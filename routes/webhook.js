const express = require('express');
const fetch = require('node-fetch');
const nacl = require('tweetnacl');

const router = express.Router();

const FORWARD_WEBHOOK = process.env.FORWARD_WEBHOOK;
if (!FORWARD_WEBHOOK) {
    console.warn('FORWARD_WEBHOOK is not configured. Incoming Discord webhooks will be acknowledged but not forwarded.');
}

const DISCORD_PUBLIC_KEY = (process.env.DISCORD_WEBHOOK_PUBLIC_KEY || process.env.DISCORD_PUBLIC_KEY || '').trim();
if (!DISCORD_PUBLIC_KEY) {
    console.warn('DISCORD_WEBHOOK_PUBLIC_KEY (or DISCORD_PUBLIC_KEY) is not configured. Discord signature verification will fail.');
}

const DISCORD_BOT_TOKEN = (process.env.DISCORD_TOKEN || process.env.BOT_TOKEN || '').trim();

const rawBodyParser = express.raw({ type: 'application/json' });

router.get('/', (_req, res) => {
    res.json({ status: 'ok' });
});

router.head('/', (_req, res) => {
    res.sendStatus(200);
});

router.post('/', rawBodyParser, async (req, res) => {
    if (!Buffer.isBuffer(req.body)) {
        return res.status(400).json({ error: 'Expected raw request body' });
    }

    const signature = req.get('X-Signature-Ed25519');
    const timestamp = req.get('X-Signature-Timestamp');

    if (!signature || !timestamp) {
        return res.status(401).json({ error: 'Missing Discord signature headers' });
    }

    if (!DISCORD_PUBLIC_KEY) {
        return res.status(500).json({ error: 'Discord public key not configured' });
    }

    const isValid = verifyDiscordRequest(signature, timestamp, req.body);
    if (!isValid) {
        return res.status(401).json({ error: 'Invalid request signature' });
    }

    let payload;
    try {
        payload = JSON.parse(req.body.toString('utf8') || '{}');
    } catch {
        return res.status(400).json({ error: 'Invalid JSON payload' });
    }

    const hasEventBlock = Boolean(payload?.event || payload?.event_type || payload?.payload);
    if (Number(payload?.type) === 1 && !hasEventBlock) {
        console.log('✅ Discord webhook challenge verified.');
        return res.json({ type: 1 });
    }

    const eventInfo = extractDiscordEvent(payload);
    if (!eventInfo) {
        console.warn('⚠️ Discord webhook payload missing event metadata; type:', payload?.type);
        if (FORWARD_WEBHOOK) {
            await forwardEventPayload(payload, {
                type: `Raw Payload (type ${payload?.type ?? 'unknown'})`,
                payload: null,
                raw: payload
            });
        }
        return res.json({ type: 5 });
    }

    console.log(`🔔 Received Discord webhook event: ${eventInfo.type}`);

    if (FORWARD_WEBHOOK) {
        await forwardEventPayload(payload, eventInfo);
    }

    // Respond with a deferred interaction style payload so Discord treats the event as acknowledged
    res.json({ type: 5 });
});

function verifyDiscordRequest(signature, timestamp, rawBody) {
    const message = Buffer.concat([
        Buffer.from(timestamp, 'utf8'),
        Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody || '')
    ]);

    try {
        return nacl.sign.detached.verify(
            message,
            Buffer.from(signature, 'hex'),
            Buffer.from(DISCORD_PUBLIC_KEY, 'hex')
        );
    } catch (error) {
        console.warn('Discord signature verification failed:', error);
        return false;
    }
}

async function forwardEventPayload(payload, eventInfo) {
    const enrichedEvent = await maybeAttachGuildOwner(eventInfo);
    const body = buildDiscordWebhookBody(payload, enrichedEvent);

    try {
        const response = await fetch(FORWARD_WEBHOOK, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errorText = await response.text().catch(() => '(no body)');
            console.error('⚠️ Discord server webhook rejected payload:', response.status, errorText);
        } else {
            console.log('📨 Forwarded webhook payload to Discord server webhook.');
        }
    } catch (error) {
        console.error('⚠️ Failed to forward webhook payload:', error);
    }
}

async function maybeAttachGuildOwner(eventInfo) {
    try {
        const data = eventInfo?.raw?.data;
        const guild = data?.guild;
        if (!guild?.id || !guild.owner_id) {
            return eventInfo;
        }

        if (data.guild_owner || !DISCORD_BOT_TOKEN) {
            return eventInfo;
        }

        const response = await fetch(`https://discord.com/api/v10/guilds/${guild.id}/members/${guild.owner_id}`, {
            headers: {
                Authorization: `Bot ${DISCORD_BOT_TOKEN}`
            }
        });

        if (!response.ok) {
            console.warn(`⚠️ Failed to fetch guild owner ${guild.owner_id} for guild ${guild.id}:`, response.status);
            return eventInfo;
        }

        const member = await response.json();
        const ownerProfile = member?.user || member;
        if (!ownerProfile) {
            return eventInfo;
        }

        return {
            ...eventInfo,
            raw: {
                ...eventInfo.raw,
                data: {
                    ...eventInfo.raw.data,
                    guild_owner: ownerProfile
                }
            }
        };
    } catch (error) {
        console.warn('⚠️ Error while fetching guild owner profile:', error);
        return eventInfo;
    }
}

function extractDiscordEvent(payload) {
    if (!payload || typeof payload !== 'object') {
        return null;
    }

    if (payload.event && typeof payload.event === 'object') {
        return {
            type: payload.event.type || payload.event_type || payload.type || 'unknown',
            payload: payload.event.payload || null,
            raw: payload.event
        };
    }

    if (payload.event_type || payload.payload) {
        return {
            type: payload.event_type || payload.type || 'unknown',
            payload: payload.payload || null,
            raw: payload
        };
    }

    return null;
}

function buildDiscordWebhookBody(originalPayload, eventInfo) {
    const eventName = (() => {
        if (eventInfo?.raw?.name) return eventInfo.raw.name;
        if (eventInfo?.type) return eventInfo.type;
        if (typeof originalPayload?.event_type !== 'undefined') return String(originalPayload.event_type);
        if (typeof originalPayload?.type !== 'undefined') return `Type ${originalPayload.type}`;
        return 'Unknown Event';
    })();

    const data = eventInfo?.raw?.data || eventInfo?.payload || {};
    const user = data.user || null;
    const guild = data.guild || null;
    const userDisplayName = user ? buildUserDisplayName(user) : 'Unknown user';
    const guildDisplayName = guild?.name || (data.integration_type === 1 ? 'Direct Authorization' : null);
    const userAvatarUrl = buildUserAvatarUrl(user);
    const guildIconUrl = buildGuildIconUrl(guild);

    const isGuildAuthorization = Boolean(guild);
    const description = isGuildAuthorization
        ? `${userDisplayName} authorized Jarvis in **${guildDisplayName}**.`
        : `${userDisplayName} completed a direct authorization (no guild metadata provided).`;

    const fields = [];
    if (guild?.id) {
        fields.push({
            name: 'Guild ID',
            value: `\`${guild.id}\``,
            inline: true
        });
    }
    if (guild?.owner_id) {
        const guildOwnerUser = data.guild_owner?.user || data.guild_owner || (user?.id === guild.owner_id ? user : null);
        const ownerUsername = guildOwnerUser?.username || guildOwnerUser?.global_name || null;
        const ownerLabel = ownerUsername ? `${ownerUsername} (\`${guild.owner_id}\`)` : `\`${guild.owner_id}\``;
        fields.push({
            name: 'Owner',
            value: ownerLabel,
            inline: true
        });
    }

    const embed = {
        title: `Discord Event: ${eventName}`,
        color: 0x5865F2,
        timestamp: new Date().toISOString(),
        description,
        fields: fields.length ? fields : undefined,
        author: user ? {
            name: userDisplayName,
            icon_url: userAvatarUrl || undefined,
            url: user?.id ? `https://discord.com/users/${user.id}` : undefined
        } : undefined,
        thumbnail: guildIconUrl ? { url: guildIconUrl } : undefined,
        footer: guildDisplayName ? { text: guildDisplayName } : undefined
    };

    Object.keys(embed).forEach((key) => {
        if (embed[key] == null) {
            delete embed[key];
        }
    });

    return {
        content: `Event detected: ${eventName} • ${userDisplayName}${guildDisplayName ? ` @ ${guildDisplayName}` : ''}`,
        embeds: [embed],
        allowed_mentions: { parse: [] }
    };
}

function buildUserDisplayName(user = {}) {
    return user.global_name || user.username || `User ${user.id ?? 'unknown'}`;
}

function buildUserAvatarUrl(user) {
    if (!user || !user.id || !user.avatar) return null;
    const isGif = String(user.avatar).startsWith('a_');
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${isGif ? 'gif' : 'png'}?size=256`;
}

function buildGuildIconUrl(guild) {
    if (!guild || !guild.id || !guild.icon) return null;
    const isGif = String(guild.icon).startsWith('a_');
    return `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.${isGif ? 'gif' : 'png'}?size=256`;
}

router.__helpers = {
    buildDiscordWebhookBody,
    extractDiscordEvent
};

module.exports = router;

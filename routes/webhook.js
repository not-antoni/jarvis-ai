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

    console.log('🌐 Discord webhook payload:', JSON.stringify(payload));

    if (Number(payload?.type) === 1) {
        console.log('✅ Discord webhook challenge verified.');
        return res.json({ type: 1 });
    }

    const eventInfo = extractDiscordEvent(payload);
    if (!eventInfo) {
        console.log('⚠️ Discord webhook payload missing event metadata; payload:', JSON.stringify(payload));
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
        console.log('🚀 Forwarding event to Discord webhook:', JSON.stringify(eventInfo));
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
    const body = buildDiscordWebhookBody(payload, eventInfo);

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
    const pretty = JSON.stringify(originalPayload ?? {}, null, 2);
    const MAX_DESC = 4000;
    const truncated = pretty.length > MAX_DESC
        ? `${pretty.slice(0, MAX_DESC - 30)}\n... (truncated ${pretty.length - (MAX_DESC - 30)} chars)`
        : pretty;

    const eventName = (() => {
        if (eventInfo?.raw?.name) return eventInfo.raw.name;
        if (eventInfo?.type) return eventInfo.type;
        if (typeof originalPayload?.event_type !== 'undefined') return String(originalPayload.event_type);
        if (typeof originalPayload?.type !== 'undefined') return `Type ${originalPayload.type}`;
        return 'Unknown Event';
    })();

    const data = eventInfo?.payload || {};

    const user = data.user || null;
    const guild = data.guild || null;
    const embed = {
        title: `Discord Event: ${eventName}`,
        color: 0x5865F2,
        timestamp: new Date().toISOString(),
        description: `\`\`\`json\n${truncated}\n\`\`\``,
        fields: [],
        author: user ? {
            name: buildUserDisplayName(user),
            icon_url: buildUserAvatarUrl(user),
            url: `https://discord.com/users/${user.id}`
        } : undefined,
        thumbnail: guild ? {
            url: buildGuildIconUrl(guild)
        } : undefined
    };

    const addField = (name, value, inline = false) => {
        if (value == null) return;
        const stringValue = String(value).trim();
        if (!stringValue) return;
        embed.fields.push({ name, value: stringValue.slice(0, 1024), inline });
    };

    addField('Event Type', eventInfo?.type || 'unknown');
    addField('Application ID', originalPayload?.application_id);
    addField('Event ID', originalPayload?.id);
    addField('Event Version', originalPayload?.version);

    addField('Scopes', Array.isArray(data.scopes) ? data.scopes.join(', ') : data.scopes || null);
    addField('Integration Type', typeof data.integration_type !== 'undefined' ? data.integration_type : null, true);
    addField('User ID', data.user_id || user?.id || null, true);
    addField('Guild ID', data.guild_id || guild?.id || null, true);
    addField('Authorization', data.authorization_id, true);
    addField('Entitlement', data.entitlement_id, true);
    addField('SKU', data.sku_id, true);

    if (!embed.fields.length) {
        addField('Info', 'No additional metadata supplied by Discord.');
    }

    return {
        content: `Event detected: ${eventName}`,
        embeds: [embed],
        allowed_mentions: { parse: [] }
    };
}

function buildUserDisplayName(user = {}) {
    return user.global_name || user.username || `User ${user.id ?? 'unknown'}`;
}

function buildUserAvatarUrl(user = {}) {
    if (!user.id || !user.avatar) return null;
    const isGif = String(user.avatar).startsWith('a_');
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${isGif ? 'gif' : 'png'}?size=256`;
}

function buildGuildIconUrl(guild = {}) {
    if (!guild.id || !guild.icon) return null;
    const isGif = String(guild.icon).startsWith('a_');
    return `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.${isGif ? 'gif' : 'png'}?size=256`;
}

module.exports = router;

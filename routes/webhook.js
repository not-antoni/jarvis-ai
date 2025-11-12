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

    if (Number(payload?.type) === 1) {
        console.log('✅ Discord webhook challenge verified.');
        return res.json({ type: 1 });
    }

    console.log('🔔 Received Discord webhook event:', JSON.stringify(payload));

    if (FORWARD_WEBHOOK) {
        await forwardEventPayload(payload);
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

async function forwardEventPayload(payload) {
    const body = buildDiscordWebhookBody(payload);

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

function buildDiscordWebhookBody(payload) {
    const pretty = JSON.stringify(payload ?? {}, null, 2);
    const MAX_DESC = 4000;
    const truncated = pretty.length > MAX_DESC
        ? `${pretty.slice(0, MAX_DESC - 30)}\n... (truncated ${pretty.length - (MAX_DESC - 30)} chars)`
        : pretty;

    const eventName = payload?.event?.name
        ? payload.event.name
        : payload?.event_type
            ? String(payload.event_type)
            : typeof payload?.type !== 'undefined'
                ? `Type ${payload.type}`
                : 'Unknown Event';

    const embed = {
        title: `Discord Event: ${eventName}`,
        color: 0x5865F2,
        timestamp: new Date().toISOString(),
        description: `\`\`\`json\n${truncated}\n\`\`\``,
        fields: []
    };

    const addField = (name, value, inline = false) => {
        if (value == null) return;
        const stringValue = String(value).trim();
        if (!stringValue) return;
        embed.fields.push({ name, value: stringValue.slice(0, 1024), inline });
    };

    addField('Application ID', payload?.application_id);
    addField('Event ID', payload?.id);
    addField('Event Version', payload?.version);

    const eventPayload = payload?.event?.payload || payload?.payload || null;
    if (eventPayload) {
        addField('User', eventPayload.user_id || eventPayload.user?.id || null, true);
        addField('Guild', eventPayload.guild_id || eventPayload.guild?.id || null, true);
        addField('Authorization', eventPayload.authorization_id, true);
        addField('Entitlement', eventPayload.entitlement_id, true);
    }

    if (!embed.fields.length) {
        addField('Info', 'No additional metadata supplied by Discord.');
    }

    return {
        embeds: [embed],
        allowed_mentions: { parse: [] }
    };
}

module.exports = router;

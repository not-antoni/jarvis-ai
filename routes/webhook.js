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

    if (!FORWARD_WEBHOOK) {
        return res.sendStatus(202);
    }

    try {
        await fetch(FORWARD_WEBHOOK, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload ?? {})
        });
        console.log('📨 Forwarded webhook payload to Discord server webhook.');
    } catch (error) {
        console.error('⚠️ Failed to forward webhook payload:', error);
    }

    res.sendStatus(200);
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

module.exports = router;

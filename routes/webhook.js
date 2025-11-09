const express = require('express');
const fetch = require('node-fetch');

const router = express.Router();
const FORWARD_WEBHOOK = process.env.FORWARD_WEBHOOK;

if (!FORWARD_WEBHOOK) {
    console.warn('FORWARD_WEBHOOK is not configured. Incoming Discord webhooks will be acknowledged but not forwarded.');
}

router.post('/', async (req, res) => {
    if (req.body?.type === 1) {
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
            body: JSON.stringify(req.body ?? {})
        });
        console.log('📨 Forwarded webhook payload to Discord server webhook.');
    } catch (error) {
        console.error('⚠️ Failed to forward webhook payload:', error);
    }

    res.sendStatus(200);
});

module.exports = router;

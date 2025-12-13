#!/usr/bin/env node
require('dotenv').config();
const fetch = require('node-fetch');
const { summarizeUrl } = require('../src/utils/agent-preview');
const config = require('../config');

async function main() {
    const url = process.argv[2];
    const webhook = process.env.AGENT_WEBHOOK;

    if (!url) {
        console.error('Usage: node scripts/run-agent-preview.js <url>');
        process.exit(1);
    }

    if (config?.deployment?.target !== 'selfhost' || !config?.deployment?.liveAgentMode) {
        console.error(
            'Agent preview is disabled. Set DEPLOY_TARGET=selfhost and LIVE_AGENT_MODE=true.'
        );
        process.exit(1);
    }

    try {
        const result = await summarizeUrl(url);
        console.log('Summary:', result.summary);

        if (webhook) {
            const payload = {
                content: null,
                embeds: [
                    {
                        title: `Agent preview`,
                        url: result.url,
                        description: result.summary.slice(0, 4000),
                        color: 0x1f8b4c,
                        footer: { text: 'Self-host agent preview (single page)' },
                        timestamp: new Date().toISOString()
                    }
                ]
            };
            const res = await fetch(webhook, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!res.ok) {
                const text = await res.text();
                throw new Error(`Webhook failed: ${res.status} ${text}`);
            }
            console.log('Sent to webhook.');
        }
    } catch (err) {
        console.error('Agent preview failed:', err.message || err);
        process.exit(1);
    }
}

main();

#!/usr/bin/env node
/**
 * Batch agent preview runner with simple resume support.
 * - Selfhost only: DEPLOY_TARGET=selfhost LIVE_AGENT_MODE=true
 * - Optionally send each result to AGENT_WEBHOOK.
 * - Stores progress in data/agent-session.json so reruns skip completed URLs unless --force.
 *
 * Usage:
 *   node scripts/run-agent-session.js <url1> <url2> ...
 *   node scripts/run-agent-session.js --file urls.txt
 *   node scripts/run-agent-session.js --resume
 *
 * Flags:
 *   --file <path>   Load URLs (one per line) from a file
 *   --resume        Resume pending entries from previous state
 *   --force         Reprocess even if already completed
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const { summarizeUrl } = require('../src/utils/agent-preview');
const config = require('../config');

const STATE_PATH = path.join(__dirname, '..', 'data', 'agent-session.json');

function loadState() {
    try {
        if (fs.existsSync(STATE_PATH)) {
            const raw = fs.readFileSync(STATE_PATH, 'utf8');
            if (raw) return JSON.parse(raw);
        }
    } catch (err) {
        console.warn('Failed to load session state:', err);
    }
    return { entries: [] };
}

function saveState(state) {
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function parseArgs() {
    const args = process.argv.slice(2);
    const opts = { urls: [], resume: false, force: false, file: null };
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--resume') {
            opts.resume = true;
        } else if (arg === '--force') {
            opts.force = true;
        } else if (arg === '--file') {
            opts.file = args[i + 1];
            i += 1;
        } else {
            opts.urls.push(arg);
        }
    }
    return opts;
}

function readUrlsFromFile(filePath) {
    if (!filePath) return [];
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        return raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    } catch (err) {
        console.error('Failed to read URL file:', err.message);
        return [];
    }
}

async function sendWebhook(webhook, payload) {
    if (!webhook) return;
    const res = await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Webhook failed: ${res.status} ${text}`);
    }
}

async function main() {
    if (config?.deployment?.target !== 'selfhost' || !config?.deployment?.liveAgentMode) {
        console.error('Agent preview is disabled. Set DEPLOY_TARGET=selfhost and LIVE_AGENT_MODE=true.');
        process.exit(1);
    }

    const opts = parseArgs();
    const fileUrls = readUrlsFromFile(opts.file);
    const inputUrls = [...opts.urls, ...fileUrls].filter(Boolean);
    const state = loadState();

    if (!opts.resume && inputUrls.length === 0) {
        console.error('Provide URLs or use --resume.');
        process.exit(1);
    }

    const now = new Date().toISOString();
    const known = new Map(state.entries.map((e) => [e.url, e]));

    if (!opts.resume) {
        for (const url of inputUrls) {
            if (!known.has(url)) {
                state.entries.push({ url, status: 'pending', summary: null, error: null, updatedAt: now });
            } else if (opts.force) {
                const entry = known.get(url);
                entry.status = 'pending';
                entry.error = null;
                entry.updatedAt = now;
            }
        }
    }

    const toProcess = state.entries.filter((e) => e.status !== 'done');
    if (!toProcess.length) {
        console.log('Nothing to process.');
        return;
    }

    const webhook = process.env.AGENT_WEBHOOK;

    for (const entry of toProcess) {
        console.log(`Processing: ${entry.url}`);
        try {
            const result = await summarizeUrl(entry.url);
            entry.status = 'done';
            entry.summary = result.summary;
            entry.error = null;
            entry.updatedAt = new Date().toISOString();

            const payload = {
                content: null,
                embeds: [
                    {
                        title: result.title || entry.url,
                        url: result.url,
                        description: result.summary.slice(0, 4000),
                        color: 0x1f8b4c,
                        footer: { text: 'Agent preview (selfhost)' },
                        timestamp: new Date().toISOString()
                    }
                ]
            };
            await sendWebhook(webhook, payload).catch((err) => {
                console.warn('Webhook send failed:', err.message);
            });
        } catch (err) {
            entry.status = 'error';
            entry.error = err.message || String(err);
            entry.updatedAt = new Date().toISOString();
            console.error(`Failed: ${entry.url} -> ${entry.error}`);
        }
        saveState(state);
    }

    console.log('Done. State saved to', STATE_PATH);
}

main();

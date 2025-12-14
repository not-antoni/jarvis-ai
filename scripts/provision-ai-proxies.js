'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const database = require('../src/services/database');

function parseBoolean(value, fallback = false) {
    if (value == null) return Boolean(fallback);
    const normalized = String(value).trim().toLowerCase();
    if (!normalized) return Boolean(fallback);
    if (['1', 'true', 'yes', 'on', 'enabled'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off', 'disabled'].includes(normalized)) return false;
    return Boolean(fallback);
}

function requireEnv(name) {
    const value = process.env[name];
    if (!value || !String(value).trim()) {
        throw new Error(`Missing required env var: ${name}`);
    }
    return String(value).trim();
}

function getAuthHeaders() {
    const token = String(process.env.CLOUDFLARE_API_TOKEN || '').trim();
    if (token) {
        return { Authorization: `Bearer ${token}` };
    }

    const email = String(process.env.CLOUDFLARE_EMAIL || '').trim();
    const key = String(process.env.CLOUDFLARE_GLOBAL_API_KEY || '').trim();
    if (email && key) {
        return {
            'X-Auth-Email': email,
            'X-Auth-Key': key
        };
    }

    throw new Error(
        'Missing Cloudflare auth. Set CLOUDFLARE_API_TOKEN (recommended) or (CLOUDFLARE_EMAIL + CLOUDFLARE_GLOBAL_API_KEY).'
    );
}

async function cfFetch(url, init = {}) {
    const headers = {
        ...(init.headers || null),
        ...getAuthHeaders()
    };

    const res = await fetch(url, {
        ...init,
        headers
    });

    const text = await res.text().catch(() => '');
    let json = null;
    try {
        json = text ? JSON.parse(text) : null;
    } catch {
        json = null;
    }

    if (!res.ok) {
        const details = json ? JSON.stringify(json).slice(0, 800) : text.slice(0, 800);
        throw new Error(`Cloudflare API error ${res.status} ${res.statusText}: ${details}`);
    }

    return json;
}

async function ensureWorkersSubdomain({ accountId, subdomain }) {
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`;
    return cfFetch(url, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ subdomain })
    });
}

async function getWorkersSubdomain({ accountId }) {
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`;
    const resp = await cfFetch(url, { method: 'GET' });
    const subdomain = resp && resp.result && resp.result.subdomain ? String(resp.result.subdomain) : '';
    return subdomain.trim() || null;
}

function toSlug(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 42);
}

async function uploadWorkerModule({ accountId, scriptName, workerSource, allowedHosts }) {
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${encodeURIComponent(scriptName)}`;

    const mainModule = 'ai-proxy-worker.js';
    const metadata = {
        main_module: mainModule,
        compatibility_date: '2025-12-01',
        bindings: [
            {
                type: 'plain_text',
                name: 'AI_PROXY_ALLOWED_HOSTS',
                text: allowedHosts
            }
        ]
    };

    const form = new FormData();
    form.append('metadata', JSON.stringify(metadata));

    const blob = new Blob([workerSource], { type: 'application/javascript+module' });
    form.append(mainModule, blob, mainModule);

    return cfFetch(url, {
        method: 'PUT',
        body: form
    });
}

async function setWorkerSecret({ accountId, scriptName, name, value }) {
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${encodeURIComponent(scriptName)}/secrets`;

    return cfFetch(url, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name, text: value, type: 'secret_text' })
    });
}

async function enableWorkersDev({ accountId, scriptName }) {
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${encodeURIComponent(scriptName)}/subdomain`;

    return cfFetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ enabled: true })
    });
}

function loadWorkerSource() {
    const workerPath = path.join(__dirname, '..', 'cloudflare', 'ai-proxy-worker.js');
    if (!fs.existsSync(workerPath)) {
        throw new Error(`Worker source file not found: ${workerPath}`);
    }

    const src = fs.readFileSync(workerPath, 'utf8');
    if (!src.trim()) {
        throw new Error(`Worker source file is empty: ${workerPath}`);
    }

    return src;
}

async function main() {
    const accountId = requireEnv('CLOUDFLARE_ACCOUNT_ID');
    const configuredSubdomain = String(process.env.CLOUDFLARE_WORKERS_SUBDOMAIN || '').trim();

    const countRaw = process.env.AI_PROXY_WORKERS_COUNT || process.env.AI_PROXY_COUNT || '3';
    const count = Math.max(1, Number(countRaw) || 3);

    const prefix = String(process.env.AI_PROXY_WORKER_PREFIX || 'jarvis-ai-proxy').trim();
    if (!prefix) {
        throw new Error('AI_PROXY_WORKER_PREFIX is empty');
    }

    const allowedHosts = String(
        process.env.AI_PROXY_ALLOWED_HOSTS ||
            'api.openai.com,openrouter.ai,api.groq.com,ollama.com,ai-gateway.vercel.sh'
    ).trim();

    const setToken = parseBoolean(process.env.AI_PROXY_SET_WORKER_TOKEN, true);
    const proxyToken = String(process.env.AI_PROXY_TOKEN || '').trim();

    if (setToken && !proxyToken) {
        throw new Error('AI_PROXY_TOKEN is required when AI_PROXY_SET_WORKER_TOKEN=true');
    }

    const workerSource = loadWorkerSource();

    let subdomain = null;

    console.log('[ai-proxy] Resolving workers.dev subdomain...');
    try {
        subdomain = await getWorkersSubdomain({ accountId });
    } catch {
        subdomain = null;
    }

    if (!subdomain) {
        const desired = configuredSubdomain || `${toSlug(prefix)}-${String(accountId).slice(0, 6)}`;
        console.log(`[ai-proxy] Creating workers.dev subdomain: ${desired}`);
        await ensureWorkersSubdomain({ accountId, subdomain: desired });
        subdomain = await getWorkersSubdomain({ accountId });
    }

    if (!subdomain) {
        throw new Error(
            'Unable to determine workers.dev subdomain. Set CLOUDFLARE_WORKERS_SUBDOMAIN and retry.'
        );
    }

    const urls = [];

    for (let i = 1; i <= count; i += 1) {
        const scriptName = `${prefix}-${i}`;
        console.log(`[ai-proxy] Uploading ${scriptName}...`);
        await uploadWorkerModule({ accountId, scriptName, workerSource, allowedHosts });

        if (setToken) {
            console.log(`[ai-proxy] Setting secret AI_PROXY_TOKEN for ${scriptName}...`);
            await setWorkerSecret({
                accountId,
                scriptName,
                name: 'AI_PROXY_TOKEN',
                value: proxyToken
            });
        }

        console.log(`[ai-proxy] Enabling workers.dev for ${scriptName}...`);
        await enableWorkersDev({ accountId, scriptName });

        urls.push(`https://${scriptName}.${subdomain}.workers.dev/`);
    }

    const saveToDb = parseBoolean(process.env.AI_PROXY_SAVE_TO_DB, true);
    if (saveToDb) {
        console.log('\n[ai-proxy] Saving proxy URLs to MongoDB...');
        try {
            await database.connect();
            if (!database.isConnected) {
                throw new Error('Database is not connected');
            }
            await database.saveAiProxyConfig({ enabled: true, urls });
            console.log('[ai-proxy] Saved AI proxy config to MongoDB');
        } finally {
            try {
                await database.disconnect();
            } catch {
                // ignore
            }
        }
    }

    console.log('\n[ai-proxy] Provisioned proxy endpoints:');
    urls.forEach(url => console.log(url));

    console.log('\n[ai-proxy] Add this to your .env:');
    console.log(`AI_PROXY_ENABLED=true`);
    console.log(`AI_PROXY_URLS=${urls.join(',')}`);
    console.log(`AI_PROXY_STRATEGY=round_robin`);
    console.log(`AI_PROXY_DEBUG=true`);
    console.log(`AI_PROXY_FALLBACK_DIRECT=true`);
}

main().catch(err => {
    console.error(err.message || err);
    process.exitCode = 1;
});

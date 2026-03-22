'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { __testing } = require('../src/services/ai-proxy');

const ORIGINAL_FETCH = global.fetch;
const ENV_KEYS = [
    'AI_PROXY_ENABLED',
    'AI_PROXY_URLS',
    'AI_PROXY_BYPASS_HOSTS',
    'AI_PROXY_ALLOWED_HOSTS',
    'AI_PROXY_FALLBACK_DIRECT',
    'AI_PROXY_STRATEGY'
];

function saveEnv() {
    return Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));
}

function restoreEnv(snapshot) {
    for (const key of ENV_KEYS) {
        if (snapshot[key] == null) {
            delete process.env[key];
        } else {
            process.env[key] = snapshot[key];
        }
    }
}

test('generativelanguage.googleapis.com bypasses proxies by default', async() => {
    const envSnapshot = saveEnv();
    const seen = [];

    global.fetch = async(input) => {
        const url = input instanceof Request ? input.url : String(input);
        seen.push(url);
        return new Response('ok', { status: 200 });
    };

    process.env.AI_PROXY_ENABLED = 'true';
    process.env.AI_PROXY_URLS = 'https://proxy-1.example/';
    process.env.AI_PROXY_ALLOWED_HOSTS = 'generativelanguage.googleapis.com';
    delete process.env.AI_PROXY_BYPASS_HOSTS;

    try {
        const fetcher = __testing.createProxyingFetch();
        const response = await fetcher('https://generativelanguage.googleapis.com/v1beta/models');

        assert.equal(response.status, 200);
        assert.deepEqual(seen, ['https://generativelanguage.googleapis.com/v1beta/models']);
    } finally {
        global.fetch = ORIGINAL_FETCH;
        restoreEnv(envSnapshot);
    }
});

test('429 stops proxy rotation and falls back direct once', async() => {
    const envSnapshot = saveEnv();
    const seen = [];
    const targetUrl = 'https://api.openai.com/v1/chat/completions';
    const proxyUrl = `https://proxy-1.example/?url=${encodeURIComponent(targetUrl)}`;

    global.fetch = async(input) => {
        const url = input instanceof Request ? input.url : String(input);
        seen.push(url);

        if (url === proxyUrl) {
            return new Response('rate limited', { status: 429 });
        }

        if (url === targetUrl) {
            return new Response('ok', { status: 200 });
        }

        throw new Error(`Unexpected URL: ${url}`);
    };

    process.env.AI_PROXY_ENABLED = 'true';
    process.env.AI_PROXY_URLS = 'https://proxy-1.example/,https://proxy-2.example/';
    process.env.AI_PROXY_ALLOWED_HOSTS = 'api.openai.com';
    process.env.AI_PROXY_BYPASS_HOSTS = '';
    process.env.AI_PROXY_FALLBACK_DIRECT = 'true';
    process.env.AI_PROXY_STRATEGY = 'round_robin';

    try {
        const fetcher = __testing.createProxyingFetch();
        const response = await fetcher(targetUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{}'
        });

        assert.equal(response.status, 200);
        assert.deepEqual(seen, [proxyUrl, targetUrl]);
    } finally {
        global.fetch = ORIGINAL_FETCH;
        restoreEnv(envSnapshot);
    }
});

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const path = require('path');

function reloadBrave(env) {
    const previous = {};
    for (const key of Object.keys(env)) {
        previous[key] = process.env[key];
        if (env[key] === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = env[key];
        }
    }
    const modPath = path.resolve(__dirname, '..', 'src', 'services', 'brave-search.js');
    delete require.cache[modPath];
    const brave = require(modPath);
    return {
        brave,
        restore() {
            for (const key of Object.keys(previous)) {
                if (previous[key] === undefined) {
                    delete process.env[key];
                } else {
                    process.env[key] = previous[key];
                }
            }
            delete require.cache[modPath];
        }
    };
}

// ─── #262: NSFW SafeSearch is strict by default ─────────────────────────

test('brave-search uses safesearch=strict by default for web', async() => {
    const { brave, restore } = reloadBrave({
        BRAVE_SEARCH_API_KEY: 'test',
        BRAVE_SAFESEARCH: undefined,
        BRAVE_IMAGE_SAFESEARCH: undefined
    });
    let capturedUrl = null;
    const realFetch = globalThis.fetch;
    globalThis.fetch = async(url) => {
        capturedUrl = String(url);
        return new Response(JSON.stringify({ web: { results: [] } }), {
            status: 200, headers: { 'Content-Type': 'application/json' }
        });
    };
    try {
        await brave.searchWeb('test query');
        assert.match(capturedUrl, /safesearch=strict/);
    } finally {
        globalThis.fetch = realFetch;
        restore();
    }
});

test('brave-search honours BRAVE_SAFESEARCH override', async() => {
    const { brave, restore } = reloadBrave({
        BRAVE_SEARCH_API_KEY: 'test',
        BRAVE_SAFESEARCH: 'moderate',
        BRAVE_IMAGE_SAFESEARCH: undefined
    });
    let capturedUrl = null;
    const realFetch = globalThis.fetch;
    globalThis.fetch = async(url) => {
        capturedUrl = String(url);
        return new Response(JSON.stringify({ web: { results: [] } }), {
            status: 200, headers: { 'Content-Type': 'application/json' }
        });
    };
    try {
        await brave.searchWeb('test query');
        assert.match(capturedUrl, /safesearch=moderate/);
    } finally {
        globalThis.fetch = realFetch;
        restore();
    }
});

test('brave-search images default to safesearch=strict', async() => {
    const { brave, restore } = reloadBrave({
        BRAVE_SEARCH_API_KEY: 'test',
        BRAVE_SAFESEARCH: undefined,
        BRAVE_IMAGE_SAFESEARCH: undefined
    });
    let capturedUrl = null;
    const realFetch = globalThis.fetch;
    globalThis.fetch = async(url) => {
        capturedUrl = String(url);
        return new Response(JSON.stringify({ results: [] }), {
            status: 200, headers: { 'Content-Type': 'application/json' }
        });
    };
    try {
        await brave.searchImages('cat picture');
        assert.match(capturedUrl, /safesearch=strict/);
    } finally {
        globalThis.fetch = realFetch;
        restore();
    }
});

// ─── #259 follow-up: explicit search verbs always trigger ──────────────

test('detectSearchPlan triggers on standalone "search X" phrasing', () => {
    const { brave, restore } = reloadBrave({});
    try {
        const cases = [
            'search jarvis news',
            'google quantum computing',
            'look it up please',
            'find me info on xenon',
            'research this topic for me',
            'lookup nodejs docs'
        ];
        for (const prompt of cases) {
            const plan = brave.detectSearchPlan(prompt);
            assert.ok(plan, `expected a search plan for "${prompt}"`);
        }
    } finally {
        restore();
    }
});

'use strict';

require('dotenv').config();

const test = require('node:test');
const assert = require('node:assert/strict');

const AIProviderManager = require('../src/services/ai-providers');

function withManager(setup) {
    const manager = Object.create(Object.getPrototypeOf(AIProviderManager));
    Object.assign(manager, {
        providers: [],
        providerErrors: new Map(),
        metrics: new Map(),
        disabledProviders: new Map(),
        roundRobinIndex: 0,
        sessionStickiness: new Map(),
        sessionStickinessMs: 60 * 1000,
        selectedProviderType: 'auto',
        openRouterGlobalFailure: false,
        openRouterFailureCount: 0,
        providerFailureCounts: new Map(),
        stateSaveTimer: null,
        stateSaveDebounceMs: 5000,
        stateDirty: false,
        totalTokensIn: 0,
        totalTokensOut: 0,
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        activeRequests: 0,
        activeRequestsPeak: 0,
        loadConfig: {
            maxConcurrent: 20,
            softCap: 10,
            rejectThreshold: 30
        }
    });

    setup(manager);
    return manager;
}

test('auto session stickiness prefers groq family over google within free tier', () => {
    const manager = withManager((instance) => {
        instance.providers = [
            { name: 'GoogleAI1-gemini-3.1-flash-lite-preview', family: 'google', costTier: 'free' },
            { name: 'Groq1-kimi-k2-instruct-0905', family: 'groq', costTier: 'free' },
            { name: 'GoogleAI2-gemini-3.1-flash-lite-preview', family: 'google', costTier: 'free' }
        ];
    });

    const picked = manager._getSessionStickyProvider('user-1');

    assert.equal(picked?.family, 'groq');
    assert.equal(picked?.name, 'Groq1-kimi-k2-instruct-0905');
});

test('ranked providers de-prioritize google behind groq in auto mode', () => {
    const manager = withManager((instance) => {
        instance.providers = [
            { name: 'GoogleAI1-gemini-3.1-flash-lite-preview', family: 'google', costTier: 'free' },
            { name: 'Groq1-kimi-k2-instruct-0905', family: 'groq', costTier: 'free' },
            { name: 'GoogleAI2-gemini-3.1-flash-lite-preview', family: 'google', costTier: 'free' }
        ];
    });

    const ranked = manager._rankedProviders();

    assert.deepEqual(
        ranked.map(provider => provider.name),
        [
            'Groq1-kimi-k2-instruct-0905',
            'GoogleAI1-gemini-3.1-flash-lite-preview',
            'GoogleAI2-gemini-3.1-flash-lite-preview'
        ]
    );
});

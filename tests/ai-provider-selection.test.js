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
        disabledProviderMeta: new Map(),
        roundRobinIndex: 0,
        sessionStickiness: new Map(),
        sessionStickinessMs: 60 * 1000,
        selectedProviderType: 'auto',
        openRouterGlobalFailure: false,
        openRouterFailureCount: 0,
        providerFailureCounts: new Map(),
        providerPoisonCounts: new Map(),
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
        },
        saveState: async() => {},
        scheduleStateSave: () => {}
    });

    setup(manager);
    return manager;
}

test('auto session stickiness prefers groq family over google within free tier', () => {
    const manager = withManager((instance) => {
        instance.providers = [
            { name: 'GoogleAI1-gemini-3.1-flash-lite-preview', family: 'google', costTier: 'free' },
            { name: 'Groq1-llama-3.3-70b-versatile', family: 'groq', costTier: 'free' },
            { name: 'GoogleAI2-gemini-3.1-flash-lite-preview', family: 'google', costTier: 'free' }
        ];
    });

    const picked = manager._getSessionStickyProvider('user-1');

    assert.equal(picked?.family, 'groq');
    assert.equal(picked?.name, 'Groq1-llama-3.3-70b-versatile');
});

test('ranked providers de-prioritize google behind groq in auto mode', () => {
    const manager = withManager((instance) => {
        instance.providers = [
            { name: 'GoogleAI1-gemini-3.1-flash-lite-preview', family: 'google', costTier: 'free' },
            { name: 'Groq1-llama-3.3-70b-versatile', family: 'groq', costTier: 'free' },
            { name: 'GoogleAI2-gemini-3.1-flash-lite-preview', family: 'google', costTier: 'free' }
        ];
    });

    const ranked = manager._rankedProviders();

    assert.deepEqual(
        ranked.map(provider => provider.name),
        [
            'Groq1-llama-3.3-70b-versatile',
            'GoogleAI1-gemini-3.1-flash-lite-preview',
            'GoogleAI2-gemini-3.1-flash-lite-preview'
        ]
    );
});

test('session stickiness drops cached providers once they are disabled', () => {
    const manager = withManager((instance) => {
        instance.providers = [
            {
                name: 'Groq1-llama-3.3-70b-versatile',
                family: 'groq',
                costTier: 'free',
                credentialGroup: 'groq:1'
            },
            {
                name: 'Cerebras1-qwen-3-235b-a22b-instruct-2507',
                family: 'cerebras',
                costTier: 'free',
                credentialGroup: 'cerebras:1'
            }
        ];
        instance.sessionStickiness.set('user-2', instance.providers[0]);
        instance.disabledProviders.set('Groq1-llama-3.3-70b-versatile', Date.now() + 60_000);
    });

    const picked = manager._getSessionStickyProvider('user-2');

    assert.equal(picked?.name, 'Cerebras1-qwen-3-235b-a22b-instruct-2507');
});

test('forced provider mode fails open to auto when the selected family has no active providers', () => {
    const manager = withManager((instance) => {
        instance.selectedProviderType = 'google';
        instance.providers = [
            {
                name: 'GoogleAI1-gemini-2.0-flash',
                family: 'google',
                costTier: 'free',
                credentialGroup: 'google:1'
            },
            {
                name: 'Groq1-llama-3.3-70b-versatile',
                family: 'groq',
                costTier: 'free',
                credentialGroup: 'groq:1'
            }
        ];
        instance.disabledProviders.set('GoogleAI1-gemini-2.0-flash', Date.now() + 60_000);
    });

    const available = manager._availableProviders();

    assert.deepEqual(
        available.map(provider => provider.name),
        ['Groq1-llama-3.3-70b-versatile']
    );
});

test('google preview models are opt-in', () => {
    const original = process.env.GOOGLE_AI_ENABLE_PREVIEW_MODELS;
    const originalGoogleKey = process.env.GOOGLE_AI_API_KEY;

    try {
        process.env.GOOGLE_AI_API_KEY = 'test-google-key';
        delete process.env.GOOGLE_AI_ENABLE_PREVIEW_MODELS;
        const withoutPreview = withManager(instance => {
            instance.setupProviders();
        });
        assert.equal(
            withoutPreview.providers.some(
                provider => provider.model === 'gemini-3-pro-preview'
            ),
            false
        );

        process.env.GOOGLE_AI_ENABLE_PREVIEW_MODELS = '1';
        const withPreview = withManager(instance => {
            instance.setupProviders();
        });
        assert.equal(
            withPreview.providers.some(
                provider => provider.model === 'gemini-3-pro-preview'
            ),
            true
        );
    } finally {
        if (originalGoogleKey == null) {
            delete process.env.GOOGLE_AI_API_KEY;
        } else {
            process.env.GOOGLE_AI_API_KEY = originalGoogleKey;
        }
        if (original == null) {
            delete process.env.GOOGLE_AI_ENABLE_PREVIEW_MODELS;
        } else {
            process.env.GOOGLE_AI_ENABLE_PREVIEW_MODELS = original;
        }
    }
});

test('poison quarantine benches repeat offenders and exposes cooldown metadata', () => {
    const manager = withManager((instance) => {
        instance.providers = [
            {
                name: 'GoogleAI1-gemma-4-31b-it',
                family: 'google',
                type: 'google',
                model: 'gemma-4-31b-it',
                costTier: 'free',
                credentialGroup: 'google:1'
            }
        ];
    });

    const firstHit = manager.recordPoisonedOutput(
        'GoogleAI1-gemma-4-31b-it',
        '[SECURE_MEMORY_BLOCK] leaked prompt',
        {
            hash: 'abc123def456',
            sample: '[SECURE_MEMORY_BLOCK] leaked prompt'
        }
    );
    const secondHit = manager.recordPoisonedOutput(
        'GoogleAI1-gemma-4-31b-it',
        '[SECURE_MEMORY_BLOCK] leaked prompt again',
        {
            hash: 'fed654cba321',
            sample: '[SECURE_MEMORY_BLOCK] leaked prompt again'
        }
    );

    assert.deepEqual(firstHit, { count: 1, benched: false });
    assert.equal(secondHit.count, 2);
    assert.equal(secondHit.benched, true);
    assert.equal(secondHit.durationMs, 30 * 60 * 1000);

    const providerStatus = manager
        .getProviderStatus()
        .find(provider => provider.name === 'GoogleAI1-gemma-4-31b-it');

    assert.equal(providerStatus?.isDisabled, true);
    assert.equal(providerStatus?.credentialGroup, 'google:1');
    assert.equal(providerStatus?.disabledReason, 'poisoned output x2');
    assert.equal(providerStatus?.disabledSource, 'garbage-detection');

    const providerError = manager.providerErrors.get('GoogleAI1-gemma-4-31b-it');
    assert.equal(providerError?.status, 'poison');
    assert.equal(providerError?.source, 'garbage-detection');
    assert.equal(providerError?.count, 2);
    assert.equal(providerError?.hash, 'fed654cba321');
    assert.equal(providerError?.sample, '[SECURE_MEMORY_BLOCK] leaked prompt again');
});

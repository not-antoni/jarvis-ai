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

test('ranked providers prefer healthy fast history over slow fallback history', () => {
    const manager = withManager((instance) => {
        instance.providers = [
            { name: 'GoogleAI3-gemma-4-31b-it', family: 'google', costTier: 'free' },
            { name: 'Cerebras2-qwen-3-235b-a22b-instruct-2507', family: 'cerebras', costTier: 'free' },
            { name: 'Groq1-llama-3.3-70b-versatile', family: 'groq', costTier: 'free' }
        ];
        instance.metrics.set('GoogleAI3-gemma-4-31b-it', {
            successes: 90,
            failures: 10,
            avgLatencyMs: 18000
        });
        instance.metrics.set('Cerebras2-qwen-3-235b-a22b-instruct-2507', {
            successes: 70,
            failures: 30,
            avgLatencyMs: 900
        });
        instance.metrics.set('Groq1-llama-3.3-70b-versatile', {
            successes: 40,
            failures: 60,
            avgLatencyMs: 120
        });
    });

    const ranked = manager._rankedProviders();

    assert.deepEqual(
        ranked.map(provider => provider.name),
        [
            'Cerebras2-qwen-3-235b-a22b-instruct-2507',
            'Groq1-llama-3.3-70b-versatile',
            'GoogleAI3-gemma-4-31b-it'
        ]
    );
});

test('ranked providers push dead zero-success lanes behind cold alternatives in auto mode', () => {
    const manager = withManager((instance) => {
        instance.providers = [
            { name: 'GoogleAI7-gemini-2.0-flash', family: 'google', costTier: 'free' },
            { name: 'OpenRouter1-gemma-4-31b-it', family: 'openrouter', costTier: 'free' },
            { name: 'Groq1-llama-3.3-70b-versatile', family: 'groq', costTier: 'free' }
        ];
        instance.metrics.set('GoogleAI7-gemini-2.0-flash', {
            successes: 0,
            failures: 12,
            avgLatencyMs: 180
        });
        instance.metrics.set('Groq1-llama-3.3-70b-versatile', {
            successes: 10,
            failures: 2,
            avgLatencyMs: 200
        });
    });

    const ranked = manager._rankedProviders();

    assert.deepEqual(
        ranked.map(provider => provider.name),
        [
            'Groq1-llama-3.3-70b-versatile',
            'OpenRouter1-gemma-4-31b-it',
            'GoogleAI7-gemini-2.0-flash'
        ]
    );
});

test('persisted OpenRouter global failures are ignored on startup', () => {
    let scheduledSaves = 0;
    const manager = withManager((instance) => {
        instance.scheduleStateSave = () => {
            scheduledSaves += 1;
        };
    });

    manager._applyStateData({
        openRouterGlobalFailure: true,
        openRouterFailureCount: 2
    });

    assert.equal(manager.openRouterGlobalFailure, false);
    assert.equal(manager.openRouterFailureCount, 0);
    assert.equal(scheduledSaves, 1);
});

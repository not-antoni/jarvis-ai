'use strict';

require('dotenv').config();

const { test } = require('node:test');
const assert = require('node:assert/strict');

function loadProviderManager(env) {
    // Reload the module with a fresh env so we exercise different configs.
    const previous = {};
    for (const key of Object.keys(env)) {
        previous[key] = process.env[key];
        if (env[key] === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = env[key];
        }
    }

    // Drop cached modules so the singleton picks up new env values.
    for (const key of Object.keys(require.cache)) {
        if (
            key.includes('/src/services/ai-providers') ||
            key.includes('/src/services/ai-providers-execution') ||
            key.includes('/src/services/ai-proxy')
        ) {
            delete require.cache[key];
        }
    }

    const manager = require('../src/services/ai-providers');
    return {
        manager,
        restore() {
            for (const key of Object.keys(previous)) {
                if (previous[key] === undefined) {
                    delete process.env[key];
                } else {
                    process.env[key] = previous[key];
                }
            }
        }
    };
}

test('GOOGLE_TRIAL defaults to Generative Language API (no Vertex)', () => {
    // The user's existing trial key in their .env is a Gemini API key. The
    // default backend must NOT break that path (#264 follow-up).
    const { manager, restore } = loadProviderManager({
        GOOGLE_TRIAL: 'AQ.Ab8TestKey',
        GOOGLE_TRIAL_BACKEND: undefined,
        VERTEX_PROVIDER: undefined,
        VERTEX_LOCATION: undefined,
        VERTEX_MODELS: undefined
    });
    try {
        const trial = manager.providers.find(p => p.credentialGroup === 'google:trial');
        assert.ok(trial, 'expected a trial provider');
        assert.equal(trial.type, 'google');
        const vertexTrial = manager.providers.find(p => p.type === 'vertex-express');
        assert.equal(vertexTrial, undefined, 'no vertex-express provider should register by default');
    } finally {
        restore();
    }
});

test('GOOGLE_TRIAL_BACKEND=vertex registers a vertex-express provider', () => {
    const { manager, restore } = loadProviderManager({
        GOOGLE_TRIAL: 'AQ.Ab8TestKey',
        GOOGLE_TRIAL_BACKEND: 'vertex',
        VERTEX_PROVIDER: undefined,
        VERTEX_LOCATION: 'global',
        VERTEX_MODELS: 'gemini-2.5-flash'
    });
    try {
        const trial = manager.providers.find(p => p.type === 'vertex-express');
        assert.ok(trial, 'expected at least one vertex-express provider');
        assert.equal(trial.family, 'google');
        assert.equal(trial.location, 'global');
        assert.equal(trial.apiKey, 'AQ.Ab8TestKey');
        assert.equal(trial.model, 'gemini-2.5-flash');
        assert.equal(trial.credentialGroup, 'google:trial');
        const geminiTrial = manager.providers.find(p =>
            p.credentialGroup === 'google:trial' && p.type === 'google'
        );
        assert.equal(geminiTrial, undefined, 'vertex backend should not also register Gemini');
    } finally {
        restore();
    }
});

test('VERTEX_PROVIDER=true alias forces Vertex backend', () => {
    const { manager, restore } = loadProviderManager({
        GOOGLE_TRIAL: 'AQ.Ab8TestKey',
        GOOGLE_TRIAL_BACKEND: undefined,
        VERTEX_PROVIDER: 'true',
        VERTEX_LOCATION: undefined,
        VERTEX_MODELS: undefined
    });
    try {
        const trial = manager.providers.find(p => p.type === 'vertex-express');
        assert.ok(trial, 'VERTEX_PROVIDER=true should register vertex-express');
        assert.equal(trial.location, 'global');
        assert.equal(trial.model, 'gemini-2.5-flash');
    } finally {
        restore();
    }
});

test('GOOGLE_TRIAL_BACKEND=both registers gemini AND vertex providers', () => {
    const { manager, restore } = loadProviderManager({
        GOOGLE_TRIAL: 'AQ.Ab8TestKey',
        GOOGLE_TRIAL_BACKEND: 'both',
        VERTEX_PROVIDER: undefined,
        VERTEX_LOCATION: undefined,
        VERTEX_MODELS: undefined
    });
    try {
        const trialProviders = manager.providers.filter(p => p.credentialGroup === 'google:trial');
        const types = new Set(trialProviders.map(p => p.type));
        assert.ok(types.has('google'), 'expected gemini path');
        assert.ok(types.has('vertex-express'), 'expected vertex-express path');
    } finally {
        restore();
    }
});

test('No GOOGLE_TRIAL means no trial-credential providers', () => {
    const { manager, restore } = loadProviderManager({
        GOOGLE_TRIAL: undefined,
        GOOGLE_TRIAL_BACKEND: undefined,
        VERTEX_PROVIDER: undefined,
        VERTEX_LOCATION: undefined,
        VERTEX_MODELS: undefined
    });
    try {
        const trial = manager.providers.find(p => p.credentialGroup === 'google:trial');
        assert.equal(trial, undefined);
    } finally {
        restore();
    }
});

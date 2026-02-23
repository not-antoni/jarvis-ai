/**
 * Tests for AI provider manager — failover, load management, metrics, retry logic
 */

const { test } = require('node:test');
const assert = require('node:assert');

// Stub env vars so config validation passes and setupProviders doesn't use real keys
const originalEnv = { ...process.env };
const crypto = require('node:crypto');
// Config validation requires these
process.env.DISCORD_TOKEN = process.env.DISCORD_TOKEN || 'test-token';
process.env.MASTER_KEY_BASE64 = process.env.MASTER_KEY_BASE64 || crypto.randomBytes(32).toString('base64');
process.env.LOCAL_DB_MODE = '1';

test('AIProviderManager: constructor initializes defaults', () => {
    // Clear AI keys so setupProviders doesn't fail
    for (const key of Object.keys(process.env)) {
        if (/^(OPENROUTER_API_KEY|GROQ_API_KEY|GOOGLE_AI_API_KEY|OPENAI_API_KEY|DEEPSEEK_API_KEY|CLOUDFLARE_)/.test(key)) {
            delete process.env[key];
        }
    }

    // Bust require cache to get a fresh instance
    delete require.cache[require.resolve('../../src/services/ai-providers')];
    const mgr = require('../../src/services/ai-providers');

    assert.strictEqual(mgr.activeRequests, 0);
    assert.strictEqual(mgr.totalRequests, 0);
    assert.strictEqual(mgr.successfulRequests, 0);
    assert.strictEqual(mgr.failedRequests, 0);
    assert.strictEqual(typeof mgr.generateResponse, 'function');
    assert.strictEqual(typeof mgr.getProviderStatus, 'function');

    // Restore env
    Object.assign(process.env, originalEnv);
});

test('AIProviderManager: _isRetryable identifies transient errors', () => {
    delete require.cache[require.resolve('../../src/services/ai-providers')];
    const mgr = require('../../src/services/ai-providers');

    // 429 rate limit
    assert.strictEqual(mgr._isRetryable({ status: 429 }), true);
    // 502 bad gateway
    assert.strictEqual(mgr._isRetryable({ status: 502 }), true);
    // 503 service unavailable
    assert.strictEqual(mgr._isRetryable({ status: 503 }), true);
    // Timeout message
    assert.strictEqual(mgr._isRetryable({ message: 'Request timeout' }), true);
    // Overloaded message
    assert.strictEqual(mgr._isRetryable({ message: 'Server overloaded' }), true);
    // Empty response
    assert.strictEqual(mgr._isRetryable({ message: 'Empty response body' }), true);
    // Transient flag
    assert.strictEqual(mgr._isRetryable({ transient: true }), true);

    // Non-retryable
    assert.strictEqual(mgr._isRetryable({ status: 400 }), false);
    assert.strictEqual(mgr._isRetryable({ status: 401 }), false);
    assert.strictEqual(mgr._isRetryable({ message: 'Invalid API key' }), false);
    assert.strictEqual(mgr._isRetryable({}), false);

    Object.assign(process.env, originalEnv);
});

test('AIProviderManager: getLoadFactor computes correctly', () => {
    delete require.cache[require.resolve('../../src/services/ai-providers')];
    const mgr = require('../../src/services/ai-providers');

    mgr.loadConfig.softCap = 10;
    mgr.activeRequests = 0;
    assert.strictEqual(mgr.getLoadFactor(), 0);

    mgr.activeRequests = 5;
    assert.strictEqual(mgr.getLoadFactor(), 0.5);

    mgr.activeRequests = 10;
    assert.strictEqual(mgr.getLoadFactor(), 1.0);

    mgr.activeRequests = 20;
    assert.strictEqual(mgr.getLoadFactor(), 2.0);

    // Reset
    mgr.activeRequests = 0;
    Object.assign(process.env, originalEnv);
});

test('AIProviderManager: getLoadAdjustedTokens reduces under load', () => {
    delete require.cache[require.resolve('../../src/services/ai-providers')];
    const mgr = require('../../src/services/ai-providers');

    mgr.loadConfig.softCap = 10;

    // No load — tokens unchanged
    mgr.activeRequests = 0;
    assert.strictEqual(mgr.getLoadAdjustedTokens(4096), 4096);

    // At soft cap — tokens unchanged
    mgr.activeRequests = 10;
    assert.strictEqual(mgr.getLoadAdjustedTokens(4096), 4096);

    // Over soft cap — tokens reduced
    mgr.activeRequests = 20;
    const adjusted = mgr.getLoadAdjustedTokens(4096);
    assert.ok(adjusted < 4096, `Expected tokens < 4096 under load, got ${adjusted}`);
    assert.ok(adjusted >= 512, `Expected tokens >= 512 minimum, got ${adjusted}`);

    // Reset
    mgr.activeRequests = 0;
    Object.assign(process.env, originalEnv);
});

test('AIProviderManager: generateResponse rejects when over threshold', async() => {
    delete require.cache[require.resolve('../../src/services/ai-providers')];
    const mgr = require('../../src/services/ai-providers');

    mgr.loadConfig.rejectThreshold = 5;
    mgr.activeRequests = 5;

    await assert.rejects(
        () => mgr.generateResponse('system', 'user', 100),
        (err) => {
            assert.ok(err.message.includes('heavy load'));
            return true;
        }
    );

    // Reset
    mgr.activeRequests = 0;
    Object.assign(process.env, originalEnv);
});

test('AIProviderManager: _recordMetric tracks success/failure', () => {
    delete require.cache[require.resolve('../../src/services/ai-providers')];
    const mgr = require('../../src/services/ai-providers');

    mgr._recordMetric('test-provider', true, 200);
    mgr._recordMetric('test-provider', true, 300);
    mgr._recordMetric('test-provider', false, 5000);

    const m = mgr.metrics.get('test-provider');
    assert.strictEqual(m.successes, 2);
    assert.strictEqual(m.failures, 1);
    assert.ok(m.avgLatencyMs > 0);

    Object.assign(process.env, originalEnv);
});

test('AIProviderManager: _retry retries on transient errors', async() => {
    delete require.cache[require.resolve('../../src/services/ai-providers')];
    const mgr = require('../../src/services/ai-providers');

    let attempts = 0;
    const result = await mgr._retry(
        (attempt) => {
            attempts++;
            if (attempt < 2) {
                const err = new Error('timeout');
                err.transient = true;
                throw err;
            }
            return 'success';
        },
        { retries: 3, baseDelay: 0, providerName: 'test' }
    );

    assert.strictEqual(result, 'success');
    assert.strictEqual(attempts, 3);

    Object.assign(process.env, originalEnv);
});

test('AIProviderManager: _retry does not retry non-transient errors', async() => {
    delete require.cache[require.resolve('../../src/services/ai-providers')];
    const mgr = require('../../src/services/ai-providers');

    let attempts = 0;
    await assert.rejects(
        () => mgr._retry(
            () => {
                attempts++;
                throw new Error('Invalid API key');
            },
            { retries: 3, baseDelay: 0 }
        ),
        (err) => {
            assert.strictEqual(err.message, 'Invalid API key');
            return true;
        }
    );

    assert.strictEqual(attempts, 1);

    Object.assign(process.env, originalEnv);
});

test('AIProviderManager: _computeProviderWeight penalizes errored providers', () => {
    delete require.cache[require.resolve('../../src/services/ai-providers')];
    const mgr = require('../../src/services/ai-providers');

    const provider = { name: 'test-weight-provider' };

    // Good provider
    mgr.metrics.set(provider.name, { successes: 100, failures: 0, avgLatencyMs: 500 });
    const goodWeight = mgr._computeProviderWeight(provider);

    // Same provider but with error flag
    mgr.providerErrors.set(provider.name, 'some error');
    const errorWeight = mgr._computeProviderWeight(provider);

    assert.ok(errorWeight < goodWeight, `Error weight (${errorWeight}) should be less than good weight (${goodWeight})`);

    Object.assign(process.env, originalEnv);
});

test('AIProviderManager: getProviderStatus returns sorted array', () => {
    delete require.cache[require.resolve('../../src/services/ai-providers')];
    const mgr = require('../../src/services/ai-providers');

    // Add test providers
    mgr.providers = [
        { name: 'free-provider', model: 'test-free', type: 'test', family: 'test', costTier: 'free' },
        { name: 'paid-provider', model: 'test-paid', type: 'test', family: 'test', costTier: 'paid' }
    ];

    const status = mgr.getProviderStatus();
    assert.strictEqual(status.length, 2);
    // Free should sort before paid
    assert.strictEqual(status[0].name, 'free-provider');
    assert.strictEqual(status[1].name, 'paid-provider');

    Object.assign(process.env, originalEnv);
});

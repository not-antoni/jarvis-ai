/**
 * Tests for metrics utility
 */

const { test } = require('node:test');
const assert = require('node:assert');
const metrics = require('../../src/utils/metrics');

test('Metrics: Record request', () => {
    metrics.recordRequest('/api/test', 100, true, 200);
    const m = metrics.getMetrics();
    assert.strictEqual(m.requests.total, 1);
    assert.strictEqual(m.requests.successful, 1);
});

test('Metrics: Record failed request', () => {
    metrics.recordRequest('/api/test', 50, false, 500);
    const m = metrics.getMetrics();
    assert.ok(m.requests.failed >= 1);
});

test('Metrics: Record error', () => {
    const error = new Error('Test error');
    metrics.recordError(error, { context: 'test' });
    const m = metrics.getMetrics();
    assert.ok(m.errors.total >= 1);
});

test('Metrics: Record AI provider call', () => {
    metrics.recordAIProviderCall('openai', 1000, 0.002);
    const m = metrics.getMetrics();
    assert.ok(m.ai.totalTokens >= 1000);
    assert.ok(m.ai.totalCost >= 0.002);
});

test('Metrics: Get Prometheus format', () => {
    const prometheus = metrics.getPrometheusMetrics();
    assert.ok(prometheus.includes('jarvis_requests_total'));
    assert.ok(prometheus.includes('jarvis_response_time_ms'));
});

test('Metrics: Response time percentiles', () => {
    // Record multiple response times
    for (let i = 1; i <= 100; i++) {
        metrics.recordResponseTime(i);
    }
    
    const m = metrics.getMetrics();
    assert.ok(m.performance.p50 > 0);
    assert.ok(m.performance.p95 > 0);
    assert.ok(m.performance.p99 > 0);
});


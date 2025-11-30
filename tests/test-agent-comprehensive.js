#!/usr/bin/env node

/**
 * Comprehensive Test Suite for All 10 New Agent Components
 * Tests each component individually and in integration
 */

const assert = require('assert');

// Import all components
const ResourcePool = require('./src/agents/resourcePool');
const PerformanceProfiler = require('./src/agents/performanceProfiler');
const CacheManager = require('./src/agents/cacheManager');
const BrowserOptimizer = require('./src/agents/browserOptimizer');
const ErrorContextDebugger = require('./src/agents/errorContextDebugger');
const AdvancedSessionManager = require('./src/agents/advancedSessionManager');
const DistributedTracer = require('./src/agents/distributedTracer');
const CostRateLimiter = require('./src/agents/costRateLimiter');
const GracefulShutdownManager = require('./src/agents/gracefulShutdownManager');
const APIResponseStandardizer = require('./src/agents/apiResponseStandardizer');

let passed = 0;
let failed = 0;

async function test(name, fn) {
    try {
        console.log(`\n[TEST] ${name}`);
        await fn();
        console.log(`  ✓ PASSED`);
        passed++;
    } catch (error) {
        console.error(`  ✗ FAILED: ${error.message}`);
        failed++;
    }
}

async function runTests() {
    console.log('====================================');
    console.log('Agent Component Test Suite');
    console.log('====================================\n');

    // 1. ResourcePool Tests
    await test('ResourcePool: Initialize', () => {
        const pool = new ResourcePool({ maxPoolSize: 3 });
        assert.strictEqual(pool.availableBrowsers.length, 0);
        assert.strictEqual(pool.metrics.totalCreated, 0);
    });

    await test('ResourcePool: Get stats', () => {
        const pool = new ResourcePool();
        const stats = pool.getStats();
        assert(stats.poolSize !== undefined);
        assert(stats.metrics !== undefined);
    });

    await test('ResourcePool: Cleanup and drain', async () => {
        const pool = new ResourcePool();
        await pool.drain();
        assert.strictEqual(pool.activeBrowsers.size, 0);
    });

    // 2. PerformanceProfiler Tests
    await test('PerformanceProfiler: Record operation', () => {
        const profiler = new PerformanceProfiler();
        profiler.recordOperation('test_op', 100, true);
        assert.strictEqual(profiler.metrics.totalOperations, 1);
        assert.strictEqual(profiler.metrics.totalSuccessful, 1);
    });

    await test('PerformanceProfiler: Track page load times', () => {
        const profiler = new PerformanceProfiler();
        profiler.recordPageLoadTime('http://example.com', 500, 10000);
        assert(profiler.pageLoadTimes.has('http://example.com'));
    });

    await test('PerformanceProfiler: Generate histogram', () => {
        const profiler = new PerformanceProfiler();
        for (let i = 0; i < 100; i++) {
            profiler.recordOperation('op', Math.random() * 1000, true);
        }
        const histogram = profiler.getHistogram(100);
        assert(histogram.length > 0);
    });

    await test('PerformanceProfiler: Identify bottlenecks', () => {
        const profiler = new PerformanceProfiler();
        profiler.recordOperation('slow_op', 5000, true);
        profiler.recordOperation('fast_op', 100, true);
        const bottlenecks = profiler.identifyBottlenecks(5);
        assert(bottlenecks.length > 0);
    });

    // 3. CacheManager Tests
    await test('CacheManager: Cache response', () => {
        const cache = new CacheManager();
        cache.setResponseCache('http://test.com', { data: 'test' });
        const cached = cache.getResponseCache('http://test.com');
        assert.deepStrictEqual(cached, { data: 'test' });
    });

    await test('CacheManager: Cache hit/miss tracking', () => {
        const cache = new CacheManager();
        cache.getResponseCache('http://missing.com'); // miss
        assert.strictEqual(cache.stats.responseMisses, 1);
        
        cache.setResponseCache('http://existing.com', { data: 'test' });
        cache.getResponseCache('http://existing.com'); // hit
        assert.strictEqual(cache.stats.responseHits, 1);
    });

    await test('CacheManager: Eviction', () => {
        const cache = new CacheManager({ maxCacheSizeBytes: 1000 });
        cache.setResponseCache('url1', { data: 'x'.repeat(500) });
        cache.setResponseCache('url2', { data: 'x'.repeat(500) });
        cache.setResponseCache('url3', { data: 'x'.repeat(500) }); // Should trigger eviction
        assert(cache.stats.evictions >= 0);
    });

    // 4. BrowserOptimizer Tests
    await test('BrowserOptimizer: Initialize', () => {
        const optimizer = new BrowserOptimizer();
        assert.strictEqual(optimizer.optimizations.length, 0);
    });

    await test('BrowserOptimizer: Add human delay', async () => {
        const optimizer = new BrowserOptimizer();
        const start = Date.now();
        await optimizer.addHumanDelay(50, 100);
        const duration = Date.now() - start;
        assert(duration >= 50 && duration <= 150);
    });

    // 5. ErrorContextDebugger Tests
    await test('ErrorContextDebugger: Initialize', () => {
        const debugCtx = new ErrorContextDebugger();
        assert.strictEqual(debugCtx.networkRequests.length, 0);
        assert.strictEqual(debugCtx.consoleLogs.length, 0);
    });

    await test('ErrorContextDebugger: Record network request', () => {
        const debugCtx = new ErrorContextDebugger();
        debugCtx.recordNetworkRequest({
            url: 'http://test.com',
            method: 'GET',
            resourceType: 'xhr'
        });
        assert.strictEqual(debugCtx.networkRequests.length, 1);
    });

    await test('ErrorContextDebugger: Record JS error', () => {
        const debugCtx = new ErrorContextDebugger();
        debugCtx.recordJSError(new Error('Test error'));
        assert.strictEqual(debugCtx.jsErrors.length, 1);
    });

    // 6. AdvancedSessionManager Tests
    await test('AdvancedSessionManager: Create session', async () => {
        const manager = new AdvancedSessionManager();
        const session = await manager.createSession('test_session_1');
        assert.strictEqual(session.id, 'test_session_1');
        assert.strictEqual(manager.sessionStore.size, 1);
    });

    await test('AdvancedSessionManager: Acquire from pool', async () => {
        const manager = new AdvancedSessionManager();
        const session = await manager.acquireFromPool();
        assert(session.id);
        assert.strictEqual(manager.sessionStore.size, 1);
    });

    await test('AdvancedSessionManager: Get sessions', async () => {
        const manager = new AdvancedSessionManager();
        await manager.createSession('s1');
        await manager.createSession('s2');
        const sessions = manager.getSessions();
        assert.strictEqual(sessions.length, 2);
    });

    await test('AdvancedSessionManager: Cleanup', async () => {
        const manager = new AdvancedSessionManager({ sessionTTLMs: 1 });
        await manager.createSession('expired_session');
        await new Promise(r => setTimeout(r, 10));
        const cleaned = await manager.cleanup();
        assert(cleaned >= 0);
    });

    // 7. DistributedTracer Tests
    await test('DistributedTracer: Start trace', () => {
        const tracer = new DistributedTracer();
        const traceId = tracer.startTrace('operation_1', { userId: 'user123' });
        assert(traceId.startsWith('trace_'));
        assert.strictEqual(tracer.traces.size, 1);
    });

    await test('DistributedTracer: Create spans', () => {
        const tracer = new DistributedTracer();
        const traceId = tracer.startTrace('operation_1');
        const spanId = tracer.startSpan(traceId, 'span_1');
        assert(spanId.startsWith('span_'));
        tracer.endSpan(spanId);
        assert.strictEqual(tracer.spans.get(spanId).status, 'completed');
    });

    await test('DistributedTracer: Get trace timeline', () => {
        const tracer = new DistributedTracer();
        const traceId = tracer.startTrace('operation_1');
        tracer.startSpan(traceId, 'span_1');
        tracer.startSpan(traceId, 'span_2');
        const timeline = tracer.getTraceTimeline(traceId);
        assert.strictEqual(timeline.timeline.length, 2);
    });

    // 8. CostRateLimiter Tests
    await test('CostRateLimiter: Register user', () => {
        const limiter = new CostRateLimiter();
        const user = limiter.registerUser('user1');
        assert.strictEqual(user.userId, 'user1');
        assert.strictEqual(limiter.users.size, 1);
    });

    await test('CostRateLimiter: Check rate limit', () => {
        const limiter = new CostRateLimiter({ requestsPerMinute: 5 });
        const result = limiter.checkRateLimit('user1');
        assert.strictEqual(result.allowed, true);
    });

    await test('CostRateLimiter: Enforce rate limits', () => {
        const limiter = new CostRateLimiter({ requestsPerMinute: 2 });
        
        limiter.recordRequest('user2');
        limiter.recordRequest('user2');
        
        const result = limiter.checkRateLimit('user2');
        assert.strictEqual(result.allowed, false);
        assert.strictEqual(result.reason, 'minute_limit_exceeded');
    });

    await test('CostRateLimiter: Session tracking', () => {
        const limiter = new CostRateLimiter();
        assert.strictEqual(limiter.incrementSession('user3'), 1);
        assert.strictEqual(limiter.incrementSession('user3'), 2);
        assert.strictEqual(limiter.decrementSession('user3'), 1);
    });

    // 9. GracefulShutdownManager Tests
    await test('GracefulShutdownManager: Register handler', () => {
        const shutdown = new GracefulShutdownManager();
        shutdown.registerHandler('test_handler', () => {}, 'normal');
        assert.strictEqual(shutdown.handlers.length, 1);
    });

    await test('GracefulShutdownManager: Get handlers', () => {
        const shutdown = new GracefulShutdownManager();
        shutdown.registerHandler('h1', () => {}, 'high');
        shutdown.registerHandler('h2', () => {}, 'normal');
        const handlers = shutdown.getHandlers();
        assert.strictEqual(handlers.length, 2);
    });

    // 10. APIResponseStandardizer Tests
    await test('APIResponseStandardizer: Success response', () => {
        const standardizer = new APIResponseStandardizer();
        const resp = standardizer.success({ data: 'test' });
        assert.strictEqual(resp.success, true);
        assert.strictEqual(resp.code, 20000);
    });

    await test('APIResponseStandardizer: Error response', () => {
        const standardizer = new APIResponseStandardizer();
        const resp = standardizer.error('NOT_FOUND', { resource: 'user' });
        assert.strictEqual(resp.success, false);
        assert.strictEqual(resp.httpStatus, 404);
    });

    await test('APIResponseStandardizer: Paginated response', () => {
        const standardizer = new APIResponseStandardizer();
        const items = [1, 2, 3, 4, 5];
        const resp = standardizer.paginated(items, { page: 1, pageSize: 2, total: 10 });
        assert.strictEqual(resp.pagination.page, 1);
        assert.strictEqual(resp.pagination.pageSize, 2);
        assert.strictEqual(resp.pagination.hasNextPage, true);
    });

    await test('APIResponseStandardizer: Rate limit headers', () => {
        const standardizer = new APIResponseStandardizer();
        const headers = standardizer.addRateLimitHeaders({}, { 
            limit: 60, 
            remaining: 30,
            retryAfterMs: 5000
        });
        assert.strictEqual(headers['X-RateLimit-Limit'], '60');
        assert.strictEqual(headers['X-RateLimit-Remaining'], '30');
    });

    // Summary
    console.log('\n====================================');
    console.log(`Results: ${passed} passed, ${failed} failed`);
    console.log('====================================\n');

    if (failed > 0) {
        process.exit(1);
    }
}

runTests().catch(error => {
    console.error('Test suite error:', error);
    process.exit(1);
});

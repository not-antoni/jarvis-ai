/**
 * Comprehensive Agent Enhancement Integration Guide
 * Shows how to use all 10 new components together in production
 */

const BrowserAgent = require('./src/agents/browserAgent');
const AgentConfig = require('./src/agents/agentConfig');
const AgentMonitor = require('./src/agents/agentMonitor');
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

/**
 * Production Agent Setup
 */
class ProductionAgent {
    constructor(config = {}) {
        // Core components
        this.config = new AgentConfig(config.config);
        this.browserAgent = new BrowserAgent(this.config);
        this.agentMonitor = new AgentMonitor();
        
        // Performance & reliability
        this.resourcePool = new ResourcePool({
            maxPoolSize: config.maxPoolSize || 5,
            preWarmCount: config.preWarmCount || 2
        });
        this.profiler = new PerformanceProfiler();
        this.cache = new CacheManager();
        this.optimizer = new BrowserOptimizer();
        this.debugger = new ErrorContextDebugger();
        
        // Sessions & tracking
        this.sessionManager = new AdvancedSessionManager();
        this.tracer = new DistributedTracer();
        this.rateLimiter = new CostRateLimiter({
            requestsPerMinute: config.requestsPerMinute || 60,
            dailyCostLimit: config.dailyCostLimit || 10000
        });
        
        // Shutdown & API
        this.shutdown = new GracefulShutdownManager();
        this.apiStandardizer = new APIResponseStandardizer();

        this.setupShutdownHandlers();
    }

    /**
     * Execute operation with full tracing, monitoring, and error handling
     */
    async executeOperation(userId, operationName, operation, options = {}) {
        // Start trace
        const traceId = this.tracer.startTrace(operationName, { userId });
        const spanId = this.tracer.startSpan(traceId, operationName);

        try {
            // Check rate limits
            const rateCheck = this.rateLimiter.checkRateLimit(userId, options);
            if (!rateCheck.allowed) {
                throw {
                    errorKey: rateCheck.reason,
                    retryAfterMs: rateCheck.retryAfterMs,
                    details: rateCheck
                };
            }

            // Record rate limit
            this.rateLimiter.recordRequest(userId, options);
            this.rateLimiter.incrementSession(userId);

            // Check cache
            const cacheKey = options.cacheKey;
            if (cacheKey && !options.skipCache) {
                const cached = this.cache.getResponseCache(cacheKey);
                if (cached) {
                    this.tracer.recordSpanEvent(spanId, 'cache_hit', { cacheKey });
                    this.tracer.endSpan(spanId, 'completed');
                    return cached;
                }
            }

            // Create session
            const session = await this.sessionManager.acquireFromPool({ metadata: { userId } });
            const operationStart = Date.now();

            // Get browser from pool
            const { browser, browserId } = await this.resourcePool.acquire(
                require('puppeteer'),
                options.browserConfig
            );

            try {
                // Create page and setup debugging
                const page = await browser.newPage();
                await this.debugger.setupListeners(page);
                await this.optimizer.applyOptimizations(page);

                // Restore session state
                await this.sessionManager.restorePageState(session.id, page);

                // Execute operation
                const result = await operation(page, {
                    tracer: this.tracer,
                    spanId,
                    session,
                    cache: this.cache,
                    debugger: this.debugger
                });

                // Capture session state
                await this.sessionManager.capturePageState(session.id, page);

                // Cache result
                if (cacheKey) {
                    this.cache.setResponseCache(cacheKey, result);
                }

                // Record metrics
                const duration = Date.now() - operationStart;
                this.profiler.recordOperation(operationName, duration, true);
                this.tracer.recordSpanEvent(spanId, 'operation_complete', { duration });
                this.agentMonitor.recordOperation(true, operationName);

                // Cleanup
                await page.close();
                this.resourcePool.release(browserId);

                return result;

            } catch (error) {
                // Record error
                this.tracer.recordSpanEvent(spanId, 'error', { error: error.message });
                this.profiler.recordOperation(operationName, Date.now() - operationStart, false);
                this.agentMonitor.recordOperation(false, operationName, error);

                // Capture debug context
                if (this.debugger.page) {
                    const errorReport = await this.debugger.generateErrorReport(operationName, error);
                    this.tracer.recordSpanEvent(spanId, 'error_context', { report: errorReport });
                }

                throw error;

            } finally {
                // Always release session and clean up rate limit
                await this.sessionManager.releaseToPool(session.id);
                this.rateLimiter.decrementSession(userId);
            }

        } catch (error) {
            this.tracer.endSpan(spanId, 'failed', error);
            this.tracer.endTrace(traceId, 'failed', error);

            // Convert to API response
            throw this.apiStandardizer.fromError(error, { traceId, spanId });

        } finally {
            this.tracer.endSpan(spanId);
            this.tracer.endTrace(traceId);
        }
    }

    /**
     * Setup graceful shutdown
     */
    setupShutdownHandlers() {
        this.shutdown.registerHandler('drain-sessions', async () => {
            console.log('[ProductionAgent] Draining sessions...');
            await this.shutdown.drainSessions(this.sessionManager);
        }, 'critical');

        this.shutdown.registerHandler('cache-shutdown', async () => {
            console.log('[ProductionAgent] Shutting down cache...');
            this.cache.shutdown();
        }, 'high');

        this.shutdown.registerHandler('resource-pool-drain', async () => {
            console.log('[ProductionAgent] Draining resource pool...');
            await this.resourcePool.drain();
        }, 'high');

        this.shutdown.registerHandler('session-manager-shutdown', async () => {
            console.log('[ProductionAgent] Saving sessions...');
            await this.sessionManager.shutdown();
        }, 'high');

        this.shutdown.registerHandler('rate-limiter-shutdown', async () => {
            console.log('[ProductionAgent] Shutting down rate limiter...');
            this.rateLimiter.shutdown();
        }, 'normal');

        this.shutdown.registerHandler('browser-agent-cleanup', async () => {
            console.log('[ProductionAgent] Cleaning up browser agent...');
            await this.browserAgent.close?.();
        }, 'normal');
    }

    /**
     * Get comprehensive health report
     */
    getHealthReport() {
        return {
            timestamp: Date.now(),
            agent: {
                health: this.agentMonitor.getHealthScore?.() || 0,
                metrics: this.agentMonitor.getMetrics?.(),
                monitor: this.agentMonitor.getStats?.()
            },
            performance: {
                metrics: this.profiler.getReport(),
                bottlenecks: this.profiler.identifyBottlenecks(10)
            },
            cache: {
                stats: this.cache.getStats(),
                hitRates: this.cache.getStats().hitRate
            },
            sessions: {
                active: this.sessionManager.getSessions(),
                stats: this.sessionManager.getStats()
            },
            resources: {
                pool: this.resourcePool.getStats()
            },
            rateLimit: {
                stats: this.rateLimiter.getStats()
            },
            tracing: {
                stats: this.tracer.getStats()
            },
            shutdown: {
                stats: this.shutdown.getStats()
            }
        };
    }

    /**
     * Get operation metrics
     */
    getMetrics() {
        return {
            profiler: this.profiler.toPrometheus(),
            cache: this.cache.getStats(),
            sessions: this.sessionManager.getStats(),
            resources: this.resourcePool.getStats(),
            rateLimiting: this.rateLimiter.getStats(),
            tracing: this.tracer.getStats()
        };
    }
}

/**
 * Example: Using ProductionAgent in Express
 */
async function exampleExpressSetup(app) {
    const agent = new ProductionAgent({
        maxPoolSize: 5,
        requestsPerMinute: 60,
        dailyCostLimit: 10000
    });

    app.use((req, res, next) => {
        agent.apiStandardizer.expressMiddleware(app);
        next();
    });

    // Health endpoint
    app.get('/health', (req, res) => {
        const health = agent.getHealthReport();
        res.json(agent.apiStandardizer.success(health));
    });

    // Metrics endpoint
    app.get('/metrics', (req, res) => {
        const metrics = agent.getMetrics();
        res.set('Content-Type', 'text/plain');
        res.send(metrics.profiler);
    });

    // Execute operation endpoint
    app.post('/api/execute', async (req, res) => {
        const { userId, operationName, url } = req.body;

        try {
            const result = await agent.executeOperation(
                userId,
                operationName,
                async (page) => {
                    await page.goto(url);
                    return {
                        title: await page.title(),
                        url: page.url()
                    };
                },
                { cacheKey: url }
            );

            res.success(result);
        } catch (error) {
            if (error.errorKey === 'RATE_LIMIT_EXCEEDED') {
                res.rateLimit(error.errorKey, error.retryAfterMs);
            } else {
                res.error(error.errorKey || 'INTERNAL_ERROR', error.details);
            }
        }
    });

    return agent;
}

module.exports = {
    ProductionAgent,
    exampleExpressSetup,
    // Export all components for individual use
    BrowserAgent,
    AgentConfig,
    AgentMonitor,
    ResourcePool,
    PerformanceProfiler,
    CacheManager,
    BrowserOptimizer,
    ErrorContextDebugger,
    AdvancedSessionManager,
    DistributedTracer,
    CostRateLimiter,
    GracefulShutdownManager,
    APIResponseStandardizer
};

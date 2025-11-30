/**
 * Metrics Collection System
 * Tracks performance metrics, errors, and system health
 */

const logger = require('./logger');

class MetricsCollector {
    constructor() {
        this.metrics = {
            requests: {
                total: 0,
                successful: 0,
                failed: 0,
                byEndpoint: new Map()
            },
            errors: {
                total: 0,
                byType: new Map(),
                recent: []
            },
            performance: {
                responseTimes: [],
                averageResponseTime: 0,
                p50: 0,
                p95: 0,
                p99: 0
            },
            system: {
                memoryUsage: [],
                cpuUsage: [],
                uptime: Date.now()
            },
            ai: {
                providerCalls: new Map(),
                totalTokens: 0,
                totalCost: 0
            }
        };

        // Keep only last 1000 response times for performance
        this.maxResponseTimeSamples = 1000;
        
        // Start periodic metrics collection
        this.startCollection();
    }

    /**
     * Record a request
     */
    recordRequest(endpoint, duration, success = true, statusCode = 200) {
        this.metrics.requests.total++;
        
        if (success && statusCode < 400) {
            this.metrics.requests.successful++;
        } else {
            this.metrics.requests.failed++;
        }

        // Track by endpoint
        if (!this.metrics.requests.byEndpoint.has(endpoint)) {
            this.metrics.requests.byEndpoint.set(endpoint, {
                total: 0,
                successful: 0,
                failed: 0,
                totalDuration: 0,
                averageDuration: 0
            });
        }

        const endpointStats = this.metrics.requests.byEndpoint.get(endpoint);
        endpointStats.total++;
        endpointStats.totalDuration += duration;
        endpointStats.averageDuration = endpointStats.totalDuration / endpointStats.total;
        
        if (success && statusCode < 400) {
            endpointStats.successful++;
        } else {
            endpointStats.failed++;
        }

        // Record response time
        this.recordResponseTime(duration);
    }

    /**
     * Record response time
     */
    recordResponseTime(duration) {
        this.metrics.performance.responseTimes.push(duration);
        
        // Keep only last N samples
        if (this.metrics.performance.responseTimes.length > this.maxResponseTimeSamples) {
            this.metrics.performance.responseTimes.shift();
        }

        // Calculate percentiles
        this.calculatePercentiles();
    }

    /**
     * Calculate percentiles
     */
    calculatePercentiles() {
        const times = [...this.metrics.performance.responseTimes].sort((a, b) => a - b);
        const count = times.length;

        if (count === 0) {
            this.metrics.performance.averageResponseTime = 0;
            this.metrics.performance.p50 = 0;
            this.metrics.performance.p95 = 0;
            this.metrics.performance.p99 = 0;
            return;
        }

        this.metrics.performance.averageResponseTime = 
            times.reduce((a, b) => a + b, 0) / count;
        this.metrics.performance.p50 = times[Math.floor(count * 0.5)];
        this.metrics.performance.p95 = times[Math.floor(count * 0.95)];
        this.metrics.performance.p99 = times[Math.floor(count * 0.99)];
    }

    /**
     * Record an error
     */
    recordError(error, context = {}) {
        this.metrics.errors.total++;
        
        const errorType = error.name || error.constructor?.name || 'UnknownError';
        const current = this.metrics.errors.byType.get(errorType) || 0;
        this.metrics.errors.byType.set(errorType, current + 1);

        // Keep last 100 errors
        this.metrics.errors.recent.push({
            type: errorType,
            message: error.message,
            timestamp: Date.now(),
            context
        });

        if (this.metrics.errors.recent.length > 100) {
            this.metrics.errors.recent.shift();
        }

        logger.error('Error recorded', {
            errorType,
            message: error.message,
            context
        });
    }

    /**
     * Record AI provider call
     */
    recordAIProviderCall(provider, tokens, cost = 0) {
        if (!this.metrics.ai.providerCalls.has(provider)) {
            this.metrics.ai.providerCalls.set(provider, {
                calls: 0,
                tokens: 0,
                cost: 0
            });
        }

        const stats = this.metrics.ai.providerCalls.get(provider);
        stats.calls++;
        stats.tokens += tokens;
        stats.cost += cost;

        this.metrics.ai.totalTokens += tokens;
        this.metrics.ai.totalCost += cost;
    }

    /**
     * Get current metrics
     */
    getMetrics() {
        return {
            requests: {
                total: this.metrics.requests.total,
                successful: this.metrics.requests.successful,
                failed: this.metrics.requests.failed,
                successRate: this.metrics.requests.total > 0
                    ? (this.metrics.requests.successful / this.metrics.requests.total * 100).toFixed(2) + '%'
                    : '0%',
                byEndpoint: Object.fromEntries(
                    Array.from(this.metrics.requests.byEndpoint.entries()).map(([endpoint, stats]) => [
                        endpoint,
                        {
                            ...stats,
                            successRate: stats.total > 0
                                ? (stats.successful / stats.total * 100).toFixed(2) + '%'
                                : '0%'
                        }
                    ])
                )
            },
            errors: {
                total: this.metrics.errors.total,
                byType: Object.fromEntries(this.metrics.errors.byType),
                recent: this.metrics.errors.recent.slice(-10) // Last 10 errors
            },
            performance: {
                ...this.metrics.performance,
                responseTimes: undefined // Don't expose raw array
            },
            system: {
                ...this.metrics.system,
                uptime: Date.now() - this.metrics.system.uptime,
                memory: process.memoryUsage(),
                cpu: process.cpuUsage()
            },
            ai: {
                totalCalls: Array.from(this.metrics.ai.providerCalls.values())
                    .reduce((sum, stats) => sum + stats.calls, 0),
                totalTokens: this.metrics.ai.totalTokens,
                totalCost: this.metrics.ai.totalCost,
                byProvider: Object.fromEntries(
                    Array.from(this.metrics.ai.providerCalls.entries()).map(([provider, stats]) => [
                        provider,
                        {
                            calls: stats.calls,
                            tokens: stats.tokens,
                            cost: stats.cost,
                            averageTokensPerCall: stats.calls > 0
                                ? (stats.tokens / stats.calls).toFixed(2)
                                : 0
                        }
                    ])
                )
            }
        };
    }

    /**
     * Get metrics in Prometheus format
     */
    getPrometheusMetrics() {
        const metrics = this.getMetrics();
        const lines = [];

        // Request metrics
        lines.push(`# HELP jarvis_requests_total Total number of requests`);
        lines.push(`# TYPE jarvis_requests_total counter`);
        lines.push(`jarvis_requests_total ${metrics.requests.total}`);

        lines.push(`# HELP jarvis_requests_successful Total successful requests`);
        lines.push(`# TYPE jarvis_requests_successful counter`);
        lines.push(`jarvis_requests_successful ${metrics.requests.successful}`);

        lines.push(`# HELP jarvis_requests_failed Total failed requests`);
        lines.push(`# TYPE jarvis_requests_failed counter`);
        lines.push(`jarvis_requests_failed ${metrics.requests.failed}`);

        // Performance metrics
        lines.push(`# HELP jarvis_response_time_ms Average response time in milliseconds`);
        lines.push(`# TYPE jarvis_response_time_ms gauge`);
        lines.push(`jarvis_response_time_ms ${metrics.performance.averageResponseTime.toFixed(2)}`);

        lines.push(`# HELP jarvis_response_time_p95_ms 95th percentile response time`);
        lines.push(`# TYPE jarvis_response_time_p95_ms gauge`);
        lines.push(`jarvis_response_time_p95_ms ${metrics.performance.p95}`);

        // Error metrics
        lines.push(`# HELP jarvis_errors_total Total number of errors`);
        lines.push(`# TYPE jarvis_errors_total counter`);
        lines.push(`jarvis_errors_total ${metrics.errors.total}`);

        // AI metrics
        lines.push(`# HELP jarvis_ai_tokens_total Total AI tokens used`);
        lines.push(`# TYPE jarvis_ai_tokens_total counter`);
        lines.push(`jarvis_ai_tokens_total ${metrics.ai.totalTokens}`);

        lines.push(`# HELP jarvis_ai_cost_total Total AI cost`);
        lines.push(`# TYPE jarvis_ai_cost_total counter`);
        lines.push(`jarvis_ai_cost_total ${metrics.ai.totalCost}`);

        return lines.join('\n');
    }

    /**
     * Start periodic metrics collection
     */
    startCollection() {
        // Collect system metrics every 60 seconds
        setInterval(() => {
            const memUsage = process.memoryUsage();
            this.metrics.system.memoryUsage.push({
                timestamp: Date.now(),
                heapUsed: memUsage.heapUsed,
                heapTotal: memUsage.heapTotal,
                external: memUsage.external,
                rss: memUsage.rss
            });

            // Keep only last 100 samples
            if (this.metrics.system.memoryUsage.length > 100) {
                this.metrics.system.memoryUsage.shift();
            }

            const cpuUsage = process.cpuUsage();
            this.metrics.system.cpuUsage.push({
                timestamp: Date.now(),
                user: cpuUsage.user,
                system: cpuUsage.system
            });

            if (this.metrics.system.cpuUsage.length > 100) {
                this.metrics.system.cpuUsage.shift();
            }
        }, 60000);
    }

    /**
     * Reset all metrics
     */
    reset() {
        this.metrics = {
            requests: {
                total: 0,
                successful: 0,
                failed: 0,
                byEndpoint: new Map()
            },
            errors: {
                total: 0,
                byType: new Map(),
                recent: []
            },
            performance: {
                responseTimes: [],
                averageResponseTime: 0,
                p50: 0,
                p95: 0,
                p99: 0
            },
            system: {
                memoryUsage: [],
                cpuUsage: [],
                uptime: Date.now()
            },
            ai: {
                providerCalls: new Map(),
                totalTokens: 0,
                totalCost: 0
            }
        };
    }
}

// Create singleton instance
const metricsCollector = new MetricsCollector();

module.exports = metricsCollector;


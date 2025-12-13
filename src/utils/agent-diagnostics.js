/**
 * Agent Healthcheck and Diagnostic Endpoint
 * Provides JSON metrics suitable for monitoring dashboards, K8s probes, or CI/CD
 */

const express = require('express');

function createAgentDiagnosticsRouter(discordHandlers) {
    const router = express.Router();

    /**
     * GET /health/agent/status
     * Quick health check - suitable for Kubernetes liveness probes
     */
    router.get('/health/agent/status', (req, res) => {
        const metrics = discordHandlers.browserAgent.getMetrics();
        const health = discordHandlers.agentMonitor.getHealthReport(discordHandlers.browserAgent);

        const isHealthy = health.overallHealth >= 75 && metrics.circuitBreakerStatus === 'closed';

        res.status(isHealthy ? 200 : 503).json({
            status: isHealthy ? 'healthy' : 'unhealthy',
            timestamp: Date.now(),
            health: health.overallHealth,
            circuit: metrics.circuitBreakerStatus,
            activeSessions: metrics.activeSessions,
            uptime: health.uptime
        });
    });

    /**
     * GET /health/agent/detailed
     * Detailed metrics including operation breakdown
     */
    router.get('/health/agent/detailed', (req, res) => {
        const health = discordHandlers.agentMonitor.getHealthReport(discordHandlers.browserAgent);
        res.json(health);
    });

    /**
     * GET /health/agent/diagnostics
     * Full diagnostics report for debugging
     */
    router.get('/health/agent/diagnostics', (req, res) => {
        const report = discordHandlers.agentMonitor.generateDiagnosticsReport(
            discordHandlers.browserAgent
        );
        res.json(report);
    });

    /**
     * GET /health/agent/logs
     * Recent operation logs (last 50 by default)
     */
    router.get('/health/agent/logs', (req, res) => {
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        const logs = discordHandlers.agentMonitor.operationLog.slice(-limit);
        res.json({ limit, count: logs.length, logs });
    });

    /**
     * GET /health/agent/alerts
     * Recent system alerts
     */
    router.get('/health/agent/alerts', (req, res) => {
        const limit = Math.min(parseInt(req.query.limit) || 20, 100);
        const alerts = discordHandlers.agentMonitor.alerts.slice(-limit);
        res.json({ limit, count: alerts.length, alerts });
    });

    /**
     * POST /health/agent/restart
     * Manual restart of browser (requires auth token)
     */
    router.post('/health/agent/restart', async (req, res) => {
        const token = req.headers['x-health-token'] || req.query.token;
        if (token !== process.env.HEALTH_TOKEN) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        try {
            const success = await discordHandlers.browserAgent.restartBrowser();
            res.json({ success, timestamp: Date.now() });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * GET /health/agent/memory/trend
     * Memory usage trend and leak detection
     */
    router.get('/health/agent/memory/trend', (req, res) => {
        const monitor = discordHandlers.agentMonitor;
        const trend = monitor.getMemoryTrend();
        const memoryMetrics = monitor.getMemoryMetrics();

        res.json({
            current: memoryMetrics,
            trend: trend,
            history: monitor.memoryTrend.slice(-20),
            analysis: {
                isLeaking: trend.riskLevel !== 'low',
                riskLevel: trend.riskLevel,
                recommendedAction:
                    trend.riskLevel === 'high'
                        ? 'RESTART'
                        : trend.riskLevel === 'medium'
                          ? 'MONITOR'
                          : 'OK'
            }
        });
    });

    /**
     * GET /health/agent/retry/strategies
     * Available retry strategies by error type
     */
    router.get('/health/agent/retry/strategies', (req, res) => {
        try {
            const RetryPolicy = require('../agents/retryPolicy');
            const retryPolicy = new RetryPolicy();

            const errorTypes = ['TIMEOUT', 'NETWORK', 'BROWSER_CRASH', 'RATE_LIMIT', 'INVALID_URL'];
            const strategies = {};

            for (const errorType of errorTypes) {
                strategies[errorType] = retryPolicy.getRetryInfo(errorType);
            }

            res.json({
                strategies,
                timestamp: Date.now()
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * GET /health/agent/healing/status
     * Auto-healing system status
     */
    router.get('/health/agent/healing/status', (req, res) => {
        try {
            const handlers = discordHandlers;
            const healingState = handlers.autoHealer?.getState?.() || { enabled: false };

            res.json({
                autoHealing: healingState,
                monitor: {
                    autoRestartCount: discordHandlers.agentMonitor.autoRestartCount,
                    alertCount: discordHandlers.agentMonitor.alerts.length,
                    lastAlert:
                        discordHandlers.agentMonitor.alerts[
                            discordHandlers.agentMonitor.alerts.length - 1
                        ] || null
                },
                timestamp: Date.now()
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * GET /health/agent/captcha/status
     * Captcha handling capabilities and configuration
     */
    router.get('/health/agent/captcha/status', (req, res) => {
        try {
            const captcha = discordHandlers.captchaHandler;
            res.json({
                enabled: captcha.solvingService !== 'none',
                service: captcha.solvingService,
                hasApiKey: !!captcha.apiKey,
                timeout: captcha.timeout,
                retries: captcha.retries,
                supportedTypes: [
                    'recaptcha_v2',
                    'recaptcha_v3',
                    'hcaptcha',
                    'cloudflare_turnstile'
                ],
                timestamp: Date.now()
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * GET /health/agent/robustness/status
     * Robustness and error recovery capabilities
     */
    router.get('/health/agent/robustness/status', (req, res) => {
        try {
            const robustness = discordHandlers.robustnessEnhancer;
            res.json({
                enhancerStats: robustness.getStats(),
                recoveryStrategies: [
                    'timeout_recovery',
                    'network_error_recovery',
                    'browser_crash_recovery',
                    'rate_limit_recovery',
                    'js_error_recovery',
                    'memory_pressure_recovery'
                ],
                capabilities: {
                    resilientNavigation: true,
                    resilientEvaluation: true,
                    resilientScreenshot: true,
                    errorDetection: true,
                    autoRecovery: true
                },
                timestamp: Date.now()
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * GET /health/agent/prometheus
     * Prometheus-compatible metrics format
     */
    router.get('/health/agent/prometheus', (req, res) => {
        const metrics = discordHandlers.browserAgent.getMetrics();
        const health = discordHandlers.agentMonitor.getHealthReport(discordHandlers.browserAgent);

        let lines = [
            '# HELP jarvis_agent_health Overall agent health score (0-100)',
            '# TYPE jarvis_agent_health gauge',
            `jarvis_agent_health ${health.overallHealth}`,
            '',
            '# HELP jarvis_agent_memory_heap_used_bytes Heap memory usage in bytes',
            '# TYPE jarvis_agent_memory_heap_used_bytes gauge',
            `jarvis_agent_memory_heap_used_bytes ${health.memory.heapUsedMb * 1024 * 1024}`,
            '',
            '# HELP jarvis_agent_memory_heap_total_bytes Total heap memory available',
            '# TYPE jarvis_agent_memory_heap_total_bytes gauge',
            `jarvis_agent_memory_heap_total_bytes ${health.memory.heapTotalMb * 1024 * 1024}`,
            '',
            '# HELP jarvis_agent_memory_heap_used_percent Heap memory usage percentage',
            '# TYPE jarvis_agent_memory_heap_used_percent gauge',
            `jarvis_agent_memory_heap_used_percent ${health.memory.heapUsedPercent}`,
            '',
            '# HELP jarvis_agent_memory_trend_slope Memory usage trend slope',
            '# TYPE jarvis_agent_memory_trend_slope gauge',
            `jarvis_agent_memory_trend_slope ${health.memory.trend?.slope || 0}`,
            '',
            '# HELP jarvis_agent_active_sessions Number of active browser sessions',
            '# TYPE jarvis_agent_active_sessions gauge',
            `jarvis_agent_active_sessions ${metrics.activeSessions}`,
            '',
            '# HELP jarvis_agent_total_sessions Total sessions created',
            '# TYPE jarvis_agent_total_sessions counter',
            `jarvis_agent_total_sessions ${metrics.totalSessions}`,
            '',
            '# HELP jarvis_agent_failed_sessions Sessions that encountered errors',
            '# TYPE jarvis_agent_failed_sessions counter',
            `jarvis_agent_failed_sessions ${metrics.failedSessions}`,
            '',
            '# HELP jarvis_agent_succeeded_operations Successful operations count',
            '# TYPE jarvis_agent_succeeded_operations counter',
            `jarvis_agent_succeeded_operations ${health.operations.succeeded}`,
            '',
            '# HELP jarvis_agent_failed_operations Failed operations count',
            '# TYPE jarvis_agent_failed_operations counter',
            `jarvis_agent_failed_operations ${health.operations.failed}`,
            '',
            '# HELP jarvis_agent_operation_latency_ms Average operation latency',
            '# TYPE jarvis_agent_operation_latency_ms gauge',
            `jarvis_agent_operation_latency_ms ${health.operations.avgLatencyMs}`,
            '',
            '# HELP jarvis_agent_browser_restarts Number of browser restarts',
            '# TYPE jarvis_agent_browser_restarts counter',
            `jarvis_agent_browser_restarts ${metrics.browserRestarts}`,
            '',
            '# HELP jarvis_agent_auto_restarts Number of automatic restarts',
            '# TYPE jarvis_agent_auto_restarts counter',
            `jarvis_agent_auto_restarts ${health.autoRestartCount}`,
            '',
            '# HELP jarvis_agent_circuit_breaker Circuit breaker status (1=open, 0=closed)',
            '# TYPE jarvis_agent_circuit_breaker gauge',
            `jarvis_agent_circuit_breaker ${metrics.circuitBreakerStatus === 'open' ? 1 : 0}`,
            '',
            '# HELP jarvis_agent_uptime_seconds Agent uptime in seconds',
            '# TYPE jarvis_agent_uptime_seconds counter',
            `jarvis_agent_uptime_seconds ${Math.floor(health.uptime / 1000)}`,
            '',
            '# HELP jarvis_agent_session_error_rate Session error rate (0-1)',
            '# TYPE jarvis_agent_session_error_rate gauge',
            `jarvis_agent_session_error_rate ${health.sessions.avgErrorRate}`,
            '',
            '# HELP jarvis_agent_alerts_total Total alerts recorded',
            '# TYPE jarvis_agent_alerts_total counter',
            `jarvis_agent_alerts_total ${discordHandlers.agentMonitor.alerts.length}`
        ];

        res.set('Content-Type', 'text/plain; charset=utf-8');
        res.send(lines.join('\n') + '\n');
    });

    return router;
}

module.exports = { createAgentDiagnosticsRouter };

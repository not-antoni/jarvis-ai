/**
 * Agent monitoring and diagnostics system
 * Tracks performance, health, resource usage, and operational metrics
 */

const AgentConfig = require('./agentConfig');

class AgentMonitor {
    constructor(config = null) {
        this.config = config instanceof AgentConfig ? config : new AgentConfig();
        this.operationLog = [];
        this.startTime = Date.now();
        this.alerts = [];
        
        // Memory trend tracking
        this.memoryTrend = [];
        this.memoryTrendMaxSize = this.config.get('memory.trendTrackingSamples') || 60;
        this.memoryTrendWindow = this.config.get('memory.trendTrackingWindow') || 300000;
        
        // Auto-healing tracking
        this.autoRestartCount = 0;
        this.lastAutoRestartTime = 0;
        this.autoRestartResetTime = (this.config.get('autoHealing.autoRestartResetHours') || 24) * 3600000;
        
        // Session management
        this.sessionExpiryMap = new Map();
    }

    recordOperation(contextKey, operation, durationMs, success, error = null) {
        const entry = {
            timestamp: Date.now(),
            contextKey,
            operation,
            durationMs,
            success,
            error: error ? error.message : null
        };
        
        this.operationLog.push(entry);
        if (this.operationLog.length > (this.config.get('diagnostics.maxLogEntries') || 1000)) {
            this.operationLog.shift();
        }
        
        // Check for anomalies
        if (!success) {
            this.recordAlert('operation_failure', `${operation} failed: ${error?.message}`, 'error');
        }
        
        const latencyThreshold = this.config.get('monitoring.operationLatencyMs');
        if (durationMs > latencyThreshold) {
            this.recordAlert('high_latency', `${operation} took ${durationMs}ms (threshold: ${latencyThreshold}ms)`, 'warning');
        }
    }

    recordAlert(type, message, severity = 'info') {
        const alert = {
            timestamp: Date.now(),
            type,
            message,
            severity
        };
        
        const maxAlerts = this.config.get('diagnostics.maxAlerts') || 100;
        this.alerts.push(alert);
        if (this.alerts.length > maxAlerts) {
            this.alerts.shift();
        }
        
        console.log(`[AgentMonitor] ${severity.toUpperCase()} - ${type}: ${message}`);
    }

    // Track memory usage over time to detect leaks
    recordMemorySnapshot(usage) {
        const now = Date.now();
        const heapUsedPercent = (usage.heapUsed / usage.heapTotal) * 100;
        
        this.memoryTrend.push({
            timestamp: now,
            heapUsedMb: Math.round(usage.heapUsed / 1024 / 1024),
            heapUsedPercent: Math.round(heapUsedPercent),
            rssMb: Math.round(usage.rss / 1024 / 1024),
        });
        
        // Keep trend window bounded
        if (this.memoryTrend.length > this.memoryTrendMaxSize) {
            this.memoryTrend.shift();
        }
    }

    // Detect memory leak by analyzing trend
    getMemoryTrend() {
        if (this.memoryTrend.length < 2) {
            return { trend: 'insufficient_data', slope: 0, riskLevel: 'low' };
        }
        
        const recent = this.memoryTrend.slice(-10);
        const old = this.memoryTrend.slice(0, Math.max(1, this.memoryTrend.length - 10));
        
        const avgRecentHeap = recent.reduce((sum, m) => sum + m.heapUsedMb, 0) / recent.length;
        const avgOldHeap = old.reduce((sum, m) => sum + m.heapUsedMb, 0) / old.length;
        
        const slope = (avgRecentHeap - avgOldHeap) / avgOldHeap;
        let trend = 'stable';
        let riskLevel = 'low';
        
        if (slope > 0.1) {
            trend = 'increasing';
            riskLevel = slope > 0.3 ? 'high' : 'medium';
        } else if (slope < -0.05) {
            trend = 'decreasing';
        }
        
        return { trend, slope: Math.round(slope * 100) / 100, riskLevel };
    }

    // Register session with expiry tracking
    registerSession(sessionKey, ttlMinutes = null) {
        const ttl = ttlMinutes || this.config.get('sessions.sessionTTLMinutes');
        this.sessionExpiryMap.set(sessionKey, Date.now() + (ttl * 60 * 1000));
    }

    // Check for expired sessions
    getExpiredSessions() {
        const now = Date.now();
        const expired = [];
        
        for (const [key, expiryTime] of this.sessionExpiryMap.entries()) {
            if (now > expiryTime) {
                expired.push(key);
            }
        }
        
        return expired;
    }

    // Clean up expired sessions
    cleanupExpiredSessions(onExpire) {
        const expired = this.getExpiredSessions();
        for (const key of expired) {
            this.sessionExpiryMap.delete(key);
            if (onExpire) onExpire(key);
        }
        return expired;
    }

    // Track auto-restart attempts
    recordAutoRestart() {
        const now = Date.now();
        
        // Reset counter if outside the reset window
        if (now - this.lastAutoRestartTime > this.autoRestartResetTime) {
            this.autoRestartCount = 0;
        }
        
        this.autoRestartCount++;
        this.lastAutoRestartTime = now;
        
        const maxRestarts = this.config.get('autoHealing.maxAutoRestarts') || 5;
        if (this.autoRestartCount > maxRestarts) {
            this.recordAlert('too_many_restarts', 
                `Agent exceeded max auto-restarts (${this.autoRestartCount}/${maxRestarts}) in 24h`, 
                'error');
            return false; // Don't restart
        }
        
        return true; // OK to restart
    }

    getSessionMetrics(browserAgent) {
        const sessions = browserAgent.sessions;
        const now = Date.now();
        const inactiveThreshold = this.config.get('sessions.sessionIdleTimeoutMinutes') * 60 * 1000;
        
        let totalErrorCount = 0;
        let totalRequestCount = 0;
        const sessionDetails = [];
        
        for (const [key, session] of sessions.entries()) {
            totalErrorCount += session.errorCount || 0;
            totalRequestCount += session.requestCount || 0;
            
            const ageMs = now - session.createdAt;
            const inactiveMs = now - session.touchedAt;
            
            sessionDetails.push({
                key,
                ageMs,
                inactiveMs,
                errorCount: session.errorCount || 0,
                requestCount: session.requestCount || 0,
                isStale: inactiveMs > inactiveThreshold
            });
        }
        
        return {
            activeCount: sessions.size,
            totalSessions: browserAgent.metrics.totalSessions,
            failedSessions: browserAgent.metrics.failedSessions,
            totalErrorCount,
            totalRequestCount,
            avgErrorRate: sessions.size > 0 ? totalErrorCount / totalRequestCount : 0,
            sessionDetails
        };
    }

    getMemoryMetrics() {
        const usage = process.memoryUsage();
        const heapUsedPercent = (usage.heapUsed / usage.heapTotal) * 100;
        const rssUsedPercent = (usage.rss / (require('os').totalmem())) * 100;
        
        // Record for trend tracking
        this.recordMemorySnapshot(usage);
        
        const warningThreshold = this.config.get('memory.heapWarningThreshold');
        const criticalThreshold = this.config.get('memory.heapCriticalThreshold');
        
        return {
            heapUsedMb: Math.round(usage.heapUsed / 1024 / 1024),
            heapTotalMb: Math.round(usage.heapTotal / 1024 / 1024),
            heapUsedPercent: Math.round(heapUsedPercent),
            rssMb: Math.round(usage.rss / 1024 / 1024),
            externalMb: Math.round(usage.external / 1024 / 1024),
            isWarning: heapUsedPercent > warningThreshold,
            isCritical: heapUsedPercent > criticalThreshold,
            trend: this.getMemoryTrend()
        };
    }

    getOperationStats() {
        const recentOps = this.operationLog.slice(-100);
        const succeeded = recentOps.filter(op => op.success).length;
        const failed = recentOps.filter(op => !op.success).length;
        const avgLatency = recentOps.length > 0 
            ? Math.round(recentOps.reduce((sum, op) => sum + op.durationMs, 0) / recentOps.length)
            : 0;
        
        const operationCounts = {};
        for (const op of recentOps) {
            operationCounts[op.operation] = (operationCounts[op.operation] || 0) + 1;
        }
        
        return {
            recentOperations: recentOps.length,
            succeeded,
            failed,
            successRate: recentOps.length > 0 ? ((succeeded / recentOps.length) * 100).toFixed(1) + '%' : 'N/A',
            avgLatencyMs: avgLatency,
            operationBreakdown: operationCounts
        };
    }

    getHealthReport(browserAgent) {
        const sessionMetrics = this.getSessionMetrics(browserAgent);
        const memoryMetrics = this.getMemoryMetrics();
        const operationStats = this.getOperationStats();
        const browserMetrics = browserAgent.getMetrics();
        
        const healthScores = {
            browser: browserMetrics.browserHealth === 'ok' ? 100 : 0,
            memory: memoryMetrics.isCritical ? 10 : memoryMetrics.isWarning ? 50 : 100,
            operations: operationStats.succeeded > 0 
                ? Math.min(100, Math.round((operationStats.succeeded / (operationStats.succeeded + operationStats.failed)) * 100))
                : 100,
            circuitBreaker: browserMetrics.circuitBreakerStatus === 'closed' ? 100 : 0
        };
        
        const overallHealth = Math.round(
            (healthScores.browser + healthScores.memory + healthScores.operations + healthScores.circuitBreaker) / 4
        );
        
        return {
            timestamp: Date.now(),
            uptime: Date.now() - this.startTime,
            overallHealth,
            healthScores,
            sessions: sessionMetrics,
            memory: memoryMetrics,
            operations: operationStats,
            browser: browserMetrics,
            autoRestartCount: this.autoRestartCount,
            recentAlerts: this.alerts.slice(-10)
        };
    }

    generateDiagnosticsReport(browserAgent) {
        const health = this.getHealthReport(browserAgent);
        
        return {
            generatedAt: new Date().toISOString(),
            system: {
                nodeVersion: process.version,
                platform: process.platform,
                uptime: health.uptime,
                pid: process.pid
            },
            agent: {
                enabled: browserAgent.enabled,
                circuitBreakerOpen: browserAgent.circuitBreakerOpen,
                consecutiveErrors: browserAgent.consecutiveErrorCount,
                browserRestarts: browserAgent.browserRestarts,
                maxConcurrentSessions: browserAgent.maxConcurrentSessions
            },
            performance: health,
            recommendations: this.generateRecommendations(health)
        };
    }

    generateRecommendations(health) {
        const recommendations = [];
        
        if (health.healthScores.memory < 75) {
            recommendations.push('⚠️  High memory usage detected. Consider clearing old sessions or restarting the agent.');
        }
        
        // Memory leak detection from trend
        if (health.memory.trend && health.memory.trend.riskLevel === 'high') {
            recommendations.push(`🚨 MEMORY LEAK DETECTED: Heap growing ${health.memory.trend.slope}% per window. Restart recommended.`);
        } else if (health.memory.trend && health.memory.trend.riskLevel === 'medium') {
            recommendations.push(`⚠️  Memory increasing ${health.memory.trend.slope}% per window. Monitor closely.`);
        }
        
        if (health.healthScores.circuitBreaker === 0) {
            recommendations.push('🚨 Circuit breaker is OPEN. Agent is experiencing repeated failures. Check browser health.');
        }
        
        if (health.sessions.avgErrorRate > 0.2) {
            recommendations.push('⚠️  High session error rate. Monitor network stability and URL domains.');
        }
        
        if (health.sessions.activeCount >= (health.sessions.sessionDetails.length * 0.9)) {
            recommendations.push('⚠️  Operating near maximum concurrent sessions. Consider increasing capacity or reducing TTL.');
        }
        
        if (health.operations.successRate === '0%' && health.operations.recentOperations > 0) {
            recommendations.push('🚨 All recent operations failed. Agent may be in a broken state.');
        }
        
        if (health.memory.isCritical) {
            recommendations.push('🚨 CRITICAL: Heap memory usage >90%. Immediate restart recommended.');
        }
        
        if (health.autoRestartCount > 3) {
            recommendations.push(`⚠️  Agent has auto-restarted ${health.autoRestartCount} times. Investigate root cause.`);
        }
        
        if (health.healthScores.operations > 90 && health.healthScores.memory > 80 && health.healthScores.circuitBreaker === 100) {
            recommendations.push('✅ Agent is operating normally.');
        }
        
        return recommendations;
    }

    exportMetricsJSON(browserAgent) {
        return JSON.stringify(this.getHealthReport(browserAgent), null, 2);
    }
}

module.exports = AgentMonitor;

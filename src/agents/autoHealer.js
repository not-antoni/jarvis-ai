/**
 * Auto-Healing Manager - Handles automatic recovery and health checks
 * Monitors agent state and triggers recovery actions proactively
 */

const AgentConfig = require('./agentConfig');

class AutoHealer {
    constructor(config = null) {
        this.config = config instanceof AgentConfig ? config : new AgentConfig();
        this.healingConfig = this.config.get('autoHealing');
        this.circuitBreakerConfig = this.config.get('circuitBreaker');
        
        this.healthCheckInterval = null;
        this.cbResetAttempts = new Map();
    }

    /**
     * Start automatic health checks
     */
    startHealthChecks(browserAgent, agentMonitor, callbacks = {}) {
        if (!this.healingConfig.enabled) return;

        const intervalSeconds = this.healingConfig.healthCheckIntervalSeconds || 30;
        const intervalMs = intervalSeconds * 1000;

        console.log(`[AutoHealer] Starting health checks every ${intervalSeconds}s`);

        this.healthCheckInterval = setInterval(async () => {
            try {
                await this.performHealthCheck(browserAgent, agentMonitor, callbacks);
            } catch (error) {
                console.error('[AutoHealer] Health check failed:', error.message);
            }
        }, intervalMs);
    }

    stopHealthChecks() {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
        }
    }

    /**
     * Perform comprehensive health check and take actions
     */
    async performHealthCheck(browserAgent, agentMonitor, callbacks = {}) {
        const health = agentMonitor.getHealthReport(browserAgent);

        // Check for circuit breaker stuck open
        if (browserAgent.circuitBreakerOpen) {
            await this.handleOpenCircuitBreaker(browserAgent, agentMonitor, callbacks);
        }

        // Check for critical memory
        if (health.memory.isCritical && this.healingConfig.autoRestartOnCritical) {
            const canRestart = agentMonitor.recordAutoRestart();
            if (canRestart && callbacks.onCriticalMemory) {
                console.log('[AutoHealer] Critical memory detected, triggering restart...');
                await callbacks.onCriticalMemory(browserAgent);
            }
        }

        // Check memory leak trend
        if (health.memory.trend?.riskLevel === 'high') {
            agentMonitor.recordAlert('memory_leak_detected', 
                `Memory leak trend detected: ${health.memory.trend.slope}% growth`, 
                'error');
            if (callbacks.onMemoryLeak) {
                await callbacks.onMemoryLeak(browserAgent);
            }
        }

        // Clean up expired sessions
        if (callbacks.onSessionExpiry) {
            const expired = agentMonitor.cleanupExpiredSessions(callbacks.onSessionExpiry);
            if (expired.length > 0) {
                console.log(`[AutoHealer] Cleaned up ${expired.length} expired sessions`);
            }
        }

        // Check session limits
        if (health.sessions.activeCount >= this.config.get('sessions.maxConcurrentSessions') * 0.95) {
            agentMonitor.recordAlert('session_capacity_warning',
                `Approaching session limit: ${health.sessions.activeCount}/${this.config.get('sessions.maxConcurrentSessions')}`,
                'warning');
        }
    }

    /**
     * Handle stuck open circuit breaker
     */
    async handleOpenCircuitBreaker(browserAgent, agentMonitor, callbacks = {}) {
        const cbConfig = this.circuitBreakerConfig;
        const key = 'circuit_breaker_reset';
        let attempts = this.cbResetAttempts.get(key) || 0;

        // Try to transition to half-open
        if (attempts < cbConfig.halfOpenAttempts) {
            this.cbResetAttempts.set(key, attempts + 1);
            
            console.log(`[AutoHealer] Attempting circuit breaker reset (${attempts + 1}/${cbConfig.halfOpenAttempts})`);
            agentMonitor.recordAlert('circuit_breaker_reset_attempt',
                `Attempting to close circuit breaker (attempt ${attempts + 1})`,
                'info');

            if (callbacks.onCircuitBreakerReset) {
                await callbacks.onCircuitBreakerReset(browserAgent);
            }
        } else {
            // Give up and restart browser
            console.log('[AutoHealer] Circuit breaker stuck open, forcing restart...');
            agentMonitor.recordAlert('circuit_breaker_restart',
                'Circuit breaker unable to recover, forcing browser restart',
                'error');

            this.cbResetAttempts.delete(key);

            const canRestart = agentMonitor.recordAutoRestart();
            if (canRestart && callbacks.onBrowserRestart) {
                await callbacks.onBrowserRestart(browserAgent);
            }
        }
    }

    /**
     * Reset circuit breaker tracking
     */
    resetCircuitBreakerTracking() {
        this.cbResetAttempts.clear();
    }

    /**
     * Get current healing state
     */
    getState() {
        return {
            enabled: this.healingConfig.enabled,
            isHealthCheckRunning: !!this.healthCheckInterval,
            cbResetAttempts: Object.fromEntries(this.cbResetAttempts)
        };
    }
}

module.exports = AutoHealer;

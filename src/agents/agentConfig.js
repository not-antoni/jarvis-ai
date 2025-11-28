/**
 * Agent Configuration - Centralized settings for BrowserAgent monitoring and behavior
 * Allows fine-tuning without code changes
 */

const defaultConfig = {
    // ===== Monitoring Thresholds =====
    monitoring: {
        memoryUsagePercent: 80,           // Alert when heap usage exceeds this
        sessionErrorRate: 0.3,             // Alert when error rate exceeds 30%
        operationLatencyMs: 30000,         // Alert when operation takes longer than this
        inactiveSessionMinutes: 30,        // Close sessions inactive for this long
        consecutiveErrorsBeforeOpen: 5,   // Circuit breaker opens after N errors
    },

    // ===== Session Management =====
    sessions: {
        maxConcurrentSessions: 10,         // Maximum parallel browser sessions
        sessionTTLMinutes: 60,             // Default time-to-live for sessions
        sessionIdleTimeoutMinutes: 15,     // Close session if inactive for this long
        staleSweepIntervalSeconds: 60,    // How often to clean up stale sessions
    },

    // ===== Circuit Breaker =====
    circuitBreaker: {
        enabled: true,
        openThreshold: 5,                  // Open after N consecutive errors
        halfOpenAttempts: 3,               // Retry attempts in half-open state
        resetTimeoutMs: 30000,             // Time before attempting reset
        backoffMultiplier: 2,              // Exponential backoff factor
        maxBackoffMs: 300000,              // Max backoff time (5 minutes)
    },

    // ===== Retry Policy =====
    retry: {
        maxRetries: 3,
        baseDelayMs: 1000,
        maxDelayMs: 10000,
        backoffMultiplier: 2,
        jitterPercent: 0.1,                // Add ±10% jitter to delays

        // Retry strategies by error type
        strategies: {
            'TIMEOUT': { maxRetries: 4, baseDelayMs: 2000 },
            'NETWORK': { maxRetries: 3, baseDelayMs: 1500 },
            'BROWSER_CRASH': { maxRetries: 1, baseDelayMs: 5000 },
            'RATE_LIMIT': { maxRetries: 5, baseDelayMs: 3000 },
            'INVALID_URL': { maxRetries: 0 },  // Don't retry bad URLs
        },
    },

    // ===== Memory Management =====
    memory: {
        heapWarningThreshold: 80,          // Trigger warning at 80%
        heapCriticalThreshold: 90,         // Force cleanup at 90%
        trendTrackingWindow: 300000,       // Track memory over 5 minutes
        trendTrackingSamples: 60,          // Number of samples to keep
        autoRestartOnCritical: true,       // Auto-restart browser at critical
    },

    // ===== Performance Optimization =====
    performance: {
        enableConnectionPooling: true,
        pageLoadTimeoutMs: 30000,
        navigationTimeoutMs: 30000,
        defaultViewport: { width: 1920, height: 1080 },
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--single-process',
        ],
    },

    // ===== Logging & Diagnostics =====
    diagnostics: {
        logOperations: true,
        logLevel: 'info',  // 'debug', 'info', 'warn', 'error'
        maxLogEntries: 1000,
        maxAlerts: 100,
        enableMetricsCollection: true,
        prometheusEnabled: true,
    },

    // ===== Auto-Healing =====
    autoHealing: {
        enabled: true,
        healthCheckIntervalSeconds: 30,
        autoRestartBrokenBrowser: true,
        maxAutoRestarts: 5,
        autoRestartResetHours: 24,
    },
};

class AgentConfig {
    constructor(overrides = {}) {
        this.config = JSON.parse(JSON.stringify(defaultConfig));
        this.applyOverrides(overrides);
        this.validateConfig();
    }

    applyOverrides(overrides) {
        const merge = (target, source) => {
            for (const key in source) {
                if (source.hasOwnProperty(key)) {
                    if (typeof source[key] === 'object' && !Array.isArray(source[key])) {
                        merge(target[key] || {}, source[key]);
                    } else {
                        target[key] = source[key];
                    }
                }
            }
        };
        merge(this.config, overrides);
    }

    validateConfig() {
        const errors = [];

        if (this.config.sessions.maxConcurrentSessions < 1) {
            errors.push('maxConcurrentSessions must be >= 1');
        }
        if (this.config.monitoring.memoryUsagePercent < 50 || this.config.monitoring.memoryUsagePercent > 100) {
            errors.push('memoryUsagePercent must be between 50-100');
        }
        if (this.config.circuitBreaker.openThreshold < 1) {
            errors.push('circuitBreaker.openThreshold must be >= 1');
        }
        if (this.config.memory.heapWarningThreshold >= this.config.memory.heapCriticalThreshold) {
            errors.push('heapWarningThreshold must be < heapCriticalThreshold');
        }

        if (errors.length > 0) {
            throw new Error(`Agent config validation failed:\n${errors.join('\n')}`);
        }
    }

    get(path) {
        return path.split('.').reduce((obj, key) => obj?.[key], this.config);
    }

    set(path, value) {
        const keys = path.split('.');
        const target = keys.slice(0, -1).reduce((obj, key) => obj[key] || (obj[key] = {}), this.config);
        target[keys[keys.length - 1]] = value;
        this.validateConfig();
    }

    getAll() {
        return JSON.parse(JSON.stringify(this.config));
    }

    static loadFromEnv() {
        const overrides = {};

        // Load from environment variables with prefix AGENT_
        for (const [key, value] of Object.entries(process.env)) {
            if (key.startsWith('AGENT_')) {
                const configPath = key.slice(6).toLowerCase();
                try {
                    overrides[configPath] = JSON.parse(value);
                } catch (e) {
                    overrides[configPath] = value;
                }
            }
        }

        return new AgentConfig(overrides);
    }
}

module.exports = AgentConfig;

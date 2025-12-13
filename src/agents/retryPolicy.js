/**
 * Retry Policy Manager - Handles granular retry logic based on error types
 * Supports exponential backoff, jitter, and strategy-specific overrides
 */

const AgentConfig = require('./agentConfig');

class RetryPolicy {
    constructor(config = null) {
        this.config = config instanceof AgentConfig ? config : new AgentConfig();
        this.retryConfig = this.config.get('retry');
    }

    /**
     * Determine if an error is retryable and get retry parameters
     */
    getRetryStrategy(errorType = 'UNKNOWN') {
        const strategies = this.retryConfig.strategies || {};
        const strategy = strategies[errorType] || {
            maxRetries: this.retryConfig.maxRetries,
            baseDelayMs: this.retryConfig.baseDelayMs
        };

        return {
            errorType,
            maxRetries: strategy.maxRetries,
            baseDelayMs: strategy.baseDelayMs,
            backoffMultiplier: this.retryConfig.backoffMultiplier,
            maxDelayMs: this.retryConfig.maxDelayMs,
            jitterPercent: this.retryConfig.jitterPercent
        };
    }

    /**
     * Calculate delay for a retry attempt with exponential backoff and jitter
     */
    calculateDelay(attemptNumber, strategy) {
        const baseDelay = strategy.baseDelayMs;
        const multiplier = Math.pow(strategy.backoffMultiplier, attemptNumber - 1);
        let delay = baseDelay * multiplier;

        // Cap at max delay
        delay = Math.min(delay, strategy.maxDelayMs);

        // Add jitter (±10%)
        const jitterAmount = delay * strategy.jitterPercent;
        const jitter = (Math.random() - 0.5) * 2 * jitterAmount;
        delay = Math.max(1, delay + jitter);

        return Math.round(delay);
    }

    /**
     * Execute a function with retry logic
     */
    async executeWithRetry(fn, options = {}) {
        const errorType = options.errorType || 'UNKNOWN';
        const strategy = this.getRetryStrategy(errorType);
        const onRetry = options.onRetry || (() => {});
        const shouldRetry = options.shouldRetry || (() => true);

        let lastError = null;

        for (let attempt = 1; attempt <= strategy.maxRetries + 1; attempt++) {
            try {
                return await fn();
            } catch (error) {
                lastError = error;

                if (attempt > strategy.maxRetries || !shouldRetry(error)) {
                    throw error;
                }

                const delay = this.calculateDelay(attempt, strategy);
                onRetry({ attempt, delay, error });
                await this.sleep(delay);
            }
        }

        throw lastError;
    }

    /**
     * Classify error type from error object or message
     */
    classifyError(error) {
        const message = (error.message || error.toString()).toUpperCase();

        if (message.includes('TIMEOUT') || message.includes('EXCEEDED')) {
            return 'TIMEOUT';
        }
        if (
            message.includes('ECONNREFUSED') ||
            message.includes('ENOTFOUND') ||
            message.includes('NETWORK')
        ) {
            return 'NETWORK';
        }
        if (message.includes('CRASH') || message.includes('EXITED')) {
            return 'BROWSER_CRASH';
        }
        if (
            message.includes('429') ||
            message.includes('RATE_LIMIT') ||
            message.includes('TOO_MANY')
        ) {
            return 'RATE_LIMIT';
        }
        if (message.includes('INVALID') || message.includes('MALFORMED')) {
            return 'INVALID_URL';
        }

        return 'UNKNOWN';
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Get human-readable retry info
     */
    getRetryInfo(errorType) {
        const strategy = this.getRetryStrategy(errorType);
        const delays = [];

        for (let i = 1; i <= Math.min(strategy.maxRetries, 5); i++) {
            delays.push(this.calculateDelay(i, strategy));
        }

        return {
            errorType,
            maxRetries: strategy.maxRetries,
            estimatedDelays: delays,
            totalEstimatedTimeMs: delays.reduce((a, b) => a + b, 0)
        };
    }
}

module.exports = RetryPolicy;

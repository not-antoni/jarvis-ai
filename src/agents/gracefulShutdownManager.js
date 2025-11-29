/**
 * Graceful Shutdown Manager - Signal handlers, session draining, resource cleanup guarantees
 * Ensures clean shutdown without losing data or orphaned processes
 */

class GracefulShutdownManager {
    constructor(config = {}) {
        this.timeoutMs = config.timeoutMs || 30 * 1000; // 30 second shutdown timeout
        this.handlers = [];
        this.shutdownStarted = false;
        this.shutdownInProgress = false;
        this.shutdownComplete = false;
        
        this.stats = {
            handlersRegistered: 0,
            handlersExecuted: 0,
            handlersSkipped: 0,
            shutdownDurationMs: 0,
            errors: []
        };

        this.setup();
    }

    /**
     * Setup signal handlers
     */
    setup() {
        // Handle graceful shutdown signals
        process.on('SIGTERM', () => this.handleSignal('SIGTERM'));
        process.on('SIGINT', () => this.handleSignal('SIGINT'));
        process.on('SIGHUP', () => this.handleSignal('SIGHUP'));

        // Prevent immediate exit
        process.on('exit', () => this.onProcessExit());
    }

    /**
     * Handle shutdown signal
     */
    async handleSignal(signal) {
        if (this.shutdownStarted) {
            console.log(`[GracefulShutdown] Received ${signal} during shutdown, forcing exit in 5s...`);
            setTimeout(() => process.exit(1), 5000);
            return;
        }

        console.log(`\n[GracefulShutdown] Received ${signal}, starting graceful shutdown...`);
        await this.shutdown();
        process.exit(0);
    }

    /**
     * Register cleanup handler
     */
    registerHandler(name, handler, priority = 'normal') {
        if (this.shutdownInProgress) {
            console.warn(`[GracefulShutdown] Cannot register handler ${name}: shutdown in progress`);
            return false;
        }

        const priorityValue = {
            'critical': 0,
            'high': 1,
            'normal': 2,
            'low': 3
        }[priority] || 2;

        this.handlers.push({
            name,
            handler,
            priority: priorityValue,
            registered: Date.now()
        });

        this.stats.handlersRegistered++;
        return true;
    }

    /**
     * Unregister handler
     */
    unregisterHandler(name) {
        const index = this.handlers.findIndex(h => h.name === name);
        if (index >= 0) {
            this.handlers.splice(index, 1);
            return true;
        }
        return false;
    }

    /**
     * Execute graceful shutdown
     */
    async shutdown() {
        if (this.shutdownStarted) return;

        this.shutdownStarted = true;
        this.shutdownInProgress = true;
        const startTime = Date.now();

        console.log(`[GracefulShutdown] Executing ${this.handlers.length} cleanup handlers...`);

        // Sort handlers by priority (lower value = higher priority)
        const sortedHandlers = [...this.handlers].sort((a, b) => a.priority - b.priority);

        for (const handlerInfo of sortedHandlers) {
            try {
                console.log(`[GracefulShutdown] Executing ${handlerInfo.name}...`);

                // Execute with timeout
                await Promise.race([
                    this.executeHandler(handlerInfo),
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('Handler timeout')), this.timeoutMs / sortedHandlers.length)
                    )
                ]);

                this.stats.handlersExecuted++;
                console.log(`[GracefulShutdown] ✓ ${handlerInfo.name} completed`);
            } catch (error) {
                this.stats.handlersSkipped++;
                this.stats.errors.push({
                    handler: handlerInfo.name,
                    error: error.message,
                    timestamp: Date.now()
                });

                console.error(`[GracefulShutdown] ✗ ${handlerInfo.name} failed:`, error.message);
            }
        }

        this.stats.shutdownDurationMs = Date.now() - startTime;
        this.shutdownInProgress = false;
        this.shutdownComplete = true;

        console.log(`[GracefulShutdown] Shutdown complete in ${this.stats.shutdownDurationMs}ms`);
        console.log(`[GracefulShutdown] Handlers: ${this.stats.handlersExecuted} executed, ${this.stats.handlersSkipped} failed`);

        return this.stats;
    }

    /**
     * Execute single handler
     */
    async executeHandler(handlerInfo) {
        try {
            const result = handlerInfo.handler();
            
            // Handle promises
            if (result && typeof result.then === 'function') {
                await result;
            }
        } catch (error) {
            throw error;
        }
    }

    /**
     * Session draining - wait for active sessions to complete
     */
    async drainSessions(sessionManager, maxWaitMs = 10000) {
        const startTime = Date.now();
        
        return new Promise((resolve) => {
            const checkInterval = setInterval(() => {
                const sessions = sessionManager.getSessions?.();
                const activeSessions = sessions?.filter(s => s.accessCount > 0).length || 0;

                if (activeSessions === 0) {
                    clearInterval(checkInterval);
                    resolve();
                    return;
                }

                if (Date.now() - startTime > maxWaitMs) {
                    clearInterval(checkInterval);
                    console.warn(`[GracefulShutdown] Session drain timeout, forcing shutdown with ${activeSessions} active sessions`);
                    resolve();
                }
            }, 100);
        });
    }

    /**
     * Cleanup all resources
     */
    async cleanupResources(resources = {}) {
        const cleanupOps = [];

        // Close databases
        if (resources.database?.close) {
            cleanupOps.push({
                name: 'database.close',
                fn: () => resources.database.close()
            });
        }

        // Shutdown cache
        if (resources.cache?.shutdown) {
            cleanupOps.push({
                name: 'cache.shutdown',
                fn: () => resources.cache.shutdown()
            });
        }

        // Drain session manager
        if (resources.sessionManager?.shutdown) {
            cleanupOps.push({
                name: 'sessionManager.shutdown',
                fn: () => resources.sessionManager.shutdown()
            });
        }

        // Close resource pool
        if (resources.resourcePool?.drain) {
            cleanupOps.push({
                name: 'resourcePool.drain',
                fn: () => resources.resourcePool.drain()
            });
        }

        // Shutdown rate limiter
        if (resources.rateLimiter?.shutdown) {
            cleanupOps.push({
                name: 'rateLimiter.shutdown',
                fn: () => resources.rateLimiter.shutdown()
            });
        }

        for (const op of cleanupOps) {
            try {
                await op.fn();
            } catch (error) {
                console.error(`[GracefulShutdown] Error during ${op.name}:`, error.message);
            }
        }
    }

    /**
     * Force shutdown (used when graceful fails)
     */
    async forceShutdown() {
        console.error('[GracefulShutdown] FORCE SHUTDOWN - Terminating immediately');
        process.exit(1);
    }

    /**
     * Process exit handler
     */
    onProcessExit() {
        if (!this.shutdownComplete) {
            console.warn('[GracefulShutdown] Process exiting without completing shutdown');
        }
    }

    /**
     * Get shutdown stats
     */
    getStats() {
        return {
            ...this.stats,
            handlersRegistered: this.handlers.length,
            shutdownStarted: this.shutdownStarted,
            shutdownInProgress: this.shutdownInProgress,
            shutdownComplete: this.shutdownComplete
        };
    }

    /**
     * Get handler info
     */
    getHandlers() {
        return this.handlers.map(h => ({
            name: h.name,
            priority: ['critical', 'high', 'normal', 'low'][h.priority],
            registered: h.registered
        }));
    }

    /**
     * Wait for shutdown to complete
     */
    waitForShutdown() {
        return new Promise((resolve) => {
            const checkInterval = setInterval(() => {
                if (this.shutdownComplete) {
                    clearInterval(checkInterval);
                    resolve(this.stats);
                }
            }, 100);

            // Timeout after max time
            setTimeout(() => {
                clearInterval(checkInterval);
                resolve(this.stats);
            }, this.timeoutMs);
        });
    }
}

module.exports = GracefulShutdownManager;

/**
 * Resource Pool - Manages reusable Chromium instances and connections
 * Prevents unbounded growth, enables connection reuse, graceful degradation
 */

class ResourcePool {
    constructor(config = {}) {
        this.maxPoolSize = config.maxPoolSize || 5;
        this.maxIdleTimeMs = config.maxIdleTimeMs || 30 * 60 * 1000; // 30 min
        this.maxBrowserLifetimeMs = config.maxBrowserLifetimeMs || 2 * 60 * 60 * 1000; // 2 hours
        this.preWarmCount = config.preWarmCount || 2;

        this.availableBrowsers = [];
        this.activeBrowsers = new Map(); // browserId -> { browser, createdAt, lastUsedAt, sessionCount }
        this.waitingQueue = [];
        this.metrics = {
            totalCreated: 0,
            totalDestroyed: 0,
            reused: 0,
            poolHits: 0,
            poolMisses: 0,
            averageWaitTimeMs: 0
        };

        this.cleanupInterval = setInterval(() => this.cleanup(), 60000).unref(); // Every 60s, unref to not keep process alive
    }

    /**
     * Acquire a browser from pool or create new one
     */
    async acquire(puppeteer, options = {}) {
        const startTime = Date.now();

        // Try to get available browser
        if (this.availableBrowsers.length > 0) {
            const browserId = this.availableBrowsers.shift();
            const browserData = this.activeBrowsers.get(browserId);

            if (browserData) {
                browserData.lastUsedAt = Date.now();
                browserData.sessionCount++;
                this.metrics.poolHits++;
                this.metrics.reused++;

                // Check if browser still connected
                if (browserData.browser?.connected) {
                    return { browser: browserData.browser, browserId, fromPool: true };
                } else {
                    // Remove dead browser
                    this.activeBrowsers.delete(browserId);
                    this.metrics.totalDestroyed++;
                }
            }
        }

        // Check if we can create new
        if (this.activeBrowsers.size < this.maxPoolSize) {
            this.metrics.poolMisses++;
            return this.createNewBrowser(puppeteer, options);
        }

        // Wait for available browser
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.waitingQueue = this.waitingQueue.filter(r => r.resolve !== resolve);
                reject(new Error(`Browser pool exhausted (${this.maxPoolSize} instances active)`));
            }, options.timeoutMs || 30000);

            this.waitingQueue.push({
                resolve: result => {
                    clearTimeout(timeout);
                    this.metrics.averageWaitTimeMs =
                        (this.metrics.averageWaitTimeMs + (Date.now() - startTime)) / 2;
                    resolve(result);
                },
                reject,
                options
            });
        });
    }

    /**
     * Create new browser instance
     */
    async createNewBrowser(puppeteer, options = {}) {
        const browserId = `browser_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

        try {
            const browser = await puppeteer.launch({
                headless: 'new',
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-gpu',
                    '--disable-dev-shm-usage',
                    '--disable-web-resources',
                    '--disable-sync',
                    '--disable-extensions'
                ],
                ...options
            });

            this.activeBrowsers.set(browserId, {
                browser,
                createdAt: Date.now(),
                lastUsedAt: Date.now(),
                sessionCount: 0
            });

            this.metrics.totalCreated++;
            return { browser, browserId, fromPool: false };
        } catch (error) {
            console.error('[ResourcePool] Failed to create browser:', error.message);
            throw error;
        }
    }

    /**
     * Release browser back to pool
     */
    release(browserId) {
        const browserData = this.activeBrowsers.get(browserId);
        if (!browserData) return;

        // Check if browser is still valid
        if (!browserData.browser?.connected) {
            this.destroy(browserId);
            return;
        }

        // Check if exceeded lifetime
        if (Date.now() - browserData.createdAt > this.maxBrowserLifetimeMs) {
            this.destroy(browserId);
            return;
        }

        // Put back in available pool
        this.availableBrowsers.push(browserId);

        // Serve waiting requests
        if (this.waitingQueue.length > 0) {
            const waiter = this.waitingQueue.shift();
            const bidx = this.availableBrowsers.indexOf(browserId);
            if (bidx >= 0) {
                this.availableBrowsers.splice(bidx, 1);
            }
            waiter.resolve({ browser: browserData.browser, browserId, fromPool: true });
        }
    }

    /**
     * Destroy browser and remove from pool
     */
    async destroy(browserId) {
        const browserData = this.activeBrowsers.get(browserId);
        if (!browserData) return;

        try {
            if (browserData.browser) {
                await browserData.browser.close().catch(() => {});
            }
        } catch (error) {
            console.error(`[ResourcePool] Error destroying browser ${browserId}:`, error.message);
        }

        this.activeBrowsers.delete(browserId);
        const idx = this.availableBrowsers.indexOf(browserId);
        if (idx >= 0) {
            this.availableBrowsers.splice(idx, 1);
        }
        this.metrics.totalDestroyed++;
    }

    /**
     * Cleanup stale browsers
     */
    async cleanup() {
        const now = Date.now();

        for (const [browserId, browserData] of this.activeBrowsers.entries()) {
            // Remove browsers exceeding lifetime
            if (now - browserData.createdAt > this.maxBrowserLifetimeMs) {
                await this.destroy(browserId);
                continue;
            }

            // Remove idle browsers if pool is large
            if (
                this.availableBrowsers.length > this.preWarmCount &&
                now - browserData.lastUsedAt > this.maxIdleTimeMs &&
                this.availableBrowsers.includes(browserId)
            ) {
                await this.destroy(browserId);
            }

            // Validate connection
            if (!browserData.browser?.connected) {
                await this.destroy(browserId);
            }
        }
    }

    /**
     * Pre-warm pool with N browsers
     */
    async preWarm(puppeteer, count = null) {
        count = count || this.preWarmCount;
        const needed = Math.max(0, count - this.activeBrowsers.size);

        for (let i = 0; i < needed; i++) {
            try {
                const { browserId, browser } = await this.createNewBrowser(puppeteer);
                this.availableBrowsers.push(browserId);
            } catch (error) {
                console.warn(`[ResourcePool] Pre-warm failed (${i}/${needed}):`, error.message);
            }
        }
    }

    /**
     * Gracefully drain pool
     */
    async drain() {
        // Reject waiting requests
        for (const waiter of this.waitingQueue) {
            waiter.reject(new Error('Resource pool draining'));
        }
        this.waitingQueue = [];

        // Close all browsers
        const browserIds = Array.from(this.activeBrowsers.keys());
        for (const browserId of browserIds) {
            await this.destroy(browserId);
        }

        clearInterval(this.cleanupInterval);
    }

    /**
     * Get pool statistics
     */
    getStats() {
        return {
            poolSize: this.activeBrowsers.size,
            available: this.availableBrowsers.length,
            active: this.activeBrowsers.size - this.availableBrowsers.length,
            waiting: this.waitingQueue.length,
            metrics: this.metrics,
            details: Array.from(this.activeBrowsers.entries()).map(([id, data]) => ({
                browserId: id,
                sessionCount: data.sessionCount,
                ageMs: Date.now() - data.createdAt,
                idleMs: Date.now() - data.lastUsedAt,
                connected: data.browser?.connected
            }))
        };
    }
}

module.exports = ResourcePool;

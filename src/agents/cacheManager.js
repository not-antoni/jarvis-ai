/**
 * Cache Manager - Implements multi-tier caching for responses, DOM, and screenshots
 * Reduces redundant requests and speeds up operations
 */

class CacheManager {
    constructor(config = {}) {
        this.maxCacheSizeBytes = config.maxCacheSizeBytes || 500 * 1024 * 1024; // 500 MB
        this.responseCacheTTLMs = config.responseCacheTTLMs || 60 * 60 * 1000; // 1 hour
        this.domCacheTTLMs = config.domCacheTTLMs || 5 * 60 * 1000; // 5 min
        this.screenshotCacheTTLMs = config.screenshotCacheTTLMs || 10 * 60 * 1000; // 10 min

        this.responseCache = new Map(); // url -> { data, timestamp, size }
        this.domCache = new Map(); // url -> { html, timestamp, size }
        this.screenshotCache = new Map(); // url+selector -> { buffer, timestamp, size }

        this.stats = {
            responseHits: 0,
            responseMisses: 0,
            domHits: 0,
            domMisses: 0,
            screenshotHits: 0,
            screenshotMisses: 0,
            totalSizeBytes: 0,
            evictions: 0
        };

        this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000); // Every 5 min
    }

    /**
     * Get from response cache
     */
    getResponseCache(url) {
        const cached = this.responseCache.get(url);
        if (!cached) {
            this.stats.responseMisses++;
            return null;
        }

        if (Date.now() - cached.timestamp > this.responseCacheTTLMs) {
            this.responseCache.delete(url);
            this.stats.totalSizeBytes -= cached.size;
            this.stats.responseMisses++;
            return null;
        }

        this.stats.responseHits++;
        return cached.data;
    }

    /**
     * Set response cache
     */
    setResponseCache(url, data) {
        const size = this.estimateSize(data);

        // Evict if needed
        if (this.stats.totalSizeBytes + size > this.maxCacheSizeBytes) {
            this.evict();
        }

        const cached = { data, timestamp: Date.now(), size };
        this.responseCache.set(url, cached);
        this.stats.totalSizeBytes += size;
    }

    /**
     * Get from DOM cache
     */
    getDOMCache(url) {
        const cached = this.domCache.get(url);
        if (!cached) {
            this.stats.domMisses++;
            return null;
        }

        if (Date.now() - cached.timestamp > this.domCacheTTLMs) {
            this.domCache.delete(url);
            this.stats.totalSizeBytes -= cached.size;
            this.stats.domMisses++;
            return null;
        }

        this.stats.domHits++;
        return cached.html;
    }

    /**
     * Set DOM cache
     */
    setDOMCache(url, html) {
        const size = html.length * 2; // Rough estimate

        if (this.stats.totalSizeBytes + size > this.maxCacheSizeBytes) {
            this.evict();
        }

        const cached = { html, timestamp: Date.now(), size };
        this.domCache.set(url, cached);
        this.stats.totalSizeBytes += size;
    }

    /**
     * Get from screenshot cache
     */
    getScreenshotCache(cacheKey) {
        const cached = this.screenshotCache.get(cacheKey);
        if (!cached) {
            this.stats.screenshotMisses++;
            return null;
        }

        if (Date.now() - cached.timestamp > this.screenshotCacheTTLMs) {
            this.screenshotCache.delete(cacheKey);
            this.stats.totalSizeBytes -= cached.size;
            this.stats.screenshotMisses++;
            return null;
        }

        this.stats.screenshotHits++;
        return cached.buffer;
    }

    /**
     * Set screenshot cache
     */
    setScreenshotCache(cacheKey, buffer) {
        const size = Buffer.byteLength(buffer);

        if (this.stats.totalSizeBytes + size > this.maxCacheSizeBytes) {
            this.evict();
        }

        const cached = { buffer, timestamp: Date.now(), size };
        this.screenshotCache.set(cacheKey, cached);
        this.stats.totalSizeBytes += size;
    }

    /**
     * Estimate size of object
     */
    estimateSize(obj) {
        if (Buffer.isBuffer(obj)) return obj.length;
        if (typeof obj === 'string') return obj.length * 2;
        if (typeof obj === 'object') {
            let size = 0;
            for (const key in obj) {
                size += key.length * 2 + this.estimateSize(obj[key]);
            }
            return size;
        }
        return 8; // Base size for primitives
    }

    /**
     * Evict least recently used entries
     */
    evict() {
        const allEntries = [
            ...Array.from(this.responseCache.entries()).map(([k, v]) => ({
                key: k,
                map: this.responseCache,
                timestamp: v.timestamp,
                size: v.size,
                type: 'response'
            })),
            ...Array.from(this.domCache.entries()).map(([k, v]) => ({
                key: k,
                map: this.domCache,
                timestamp: v.timestamp,
                size: v.size,
                type: 'dom'
            })),
            ...Array.from(this.screenshotCache.entries()).map(([k, v]) => ({
                key: k,
                map: this.screenshotCache,
                timestamp: v.timestamp,
                size: v.size,
                type: 'screenshot'
            }))
        ];

        // Sort by timestamp (LRU)
        allEntries.sort((a, b) => a.timestamp - b.timestamp);

        // Evict 10% of oldest
        const toEvict = Math.ceil(allEntries.length * 0.1);
        for (let i = 0; i < toEvict; i++) {
            const entry = allEntries[i];
            entry.map.delete(entry.key);
            this.stats.totalSizeBytes -= entry.size;
            this.stats.evictions++;
        }
    }

    /**
     * Remove expired entries
     */
    cleanup() {
        const now = Date.now();
        let cleaned = 0;

        // Response cache
        for (const [key, cached] of this.responseCache.entries()) {
            if (now - cached.timestamp > this.responseCacheTTLMs) {
                this.responseCache.delete(key);
                this.stats.totalSizeBytes -= cached.size;
                cleaned++;
            }
        }

        // DOM cache
        for (const [key, cached] of this.domCache.entries()) {
            if (now - cached.timestamp > this.domCacheTTLMs) {
                this.domCache.delete(key);
                this.stats.totalSizeBytes -= cached.size;
                cleaned++;
            }
        }

        // Screenshot cache
        for (const [key, cached] of this.screenshotCache.entries()) {
            if (now - cached.timestamp > this.screenshotCacheTTLMs) {
                this.screenshotCache.delete(key);
                this.stats.totalSizeBytes -= cached.size;
                cleaned++;
            }
        }

        if (cleaned > 0) {
            console.log(`[CacheManager] Cleaned up ${cleaned} expired entries`);
        }
    }

    /**
     * Get cache statistics
     */
    getStats() {
        return {
            ...this.stats,
            responseEntries: this.responseCache.size,
            domEntries: this.domCache.size,
            screenshotEntries: this.screenshotCache.size,
            totalEntries: this.responseCache.size + this.domCache.size + this.screenshotCache.size,
            hitRate: {
                response:
                    this.stats.responseHits /
                        (this.stats.responseHits + this.stats.responseMisses) || 0,
                dom: this.stats.domHits / (this.stats.domHits + this.stats.domMisses) || 0,
                screenshot:
                    this.stats.screenshotHits /
                        (this.stats.screenshotHits + this.stats.screenshotMisses) || 0
            }
        };
    }

    /**
     * Clear all caches
     */
    clear() {
        this.responseCache.clear();
        this.domCache.clear();
        this.screenshotCache.clear();
        this.stats.totalSizeBytes = 0;
    }

    /**
     * Shutdown
     */
    shutdown() {
        clearInterval(this.cleanupInterval);
        this.clear();
    }
}

module.exports = CacheManager;

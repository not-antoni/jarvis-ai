/**
 * Shared LRU Cache utility
 * Provides a consistent way to import LRUCache across the codebase
 */

const LruModule = require('lru-cache');

// Handle different lru-cache module export formats
function resolveLRUCache() {
    if (typeof LruModule === 'function') {
        return LruModule;
    }
    if (typeof LruModule?.LRUCache === 'function') {
        return LruModule.LRUCache;
    }
    if (typeof LruModule?.default === 'function') {
        return LruModule.default;
    }
    return null;
}

const LRUCache = resolveLRUCache();

if (!LRUCache) {
    throw new Error('Failed to load LRUCache constructor from lru-cache module');
}

module.exports = { LRUCache };

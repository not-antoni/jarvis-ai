/**
 * Unified Cache Manager
 * 
 * Provides consistent caching across Jarvis with standardized TTLs.
 * Uses LRU (Least Recently Used) eviction for memory efficiency.
 */

const { LRUCache } = require('lru-cache');

// Default TTLs (in milliseconds)
const TTL = {
    GUILD_CONFIG: 5 * 60 * 1000,    // 5 minutes
    USER_PROFILE: 60 * 60 * 1000,   // 1 hour
    AI_PROVIDER: 30 * 1000,          // 30 seconds
    COMMAND_COOLDOWN: 60 * 1000,    // 1 minute
    RATE_LIMIT: 60 * 1000,          // 1 minute
    MODERATION: 5 * 60 * 1000,      // 5 minutes
    ECONOMY: 30 * 1000,             // 30 seconds (balance changes frequently)
    SESSION: 24 * 60 * 60 * 1000,   // 24 hours
};

// Cache instances with size limits
const guildCache = new LRUCache({
    max: 500,           // Max 500 guilds
    ttl: TTL.GUILD_CONFIG,
    updateAgeOnGet: true,
    updateAgeOnHas: false,
});

const userCache = new LRUCache({
    max: 10000,         // Max 10k users
    ttl: TTL.USER_PROFILE,
    updateAgeOnGet: true,
    updateAgeOnHas: false,
});

const providerCache = new LRUCache({
    max: 50,            // Max 50 provider entries
    ttl: TTL.AI_PROVIDER,
    updateAgeOnGet: false,
    updateAgeOnHas: false,
});

const cooldownCache = new LRUCache({
    max: 50000,         // Max 50k cooldown entries
    ttl: TTL.COMMAND_COOLDOWN,
    updateAgeOnGet: false,
    updateAgeOnHas: false,
});

const rateLimitCache = new LRUCache({
    max: 10000,         // Max 10k rate limit entries
    ttl: TTL.RATE_LIMIT,
    updateAgeOnGet: false,
    updateAgeOnHas: false,
});

const moderationCache = new LRUCache({
    max: 1000,          // Max 1k moderation entries
    ttl: TTL.MODERATION,
    updateAgeOnGet: true,
    updateAgeOnHas: false,
});

const economyCache = new LRUCache({
    max: 5000,          // Max 5k economy entries
    ttl: TTL.ECONOMY,
    updateAgeOnGet: true,
    updateAgeOnHas: false,
});

const sessionCache = new LRUCache({
    max: 1000,          // Max 1k sessions
    ttl: TTL.SESSION,
    updateAgeOnGet: true,
    updateAgeOnHas: false,
});

/**
 * Get cache statistics
 */
function getStats() {
    return {
        guild: { size: guildCache.size, max: 500 },
        user: { size: userCache.size, max: 10000 },
        provider: { size: providerCache.size, max: 50 },
        cooldown: { size: cooldownCache.size, max: 50000 },
        rateLimit: { size: rateLimitCache.size, max: 10000 },
        moderation: { size: moderationCache.size, max: 1000 },
        economy: { size: economyCache.size, max: 5000 },
        session: { size: sessionCache.size, max: 1000 },
    };
}

/**
 * Clear all caches (for testing or reset)
 */
function clearAll() {
    guildCache.clear();
    userCache.clear();
    providerCache.clear();
    cooldownCache.clear();
    rateLimitCache.clear();
    moderationCache.clear();
    economyCache.clear();
    sessionCache.clear();
}

/**
 * Helper: Create a scoped cache key
 */
function scopedKey(scope, ...parts) {
    return `${scope}:${parts.join(':')}`;
}

/**
 * Rate limiting helper
 * @param {string} key - Unique key for rate limit (e.g., "user:123:chat")
 * @param {number} limit - Max requests allowed
 * @param {number} windowMs - Time window in milliseconds
 * @returns {Object} { allowed: boolean, remaining: number, resetMs: number }
 */
function checkRateLimit(key, limit, windowMs = TTL.RATE_LIMIT) {
    const now = Date.now();
    let entry = rateLimitCache.get(key);

    if (!entry || now - entry.windowStart >= windowMs) {
        // New window
        entry = { count: 1, windowStart: now };
        rateLimitCache.set(key, entry, { ttl: windowMs });
        return { allowed: true, remaining: limit - 1, resetMs: windowMs };
    }

    entry.count++;
    rateLimitCache.set(key, entry, { ttl: windowMs - (now - entry.windowStart) });

    const allowed = entry.count <= limit;
    const remaining = Math.max(0, limit - entry.count);
    const resetMs = windowMs - (now - entry.windowStart);

    return { allowed, remaining, resetMs };
}

/**
 * Cooldown helper
 * @param {string} key - Unique key (e.g., "cmd:daily:user123")
 * @param {number} cooldownMs - Cooldown duration
 * @returns {Object} { onCooldown: boolean, remainingMs: number }
 */
function checkCooldown(key, cooldownMs) {
    const existing = cooldownCache.get(key);
    const now = Date.now();

    if (existing) {
        const elapsed = now - existing;
        if (elapsed < cooldownMs) {
            return { onCooldown: true, remainingMs: cooldownMs - elapsed };
        }
    }

    return { onCooldown: false, remainingMs: 0 };
}

/**
 * Set cooldown
 * @param {string} key - Unique key
 * @param {number} cooldownMs - Cooldown duration (default: 1 minute)
 */
function setCooldown(key, cooldownMs = TTL.COMMAND_COOLDOWN) {
    cooldownCache.set(key, Date.now(), { ttl: cooldownMs });
}

module.exports = {
    // TTL constants
    TTL,

    // Cache instances
    guildCache,
    userCache,
    providerCache,
    cooldownCache,
    rateLimitCache,
    moderationCache,
    economyCache,
    sessionCache,

    // Helpers
    getStats,
    clearAll,
    scopedKey,
    checkRateLimit,
    checkCooldown,
    setCooldown,
};

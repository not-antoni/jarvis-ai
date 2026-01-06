/**
 * Disk-backed cache for guild configurations
 * Reduces MongoDB queries for frequently accessed guild settings
 */

const fs = require('fs');
const path = require('path');

const CACHE_FILE = path.join(__dirname, '../../data/guild-config-cache.json');
const MAX_ENTRIES = 500;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes (short TTL since configs can change)

let cache = {};
let lastSaveTime = 0;
const SAVE_DEBOUNCE_MS = 10000; // Only save every 10 seconds max

// Load cache from disk
function loadCache() {
    try {
        if (fs.existsSync(CACHE_FILE)) {
            const data = fs.readFileSync(CACHE_FILE, 'utf8');
            const parsed = JSON.parse(data);
            const now = Date.now();
            let loaded = 0;
            let expired = 0;

            for (const [guildId, entry] of Object.entries(parsed)) {
                if (now - (entry.cachedAt || 0) < CACHE_TTL_MS) {
                    cache[guildId] = entry;
                    loaded++;
                } else {
                    expired++;
                }
            }

            if (loaded > 0 || expired > 0) {
                console.log(`[GuildCache] Loaded ${loaded} guild configs, cleaned ${expired} expired`);
            }
        }
    } catch (e) {
        console.warn('[GuildCache] Failed to load cache:', e.message);
        cache = {};
    }
}

// Save cache to disk (debounced)
let saveTimeout = null;
function scheduleSave() {
    if (saveTimeout) return;

    const timeSinceLastSave = Date.now() - lastSaveTime;
    const delay = Math.max(0, SAVE_DEBOUNCE_MS - timeSinceLastSave);

    saveTimeout = setTimeout(() => {
        saveTimeout = null;
        saveCache();
    }, delay);
}

function saveCache() {
    try {
        const dir = path.dirname(CACHE_FILE);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 0));
        lastSaveTime = Date.now();
    } catch (e) {
        console.warn('[GuildCache] Failed to save cache:', e.message);
    }
}

// Get cached config (returns null if not cached or expired)
function get(guildId) {
    const entry = cache[guildId];
    if (!entry) return null;

    if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
        delete cache[guildId];
        return null;
    }

    return entry.config;
}

// Set cache entry
function set(guildId, config) {
    // Evict oldest if at capacity
    const keys = Object.keys(cache);
    if (keys.length >= MAX_ENTRIES) {
        // Sort by cachedAt and remove oldest 10%
        const sorted = keys.sort((a, b) => (cache[a].cachedAt || 0) - (cache[b].cachedAt || 0));
        const toRemove = Math.floor(MAX_ENTRIES * 0.1);
        sorted.slice(0, toRemove).forEach(k => delete cache[k]);
    }

    cache[guildId] = {
        config,
        cachedAt: Date.now()
    };

    scheduleSave();
}

// Invalidate cache entry (call when config is updated)
function invalidate(guildId) {
    if (cache[guildId]) {
        delete cache[guildId];
        scheduleSave();
    }
}

// Clear all cache
function clear() {
    cache = {};
    scheduleSave();
}

// Get cache stats
function getStats() {
    const keys = Object.keys(cache);
    const now = Date.now();
    let valid = 0;

    for (const key of keys) {
        if (now - (cache[key].cachedAt || 0) < CACHE_TTL_MS) {
            valid++;
        }
    }

    return {
        total: keys.length,
        valid,
        maxEntries: MAX_ENTRIES,
        ttlMs: CACHE_TTL_MS
    };
}

// Initialize on load
loadCache();

module.exports = {
    get,
    set,
    invalidate,
    clear,
    getStats
};

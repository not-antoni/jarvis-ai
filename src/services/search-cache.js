/**
 * Simple file-based cache for YouTube search results
 * Stores query -> URL mappings to skip API calls for repeated searches
 */

const fs = require('fs');
const path = require('path');

const CACHE_FILE = path.join(__dirname, '../../data/search-cache.json');
const MAX_ENTRIES = 1000; // Max cached searches (keeps file small)

let cache = {};

// Load cache from disk
function loadCache() {
    try {
        if (fs.existsSync(CACHE_FILE)) {
            const data = fs.readFileSync(CACHE_FILE, 'utf8');
            cache = JSON.parse(data);
            console.log(`[Cache] Loaded ${Object.keys(cache).length} cached searches`);
        }
    } catch (e) {
        console.warn('[Cache] Failed to load cache:', e.message);
        cache = {};
    }
}

// Save cache to disk (async to not block)
function saveCache() {
    try {
        const dir = path.dirname(CACHE_FILE);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
    } catch (e) {
        console.warn('[Cache] Failed to save cache:', e.message);
    }
}

// Normalize query for consistent cache keys
function normalizeQuery(query) {
    return query.toLowerCase().trim().replace(/\s+/g, ' ');
}

// Get cached result
function get(query) {
    const key = normalizeQuery(query);
    const entry = cache[key];
    if (entry) {
        console.log(`[Cache] HIT for: "${query}"`);
        return entry;
    }
    return null;
}

// Set cache entry
function set(query, result) {
    const key = normalizeQuery(query);

    // Evict oldest entries if cache is full
    const keys = Object.keys(cache);
    if (keys.length >= MAX_ENTRIES) {
        // Remove oldest 10% of entries
        const toRemove = Math.floor(MAX_ENTRIES * 0.1);
        keys.slice(0, toRemove).forEach(k => delete cache[k]);
        console.log(`[Cache] Evicted ${toRemove} old entries`);
    }

    cache[key] = {
        url: result.url,
        title: result.title,
        cachedAt: Date.now()
    };

    // Save async
    setImmediate(saveCache);
    console.log(`[Cache] Stored: "${query}" -> ${result.url}`);
}

// Initialize on load
loadCache();

module.exports = { get, set };

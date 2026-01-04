/**
 * Disk-based cache for SoundCloud track metadata
 * Stores URL -> track info to skip re-fetching recently played tracks
 */

const fs = require('fs');
const path = require('path');

const CACHE_FILE = path.join(__dirname, '../../data/soundcloud-cache.json');
const MAX_ENTRIES = 500; // Max cached tracks
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours (stream URLs expire)

let cache = {};

// Load cache from disk
function loadCache() {
    try {
        if (fs.existsSync(CACHE_FILE)) {
            const data = fs.readFileSync(CACHE_FILE, 'utf8');
            cache = JSON.parse(data);
            // Clean expired entries
            const now = Date.now();
            let cleaned = 0;
            for (const key of Object.keys(cache)) {
                if (now - (cache[key].cachedAt || 0) > CACHE_TTL_MS) {
                    delete cache[key];
                    cleaned++;
                }
            }
            if (cleaned > 0) {
                console.log(`[SC-Cache] Cleaned ${cleaned} expired entries`);
                saveCache();
            }
            console.log(`[SC-Cache] Loaded ${Object.keys(cache).length} cached tracks`);
        }
    } catch (e) {
        console.warn('[SC-Cache] Failed to load cache:', e.message);
        cache = {};
    }
}

// Save cache to disk
function saveCache() {
    try {
        const dir = path.dirname(CACHE_FILE);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
    } catch (e) {
        console.warn('[SC-Cache] Failed to save cache:', e.message);
    }
}

// Normalize URL for consistent cache keys
function normalizeUrl(url) {
    // Remove tracking params and normalize
    try {
        const u = new URL(url);
        return `${u.origin}${u.pathname}`.toLowerCase();
    } catch {
        return url.toLowerCase().trim();
    }
}

// Check if URL is a SoundCloud URL
function isSoundCloudUrl(url) {
    return url && url.includes('soundcloud.com');
}

// Get cached track info
function get(url) {
    if (!isSoundCloudUrl(url)) return null;

    const key = normalizeUrl(url);
    const entry = cache[key];

    if (entry) {
        // Check if still valid
        if (Date.now() - entry.cachedAt < CACHE_TTL_MS) {
            console.log(`[SC-Cache] HIT for: ${url}`);
            return entry;
        } else {
            // Expired
            delete cache[key];
        }
    }
    return null;
}

// Set cache entry
function set(url, info) {
    if (!isSoundCloudUrl(url)) return;

    const key = normalizeUrl(url);

    // Evict oldest entries if cache is full
    const keys = Object.keys(cache);
    if (keys.length >= MAX_ENTRIES) {
        // Sort by cachedAt and remove oldest 10%
        const sorted = keys.sort((a, b) => (cache[a].cachedAt || 0) - (cache[b].cachedAt || 0));
        const toRemove = Math.floor(MAX_ENTRIES * 0.1);
        sorted.slice(0, toRemove).forEach(k => delete cache[k]);
        console.log(`[SC-Cache] Evicted ${toRemove} old entries`);
    }

    cache[key] = {
        title: info.title || info.name,
        duration: info.duration,
        thumbnail: info.thumbnail,
        uploader: info.uploader || info.author,
        cachedAt: Date.now()
    };

    // Save async
    setImmediate(saveCache);
    console.log(`[SC-Cache] Stored: ${info.title || url}`);
}

// Initialize on load
loadCache();

module.exports = { get, set, isSoundCloudUrl };

const fs = require('fs');
const path = require('path');

function createDiskCache({ file, maxEntries, ttlMs, debounceMs = 10000 }) {
    let cache = {};
    let saveTimeout = null;
    let lastSaveTime = 0;

    try {
        if (fs.existsSync(file)) {
            const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
            const now = Date.now();
            for (const [key, value] of Object.entries(parsed)) {
                if (!ttlMs || now - (value.cachedAt || 0) < ttlMs) {
                    cache[key] = value;
                }
            }
        }
    } catch {
        cache = {};
    }

    function scheduleSave() {
        if (saveTimeout) {return;}
        const delay = Math.max(0, debounceMs - (Date.now() - lastSaveTime));
        saveTimeout = setTimeout(() => {
            saveTimeout = null;
            try {
                fs.mkdirSync(path.dirname(file), { recursive: true });
                fs.writeFileSync(file, JSON.stringify(cache, null, 0));
                lastSaveTime = Date.now();
            } catch {}
        }, delay);
    }

    return {
        get(key) {
            const entry = cache[key];
            if (!entry) {return null;}
            if (ttlMs && Date.now() - (entry.cachedAt || 0) > ttlMs) {
                delete cache[key];
                return null;
            }
            return entry;
        },
        set(key, value) {
            const keys = Object.keys(cache);
            if (keys.length >= maxEntries) {
                keys.sort((a, b) => (cache[a].cachedAt || 0) - (cache[b].cachedAt || 0))
                    .slice(0, Math.floor(maxEntries * 0.1))
                    .forEach(k => delete cache[k]);
            }
            cache[key] = { ...value, cachedAt: Date.now() };
            setImmediate(scheduleSave);
        },
        invalidate(key) {
            delete cache[key];
            setImmediate(scheduleSave);
        },
        clear() {
            cache = {};
            setImmediate(scheduleSave);
        }
    };
}

module.exports = { createDiskCache };

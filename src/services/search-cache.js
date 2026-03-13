const path = require('path');
const { createDiskCache } = require('../utils/disk-cache');

const cache = createDiskCache({
    file: path.join(__dirname, '../../data/search-cache.json'),
    maxEntries: 1000
});

function normalizeQuery(query) {
    return String(query || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

function get(query) {
    const key = normalizeQuery(query);
    return cache.get(key);
}

function set(query, result = {}) {
    const key = normalizeQuery(query);
    cache.set(key, {
        url: result.url || null,
        title: result.title || null,
        source: result.source || null
    });
}

module.exports = { get, set };

const path = require('path');
const { createDiskCache } = require('../utils/disk-cache');

const cache = createDiskCache({
    file: path.join(__dirname, '../../data/soundcloud-cache.json'),
    maxEntries: 500,
    ttlMs: 24 * 60 * 60 * 1000
});

function normalizeUrl(url) {
    try {
        const parsed = new URL(url);
        return `${parsed.origin}${parsed.pathname}`.toLowerCase();
    } catch {
        return String(url || '').toLowerCase().trim();
    }
}

function isSoundCloudUrl(url) {
    return url && String(url).includes('soundcloud.com');
}

function get(url) {
    if (!isSoundCloudUrl(url)) {return null;}
    const key = normalizeUrl(url);
    return cache.get(key);
}

function set(url, info = {}) {
    if (!isSoundCloudUrl(url)) {return;}
    const key = normalizeUrl(url);
    cache.set(key, {
        title: info.title || info.name || null,
        duration: info.duration || null,
        thumbnail: info.thumbnail || null,
        uploader: info.uploader || info.author || null
    });
}

module.exports = { get, set, isSoundCloudUrl };

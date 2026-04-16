'use strict';

let _byName = new Map();
let _byId = new Map();
let _ready = false;
let _refreshTimer = null;

function _formatEmoji(emoji) {
    if (!emoji) return '';
    const prefix = emoji.animated ? 'a' : '';
    return `<${prefix}:${emoji.name}:${emoji.id}>`;
}

function _index(collection) {
    _byName = new Map();
    _byId = new Map();
    if (!collection) return;
    const iterable = typeof collection.values === 'function' ? collection.values() : collection;
    for (const emoji of iterable) {
        if (!emoji?.name || !emoji.id) continue;
        _byName.set(emoji.name.toLowerCase(), emoji);
        _byId.set(emoji.id, emoji);
    }
}

async function init(client, { refreshIntervalMs = 30 * 60 * 1000 } = {}) {
    if (!client?.application) {
        console.warn('[AppEmojis] No client.application; skipping emoji fetch.');
        return;
    }
    try {
        if (!client.application.id) await client.application.fetch();
        const emojis = await client.application.emojis.fetch();
        _index(emojis);
        _ready = true;
        console.log(`[AppEmojis] Loaded ${_byName.size} application emojis.`);
    } catch (err) {
        console.warn('[AppEmojis] Initial fetch failed:', err.message);
    }

    if (_refreshTimer) clearInterval(_refreshTimer);
    if (refreshIntervalMs > 0) {
        _refreshTimer = setInterval(async() => {
            try {
                const emojis = await client.application.emojis.fetch();
                _index(emojis);
            } catch (err) {
                console.warn('[AppEmojis] Refresh failed:', err.message);
            }
        }, refreshIntervalMs);
        _refreshTimer.unref?.();
    }
}

function get(name, fallback = '') {
    if (!name) return fallback;
    const emoji = _byName.get(String(name).toLowerCase());
    return emoji ? _formatEmoji(emoji) : fallback;
}

function repeat(name, count, fallback = '') {
    const str = get(name, fallback);
    if (!str || count <= 0) return '';
    return str.repeat(count);
}

function raw(name) {
    if (!name) return null;
    return _byName.get(String(name).toLowerCase()) || null;
}

function has(name) {
    return _byName.has(String(name).toLowerCase());
}

function list() {
    return Array.from(_byName.values()).map(e => ({
        id: e.id,
        name: e.name,
        animated: Boolean(e.animated),
        formatted: _formatEmoji(e)
    }));
}

function isReady() { return _ready; }

module.exports = { init, get, repeat, raw, has, list, isReady };

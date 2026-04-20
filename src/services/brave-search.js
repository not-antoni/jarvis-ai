'use strict';

/**
 * Thin Brave Search API client with in-process caching.
 *
 * Docs: https://api.search.brave.com/app/documentation/web-search/get-started
 *
 * Env:
 *   BRAVE_SEARCH_API_KEY   required for live calls (otherwise client is inert)
 *   BRAVE_SEARCH_ENDPOINT  override base URL (default api.search.brave.com)
 *   BRAVE_SEARCH_COUNTRY   two-letter country code (default "us")
 *   BRAVE_SEARCH_TTL_MS    cache TTL in ms (default 5 minutes)
 */

const { LRUCache } = require('lru-cache');
const logger = require('../utils/logger');

const log = logger.child({ module: 'brave-search' });

const DEFAULT_ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';
const DEFAULT_TTL_MS = 5 * 60_000;

const cache = new LRUCache({
    max: 500,
    ttl: Number(process.env.BRAVE_SEARCH_TTL_MS) || DEFAULT_TTL_MS
});

function getApiKey() {
    // Accept both BRAVE_SEARCH_API_KEY (docs) and BRAVE_API_KEY (shorter alias)
    const key = (process.env.BRAVE_SEARCH_API_KEY || process.env.BRAVE_API_KEY || '').trim();
    return key || null;
}

function isConfigured() {
    return Boolean(getApiKey());
}

function normalizeQuery(query) {
    return String(query || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

async function search(query, { count = 5, signal = null } = {}) {
    const apiKey = getApiKey();
    if (!apiKey) {
        return { ok: false, reason: 'Brave Search API key not configured', results: [] };
    }
    const cleanQuery = String(query || '').trim();
    if (!cleanQuery) {
        return { ok: false, reason: 'Empty query', results: [] };
    }
    const cacheKey = `${normalizeQuery(cleanQuery)}::${count}`;
    const cached = cache.get(cacheKey);
    if (cached) {
        return { ok: true, cached: true, results: cached.results, query: cleanQuery };
    }
    const endpoint = (process.env.BRAVE_SEARCH_ENDPOINT || DEFAULT_ENDPOINT).replace(/\/$/, '');
    const url = new URL(endpoint);
    url.searchParams.set('q', cleanQuery);
    url.searchParams.set('count', String(Math.max(1, Math.min(count, 20))));
    url.searchParams.set('country', process.env.BRAVE_SEARCH_COUNTRY || 'us');
    url.searchParams.set('safesearch', 'moderate');

    try {
        const res = await fetch(url, {
            headers: {
                Accept: 'application/json',
                'X-Subscription-Token': apiKey,
                'User-Agent': 'JarvisAI/1.0 (+https://github.com/jarvis-ai)'
            },
            signal
        });
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            log.warn('Brave search API error', {
                status: res.status,
                body: body.slice(0, 200)
            });
            return { ok: false, reason: `Brave API returned ${res.status}`, results: [] };
        }
        const data = await res.json();
        const webResults = Array.isArray(data?.web?.results) ? data.web.results : [];
        const results = webResults.slice(0, count).map(item => ({
            title: item.title || '',
            url: item.url || '',
            description: item.description || '',
            age: item.age || null,
            source: item.meta_url?.netloc || item.profile?.name || null
        }));
        const payload = { results, fetchedAt: Date.now() };
        cache.set(cacheKey, payload);
        return { ok: true, cached: false, results, query: cleanQuery };
    } catch (error) {
        log.error('Brave search failed', { err: error, query: cleanQuery });
        return { ok: false, reason: error?.message || 'request failed', results: [] };
    }
}

/**
 * Heuristic: should a user's prompt trigger a web search?
 * Conservative — only triggers on clearly time-sensitive or factual lookup
 * phrasing. Returns a trimmed query suited for search, or null.
 */
function detectSearchIntent(prompt) {
    if (typeof prompt !== 'string') {return null;}
    const text = prompt.trim();
    if (text.length < 6 || text.length > 400) {return null;}

    const lower = text.toLowerCase();

    const triggers = [
        /\b(latest|current|recent|today|yesterday|this week|this month|right now|news)\b/,
        /\b(who won|who is winning|who is the|what is the latest|how much is|what's the price|stock price)\b/,
        /\b(release date|released on|when did|when will|upcoming|schedule|lineup)\b/,
        /\b(score|result|final score|standings|leaderboard)\b/,
        /\b20(2[5-9]|3\d)\b/, // any near-future year
        /\b(weather in|forecast for)\b/
    ];
    const matches = triggers.some(rx => rx.test(lower));
    if (!matches) {return null;}

    // Strip bot nicknames / polite filler to improve search quality
    return text
        .replace(/^(hey|hi|hello|yo|ok|okay|please|could you|can you|jarvis|j)[\s,:]+/i, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

module.exports = {
    search,
    isConfigured,
    detectSearchIntent,
    _cache: cache
};

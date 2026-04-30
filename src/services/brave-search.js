'use strict';

/**
 * Brave Search API client with in-process caching, query cleanup, retry logic,
 * lightweight relevance ranking, and media-aware search modes.
 *
 * Env:
 *   BRAVE_SEARCH_API_KEY   required for live calls (otherwise client is inert)
 *   BRAVE_API_KEY          alias for BRAVE_SEARCH_API_KEY
 *   BRAVE_ANSWERS_API_KEY   dedicated key for the Answers / chat endpoint
 *   BRAVE_SEARCH_ENDPOINT  override web search base URL (default api.search.brave.com)
 *   BRAVE_SEARCH_IMAGE_ENDPOINT override image search base URL
 *   BRAVE_LLM_CONTEXT_ENDPOINT override LLM context base URL
 *   BRAVE_ANSWERS_ENDPOINT override Answers / chat completions base URL
 *   BRAVE_SEARCH_COUNTRY   two-letter country code (default "us")
 *   BRAVE_SEARCH_TTL_MS    cache TTL in ms (default 5 minutes)
 */

const { LRUCache } = require('lru-cache');
const logger = require('../utils/logger');

const log = logger.child({ module: 'brave-search' });

const DEFAULT_WEB_ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';
const DEFAULT_IMAGE_ENDPOINT = 'https://api.search.brave.com/res/v1/images/search';
const DEFAULT_LLM_CONTEXT_ENDPOINT = 'https://api.search.brave.com/res/v1/llm/context';
const DEFAULT_ANSWERS_ENDPOINT = 'https://api.search.brave.com/res/v1/chat/completions';
const DEFAULT_TTL_MS = 5 * 60_000;
const DEFAULT_COUNT = 5;
const MAX_WEB_COUNT = 10;
const MAX_IMAGE_COUNT = 20;
const REQUEST_TIMEOUT_MS = Number(process.env.BRAVE_SEARCH_TIMEOUT_MS) || 5000;
const RETRY_DELAY_MS = Number(process.env.BRAVE_SEARCH_RETRY_DELAY_MS) || 250;

const VALID_SAFESEARCH = new Set(['off', 'moderate', 'strict']);
function resolveSafesearch(scope) {
    const envKey = scope === 'image' ? 'BRAVE_IMAGE_SAFESEARCH' : 'BRAVE_SAFESEARCH';
    const value = String(process.env[envKey] || process.env.BRAVE_SAFESEARCH || 'strict')
        .toLowerCase()
        .trim();
    return VALID_SAFESEARCH.has(value) ? value : 'strict';
}

const cache = new LRUCache({
    max: 500,
    ttl: Number(process.env.BRAVE_SEARCH_TTL_MS) || DEFAULT_TTL_MS
});

const STOP_WORDS = new Set([
    'a','an','the','is','are','was','were','be','been','am','do','does','did',
    'will','would','could','should','shall','can','may','might','must',
    'i','me','my','you','your','he','she','it','we','they','them','his','her',
    'its','our','their','this','that','these','those','what','which','who','how','when','where',
    'why','not','no','and','or','but','if','so','to','of','in','on','at','for','with',
    'from','by','as','up','out','about','into','over','under','after','before','between',
    'has','have','had','just','very','really','like','know','think','want','tell','say',
    'said','get','got','go','went','make','made','take','see','come','let','please',
    'jarvis','garmin','sir','hey','hi','hello','yo','ok','okay','pls','search','web'
]);

const GIF_HINTS = /(\bgifs?\b|tenor|giphy|animated gif|reaction gif|looping gif)/i;
const IMAGE_HINTS = /(\bimages?\b|\bphotos?\b|\bpictures?\b|\bwallpapers?\b|\bavatars?\b|\bicons?\b|\bmemes?\b|\bstickers?\b|\bart\b)/i;
const VIDEO_HINTS = /(\bvideos?\b|\bclips?\b|\btrailers?\b|youtube|tiktok|\breels?\b)/i;
const CURRENT_HINTS = /\b(?:latest|current|currently|recent|recently|today|tonight|tomorrow|yesterday|right now|now|breaking|news|update[ds]?|trending|live|happening|since|so far|to date|over time|so-far|earliest|oldest|biggest|smallest|first|last|highest|lowest|cheapest|fastest|best|worst|top|leading|trailing|forecast|prediction|outlook|score|scores|standings|results?|stats?|statistics|record|records|prices?|costs?|rates?|quotes?|values?|worth|exchange|conversion|translate)\b/i;
const YEAR_HINT = /\b(19|20|21)\d{2}\b/;
const PROPER_NOUN_HINT = /\b[A-Z][a-zA-Z0-9_]{2,}(?:\s+[A-Z][a-zA-Z0-9_]+){0,3}\b/;
const MEME_HINTS = /\b(?:skibidi|rizz(?:ing)?|gyatt|sigma|slay|based|cringe|poggers|bussin|fr\s?fr|no\s?cap|lowkey|highkey|ratio|mid|sus|yeet|sheesh|npc|oomf|hits\s+different|it's?\s+giving|rent\s+free|main\s+character|touch\s+grass|skill\s+issue|cope|seethe|mald|glazing|brainrot|ick|delulu|situationship|roman\s+empire|girl\s+dinner|unalived|ate\s+that|left\s+no\s+crumbs|real\s+and\s+true|fanum\s+tax|mewing|looksmax(?:xing)?|aura|crash\s*out|yap(?:per|ping)?|let\s*him\s*cook|stand\s*proud|domain\s*expansion|goon(?:ing)?|edging|demure|brat|unc|pookie|lock(?:ed)?\s*in|cooked|washed|tweaking|mog(?:ging)?|kino|peak|schizo|bop|ohio|blud|type\s*shit|freaky|bet|chat|is\s*bro|bro\s*really|catching\s*strays|fraud)\b/i;

function looksLikeMemeFragment(text) {
    const words = tokenize(text);
    if (words.length < 2 || words.length > 7) { return false; }
    const contentWords = words.filter(w => !STOP_WORDS.has(w));
    if (contentWords.length === 0) { return false; }
    if (/^(who|what|when|where|why|how|which|is|are|was|were|do|does|did)\b/i.test(text)) { return false; }
    if (/^(hi|hey|hello|yo|sup|wassup|howdy|good\s+(morning|evening|night|afternoon))/i.test(text.trim())) { return false; }
    return true;
}

function getApiKey() {
    const key = (process.env.BRAVE_SEARCH_API_KEY || process.env.BRAVE_API_KEY || '').trim();
    return key || null;
}

function getAnswersApiKey() {
    return (process.env.BRAVE_ANSWERS_API_KEY || '').trim() || null;
}

function isConfigured() {
    return Boolean(getApiKey());
}

function normalizeQuery(query) {
    return String(query || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeWhitespace(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
}

function stripNoiseFromPrompt(text) {
    return String(text || '')
        .trim()
        .replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, '')
        .replace(/^(hey|hi|hello|yo|ok|okay|please|pls|can you|could you|would you|will you|jarvis|garmin|sir)[\s,:-]+/i, '')
        .replace(/ (can you|could you|would you|please|pls|kindly) /gi, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

function tokenize(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(Boolean);
}

function buildKeywordSet(text) {
    return new Set(tokenize(text).filter(token => token.length > 2 && !STOP_WORDS.has(token)));
}

function countWords(text) {
    return tokenize(text).length;
}

function hostFromUrl(url) {
    try {
        return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
    } catch {
        return '';
    }
}

function sanitizeUrl(url) {
    try {
        const parsed = new URL(url);
        parsed.hash = '';
        for (const key of [...parsed.searchParams.keys()]) {
            if (/^(utm_|fbclid$|gclid$|yclid$|ref$|ref_src$|spm$)/i.test(key)) {
                parsed.searchParams.delete(key);
            }
        }
        return parsed.toString();
    } catch {
        return String(url || '').trim();
    }
}

function sourceFromResult(item) {
    const source = item?.meta_url?.netloc || item?.profile?.name || item?.source || item?.publisher || null;
    if (typeof source === 'string') { return source; }
    return source?.name || source?.url || null;
}

function extractUrlCandidate(value) {
    if (!value) { return null; }
    if (typeof value === 'string') { return sanitizeUrl(value); }
    if (typeof value === 'object') {
        return sanitizeUrl(
            value.url || value.src || value.link || value.href || value.original || value.original_url || value.originalUrl || ''
        );
    }
    return null;
}

function extractImageUrl(item) {
    const candidates = [
        item?.image?.url,
        item?.imageUrl,
        item?.image_url,
        item?.thumbnail?.url,
        item?.thumbnailUrl,
        item?.thumbnail_url,
        item?.properties?.url,
        item?.properties?.image,
        item?.properties?.original,
        item?.properties?.original_url,
        item?.properties?.originalUrl,
        item?.original?.url,
        item?.originalUrl,
        item?.original_url,
        item?.url,
        item?.source?.url,
        item?.media?.url
    ];

    for (const candidate of candidates) {
        const url = extractUrlCandidate(candidate);
        if (url) { return url; }
    }

    return null;
}

function extractThumbnailUrl(item) {
    const candidates = [
        item?.thumbnail?.url,
        item?.thumbnailUrl,
        item?.thumbnail_url,
        item?.thumbnail,
        item?.properties?.placeholder,
        item?.properties?.thumbnail,
        item?.properties?.thumbnailUrl,
        item?.image?.thumbnail,
        item?.image?.thumbnailUrl
    ];

    for (const candidate of candidates) {
        const url = extractUrlCandidate(candidate);
        if (url) { return url; }
    }

    return null;
}

function isGifUrl(url) {
    return /\.gif(\?|$)/i.test(url || '') || /media\.tenor\.com/i.test(url || '') || /giphy\.com/i.test(url || '');
}

function rewriteSearchQuery(prompt, { mode = 'web', forceGif = false } = {}) {
    const cleaned = stripNoiseFromPrompt(prompt);
    if (!cleaned) { return null; }

    let query = cleaned
        .replace(/^((what|who|when|where|why|how)('?s| is| are| was| were)?\s+)/i, '')
        .replace(/^(find|search for|look up|lookup|google|brave search|web search|search the web)\s+/i, '')
        .replace(/\?$|\s+\?$/g, '')
        .replace(/ (please|thanks|thank you) /gi, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();

    if (!query) {
        query = cleaned;
    }

    if (mode === 'image' && forceGif && !GIF_HINTS.test(query)) {
        query = `${query} gif`;
    }

    const terms = tokenize(query).filter(token => token.length > 2 && !STOP_WORDS.has(token));
    if (terms.length >= 3) {
        const compressed = terms.join(' ');
        if (compressed.length < query.length * 0.9) {
            query = compressed;
        }
    }

    const trimmedWords = tokenize(query).slice(0, 18).join(' ');
    return normalizeWhitespace(trimmedWords).slice(0, 180) || null;
}

function detectSearchPlan(prompt) {
    if (typeof prompt !== 'string') { return null; }
    const text = prompt.trim();
    if (text.length < 4 || text.length > 500) { return null; }

    const lower = text.toLowerCase();
    const gifIntent = GIF_HINTS.test(lower);
    const imageIntent = gifIntent || IMAGE_HINTS.test(lower);
    const videoIntent = VIDEO_HINTS.test(lower);
    const yearIntent = YEAR_HINT.test(text);
    const currentIntent = CURRENT_HINTS.test(lower) || yearIntent;
    const memeIntent = MEME_HINTS.test(lower) || looksLikeMemeFragment(text);
    const startsWithQuestion = /^(who|what|when|where|why|how|which)\b/i.test(text);
    const contentTokens = tokenize(text).filter(tok => !STOP_WORDS.has(tok));
    const questionLike = startsWithQuestion && (text.includes('?') || contentTokens.length >= 3);
    const phraseLooksLookup = /\b(?:means|definition of|meaning of|price of|value of|status of|how many|how much|how old|how tall)\b/i.test(lower);
    const explicitSearch = /(?:^|\s)(?:search|google|bing|lookup|look\s+(?:it|that|this)?\s*up|find\s+(?:me\s+)?(?:info|out|about|on)|brave\s*search|web\s*search|search\s*the\s*web|research)\b/i.test(lower);
    const properNounLookup = startsWithQuestion && PROPER_NOUN_HINT.test(text);

    if (!explicitSearch && !questionLike && !phraseLooksLookup && !currentIntent && !imageIntent && !videoIntent && !properNounLookup && !memeIntent) {
        return null;
    }

    const mode = imageIntent ? 'image' : 'web';
    const query = memeIntent && !explicitSearch
        ? `${rewriteSearchQuery(text, { mode: 'web' }) || text} meme`
        : rewriteSearchQuery(text, { mode, forceGif: gifIntent });

    if (!query) { return null; }

    return {
        mode,
        query,
        originalQuery: text,
        gifIntent,
        imageIntent,
        videoIntent,
        currentIntent,
        yearIntent,
        memeIntent
    };
}

function detectSearchIntent(prompt) {
    const plan = detectSearchPlan(prompt);
    if (!plan) { return null; }
    const cleaned = stripNoiseFromPrompt(plan.originalQuery);
    return cleaned || plan.originalQuery;
}

function relevanceScore(result, queryTerms, exactQuery, { gifIntent = false } = {}) {
    const haystack = `${result.title || ''} ${result.description || ''} ${result.source || ''} ${result.url || ''}`.toLowerCase();
    let score = 0;

    if (exactQuery && (result.title || '').toLowerCase().includes(exactQuery.toLowerCase())) {
        score += 4;
    }

    for (const term of queryTerms) {
        if (haystack.includes(term)) { score += 1.5; }
        if ((result.title || '').toLowerCase().includes(term)) { score += 1; }
    }

    if (result.age) { score -= 0.25; }
    if (result.source) { score += 0.2; }
    if (/^(reddit|x|twitter|facebook|tiktok)$/i.test(result.source || '')) { score -= 0.5; }

    if (gifIntent) {
        const url = `${result.url || ''} ${result.mediaUrl || ''} ${result.thumbnail || ''}`.toLowerCase();
        if (isGifUrl(url)) { score += 5; }
        if (/tenor\.com|giphy\.com/i.test(url)) { score += 2.5; }
        if (/reaction|loop|animated|animation|gif/i.test(haystack)) { score += 1; }
    }

    return score;
}

function dedupeAndRankWeb(results, query) {
    const queryTerms = [...buildKeywordSet(query)];
    const exactQuery = normalizeQuery(query);
    const seen = new Set();
    const normalized = [];

    for (const item of results) {
        const url = sanitizeUrl(item?.url || '');
        if (!url || seen.has(url)) { continue; }
        seen.add(url);

        const normalizedItem = {
            kind: 'web',
            title: normalizeWhitespace(item?.title || ''),
            url,
            description: normalizeWhitespace(item?.description || ''),
            age: item?.age || null,
            source: sourceFromResult(item) || hostFromUrl(url),
            score: 0
        };
        normalizedItem.score = relevanceScore(normalizedItem, queryTerms, exactQuery);
        normalized.push(normalizedItem);
    }

    normalized.sort((a, b) => {
        if (b.score !== a.score) { return b.score - a.score; }
        if ((b.title || '').length !== (a.title || '').length) {
            return (a.title || '').length - (b.title || '').length;
        }
        return (a.title || '').localeCompare(b.title || '');
    });

    return normalized;
}

function dedupeAndRankImages(results, query, { gifIntent = false } = {}) {
    const queryTerms = [...buildKeywordSet(query)];
    const exactQuery = normalizeQuery(query);
    const seen = new Set();
    const normalized = [];

    for (const item of results) {
        const mediaUrl = sanitizeUrl(extractImageUrl(item) || item?.url || '');
        const pageUrl = sanitizeUrl(item?.pageUrl || item?.sourceUrl || item?.source?.url || item?.url || '');
        const uniqueKey = mediaUrl || pageUrl;
        if (!uniqueKey || seen.has(uniqueKey)) { continue; }
        seen.add(uniqueKey);

        const thumbnail = extractThumbnailUrl(item);
        const normalizedItem = {
            kind: 'image',
            title: normalizeWhitespace(item?.title || item?.name || item?.alt || ''),
            url: mediaUrl || pageUrl,
            mediaUrl,
            pageUrl,
            thumbnail,
            description: normalizeWhitespace(item?.description || item?.snippet || item?.source || ''),
            source: sourceFromResult(item) || hostFromUrl(pageUrl || mediaUrl),
            width: item?.properties?.width || item?.width || null,
            height: item?.properties?.height || item?.height || null,
            score: 0
        };
        normalizedItem.score = relevanceScore(normalizedItem, queryTerms, exactQuery, { gifIntent });
        normalized.push(normalizedItem);
    }

    normalized.sort((a, b) => {
        if (b.score !== a.score) { return b.score - a.score; }
        if (b.mediaUrl && !a.mediaUrl) { return 1; }
        if (a.mediaUrl && !b.mediaUrl) { return -1; }
        if ((b.title || '').length !== (a.title || '').length) {
            return (a.title || '').length - (b.title || '').length;
        }
        return (a.title || '').localeCompare(b.title || '');
    });

    return normalized;
}

function getRetryAfterMs(response) {
    const raw = response?.headers?.get?.('retry-after');
    if (!raw) { return 0; }

    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds > 0) {
        return seconds * 1000;
    }

    const dateMs = Date.parse(raw);
    if (Number.isFinite(dateMs)) {
        return Math.max(0, dateMs - Date.now());
    }

    return 0;
}

async function fetchWithRetry(url, { signal = null, headers = {}, retries = 2 } = {}) {
    let lastError = null;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(new Error('request timeout')), REQUEST_TIMEOUT_MS);
        const onAbort = () => controller.abort(signal?.reason || new Error('request aborted'));

        try {
            if (signal) {
                if (signal.aborted) {
                    throw new Error('request aborted');
                }
                signal.addEventListener('abort', onAbort, { once: true });
            }

            const res = await fetch(url, {
                headers,
                signal: controller.signal
            });

            if (signal) {
                signal.removeEventListener('abort', onAbort);
            }
            clearTimeout(timeout);

            if (res.ok) {
                return res;
            }

            const body = await res.text().catch(() => '');
            const retryable = [408, 429, 500, 502, 503, 504].includes(res.status);
            lastError = new Error(`Brave API returned ${res.status}`);
            lastError.status = res.status;
            lastError.body = body.slice(0, 200);

            if (!retryable || attempt >= retries) {
                return res;
            }

            const retryAfterMs = getRetryAfterMs(res);
            const delay = retryAfterMs > 0 ? retryAfterMs : RETRY_DELAY_MS * (attempt + 1);
            await new Promise(resolve => setTimeout(resolve, delay));
        } catch (error) {
            if (signal) {
                signal.removeEventListener('abort', onAbort);
            }
            clearTimeout(timeout);
            lastError = error;
            if (attempt >= retries) {
                throw error;
            }
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * (attempt + 1)));
        }
    }

    throw lastError || new Error('request failed');
}

async function searchWeb(query, { count = DEFAULT_COUNT, signal = null, freshness = null } = {}) {
    const apiKey = getApiKey();
    if (!apiKey) {
        return { ok: false, reason: 'Brave Search API key not configured', results: [] };
    }

    const cleanQuery = String(query || '').trim();
    if (!cleanQuery) {
        return { ok: false, reason: 'Empty query', results: [] };
    }

    const safeCount = Math.max(1, Math.min(Number(count) || DEFAULT_COUNT, MAX_WEB_COUNT));
    const cacheKey = `web::${normalizeQuery(cleanQuery)}::${safeCount}::${process.env.BRAVE_SEARCH_COUNTRY || 'us'}::${freshness || ''}`;
    const cached = cache.get(cacheKey);
    if (cached) {
        return { ok: true, cached: true, ...cached };
    }

    const endpoint = (process.env.BRAVE_SEARCH_ENDPOINT || DEFAULT_WEB_ENDPOINT).replace(/\/$/, '');
    const rewrittenQuery = rewriteSearchQuery(cleanQuery, { mode: 'web' }) || cleanQuery;
    const url = new URL(endpoint);
    url.searchParams.set('q', rewrittenQuery);
    url.searchParams.set('count', String(safeCount));
    url.searchParams.set('country', process.env.BRAVE_SEARCH_COUNTRY || 'us');
    url.searchParams.set('safesearch', resolveSafesearch('web'));
    url.searchParams.set('spellcheck', 'true');
    if (freshness && /^(pd|pw|pm|py)$/i.test(freshness)) {
        url.searchParams.set('freshness', String(freshness).toLowerCase());
    }

    try {
        const res = await fetchWithRetry(url, {
            headers: {
                Accept: 'application/json',
                'Cache-Control': 'no-cache',
                'X-Subscription-Token': apiKey,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/103.0.0.0 Safari/537.36'
            },
            signal,
            retries: 2
        });

        if (!res.ok) {
            const body = await res.text().catch(() => '');
            log.warn('Brave web search API error', {
                status: res.status,
                body: body.slice(0, 200),
                query: rewrittenQuery
            });
            return { ok: false, reason: `Brave API returned ${res.status}`, results: [] };
        }

        const data = await res.json();
        const webResults = Array.isArray(data?.web?.results) ? data.web.results : Array.isArray(data?.results) ? data.results : [];
        const ranked = dedupeAndRankWeb(webResults, rewrittenQuery).slice(0, safeCount);
        const results = ranked.map(item => ({
            kind: 'web',
            title: item.title,
            url: item.url,
            description: item.description,
            age: item.age,
            source: item.source
        }));

        const totalResults = Number(data?.web?.total) || Number(data?.total) || webResults.length;
        const payload = {
            ok: true,
            cached: false,
            mode: 'web',
            results,
            query: cleanQuery,
            rewrittenQuery,
            totalResults
        };
        cache.set(cacheKey, payload);
        return payload;
    } catch (error) {
        log.error('Brave web search failed', { err: error, query: rewrittenQuery });
        return { ok: false, reason: error?.message || 'request failed', results: [] };
    }
}

async function searchImages(query, { count = 12, signal = null, gifIntent = false } = {}) {
    const apiKey = getApiKey();
    if (!apiKey) {
        return { ok: false, reason: 'Brave Search API key not configured', results: [] };
    }

    const cleanQuery = String(query || '').trim();
    if (!cleanQuery) {
        return { ok: false, reason: 'Empty query', results: [] };
    }

    const safeCount = Math.max(1, Math.min(Number(count) || 12, MAX_IMAGE_COUNT));
    const cacheKey = `image::${gifIntent ? 'gif:' : ''}${normalizeQuery(cleanQuery)}::${safeCount}::${process.env.BRAVE_SEARCH_COUNTRY || 'us'}`;
    const cached = cache.get(cacheKey);
    if (cached) {
        return { ok: true, cached: true, ...cached };
    }

    const endpoint = (process.env.BRAVE_SEARCH_IMAGE_ENDPOINT || DEFAULT_IMAGE_ENDPOINT).replace(/\/$/, '');
    const rewrittenQuery = rewriteSearchQuery(cleanQuery, { mode: 'image', forceGif: gifIntent }) || cleanQuery;
    const url = new URL(endpoint);
    url.searchParams.set('q', rewrittenQuery);
    url.searchParams.set('count', String(safeCount));
    url.searchParams.set('country', process.env.BRAVE_SEARCH_COUNTRY || 'us');
    url.searchParams.set('safesearch', resolveSafesearch('image'));
    url.searchParams.set('spellcheck', 'true');

    try {
        const res = await fetchWithRetry(url, {
            headers: {
                Accept: 'application/json',
                'Cache-Control': 'no-cache',
                'X-Subscription-Token': apiKey,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/103.0.0.0 Safari/537.36'
            },
            signal,
            retries: 2
        });

        if (!res.ok) {
            const body = await res.text().catch(() => '');
            log.warn('Brave image search API error', {
                status: res.status,
                body: body.slice(0, 200),
                query: rewrittenQuery
            });
            return { ok: false, reason: `Brave API returned ${res.status}`, results: [] };
        }

        const data = await res.json();
        const rawResults = Array.isArray(data?.results)
            ? data.results
            : Array.isArray(data?.images?.results)
                ? data.images.results
                : Array.isArray(data?.image?.results)
                    ? data.image.results
                    : [];

        const ranked = dedupeAndRankImages(rawResults, rewrittenQuery, { gifIntent }).slice(0, safeCount);
        const results = ranked.map(item => ({
            kind: 'image',
            title: item.title,
            url: item.url,
            mediaUrl: item.mediaUrl,
            pageUrl: item.pageUrl,
            thumbnail: item.thumbnail,
            description: item.description,
            source: item.source,
            width: item.width,
            height: item.height
        }));

        const totalResults = Number(data?.extra?.total) || Number(data?.total) || rawResults.length;
        const payload = {
            ok: true,
            cached: false,
            mode: 'image',
            results,
            query: cleanQuery,
            rewrittenQuery,
            totalResults,
            gifIntent
        };
        cache.set(cacheKey, payload);
        return payload;
    } catch (error) {
        log.error('Brave image search failed', { err: error, query: rewrittenQuery });
        return { ok: false, reason: error?.message || 'request failed', results: [] };
    }
}

async function searchLLMContext(query, { count = 5, signal = null } = {}) {
    const apiKey = getApiKey();
    if (!apiKey) {
        return { ok: false, reason: 'Search API key not configured', results: [] };
    }

    const cleanQuery = String(query || '').trim();
    if (!cleanQuery) {
        return { ok: false, reason: 'Empty query', results: [] };
    }

    const safeCount = Math.max(1, Math.min(Number(count) || 5, MAX_WEB_COUNT));
    const cacheKey = `llm-context::${normalizeQuery(cleanQuery)}::${safeCount}::${process.env.BRAVE_SEARCH_COUNTRY || 'us'}`;
    const cached = cache.get(cacheKey);
    if (cached) {
        return { ok: true, cached: true, ...cached };
    }

    const endpoint = (process.env.BRAVE_LLM_CONTEXT_ENDPOINT || DEFAULT_LLM_CONTEXT_ENDPOINT).replace(/\/$/, '');
    const rewrittenQuery = rewriteSearchQuery(cleanQuery, { mode: 'web' }) || cleanQuery;
    const url = new URL(endpoint);
    url.searchParams.set('q', rewrittenQuery);
    url.searchParams.set('count', String(safeCount));
    url.searchParams.set('country', process.env.BRAVE_SEARCH_COUNTRY || 'us');
    url.searchParams.set('safesearch', resolveSafesearch('web'));
    url.searchParams.set('spellcheck', 'true');

    try {
        const res = await fetchWithRetry(url, {
            headers: {
                Accept: 'application/json',
                'Cache-Control': 'no-cache',
                'X-Subscription-Token': apiKey,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/103.0.0.0 Safari/537.36'
            },
            signal,
            retries: 2
        });

        if (!res.ok) {
            const body = await res.text().catch(() => '');
            log.warn('Brave LLM context search API error', {
                status: res.status,
                body: body.slice(0, 200),
                query: rewrittenQuery
            });
            return { ok: false, reason: `Brave API returned ${res.status}`, results: [] };
        }

        const data = await res.json();
        const grounding = Array.isArray(data?.grounding?.generic)
            ? data.grounding.generic
            : Array.isArray(data?.grounding)
                ? data.grounding
                : [];

        const results = grounding.slice(0, safeCount).map(item => ({
            kind: 'llm_context',
            title: normalizeWhitespace(item?.title || item?.name || ''),
            url: sanitizeUrl(item?.url || item?.link || item?.sourceUrl || ''),
            description: normalizeWhitespace(item?.snippet || item?.description || item?.content || ''),
            source: normalizeWhitespace(item?.source || item?.publisher || item?.domain || ''),
            raw: item
        }));

        const payload = {
            ok: true,
            cached: false,
            mode: 'llm_context',
            results,
            query: cleanQuery,
            rewrittenQuery,
            totalResults: grounding.length
        };
        cache.set(cacheKey, payload);
        return payload;
    } catch (error) {
        log.error('Brave LLM context search failed', { err: error, query: rewrittenQuery });
        return { ok: false, reason: error?.message || 'request failed', results: [] };
    }
}

async function getBraveAnswer(prompt, { signal = null } = {}) {
    const apiKey = getAnswersApiKey();
    if (!apiKey) {
        return { ok: false, answer: null };
    }

    const cleanPrompt = String(prompt || '').trim();
    if (!cleanPrompt) {
        return { ok: false, answer: null };
    }

    const endpoint = (process.env.BRAVE_ANSWERS_ENDPOINT || DEFAULT_ANSWERS_ENDPOINT).replace(/\/$/, '');

    try {
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Subscription-Token': apiKey,
                'Accept': 'application/json'
            },
            body: JSON.stringify({
                messages: [{ role: 'user', content: cleanPrompt }]
            }),
            signal
        });

        if (!res.ok) {
            const body = await res.text().catch(() => '');
            log.warn('Brave Answers API error', {
                status: res.status,
                body: body.slice(0, 200)
            });
            return { ok: false, answer: null };
        }

        const data = await res.json();
        const answer = data?.choices?.[0]?.message?.content || null;
        return {
            ok: true,
            answer
        };
    } catch (error) {
        log.error('Brave Answers API failed', { err: error });
        return { ok: false, answer: null };
    }
}

function pickFreshness(plan, prompt) {
    if (!plan) { return null; }
    const lower = String(prompt || '').toLowerCase();
    if (/today|tonight|right now|breaking|live|happening now/i.test(lower)) { return 'pd'; }
    if (/this week|recent|latest|current|news|update/i.test(lower)) { return 'pw'; }
    if (plan.currentIntent) { return 'pm'; }
    if (plan.yearIntent) { return 'py'; }
    return null;
}

async function search(query, { count = DEFAULT_COUNT, signal = null, mode = 'auto', freshness = null } = {}) {
    const cleanQuery = String(query || '').trim();
    if (!cleanQuery) {
        return { ok: false, reason: 'Empty query', results: [] };
    }

    const plan = mode === 'auto'
        ? detectSearchPlan(cleanQuery)
        : {
            mode,
            query: rewriteSearchQuery(cleanQuery, { mode: mode === 'image' ? 'image' : 'web', forceGif: mode === 'image' && GIF_HINTS.test(cleanQuery) }) || cleanQuery,
            gifIntent: GIF_HINTS.test(cleanQuery)
        };

    const chosenMode = plan?.mode || 'web';
    if (chosenMode === 'image') {
        return searchImages(plan.query || cleanQuery, { count, signal, gifIntent: Boolean(plan.gifIntent) });
    }

    const effectiveFreshness = freshness || pickFreshness(plan, cleanQuery);
    return searchWeb(plan.query || cleanQuery, { count, signal, freshness: effectiveFreshness });
}

async function searchByIntent(prompt, options = {}) {
    const plan = detectSearchPlan(prompt);
    if (!plan) {
        return { ok: false, reason: 'No searchable intent detected', results: [] };
    }

    return search(plan.query, {
        ...options,
        mode: plan.mode,
        freshness: options.freshness || pickFreshness(plan, prompt)
    });
}

module.exports = {
    search,
    searchByIntent,
    searchWeb,
    searchImages,
    searchLLMContext,
    getBraveAnswer,
    getAnswersApiKey,
    isConfigured,
    detectSearchIntent,
    detectSearchPlan,
    rewriteSearchQuery,
    _cache: cache,
    _extractImageUrl: extractImageUrl,
    _extractThumbnailUrl: extractThumbnailUrl,
    _isGifUrl: isGifUrl
};

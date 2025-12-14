'use strict';

function parseCsv(value) {
    return String(value || '')
        .split(',')
        .map(entry => entry.trim())
        .filter(Boolean);
}

function normalizeProxyBase(value) {
    const url = new URL(value);
    url.hash = '';
    url.search = '';
    url.username = '';
    url.password = '';

    const pathname = url.pathname && url.pathname !== '/' ? url.pathname.replace(/\/+$/, '') : '';
    url.pathname = pathname ? `${pathname}/` : '/';

    return url.toString().replace(/\/+$/, '/');
}

function isLikelyPrivateHostname(hostname) {
    const lowered = String(hostname || '').trim().toLowerCase();

    if (!lowered) return true;

    if (lowered === 'localhost') return true;
    if (lowered.endsWith('.local')) return true;

    if (/^\d+\.\d+\.\d+\.\d+$/.test(lowered)) {
        const parts = lowered.split('.').map(v => Number(v));
        if (parts.length === 4 && parts.every(n => Number.isFinite(n) && n >= 0 && n <= 255)) {
            const [a, b] = parts;
            if (a === 10) return true;
            if (a === 127) return true;
            if (a === 192 && b === 168) return true;
            if (a === 172 && b >= 16 && b <= 31) return true;
            if (a === 169 && b === 254) return true;
        }
    }

    return false;
}

class ProxyRotator {
    constructor(urls, strategy) {
        this.urls = Array.isArray(urls) ? urls.slice() : [];
        this.strategy = String(strategy || 'round_robin').toLowerCase();
        this.index = 0;
    }

    pick() {
        if (!this.urls.length) {
            return null;
        }

        if (this.strategy === 'random') {
            const picked = Math.floor(Math.random() * this.urls.length);
            return { url: this.urls[picked], index: picked };
        }

        const picked = this.index % this.urls.length;
        this.index = (this.index + 1) % this.urls.length;
        return { url: this.urls[picked], index: picked };
    }
}

function buildConfigFromEnv() {
    const proxyUrls = parseCsv(process.env.AI_PROXY_URLS).map(normalizeProxyBase);
    const enabled =
        String(process.env.AI_PROXY_ENABLED || 'true').trim().toLowerCase() !== 'false';

    const strategy = String(process.env.AI_PROXY_STRATEGY || 'round_robin').trim();
    const debug = String(process.env.AI_PROXY_DEBUG || '').trim().toLowerCase() === 'true';
    const token = String(process.env.AI_PROXY_TOKEN || '').trim();
    const fallbackDirect =
        String(process.env.AI_PROXY_FALLBACK_DIRECT || 'true').trim().toLowerCase() !== 'false';

    const allowedHosts = parseCsv(
        process.env.AI_PROXY_ALLOWED_HOSTS ||
            'api.openai.com,openrouter.ai,api.groq.com,ollama.com,ai-gateway.vercel.sh'
    ).map(host => host.toLowerCase());

    return {
        enabled,
        proxyUrls,
        strategy,
        debug,
        token,
        fallbackDirect,
        allowedHosts
    };
}

function mergeHeaders(...inputs) {
    const headers = new Headers();

    for (const input of inputs) {
        if (!input) continue;
        const h = input instanceof Headers ? input : new Headers(input);
        for (const [key, value] of h.entries()) {
            headers.set(key, value);
        }
    }

    return headers;
}

function createProxyingFetch() {
    const config = buildConfigFromEnv();
    let proxyUrls = Array.isArray(config.proxyUrls) ? config.proxyUrls.slice() : [];
    let rotator = new ProxyRotator(proxyUrls, config.strategy);
    let dbConfigPromise = null;
    let dbConfigLoaded = false;

    async function maybeLoadDbConfig() {
        if (dbConfigLoaded) return;
        if (proxyUrls.length > 0) {
            dbConfigLoaded = true;
            return;
        }

        if (!dbConfigPromise) {
            dbConfigPromise = (async () => {
                try {
                    const database = require('./database');
                    await database.connect();
                    const dbConfig = await database.getAiProxyConfig();
                    if (!dbConfig) {
                        dbConfigLoaded = true;
                        return;
                    }

                    if (typeof dbConfig.enabled === 'boolean') {
                        config.enabled = dbConfig.enabled;
                    }

                    if (Array.isArray(dbConfig.urls) && dbConfig.urls.length > 0) {
                        proxyUrls = dbConfig.urls.map(normalizeProxyBase);
                        config.proxyUrls = proxyUrls;
                        rotator = new ProxyRotator(proxyUrls, config.strategy);
                    }
                } catch {
                    // ignore
                } finally {
                    dbConfigLoaded = true;
                }
            })();
        }

        await dbConfigPromise;
    }

    function buildAttemptOrder(startIndex) {
        const total = proxyUrls.length;
        if (!total) return [];

        if (config.strategy === 'random') {
            const order = Array.from({ length: total }, (_, i) => i);
            for (let i = order.length - 1; i > 0; i -= 1) {
                const j = Math.floor(Math.random() * (i + 1));
                [order[i], order[j]] = [order[j], order[i]];
            }
            return order;
        }

        const order = [];
        for (let step = 0; step < total; step += 1) {
            order.push((startIndex + step) % total);
        }
        return order;
    }

    return async function proxyingFetch(input, init) {
        const baseFetch = global.fetch;

        if (typeof baseFetch !== 'function') {
            throw new Error('Global fetch is not available in this Node runtime.');
        }

        const request = input instanceof Request ? input : null;
        const url =
            typeof input === 'string'
                ? input
                : input instanceof URL
                  ? input.toString()
                  : request
                    ? request.url
                    : null;

        if (!url) {
            return baseFetch(input, init);
        }

        let urlObj;
        try {
            urlObj = new URL(url);
        } catch {
            return baseFetch(input, init);
        }

        if (urlObj.protocol !== 'https:' && urlObj.protocol !== 'http:') {
            return baseFetch(input, init);
        }

        const hostname = urlObj.hostname.toLowerCase();
        if (isLikelyPrivateHostname(hostname)) {
            return baseFetch(input, init);
        }

        if (Array.isArray(config.allowedHosts) && config.allowedHosts.length > 0) {
            if (!config.allowedHosts.includes(hostname)) {
                return baseFetch(input, init);
            }
        }

        if (config.enabled && proxyUrls.length === 0) {
            await maybeLoadDbConfig();
        }

        if (!config.enabled || proxyUrls.length === 0) {
            return baseFetch(input, init);
        }

        const picked = rotator.pick();
        if (!picked) {
            return baseFetch(input, init);
        }

        const mergedHeaders = mergeHeaders(request ? request.headers : null, init ? init.headers : null);
        const baseInit = {
            ...(init || null),
            headers: mergedHeaders
        };

        const baseRequest = request ? new Request(request, baseInit) : new Request(url, baseInit);
        const method = String(baseRequest.method || 'GET').toUpperCase();

        let bufferedBody = null;
        const canHaveBody = method !== 'GET' && method !== 'HEAD';
        if (canHaveBody && proxyUrls.length > 1) {
            try {
                bufferedBody = await baseRequest.clone().arrayBuffer();
            } catch {
                bufferedBody = null;
            }
        }

        const baseSignal = (init && init.signal) || baseRequest.signal;
        const baseRedirect = baseRequest.redirect;
        const baseDuplex = init && Object.prototype.hasOwnProperty.call(init, 'duplex') ? init.duplex : undefined;

        const buildRequestForUrl = (nextUrl, extraHeaders) => {
            const headers = mergeHeaders(baseRequest.headers, extraHeaders);
            const nextInit = {
                method: baseRequest.method,
                headers,
                redirect: baseRedirect,
                signal: baseSignal
            };

            if (baseDuplex != null) {
                nextInit.duplex = baseDuplex;
            }

            if (canHaveBody) {
                if (bufferedBody) {
                    nextInit.body = Buffer.from(bufferedBody);
                } else if (proxyUrls.length <= 1) {
                    nextInit.body = baseRequest.body;
                }
            }

            return new Request(nextUrl, nextInit);
        };

        const attemptOrder = buildAttemptOrder(picked.index);
        let lastError = null;
        let lastResponse = null;

        for (let attempt = 0; attempt < attemptOrder.length; attempt += 1) {
            const proxyIndex = attemptOrder[attempt];
            const proxyBase = proxyUrls[proxyIndex];
            const proxyRequestUrl = `${proxyBase}?url=${encodeURIComponent(url)}`;

            const extraHeaders = new Headers();
            if (config.token) {
                extraHeaders.set('x-jarvis-proxy-token', config.token);
            }
            extraHeaders.set('x-jarvis-proxy-target', hostname);
            extraHeaders.set('x-jarvis-proxy-choice', String(proxyIndex));

            if (config.debug) {
                console.log(
                    `[AIProxy] ${hostname} attempt ${attempt + 1}/${attemptOrder.length} via ${proxyIndex + 1}/${proxyUrls.length} (${config.strategy})`
                );
            }

            try {
                const nextReq = buildRequestForUrl(proxyRequestUrl, extraHeaders);
                const resp = await baseFetch(nextReq);
                lastResponse = resp;

                if (resp.status >= 500 || resp.status === 429) {
                    continue;
                }

                return resp;
            } catch (err) {
                lastError = err;

                if (canHaveBody && !bufferedBody && proxyUrls.length > 1) {
                    break;
                }

                continue;
            }
        }

        if (config.fallbackDirect) {
            if (config.debug) {
                console.log(`[AIProxy] ${hostname} all proxies failed; falling back to direct`);
            }

            const directReq = buildRequestForUrl(url, null);
            return baseFetch(directReq);
        }

        if (lastError) {
            throw lastError;
        }

        return lastResponse;
    };
}

let _cachedFetch = null;

function getAIFetch() {
    if (!_cachedFetch) {
        _cachedFetch = createProxyingFetch();
    }

    return _cachedFetch;
}

module.exports = {
    getAIFetch
};

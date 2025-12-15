'use strict';

const fs = require('fs');
const path = require('path');

function parseCsv(value) {
    return String(value || '')
        .split(',')
        .map(entry => entry.trim())
        .filter(Boolean);
}

function parseBooleanEnv(value, fallback = false) {
    if (value == null) return Boolean(fallback);
    const normalized = String(value).trim().toLowerCase();
    if (!normalized) return Boolean(fallback);
    if (['1', 'true', 'yes', 'on', 'enabled'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off', 'disabled'].includes(normalized)) return false;
    return Boolean(fallback);
}

function getCloudflareAuthHeaders() {
    const token = String(process.env.CLOUDFLARE_API_TOKEN || '').trim();
    if (token) {
        return { Authorization: `Bearer ${token}` };
    }

    const email = String(process.env.CLOUDFLARE_EMAIL || '').trim();
    const key = String(process.env.CLOUDFLARE_GLOBAL_API_KEY || '').trim();
    if (email && key) {
        return {
            'X-Auth-Email': email,
            'X-Auth-Key': key
        };
    }

    return null;
}

async function cfFetch(url, init = {}) {
    const authHeaders = getCloudflareAuthHeaders();
    if (!authHeaders) {
        throw new Error(
            'Missing Cloudflare auth. Set CLOUDFLARE_API_TOKEN (recommended) or (CLOUDFLARE_EMAIL + CLOUDFLARE_GLOBAL_API_KEY).'
        );
    }

    const headers = {
        ...(init.headers || null),
        ...authHeaders
    };

    const res = await fetch(url, {
        ...init,
        headers
    });

    const text = await res.text().catch(() => '');
    let json = null;
    try {
        json = text ? JSON.parse(text) : null;
    } catch {
        json = null;
    }

    if (!res.ok) {
        const details = json ? JSON.stringify(json).slice(0, 800) : text.slice(0, 800);
        throw new Error(`Cloudflare API error ${res.status} ${res.statusText}: ${details}`);
    }

    return json;
}

async function ensureWorkersSubdomain({ accountId, subdomain }) {
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`;
    return cfFetch(url, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ subdomain })
    });
}

async function getWorkersSubdomain({ accountId }) {
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`;
    const resp = await cfFetch(url, { method: 'GET' });
    const subdomain = resp && resp.result && resp.result.subdomain ? String(resp.result.subdomain) : '';
    return subdomain.trim() || null;
}

function toSlug(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 42);
}

function loadWorkerSource() {
    const workerPath = path.join(__dirname, '..', '..', 'cloudflare', 'ai-proxy-worker.js');
    if (!fs.existsSync(workerPath)) {
        throw new Error(`Worker source file not found: ${workerPath}`);
    }

    const src = fs.readFileSync(workerPath, 'utf8');
    if (!src.trim()) {
        throw new Error(`Worker source file is empty: ${workerPath}`);
    }

    return src;
}

async function uploadWorkerModule({ accountId, scriptName, workerSource, allowedHosts }) {
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${encodeURIComponent(scriptName)}`;

    const mainModule = 'ai-proxy-worker.js';
    const metadata = {
        main_module: mainModule,
        compatibility_date: '2025-12-01',
        bindings: [
            {
                type: 'plain_text',
                name: 'AI_PROXY_ALLOWED_HOSTS',
                text: allowedHosts
            }
        ]
    };

    const form = new FormData();
    form.append('metadata', JSON.stringify(metadata));

    const blob = new Blob([workerSource], { type: 'application/javascript+module' });
    form.append(mainModule, blob, mainModule);

    return cfFetch(url, {
        method: 'PUT',
        body: form
    });
}

async function setWorkerSecret({ accountId, scriptName, name, value }) {
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${encodeURIComponent(scriptName)}/secrets`;

    return cfFetch(url, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name, text: value, type: 'secret_text' })
    });
}

async function enableWorkersDev({ accountId, scriptName }) {
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${encodeURIComponent(scriptName)}/subdomain`;

    return cfFetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ enabled: true })
    });
}

async function provisionCloudflareProxies({ allowedHosts, debug }) {
    const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
    if (!accountId) {
        throw new Error('Missing required env var: CLOUDFLARE_ACCOUNT_ID');
    }

    const countRaw = process.env.AI_PROXY_WORKERS_COUNT || process.env.AI_PROXY_COUNT || '3';
    const count = Math.max(1, Number(countRaw) || 3);

    const prefix = String(process.env.AI_PROXY_WORKER_PREFIX || 'jarvis-ai-proxy').trim();
    if (!prefix) {
        throw new Error('AI_PROXY_WORKER_PREFIX is empty');
    }

    const setToken = parseBooleanEnv(process.env.AI_PROXY_SET_WORKER_TOKEN, true);
    const proxyToken = String(process.env.AI_PROXY_TOKEN || '').trim();
    if (setToken && !proxyToken) {
        throw new Error('AI_PROXY_TOKEN is required when AI_PROXY_SET_WORKER_TOKEN=true');
    }

    const workerSource = loadWorkerSource();

    let subdomain = null;
    if (debug) {
        console.log('[AIProxy] Resolving workers.dev subdomain...');
    }

    try {
        subdomain = await getWorkersSubdomain({ accountId });
    } catch {
        subdomain = null;
    }

    if (!subdomain) {
        const configuredSubdomain = String(process.env.CLOUDFLARE_WORKERS_SUBDOMAIN || '').trim();
        const desired = configuredSubdomain || `${toSlug(prefix)}-${String(accountId).slice(0, 6)}`;

        if (debug) {
            console.log(`[AIProxy] Creating workers.dev subdomain: ${desired}`);
        }

        await ensureWorkersSubdomain({ accountId, subdomain: desired });
        subdomain = await getWorkersSubdomain({ accountId });
    }

    if (!subdomain) {
        throw new Error(
            'Unable to determine workers.dev subdomain. Set CLOUDFLARE_WORKERS_SUBDOMAIN and retry.'
        );
    }

    const urls = [];
    for (let i = 1; i <= count; i += 1) {
        const scriptName = `${prefix}-${i}`;

        if (debug) {
            console.log(`[AIProxy] Uploading ${scriptName}...`);
        }

        await uploadWorkerModule({ accountId, scriptName, workerSource, allowedHosts });

        if (setToken) {
            if (debug) {
                console.log(`[AIProxy] Setting secret AI_PROXY_TOKEN for ${scriptName}...`);
            }

            await setWorkerSecret({
                accountId,
                scriptName,
                name: 'AI_PROXY_TOKEN',
                value: proxyToken
            });
        }

        if (debug) {
            console.log(`[AIProxy] Enabling workers.dev for ${scriptName}...`);
        }

        await enableWorkersDev({ accountId, scriptName });
        urls.push(`https://${scriptName}.${subdomain}.workers.dev/`);
    }

    return urls;
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
    const enabled = parseBooleanEnv(process.env.AI_PROXY_ENABLED, true);

    const strategy = String(process.env.AI_PROXY_STRATEGY || 'round_robin').trim();
    const debug = parseBooleanEnv(process.env.AI_PROXY_DEBUG, false);
    const token = String(process.env.AI_PROXY_TOKEN || '').trim();
    const fallbackDirect = parseBooleanEnv(process.env.AI_PROXY_FALLBACK_DIRECT, true);

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
    let warnedNoUrls = false;
    let autoProvisionPromise = null;
    let autoProvisionAttempted = false;

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
                } catch (err) {
                    if (config.debug) {
                        console.warn('[AIProxy] Failed to load proxy config from DB:', err?.message || err);
                    }
                } finally {
                    dbConfigLoaded = true;
                }
            })();
        }

        await dbConfigPromise;
    }

    async function maybeAutoProvision() {
        if (autoProvisionAttempted) return;
        if (!config.enabled) return;
        if (proxyUrls.length > 0) return;

        const hasAccountId = Boolean(String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim());
        const hasAuth = Boolean(getCloudflareAuthHeaders());
        if (!hasAccountId || !hasAuth) {
            autoProvisionAttempted = true;
            return;
        }

        const autoProvisionEnabled = parseBooleanEnv(
            process.env.AI_PROXY_AUTO_PROVISION,
            false
        );

        if (!autoProvisionEnabled) {
            autoProvisionAttempted = true;
            return;
        }

        if (!autoProvisionPromise) {
            autoProvisionPromise = (async () => {
                try {
                    console.warn(
                        '[AIProxy] No proxy URLs found in env/DB. Auto-provisioning Cloudflare Workers...'
                    );

                    const allowedHosts = String(
                        process.env.AI_PROXY_ALLOWED_HOSTS ||
                            'api.openai.com,openrouter.ai,api.groq.com,ollama.com,ai-gateway.vercel.sh'
                    ).trim();

                    try {
                        const urls = await provisionCloudflareProxies({
                            allowedHosts,
                            debug: config.debug
                        });

                        proxyUrls = urls.map(normalizeProxyBase);
                        config.proxyUrls = proxyUrls;
                        rotator = new ProxyRotator(proxyUrls, config.strategy);

                        const saveToDb = parseBooleanEnv(process.env.AI_PROXY_SAVE_TO_DB, true);
                        if (saveToDb) {
                            try {
                                const database = require('./database');
                                await database.connect();
                                await database.saveAiProxyConfig({ enabled: true, urls: proxyUrls });
                            } catch (err) {
                                if (config.debug) {
                                    console.warn(
                                        '[AIProxy] Failed to persist proxy URLs to DB:',
                                        err?.message || err
                                    );
                                }
                            }
                        }
                    } catch (err) {
                        console.warn(
                            '[AIProxy] Auto-provision failed; continuing without proxy URLs:',
                            err?.message || err
                        );
                    }
                } finally {
                    autoProvisionAttempted = true;
                }
            })();
        }

        await autoProvisionPromise;
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

        if (config.enabled && proxyUrls.length === 0) {
            await maybeAutoProvision();
        }

        if (config.enabled && proxyUrls.length === 0) {
            if (!warnedNoUrls) {
                warnedNoUrls = true;
                const hasCloudflareCreds =
                    Boolean(String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim()) &&
                    Boolean(getCloudflareAuthHeaders());
                const autoProvisionEnabled = parseBooleanEnv(
                    process.env.AI_PROXY_AUTO_PROVISION,
                    false
                );
                const autoProvisionHint =
                    hasCloudflareCreds && !autoProvisionEnabled
                        ? ' Set AI_PROXY_AUTO_PROVISION=true to provision Cloudflare Workers automatically.'
                        : '';
                console.warn(
                    `[AIProxy] AI proxying is enabled but no proxy URLs are configured. Set AI_PROXY_URLS (comma-separated) or provision proxies (see scripts/provision-ai-proxies.js).${autoProvisionHint}`
                );
            }
            return baseFetch(input, init);
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

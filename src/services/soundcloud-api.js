'use strict';

const fetch = require('node-fetch');

const TOKEN_ENDPOINT = 'https://api.soundcloud.com/oauth2/token';
const API_BASE = 'https://api-v2.soundcloud.com';

function formatDurationMs(durationMs) {
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
        return null;
    }
    const totalSeconds = Math.floor(durationMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

class SoundCloudApi {
    constructor() {
        this.clientId = String(process.env.SOUNDCLOUD_CLIENT_ID || '').trim();
        this.clientSecret = String(process.env.SOUNDCLOUD_CLIENT_SECRET || '').trim();
        this.timeoutMs = Number(process.env.SOUNDCLOUD_API_TIMEOUT_MS) || 8000;
        this.refreshSkewMs = Number(process.env.SOUNDCLOUD_TOKEN_REFRESH_SKEW_MS) || 60_000;
        this.webClientIdTtlMs = Number(process.env.SOUNDCLOUD_WEB_CLIENT_ID_TTL_MS) || (6 * 60 * 60 * 1000);
        this.authBackoffMs = Number(process.env.SOUNDCLOUD_AUTH_BACKOFF_MS) || (10 * 60 * 1000);
        this.cachedToken = null;
        this.webClientId = null;
        this.webClientIdFetchedAt = 0;
        this.oauthBlockedUntil = 0;
        this.configuredClientIdBlockedUntil = 0;
        this.lastWebClientIdFailureAt = 0;

        if (String(process.env.SOUNDCLOUD_DISABLE_WEB_CLIENT_WARMUP || '') !== '1') {
            const warmup = setImmediate(() => {
                this.getWebClientId().catch(() => {});
            });
            warmup.unref?.();
        }
    }

    isConfigured() {
        return Boolean(this.clientId);
    }

    canUseOAuth() {
        return Boolean(this.clientId && this.clientSecret);
    }

    defaultHeaders() {
        return {
            'user-agent':
                'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            accept: 'application/json, text/plain, */*',
            'accept-language': 'en-US,en;q=0.9',
            origin: 'https://soundcloud.com',
            referer: 'https://soundcloud.com/'
        };
    }

    async fetchJson(url, options = {}) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
            const headers = {
                ...this.defaultHeaders(),
                ...(options.headers || {})
            };
            const res = await fetch(url, {
                ...options,
                headers,
                signal: controller.signal
            });
            const text = await res.text();
            let data = null;
            if (text) {
                try {
                    data = JSON.parse(text);
                } catch (_e) {
                    data = null;
                }
            }
            return { ok: res.ok, status: res.status, data, raw: text };
        } finally {
            clearTimeout(timeout);
        }
    }

    isOauthBlocked() {
        return Date.now() < this.oauthBlockedUntil;
    }

    isConfiguredClientIdBlocked() {
        return Date.now() < this.configuredClientIdBlockedUntil;
    }

    markOauthBlocked() {
        this.oauthBlockedUntil = Date.now() + this.authBackoffMs;
    }

    markConfiguredClientIdBlocked() {
        this.configuredClientIdBlockedUntil = Date.now() + this.authBackoffMs;
    }

    clearAuthBlocks() {
        this.oauthBlockedUntil = 0;
        this.configuredClientIdBlockedUntil = 0;
    }

    async getAccessToken() {
        if (!this.canUseOAuth()) {
            return null;
        }

        const now = Date.now();
        if (
            this.cachedToken &&
            this.cachedToken.token &&
            this.cachedToken.expiresAt > now + this.refreshSkewMs
        ) {
            return this.cachedToken.token;
        }

        const body = new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: this.clientId,
            client_secret: this.clientSecret
        });

        const { ok, status, data, raw } = await this.fetchJson(TOKEN_ENDPOINT, {
            method: 'POST',
            headers: {
                'content-type': 'application/x-www-form-urlencoded'
            },
            body
        });

        if (!ok || !data?.access_token) {
            throw new Error(
                `SoundCloud token request failed (${status}): ${data?.error_description || raw || 'unknown error'}`
            );
        }

        const expiresIn = Number(data.expires_in) || 3600;
        this.cachedToken = {
            token: data.access_token,
            expiresAt: now + (expiresIn * 1000)
        };

        return data.access_token;
    }

    extractClientIdFromScript(sourceText) {
        if (!sourceText || typeof sourceText !== 'string') {
            return null;
        }

        const patterns = [
            /client_id\s*[:=]\s*["']([a-zA-Z0-9]{32})["']/,
            /["']client_id["']\s*:\s*["']([a-zA-Z0-9]{32})["']/,
            /clientId\s*[:=]\s*["']([a-zA-Z0-9]{32})["']/
        ];

        for (const pattern of patterns) {
            const match = sourceText.match(pattern);
            if (match?.[1]) {
                return match[1];
            }
        }

        return null;
    }

    async getWebClientId(options = {}) {
        const forceRefresh = Boolean(options.forceRefresh);
        const now = Date.now();
        if (
            !forceRefresh &&
            this.webClientId &&
            this.webClientIdFetchedAt > 0 &&
            now - this.webClientIdFetchedAt < this.webClientIdTtlMs
        ) {
            return this.webClientId;
        }

        if (!forceRefresh && now - this.lastWebClientIdFailureAt < 30_000) {
            return this.webClientId || null;
        }

        try {
            const home = await this.fetchJson('https://soundcloud.com');
            if (!home.ok || !home.raw) {
                throw new Error(`home request failed (${home.status})`);
            }

            const assets = Array.from(
                new Set(
                    (home.raw.match(/https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js/g) || []).slice(0, 20)
                )
            );

            for (const assetUrl of assets) {
                try {
                    const asset = await this.fetchJson(assetUrl);
                    if (!asset.ok || !asset.raw) {
                        continue;
                    }
                    const discovered = this.extractClientIdFromScript(asset.raw);
                    if (discovered) {
                        this.webClientId = discovered;
                        this.webClientIdFetchedAt = Date.now();
                        return discovered;
                    }
                } catch {
                    // Continue scanning other assets.
                }
            }

            throw new Error('no client_id found in SoundCloud assets');
        } catch (error) {
            this.lastWebClientIdFailureAt = Date.now();
            console.warn('[SoundCloud] Failed to obtain web client_id:', error.message);
            return this.webClientId || null;
        }
    }

    async requestV2(path, query = {}) {
        const normalizedQuery = {};
        for (const [key, value] of Object.entries(query || {})) {
            if (value == null || value === '') {continue;}
            normalizedQuery[key] = String(value);
        }

        const executeRequest = async({ clientId = null, headers = {} }) => {
            const params = new URLSearchParams(normalizedQuery);
            if (clientId) {
                params.set('client_id', clientId);
            } else {
                params.delete('client_id');
            }
            const url = `${API_BASE}${path}?${params.toString()}`;
            return this.fetchJson(url, { headers });
        };

        const authErrors = [];
        const preferWebClient = path.startsWith('/search/');

        if (preferWebClient && this.webClientId) {
            const webCached = await executeRequest({ clientId: this.webClientId });
            if (webCached.ok) {
                return webCached.data;
            }
            if (webCached.status === 401 || webCached.status === 403) {
                authErrors.push(`web_client_id_cached:${webCached.status}`);
            } else {
                throw new Error(
                    `SoundCloud API request failed (${webCached.status}): ${webCached.raw || 'unknown'}`
                );
            }
        }

        if (this.canUseOAuth() && !this.isOauthBlocked()) {
            try {
                const token = await this.getAccessToken();
                const oauthRes = await executeRequest({
                    headers: { authorization: `OAuth ${token}` }
                });
                if (oauthRes.ok) {
                    this.clearAuthBlocks();
                    return oauthRes.data;
                }
                if (oauthRes.status === 401 || oauthRes.status === 403) {
                    this.markOauthBlocked();
                    authErrors.push(`oauth:${oauthRes.status}`);
                } else {
                    throw new Error(
                        `SoundCloud API request failed (${oauthRes.status}): ${oauthRes.raw || 'unknown'}`
                    );
                }
            } catch (error) {
                this.markOauthBlocked();
                authErrors.push(`oauth:error:${error.message}`);
            }
        }

        if (this.clientId && !this.isConfiguredClientIdBlocked()) {
            const configuredRes = await executeRequest({ clientId: this.clientId });
            if (configuredRes.ok) {
                this.clearAuthBlocks();
                return configuredRes.data;
            }
            if (configuredRes.status === 401 || configuredRes.status === 403) {
                this.markConfiguredClientIdBlocked();
                authErrors.push(`client_id:${configuredRes.status}`);
            } else {
                throw new Error(
                    `SoundCloud API request failed (${configuredRes.status}): ${configuredRes.raw || 'unknown'}`
                );
            }
        }

        const webClientId = await this.getWebClientId({
            forceRefresh: !this.webClientId || authErrors.length > 0
        });
        if (webClientId) {
            const webRes = await executeRequest({ clientId: webClientId });
            if (webRes.ok) {
                this.webClientId = webClientId;
                this.webClientIdFetchedAt = Date.now();
                return webRes.data;
            }
            if (webRes.status === 401 || webRes.status === 403) {
                authErrors.push(`web_client_id:${webRes.status}`);
                const refreshedId = await this.getWebClientId({ forceRefresh: true });
                if (refreshedId && refreshedId !== webClientId) {
                    const refreshedRes = await executeRequest({ clientId: refreshedId });
                    if (refreshedRes.ok) {
                        this.webClientId = refreshedId;
                        this.webClientIdFetchedAt = Date.now();
                        return refreshedRes.data;
                    }
                    if (refreshedRes.status === 401 || refreshedRes.status === 403) {
                        authErrors.push(`web_client_id_refreshed:${refreshedRes.status}`);
                    } else {
                        throw new Error(
                            `SoundCloud API request failed (${refreshedRes.status}): ${refreshedRes.raw || 'unknown'}`
                        );
                    }
                }
            } else {
                throw new Error(
                    `SoundCloud API request failed (${webRes.status}): ${webRes.raw || 'unknown'}`
                );
            }
        }

        const reason = authErrors.length ? authErrors.join(', ') : 'no usable auth mode';
        throw new Error(`SoundCloud API request failed (403): ${reason}`);
    }

    mapTrack(rawTrack) {
        if (!rawTrack || rawTrack.kind !== 'track') {
            return null;
        }

        const permalink = rawTrack.permalink_url || null;
        if (!permalink) {
            return null;
        }

        return {
            source: 'soundcloud',
            title: rawTrack.title || 'SoundCloud Track',
            url: permalink,
            duration: formatDurationMs(Number(rawTrack.duration) || 0),
            durationMs: Number(rawTrack.duration) || null,
            thumbnail: rawTrack.artwork_url || rawTrack.user?.avatar_url || null,
            uploader: rawTrack.user?.username || null
        };
    }

    async searchTracks(query, limit = 1) {
        if (!this.isConfigured()) {
            return [];
        }
        const q = String(query || '').trim();
        if (!q) {
            return [];
        }

        const data = await this.requestV2('/search/tracks', {
            q,
            limit: Math.max(1, Math.min(Number(limit) || 1, 10)),
            linked_partitioning: 1
        });

        const tracks = Array.isArray(data?.collection) ? data.collection : [];
        return tracks.map(track => this.mapTrack(track)).filter(Boolean);
    }

    async resolveTrack(url) {
        if (!this.isConfigured()) {
            return null;
        }

        let normalizedUrl;
        try {
            normalizedUrl = new URL(url).toString();
        } catch (_e) {
            return null;
        }

        const data = await this.requestV2('/resolve', { url: normalizedUrl });
        if (!data) {
            return null;
        }

        if (data.kind === 'track') {
            return this.mapTrack(data);
        }

        if (data.kind === 'playlist' && Array.isArray(data.tracks) && data.tracks.length > 0) {
            const firstTrack = this.mapTrack(data.tracks[0]);
            if (firstTrack) {
                return firstTrack;
            }
        }

        return null;
    }
}

module.exports = new SoundCloudApi();

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
        this.cachedToken = null;
    }

    isConfigured() {
        return Boolean(this.clientId);
    }

    canUseOAuth() {
        return Boolean(this.clientId && this.clientSecret);
    }

    async fetchJson(url, options = {}) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
            const res = await fetch(url, {
                ...options,
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

    async requestV2(path, query = {}) {
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(query || {})) {
            if (value == null || value === '') {continue;}
            params.set(key, String(value));
        }

        const withClientId = () => {
            if (this.clientId && !params.has('client_id')) {
                params.set('client_id', this.clientId);
            }
        };

        const doRequest = async(headers = {}) => {
            const url = `${API_BASE}${path}?${params.toString()}`;
            return this.fetchJson(url, { headers });
        };

        // Try OAuth first (best reliability), then fall back to client_id.
        if (this.canUseOAuth()) {
            try {
                withClientId();
                const token = await this.getAccessToken();
                const tokenRes = await doRequest({
                    authorization: `OAuth ${token}`
                });
                if (tokenRes.ok) {
                    return tokenRes.data;
                }
                if (tokenRes.status !== 401 && tokenRes.status !== 403) {
                    throw new Error(
                        `SoundCloud API request failed (${tokenRes.status}): ${tokenRes.raw || 'unknown'}`
                    );
                }
            } catch (error) {
                console.warn('[SoundCloud] OAuth request failed, falling back to client_id:', error.message);
            }
        }

        if (!this.clientId) {
            throw new Error('SoundCloud client_id is not configured.');
        }

        withClientId();
        const fallbackRes = await doRequest();
        if (!fallbackRes.ok) {
            throw new Error(
                `SoundCloud API request failed (${fallbackRes.status}): ${fallbackRes.raw || 'unknown'}`
            );
        }
        return fallbackRes.data;
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

'use strict';

const fetch = require('node-fetch');
const cheerio = require('cheerio');

let twitchTokenState = {
    accessToken: null,
    expiresAtMs: 0
};

function normalizeUrl(url) {
    const raw = String(url || '').trim();
    if (!raw) {
        const error = new Error('URL is required.');
        error.isFriendly = true;
        throw error;
    }
    return raw;
}

function loadXml(xml) {
    return cheerio.load(xml, { xmlMode: true });
}

function extractFirstItem($) {
    const item = $('channel > item').first();
    if (item && item.length) {
        return { kind: 'rss', node: item };
    }

    const entry = $('feed > entry').first();
    if (entry && entry.length) {
        return { kind: 'atom', node: entry };
    }

    const anyItem = $('item').first();
    if (anyItem && anyItem.length) {
        return { kind: 'rss', node: anyItem };
    }

    const anyEntry = $('entry').first();
    if (anyEntry && anyEntry.length) {
        return { kind: 'atom', node: anyEntry };
    }

    return null;
}

function extractAtomLink(node) {
    const alt = node.find('link[rel="alternate"]').first();
    const hrefAlt = alt.attr('href');
    if (hrefAlt) return String(hrefAlt).trim();

    const link = node.find('link').first();
    const href = link.attr('href');
    if (href) return String(href).trim();

    const textLink = node.find('link').first().text();
    if (textLink) return String(textLink).trim();

    return null;
}

function extractRssLink(node) {
    const link = node.find('link').first();
    if (link && link.length) {
        const href = link.attr('href');
        if (href) return String(href).trim();
        const text = link.text();
        if (text) return String(text).trim();
    }

    return null;
}

function extractEntryIdentifier({ kind, node }) {
    if (kind === 'rss') {
        const guid = node.find('guid').first().text();
        if (guid) return String(guid).trim();

        const id = node.find('id').first().text();
        if (id) return String(id).trim();

        const link = extractRssLink(node);
        if (link) return link;

        const title = node.find('title').first().text();
        if (title) return String(title).trim();

        return null;
    }

    const ytVideoId = node.find('yt\\:videoId').first().text();
    if (ytVideoId) return String(ytVideoId).trim();

    const id = node.find('id').first().text();
    if (id) return String(id).trim();

    const link = extractAtomLink(node);
    if (link) return link;

    const title = node.find('title').first().text();
    if (title) return String(title).trim();

    return null;
}

function extractEntryTitle(node) {
    const title = node.find('title').first().text();
    return title ? String(title).trim() : null;
}

function extractEntryPublished(node) {
    const published = node.find('published').first().text();
    if (published) return String(published).trim();
    const pubDate = node.find('pubDate').first().text();
    if (pubDate) return String(pubDate).trim();
    const updated = node.find('updated').first().text();
    if (updated) return String(updated).trim();
    return null;
}

async function fetchXml(url) {
    const target = normalizeUrl(url);
    const res = await fetch(target, {
        method: 'GET',
        redirect: 'follow',
        timeout: 20000,
        headers: {
            'User-Agent': 'JarvisMonitor/1.0 (+https://github.com/not-antoni/jarvis-ai)'
        }
    });

    const body = await res.text();
    return { status: res.status, ok: res.ok, body };
}

async function fetchFeedLatest(url) {
    const { body } = await fetchXml(url);
    const $ = loadXml(body);
    const first = extractFirstItem($);
    if (!first) {
        return null;
    }

    const id = extractEntryIdentifier(first);
    const title = extractEntryTitle(first.node);
    const link = first.kind === 'rss' ? extractRssLink(first.node) : extractAtomLink(first.node);
    const publishedAt = extractEntryPublished(first.node);

    return {
        id: id || null,
        title: title || null,
        link: link || null,
        publishedAt: publishedAt || null
    };
}

async function fetchWebsiteStatus(url) {
    const target = normalizeUrl(url);
    const startTime = Date.now();
    
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 20000);
        
        const res = await fetch(target, {
            method: 'GET',
            redirect: 'follow',
            signal: controller.signal,
            headers: {
                'User-Agent': 'JarvisMonitor/1.0 (+https://github.com/not-antoni/jarvis-ai)'
            }
        });
        
        clearTimeout(timeoutId);
        const responseTime = Date.now() - startTime;

        return {
            status: res.status,
            ok: res.ok,
            responseTime,
            statusText: res.statusText || getStatusText(res.status),
            headers: {
                server: res.headers.get('server'),
                contentType: res.headers.get('content-type')
            }
        };
    } catch (error) {
        const responseTime = Date.now() - startTime;
        
        if (error.name === 'AbortError') {
            return { status: 0, ok: false, responseTime, statusText: 'Timeout', error: 'Request timed out after 20s' };
        }
        
        if (error.code === 'ENOTFOUND') {
            return { status: 0, ok: false, responseTime, statusText: 'DNS Failed', error: 'Domain not found' };
        }
        
        if (error.code === 'ECONNREFUSED') {
            return { status: 0, ok: false, responseTime, statusText: 'Connection Refused', error: 'Server refused connection' };
        }
        
        if (error.code === 'CERT_HAS_EXPIRED' || error.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
            return { status: 0, ok: false, responseTime, statusText: 'SSL Error', error: 'Certificate issue' };
        }
        
        return { status: 0, ok: false, responseTime, statusText: 'Error', error: error.message || 'Unknown error' };
    }
}

function getStatusText(code) {
    const codes = {
        200: 'OK', 201: 'Created', 204: 'No Content',
        301: 'Moved Permanently', 302: 'Found', 304: 'Not Modified',
        400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found',
        500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Timeout'
    };
    return codes[code] || 'Unknown';
}

// ============================================================================
// CLOUDFLARE STATUS PAGE MONITORING
// ============================================================================

const CLOUDFLARE_STATUS_URL = 'https://www.cloudflarestatus.com/api/v2/summary.json';
const CLOUDFLARE_COMPONENTS_URL = 'https://www.cloudflarestatus.com/api/v2/components.json';
const CLOUDFLARE_INCIDENTS_URL = 'https://www.cloudflarestatus.com/api/v2/incidents/unresolved.json';

async function fetchCloudflareStatus() {
    try {
        const [summaryRes, incidentsRes] = await Promise.all([
            fetch(CLOUDFLARE_STATUS_URL, {
                timeout: 15000,
                headers: { 'User-Agent': 'JarvisMonitor/1.0' }
            }),
            fetch(CLOUDFLARE_INCIDENTS_URL, {
                timeout: 15000,
                headers: { 'User-Agent': 'JarvisMonitor/1.0' }
            })
        ]);

        const summary = await summaryRes.json().catch(() => null);
        const incidents = await incidentsRes.json().catch(() => null);

        if (!summary?.status) {
            return { success: false, error: 'Could not parse Cloudflare status' };
        }

        // Parse overall status
        const overallStatus = summary.status?.indicator || 'unknown';
        const overallDescription = summary.status?.description || 'Unknown';

        // Parse components
        const components = (summary.components || []).map(c => ({
            id: c.id,
            name: c.name,
            status: c.status,
            description: c.description,
            updatedAt: c.updated_at
        }));

        // Group components by status
        const operational = components.filter(c => c.status === 'operational');
        const degraded = components.filter(c => c.status === 'degraded_performance');
        const partial = components.filter(c => c.status === 'partial_outage');
        const major = components.filter(c => c.status === 'major_outage');

        // Parse active incidents
        const activeIncidents = (incidents?.incidents || []).map(i => ({
            id: i.id,
            name: i.name,
            status: i.status,
            impact: i.impact,
            createdAt: i.created_at,
            updatedAt: i.updated_at,
            shortlink: i.shortlink,
            updates: (i.incident_updates || []).slice(0, 3).map(u => ({
                status: u.status,
                body: u.body?.substring(0, 200),
                createdAt: u.created_at
            }))
        }));

        return {
            success: true,
            overall: {
                status: overallStatus,
                description: overallDescription,
                emoji: getStatusEmoji(overallStatus)
            },
            components: {
                total: components.length,
                operational: operational.length,
                degraded: degraded.map(c => c.name),
                partialOutage: partial.map(c => c.name),
                majorOutage: major.map(c => c.name)
            },
            componentsList: components,
            incidents: activeIncidents,
            fetchedAt: new Date().toISOString()
        };
    } catch (error) {
        return { success: false, error: error.message || 'Failed to fetch Cloudflare status' };
    }
}

function getStatusEmoji(status) {
    const emojis = {
        'none': '✅',
        'operational': '✅',
        'minor': '⚠️',
        'major': '🔴',
        'critical': '🚨',
        'degraded_performance': '⚠️',
        'partial_outage': '🟠',
        'major_outage': '🔴'
    };
    return emojis[status] || '❓';
}

// ============================================================================
// GENERIC STATUS PAGE MONITORING (Statuspage.io format)
// ============================================================================

async function fetchStatusPageStatus(baseUrl) {
    try {
        // Statuspage.io compatible API
        const apiUrl = baseUrl.replace(/\/$/, '') + '/api/v2/summary.json';
        
        const res = await fetch(apiUrl, {
            timeout: 15000,
            headers: { 'User-Agent': 'JarvisMonitor/1.0' }
        });

        if (!res.ok) {
            return { success: false, error: `HTTP ${res.status}` };
        }

        const data = await res.json().catch(() => null);
        if (!data?.status) {
            return { success: false, error: 'Invalid status page format' };
        }

        const components = (data.components || []).map(c => ({
            id: c.id,
            name: c.name,
            status: c.status,
            emoji: getStatusEmoji(c.status),
            updatedAt: c.updated_at
        }));

        const incidents = (data.incidents || []).slice(0, 5).map(i => ({
            id: i.id,
            name: i.name,
            status: i.status,
            impact: i.impact,
            updatedAt: i.updated_at,
            shortlink: i.shortlink
        }));

        return {
            success: true,
            pageName: data.page?.name || 'Status Page',
            overall: {
                status: data.status?.indicator || 'unknown',
                description: data.status?.description || 'Unknown',
                emoji: getStatusEmoji(data.status?.indicator)
            },
            components,
            incidents,
            fetchedAt: new Date().toISOString()
        };
    } catch (error) {
        return { success: false, error: error.message || 'Failed to fetch status page' };
    }
}

function buildYoutubeFeedUrl(channelId) {
    const cid = String(channelId || '').trim();
    if (!cid) {
        const error = new Error('YouTube channel_id is required.');
        error.isFriendly = true;
        throw error;
    }
    return `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(cid)}`;
}

async function fetchYoutubeLatest(channelId) {
    const feedUrl = buildYoutubeFeedUrl(channelId);
    return fetchFeedLatest(feedUrl);
}

async function fetchTwitchAppToken() {
    const clientId = String(process.env.TWITCH_CLIENT_ID || '').trim();
    const clientSecret = String(process.env.TWITCH_CLIENT_SECRET || '').trim();
    if (!clientId || !clientSecret) {
        const error = new Error('TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET must be configured.');
        error.isFriendly = true;
        throw error;
    }

    const params = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'client_credentials'
    });

    const res = await fetch(`https://id.twitch.tv/oauth2/token?${params.toString()}`, {
        method: 'POST',
        timeout: 20000
    });

    const payload = await res.json().catch(() => null);
    if (!res.ok || !payload?.access_token) {
        const message = payload?.message || payload?.error_description || 'Unable to fetch Twitch token';
        throw new Error(message);
    }

    const expiresIn = Number(payload.expires_in) || 0;
    const expiresAtMs = Date.now() + Math.max(0, expiresIn - 60) * 1000;
    twitchTokenState.accessToken = String(payload.access_token);
    twitchTokenState.expiresAtMs = expiresAtMs;

    return twitchTokenState.accessToken;
}

async function getTwitchBearerToken() {
    if (twitchTokenState.accessToken && Date.now() < twitchTokenState.expiresAtMs) {
        return twitchTokenState.accessToken;
    }

    return fetchTwitchAppToken();
}

function getTwitchHeaders(token) {
    const clientId = String(process.env.TWITCH_CLIENT_ID || '').trim();
    return {
        'Client-ID': clientId,
        Authorization: `Bearer ${token}`
    };
}

async function fetchTwitchJson(url, { retryOnUnauthorized = true } = {}) {
    const token = await getTwitchBearerToken();

    const res = await fetch(url, {
        method: 'GET',
        timeout: 20000,
        headers: getTwitchHeaders(token)
    });

    if (res.status === 401 && retryOnUnauthorized) {
        twitchTokenState.accessToken = null;
        twitchTokenState.expiresAtMs = 0;
        const refreshed = await getTwitchBearerToken();
        const retryRes = await fetch(url, {
            method: 'GET',
            timeout: 20000,
            headers: getTwitchHeaders(refreshed)
        });
        const retryPayload = await retryRes.json().catch(() => null);
        return { status: retryRes.status, ok: retryRes.ok, data: retryPayload };
    }

    const data = await res.json().catch(() => null);
    return { status: res.status, ok: res.ok, data };
}

async function fetchTwitchUserAndStream(username) {
    const login = String(username || '').trim().toLowerCase();
    if (!login) {
        const error = new Error('Twitch username is required.');
        error.isFriendly = true;
        throw error;
    }

    const userRes = await fetchTwitchJson(
        `https://api.twitch.tv/helix/users?login=${encodeURIComponent(login)}`
    );

    const user = Array.isArray(userRes?.data?.data) ? userRes.data.data[0] : null;
    if (!user) {
        return { status: 'offline', user: null, stream: null };
    }

    const streamRes = await fetchTwitchJson(
        `https://api.twitch.tv/helix/streams?user_id=${encodeURIComponent(user.id)}`
    );
    const stream = Array.isArray(streamRes?.data?.data) ? streamRes.data.data[0] : null;

    if (stream) {
        return { status: 'live', user, stream };
    }

    return { status: 'offline', user, stream: null };
}

module.exports = {
    fetchFeedLatest,
    fetchWebsiteStatus,
    buildYoutubeFeedUrl,
    fetchYoutubeLatest,
    fetchTwitchUserAndStream,
    fetchCloudflareStatus,
    fetchStatusPageStatus,
    getStatusEmoji
};

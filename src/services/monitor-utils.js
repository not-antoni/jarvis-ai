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
    const res = await fetch(target, {
        method: 'GET',
        redirect: 'follow',
        timeout: 20000,
        headers: {
            'User-Agent': 'JarvisMonitor/1.0 (+https://github.com/not-antoni/jarvis-ai)'
        }
    });

    return {
        status: res.status,
        ok: res.ok
    };
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
    fetchTwitchUserAndStream
};

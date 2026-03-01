'use strict';

const DEFAULT_SITE_BASE_URL = 'https://jorvis.org';
const DEFAULT_SITE_DOMAIN = 'jorvis.org';
const DEFAULT_DISCORD_INVITE_URL = 'https://discord.com/invite/ksXzuBtmK5';
const DEFAULT_BOT_CLIENT_ID = '1402324275762954371';
const DEFAULT_GA_MEASUREMENT_ID = 'G-7P8W1MN168';
const DEFAULT_CORS_ALLOWED_ORIGINS = ['http://localhost:3000', 'http://localhost:5173'];

function normalizeHostValue(raw) {
    const value = String(raw || '').trim().toLowerCase();
    if (!value) {return '';}

    if (value.startsWith('[') && value.includes(']')) {
        const endBracket = value.indexOf(']');
        return value.slice(1, endBracket);
    }

    return value.replace(/:\d+$/, '').replace(/\/+$/, '');
}

function normalizeBaseUrl(raw, fallback = DEFAULT_SITE_BASE_URL) {
    const value = String(raw || '').trim();
    if (!value) {return fallback;}

    try {
        const parsed = new URL(value.includes('://') ? value : `https://${value}`);
        const pathname = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, '');
        return `${parsed.protocol}//${parsed.host}${pathname}`;
    } catch {
        return fallback;
    }
}

function parseDomain(raw) {
    const value = String(raw || '').trim();
    if (!value) {return '';}

    try {
        const parsed = new URL(value.includes('://') ? value : `https://${value}`);
        return normalizeHostValue(parsed.host);
    } catch {
        return normalizeHostValue(value.replace(/\/.*$/, ''));
    }
}

function buildBotInviteUrl(clientId) {
    const id = String(clientId || '').trim();
    if (!id) {return '';}
    return `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(id)}`;
}

function parseCsv(raw) {
    return String(raw || '')
        .split(',')
        .map(entry => entry.trim())
        .filter(Boolean);
}

function getPublicConfig() {
    const baseUrl = normalizeBaseUrl(
        process.env.SITE_BASE_URL || process.env.PUBLIC_BASE_URL || DEFAULT_SITE_BASE_URL
    );

    const domain =
        parseDomain(process.env.SITE_DOMAIN || process.env.JARVIS_DOMAIN) ||
        parseDomain(baseUrl) ||
        DEFAULT_SITE_DOMAIN;

    const discordInviteUrl =
        String(process.env.DISCORD_INVITE_URL || '').trim() || DEFAULT_DISCORD_INVITE_URL;

    const botClientId =
        process.env.DISCORD_CLIENT_ID ||
        process.env.DISCORD_APPLICATION_ID ||
        process.env.DISCORD_APP_ID ||
        process.env.APPLICATION_ID ||
        DEFAULT_BOT_CLIENT_ID;

    const botInviteUrl =
        String(process.env.BOT_INVITE_URL || '').trim() || buildBotInviteUrl(botClientId);

    const gaMeasurementId =
        String(process.env.GA_MEASUREMENT_ID || '').trim() || DEFAULT_GA_MEASUREMENT_ID;

    const corsAllowedOrigins = Array.from(
        new Set(
            [
                baseUrl,
                process.env.PUBLIC_BASE_URL,
                ...DEFAULT_CORS_ALLOWED_ORIGINS,
                ...parseCsv(process.env.CORS_ALLOWED_ORIGINS)
            ]
                .map(entry => String(entry || '').trim().replace(/\/+$/, ''))
                .filter(Boolean)
        )
    );

    return {
        baseUrl,
        domain,
        discordInviteUrl,
        botInviteUrl,
        gaMeasurementId,
        corsAllowedOrigins
    };
}

module.exports = {
    getPublicConfig,
    normalizeBaseUrl,
    normalizeHostValue
};

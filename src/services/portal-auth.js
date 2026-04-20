'use strict';

/**
 * Discord OAuth2 helpers for the web portal.
 *
 * Flow:
 *   1. `getAuthorizeUrl({ state })` — builds the Discord consent URL
 *   2. `exchangeCode({ code })` — swaps an authorization code for an access token
 *   3. `fetchUser(accessToken)` — returns the Discord user payload
 *   4. `fetchUserGuilds(accessToken)` — returns guilds the user is in
 *
 * Environment:
 *   DISCORD_CLIENT_ID       (required, falls back to CLIENT_ID)
 *   DISCORD_CLIENT_SECRET   (required)
 *   PORTAL_CALLBACK_URL     (optional, derived from public config if unset)
 */

const { getPublicConfig } = require('../utils/public-config');
const logger = require('../utils/logger');

const log = logger.child({ module: 'portal-auth' });

const DISCORD_OAUTH_BASE = 'https://discord.com/api/oauth2';
const DISCORD_API_BASE = 'https://discord.com/api/v10';

const OAUTH_SCOPES = ['identify', 'guilds'];

function getCredentials() {
    const clientId = (process.env.DISCORD_CLIENT_ID || process.env.CLIENT_ID || '').trim();
    const clientSecret = (process.env.DISCORD_CLIENT_SECRET || process.env.CLIENT_SECRET || '').trim();
    return { clientId, clientSecret };
}

function isConfigured() {
    const { clientId, clientSecret } = getCredentials();
    return Boolean(clientId && clientSecret);
}

function getRedirectUri() {
    const override = (process.env.PORTAL_CALLBACK_URL || '').trim();
    if (override) {return override;}
    const base = getPublicConfig().baseUrl || '';
    return `${base.replace(/\/$/, '')}/portal/callback`;
}

function getAuthorizeUrl({ state }) {
    const { clientId } = getCredentials();
    if (!clientId) {throw new Error('Discord client id not configured');}
    const params = new URLSearchParams({
        client_id: clientId,
        response_type: 'code',
        redirect_uri: getRedirectUri(),
        scope: OAUTH_SCOPES.join(' '),
        state: String(state),
        prompt: 'none'
    });
    return `${DISCORD_OAUTH_BASE}/authorize?${params.toString()}`;
}

async function exchangeCode({ code }) {
    const { clientId, clientSecret } = getCredentials();
    if (!clientId || !clientSecret) {throw new Error('Discord OAuth credentials missing');}
    const body = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code: String(code),
        redirect_uri: getRedirectUri()
    });
    const res = await fetch(`${DISCORD_OAUTH_BASE}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        log.warn('OAuth token exchange failed', { status: res.status, body: text.slice(0, 200) });
        throw new Error(`OAuth token exchange failed with status ${res.status}`);
    }
    const data = await res.json();
    if (!data?.access_token) {throw new Error('OAuth token exchange returned no access_token');}
    return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token || null,
        expiresIn: Number(data.expires_in) || 3600,
        scope: data.scope || null,
        tokenType: data.token_type || 'Bearer'
    };
}

async function revokeToken(accessToken) {
    const { clientId, clientSecret } = getCredentials();
    if (!accessToken || !clientId || !clientSecret) {return;}
    try {
        await fetch(`${DISCORD_OAUTH_BASE}/token/revoke`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: clientId,
                client_secret: clientSecret,
                token: accessToken
            })
        });
    } catch (error) {
        log.warn('OAuth token revoke failed', { err: error });
    }
}

async function fetchUser(accessToken) {
    const res = await fetch(`${DISCORD_API_BASE}/users/@me`, {
        headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Discord /users/@me failed: ${res.status} ${text.slice(0, 100)}`);
    }
    return res.json();
}

async function fetchUserGuilds(accessToken) {
    const res = await fetch(`${DISCORD_API_BASE}/users/@me/guilds`, {
        headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Discord /users/@me/guilds failed: ${res.status} ${text.slice(0, 100)}`);
    }
    const guilds = await res.json();
    return Array.isArray(guilds) ? guilds : [];
}

/**
 * Compute a cdn.discordapp.com avatar URL from an API user payload.
 * Returns a default Discord embed avatar when the user has no custom one.
 */
function avatarUrlFor(user) {
    if (!user?.id) {return null;}
    if (user.avatar) {
        const extension = user.avatar.startsWith('a_') ? 'gif' : 'png';
        return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${extension}?size=128`;
    }
    // Fallback to the new default avatar scheme (based on user id)
    const index = Number(BigInt(user.id) >> 22n) % 6;
    return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

module.exports = {
    OAUTH_SCOPES,
    getCredentials,
    isConfigured,
    getRedirectUri,
    getAuthorizeUrl,
    exchangeCode,
    revokeToken,
    fetchUser,
    fetchUserGuilds,
    avatarUrlFor
};

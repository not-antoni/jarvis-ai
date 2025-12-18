'use strict';

/**
 * User Authentication Service for Website
 * Discord OAuth for users to execute commands from the web
 */

const crypto = require('crypto');

// Session storage
const userSessions = new Map();
const SESSION_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

// Discord OAuth config
const DISCORD_API = 'https://discord.com/api/v10';
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || '';
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || '';
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 'http://localhost:3000';

/**
 * Get OAuth authorization URL
 */
function getOAuthUrl(state = null) {
    const redirectUri = `${PUBLIC_BASE_URL}/auth/callback`;
    const scopes = ['identify', 'guilds'];
    
    const params = new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: scopes.join(' ')
    });
    
    if (state) {
        params.set('state', state);
    }
    
    return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

/**
 * Exchange code for access token
 */
async function exchangeCode(code) {
    const redirectUri = `${PUBLIC_BASE_URL}/auth/callback`;
    
    const response = await fetch(`${DISCORD_API}/oauth2/token`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
            client_id: DISCORD_CLIENT_ID,
            client_secret: DISCORD_CLIENT_SECRET,
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirectUri
        })
    });
    
    if (!response.ok) {
        const error = await response.text();
        throw new Error(`OAuth token exchange failed: ${error}`);
    }
    
    return response.json();
}

/**
 * Get user info from Discord
 */
async function getDiscordUser(accessToken) {
    const response = await fetch(`${DISCORD_API}/users/@me`, {
        headers: {
            Authorization: `Bearer ${accessToken}`
        }
    });
    
    if (!response.ok) {
        throw new Error('Failed to fetch Discord user');
    }
    
    return response.json();
}

/**
 * Get user's guilds from Discord
 */
async function getDiscordGuilds(accessToken) {
    const response = await fetch(`${DISCORD_API}/users/@me/guilds`, {
        headers: {
            Authorization: `Bearer ${accessToken}`
        }
    });
    
    if (!response.ok) {
        return [];
    }
    
    return response.json();
}

/**
 * Generate session token
 */
function generateSessionToken() {
    return crypto.randomBytes(32).toString('hex');
}

/**
 * Create user session
 */
function createSession(user, accessToken, refreshToken) {
    const sessionToken = generateSessionToken();
    const session = {
        token: sessionToken,
        userId: user.id,
        username: user.username,
        discriminator: user.discriminator || '0',
        avatar: user.avatar,
        globalName: user.global_name,
        accessToken,
        refreshToken,
        createdAt: Date.now(),
        expiresAt: Date.now() + SESSION_DURATION_MS
    };
    
    userSessions.set(sessionToken, session);
    return session;
}

/**
 * Get session by token
 */
function getSession(token) {
    if (!token) return null;
    
    const session = userSessions.get(token);
    if (!session) return null;
    
    if (Date.now() > session.expiresAt) {
        userSessions.delete(token);
        return null;
    }
    
    return session;
}

/**
 * Delete session
 */
function deleteSession(token) {
    userSessions.delete(token);
}

/**
 * Get session from request (cookie or header)
 */
function getSessionFromRequest(req) {
    // Try cookie first
    const cookieToken = req.cookies?.jarvis_session;
    if (cookieToken) {
        const session = getSession(cookieToken);
        if (session) return session;
    }
    
    // Try Authorization header
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.slice(7);
        return getSession(token);
    }
    
    return null;
}

/**
 * Get user's avatar URL
 */
function getAvatarUrl(user) {
    if (user.avatar) {
        const ext = user.avatar.startsWith('a_') ? 'gif' : 'png';
        return `https://cdn.discordapp.com/avatars/${user.userId}/${user.avatar}.${ext}`;
    }
    // Default avatar
    const defaultIndex = (BigInt(user.userId) >> 22n) % 6n;
    return `https://cdn.discordapp.com/embed/avatars/${defaultIndex}.png`;
}

/**
 * Check if OAuth is configured
 */
function isOAuthConfigured() {
    return !!(DISCORD_CLIENT_ID && DISCORD_CLIENT_SECRET);
}

/**
 * Prune expired sessions
 */
function pruneSessions() {
    const now = Date.now();
    for (const [token, session] of userSessions.entries()) {
        if (now > session.expiresAt) {
            userSessions.delete(token);
        }
    }
}

// Prune sessions every 5 minutes
setInterval(pruneSessions, 5 * 60 * 1000);

module.exports = {
    getOAuthUrl,
    exchangeCode,
    getDiscordUser,
    getDiscordGuilds,
    createSession,
    getSession,
    deleteSession,
    getSessionFromRequest,
    getAvatarUrl,
    isOAuthConfigured,
    PUBLIC_BASE_URL
};

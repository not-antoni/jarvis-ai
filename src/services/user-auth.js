'use strict';

/**
 * User Authentication Service for Website
 * Discord OAuth for users to execute commands from the web
 * Uses signed JWT-like tokens that survive server restarts
 */

const crypto = require('crypto');

// Session cache (for faster validation, but tokens are self-contained)
const sessionCache = new Map();
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const CACHE_MAX_SIZE = 10000;

// Discord OAuth config
const DISCORD_API = 'https://discord.com/api/v10';
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || '';
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || '';
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 'http://localhost:3000';

/**
 * Get signing key for session tokens
 */
function getSigningKey() {
    const raw = process.env.USER_SESSION_SECRET || process.env.MASTER_KEY_BASE64 || process.env.DISCORD_TOKEN || '';
    if (!raw) return crypto.randomBytes(32);
    return crypto.createHash('sha256').update(raw).digest();
}

/**
 * Create signed session token
 */
function createSignedToken(payload) {
    const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto.createHmac('sha256', getSigningKey()).update(data).digest('base64url');
    return `${data}.${signature}`;
}

/**
 * Parse and verify signed token
 */
function parseSignedToken(token) {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    
    const [data, signature] = parts;
    const expectedSig = crypto.createHmac('sha256', getSigningKey()).update(data).digest('base64url');
    
    if (signature !== expectedSig) return null;
    
    try {
        return JSON.parse(Buffer.from(data, 'base64url').toString());
    } catch {
        return null;
    }
}

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
 * Create user session (returns signed token that survives restarts)
 */
function createSession(user, accessToken, refreshToken) {
    const now = Date.now();
    const payload = {
        v: 1,
        userId: user.id,
        username: user.username,
        discriminator: user.discriminator || '0',
        avatar: user.avatar,
        globalName: user.global_name,
        iat: now,
        exp: now + SESSION_DURATION_MS
    };
    
    const token = createSignedToken(payload);
    
    // Cache for faster lookups
    const session = {
        token,
        userId: user.id,
        username: user.username,
        discriminator: user.discriminator || '0',
        avatar: user.avatar,
        globalName: user.global_name,
        accessToken,
        refreshToken,
        createdAt: now,
        expiresAt: payload.exp
    };
    
    // Limit cache size
    if (sessionCache.size >= CACHE_MAX_SIZE) {
        const firstKey = sessionCache.keys().next().value;
        sessionCache.delete(firstKey);
    }
    sessionCache.set(token, session);
    
    return session;
}

/**
 * Get session by token (validates signed token, survives restarts)
 */
function getSession(token) {
    if (!token) return null;
    
    // Check cache first
    const cached = sessionCache.get(token);
    if (cached) {
        if (Date.now() > cached.expiresAt) {
            sessionCache.delete(token);
            return null;
        }
        return cached;
    }
    
    // Parse and validate signed token (works even after restart)
    const payload = parseSignedToken(token);
    if (!payload || !payload.userId || !payload.exp) return null;
    
    const expiresAt = Number(payload.exp);
    if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return null;
    
    // Reconstruct session from token
    const session = {
        token,
        userId: payload.userId,
        username: payload.username,
        discriminator: payload.discriminator || '0',
        avatar: payload.avatar,
        globalName: payload.globalName,
        accessToken: null, // Not stored in token for security
        refreshToken: null,
        createdAt: payload.iat || Date.now(),
        expiresAt
    };
    
    // Cache for future lookups
    sessionCache.set(token, session);
    return session;
}

/**
 * Delete session
 */
function deleteSession(token) {
    sessionCache.delete(token);
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

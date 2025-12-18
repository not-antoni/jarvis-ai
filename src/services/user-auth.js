'use strict';

/**
 * User Authentication Service for Website
 * Discord OAuth for users to execute commands from the web
 * Uses signed JWT-like tokens that survive server restarts
 */

const crypto = require('crypto');
const logger = require('../utils/logger');

// Session cache (for faster validation, but tokens are self-contained)
const sessionCache = new Map();
const SESSION_DURATION_MS = parseInt(process.env.SESSION_DURATION_DAYS || '30', 10) * 24 * 60 * 60 * 1000;
const CACHE_MAX_SIZE = 10000;

// Token version store for session revocation (userId -> version)
const tokenVersions = new Map();

// Discord OAuth config
const DISCORD_API = 'https://discord.com/api/v10';
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || '';
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || '';
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 'http://localhost:3000';

// Cached signing key (computed once)
let _signingKey = null;

/**
 * Get signing key for session tokens
 * @throws {Error} If no secret is configured
 */
function getSigningKey() {
    if (_signingKey) {
        return _signingKey;
    }
    
    const raw = process.env.USER_SESSION_SECRET || process.env.MASTER_KEY_BASE64;
    if (!raw) {
        throw new Error('USER_SESSION_SECRET or MASTER_KEY_BASE64 must be set for session signing (do not use DISCORD_TOKEN)');
    }
    _signingKey = crypto.createHash('sha256').update(raw).digest();
    return _signingKey;
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
 * Parse and verify signed token (timing-safe)
 */
function parseSignedToken(token) {
    if (!token || typeof token !== 'string') {
        return null;
    }
    const parts = token.split('.');
    if (parts.length !== 2) {
        return null;
    }
    
    const [data, signature] = parts;
    
    try {
        const expectedSig = crypto.createHmac('sha256', getSigningKey()).update(data).digest('base64url');
        const sigBuffer = Buffer.from(signature, 'base64url');
        const expectedBuffer = Buffer.from(expectedSig, 'base64url');
        
        // Timing-safe comparison to prevent timing attacks
        if (sigBuffer.length !== expectedBuffer.length || 
            !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
            return null;
        }
        
        return JSON.parse(Buffer.from(data, 'base64url').toString());
    } catch {
        return null;
    }
}

/**
 * Generate a signed CSRF state token
 */
function generateState(returnUrl = '/') {
    const payload = {
        r: returnUrl,
        t: Date.now(),
        n: crypto.randomBytes(8).toString('hex')
    };
    return createSignedToken(payload);
}

/**
 * Validate and parse CSRF state token
 * @returns {Object|null} Parsed state with returnUrl, or null if invalid
 */
function validateState(state) {
    if (!state) {
        return null;
    }
    
    const payload = parseSignedToken(state);
    if (!payload || !payload.t) {
        return null;
    }
    
    // State tokens expire after 10 minutes
    const STATE_TTL = 10 * 60 * 1000;
    if (Date.now() - payload.t > STATE_TTL) {
        logger.warn('OAuth state token expired');
        return null;
    }
    
    return { returnUrl: payload.r || '/' };
}

/**
 * Get OAuth authorization URL
 * @param {string} returnUrl - URL to redirect to after auth
 * @returns {{url: string, state: string}} Auth URL and state token
 */
function getOAuthUrl(returnUrl = '/') {
    const redirectUri = `${PUBLIC_BASE_URL}/auth/callback`;
    const scopes = ['identify', 'guilds'];
    const state = generateState(returnUrl);
    
    const params = new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: scopes.join(' '),
        state
    });
    
    return {
        url: `https://discord.com/oauth2/authorize?${params.toString()}`,
        state
    };
}

/**
 * Exchange code for access token
 */
async function exchangeCode(code) {
    const redirectUri = `${PUBLIC_BASE_URL}/auth/callback`;
    
    let response;
    try {
        response = await fetch(`${DISCORD_API}/oauth2/token`, {
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
    } catch (error) {
        logger.error('OAuth token exchange network error', { error: error.message });
        throw new Error(`OAuth token exchange failed: ${error.message}`);
    }
    
    if (!response.ok) {
        const error = await response.text();
        logger.error('OAuth token exchange failed', { status: response.status, error });
        throw new Error(`OAuth token exchange failed: ${error}`);
    }
    
    return await response.json();
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
        const error = await response.text().catch(() => 'Unknown error');
        logger.error('Failed to fetch Discord user', { status: response.status, error });
        throw new Error('Failed to fetch Discord user');
    }
    
    return await response.json();
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
        const error = await response.text().catch(() => 'Unknown error');
        logger.warn('Failed to fetch Discord guilds', { status: response.status, error });
        return [];
    }
    
    return await response.json();
}

/**
 * Get current token version for a user (for session revocation)
 */
function getTokenVersion(userId) {
    return tokenVersions.get(userId) || 0;
}

/**
 * Increment token version to revoke all existing sessions for a user
 */
function revokeAllUserSessions(userId) {
    const currentVersion = getTokenVersion(userId);
    tokenVersions.set(userId, currentVersion + 1);
    
    // Clear cached sessions for this user
    for (const [token, session] of sessionCache.entries()) {
        if (session.userId === userId) {
            sessionCache.delete(token);
        }
    }
    
    logger.info('Revoked all sessions for user', { userId });
    return currentVersion + 1;
}

/**
 * Create user session (returns signed token that survives restarts)
 */
function createSession(user, accessToken, refreshToken, expiresIn = null) {
    const now = Date.now();
    const tokenVersion = getTokenVersion(user.id);
    
    const payload = {
        v: 1,
        userId: user.id,
        username: user.username,
        discriminator: user.discriminator || '0',
        avatar: user.avatar,
        globalName: user.global_name,
        tv: tokenVersion,
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
        accessTokenExpiresAt: expiresIn ? now + (expiresIn * 1000) : null,
        tokenVersion,
        createdAt: now,
        expiresAt: payload.exp
    };
    
    // Evict expired sessions first, then oldest if still over limit
    evictExpiredSessions();
    if (sessionCache.size >= CACHE_MAX_SIZE) {
        const firstKey = sessionCache.keys().next().value;
        sessionCache.delete(firstKey);
    }
    sessionCache.set(token, session);
    
    logger.info('Created session for user', { userId: user.id, username: user.username });
    return session;
}

/**
 * Evict expired sessions from cache
 */
function evictExpiredSessions() {
    const now = Date.now();
    let evicted = 0;
    for (const [token, session] of sessionCache.entries()) {
        if (now > session.expiresAt) {
            sessionCache.delete(token);
            evicted++;
        }
    }
    return evicted;
}

/**
 * Get session by token (validates signed token, survives restarts)
 */
function getSession(token) {
    if (!token) {
        return null;
    }
    
    // Check cache first
    const cached = sessionCache.get(token);
    if (cached) {
        if (Date.now() > cached.expiresAt) {
            sessionCache.delete(token);
            return null;
        }
        // Check token version for revocation
        if (cached.tokenVersion !== getTokenVersion(cached.userId)) {
            sessionCache.delete(token);
            return null;
        }
        return cached;
    }
    
    // Parse and validate signed token (works even after restart)
    const payload = parseSignedToken(token);
    if (!payload || !payload.userId || !payload.exp) {
        return null;
    }
    
    const expiresAt = Number(payload.exp);
    if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) {
        return null;
    }
    
    // Check token version for revocation
    const tokenVersion = payload.tv || 0;
    if (tokenVersion !== getTokenVersion(payload.userId)) {
        return null;
    }
    
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
        tokenVersion,
        createdAt: payload.iat || Date.now(),
        expiresAt
    };
    
    // Cache for future lookups (with size check)
    if (sessionCache.size < CACHE_MAX_SIZE) {
        sessionCache.set(token, session);
    }
    return session;
}

/**
 * Delete session
 */
function deleteSession(token) {
    const session = sessionCache.get(token);
    if (session) {
        logger.info('Deleted session for user', { userId: session.userId });
    }
    sessionCache.delete(token);
}

/**
 * Refresh Discord access token using refresh token
 */
async function refreshAccessToken(refreshToken) {
    if (!refreshToken) {
        throw new Error('No refresh token provided');
    }
    
    let response;
    try {
        response = await fetch(`${DISCORD_API}/oauth2/token`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
                client_id: DISCORD_CLIENT_ID,
                client_secret: DISCORD_CLIENT_SECRET,
                grant_type: 'refresh_token',
                refresh_token: refreshToken
            })
        });
    } catch (error) {
        logger.error('Failed to refresh access token - network error', { error: error.message });
        throw new Error(`Failed to refresh access token: ${error.message}`);
    }
    
    if (!response.ok) {
        const error = await response.text().catch(() => 'Unknown error');
        logger.error('Failed to refresh access token', { status: response.status, error });
        throw new Error('Failed to refresh access token');
    }
    
    const data = await response.json();
    logger.info('Successfully refreshed access token');
    return data;
}

/**
 * Refresh a session's access token if needed and cached
 * @returns {Object|null} Updated session or null if refresh not possible
 */
async function refreshSessionIfNeeded(token) {
    const session = sessionCache.get(token);
    if (!session || !session.refreshToken) {
        return null;
    }
    
    // Check if access token is expired or expiring soon (within 5 minutes)
    const now = Date.now();
    const REFRESH_BUFFER = 5 * 60 * 1000;
    
    if (session.accessTokenExpiresAt && now < session.accessTokenExpiresAt - REFRESH_BUFFER) {
        return session; // Token still valid
    }
    
    try {
        const tokenData = await refreshAccessToken(session.refreshToken);
        
        // Update cached session
        session.accessToken = tokenData.access_token;
        session.refreshToken = tokenData.refresh_token || session.refreshToken;
        session.accessTokenExpiresAt = now + (tokenData.expires_in * 1000);
        
        return session;
    } catch (error) {
        logger.warn('Session refresh failed', { userId: session.userId, error: error.message });
        return null;
    }
}

/**
 * Get session from request (cookie or header)
 */
function getSessionFromRequest(req) {
    // Try cookie first
    const cookieToken = req.cookies?.jarvis_session;
    if (cookieToken) {
        const session = getSession(cookieToken);
        if (session) {
            return session;
        }
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
    if (!user || !user.userId) {
        return 'https://cdn.discordapp.com/embed/avatars/0.png';
    }
    if (user.avatar) {
        const ext = user.avatar.startsWith('a_') ? 'gif' : 'png';
        return `https://cdn.discordapp.com/avatars/${user.userId}/${user.avatar}.${ext}`;
    }
    // Default avatar based on user ID
    try {
        const defaultIndex = (BigInt(user.userId) >> 22n) % 6n;
        return `https://cdn.discordapp.com/embed/avatars/${defaultIndex}.png`;
    } catch {
        return 'https://cdn.discordapp.com/embed/avatars/0.png';
    }
}

/**
 * Check if OAuth is configured
 */
function isOAuthConfigured() {
    return !!(DISCORD_CLIENT_ID && DISCORD_CLIENT_SECRET);
}

/**
 * Prune expired sessions from cache
 */
function pruneSessions() {
    const evicted = evictExpiredSessions();
    if (evicted > 0) {
        logger.debug('Pruned expired sessions', { count: evicted });
    }
}

// Prune sessions every 5 minutes (unref to not keep process alive)
setInterval(pruneSessions, 5 * 60 * 1000).unref();

module.exports = {
    getOAuthUrl,
    validateState,
    exchangeCode,
    getDiscordUser,
    getDiscordGuilds,
    createSession,
    getSession,
    deleteSession,
    getSessionFromRequest,
    getAvatarUrl,
    isOAuthConfigured,
    refreshAccessToken,
    refreshSessionIfNeeded,
    revokeAllUserSessions,
    PUBLIC_BASE_URL
};

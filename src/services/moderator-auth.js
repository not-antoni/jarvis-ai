/**
 * Moderator Dashboard Authentication Service
 * 
 * Production (Render): Discord OAuth + password
 * Selfhost: Password-only mode (user ID + password)
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Check mode
const SELFHOST_MODE = String(process.env.SELFHOST_MODE || '').toLowerCase() === 'true';
const LOCAL_DB_MODE = String(process.env.LOCAL_DB_MODE || '').toLowerCase() === '1';

// Session storage (in-memory for simplicity, could be Redis in production)
const sessions = new Map();
const SESSION_DURATION_MS = 12 * 60 * 60 * 1000; // 12 hours

// Pending password setups (userId -> { token, expires })
const pendingSetups = new Map();

// Database
let database = null;
const COLLECTION_NAME = 'moderatorAuth';

// Discord OAuth configuration (client id can be derived from the bot if not set)
let discordClientId = null;

// Local file storage for selfhost
const DATA_DIR = path.join(__dirname, '../../data');
const AUTH_FILE = path.join(DATA_DIR, 'moderator-auth.json');

/**
 * Initialize database connection
 */
async function initDatabase() {
    try {
        if (!SELFHOST_MODE && !LOCAL_DB_MODE) {
            database = require('./database');
        }
    } catch (error) {
        console.error('[ModeratorAuth] Failed to initialize database:', error);
    }
}

// Initialize on load
initDatabase();

/**
 * Hash password with salt
 */
function hashPassword(password, salt = null) {
    salt = salt || crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
    return { hash, salt };
}

/**
 * Verify password
 */
function verifyPassword(password, storedHash, salt) {
    const { hash } = hashPassword(password, salt);
    return hash === storedHash;
}

/**
 * Generate session token
 */
function generateSessionToken() {
    return crypto.randomBytes(32).toString('hex');
}

function base64urlEncode(input) {
    const buffer = Buffer.isBuffer(input) ? input : Buffer.from(String(input));
    return buffer
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
}

function base64urlDecode(input) {
    const str = String(input || '').replace(/-/g, '+').replace(/_/g, '/');
    const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
    return Buffer.from(str + pad, 'base64');
}

function getSessionSigningKey() {
    const raw = (process.env.MODERATOR_SESSION_SECRET || process.env.MASTER_KEY_BASE64 || process.env.DISCORD_TOKEN || '').trim();
    if (!raw) {
        throw new Error('No session signing secret configured');
    }

    if ((process.env.MODERATOR_SESSION_SECRET || process.env.MASTER_KEY_BASE64) && /^[A-Za-z0-9+/=]+$/.test(raw)) {
        try {
            const decoded = Buffer.from(raw, 'base64');
            if (decoded.length >= 32) {
                return decoded;
            }
        } catch {
            // fall through
        }
    }

    return crypto.createHash('sha256').update(raw).digest();
}

function signSessionPayload(payloadBase64) {
    return crypto
        .createHmac('sha256', getSessionSigningKey())
        .update(payloadBase64)
        .digest();
}

function createSignedSessionToken(sessionPayload) {
    const payloadBase64 = base64urlEncode(Buffer.from(JSON.stringify(sessionPayload)));
    const sigBase64 = base64urlEncode(signSessionPayload(payloadBase64));
    return `${payloadBase64}.${sigBase64}`;
}

function parseSignedSessionToken(token) {
    const raw = String(token || '');
    const parts = raw.split('.');
    if (parts.length !== 2) {
        return null;
    }

    const [payloadBase64, sigBase64] = parts;
    if (!payloadBase64 || !sigBase64) {
        return null;
    }

    const expectedSig = signSessionPayload(payloadBase64);
    const providedSig = base64urlDecode(sigBase64);

    if (providedSig.length !== expectedSig.length || !crypto.timingSafeEqual(providedSig, expectedSig)) {
        return null;
    }

    try {
        const payload = JSON.parse(base64urlDecode(payloadBase64).toString('utf8'));
        return payload;
    } catch {
        return null;
    }
}

/**
 * Generate setup token for DM password setup
 */
function generateSetupToken(userId) {
    const token = crypto.randomBytes(16).toString('hex');
    pendingSetups.set(userId, {
        token,
        expires: Date.now() + 30 * 60 * 1000 // 30 minutes
    });
    return token;
}

/**
 * Verify setup token
 */
function verifySetupToken(userId, token) {
    const setup = pendingSetups.get(userId);
    if (!setup) return false;
    if (Date.now() > setup.expires) {
        pendingSetups.delete(userId);
        return false;
    }
    if (setup.token !== token) return false;
    pendingSetups.delete(userId);
    return true;
}

// Data sync service for robust MongoDB ↔ local migration
const dataSync = require('./data-sync');

/**
 * Load auth data from storage (uses smart read for automatic sync)
 */
async function loadAuthData() {
    try {
        const preferLocal = SELFHOST_MODE || LOCAL_DB_MODE;
        const data = await dataSync.smartRead(COLLECTION_NAME, preferLocal);
        
        // Handle different data formats
        if (data) {
            if (Array.isArray(data) && data.length > 0) {
                // MongoDB array format - find authData doc
                const authDoc = data.find(d => d._id === 'authData');
                return authDoc || { users: {} };
            }
            return data;
        }
    } catch (error) {
        console.error('[ModeratorAuth] Failed to load auth data:', error);
    }
    return { users: {} };
}

/**
 * Save auth data to storage (uses smart write - saves to both)
 */
async function saveAuthData(data) {
    try {
        // Add _id for MongoDB compatibility
        const dataWithId = { ...data, _id: 'authData' };
        await dataSync.smartWrite(COLLECTION_NAME, dataWithId);
    } catch (error) {
        console.error('[ModeratorAuth] Failed to save auth data:', error);
    }
}

/**
 * Check if user has password set
 */
async function hasPassword(userId) {
    const data = await loadAuthData();
    return !!data.users[userId]?.passwordHash;
}

/**
 * Set password for user
 */
async function setPassword(userId, password) {
    const data = await loadAuthData();
    const { hash, salt } = hashPassword(password);
    
    if (!data.users[userId]) {
        data.users[userId] = {};
    }
    
    data.users[userId].passwordHash = hash;
    data.users[userId].passwordSalt = salt;
    data.users[userId].passwordSetAt = new Date().toISOString();
    
    await saveAuthData(data);
    return true;
}

/**
 * Verify user password
 */
async function verifyUserPassword(userId, password) {
    const data = await loadAuthData();
    const user = data.users[userId];
    
    if (!user?.passwordHash || !user?.passwordSalt) {
        return false;
    }
    
    return verifyPassword(password, user.passwordHash, user.passwordSalt);
}

/**
 * Create session for user
 */
function createSession(userId, discordData = null) {
    const now = Date.now();
    const sessionPayload = {
        v: 1,
        userId,
        discordData,
        iat: now,
        exp: now + SESSION_DURATION_MS
    };

    const token = createSignedSessionToken(sessionPayload);
    sessions.set(token, {
        userId,
        discordData,
        createdAt: now,
        expiresAt: sessionPayload.exp
    });
    return token;
}

/**
 * Validate session
 */
function validateSession(token) {
    const cached = sessions.get(token);
    if (cached) {
        if (Date.now() > cached.expiresAt) {
            sessions.delete(token);
            return null;
        }
        return cached;
    }

    const payload = parseSignedSessionToken(token);
    if (!payload || !payload.userId || !payload.exp) {
        return null;
    }

    const expiresAt = Number(payload.exp);
    if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) {
        return null;
    }

    const session = {
        userId: payload.userId,
        discordData: payload.discordData || null,
        createdAt: Number(payload.iat) || Date.now(),
        expiresAt
    };

    sessions.set(token, session);
    return session;
}

/**
 * Destroy session
 */
function destroySession(token) {
    sessions.delete(token);
}

function resolveDiscordClientId() {
    const fromEnv = (
        process.env.DISCORD_CLIENT_ID ||
        process.env.DISCORD_APP_ID ||
        process.env.DISCORD_APPLICATION_ID ||
        process.env.APPLICATION_ID ||
        ''
    ).trim();

    return fromEnv || (discordClientId ? String(discordClientId).trim() : '');
}

function setDiscordClient(client) {
    try {
        const derived = client?.application?.id || client?.user?.id;
        if (derived) {
            discordClientId = String(derived);
        }
    } catch {
        // ignore
    }
}

/**
 * Get Discord OAuth URL
 */
function getOAuthUrl(state) {
    const clientId = resolveDiscordClientId();
    if (!clientId) {
        throw new Error('DISCORD_CLIENT_ID is not configured');
    }
    const redirectUri = getRedirectUri();
    
    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'identify guilds',
        state
    });
    
    return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

/**
 * Get redirect URI based on environment
 */
function getRedirectUri() {
    if (process.env.DASHBOARD_DOMAIN) {
        return `${process.env.DASHBOARD_DOMAIN}/moderator/callback`;
    }
    
    // Auto-detect Render URL
    if (process.env.RENDER_EXTERNAL_URL) {
        return `${process.env.RENDER_EXTERNAL_URL}/moderator/callback`;
    }
    
    // Fallback to localhost
    const port = process.env.PORT || 3000;
    return `http://localhost:${port}/moderator/callback`;
}

/**
 * Exchange OAuth code for tokens
 */
async function exchangeCode(code) {
    const fetch = require('node-fetch');

    const clientId = resolveDiscordClientId();
    if (!clientId) {
        throw new Error('DISCORD_CLIENT_ID is not configured');
    }
    if (!process.env.DISCORD_CLIENT_SECRET) {
        throw new Error('DISCORD_CLIENT_SECRET is not configured');
    }
    
    const params = new URLSearchParams({
        client_id: clientId,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: getRedirectUri()
    });
    
    const response = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params
    });
    
    if (!response.ok) {
        throw new Error('Failed to exchange code');
    }
    
    return response.json();
}

/**
 * Get Discord user info
 */
async function getDiscordUser(accessToken) {
    const fetch = require('node-fetch');
    
    const response = await fetch('https://discord.com/api/users/@me', {
        headers: { Authorization: `Bearer ${accessToken}` }
    });
    
    if (!response.ok) {
        throw new Error('Failed to get user info');
    }
    
    return response.json();
}

/**
 * Check if user is authorized moderator
 */
async function isAuthorizedModerator(userId, guildId) {
    const moderation = require('./GUILDS_FEATURES/moderation');
    const status = moderation.getStatus(guildId);
    
    if (!status.isEnabled) return false;
    
    // Check if user is in pingUsers
    if (status.settings.pingUsers?.includes(userId)) {
        return true;
    }
    
    // Owner always has access
    // (This would need guild data to check, handled in route)
    
    return false;
}

/**
 * Send password setup DM via Jarvis
 */
async function sendPasswordSetupDM(client, userId, guildId) {
    try {
        const user = await client.users.fetch(userId);
        if (!user) return false;
        
        const token = generateSetupToken(userId);
        const baseUrl = getRedirectUri().replace('/moderator/callback', '');
        const setupUrl = `${baseUrl}/moderator/setup?userId=${userId}&token=${token}`;
        
        await user.send({
            content: `🔐 **Sir, you've been granted access to the Moderator Dashboard.**\n\nPlease set up your password to secure your account:\n${setupUrl}\n\n*This link expires in 30 minutes.*\n\n— Jarvis Security System`
        });
        
        return true;
    } catch (error) {
        console.error('[ModeratorAuth] Failed to send setup DM:', error);
        return false;
    }
}

module.exports = {
    SELFHOST_MODE: SELFHOST_MODE || LOCAL_DB_MODE,
    hashPassword,
    verifyPassword,
    generateSessionToken,
    generateSetupToken,
    verifySetupToken,
    hasPassword,
    setPassword,
    verifyUserPassword,
    createSession,
    validateSession,
    destroySession,
    setDiscordClient,
    getOAuthUrl,
    getRedirectUri,
    exchangeCode,
    getDiscordUser,
    isAuthorizedModerator,
    sendPasswordSetupDM
};

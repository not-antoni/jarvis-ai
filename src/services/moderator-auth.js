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
const SESSION_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

// Pending password setups (userId -> { token, expires })
const pendingSetups = new Map();

// Database
let database = null;
const COLLECTION_NAME = 'moderatorAuth';

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
    const token = generateSessionToken();
    sessions.set(token, {
        userId,
        discordData,
        createdAt: Date.now(),
        expiresAt: Date.now() + SESSION_DURATION_MS
    });
    return token;
}

/**
 * Validate session
 */
function validateSession(token) {
    const session = sessions.get(token);
    if (!session) return null;
    
    if (Date.now() > session.expiresAt) {
        sessions.delete(token);
        return null;
    }
    
    return session;
}

/**
 * Destroy session
 */
function destroySession(token) {
    sessions.delete(token);
}

/**
 * Get Discord OAuth URL
 */
function getOAuthUrl(state) {
    const clientId = process.env.DISCORD_CLIENT_ID;
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
    
    const params = new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
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
    getOAuthUrl,
    getRedirectUri,
    exchangeCode,
    getDiscordUser,
    isAuthorizedModerator,
    sendPasswordSetupDM
};

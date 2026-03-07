const crypto = require('crypto');

// Check mode
const SELFHOST_MODE = String(process.env.SELFHOST_MODE || '').toLowerCase() === 'true';
const LOCAL_DB_MODE = String(process.env.LOCAL_DB_MODE || '').toLowerCase() === '1';

// Session storage (in-memory for simplicity, could be Redis in production)
const sessions = new Map();
const revokedSessions = new Map();
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const AUTH_PRUNE_INTERVAL_MS = Math.max(
    60 * 1000,
    Number(process.env.MODERATOR_AUTH_PRUNE_INTERVAL_MS || '') || 5 * 60 * 1000
);
const SESSION_CACHE_MAX = Math.max(
    500,
    Number(process.env.MODERATOR_SESSION_CACHE_MAX || '') || 5000
);
let lastAuthPruneAt = 0;

function pruneAuthMaps(force = false) {
    const now = Date.now();
    if (!force && now - lastAuthPruneAt < AUTH_PRUNE_INTERVAL_MS) {
        return;
    }
    lastAuthPruneAt = now;

    for (const [token, session] of sessions.entries()) {
        const expiresAt = Number(session?.expiresAt || 0);
        if (!expiresAt || !Number.isFinite(expiresAt) || now > expiresAt) {
            sessions.delete(token);
        }
    }

    for (const [token, revokedUntil] of revokedSessions.entries()) {
        const until = Number(revokedUntil || 0);
        if (!until || !Number.isFinite(until) || now >= until) {
            revokedSessions.delete(token);
        }
    }

    if (sessions.size > SESSION_CACHE_MAX) {
        const overflow = sessions.size - SESSION_CACHE_MAX;
        let i = 0;
        for (const key of sessions.keys()) {
            sessions.delete(key);
            i += 1;
            if (i >= overflow) {break;}
        }
    }
}

const authPruneTimer = setInterval(() => pruneAuthMaps(true), AUTH_PRUNE_INTERVAL_MS);
if (typeof authPruneTimer.unref === 'function') {
    authPruneTimer.unref();
}

// Discord OAuth configuration (client id can be derived from the bot if not set)
let discordClientId = null;

async function initDatabase() {
    try {
        if (!SELFHOST_MODE && !LOCAL_DB_MODE) {
            require('./database');
        }
    } catch (error) {
        console.error('[ModeratorAuth] Failed to initialize database:', error);
    }
}

// Initialize on load
initDatabase();

function base64urlEncode(input) {
    const buffer = Buffer.isBuffer(input) ? input : Buffer.from(String(input));
    return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64urlDecode(input) {
    const str = String(input || '')
        .replace(/-/g, '+')
        .replace(/_/g, '/');
    const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
    return Buffer.from(str + pad, 'base64');
}

function getSessionSigningKey() {
    // SECURITY: Only use dedicated secrets for session signing
    // Do NOT use DISCORD_TOKEN - it may be exposed in logs and would allow session forgery
    const raw = (
        process.env.MODERATOR_SESSION_SECRET ||
        process.env.MASTER_KEY_BASE64 ||
        ''
    ).trim();
    if (!raw) {
        throw new Error('MODERATOR_SESSION_SECRET or MASTER_KEY_BASE64 is required for session signing');
    }

    if (
        (process.env.MODERATOR_SESSION_SECRET || process.env.MASTER_KEY_BASE64) &&
        /^[A-Za-z0-9+/=]+$/.test(raw)
    ) {
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
    return crypto.createHmac('sha256', getSessionSigningKey()).update(payloadBase64).digest();
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

    if (
        providedSig.length !== expectedSig.length ||
        !crypto.timingSafeEqual(providedSig, expectedSig)
    ) {
        return null;
    }

    try {
        const payload = JSON.parse(base64urlDecode(payloadBase64).toString('utf8'));
        return payload;
    } catch {
        return null;
    }
}

function createSession(userId, discordData = null) {
    pruneAuthMaps();
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

function validateSession(token) {
    pruneAuthMaps();
    const revokedUntil = revokedSessions.get(token);
    if (revokedUntil) {
        if (Date.now() < revokedUntil) {
            return null;
        }
        revokedSessions.delete(token);
    }

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

function destroySession(token) {
    pruneAuthMaps();
    sessions.delete(token);

    const payload = parseSignedSessionToken(token);
    const exp = payload?.exp ? Number(payload.exp) : null;
    if (Number.isFinite(exp) && exp > Date.now()) {
        revokedSessions.set(token, exp);
    } else {
        revokedSessions.delete(token);
    }
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

function getOAuthUrl(state, redirectPath = '/moderator/callback') {
    const clientId = resolveDiscordClientId();
    if (!clientId) {
        throw new Error('DISCORD_CLIENT_ID is not configured');
    }
    const redirectUri = getRedirectUri(redirectPath);

    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'identify guilds',
        state
    });

    return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

function getRedirectUri(redirectPath = '/moderator/callback') {
    const normalizedPath = String(redirectPath || '/moderator/callback');

    // Priority: DASHBOARD_DOMAIN > PUBLIC_BASE_URL > RENDER_EXTERNAL_URL > localhost
    if (process.env.DASHBOARD_DOMAIN) {
        return `${process.env.DASHBOARD_DOMAIN.replace(/\/$/, '')}${normalizedPath}`;
    }

    // Selfhost: use PUBLIC_BASE_URL
    if (process.env.PUBLIC_BASE_URL) {
        return `${process.env.PUBLIC_BASE_URL.replace(/\/$/, '')}${normalizedPath}`;
    }

    // Auto-detect Render URL
    if (process.env.RENDER_EXTERNAL_URL) {
        return `${process.env.RENDER_EXTERNAL_URL}${normalizedPath}`;
    }

    // Fallback to localhost (dev only)
    const port = process.env.PORT || 3000;
    return `http://localhost:${port}${normalizedPath}`;
}

async function exchangeCode(code, redirectPath = '/moderator/callback') {
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
        redirect_uri: getRedirectUri(redirectPath)
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

module.exports = {
    SELFHOST_MODE: SELFHOST_MODE || LOCAL_DB_MODE,
    createSession,
    validateSession,
    destroySession,
    setDiscordClient,
    getOAuthUrl,
    exchangeCode,
    getDiscordUser
};

const express = require('express');
const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const path = require('path');
const cookieParser = require('cookie-parser');

const router = express.Router();
const appContext = require('../core/app-context');
const auth = require('../services/moderator-auth');
const config = require('../../config');
const database = require('../services/database');
const { mountFeatureRoutes } = require('./jarvis-api-routes');

router.use(cookieParser());
router.use(express.json({ limit: '1mb' }));

const jarvisAuditLog = [];
const jarvisRateBuckets = new Map();
const jarvisSnapshotBuckets = new Map();

let jarvisRateBucketsLastPruneAt = 0;
const JARVIS_RATE_BUCKET_PRUNE_INTERVAL_MS = 5 * 60 * 1000;
const JARVIS_RATE_BUCKET_MAX = Math.max(
    1000,
    Number(process.env.JARVIS_RATE_BUCKET_MAX || '') || 5000
);

let jarvisSnapshotBucketsLastPruneAt = 0;
const JARVIS_SNAPSHOT_BUCKET_PRUNE_INTERVAL_MS = 10 * 60 * 1000;
const JARVIS_SNAPSHOT_BUCKET_TTL_MS = Math.max(
    60 * 60 * 1000,
    Number(process.env.JARVIS_SNAPSHOT_BUCKET_TTL_MS || '') || 24 * 60 * 60 * 1000
);
const JARVIS_SNAPSHOT_BUCKET_MAX = Math.max(
    1000,
    Number(process.env.JARVIS_SNAPSHOT_BUCKET_MAX || '') || 5000
);

function pruneJarvisRateBuckets(now) {
    if (now - jarvisRateBucketsLastPruneAt < JARVIS_RATE_BUCKET_PRUNE_INTERVAL_MS) {
        return;
    }
    jarvisRateBucketsLastPruneAt = now;

    for (const [key, bucket] of jarvisRateBuckets.entries()) {
        const bucketResetAt = Number(bucket?.resetAt || 0);
        if (!bucketResetAt || !Number.isFinite(bucketResetAt) || now >= bucketResetAt) {
            jarvisRateBuckets.delete(key);
        }
    }

    if (jarvisRateBuckets.size > JARVIS_RATE_BUCKET_MAX) {
        const entries = Array.from(jarvisRateBuckets.entries());
        entries.sort(
            (a, b) => Number(a?.[1]?.lastSeenAt || 0) - Number(b?.[1]?.lastSeenAt || 0)
        );
        const overflow = jarvisRateBuckets.size - JARVIS_RATE_BUCKET_MAX;
        for (let i = 0; i < overflow; i += 1) {
            jarvisRateBuckets.delete(entries[i][0]);
        }
    }
}

function pruneJarvisSnapshotBuckets(now) {
    if (now - jarvisSnapshotBucketsLastPruneAt < JARVIS_SNAPSHOT_BUCKET_PRUNE_INTERVAL_MS) {
        return;
    }
    jarvisSnapshotBucketsLastPruneAt = now;

    for (const [key, bucket] of jarvisSnapshotBuckets.entries()) {
        const lastWriteAt = Number(bucket?.lastWriteAt || 0);
        if (!lastWriteAt || !Number.isFinite(lastWriteAt) || now - lastWriteAt > JARVIS_SNAPSHOT_BUCKET_TTL_MS) {
            jarvisSnapshotBuckets.delete(key);
        }
    }

    if (jarvisSnapshotBuckets.size > JARVIS_SNAPSHOT_BUCKET_MAX) {
        const entries = Array.from(jarvisSnapshotBuckets.entries());
        entries.sort(
            (a, b) => Number(a?.[1]?.lastWriteAt || 0) - Number(b?.[1]?.lastWriteAt || 0)
        );
        const overflow = jarvisSnapshotBuckets.size - JARVIS_SNAPSHOT_BUCKET_MAX;
        for (let i = 0; i < overflow; i += 1) {
            jarvisSnapshotBuckets.delete(entries[i][0]);
        }
    }
}

let jarvisSnapshotIndexesReady = false;

function getSnapshotCollection() {
    if (!database?.isConnected || !database?.db) {
        return null;
    }
    if (typeof database.getCollection === 'function') {
        return database.getCollection('jarvis_owner_snapshots');
    }
    if (typeof database.db.collection === 'function') {
        return database.db.collection('jarvis_owner_snapshots');
    }
    return null;
}

async function ensureSnapshotIndexes(collection) {
    if (jarvisSnapshotIndexesReady) {return;}
    jarvisSnapshotIndexesReady = true;
    await collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }).catch(err => {
        console.warn('[Jarvis] Failed to create TTL index:', err?.message || err);
    });
    await collection.createIndex({ updatedAt: -1 }).catch(err => {
        console.warn('[Jarvis] Failed to create updatedAt index:', err?.message || err);
    });
}

async function saveJarvisSnapshot(key, payload, opts = {}) {
    const safeKey = String(key || '').trim();
    if (!safeKey) {return false;}

    const maxBytes = Math.max(1024, Number(opts.maxBytes || 512 * 1024));
    const ttlMs = Math.max(60 * 1000, Number(opts.ttlMs || 6 * 60 * 60 * 1000));
    const minWriteMs = Math.max(250, Number(opts.minWriteMs || 5000));

    let json = '';
    try {
        json = JSON.stringify(payload);
    } catch {
        return false;
    }
    if (Buffer.byteLength(json, 'utf8') > maxBytes) {
        return false;
    }

    const collection = getSnapshotCollection();
    if (!collection) {return false;}
    await ensureSnapshotIndexes(collection);

    const now = Date.now();
    pruneJarvisSnapshotBuckets(now);
    const hash = crypto.createHash('sha256').update(json).digest('hex');

    const bucket = jarvisSnapshotBuckets.get(safeKey);
    if (bucket && now - bucket.lastWriteAt < minWriteMs && bucket.lastHash === hash) {
        return false;
    }

    jarvisSnapshotBuckets.set(safeKey, { lastWriteAt: now, lastHash: hash });

    const doc = {
        _id: safeKey,
        key: safeKey,
        payload,
        payloadHash: hash,
        sizeBytes: Buffer.byteLength(json, 'utf8'),
        updatedAt: new Date(now),
        expiresAt: new Date(now + ttlMs)
    };

    await collection.replaceOne({ _id: safeKey }, doc, { upsert: true });
    return true;
}

function getClientIp(req) {
    const xf = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
    return xf || req.ip || req.connection?.remoteAddress || 'unknown';
}

function recordAuditEvent(req, action, data) {
    const entry = {
        ts: Date.now(),
        userId: req.session?.userId || null,
        ip: getClientIp(req),
        action: String(action || ''),
        data: data || null
    };
    jarvisAuditLog.push(entry);
    if (jarvisAuditLog.length > 500) {jarvisAuditLog.splice(0, jarvisAuditLog.length - 500);}
    return entry;
}

function rateLimit({ keyPrefix, max, windowMs }) {
    return (req, res, next) => {
        const ip = getClientIp(req);
        const key = `${String(keyPrefix || 'rl')}:${ip}`;
        const now = Date.now();
        pruneJarvisRateBuckets(now);
        const bucket = jarvisRateBuckets.get(key);
        if (!bucket || now >= bucket.resetAt) {
            const resolvedWindow = Number(windowMs || 60000);
            jarvisRateBuckets.set(key, {
                count: 1,
                resetAt: now + resolvedWindow,
                windowMs: resolvedWindow,
                lastSeenAt: now
            });
            return next();
        }
        bucket.count += 1;
        bucket.lastSeenAt = now;
        if (bucket.count > Number(max || 60)) {
            return res.status(429).json({ ok: false, error: 'rate_limited' });
        }
        return next();
    };
}

function requireCsrf(req, res, next) {
    const expected = req.session?.csrfToken ? String(req.session.csrfToken) : '';
    const provided = String(req.headers?.['x-csrf-token'] || req.body?.csrfToken || req.body?._csrf || '');
    if (!expected || !provided || provided !== expected) {
        return res.status(403).json({ ok: false, error: 'bad_csrf' });
    }
    return next();
}

function shouldUseSecureCookies(req) {
    if (req?.secure) {return true;}
    if (String(req?.headers?.['x-forwarded-proto'] || '').toLowerCase() === 'https') {return true;}
    if (process.env.DASHBOARD_DOMAIN && process.env.DASHBOARD_DOMAIN.startsWith('https://')) {return true;}
    return false;
}

function getCookieOptions(req, overrides = {}) {
    return {
        httpOnly: true,
        sameSite: 'lax',
        secure: shouldUseSecureCookies(req),
        path: '/',
        ...overrides
    };
}

function getOwnerId() {
    return String(config?.admin?.userId || '').trim();
}

function getDiscordClient() {
    return appContext.getClient();
}

function getDiscordHandlers() {
    return appContext.getHandlers();
}


const { getLoginPage, getPanelPage } = require('./jarvis-panel-html');

async function resolveDiscordUserData(userId) {
    const client = getDiscordClient();
    if (!client?.users?.fetch) {return { id: String(userId) };}

    const user = await client.users.fetch(String(userId)).catch(err => {
        console.warn('[Jarvis] Failed to fetch user:', userId, err?.message || err);
        return null;
    });
    if (!user) {return { id: String(userId) };}

    return {
        id: user.id,
        username: user.username,
        global_name: user.globalName || null,
        avatar: user.avatar || null
    };
}

async function requireOwner(req, res, next) {
    const token = req.cookies?.jarvis_owner_session;
    if (!token) {
        const accept = String(req.headers?.accept || '');
        if (accept.includes('application/json')) {
            return res.status(401).json({ ok: false, error: 'not_authenticated' });
        }
        return res.redirect('/jarvis?error=not_authenticated');
    }

    const session = auth.validateSession(token);
    if (!session) {
        res.clearCookie('jarvis_owner_session', { path: '/' });
        const accept = String(req.headers?.accept || '');
        if (accept.includes('application/json')) {
            return res.status(401).json({ ok: false, error: 'session_expired' });
        }
        return res.redirect('/jarvis?error=session_expired');
    }

    const ownerId = getOwnerId();
    if (!ownerId || String(session.userId) !== ownerId) {
        res.clearCookie('jarvis_owner_session', { path: '/' });
        auth.destroySession(token);
        const accept = String(req.headers?.accept || '');
        if (accept.includes('application/json')) {
            return res.status(403).json({ ok: false, error: 'unauthorized' });
        }
        return res.redirect('/jarvis?error=unauthorized');
    }

    if (!session.csrfToken) {
        session.csrfToken = crypto.randomBytes(24).toString('hex');
    }

    req.session = session;

    try {
        const d = req.session.discordData;
        const hasIdentity = Boolean(d && d.id);
        const hasName = Boolean(d && (d.global_name || d.username));
        const hasAvatar = Boolean(d && (d.avatar || d.avatar_url));

        if (!hasIdentity || !hasName || !hasAvatar) {
            const resolved = await resolveDiscordUserData(req.session.userId);
            if (resolved && resolved.id) {
                req.session.discordData = {
                    ...(req.session.discordData || {}),
                    ...resolved
                };
            }
        }
    } catch {
    }

    next();
}



router.get('/', async(req, res) => {
    const token = req.cookies?.jarvis_owner_session;
    if (token) {
        const session = auth.validateSession(token);
        if (session && String(session.userId) === getOwnerId()) {
            return res.redirect('/jarvis/panel');
        }
    }

    const { error } = req.query;
    const errorMessages = {
        not_authenticated: 'Please log in to access the owner console.',
        session_expired: 'Your session has expired. Please log in again.',
        unauthorized: 'You are not authorized to access this console.',
        oauth_failed: 'Discord authentication failed. Please try again.',
        owner_not_configured: 'Owner ID is not configured.'
    };

    const state = crypto.randomBytes(16).toString('hex');
    res.cookie('jarvis_oauth_state', state, getCookieOptions(req, { maxAge: 600000 }));

    const ownerId = getOwnerId();
    if (!ownerId) {
        return res.send(getLoginPage({ oauthUrl: '', errorMsg: errorMessages.owner_not_configured }));
    }

    let oauthUrl = '';
    let errorMsg = errorMessages[error] || '';

    try {
        oauthUrl = auth.getOAuthUrl(state, '/jarvis/callback');
    } catch (e) {
        errorMsg = errorMsg || `Discord OAuth is not configured: ${e.message}`;
    }

    res.send(getLoginPage({ oauthUrl, errorMsg }));
});

router.get('/callback', async(req, res) => {
    const { code, state } = req.query;
    const storedState = req.cookies?.jarvis_oauth_state;
    res.clearCookie('jarvis_oauth_state', { path: '/' });

    if (!state || state !== storedState) {
        return res.redirect('/jarvis?error=oauth_failed');
    }

    try {
        const tokens = await auth.exchangeCode(code, '/jarvis/callback');
        const discordUser = await auth.getDiscordUser(tokens.access_token);

        const ownerId = getOwnerId();
        if (!ownerId || String(discordUser.id) !== ownerId) {
            return res.redirect('/jarvis?error=unauthorized');
        }

        const sessionToken = auth.createSession(discordUser.id, discordUser);
        res.cookie('jarvis_owner_session', sessionToken, getCookieOptions(req, { maxAge: 12 * 60 * 60 * 1000 }));

        res.redirect('/jarvis/panel');
    } catch (error) {
        console.error('[JarvisOwner] OAuth callback error:', error);
        res.redirect('/jarvis?error=oauth_failed');
    }
});

router.get('/panel', requireOwner, (req, res) => {
    res.send(getPanelPage(req.session));
});

router.get('/api/identity', requireOwner, (req, res) => {
    res.json({
        ok: true,
        ownerId: getOwnerId(),
        userId: req.session.userId,
        discord: req.session.discordData || null
    });
});

router.get('/api/csrf', requireOwner, (req, res) => {
    res.json({ ok: true, csrfToken: req.session.csrfToken });
});

router.get('/api/cache/:key', requireOwner, async(req, res) => {
    const rawKey = String(req.params?.key || '').trim();
    if (!rawKey || rawKey.length > 120 || !/^[a-zA-Z0-9._-]+$/.test(rawKey)) {
        return res.status(400).json({ ok: false, error: 'invalid_key' });
    }
    const collection = getSnapshotCollection();
    if (!collection) {
        return res.status(503).json({ ok: false, error: 'mongo_unavailable' });
    }
    try {
        const doc = await collection.findOne({ _id: rawKey });
        if (!doc) {
            return res.status(404).json({ ok: false, error: 'not_found' });
        }
        return res.json({
            ok: true,
            key: doc.key,
            updatedAt: doc.updatedAt ? new Date(doc.updatedAt).getTime() : null,
            expiresAt: doc.expiresAt ? new Date(doc.expiresAt).getTime() : null,
            sizeBytes: doc.sizeBytes || null,
            payload: doc.payload || null
        });
    } catch (e) {
        return res.status(500).json({ ok: false, error: e?.message || 'failed' });
    }
});

router.get('/api/audit', requireOwner, (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit || 100), 1), 500);
    const events = jarvisAuditLog.slice(-limit);
    const payload = { ok: true, count: events.length, events };
    res.json(payload);
    saveJarvisSnapshot('audit', payload).catch(err => {
        console.warn('[Jarvis] Failed to save audit snapshot:', err?.message || err);
    });
});

router.get('/api/stats', requireOwner, (req, res) => {
    const client = getDiscordClient();

    const now = Date.now();
    const uptimeMs = process.uptime() * 1000;

    const discordStats = { guilds: 0, users: 0, channels: 0, ready: false, tag: null };
    if (client && typeof client.isReady === 'function' && client.isReady()) {
        discordStats.ready = true;
        discordStats.tag = client.user?.tag || null;
        discordStats.guilds = client.guilds?.cache?.size || 0;
        discordStats.channels = client.channels?.cache?.size || 0;
        try {
            discordStats.users = client.guilds.cache.reduce((acc, g) => acc + (g.memberCount || 0), 0);
        } catch {
            discordStats.users = 0;
        }
    }

    res.json({
        ok: true,
        now,
        uptimeMs,
        nodeVersion: process.version,
        platform: process.platform,
        memory: {
            rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
            heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
            heapTotalMb: Math.round(process.memoryUsage().heapTotal / 1024 / 1024)
        },
        cpu: {
            load1: os.loadavg()[0],
            cores: os.cpus().length
        },
        discord: discordStats
    });
});

router.get('/api/guilds', requireOwner, (req, res) => {
    const client = getDiscordClient();
    if (!client || typeof client.isReady !== 'function' || !client.isReady()) {
        return res.json({ ok: true, ready: false, guilds: [] });
    }

    const guilds = Array.from(client.guilds.cache.values()).map(g => ({
        id: g.id,
        name: g.name,
        memberCount: g.memberCount || 0,
        icon: typeof g.iconURL === 'function' ? g.iconURL({ size: 64 }) : null,
        ownerId: g.ownerId
    }));

    res.json({ ok: true, ready: true, count: guilds.length, guilds });
});

function listLocalCommandFiles() {
    const baseDir = path.join(__dirname, '..', 'commands');
    const found = [];

    function walk(dir) {
        const entries = fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : [];
        for (const entry of entries) {
            if (entry.name.startsWith('.')) {continue;}
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(full);
                continue;
            }
            if (entry.isFile() && entry.name.endsWith('.js')) {
                const rel = path.relative(baseDir, full).replace(/\\/g, '/');
                found.push(rel);
            }
        }
    }

    walk(baseDir);
    return found.sort();
}

router.get('/api/commands', requireOwner, async(req, res) => {
    const client = getDiscordClient();

    let registered = [];
    if (client && typeof client.isReady === 'function' && client.isReady()) {
        try {
            const commands = await client.application?.commands?.fetch().catch(err => {
                console.warn('[Jarvis] Failed to fetch commands:', err?.message || err);
                return null;
            });
            if (commands && typeof commands.values === 'function') {
                registered = Array.from(commands.values()).map(cmd => ({
                    id: cmd.id,
                    name: cmd.name,
                    description: cmd.description || '',
                    type: cmd.type
                }));
            }
        } catch {
            registered = [];
        }
    }

    const localFiles = listLocalCommandFiles();

    res.json({
        ok: true,
        registered,
        localFiles
    });
});

mountFeatureRoutes(router, { requireOwner, rateLimit, requireCsrf, recordAuditEvent, saveJarvisSnapshot, getDiscordClient, getDiscordHandlers });

router.post('/logout', (req, res) => {
    const token = req.cookies?.jarvis_owner_session;
    if (token) {
        auth.destroySession(token);
    }
    res.clearCookie('jarvis_owner_session', { path: '/' });
    res.redirect('/jarvis');
});

module.exports = router;

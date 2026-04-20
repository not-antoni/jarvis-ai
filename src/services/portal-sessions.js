'use strict';

/**
 * Session + CSRF state store for the web portal.
 *
 * - Sessions are stored in MongoDB when available (TTL index handles expiry),
 *   with a best-effort in-memory fallback so the portal stays usable when the
 *   database is offline.
 * - Session IDs are 32-hex (128 bits). Cookies carry only the id, never the
 *   Discord access token — tokens stay server-side.
 * - CSRF state tokens are short-lived and kept in memory only.
 */

const crypto = require('crypto');
const database = require('./database');
const config = require('../../config');
const logger = require('../utils/logger');

const log = logger.child({ module: 'portal-sessions' });

const SESSION_TTL_MS = Number(process.env.PORTAL_SESSION_TTL_MS) || 7 * 24 * 60 * 60_000; // 7 days
const STATE_TTL_MS = Number(process.env.PORTAL_STATE_TTL_MS) || 10 * 60_000;

const memorySessions = new Map(); // sid → record
const stateStore = new Map(); // state → { createdAt, returnTo }

function generateId(bytes = 16) {
    return crypto.randomBytes(bytes).toString('hex');
}

// Sweep memory stores periodically. Runs on the interval that already exists
// for the bot's main loop via timers.
setInterval(() => {
    const now = Date.now();
    for (const [sid, record] of memorySessions) {
        if (record.expiresAt.getTime() <= now) {memorySessions.delete(sid);}
    }
    for (const [state, record] of stateStore) {
        if (now - record.createdAt > STATE_TTL_MS) {stateStore.delete(state);}
    }
}, 5 * 60_000).unref();

function sessionsCollection() {
    if (!database.isConnected || !database.db) {return null;}
    return database.db.collection(config.database.collections.portalSessions);
}

async function createSession(data) {
    const sid = generateId(16);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
    const record = {
        sid,
        userId: String(data.userId || ''),
        username: String(data.username || '').slice(0, 64),
        globalName: data.globalName ? String(data.globalName).slice(0, 64) : null,
        avatar: data.avatar ? String(data.avatar).slice(0, 128) : null,
        discordAccessToken: data.discordAccessToken || null,
        discordRefreshToken: data.discordRefreshToken || null,
        discordTokenExpiresAt: data.discordTokenExpiresAt || null,
        createdAt: now,
        updatedAt: now,
        expiresAt
    };
    const collection = sessionsCollection();
    if (collection) {
        try {
            await collection.insertOne({ ...record });
        } catch (error) {
            log.warn('DB session insert failed, using memory fallback', { err: error });
            memorySessions.set(sid, record);
        }
    } else {
        memorySessions.set(sid, record);
    }
    return record;
}

async function getSession(sid) {
    if (!sid || typeof sid !== 'string') {return null;}
    const collection = sessionsCollection();
    if (collection) {
        try {
            const doc = await collection.findOne({ sid });
            if (!doc) {return null;}
            if (doc.expiresAt && new Date(doc.expiresAt).getTime() <= Date.now()) {
                await collection.deleteOne({ sid }).catch(() => {});
                return null;
            }
            return doc;
        } catch (error) {
            log.warn('DB session fetch failed, trying memory fallback', { err: error });
        }
    }
    const record = memorySessions.get(sid);
    if (!record) {return null;}
    if (record.expiresAt.getTime() <= Date.now()) {
        memorySessions.delete(sid);
        return null;
    }
    return record;
}

async function deleteSession(sid) {
    if (!sid) {return;}
    const collection = sessionsCollection();
    if (collection) {
        await collection.deleteOne({ sid }).catch(() => {});
    }
    memorySessions.delete(sid);
}

async function refreshSession(sid) {
    const session = await getSession(sid);
    if (!session) {return null;}
    const newExpiresAt = new Date(Date.now() + SESSION_TTL_MS);
    const collection = sessionsCollection();
    if (collection) {
        await collection.updateOne(
            { sid },
            { $set: { updatedAt: new Date(), expiresAt: newExpiresAt } }
        ).catch(() => {});
    }
    const memRecord = memorySessions.get(sid);
    if (memRecord) {
        memRecord.expiresAt = newExpiresAt;
        memRecord.updatedAt = new Date();
    }
    return { ...session, expiresAt: newExpiresAt };
}

// ─── CSRF state (in-memory only — short-lived) ──────────────────────────────

function createState({ returnTo = '/portal' } = {}) {
    const state = generateId(24);
    stateStore.set(state, { createdAt: Date.now(), returnTo: String(returnTo).slice(0, 500) });
    return state;
}

function consumeState(state) {
    if (!state || typeof state !== 'string') {return null;}
    const record = stateStore.get(state);
    if (!record) {return null;}
    stateStore.delete(state);
    if (Date.now() - record.createdAt > STATE_TTL_MS) {return null;}
    return record;
}

module.exports = {
    SESSION_TTL_MS,
    createSession,
    getSession,
    deleteSession,
    refreshSession,
    createState,
    consumeState,
    _internals: { memorySessions, stateStore }
};

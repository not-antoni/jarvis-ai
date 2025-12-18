'use strict';

const config = require('../../config');
const database = require('./database');
const localdb = require('../localdb');
const { safeSend } = require('../utils/discord-safe-send');

const DEFAULT_TICK_MS = 15 * 1000;
const DEFAULT_LOCK_MS = 60 * 1000;
const DEFAULT_MEMORY_THRESHOLD_MS = 10 * 60 * 1000;

const memoryJobs = new Map();
const memoryJobTimeouts = new Map();

let schedulerState = {
    started: false,
    tickHandle: null,
    client: null,
    database: null,
    lastConnectAttemptAt: 0,
    warnedNotConnected: false,
    tickMs: DEFAULT_TICK_MS,
    memoryThresholdMs: DEFAULT_MEMORY_THRESHOLD_MS
};

function ensureConnected() {
    return Boolean(
        schedulerState.database && schedulerState.database.isConnected && schedulerState.database.db
    );
}

function clearMemoryTimeout(id) {
    const handle = memoryJobTimeouts.get(String(id));
    if (handle) {
        clearTimeout(handle);
    }
    memoryJobTimeouts.delete(String(id));
}

async function runMemoryAnnouncement(id) {
    const job = memoryJobs.get(String(id));
    if (!job || !job.enabled) {
        clearMemoryTimeout(id);
        return;
    }

    const nowDate = new Date();
    const nextRunAt = job.nextRunAt ? new Date(job.nextRunAt) : null;
    if (nextRunAt && nextRunAt.getTime() - nowDate.getTime() > 250) {
        scheduleMemoryAnnouncement(job);
        return;
    }

    const lockedUntil = job.lockedUntil ? new Date(job.lockedUntil) : null;
    if (lockedUntil && lockedUntil > nowDate) {
        scheduleMemoryAnnouncement(job);
        return;
    }

    job.lockedUntil = new Date(nowDate.getTime() + DEFAULT_LOCK_MS);
    job.updatedAt = nowDate;
    memoryJobs.set(job.id, job);
    clearMemoryTimeout(id);

    const result = await deliverAnnouncement(job);
    await completeMemoryAnnouncement(job, { now: nowDate, success: result.ok, error: result.error });

    const refreshed = memoryJobs.get(String(id));
    if (refreshed && refreshed.enabled) {
        scheduleMemoryAnnouncement(refreshed);
    } else {
        clearMemoryTimeout(id);
    }
}

function scheduleMemoryAnnouncement(job) {
    if (!job || !job.id) return;
    clearMemoryTimeout(job.id);
    if (!job.enabled || !job.nextRunAt) return;

    const nextRunMs = new Date(job.nextRunAt).getTime();
    const lockedUntilMs = job.lockedUntil ? new Date(job.lockedUntil).getTime() : 0;
    const targetMs = Math.max(nextRunMs, lockedUntilMs);
    const delayMs = Math.max(0, targetMs - Date.now());
    const handle = setTimeout(() => {
        runMemoryAnnouncement(job.id).catch((error) => {
            console.warn('[Announcements] Memory job failed:', error?.message || error);
        });
    }, delayMs);
    memoryJobTimeouts.set(String(job.id), handle);
}

function getCollection() {
    if (!ensureConnected()) {
        return null;
    }
    return schedulerState.database.db.collection(config.database.collections.announcements);
}

function normalizeUnit(unit) {
    const raw = String(unit || '').toLowerCase();
    if (raw === 'second' || raw === 'seconds') return 'seconds';
    if (raw === 'minute' || raw === 'minutes') return 'minutes';
    if (raw === 'hour' || raw === 'hours') return 'hours';
    if (raw === 'day' || raw === 'days') return 'days';
    if (raw === 'week' || raw === 'weeks') return 'weeks';
    if (raw === 'month' || raw === 'months') return 'months';
    return null;
}

function addInterval(date, amount, unit) {
    const normalized = normalizeUnit(unit);
    const n = Number(amount);
    if (!normalized || !Number.isFinite(n) || n <= 0) {
        return null;
    }

    const d = new Date(date);
    switch (normalized) {
        case 'seconds':
            d.setTime(d.getTime() + n * 1000);
            return d;
        case 'minutes':
            d.setTime(d.getTime() + n * 60 * 1000);
            return d;
        case 'hours':
            d.setTime(d.getTime() + n * 60 * 60 * 1000);
            return d;
        case 'days':
            d.setDate(d.getDate() + n);
            return d;
        case 'weeks':
            d.setDate(d.getDate() + n * 7);
            return d;
        case 'months':
            d.setMonth(d.getMonth() + n);
            return d;
        default:
            return null;
    }
}

async function claimDueAnnouncements({
    now = new Date(),
    limit = 10,
    lockMs = DEFAULT_LOCK_MS
} = {}) {
    const collection = getCollection();
    if (!collection) {
        return [];
    }

    const nowDate = now instanceof Date ? now : new Date(now);
    const lockUntil = new Date(nowDate.getTime() + lockMs);

    const claimed = [];

    for (let i = 0; i < limit; i += 1) {
        const res = await collection.findOneAndUpdate(
            {
                enabled: true,
                nextRunAt: { $lte: nowDate },
                $or: [
                    { lockedUntil: { $exists: false } },
                    { lockedUntil: null },
                    { lockedUntil: { $lte: nowDate } }
                ]
            },
            {
                $set: {
                    lockedUntil: lockUntil,
                    updatedAt: new Date()
                }
            },
            {
                sort: { nextRunAt: 1 },
                returnDocument: 'after'
            }
        );

        const doc = res && res.value ? res.value : null;
        if (!doc) {
            break;
        }

        claimed.push(doc);
    }

    return claimed;
}

async function claimDueMemoryAnnouncements({
    now = new Date(),
    limit = 10,
    lockMs = DEFAULT_LOCK_MS
} = {}) {
    const nowDate = now instanceof Date ? now : new Date(now);
    const lockUntil = new Date(nowDate.getTime() + lockMs);

    const candidates = [];
    for (const job of memoryJobs.values()) {
        if (!job || !job.enabled) continue;
        if (!job.nextRunAt || new Date(job.nextRunAt) > nowDate) continue;

        const lockedUntil = job.lockedUntil ? new Date(job.lockedUntil) : null;
        if (lockedUntil && lockedUntil > nowDate) continue;

        candidates.push(job);
    }

    candidates.sort((a, b) => new Date(a.nextRunAt).getTime() - new Date(b.nextRunAt).getTime());

    const claimed = [];
    for (const job of candidates.slice(0, limit)) {
        const stored = memoryJobs.get(job.id);
        if (!stored) continue;

        stored.lockedUntil = lockUntil;
        stored.updatedAt = new Date();
        memoryJobs.set(stored.id, stored);
        claimed.push(stored);
    }

    return claimed;
}

async function deliverAnnouncement(doc) {
    if (!schedulerState.client) {
        return { ok: false, error: new Error('Discord client not attached') };
    }

    const guildId = doc.guildId;
    const channelId = doc.channelId;

    const channel = await schedulerState.client.channels.fetch(channelId).catch(() => null);
    if (!channel || typeof channel.send !== 'function') {
        return { ok: false, error: new Error('Target channel not found or not sendable') };
    }

    const roleIds = Array.isArray(doc.roleIds) ? doc.roleIds.filter(Boolean) : [];
    const roleMentions = roleIds.length ? roleIds.map(id => `<@&${id}>`).join(' ') : '';
    const content = [roleMentions, doc.message].filter(Boolean).join(' ');

    try {
        const result = await safeSend(channel, {
            content,
            allowedMentions: {
                parse: ['users', 'everyone'],
                roles: roleIds
            }
        }, schedulerState.client);
        return result;
    } catch (error) {
        return { ok: false, error };
    }
}

async function completeAnnouncement(doc, { now = new Date(), success = true, error = null } = {}) {
    const collection = getCollection();
    if (!collection) {
        return;
    }

    const nowDate = now instanceof Date ? now : new Date(now);

    const repeatEvery = doc.repeatEvery;
    const repeatUnit = doc.repeatUnit;

    const updates = {
        updatedAt: nowDate,
        lockedUntil: null
    };

    if (success) {
        updates.lastRunAt = nowDate;
        updates.errorCount = 0;

        if (repeatEvery && repeatUnit) {
            const next = addInterval(nowDate, repeatEvery, repeatUnit);
            updates.nextRunAt = next;
            updates.enabled = Boolean(next);
        } else {
            await collection.deleteOne({ id: doc.id }).catch(() => null);
            return;
        }
    } else {
        const currentErrors = Number(doc.errorCount) || 0;
        const nextErrorCount = currentErrors + 1;
        updates.errorCount = nextErrorCount;
        updates.lastError = error ? String(error.message || error) : 'Unknown error';

        if (nextErrorCount >= 5) {
            updates.enabled = false;
            updates.nextRunAt = null;
        } else {
            updates.nextRunAt = new Date(nowDate.getTime() + 5 * 60 * 1000);
        }
    }

    await collection.updateOne({ id: doc.id }, { $set: updates });
}

async function completeMemoryAnnouncement(
    doc,
    { now = new Date(), success = true, error = null } = {}
) {
    if (!doc || !doc.id) return;

    const nowDate = now instanceof Date ? now : new Date(now);
    const stored = memoryJobs.get(doc.id);
    if (!stored) return;

    stored.updatedAt = nowDate;
    stored.lockedUntil = null;

    const repeatEvery = stored.repeatEvery;
    const repeatUnit = stored.repeatUnit;

    if (success) {
        stored.lastRunAt = nowDate;
        stored.errorCount = 0;
        stored.lastError = null;

        if (repeatEvery && repeatUnit) {
            const next = addInterval(nowDate, repeatEvery, repeatUnit);
            stored.nextRunAt = next;
            stored.enabled = Boolean(next);
            memoryJobs.set(stored.id, stored);
            return;
        }

        memoryJobs.delete(stored.id);
        return;
    }

    const currentErrors = Number(stored.errorCount) || 0;
    const nextErrorCount = currentErrors + 1;
    stored.errorCount = nextErrorCount;
    stored.lastError = error ? String(error.message || error) : 'Unknown error';

    if (nextErrorCount >= 5) {
        stored.enabled = false;
        stored.nextRunAt = null;
    } else {
        stored.nextRunAt = new Date(nowDate.getTime() + 5 * 60 * 1000);
    }

    memoryJobs.set(stored.id, stored);
}

async function tick() {
    const dueMemory = await claimDueMemoryAnnouncements({ limit: 10 }).catch(() => []);
    for (const job of dueMemory) {
        const result = await deliverAnnouncement(job);
        await completeMemoryAnnouncement(job, { success: result.ok, error: result.error });
    }

    if (!ensureConnected()) {
        const now = Date.now();
        if (schedulerState.database && typeof schedulerState.database.connect === 'function') {
            if (
                !schedulerState.lastConnectAttemptAt ||
                now - schedulerState.lastConnectAttemptAt > 30 * 1000
            ) {
                schedulerState.lastConnectAttemptAt = now;
                await schedulerState.database.connect().catch(() => {});
            }
        }

        if (!ensureConnected()) {
            if (!schedulerState.warnedNotConnected) {
                schedulerState.warnedNotConnected = true;
                console.warn('[Announcements] Scheduler idle - database not connected');
            }
            return;
        }
    }

    schedulerState.warnedNotConnected = false;

    const due = await claimDueAnnouncements({ limit: 10 }).catch(() => []);
    if (!due.length) {
        return;
    }

    for (const job of due) {
        const result = await deliverAnnouncement(job);
        await completeAnnouncement(job, { success: result.ok, error: result.error });
    }
}

async function createAnnouncement(payload) {
    const now = new Date();

    const delayAmount = Number(payload.delayAmount);
    const delayUnit = normalizeUnit(payload.delayUnit);
    if (!delayUnit || !Number.isFinite(delayAmount) || delayAmount <= 0) {
        throw new Error('Invalid delay');
    }

    const nextRunAt = addInterval(now, delayAmount, delayUnit);
    if (!nextRunAt) {
        throw new Error('Unable to compute scheduled time');
    }

    let repeatEvery = null;
    let repeatUnit = null;
    if (payload.repeatEvery != null) {
        const rep = Number(payload.repeatEvery);
        const repUnit = normalizeUnit(payload.repeatUnit);
        if (!repUnit || !Number.isFinite(rep) || rep <= 0) {
            throw new Error('Invalid repeat interval');
        }
        repeatEvery = rep;
        repeatUnit = repUnit;
    }

    const delayMs = new Date(nextRunAt).getTime() - now.getTime();
    const shouldUseMemory = !repeatEvery && delayMs <= schedulerState.memoryThresholdMs;

    const id = shouldUseMemory
        ? `memann_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        : `ann_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const doc = {
        id,
        guildId: String(payload.guildId),
        channelId: String(payload.channelId),
        message: String(payload.message || '').trim(),
        roleIds: Array.isArray(payload.roleIds) ? payload.roleIds.map(String) : [],
        createdByUserId: String(payload.createdByUserId),
        enabled: true,
        createdAt: now,
        updatedAt: now,
        nextRunAt,
        lastRunAt: null,
        lockedUntil: null,
        errorCount: 0,
        lastError: null,
        repeatEvery,
        repeatUnit
    };

    if (!doc.message.length) {
        throw new Error('Message is required');
    }

    if (shouldUseMemory) {
        memoryJobs.set(doc.id, doc);
        scheduleMemoryAnnouncement(doc);
        return doc;
    }

    const collection = getCollection();
    if (!collection) {
        throw new Error('Database not connected');
    }

    await collection.insertOne(doc);
    return doc;
}

async function listAnnouncementsForGuild({ guildId }) {
    const gid = String(guildId);
    const mem = Array.from(memoryJobs.values()).filter(job => job && job.guildId === gid);

    const collection = getCollection();
    const dbJobs = collection
        ? await collection
              .find({ guildId: gid })
              .sort({ createdAt: -1 })
              .limit(100)
              .toArray()
        : [];

    const all = mem.concat(dbJobs);
    all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return all.slice(0, 100);
}

async function listAnnouncementsForUser({ userId, guildId }) {
    const mem = Array.from(memoryJobs.values()).filter(
        job => job && job.createdByUserId === String(userId) && job.guildId === String(guildId)
    );

    const collection = getCollection();
    const dbJobs = collection
        ? await collection
              .find({ createdByUserId: String(userId), guildId: String(guildId) })
              .sort({ createdAt: -1 })
              .limit(50)
              .toArray()
        : [];

    const all = mem.concat(dbJobs);
    all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return all.slice(0, 50);
}

async function setAnnouncementEnabledForGuild({ id, guildId, enabled }) {
    const gid = String(guildId);
    const mem = memoryJobs.get(String(id));
    if (mem && mem.guildId === gid) {
        mem.enabled = Boolean(enabled);
        mem.updatedAt = new Date();
        mem.lockedUntil = null;
        if (enabled && !mem.nextRunAt) {
            mem.nextRunAt = new Date(Date.now() + 60 * 1000);
        }
        memoryJobs.set(mem.id, mem);
        if (enabled) {
            scheduleMemoryAnnouncement(mem);
        } else {
            clearMemoryTimeout(mem.id);
        }
        return { ok: true };
    }

    const collection = getCollection();
    if (!collection) {
        return { ok: false, error: 'Database not connected.' };
    }

    const doc = await collection.findOne({ id: String(id), guildId: gid });
    if (!doc) {
        return { ok: false, error: 'Announcement not found.' };
    }

    const patch = {
        enabled: Boolean(enabled),
        updatedAt: new Date(),
        lockedUntil: null
    };

    if (enabled && !doc.nextRunAt) {
        patch.nextRunAt = new Date(Date.now() + 60 * 1000);
    }

    await collection.updateOne({ id: doc.id }, { $set: patch });
    return { ok: true };
}

async function setAnnouncementEnabled({ id, userId, guildId, enabled }) {
    const mem = memoryJobs.get(String(id));
    if (mem && mem.createdByUserId === String(userId) && mem.guildId === String(guildId)) {
        mem.enabled = Boolean(enabled);
        mem.updatedAt = new Date();
        mem.lockedUntil = null;
        if (enabled && !mem.nextRunAt) {
            mem.nextRunAt = new Date(Date.now() + 60 * 1000);
        }
        memoryJobs.set(mem.id, mem);
        if (enabled) {
            scheduleMemoryAnnouncement(mem);
        } else {
            clearMemoryTimeout(mem.id);
        }
        return { ok: true };
    }

    const collection = getCollection();
    if (!collection) {
        return { ok: false, error: 'Database not connected.' };
    }

    const doc = await collection.findOne({
        id: String(id),
        createdByUserId: String(userId),
        guildId: String(guildId)
    });
    if (!doc) {
        return { ok: false, error: 'Announcement not found.' };
    }

    const patch = {
        enabled: Boolean(enabled),
        updatedAt: new Date(),
        lockedUntil: null
    };

    if (enabled && !doc.nextRunAt) {
        patch.nextRunAt = new Date(Date.now() + 60 * 1000);
    }

    await collection.updateOne({ id: doc.id }, { $set: patch });
    return { ok: true };
}

async function deleteAnnouncementForGuild({ id, guildId }) {
    const gid = String(guildId);
    const mem = memoryJobs.get(String(id));
    if (mem && mem.guildId === gid) {
        memoryJobs.delete(mem.id);
        clearMemoryTimeout(mem.id);
        return { ok: true };
    }

    const collection = getCollection();
    if (!collection) {
        return { ok: false, error: 'Database not connected.' };
    }

    const res = await collection.deleteOne({ id: String(id), guildId: gid });
    if (!res.deletedCount) {
        return { ok: false, error: 'Announcement not found.' };
    }

    return { ok: true };
}

async function deleteAnnouncement({ id, userId, guildId }) {
    const mem = memoryJobs.get(String(id));
    if (mem && mem.createdByUserId === String(userId) && mem.guildId === String(guildId)) {
        memoryJobs.delete(mem.id);
        clearMemoryTimeout(mem.id);
        return { ok: true };
    }

    const collection = getCollection();
    if (!collection) {
        return { ok: false, error: 'Database not connected.' };
    }

    const res = await collection.deleteOne({
        id: String(id),
        createdByUserId: String(userId),
        guildId: String(guildId)
    });
    if (!res.deletedCount) {
        return { ok: false, error: 'Announcement not found.' };
    }

    return { ok: true };
}

async function clearAnnouncementsForGuild({ guildId }) {
    const gid = String(guildId);
    let removedMem = 0;
    for (const [id, job] of memoryJobs.entries()) {
        if (job && job.guildId === gid) {
            memoryJobs.delete(id);
            clearMemoryTimeout(id);
            removedMem += 1;
        }
    }

    const collection = getCollection();
    if (!collection) {
        return { ok: true, removedMem, removedDb: 0, dbAvailable: false };
    }

    const res = await collection.deleteMany({ guildId: gid });
    return {
        ok: true,
        removedMem,
        removedDb: Number(res?.deletedCount) || 0,
        dbAvailable: true
    };
}

async function countEnabledForGuild(guildId) {
    const gid = String(guildId);
    const memCount = Array.from(memoryJobs.values()).filter(
        job => job && job.enabled && job.guildId === gid
    ).length;

    const collection = getCollection();
    if (!collection) return memCount;
    const dbCount = await collection.countDocuments({ guildId: gid, enabled: true });
    return memCount + dbCount;
}

async function countEnabledForChannel(guildId, channelId) {
    const gid = String(guildId);
    const cid = String(channelId);
    const memCount = Array.from(memoryJobs.values()).filter(
        job => job && job.enabled && job.guildId === gid && job.channelId === cid
    ).length;

    const collection = getCollection();
    if (!collection) return memCount;
    const dbCount = await collection.countDocuments({
        guildId: gid,
        channelId: cid,
        enabled: true
    });
    return memCount + dbCount;
}

function init({
    client,
    database,
    tickMs = DEFAULT_TICK_MS,
    memoryThresholdMs = DEFAULT_MEMORY_THRESHOLD_MS,
    startInterval = true
} = {}) {
    if (schedulerState.started) {
        return;
    }

    schedulerState.client = client || null;
    schedulerState.database = database || null;

    const parsedTick = Number(tickMs);
    schedulerState.tickMs = Math.max(
        5000,
        Number.isFinite(parsedTick) ? parsedTick : DEFAULT_TICK_MS
    );

    const parsedThreshold = Number(memoryThresholdMs);
    schedulerState.memoryThresholdMs = Math.max(
        0,
        Number.isFinite(parsedThreshold) ? parsedThreshold : DEFAULT_MEMORY_THRESHOLD_MS
    );

    if (startInterval) {
        schedulerState.tickHandle = setInterval(() => {
            tick().catch(error => {
                console.warn('[Announcements] Tick failed:', error?.message || error);
            });
        }, schedulerState.tickMs);
    }

    schedulerState.started = true;
    console.log('[Announcements] Scheduler started');
}

async function runOnce() {
    return tick();
}

module.exports = {
    init,
    runOnce,
    createAnnouncement,
    listAnnouncementsForGuild,
    listAnnouncementsForUser,
    setAnnouncementEnabledForGuild,
    setAnnouncementEnabled,
    deleteAnnouncementForGuild,
    deleteAnnouncement,
    clearAnnouncementsForGuild,
    countEnabledForGuild,
    countEnabledForChannel,
    addInterval,
    normalizeUnit
};

'use strict';

const config = require('../../config');

const DEFAULT_TICK_MS = 15 * 1000;
const DEFAULT_LOCK_MS = 60 * 1000;

let schedulerState = {
    started: false,
    tickHandle: null,
    client: null,
    database: null,
    lastConnectAttemptAt: 0,
    warnedNotConnected: false
};

function ensureConnected() {
    return Boolean(schedulerState.database && schedulerState.database.isConnected && schedulerState.database.db);
}

function getCollection() {
    if (!ensureConnected()) {
        return null;
    }
    return schedulerState.database.db.collection(config.database.collections.announcements);
}

function normalizeUnit(unit) {
    const raw = String(unit || '').toLowerCase();
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

async function claimDueAnnouncements({ now = new Date(), limit = 10, lockMs = DEFAULT_LOCK_MS } = {}) {
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
    const roleMentions = roleIds.length ? roleIds.map((id) => `<@&${id}>`).join(' ') : '';
    const content = [roleMentions, doc.message].filter(Boolean).join(' ');

    try {
        await channel.send({
            content,
            allowedMentions: {
                parse: [],
                roles: roleIds
            }
        });
        return { ok: true };
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
            updates.enabled = false;
            updates.nextRunAt = null;
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

async function tick() {
    if (!ensureConnected()) {
        const now = Date.now();
        if (schedulerState.database && typeof schedulerState.database.connect === 'function') {
            if (!schedulerState.lastConnectAttemptAt || now - schedulerState.lastConnectAttemptAt > 30 * 1000) {
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
    const collection = getCollection();
    if (!collection) {
        throw new Error('Database not connected');
    }

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

    const id = `ann_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

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

    await collection.insertOne(doc);
    return doc;
}

async function listAnnouncementsForUser({ userId, guildId }) {
    const collection = getCollection();
    if (!collection) {
        return [];
    }

    return collection
        .find({ createdByUserId: String(userId), guildId: String(guildId) })
        .sort({ createdAt: -1 })
        .limit(50)
        .toArray();
}

async function setAnnouncementEnabled({ id, userId, guildId, enabled }) {
    const collection = getCollection();
    if (!collection) {
        throw new Error('Database not connected');
    }

    const doc = await collection.findOne({ id: String(id), createdByUserId: String(userId), guildId: String(guildId) });
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

async function deleteAnnouncement({ id, userId, guildId }) {
    const collection = getCollection();
    if (!collection) {
        throw new Error('Database not connected');
    }

    const res = await collection.deleteOne({ id: String(id), createdByUserId: String(userId), guildId: String(guildId) });
    if (!res.deletedCount) {
        return { ok: false, error: 'Announcement not found.' };
    }

    return { ok: true };
}

async function countEnabledForGuild(guildId) {
    const collection = getCollection();
    if (!collection) return 0;
    return collection.countDocuments({ guildId: String(guildId), enabled: true });
}

async function countEnabledForChannel(guildId, channelId) {
    const collection = getCollection();
    if (!collection) return 0;
    return collection.countDocuments({ guildId: String(guildId), channelId: String(channelId), enabled: true });
}

function init({ client, database, tickMs = DEFAULT_TICK_MS } = {}) {
    if (schedulerState.started) {
        return;
    }

    schedulerState.client = client || null;
    schedulerState.database = database || null;

    schedulerState.tickHandle = setInterval(() => {
        tick().catch((error) => {
            console.warn('[Announcements] Tick failed:', error?.message || error);
        });
    }, Math.max(5000, Number(tickMs) || DEFAULT_TICK_MS));

    schedulerState.started = true;
    console.log('[Announcements] Scheduler started');
}

module.exports = {
    init,
    createAnnouncement,
    listAnnouncementsForUser,
    setAnnouncementEnabled,
    deleteAnnouncement,
    countEnabledForGuild,
    countEnabledForChannel,
    addInterval,
    normalizeUnit
};

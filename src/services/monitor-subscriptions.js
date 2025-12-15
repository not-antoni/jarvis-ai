'use strict';

const config = require('../../config');
const database = require('./database');
const localdb = require('../localdb');

const IS_RENDER = Boolean(process.env.RENDER || process.env.RENDER_SERVICE_ID || process.env.RENDER_EXTERNAL_URL);

const LOCAL_DB_MODE =
    !IS_RENDER &&
    String(process.env.LOCAL_DB_MODE || process.env.ALLOW_START_WITHOUT_DB || '').toLowerCase() === '1';

const VALID_MONITOR_TYPES = new Set(['rss', 'website', 'youtube', 'twitch']);

function assertMonitorType(monitorType) {
    const normalized = String(monitorType || '').trim().toLowerCase();
    if (!VALID_MONITOR_TYPES.has(normalized)) {
        const error = new Error(
            "Invalid monitor_type. Must be one of 'rss', 'website', 'youtube', or 'twitch'."
        );
        error.isFriendly = true;
        throw error;
    }
    return normalized;
}

function normalizeRequired(value, label) {
    const normalized = String(value || '').trim();
    if (!normalized) {
        const error = new Error(`${label} is required.`);
        error.isFriendly = true;
        throw error;
    }
    return normalized;
}

function buildId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function databaseNotConnectedError() {
    const error = new Error('Database not connected.');
    error.isFriendly = true;
    return error;
}

function getMongoCollection() {
    if (!database?.isConnected || !database?.db) {
        return null;
    }
    return database.db.collection(config.database.collections.subscriptions);
}

async function add_subscription({
    guild_id,
    channel_id,
    monitor_type,
    source_id,
    last_seen_data
} = {}) {
    const gid = normalizeRequired(guild_id, 'guild_id');
    const cid = normalizeRequired(channel_id, 'channel_id');
    const type = assertMonitorType(monitor_type);
    const source = normalizeRequired(source_id, 'source_id');

    const now = new Date();

    const collection = getMongoCollection();
    if (collection) {
        const result = await collection.findOneAndUpdate(
            { guild_id: gid, monitor_type: type, source_id: source },
            {
                $setOnInsert: {
                    id: buildId('sub'),
                    guild_id: gid,
                    channel_id: cid,
                    monitor_type: type,
                    source_id: source,
                    last_seen_data: last_seen_data ?? null,
                    createdAt: now
                },
                $set: {
                    channel_id: cid,
                    ...(last_seen_data !== undefined ? { last_seen_data } : {}),
                    updatedAt: now
                }
            },
            { upsert: true, returnDocument: 'after' }
        );

        return result?.value || null;
    }

    if (!LOCAL_DB_MODE) {
        throw databaseNotConnectedError();
    }

    const docs = localdb.readCollection(config.database.collections.subscriptions);
    const idx = docs.findIndex(
        d => d && d.guild_id === gid && d.monitor_type === type && d.source_id === source
    );

    if (idx >= 0) {
        const updated = {
            ...docs[idx],
            channel_id: cid,
            ...(last_seen_data !== undefined ? { last_seen_data } : {}),
            updatedAt: now.toISOString()
        };
        docs[idx] = updated;
        localdb.writeCollection(config.database.collections.subscriptions, docs);
        return updated;
    }

    const doc = {
        id: buildId('sub'),
        guild_id: gid,
        channel_id: cid,
        monitor_type: type,
        source_id: source,
        last_seen_data: last_seen_data ?? null,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString()
    };

    docs.push(doc);
    localdb.writeCollection(config.database.collections.subscriptions, docs);
    return doc;
}

async function remove_subscription({ guild_id, source_id, monitor_type } = {}) {
    const gid = normalizeRequired(guild_id, 'guild_id');
    const source = normalizeRequired(source_id, 'source_id');
    const type = monitor_type ? assertMonitorType(monitor_type) : null;

    const collection = getMongoCollection();
    if (collection) {
        const query = {
            guild_id: gid,
            source_id: source,
            ...(type ? { monitor_type: type } : {})
        };
        const res = await collection.deleteMany(query);
        return { ok: true, removed: Number(res?.deletedCount) || 0 };
    }

    if (!LOCAL_DB_MODE) {
        throw databaseNotConnectedError();
    }

    const docs = localdb.readCollection(config.database.collections.subscriptions);
    const before = docs.length;
    const kept = docs.filter(d => {
        if (!d) return false;
        if (d.guild_id !== gid) return true;
        if (d.source_id !== source) return true;
        if (type && d.monitor_type !== type) return true;
        return false;
    });

    localdb.writeCollection(config.database.collections.subscriptions, kept);
    return { ok: true, removed: before - kept.length };
}

async function remove_subscription_by_id({ id } = {}) {
    const sid = normalizeRequired(id, 'id');

    const collection = getMongoCollection();
    if (collection) {
        const res = await collection.deleteOne({ id: sid });
        return { ok: true, removed: Number(res?.deletedCount) || 0 };
    }

    if (!LOCAL_DB_MODE) {
        throw databaseNotConnectedError();
    }

    const docs = localdb.readCollection(config.database.collections.subscriptions);
    const before = docs.length;
    const kept = docs.filter(d => d && d.id !== sid);
    localdb.writeCollection(config.database.collections.subscriptions, kept);
    return { ok: true, removed: before - kept.length };
}

async function get_all_subscriptions() {
    const collection = getMongoCollection();
    if (collection) {
        return collection.find({}).sort({ createdAt: 1 }).toArray();
    }

    if (!LOCAL_DB_MODE) {
        return [];
    }

    return localdb.readCollection(config.database.collections.subscriptions);
}

async function update_last_seen_data({ id, last_seen_data } = {}) {
    const sid = normalizeRequired(id, 'id');

    const collection = getMongoCollection();
    if (collection) {
        const now = new Date();
        const res = await collection.findOneAndUpdate(
            { id: sid },
            { $set: { last_seen_data: last_seen_data ?? null, updatedAt: now } },
            { returnDocument: 'after' }
        );
        return res?.value || null;
    }

    if (!LOCAL_DB_MODE) {
        throw databaseNotConnectedError();
    }

    const docs = localdb.readCollection(config.database.collections.subscriptions);
    const idx = docs.findIndex(d => d && d.id === sid);
    if (idx < 0) {
        return null;
    }

    const now = new Date();
    docs[idx] = {
        ...docs[idx],
        last_seen_data: last_seen_data ?? null,
        updatedAt: now.toISOString()
    };
    localdb.writeCollection(config.database.collections.subscriptions, docs);
    return docs[idx];
}

module.exports = {
    add_subscription,
    remove_subscription,
    remove_subscription_by_id,
    get_all_subscriptions,
    update_last_seen_data,
    VALID_MONITOR_TYPES
};

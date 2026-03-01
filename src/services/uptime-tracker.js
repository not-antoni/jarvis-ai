'use strict';

const appContext = require('../core/app-context');
const database = require('./database');

const COLLECTION = 'uptimeSnapshots';
const TTL_SECONDS = 60 * 60 * 24 * 90; // 90 days

function evaluateServiceStatus() {
    const client = appContext.getClient();

    // AI Providers
    let aiStatus = 'down';
    try {
        const aiManager = require('./ai-providers');
        const stats = aiManager.getStats();
        const total = stats.providers || 0;
        const active = stats.activeProviders || 0;
        if (active > 0 && active >= Math.ceil(total / 2)) {
            aiStatus = 'operational';
        } else if (active > 0) {
            aiStatus = 'degraded';
        }
    } catch (_) {
        // ai-providers not loaded yet
    }

    // Discord Bot
    const discordOk = !!(client && client.isReady() && client.guilds.cache.size > 0);
    const discordStatus = discordOk ? 'operational' : 'down';

    // Database
    const dbStatus = database.isConnected ? 'operational' : 'down';

    return { ai: aiStatus, discord: discordStatus, database: dbStatus };
}

async function recordSnapshot() {
    if (!database.isConnected) { return; }
    const col = database.getCollection(COLLECTION);
    if (!col) { return; }

    const services = evaluateServiceStatus();
    const now = new Date();

    await col.insertOne({
        timestamp: now,
        date: now.toISOString().slice(0, 10),
        services
    });
}

async function getDailyHistory(days = 90) {
    if (!database.isConnected) { return []; }
    const col = database.getCollection(COLLECTION);
    if (!col) { return []; }

    const since = new Date();
    since.setDate(since.getDate() - days);

    const results = await col.aggregate([
        { $match: { timestamp: { $gte: since } } },
        { $group: {
            _id: '$date',
            total: { $sum: 1 },
            aiOp: { $sum: { $cond: [{ $eq: ['$services.ai', 'operational'] }, 1, 0] } },
            aiDeg: { $sum: { $cond: [{ $eq: ['$services.ai', 'degraded'] }, 1, 0] } },
            aiDown: { $sum: { $cond: [{ $eq: ['$services.ai', 'down'] }, 1, 0] } },
            discordOp: { $sum: { $cond: [{ $eq: ['$services.discord', 'operational'] }, 1, 0] } },
            discordDown: { $sum: { $cond: [{ $eq: ['$services.discord', 'down'] }, 1, 0] } },
            dbOp: { $sum: { $cond: [{ $eq: ['$services.database', 'operational'] }, 1, 0] } },
            dbDown: { $sum: { $cond: [{ $eq: ['$services.database', 'down'] }, 1, 0] } }
        } },
        { $sort: { _id: 1 } }
    ]).toArray();

    return results.map(d => ({
        date: d._id,
        ai: {
            status: d.aiDown > 0 ? 'down' : d.aiDeg > 0 ? 'degraded' : 'operational',
            uptime: ((d.aiOp / d.total) * 100).toFixed(1)
        },
        discord: {
            status: d.discordDown > 0 ? 'down' : 'operational',
            uptime: ((d.discordOp / d.total) * 100).toFixed(1)
        },
        database: {
            status: d.dbDown > 0 ? 'down' : 'operational',
            uptime: ((d.dbOp / d.total) * 100).toFixed(1)
        }
    }));
}

async function ensureIndexes() {
    if (!database.isConnected) { return; }
    const col = database.getCollection(COLLECTION);
    if (!col) { return; }

    await col.createIndex(
        { timestamp: 1 },
        { expireAfterSeconds: TTL_SECONDS, name: 'ttl_90d' }
    );
    await col.createIndex({ date: 1 }, { name: 'idx_date' });
}

module.exports = { recordSnapshot, getDailyHistory, ensureIndexes, evaluateServiceStatus };

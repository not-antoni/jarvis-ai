'use strict';

/**
 * Guild Activity Tracker
 * Tracks per-guild message volume, active hours, and top channels/users.
 * Data is kept in memory with periodic flushes to database.
 */

const { LRUCache } = require('lru-cache');

const guildActivity = new LRUCache({ max: 500, ttl: 1000 * 60 * 60 * 24 }); // 24h TTL

function getGuildData(guildId) {
    let data = guildActivity.get(guildId);
    if (!data) {
        data = {
            guildId,
            messages: 0,
            uniqueUsers: new Set(),
            channelCounts: {},     // channelId -> count
            hourCounts: new Array(24).fill(0),
            lastActivity: Date.now(),
            trackedSince: Date.now()
        };
        guildActivity.set(guildId, data);
    }
    return data;
}

/**
 * Record a message for activity tracking
 */
function recordMessage(guildId, channelId, userId) {
    if (!guildId) {return;}

    const data = getGuildData(guildId);
    data.messages++;
    data.uniqueUsers.add(userId);
    data.channelCounts[channelId] = (data.channelCounts[channelId] || 0) + 1;
    data.hourCounts[new Date().getHours()]++;
    data.lastActivity = Date.now();
}

/**
 * Get activity summary for a guild
 */
function getActivitySummary(guildId) {
    const data = guildActivity.get(guildId);
    if (!data) {
        return null;
    }

    const channelEntries = Object.entries(data.channelCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5);

    const peakHour = data.hourCounts.indexOf(Math.max(...data.hourCounts));
    const trackedMinutes = Math.floor((Date.now() - data.trackedSince) / 60000);

    return {
        guildId: data.guildId,
        totalMessages: data.messages,
        uniqueUsers: data.uniqueUsers.size,
        topChannels: channelEntries.map(([id, count]) => ({ channelId: id, count })),
        peakHour,
        hourDistribution: [...data.hourCounts],
        trackedMinutes,
        messagesPerMinute: trackedMinutes > 0 ? Math.round((data.messages / trackedMinutes) * 100) / 100 : 0,
        lastActivity: data.lastActivity
    };
}

/**
 * Persist activity data to database (call periodically)
 */
async function flushToDatabase(database) {
    if (!database?.isConnected) {return;}

    const flushed = [];
    for (const [guildId] of guildActivity.entries()) {
        const summary = getActivitySummary(guildId);
        if (!summary || summary.totalMessages === 0) {continue;}

        try {
            const col = database.db.collection('guildActivity');
            await col.updateOne(
                { guildId, date: new Date().toISOString().slice(0, 10) },
                {
                    $set: {
                        ...summary,
                        uniqueUsers: summary.uniqueUsers,
                        updatedAt: new Date()
                    },
                    $setOnInsert: { createdAt: new Date() }
                },
                { upsert: true }
            );
            flushed.push(guildId);
        } catch (err) {
            console.warn(`[ActivityTracker] Failed to flush guild ${guildId}:`, err.message);
        }
    }

    return flushed.length;
}

/**
 * Reset tracking data for a guild
 */
function resetGuild(guildId) {
    guildActivity.delete(guildId);
}

module.exports = {
    recordMessage,
    getActivitySummary,
    flushToDatabase,
    resetGuild
};

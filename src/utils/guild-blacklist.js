'use strict';

const { AttachmentBuilder } = require('discord.js');
const database = require('../services/database');
const { isOwner } = require('./owner-check');

function getBlockedUserIds(guildConfig) {
    return Array.isArray(guildConfig?.blockedUserIds) ? guildConfig.blockedUserIds : [];
}

async function isGuildUserBlacklisted(guildId, userId) {
    if (!guildId || !userId || !database.isConnected) {
        return false;
    }

    if (isOwner(userId)) {
        return false;
    }

    try {
        const guildConfig = await database.getGuildConfig(guildId);
        return getBlockedUserIds(guildConfig).includes(userId);
    } catch (error) {
        console.error('Failed to inspect guild blacklist:', error);
        return false;
    }
}

async function resolveBlacklistedUsers(client, ids = []) {
    return Promise.all(ids.map(async (id, index) => {
        let user = client?.users?.cache?.get(id) || null;

        if (!user && client?.users?.fetch) {
            user = await client.users.fetch(id).catch(() => null);
        }

        const label = user?.tag || user?.username || 'Unknown User';

        return {
            id,
            label,
            line: `${index + 1}. ${label} (${id})`
        };
    }));
}

function buildBlacklistAttachment(guild, entries = []) {
    const safeGuildName = String(guild?.name || 'server')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'server';

    const lines = [
        `Jarvis blacklist for ${guild?.name || 'Unknown Server'}`,
        `Guild ID: ${guild?.id || 'Unknown'}`,
        `Generated: ${new Date().toISOString()}`,
        `Total users: ${entries.length}`,
        '',
        ...(entries.length ? entries.map(entry => entry.line) : ['No users are blacklisted.'])
    ];

    return new AttachmentBuilder(Buffer.from(lines.join('\n'), 'utf8'), {
        name: `${safeGuildName}-blacklist.txt`
    });
}

module.exports = {
    getBlockedUserIds,
    isGuildUserBlacklisted,
    resolveBlacklistedUsers,
    buildBlacklistAttachment
};

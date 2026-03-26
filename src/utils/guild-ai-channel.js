'use strict';

const database = require('../services/database');

function getConfiguredAiChannelId(guildConfig) {
    const channelId = guildConfig?.aiChannelId;
    return typeof channelId === 'string' && channelId.length > 0 ? channelId : null;
}

async function resolveActiveAiChannelId(guild) {
    if (!guild?.id || !database.isConnected) {
        return null;
    }

    try {
        const guildConfig = await database.getGuildConfig(guild.id, guild.ownerId);
        const configuredChannelId = getConfiguredAiChannelId(guildConfig);

        if (!configuredChannelId) {
            return null;
        }

        let channel = guild.channels?.cache?.get(configuredChannelId) || null;
        if (!channel && guild.channels?.fetch) {
            channel = await guild.channels.fetch(configuredChannelId).catch(() => null);
        }

        return channel ? configuredChannelId : null;
    } catch (error) {
        console.error('Failed to resolve configured AI channel:', error);
        return null;
    }
}

function isMatchingAiChannel(configuredChannelId, channel) {
    if (!configuredChannelId) {
        return true;
    }

    if (!channel) {
        return false;
    }

    return channel.id === configuredChannelId || channel.parentId === configuredChannelId;
}

module.exports = {
    getConfiguredAiChannelId,
    resolveActiveAiChannelId,
    isMatchingAiChannel
};

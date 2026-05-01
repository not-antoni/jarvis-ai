'use strict';

const database = require('../services/database');
const { isOwner } = require('./owner-check');

function getBlockedAiRoleIds(guildConfig) {
    return Array.isArray(guildConfig?.blockedAiRoleIds)
        ? guildConfig.blockedAiRoleIds
        : [];
}

/**
 * Returns true if the given guild member holds at least one role that is
 * blacklisted from triggering Jarvis AI chat. Bot owners always bypass.
 *
 * Slash commands and other modules are not affected - this only gates the
 * conversational AI (mentions, replies, wake-words, /jarvis prompts).
 */
async function isMemberAiBlacklistedByRole(member) {
    if (!member?.guild?.id || !member?.id) {return false;}
    if (!database.isConnected) {return false;}
    if (isOwner(member.id)) {return false;}

    try {
        const guildConfig = await database.getGuildConfig(member.guild.id);
        const blockedIds = getBlockedAiRoleIds(guildConfig);
        if (blockedIds.length === 0) {return false;}
        const roles = member.roles?.cache;
        if (!roles) {return false;}
        for (const id of blockedIds) {
            if (roles.has(id)) {return true;}
        }
        return false;
    } catch (error) {
        console.error('Failed to evaluate AI role blacklist:', error);
        return false;
    }
}

module.exports = {
    getBlockedAiRoleIds,
    isMemberAiBlacklistedByRole
};

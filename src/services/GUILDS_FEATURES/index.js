/**
 * Guild-Specific Features
 * 
 * This module handles features that are specific to certain Discord guilds.
 * Each guild can have custom features enabled based on their needs.
 */

const guildFeatures = require('./guild-features');
const moderation = require('./moderation');
const antiScam = require('./anti-scam');

module.exports = {
    guildFeatures,
    moderation,
    antiScam,
    
    // Convenience re-exports
    isEnabled: moderation.isEnabled,
    enableModeration: moderation.enableModeration,
    disableModeration: moderation.disableModeration,
    handleMemberJoin: moderation.handleMemberJoin
};

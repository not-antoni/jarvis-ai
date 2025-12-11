/**
 * Guild-Specific Features
 * 
 * This module handles features that are specific to certain Discord guilds.
 * Each guild can have custom features enabled based on their needs.
 */

const guildFeatures = require('./guild-features');

module.exports = {
    guildFeatures,
    // Re-export specific features
    antiScam: require('./anti-scam')
};

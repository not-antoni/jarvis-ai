/**
 * Guild Features Manager
 *
 * Manages which features are enabled for specific guilds.
 * Add guild IDs and their enabled features here.
 */

// Guild-specific feature configurations
const GUILD_CONFIGS = {
    // Guild: 858444090374881301 - Anti-scam and alt detection
    '858444090374881301': {
        name: 'Primary Guild',
        features: {
            antiScam: true,
            altDetection: true,
            newAccountWarnings: true
        },
        // Role IDs to notify about suspicious activity (admins/moderators)
        notifyRoles: [],
        // User IDs to notify (server owner, admins)
        notifyUsers: [],
        settings: {
            // Warn if account was created within this many days
            newAccountThresholdDays: 30,
            // Flag accounts created today
            flagSameDayAccounts: true,
            // Flag accounts created within this year
            flagThisYearAccounts: true
        }
    }
};

/**
 * Check if a feature is enabled for a guild
 * @param {string} guildId - Discord guild ID
 * @param {string} feature - Feature name
 * @returns {boolean}
 */
function isFeatureEnabled(guildId, feature) {
    const config = GUILD_CONFIGS[guildId];
    if (!config) return false;
    return config.features[feature] === true;
}

/**
 * Get guild configuration
 * @param {string} guildId - Discord guild ID
 * @returns {Object|null}
 */
function getGuildConfig(guildId) {
    return GUILD_CONFIGS[guildId] || null;
}

/**
 * Get all guilds with a specific feature enabled
 * @param {string} feature - Feature name
 * @returns {string[]} Array of guild IDs
 */
function getGuildsWithFeature(feature) {
    return Object.keys(GUILD_CONFIGS).filter(
        guildId => GUILD_CONFIGS[guildId].features[feature] === true
    );
}

/**
 * Add or update a guild configuration
 * @param {string} guildId - Discord guild ID
 * @param {Object} config - Guild configuration
 */
function setGuildConfig(guildId, config) {
    GUILD_CONFIGS[guildId] = {
        ...GUILD_CONFIGS[guildId],
        ...config
    };
}

module.exports = {
    GUILD_CONFIGS,
    isFeatureEnabled,
    getGuildConfig,
    getGuildsWithFeature,
    setGuildConfig
};

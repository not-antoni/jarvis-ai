/**
 * Guild Features Manager
 *
 * Manages which features are enabled for specific guilds.
 * Add guild IDs and their enabled features here.
 */

// Guild-specific feature configurations — loaded from env or database at runtime
// Use GUILD_FEATURES_PRIMARY env var to set the primary guild ID
const PRIMARY_GUILD_ID = process.env.GUILD_FEATURES_PRIMARY || '';
const GUILD_CONFIGS = {};
if (PRIMARY_GUILD_ID) {
    GUILD_CONFIGS[PRIMARY_GUILD_ID] = {
        name: 'Primary Guild',
        features: {
            antiScam: true,
            altDetection: true,
            newAccountWarnings: true
        },
        notifyRoles: [],
        notifyUsers: [],
        settings: {
            newAccountThresholdDays: 30,
            flagSameDayAccounts: true,
            flagThisYearAccounts: true
        }
    };
}

// Load additional guilds from .env
const envGuilds = (process.env.MODERATION_GUILD_IDS || '')
    .split(',')
    .map(id => id.trim())
    .filter(id => id.length > 0);

const DEFAULT_CONFIG = {
    features: {
        antiScam: true,
        altDetection: true,
        newAccountWarnings: true
    },
    notifyRoles: [],
    notifyUsers: [],
    settings: {
        newAccountThresholdDays: 30,
        flagSameDayAccounts: true,
        flagThisYearAccounts: true
    }
};

envGuilds.forEach(guildId => {
    if (!GUILD_CONFIGS[guildId]) {
        GUILD_CONFIGS[guildId] = {
            name: 'Whitelisted Guild',
            ...DEFAULT_CONFIG
        };
    }
});

/**
 * Check if a feature is enabled for a guild
 * @param {string} guildId - Discord guild ID
 * @param {string} feature - Feature name
 * @returns {boolean}
 */
function isFeatureEnabled(guildId, feature) {
    const config = GUILD_CONFIGS[guildId];
    if (!config) {return false;}
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

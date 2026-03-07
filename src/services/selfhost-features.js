/**
 * Selfhost-only experimental features for Jarvis AI
 * These features are only available when running in selfhost mode
 */

const config = require('../../config');

/**
 * Dynamic selfhost check - evaluates at runtime, not module load
 * This fixes the issue where SELFHOST_MODE wasn't being respected
 */
function checkSelfhost() {
    const result =
        config?.deployment?.selfhostMode === true ||
        config?.deployment?.target === 'selfhost' ||
        process.env.SELFHOST_MODE === 'true' ||
        process.env.DEPLOY_TARGET === 'selfhost';
    return result;
}

// Log selfhost status on startup (single line)
console.log(
    `[Selfhost] Mode: ${checkSelfhost() ? 'ENABLED' : 'disabled'}, Sentience: enabled=${config?.sentience?.enabled}, guilds: ${config?.sentience?.whitelistedGuilds?.join(', ') || 'none'}`
);

// Make it work with boolean checks like: if (isSelfhost)
Object.defineProperty(module.exports, 'isSelfhost', {
    get: () => checkSelfhost(),
    enumerable: true
});

/**
 * Check if a guild has sentience features enabled
 */
function isSentienceEnabled(guildId) {
    const sentienceConfig = config?.sentience || { enabled: false, whitelistedGuilds: [] };
    const guildIdStr = String(guildId);
    const isEnabled =
        sentienceConfig.enabled &&
        guildId &&
        sentienceConfig.whitelistedGuilds.includes(guildIdStr);

    return isEnabled;
}

module.exports = {
    checkSelfhost,
    isSentienceEnabled
};

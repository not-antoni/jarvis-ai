const config = require('../../config');

const featureFlags = config.features || {};

function isFeatureGloballyEnabled(flag, fallback = true) {
    if (!flag) {
        return fallback;
    }

    if (Object.prototype.hasOwnProperty.call(featureFlags, flag)) {
        return Boolean(featureFlags[flag]);
    }

    return fallback;
}

function isFeatureEnabledForGuild(flag, guildConfig = null, fallback = true) {
    if (!isFeatureGloballyEnabled(flag, fallback)) {
        return false;
    }

    if (!guildConfig || !flag) {
        return fallback;
    }

    const guildFeatures = guildConfig.features;
    if (!guildFeatures || typeof guildFeatures !== 'object') {
        return fallback;
    }

    if (!Object.prototype.hasOwnProperty.call(guildFeatures, flag)) {
        return fallback;
    }

    return Boolean(guildFeatures[flag]);
}

module.exports = {
    isFeatureGloballyEnabled,
    isFeatureEnabledForGuild
};

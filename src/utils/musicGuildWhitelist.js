const DEFAULT_WHITELIST = ['1403664986089324606', '858444090374881301', '833376882896142393'];

function parseEnvList(raw) {
    if (!raw || typeof raw !== 'string') {
        return [];
    }

    return raw
        .split(/[\s,]+/)
        .map(entry => entry.trim())
        .filter(entry => entry.length > 0);
}

const envWhitelist = parseEnvList(process.env.MUSIC_GUILD_WHITELIST);
const whitelist = new Set([...DEFAULT_WHITELIST, ...envWhitelist]);

function isGuildAllowed(guildId) {
    if (!guildId) {
        return false;
    }
    return whitelist.has(String(guildId));
}

function getWhitelistedGuilds() {
    return Array.from(whitelist);
}

module.exports = {
    isGuildAllowed,
    getWhitelistedGuilds
};

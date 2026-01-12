const { PermissionFlagsBits } = require('discord.js');
const database = require('../services/database');

const BOT_OWNER_ID = process.env.BOT_OWNER_ID || '809010595545874432'; // Fallback to provided owner ID

/**
 * Check if a user matches "True Moderator" criteria
 * (Ban, Kick, Maintain Members permissions)
 */
function hasTrueModPerms(member) {
    if (!member) return false;
    return member.permissions.has(PermissionFlagsBits.BanMembers) &&
        member.permissions.has(PermissionFlagsBits.KickMembers) &&
        member.permissions.has(PermissionFlagsBits.ModerateMembers);
}

/**
 * Check if a user is a DJ Administrator (can configure DJ settings)
 * Criteria: Bot Owner OR Guild Owner OR Administrator OR True Mod
 */
function isDjAdmin(member, guildConfig) {
    if (!member) return false;

    // 1. Bot Owner override
    if (member.id === BOT_OWNER_ID) return true;

    // 2. Guild Owner override
    if (member.guild.ownerId === member.id) return true;

    // 3. Configured Owner Match
    if (guildConfig && guildConfig.ownerId === member.id) return true;

    // 4. Administrator Permission
    if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;

    // 5. "True Mod" check
    if (hasTrueModPerms(member)) return true;

    return false;
}

/**
 * Check if a user is authorized to use DJ commands
 * Criteria: isDjAdmin OR Has DJ Role OR Is Whitelisted DJ User
 */
function isDj(member, guildConfig) {
    if (!member) return false;
    if (!guildConfig) return true; // Fail safe: if no config, allow (or maybe deny? default permissive)

    // Admins are always DJs
    if (isDjAdmin(member, guildConfig)) return true;

    // Check specific DJ Users list
    if (guildConfig.djUserIds && guildConfig.djUserIds.includes(member.id)) return true;

    // Check DJ Roles
    if (guildConfig.djRoleIds && guildConfig.djRoleIds.length > 0) {
        const hasDjRole = member.roles.cache.some(role => guildConfig.djRoleIds.includes(role.id));
        if (hasDjRole) return true;
    }

    return false;
}

/**
 * Check if a user is blocked from using music commands
 */
function isBlocked(userId, guildConfig) {
    if (!guildConfig) return false;
    return guildConfig.blockedUserIds && guildConfig.blockedUserIds.includes(userId);
}

/**
 * Main permission check for music commands
 * Usage: if (!await canControlMusic(interaction)) return;
 */
async function canControlMusic(interactionOrMessage, guildConfig = null) {
    const member = interactionOrMessage.member;
    const guildId = interactionOrMessage.guildId;
    const userId = member.id;

    // Fetch config if not provided
    if (!guildConfig) {
        guildConfig = await database.getGuildConfig(guildId);
    }

    // 1. Check Blocklist (Except Bot Owner)
    if (userId !== BOT_OWNER_ID && isBlocked(userId, guildConfig)) {
        const reply = { content: '🚫 You are blocked from using music commands.', ephemeral: true };
        if (interactionOrMessage.reply) await interactionOrMessage.reply(reply);
        else interactionOrMessage.channel.send(reply);
        return false;
    }

    // 2. Check if DJ Mode is enabled
    // Note: We need to determine where "DJ Mode Enabled" is stored.
    // For now, let's assume if DJ Roles/Users are set, we implicitly enforce it?
    // Or we should add an explicit toggle.
    // Let's add a feature flag check.
    const djModeEnabled = guildConfig.features?.dj_mode;

    if (djModeEnabled) {
        if (!isDj(member, guildConfig)) {
            const reply = {
                content: '🔒 **DJ Mode is Active**\nYou need the DJ role or Admin permissions to control music.',
                ephemeral: true
            };
            if (interactionOrMessage.reply) await interactionOrMessage.reply(reply);
            else interactionOrMessage.channel.send(reply);
            return false;
        }
    }

    return true;
}

module.exports = {
    isDjAdmin,
    isDj,
    isBlocked,
    canControlMusic
};

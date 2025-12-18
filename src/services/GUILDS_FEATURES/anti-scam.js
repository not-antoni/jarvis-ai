/**
 * Anti-Scam & Alt Account Detection
 *
 * Guild-specific feature for detecting and warning about:
 * - New accounts (created recently)
 * - Alt accounts (suspicious patterns)
 * - Potential scammers
 *
 * REQUIREMENTS:
 * - MESSAGE_CONTENT intent (not currently available)
 * - Additional API keys for enhanced detection (TODO)
 *
 * This is a PLACEHOLDER implementation. Full functionality requires:
 * 1. Discord MESSAGE_CONTENT privileged intent
 * 2. Additional API integrations for scam detection
 */

const guildFeatures = require('./guild-features');

/**
 * Analyze a member that just joined
 * @param {GuildMember} member - Discord.js GuildMember object
 * @returns {Object} Analysis result
 */
async function analyzeMember(member) {
    const guildId = member.guild.id;
    const config = guildFeatures.getGuildConfig(guildId);

    if (!config || !config.features.antiScam) {
        return { shouldWarn: false, reason: null };
    }

    const accountCreatedAt = member.user.createdAt;
    const now = new Date();
    const accountAgeMs = now - accountCreatedAt;
    const accountAgeDays = Math.floor(accountAgeMs / (1000 * 60 * 60 * 24));
    const accountAgeHours = Math.floor(accountAgeMs / (1000 * 60 * 60));

    const warnings = [];
    const settings = config.settings || {};

    // Check if account was created today
    if (settings.flagSameDayAccounts && accountAgeDays === 0) {
        warnings.push({
            level: 'critical',
            message: `⚠️ **CRITICAL**: Account created ${accountAgeHours} hours ago!`,
            type: 'same_day_account'
        });
    }
    // Check if account was created within the last few days
    else if (accountAgeDays <= 2) {
        warnings.push({
            level: 'high',
            message: `⚠️ **HIGH RISK**: Account created ${accountAgeDays} day(s) ago!`,
            type: 'very_new_account'
        });
    }
    // Check if account was created this year
    else if (
        settings.flagThisYearAccounts &&
        accountCreatedAt.getFullYear() === now.getFullYear()
    ) {
        warnings.push({
            level: 'medium',
            message: `⚠️ **MEDIUM RISK**: Account created this year (${accountAgeDays} days old)`,
            type: 'new_this_year'
        });
    }
    // Check against threshold
    else if (
        settings.newAccountThresholdDays &&
        accountAgeDays < settings.newAccountThresholdDays
    ) {
        warnings.push({
            level: 'low',
            message: `ℹ️ **LOW RISK**: Account is ${accountAgeDays} days old`,
            type: 'below_threshold'
        });
    }

    // TODO: Additional checks when MESSAGE_CONTENT intent is available:
    // - Check for scam patterns in username
    // - Check for suspicious avatar
    // - Check for matching patterns with known alt accounts
    // - Check against external scammer databases (requires API keys)

    return {
        shouldWarn: warnings.length > 0,
        warnings,
        accountAgeDays,
        accountCreatedAt,
        memberId: member.user.id,
        memberTag: member.user.tag
    };
}

/**
 * Format a warning message for admins
 * @param {Object} analysis - Analysis result from analyzeMember
 * @param {GuildMember} member - Discord.js GuildMember object
 * @returns {string} Formatted warning message
 */
function formatWarningMessage(analysis, member) {
    if (!analysis.shouldWarn) return null;

    const lines = [
        `🚨 **NEW MEMBER ALERT** 🚨`,
        ``,
        `**User**: ${member.user.tag} (<@${member.user.id}>)`,
        `**User ID**: ${member.user.id}`,
        `**Account Created**: ${analysis.accountCreatedAt.toUTCString()}`,
        `**Account Age**: ${analysis.accountAgeDays} days`,
        ``,
        `**Warnings**:`
    ];

    for (const warning of analysis.warnings) {
        lines.push(`• ${warning.message}`);
    }

    lines.push(``);
    lines.push(`*This is an automated alert. Manual review recommended.*`);

    return lines.join('\n');
}

/**
 * Send warning to configured notification channels/users
 * @param {Guild} guild - Discord.js Guild object
 * @param {string} message - Warning message to send
 */
async function sendWarningToAdmins(guild, message) {
    const config = guildFeatures.getGuildConfig(guild.id);
    if (!config) return;

    const settings = config.settings || {};
    const notifyChannelId = settings.notifyChannelId;
    const notifyUsers = config.notifyUsers || [];

    // Send to configured notification channel
    if (notifyChannelId) {
        try {
            const channel = await guild.channels.fetch(notifyChannelId);
            if (channel && channel.isTextBased()) {
                await channel.send(message);
            }
        } catch (error) {
            console.error(`[AntiScam] Failed to send to channel ${notifyChannelId}:`, error.message);
        }
    }

    // DM configured admin users
    for (const userId of notifyUsers) {
        try {
            const member = await guild.members.fetch(userId);
            if (member) {
                await member.send(`**[${guild.name}]** New member alert:\n\n${message}`);
            }
        } catch (error) {
            // User may have DMs disabled, silently continue
        }
    }

    // Log for debugging if no notifications configured
    if (!notifyChannelId && notifyUsers.length === 0) {
        console.log(`[AntiScam] Warning for guild ${guild.id} (no notification channel configured):`, message);
    }
}

/**
 * Handle member join event
 * PLACEHOLDER: Hook this up to the guildMemberAdd event
 * @param {GuildMember} member - Discord.js GuildMember object
 */
async function handleMemberJoin(member) {
    const guildId = member.guild.id;

    // Check if this guild has anti-scam enabled
    if (!guildFeatures.isFeatureEnabled(guildId, 'antiScam')) {
        return;
    }

    try {
        const analysis = await analyzeMember(member);

        if (analysis.shouldWarn) {
            const warningMessage = formatWarningMessage(analysis, member);
            await sendWarningToAdmins(member.guild, warningMessage);
        }
    } catch (error) {
        console.error(`[AntiScam] Error analyzing member ${member.user.id}:`, error);
    }
}

module.exports = {
    analyzeMember,
    formatWarningMessage,
    sendWarningToAdmins,
    handleMemberJoin,
    // Feature availability check - account age detection works without MESSAGE_CONTENT
    isAvailable: () => true,
    // Required setup info for full functionality
    requirements: {
        intents: [], // Basic account age detection works without special intents
        apiKeys: [], // External API keys optional for enhanced detection
        permissions: ['MANAGE_GUILD']
    }
};

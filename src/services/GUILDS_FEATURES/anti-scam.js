/**
 * Anti-Scam & Alt Account Detection
 *
 * Guild-specific feature for detecting and warning about:
 * - New accounts (created recently)
 * - Alt accounts (suspicious patterns)
 * - Potential scammers
 *
 * Features:
 * - Account age detection
 * - Suspicious username pattern detection
 * - Default avatar detection
 * - Common scam keyword detection
 */

const guildFeatures = require('./guild-features');

// Common scam username patterns
const SCAM_USERNAME_PATTERNS = [
    /free\s*nitro/i,
    /discord\s*(?:mod|admin|staff|support)/i,
    /giveaway/i,
    /claim\s*(?:your|free)/i,
    /steam\s*(?:gift|trade|admin)/i,
    /cs\s*go\s*(?:skin|trade)/i,
    /crypto\s*(?:give|airdrop)/i,
    /nft\s*(?:drop|mint|free)/i,
    /elon\s*musk/i,
    /official\s*bot/i,
    /verify\s*bot/i,
];

// Suspicious character patterns (homoglyphs, excessive symbols)
const SUSPICIOUS_CHAR_PATTERNS = [
    /[а-яА-Я].*[a-zA-Z]|[a-zA-Z].*[а-яА-Я]/,  // Mixed Cyrillic and Latin (homoglyph attacks)
    /(.)\1{4,}/,  // Same character repeated 5+ times
    /[^\w\s]{3,}/,  // 3+ special characters in a row
];

/**
 * Check username for scam patterns
 * @param {string} username - Username to check
 * @returns {Object|null} Warning object if suspicious
 */
function checkUsernamePatterns(username) {
    const lowerUsername = username.toLowerCase();
    
    // Check against known scam patterns
    for (const pattern of SCAM_USERNAME_PATTERNS) {
        if (pattern.test(username)) {
            return {
                level: 'high',
                message: `⚠️ **HIGH RISK**: Username matches scam pattern: "${username}"`,
                type: 'scam_username'
            };
        }
    }
    
    // Check for suspicious characters
    for (const pattern of SUSPICIOUS_CHAR_PATTERNS) {
        if (pattern.test(username)) {
            return {
                level: 'medium',
                message: `⚠️ **MEDIUM RISK**: Username contains suspicious characters: "${username}"`,
                type: 'suspicious_chars'
            };
        }
    }
    
    // Check for impersonation attempts (common service names)
    const impersonationKeywords = ['discord', 'steam', 'twitch', 'youtube', 'twitter', 'paypal', 'support', 'admin', 'moderator'];
    for (const keyword of impersonationKeywords) {
        if (lowerUsername.includes(keyword) && !lowerUsername.includes('fan') && !lowerUsername.includes('lover')) {
            return {
                level: 'medium',
                message: `⚠️ **MEDIUM RISK**: Possible impersonation attempt: "${username}"`,
                type: 'impersonation'
            };
        }
    }
    
    return null;
}

/**
 * Check if user has default avatar (potential alt/throwaway)
 * @param {User} user - Discord.js User object
 * @returns {Object|null} Warning object if default avatar
 */
function checkDefaultAvatar(user) {
    // Discord default avatars use the discriminator or user ID
    // Users with default avatars have avatar = null
    if (!user.avatar) {
        return {
            level: 'low',
            message: `ℹ️ **LOW RISK**: User has default avatar (potential throwaway account)`,
            type: 'default_avatar'
        };
    }
    return null;
}

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

    // Check username for scam patterns
    const usernameWarning = checkUsernamePatterns(member.user.username);
    if (usernameWarning) {
        warnings.push(usernameWarning);
    }
    
    // Also check display name if different from username
    if (member.user.globalName && member.user.globalName !== member.user.username) {
        const displayNameWarning = checkUsernamePatterns(member.user.globalName);
        if (displayNameWarning) {
            displayNameWarning.message = displayNameWarning.message.replace('Username', 'Display name');
            warnings.push(displayNameWarning);
        }
    }
    
    // Check for default avatar (potential throwaway)
    const avatarWarning = checkDefaultAvatar(member.user);
    if (avatarWarning) {
        warnings.push(avatarWarning);
    }

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
    checkUsernamePatterns,
    checkDefaultAvatar,
    SCAM_USERNAME_PATTERNS,
    isAvailable: () => true,
    requirements: {
        intents: [],
        apiKeys: [],
        permissions: ['MANAGE_GUILD']
    }
};

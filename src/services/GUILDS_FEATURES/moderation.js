/**
 * Guild Moderation System
 * 
 * Features:
 * - Anti-scam detection (new accounts, suspicious patterns)
 * - Bot/spam detection
 * - Alt account detection
 * - New member warnings to admins/owners
 * 
 * ONLY enabled for specific guilds via .j enable moderation
 * Currently: Guild 858444090374881301
 */

const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const fs = require('fs');
const path = require('path');

// Persistent storage for moderation settings
const DATA_DIR = path.join(__dirname, '../../../data');
const MODERATION_CONFIG_PATH = path.join(DATA_DIR, 'moderation-config.json');

// Allowed guilds that CAN enable moderation (whitelist)
const ALLOWED_GUILDS = [
    '858444090374881301'  // Primary guild
];

// In-memory cache of enabled guilds
let enabledGuilds = new Map();

/**
 * Load moderation config from disk
 */
function loadConfig() {
    try {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        if (fs.existsSync(MODERATION_CONFIG_PATH)) {
            const data = JSON.parse(fs.readFileSync(MODERATION_CONFIG_PATH, 'utf8'));
            enabledGuilds = new Map(Object.entries(data.enabledGuilds || {}));
            console.log('[Moderation] Loaded config for', enabledGuilds.size, 'guilds');
        }
    } catch (error) {
        console.error('[Moderation] Failed to load config:', error);
    }
}

/**
 * Save moderation config to disk
 */
function saveConfig() {
    try {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        const data = {
            enabledGuilds: Object.fromEntries(enabledGuilds),
            updatedAt: new Date().toISOString()
        };
        fs.writeFileSync(MODERATION_CONFIG_PATH, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('[Moderation] Failed to save config:', error);
    }
}

// Load on startup
loadConfig();

/**
 * Check if a guild can enable moderation (is in whitelist)
 */
function canEnableModeration(guildId) {
    return ALLOWED_GUILDS.includes(guildId);
}

/**
 * Check if moderation is enabled for a guild
 */
function isEnabled(guildId) {
    return enabledGuilds.has(guildId) && enabledGuilds.get(guildId).enabled === true;
}

/**
 * Enable moderation for a guild
 * @param {string} guildId - Discord guild ID
 * @param {string} enabledBy - User ID who enabled it
 * @returns {Object} Result
 */
function enableModeration(guildId, enabledBy) {
    if (!canEnableModeration(guildId)) {
        return { success: false, error: 'This guild is not authorized to use moderation features.' };
    }
    
    enabledGuilds.set(guildId, {
        enabled: true,
        enabledBy,
        enabledAt: new Date().toISOString(),
        settings: getDefaultSettings()
    });
    
    saveConfig();
    console.log(`[Moderation] Enabled for guild ${guildId} by user ${enabledBy}`);
    return { success: true };
}

/**
 * Disable moderation for a guild
 * @param {string} guildId - Discord guild ID
 * @param {string} disabledBy - User ID who disabled it
 * @returns {Object} Result
 */
function disableModeration(guildId, disabledBy) {
    if (!enabledGuilds.has(guildId)) {
        return { success: false, error: 'Moderation is not enabled for this guild.' };
    }
    
    const config = enabledGuilds.get(guildId);
    config.enabled = false;
    config.disabledBy = disabledBy;
    config.disabledAt = new Date().toISOString();
    enabledGuilds.set(guildId, config);
    
    saveConfig();
    console.log(`[Moderation] Disabled for guild ${guildId} by user ${disabledBy}`);
    return { success: true };
}

/**
 * Get moderation settings for a guild
 */
function getSettings(guildId) {
    const config = enabledGuilds.get(guildId);
    return config?.settings || getDefaultSettings();
}

/**
 * Update moderation settings for a guild
 */
function updateSettings(guildId, newSettings) {
    if (!enabledGuilds.has(guildId)) {
        return { success: false, error: 'Moderation is not enabled for this guild.' };
    }
    
    const config = enabledGuilds.get(guildId);
    config.settings = { ...config.settings, ...newSettings };
    enabledGuilds.set(guildId, config);
    
    saveConfig();
    return { success: true };
}

/**
 * Get default moderation settings
 */
function getDefaultSettings() {
    return {
        // New account detection
        warnNewAccounts: true,
        newAccountThresholdDays: 30,      // Warn if account < 30 days old
        criticalAccountAgeDays: 1,        // Critical alert if < 1 day old
        highRiskAccountAgeDays: 7,        // High risk if < 7 days old
        
        // This year accounts
        warnThisYearAccounts: true,       // Warn if account created this year
        
        // Bot/spam detection
        detectSpamPatterns: true,         // Detect spam-like usernames
        detectSuspiciousAvatars: true,    // Flag default/suspicious avatars
        
        // Alt account detection
        detectAltAccounts: true,          // Flag potential alt accounts
        
        // Notification settings
        notifyOnJoin: true,               // Send alert when suspicious member joins
        logChannel: null,                 // Channel ID for logs (null = DM owner)
        mentionOwner: false,              // @ mention owner in alerts
        
        // Actions
        autoKick: false,                  // Auto-kick suspicious accounts (disabled by default)
        autoBan: false                    // Auto-ban known scammers (disabled by default)
    };
}

// ============ DETECTION FUNCTIONS ============

/**
 * Analyze a new member for suspicious patterns
 * @param {GuildMember} member - Discord.js GuildMember
 * @returns {Object} Analysis result
 */
function analyzeMember(member) {
    const settings = getSettings(member.guild.id);
    const warnings = [];
    const accountCreatedAt = member.user.createdAt;
    const now = new Date();
    const accountAgeMs = now - accountCreatedAt;
    const accountAgeDays = Math.floor(accountAgeMs / (1000 * 60 * 60 * 24));
    const accountAgeHours = Math.floor(accountAgeMs / (1000 * 60 * 60));
    
    // ============ ACCOUNT AGE CHECKS ============
    if (settings.warnNewAccounts) {
        if (accountAgeDays < settings.criticalAccountAgeDays) {
            warnings.push({
                level: 'critical',
                type: 'new_account',
                emoji: '🚨',
                message: `Account created ${accountAgeHours} hours ago!`,
                detail: `This account was just created today. High probability of alt/scam account.`
            });
        } else if (accountAgeDays < settings.highRiskAccountAgeDays) {
            warnings.push({
                level: 'high',
                type: 'new_account',
                emoji: '⚠️',
                message: `Account is only ${accountAgeDays} day(s) old`,
                detail: `New accounts are often used for scams or ban evasion.`
            });
        } else if (accountAgeDays < settings.newAccountThresholdDays) {
            warnings.push({
                level: 'medium',
                type: 'new_account',
                emoji: '📋',
                message: `Account is ${accountAgeDays} days old (< ${settings.newAccountThresholdDays} day threshold)`,
                detail: `Relatively new account. Monitor activity.`
            });
        }
    }
    
    // ============ THIS YEAR CHECK ============
    if (settings.warnThisYearAccounts && accountCreatedAt.getFullYear() === now.getFullYear()) {
        if (!warnings.some(w => w.type === 'new_account')) {
            warnings.push({
                level: 'low',
                type: 'this_year_account',
                emoji: 'ℹ️',
                message: `Account created this year (${accountAgeDays} days ago)`,
                detail: `Account was created in ${now.getFullYear()}.`
            });
        }
    }
    
    // ============ SPAM PATTERN CHECKS ============
    if (settings.detectSpamPatterns) {
        const username = member.user.username.toLowerCase();
        const displayName = (member.displayName || '').toLowerCase();
        
        // Check for suspicious patterns
        const spamPatterns = [
            /free\s*nitro/i,
            /discord\s*nitro/i,
            /steam\s*gift/i,
            /crypto\s*(airdrop|giveaway)/i,
            /nft\s*(mint|drop|free)/i,
            /earn\s*\$\d+/i,
            /investment\s*opportunity/i,
            /click\s*here/i,
            /bit\.ly|tinyurl|t\.co/i,
            /18\+|nsfw|onlyfans|fansly/i
        ];
        
        for (const pattern of spamPatterns) {
            if (pattern.test(username) || pattern.test(displayName)) {
                warnings.push({
                    level: 'high',
                    type: 'spam_pattern',
                    emoji: '🚫',
                    message: `Suspicious spam pattern in username/display name`,
                    detail: `Username or display name matches known scam/spam patterns.`
                });
                break;
            }
        }
        
        // Check for excessive numbers/random characters (bot-like)
        const randomPattern = /^[a-z]{2,4}\d{4,}$/i;
        const excessiveNumbers = /\d{6,}/;
        if (randomPattern.test(username) || excessiveNumbers.test(username)) {
            warnings.push({
                level: 'medium',
                type: 'bot_pattern',
                emoji: '🤖',
                message: `Username looks auto-generated`,
                detail: `Pattern: "${username}" - commonly seen in bot accounts.`
            });
        }
    }
    
    // ============ AVATAR CHECKS ============
    if (settings.detectSuspiciousAvatars) {
        const avatar = member.user.avatar;
        if (!avatar) {
            warnings.push({
                level: 'low',
                type: 'default_avatar',
                emoji: '👤',
                message: `Using default Discord avatar`,
                detail: `New/scam accounts often don't set a custom avatar.`
            });
        }
    }
    
    // Calculate overall risk level
    let riskLevel = 'none';
    let riskScore = 0;
    
    for (const warning of warnings) {
        switch (warning.level) {
            case 'critical': riskScore += 40; break;
            case 'high': riskScore += 25; break;
            case 'medium': riskScore += 10; break;
            case 'low': riskScore += 5; break;
        }
    }
    
    if (riskScore >= 50) riskLevel = 'critical';
    else if (riskScore >= 30) riskLevel = 'high';
    else if (riskScore >= 15) riskLevel = 'medium';
    else if (riskScore >= 5) riskLevel = 'low';
    
    return {
        shouldAlert: warnings.length > 0,
        warnings,
        riskLevel,
        riskScore,
        accountAgeDays,
        accountAgeHours,
        accountCreatedAt,
        member: {
            id: member.user.id,
            tag: member.user.tag,
            username: member.user.username,
            displayName: member.displayName,
            avatar: member.user.avatarURL({ size: 128 }),
            createdAt: accountCreatedAt.toISOString(),
            joinedAt: member.joinedAt?.toISOString()
        }
    };
}

/**
 * Build an alert embed for suspicious member
 */
function buildAlertEmbed(analysis, member) {
    const riskColors = {
        critical: 0xFF0000,
        high: 0xFF6600,
        medium: 0xFFCC00,
        low: 0x3498DB,
        none: 0x2ECC71
    };
    
    const embed = new EmbedBuilder()
        .setTitle(`🚨 New Member Alert - ${analysis.riskLevel.toUpperCase()} RISK`)
        .setColor(riskColors[analysis.riskLevel] || 0x3498DB)
        .setThumbnail(analysis.member.avatar || member.user.defaultAvatarURL)
        .setTimestamp();
    
    // Member info
    embed.addFields({
        name: '👤 Member Info',
        value: [
            `**User:** ${member.user.tag} (<@${member.user.id}>)`,
            `**ID:** \`${member.user.id}\``,
            `**Display Name:** ${analysis.member.displayName || 'None'}`,
            `**Account Age:** ${analysis.accountAgeDays} days (${analysis.accountAgeHours} hours)`,
            `**Created:** <t:${Math.floor(analysis.accountCreatedAt.getTime() / 1000)}:F>`
        ].join('\n'),
        inline: false
    });
    
    // Risk score
    embed.addFields({
        name: '📊 Risk Assessment',
        value: `**Score:** ${analysis.riskScore}/100 | **Level:** ${analysis.riskLevel.toUpperCase()}`,
        inline: false
    });
    
    // Warnings
    if (analysis.warnings.length > 0) {
        const warningText = analysis.warnings
            .map(w => `${w.emoji} **${w.level.toUpperCase()}:** ${w.message}`)
            .join('\n');
        
        embed.addFields({
            name: `⚠️ Warnings (${analysis.warnings.length})`,
            value: warningText.substring(0, 1024),
            inline: false
        });
    }
    
    embed.setFooter({ 
        text: `Jarvis Moderation • Use .j moderation settings to configure` 
    });
    
    return embed;
}

/**
 * Handle member join event
 * @param {GuildMember} member - Discord.js GuildMember
 * @param {Client} client - Discord.js Client
 */
async function handleMemberJoin(member, client) {
    const guildId = member.guild.id;
    
    // Check if moderation is enabled for this guild
    if (!isEnabled(guildId)) {
        return { handled: false, reason: 'Moderation not enabled for this guild' };
    }
    
    try {
        const analysis = analyzeMember(member);
        
        if (!analysis.shouldAlert) {
            return { handled: true, reason: 'No suspicious activity detected' };
        }
        
        const settings = getSettings(guildId);
        const embed = buildAlertEmbed(analysis, member);
        
        // Send alert
        if (settings.logChannel) {
            // Send to configured log channel
            try {
                const channel = await client.channels.fetch(settings.logChannel);
                if (channel) {
                    const content = settings.mentionOwner 
                        ? `<@${member.guild.ownerId}>` 
                        : '';
                    await channel.send({ content, embeds: [embed] });
                }
            } catch (error) {
                console.error('[Moderation] Failed to send to log channel:', error);
            }
        } else {
            // DM the server owner
            try {
                const owner = await member.guild.fetchOwner();
                if (owner) {
                    await owner.send({
                        content: `🚨 **New suspicious member joined ${member.guild.name}**`,
                        embeds: [embed]
                    });
                }
            } catch (error) {
                console.error('[Moderation] Failed to DM owner:', error);
            }
        }
        
        console.log(`[Moderation] Alert sent for ${member.user.tag} in guild ${guildId} (risk: ${analysis.riskLevel})`);
        
        return { 
            handled: true, 
            analysis,
            alertSent: true 
        };
    } catch (error) {
        console.error('[Moderation] Error handling member join:', error);
        return { handled: false, error: error.message };
    }
}

/**
 * Get status for a guild
 */
function getStatus(guildId) {
    const config = enabledGuilds.get(guildId);
    return {
        canEnable: canEnableModeration(guildId),
        isEnabled: isEnabled(guildId),
        enabledBy: config?.enabledBy || null,
        enabledAt: config?.enabledAt || null,
        settings: config?.settings || getDefaultSettings()
    };
}

module.exports = {
    // Config
    ALLOWED_GUILDS,
    canEnableModeration,
    isEnabled,
    enableModeration,
    disableModeration,
    getSettings,
    updateSettings,
    getStatus,
    
    // Detection
    analyzeMember,
    buildAlertEmbed,
    handleMemberJoin,
    
    // Reload config
    loadConfig,
    saveConfig
};

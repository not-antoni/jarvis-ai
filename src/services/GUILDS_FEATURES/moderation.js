/**
 * Guild Moderation System - AI-Powered Content Detection
 *
 * Features:
 * - AI-based text content moderation (using function calling)
 * - Image content moderation via Ollama
 * - Monitors new members' messages for suspicious content
 * - Configurable ping targets (roles/users)
 * - MongoDB storage (or local file in selfhost mode)
 * - Rate limiting to avoid alert spam
 * - Whitelist for trusted users/roles
 * - Fallback pattern matching when AI unavailable
 *
 * ONLY enabled for specific guilds via .j enable moderation
 */

const moderationQueue = require('./moderation-queue');
const threatDB = require('./threat-database');
const detection = require('./moderation-detection');
const alerts = require('./moderation-alerts');

// Check if we're in selfhost/local mode
const LOCAL_DB_MODE = String(process.env.LOCAL_DB_MODE || '').toLowerCase() === '1';
const SELFHOST_MODE = String(process.env.SELFHOST_MODE || '').toLowerCase() === 'true';

// Collection name for moderation config
const COLLECTION_NAME = 'guildModeration';

// Allowed guilds that CAN enable moderation (whitelist)
const ALLOWED_GUILDS = (process.env.MODERATION_GUILD_IDS || '')
    .split(',')
    .map(id => id.trim())
    .filter(id => id.length > 0);

// In-memory cache of enabled guilds
let enabledGuilds = new Map();

// ============ DATABASE FUNCTIONS ============
// Uses data-sync service for robust MongoDB <-> local migration

const dataSync = require('../data-sync');

/**
 * Initialize database connection
 */
async function initDatabase() {
    try {
        const mongoAvailable = await dataSync.checkMongoConnection();
        if (LOCAL_DB_MODE || SELFHOST_MODE) {
            console.log('[Moderation] Using local database (selfhost mode)');
            // If MongoDB was available before, sync data to local
            if (mongoAvailable) {
                console.log('[Moderation] Syncing MongoDB data to local for offline use...');
                await dataSync.syncMongoToLocal(COLLECTION_NAME);
            }
        } else {
            console.log('[Moderation] Using MongoDB (production mode)');
            // Sync any pending local changes to MongoDB
            await dataSync.syncPendingChanges();
        }
    } catch (error) {
        console.error('[Moderation] Failed to initialize database:', error);
    }
}

/**
 * Load config from database (uses smart read - tries both sources)
 */
async function loadConfig() {
    try {
        // Smart read tries MongoDB first, falls back to local, keeps both in sync
        const preferLocal = LOCAL_DB_MODE || SELFHOST_MODE;
        const data = await dataSync.smartRead(COLLECTION_NAME, preferLocal);

        if (data) {
            // Handle array format (from MongoDB)
            if (Array.isArray(data)) {
                for (const config of data) {
                    if (config.guildId) {
                        enabledGuilds.set(config.guildId, config);
                    }
                }
            }
            // Handle object format (from local file)
            else if (data.enabledGuilds) {
                enabledGuilds = new Map(Object.entries(data.enabledGuilds));
            }
        }

        console.log('[Moderation] Loaded config for', enabledGuilds.size, 'guilds');
    } catch (error) {
        console.error('[Moderation] Failed to load config:', error);
    }
}

/**
 * Save config to database (uses smart write - writes to both MongoDB and local)
 */
async function saveConfig(guildId) {
    try {
        const config = enabledGuilds.get(guildId);
        if (!config) return;

        // Prepare data for storage
        const data = {
            enabledGuilds: Object.fromEntries(enabledGuilds),
            updatedAt: new Date().toISOString()
        };

        // Smart write saves to both MongoDB and local, handles failures gracefully
        await dataSync.smartWrite(COLLECTION_NAME, data);
    } catch (error) {
        console.error('[Moderation] Failed to save config:', error);
    }
}

// Initialize on load
initDatabase().then(() => loadConfig());

// ============ CONFIG FUNCTIONS ============

/**
 * Get default moderation settings
 */
function getDefaultSettings() {
    return {
        // Ping configuration
        pingRoles: [],
        pingUsers: [],
        pingOwner: true,

        // Whitelist (bypass moderation)
        whitelistRoles: [],
        whitelistUsers: [],

        // Detection settings
        monitorNewMembers: true,
        newMemberThresholdDays: 7,
        monitorDurationHours: 1,
        minSeverity: 'medium', // low, medium, high, critical

        // AI settings
        useAI: true,
        aiProvider: 'openai',
        ollamaUrl: process.env.OLLAMA_URL || 'http://localhost:11434',
        ollamaModel: 'llava',
        useFallbackPatterns: true, // Use pattern matching as backup

        // Log channel
        logChannel: null,
        alertChannel: null,

        // Alert customization
        useEmbeds: true, // false = simple message only
        customAlertTemplate: '', // Empty = use default Jarvis style
        // Variables: {user} {category} {severity} {pings} {reason}
        // Example: "⚠️ {pings} THREAT DETECTED: {user} | {category} | {severity}"

        // Actions
        autoDelete: false,
        autoMute: false,
        autoBan: false,

        // ============ AUTO-MOD MODULES (Sapphire-like) ============
        // Spam detection
        antiSpam: false,
        antiSpamMaxMessages: 5, // Max messages in window
        antiSpamWindow: 5000, // Time window in ms
        antiSpamAction: 'mute', // 'warn', 'mute', 'kick', 'ban'

        // Mention spam
        antiMentionSpam: false,
        antiMentionMax: 5, // Max mentions per message
        antiMentionAction: 'warn',

        // Emoji spam
        antiEmojiSpam: false,
        antiEmojiMax: 10, // Max emojis per message
        antiEmojiAction: 'warn',

        // Link filtering
        antiLinks: false,
        antiLinksWhitelist: [], // Allowed domains
        antiLinksAction: 'delete',

        // Invite links
        antiInvites: false,
        antiInvitesAction: 'delete',

        // Caps spam
        antiCaps: false,
        antiCapsPercent: 70, // % of message that's caps
        antiCapsMinLength: 10, // Min message length to check
        antiCapsAction: 'warn',

        // Raid detection
        antiRaid: false,
        antiRaidJoinThreshold: 10, // Members joining
        antiRaidJoinWindow: 60000, // Within this time (ms)
        antiRaidAction: 'lockdown', // 'lockdown', 'kick', 'ban'

        // ============ CHANNEL EXCLUSIONS ============
        excludedChannels: [], // Channel IDs to ignore completely

        // ============ AUTO-ESCALATION ============
        autoEscalation: false, // Progressive punishment for repeat offenders
        escalationThreshold: 3, // Offenses before escalating
        escalationWindow: 24, // Hours to track offenses
        // Escalation path: warn -> mute -> kick -> ban

        // ============ COOLDOWNS (configurable) ============
        alertCooldownSeconds: 5, // Seconds between alerts per user

        // ============ DAILY SUMMARY ============
        dailySummary: false, // Send daily report to log channel
        dailySummaryTime: '09:00', // Time in HH:MM (UTC)

        // Punishment DM templates
        punishmentDMTemplate: '', // Custom DM message when punished
        // Variables: {user} {action} {reason} {guild} {duration}
    };
}

function canEnableModeration(guildId) {
    return ALLOWED_GUILDS.includes(guildId);
}

function isEnabled(guildId) {
    return enabledGuilds.has(guildId) && enabledGuilds.get(guildId).enabled === true;
}

function enableModeration(guildId, enabledBy) {
    if (!canEnableModeration(guildId)) {
        return { success: false, error: 'This guild is not authorized.' };
    }

    enabledGuilds.set(guildId, {
        enabled: true,
        enabledBy,
        enabledAt: new Date().toISOString(),
        settings: getDefaultSettings(),
        stats: { total: 0, byCategory: {}, byUser: {} }
    });

    if (!detection.trackedMembers.has(guildId)) {
        detection.trackedMembers.set(guildId, new Map());
    }

    saveConfig(guildId);
    return { success: true };
}

function disableModeration(guildId, disabledBy) {
    if (!enabledGuilds.has(guildId)) {
        return { success: false, error: 'Moderation is not enabled.' };
    }

    const config = enabledGuilds.get(guildId);
    config.enabled = false;
    config.disabledBy = disabledBy;
    config.disabledAt = new Date().toISOString();

    detection.trackedMembers.delete(guildId);
    saveConfig(guildId);
    return { success: true };
}

function getSettings(guildId) {
    const config = enabledGuilds.get(guildId);
    return config?.settings || getDefaultSettings();
}

function updateSettings(guildId, newSettings) {
    if (!enabledGuilds.has(guildId)) {
        return { success: false, error: 'Moderation is not enabled.' };
    }

    const config = enabledGuilds.get(guildId);
    config.settings = { ...config.settings, ...newSettings };
    saveConfig(guildId);
    return { success: true };
}

function getStatus(guildId) {
    const config = enabledGuilds.get(guildId);
    return {
        canEnable: canEnableModeration(guildId),
        isEnabled: isEnabled(guildId),
        enabledBy: config?.enabledBy || null,
        enabledAt: config?.enabledAt || null,
        settings: config?.settings || getDefaultSettings(),
        stats: config?.stats || { total: 0, byCategory: {}, byUser: {} },
        trackedMembersCount: detection.trackedMembers.get(guildId)?.size || 0,
        recentDetections: config?.recentDetections || []
    };
}

// ============ WHITELIST FUNCTIONS ============

function isWhitelisted(guildId, member) {
    const settings = getSettings(guildId);

    // Check user whitelist
    if (settings.whitelistUsers?.includes(member.id)) {
        return true;
    }

    // Check role whitelist
    if (member.roles?.cache) {
        for (const roleId of settings.whitelistRoles || []) {
            if (member.roles.cache.has(roleId)) {
                return true;
            }
        }
    }

    return false;
}

// ============ STATISTICS ============

function recordDetection(guildId, userId, category, reason = null, severity = 'medium') {
    const config = enabledGuilds.get(guildId);
    if (!config) return;

    if (!config.stats) {
        config.stats = { total: 0, byCategory: {}, byUser: {} };
    }
    if (!config.recentDetections) {
        config.recentDetections = [];
    }

    config.stats.total++;
    config.stats.byCategory[category] = (config.stats.byCategory[category] || 0) + 1;
    config.stats.byUser[userId] = (config.stats.byUser[userId] || 0) + 1;

    // Truncate byUser to keep only top 100 users (prevent memory bloat)
    const userEntries = Object.entries(config.stats.byUser);
    if (userEntries.length > 100) {
        const sorted = userEntries.sort((a, b) => b[1] - a[1]).slice(0, 100);
        config.stats.byUser = Object.fromEntries(sorted);
    }

    // Add to recent detections (keep last 50)
    config.recentDetections.unshift({
        userId,
        category,
        severity,
        reason: reason?.slice(0, 200), // Truncate reason to save space
        timestamp: new Date().toISOString()
    });
    if (config.recentDetections.length > 50) {
        config.recentDetections = config.recentDetections.slice(0, 50);
    }

    // Save immediately on first few detections, then every 5
    if (config.stats.total <= 5 || config.stats.total % 5 === 0) {
        saveConfig(guildId);
    }
}

// ============ AUTO-MOD ACTION EXECUTION ============

/**
 * Execute auto-mod action
 */
async function executeAutoModAction(message, member, action, reason, moduleName, client, settings) {
    const guildId = message.guild.id;
    const userId = message.author.id;

    // Send punishment DM
    if (settings.punishmentDMTemplate) {
        try {
            const dmMessage = settings.punishmentDMTemplate
                .replace(/\{user\}/gi, message.author.tag)
                .replace(/\{action\}/gi, action)
                .replace(/\{reason\}/gi, reason)
                .replace(/\{guild\}/gi, message.guild.name)
                .replace(/\{module\}/gi, moduleName);
            await message.author.send(dmMessage).catch(() => { });
        } catch { }
    }

    try {
        // execute punishment
        switch (action) {
            case 'delete':
                await message.delete().catch(() => { });
                break;

            case 'warn':
                await message.delete().catch(() => { });
                break;

            case 'mute':
                await message.delete().catch(() => { });
                if (member?.moderatable) {
                    await member.timeout(10 * 60 * 1000, `[${moduleName}] ${reason}`);
                }
                break;

            case 'kick':
                await message.delete().catch(() => { });
                if (member?.kickable) {
                    await member.kick(`[${moduleName}] ${reason}`);
                }
                break;

            case 'ban':
                await message.delete().catch(() => { });
                if (member?.bannable) {
                    await member.ban({ reason: `[${moduleName}] ${reason}` });
                }
                break;
        }

        // Record detection
        recordDetection(guildId, userId, moduleName.toLowerCase(), reason, 'medium');

        // Send Alert using the standard system (respects custom templates & embeds)
        const fakeResult = {
            categories: [moduleName.toLowerCase()],
            severity: 'medium',
            reason: reason,
            isUnsafe: true
        };

        await alerts.sendAlert(message, fakeResult, 'auto-mod', client, null, null, settings);

    } catch (error) {
        console.error(`[AutoMod] Failed to execute ${action}:`, error.message);
    }
}

// ============ MESSAGE HANDLER ============

async function handleMessage(message, client) {
    if (!message.guild || message.author.bot) return { handled: false };

    const guildId = message.guild.id;
    if (!isEnabled(guildId)) return { handled: false };

    const settings = getSettings(guildId);
    const userId = message.author.id;
    const channelId = message.channel.id;
    const member = message.member || (await message.guild.members.fetch(userId).catch(() => null));

    // Check channel exclusions
    if (settings.excludedChannels?.includes(channelId)) {
        return { handled: false, reason: 'Excluded channel' };
    }

    // Check whitelist
    if (member && isWhitelisted(guildId, member)) {
        return { handled: false, reason: 'Whitelisted' };
    }

    // Check if known cross-guild threat (immediate flag)
    const knownThreat = threatDB.isKnownThreat(userId);
    if (knownThreat) {
        console.log(`[Moderation] Known threat detected: ${userId} (${knownThreat.severity})`);
    }

    // Check if tracking (new member or high-risk)
    if (!detection.isActivelyTracking(guildId, userId)) {
        if (member && detection.shouldMonitorMember(member, settings)) {
            detection.startTracking(guildId, userId);
        } else {
            // Non-tracked user: check if message needs real-time analysis or batch queue
            const context = detection.buildModerationContext(message, member);
            const riskData = detection.calculateRiskScore(message, member, context);

            // Build queue context
            const queueContext = {
                accountAgeDays: context.accountAgeDays,
                memberAgeDays: context.memberAgeDays,
                isNewAccount: context.accountAgeDays < 7,
                isFirstMessage: detection.isFirstMessageInServer(guildId, userId),
                hasLinks: detection.extractUrls(context.messageContent).length > 0,
                hasMassMention: /@(everyone|here)/i.test(context.messageContent),
                hasAttachments: message.attachments.size > 0,
                riskScore: riskData.score,
                riskFactors: riskData.factors
            };

            // Record activity for first-message detection
            detection.recordMemberActivity(guildId, userId);

            // Check if needs real-time analysis (high-risk indicators)
            if (moderationQueue.shouldAnalyzeRealtime(queueContext)) {
                // Real-time analysis needed - continue to full analysis below
                // Fall through by NOT returning here
            } else {
                // Queue for batch analysis (non-urgent messages)
                if (message.content?.length > 3) {
                    moderationQueue.queueMessage(message, queueContext);
                }
                return { handled: true, reason: 'Queued for batch analysis' };
            }
        }
    }

    // Check rate limit
    if (alerts.isOnAlertCooldown(guildId, userId)) {
        return { handled: false, reason: 'On cooldown' };
    }

    // Check auto-mod modules FIRST (synchronous, fast checks)
    const autoModResult = detection.checkAutoModules(message, settings);
    if (autoModResult.triggered) {
        await executeAutoModAction(
            message,
            member,
            autoModResult.action,
            autoModResult.reason,
            autoModResult.module,
            client,
            settings
        );
        return { handled: true, reason: autoModResult.module };
    }

    // Analyze in background (non-blocking) - AI analysis for scams/threats
    setImmediate(async () => {
        try {
            let alertSent = false; // Only send one alert per message

            // Text analysis - pass full message and member for rich context
            if (message.content?.length > 3) {
                const textResult = await detection.analyzeTextContent(message, member, settings);
                const context = textResult.context;
                const riskData = context ? detection.calculateRiskScore(message, member, context) : null;

                if (textResult.success && textResult.result?.isUnsafe) {
                    if (
                        detection.meetsMinSeverity(
                            textResult.result.severity,
                            settings.minSeverity || 'medium'
                        )
                    ) {
                        await alerts.sendAlert(
                            message,
                            textResult.result,
                            'text',
                            client,
                            context,
                            riskData,
                            settings
                        );
                        alertSent = true;
                        // Auto-delete flagged message if enabled
                        if (settings.autoDelete) {
                            try {
                                await message.delete();
                            } catch (e) {
                                console.warn('[Moderation] Failed to auto-delete:', e.message);
                            }
                        }
                        alerts.setAlertCooldown(guildId, userId);
                        detection.pauseTracking(guildId, userId);
                        recordDetection(
                            guildId,
                            userId,
                            textResult.result.categories?.[0] || 'unknown',
                            textResult.result.reason || null,
                            textResult.result.severity || 'medium'
                        );
                    }
                }
            }

            // Image analysis - only if no alert sent yet for this message
            if (!alertSent) {
                for (const attachment of message.attachments.values()) {
                    if (alertSent) break; // Stop after first alert
                    if (attachment.contentType?.startsWith('image/')) {
                        const imageResult = await detection.analyzeImageContent(
                            attachment.url,
                            message,
                            member,
                            settings
                        );
                        const context = imageResult.context;
                        const riskData = context ? detection.calculateRiskScore(message, member, context) : null;

                        if (imageResult.success && imageResult.result?.isUnsafe) {
                            if (
                                detection.meetsMinSeverity(
                                    imageResult.result.severity,
                                    settings.minSeverity || 'medium'
                                )
                            ) {
                                await alerts.sendAlert(
                                    message,
                                    imageResult.result,
                                    'image',
                                    client,
                                    context,
                                    riskData,
                                    settings
                                );
                                alertSent = true;
                                // Auto-delete flagged message if enabled
                                if (settings.autoDelete) {
                                    try {
                                        await message.delete();
                                    } catch (e) {
                                        console.warn('[Moderation] Failed to auto-delete:', e.message);
                                    }
                                }
                                alerts.setAlertCooldown(guildId, userId);
                                detection.pauseTracking(guildId, userId);
                                recordDetection(
                                    guildId,
                                    userId,
                                    imageResult.result.categories?.[0] || 'image',
                                    imageResult.result.reason || null,
                                    imageResult.result.severity || 'medium'
                                );
                            }
                        }
                    }
                }
            }
        } catch (error) {
            console.error('[Moderation] Analysis error:', error.message);
        }
    });

    return { handled: true };
}

async function handleMemberJoin(member, client) {
    const guildId = member.guild.id;
    if (!isEnabled(guildId)) return { handled: false };

    const settings = getSettings(guildId);

    // Check for raid
    const raidResult = detection.checkRaidDetection(member, settings);
    if (raidResult.detected) {
        console.log(`[Moderation] RAID DETECTED in ${member.guild.name}: ${raidResult.joinCount} joins`);

        try {
            // Find a channel to alert
            const alertChannel = settings.alertChannel
                ? await client.channels.fetch(settings.alertChannel).catch(() => null)
                : member.guild.systemChannel;

            if (alertChannel) {
                const pings = [];
                if (settings.pingOwner) pings.push(`<@${member.guild.ownerId}>`);
                for (const roleId of settings.pingRoles || []) pings.push(`<@&${roleId}>`);

                await alertChannel.send(
                    `🚨 **RAID DETECTED** ${pings.join(' ')}\n\n` +
                    `**${raidResult.joinCount}** members joined in the last minute!\n` +
                    `Action: **${raidResult.action.toUpperCase()}**`
                );
            }

            // Execute raid action
            switch (raidResult.action) {
                case 'lockdown':
                    // Set verification level to highest
                    try {
                        await member.guild.setVerificationLevel(4); // VERY_HIGH
                        if (alertChannel) {
                            await alertChannel.send('🔒 Server verification level set to **VERY HIGH** (phone verification required)');
                        }
                    } catch (e) {
                        console.error('[Moderation] Failed to set verification level:', e.message);
                    }
                    break;

                case 'kick':
                    if (member.kickable) {
                        await member.kick('Raid detection - auto kick');
                    }
                    break;

                case 'ban':
                    if (member.bannable) {
                        await member.ban({ reason: 'Raid detection - auto ban' });
                    }
                    break;
            }
        } catch (error) {
            console.error('[Moderation] Raid response error:', error.message);
        }

        return { handled: true, raid: true };
    }

    // Normal new member tracking
    if (detection.shouldMonitorMember(member, settings)) {
        detection.startTracking(guildId, member.id);
        return { handled: true, tracking: true };
    }

    return { handled: false };
}

module.exports = {
    ALLOWED_GUILDS,
    canEnableModeration,
    isEnabled,
    enableModeration,
    disableModeration,
    getSettings,
    updateSettings,
    getStatus,
    isWhitelisted,
    analyzeTextContent: detection.analyzeTextContent,
    analyzeImageContent: detection.analyzeImageContent,
    analyzeWithPatterns: detection.analyzeWithPatterns,
    handleMessage,
    handleMemberJoin,
    sendAlert: (message, result, contentType, client, context, riskData) => {
        const settings = getSettings(message.guild?.id);
        return alerts.sendAlert(message, result, contentType, client, context, riskData, settings);
    },
    loadConfig,
    saveConfig,
    parseAIResponse: detection.parseAIResponse,
    buildModerationContext: detection.buildModerationContext,

    // Queue & Dashboard APIs
    getQueueStatus: () => moderationQueue.getQueueStatus(),
    getPendingMessages: (guildId, limit) => moderationQueue.getPendingMessages(guildId, limit),
    getAnalysisLogs: (limit) => moderationQueue.getAnalysisLogs(limit),
    getUserRiskProfile: (userId) => moderationQueue.getUserRiskProfile(userId),
    getGuildUserProfiles: (guildId, limit) => moderationQueue.getGuildUserProfiles(guildId, limit),
    triggerBatchAnalysis: () => moderationQueue.triggerBatchAnalysis(),

    // Threat Database APIs
    reportThreat: (userId, guildId, reason, severity) => threatDB.reportThreat(userId, guildId, reason, severity),
    isKnownThreat: (userId) => threatDB.isKnownThreat(userId),
    getAllThreats: (limit) => threatDB.getAllThreats(limit),
    removeThreat: (userId) => threatDB.removeThreat(userId),
    getThreatStats: () => threatDB.getThreatStats(),
    getEscalatedAction: (userId, guildId, baseAction, settings) => threatDB.getEscalatedAction(userId, guildId, baseAction, settings),
    recordOffense: (userId, guildId, offense, action, severity) => threatDB.recordOffense(userId, guildId, offense, action, severity)
};

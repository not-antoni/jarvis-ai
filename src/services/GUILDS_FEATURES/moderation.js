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

const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const fs = require('fs');
const path = require('path');
const config = require('../../../config');
const database = require('../database');
const localdb = require('../../localdb');
const { safeSend } = require('../../utils/discord-safe-send');

// Check if we're in selfhost/local mode
const LOCAL_DB_MODE = String(process.env.LOCAL_DB_MODE || '').toLowerCase() === '1';
const SELFHOST_MODE = String(process.env.SELFHOST_MODE || '').toLowerCase() === 'true';

// Collection name for moderation config
const COLLECTION_NAME = 'guildModeration';

// Allowed guilds that CAN enable moderation (whitelist)
const ALLOWED_GUILDS = [
    '858444090374881301', // Primary guild
    '1403664986089324606' // Jarvis HQ
];

// In-memory cache of enabled guilds
let enabledGuilds = new Map();

// Tracked members (new members being monitored)
const trackedMembers = new Map();

// Rate limiting for alerts (prevent spam)
// Global rate limit: 10 alerts max per 2 seconds
const alertTimestamps = []; // Array of timestamps for sliding window
const MAX_ALERTS_PER_WINDOW = 10;
const RATE_LIMIT_WINDOW_MS = 2000; // 2 seconds

// Per-user cooldown (prevent spam from same user)
const alertCooldowns = new Map(); // `${guildId}:${userId}` -> timestamp
const ALERT_COOLDOWN_MS = 5 * 1000; // 5 seconds between alerts per user

// Detection statistics
const detectionStats = new Map(); // guildId -> { total, byCategory, byUser }

// Monitoring settings
const MONITORING_DURATION_MS = 60 * 60 * 1000; // 1 hour
const PAUSE_DURATION_MS = 5 * 60 * 1000; // 5 min pause after detection

// AI Moderation prompts - these run internally and check for specific response format
// The AI MUST respond with exactly "ACTION:FLAG" or "ACTION:SAFE" followed by details
const INTERNAL_MODERATION_PROMPT = `You are Jarvis's internal content moderation system. You run silently in the background.

You will receive message context including:
- Username, User ID, Mention format
- Current date/time
- Message content
- Account age

Analyze for:
- SCAM: crypto scams, fake giveaways, phishing, "free nitro", suspicious links
- SPAM: advertising, repetitive messages, self-promotion, unsolicited DM requests
- HARMFUL: harassment, threats, hate speech, slurs, doxxing
- NSFW: sexual content, explicit material
- MALWARE: malicious links, phishing URLs, IP grabbers

You MUST respond in this EXACT format:
ACTION:FLAG or ACTION:SAFE
SEVERITY:low|medium|high|critical
CATEGORY:scam|spam|harmful|nsfw|malware|safe
REASON:<brief explanation>
CONFIDENCE:<0.0-1.0>

Example unsafe response:
ACTION:FLAG
SEVERITY:high
CATEGORY:scam
REASON:Message contains fake Discord Nitro link attempting to steal credentials
CONFIDENCE:0.95

Example safe response:
ACTION:SAFE
SEVERITY:low
CATEGORY:safe
REASON:Normal conversation message
CONFIDENCE:0.98`;

const OLLAMA_IMAGE_PROMPT = `You are an image content moderation AI. Analyze this image carefully.

CRITICAL - Flag these as HIGH/CRITICAL severity scams:
- Screenshots of crypto wallets, Bitcoin transactions, or trading platforms
- People sitting at computers showing trading dashboards or profits
- "Proof" screenshots of payments, withdrawals, or earnings
- Fake Discord/Steam gift card images
- QR codes (often used for crypto scams)
- Screenshots designed to build fake trust or credibility
- Photoshopped bank statements or transaction confirmations
- Images showing "guaranteed returns" or investment opportunities

Also check for:
- NSFW/inappropriate/sexual content
- Gore or disturbing content
- Spam/advertising images
- Fake giveaway announcements

Respond in this EXACT format:
ACTION:FLAG or ACTION:SAFE
SEVERITY:low|medium|high|critical
CATEGORY:crypto_scam|nsfw|gore|spam|safe
REASON:<brief explanation of what you detected>
CONFIDENCE:<0.0-1.0>`;

// Jarvis persona alert messages - randomly selected for variety
const JARVIS_ALERTS = {
    detection: [
        "🚨 **Sir, I've detected a potential threat!**",
        '🚨 **Security breach identified, sir.**',
        '🚨 **Alert! Suspicious activity detected.**',
        "🚨 **Sir, I've intercepted something concerning.**",
        '🚨 **Threat detected in this sector, sir.**'
    ],
    scam: [
        'A scammer has been identified attempting to distribute malicious content.',
        "I've flagged what appears to be a scam attempt.",
        'This looks like a classic social engineering attack, sir.',
        'Potential phishing or fraud attempt detected.'
    ],
    spam: [
        'Spam content detected from this user.',
        'This appears to be unsolicited promotional content.',
        "I've identified spam patterns in this message."
    ],
    nsfw: [
        'Inappropriate content has been flagged.',
        'NSFW material detected, sir.',
        'This content violates server guidelines.'
    ],
    harmful: [
        'Potentially harmful content identified.',
        "I've detected concerning language patterns.",
        'This message contains potentially threatening content.'
    ],
    recommendation: [
        'I recommend immediate investigation.',
        'Manual review is advised, sir.',
        'Please review at your earliest convenience.',
        'Awaiting your orders on how to proceed.'
    ]
};

/**
 * Get random element from array
 */
function randomChoice(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Build Jarvis-style alert message
 */
function buildJarvisAlert(category, pings) {
    const detection = randomChoice(JARVIS_ALERTS.detection);
    const categoryMessages = JARVIS_ALERTS[category] || JARVIS_ALERTS.scam;
    const description = randomChoice(categoryMessages);
    const recommendation = randomChoice(JARVIS_ALERTS.recommendation);

    return `${detection} ${pings}\n\n${description}\n${recommendation}`;
}

// Risk scoring weights
const RISK_FACTORS = {
    newAccount: { days: 7, weight: 30 }, // Account < 7 days old
    veryNewAccount: { days: 1, weight: 50 }, // Account < 1 day old
    noAvatar: { weight: 15 }, // Default avatar
    newMember: { days: 1, weight: 20 }, // Joined server < 1 day ago
    cryptoKeywords: { weight: 25 }, // Message contains crypto terms
    urgencyLanguage: { weight: 20 }, // "Act now", "Limited time", etc.
    suspiciousLinks: { weight: 35 }, // Shortened URLs, suspicious domains
    massmentions: { weight: 15 } // @everyone, @here
};

/**
 * Calculate risk score for a message/user
 */
function calculateRiskScore(message, member, context) {
    let score = 0;
    const factors = [];

    // Account age
    if (context.accountAgeDays < 1) {
        score += RISK_FACTORS.veryNewAccount.weight;
        factors.push('Very new account (<1 day)');
    } else if (context.accountAgeDays < 7) {
        score += RISK_FACTORS.newAccount.weight;
        factors.push('New account (<7 days)');
    }

    // No avatar
    if (!message.author.avatar) {
        score += RISK_FACTORS.noAvatar.weight;
        factors.push('Default avatar');
    }

    // New member
    if (context.memberAgeDays !== null && context.memberAgeDays < 1) {
        score += RISK_FACTORS.newMember.weight;
        factors.push('Just joined server');
    }

    // Crypto keywords
    const cryptoPattern =
        /crypto|bitcoin|btc|eth|ethereum|nft|airdrop|wallet|blockchain|defi|token/i;
    if (cryptoPattern.test(context.messageContent)) {
        score += RISK_FACTORS.cryptoKeywords.weight;
        factors.push('Crypto keywords');
    }

    // Urgency language
    const urgencyPattern =
        /act now|limited time|hurry|fast|quick|urgent|immediately|don't miss|last chance/i;
    if (urgencyPattern.test(context.messageContent)) {
        score += RISK_FACTORS.urgencyLanguage.weight;
        factors.push('Urgency language');
    }

    // Suspicious links
    const linkPattern = /bit\.ly|tinyurl|t\.co|discord\.gift|discordgift|steamcommunity\.ru/i;
    if (linkPattern.test(context.messageContent)) {
        score += RISK_FACTORS.suspiciousLinks.weight;
        factors.push('Suspicious links');
    }

    // Mass mentions
    if (/@everyone|@here/.test(context.messageContent)) {
        score += RISK_FACTORS.massmentions.weight;
        factors.push('Mass mentions');
    }

    return { score: Math.min(score, 100), factors };
}

// Fallback patterns for when AI is unavailable
const FALLBACK_PATTERNS = [
    { pattern: /free\s*nitro|discord\.gift|discordgift/i, category: 'scam', severity: 'high' },
    {
        pattern: /click\s*(here|this|now)|bit\.ly|tinyurl|t\.co/i,
        category: 'spam',
        severity: 'medium'
    },
    {
        pattern: /crypto\s*(airdrop|giveaway)|nft\s*(mint|drop|free)/i,
        category: 'scam',
        severity: 'high'
    },
    {
        pattern: /earn\s*\$\d+|investment\s*opportunity|passive\s*income/i,
        category: 'scam',
        severity: 'high'
    },
    { pattern: /18\+|nsfw|onlyfans|fansly|porn/i, category: 'nsfw', severity: 'medium' },
    { pattern: /@everyone|@here/i, category: 'spam', severity: 'low' },
    { pattern: /dm\s*me|check\s*my\s*(bio|profile)/i, category: 'spam', severity: 'low' }
];

// ============ DATABASE FUNCTIONS ============
// Uses data-sync service for robust MongoDB ↔ local migration

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

    if (!trackedMembers.has(guildId)) {
        trackedMembers.set(guildId, new Map());
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

    trackedMembers.delete(guildId);
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
        trackedMembersCount: trackedMembers.get(guildId)?.size || 0,
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

// ============ RATE LIMITING ============

/**
 * Check if global rate limit is exceeded (10 alerts per 2 seconds)
 */
function isGlobalRateLimited() {
    const now = Date.now();

    // Remove timestamps outside the window
    while (alertTimestamps.length > 0 && alertTimestamps[0] < now - RATE_LIMIT_WINDOW_MS) {
        alertTimestamps.shift();
    }

    return alertTimestamps.length >= MAX_ALERTS_PER_WINDOW;
}

/**
 * Record an alert for rate limiting
 */
function recordAlert() {
    alertTimestamps.push(Date.now());
}

/**
 * Check if user is on cooldown
 */
function isOnAlertCooldown(guildId, userId) {
    // Check global rate limit first
    if (isGlobalRateLimited()) {
        return true;
    }

    // Check per-user cooldown
    const key = `${guildId}:${userId}`;
    const cooldownUntil = alertCooldowns.get(key);

    if (cooldownUntil && Date.now() < cooldownUntil) {
        return true;
    }

    return false;
}

function setAlertCooldown(guildId, userId) {
    const key = `${guildId}:${userId}`;
    alertCooldowns.set(key, Date.now() + ALERT_COOLDOWN_MS);
    recordAlert(); // Record for global rate limit
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

// ============ AUTO-MOD MODULES ============

// Spam tracking for anti-spam module
const spamTracker = new Map(); // guildId:userId -> { messages: [], lastViolation: timestamp }
const raidTracker = new Map(); // guildId -> { joins: [timestamps] }

/**
 * Check all auto-mod modules
 * Returns { triggered: boolean, module: string, action: string, reason: string }
 */
function checkAutoModules(message, settings) {
    const content = message.content || '';
    const guildId = message.guild.id;
    const userId = message.author.id;

    // Anti-Spam (message rate)
    if (settings.antiSpam) {
        const key = `${guildId}:${userId}`;
        const now = Date.now();
        let userData = spamTracker.get(key) || { messages: [], lastViolation: 0 };

        // Clean old messages outside window
        userData.messages = userData.messages.filter(t => now - t < settings.antiSpamWindow);
        userData.messages.push(now);
        spamTracker.set(key, userData);

        if (userData.messages.length > settings.antiSpamMaxMessages) {
            // Cooldown to prevent spam alerts
            if (now - userData.lastViolation > 30000) {
                userData.lastViolation = now;
                spamTracker.set(key, userData);
                return {
                    triggered: true,
                    module: 'Anti-Spam',
                    action: settings.antiSpamAction,
                    reason: `Sent ${userData.messages.length} messages in ${settings.antiSpamWindow / 1000}s`
                };
            }
        }
    }

    // Anti-Mention Spam
    if (settings.antiMentionSpam) {
        const mentionCount = (message.mentions.users?.size || 0) +
            (message.mentions.roles?.size || 0) +
            (message.mentions.everyone ? 10 : 0);
        if (mentionCount > settings.antiMentionMax) {
            return {
                triggered: true,
                module: 'Anti-Mention',
                action: settings.antiMentionAction,
                reason: `${mentionCount} mentions (max: ${settings.antiMentionMax})`
            };
        }
    }

    // Anti-Emoji Spam
    if (settings.antiEmojiSpam) {
        const emojiRegex = /(\p{Emoji_Presentation}|\p{Extended_Pictographic}|<a?:[a-zA-Z0-9_]+:\d+>)/gu;
        const emojiCount = (content.match(emojiRegex) || []).length;
        if (emojiCount > settings.antiEmojiMax) {
            return {
                triggered: true,
                module: 'Anti-Emoji',
                action: settings.antiEmojiAction,
                reason: `${emojiCount} emojis (max: ${settings.antiEmojiMax})`
            };
        }
    }

    // Anti-Caps
    if (settings.antiCaps && content.length >= settings.antiCapsMinLength) {
        const letters = content.replace(/[^a-zA-Z]/g, '');
        if (letters.length > 0) {
            const capsCount = (letters.match(/[A-Z]/g) || []).length;
            const capsPercent = (capsCount / letters.length) * 100;
            if (capsPercent >= settings.antiCapsPercent) {
                return {
                    triggered: true,
                    module: 'Anti-Caps',
                    action: settings.antiCapsAction,
                    reason: `${Math.round(capsPercent)}% caps (max: ${settings.antiCapsPercent}%)`
                };
            }
        }
    }

    // Anti-Invites (Discord invites)
    if (settings.antiInvites) {
        const inviteRegex = /(discord\.(gg|io|me|li)|discordapp\.com\/invite|discord\.com\/invite)\/[a-zA-Z0-9]+/gi;
        if (inviteRegex.test(content)) {
            return {
                triggered: true,
                module: 'Anti-Invite',
                action: settings.antiInvitesAction,
                reason: 'Discord invite link detected'
            };
        }
    }

    // Anti-Links
    if (settings.antiLinks) {
        const urlRegex = /https?:\/\/[^\s]+/gi;
        const urls = content.match(urlRegex) || [];
        const whitelist = settings.antiLinksWhitelist || [];

        for (const url of urls) {
            try {
                const domain = new URL(url).hostname.toLowerCase();
                const isWhitelisted = whitelist.some(w =>
                    domain === w.toLowerCase() || domain.endsWith('.' + w.toLowerCase())
                );
                if (!isWhitelisted) {
                    return {
                        triggered: true,
                        module: 'Anti-Link',
                        action: settings.antiLinksAction,
                        reason: `Link detected: ${domain}`
                    };
                }
            } catch { }
        }
    }

    return { triggered: false };
}

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
        switch (action) {
            case 'delete':
                await message.delete().catch(() => { });
                break;

            case 'warn':
                await message.delete().catch(() => { });
                await message.channel.send(`⚠️ <@${userId}> Warning: ${reason}`).then(m =>
                    setTimeout(() => m.delete().catch(() => { }), 5000)
                );
                break;

            case 'mute':
                await message.delete().catch(() => { });
                if (member?.moderatable) {
                    await member.timeout(10 * 60 * 1000, `[${moduleName}] ${reason}`);
                }
                await message.channel.send(`🔇 <@${userId}> Muted (10m): ${reason}`).then(m =>
                    setTimeout(() => m.delete().catch(() => { }), 5000)
                );
                break;

            case 'kick':
                await message.delete().catch(() => { });
                if (member?.kickable) {
                    await member.kick(`[${moduleName}] ${reason}`);
                    await message.channel.send(`👢 ${message.author.tag} kicked: ${reason}`);
                }
                break;

            case 'ban':
                await message.delete().catch(() => { });
                if (member?.bannable) {
                    await member.ban({ reason: `[${moduleName}] ${reason}` });
                    await message.channel.send(`🔨 ${message.author.tag} banned: ${reason}`);
                }
                break;
        }

        // Record detection
        recordDetection(guildId, userId, moduleName.toLowerCase(), reason, 'medium');

    } catch (error) {
        console.error(`[AutoMod] Failed to execute ${action}:`, error.message);
    }
}

/**
 * Check for raid (mass joins)
 */
function checkRaidDetection(member, settings) {
    if (!settings.antiRaid) return false;

    const guildId = member.guild.id;
    const now = Date.now();

    let raidData = raidTracker.get(guildId) || { joins: [], inLockdown: false };

    // Clean old joins
    raidData.joins = raidData.joins.filter(t => now - t < settings.antiRaidJoinWindow);
    raidData.joins.push(now);
    raidTracker.set(guildId, raidData);

    if (raidData.joins.length >= settings.antiRaidJoinThreshold && !raidData.inLockdown) {
        raidData.inLockdown = true;
        raidTracker.set(guildId, raidData);

        // Auto-reset lockdown after 5 minutes
        setTimeout(() => {
            const data = raidTracker.get(guildId);
            if (data) {
                data.inLockdown = false;
                data.joins = [];
                raidTracker.set(guildId, data);
            }
        }, 5 * 60 * 1000);

        return {
            detected: true,
            joinCount: raidData.joins.length,
            action: settings.antiRaidAction
        };
    }

    return { detected: false };
}

// ============ AI MODERATION ============

/**
 * Build rich context for AI moderation
 */
function buildModerationContext(message, member) {
    const now = new Date();
    const accountCreated = message.author.createdAt;
    const accountAgeDays = Math.floor((now - accountCreated) / (1000 * 60 * 60 * 24));
    const joinedAt = member?.joinedAt;
    const memberAgeDays = joinedAt ? Math.floor((now - joinedAt) / (1000 * 60 * 60 * 24)) : null;

    return {
        username: message.author.username,
        displayName: message.author.displayName || message.author.username,
        userId: message.author.id,
        mention: `<@${message.author.id}>`,
        isBot: message.author.bot,
        accountCreated: accountCreated.toISOString(),
        accountAgeDays,
        memberAgeDays,
        guildName: message.guild?.name || 'DM',
        guildId: message.guild?.id || null,
        channelName: message.channel?.name || 'DM',
        channelId: message.channel?.id,
        currentTime: now.toISOString(),
        currentDate: now.toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        }),
        messageContent: message.content?.substring(0, 1000) || '',
        hasAttachments: message.attachments?.size > 0,
        attachmentCount: message.attachments?.size || 0
    };
}

/**
 * Format context for AI prompt
 */
function formatContextForAI(context) {
    return `=== MESSAGE CONTEXT ===
User: ${context.displayName} (@${context.username})
User ID: ${context.userId}
Mention: ${context.mention}
Account Age: ${context.accountAgeDays} days old
Member Age: ${context.memberAgeDays !== null ? `${context.memberAgeDays} days in server` : 'Unknown'}
Server: ${context.guildName}
Channel: #${context.channelName}
Date/Time: ${context.currentDate} at ${new Date(context.currentTime).toLocaleTimeString()}

=== MESSAGE CONTENT ===
${context.messageContent}

=== ATTACHMENTS ===
${context.hasAttachments ? `${context.attachmentCount} attachment(s)` : 'None'}`;
}

/**
 * Parse AI response in the specific format
 * Expected format:
 * ACTION:FLAG or ACTION:SAFE
 * SEVERITY:low|medium|high|critical
 * CATEGORY:scam|spam|harmful|nsfw|malware|safe
 * REASON:<explanation>
 * CONFIDENCE:<0.0-1.0>
 */
function parseAIResponse(response) {
    if (!response || typeof response !== 'string') {
        return null;
    }

    const result = {
        isUnsafe: false,
        severity: 'low',
        categories: [],
        reason: '',
        confidence: 0.5
    };

    // Handle both newline-separated and space-separated formats
    // e.g. "ACTION:FLAG SEVERITY:critical CATEGORY:scam..." or "ACTION:FLAG\nSEVERITY:critical\n..."

    // Extract ACTION
    const actionMatch = response.match(/ACTION:\s*(FLAG|SAFE)/i);
    if (actionMatch) {
        result.isUnsafe = actionMatch[1].toUpperCase() === 'FLAG';
    }

    // Extract SEVERITY
    const severityMatch = response.match(/SEVERITY:\s*(low|medium|high|critical)/i);
    if (severityMatch) {
        result.severity = severityMatch[1].toLowerCase();
    }

    // Extract CATEGORY
    const categoryMatch = response.match(/CATEGORY:\s*(\w+)/i);
    if (categoryMatch && categoryMatch[1].toLowerCase() !== 'safe') {
        result.categories = [categoryMatch[1].toLowerCase()];
    }

    // Extract REASON - everything after REASON: until the next field or end
    const reasonMatch = response.match(/REASON:\s*(.+?)(?=\s*(?:CONFIDENCE:|$))/is);
    if (reasonMatch) {
        result.reason = reasonMatch[1].trim();
    }

    // Extract CONFIDENCE
    const confidenceMatch = response.match(/CONFIDENCE:\s*([\d.]+)/i);
    if (confidenceMatch) {
        const conf = parseFloat(confidenceMatch[1]);
        if (!isNaN(conf) && conf >= 0 && conf <= 1) {
            result.confidence = conf;
        }
    }

    return result;
}

/**
 * Analyze with fallback patterns (no AI needed)
 */
function analyzeWithPatterns(content) {
    for (const { pattern, category, severity } of FALLBACK_PATTERNS) {
        if (pattern.test(content)) {
            return {
                success: true,
                result: {
                    isUnsafe: true,
                    severity,
                    categories: [category],
                    reason: `Matched pattern: ${category}`,
                    confidence: 0.7
                }
            };
        }
    }

    return {
        success: true,
        result: {
            isUnsafe: false,
            severity: 'low',
            categories: [],
            reason: 'No patterns matched',
            confidence: 1.0
        }
    };
}

/**
 * Analyze text content using internal AI moderation
 */
async function analyzeTextContent(message, member, settings) {
    const context = buildModerationContext(message, member);
    const contextString = formatContextForAI(context);

    // Try AI first if enabled
    if (settings?.useAI) {
        try {
            const aiManager = require('../ai-providers');

            // Use the correct method signature: generateResponse(systemPrompt, userPrompt, maxTokens)
            const response = await aiManager.generateResponse(
                INTERNAL_MODERATION_PROMPT,
                contextString,
                200
            );

            if (response?.content) {
                const parsed = parseAIResponse(response.content);
                if (parsed) {
                    return { success: true, result: parsed, context };
                }
            }
        } catch (error) {
            console.warn('[Moderation] AI analysis failed, using fallback:', error.message);
        }
    }

    // Fallback to pattern matching
    if (settings?.useFallbackPatterns !== false) {
        return { ...analyzeWithPatterns(context.messageContent), context };
    }

    return {
        success: true,
        result: {
            isUnsafe: false,
            severity: 'low',
            categories: [],
            reason: 'AI unavailable',
            confidence: 0.5
        },
        context
    };
}

/**
 * Analyze image content using Ollama with rich context
 */
async function analyzeImageContent(imageUrl, message, member, settings) {
    const context = buildModerationContext(message, member);

    try {
        const aiManager = require('../ai-providers');

        // Build context-aware prompt for image analysis
        const contextPrompt = `${OLLAMA_IMAGE_PROMPT}

=== CONTEXT ===
User: ${context.displayName} (@${context.username})
User ID: ${context.userId}
Account Age: ${context.accountAgeDays} days
Date/Time: ${context.currentDate}
Server: ${context.guildName}`;

        // Use the ai-providers module to handle image analysis
        // This will use any available vision-capable provider (Ollama, etc)
        const response = await aiManager.generateResponseWithImages(
            OLLAMA_IMAGE_PROMPT,
            contextPrompt,
            [{ url: imageUrl }],
            200
        );

        if (response?.content) {
            // Try parsing with our format first
            const parsed = parseAIResponse(response.content);
            if (parsed) {
                return { success: true, result: parsed, context };
            }

            // Fallback to JSON parsing
            const jsonMatch = response.content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                try {
                    const jsonResult = JSON.parse(jsonMatch[0]);
                    console.log('[Moderation] JSON parsed result:', JSON.stringify(jsonResult));
                    return { success: true, result: jsonResult, context };
                } catch { }
            }
        }
    } catch (error) {
        console.warn('[Moderation] Image analysis failed:', error.message);
    }

    return {
        success: true,
        result: {
            isUnsafe: false,
            severity: 'low',
            categories: [],
            reason: 'Could not analyze',
            confidence: 0.3
        },
        context
    };
}

// ============ TRACKING ============

function shouldMonitorMember(member, settings) {
    if (!settings.monitorNewMembers) return false;
    const accountAge = Date.now() - member.user.createdAt.getTime();
    const thresholdMs = settings.newMemberThresholdDays * 24 * 60 * 60 * 1000;
    return accountAge < thresholdMs;
}

function startTracking(guildId, userId) {
    if (!trackedMembers.has(guildId)) {
        trackedMembers.set(guildId, new Map());
    }
    trackedMembers.get(guildId).set(userId, {
        joinedAt: Date.now(),
        lastMessageAt: null,
        messageCount: 0,
        paused: false
    });
}

function isActivelyTracking(guildId, userId) {
    const guildTracked = trackedMembers.get(guildId);
    if (!guildTracked) return false;

    const tracking = guildTracked.get(userId);
    if (!tracking) return false;

    if (Date.now() - tracking.joinedAt > MONITORING_DURATION_MS) {
        guildTracked.delete(userId);
        return false;
    }

    if (tracking.paused && tracking.pausedUntil && Date.now() < tracking.pausedUntil) {
        return false;
    }

    tracking.paused = false;
    return true;
}

function pauseTracking(guildId, userId) {
    const tracking = trackedMembers.get(guildId)?.get(userId);
    if (tracking) {
        tracking.paused = true;
        tracking.pausedUntil = Date.now() + PAUSE_DURATION_MS;
    }
}

// ============ SEVERITY CHECK ============

const SEVERITY_LEVELS = { low: 1, medium: 2, high: 3, critical: 4 };

function meetsMinSeverity(resultSeverity, minSeverity) {
    return (SEVERITY_LEVELS[resultSeverity] || 0) >= (SEVERITY_LEVELS[minSeverity] || 2);
}

// ============ ALERT SYSTEM ============

function buildAlertEmbed(message, result, contentType, context, riskData) {
    const colors = { low: 0xffcc00, medium: 0xff9900, high: 0xff3300, critical: 0xff0000 };
    const severityEmojis = { low: '🟡', medium: '🟠', high: '🔴', critical: '⛔' };

    const embed = new EmbedBuilder()
        .setTitle(
            `${severityEmojis[result.severity] || '🚨'} Threat Level: ${result.severity.toUpperCase()}`
        )
        .setColor(colors[result.severity] || 0xff0000)
        .setThumbnail(message.author.displayAvatarURL({ dynamic: true, size: 64 }))
        .addFields(
            {
                name: '👤 Suspect',
                value: `${message.author.tag}\n<@${message.author.id}>\nID: \`${message.author.id}\``,
                inline: true
            },
            {
                name: '📍 Location',
                value: `<#${message.channel.id}>\n${message.guild.name}`,
                inline: true
            },
            {
                name: '🏷️ Threat Type',
                value: result.categories?.join(', ') || 'Unknown',
                inline: true
            }
        );

    // Add risk score if available
    if (riskData) {
        const riskBar =
            '█'.repeat(Math.floor(riskData.score / 10)) +
            '░'.repeat(10 - Math.floor(riskData.score / 10));
        embed.addFields({
            name: '⚠️ Risk Assessment',
            value: `\`[${riskBar}]\` **${riskData.score}%**\n${riskData.factors.length > 0 ? riskData.factors.join(' • ') : 'No additional risk factors'}`,
            inline: false
        });
    }

    // Add context
    if (context) {
        embed.addFields({
            name: '� Account Info',
            value: `Account Age: **${context.accountAgeDays}** days\nMember Since: **${context.memberAgeDays !== null ? context.memberAgeDays + ' days' : 'Unknown'}**\nHas Avatar: ${message.author.avatar ? '✅' : '❌'}`,
            inline: true
        });
    }

    embed.addFields(
        { name: '📝 AI Analysis', value: result.reason || 'No details provided', inline: false },
        {
            name: '💬 Message Preview',
            value: `\`\`\`${(message.content || '[No text content]').substring(0, 200)}${message.content?.length > 200 ? '...' : ''}\`\`\``,
            inline: false
        },
        { name: '🔗 Evidence', value: `[Jump to Message](${message.url})`, inline: true },
        {
            name: '📊 AI Confidence',
            value: `${Math.round((result.confidence || 0) * 100)}%`,
            inline: true
        },
        { name: '🕐 Detected', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true }
    );

    // Add recommended actions based on severity
    const actions = {
        low: '• Monitor user activity\n• No immediate action required',
        medium: '• Review message content\n• Consider issuing a warning',
        high: '• Delete the message\n• Issue a formal warning\n• Consider timeout',
        critical:
            '• **Immediately delete content**\n• **Ban user if confirmed scammer**\n• Report to Discord if necessary'
    };

    embed.addFields({
        name: '📋 Recommended Actions',
        value: actions[result.severity] || actions.medium,
        inline: false
    });

    embed.setFooter({ text: 'Jarvis Security System • Threat Detection Unit' }).setTimestamp();

    return embed;
}

async function sendAlert(message, result, contentType, client, context, riskData) {
    const guildId = message.guild.id;
    const settings = getSettings(guildId);

    // Build pings
    const pings = [];
    if (settings.pingOwner) pings.push(`<@${message.guild.ownerId}>`);
    for (const roleId of settings.pingRoles || []) pings.push(`<@&${roleId}>`);
    for (const userId of settings.pingUsers || []) pings.push(`<@${userId}>`);
    const pingString = pings.join(' ');

    // Build alert message
    const category = result.categories?.[0] || 'scam';
    const severity = result.severity || 'medium';
    const reason = result.reason || 'Suspicious content detected';
    const userMention = `<@${message.author.id}>`;
    const userName = message.author.tag || message.author.username;

    let alertMessage;
    if (settings.customAlertTemplate && settings.customAlertTemplate.trim()) {
        // Use custom template with variable replacement
        alertMessage = settings.customAlertTemplate
            .replace(/\{user\}/gi, userMention)
            .replace(/\{username\}/gi, userName)
            .replace(/\{category\}/gi, category.toUpperCase())
            .replace(/\{severity\}/gi, severity.toUpperCase())
            .replace(/\{pings\}/gi, pingString)
            .replace(/\{reason\}/gi, reason)
            .replace(/\{channel\}/gi, `<#${message.channel.id}>`)
            .replace(/\{type\}/gi, contentType);
    } else {
        // Default Jarvis-style
        alertMessage = buildJarvisAlert(category, pingString);
    }

    // Prepare message payload
    const payload = { content: alertMessage };

    // Add embed if enabled
    if (settings.useEmbeds !== false) {
        const embed = buildAlertEmbed(message, result, contentType, context, riskData);
        payload.embeds = [embed];
    }

    // Determine target channel (alertChannel or message channel)
    const targetChannel = settings.alertChannel
        ? await client.channels.fetch(settings.alertChannel).catch(() => message.channel)
        : message.channel;

    // Send alert
    try {
        await safeSend(targetChannel, payload, client);
    } catch (error) {
        console.error('[Moderation] Failed to send alert:', error.message);
    }

    // Also send to log channel if configured (different from alert channel)
    if (settings.logChannel && settings.logChannel !== targetChannel.id) {
        try {
            const channel = await client.channels.fetch(settings.logChannel);
            if (channel) {
                // Log channel always gets embed for record keeping
                const embed = buildAlertEmbed(message, result, contentType, context, riskData);
                await safeSend(channel, { content: pingString, embeds: [embed] }, client);
            }
        } catch (error) {
            console.error('[Moderation] Failed to send to log channel:', error.message);
        }
    }
}

// ============ MESSAGE HANDLER ============

async function handleMessage(message, client) {
    if (!message.guild || message.author.bot) return { handled: false };

    const guildId = message.guild.id;
    if (!isEnabled(guildId)) return { handled: false };

    const settings = getSettings(guildId);
    const userId = message.author.id;
    const member = message.member || (await message.guild.members.fetch(userId).catch(() => null));

    // Check whitelist
    if (member && isWhitelisted(guildId, member)) {
        return { handled: false, reason: 'Whitelisted' };
    }

    // Check if tracking
    if (!isActivelyTracking(guildId, userId)) {
        if (member && shouldMonitorMember(member, settings)) {
            startTracking(guildId, userId);
        } else {
            return { handled: false };
        }
    }

    // Check rate limit
    if (isOnAlertCooldown(guildId, userId)) {
        return { handled: false, reason: 'On cooldown' };
    }

    // Check auto-mod modules FIRST (synchronous, fast checks)
    const autoModResult = checkAutoModules(message, settings);
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
                const textResult = await analyzeTextContent(message, member, settings);
                const context = textResult.context;
                const riskData = context ? calculateRiskScore(message, member, context) : null;

                if (textResult.success && textResult.result?.isUnsafe) {
                    if (
                        meetsMinSeverity(
                            textResult.result.severity,
                            settings.minSeverity || 'medium'
                        )
                    ) {
                        await sendAlert(
                            message,
                            textResult.result,
                            'text',
                            client,
                            context,
                            riskData
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
                        setAlertCooldown(guildId, userId);
                        pauseTracking(guildId, userId);
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
                        const imageResult = await analyzeImageContent(
                            attachment.url,
                            message,
                            member,
                            settings
                        );
                        const context = imageResult.context;
                        const riskData = context ? calculateRiskScore(message, member, context) : null;

                        if (imageResult.success && imageResult.result?.isUnsafe) {
                            if (
                                meetsMinSeverity(
                                    imageResult.result.severity,
                                    settings.minSeverity || 'medium'
                                )
                            ) {
                                await sendAlert(
                                    message,
                                    imageResult.result,
                                    'image',
                                    client,
                                    context,
                                    riskData
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
                                setAlertCooldown(guildId, userId);
                                pauseTracking(guildId, userId);
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
    const raidResult = checkRaidDetection(member, settings);
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
    if (shouldMonitorMember(member, settings)) {
        startTracking(guildId, member.id);
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
    analyzeTextContent,
    analyzeImageContent,
    analyzeWithPatterns,
    handleMessage,
    handleMemberJoin,
    sendAlert,
    loadConfig,
    saveConfig,
    parseAIResponse,
    buildModerationContext
};

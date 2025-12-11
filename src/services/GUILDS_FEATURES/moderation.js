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

// Check if we're in selfhost/local mode
const LOCAL_DB_MODE = String(process.env.LOCAL_DB_MODE || '').toLowerCase() === '1';
const SELFHOST_MODE = String(process.env.SELFHOST_MODE || '').toLowerCase() === 'true';

// Database imports (lazy loaded)
let database = null;
let localDb = null;

// Collection name for moderation config
const COLLECTION_NAME = 'guildModeration';

// Allowed guilds that CAN enable moderation (whitelist)
const ALLOWED_GUILDS = [
    '858444090374881301'  // Primary guild
];

// In-memory cache of enabled guilds
let enabledGuilds = new Map();

// Tracked members (new members being monitored)
const trackedMembers = new Map();

// Rate limiting for alerts (prevent spam)
const alertCooldowns = new Map(); // `${guildId}:${userId}` -> timestamp
const ALERT_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes between alerts per user

// Detection statistics
const detectionStats = new Map(); // guildId -> { total, byCategory, byUser }

// Monitoring settings
const MONITORING_DURATION_MS = 60 * 60 * 1000; // 1 hour
const PAUSE_DURATION_MS = 5 * 60 * 1000; // 5 min pause after detection

// AI Moderation prompts
const TEXT_MODERATION_PROMPT = `You are a content moderation AI. Analyze the message for:
- Scam attempts (crypto scams, fake giveaways, phishing, "free nitro")
- Spam content (advertising, repetitive messages, self-promotion)
- Harmful content (harassment, threats, hate speech, slurs)
- NSFW content (sexual, explicit)
- Malicious links (phishing, malware)

You MUST respond ONLY by calling the moderationResult function.`;

const IMAGE_MODERATION_PROMPT = `Analyze this image for inappropriate content including NSFW, scams, gore, or spam. Respond with JSON: {"isUnsafe": boolean, "severity": "low"|"medium"|"high"|"critical", "categories": [], "reason": "string", "confidence": number}`;

// Fallback patterns for when AI is unavailable
const FALLBACK_PATTERNS = [
    { pattern: /free\s*nitro|discord\.gift|discordgift/i, category: 'scam', severity: 'high' },
    { pattern: /click\s*(here|this|now)|bit\.ly|tinyurl|t\.co/i, category: 'spam', severity: 'medium' },
    { pattern: /crypto\s*(airdrop|giveaway)|nft\s*(mint|drop|free)/i, category: 'scam', severity: 'high' },
    { pattern: /earn\s*\$\d+|investment\s*opportunity|passive\s*income/i, category: 'scam', severity: 'high' },
    { pattern: /18\+|nsfw|onlyfans|fansly|porn/i, category: 'nsfw', severity: 'medium' },
    { pattern: /@everyone|@here/i, category: 'spam', severity: 'low' },
    { pattern: /dm\s*me|check\s*my\s*(bio|profile)/i, category: 'spam', severity: 'low' }
];

// ============ DATABASE FUNCTIONS ============

/**
 * Initialize database connection
 */
async function initDatabase() {
    try {
        if (LOCAL_DB_MODE || SELFHOST_MODE) {
            // Use local database
            localDb = require('../../localdb');
            console.log('[Moderation] Using local database');
        } else {
            // Use MongoDB
            database = require('../database');
            console.log('[Moderation] Using MongoDB');
        }
    } catch (error) {
        console.error('[Moderation] Failed to initialize database:', error);
    }
}

/**
 * Load config from database
 */
async function loadConfig() {
    try {
        if (LOCAL_DB_MODE || SELFHOST_MODE) {
            // Load from local file
            const dataPath = path.join(__dirname, '../../../data/moderation-config.json');
            if (fs.existsSync(dataPath)) {
                const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
                enabledGuilds = new Map(Object.entries(data.enabledGuilds || {}));
            }
        } else if (database?.isConnected) {
            // Load from MongoDB
            const collection = database.getCollection(COLLECTION_NAME);
            if (collection) {
                const configs = await collection.find({}).toArray();
                for (const config of configs) {
                    enabledGuilds.set(config.guildId, config);
                }
            }
        }
        console.log('[Moderation] Loaded config for', enabledGuilds.size, 'guilds');
    } catch (error) {
        console.error('[Moderation] Failed to load config:', error);
    }
}

/**
 * Save config to database
 */
async function saveConfig(guildId) {
    try {
        const config = enabledGuilds.get(guildId);
        if (!config) return;
        
        if (LOCAL_DB_MODE || SELFHOST_MODE) {
            // Save to local file
            const dataDir = path.join(__dirname, '../../../data');
            const dataPath = path.join(dataDir, 'moderation-config.json');
            
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
            }
            
            const data = {
                enabledGuilds: Object.fromEntries(enabledGuilds),
                updatedAt: new Date().toISOString()
            };
            fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
        } else if (database?.isConnected) {
            // Save to MongoDB
            const collection = database.getCollection(COLLECTION_NAME);
            if (collection) {
                await collection.updateOne(
                    { guildId },
                    { $set: { ...config, guildId, updatedAt: new Date() } },
                    { upsert: true }
                );
            }
        }
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
        
        // Actions
        autoDelete: false,
        autoMute: false,
        autoBan: false
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
        trackedMembersCount: trackedMembers.get(guildId)?.size || 0
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

function isOnAlertCooldown(guildId, userId) {
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
}

// ============ STATISTICS ============

function recordDetection(guildId, userId, category) {
    const config = enabledGuilds.get(guildId);
    if (!config) return;
    
    if (!config.stats) {
        config.stats = { total: 0, byCategory: {}, byUser: {} };
    }
    
    config.stats.total++;
    config.stats.byCategory[category] = (config.stats.byCategory[category] || 0) + 1;
    config.stats.byUser[userId] = (config.stats.byUser[userId] || 0) + 1;
    
    // Save periodically (every 10 detections)
    if (config.stats.total % 10 === 0) {
        saveConfig(guildId);
    }
}

// ============ AI MODERATION ============

const MODERATION_FUNCTION = {
    name: 'moderationResult',
    description: 'Report moderation analysis result',
    parameters: {
        type: 'object',
        properties: {
            isUnsafe: { type: 'boolean' },
            severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
            categories: { type: 'array', items: { type: 'string' } },
            reason: { type: 'string' },
            confidence: { type: 'number' }
        },
        required: ['isUnsafe', 'severity', 'categories', 'reason', 'confidence']
    }
};

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
    
    return { success: true, result: { isUnsafe: false, severity: 'low', categories: [], reason: 'No patterns matched', confidence: 1.0 } };
}

/**
 * Analyze text content using AI with function calling
 */
async function analyzeTextContent(content, settings) {
    // Try AI first if enabled
    if (settings?.useAI) {
        try {
            const aiManager = require('../ai-providers');
            
            const messages = [
                { role: 'system', content: TEXT_MODERATION_PROMPT },
                { role: 'user', content: `Analyze: ${content.substring(0, 500)}` }
            ];
            
            const response = await aiManager.generateWithFunctions(messages, [MODERATION_FUNCTION], {
                functionCall: { name: 'moderationResult' },
                maxTokens: 150,
                temperature: 0.1
            });
            
            if (response?.functionCall?.name === 'moderationResult') {
                return { success: true, result: response.functionCall.arguments };
            }
            
            // Try parsing response as JSON
            if (response?.content) {
                try {
                    const parsed = JSON.parse(response.content);
                    return { success: true, result: parsed };
                } catch {}
            }
        } catch (error) {
            console.warn('[Moderation] AI analysis failed, using fallback:', error.message);
        }
    }
    
    // Fallback to pattern matching
    if (settings?.useFallbackPatterns !== false) {
        return analyzeWithPatterns(content);
    }
    
    return { success: true, result: { isUnsafe: false, severity: 'low', categories: [], reason: 'AI unavailable', confidence: 0.5 } };
}

/**
 * Analyze image content using Ollama
 */
async function analyzeImageContent(imageUrl, settings) {
    try {
        const fetch = require('node-fetch');
        const ollamaUrl = settings?.ollamaUrl || 'http://localhost:11434';
        const model = settings?.ollamaModel || 'llava';
        
        const imageResponse = await fetch(imageUrl);
        const imageBuffer = await imageResponse.buffer();
        const base64Image = imageBuffer.toString('base64');
        
        const response = await fetch(`${ollamaUrl}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model,
                prompt: IMAGE_MODERATION_PROMPT,
                images: [base64Image],
                stream: false
            })
        });
        
        const data = await response.json();
        
        if (data.response) {
            const jsonMatch = data.response.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return { success: true, result: JSON.parse(jsonMatch[0]) };
            }
        }
    } catch (error) {
        console.warn('[Moderation] Image analysis failed:', error.message);
    }
    
    return { success: true, result: { isUnsafe: false, severity: 'low', categories: [], reason: 'Could not analyze', confidence: 0.3 } };
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

function buildAlertEmbed(message, result, contentType) {
    const colors = { low: 0xFFCC00, medium: 0xFF9900, high: 0xFF3300, critical: 0xFF0000 };
    
    return new EmbedBuilder()
        .setTitle(`🚨 ${contentType === 'image' ? 'Image' : 'Message'} Flagged - ${result.severity.toUpperCase()}`)
        .setColor(colors[result.severity] || 0xFF0000)
        .addFields(
            { name: '👤 User', value: `${message.author.tag}\n<@${message.author.id}>`, inline: true },
            { name: '📍 Channel', value: `<#${message.channel.id}>`, inline: true },
            { name: '🏷️ Categories', value: result.categories?.join(', ') || 'Unknown', inline: true },
            { name: '📝 Reason', value: result.reason || 'No reason', inline: false },
            { name: '💬 Preview', value: `\`\`\`${(message.content || '').substring(0, 150)}\`\`\``, inline: false },
            { name: '🔗 Jump', value: `[Go to message](${message.url})`, inline: true },
            { name: '📊 Confidence', value: `${Math.round((result.confidence || 0) * 100)}%`, inline: true }
        )
        .setFooter({ text: 'Jarvis AI Moderation' })
        .setTimestamp();
}

async function sendAlert(message, result, contentType, client) {
    const guildId = message.guild.id;
    const settings = getSettings(guildId);
    const embed = buildAlertEmbed(message, result, contentType);
    
    // Build pings
    const pings = [];
    if (settings.pingOwner) pings.push(`<@${message.guild.ownerId}>`);
    for (const roleId of settings.pingRoles || []) pings.push(`<@&${roleId}>`);
    for (const userId of settings.pingUsers || []) pings.push(`<@${userId}>`);
    const pingString = pings.join(' ');
    
    // Send in current channel
    try {
        await message.channel.send({ content: `🚨 **Suspicious content detected!** ${pingString}`, embeds: [embed] });
    } catch (error) {
        console.error('[Moderation] Failed to send alert:', error.message);
    }
    
    // Also send to log channel if configured
    if (settings.logChannel && settings.logChannel !== message.channel.id) {
        try {
            const channel = await client.channels.fetch(settings.logChannel);
            if (channel) await channel.send({ content: pingString, embeds: [embed] });
        } catch {}
    }
}

// ============ MESSAGE HANDLER ============

async function handleMessage(message, client) {
    if (!message.guild || message.author.bot) return { handled: false };
    
    const guildId = message.guild.id;
    if (!isEnabled(guildId)) return { handled: false };
    
    const settings = getSettings(guildId);
    const userId = message.author.id;
    const member = message.member || await message.guild.members.fetch(userId).catch(() => null);
    
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
    
    // Analyze in background (non-blocking)
    setImmediate(async () => {
        try {
            // Text analysis
            if (message.content?.length > 3) {
                const textResult = await analyzeTextContent(message.content, settings);
                
                if (textResult.success && textResult.result?.isUnsafe) {
                    if (meetsMinSeverity(textResult.result.severity, settings.minSeverity || 'medium')) {
                        await sendAlert(message, textResult.result, 'text', client);
                        setAlertCooldown(guildId, userId);
                        pauseTracking(guildId, userId);
                        recordDetection(guildId, userId, textResult.result.categories?.[0] || 'unknown');
                    }
                }
            }
            
            // Image analysis
            for (const attachment of message.attachments.values()) {
                if (attachment.contentType?.startsWith('image/')) {
                    const imageResult = await analyzeImageContent(attachment.url, settings);
                    
                    if (imageResult.success && imageResult.result?.isUnsafe) {
                        if (meetsMinSeverity(imageResult.result.severity, settings.minSeverity || 'medium')) {
                            await sendAlert(message, imageResult.result, 'image', client);
                            setAlertCooldown(guildId, userId);
                            pauseTracking(guildId, userId);
                            recordDetection(guildId, userId, imageResult.result.categories?.[0] || 'image');
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
    MODERATION_FUNCTION
};

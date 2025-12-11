/**
 * Guild Moderation System - AI-Powered Content Detection
 * 
 * Features:
 * - AI-based text content moderation (using function calling)
 * - Image content moderation via Ollama
 * - Monitors new members' messages for a period
 * - Configurable ping targets (roles/users)
 * - Auto-pause/resume based on member activity
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

// Tracked members (new members being monitored)
// Map<guildId, Map<userId, { joinedAt, lastMessageAt, messageCount, paused, pausedUntil }>>
const trackedMembers = new Map();

// Monitoring duration for new members (1 hour)
const MONITORING_DURATION_MS = 60 * 60 * 1000;

// Pause duration when member is inactive (resumes on next message)
const PAUSE_DURATION_MS = 5 * 60 * 1000;

// AI Moderation prompts
const TEXT_MODERATION_PROMPT = `You are a content moderation AI. Analyze the message and determine if it contains:
- Scam attempts (crypto scams, fake giveaways, phishing)
- Spam content (advertising, repetitive messages)
- Harmful content (harassment, threats, hate speech)
- NSFW content
- Malicious links

You MUST respond ONLY by calling the moderationResult function with your analysis.`;

const IMAGE_MODERATION_PROMPT = `Analyze this image for:
- NSFW/inappropriate content
- Scam imagery (fake giveaways, crypto scams)
- Gore or disturbing content
- Spam/advertising

Respond ONLY with the moderationResult function call.`;

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
 * Get default moderation settings
 */
function getDefaultSettings() {
    return {
        // Ping configuration
        pingRoles: [],           // Role IDs to ping on detection
        pingUsers: [],           // User IDs to ping on detection
        pingOwner: true,         // Ping server owner
        
        // Detection settings
        monitorNewMembers: true, // Monitor messages from new members
        newMemberThresholdDays: 7, // Consider "new" if account < 7 days old
        monitorDurationHours: 1, // How long to monitor new members
        
        // AI settings
        useAI: true,             // Use AI for content analysis
        aiProvider: 'openai',    // AI provider for text (openai, groq, etc.)
        ollamaUrl: process.env.OLLAMA_URL || 'http://localhost:11434',
        ollamaModel: 'llava',    // Ollama model for images
        
        // Log channel
        logChannel: null,        // Channel ID for moderation logs
        
        // Actions
        autoDelete: false,       // Auto-delete detected messages
        autoMute: false,         // Auto-mute on detection
        autoBan: false           // Auto-ban on severe violations
    };
}

/**
 * Enable moderation for a guild
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
    
    // Initialize tracked members for this guild
    if (!trackedMembers.has(guildId)) {
        trackedMembers.set(guildId, new Map());
    }
    
    saveConfig();
    console.log(`[Moderation] Enabled for guild ${guildId} by user ${enabledBy}`);
    return { success: true };
}

/**
 * Disable moderation for a guild
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
    
    // Clear tracked members
    trackedMembers.delete(guildId);
    
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
 * Get status for a guild
 */
function getStatus(guildId) {
    const config = enabledGuilds.get(guildId);
    return {
        canEnable: canEnableModeration(guildId),
        isEnabled: isEnabled(guildId),
        enabledBy: config?.enabledBy || null,
        enabledAt: config?.enabledAt || null,
        settings: config?.settings || getDefaultSettings(),
        trackedMembersCount: trackedMembers.get(guildId)?.size || 0
    };
}

// ============ AI MODERATION FUNCTIONS ============

/**
 * The function schema for AI moderation responses
 */
const MODERATION_FUNCTION = {
    name: 'moderationResult',
    description: 'Report the moderation analysis result',
    parameters: {
        type: 'object',
        properties: {
            isUnsafe: {
                type: 'boolean',
                description: 'Whether the content is unsafe/violates rules'
            },
            severity: {
                type: 'string',
                enum: ['low', 'medium', 'high', 'critical'],
                description: 'Severity level of the violation'
            },
            categories: {
                type: 'array',
                items: { type: 'string' },
                description: 'Categories of violation detected (scam, spam, nsfw, harassment, etc.)'
            },
            reason: {
                type: 'string',
                description: 'Brief explanation of why content is unsafe'
            },
            confidence: {
                type: 'number',
                description: 'Confidence level 0-1'
            }
        },
        required: ['isUnsafe', 'severity', 'categories', 'reason', 'confidence']
    }
};

/**
 * Analyze text content using AI with function calling
 */
async function analyzeTextContent(content, aiProvider = null) {
    try {
        // Dynamic import to avoid circular dependencies
        const aiManager = require('../ai-providers');
        
        const messages = [
            { role: 'system', content: TEXT_MODERATION_PROMPT },
            { role: 'user', content: `Analyze this message:\n\n${content}` }
        ];
        
        // Use function calling
        const response = await aiManager.generateWithFunctions(messages, [MODERATION_FUNCTION], {
            functionCall: { name: 'moderationResult' },
            maxTokens: 200,
            temperature: 0.1
        });
        
        if (response?.functionCall?.name === 'moderationResult') {
            return {
                success: true,
                result: response.functionCall.arguments
            };
        }
        
        // Fallback: try to parse response as JSON
        if (response?.content) {
            try {
                const parsed = JSON.parse(response.content);
                return { success: true, result: parsed };
            } catch {
                // Not JSON, assume safe
                return {
                    success: true,
                    result: {
                        isUnsafe: false,
                        severity: 'low',
                        categories: [],
                        reason: 'Could not parse AI response',
                        confidence: 0.5
                    }
                };
            }
        }
        
        return { success: false, error: 'No valid response from AI' };
    } catch (error) {
        console.error('[Moderation] Text analysis error:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Analyze image content using Ollama
 */
async function analyzeImageContent(imageUrl, settings) {
    try {
        const fetch = require('node-fetch');
        
        const ollamaUrl = settings?.ollamaUrl || 'http://localhost:11434';
        const model = settings?.ollamaModel || 'llava';
        
        // Download image and convert to base64
        const imageResponse = await fetch(imageUrl);
        const imageBuffer = await imageResponse.buffer();
        const base64Image = imageBuffer.toString('base64');
        
        // Call Ollama with the image
        const response = await fetch(`${ollamaUrl}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: model,
                prompt: IMAGE_MODERATION_PROMPT + '\n\nRespond with JSON: {"isUnsafe": boolean, "severity": "low"|"medium"|"high"|"critical", "categories": [], "reason": "string", "confidence": number}',
                images: [base64Image],
                stream: false
            })
        });
        
        const data = await response.json();
        
        if (data.response) {
            try {
                // Try to extract JSON from response
                const jsonMatch = data.response.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    const parsed = JSON.parse(jsonMatch[0]);
                    return { success: true, result: parsed };
                }
            } catch {
                // Parsing failed
            }
        }
        
        return {
            success: true,
            result: {
                isUnsafe: false,
                severity: 'low',
                categories: [],
                reason: 'Could not analyze image',
                confidence: 0.3
            }
        };
    } catch (error) {
        console.error('[Moderation] Image analysis error:', error);
        return { success: false, error: error.message };
    }
}

// ============ MESSAGE MONITORING ============

/**
 * Check if a member should be monitored
 */
function shouldMonitorMember(member, settings) {
    if (!settings.monitorNewMembers) return false;
    
    const accountAge = Date.now() - member.user.createdAt.getTime();
    const thresholdMs = settings.newMemberThresholdDays * 24 * 60 * 60 * 1000;
    
    return accountAge < thresholdMs;
}

/**
 * Start tracking a member
 */
function startTracking(guildId, userId) {
    if (!trackedMembers.has(guildId)) {
        trackedMembers.set(guildId, new Map());
    }
    
    const guildTracked = trackedMembers.get(guildId);
    guildTracked.set(userId, {
        joinedAt: Date.now(),
        lastMessageAt: null,
        messageCount: 0,
        paused: false,
        pausedUntil: null
    });
}

/**
 * Check if member is being tracked and not paused
 */
function isActivelyTracking(guildId, userId) {
    const guildTracked = trackedMembers.get(guildId);
    if (!guildTracked) return false;
    
    const tracking = guildTracked.get(userId);
    if (!tracking) return false;
    
    // Check if monitoring duration expired
    if (Date.now() - tracking.joinedAt > MONITORING_DURATION_MS) {
        guildTracked.delete(userId);
        return false;
    }
    
    // Check if paused
    if (tracking.paused) {
        if (tracking.pausedUntil && Date.now() < tracking.pausedUntil) {
            return false;
        }
        // Auto-resume
        tracking.paused = false;
        tracking.pausedUntil = null;
    }
    
    return true;
}

/**
 * Update tracking on message
 */
function updateTracking(guildId, userId) {
    const guildTracked = trackedMembers.get(guildId);
    if (!guildTracked) return;
    
    const tracking = guildTracked.get(userId);
    if (!tracking) return;
    
    tracking.lastMessageAt = Date.now();
    tracking.messageCount++;
    
    // Resume if paused
    if (tracking.paused) {
        tracking.paused = false;
        tracking.pausedUntil = null;
    }
}

/**
 * Pause tracking for a member
 */
function pauseTracking(guildId, userId) {
    const guildTracked = trackedMembers.get(guildId);
    if (!guildTracked) return;
    
    const tracking = guildTracked.get(userId);
    if (!tracking) return;
    
    tracking.paused = true;
    tracking.pausedUntil = Date.now() + PAUSE_DURATION_MS;
}

// ============ ALERT SYSTEM ============

/**
 * Build an alert embed for detected content
 */
function buildAlertEmbed(message, analysisResult, contentType = 'text') {
    const colors = {
        low: 0xFFCC00,
        medium: 0xFF9900,
        high: 0xFF3300,
        critical: 0xFF0000
    };
    
    const embed = new EmbedBuilder()
        .setTitle(`🚨 ${contentType === 'image' ? 'Image' : 'Message'} Flagged - ${analysisResult.severity.toUpperCase()}`)
        .setColor(colors[analysisResult.severity] || 0xFF0000)
        .setTimestamp();
    
    // User info
    embed.addFields({
        name: '👤 User',
        value: `${message.author.tag} (<@${message.author.id}>)\nID: \`${message.author.id}\``,
        inline: true
    });
    
    // Channel info
    embed.addFields({
        name: '📍 Channel',
        value: `<#${message.channel.id}>`,
        inline: true
    });
    
    // Categories
    if (analysisResult.categories?.length > 0) {
        embed.addFields({
            name: '🏷️ Categories',
            value: analysisResult.categories.join(', '),
            inline: true
        });
    }
    
    // Reason
    embed.addFields({
        name: '📝 Reason',
        value: analysisResult.reason || 'No reason provided',
        inline: false
    });
    
    // Content preview (truncated)
    if (contentType === 'text' && message.content) {
        const preview = message.content.length > 200 
            ? message.content.substring(0, 200) + '...' 
            : message.content;
        embed.addFields({
            name: '💬 Content Preview',
            value: `\`\`\`${preview}\`\`\``,
            inline: false
        });
    }
    
    // Message link
    embed.addFields({
        name: '🔗 Jump to Message',
        value: `[Click here](${message.url})`,
        inline: true
    });
    
    // Confidence
    embed.addFields({
        name: '📊 Confidence',
        value: `${Math.round((analysisResult.confidence || 0) * 100)}%`,
        inline: true
    });
    
    embed.setFooter({ text: 'Jarvis AI Moderation • Automated Detection' });
    
    return embed;
}

/**
 * Send alert to configured targets
 */
async function sendAlert(message, analysisResult, contentType, client) {
    const guildId = message.guild.id;
    const settings = getSettings(guildId);
    
    const embed = buildAlertEmbed(message, analysisResult, contentType);
    
    // Build ping string
    const pings = [];
    
    if (settings.pingOwner) {
        pings.push(`<@${message.guild.ownerId}>`);
    }
    
    for (const roleId of settings.pingRoles || []) {
        pings.push(`<@&${roleId}>`);
    }
    
    for (const userId of settings.pingUsers || []) {
        pings.push(`<@${userId}>`);
    }
    
    const pingString = pings.length > 0 ? pings.join(' ') : '';
    
    // Send to log channel if configured
    if (settings.logChannel) {
        try {
            const channel = await client.channels.fetch(settings.logChannel);
            if (channel) {
                await channel.send({
                    content: pingString,
                    embeds: [embed]
                });
            }
        } catch (error) {
            console.error('[Moderation] Failed to send to log channel:', error);
        }
    } else {
        // DM the server owner
        try {
            const owner = await message.guild.fetchOwner();
            if (owner) {
                await owner.send({
                    content: `🚨 **Content flagged in ${message.guild.name}**`,
                    embeds: [embed]
                });
            }
        } catch (error) {
            console.error('[Moderation] Failed to DM owner:', error);
        }
    }
}

// ============ MESSAGE HANDLER ============

/**
 * Handle incoming message for moderation
 */
async function handleMessage(message, client) {
    // Skip if not in a guild or from a bot
    if (!message.guild || message.author.bot) return { handled: false };
    
    const guildId = message.guild.id;
    
    // Check if moderation is enabled
    if (!isEnabled(guildId)) {
        return { handled: false, reason: 'Moderation not enabled' };
    }
    
    const settings = getSettings(guildId);
    const userId = message.author.id;
    
    // Check if we should monitor this member
    if (!isActivelyTracking(guildId, userId)) {
        // Check if this is a new member we should start tracking
        const member = message.member || await message.guild.members.fetch(userId).catch(() => null);
        if (member && shouldMonitorMember(member, settings)) {
            startTracking(guildId, userId);
        } else {
            return { handled: false, reason: 'Member not being tracked' };
        }
    }
    
    // Update tracking
    updateTracking(guildId, userId);
    
    // Skip if AI is disabled
    if (!settings.useAI) {
        return { handled: false, reason: 'AI moderation disabled' };
    }
    
    try {
        // Analyze text content
        if (message.content && message.content.length > 3) {
            const textResult = await analyzeTextContent(message.content);
            
            if (textResult.success && textResult.result?.isUnsafe) {
                await sendAlert(message, textResult.result, 'text', client);
                
                // Pause tracking after detection to avoid spam
                pauseTracking(guildId, userId);
                
                return {
                    handled: true,
                    detected: true,
                    type: 'text',
                    result: textResult.result
                };
            }
        }
        
        // Analyze image attachments
        for (const attachment of message.attachments.values()) {
            if (attachment.contentType?.startsWith('image/')) {
                const imageResult = await analyzeImageContent(attachment.url, settings);
                
                if (imageResult.success && imageResult.result?.isUnsafe) {
                    await sendAlert(message, imageResult.result, 'image', client);
                    
                    pauseTracking(guildId, userId);
                    
                    return {
                        handled: true,
                        detected: true,
                        type: 'image',
                        result: imageResult.result
                    };
                }
            }
        }
        
        return { handled: true, detected: false };
    } catch (error) {
        console.error('[Moderation] Error handling message:', error);
        return { handled: false, error: error.message };
    }
}

/**
 * Handle member join - just start tracking if needed
 * (No longer sends warnings - users have join/leave logs for that)
 */
async function handleMemberJoin(member, client) {
    const guildId = member.guild.id;
    
    if (!isEnabled(guildId)) {
        return { handled: false };
    }
    
    const settings = getSettings(guildId);
    
    if (shouldMonitorMember(member, settings)) {
        startTracking(guildId, member.id);
        console.log(`[Moderation] Started tracking new member ${member.user.tag} in guild ${guildId}`);
        return { handled: true, tracking: true };
    }
    
    return { handled: false };
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
    
    // Tracking
    startTracking,
    isActivelyTracking,
    pauseTracking,
    
    // Analysis
    analyzeTextContent,
    analyzeImageContent,
    MODERATION_FUNCTION,
    
    // Handlers
    handleMessage,
    handleMemberJoin,
    sendAlert,
    
    // Reload config
    loadConfig,
    saveConfig
};

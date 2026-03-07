'use strict';

const { EmbedBuilder } = require('discord.js');
const { safeSend } = require('../../utils/discord-safe-send');

// ============ RATE LIMITING ============

// Global rate limit: 10 alerts max per 2 seconds
const alertTimestamps = [];
const MAX_ALERTS_PER_WINDOW = 10;
const RATE_LIMIT_WINDOW_MS = 2000;

// Per-user cooldown (prevent spam from same user)
const alertCooldowns = new Map();
const ALERT_COOLDOWN_MS = 5 * 1000;

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
            name: '🔍 Account Info',
            value: `Account Age: **${context.accountAgeDays}** days\nMember Since: **${context.memberAgeDays !== null ? `${context.memberAgeDays  } days` : 'Unknown'}**\nHas Avatar: ${message.author.avatar ? '✅' : '❌'}`,
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

/**
 * Send moderation alert to the appropriate channel.
 * @param {object} settings - Guild moderation settings (passed by caller to avoid circular dependency)
 */
async function sendAlert(message, result, contentType, client, context, riskData, settings) {
    // Build pings
    const pings = [];
    if (settings.pingOwner) {pings.push(`<@${message.guild.ownerId}>`);}
    for (const roleId of settings.pingRoles || []) {pings.push(`<@&${roleId}>`);}
    for (const userId of settings.pingUsers || []) {pings.push(`<@${userId}>`);}
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

module.exports = {
    isOnAlertCooldown,
    setAlertCooldown,
    buildAlertEmbed,
    sendAlert
};

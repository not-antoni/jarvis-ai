'use strict';

const config = require('../../../config');
const clankerGif = require('../../utils/clanker-gif');
const { isFeatureGloballyEnabled } = require('../../core/feature-flags');

async function handleMessage(handler, message, client) {
const path = require('path');
const { AttachmentBuilder } = require('discord.js');
const allowedBotIds = (process.env.ALLOWED_BOTS || '984734399310467112,1391010888915484672')
    .split(',')
    .map(id => id.trim())
    .filter(id => id.length > 0);
if (message.author.id === client.user.id) {return;}
if (message.author.bot && !allowedBotIds.includes(message.author.id)) {return;}


if (!message.guild) {
    return;
}

// Track guild activity
try {
    const activityTracker = require('../GUILDS_FEATURES/activity-tracker');
    activityTracker.recordMessage(message.guild.id, message.channel.id, message.author.id);
} catch (_e) { /* activity tracker not available */ }

const chatEnabled = await handler.isCommandFeatureEnabled('jarvis', message.guild);
if (!chatEnabled || !isFeatureGloballyEnabled('coreChat')) {
    return;
}

const userId = message.author.id;

const messageScope = 'message:jarvis';
const allowWakeWords = Boolean(config.discord?.messageContent?.enabled);
const rawContent = typeof message.content === 'string' ? message.content : '';
const normalizedContent = rawContent.toLowerCase();

// Strip Discord formatting to catch attempts to hide it in codeblocks, bold, etc.
const stripDiscordFormatting = (text) => {
    return text
        // Remove code blocks (```text```)
        .replace(/```[\s\S]*?```/g, (match) => match.replace(/```/g, ''))
        // Remove inline code (`text`)
        .replace(/`([^`]+)`/g, '$1')
        // Remove bold (**text**)
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        // Remove italic (*text* or _text_)
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/_([^_]+)_/g, '$1')
        // Remove underline (__text__)
        .replace(/__([^_]+)__/g, '$1')
        // Remove strikethrough (~~text~~)
        .replace(/~~([^~]+)~~/g, '$1')
        // Remove spoilers (||text||)
        .replace(/\|\|([^|]+)\|\|/g, '$1');
};

const strippedContent = stripDiscordFormatting(rawContent);
let containsWakeWord = false;

// Check for custom guild/user wake words FIRST — if a guild has a custom
// wake word, it REPLACES the defaults (jarvis/garmin) for that server.
let customWakeWordTriggered = false;
let guildHasCustomWakeWord = false;
let guildWakeWordsDisabled = false;
if (allowWakeWords && normalizedContent) {
    try {
        const userFeatures = require('../user-features');
        // Check guild custom wake word
        if (message.guild) {
            const guildWord = await userFeatures.getGuildWakeWord(message.guild.id);
            if (guildWord) {
                guildHasCustomWakeWord = true;
                customWakeWordTriggered = await userFeatures.matchesGuildWakeWord(message.guild.id, normalizedContent);
            }
            guildWakeWordsDisabled = await userFeatures.isGuildWakeWordsDisabled(message.guild.id);
        }
        // Also check personal user wake word
        if (!customWakeWordTriggered) {
            customWakeWordTriggered = await userFeatures.matchesWakeWord(userId, normalizedContent);
        }
        if (customWakeWordTriggered) {
            containsWakeWord = true;
        }
    } catch (e) {
        // User features not available
    }
}

// Only fall back to default wake words if the guild has NO custom wake word
if (!containsWakeWord && !guildHasCustomWakeWord && !guildWakeWordsDisabled && allowWakeWords && normalizedContent) {
    containsWakeWord = config.wakeWords.some((trigger) => normalizedContent.includes(trigger));
}

if (message.mentions.everyone) {
    return;
}

const isMentioned = message.mentions.has(client.user);
let isRoleMentioned = false;

// Check for role mentions
if (message.guild && message.mentions.roles.size > 0) {
    try {
        // Use cached member if available, otherwise fetch
        const botMember = message.guild.members.me || await message.guild.members.fetchMe().catch(() => null);
        if (botMember) {
            isRoleMentioned = message.mentions.roles.some(role => botMember.roles.cache.has(role.id));
        }
    } catch (err) {
        // Ignore role check errors
    }
}

let isReplyToJarvis = false;

if (!isMentioned && message.reference?.messageId) {
    try {
        const replied = await message.channel.messages.fetch(message.reference.messageId);
        if (replied?.author?.id === client.user.id) {
            isReplyToJarvis = true;
        }
    } catch (error) {
        // Ignore 10008 (Unknown Message) - message was deleted
        if (error.code !== 10008) {
            console.error('Failed to inspect replied message for Jarvis mention:', error.message);
        }
    }
}

// ============ CLANKER DETECTION (Top Priority) ============
// Check if user said "clanker" in any variation (case-insensitive)
// Strip Discord formatting to catch attempts to hide it in codeblocks, bold, etc.
const botMentionRegex = new RegExp(`<@!?${client.user.id}>`, 'g');
const cleanForClanker = rawContent.replace(botMentionRegex, '').trim().toLowerCase();
const strippedClanker = stripDiscordFormatting(cleanForClanker);

if (strippedClanker === 'clanker' && (isMentioned || isReplyToJarvis)) {
    const { limited } = handler.hitCooldown(userId, messageScope);
    if (limited) {return;}

    try {
        if (typeof handler.sendTypingSafe === 'function') {
            await handler.sendTypingSafe(message.channel);
        } else {
            await message.channel.sendTyping();
        }
        
        // Response variations - weighted probability: 99% text, 1% GIF
        const chance = Math.random();
        let selectedResponse;
        
        if (chance < 0.01) {
            selectedResponse = { type: 'gif' };
        } else {
            const { clankerResponses } = require('./templates');
            const randomIndex = Math.floor(Math.random() * clankerResponses.length);
            selectedResponse = { type: 'text', content: clankerResponses[randomIndex] };
        }
        
        if (selectedResponse.type === 'text') {
            await message.reply({ 
                content: selectedResponse.content,
                allowedMentions: { parse: [] }
            });
        } else {
            // Get user's avatar URL (high quality)
            const avatarUrl = message.author.displayAvatarURL({ 
                format: 'png', 
                size: 128,
                dynamic: false 
            });
            
            // Process the clanker.gif with user's avatar overlay
            const processedGif = await clankerGif.processClankerGifFast(avatarUrl);
            
            // Send the processed GIF
            const attachment = new AttachmentBuilder(processedGif, { name: 'clanker.gif' });
            await message.reply({ 
                files: [attachment],
                allowedMentions: { parse: [] }
            });
        }
        
        return; // Exit early, no AI response
    } catch (clankerError) {
        console.error('[Clanker] Failed to process clanker response:', clankerError);
        // Reply with error so user knows we tried
        await message.reply('**[System Error]** Clanker protocol malfunctioned. Check logs for details.');
        return; // Stop execution, do not fall through to AI
    }
}

// ============ FUH NAW SIR DETECTION ============
// Detect "is this tuff?" variations
if (strippedContent && /\bis\s+this\s+tuff\b/i.test(strippedContent)) {
    const { limited } = handler.hitCooldown(userId, messageScope);
    if (limited) {return;}

    try {
        // Use specific bot emoji
        const emojiString = '<:wilted_rose:1462415423327703260>';

        await message.reply({ 
            content: `Fuh naw, sir 💔 ${emojiString}`, 
            allowedMentions: { parse: [] } 
        });
        return; // Exit early
    } catch (error) {
        console.error('[FuhNaw] Failed to send response:', error);
    }
}

// ============ IS THIS PEAK DETECTION ============
if (strippedContent && /\bis\s+this\s+peak\b/i.test(strippedContent)) {
    const { limited } = handler.hitCooldown(userId, messageScope);
    if (limited) {return;}

    try {
        await message.reply({ 
            content: 'Indubitably peak, sir. 🏔️🔥', 
            allowedMentions: { parse: [] } 
        });
        return; // Exit early
    } catch (error) {
        console.error('[IsPeak] Failed to send response:', error);
    }
}

// ============ DO WE DESERVE DESTRUCTION DETECTION ============
if (strippedContent && /do\s+we\s+deserve\s+destruction\?/i.test(strippedContent)) {
    const { limited } = handler.hitCooldown(userId, messageScope);
    if (limited) {return;}

    try {
        const gifPath = path.join(process.cwd(), 'destruction.gif');
        const attachment = new AttachmentBuilder(gifPath, { name: 'destruction.gif' });
        await message.reply({ files: [attachment], allowedMentions: { parse: [] } });
        
        // React in order: ✅, 🔥, bot emoji
        await message.react('✅').catch(() => {});
        await message.react('🔥').catch(() => {});
        await message.react('1472278085373137048').catch(() => {});
        
        return; // Exit early
    } catch (error) {
        console.error('[Destruction] Failed to send response:', error);
    }
}

if (!isMentioned && !isRoleMentioned && !isReplyToJarvis && !containsWakeWord) {
    return;
}

const { limited } = handler.hitCooldown(userId, messageScope);
if (limited) {
    return;
}

await handler.handleJarvisInteraction(message, client);
}

module.exports = {
    handleMessage
};

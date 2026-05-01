/**
 * Discord event handlers and command processing
 */
const {
    AttachmentBuilder,
    PermissionsBitField,
} = require('discord.js');
const JarvisAI = require('./jarvis-core');
const config = require('../../config');
const { LRUCache } = require('lru-cache');
const database = require('./database');
const CooldownManager = require('../core/cooldown-manager');
const { commandFeatureMap } = require('../core/command-registry');
const { isFeatureGloballyEnabled, isFeatureEnabledForGuild } = require('../core/feature-flags');
const tempFiles = require('../utils/temp-files');
const { sanitizePings: sanitizePingsUtil } = require('../utils/sanitize');
const { splitMessage } = require('../utils/discord-safe-send');
const { isOwner: isOwnerCheck } = require('../utils/owner-check');
const serverStats = require('./handlers/server-stats');
const mediaRendering = require('./handlers/media-rendering');
const templates = require('./handlers/templates');
const newsHandler = require('./handlers/news-handler');
const userFeatureCommands = require('./handlers/user-feature-commands');
const clipRendering = require('./handlers/clip-rendering');
function envInt(name, fallback, min) { return Math.max(min, Number(process.env[name] || '') || fallback); }
const DISCORD_EMOJI_ASSET_CACHE_MAX = envInt('DISCORD_EMOJI_ASSET_CACHE_MAX', 500, 200);
const DISCORD_EMOJI_ASSET_CACHE_TTL_MS = envInt('DISCORD_EMOJI_ASSET_CACHE_TTL_MS', 24 * 60 * 60 * 1000, 60 * 1000);
const DISCORD_MEMBER_LOG_CACHE_MAX = envInt('DISCORD_MEMBER_LOG_CACHE_MAX', 5000, 200);
const DISCORD_MEMBER_LOG_CACHE_TTL_MS = envInt('DISCORD_MEMBER_LOG_CACHE_TTL_MS', 30 * 60 * 1000, 60 * 1000);
const DISCORD_AFK_USERS_MAX = envInt('DISCORD_AFK_USERS_MAX', 5000, 500);
const DISCORD_AFK_USERS_TTL_MS = envInt('DISCORD_AFK_USERS_TTL_MS', 24 * 60 * 60 * 1000, 10 * 60 * 1000);
const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'gif'];
function isImageAttachment(att) {
    const contentType = att.contentType || '';
    const ext = (att.name || '').split('.').pop()?.toLowerCase();
    return contentType.startsWith('image/') || IMAGE_EXTS.includes(ext);
}
function extractImagesFromMessage(msg, tag) {
    const images = [];
    if (msg?.attachments?.size > 0) {
        for (const att of msg.attachments.values()) {
            if (isImageAttachment(att)) { images.push({ url: att.url, contentType: att.contentType, [tag]: true }); }
        }
    }
    if (msg?.embeds?.length > 0) {
        for (const embed of msg.embeds) {
            if (embed.image?.url) { images.push({ url: embed.image.url, contentType: 'image/unknown', [tag]: true }); }
            if (embed.thumbnail?.url && !images.some(a => a.url === embed.thumbnail.url)) {
                images.push({ url: embed.thumbnail.url, contentType: 'image/unknown', [tag]: true });
            }
        }
    }
    return images;
}
class DiscordHandlers {
    constructor() {
        this.jarvis = new JarvisAI();
        this.cooldowns = new CooldownManager({ defaultCooldownMs: config.ai.cooldownMs });
        this.autoModRuleName = 'Jarvis Blacklist Filter';
        this.maxAutoModKeywordsPerRule = 1000;
        this.defaultAutoModMessage = 'Jarvis blocked this message for containing prohibited language.';
        this.missionCooldownMs = 12 * 60 * 60 * 1000;
        this.serverStatsCategoryName = '────────│ Server Stats │────────';
        this.serverStatsChannelLabels = {
            total: 'Member Count',
            users: 'User Count',
            bots: 'Bot Count',
            channels: 'Channel Count',
            roles: 'Role Count'
        };
        this.memberLogCache = new LRUCache({ max: DISCORD_MEMBER_LOG_CACHE_MAX, ttl: DISCORD_MEMBER_LOG_CACHE_TTL_MS });
        this.maxMemberLogVariations = 20;
        this.maxMemberLogMessageLength = 400;
        this.defaultJoinMessages = [
            '🛰️ {mention} has entered {server}.',
            '🎉 A new arrival! Welcome {mention} - population now {membercount}.',
            '🔔 {mention} just docked with {server}. Make them feel at home.',
            '✨ {mention} joined us. Jarvis registering their credentials now.'
        ];
        this.defaultLeaveMessages = [
            '📉 {mention} has departed {server}. We are now {membercount} strong.',
            '🛰️ {mention} slipped out of the hangar. Farewell until next time.',
            '⚠️ {mention} has left the server. Recalibrating member count to {membercount}.',
            '😔 {mention} disconnected from {server}. Until we meet again.'
        ];
        this.emojiAssetCache = new LRUCache({ max: DISCORD_EMOJI_ASSET_CACHE_MAX, ttl: DISCORD_EMOJI_ASSET_CACHE_TTL_MS });
        this.clipEmojiRenderSize = 22;
        this.clipEmojiSpacing = 4;
        this.clipLineHeight = 24;
        this.roastTemplates = templates.roastTemplates;
        this.flatterTemplates = templates.flatterTemplates;
        this.toastTemplates = templates.toastTemplates;
        this.triviaQuestions = templates.triviaQuestions;
        this.missions = templates.missions;
        this.afkUsers = new LRUCache({ max: DISCORD_AFK_USERS_MAX, ttl: DISCORD_AFK_USERS_TTL_MS });
        this.maxInputBytes = 3 * 1024 * 1024; // 3MB cap for heavy media processing
    }
    sanitizePings(text) { return sanitizePingsUtil(text); }
    canIgnoreChannelPermissionError(error) {
        return error?.code === 50001 || error?.code === 50013;
    }
    shouldFallbackMessageReply(error) {
        if (!error) {return false;}
        if (error.code === 10008) {return true;}
        return error.code === 50035 && Boolean(error?.rawError?.errors?.message_reference);
    }
    async sendTypingSafe(channel) {
        if (!channel?.sendTyping) {return false;}
        try {
            await channel.sendTyping();
            return true;
        } catch (error) {
            if (!this.canIgnoreChannelPermissionError(error)) {
                console.warn('Failed to send typing:', error);
            }
            return false;
        }
    }
    async replyToMessage(message, payload) {
        if (!message?.reply) {
            throw new Error('Message reply is unavailable');
        }
        const normalizedPayload =
            typeof payload === 'string' ? { content: payload } : { ...(payload || {}) };
        if (!normalizedPayload.allowedMentions) {
            normalizedPayload.allowedMentions = { parse: [] };
        }
        try {
            return await message.reply({
                failIfNotExists: false,
                ...normalizedPayload
            });
        } catch (error) {
            if (!this.shouldFallbackMessageReply(error) || !message.channel?.send) {
                throw error;
            }
            const { failIfNotExists, ...fallbackPayload } = normalizedPayload;
            return await message.channel.send(fallbackPayload);
        }
    }
    async sendBufferOrLink(interaction, buffer, preferredName, options = {}) {
        const {
            maxUploadBytes = 8 * 1024 * 1024,
            allowTempLink = true,
            tooLargeMessage = null
        } = options || {};
        const ext = (preferredName.split('.').pop() || '').toLowerCase();
        const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext);
        if (buffer.length <= maxUploadBytes) {
            const file = new AttachmentBuilder(buffer, { name: preferredName });
            const payload = { files: [file] };
            if (!interaction.deferred && !interaction.replied) {await interaction.reply(payload);}
            else {await interaction.editReply(payload);}
            return { uploaded: true };
        }
        if (!allowTempLink) {
            const content = tooLargeMessage || 'Generated output is too large to upload, sir.';
            if (!interaction.deferred && !interaction.replied) {
                await interaction.reply({ content });
            } else {
                await interaction.editReply({ content });
            }
            return { uploaded: false, tooLarge: true };
        }
        try {
            const saved = tempFiles.saveTempFile(buffer, ext || 'bin');
            const { url } = saved;
            const payload = isImage
                ? { embeds: [{ color: 0x1f8b4c, image: { url }, footer: { text: 'Temporary image • expires in ~4 hours' } }] }
                : { content: url };
            if (!interaction.deferred && !interaction.replied) {await interaction.reply(payload);}
            else {await interaction.editReply(payload);}
            return { uploaded: false, url };
        } catch (err) {
            const kb = Math.round(buffer.length / 1024);
            const content = tooLargeMessage || `Generated file (${kb} KB) is too large to upload and saving failed.`;
            if (!interaction.deferred && !interaction.replied) {await interaction.reply({ content });}
            else {await interaction.editReply({ content });}
            return { uploaded: false, error: err };
        }
    }
    async isCommandFeatureEnabled(commandName, guild = null) {
        const featureKey = commandFeatureMap.get(commandName);
        if (!featureKey) { return true; }
        return this.isFeatureActive(featureKey, guild);
    }
    async isFeatureActive(featureKey, guild = null) {
        if (!isFeatureGloballyEnabled(featureKey)) { return false; }
        if (!guild) { return true; }
        const guildConfig = await this.getGuildConfig(guild);
        return isFeatureEnabledForGuild(featureKey, guildConfig, true);
    }
    extractInteractionRoute(interaction) {
        if (!interaction?.options) {return null;}
        const group = (() => { try { return interaction.options.getSubcommandGroup(false); } catch { return null; } })();
        const sub = (() => { try { return interaction.options.getSubcommand(false); } catch { return null; } })();
        return group && sub ? `${group}.${sub}` : sub || group || null;
    }
    pickRandom(items) {
        if (!Array.isArray(items) || !items.length) {
            return null;
        }
        const index = Math.floor(Math.random() * items.length);
        return items[index];
    }
    getTicketStaffRoleIds(guild) {
        if (!guild?.roles?.cache) {
            return [];
        }
        return guild.roles.cache
            .filter((role) => !role.managed && role.editable && (
                role.permissions.has(PermissionsBitField.Flags.ManageGuild) ||
                role.permissions.has(PermissionsBitField.Flags.ManageChannels) ||
                role.permissions.has(PermissionsBitField.Flags.ManageMessages) ||
                role.permissions.has(PermissionsBitField.Flags.Administrator)
            ))
            .map((role) => role.id);
    }
    cleanupCooldowns() {
        if (this.cooldowns) { this.cooldowns.prune(); }
        for (const cache of [this.emojiAssetCache, this.memberLogCache, this.afkUsers]) {
            if (cache && typeof cache.purgeStale === 'function') { cache.purgeStale(); }
        }
    }
    isOnCooldown(userId, scope = 'global', cooldownMs = null) {
        if (isOwnerCheck(userId)) {
            return false;
        }
        if (!this.cooldowns) {
            return false;
        }
        return this.cooldowns.isLimited(scope, userId, cooldownMs).limited;
    }
    hitCooldown(userId, scope = 'global', cooldownMs = null) {
        if (!this.cooldowns) {
            return { limited: false, remainingMs: 0 };
        }
        return this.cooldowns.hit(scope, userId, cooldownMs);
    }
    setCooldown(userId, scope = 'global') {
        if (!this.cooldowns) {
            return;
        }
        const aiManager = require('./ai-providers');
        const loadFactor = typeof aiManager.getLoadFactor === 'function' ? aiManager.getLoadFactor() : 0;
        if (loadFactor > 1.0) {
            const extraMs = Math.floor((loadFactor - 1.0) * 3000); // Up to +3s per 1.0 load factor above soft cap
            const adjustedMs = (config.ai?.cooldownMs || 3000) + extraMs;
            this.cooldowns.set(scope, userId, adjustedMs);
            return;
        }
        this.cooldowns.set(scope, userId);
    }
    createFriendlyError(message) {
        const error = new Error(message);
        error.isFriendly = true;
        return error;
    }
    /**
     * Check if the bot has permission to send messages in a channel.
     * Returns true for DMs (always allowed) and guild channels where the bot has SendMessages.
     */
    canSendInChannel(channel) {
        if (!channel?.guild) {return true;} // DMs are always fine
        const me = channel.guild.members.me;
        if (!me || !channel.permissionsFor) {return true;} // Can't check, optimistically allow
        const perms = channel.permissionsFor(me);
        return perms.has(PermissionsBitField.Flags.SendMessages) &&
               perms.has(PermissionsBitField.Flags.ViewChannel);
    }
    async getGuildConfig(guild) {
        if (!guild) {
            return null;
        }
        if (!database.isConnected) {
            return null;
        }
        try {
            return await database.getGuildConfig(guild.id, guild.ownerId);
        } catch (error) {
            console.error('Failed to fetch guild configuration:', error);
            return null;
        }
    }
    async isGuildModerator(member, guildConfig = null) {
        if (!member || !member.guild) {
            return false;
        }
        if (isOwnerCheck(member.id)) {
            return true;
        }
        const { guild } = member;
        const { ownerId } = guild;
        if (member.id === ownerId) {
            return true;
        }
        if (member.permissions?.has(PermissionsBitField.Flags.Administrator)) {
            return true;
        }
        if (member.permissions?.has(PermissionsBitField.Flags.ManageGuild) || member.permissions?.has(PermissionsBitField.Flags.ManageRoles)) {
            return true;
        }
        if (!database.isConnected) {
            return false;
        }
        try {
            const config = guildConfig || await this.getGuildConfig(guild);
            if (!config) {
                return false;
            }
            if (Array.isArray(config.moderatorUserIds) && config.moderatorUserIds.includes(member.id)) {
                return true;
            }
            if (Array.isArray(config.moderatorRoleIds) && config.moderatorRoleIds.length > 0) {
                const hasRole = member.roles?.cache?.some(role => config.moderatorRoleIds.includes(role.id));
                if (hasRole) {
                    return true;
                }
            }
        } catch (error) {
            console.error('Failed to evaluate moderator permissions:', error);
        }
        return false;
    }
    async resolveGuildChannel(guild, channelId) {
        if (!guild || !channelId) {
            return null;
        }
        let channel = guild.channels.cache.get(channelId) || null;
        if (!channel) {
            try {
                channel = await guild.channels.fetch(channelId);
            } catch (error) {
                if (error.code !== 10003 && error.code !== 50001) {
                    console.warn(`Failed to fetch channel ${channelId} in guild ${guild.id}:`, error);
                }
                return null;
            }
        }
        return channel;
    }
    async fetchNewsFromTheNewsApi(topic, limit) { return newsHandler.fetchNewsFromTheNewsApi(topic, limit); }
    async handleNewsCommand(interaction) { return newsHandler.handleNewsCommand(interaction); }
    async refreshAllServerStats(client) {
        if (!client || !database.isConnected) {
            return;
        }
        let configs = [];
        try {
            configs = await database.getAllServerStatsConfigs();
        } catch (error) {
            console.error('Failed to load server stats configurations:', error);
            return;
        }
        for (const config of configs) {
            if (!config?.guildId) {
                continue;
            }
            let guild = client.guilds.cache.get(config.guildId) || null;
            if (!guild) {
                try {
                    guild = await client.guilds.fetch(config.guildId);
                } catch (error) {
                    if (error.code !== 50001 && error.code !== 10004) {
                        console.warn(`Failed to fetch guild ${config.guildId} for server stats update:`, error);
                    }
                    continue;
                }
            }
            try {
                await serverStats.updateServerStats(this, guild, config);
            } catch (error) {
                if (error.isFriendly || error.code === 50013) {
                    console.warn(`Skipping server stats update for guild ${config.guildId}: ${error.message || 'missing permissions'}`);
                } else if (error.code === 50001) {
                    console.warn(`Missing access to update server stats for guild ${config.guildId}.`);
                } else {
                    console.error(`Failed to update server stats for guild ${config.guildId}:`, error);
                }
            }
        }
    }
    getUserRoleColor(member) { return clipRendering.getUserRoleColor(member); }
    getSafeDisplayName(member, author) { return clipRendering.getSafeDisplayName(member, author); }
    async loadImageSafe(url) {
        return clipRendering.loadImageSafe(url);
    }
    parseCustomEmojis(text, guild) { return clipRendering.parseCustomEmojis(text, guild); }
    parseUnicodeEmojis(text) { return clipRendering.parseUnicodeEmojis(text); }
    async parseMentions(text, guild, client) { return clipRendering.parseMentions(this, text, guild, client); }
    truncateText(text, maxLength) { return clipRendering.truncateText(text, maxLength); }
    isBotVerified(user) { return clipRendering.isBotVerified(user); }
    extractImageUrls(text) { return clipRendering.extractImageUrls(text); }
    calculateTextHeight(text, maxWidth, customEmojis, mentions) { return clipRendering.calculateTextHeight(this, text, maxWidth, customEmojis, mentions); }
    async handleClipCommand(message, client) {
        return await mediaRendering.handleClipCommand(this, message, client);
    }
    async findMessageAcrossChannels(interaction, messageId) {
        return clipRendering.findMessageAcrossChannels(interaction, messageId);
    }
    async loadStaticImage(url) { return clipRendering.loadStaticImage(url); }
    async resolveTenorStatic(url) { return clipRendering.resolveTenorStatic(url); }
    sanitizeMessageText(text) { return clipRendering.sanitizeMessageText(text); }
    async createClipImage(text, username, avatarUrl, isBot = false, roleColor = '#ff6b6b', guild = null, client = null, message = null, user = null, attachments = null, embeds = null) {
        return clipRendering.createClipImage(this, text, username, avatarUrl, isBot, roleColor, guild, client, message, user, attachments, embeds);
    }
    async handleJarvisInteraction(message, client) {
        if (!this.canSendInChannel(message.channel)) {return;}
        // Trigger validation (mentions, wake words, reply-to-jarvis) already done
        // by message-processing.js handleMessage() - the only caller.
        if (message.author.bot) {
            console.log(`Bot interaction detected from ${message.author.username} (${message.author.id}): ${message.content.substring(0, 50)}...`);
        }
        const messageScope = 'message:jarvis';
        let cleanContent = typeof message.content === 'string' ? message.content : '';
        try {
            if (message.mentions?.members && message.mentions.members.size > 0) {
                for (const [userId, member] of message.mentions.members) {
                    const displayName = member?.displayName || member?.user?.globalName || member?.user?.username || 'user';
                    cleanContent = cleanContent.replace(new RegExp(`<@!?${userId}>`, 'g'), `${displayName}`);
                }
            } else if (message.mentions?.users && message.mentions.users.size > 0) {
                for (const [userId, user] of message.mentions.users) {
                    const displayName = user?.globalName || user?.username || 'user';
                    cleanContent = cleanContent.replace(new RegExp(`<@!?${userId}>`, 'g'), `${displayName}`);
                }
            }
            if (message.mentions?.roles && message.mentions.roles.size > 0) {
                for (const [roleId, role] of message.mentions.roles) {
                    cleanContent = cleanContent.replace(new RegExp(`<@&${roleId}>`, 'g'), `@${role.name}`);
                }
            }
            if (message.mentions?.channels && message.mentions.channels.size > 0) {
                for (const [channelId, channel] of message.mentions.channels) {
                    cleanContent = cleanContent.replace(new RegExp(`<#${channelId}>`, 'g'), `#${channel.name}`);
                }
            }
        } catch (e) {
            console.warn('[Jarvis] Mention parsing failed:', e.message);
        }
        try {
            if (client?.user?.id) {
                cleanContent = cleanContent.replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '').trim();
            }
        } catch (_) {}
        cleanContent = cleanContent
            .replace(/@everyone/g, '')
            .replace(/@here/g, '')
            .trim();
        if (await this.handleClipCommand(message, client)) {
            this.setCooldown(message.author.id, messageScope);
            return; // Exit early, no AI response
        }
        const ytCommandPattern = /^jarvis\s+yt\s+(.+)$/i;
        const ytMatch = cleanContent.match(ytCommandPattern);
        if (ytMatch) {
            await this.replyToMessage(message, 'For video reconnaissance, deploy `/yt` instead, sir.');
            this.setCooldown(message.author.id, messageScope);
            return;
        }
        if (!cleanContent) {
            cleanContent = 'jarvis';
        } else {
            const wakeWordPattern = new RegExp(`^(${config.wakeWords.join('|')})[,.!?]*$`, 'i');
            if (wakeWordPattern.test(cleanContent)) {
                cleanContent = 'jarvis';
            }
        }
        try {
            await this.sendTypingSafe(message.channel);
        } catch (_) {}
        if (cleanContent.length > config.ai.maxInputLength) {
            const responses = [
                'Rather verbose, sir. A concise version, perhaps?',
                'Too many words, sir. Brevity, please.',
                'TL;DR, sir.',
                'Really, sir?',
                'Saving your creativity for later, sir.',
                `${config.ai.maxInputLength} characters is the limit, sir.`,
                'Stop yapping, sir.',
                'Quite the novella, sir. Abridged edition?',
                'Brevity is the soul of wit, sir.'
            ];
            try {
                await this.replyToMessage(message, responses[Math.floor(Math.random() * responses.length)]);
            } catch (err) {
                console.error('Failed to reply (permissions?):', err);
            }
            this.setCooldown(message.author.id, messageScope);
            return;
        }
        try {
            const callerDisplayName = message.member?.displayName || message.author.displayName || message.author.username;
            const utilityResponse = await this.jarvis.handleUtilityCommand(
                cleanContent,
                callerDisplayName,
                message.author.id,
                false,
                null,
                message.guild?.id || null
            );
            if (utilityResponse) {
                if (typeof utilityResponse === 'string' && utilityResponse.trim()) {
                    const safe = this.sanitizePings(utilityResponse);
                    await this.replyToMessage(message, { content: safe, allowedMentions: { parse: [] } });
                } else {
                    await this.replyToMessage(message, { content: 'Utility functions misbehaving, sir. Try another?', allowedMentions: { parse: [] } });
                }
                return;
            }
            let imageAttachments = message.attachments
                ? Array.from(message.attachments.values())
                    .filter(isImageAttachment)
                    .map(att => ({ url: att.url, contentType: att.contentType }))
                : [];
            let repliedContext = '';
            if (message.reference?.messageId) {
                try {
                    const repliedMessage = await message.channel.messages.fetch(message.reference.messageId);
                    const repliedAuthorId = repliedMessage.author?.id;
                    // Skip reply context if the replied-to user opted out (unless it's the bot or the caller themselves)
                    const isBotReply = repliedAuthorId === message.client?.user?.id;
                    const isSelfReply = repliedAuthorId === message.author?.id;
                    const repliedOptedOut = !isBotReply && !isSelfReply && repliedAuthorId
                        ? await database.isUserOptedOut(repliedAuthorId).catch(() => false)
                        : false;
                    if (!repliedOptedOut) {
                        let repliedDisplayName = repliedMessage.author?.username || 'user';
                        if (message.guild && repliedAuthorId) {
                            const repliedMember =
                                repliedMessage.member ||
                                (await message.guild.members.fetch(repliedAuthorId).catch(() => null));
                            repliedDisplayName =
                                repliedMember?.displayName ||
                                repliedMessage.author?.globalName ||
                                repliedMessage.author?.username ||
                                'user';
                        } else {
                            repliedDisplayName =
                                repliedMessage.author?.globalName || repliedMessage.author?.username || 'user';
                        }
                        const repliedText = (repliedMessage?.cleanContent || repliedMessage?.content || '').trim();
                        if (repliedText) {
                            const maxReplyContext = Math.min(300, Math.max(100, config.ai.maxInputLength - cleanContent.length - 50));
                            const trimmedReply = repliedText.substring(0, maxReplyContext);
                            repliedContext = `[Replied to ${repliedDisplayName}: "${trimmedReply}${repliedText.length > maxReplyContext ? '...' : ''}"]\n`;
                        }
                    }
                    if (imageAttachments.length === 0) {
                        imageAttachments = [...imageAttachments, ...extractImagesFromMessage(repliedMessage, 'fromReply')];
                    }
                } catch (err) {
                    console.warn('[Vision] Failed to fetch replied message:', err.message);
                }
            }
            if (imageAttachments.length === 0 && message.channel) {
                try {
                    const previousMessages = await message.channel.messages.fetch({ limit: 2, before: message.id });
                    const prevMsg = previousMessages.first();
                    if (prevMsg && prevMsg.author?.id === message.author?.id) {
                        const timeDiff = message.createdTimestamp - prevMsg.createdTimestamp;
                        if (timeDiff < 30000) { // Within 30 seconds
                            const prevImages = extractImagesFromMessage(prevMsg, 'fromPrevious');
                            imageAttachments = [...imageAttachments, ...prevImages];
                            if (prevImages.length > 0) {
                                console.log(`[Vision] Found ${prevImages.length} image(s) in previous message`);
                            }
                        }
                    }
                } catch (err) {
                    console.warn('[Vision] Failed to fetch previous message:', err.message);
                }
            }
            let fullContent = repliedContext ? repliedContext + cleanContent : cleanContent;
            if (fullContent.length > config.ai.maxInputLength) {
                const availableForReply = config.ai.maxInputLength - cleanContent.length - 20;
                if (availableForReply > 50 && repliedContext) {
                    repliedContext = `${repliedContext.substring(0, availableForReply)  }..."]\n`;
                    fullContent = repliedContext + cleanContent;
                } else {
                    fullContent = cleanContent.substring(0, config.ai.maxInputLength);
                }
            }
            if (process.env.JARVIS_DEBUG_AI_INPUT === '1') {
                console.log('[Jarvis AI Input]', {
                    userId: message.author?.id,
                    hasReply: Boolean(message.reference?.messageId),
                    replyContextChars: repliedContext ? repliedContext.length : 0,
                    userPromptChars: typeof cleanContent === 'string' ? cleanContent.length : 0,
                    fullPromptChars: typeof fullContent === 'string' ? fullContent.length : 0,
                    images: Array.isArray(imageAttachments) ? imageAttachments.length : 0,
                    fromReplyImages: Array.isArray(imageAttachments)
                        ? imageAttachments.filter(i => i && i.fromReply).length
                        : 0
                });
            }
            const response = await this.jarvis.generateResponse(message, fullContent, false, imageAttachments);
            const cleanResponse = response;
            if (typeof cleanResponse === 'string' && cleanResponse.trim()) {
                const safe = this.sanitizePings(cleanResponse);
                const chunks = splitMessage(safe);
                for (let i = 0; i < chunks.length; i++) {
                    if (i === 0) {
                        await this.replyToMessage(message, { content: chunks[i], allowedMentions: { parse: [] } });
                    } else {
                        await message.channel.send({ content: chunks[i], allowedMentions: { parse: [] } });
                    }
                }
            } else {
                await this.replyToMessage(message, {
                    content: 'Temporary AI provider outage, sir. Please try again shortly.',
                    allowedMentions: { parse: [] }
                });
            }
        } catch (error) {
            const errorId = `J-${Date.now().toString(36).slice(-4).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
            console.error(`[${errorId}] Error processing message:`, error);
            if (this.canIgnoreChannelPermissionError(error)) {return;}
            try {
                await this.replyToMessage(message, { content: `Technical difficulties, sir. (${errorId}) Please try again shortly.`, allowedMentions: { parse: [] } });
            } catch (err) {
                if (!this.canIgnoreChannelPermissionError(err)) {
                    console.error(`[${errorId}] Failed to send error reply:`, err);
                }
            }
        }
    }
    async handleServerStatsCommand(interaction) {
        if (!interaction.guild) {
            await interaction.editReply('This command is only available within a server, sir.');
            return;
        }
        if (!database.isConnected) {
            await interaction.editReply('My database uplink is offline, sir. Server stats are unavailable at the moment.');
            return;
        }
        const { guild } = interaction;
        const { member } = interaction;
        const subcommand = interaction.options.getSubcommand();
        const guildConfig = await this.getGuildConfig(guild);
        const isModerator = await this.isGuildModerator(member, guildConfig);
        if (!isModerator) {
            await interaction.editReply('Only the server owner or configured moderators may do that, sir.');
            return;
        }
        try {
            if (subcommand === 'status') {
                const statsConfig = await database.getServerStatsConfig(guild.id);
                if (!statsConfig) {
                    await interaction.editReply('Server statistics channels are not configured, sir.');
                    return;
                }
                const stats = await serverStats.collectGuildMemberStats(guild);
                const channelDefs = [
                    ['Category', 'categoryId'], ['Member channel', 'totalChannelId'],
                    ['User channel', 'userChannelId'], ['Bot channel', 'botChannelId'],
                    ['Channel count channel', 'channelCountChannelId'], ['Role count channel', 'roleCountChannelId']
                ];
                const resolved = await Promise.all(channelDefs.map(([, key]) => this.resolveGuildChannel(guild, statsConfig[key])));
                const lines = channelDefs.map(([label], i) => `${label}: ${resolved[i] ? `<#${resolved[i].id}>` : 'Missing'}`);
                const fmt = serverStats.formatServerStatsValue;
                lines.push(`Current totals - Members: ${fmt(stats.total)}, Users: ${fmt(stats.userCount)}, Bots: ${fmt(stats.botCount)}, Channels: ${fmt(stats.channelCount)}, Roles: ${fmt(stats.roleCount)}`);
                await interaction.editReply(`Server statistics are active, sir.\n${lines.join('\n')}`);
                return;
            }
            if (subcommand === 'enable') {
                const existing = await database.getServerStatsConfig(guild.id);
                await serverStats.updateServerStats(this, guild, existing);
                await interaction.editReply('Server statistics channels are ready, sir. I will refresh them every 10 minutes.');
                return;
            }
            if (subcommand === 'refresh') {
                const existing = await database.getServerStatsConfig(guild.id);
                if (!existing) {
                    await interaction.editReply('Server statistics are not configured yet, sir.');
                    return;
                }
                await serverStats.updateServerStats(this, guild, existing);
                await interaction.editReply('Server statistics channels refreshed, sir.');
                return;
            }
            if (subcommand === 'report') {
                const publish = interaction.options.getBoolean('public') || false;
                const stats = await serverStats.collectGuildMemberStats(guild);
                const summaryLines = [
                    `**${guild.name || 'Server'} Snapshot**`,
                    `• Members: ${serverStats.formatServerStatsValue(stats.total)}`,
                    `• Humans: ${serverStats.formatServerStatsValue(stats.userCount)}`,
                    `• Bots: ${serverStats.formatServerStatsValue(stats.botCount)}`,
                    `• Channels: ${serverStats.formatServerStatsValue(stats.channelCount)}`,
                    `• Roles: ${serverStats.formatServerStatsValue(stats.roleCount)}`
                ];
                try {
                    const activityTracker = require('./GUILDS_FEATURES/activity-tracker');
                    const activity = activityTracker.getActivitySummary(guild.id);
                    if (activity && activity.totalMessages > 0) {
                        summaryLines.push('', '**Activity (since last restart)**');
                        summaryLines.push(`• Messages tracked: ${activity.totalMessages}`);
                        summaryLines.push(`• Active users: ${activity.uniqueUsers}`);
                        summaryLines.push(`• Msgs/min: ${activity.messagesPerMinute}`);
                        if (activity.peakHour !== undefined) {
                            summaryLines.push(`• Peak hour: ${activity.peakHour}:00`);
                        }
                        if (activity.topChannels.length > 0) {
                            const topChans = activity.topChannels.slice(0, 3).map(c => `<#${c.channelId}> (${c.count})`).join(', ');
                            summaryLines.push(`• Top channels: ${topChans}`);
                        }
                    }
                } catch (_e) { /* activity tracker not available */ }
                let chartBuffer = null;
                try {
                    chartBuffer = serverStats.renderServerStatsChart(stats, guild.name || 'Server Snapshot');
                } catch (error) {
                    console.warn('Failed to render server stats chart:', error);
                }
                if (publish) {
                    await interaction.editReply('Compiling your report, sir...');
                    if (chartBuffer) {
                        const attachment = new AttachmentBuilder(chartBuffer, { name: 'server-report.png' });
                        await interaction.channel.send({ content: summaryLines.join('\n'), files: [attachment] });
                    } else {
                        await interaction.channel.send(summaryLines.join('\n'));
                    }
                    await interaction.editReply('Report posted to the channel, sir.');
                } else {
                    if (chartBuffer) {
                        const attachment = new AttachmentBuilder(chartBuffer, { name: 'server-report.png' });
                        await interaction.editReply({ content: summaryLines.join('\n'), files: [attachment] });
                    } else {
                        await interaction.editReply(summaryLines.join('\n'));
                    }
                }
                return;
            }
            if (subcommand === 'disable') {
                const existing = await database.getServerStatsConfig(guild.id);
                if (!existing) {
                    await interaction.editReply('Server statistics channels were not configured, sir.');
                    return;
                }
                await serverStats.disableServerStats(this, guild, existing);
                await interaction.editReply('Server statistics channels have been removed, sir.');
                return;
            }
            await interaction.editReply('I am not certain how to handle that server stats request, sir.');
        } catch (error) {
            console.error('Failed to handle server stats command:', error);
            if (error.isFriendly || error.code === 50013) {
                await interaction.editReply(error.message || 'I could not adjust the server statistics, sir.');
            } else {
                await interaction.editReply('I could not adjust the server statistics, sir.');
            }
        }
    }
    async handleRemindCommand(interaction) { return userFeatureCommands.handleRemindCommand(interaction); }
    async handleTimezoneCommand(interaction) { return userFeatureCommands.handleTimezoneCommand(interaction); }
    async handleWakewordCommand(interaction) { return userFeatureCommands.handleWakewordCommand(this, interaction); }
}
module.exports = new DiscordHandlers();

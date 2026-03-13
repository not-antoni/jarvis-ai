/**
 * Discord event handlers and command processing
 */
const {
    ChannelType,
    AttachmentBuilder,
    UserFlags,
    PermissionsBitField,
    EmbedBuilder
} = require('discord.js');
const JarvisAI = require('./jarvis-core');
const config = require('../../config');
const { LRUCache } = require('lru-cache');
const { createCanvas, loadImage } = require('canvas');
const sharp = require('sharp');
const database = require('./database');
const fetch = require('node-fetch');
const CooldownManager = require('../core/cooldown-manager');
const socialCredit = require('./social-credit');
const { commandFeatureMap } = require('../core/command-registry');
const { isFeatureGloballyEnabled, isFeatureEnabledForGuild } = require('../core/feature-flags');
const NEWS_API_KEY = process.env.NEWS_API_KEY || null;
const tempFiles = require('../utils/temp-files');
const { extractReactionDirective } = require('../utils/react-tags');
const { sanitizePings: sanitizePingsUtil } = require('../utils/sanitize');
const { splitMessage } = require('../utils/discord-safe-send');
const serverStats = require('./handlers/server-stats');
const mediaRendering = require('./handlers/media-rendering');
const templates = require('./handlers/templates');
const DEFAULT_CUSTOM_EMOJI_SIZE = 128;
const TWEMOJI_SVG_BASE = 'https://cdn.jsdelivr.net/gh/twitter/twemoji@latest/assets/svg';
const TWEMOJI_PNG_BASE = 'https://cdn.jsdelivr.net/gh/twitter/twemoji@latest/assets/72x72';
const DISCORD_EMOJI_ASSET_CACHE_MAX = Math.max(
    200,
    Number(process.env.DISCORD_EMOJI_ASSET_CACHE_MAX || '') || 500
);
const DISCORD_EMOJI_ASSET_CACHE_TTL_MS = Math.max(
    60 * 1000,
    Number(process.env.DISCORD_EMOJI_ASSET_CACHE_TTL_MS || '') || 24 * 60 * 60 * 1000
);
const DISCORD_MEMBER_LOG_CACHE_MAX = Math.max(
    200,
    Number(process.env.DISCORD_MEMBER_LOG_CACHE_MAX || '') || 5000
);
const DISCORD_MEMBER_LOG_CACHE_TTL_MS = Math.max(
    60 * 1000,
    Number(process.env.DISCORD_MEMBER_LOG_CACHE_TTL_MS || '') || 30 * 60 * 1000
);
const DISCORD_AFK_USERS_MAX = Math.max(
    500,
    Number(process.env.DISCORD_AFK_USERS_MAX || '') || 5000
);
const DISCORD_AFK_USERS_TTL_MS = Math.max(
    10 * 60 * 1000,
    Number(process.env.DISCORD_AFK_USERS_TTL_MS || '') || 24 * 60 * 60 * 1000
);
const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'gif'];
function isImageAttachment(att) {
    const contentType = att.contentType || '';
    const ext = (att.name || '').split('.').pop()?.toLowerCase();
    return contentType.startsWith('image/') || IMAGE_EXTS.includes(ext);
}
function ensureDiscordEmojiSize(url, size = DEFAULT_CUSTOM_EMOJI_SIZE) {
    if (!url || typeof url !== 'string') {return url;}
    const base = url.split('?')[0];
    return `${base}?size=${size}&quality=lossless`;
}
function unicodeEmojiToCodePoints(emoji) {
    if (!emoji) {return null;}
    const codePoints = [];
    for (const symbol of Array.from(emoji)) {
        const codePoint = symbol.codePointAt(0);
        if (typeof codePoint === 'number') {
            const hex = codePoint.toString(16).toLowerCase();
            codePoints.push(hex.padStart(codePoint > 0xffff ? hex.length : 4, '0'));
        }
    }
    return codePoints.length ? codePoints.join('-') : null;
}
function buildUnicodeEmojiAsset(emoji) {
    const code = unicodeEmojiToCodePoints(emoji);
    if (!code) {return null;}
    return {
        svg: `${TWEMOJI_SVG_BASE}/${code}.svg`,
        png: `${TWEMOJI_PNG_BASE}/${code}.png`
    };
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
            '🎉 A new arrival! Welcome {mention} — population now {membercount}.',
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
    sanitizePings(text) {
        return sanitizePingsUtil(text);
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
        if (!featureKey) {
            return true;
        }
        if (!isFeatureGloballyEnabled(featureKey)) {
            return false;
        }
        if (!guild) {
            return true;
        }
        const guildConfig = await this.getGuildConfig(guild);
        return isFeatureEnabledForGuild(featureKey, guildConfig, true);
    }
    async isFeatureActive(featureKey, guild = null) {
        if (!isFeatureGloballyEnabled(featureKey)) {
            return false;
        }
        if (!guild) {
            return true;
        }
        const guildConfig = await this.getGuildConfig(guild);
        return isFeatureEnabledForGuild(featureKey, guildConfig, true);
    }
    extractInteractionRoute(interaction) {
        if (!interaction?.options) {
            return null;
        }
        let group = null;
        let sub = null;
        try {
            group = interaction.options.getSubcommandGroup(false);
        } catch (error) {
            group = null;
        }
        try {
            sub = interaction.options.getSubcommand(false);
        } catch (error) {
            sub = null;
        }
        if (group && sub) {
            return `${group}.${sub}`;
        }
        return sub || group || null;
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
        if (this.cooldowns) {
            this.cooldowns.prune();
        }
        if (this.emojiAssetCache && typeof this.emojiAssetCache.purgeStale === 'function') {
            this.emojiAssetCache.purgeStale();
        }
        if (this.memberLogCache && typeof this.memberLogCache.purgeStale === 'function') {
            this.memberLogCache.purgeStale();
        }
        if (this.afkUsers && typeof this.afkUsers.purgeStale === 'function') {
            this.afkUsers.purgeStale();
        }
    }
    isOnCooldown(userId, scope = 'global', cooldownMs = null) {
        const ownerId = process.env.BOT_OWNER_ID || '';
        if (ownerId && userId === ownerId) {
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
    async fetchNewsFromTheNewsApi(topic, limit = 5) {
        if (!NEWS_API_KEY) {return [];}
        const searchParam = encodeURIComponent(topic);
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        const publishedAfter = weekAgo.toISOString().split('T')[0]; // YYYY-MM-DD
        const url = `https://api.thenewsapi.com/v1/news/all?api_token=${NEWS_API_KEY}&language=en&limit=${limit}&search=${searchParam}&published_after=${publishedAfter}&sort=published_at`;
        const response = await fetch(url, {
            headers: { 'Accept': 'application/json' }
        });
        if (!response.ok) {
            throw new Error(`TheNewsAPI request failed: ${response.status}`);
        }
        const data = await response.json();
        const articles = Array.isArray(data?.data) ? data.data : [];
        const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
        return articles
            .filter(article => {
                if (!article.published_at) {return true;}
                return new Date(article.published_at).getTime() > thirtyDaysAgo;
            })
            .map((article) => ({
                title: article.title || 'Untitled story',
                description: article.description || '',
                url: article.url || null,
                source: article.source || article.source_url || 'TheNewsAPI',
                published: article.published_at ? new Date(article.published_at) : null,
                image: article.image_url || null
            }));
    }
    async handleNewsCommand(interaction) {
        const topic = interaction.options.getString('topic') || 'technology';
        const fresh = interaction.options.getBoolean('fresh') || false;
        const normalizedTopic = topic.toLowerCase();
        let articles = [];
        let fromCache = false;
        if (!fresh && database.isConnected) {
            try {
                const cached = await database.getNewsDigest(normalizedTopic);
                if (cached?.articles?.length) {
                    articles = cached.articles.map((article) => ({
                        ...article,
                        published: article.published ? new Date(article.published) : null
                    }));
                    fromCache = true;
                    if (cached.metadata?.cachedAt) {
                        const cachedDate = new Date(cached.metadata.cachedAt);
                        if (!Number.isNaN(cachedDate.getTime()) && Date.now() - cachedDate.getTime() > 90 * 60 * 1000) {
                            fromCache = false;
                        }
                    }
                }
            } catch (error) {
                console.warn('Failed to read cached news digest:', error);
            }
        }
        if (!articles.length) {
            try {
                if (NEWS_API_KEY) {
                    articles = await this.fetchNewsFromTheNewsApi(normalizedTopic, 5);
                }
                if (database.isConnected) {
                    const serialisable = articles.map((article) => ({
                        ...article,
                        published: article.published ? article.published.toISOString() : null
                    }));
                    await database.saveNewsDigest(normalizedTopic, serialisable, { cachedAt: new Date().toISOString() });
                }
            } catch (error) {
                console.error('News fetch failed:', error);
                await interaction.editReply('Unable to fetch headlines at the moment, sir.');
                return;
            }
        }
        if (!articles.length) {
            await interaction.editReply('No headlines available right now, sir.');
            return;
        }
        const embed = new EmbedBuilder()
            .setTitle(`Top headlines: ${topic}`)
            .setColor(0x00b5ad)
            .setTimestamp(new Date());
        const lines = articles.slice(0, 5).map((article, index) => {
            const title = article.title || 'Untitled story';
            const url = article.url || '';
            const source = article.source || 'Unknown source';
            const published = article.published ? Math.floor(new Date(article.published).getTime() / 1000) : null;
            const desc = article.description ? article.description.trim() : '';
            const headline = url ? `**${index + 1}. [${title}](${url})**` : `**${index + 1}. ${title}**`;
            const metaParts = [source];
            if (published) {
                metaParts.push(`<t:${published}:R>`);
            }
            const metaLine = metaParts.length ? `_${metaParts.join(' • ')}_` : '';
            const body = desc ? `${desc.slice(0, 180)}${desc.length > 180 ? '…' : ''}` : '';
            return [headline, body, metaLine].filter(Boolean).join('\n');
        });
        embed.setDescription(lines.join('\n\n'));
        const firstImage = articles.find((a) => a.image)?.image;
        if (firstImage) {
            embed.setImage(firstImage);
        }
        if (fromCache && database.isConnected) {
            embed.setFooter({ text: 'Cached digest • add fresh:true to refresh' });
        } else if (NEWS_API_KEY) {
            embed.setFooter({ text: 'Powered by TheNewsAPI.com' });
        }
        await interaction.editReply({ embeds: [embed] });
    }
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
    getUserRoleColor(member) {
        try {
            if (!member || !member.roles) {
                return '#ff6b6b'; // Default red
            }
            const coloredRoles = member.roles.cache
                .filter(role => role.color !== 0 && role.name !== '@everyone')
                .sort((a, b) => b.position - a.position);
            if (coloredRoles.size > 0) {
                const topRole = coloredRoles.first();
                return `#${topRole.color.toString(16).padStart(6, '0')}`;
            }
            return '#ff6b6b'; // Default red if no colored roles
        } catch (error) {
            console.warn('Failed to get role color:', error);
            return '#ff6b6b'; // Default red on error
        }
    }
    getSafeDisplayName(member, author) {
        try {
            const rawName = (member && member.displayName) ? member.displayName : (author && author.username ? author.username : 'User');
            let name = rawName.normalize('NFKC');
            name = name.replace(/[\p{C}\p{Cf}]/gu, '');
            name = name.replace(/[^\p{L}\p{N}\p{M} _\-'.]/gu, '');
            name = name.replace(/\s+/g, ' ').trim();
            if (!name) {name = (author && author.username) ? author.username : 'User';}
            return name;
        } catch (_) {
            return (author && author.username) ? author.username : 'User';
        }
    }
    async fetchEmojiImage(url) {
        if (!url || typeof url !== 'string') {return null;}
        const cached = this.emojiAssetCache.get(url);
        if (cached) {
            return cached;
        }
        const pending = loadImage(url)
            .then((image) => {
                this.emojiAssetCache.set(url, image);
                return image;
            })
            .catch((error) => {
                this.emojiAssetCache.delete(url);
                throw error;
            });
        this.emojiAssetCache.set(url, pending);
        return pending;
    }
    async parseCustomEmojis(text, guild = null) {
        const emojiRegex = /<a?:(\w+):(\d+)>/g;
        const emojis = [];
        let match;
        while ((match = emojiRegex.exec(text)) !== null) {
            const isAnimated = match[0].startsWith('<a:');
            const name = match[1];
            const id = match[2];
            let emojiUrl = `https://cdn.discordapp.com/emojis/${id}.${isAnimated ? 'gif' : 'png'}`;
            let emojiObject = null;
            if (guild) {
                try {
                    emojiObject = guild.emojis.cache.get(id);
                    if (emojiObject) {
                        emojiUrl = emojiObject.url || emojiUrl;
                    } else {
                        try {
                            const fetchedEmoji = await guild.emojis.fetch(id);
                            if (fetchedEmoji) {
                                emojiObject = fetchedEmoji;
                                emojiUrl = fetchedEmoji.url || emojiUrl;
                            }
                        } catch (fetchError) {
                            if (fetchError.code === 10014) {
                                console.warn(`Emoji ${id} not found in guild ${guild.id}`);
                            } else if (fetchError.code === 50013) {
                                console.warn(`Missing permissions to fetch emoji ${id} from guild ${guild.id}`);
                            } else {
                                console.warn('Failed to fetch emoji from Discord API:', fetchError);
                            }
                        }
                    }
                } catch (error) {
                    console.warn('Failed to fetch emoji from guild:', error);
                }
            }
            emojiUrl = ensureDiscordEmojiSize(emojiUrl, DEFAULT_CUSTOM_EMOJI_SIZE);
            emojis.push({
                full: match[0],
                name: name,
                id: id,
                url: emojiUrl,
                isAnimated: isAnimated,
                emojiObject: emojiObject,
                start: match.index,
                end: match.index + match[0].length
            });
        }
        return emojis;
    }
    parseUnicodeEmojis(text) {
        const unicodeEmojiRegex = /[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F000}-\u{1FFFF}]/gu;
        const emojis = [];
        let match;
        while ((match = unicodeEmojiRegex.exec(text)) !== null) {
            const asset = buildUnicodeEmojiAsset(match[0]);
            emojis.push({
                full: match[0],
                name: match[0],
                id: null,
                url: asset ? asset.svg : null,
                fallbackUrl: asset ? asset.png : null,
                isAnimated: false,
                emojiObject: null,
                start: match.index,
                end: match.index + match[0].length,
                isUnicode: true
            });
        }
        return emojis;
    }
    async parseMentions(text, guild = null, client = null) {
        const mentionRegex = /<@!?([0-9]{5,})>/g;
        const mentions = [];
        let match;
        while ((match = mentionRegex.exec(text)) !== null) {
            const userId = match[1];
            let display = '@unknown';
            try {
                let user = null;
                let member = null;
                if (guild) {
                    member = guild.members.cache.get(userId) || null;
                    if (!member) {
                        try { member = await guild.members.fetch(userId); } catch (_) {}
                    }
                    user = member ? member.user : null;
                }
                if (!user && client) {
                    user = client.users.cache.get(userId) || null;
                    if (!user) {
                        try { user = await client.users.fetch(userId); } catch (_) {}
                    }
                }
                display = `@${this.getSafeDisplayName(member, user || { username: userId })}`;
            } catch (_) {}
            mentions.push({
                full: match[0],
                userId: userId,
                display: display,
                start: match.index,
                end: match.index + match[0].length
            });
        }
        return mentions;
    }
    drawVerifiedBadge(ctx, x, y, size = 16) {
        try {
            ctx.save();
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.moveTo(x + size * 0.3, y + size * 0.5);
            ctx.lineTo(x + size * 0.45, y + size * 0.65);
            ctx.lineTo(x + size * 0.7, y + size * 0.35);
            ctx.lineWidth = 2;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.strokeStyle = '#ffffff';
            ctx.stroke();
            ctx.restore();
        } catch (error) {
            console.warn('Failed to draw verified badge:', error);
        }
    }
    parseDiscordTimestamp(message) {
        try {
            const date = message.createdAt;
            const options = {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true
            };
            return date.toLocaleTimeString('en-US', options);
        } catch (error) {
            console.warn('Failed to parse Discord timestamp:', error);
            return '6:39 PM'; // Fallback
        }
    }
    truncateText(text, maxLength) {
        if (text.length <= maxLength) {return text;}
        return `${text.substring(0, maxLength - 3)  }...`;
    }
    isBotVerified(user) {
        try {
            return user.publicFlags && user.publicFlags.has(UserFlags.VerifiedBot);
        } catch (error) {
            console.warn('Failed to check bot verification status:', error);
            return false;
        }
    }
    extractImageUrls(text) {
        const imageUrlRegex = /(https?:\/\/[^\s]+\.(?:jpg|jpeg|png|gif|webp|bmp|svg)(?:\?[^\s]*)?)/gi;
        const imageMatches = text.match(imageUrlRegex) || [];
        const tenorRegex = /(https?:\/\/tenor\.com\/[^\s]+)/gi;
        const tenorMatches = text.match(tenorRegex) || [];
        const tenorGifUrls = tenorMatches.map(tenorUrl => {
            try {
                let gifId = null;
                const viewMatch = tenorUrl.match(/\/view\/[^-]+-(\d+)/);
                if (viewMatch) {
                    gifId = viewMatch[1];
                }
                if (!gifId) {
                    const directMatch = tenorUrl.match(/\/view\/(\d+)/);
                    if (directMatch) {
                        gifId = directMatch[1];
                    }
                }
                if (!gifId) {
                    const complexMatch = tenorUrl.match(/-(\d+)(?:-|$)/);
                    if (complexMatch) {
                        gifId = complexMatch[1];
                    }
                }
                if (gifId) {
                    return `https://media.tenor.com/${gifId}.gif`;
                }
                console.warn('Could not extract GIF ID from Tenor URL:', tenorUrl);
                return tenorUrl; // Fallback to original URL
            } catch (error) {
                console.warn('Failed to convert Tenor URL:', error);
                return tenorUrl;
            }
        });
        return [...imageMatches, ...tenorGifUrls];
    }
    calculateTextHeight(text, maxWidth, customEmojis = [], mentions = []) {
        const tempCanvas = createCanvas(1, 1);
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.font = '15px Arial';
        const segments = this.splitTextWithEmojisAndMentions(text, customEmojis, mentions);
        const lineHeight = 22;
        const emojiSize = 18;
        const emojiSpacing = typeof this.clipEmojiSpacing === 'number' ? this.clipEmojiSpacing : 3;
        const emojiAdvance = emojiSize + emojiSpacing;
        let lineCount = 1;
        let currentLineWidth = 0;
        const advanceLine = () => {
            lineCount++;
            currentLineWidth = 0;
        };
        const handleWhitespaceToken = token => {
            if (!token) {return;}
            const { width } = tempCtx.measureText(token);
            if (currentLineWidth + width > maxWidth && currentLineWidth > 0) {
                advanceLine();
            }
            currentLineWidth += width;
        };
        const handleTextToken = token => {
            if (!token) {return;}
            const { width } = tempCtx.measureText(token);
            if (currentLineWidth + width > maxWidth && currentLineWidth > 0) {
                advanceLine();
            }
            currentLineWidth += width;
        };
        for (const segment of segments) {
            if (segment.type === 'emoji') {
                const hasImageAsset = Boolean(segment.url);
                if (hasImageAsset) {
                    if (currentLineWidth + emojiAdvance > maxWidth && currentLineWidth > 0) {
                        advanceLine();
                    }
                    currentLineWidth += emojiAdvance;
                } else if (segment.isUnicode) {
                    const emojiText = segment.name;
                    tempCtx.font = '18px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Android Emoji", "EmojiSymbols", "EmojiOne Mozilla", "Twemoji Mozilla", "Segoe UI Symbol", sans-serif';
                    const { width } = tempCtx.measureText(emojiText);
                    tempCtx.font = '15px Arial';
                    if (currentLineWidth + width > maxWidth && currentLineWidth > 0) {
                        advanceLine();
                    }
                    currentLineWidth += width;
                } else {
                    if (currentLineWidth + emojiAdvance > maxWidth && currentLineWidth > 0) {
                        advanceLine();
                    }
                    currentLineWidth += emojiAdvance;
                }
            } else if (segment.type === 'mention') {
                const mentionTokens = segment.text.split(/(\n|\s+)/);
                for (const token of mentionTokens) {
                    if (!token) {continue;}
                    if (token === '\n') {
                        advanceLine();
                        continue;
                    }
                    if (/^\s+$/.test(token)) {
                        handleWhitespaceToken(token);
                        continue;
                    }
                    handleTextToken(token);
                }
            } else {
                const textTokens = segment.text.split(/(\n|\s+)/);
                for (const token of textTokens) {
                    if (!token) {continue;}
                    if (token === '\n') {
                        advanceLine();
                        continue;
                    }
                    if (/^\s+$/.test(token)) {
                        handleWhitespaceToken(token);
                        continue;
                    }
                    handleTextToken(token);
                }
            }
        }
        const baseHeight = 44;
        return baseHeight + (lineCount * lineHeight);
    }
    async handleClipCommand(message, client) {
        return await mediaRendering.handleClipCommand(this, message, client);
    }
    async findMessageAcrossChannels(interaction, messageId) {
        try {
            if (interaction.channel && interaction.channel.messages) {
                const msg = await interaction.channel.messages.fetch(messageId);
                if (msg) {return msg;}
            }
        } catch (_) {}
        if (!interaction.guild) {return null;}
        const channels = interaction.guild.channels.cache;
        for (const [, channel] of channels) {
            try {
                if (!channel || typeof channel.isTextBased !== 'function' || !channel.isTextBased()) {continue;}
                const perms = channel.permissionsFor(interaction.client.user.id);
                if (!perms) {continue;}
                if (!perms.has(PermissionsBitField.Flags.ViewChannel)) {continue;}
                if (!perms.has(PermissionsBitField.Flags.ReadMessageHistory)) {continue;}
                const msg = await channel.messages.fetch(messageId);
                if (msg) {return msg;}
            } catch (err) {
                continue;
            }
        }
        return null;
    }
    async loadStaticImage(url) {
        try {
            const res = await fetch(url);
            if (!res.ok) {throw new Error(`HTTP ${res.status}`);}
            const buffer = await res.arrayBuffer();
            const input = Buffer.from(buffer);
            const pngBuffer = await sharp(input).ensureAlpha().extractFrame(0).png().toBuffer();
            return await loadImage(pngBuffer);
        } catch (error) {
            console.warn('Failed to load static GIF frame, falling back to direct load:', error);
            return await loadImage(url);
        }
    }
    async resolveTenorStatic(url) {
        try {
            const oembedUrl = `https://tenor.com/oembed?url=${encodeURIComponent(url)}`;
            const res = await fetch(oembedUrl, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0' } });
            if (!res.ok) {throw new Error(`Tenor oEmbed HTTP ${res.status}`);}
            const data = await res.json();
            if (data && data.thumbnail_url) {return data.thumbnail_url;}
            if (data && data.url) {return data.url;}
        } catch (error) {
            console.warn('Failed to resolve Tenor static image via oEmbed:', error);
        }
        try {
            const pageRes = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0' } });
            if (!pageRes.ok) {throw new Error(`Tenor page HTTP ${pageRes.status}`);}
            const html = await pageRes.text();
            let metaMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
            if (!metaMatch) {metaMatch = html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i);}
            if (metaMatch && metaMatch[1]) {return metaMatch[1];}
        } catch (err) {
            console.warn('Failed to parse Tenor page for image:', err);
        }
        return null;
    }
    sanitizeMessageText(text) {
        if (!text) {return '';}
        let sanitized = text
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n')
            .replace(/[\u2028\u2029]/g, '\n');
        sanitized = sanitized.replace(/[\u200B-\u200D\u2060\uFEFF]/g, '');
        sanitized = sanitized.replace(/```[^\n]*\n([\s\S]*?)```/g, '$1');
        sanitized = sanitized.replace(/```/g, '');
        sanitized = sanitized.replace(/\*\*(.*?)\*\*/g, '$1');
        sanitized = sanitized.replace(/(?<!\*)\*(?!\*)([^*]+)\*(?!\*)/g, '$1');
        sanitized = sanitized.replace(/(?<!_)_(?!_)([^_]+)_(?!_)/g, '$1');
        sanitized = sanitized.replace(/~~(.*?)~~/g, '$1');
        sanitized = sanitized.replace(/__(.*?)__/g, '$1');
        sanitized = sanitized.replace(/`([^`]+)`/g, '$1');
        sanitized = sanitized.replace(/[^\S\r\n]+/g, ' ');
        sanitized = sanitized.replace(/\n[ \t]+/g, '\n');
        sanitized = sanitized.replace(/[ \t]+\n/g, '\n');
        return sanitized.trimEnd();
    }
    async createClipImage(text, username, avatarUrl, isBot = false, roleColor = '#ff6b6b', guild = null, client = null, message = null, user = null, attachments = null, embeds = null) {
        const isVerified = user ? this.isBotVerified(user) : false;
        const hasImages = attachments && attachments.size > 0;
        const imageUrls = this.extractImageUrls(text);
        const embedImageUrls = (embeds || []).flatMap(e => {
            const urls = [];
            if (e && e.image && e.image.url) {urls.push(e.image.url);}
            if (e && e.thumbnail && e.thumbnail.url) {urls.push(e.thumbnail.url);}
            return urls;
        });
        let trailingGifUrl = null;
        try {
            const trailing = text.trim().match(/(https?:\/\/\S+?\.gif(?:\?\S*)?)$/i);
            if (trailing && trailing[1]) {trailingGifUrl = trailing[1];}
        } catch (_) {}
        const allImageUrls = [...imageUrls, ...embedImageUrls, ...(trailingGifUrl ? [trailingGifUrl] : [])];
        let cleanedText = text;
        try {
            for (const url of allImageUrls) {
                const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                cleanedText = cleanedText.replace(new RegExp(escaped, 'g'), '').trim();
            }
            cleanedText = cleanedText.replace(/https?:\/\/tenor\.com\/\S+/gi, '').trim();
            cleanedText = cleanedText.replace(/[^\S\r\n]+/g, ' ');
            cleanedText = cleanedText.replace(/\n[ \t]+/g, '\n');
            cleanedText = cleanedText.replace(/[ \t]+\n/g, '\n');
            cleanedText = cleanedText.trimEnd();
        } catch (_) {}
        const sanitizedText = this.sanitizeMessageText(cleanedText);
        const customEmojis = await this.parseCustomEmojis(sanitizedText, guild);
        const unicodeEmojis = this.parseUnicodeEmojis(sanitizedText);
        const allEmojis = [...customEmojis, ...unicodeEmojis].sort((a, b) => a.start - b.start);
        const mentions = await this.parseMentions(sanitizedText, guild, client);
        if (allEmojis.length > 0) {
            console.log('Found emojis:', allEmojis.map(e => ({ name: e.name, url: e.url, isUnicode: e.isUnicode })));
        }
        const width = 800; // Increased width for better layout and positioning
        const minHeight = 120; // Minimum height for basic content
        const textHeight = this.calculateTextHeight(sanitizedText, width - 180, allEmojis, mentions); // Account for margins and avatar space
        let actualImageHeight = 0;
        if (hasImages || allImageUrls.length > 0) {
            const tempCanvas = createCanvas(width, 1);
            const tempCtx = tempCanvas.getContext('2d');
            const imageEndY = await this.drawImages(tempCtx, attachments, allImageUrls, 0, 0, width - 180);
            actualImageHeight = imageEndY + 20; // padding
        }
        const totalHeight = Math.ceil(Math.max(minHeight, textHeight + actualImageHeight + 40));
        const canvas = createCanvas(width, totalHeight);
        const ctx = canvas.getContext('2d');
        ctx.patternQuality = 'best';
        ctx.quality = 'best';
        ctx.antialias = 'subpixel';
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.textDrawingMode = 'path';
        ctx.fillStyle = '#1a1a1e';
        ctx.fillRect(0, 0, width, totalHeight);
        const avatarSize = 48;
        const contentWidth = width - 80; // More margin
        const avatarX = 50; // Moved further to the right
        const avatarY = 20; // Top-aligned padding instead of vertical centering
        const avatarBackgroundColor = '#1a1a1e';
        const drawAvatarFallback = () => {
            ctx.save();
            ctx.beginPath();
            ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
            ctx.fillStyle = avatarBackgroundColor;
            ctx.fill();
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 12px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(username.charAt(0).toUpperCase(), avatarX + avatarSize / 2, avatarY + avatarSize / 2);
            ctx.restore();
        };
        if (avatarUrl) {
            try {
                ctx.save();
                ctx.beginPath();
                ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
                ctx.clip();
                ctx.fillStyle = avatarBackgroundColor;
                ctx.fillRect(avatarX, avatarY, avatarSize, avatarSize);
                const avatarImg = await loadImage(avatarUrl);
                ctx.drawImage(avatarImg, avatarX, avatarY, avatarSize, avatarSize);
                ctx.restore();
            } catch (error) {
                console.warn('Failed to load avatar, using fallback:', error);
                drawAvatarFallback();
            }
        } else {
            drawAvatarFallback();
        }
        const textStartX = avatarX + avatarSize + 20; // Increased spacing
        const textStartY = avatarY + 3;
        const maxTextWidth = contentWidth - (avatarSize + 20) - 30; // More margin
        const truncatedUsername = this.truncateText(username, 20);
        ctx.fillStyle = roleColor;
        ctx.font = 'bold 16px Arial';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(truncatedUsername, textStartX, textStartY);
        let currentX = textStartX + ctx.measureText(truncatedUsername).width + 4;
        if (isBot) {
            const appTagWidth = 38;
            const appTagHeight = 18;
            if (isVerified) {
                const badgeSize = 18;
                const badgeX = currentX;
                this.drawVerifiedBadge(ctx, badgeX, textStartY, badgeSize);
                currentX += badgeSize + 4;
            }
            ctx.fillStyle = 'rgb(88, 101, 242)'; // Discord APP badge color
            ctx.fillRect(currentX, textStartY, appTagWidth, appTagHeight);
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 11px Arial';
            ctx.fillText('APP', currentX + 3, textStartY + 3);
            currentX += appTagWidth + 4;
        }
        const timestamp = message ? this.parseDiscordTimestamp(message) : '6:39 PM';
        ctx.font = '13px Arial';
        const timestampWidth = ctx.measureText(timestamp).width;
        const availableWidth = width - currentX - 20;
        if (timestampWidth <= availableWidth) {
            ctx.fillStyle = '#72767d';
            ctx.fillText(timestamp, currentX, textStartY + 1);
        } else {
            ctx.fillStyle = '#72767d';
            ctx.fillText(timestamp, textStartX, textStartY + 18);
        }
        ctx.font = '15px Arial';
        const messageStartY = textStartY + 20;
        await this.drawFormattedText(ctx, sanitizedText, textStartX, messageStartY, maxTextWidth, allEmojis, mentions);
        if (hasImages || allImageUrls.length > 0) {
            const effectiveTextHeight = Math.max(0, textHeight - 44);
            const imageY = messageStartY + effectiveTextHeight + 2;
            await this.drawImages(ctx, attachments, allImageUrls, textStartX, imageY, maxTextWidth);
        }
        const buffer = canvas.toBuffer('image/png');
        const processedBuffer = await sharp(buffer)
            .resize({
                width: 800,
                fit: 'inside',
                withoutEnlargement: true,
                kernel: sharp.kernel.lanczos3
            })
            .png({
                compressionLevel: 6,
                adaptiveFiltering: true,
                quality: 100,
                effort: 6,
                palette: false
            })
            .toBuffer();
        return processedBuffer;
    }
    async drawFormattedText(ctx, text, startX, startY, maxWidth, customEmojis, mentions = []) {
        ctx.fillStyle = '#ffffff';
        ctx.font = '15px Arial';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        let currentY = startY;
        const lineHeight = 22;
        const emojiSize = 18;
        const emojiSpacing = typeof this.clipEmojiSpacing === 'number' ? this.clipEmojiSpacing : 3;
        const emojiAdvance = emojiSize + emojiSpacing;
        const segments = this.splitTextWithEmojisAndMentions(text, customEmojis, mentions);
        let currentLineWidth = 0;
        const advanceLine = () => {
            currentY += lineHeight;
            currentLineWidth = 0;
        };
        const handleWhitespaceToken = token => {
            if (!token) {return;}
            const { width } = ctx.measureText(token);
            if (currentLineWidth + width > maxWidth && currentLineWidth > 0) {
                advanceLine();
            }
            currentLineWidth += width;
        };
        const handleTextToken = (token, color = '#ffffff') => {
            if (!token) {return;}
            const { width } = ctx.measureText(token);
            if (currentLineWidth + width > maxWidth && currentLineWidth > 0) {
                advanceLine();
            }
            const previousFill = ctx.fillStyle;
            ctx.fillStyle = color;
            ctx.fillText(token, startX + currentLineWidth, currentY);
            ctx.fillStyle = previousFill;
            currentLineWidth += width;
        };
        for (const segment of segments) {
            if (segment.type === 'emoji') {
                const hasImageAsset = Boolean(segment.url);
                let rendered = false;
                if (hasImageAsset) {
                    if (currentLineWidth + emojiSize > maxWidth && currentLineWidth > 0) {
                        advanceLine();
                    }
                    const drawX = startX + currentLineWidth;
                    try {
                        const emojiImg = await this.fetchEmojiImage(segment.url);
                        ctx.drawImage(emojiImg, drawX, currentY, emojiSize, emojiSize);
                        rendered = true;
                    } catch (primaryError) {
                        console.warn('Failed to load primary emoji asset:', { name: segment.name, url: segment.url, error: primaryError.message });
                        if (segment.fallbackUrl) {
                            try {
                                const fallbackImg = await this.fetchEmojiImage(segment.fallbackUrl);
                                ctx.drawImage(fallbackImg, drawX, currentY, emojiSize, emojiSize);
                                rendered = true;
                            } catch (fallbackError) {
                                console.warn('Fallback emoji asset also failed:', { name: segment.name, url: segment.fallbackUrl, error: fallbackError.message });
                            }
                        } else if (segment.id) {
                            const alternativeUrl = ensureDiscordEmojiSize(`https://cdn.discordapp.com/emojis/${segment.id}.png`, DEFAULT_CUSTOM_EMOJI_SIZE);
                            if (alternativeUrl !== segment.url) {
                                try {
                                    const fallbackImg = await this.fetchEmojiImage(alternativeUrl);
                                    ctx.drawImage(fallbackImg, drawX, currentY, emojiSize, emojiSize);
                                    rendered = true;
                                } catch (altError) {
                                    console.warn('Alternative emoji URL also failed:', { name: segment.name, url: alternativeUrl, error: altError.message });
                                }
                            }
                        }
                    }
                    if (rendered) {
                        currentLineWidth += emojiAdvance;
                        continue;
                    }
                }
                if (segment.isUnicode) {
                    const emojiText = segment.name;
                    ctx.font = '18px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Android Emoji", "EmojiSymbols", "EmojiOne Mozilla", "Twemoji Mozilla", "Segoe UI Symbol", sans-serif';
                    const textWidth = ctx.measureText(emojiText).width;
                    if (currentLineWidth + textWidth > maxWidth && currentLineWidth > 0) {
                        advanceLine();
                    }
                    ctx.fillText(emojiText, startX + currentLineWidth, currentY);
                    currentLineWidth += textWidth;
                    ctx.font = '15px Arial';
                } else {
                    try {
                        console.log('Loading emoji:', { name: segment.name, url: segment.url });
                        const emojiImg = await loadImage(segment.url);
                        const emojiWidth = emojiSize;
                        const emojiHeight = emojiSize;
                        if (currentLineWidth + emojiAdvance > maxWidth && currentLineWidth > 0) {
                            advanceLine();
                        }
                        ctx.drawImage(emojiImg, startX + currentLineWidth, currentY, emojiWidth, emojiHeight);
                        currentLineWidth += emojiAdvance;
                        console.log('Successfully rendered emoji:', segment.name);
                    } catch (error) {
                        console.warn('Failed to load emoji:', { name: segment.name, url: segment.url, error: error.message });
                        try {
                            const alternativeUrl = `https://cdn.discordapp.com/emojis/${segment.id}.png`;
                            if (alternativeUrl !== segment.url) {
                                console.log('Trying alternative emoji URL:', alternativeUrl);
                                const emojiImg = await loadImage(alternativeUrl);
                                const emojiWidth = emojiSize;
                                const emojiHeight = emojiSize;
                                if (currentLineWidth + emojiAdvance > maxWidth && currentLineWidth > 0) {
                                    advanceLine();
                                }
                                ctx.drawImage(emojiImg, startX + currentLineWidth, currentY, emojiWidth, emojiHeight);
                                currentLineWidth += emojiAdvance;
                                console.log('Successfully rendered emoji with alternative URL:', segment.name);
                            } else {
                                throw new Error('Alternative URL same as original');
                            }
                        } catch (altError) {
                            console.warn('Alternative emoji URL also failed:', altError.message);
                            const fallbackText = `:${segment.name}:`;
                            handleTextToken(fallbackText);
                        }
                    }
                }
            } else if (segment.type === 'mention') {
                const mentionTokens = segment.text.split(/(\n|\s+)/);
                for (const token of mentionTokens) {
                    if (!token) {continue;}
                    if (token === '\n') {
                        advanceLine();
                        continue;
                    }
                    if (/^\s+$/.test(token)) {
                        handleWhitespaceToken(token);
                        continue;
                    }
                    handleTextToken(token, '#8899ff');
                }
            } else {
                const textTokens = segment.text.split(/(\n|\s+)/);
                for (const token of textTokens) {
                    if (!token) {continue;}
                    if (token === '\n') {
                        advanceLine();
                        continue;
                    }
                    if (/^\s+$/.test(token)) {
                        handleWhitespaceToken(token);
                        continue;
                    }
                    handleTextToken(token);
                }
            }
        }
    }
    splitTextWithEmojisAndMentions(text, allEmojis, mentions) {
        const segments = [];
        let lastIndex = 0;
        const sortedEmojis = allEmojis.sort((a, b) => a.start - b.start);
        const sortedMentions = (mentions || []).sort((a, b) => a.start - b.start);
        let i = 0, j = 0;
        const items = [];
        while (i < sortedEmojis.length || j < sortedMentions.length) {
            const nextEmoji = i < sortedEmojis.length ? sortedEmojis[i] : null;
            const nextMention = j < sortedMentions.length ? sortedMentions[j] : null;
            const takeEmoji = nextEmoji && (!nextMention || nextEmoji.start <= nextMention.start);
            if (takeEmoji) { items.push({ kind: 'emoji', item: nextEmoji }); i++; }
            else { items.push({ kind: 'mention', item: nextMention }); j++; }
        }
        for (const entry of items) {
            const posStart = entry.item.start;
            const posEnd = entry.item.end;
            if (posStart > lastIndex) {
                const textSegment = text.substring(lastIndex, posStart);
                if (textSegment) {segments.push({ type: 'text', text: textSegment });}
            }
            if (entry.kind === 'emoji') {
                const emoji = entry.item;
                segments.push({
                    type: 'emoji',
                    name: emoji.name,
                    url: emoji.url,
                    fallbackUrl: emoji.fallbackUrl,
                    full: emoji.full,
                    id: emoji.id,
                    isUnicode: emoji.isUnicode
                });
            } else {
                const mention = entry.item;
                segments.push({ type: 'mention', text: mention.display });
            }
            lastIndex = posEnd;
        }
        if (lastIndex < text.length) {
            const remainingText = text.substring(lastIndex);
            if (remainingText) {
                segments.push({ type: 'text', text: remainingText });
            }
        }
        return segments;
    }
    async drawImages(ctx, attachments, imageUrls, startX, startY, maxWidth) {
        let currentY = startY;
        const maxImageWidth = Math.min(maxWidth, 400);
        const maxImageHeight = 300; // Increased max height
        if (attachments && attachments.size > 0) {
            for (const attachment of attachments.values()) {
                if (attachment.contentType && attachment.contentType.startsWith('image/')) {
                    try {
                        const isGif = attachment.contentType.includes('gif') || /\.gif(\?|$)/i.test(attachment.url);
                        const img = isGif ? await this.loadStaticImage(attachment.url) : await loadImage(attachment.url);
                        const aspectRatio = img.width / img.height;
                        let drawWidth = maxImageWidth;
                        let drawHeight = drawWidth / aspectRatio;
                        if (drawHeight > maxImageHeight) {
                            drawHeight = maxImageHeight;
                            drawWidth = drawHeight * aspectRatio;
                        }
                        ctx.drawImage(img, startX, currentY, drawWidth, drawHeight);
                        currentY += drawHeight + 10;
                    } catch (error) {
                        console.warn('Failed to load attachment image:', error);
                    }
                }
            }
        }
        for (const imageUrl of imageUrls) {
            try {
                let sourceUrl = imageUrl;
                if (/tenor\.com\//i.test(sourceUrl)) {
                    const staticUrl = await this.resolveTenorStatic(sourceUrl);
                    if (staticUrl) {sourceUrl = staticUrl;}
                }
                const isGifUrl = /\.gif(\?|$)/i.test(sourceUrl) || /media\.discordapp\.net\//i.test(sourceUrl);
                const img = isGifUrl ? await this.loadStaticImage(sourceUrl) : await loadImage(sourceUrl);
                const aspectRatio = img.width / img.height;
                let drawWidth = maxImageWidth;
                let drawHeight = drawWidth / aspectRatio;
                if (drawHeight > maxImageHeight) {
                    drawHeight = maxImageHeight;
                    drawWidth = drawHeight * aspectRatio;
                }
                ctx.drawImage(img, startX, currentY, drawWidth, drawHeight);
                currentY += drawHeight + 10;
            } catch (error) {
                console.warn('Failed to load URL image:', error);
            }
        }
        return currentY;
    }
    async getContextualMemory(message, client) {
        try {
            const messages = await message.channel.messages.fetch({ limit: 20 });
            const sortedMessages = messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
            const referencedMessageId = message.reference?.messageId;
            let conversationStart = -1;
            let referencedMessage = null;
            for (let i = 0; i < sortedMessages.size; i++) {
                const msg = Array.from(sortedMessages.values())[i];
                if (msg.id === referencedMessageId) {
                    conversationStart = i;
                    referencedMessage = msg;
                    break;
                }
            }
            if (conversationStart === -1) {
                return null;
            }
            const contextualMessages = [];
            const threadMessages = Array.from(sortedMessages.values()).slice(conversationStart);
            if (referencedMessage.author.id === client.user.id) {
                contextualMessages.push({
                    role: 'assistant',
                    content: referencedMessage.content,
                    timestamp: referencedMessage.createdTimestamp
                });
            } else {
                contextualMessages.push({
                    role: 'user',
                    content: referencedMessage.content,
                    username: referencedMessage.author.username,
                    timestamp: referencedMessage.createdTimestamp,
                    isReferencedMessage: true
                });
            }
            for (const msg of threadMessages) {
                if (msg.id === referencedMessageId) {continue;}
                if (msg.author.bot && msg.author.id === client.user.id) {
                    contextualMessages.push({
                        role: 'assistant',
                        content: msg.content,
                        timestamp: msg.createdTimestamp
                    });
                } else if (!msg.author.bot) {
                    contextualMessages.push({
                        role: 'user',
                        content: msg.content,
                        username: msg.author.username,
                        timestamp: msg.createdTimestamp
                    });
                }
            }
            const recentContext = contextualMessages.slice(-10);
            return {
                type: 'contextual',
                messages: recentContext,
                threadStart: referencedMessageId,
                isReplyToUser: referencedMessage.author.id !== client.user.id
            };
        } catch (error) {
            console.warn('Failed to build contextual memory:', error);
            return null;
        }
    }
    async handleJarvisInteraction(message, client) {
        if (!this.canSendInChannel(message.channel)) {return;}
        const isMentioned = message.mentions.has(client.user);
        const isDM = message.channel.type === ChannelType.DM;
        const lowerContent = message.content.toLowerCase();
        let containsJarvis = false;
        let guildHasCustomWord = false;
        let guildWakeWordsDisabled = false;
        try {
            const userFeatures = require('./user-features');
            if (message.guild) {
                const guildWord = await userFeatures.getGuildWakeWord(message.guild.id);
                if (guildWord) {
                    guildHasCustomWord = true;
                    containsJarvis = await userFeatures.matchesGuildWakeWord(message.guild.id, lowerContent);
                }
                guildWakeWordsDisabled = await userFeatures.isGuildWakeWordsDisabled(message.guild.id);
            }
            if (!containsJarvis) {
                const userMatch = await userFeatures.matchesWakeWord(message.author.id, lowerContent);
                if (userMatch) {containsJarvis = true;}
            }
        } catch (_e) {
        }
        if (!containsJarvis && !guildHasCustomWord && !guildWakeWordsDisabled) {
            containsJarvis = config.wakeWords.some(trigger =>
                lowerContent.includes(trigger)
            );
        }
        const isBot = message.author.bot;
        if (isBot) {
            console.log(`Bot interaction detected from ${message.author.username} (${message.author.id}): ${message.content.substring(0, 50)}...`);
        }
        let isReplyToJarvis = false;
        let isReplyToUser = false;
        let contextualMemory = null;
        const rawContent = typeof message.content === 'string' ? message.content : '';
        const messageScope = 'message:jarvis';
        if (message.reference && message.reference.messageId) {
            try {
                const referencedMessage = await message.channel.messages.fetch(message.reference.messageId);
                if (referencedMessage.author.id === client.user.id) {
                    isReplyToJarvis = true;
                    contextualMemory = await this.getContextualMemory(message, client);
                } else if (!referencedMessage.author.bot) {
                    isReplyToUser = true;
                    if (isMentioned || containsJarvis) {
                        contextualMemory = await this.getContextualMemory(message, client);
                    }
                }
            } catch (error) {
                if (error.code !== 10008) {
                    console.warn('Failed to fetch referenced message:', error.message);
                }
            }
        }
        if (isBot) {
            if (!isMentioned && !containsJarvis) {return;}
        } else {
            if (!isDM && !isMentioned && !containsJarvis && !isReplyToJarvis && !(isReplyToUser && (isMentioned || containsJarvis))) {
                return;
            }
        }
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
            await message.reply('For video reconnaissance, deploy `/yt` instead, sir.');
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
            await message.channel.sendTyping();
        } catch (err) {
            console.warn('Failed to send typing (permissions?):', err);
        }
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
                await message.reply(responses[Math.floor(Math.random() * responses.length)]);
            } catch (err) {
                console.error('Failed to reply (permissions?):', err);
            }
            this.setCooldown(message.author.id, messageScope);
            return;
        }
        try {
            const utilityResponse = await this.jarvis.handleUtilityCommand(
                cleanContent,
                message.author.username,
                message.author.id,
                false,
                null,
                message.guild?.id || null
            );
            if (utilityResponse) {
                if (typeof utilityResponse === 'string' && utilityResponse.trim()) {
                    const safe = this.sanitizePings(utilityResponse);
                    await message.reply({ content: safe, allowedMentions: { parse: [] } });
                } else {
                    await message.reply({ content: 'Utility functions misbehaving, sir. Try another?', allowedMentions: { parse: [] } });
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
                    let repliedDisplayName = repliedMessage.author?.username || 'user';
                    if (message.guild && repliedMessage.author?.id) {
                        const repliedMember =
                            repliedMessage.member ||
                            (await message.guild.members.fetch(repliedMessage.author.id).catch(() => null));
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
                    if (imageAttachments.length === 0) {
                        if (repliedMessage?.attachments?.size > 0) {
                            const repliedImages = Array.from(repliedMessage.attachments.values())
                                .filter(isImageAttachment)
                                .map(att => ({ url: att.url, contentType: att.contentType, fromReply: true }));
                            imageAttachments = [...imageAttachments, ...repliedImages];
                        }
                        if (repliedMessage?.embeds?.length > 0) {
                            for (const embed of repliedMessage.embeds) {
                                if (embed.image?.url) {
                                    imageAttachments.push({ url: embed.image.url, contentType: 'image/unknown', fromReply: true });
                                }
                                if (embed.thumbnail?.url && !imageAttachments.some(a => a.url === embed.thumbnail.url)) {
                                    imageAttachments.push({ url: embed.thumbnail.url, contentType: 'image/unknown', fromReply: true });
                                }
                            }
                        }
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
                            if (prevMsg.attachments?.size > 0) {
                                const prevImages = Array.from(prevMsg.attachments.values())
                                    .filter(isImageAttachment)
                                    .map(att => ({ url: att.url, contentType: att.contentType, fromPrevious: true }));
                                imageAttachments = [...imageAttachments, ...prevImages];
                                if (prevImages.length > 0) {
                                    console.log(`[Vision] Found ${prevImages.length} image(s) in previous message`);
                                }
                            }
                            if (prevMsg.embeds?.length > 0) {
                                for (const embed of prevMsg.embeds) {
                                    if (embed.image?.url) {
                                        imageAttachments.push({ url: embed.image.url, contentType: 'image/unknown', fromPrevious: true });
                                    }
                                    if (embed.thumbnail?.url && !imageAttachments.some(a => a.url === embed.thumbnail.url)) {
                                        imageAttachments.push({ url: embed.thumbnail.url, contentType: 'image/unknown', fromPrevious: true });
                                    }
                                }
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
            const userCredit = await socialCredit.getCredit(message.author.id);
            if (socialCredit.isBlocked(userCredit)) {
                await message.reply({ content: socialCredit.getBlockMessage(userCredit), allowedMentions: { parse: [] } });
                try {
                    await message.react('1477737004195123230');
                } catch (_) { /* emoji not available */ }
                this.setCooldown(message.author.id, messageScope);
                return;
            }
            if (userCredit.blockedUntil && new Date() >= new Date(userCredit.blockedUntil)) {
                socialCredit.clearBlock(message.author.id).catch(() => {});
            }
            const response = await this.jarvis.generateResponse(message, fullContent, false, contextualMemory, imageAttachments);
            let reactCandidates = [];
            let cleanResponse = response;
            if (typeof response === 'string') {
                const parsedReactionDirective = extractReactionDirective(response);
                cleanResponse = parsedReactionDirective.cleanText;
                reactCandidates = parsedReactionDirective.reactionCandidates;
            }
            let creditSuffix = '';
            try {
                const rawCreditContent = typeof message.content === 'string' ? message.content : '';
                const cringeInput = socialCredit.stripBotMentions(rawCreditContent, client);
                const cringeScore = socialCredit.getCringeLevel(cringeInput);
                let creditChange = socialCredit.rollCreditChange(rawCreditContent, client);
                if (cringeScore < 15 && userCredit.score < 0) {
                    creditChange += socialCredit.getRecoveryBonus(userCredit.score);
                }
                if (creditChange > 0 || creditChange < 0) {
                    const newScore = await socialCredit.adjustCredit(message.author.id, creditChange);
                    if (socialCredit.shouldReact(cringeScore)) {
                        const emojiId = creditChange > 0 ? '1477736880127869039' : '1477737004195123230';
                        try {
                            await message.react(emojiId);
                        } catch (_) { /* emoji not available */ }
                    }
                    if (socialCredit.shouldNotify(creditChange, cringeScore)) {
                        creditSuffix = '\n' + socialCredit.buildNotifyMessage(creditChange, newScore);
                    }
                }
            } catch (_) { /* social credit non-critical */ }
            if (typeof cleanResponse === 'string' && cleanResponse.trim()) {
                const safe = this.sanitizePings(cleanResponse);
                const chunks = splitMessage(safe + creditSuffix);
                for (let i = 0; i < chunks.length; i++) {
                    if (i === 0) {
                        await message.reply({ content: chunks[i], allowedMentions: { parse: [] } });
                    } else {
                        await message.channel.send({ content: chunks[i], allowedMentions: { parse: [] } });
                    }
                }
            } else {
                await message.reply({ content: 'Response circuits tangled, sir. Clarify your request?' + creditSuffix, allowedMentions: { parse: [] } });
            }
            if (reactCandidates.length > 0) {
                for (const candidate of reactCandidates) {
                    try {
                        await message.react(candidate);
                        break;
                    } catch (_) {
                    }
                }
            }
        } catch (error) {
            const errorId = `J-${Date.now().toString(36).slice(-4).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
            console.error(`[${errorId}] Error processing message:`, error);
            if (error?.code === 50013) {return;}
            try {
                await message.reply({ content: `Technical difficulties, sir. (${errorId}) Please try again shortly.`, allowedMentions: { parse: [] } });
            } catch (err) {
                if (err?.code !== 50013) {
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
                const config = await database.getServerStatsConfig(guild.id);
                if (!config) {
                    await interaction.editReply('Server statistics channels are not configured, sir.');
                    return;
                }
                const stats = await serverStats.collectGuildMemberStats(guild);
                const category = await this.resolveGuildChannel(guild, config.categoryId);
                const totalChannel = await this.resolveGuildChannel(guild, config.totalChannelId);
                const userChannel = await this.resolveGuildChannel(guild, config.userChannelId);
                const botChannel = await this.resolveGuildChannel(guild, config.botChannelId);
                const channelCountChannel = await this.resolveGuildChannel(guild, config.channelCountChannelId);
                const roleCountChannel = await this.resolveGuildChannel(guild, config.roleCountChannelId);
                const lines = [
                    `Category: ${category ? `<#${category.id}>` : 'Missing'}`,
                    `Member channel: ${totalChannel ? `<#${totalChannel.id}>` : 'Missing'}`,
                    `User channel: ${userChannel ? `<#${userChannel.id}>` : 'Missing'}`,
                    `Bot channel: ${botChannel ? `<#${botChannel.id}>` : 'Missing'}`,
                    `Channel count channel: ${channelCountChannel ? `<#${channelCountChannel.id}>` : 'Missing'}`,
                    `Role count channel: ${roleCountChannel ? `<#${roleCountChannel.id}>` : 'Missing'}`,
                    `Current totals — Members: ${serverStats.formatServerStatsValue(stats.total)}, Users: ${serverStats.formatServerStatsValue(stats.userCount)}, Bots: ${serverStats.formatServerStatsValue(stats.botCount)}, Channels: ${serverStats.formatServerStatsValue(stats.channelCount)}, Roles: ${serverStats.formatServerStatsValue(stats.roleCount)}`
                ];
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
    async handleRemindCommand(interaction) {
        const userFeatures = require('./user-features');
        const subcommand = interaction.options.getSubcommand();
        const userId = interaction.user.id;
        const { channelId } = interaction;
        try {
            if (subcommand === 'set') {
                const message = interaction.options.getString('message');
                const timeInput = interaction.options.getString('time');
                const result = await userFeatures.createReminder(userId, channelId, message, timeInput);
                if (!result.success) {
                    await interaction.editReply(result.error);
                    return;
                }
                await interaction.editReply(
                    `⏰ Reminder set, sir.\n**Message:** ${message}\n**When:** ${result.formattedTime}\n**ID:** \`${result.reminder.id}\``
                );
            } else if (subcommand === 'list') {
                const reminders = await userFeatures.getUserReminders(userId);
                if (reminders.length === 0) {
                    await interaction.editReply('No pending reminders, sir. Use `/remind set` to create one.');
                    return;
                }
                const lines = await Promise.all(reminders.map(async(r, i) => {
                    const time = await userFeatures.formatTimeForUser(userId, new Date(r.scheduledFor));
                    return `${i + 1}. **${r.message}**\n   ⏰ ${time} | ID: \`${r.id}\``;
                }));
                await interaction.editReply(`📋 **Your Reminders:**\n\n${lines.join('\n\n')}`);
            } else if (subcommand === 'cancel') {
                const reminderId = interaction.options.getString('id');
                const result = await userFeatures.cancelReminder(userId, reminderId);
                if (!result.success) {
                    await interaction.editReply(result.error);
                    return;
                }
                await interaction.editReply('✅ Reminder cancelled, sir.');
            }
        } catch (error) {
            console.error('[/remind] Error:', error);
            await interaction.editReply('Failed to process reminder command, sir.');
        }
    }
    async handleTimezoneCommand(interaction) {
        const userFeatures = require('./user-features');
        const userId = interaction.user.id;
        const zone = interaction.options.getString('zone');
        try {
            if (!zone) {
                const currentZone = await userFeatures.getTimezone(userId);
                const currentTime = await userFeatures.formatTimeForUser(userId);
                await interaction.editReply(
                    `🌍 **Your Timezone:** ${currentZone}\n🕐 **Current Time:** ${currentTime}\n\nUse \`/timezone zone:America/New_York\` to change.`
                );
                return;
            }
            const result = await userFeatures.setTimezone(userId, zone);
            if (!result.success) {
                await interaction.editReply(result.error);
                return;
            }
            const currentTime = await userFeatures.formatTimeForUser(userId);
            await interaction.editReply(`✅ Timezone set to **${result.timezone}**\n🕐 Current time: ${currentTime}`);
        } catch (error) {
            console.error('[/timezone] Error:', error);
            await interaction.editReply('Failed to update timezone, sir.');
        }
    }
    async handleWakewordCommand(interaction) {
        const userFeatures = require('./user-features');
        const userId = interaction.user.id;
        const word = interaction.options.getString('word');
        const scope = interaction.options.getString('scope') || 'personal';
        const clear = interaction.options.getBoolean('clear') || false;
        const disableDefaults = interaction.options.getBoolean('disable_defaults');
        try {
            if (scope === 'server') {
                if (!interaction.guild) {
                    await interaction.editReply('Server wake words can only be set in a server, sir.');
                    return;
                }
                const { member } = interaction;
                const isAdmin = member.permissions?.has(PermissionsBitField.Flags.Administrator) ||
                    member.permissions?.has(PermissionsBitField.Flags.ManageGuild) ||
                    member.id === interaction.guild.ownerId;
                if (!isAdmin) {
                    await interaction.editReply('Only server admins can set a server-wide wake word.');
                    return;
                }
                const guildId = interaction.guild.id;
                if (disableDefaults !== null) {
                    await userFeatures.setGuildWakeWordsDisabled(guildId, disableDefaults);
                    if (disableDefaults) {
                        await interaction.editReply('Default wake words disabled for this server. I will only respond to custom wake words, personal wake words, or mentions.');
                    } else {
                        await interaction.editReply('Default wake words enabled for this server. I will respond to "jarvis" / "garmin" when no server wake word is set.');
                    }
                    return;
                }
                if (clear) {
                    await userFeatures.removeGuildWakeWord(guildId);
                    const defaultsDisabled = await userFeatures.isGuildWakeWordsDisabled(guildId);
                    if (defaultsDisabled) {
                        await interaction.editReply('Server wake word removed. Default wake words are still disabled for this server; I will respond to personal wake words or mentions.');
                    } else {
                        await interaction.editReply('Server wake word removed. I\'ll respond to the default triggers ("jarvis" / "garmin") and personal wake words now.');
                    }
                    return;
                }
                if (!word) {
                    const currentGuildWord = await userFeatures.getGuildWakeWord(guildId);
                    const defaultsDisabled = await userFeatures.isGuildWakeWordsDisabled(guildId);
                    if (currentGuildWord) {
                        const defaultsLine = defaultsDisabled
                            ? '\nDefault wake words are disabled.'
                            : '\nDefault wake words are enabled when no server wake word is set.';
                        await interaction.editReply(`🏠 **Server Wake Word:** "${currentGuildWord}"\n\nAnyone in this server can say "${currentGuildWord}" to summon me.\nUse \`/wakeword word:newword scope:Server\` to change, or \`/wakeword scope:Server clear:True\` to remove.${defaultsLine}`);
                    } else {
                        const defaultsLine = defaultsDisabled
                            ? '\nDefault wake words are currently disabled.'
                            : '\nDefault wake words are currently enabled.';
                        await interaction.editReply(`No server wake word set.\n\nUse \`/wakeword word:yourword scope:Server\` to set one for the whole server.${defaultsLine}`);
                    }
                    return;
                }
                const result = await userFeatures.setGuildWakeWord(guildId, word);
                if (!result.success) {
                    await interaction.editReply(result.error);
                    return;
                }
                await interaction.editReply(`Server wake word set to **"${result.wakeWord}"**\n\nAnyone in this server can now summon me by saying "${result.wakeWord}". Default triggers ("jarvis" / "garmin") are now disabled for this server.`);
                return;
            }
            if (disableDefaults !== null) {
                await interaction.editReply('`disable_defaults` is a server-only option, sir.');
                return;
            }
            if (clear) {
                await userFeatures.clearWakeWord(userId);
                await interaction.editReply('Your personal wake word has been removed.');
                return;
            }
            if (!word) {
                const currentWord = await userFeatures.getWakeWord(userId);
                const lines = [];
                if (currentWord) {
                    lines.push(`🎯 **Your Custom Wake Word:** "${currentWord}"`);
                    lines.push(`\nUse \`/wakeword word:newword\` to change, or say "${currentWord}" to summon me.`);
                } else {
                    lines.push('No personal wake word set, sir.');
                    lines.push('\nUse `/wakeword word:yourword` to set one. I\'ll respond when you say it!');
                }
                if (interaction.guild) {
                    const guildWord = await userFeatures.getGuildWakeWord(interaction.guild.id);
                    if (guildWord) {
                        lines.push(`\n🏠 **Server Wake Word:** "${guildWord}"`);
                    }
                }
                await interaction.editReply(lines.join(''));
                return;
            }
            const result = await userFeatures.setWakeWord(userId, word);
            if (!result.success) {
                await interaction.editReply(result.error);
                return;
            }
            await interaction.editReply(`Custom wake word set to **"${result.wakeWord}"**\n\nNow you can summon me by saying "${result.wakeWord}" in any message!`);
        } catch (error) {
            console.error('[/wakeword] Error:', error);
            await interaction.editReply('Failed to update wake word, sir.');
        }
    }
}
module.exports = new DiscordHandlers();

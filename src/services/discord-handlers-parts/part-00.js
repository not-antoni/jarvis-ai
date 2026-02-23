/**
 * Discord event handlers and command processing
 */

const {
    ChannelType,
    AttachmentBuilder,
    UserFlags,
    PermissionsBitField,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    parseEmoji,
} = require('discord.js');
const JarvisAI = require('./jarvis-core');
const config = require('../../config');
const { LRUCache } = require('lru-cache');
const braveSearch = require('./brave-search');
const { createCanvas, loadImage, registerFont } = require('canvas');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const database = require('./database');
const fetch = require('node-fetch');
const cheerio = require('cheerio');
const pdfParse = require('pdf-parse');
const embeddingSystem = require('./embedding-system');
const { commandMap: musicCommandMap } = require('../commands/music');
const CooldownManager = require('../core/cooldown-manager');
const { recordCommandRun } = require('../utils/telemetry');
const { commandFeatureMap, SLASH_EPHEMERAL_COMMANDS } = require('../core/command-registry');
const { isFeatureGloballyEnabled, isFeatureEnabledForGuild } = require('../core/feature-flags');
const memeCanvas = require('../utils/meme-canvas');
const cryptoClient = require('./crypto-client');
const vaultClient = require('./vault-client');
const moderationFilters = require('./moderation-filters');
const NEWS_API_KEY = process.env.NEWS_API_KEY || null;
const BrowserAgent = require('../agents/browserAgent');
const AgentMonitor = require('../agents/agentMonitor');
const AgentConfig = require('../agents/agentConfig');
const RetryPolicy = require('../agents/retryPolicy');
const AutoHealer = require('../agents/autoHealer');
const CaptchaHandler = require('../agents/captchaHandler');
const RobustnessEnhancer = require('../agents/robustnessEnhancer');
const tempFiles = require('../utils/temp-files');
const { sanitizePings: sanitizePingsUtil } = require('../utils/sanitize');
const { splitMessage } = require('../utils/discord-safe-send');
const funFeatures = require('./fun-features');
const selfhostFeatures = require('./selfhost-features');
const ytDlpManager = require('./yt-dlp-manager');
const { getSentientAgent } = require('../agents/sentient-core');
const starkTinker = require('./stark-tinker');
const starkEconomy = require('./stark-economy');
const guildModeration = require('./GUILDS_FEATURES/moderation');
const clankerGif = require('../utils/clanker-gif');
const guildConfigDiskCache = require('./guild-config-cache');
const { handleSelfmodCommand, handleSentientCommand } = require('./handlers/slash-experimental');
const slashEconomy = require('./handlers/slash-economy');
const slashSocial = require('./handlers/slash-social');
const slashUtility = require('./handlers/slash-utility');
const slashModeration = require('./handlers/slash-moderation');
const automodSlash = require('./handlers/automod-slash');
const automodUtils = require('./handlers/automod-utils');
const serverStats = require('./handlers/server-stats');
const memberLog = require('./handlers/member-log');
const reactionRoleHandler = require('./handlers/reaction-role-handler');
const monitorHandler = require('./handlers/monitor-handler');
const mediaHandlers = require('./handlers/media-handlers');
const gameHandlers = require('./handlers/game-handlers');
const memoryHandler = require('./handlers/memory-handler');

function isCommandEnabled(commandName) {
    const featureKey = commandFeatureMap.get(commandName);
    return isFeatureGloballyEnabled(featureKey);
}

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

function ensureDiscordEmojiSize(url, size = DEFAULT_CUSTOM_EMOJI_SIZE) {
    if (!url || typeof url !== 'string') return url;
    const base = url.split('?')[0];
    return `${base}?size=${size}&quality=lossless`;
}

function unicodeEmojiToCodePoints(emoji) {
    if (!emoji) return null;
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
    if (!code) return null;
    return {
        svg: `${TWEMOJI_SVG_BASE}/${code}.svg`,
        png: `${TWEMOJI_PNG_BASE}/${code}.png`
    };
}

class DiscordHandlers {
    constructor() {
        this.jarvis = new JarvisAI();
        this.cooldowns = new CooldownManager({ defaultCooldownMs: config.ai.cooldownMs });
        this.crypto = cryptoClient;
        
        // Initialize agent config from environment
        this.agentConfig = AgentConfig.loadFromEnv();
        this.browserAgent = new BrowserAgent(config);
        this.agentMonitor = new AgentMonitor(this.agentConfig);
        this.retryPolicy = new RetryPolicy(this.agentConfig);
        this.autoHealer = new AutoHealer(this.agentConfig);
        
        // Initialize captcha and robustness
        this.captchaHandler = new CaptchaHandler({
            solvingService: process.env.CAPTCHA_SERVICE || 'none', // 'none', '2captcha', 'anticaptcha'
            apiKey: process.env.CAPTCHA_API_KEY || null,
            timeout: 120000,
            retries: 3
        });
        this.robustnessEnhancer = new RobustnessEnhancer();
        
        this.guildConfigCache = new Map();
        this.guildConfigTtlMs = 60 * 1000;
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
        this.roastTemplates = [
            'Deploying shade cannons on {target}. Try not to melt, sir.',
            '{target}, even my error logs have more direction.',
            '{target}, if brilliance were a drive, you’re stuck in neutral.',
            '{target}, I’ve met loading bars with more resolve.',
            'I ran the numbers, {target}. Comedy requires a punchline—you are optional.'
        ];
        this.flatterTemplates = [
            '{target}, your presence calibrates the whole grid.',
            '{target}, even Stark’s ego flinches when you walk in.',
            'I logged your stride, {target}. It ranks among the top five trajectories.',
            '{target}, the servers purr a little smoother when you’re nearby.',
            'Consider this official: {target} remains the premium upgrade.'
        ];
        this.toastTemplates = [
            'A toast to {target}: may your glitches be charming and your victories loud.',
            'Raise a glass for {target}; brilliance executed with reckless elegance.',
            'To {target}: proof that chaos, when curated, is unstoppable.',
            'Celebrating {target}—the software patch the universe didn’t deserve.',
            'Here’s to {target}; long may your legend crash their humble firewalls.'
        ];
        this.triviaQuestions = [
            {
                question: 'Which Stark suit first featured full nanotech deployment?',
                choices: ['Mark 42', 'Mark 46', 'Mark 50', 'Mark 85'],
                answer: 'Mark 50'
            },
            {
                question: 'What element did Tony synthesize to replace palladium?',
                choices: ['Vibranium', 'Badassium', 'Chromium', 'Proteanium'],
                answer: 'Badassium'
            },
            {
                question: 'Which protocol locks down the Avengers Tower?',
                choices: ['Protocol House Party', 'Protocol Barn Door', 'Protocol Sky Shield', 'Protocol Jarvis Prime'],
                answer: 'Protocol Barn Door'
            },
            {
                question: 'Who reprogrammed Vision’s mind stone interface besides Stark?',
                choices: ['Banner', 'Shuri', 'Pym', 'Cho'],
                answer: 'Banner'
            }
        ];
        this.cipherPhrases = [
            'Arc reactor diagnostics nominal',
            'Stark Expo security override',
            'Deploy the Hall of Armor',
            'Engage satellite uplink now',
            'Initiate Mark Seven extraction'
        ];
        this.scrambleWords = [
            'repulsor',
            'vibranium',
            'arcforge',
            'nanotech',
            'ultrasonic',
            'starkware'
        ];
        this.missions = [
            'Share a photo of your current setup—Jarvis will rate the chaos.',
            'Teach the channel one obscure fact. Bonus points for science fiction.',
            'Designate a teammate and compliment their latest win.',
            'Queue up a nostalgic MCU moment and drop the timestamp.',
            'Build a playlist with five tracks that motivate your inner Avenger.',
            'Swap desktop wallpapers for the day and show your new look.',
            'Document a mini DIY project and share progress before midnight.',
            'Run a five-minute stretch break and ping the squad to join.'
        ];

        this.afkUsers = new LRUCache({ max: DISCORD_AFK_USERS_MAX, ttl: DISCORD_AFK_USERS_TTL_MS });
        

        this.maxInputBytes = 3 * 1024 * 1024; // 3MB cap for heavy media processing
    }

    sanitizePings(text) {
        return sanitizePingsUtil(text);
    }

    async sendBufferOrLink(interaction, buffer, preferredName) {
        const MAX_UPLOAD = 8 * 1024 * 1024;
        const ext = (preferredName.split('.').pop() || '').toLowerCase();
        const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext);
        if (buffer.length <= MAX_UPLOAD) {
            const file = new AttachmentBuilder(buffer, { name: preferredName });
            const payload = { files: [file] };
            if (!interaction.deferred && !interaction.replied) await interaction.reply(payload);
            else await interaction.editReply(payload);
            return { uploaded: true };
        }

        try {
            const saved = tempFiles.saveTempFile(buffer, ext || 'bin');
            const url = saved.url;
            const payload = isImage
                ? { embeds: [{ color: 0x1f8b4c, image: { url }, footer: { text: 'Temporary image • expires in ~4 hours' } }] }
                : { content: url };
            if (!interaction.deferred && !interaction.replied) await interaction.reply(payload);
            else await interaction.editReply(payload);
            return { uploaded: false, url };
        } catch (err) {
            const kb = Math.round(buffer.length / 1024);
            const content = `Generated file (${kb} KB) is too large to upload and saving failed.`;
            if (!interaction.deferred && !interaction.replied) await interaction.reply({ content });
            else await interaction.editReply({ content });
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

    randomInRange(min, max) {
        const low = Math.ceil(min);
        const high = Math.floor(max);
        return Math.floor(Math.random() * (high - low + 1)) + low;
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

    async ensureTicketCategory(guild) {
        if (!guild) {
            return null;
        }

        const existing = guild.channels.cache.find((channel) =>
            channel.type === ChannelType.GuildCategory && channel.name.toLowerCase() === 'tickets'
        );

        if (existing) {
            return existing;
        }

        try {
            const created = await guild.channels.create({
                name: 'Tickets',
                type: ChannelType.GuildCategory,
                reason: 'Initializing ticket workspace for Jarvis'
            });
            return created;
        } catch (error) {
            console.error('Failed to create ticket category:', error);
            return null;
        }
    }

    async collectTicketTranscript(channel) {
        const collected = [];

        if (!channel?.messages) {
            return collected;
        }

        let beforeId = null;
        const maxIterations = 100;
        let iterations = 0;

        while (iterations < maxIterations) {
            iterations += 1;
            try {
                const fetched = await channel.messages.fetch({ limit: 100, before: beforeId });
                if (!fetched.size) {
                    break;
                }

                const batch = [...fetched.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
                for (const message of batch) {
                    collected.push({
                        id: message.id,
                        authorId: message.author?.id || null,
                        authorTag: message.author?.tag || message.author?.username || 'Unknown',
                        createdAt: message.createdAt?.toISOString() || new Date().toISOString(),
                        content: message.cleanContent || message.content || '',
                        attachments: message.attachments?.map((attachment) => ({
                            id: attachment.id,
                            name: attachment.name,
                            url: attachment.url,
                            contentType: attachment.contentType || null
                        })) || []
                    });
                }

                beforeId = batch[0]?.id;
                if (!beforeId) {
                    break;
                }
            } catch (error) {
                console.error('Failed to fetch ticket transcript messages:', error);
                break;
            }
        }

        return collected;
    }

    // Clean up old cooldowns to prevent memory leaks
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
        // Bot owner bypasses ALL cooldowns
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
        // Under high load, increase cooldown duration to reduce pressure
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

    formatServerStatsValue(value) {
        return serverStats.formatServerStatsValue(value);
    }

    formatServerStatsName(label, value) {
        return serverStats.formatServerStatsName(label, value);
    }

    createDefaultMemberLogConfig(guildId = null) {
        return memberLog.createDefaultMemberLogConfig(guildId);
    }

    cloneMemberLogRecord(record) {
        return memberLog.cloneMemberLogRecord(this, record);
    }

    normalizeMemberLogMessage(input) {
        return memberLog.normalizeMemberLogMessage(this, input);
    }

    sanitizeMemberLogList(list = []) {
        return memberLog.sanitizeMemberLogList(this, list);
    }

    async getCachedMemberLogConfig(guildId, refresh = false) {
        return await memberLog.getCachedMemberLogConfig(this, guildId, refresh);
    }

    setCachedMemberLogConfig(guildId, record) {
        return memberLog.setCachedMemberLogConfig(this, guildId, record);
    }

    async persistMemberLogConfig(guildId, config) {
        return await memberLog.persistMemberLogConfig(this, guildId, config);
    }

    pickMemberLogMessage(type, config) {
        return memberLog.pickMemberLogMessage(this, type, config);
    }

    formatMemberLogMessage(template, member, type) {
        return memberLog.formatMemberLogMessage(template, member, type);
    }

    previewMemberLogMessage(template) {
        return memberLog.previewMemberLogMessage(template);
    }

    async sendMemberLogEvent(member, type) {
        return await memberLog.sendMemberLogEvent(this, member, type);
    }

    async handleGuildMemberAdd(member, client) {
        return await memberLog.handleGuildMemberAdd(this, member, client);
    }

    async handleGuildMemberRemove(member) {
        return await memberLog.handleGuildMemberRemove(this, member);
    }

    getReactionEmojiKey(emoji) {
        if (!emoji) {
            return null;
        }

        return emoji.id || emoji.name || null;
    }

    normalizeKeyword(keyword) {
        return automodUtils.normalizeKeyword(keyword);
    }

    parseKeywordInput(input) {
        return automodUtils.parseKeywordInput(input);
    }

    mergeKeywords(current = [], additions = []) {
        return automodUtils.mergeKeywords(current, additions);
    }

    createDefaultAutoModRecord(guildId = null) {
        return automodUtils.createDefaultAutoModRecord(this, guildId);
    }

    extractAutoModKeywordIssues(error) {
        return automodUtils.extractAutoModKeywordIssues(error);
    }

    getAutoModErrorMessage(error, fallback) {
        return automodUtils.getAutoModErrorMessage(this, error, fallback);
    }

    handleAutoModApiError(error, fallback) {
        return automodUtils.handleAutoModApiError(this, error, fallback);
    }

    async prepareAutoModState(guild, record) {
        return await automodUtils.prepareAutoModState(this, guild, record);
    }

    async fetchAutoModRule(guild, ruleId) {
        return await automodUtils.fetchAutoModRule(guild, ruleId);
    }

    async upsertAutoModRule(guild, keywords, customMessage = null, ruleId = null, enabled = true, ruleName = null) {
        return await automodUtils.upsertAutoModRule(this, guild, keywords, customMessage, ruleId, enabled, ruleName);
    }

    async syncAutoModRules(guild, keywords, customMessage = null, existingRuleIds = [], enabled = true) {
        return await automodUtils.syncAutoModRules(this, guild, keywords, customMessage, existingRuleIds, enabled);
    }

    generateAutoModFilterName(existingFilters = []) {
        return automodUtils.generateAutoModFilterName(this, existingFilters);
    }

    async upsertExtraAutoModFilter(guild, filter, defaultMessage, enabled = true) {
        return await automodUtils.upsertExtraAutoModFilter(this, guild, filter, defaultMessage, enabled);
    }

    async enableExtraAutoModFilters(guild, record) {
        return await automodUtils.enableExtraAutoModFilters(this, guild, record);
    }

    async disableExtraAutoModFilters(guild, record) {
        return await automodUtils.disableExtraAutoModFilters(this, guild, record);
    }

    async resyncEnabledExtraAutoModFilters(guild, record) {
        return await automodUtils.resyncEnabledExtraAutoModFilters(this, guild, record);
    }

    async disableAutoModRule(guild, ruleId) {
        return await automodUtils.disableAutoModRule(guild, ruleId);
    }

    invalidateGuildConfig(guildId) {
        if (guildId) {
            this.guildConfigCache.delete(guildId);
        }
    }

    async getGuildConfig(guild) {
        if (!guild) {
            return null;
        }

        const guildId = guild.id;
        
        // Layer 1: Check memory cache (fast, 60s TTL)
        const cached = this.guildConfigCache.get(guildId);
        if (cached && (Date.now() - cached.fetchedAt) < this.guildConfigTtlMs) {
            return cached.config;
        }

        // Layer 2: Check disk cache (5min TTL)
        const diskCached = guildConfigDiskCache.get(guildId);
        if (diskCached) {
            // Restore to memory cache
            this.guildConfigCache.set(guildId, { config: diskCached, fetchedAt: Date.now() });
            return diskCached;
        }

        // Layer 3: Fetch from MongoDB
        if (!database.isConnected) {
            return null;
        }

        try {
            const guildConfig = await database.getGuildConfig(guild.id, guild.ownerId);
            
            // Cache in both layers
            this.guildConfigCache.set(guildId, { config: guildConfig, fetchedAt: Date.now() });
            guildConfigDiskCache.set(guildId, guildConfig);
            
            return guildConfig;
        } catch (error) {
            console.error('Failed to fetch guild configuration:', error);
            return null;
        }
    }

    async isGuildModerator(member, guildConfig = null) {
        if (!member || !member.guild) {
            return false;
        }

        const guild = member.guild;
        const ownerId = guild.ownerId;

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

    async ensureBotCanManageChannels(guild) {
        return await serverStats.ensureBotCanManageChannels(this, guild);
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

    async applyServerStatsPermissions(channel, botMember, everyoneId) {
        return await serverStats.applyServerStatsPermissions(channel, botMember, everyoneId);
    }

    async ensureServerStatsChannels(guild, existingConfig = null, botMember = null) {
        return await serverStats.ensureServerStatsChannels(this, guild, existingConfig, botMember);
    }

    async collectGuildMemberStats(guild) {
        return await serverStats.collectGuildMemberStats(guild);
    }

    renderServerStatsChart(stats, guildName = 'Server Snapshot') {
        return serverStats.renderServerStatsChart(stats, guildName);
    }

    async updateServerStats(guild, existingConfig = null) {
        return await serverStats.updateServerStats(this, guild, existingConfig);
    }

    async disableServerStats(guild, existingConfig = null) {
        return await serverStats.disableServerStats(this, guild, existingConfig);
    }

    async handleMemberLogCommand(interaction) {
        return await memberLog.handleMemberLogCommand(this, interaction);
    }

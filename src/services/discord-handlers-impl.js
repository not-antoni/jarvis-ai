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
    parseEmoji
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
const interactionDispatch = require('./handlers/interaction-dispatch');
const interactionAutocomplete = require('./handlers/interaction-autocomplete');
const messageProcessing = require('./handlers/message-processing');
const mediaRendering = require('./handlers/media-rendering');

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
            if (!interaction.deferred && !interaction.replied) {await interaction.reply(payload);}
            else {await interaction.editReply(payload);}
            return { uploaded: true };
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
            const content = `Generated file (${kb} KB) is too large to upload and saving failed.`;
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

    async fetchNewsFromTheNewsApi(topic, limit = 5) {
        if (!NEWS_API_KEY) {return [];}

        const searchParam = encodeURIComponent(topic);
        
        // Only get news from last 7 days, sorted by recency
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

        // Filter out anything older than 30 days just in case
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

    async handleTicketCommand(interaction) {
        const { guild } = interaction;

        if (!guild) {
            await interaction.editReply('Ticket operations must be run inside a server, sir.');
            return;
        }

        if (!database.isConnected) {
            await interaction.editReply('Database uplink offline, sir. Ticketing is unavailable.');
            return;
        }

        const subcommand = interaction.options.getSubcommand();
        const me = guild.members.me || await guild.members.fetchMe().catch(() => null);

        if (!me || !me.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
            await interaction.editReply('I require the "Manage Channels" permission to manage tickets, sir.');
            return;
        }

        if (subcommand === 'open') {
            const reasonInput = interaction.options.getString('reason') || 'No reason provided.';
            const reason = reasonInput.length > 500 ? `${reasonInput.slice(0, 497)}…` : reasonInput;

            const existing = await database.getOpenTicket(guild.id, interaction.user.id);
            if (existing) {
                await interaction.editReply(`You already have an open ticket, sir: <#${existing.channelId}>.`);
                return;
            }

            const category = await this.ensureTicketCategory(guild);
            if (!category) {
                await interaction.editReply('I could not prepare the ticket workspace due to missing permissions, sir.');
                return;
            }

            const staffRoleIds = this.getTicketStaffRoleIds(guild);
            const ticketNumber = await database.reserveCounter(`ticket:${guild.id}`);
            const channelName = `ticket-${String(ticketNumber).padStart(4, '0')}`;

            const overwrites = [
                { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                {
                    id: interaction.user.id,
                    allow: [
                        PermissionsBitField.Flags.ViewChannel,
                        PermissionsBitField.Flags.SendMessages,
                        PermissionsBitField.Flags.ReadMessageHistory,
                        PermissionsBitField.Flags.AttachFiles
                    ]
                },
                {
                    id: me.id,
                    allow: [
                        PermissionsBitField.Flags.ViewChannel,
                        PermissionsBitField.Flags.SendMessages,
                        PermissionsBitField.Flags.ManageChannels,
                        PermissionsBitField.Flags.ReadMessageHistory,
                        PermissionsBitField.Flags.AttachFiles
                    ]
                }
            ];

            for (const roleId of staffRoleIds) {
                overwrites.push({
                    id: roleId,
                    allow: [
                        PermissionsBitField.Flags.ViewChannel,
                        PermissionsBitField.Flags.SendMessages,
                        PermissionsBitField.Flags.ReadMessageHistory,
                        PermissionsBitField.Flags.AttachFiles
                    ]
                });
            }

            let channel;
            try {
                channel = await guild.channels.create({
                    name: channelName,
                    type: ChannelType.GuildText,
                    parent: category.id,
                    reason: `Support ticket for ${interaction.user.tag}`,
                    permissionOverwrites: overwrites
                });
            } catch (error) {
                console.error('Failed to create ticket channel:', error);
                await interaction.editReply('Ticket bay doors jammed, sir. I could not create a private channel.');
                return;
            }

            try {
                const ticketRecord = await database.createTicket({
                    guildId: guild.id,
                    openerId: interaction.user.id,
                    channelId: channel.id,
                    ticketNumber,
                    reason,
                    staffRoleIds
                });

                const staffMentions = staffRoleIds.length
                    ? staffRoleIds.map((id) => `<@&${id}>`).join(' ')
                    : null;

                const headerLines = [
                    `Hello <@${interaction.user.id}>, I have opened ticket #${String(ticketRecord.ticketNumber).padStart(4, '0')} for you.`,
                    'Please describe the issue in detail so the staff can assist.'
                ];
                if (staffMentions) {
                    headerLines.push(`Staff notified: ${staffMentions}`);
                }

                await channel.send({
                    content: headerLines.join('\n'),
                    embeds: [
                        new EmbedBuilder()
                            .setTitle('Ticket opened')
                            .setDescription(reason)
                            .setColor(0x5865f2)
                            .setFooter({ text: 'Use /ticket close when finished.' })
                    ]
                });

                await interaction.editReply(`Ticket #${String(ticketRecord.ticketNumber).padStart(4, '0')} ready, sir: ${channel}.`);
            } catch (error) {
                console.error('Failed to persist ticket record:', error);
                try {
                    await channel.delete('Rolling back failed ticket creation');
                } catch (deleteError) {
                    console.warn('Failed to delete ticket channel during rollback:', deleteError);
                }
                await interaction.editReply('I could not store that ticket in the database, sir.');
            }

            return;
        }

        const { member } = interaction;
        const { channel } = interaction;
        let ticket = null;

        if (subcommand === 'close' || subcommand === 'export') {
            const ticketIdInput = interaction.options.getString('ticket_id');
            if (ticketIdInput) {
                try {
                    ticket = await database.getTicketById(ticketIdInput.trim());
                } catch (error) {
                    console.warn('Invalid ticket_id supplied for /ticket command:', error);
                    await interaction.editReply('That ticket identifier is not valid, sir.');
                    return;
                }
            }

            if (!ticket && subcommand === 'export') {
                const ticketNumber = interaction.options.getInteger('ticket_number');
                if (ticketNumber && Number.isInteger(ticketNumber) && ticketNumber > 0) {
                    ticket = await database.getTicketByNumber(guild.id, ticketNumber);
                }
            }

            if (!ticket && channel) {
                ticket = await database.getTicketByChannel(channel.id);
            }

            if (!ticket) {
                await interaction.editReply('I could not locate a ticket record for this request, sir.');
                return;
            }
        }

        const isStaffMember = () => {
            if (!member) {
                return false;
            }

            if (ticket && member.id === ticket.openerId) {
                return true;
            }

            if (member.permissions?.has(PermissionsBitField.Flags.ManageGuild) ||
                member.permissions?.has(PermissionsBitField.Flags.ManageChannels) ||
                member.permissions?.has(PermissionsBitField.Flags.Administrator)) {
                return true;
            }

            if (ticket?.staffRoleIds?.some((id) => member.roles?.cache?.has(id))) {
                return true;
            }

            return false;
        };

        if (subcommand === 'close') {
            if (!isStaffMember()) {
                await interaction.editReply('Only the opener or server staff may close this ticket, sir.');
                return;
            }

            if (ticket.status === 'closed') {
                await interaction.editReply('This ticket was already closed, sir.');
                return;
            }

            const transcriptMessages = channel ? await this.collectTicketTranscript(channel) : [];
            const summary = `Ticket #${String(ticket.ticketNumber).padStart(4, '0')} closed by ${interaction.user.tag}.`;

            try {
                await database.saveTicketTranscript(ticket._id, {
                    messages: transcriptMessages,
                    messageCount: transcriptMessages.length,
                    summary
                });
                await database.closeTicket(ticket._id, { closedBy: interaction.user.id });
            } catch (error) {
                console.error('Failed to archive ticket transcript:', error);
                await interaction.editReply('I could not archive this ticket, sir. Try again shortly.');
                return;
            }

            if (channel) {
                try {
                    if (ticket.openerId) {
                        await channel.permissionOverwrites.edit(ticket.openerId, { SendMessages: false }).catch(() => null);
                    }
                    await channel.permissionOverwrites.edit(interaction.user.id, { SendMessages: false }).catch(() => null);
                    await channel.send({
                        embeds: [
                            new EmbedBuilder()
                                .setTitle('Ticket closed')
                                .setDescription(`Closed by ${interaction.user.tag}. Transcript archived.`)
                                .setColor(0xffa200)
                                .setTimestamp(new Date())
                        ]
                    });
                } catch (error) {
                    console.warn('Failed to lock ticket channel:', error);
                }

                if (channel.deletable) {
                    const deleteDelayMs = 5000;
                    setTimeout(() => {
                        channel.delete('Ticket closed and archived.')
                            .catch((error) => console.warn('Failed to delete ticket channel after closing:', error));
                    }, deleteDelayMs);
                }
            }

            try {
                const opener = await interaction.client.users.fetch(ticket.openerId);
                if (opener) {
                    await opener.send([
                        `Your ticket #${String(ticket.ticketNumber).padStart(4, '0')} has been closed by ${interaction.user.tag}.`,
                        `Reason: ${ticket.reason || 'No reason provided.'}`,
                        `Messages captured: ${transcriptMessages.length}`
                    ].join('\n'));
                }
            } catch (error) {
                console.warn('Failed to DM ticket summary to opener:', error);
            }

            await interaction.editReply('Ticket closed and archived, sir.');
            return;
        }

        if (subcommand === 'export') {
            if (!isStaffMember()) {
                await interaction.editReply('Only staff members may export ticket transcripts, sir.');
                return;
            }

            let transcript = await database.getTicketTranscript(ticket._id);

            if (!transcript) {
                let ticketChannel = null;
                if (ticket.channelId) {
                    try {
                        ticketChannel = await guild.channels.fetch(ticket.channelId);
                    } catch (error) {
                        console.warn('Unable to fetch ticket channel for export:', error);
                    }
                }

                const messages = ticketChannel ? await this.collectTicketTranscript(ticketChannel) : [];
                transcript = {
                    messages,
                    messageCount: messages.length,
                    summary: `Transcript exported for ticket #${String(ticket.ticketNumber).padStart(4, '0')}`
                };

                try {
                    await database.saveTicketTranscript(ticket._id, transcript);
                } catch (error) {
                    console.warn('Failed to persist freshly generated transcript:', error);
                }
            }

            const header = [
                `Ticket: ${String(ticket.ticketNumber).padStart(4, '0')}`,
                `Opened by: ${ticket.openerId}`,
                `Reason: ${ticket.reason || 'No reason provided.'}`,
                `Status: ${ticket.status}`,
                `Messages archived: ${transcript?.messageCount || 0}`,
                '---'
            ];

            const lines = [...header];
            if (transcript?.messages?.length) {
                for (const message of transcript.messages) {
                    const attachments = (message.attachments || [])
                        .map((att) => ` [attachment: ${att.name} ${att.url}]`)
                        .join('');
                    lines.push(`[${message.createdAt}] ${message.authorTag}: ${message.content || ''}${attachments}`.trim());
                }
            } else {
                lines.push('No transcript data available.');
            }

            const buffer = Buffer.from(lines.join('\n'), 'utf8');
            const attachment = new AttachmentBuilder(buffer, {
                name: `ticket-${String(ticket.ticketNumber).padStart(4, '0')}.txt`
            });

            const replyContent = [`Transcript for ticket #${String(ticket.ticketNumber).padStart(4, '0')}, sir.`];
            if (!ticket.channelId) {
                replyContent.push('This ticket channel no longer exists; transcript retrieved from archives.');
            }

            await interaction.editReply({
                content: replyContent.join(' '),
                files: [attachment]
            });
            return;
        }

        await interaction.editReply('I am not certain how to handle that ticket request, sir.');
    }

    async handleKnowledgeBaseCommand(interaction) {
        const { guild } = interaction;

        if (!guild) {
            await interaction.editReply('Knowledge base controls only work inside a server, sir.');
            return;
        }

        if (!database.isConnected) {
            await interaction.editReply('Database uplink offline, sir. Knowledge base unavailable.');
            return;
        }

        if (!embeddingSystem.isAvailable) {
            await interaction.editReply('Embedding service unavailable, sir. Configure OPENAI or LOCAL_EMBEDDING_URL.');
            return;
        }

        const { member } = interaction;
        const hasAuthority = member?.permissions?.has(PermissionsBitField.Flags.ManageGuild) ||
            member?.permissions?.has(PermissionsBitField.Flags.Administrator);

        if (!hasAuthority) {
            await interaction.editReply('Only administrators may adjust the knowledge base, sir.');
            return;
        }

        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'add') {
            const title = interaction.options.getString('title', true);
            const textContent = interaction.options.getString('content');
            const attachment = interaction.options.getAttachment('file');

            const contentPieces = [];
            if (textContent && textContent.trim()) {
                contentPieces.push(textContent.trim());
            }

            if (attachment) {
                if (attachment.size && attachment.size > 5 * 1024 * 1024) {
                    await interaction.editReply('That file is larger than 5MB, sir. Please provide a smaller document.');
                    return;
                }

                try {
                    const response = await fetch(attachment.url);
                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}`);
                    }

                    const arrayBuffer = await response.arrayBuffer();
                    const buffer = Buffer.from(arrayBuffer);

                    let extracted = '';
                    const isPdf = (attachment.contentType && attachment.contentType.includes('pdf')) || attachment.name.endsWith('.pdf');

                    if (isPdf) {
                        const parsed = await pdfParse(buffer);
                        extracted = parsed.text || '';
                    } else {
                        extracted = buffer.toString('utf8');
                    }

                    if (extracted.trim()) {
                        contentPieces.push(extracted.trim());
                    }
                } catch (error) {
                    console.error('Failed to ingest knowledge base attachment:', error);
                    await interaction.editReply('I could not read that file, sir. Ensure it is a UTF-8 text, markdown, or PDF document.');
                    return;
                }
            }

            const combined = contentPieces.join('\n\n').trim();
            if (!combined) {
                await interaction.editReply('I need either the content field or an attachment to store, sir.');
                return;
            }

            try {
                const entry = await embeddingSystem.ingestGuildDocument({
                    guildId: guild.id,
                    userId: interaction.user.id,
                    title,
                    text: combined,
                    source: attachment ? 'upload' : 'manual'
                });

                await interaction.editReply(`Filed under ID \`${entry._id}\`, sir. Knowledge base updated.`);
            } catch (error) {
                console.error('Failed to store knowledge base entry:', error);
                await interaction.editReply('Knowledge base ingestion failed, sir.');
            }
            return;
        }

        if (subcommand === 'search') {
            const query = interaction.options.getString('query', true);
            const limit = interaction.options.getInteger('limit') || 5;

            try {
                const { message } = await embeddingSystem.formatSearchResults(guild.id, query, { limit });
                await interaction.editReply(message);
            } catch (error) {
                console.error('Knowledge search failed:', error);
                await interaction.editReply('The knowledge scanners malfunctioned, sir.');
            }
            return;
        }

        if (subcommand === 'list') {
            const limitOption = interaction.options.getInteger('limit') || 5;
            const limit = Math.max(1, Math.min(limitOption, 10));

            try {
                const entries = await database.getRecentKnowledgeEntries(guild.id, limit);
                if (!entries.length) {
                    await interaction.editReply('No entries in the knowledge base yet, sir.');
                    return;
                }

                const lines = entries.map((entry, index) => {
                    const timestamp = entry.createdAt
                        ? `<t:${Math.floor(new Date(entry.createdAt).getTime() / 1000)}:R>`
                        : 'unknown';
                    return `**${index + 1}. ${entry.title || 'Untitled'}**\n• ID: \`${entry._id}\`\n• Saved ${timestamp}`;
                });

                const embed = new EmbedBuilder()
                    .setTitle(`Latest ${entries.length} knowledge base entr${entries.length === 1 ? 'y' : 'ies'}`)
                    .setColor(0x60a5fa)
                    .setDescription(lines.join('\n\n'));

                await interaction.editReply({ embeds: [embed] });
            } catch (error) {
                console.error('Failed to list knowledge entries:', error);
                await interaction.editReply('Unable to list knowledge base entries at the moment, sir.');
            }
            return;
        }

        if (subcommand === 'delete') {
            const entryId = interaction.options.getString('entry_id', true);

            try {
                const removed = await database.deleteKnowledgeEntry(guild.id, entryId.trim());
                if (removed) {
                    await interaction.editReply('Entry removed from the knowledge archive, sir.');
                } else {
                    await interaction.editReply('I could not locate that entry, sir.');
                }
            } catch (error) {
                console.error('Failed to delete knowledge entry:', error);
                await interaction.editReply('Knowledge base deletion failed, sir.');
            }
            return;
        }

        await interaction.editReply('I am not certain how to handle that knowledge base request, sir.');
    }

    async handleAskCommand(interaction) {
        const { guild } = interaction;

        if (!guild) {
            await interaction.editReply('This command only works within a server, sir.');
            return;
        }

        if (!database.isConnected) {
            await interaction.editReply('Database uplink offline, sir. I cannot consult the archives.');
            return;
        }

        if (!embeddingSystem.isAvailable) {
            await interaction.editReply('OPENAI is not configured, sir. I cannot search the knowledge base.');
            return;
        }

        const query = interaction.options.getString('query', true);

        try {
            const { answer, sources } = await embeddingSystem.answerGuildQuestion({
                guildId: guild.id,
                userId: interaction.user.id,
                query
            });

            const lines = [answer];
            if (sources.length) {
                lines.push('\nSources:', ...sources.map((source) => `${source.label} (ID: ${source.id})`));
            }

            const safe = this.sanitizePings(lines.join('\n'));
            await interaction.editReply({ content: safe, allowedMentions: { parse: [] } });
        } catch (error) {
            console.error('Knowledge answer generation failed:', error);
            await interaction.editReply('My knowledge synthesis failed, sir. Please try again later.');
        }
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

                if (!articles.length && braveSearch.apiKey) {
                    articles = await braveSearch.fetchNews(normalizedTopic, { count: 5 });
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

    async handleMacroCommand(interaction) {
        const { guild } = interaction;

        if (!guild) {
            await interaction.editReply('Macros are only available within a server, sir.');
            return;
        }

        if (!database.isConnected) {
            await interaction.editReply('Knowledge archives offline, sir. Please try later.');
            return;
        }

        const subcommand = interaction.options.getSubcommand();
        const guildId = guild.id;

        if (subcommand === 'list') {
            const tagInput = interaction.options.getString('tag');
            const tag = tagInput ? tagInput.trim().toLowerCase() : null;
            let entries = [];

            try {
                if (tag) {
                    entries = await database.getKnowledgeEntriesByTag(guildId, tag, 10);
                } else {
                    entries = await database.getKnowledgeEntriesForGuild(guildId);
                }
            } catch (error) {
                console.error('Failed to list macros:', error);
                await interaction.editReply('Macro index unavailable, sir.');
                return;
            }

            if (!entries.length) {
                await interaction.editReply(tag ? `No macros found with tag "${tag}", sir.` : 'No macros recorded yet, sir. Add some via /kb add.');
                return;
            }

            const lines = entries.slice(0, 10).map((entry, index) => {
                const tags = Array.isArray(entry.tags) && entry.tags.length ? ` — tags: ${entry.tags.join(', ')}` : '';
                return `${index + 1}. **${entry.title || 'Untitled'}** (ID: ${entry._id})${tags}`;
            });

            const tagLabel = tag ? ` for tag "${tag}"` : '';
            await interaction.editReply([`Available macros${tagLabel}, sir:`, ...lines].join('\n'));
            return;
        }

        if (subcommand === 'send') {
            const entryIdInput = interaction.options.getString('entry_id');
            const tagInput = interaction.options.getString('tag');

            if (!entryIdInput && !tagInput) {
                await interaction.editReply('Please provide either an entry ID or a tag to resolve, sir.');
                return;
            }

            let entry = null;
            try {
                if (entryIdInput) {
                    entry = await database.getKnowledgeEntryById(guildId, entryIdInput.trim());
                } else if (tagInput) {
                    const candidates = await database.getKnowledgeEntriesByTag(guildId, tagInput.trim().toLowerCase(), 1);
                    entry = candidates[0] || null;
                }
            } catch (error) {
                console.error('Failed to resolve macro entry:', error);
            }

            if (!entry) {
                await interaction.editReply('I could not locate that macro entry, sir.');
                return;
            }

            const channelOption = interaction.options.getChannel('channel');
            const targetChannel = channelOption || interaction.channel;

            if (!targetChannel || !targetChannel.isTextBased?.()) {
                await interaction.editReply('Please choose a text channel for macro delivery, sir.');
                return;
            }

            const embed = new EmbedBuilder()
                .setTitle(entry.title || 'Knowledge Macro')
                .setDescription((entry.text || '').length ? entry.text.slice(0, 4000) : '(no content)')
                .setColor(0xF4A261)
                .setFooter({ text: `Macro ID: ${entry._id}` })
                .setTimestamp(entry.updatedAt || entry.createdAt || new Date());

            if (Array.isArray(entry.tags) && entry.tags.length) {
                embed.addFields({ name: 'Tags', value: entry.tags.join(', ').slice(0, 1024) });
            }

            try {
                await targetChannel.send({ embeds: [embed] });
                await interaction.editReply(targetChannel.id === interaction.channelId
                    ? 'Macro dispatched, sir.'
                    : `Macro dispatched to ${targetChannel}, sir.`);
            } catch (error) {
                console.error('Failed to send macro:', error);
                await interaction.editReply('I could not deliver that macro, sir.');
            }
            return;
        }

        await interaction.editReply('I do not recognize that macro request, sir.');
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
                await this.updateServerStats(guild, config);
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

    async resolveRoleFromInput(roleInput, guild) {
        if (!roleInput || !guild) {
            return null;
        }

        const trimmed = roleInput.trim();
        let roleId = null;

        const mentionMatch = trimmed.match(/^<@&(\d{5,})>$/);
        if (mentionMatch) {
            roleId = mentionMatch[1];
        }

        if (!roleId && /^\d{5,}$/.test(trimmed)) {
            roleId = trimmed;
        }

        let role = null;
        if (roleId) {
            role = guild.roles.cache.get(roleId) || null;
            if (!role) {
                try {
                    role = await guild.roles.fetch(roleId);
                } catch (error) {
                    role = null;
                }
            }
        }

        if (!role) {
            const normalized = trimmed.toLowerCase();
            role = guild.roles.cache.find(r => r.name.toLowerCase() === normalized) || null;
        }

        return role || null;
    }

    async parseReactionRolePairs(input, guild) {
        if (!input || typeof input !== 'string') {
            throw new Error('Please provide emoji and role pairs separated by commas, sir.');
        }

        const segments = input
            .split(/[\n,]+/)
            .map(segment => segment.trim())
            .filter(Boolean);

        if (segments.length === 0) {
            throw new Error('Please provide at least one emoji and role pair, sir.');
        }

        if (segments.length > 20) {
            throw new Error('Discord allows a maximum of 20 reactions per message, sir.');
        }

        const results = [];
        const seenKeys = new Set();
        const emojiPattern = /\p{Extended_Pictographic}/u;

        for (const segment of segments) {
            const separatorIndex = segment.search(/\s/);
            if (separatorIndex === -1) {
                throw new Error('Each pair must include an emoji and a role separated by a space, sir.');
            }

            const emojiInput = segment.substring(0, separatorIndex).trim();
            const roleInput = segment.substring(separatorIndex).trim();

            if (!emojiInput || !roleInput) {
                throw new Error('Each pair must include both an emoji and a role, sir.');
            }

            const parsedEmoji = parseEmoji(emojiInput);
            if (!parsedEmoji) {
                throw new Error(`I could not understand the emoji "${emojiInput}", sir.`);
            }

            if (!parsedEmoji.id && !emojiPattern.test(emojiInput)) {
                throw new Error(`"${emojiInput}" is not a usable emoji, sir. Please use a Unicode emoji or a custom server emoji.`);
            }

            const matchKey = parsedEmoji.id || parsedEmoji.name;
            if (!matchKey) {
                throw new Error(`I could not determine how to track the emoji "${emojiInput}", sir.`);
            }

            if (seenKeys.has(matchKey)) {
                throw new Error('Each emoji may only be used once per panel, sir.');
            }

            const role = await this.resolveRoleFromInput(roleInput, guild);
            if (!role) {
                throw new Error(`I could not find the role "${roleInput}", sir.`);
            }

            seenKeys.add(matchKey);

            const emojiDisplay = parsedEmoji.id
                ? `<${parsedEmoji.animated ? 'a' : ''}:${parsedEmoji.name}:${parsedEmoji.id}>`
                : emojiInput;

            results.push({
                matchKey,
                rawEmoji: emojiDisplay,
                display: emojiDisplay,
                roleId: role.id,
                roleName: role.name
            });
        }

        return results;
    }

    async resolveReactionRoleContext(reaction, user) {
        if (!database.isConnected || !reaction || !user || user.bot) {
            return null;
        }

        const messageId = reaction.message?.id || reaction.messageId;
        if (!messageId) {
            return null;
        }

        const record = await database.getReactionRole(messageId);
        if (!record) {
            return null;
        }

        if (reaction.message?.guildId && record.guildId && reaction.message.guildId !== record.guildId) {
            return null;
        }

        const key = this.getReactionEmojiKey(reaction.emoji);
        if (!key) {
            return null;
        }

        const option = (record.options || []).find(entry => entry.matchKey === key);
        if (!option) {
            return null;
        }

        const guildId = record.guildId || reaction.message?.guildId;
        if (!guildId) {
            return null;
        }

        const guild = reaction.message?.guild
            || reaction.client.guilds.cache.get(guildId)
            || await reaction.client.guilds.fetch(guildId).catch(() => null);
        if (!guild) {
            return null;
        }

        const member = await guild.members.fetch(user.id).catch(() => null);
        if (!member) {
            return null;
        }

        const role = guild.roles.cache.get(option.roleId) || await guild.roles.fetch(option.roleId).catch(() => null);
        if (!role) {
            return null;
        }

        const me = guild.members.me || await guild.members.fetchMe().catch(() => null);
        if (!me?.permissions?.has(PermissionsBitField.Flags.ManageRoles)) {
            return null;
        }

        if (me.roles.highest.comparePositionTo(role) <= 0) {
            return null;
        }

        return {
            record,
            option,
            guild,
            member,
            role,
            me
        };
    }

    getUserRoleColor(member) {
        try {
            if (!member || !member.roles) {
                return '#ff6b6b'; // Default red
            }

            // Get the highest role with a color (excluding @everyone)
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

    // Produce a display name that renders reliably on canvas
    getSafeDisplayName(member, author) {
        try {
            const rawName = (member && member.displayName) ? member.displayName : (author && author.username ? author.username : 'User');
            // Normalize to canonical form
            let name = rawName.normalize('NFKC');
            // Remove control and zero-width characters
            name = name.replace(/[\p{C}\p{Cf}]/gu, '');
            // Allow letters, numbers, spaces, and a small set of safe punctuation; drop the rest
            name = name.replace(/[^\p{L}\p{N}\p{M} _\-'.]/gu, '');
            // Collapse whitespace
            name = name.replace(/\s+/g, ' ').trim();
            // Fallback if empty after sanitization
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

    // Parse Discord custom emojis using Discord API
    // This function extracts custom emojis from message text and gets their proper URLs
    // Uses guild emoji cache for accurate emoji data, falls back to CDN URLs
    async parseCustomEmojis(text, guild = null) {
        const emojiRegex = /<a?:(\w+):(\d+)>/g;
        const emojis = [];
        let match;
        
        while ((match = emojiRegex.exec(text)) !== null) {
            const isAnimated = match[0].startsWith('<a:');
            const name = match[1];
            const id = match[2];
            
            // Always use Discord's CDN URL for emojis
            // Discord API format: https://cdn.discordapp.com/emojis/{emoji_id}.png
            // For animated emojis: https://cdn.discordapp.com/emojis/{emoji_id}.gif
            let emojiUrl = `https://cdn.discordapp.com/emojis/${id}.${isAnimated ? 'gif' : 'png'}`;
            let emojiObject = null;
            
            // Try to get emoji from guild for additional info
            if (guild) {
                try {
                    emojiObject = guild.emojis.cache.get(id);
                    if (emojiObject) {
                        // Use the emoji's URL if available, otherwise use CDN URL
                        emojiUrl = emojiObject.url || emojiUrl;
                    } else {
                        // Try to fetch emoji from Discord API if not in cache
                        // Discord API endpoint: GET /guilds/{guild_id}/emojis/{emoji_id}
                        try {
                            const fetchedEmoji = await guild.emojis.fetch(id);
                            if (fetchedEmoji) {
                                emojiObject = fetchedEmoji;
                                emojiUrl = fetchedEmoji.url || emojiUrl;
                            }
                        } catch (fetchError) {
                            // Handle Discord API errors gracefully
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

    // Parse Unicode emojis as well
    parseUnicodeEmojis(text) {
        // Enhanced Unicode emoji regex - covers more emoji ranges including newer ones
        const unicodeEmojiRegex = /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F900}-\u{1F9FF}]|[\u{1FA70}-\u{1FAFF}]|[\u{1F018}-\u{1F0FF}]|[\u{1F200}-\u{1F2FF}]|[\u{1F700}-\u{1F77F}]|[\u{1F780}-\u{1F7FF}]|[\u{1F800}-\u{1F8FF}]|[\u{1F000}-\u{1F02F}]|[\u{1F030}-\u{1F09F}]|[\u{1F0A0}-\u{1F0FF}]|[\u{1F100}-\u{1F1FF}]|[\u{1F200}-\u{1F2FF}]|[\u{1F300}-\u{1F5FF}]|[\u{1F600}-\u{1F64F}]|[\u{1F650}-\u{1F67F}]|[\u{1F680}-\u{1F6FF}]|[\u{1F700}-\u{1F77F}]|[\u{1F780}-\u{1F7FF}]|[\u{1F800}-\u{1F8FF}]|[\u{1F900}-\u{1F9FF}]|[\u{1FA00}-\u{1FA6F}]|[\u{1FA70}-\u{1FAFF}]|[\u{1FB00}-\u{1FBFF}]|[\u{1FC00}-\u{1FCFF}]|[\u{1FD00}-\u{1FDFF}]|[\u{1FE00}-\u{1FEFF}]|[\u{1FF00}-\u{1FFFF}]/gu;
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

    // Parse user mentions like <@123> or <@!123> and resolve to @DisplayName
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

    // Parse Discord markdown formatting
    parseDiscordFormatting(text) {
        const formatting = [];
        
        // Bold: **text**
        const boldRegex = /\*\*(.*?)\*\*/g;
        let match;
        while ((match = boldRegex.exec(text)) !== null) {
            formatting.push({
                type: 'bold',
                content: match[1],
                start: match.index,
                end: match.index + match[0].length,
                full: match[0]
            });
        }
        
        // Italic: *text* or _text_
        const italicRegex = /(?<!\*)\*(?!\*)([^*]+)\*(?!\*)|(?<!_)_(?!_)([^_]+)_(?!_)/g;
        while ((match = italicRegex.exec(text)) !== null) {
            formatting.push({
                type: 'italic',
                content: match[1] || match[2],
                start: match.index,
                end: match.index + match[0].length,
                full: match[0]
            });
        }
        
        // Strikethrough: ~~text~~
        const strikeRegex = /~~(.*?)~~/g;
        while ((match = strikeRegex.exec(text)) !== null) {
            formatting.push({
                type: 'strikethrough',
                content: match[1],
                start: match.index,
                end: match.index + match[0].length,
                full: match[0]
            });
        }
        
        // Underline: __text__
        const underlineRegex = /__(.*?)__/g;
        while ((match = underlineRegex.exec(text)) !== null) {
            formatting.push({
                type: 'underline',
                content: match[1],
                start: match.index,
                end: match.index + match[0].length,
                full: match[0]
            });
        }
        
        // Code: `text`
        const codeRegex = /`([^`]+)`/g;
        while ((match = codeRegex.exec(text)) !== null) {
            formatting.push({
                type: 'code',
                content: match[1],
                start: match.index,
                end: match.index + match[0].length,
                full: match[0]
            });
        }
        
        // Sort by start position
        formatting.sort((a, b) => a.start - b.start);
        
        return formatting;
    }

    // Format timestamp to actual readable time
    // Uses Discord.js Message.createdAt (Date object) for proper timezone handling
    formatTimestamp(timestamp, userTimezone = 'UTC') {
        try {
            // Handle both Date objects and timestamp numbers
            const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
            
            // Format as 12-hour time with AM/PM
            // Use system timezone to match Discord client behavior
            const options = {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true
                // No timeZone specified - uses system timezone (matches Discord client)
            };
            
            return date.toLocaleTimeString('en-US', options);
        } catch (error) {
            console.warn('Failed to format timestamp:', error);
            return '6:39 PM'; // Fallback
        }
    }

    // Get Discord's native timestamp format for user's local timezone
    // This matches exactly what Discord shows in the client
    getDiscordTimestamp(message) {
        try {
            // Convert to Unix timestamp (seconds, not milliseconds)
            const unixTimestamp = Math.floor(message.createdTimestamp / 1000);
            
            // Discord timestamp format: <t:timestamp:format>
            // 't' = short time (e.g., "2:30 PM")
            return `<t:${unixTimestamp}:t>`;
        } catch (error) {
            console.warn('Failed to get Discord timestamp:', error);
            return '6:39 PM'; // Fallback
        }
    }

    // Draw the verified badge SVG checkmark
    drawVerifiedBadge(ctx, x, y, size = 16) {
        try {
            // Save context state
            ctx.save();
            
            // Set white fill for the checkmark
            ctx.fillStyle = '#ffffff';
            
            // Create the checkmark path (simplified SVG path)
            ctx.beginPath();
            // Move to start of checkmark
            ctx.moveTo(x + size * 0.3, y + size * 0.5);
            // Line to middle point
            ctx.lineTo(x + size * 0.45, y + size * 0.65);
            // Line to end point
            ctx.lineTo(x + size * 0.7, y + size * 0.35);
            
            // Draw with rounded line caps for cleaner look
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

    // Parse Discord timestamp to get the actual formatted time
    // This extracts the time from Discord's timestamp format
    parseDiscordTimestamp(message) {
        try {
            // Get the Discord timestamp format
            const discordTimestamp = this.getDiscordTimestamp(message);
            
            // For Canvas rendering, we need the actual time string
            // Use the message's createdAt Date object with proper formatting
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

    // Truncate text if too long
    truncateText(text, maxLength) {
        if (text.length <= maxLength) {return text;}
        return `${text.substring(0, maxLength - 3)  }...`;
    }

    // Check if bot is verified using Discord API
    isBotVerified(user) {
        try {
            // Check if user has the VerifiedBot flag using public_flags
            // Discord API uses public_flags bitfield for verification status
            return user.publicFlags && user.publicFlags.has(UserFlags.VerifiedBot);
        } catch (error) {
            console.warn('Failed to check bot verification status:', error);
            return false;
        }
    }

    // Get the official Discord verification badge URL
    getVerificationBadgeUrl() {
        // Discord's official verification badge URL from their CDN
        // This is the actual badge icon used by Discord for verified bots
        return 'https://cdn.discordapp.com/badge-icons/6f1c2f904b1f5b7f3f2746965d3992f0.png';
    }

    // Extract image URLs from text including Tenor GIFs
    extractImageUrls(text) {
        // Standard image URLs
        const imageUrlRegex = /(https?:\/\/[^\s]+\.(?:jpg|jpeg|png|gif|webp|bmp|svg)(?:\?[^\s]*)?)/gi;
        const imageMatches = text.match(imageUrlRegex) || [];
        
        // Tenor GIF URLs - extract the actual GIF URL
        const tenorRegex = /(https?:\/\/tenor\.com\/[^\s]+)/gi;
        const tenorMatches = text.match(tenorRegex) || [];
        
        // Convert Tenor URLs to actual GIF URLs
        const tenorGifUrls = tenorMatches.map(tenorUrl => {
            try {
                // Extract GIF ID from different Tenor URL formats
                let gifId = null;
                
                // Format 1: https://tenor.com/view/gif-name-gifId
                const viewMatch = tenorUrl.match(/\/view\/[^-]+-(\d+)/);
                if (viewMatch) {
                    gifId = viewMatch[1];
                }
                
                // Format 2: https://tenor.com/view/gifId
                if (!gifId) {
                    const directMatch = tenorUrl.match(/\/view\/(\d+)/);
                    if (directMatch) {
                        gifId = directMatch[1];
                    }
                }
                
                // Format 3: https://tenor.com/view/gif-name-gifId-other
                if (!gifId) {
                    const complexMatch = tenorUrl.match(/-(\d+)(?:-|$)/);
                    if (complexMatch) {
                        gifId = complexMatch[1];
                    }
                }
                
                if (gifId) {
                    // Return the actual GIF URL from Tenor's CDN
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

    hasImagesOrEmojis(message) {
        // Allow all content now - images and emojis are supported
        return false;
    }

    async handleClipCommand(message, client) {
        return await mediaRendering.handleClipCommand(this, message, client);
    }

    // Find a message by ID across accessible channels in the same guild
    async findMessageAcrossChannels(interaction, messageId) {
        // Try current channel first
        try {
            if (interaction.channel && interaction.channel.messages) {
                const msg = await interaction.channel.messages.fetch(messageId);
                if (msg) {return msg;}
            }
        } catch (_) {}

        // If not in a guild, we cannot search other channels
        if (!interaction.guild) {return null;}

        // Iterate over text-based channels where the bot can view and read history
        const channels = interaction.guild.channels.cache;
        for (const [, channel] of channels) {
            try {
                // Skip non text-based channels
                if (!channel || typeof channel.isTextBased !== 'function' || !channel.isTextBased()) {continue;}

                // Permission checks to avoid errors/rate limits
                const perms = channel.permissionsFor(interaction.client.user.id);
                if (!perms) {continue;}
                if (!perms.has(PermissionsBitField.Flags.ViewChannel)) {continue;}
                if (!perms.has(PermissionsBitField.Flags.ReadMessageHistory)) {continue;}

                // Attempt to fetch by ID in this channel
                const msg = await channel.messages.fetch(messageId);
                if (msg) {return msg;}
            } catch (err) {
                // Ignore not found/permission/rate-limit errors and continue
                continue;
            }
        }

        return null;
    }

    // Load a static image for GIF sources by extracting the first frame with Sharp
    async loadStaticImage(url) {
        try {
            // Node 18 has global fetch
            const res = await fetch(url);
            if (!res.ok) {throw new Error(`HTTP ${res.status}`);}
            const buffer = await res.arrayBuffer();
            const input = Buffer.from(buffer);
            // Extract first frame to PNG buffer
            const pngBuffer = await sharp(input).ensureAlpha().extractFrame(0).png().toBuffer();
            return await loadImage(pngBuffer);
        } catch (error) {
            console.warn('Failed to load static GIF frame, falling back to direct load:', error);
            return await loadImage(url);
        }
    }

    // Resolve Tenor share pages to a static image URL via oEmbed (thumbnail)
    async resolveTenorStatic(url) {
        try {
            // 1) Try oEmbed (handles most Tenor URL forms)
            const oembedUrl = `https://tenor.com/oembed?url=${encodeURIComponent(url)}`;
            const res = await fetch(oembedUrl, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0' } });
            if (!res.ok) {throw new Error(`Tenor oEmbed HTTP ${res.status}`);}
            const data = await res.json();
            // oEmbed typically provides thumbnail_url
            if (data && data.thumbnail_url) {return data.thumbnail_url;}
            // Fallbacks some responses might include url
            if (data && data.url) {return data.url;}
        } catch (error) {
            console.warn('Failed to resolve Tenor static image via oEmbed:', error);
        }

        // 2) Fallback: fetch HTML and parse meta tags (works across Tenor share/short URLs)
        try {
            const pageRes = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0' } });
            if (!pageRes.ok) {throw new Error(`Tenor page HTTP ${pageRes.status}`);}
            const html = await pageRes.text();
            // Prefer og:image, fall back to twitter:image
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

        // Strip zero-width and control characters that can disturb layout
        sanitized = sanitized.replace(/[\u200B-\u200D\u2060\uFEFF]/g, '');

        // Remove Discord markdown markers while keeping inner text
        sanitized = sanitized.replace(/```[^\n]*\n([\s\S]*?)```/g, '$1');
        sanitized = sanitized.replace(/```/g, '');
        sanitized = sanitized.replace(/\*\*(.*?)\*\*/g, '$1');
        sanitized = sanitized.replace(/(?<!\*)\*(?!\*)([^*]+)\*(?!\*)/g, '$1');
        sanitized = sanitized.replace(/(?<!_)_(?!_)([^_]+)_(?!_)/g, '$1');
        sanitized = sanitized.replace(/~~(.*?)~~/g, '$1');
        sanitized = sanitized.replace(/__(.*?)__/g, '$1');
        sanitized = sanitized.replace(/`([^`]+)`/g, '$1');

        // Normalise repeated spaces and tabs without touching line breaks
        sanitized = sanitized.replace(/[^\S\r\n]+/g, ' ');
        sanitized = sanitized.replace(/\n[ \t]+/g, '\n');
        sanitized = sanitized.replace(/[ \t]+\n/g, '\n');

        return sanitized.trimEnd();
    }

    async createClipImage(text, username, avatarUrl, isBot = false, roleColor = '#ff6b6b', guild = null, client = null, message = null, user = null, attachments = null, embeds = null) {
    // Check bot verification status using Discord API
        const isVerified = user ? this.isBotVerified(user) : false;
    
        // Check for image attachments and embed previews (Discord link embeds like Tenor/Discord CDN)
        const hasImages = attachments && attachments.size > 0;
        const imageUrls = this.extractImageUrls(text);
        const embedImageUrls = (embeds || []).flatMap(e => {
            const urls = [];
            if (e && e.image && e.image.url) {urls.push(e.image.url);}
            if (e && e.thumbnail && e.thumbnail.url) {urls.push(e.thumbnail.url);}
            return urls;
        });
        // Also detect if the message ends with a direct .gif URL (with optional query params)
        let trailingGifUrl = null;
        try {
            const trailing = text.trim().match(/(https?:\/\/\S+?\.gif(?:\?\S*)?)$/i);
            if (trailing && trailing[1]) {trailingGifUrl = trailing[1];}
        } catch (_) {}
        const allImageUrls = [...imageUrls, ...embedImageUrls, ...(trailingGifUrl ? [trailingGifUrl] : [])];

        // Remove raw image/GIF links from text rendering (we draw them separately)
        let cleanedText = text;
        try {
            for (const url of allImageUrls) {
                const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                cleanedText = cleanedText.replace(new RegExp(escaped, 'g'), '').trim();
            }
            // Also remove Tenor share links that might not have been converted
            cleanedText = cleanedText.replace(/https?:\/\/tenor\.com\/\S+/gi, '').trim();
            // Collapse spaces and tabs without disturbing intentional newlines
            cleanedText = cleanedText.replace(/[^\S\r\n]+/g, ' ');
            cleanedText = cleanedText.replace(/\n[ \t]+/g, '\n');
            cleanedText = cleanedText.replace(/[ \t]+\n/g, '\n');
            cleanedText = cleanedText.trimEnd();
        } catch (_) {}

        const sanitizedText = this.sanitizeMessageText(cleanedText);

        // Parse custom emojis and formatting using Discord API
        const customEmojis = await this.parseCustomEmojis(sanitizedText, guild);
        const unicodeEmojis = this.parseUnicodeEmojis(sanitizedText);
        const allEmojis = [...customEmojis, ...unicodeEmojis].sort((a, b) => a.start - b.start);

        const mentions = await this.parseMentions(sanitizedText, guild, client);

        // Debug logging for emoji parsing
        if (allEmojis.length > 0) {
            console.log('Found emojis:', allEmojis.map(e => ({ name: e.name, url: e.url, isUnicode: e.isUnicode })));
        }

        // Calculate dynamic canvas dimensions based on content
        const width = 800; // Increased width for better layout and positioning
        const minHeight = 120; // Minimum height for basic content

        // Calculate text height with emojis and formatting
        const textHeight = this.calculateTextHeight(sanitizedText, width - 180, allEmojis, mentions); // Account for margins and avatar space

        // Measure required image height BEFORE creating main canvas to avoid clipping
        let actualImageHeight = 0;
        if (hasImages || allImageUrls.length > 0) {
            const tempCanvas = createCanvas(width, 1);
            const tempCtx = tempCanvas.getContext('2d');
            const imageEndY = await this.drawImages(tempCtx, attachments, allImageUrls, 0, 0, width - 180);
            actualImageHeight = imageEndY + 20; // padding
        }

        // Calculate total height including measured image height
        const totalHeight = Math.ceil(Math.max(minHeight, textHeight + actualImageHeight + 40));

        const canvas = createCanvas(width, totalHeight);
        const ctx = canvas.getContext('2d');

        // Maximize rendering quality to avoid jagged edges in the final clip
        ctx.patternQuality = 'best';
        ctx.quality = 'best';
        ctx.antialias = 'subpixel';
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.textDrawingMode = 'path';

        // Pure black background
        ctx.fillStyle = '#1a1a1e';
        ctx.fillRect(0, 0, width, totalHeight);

        // Calculate centered positioning with more space for avatar and text
        const avatarSize = 48;
        const contentWidth = width - 80; // More margin
        const contentHeight = totalHeight - 20;
        const avatarX = 50; // Moved further to the right
        const avatarY = 20; // Top-aligned padding instead of vertical centering

        const avatarBackgroundColor = '#1a1a1e';

        // Draw avatar (circular)
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
            }
        } else {
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
        }

        // Calculate text positioning - moved further right
        const textStartX = avatarX + avatarSize + 20; // Increased spacing
        const textStartY = avatarY + 3;
        const maxTextWidth = contentWidth - (avatarSize + 20) - 30; // More margin

        // Truncate username if too long to prevent timestamp overlap
        const truncatedUsername = this.truncateText(username, 20);

        // Draw username in role color
        ctx.fillStyle = roleColor;
        ctx.font = 'bold 16px Arial';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(truncatedUsername, textStartX, textStartY);

        let currentX = textStartX + ctx.measureText(truncatedUsername).width + 4;

        // Draw app tag if it's a bot
        if (isBot) {
            const appTagWidth = 38;
            const appTagHeight = 18;
            
            // Draw verification badge if verified (to the left of APP tag)
            if (isVerified) {
                const badgeSize = 18;
                const badgeX = currentX;
                this.drawVerifiedBadge(ctx, badgeX, textStartY, badgeSize);
                currentX += badgeSize + 4;
            }
            
            // App tag background (Discord blue color)
            ctx.fillStyle = 'rgb(88, 101, 242)'; // Discord APP badge color
            ctx.fillRect(currentX, textStartY, appTagWidth, appTagHeight);
            
            // App tag text
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 11px Arial';
            ctx.fillText('APP', currentX + 3, textStartY + 3);
            
            currentX += appTagWidth + 4;
        }

        // Draw timestamp with dynamic formatting
        const timestamp = message ? this.parseDiscordTimestamp(message) : '6:39 PM';
        ctx.font = '13px Arial';
        const timestampWidth = ctx.measureText(timestamp).width;
    
        // Ensure timestamp doesn't overlap with username/bot tag
        const availableWidth = width - currentX - 20;
        if (timestampWidth <= availableWidth) {
            ctx.fillStyle = '#72767d';
            ctx.fillText(timestamp, currentX, textStartY + 1);
        } else {
        // If not enough space, put timestamp on next line
            ctx.fillStyle = '#72767d';
            ctx.fillText(timestamp, textStartX, textStartY + 18);
        }

        // Draw message content with formatting support
        // Position the message content immediately below the username. The username
        // occupies approximately 16px of vertical space, so we add a 4px gap to
        // separate the text from the header. This keeps spacing consistent with the
        // small margin before image attachments rendered later.
        ctx.font = '15px Arial';
        const messageStartY = textStartY + 20;
        await this.drawFormattedText(ctx, sanitizedText, textStartX, messageStartY, maxTextWidth, allEmojis, mentions);

        // Draw images if present (main canvas has enough height already)
        if (hasImages || allImageUrls.length > 0) {
        // Compute the starting Y position for images. We subtract the base 40px
        // reserved in calculateTextHeight (for username/timestamp) from the
        // measured textHeight to get only the height of the rendered lines. Then
        // add a small 2px gap so images sit flush beneath the message text.
            const effectiveTextHeight = Math.max(0, textHeight - 44);
            const imageY = messageStartY + effectiveTextHeight + 2;
            await this.drawImages(ctx, attachments, allImageUrls, textStartX, imageY, maxTextWidth);
        }

        // Convert canvas to buffer
        const buffer = canvas.toBuffer('image/png');

        // Use sharp to optimize the image without cropping (prevent mid-image truncation)
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

    // Draw text with Discord formatting and emojis
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

    // Split text into segments with emojis and mentions
    splitTextWithEmojisAndMentions(text, allEmojis, mentions) {
        const segments = [];
        let lastIndex = 0;
        
        // Sort emojis by position
        const sortedEmojis = allEmojis.sort((a, b) => a.start - b.start);
        const sortedMentions = (mentions || []).sort((a, b) => a.start - b.start);

        // Merge streams by position
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
        
        // Add remaining text
        if (lastIndex < text.length) {
            const remainingText = text.substring(lastIndex);
            if (remainingText) {
                segments.push({ type: 'text', text: remainingText });
            }
        }
        
        return segments;
    }

    // Draw a single line with formatting applied
    drawFormattedLine(ctx, line, x, y, formatting) {
        // Remove formatting markers and apply styles
        let processedLine = line.trim();
        
        // Apply bold formatting
        processedLine = processedLine.replace(/\*\*(.*?)\*\*/g, '$1');
        
        // Apply italic formatting
        processedLine = processedLine.replace(/(?<!\*)\*(?!\*)([^*]+)\*(?!\*)/g, '$1');
        processedLine = processedLine.replace(/(?<!_)_(?!_)([^_]+)_(?!_)/g, '$1');
        
        // Apply strikethrough formatting
        processedLine = processedLine.replace(/~~(.*?)~~/g, '$1');
        
        // Apply underline formatting
        processedLine = processedLine.replace(/__(.*?)__/g, '$1');
        
        // Apply code formatting
        processedLine = processedLine.replace(/`([^`]+)`/g, '$1');
        
        // Draw the processed text
        ctx.fillStyle = '#ffffff';
        ctx.font = '15px Arial';
        ctx.fillText(processedLine, x, y);
    }

    // Draw images from attachments and URLs
    async drawImages(ctx, attachments, imageUrls, startX, startY, maxWidth) {
        let currentY = startY;
        const maxImageWidth = Math.min(maxWidth, 400);
        const maxImageHeight = 300; // Increased max height

        // Draw attachment images
        if (attachments && attachments.size > 0) {
            for (const attachment of attachments.values()) {
                if (attachment.contentType && attachment.contentType.startsWith('image/')) {
                    try {
                        const isGif = attachment.contentType.includes('gif') || /\.gif(\?|$)/i.test(attachment.url);
                        const img = isGif ? await this.loadStaticImage(attachment.url) : await loadImage(attachment.url);
                        const aspectRatio = img.width / img.height;
                        
                        // Calculate dimensions maintaining aspect ratio
                        let drawWidth = maxImageWidth;
                        let drawHeight = drawWidth / aspectRatio;
                        
                        // If height exceeds max, scale down
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

        // Draw URL images (including Tenor GIFs)
        for (const imageUrl of imageUrls) {
            try {
                let sourceUrl = imageUrl;
                // Always try to resolve Tenor links to a static image (covers all Tenor URL forms)
                if (/tenor\.com\//i.test(sourceUrl)) {
                    const staticUrl = await this.resolveTenorStatic(sourceUrl);
                    if (staticUrl) {sourceUrl = staticUrl;}
                }
                // Handle Discord CDN GIFs and any URL ending in .gif (with params)
                const isGifUrl = /\.gif(\?|$)/i.test(sourceUrl) || /media\.discordapp\.net\//i.test(sourceUrl);
                const img = isGifUrl ? await this.loadStaticImage(sourceUrl) : await loadImage(sourceUrl);
                const aspectRatio = img.width / img.height;
                
                // Calculate dimensions maintaining aspect ratio
                let drawWidth = maxImageWidth;
                let drawHeight = drawWidth / aspectRatio;
                
                // If height exceeds max, scale down
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

    async enforceImmediateBraveGuard(message) {
        if (!message || typeof message.content !== 'string' || !message.content.length) {
            return false;
        }

        if (typeof braveSearch.extractSearchInvocation !== 'function' || typeof braveSearch.isExplicitQuery !== 'function') {
            return false;
        }

        const rawContent = message.content;

        try {
            const invocation = braveSearch.extractSearchInvocation(rawContent);

            if (!invocation || invocation.triggered !== true) {
                return false;
            }

            const segments = [];

            if (typeof invocation.query === 'string' && invocation.query.length > 0) {
                segments.push({ text: invocation.query, raw: typeof invocation.rawQuery === 'string' && invocation.rawQuery.length > 0 ? invocation.rawQuery : invocation.query });
            }

            if (typeof invocation.rawQuery === 'string' && invocation.rawQuery.length > 0) {
                segments.push({ text: invocation.rawQuery, raw: invocation.rawQuery });
            }

            if (typeof invocation.invocation === 'string' && invocation.invocation.length > 0) {
                segments.push({ text: invocation.invocation, raw: invocation.invocation });
            }

            segments.push({ text: rawContent, raw: rawContent });

            const isExplicit = invocation.explicit === true || segments.some(({ text, raw }) => {
                try {
                    return braveSearch.isExplicitQuery(text, { rawSegment: raw });
                } catch (error) {
                    console.error('Failed explicit check during Brave guard:', error);
                    return false;
                }
            });

            if (!isExplicit) {
                return false;
            }

            const blockMessage = braveSearch.getExplicitQueryMessage
                ? braveSearch.getExplicitQueryMessage()
                : 'I must decline that request, sir. My safety filters forbid it.';

            try {
                await message.reply({ content: blockMessage, allowedMentions: { parse: [] } });
            } catch (error) {
                console.error('Failed to send Brave explicit guard reply:', error);
            }

            return true;
        } catch (error) {
            console.error('Failed to run Brave pre-flight guard:', error);
            return false;
        }
    }

    async handleMessage(message, client) {
        return await messageProcessing.handleMessage(this, message, client);
    }

    async handleVoiceStateUpdate() {
        
    }

    async handleJarvisInteraction(message, client) {
        // Early bail if bot lacks SendMessages in this channel (avoids 50013 cascades)
        if (!this.canSendInChannel(message.channel)) {return;}

        const isMentioned = message.mentions.has(client.user);
        const isDM = message.channel.type === ChannelType.DM;
        const lowerContent = message.content.toLowerCase();
        let containsJarvis = false;

        // Check custom guild/user wake words first — guild custom wake word replaces defaults
        let guildHasCustomWord = false;
        try {
            const userFeatures = require('./user-features');
            if (message.guild) {
                const guildWord = await userFeatures.getGuildWakeWord(message.guild.id);
                if (guildWord) {
                    guildHasCustomWord = true;
                    containsJarvis = await userFeatures.matchesGuildWakeWord(message.guild.id, lowerContent);
                }
            }
            if (!containsJarvis) {
                const userMatch = await userFeatures.matchesWakeWord(message.author.id, lowerContent);
                if (userMatch) {containsJarvis = true;}
            }
        } catch (_e) {
            // User features not available
        }

        // Only use default wake words if guild has no custom one
        if (!containsJarvis && !guildHasCustomWord) {
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
                // Ignore 10008 (Unknown Message) - message was deleted
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

        const defaultBraveInvocation = { triggered: false, query: null, rawQuery: null, invocation: null, explicit: false };
        let rawBraveInvocation = defaultBraveInvocation;

        if (rawContent && typeof braveSearch.extractSearchInvocation === 'function') {
            try {
                const extracted = braveSearch.extractSearchInvocation(rawContent);
                if (extracted && typeof extracted === 'object') {
                    rawBraveInvocation = {
                        ...defaultBraveInvocation,
                        ...extracted
                    };
                }
            } catch (error) {
                console.error('Failed to parse raw Brave invocation:', error);
                rawBraveInvocation = defaultBraveInvocation;
            }
        }

        if (rawBraveInvocation.triggered && rawBraveInvocation.explicit) {
            try {
                await message.reply({
                    content: braveSearch.getExplicitQueryMessage
                        ? braveSearch.getExplicitQueryMessage()
                        : 'I must decline that request, sir. My safety filters forbid it.'
                    ,
                    allowedMentions: { parse: [] }
                });
            } catch (error) {
                console.error('Failed to reply to explicit Brave request:', error);
            }
            this.setCooldown(message.author.id, messageScope);
            return;
        }

        // 🧠 Preserve mention context: replace mentions with display names (nicknames) instead of stripping them.
        // Only remove Jarvis' own mention and @everyone/@here.
        let cleanContent = typeof message.content === 'string' ? message.content : '';

        // Replace user mentions using guild member display names when available.
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

            // Replace role/channel mentions too (helps AI keep context).
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

        // Remove Jarvis mention so prompts don't get cluttered
        try {
            if (client?.user?.id) {
                cleanContent = cleanContent.replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '').trim();
            }
        } catch (_) {}

        // Remove broadcast pings
        cleanContent = cleanContent
            .replace(/@everyone/g, '')
            .replace(/@here/g, '')
            .trim();

        // Check for clip command first (overrides AI response)
        if (await this.handleClipCommand(message, client)) {
            this.setCooldown(message.author.id, messageScope);
            return; // Exit early, no AI response
        }

        const ytCommandPattern = /^jarvis\s+yt\s+(.+)$/i;
        const mathTriggerPattern = /\bjarvis\s+math\b/i;
        // Require "search" with context - either "jarvis search" or just "search" when Jarvis was mentioned/invoked
        // But avoid triggering on casual uses like "I was searching for my keys"
        const searchTriggerPattern = /\b(?:jarvis\s+)?search\s+(?:for\s+)?(?:the\s+)?(?:web\s+)?(.+)/i;
        const hasMathTrigger = mathTriggerPattern.test(cleanContent);
        const ytMatch = cleanContent.match(ytCommandPattern);
        const hasSearchTrigger = searchTriggerPattern.test(cleanContent);
        let braveInvocation = defaultBraveInvocation;

        if (typeof braveSearch.extractSearchInvocation === 'function') {
            try {
                const extracted = braveSearch.extractSearchInvocation(cleanContent);
                if (extracted && typeof extracted === 'object') {
                    braveInvocation = {
                        ...defaultBraveInvocation,
                        ...extracted
                    };
                }
            } catch (error) {
                console.error('Failed to parse cleaned Brave invocation:', error);
                braveInvocation = defaultBraveInvocation;
            }
        }

        // If the user said "search [query]" but didn't use the explicit "jarvis search" phrase,
        // synthesize a Brave invocation so the search pipeline still works.
        // The new pattern captures the query after "search" to avoid false positives.
        if (hasSearchTrigger && !braveInvocation.triggered && !rawBraveInvocation.triggered) {
            const searchMatch = cleanContent.match(searchTriggerPattern);
            const extractedQuery = searchMatch?.[1]?.trim() || '';
            
            // Only trigger if we actually have a query (avoids "I was searching" false positives)
            if (extractedQuery.length > 2) {
                braveInvocation = {
                    ...defaultBraveInvocation,
                    triggered: true,
                    query: extractedQuery,
                    rawQuery: extractedQuery,
                    invocation: cleanContent,
                    explicit: false
                };
            }
        }

        if (hasMathTrigger) {
            await message.reply('Mathematics routines are now available via `/math`, sir.');
            this.setCooldown(message.author.id, messageScope);
            return;
        }

        if (ytMatch) {
            await message.reply('For video reconnaissance, deploy `/yt` instead, sir.');
            this.setCooldown(message.author.id, messageScope);
            return;
        }

        if (braveInvocation.triggered || rawBraveInvocation.triggered) {

            // Web search support via keyword trigger ("jarvis search ...")
            // Uses existing Brave integration for stability.
            const activeInvocation = braveInvocation.triggered ? braveInvocation : rawBraveInvocation;
            const querySource = activeInvocation?.query || '';
            const invocationContext = activeInvocation?.invocation || null;
            const rawSegmentCandidate = activeInvocation?.rawQuery || activeInvocation?.invocation || rawContent;
            const explicitDetected = Boolean(activeInvocation?.explicit);

            if (explicitDetected) {
                await message.reply({
                    content: braveSearch.getExplicitQueryMessage
                        ? braveSearch.getExplicitQueryMessage()
                        : 'I must decline that request, sir. My safety filters forbid it.'
                    ,
                    allowedMentions: { parse: [] }
                });
                this.setCooldown(message.author.id, messageScope);
                return;
            }

            const preparedQuery = typeof braveSearch.prepareQueryForApi === 'function'
                ? braveSearch.prepareQueryForApi(querySource)
                : (querySource || '').trim();

            if (preparedQuery) {
                try {
                    const rawSegmentForCheck = (typeof rawSegmentCandidate === 'string' && rawSegmentCandidate.length > 0)
                        ? rawSegmentCandidate
                        : ((typeof invocationContext === 'string' && invocationContext.length > 0)
                            ? invocationContext
                            : preparedQuery);

                    if (braveSearch.isExplicitQuery && (
                        braveSearch.isExplicitQuery(preparedQuery, { rawSegment: rawSegmentForCheck }) ||
                        (rawSegmentForCheck && braveSearch.isExplicitQuery(rawSegmentForCheck, { rawSegment: rawSegmentForCheck }))
                    )) {
                        await message.reply({
                            content: braveSearch.getExplicitQueryMessage
                                ? braveSearch.getExplicitQueryMessage()
                                : 'I must decline that request, sir. My safety filters forbid it.'
                            ,
                            allowedMentions: { parse: [] }
                        });
                        this.setCooldown(message.author.id, messageScope);
                        return;
                    }

                    await message.channel.sendTyping();
                    const response = await this.jarvis.handleBraveSearch({
                        raw: rawSegmentForCheck,
                        prepared: preparedQuery,
                        invocation: invocationContext,
                        content: cleanContent,
                        rawMessage: rawContent,
                        rawInvocation: rawBraveInvocation.invocation,
                        explicit: explicitDetected
                    });
                    const safe = this.sanitizePings(typeof response === 'string' ? response : String(response || ''));
                    await message.reply({ content: safe, allowedMentions: { parse: [] } });
                    this.setCooldown(message.author.id, messageScope);
                    return;
                } catch (error) {
                    console.error('Brave search error:', error);
                    await message.reply({ content: 'Web search failed, sir. Technical difficulties.', allowedMentions: { parse: [] } });
                    this.setCooldown(message.author.id, messageScope);
                    return;
                }
            } else {
                await message.reply({ content: "Please provide a web search query after 'jarvis search', sir.", allowedMentions: { parse: [] } });
                this.setCooldown(message.author.id, messageScope);
                return;
            }
        }

        if (!cleanContent) {
            cleanContent = 'jarvis';
        } else {
            const wakeWordPattern = new RegExp(`^(${config.wakeWords.join('|')})[,.!?]*$`, 'i');
            if (wakeWordPattern.test(cleanContent)) {
                cleanContent = 'jarvis';
            }
        }

        // Parse Discord mentions to show display names instead of raw IDs
        // Handles user mentions <@123> and <@!123>, role mentions <@&123>, channel mentions <#123>
        if (message.mentions) {
            // Prefer guild member display names (nicknames), fall back to globalName/username
            const memberMap = message.mentions.members;
            if (memberMap && memberMap.size > 0) {
                for (const [userId, member] of memberMap) {
                    const displayName = member?.displayName || member?.user?.globalName || member?.user?.username || 'user';
                    cleanContent = cleanContent.replace(new RegExp(`<@!?${userId}>`, 'g'), `${displayName}`);
                }
            } else {
                for (const [userId, user] of message.mentions.users) {
                    const displayName = user?.globalName || user?.username || 'user';
                    cleanContent = cleanContent.replace(new RegExp(`<@!?${userId}>`, 'g'), `${displayName}`);
                }
            }
            // Replace role mentions with @rolename
            for (const [roleId, role] of message.mentions.roles) {
                cleanContent = cleanContent.replace(new RegExp(`<@&${roleId}>`, 'g'), `@${role.name}`);
            }
            // Replace channel mentions with #channelname
            for (const [channelId, channel] of message.mentions.channels) {
                cleanContent = cleanContent.replace(new RegExp(`<#${channelId}>`, 'g'), `#${channel.name}`);
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

            // Extract image attachments for vision processing
            let imageAttachments = message.attachments
                ? Array.from(message.attachments.values())
                    .filter(att => {
                        const contentType = att.contentType || '';
                        const ext = (att.name || '').split('.').pop()?.toLowerCase();
                        const imageExts = ['jpg', 'jpeg', 'png', 'webp', 'gif'];
                        return contentType.startsWith('image/') || imageExts.includes(ext);
                    })
                    .map(att => ({ url: att.url, contentType: att.contentType }))
                : [];

            // Also check for images AND text in replied message
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
                    
                    // Extract text from replied message for context (limit to leave room for user's message)
                    const repliedText = (repliedMessage?.cleanContent || repliedMessage?.content || '').trim();
                    if (repliedText) {
                        // Reserve space for user's message, cap replied context
                        const maxReplyContext = Math.min(300, Math.max(100, config.ai.maxInputLength - cleanContent.length - 50));
                        const trimmedReply = repliedText.substring(0, maxReplyContext);
                        repliedContext = `[Replied to ${repliedDisplayName}: "${trimmedReply}${repliedText.length > maxReplyContext ? '...' : ''}"]\n`;
                    }
                    
                    // Extract images from replied message (only if current message has no images)
                    if (imageAttachments.length === 0) {
                        if (repliedMessage?.attachments?.size > 0) {
                            const repliedImages = Array.from(repliedMessage.attachments.values())
                                .filter(att => {
                                    const contentType = att.contentType || '';
                                    const ext = (att.name || '').split('.').pop()?.toLowerCase();
                                    const imageExts = ['jpg', 'jpeg', 'png', 'webp', 'gif'];
                                    return contentType.startsWith('image/') || imageExts.includes(ext);
                                })
                                .map(att => ({ url: att.url, contentType: att.contentType, fromReply: true }));
                            imageAttachments = [...imageAttachments, ...repliedImages];
                        }
                        // Also check embeds for images (e.g., Discord CDN previews, Tenor GIFs)
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

            // If still no images, check the previous message in the channel (for GIFs/images sent right before the ping)
            if (imageAttachments.length === 0 && message.channel) {
                try {
                    const previousMessages = await message.channel.messages.fetch({ limit: 2, before: message.id });
                    const prevMsg = previousMessages.first();
                    if (prevMsg && prevMsg.author?.id === message.author?.id) {
                        // Only check if same author sent the previous message (within last few seconds context)
                        const timeDiff = message.createdTimestamp - prevMsg.createdTimestamp;
                        if (timeDiff < 30000) { // Within 30 seconds
                            if (prevMsg.attachments?.size > 0) {
                                const prevImages = Array.from(prevMsg.attachments.values())
                                    .filter(att => {
                                        const contentType = att.contentType || '';
                                        const ext = (att.name || '').split('.').pop()?.toLowerCase();
                                        const imageExts = ['jpg', 'jpeg', 'png', 'webp', 'gif'];
                                        return contentType.startsWith('image/') || imageExts.includes(ext);
                                    })
                                    .map(att => ({ url: att.url, contentType: att.contentType, fromPrevious: true }));
                                imageAttachments = [...imageAttachments, ...prevImages];
                                if (prevImages.length > 0) {
                                    console.log(`[Vision] Found ${prevImages.length} image(s) in previous message`);
                                }
                            }
                            // Also check embeds in previous message
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

            // Combine replied context with user's message, respecting max length
            let fullContent = repliedContext ? repliedContext + cleanContent : cleanContent;
            if (fullContent.length > config.ai.maxInputLength) {
                // Prioritize user's message, trim replied context if needed
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

            const response = await this.jarvis.generateResponse(message, fullContent, false, contextualMemory, imageAttachments);

            // Parse optional emoji reaction tag from AI response
            let reactEmoji = null;
            let cleanResponse = response;
            if (typeof response === 'string') {
                const reactMatch = response.match(/\[REACT:(.+?)\]\s*$/);
                if (reactMatch) {
                    reactEmoji = reactMatch[1].trim();
                    cleanResponse = response.replace(/\s*\[REACT:.+?\]\s*$/, '').trim();
                }
            }

            if (typeof cleanResponse === 'string' && cleanResponse.trim()) {
                const safe = this.sanitizePings(cleanResponse);
                const chunks = splitMessage(safe);
                for (let i = 0; i < chunks.length; i++) {
                    if (i === 0) {
                        await message.reply({ content: chunks[i], allowedMentions: { parse: [] } });
                    } else {
                        await message.channel.send({ content: chunks[i], allowedMentions: { parse: [] } });
                    }
                }
            } else {
                await message.reply({ content: 'Response circuits tangled, sir. Clarify your request?', allowedMentions: { parse: [] } });
            }

            // Apply emoji reaction if the AI suggested one
            if (reactEmoji) {
                try {
                    await message.react(reactEmoji);
                } catch (_) {
                    // Custom emoji format: <:name:id> or <a:name:id> — extract the ID
                    const customMatch = reactEmoji.match(/<a?:\w+:(\d+)>/);
                    if (customMatch) {
                        try { await message.react(customMatch[1]); } catch (_e) { /* emoji unavailable */ }
                    }
                }
            }
        } catch (error) {
            // Generate unique error code for debugging
            const errorId = `J-${Date.now().toString(36).slice(-4).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
            console.error(`[${errorId}] Error processing message:`, error);
            // Don't attempt a reply if the original error was a permission issue
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

                const stats = await this.collectGuildMemberStats(guild);
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
                    `Current totals — Members: ${this.formatServerStatsValue(stats.total)}, Users: ${this.formatServerStatsValue(stats.userCount)}, Bots: ${this.formatServerStatsValue(stats.botCount)}, Channels: ${this.formatServerStatsValue(stats.channelCount)}, Roles: ${this.formatServerStatsValue(stats.roleCount)}`
                ];

                await interaction.editReply(`Server statistics are active, sir.\n${lines.join('\n')}`);
                return;
            }

            if (subcommand === 'enable') {
                const existing = await database.getServerStatsConfig(guild.id);
                await this.updateServerStats(guild, existing);
                await interaction.editReply('Server statistics channels are ready, sir. I will refresh them every 10 minutes.');
                return;
            }

            if (subcommand === 'refresh') {
                const existing = await database.getServerStatsConfig(guild.id);
                if (!existing) {
                    await interaction.editReply('Server statistics are not configured yet, sir.');
                    return;
                }

                await this.updateServerStats(guild, existing);
                await interaction.editReply('Server statistics channels refreshed, sir.');
                return;
            }

            if (subcommand === 'report') {
                const publish = interaction.options.getBoolean('public') || false;
                const stats = await this.collectGuildMemberStats(guild);

                const summaryLines = [
                    `**${guild.name || 'Server'} Snapshot**`,
                    `• Members: ${this.formatServerStatsValue(stats.total)}`,
                    `• Humans: ${this.formatServerStatsValue(stats.userCount)}`,
                    `• Bots: ${this.formatServerStatsValue(stats.botCount)}`,
                    `• Channels: ${this.formatServerStatsValue(stats.channelCount)}`,
                    `• Roles: ${this.formatServerStatsValue(stats.roleCount)}`
                ];

                // Add activity insights if available
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
                    chartBuffer = this.renderServerStatsChart(stats, guild.name || 'Server Snapshot');
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

                await this.disableServerStats(guild, existing);
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

    async handleAutoModCommand(interaction) {
        return await automodSlash.handleAutoModCommand(this, interaction);
    }

    // ============ REACTION ROLE HANDLERS ============

    async handleReactionRoleCommand(interaction) {
        return await reactionRoleHandler.handleReactionRoleCommand(this, interaction);
    }

    async handleReactionAdd(reaction, user) {
        return await reactionRoleHandler.handleReactionAdd(this, reaction, user);
    }

    async handleReactionRemove(reaction, user) {
        return await reactionRoleHandler.handleReactionRemove(this, reaction, user);
    }

    async handleTrackedMessageDelete(message) {
        return await reactionRoleHandler.handleTrackedMessageDelete(this, message);
    }

    // ============ MONITOR HANDLER ============

    async handleMonitorCommand(interaction) {
        return await monitorHandler.handleMonitorCommand(interaction);
    }

    // ============ MEDIA HANDLERS ============

    async handleSlashCommandClip(interaction) {
        return await mediaHandlers.handleSlashCommandClip(this, interaction);
    }

    async fetchAttachmentBuffer(attachment) {
        return await mediaHandlers.fetchAttachmentBuffer(this, attachment);
    }

    async fetchImageFromUrl(rawUrl, opts) {
        return await mediaHandlers.fetchImageFromUrl(this, rawUrl, opts);
    }

    async handleCaptionCommand(interaction) {
        return await mediaHandlers.handleCaptionCommand(this, interaction);
    }

    async handleMemeCommand(interaction) {
        return await mediaHandlers.handleMemeCommand(this, interaction);
    }

    // ============ GAME / FUN HANDLERS ============

    async handleCryptoCommand(interaction) {
        return await gameHandlers.handleCryptoCommand(this, interaction);
    }

    async handleSixSevenCommand(interaction) {
        return await gameHandlers.handleSixSevenCommand(this, interaction);
    }

    async handleJokeCommand(interaction) {
        return await gameHandlers.handleJokeCommand(this, interaction);
    }

    async handleFeaturesCommand(interaction) {
        return await gameHandlers.handleFeaturesCommand(this, interaction);
    }

    async handleOptCommand(interaction) {
        return await gameHandlers.handleOptCommand(this, interaction);
    }

    async handleComponentInteraction(interaction) {
        return await gameHandlers.handleComponentInteraction(this, interaction);
    }

    async handleEightBallCommand(interaction) {
        return await gameHandlers.handleEightBallCommand(this, interaction);
    }

    async handleVibeCheckCommand(interaction) {
        return await gameHandlers.handleVibeCheckCommand(this, interaction);
    }

    async handleBonkCommand(interaction) {
        return await gameHandlers.handleBonkCommand(this, interaction);
    }

    async handleTemplateCommand(interaction, templates, title, defaultLine, color, optionName) {
        return await gameHandlers.handleTemplateCommand(this, interaction, templates, title, defaultLine, color, optionName);
    }

    async handleRoastCommand(interaction) {
        return await gameHandlers.handleRoastCommand(this, interaction);
    }

    async handleFlatterCommand(interaction) {
        return await gameHandlers.handleFlatterCommand(this, interaction);
    }

    async handleToastCommand(interaction) {
        return await gameHandlers.handleToastCommand(this, interaction);
    }

    async handleTriviaCommand(interaction) {
        return await gameHandlers.handleTriviaCommand(this, interaction);
    }

    caesarShift(text, shift) {
        return gameHandlers.caesarShift(text, shift);
    }

    async handleCipherCommand(interaction) {
        return await gameHandlers.handleCipherCommand(this, interaction);
    }

    scrambleWord(word) {
        return gameHandlers.scrambleWord(word);
    }

    async handleScrambleCommand(interaction) {
        return await gameHandlers.handleScrambleCommand(this, interaction);
    }

    async handleMissionCommand(interaction) {
        return await gameHandlers.handleMissionCommand(this, interaction);
    }

    // ============ MEMORY / PERSONA HANDLERS ============

    async handleMemoryCommand(interaction) {
        return await memoryHandler.handleMemoryCommand(this, interaction);
    }

    async handlePersonaCommand(interaction) {
        return await memoryHandler.handlePersonaCommand(this, interaction);
    }

    async handleAutocomplete(interaction) {
        return await interactionAutocomplete.handle(this, interaction);
    }

    async handleSlashCommand(interaction) {
        return await interactionDispatch.handle(this, interaction);
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

        try {
            // Server scope — requires admin/manage guild
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

                if (clear) {
                    await userFeatures.removeGuildWakeWord(guildId);
                    // Flush handler-level cache so the change takes effect immediately
                    this.guildConfigCache.delete(guildId);
                    const guildConfigDiskCache = require('./guild-config-cache');
                    guildConfigDiskCache.invalidate(guildId);
                    await interaction.editReply('Server wake word removed. I\'ll respond to the default triggers ("jarvis" / "garmin") and personal wake words now.');
                    return;
                }

                if (!word) {
                    const currentGuildWord = await userFeatures.getGuildWakeWord(guildId);
                    if (currentGuildWord) {
                        await interaction.editReply(`🏠 **Server Wake Word:** "${currentGuildWord}"\n\nAnyone in this server can say "${currentGuildWord}" to summon me.\nUse \`/wakeword word:newword scope:Server\` to change, or \`/wakeword scope:Server clear:True\` to remove.`);
                    } else {
                        await interaction.editReply('No server wake word set.\n\nUse `/wakeword word:yourword scope:Server` to set one for the whole server.');
                    }
                    return;
                }

                const result = await userFeatures.setGuildWakeWord(guildId, word);
                if (!result.success) {
                    await interaction.editReply(result.error);
                    return;
                }

                // Flush handler-level cache so the change takes effect immediately
                this.guildConfigCache.delete(guildId);
                const guildConfigDiskCache = require('./guild-config-cache');
                guildConfigDiskCache.invalidate(guildId);

                await interaction.editReply(`Server wake word set to **"${result.wakeWord}"**\n\nAnyone in this server can now summon me by saying "${result.wakeWord}". Default triggers ("jarvis" / "garmin") are now disabled for this server.`);
                return;
            }

            // Personal scope
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

                // Show server wake word too if in a guild
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

    async handleMyStatsCommand(interaction) {
        const userFeatures = require('./user-features');
        const userId = interaction.user.id;

        try {
            const stats = await userFeatures.getUserStats(userId);
            const timezone = await userFeatures.getTimezone(userId);
            const wakeWord = await userFeatures.getWakeWord(userId);
            
            const firstDate = new Date(stats.firstInteraction);
            const daysSince = Math.floor((Date.now() - stats.firstInteraction) / (1000 * 60 * 60 * 24));
            
            const embed = {
                color: 0x3498db,
                title: `📊 ${interaction.user.username}'s Jarvis Stats`,
                fields: [
                    { name: '💬 Messages', value: `${stats.messageCount || 0}`, inline: true },
                    { name: '🔍 Searches', value: `${stats.searchesPerformed || 0}`, inline: true },
                    { name: '⚡ Commands', value: `${stats.commandsUsed || 0}`, inline: true },
                    { name: '⏰ Reminders Created', value: `${stats.remindersCreated || 0}`, inline: true },
                    { name: '🌍 Timezone', value: timezone, inline: true },
                    { name: '🎯 Wake Word', value: wakeWord || 'None set', inline: true },
                    { name: '📅 First Interaction', value: `${firstDate.toLocaleDateString()} (${daysSince} days ago)`, inline: false }
                ],
                footer: { text: 'Stats are approximate and may reset periodically' },
                timestamp: new Date().toISOString()
            };

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('[/mystats] Error:', error);
            await interaction.editReply('Failed to retrieve stats, sir.');
        }
    }
}

module.exports = new DiscordHandlers();

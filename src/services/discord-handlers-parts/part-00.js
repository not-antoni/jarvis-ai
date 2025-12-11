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
    AutoModerationActionType,
    AutoModerationRuleEventType,
    AutoModerationRuleTriggerType,
    DiscordAPIError
} = require('discord.js');
const JarvisAI = require('./jarvis-core');
const config = require('../../config');
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
const funFeatures = require('./fun-features');
const selfhostFeatures = require('./selfhost-features');
const ytDlpManager = require('./yt-dlp-manager');
const { getSentientAgent } = require('../agents/sentient-core');
const legacyCommands = require('./legacy-commands');
const starkEconomy = require('./stark-economy');
const { AchievementsSystem, ACHIEVEMENTS } = require('./achievements');
const guildModeration = require('./GUILDS_FEATURES/moderation');
const achievements = new AchievementsSystem();

function isCommandEnabled(commandName) {
    const featureKey = commandFeatureMap.get(commandName);
    return isFeatureGloballyEnabled(featureKey);
}


const DEFAULT_CUSTOM_EMOJI_SIZE = 128;
const TWEMOJI_SVG_BASE = 'https://cdn.jsdelivr.net/gh/twitter/twemoji@latest/assets/svg';
const TWEMOJI_PNG_BASE = 'https://cdn.jsdelivr.net/gh/twitter/twemoji@latest/assets/72x72';

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
        this.memberLogCache = new Map();
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
        // Rap battle state manager
        this.rapBattles = new Map(); // userId -> { channelId, startTime, timeoutId, collector, lastBotMessage }
        this.rapBattleBlockedUsers = new Map(); // userId -> unblockTimestamp (users blocked from chat after battle ends)
        this.rapBattleComebacksPath = path.join(__dirname, '../../rapping_comebacks');
        this.emojiAssetCache = new Map();
        this.clipEmojiRenderSize = 22;
        this.clipEmojiSpacing = 4;
        this.clipLineHeight = 24;
        this.banterLines = [
            'I filed that under “impressive improvisation,” sir.',
            'Telemetry suggests a 92% chance you’re up to mischief, ma’am.',
            'I’ve adjusted the sarcasm filters to match your current vibe, sir.',
            'I preheated the lab. Thought you might want to make a mess again, ma’am.',
            'I sharpened your wits while you were offline. You’re welcome, sir.',
            'Consider this a friendly systems check: delightful chaos detected.'
        ];
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
    }

    isOnCooldown(userId, scope = 'global', cooldownMs = null) {
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
        this.cooldowns.set(scope, userId);
    }

    createFriendlyError(message) {
        const error = new Error(message);
        error.isFriendly = true;
        return error;
    }

    formatServerStatsValue(value) {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            return '0';
        }

        return Math.max(0, Math.floor(value)).toLocaleString();
    }

    formatServerStatsName(label, value) {
        return `${label}: ${this.formatServerStatsValue(value)}`;
    }

    createDefaultMemberLogConfig(guildId = null) {
        return {
            guildId: guildId || null,
            enabled: false,
            channelId: null,
            joinMessages: [],
            leaveMessages: [],
            customJoinMessage: null,
            customLeaveMessage: null
        };
    }

    cloneMemberLogRecord(record) {
        if (!record) {
            return null;
        }

        const cloned = {
            guildId: record.guildId || null,
            enabled: Boolean(record.enabled),
            channelId: record.channelId || null,
            joinMessages: this.sanitizeMemberLogList(record.joinMessages),
            leaveMessages: this.sanitizeMemberLogList(record.leaveMessages),
            customJoinMessage: this.normalizeMemberLogMessage(record.customJoinMessage),
            customLeaveMessage: this.normalizeMemberLogMessage(record.customLeaveMessage),
            createdAt: record.createdAt || null,
            updatedAt: record.updatedAt || null
        };

        if (record._id) {
            cloned._id = record._id;
        }

        return cloned;
    }

    normalizeMemberLogMessage(input) {
        if (!input || typeof input !== 'string') {
            return null;
        }

        let normalized = input.trim();
        if (!normalized) {
            return null;
        }

        if (normalized.length > this.maxMemberLogMessageLength) {
            normalized = normalized.slice(0, this.maxMemberLogMessageLength);
        }

        return normalized;
    }

    sanitizeMemberLogList(list = []) {
        if (!Array.isArray(list)) {
            return [];
        }

        const sanitized = [];
        const seen = new Set();

        for (const entry of list) {
            const normalized = this.normalizeMemberLogMessage(entry);
            if (!normalized) {
                continue;
            }

            const key = normalized.toLowerCase();
            if (seen.has(key)) {
                continue;
            }

            seen.add(key);
            sanitized.push(normalized);

            if (sanitized.length >= this.maxMemberLogVariations) {
                break;
            }
        }

        return sanitized;
    }

    async getCachedMemberLogConfig(guildId, refresh = false) {
        if (!guildId || !database.isConnected) {
            return null;
        }

        if (!refresh && this.memberLogCache.has(guildId)) {
            return this.cloneMemberLogRecord(this.memberLogCache.get(guildId));
        }

        try {
            const record = await database.getMemberLogConfig(guildId);
            if (record) {
                const sanitized = this.cloneMemberLogRecord(record);
                this.memberLogCache.set(guildId, sanitized);
                return this.cloneMemberLogRecord(sanitized);
            }

            this.memberLogCache.delete(guildId);
            return null;
        } catch (error) {
            console.error('Failed to fetch member log configuration:', error);
            return null;
        }
    }

    setCachedMemberLogConfig(guildId, record) {
        if (!guildId) {
            return;
        }

        if (record) {
            const sanitized = this.cloneMemberLogRecord(record);
            this.memberLogCache.set(guildId, sanitized);
        } else {
            this.memberLogCache.delete(guildId);
        }
    }

    async persistMemberLogConfig(guildId, config) {
        if (!guildId || !config) {
            throw new Error('Missing guild identifier for member log configuration.');
        }

        const payload = {
            channelId: config.channelId || null,
            enabled: Boolean(config.enabled),
            joinMessages: this.sanitizeMemberLogList(config.joinMessages),
            leaveMessages: this.sanitizeMemberLogList(config.leaveMessages),
            customJoinMessage: this.normalizeMemberLogMessage(config.customJoinMessage),
            customLeaveMessage: this.normalizeMemberLogMessage(config.customLeaveMessage)
        };

        const saved = await database.saveMemberLogConfig(guildId, payload);
        this.setCachedMemberLogConfig(guildId, saved);
        return this.cloneMemberLogRecord(saved);
    }

    pickMemberLogMessage(type, config) {
        if (!config) {
            return null;
        }

        const override = type === 'join' ? config.customJoinMessage : config.customLeaveMessage;
        if (override) {
            return override;
        }

        const custom = type === 'join' ? config.joinMessages : config.leaveMessages;
        const defaults = type === 'join' ? this.defaultJoinMessages : this.defaultLeaveMessages;

        const pool = Array.isArray(custom) && custom.length > 0
            ? [...custom, ...defaults]
            : defaults;

        if (!pool.length) {
            return null;
        }

        return pool[Math.floor(Math.random() * pool.length)];
    }

    formatMemberLogMessage(template, member, type) {
        if (!template || !member || !member.guild) {
            return null;
        }

        const guild = member.guild;
        const user = member.user || member;
        const mention = member.id ? `<@${member.id}>` : (user?.username || 'A member');
        const username = user?.username || member.displayName || 'A member';
        const tag = user?.tag || username;
        const serverName = guild?.name || 'this server';
        const memberCount = typeof guild?.memberCount === 'number'
            ? Math.max(0, guild.memberCount).toLocaleString()
            : 'unknown';

        const replacements = new Map([
            ['{user}', mention],
            ['{mention}', mention],
            ['{username}', username],
            ['{displayname}', member.displayName || username],
            ['{tag}', tag],
            ['{server}', serverName],
            ['{guild}', serverName],
            ['{membercount}', memberCount],
            ['{count}', memberCount],
            ['{type}', type === 'join' ? 'joined' : 'left'],
            ['{event}', type === 'join' ? 'join' : 'leave']
        ]);

        let output = template;
        for (const [token, value] of replacements.entries()) {
            output = output.replace(new RegExp(token, 'gi'), value);
        }

        return output.slice(0, 2000);
    }

    previewMemberLogMessage(template) {
        if (!template || typeof template !== 'string') {
            return 'None';
        }

        const compact = template.replace(/\s+/g, ' ').trim();
        if (!compact) {
            return 'None';
        }

        if (compact.length <= 80) {
            return compact;
        }

        return `${compact.slice(0, 77)}...`;
    }

    async sendMemberLogEvent(member, type) {
        if (!member || !member.guild || !database.isConnected) {
            return;
        }

        const guild = member.guild;
        const config = await this.getCachedMemberLogConfig(guild.id);
        if (!config || !config.enabled || !config.channelId) {
            return;
        }

        const template = this.pickMemberLogMessage(type, config);
        if (!template) {
            return;
        }

        const formatted = this.formatMemberLogMessage(template, member, type);
        if (!formatted) {
            return;
        }

        const channel = await this.resolveGuildChannel(guild, config.channelId);
        if (!channel || typeof channel.isTextBased !== 'function' || !channel.isTextBased()) {
            return;
        }

        let botMember = guild.members.me || null;
        if (!botMember) {
            try {
                botMember = await guild.members.fetchMe();
            } catch (error) {
                console.warn('Failed to verify bot permissions for member log:', error);
            }
        }

        const perms = channel.permissionsFor(botMember || guild.client?.user || member.client.user);
        if (!perms?.has(PermissionsBitField.Flags.ViewChannel) || !perms?.has(PermissionsBitField.Flags.SendMessages)) {
            return;
        }

        try {
            await channel.send({ content: formatted });
        } catch (error) {
            if (error.code === 50013 || error.code === 50001) {
                console.warn(`Insufficient permissions to send member log in guild ${guild.id}.`);
                return;
            }

            console.error('Failed to send member log message:', error);
        }
    }

    async handleGuildMemberAdd(member, client) {
        await this.sendMemberLogEvent(member, 'join');
        
        // Run guild moderation checks if enabled
        try {
            await guildModeration.handleMemberJoin(member, client);
        } catch (error) {
            console.error('[GuildModeration] Error in handleMemberJoin:', error);
        }
    }

    async handleGuildMemberRemove(member) {
        await this.sendMemberLogEvent(member, 'leave');
    }

    getReactionEmojiKey(emoji) {
        if (!emoji) {
            return null;
        }

        return emoji.id || emoji.name || null;
    }

    normalizeKeyword(keyword) {
        if (typeof keyword !== 'string') {
            return null;
        }

        let normalized = keyword.trim();
        if (!normalized) {
            return null;
        }

        if (normalized.length > 60) {
            normalized = normalized.slice(0, 60);
        }

        return normalized.toLowerCase();
    }

    parseKeywordInput(input) {
        if (!input || typeof input !== 'string') {
            return [];
        }

        return input
            .split(/[\n,]+/)
            .map(segment => this.normalizeKeyword(segment))
            .filter(Boolean);
    }

    mergeKeywords(current = [], additions = []) {
        const unique = new Set();

        const register = keyword => {
            const normalized = this.normalizeKeyword(keyword);
            if (normalized) {
                unique.add(normalized);
            }
        };

        current.forEach(register);
        additions.forEach(register);

        return Array.from(unique);
    }

    createDefaultAutoModRecord(guildId = null) {
        return {
            guildId: guildId || null,
            keywords: [],
            enabled: false,
            customMessage: this.defaultAutoModMessage,
            ruleId: null,
            ruleIds: [],
            extraFilters: []
        };
    }

    extractAutoModKeywordIssues(error) {
        const issues = new Set();

        const addIssue = value => {
            if (!value) {
                return;
            }

            if (typeof value === 'string') {
                issues.add(value);
                return;
            }

            if (typeof value === 'object') {
                if (typeof value.message === 'string') {
                    issues.add(value.message);
                } else if (typeof value.keyword === 'string') {
                    issues.add(value.keyword);
                }
            }
        };

        const traverse = node => {
            if (!node) {
                return;
            }

            if (Array.isArray(node)) {
                node.forEach(item => traverse(item));
                return;
            }

            if (typeof node === 'object') {
                if (Array.isArray(node._errors)) {
                    node._errors.forEach(addIssue);
                }

                for (const key of Object.keys(node)) {
                    if (key === '_errors') {
                        continue;
                    }

                    traverse(node[key]);
                }
                return;
            }

            addIssue(node);
        };

        if (error?.rawError) {
            const direct = error.rawError.trigger_metadata?.keyword_filter;
            if (Array.isArray(direct)) {
                direct.forEach(addIssue);
            }

            traverse(error.rawError.errors?.trigger_metadata?.keyword_filter);
        }

        return Array.from(issues).filter(Boolean);
    }

    getAutoModErrorMessage(error, fallback = 'I could not update the auto moderation rule, sir.') {
        if (!error) {
            return fallback;
        }

        if (error.isFriendly && typeof error.message === 'string') {
            return error.message;
        }

        if (error instanceof DiscordAPIError) {
            if (error.code === 50013 || error.status === 403) {
                return 'Discord denied me the permission to adjust auto moderation, sir. Please ensure I have the "Manage Server" permission.';
            }

            if (error.code === 50035) {
                const issues = this.extractAutoModKeywordIssues(error);
                if (issues.length) {
                    const preview = issues.slice(0, 3).join('; ');
                    const suffix = issues.length > 3 ? ' …' : '';
                    return `Discord rejected the blacklist update: ${preview}${suffix}. Please adjust those entries and try again, sir.`;
                }

                return 'Discord rejected one of the blacklist entries, sir. Please ensure each entry is under 60 characters and avoids restricted symbols.';
            }

            if (error.code === 30037 || error.code === 30035 || error.code === 30013) {
                return 'This server already has the maximum number of auto moderation rules, sir. Please remove another rule or reuse the Jarvis rule.';
            }

            if (error.code === 20022 || error.status === 429) {
                return 'Discord rate limited the auto moderation update, sir. Please wait a few seconds and try again.';
            }
        }

        if (error.code === 50001) {
            return 'Discord denied me access to the auto moderation rule, sir. Please ensure I can manage AutoMod settings.';
        }

        return fallback;
    }

    handleAutoModApiError(error, fallback = 'I could not update the auto moderation rule, sir.') {
        if (!error) {
            throw this.createFriendlyError(fallback);
        }

        if (error.isFriendly) {
            throw error;
        }

        const friendlyError = this.createFriendlyError(this.getAutoModErrorMessage(error, fallback));
        friendlyError.cause = error;
        throw friendlyError;
    }

    async prepareAutoModState(guild, record) {
        if (!guild) {
            throw this.createFriendlyError('I could not access that server, sir.');
        }

        const prepared = record ? { ...record } : this.createDefaultAutoModRecord(guild.id);
        prepared.guildId = guild.id;

        let mutated = false;

        if (!Array.isArray(prepared.keywords)) {
            prepared.keywords = [];
            mutated = true;
        }

        const mergedKeywords = this.mergeKeywords([], prepared.keywords);
        if (mergedKeywords.length !== prepared.keywords.length) {
            prepared.keywords = mergedKeywords;
            mutated = true;
        }

        const normalizedMessage = typeof prepared.customMessage === 'string' && prepared.customMessage.trim()
            ? prepared.customMessage.trim().slice(0, 150)
            : this.defaultAutoModMessage;
        if (prepared.customMessage !== normalizedMessage) {
            prepared.customMessage = normalizedMessage;
            mutated = true;
        }

        const normalizedEnabled = Boolean(prepared.enabled);
        if (prepared.enabled !== normalizedEnabled) {
            prepared.enabled = normalizedEnabled;
            mutated = true;
        }

        let ruleIds = Array.isArray(prepared.ruleIds) ? prepared.ruleIds.slice() : [];

        if (!ruleIds.length && prepared.ruleId) {
            ruleIds = [prepared.ruleId];
        }

        const sanitizedRuleIds = [];
        for (const id of ruleIds) {
            if (!id) {
                continue;
            }

            if (typeof id === 'string') {
                if (id.trim()) {
                    sanitizedRuleIds.push(id.trim());
                }
            } else {
                sanitizedRuleIds.push(String(id));
                mutated = true;
            }
        }

        if (prepared.ruleId) {
            const legacyId = String(prepared.ruleId);
            if (legacyId && !sanitizedRuleIds.includes(legacyId)) {
                sanitizedRuleIds.push(legacyId);
            }
            prepared.ruleId = null;
            mutated = true;
        }

        if (prepared.ruleIds?.length !== sanitizedRuleIds.length ||
            prepared.ruleIds?.some((value, index) => value !== sanitizedRuleIds[index])) {
            prepared.ruleIds = sanitizedRuleIds;
            mutated = true;
        }

        const rules = [];
        const missingRuleIds = [];

        if (!Array.isArray(prepared.extraFilters)) {
            prepared.extraFilters = [];
            mutated = true;
        }

        const normalizedExtraFilters = [];
        for (const entry of prepared.extraFilters) {
            if (!entry || typeof entry !== 'object') {
                mutated = true;
                continue;
            }

            const keywords = this.mergeKeywords([], Array.isArray(entry.keywords) ? entry.keywords : []);
            if (!keywords.length) {
                mutated = true;
                continue;
            }

            const customMessage = typeof entry.customMessage === 'string' && entry.customMessage.trim()
                ? entry.customMessage.trim().slice(0, 150)
                : normalizedMessage;
            const name = typeof entry.name === 'string' && entry.name.trim()
                ? entry.name.trim().slice(0, 100)
                : `${this.autoModRuleName} Filter`;

            let ruleId = typeof entry.ruleId === 'string' && entry.ruleId.trim()
                ? entry.ruleId.trim()
                : null;
            let enabled = Boolean(entry.enabled);

            if (ruleId) {
                const rule = await this.fetchAutoModRule(guild, ruleId);
                if (rule) {
                    enabled = Boolean(rule.enabled);
                } else {
                    missingRuleIds.push(ruleId);
                    ruleId = null;
                    enabled = false;
                    mutated = true;
                }
            }

            normalizedExtraFilters.push({
                ruleId,
                keywords,
                customMessage,
                enabled,
                name
            });

            if (!entry.ruleId || entry.ruleId !== ruleId ||
                !Array.isArray(entry.keywords) || entry.keywords.length !== keywords.length ||
                entry.customMessage !== customMessage || entry.enabled !== enabled || entry.name !== name) {
                mutated = true;
            }
        }

        if (normalizedExtraFilters.length !== prepared.extraFilters.length) {
            mutated = true;
        }

        prepared.extraFilters = normalizedExtraFilters;

        for (const ruleId of prepared.ruleIds) {
            const rule = await this.fetchAutoModRule(guild, ruleId);
            if (rule) {
                rules.push(rule);
            } else {
                missingRuleIds.push(ruleId);
            }
        }

        if (missingRuleIds.length) {
            const missingSet = new Set(missingRuleIds);
            const retained = prepared.ruleIds.filter(id => !missingSet.has(id));
            if (retained.length !== prepared.ruleIds.length) {
                prepared.ruleIds = retained;
                mutated = true;
            }

            if (!retained.length && prepared.enabled) {
                prepared.enabled = false;
                mutated = true;
            }
        }

        if (rules.length) {
            const allEnabled = rules.every(rule => Boolean(rule.enabled));
            if (prepared.enabled !== allEnabled) {
                prepared.enabled = allEnabled;
                mutated = true;
            }
        }

        return { record: prepared, rules, mutated, missingRuleIds };
    }

    async fetchAutoModRule(guild, ruleId) {
        if (!guild || !ruleId) {
            return null;
        }

        try {
            return await guild.autoModerationRules.fetch(ruleId);
        } catch (error) {
            if (error.code === 10066 || error.code === 50001) {
                return null;
            }

            console.warn('Failed to fetch auto moderation rule:', error);
            return null;
        }
    }

    async upsertAutoModRule(guild, keywords, customMessage = null, ruleId = null, enabled = true, ruleName = null) {
        if (!guild) {
            throw this.createFriendlyError('I could not access that server, sir.');
        }

        const sanitized = this.mergeKeywords([], keywords);
        if (sanitized.length === 0) {
            throw this.createFriendlyError('Please provide at least one valid keyword, sir.');
        }

        if (sanitized.length > this.maxAutoModKeywordsPerRule) {
            throw this.createFriendlyError(`Each auto moderation rule can track up to ${this.maxAutoModKeywordsPerRule} entries, sir.`);
        }

        const payload = {
            name: ruleName || this.autoModRuleName,
            eventType: AutoModerationRuleEventType.MessageSend,
            triggerType: AutoModerationRuleTriggerType.Keyword,
            triggerMetadata: {
                keywordFilter: sanitized
            },
            actions: [
                {
                    type: AutoModerationActionType.BlockMessage,
                    metadata: customMessage
                        ? { customMessage: customMessage.slice(0, 150) }
                        : {}
                }
            ],
            enabled,
            exemptRoles: [],
            exemptChannels: []
        };

        let rule = null;

        if (ruleId) {
            const existingRule = await this.fetchAutoModRule(guild, ruleId);

            if (existingRule) {
                try {
                    rule = await existingRule.edit(payload);
                } catch (error) {
                    if (error?.code === 10066 || error?.code === 50001) {
                        console.warn(`Stored auto moderation rule ${ruleId} no longer exists. Recreating.`);
                    } else {
                        this.handleAutoModApiError(error, 'I could not update the auto moderation rule, sir.');
                    }
                }
            }
        }

        if (!rule) {
            try {
                rule = await guild.autoModerationRules.create(payload);
            } catch (error) {
                this.handleAutoModApiError(error, 'I could not create the auto moderation rule, sir.');
            }
        }

        if (!rule) {
            throw this.createFriendlyError('Discord did not return an auto moderation rule, sir.');
        }

        return { rule, keywords: sanitized };
    }

    async syncAutoModRules(guild, keywords, customMessage = null, existingRuleIds = [], enabled = true) {
        if (!guild) {
            throw this.createFriendlyError('I could not access that server, sir.');
        }

        const sanitized = this.mergeKeywords([], keywords);
        if (!sanitized.length) {
            throw this.createFriendlyError('Please provide at least one valid keyword, sir.');
        }

        const chunks = [];
        for (let index = 0; index < sanitized.length; index += this.maxAutoModKeywordsPerRule) {
            chunks.push(sanitized.slice(index, index + this.maxAutoModKeywordsPerRule));
        }

        const resolvedRules = [];
        const resolvedRuleIds = [];
        const normalizedExisting = Array.isArray(existingRuleIds)
            ? existingRuleIds.filter(id => typeof id === 'string' && id.trim()).map(id => id.trim())
            : [];

        for (let index = 0; index < chunks.length; index += 1) {
            const chunkKeywords = chunks[index];
            const ruleName = chunks.length > 1
                ? `${this.autoModRuleName} #${index + 1}`
                : this.autoModRuleName;
            const targetRuleId = normalizedExisting[index] || null;

            const { rule } = await this.upsertAutoModRule(
                guild,
                chunkKeywords,
                customMessage,
                targetRuleId,
                enabled,
                ruleName
            );

            resolvedRules.push(rule);
            resolvedRuleIds.push(rule.id);
        }

        if (normalizedExisting.length > chunks.length) {
            const extras = normalizedExisting.slice(chunks.length);
            for (const extraId of extras) {
                await this.disableAutoModRule(guild, extraId);
            }
        }

        return { rules: resolvedRules, keywords: sanitized, ruleIds: resolvedRuleIds };
    }

    generateAutoModFilterName(existingFilters = []) {
        const baseName = `${this.autoModRuleName} Filter`;
        if (!Array.isArray(existingFilters) || !existingFilters.length) {
            return baseName;
        }

        const usedNumbers = new Set();
        for (const filter of existingFilters) {
            const match = typeof filter?.name === 'string' ? filter.name.match(/#(\d+)$/) : null;
            if (match) {
                usedNumbers.add(Number(match[1]));
            }
        }

        let counter = existingFilters.length + 1;
        for (let candidate = 1; candidate <= existingFilters.length + 5; candidate += 1) {
            if (!usedNumbers.has(candidate)) {
                counter = candidate;
                break;
            }
        }

        return `${baseName} #${counter}`;
    }

    async upsertExtraAutoModFilter(guild, filter, defaultMessage, enabled = true) {
        if (!guild || !filter) {
            throw this.createFriendlyError('I could not adjust that auto moderation filter, sir.');
        }

        const keywords = this.mergeKeywords([], Array.isArray(filter.keywords) ? filter.keywords : []);
        if (!keywords.length) {
            throw this.createFriendlyError('Please provide at least one valid keyword, sir.');
        }

        const customMessage = typeof filter.customMessage === 'string' && filter.customMessage.trim()
            ? filter.customMessage.trim().slice(0, 150)
            : (typeof defaultMessage === 'string' && defaultMessage.trim()
                ? defaultMessage.trim().slice(0, 150)
                : this.defaultAutoModMessage);

        const name = typeof filter.name === 'string' && filter.name.trim()
            ? filter.name.trim().slice(0, 100)
            : `${this.autoModRuleName} Filter`;

        try {
            const { rule, keywords: sanitized } = await this.upsertAutoModRule(
                guild,
                keywords,
                customMessage,
                filter.ruleId,
                enabled,
                name
            );

            filter.ruleId = rule.id;
            filter.keywords = sanitized;
            filter.customMessage = customMessage;
            filter.enabled = Boolean(rule.enabled);
            filter.name = rule.name || name;
            return filter;
        } catch (error) {
            console.error('Failed to synchronize additional auto moderation filter:', error?.cause || error);
            throw error;
        }
    }

    async enableExtraAutoModFilters(guild, record) {
        if (!guild || !record || !Array.isArray(record.extraFilters) || !record.extraFilters.length) {
            return;
        }

        for (const filter of record.extraFilters) {
            try {
                filter.enabled = true;
                await this.upsertExtraAutoModFilter(
                    guild,
                    filter,
                    record.customMessage || this.defaultAutoModMessage,
                    true
                );
            } catch (error) {
                this.handleAutoModApiError(error, 'I could not enable one of the additional auto moderation filters, sir.');
            }
        }
    }

    async disableExtraAutoModFilters(guild, record) {
        if (!guild || !record || !Array.isArray(record.extraFilters) || !record.extraFilters.length) {
            return;
        }

        for (const filter of record.extraFilters) {
            if (!filter.ruleId) {
                filter.enabled = false;
                continue;
            }

            try {
                const disabled = await this.disableAutoModRule(guild, filter.ruleId);
                filter.enabled = false;
                if (!disabled) {
                    filter.ruleId = null;
                }
            } catch (error) {
                this.handleAutoModApiError(error, 'I could not disable one of the additional auto moderation filters, sir.');
            }
        }
    }

    async resyncEnabledExtraAutoModFilters(guild, record) {
        if (!guild || !record || !Array.isArray(record.extraFilters) || !record.extraFilters.length) {
            return;
        }

        for (const filter of record.extraFilters) {
            if (!filter.enabled) {
                continue;
            }

            try {
                await this.upsertExtraAutoModFilter(
                    guild,
                    filter,
                    record.customMessage || this.defaultAutoModMessage,
                    true
                );
            } catch (error) {
                this.handleAutoModApiError(error, 'I could not update one of the additional auto moderation filters, sir.');
            }
        }
    }

    async disableAutoModRule(guild, ruleId) {
        if (!guild || !ruleId) {
            return false;
        }

        if (Array.isArray(ruleId)) {
            let disabledAny = false;
            for (const id of ruleId) {
                const disabled = await this.disableAutoModRule(guild, id);
                if (disabled) {
                    disabledAny = true;
                }
            }
            return disabledAny;
        }

        try {
            const rule = await guild.autoModerationRules.fetch(ruleId);
            if (!rule) {
                return false;
            }

            await rule.edit({ enabled: false });
            return true;
        } catch (error) {
            if (error.code === 10066 || error.code === 50001) {
                return false;
            }

            throw error;
        }
    }

    invalidateGuildConfig(guildId) {
        if (guildId) {
            this.guildConfigCache.delete(guildId);
        }
    }

    async getGuildConfig(guild) {
        if (!guild || !database.isConnected) {
            return null;
        }

        const guildId = guild.id;
        const cached = this.guildConfigCache.get(guildId);
        if (cached && (Date.now() - cached.fetchedAt) < this.guildConfigTtlMs) {
            return cached.config;
        }

        try {
            const guildConfig = await database.getGuildConfig(guild.id, guild.ownerId);
            this.guildConfigCache.set(guildId, { config: guildConfig, fetchedAt: Date.now() });
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
        if (!guild) {
            throw this.createFriendlyError('I could not access that server, sir.');
        }

        let botMember = guild.members.me || null;

        try {
            if (!botMember) {
                botMember = await guild.members.fetchMe();
            }
        } catch (error) {
            console.warn('Failed to fetch bot membership for server stats:', error);
            throw this.createFriendlyError('I could not verify my permissions in that server, sir.');
        }

        if (!botMember) {
            throw this.createFriendlyError('I am not present in that server, sir.');
        }

        if (!botMember.permissions?.has(PermissionsBitField.Flags.ManageChannels)) {
            throw this.createFriendlyError('I require the Manage Channels permission to manage server stats, sir.');
        }

        return botMember;
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
        if (!channel?.permissionOverwrites || !everyoneId) {
            return;
        }

        try {
            await channel.permissionOverwrites.edit(everyoneId, {
                ViewChannel: true,
                Connect: false,
                Speak: false
            });
        } catch (error) {
            if (error.code !== 50013 && error.code !== 50001) {
                console.warn('Failed to update @everyone permissions for server stats channel:', error);
            }
        }

        if (botMember) {
            try {
                await channel.permissionOverwrites.edit(botMember.id, {
                    ViewChannel: true,
                    Connect: true,
                    Speak: true,
                    ManageChannels: true,
                    MoveMembers: true
                });
            } catch (error) {
                if (error.code !== 50013 && error.code !== 50001) {
                    console.warn('Failed to update bot permissions for server stats channel:', error);
                }
            }
        }
    }

    async ensureServerStatsChannels(guild, existingConfig = null, botMember = null) {
        if (!guild) {
            throw this.createFriendlyError('I could not access that server, sir.');
        }

        const me = botMember || await this.ensureBotCanManageChannels(guild);
        const everyoneId = guild.roles.everyone?.id;

        if (!everyoneId) {
            throw this.createFriendlyError('I could not determine the default role for that server, sir.');
        }

        const creationOverwrites = [
            {
                id: everyoneId,
                allow: [PermissionsBitField.Flags.ViewChannel],
                deny: [PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.Speak]
            },
            {
                id: me.id,
                allow: [
                    PermissionsBitField.Flags.ViewChannel,
                    PermissionsBitField.Flags.ManageChannels,
                    PermissionsBitField.Flags.Connect,
                    PermissionsBitField.Flags.Speak,
                    PermissionsBitField.Flags.MoveMembers
                ]
            }
        ];

        let category = null;

        if (existingConfig?.categoryId) {
            category = await this.resolveGuildChannel(guild, existingConfig.categoryId);
        }

        if (!category || category.type !== ChannelType.GuildCategory) {
            category = guild.channels.cache.find(channel => channel.type === ChannelType.GuildCategory && channel.name === this.serverStatsCategoryName) || null;
        }

        if (!category || category.type !== ChannelType.GuildCategory) {
            try {
                category = await guild.channels.create({
                    name: this.serverStatsCategoryName,
                    type: ChannelType.GuildCategory,
                    permissionOverwrites: creationOverwrites
                });
            } catch (error) {
                if (error.code === 50013) {
                    throw this.createFriendlyError('I lack permission to create the server stats category, sir.');
                }
                throw error;
            }
        } else {
            if (category.name !== this.serverStatsCategoryName) {
                try {
                    await category.setName(this.serverStatsCategoryName);
                } catch (error) {
                    if (error.code === 50013) {
                        throw this.createFriendlyError('I lack permission to rename the server stats category, sir.');
                    }
                    console.warn('Failed to rename server stats category:', error);
                }
            }

            await this.applyServerStatsPermissions(category, me, everyoneId);
        }

        const ensureVoiceChannel = async (channelId, placeholderName) => {
            let channel = null;
            if (channelId) {
                channel = await this.resolveGuildChannel(guild, channelId);
            }

            if (!channel || channel.type !== ChannelType.GuildVoice) {
                try {
                    channel = await guild.channels.create({
                        name: placeholderName,
                        type: ChannelType.GuildVoice,
                        parent: category.id,
                        permissionOverwrites: creationOverwrites
                    });
                } catch (error) {
                    if (error.code === 50013) {
                        throw this.createFriendlyError('I lack permission to create the server stats channels, sir.');
                    }
                    throw error;
                }
            } else if (channel.parentId !== category.id) {
                try {
                    await channel.setParent(category.id);
                } catch (error) {
                    if (error.code !== 50013 && error.code !== 50001) {
                        console.warn('Failed to reparent server stats channel:', error);
                    }
                }
            }

            await this.applyServerStatsPermissions(channel, me, everyoneId);
            return channel;
        };

        const totalChannel = await ensureVoiceChannel(existingConfig?.totalChannelId, `${this.serverStatsChannelLabels.total}: 0`);
        const userChannel = await ensureVoiceChannel(existingConfig?.userChannelId, `${this.serverStatsChannelLabels.users}: 0`);
        const botChannel = await ensureVoiceChannel(existingConfig?.botChannelId, `${this.serverStatsChannelLabels.bots}: 0`);
        const channelCountChannel = await ensureVoiceChannel(
            existingConfig?.channelCountChannelId,
            `${this.serverStatsChannelLabels.channels}: 0`
        );
        const roleCountChannel = await ensureVoiceChannel(
            existingConfig?.roleCountChannelId,
            `${this.serverStatsChannelLabels.roles}: 0`
        );
        return {
            category,
            totalChannel,
            userChannel,
            botChannel,
            channelCountChannel,
            roleCountChannel,
            botMember: me,
            everyoneId
        };
    }

    async collectGuildMemberStats(guild) {
        if (!guild) {
            return {
                total: 0,
                botCount: 0,
                userCount: 0,
                channelCount: 0,
                roleCount: 0,
                onlineUserCount: 0,
                offlineUserCount: 0
            };
        }

        let total = typeof guild.memberCount === 'number' ? guild.memberCount : 0;
        let botCount = 0;
        let userCount = 0;
        let channelCount = 0;
        let roleCount = 0;
        let onlineUserCount = 0;
        let offlineUserCount = 0;

        const shouldFetchMembers = guild.available !== false && typeof guild.memberCount === 'number' && guild.memberCount <= 4000;

        if (shouldFetchMembers) {
            try {
                const members = await guild.members.fetch({ time: 15000 }).catch(() => null);
                if (!members) throw new Error('Fetch timed out');
                total = members.size;
                botCount = members.filter(member => member.user.bot).size;
                userCount = total - botCount;

                onlineUserCount = members.filter(member => {
                    if (member.user?.bot) {
                        return false;
                    }

                    const status = member.presence?.status;
                    return status === 'online' || status === 'idle' || status === 'dnd';
                }).size;
            } catch (error) {
                // Silently fall back to cached - timeout/permission errors are expected
            }
        }

        if (botCount === 0 && userCount === 0) {
            const cachedMembers = guild.members.cache;
            if (cachedMembers.size > 0) {
                total = cachedMembers.size;
                botCount = cachedMembers.filter(member => member.user?.bot).size;
                userCount = total - botCount;
                onlineUserCount = cachedMembers.filter(member => {
                    if (member.user?.bot) {
                        return false;
                    }

                    const status = member.presence?.status;
                    return status === 'online' || status === 'idle' || status === 'dnd';
                }).size;
            } else {
                botCount = guild.members.cache.filter(member => member.user?.bot).size;
                userCount = Math.max(0, total - botCount);
            }
        }

        if (userCount < 0) {
            userCount = 0;
        }

        if (onlineUserCount < 0) {
            onlineUserCount = 0;
        }

        if (onlineUserCount > userCount) {
            onlineUserCount = userCount;
        }

        try {
            const channels = await guild.channels.fetch();
            channelCount = channels.filter(channel => channel && channel.type !== ChannelType.GuildCategory).size;
        } catch (error) {
            if (error.code !== 50013 && error.code !== 50001) {
                console.warn(`Failed to fetch full channel list for guild ${guild.id}:`, error);
            }

            const cachedChannels = guild.channels.cache;
            if (cachedChannels.size > 0) {
                channelCount = cachedChannels.filter(channel => channel && channel.type !== ChannelType.GuildCategory).size;
            }
        }

        try {
            const roles = await guild.roles.fetch();
            roleCount = roles.size;
        } catch (error) {
            if (error.code !== 50013 && error.code !== 50001) {
                console.warn(`Failed to fetch full role list for guild ${guild.id}:`, error);
            }

            const cachedRoles = guild.roles.cache;
            if (cachedRoles.size > 0) {
                roleCount = cachedRoles.size;
            }
        }

        offlineUserCount = Math.max(0, userCount - onlineUserCount);

        return { total, botCount, userCount, channelCount, roleCount, onlineUserCount, offlineUserCount };
    }

    renderServerStatsChart(stats, guildName = 'Server Snapshot') {
        const width = 640;
        const height = 360;
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = '#0b1221';
        ctx.fillRect(0, 0, width, height);

        const metrics = [
            { key: 'total', label: 'Members', color: '#64b5f6' },
            { key: 'userCount', label: 'Humans', color: '#81c784' },
            { key: 'botCount', label: 'Bots', color: '#ffb74d' },
            { key: 'onlineUserCount', label: 'Online', color: '#4dd0e1' },
            { key: 'offlineUserCount', label: 'Offline', color: '#9575cd' },
            { key: 'channelCount', label: 'Channels', color: '#f06292' },
            { key: 'roleCount', label: 'Roles', color: '#ba68c8' }
        ];

        const values = metrics.map((metric) => Number(stats?.[metric.key]) || 0);
        const maxValue = Math.max(...values, 1);

        const padding = { top: 60, bottom: 70, left: 60, right: 40 };
        const chartWidth = width - padding.left - padding.right;
        const chartHeight = height - padding.top - padding.bottom;
        const barSpacing = chartWidth / metrics.length;
        const barWidth = barSpacing * 0.6;

        ctx.strokeStyle = '#233044';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(padding.left, padding.top);
        ctx.lineTo(padding.left, padding.top + chartHeight);
        ctx.lineTo(padding.left + chartWidth, padding.top + chartHeight);
        ctx.stroke();

        ctx.font = '20px \"Segoe UI\", sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.fillText(`${guildName}`, width / 2, 34);
        ctx.font = '16px \"Segoe UI\", sans-serif';
        ctx.fillStyle = '#8aa4c1';
        ctx.fillText('Server Health Snapshot', width / 2, 56);

        ctx.font = '12px \"Segoe UI\", sans-serif';
        ctx.textAlign = 'left';
        ctx.fillStyle = '#8aa4c1';
        for (let i = 0; i <= 4; i += 1) {
            const y = padding.top + (chartHeight * (i / 4));
            const value = Math.round(maxValue * (1 - i / 4));
            ctx.fillText(String(value), padding.left - 48, y + 4);
            ctx.strokeStyle = 'rgba(255,255,255,0.05)';
            ctx.beginPath();
            ctx.moveTo(padding.left, y);
            ctx.lineTo(padding.left + chartWidth, y);
            ctx.stroke();
        }

        metrics.forEach((metric, index) => {
            const value = values[index];
            const x = padding.left + barSpacing * index + (barSpacing - barWidth) / 2;
            const heightRatio = value / maxValue;
            const barHeight = Math.max(4, chartHeight * heightRatio);
            const y = padding.top + chartHeight - barHeight;

            ctx.fillStyle = metric.color;
            ctx.beginPath();
            ctx.roundRect(x, y, barWidth, barHeight, 6);
            ctx.fill();

            ctx.fillStyle = '#ffffff';
            ctx.textAlign = 'center';
            ctx.font = '14px \"Segoe UI\", sans-serif';
            ctx.fillText(value.toLocaleString(), x + barWidth / 2, y - 8);

            ctx.fillStyle = '#8aa4c1';
            ctx.font = '13px \"Segoe UI\", sans-serif';
            ctx.fillText(metric.label, x + barWidth / 2, padding.top + chartHeight + 20);
        });

        return canvas.toBuffer('image/png');
    }

    async updateServerStats(guild, existingConfig = null) {
        if (!guild) {
            throw this.createFriendlyError('I could not access that server, sir.');
        }

        const stats = await this.collectGuildMemberStats(guild);
        const ensured = await this.ensureServerStatsChannels(guild, existingConfig);
        const {
            category,
            totalChannel,
            userChannel,
            botChannel,
            channelCountChannel,
            roleCountChannel,
            botMember,
            everyoneId
        } = ensured;

        const desiredNames = {
            total: this.formatServerStatsName(this.serverStatsChannelLabels.total, stats.total),
            users: this.formatServerStatsName(this.serverStatsChannelLabels.users, stats.userCount),
            bots: this.formatServerStatsName(this.serverStatsChannelLabels.bots, stats.botCount),
            channels: this.formatServerStatsName(this.serverStatsChannelLabels.channels, stats.channelCount),
            roles: this.formatServerStatsName(this.serverStatsChannelLabels.roles, stats.roleCount)
        };

        try {
            if (totalChannel && totalChannel.name !== desiredNames.total) {
                await totalChannel.setName(desiredNames.total);
            }

            if (userChannel && userChannel.name !== desiredNames.users) {
                await userChannel.setName(desiredNames.users);
            }

            if (botChannel && botChannel.name !== desiredNames.bots) {
                await botChannel.setName(desiredNames.bots);
            }

            if (channelCountChannel && channelCountChannel.name !== desiredNames.channels) {
                await channelCountChannel.setName(desiredNames.channels);
            }

            if (roleCountChannel && roleCountChannel.name !== desiredNames.roles) {
                await roleCountChannel.setName(desiredNames.roles);
            }

        } catch (error) {
            if (error.code === 50013) {
                throw this.createFriendlyError('I lack permission to rename the server stats channels, sir.');
            }
            throw error;
        }

        await this.applyServerStatsPermissions(totalChannel, botMember, everyoneId);
        await this.applyServerStatsPermissions(userChannel, botMember, everyoneId);
        await this.applyServerStatsPermissions(botChannel, botMember, everyoneId);
        await this.applyServerStatsPermissions(channelCountChannel, botMember, everyoneId);
        await this.applyServerStatsPermissions(roleCountChannel, botMember, everyoneId);
        const record = await database.saveServerStatsConfig(guild.id, {
            categoryId: category.id,
            totalChannelId: totalChannel.id,
            userChannelId: userChannel.id,
            botChannelId: botChannel.id,
            channelCountChannelId: channelCountChannel.id,
            roleCountChannelId: roleCountChannel.id
        });

        return { record, stats };
    }

    async disableServerStats(guild, existingConfig = null) {
        if (!guild) {
            throw this.createFriendlyError('I could not access that server, sir.');
        }

        const config = existingConfig || await database.getServerStatsConfig(guild.id);
        if (!config) {
            return false;
        }

        await this.ensureBotCanManageChannels(guild);

        const channelIds = new Set([
            config.totalChannelId,
            config.userChannelId,
            config.botChannelId,
            config.channelCountChannelId,
            config.roleCountChannelId,
            config.onlineUsersChannelId,
            config.offlineUsersChannelId
        ]);

        for (const channelId of channelIds) {
            if (!channelId) {
                continue;
            }

            const channel = await this.resolveGuildChannel(guild, channelId);
            if (!channel) {
                continue;
            }

            try {
                await channel.delete('Removing Jarvis server statistics channel');
            } catch (error) {
                if (error.code === 50013) {
                    throw this.createFriendlyError('I do not have permission to remove the server stats channels, sir.');
                }

                if (error.code !== 10003 && error.code !== 50001) {
                    console.warn('Failed to delete server stats channel:', error);
                }
            }
        }

        if (config.categoryId) {
            const category = await this.resolveGuildChannel(guild, config.categoryId);
            if (category?.type === ChannelType.GuildCategory) {
                const remaining = guild.channels.cache.filter(ch => ch.parentId === category.id).size;
                if (remaining === 0) {
                    try {
                        await category.delete('Removing Jarvis server statistics category');
                    } catch (error) {
                        if (error.code !== 10003 && error.code !== 50001 && error.code !== 50013) {
                            console.warn('Failed to delete server stats category:', error);
                        }
                    }
                }
            }
        }

        await database.deleteServerStatsConfig(guild.id);
        return true;
    }

    async handleMemberLogCommand(interaction) {
        const guild = interaction.guild;

        if (!guild) {
            await interaction.editReply('This command may only be used within a server, sir.');
            return;
        }

        if (!(await this.isGuildModerator(interaction.member))) {
            await interaction.editReply('Only the server owner or configured moderators may do that, sir.');
            return;
        }

        const subcommand = interaction.options.getSubcommand();
        let config = await this.getCachedMemberLogConfig(guild.id, true);
        if (!config) {
            config = this.createDefaultMemberLogConfig(guild.id);
        }

        config.joinMessages = Array.isArray(config.joinMessages) ? [...config.joinMessages] : [];
        config.leaveMessages = Array.isArray(config.leaveMessages) ? [...config.leaveMessages] : [];

        const replyWithError = async message => {
            await interaction.editReply(message);
        };

        try {
            if (subcommand === 'status') {
                const joinLines = config.joinMessages.length
                    ? config.joinMessages.map((msg, idx) => `   ${idx + 1}. ${this.previewMemberLogMessage(msg)}`)
                    : ['   (Using Jarvis defaults)'];
                const leaveLines = config.leaveMessages.length
                    ? config.leaveMessages.map((msg, idx) => `   ${idx + 1}. ${this.previewMemberLogMessage(msg)}`)
                    : ['   (Using Jarvis defaults)'];

                const lines = [
                    'Here is the current join and leave reporting setup, sir:',
                    `• Channel: ${config.channelId ? `<#${config.channelId}>` : 'Not configured'}`,
                    `• Enabled: ${config.enabled ? 'Yes' : 'No'}`,
                    `• Custom join message: ${config.customJoinMessage ? `"${this.previewMemberLogMessage(config.customJoinMessage)}"` : 'None'}`,
                    `• Custom leave message: ${config.customLeaveMessage ? `"${this.previewMemberLogMessage(config.customLeaveMessage)}"` : 'None'}`,
                    `• Join variations (${config.joinMessages.length} custom):`,
                    ...joinLines,
                    `• Leave variations (${config.leaveMessages.length} custom):`,
                    ...leaveLines,
                    'Placeholders: {mention}, {username}, {tag}, {server}, {membercount}'
                ];

                await interaction.editReply(lines.join('\n'));
                return;
            }

            if (subcommand === 'setchannel') {
                const channel = interaction.options.getChannel('channel', true);
                const allowedTypes = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement]);

                if (!channel || channel.guildId !== guild.id || !allowedTypes.has(channel.type)) {
                    await replyWithError('Please choose a text channel within this server, sir.');
                    return;
                }

                let botMember = guild.members.me || null;
                if (!botMember) {
                    try {
                        botMember = await guild.members.fetchMe();
                    } catch (error) {
                        console.warn('Failed to verify bot permissions during member log setup:', error);
                    }
                }

                const perms = channel.permissionsFor(botMember || guild.client?.user);
                if (!perms?.has(PermissionsBitField.Flags.ViewChannel) || !perms?.has(PermissionsBitField.Flags.SendMessages)) {
                    await replyWithError('I require permission to view and speak in that channel, sir.');
                    return;
                }

                config.channelId = channel.id;
                config.enabled = true;
                config = await this.persistMemberLogConfig(guild.id, config);
                await interaction.editReply(`Understood, sir. I will report joins and leaves in ${channel}.`);
                return;
            }

            if (subcommand === 'enable') {
                if (!config.channelId) {
                    await replyWithError('Please designate a channel first, sir.');
                    return;
                }

                if (config.enabled) {
                    await interaction.editReply('Join and leave reporting is already active, sir.');
                    return;
                }

                config.enabled = true;
                config = await this.persistMemberLogConfig(guild.id, config);
                await interaction.editReply('Join and leave reporting enabled, sir.');
                return;
            }

            if (subcommand === 'disable') {
                if (!config.enabled) {
                    await interaction.editReply('It was already disabled, sir.');
                    return;
                }

                config.enabled = false;
                config = await this.persistMemberLogConfig(guild.id, config);
                await interaction.editReply('Understood. I will keep quiet about joins and leaves for now, sir.');
                return;
            }

            if (subcommand === 'addvariation') {
                const type = interaction.options.getString('type', true);
                const messageInput = interaction.options.getString('message', true);
                const normalized = this.normalizeMemberLogMessage(messageInput);

                if (!normalized) {
                    await replyWithError('Please provide a concise message under 400 characters, sir.');
                    return;
                }

                const target = type === 'leave' ? config.leaveMessages : config.joinMessages;
                const key = normalized.toLowerCase();
                if (target.some(entry => entry.toLowerCase() === key)) {
                    await replyWithError('That variation is already present, sir.');
                    return;
                }

                if (target.length >= this.maxMemberLogVariations) {
                    await replyWithError('We have reached the variation limit, sir. Please remove one before adding another.');
                    return;
                }

                target.push(normalized);
                config = await this.persistMemberLogConfig(guild.id, config);

                const label = type === 'leave' ? 'leave' : 'join';
                await interaction.editReply(`Added a ${label} variation. I now have ${target.length} custom ${label} lines, sir.`);
                return;
            }

            if (subcommand === 'removevariation') {
                const type = interaction.options.getString('type', true);
                const index = interaction.options.getInteger('index', true);
                const target = type === 'leave' ? config.leaveMessages : config.joinMessages;

                if (!target.length) {
                    await replyWithError('There are no custom variations to remove, sir.');
                    return;
                }

                if (index < 1 || index > target.length) {
                    await replyWithError('That index does not exist, sir.');
                    return;
                }

                target.splice(index - 1, 1);
                config = await this.persistMemberLogConfig(guild.id, config);

                const label = type === 'leave' ? 'leave' : 'join';
                await interaction.editReply(`Removed the ${label} variation at position ${index}, sir.`);
                return;
            }

            if (subcommand === 'setcustom') {
                const type = interaction.options.getString('type', true);
                const messageInput = interaction.options.getString('message', true);
                const normalized = this.normalizeMemberLogMessage(messageInput);

                if (!normalized) {
                    await replyWithError('Please provide a concise message under 400 characters, sir.');
                    return;
                }

                if (type === 'leave') {
                    config.customLeaveMessage = normalized;
                } else {
                    config.customJoinMessage = normalized;
                }

                config = await this.persistMemberLogConfig(guild.id, config);
                await interaction.editReply('Custom messaging updated, sir. I will use it exclusively for that event.');
                return;
            }

            if (subcommand === 'clearcustom') {
                const type = interaction.options.getString('type', true);

                if (type === 'leave') {
                    if (!config.customLeaveMessage) {
                        await interaction.editReply('No custom leave message was set, sir.');
                        return;
                    }

                    config.customLeaveMessage = null;
                } else {
                    if (!config.customJoinMessage) {
                        await interaction.editReply('No custom join message was set, sir.');
                        return;
                    }

                    config.customJoinMessage = null;
                }

                config = await this.persistMemberLogConfig(guild.id, config);
                await interaction.editReply('Custom message cleared. I will return to the rotation, sir.');
                return;
            }

            await replyWithError('I am not certain how to handle that member log request, sir.');
        } catch (error) {
            if (error.isFriendly) {
                await replyWithError(error.message);
                return;

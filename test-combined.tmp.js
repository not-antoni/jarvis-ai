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
const config = require('./config');
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
const { commandMap: musicCommandMap } = require('./src/commands/music');
const CooldownManager = require('./src/core/cooldown-manager');
const { recordCommandRun } = require('./src/utils/telemetry');
const { commandFeatureMap, SLASH_EPHEMERAL_COMMANDS } = require('./src/core/command-registry');
const { isFeatureGloballyEnabled, isFeatureEnabledForGuild } = require('./src/core/feature-flags');
const memeCanvas = require('./src/utils/meme-canvas');
const cryptoClient = require('./crypto-client');
const vaultClient = require('./vault-client');
const moderationFilters = require('./moderation-filters');
const NEWS_API_KEY = process.env.NEWS_API_KEY || null;
const BrowserAgent = require('./src/agents/browserAgent');
const tempFiles = require('./src/utils/temp-files');
const { sanitizePings: sanitizePingsUtil } = require('./src/utils/sanitize');

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
        this.browserAgent = new BrowserAgent(config);
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

        this.agentSessions = new Map(); // userId -> { startedAt, lastActive }
        this.agentTtlMs = 30 * 60 * 1000;
        setInterval(() => this.cleanupAgentSessions(), 60 * 1000).unref();

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

    async handleGuildMemberAdd(member) {
        await this.sendMemberLogEvent(member, 'join');
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
                const members = await guild.members.fetch();
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
                if (error.code !== 50013 && error.code !== 50001) {
                    console.warn(`Failed to fetch full member list for guild ${guild.id} (using cached counts):`, error);
                }
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



            }

            console.error('Failed to handle member log command:', error);
            await replyWithError('I could not complete that member log request, sir.');
        }
    }

    async fetchNewsFromTheNewsApi(topic, limit = 5) {
        if (!NEWS_API_KEY) return [];

        const searchParam = encodeURIComponent(topic);
        const url = `https://api.thenewsapi.com/v1/news/top?api_token=${NEWS_API_KEY}&language=en&limit=${limit}&search=${searchParam}`;

        const response = await fetch(url, {
            headers: { 'Accept': 'application/json' }
        });

        if (!response.ok) {
            throw new Error(`TheNewsAPI request failed: ${response.status}`);
        }

        const data = await response.json();
        const articles = Array.isArray(data?.data) ? data.data : [];

        return articles.map((article) => ({
            title: article.title || 'Untitled story',
            description: article.description || '',
            url: article.url || null,
            source: article.source || article.source_url || 'TheNewsAPI',
            published: article.published_at ? new Date(article.published_at) : null,
            image: article.image_url || null
        }));
    }

    async handleTicketCommand(interaction) {
        const guild = interaction.guild;

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

        const member = interaction.member;
        const channel = interaction.channel;
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
        const guild = interaction.guild;

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

        const member = interaction.member;
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
        const guild = interaction.guild;

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

            await interaction.editReply(lines.join('\n'));
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
        const guild = interaction.guild;

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
			if (!name) name = (author && author.username) ? author.username : 'User';
			return name;
		} catch (_) {
			return (author && author.username) ? author.username : 'User';
		}
	}

	async fetchEmojiImage(url) {
		if (!url || typeof url !== 'string') return null;
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
			let display = `@unknown`;
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
        if (text.length <= maxLength) return text;
        return text.substring(0, maxLength - 3) + '...';
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
            if (!token) return;
            const width = tempCtx.measureText(token).width;
            if (currentLineWidth + width > maxWidth && currentLineWidth > 0) {
                advanceLine();
            }
            currentLineWidth += width;
        };

        const handleTextToken = token => {
            if (!token) return;
            const width = tempCtx.measureText(token).width;
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
                    const width = tempCtx.measureText(emojiText).width;
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
                    if (!token) continue;
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
                    if (!token) continue;
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
        // Check if message starts with "jarvis clip"
        const content = message.content.trim().toLowerCase();
        if (!content.startsWith('jarvis clip')) {
            return false;
        }

        // If not a reply, do nothing (no response)
        if (!message.reference || !message.reference.messageId) {
            return true; // Return true to indicate we handled it (by doing nothing)
        }

        try {
            // Fetch the replied message
            const repliedMessage = await message.channel.messages.fetch(message.reference.messageId);
            
            // Debug logging for timestamps
            console.log('Timestamp debug:', {
                clipCommandTime: message.createdAt.toLocaleTimeString(),
                repliedMessageTime: repliedMessage.createdAt.toLocaleTimeString(),
                repliedMessageTimestamp: repliedMessage.createdTimestamp,
                messageTimestamp: message.createdTimestamp,
                // Check if we're getting the right message
                repliedMessageId: repliedMessage.id,
                repliedMessageContent: repliedMessage.content.substring(0, 50) + '...',
                // Check message age
                messageAge: Date.now() - repliedMessage.createdTimestamp
            });
            
            // Check if message contains images or emojis - if so, don't respond
            if (this.hasImagesOrEmojis(repliedMessage)) {
                return true; // Handled silently - don't clip messages with images/emojis
            }
            
            // Get server-specific avatar (guild avatar) or fallback to global avatar
            // Discord allows users to set unique avatars per server - this gets the server-specific one
            // If no server avatar is set, falls back to the user's global avatar
            // Using Discord's proper avatar URL structure: https://cdn.discordapp.com/avatars/{user_id}/{avatar_hash}.png
            const avatarUrl = repliedMessage.member?.avatarURL({ 
                extension: 'png', 
                size: 128,
                forceStatic: false // Allow animated avatars
            }) || repliedMessage.author.displayAvatarURL({ 
                extension: 'png', 
                size: 128,
                forceStatic: false // Allow animated avatars
            });
            
            // Get user's role color
            let roleColor = '#ff6b6b'; // Default red
            try {
                if (message.guild && repliedMessage.member) {
                    roleColor = this.getUserRoleColor(repliedMessage.member);
                }
            } catch (error) {
                console.warn('Failed to get role color for text command:', error);
            }
            
            // Get display name (sanitized for rendering)
            const displayName = this.getSafeDisplayName(repliedMessage.member, repliedMessage.author);
            
			const imageBuffer = await this.createClipImage(
                repliedMessage.content, 
                displayName, 
                avatarUrl,
                repliedMessage.author.bot,
                roleColor,
                message.guild,
                client,
				repliedMessage, // Pass the entire message object
				repliedMessage.author,
				repliedMessage.attachments,
				repliedMessage.embeds
            );
            
            // Create attachment
            const attachment = new AttachmentBuilder(imageBuffer, { name: 'clipped.png' });
            
            // Send the image with "clipped, sir." message
            await message.reply({ 
                content: 'clipped, sir.', 
                files: [attachment] 
            });
            
            // Clean up - the image buffer is automatically garbage collected
            // No need to manually delete since we're working with buffers in memory
            
            return true; // Indicate we handled the command
        } catch (error) {
            console.error('Error handling clip command:', error);
            // Don't send any error message, just fail silently
            return true;
        }
    }

	// Find a message by ID across accessible channels in the same guild
	async findMessageAcrossChannels(interaction, messageId) {
		// Try current channel first
		try {
			if (interaction.channel && interaction.channel.messages) {
				const msg = await interaction.channel.messages.fetch(messageId);
				if (msg) return msg;
			}
		} catch (_) {}

		// If not in a guild, we cannot search other channels
		if (!interaction.guild) return null;

		// Iterate over text-based channels where the bot can view and read history
		const channels = interaction.guild.channels.cache;
		for (const [, channel] of channels) {
			try {
				// Skip non text-based channels
				if (!channel || typeof channel.isTextBased !== 'function' || !channel.isTextBased()) continue;

				// Permission checks to avoid errors/rate limits
				const perms = channel.permissionsFor(interaction.client.user.id);
				if (!perms) continue;
				if (!perms.has(PermissionsBitField.Flags.ViewChannel)) continue;
				if (!perms.has(PermissionsBitField.Flags.ReadMessageHistory)) continue;

				// Attempt to fetch by ID in this channel
				const msg = await channel.messages.fetch(messageId);
				if (msg) return msg;
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
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
			if (!res.ok) throw new Error(`Tenor oEmbed HTTP ${res.status}`);
			const data = await res.json();
			// oEmbed typically provides thumbnail_url
			if (data && data.thumbnail_url) return data.thumbnail_url;
			// Fallbacks some responses might include url
			if (data && data.url) return data.url;
		} catch (error) {
			console.warn('Failed to resolve Tenor static image via oEmbed:', error);
		}

		// 2) Fallback: fetch HTML and parse meta tags (works across Tenor share/short URLs)
		try {
			const pageRes = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0' } });
			if (!pageRes.ok) throw new Error(`Tenor page HTTP ${pageRes.status}`);
			const html = await pageRes.text();
			// Prefer og:image, fall back to twitter:image
			let metaMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
			if (!metaMatch) metaMatch = html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i);
			if (metaMatch && metaMatch[1]) return metaMatch[1];
		} catch (err) {
			console.warn('Failed to parse Tenor page for image:', err);
		}
		return null;
	}

    sanitizeMessageText(text) {
        if (!text) return '';

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
        if (e && e.image && e.image.url) urls.push(e.image.url);
        if (e && e.thumbnail && e.thumbnail.url) urls.push(e.thumbnail.url);
        return urls;
    });
    // Also detect if the message ends with a direct .gif URL (with optional query params)
    let trailingGifUrl = null;
    try {
        const trailing = text.trim().match(/(https?:\/\/\S+?\.gif(?:\?\S*)?)$/i);
        if (trailing && trailing[1]) trailingGifUrl = trailing[1];
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
            ctx.arc(avatarX + avatarSize/2, avatarY + avatarSize/2, avatarSize/2, 0, Math.PI * 2);
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
            ctx.arc(avatarX + avatarSize/2, avatarY + avatarSize/2, avatarSize/2, 0, Math.PI * 2);
            ctx.fillStyle = avatarBackgroundColor;
            ctx.fill();

            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 12px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(username.charAt(0).toUpperCase(), avatarX + avatarSize/2, avatarY + avatarSize/2);
            ctx.restore();
        }
    } else {
        ctx.save();
        ctx.beginPath();
        ctx.arc(avatarX + avatarSize/2, avatarY + avatarSize/2, avatarSize/2, 0, Math.PI * 2);
        ctx.fillStyle = avatarBackgroundColor;
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 12px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(username.charAt(0).toUpperCase(), avatarX + avatarSize/2, avatarY + avatarSize/2);
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
            if (!token) return;
            const width = ctx.measureText(token).width;
            if (currentLineWidth + width > maxWidth && currentLineWidth > 0) {
                advanceLine();
            }
            currentLineWidth += width;
        };

        const handleTextToken = (token, color = '#ffffff') => {
            if (!token) return;
            const width = ctx.measureText(token).width;
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
                    if (!token) continue;
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
                    if (!token) continue;
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
                if (textSegment) segments.push({ type: 'text', text: textSegment });
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
                    if (staticUrl) sourceUrl = staticUrl;
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
                    role: "assistant",
                    content: referencedMessage.content,
                    timestamp: referencedMessage.createdTimestamp
                });
            } else {
                contextualMessages.push({
                    role: "user",
                    content: referencedMessage.content,
                    username: referencedMessage.author.username,
                    timestamp: referencedMessage.createdTimestamp,
                    isReferencedMessage: true
                });
            }

            for (const msg of threadMessages) {
                if (msg.id === referencedMessageId) continue;

                if (msg.author.bot && msg.author.id === client.user.id) {
                    contextualMessages.push({
                        role: "assistant",
                        content: msg.content,
                        timestamp: msg.createdTimestamp
                    });
                } else if (!msg.author.bot) {
                    contextualMessages.push({
                        role: "user",
                        content: msg.content,
                        username: msg.author.username,
                        timestamp: msg.createdTimestamp
                    });
                }
            }

            const recentContext = contextualMessages.slice(-10);

            return {
                type: "contextual",
                messages: recentContext,
                threadStart: referencedMessageId,
                isReplyToUser: referencedMessage.author.id !== client.user.id
            };

        } catch (error) {
            console.warn("Failed to build contextual memory:", error);
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
                await message.reply({ content: blockMessage });
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
        const allowedBotIds = ['984734399310467112', '1391010888915484672'];
        if (message.author.id === client.user.id) return;
        if (message.author.bot && !allowedBotIds.includes(message.author.id)) return;

        if (!message.guild) {
            try {
                await this.handleAgentDmMessage(message);
            } catch (e) {
                // ignore
            }
            return;
        }

        await moderationFilters.handleMessage(message);

        const chatEnabled = await this.isCommandFeatureEnabled('jarvis', message.guild);
        if (!chatEnabled || !isFeatureGloballyEnabled('coreChat')) {
            return;
        }

        const userId = message.author.id;
        const messageScope = 'message:jarvis';
        const allowWakeWords = Boolean(config.discord?.messageContent?.enabled);
        const rawContent = typeof message.content === 'string' ? message.content : '';
        const normalizedContent = rawContent.toLowerCase();
        const containsWakeWord = allowWakeWords && normalizedContent
            ? config.wakeWords.some((trigger) => normalizedContent.includes(trigger))
            : false;

        const braveGuardedEarly = await this.enforceImmediateBraveGuard(message);
        if (braveGuardedEarly) {
            this.setCooldown(userId, messageScope);
            return;
        }

        if (message.mentions.everyone) {
            return;
        }

        const isMentioned = message.mentions.has(client.user);
        let isReplyToJarvis = false;

        if (!isMentioned && message.reference?.messageId) {
            try {
                const replied = await message.channel.messages.fetch(message.reference.messageId);
                if (replied?.author?.id === client.user.id) {
                    isReplyToJarvis = true;
                }
            } catch (error) {
                console.error('Failed to inspect replied message for Jarvis mention:', error);
            }
        }

        if (!isMentioned && !isReplyToJarvis && !containsWakeWord) {
            return;
        }

        const { limited } = this.hitCooldown(userId, messageScope);
        if (limited) {
            return;
        }

        await this.handleJarvisInteraction(message, client);
    }

    async handleVoiceStateUpdate() {
        return;
    }

    async handleJarvisInteraction(message, client) {
        const isMentioned = message.mentions.has(client.user);
        const isDM = message.channel.type === ChannelType.DM;
        const containsJarvis = config.wakeWords.some(trigger =>
            message.content.toLowerCase().includes(trigger)
        );
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
                console.warn("Failed to fetch referenced message:", error);
            }
        }

        if (isBot) {
            if (!isMentioned && !containsJarvis) return;
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
                });
            } catch (error) {
                console.error('Failed to reply to explicit Brave request:', error);
            }
            this.setCooldown(message.author.id, messageScope);
            return;
        }

        // 🚫 Clean mentions + @everyone/@here
        let cleanContent = message.content
            .replace(/<@!?\d+>/g, "")  // user mentions
            .replace(/@everyone/g, "") // NEW
            .replace(/@here/g, "")     // NEW
            .trim();

        // Check for clip command first (overrides AI response)
        if (await this.handleClipCommand(message, client)) {
            this.setCooldown(message.author.id, messageScope);
            return; // Exit early, no AI response
        }

        const ytCommandPattern = /^jarvis\s+yt\s+(.+)$/i;
        const mathTriggerPattern = /\bjarvis\s+math\b/i;
        const searchTriggerPattern = /\bjarvis\s+search\b/i;
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




            if (hasSearchTrigger) {
                await message.reply('Web search is now handled by `/search`, sir.');
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
                    await message.reply(response);
                    this.setCooldown(message.author.id, messageScope);
                    return;
                } catch (error) {
                    console.error("Brave search error:", error);
                    await message.reply("Web search failed, sir. Technical difficulties.");
                    this.setCooldown(message.author.id, messageScope);
                    return;
                }
            } else {
                await message.reply("Please provide a web search query after 'jarvis search', sir.");
                this.setCooldown(message.author.id, messageScope);
                return;
            }
        }

        if (!cleanContent) {
            cleanContent = "jarvis";
        } else {
            const wakeWordPattern = new RegExp(`^(${config.wakeWords.join('|')})[,.!?]*$`, 'i');
            if (wakeWordPattern.test(cleanContent)) {
                cleanContent = "jarvis";
            }
        }

        try {
            await message.channel.sendTyping();
        } catch (err) {
            console.warn("Failed to send typing (permissions?):", err);
        }

        if (cleanContent.length > config.ai.maxInputLength) {
            const responses = [
                "Rather verbose, sir. A concise version, perhaps?",
                "Too many words, sir. Brevity, please.",
                "TL;DR, sir.",
                "Really, sir?",
                "Saving your creativity for later, sir.",
                `${config.ai.maxInputLength} characters is the limit, sir.`,
                "Stop yapping, sir.",
                "Quite the novella, sir. Abridged edition?",
                "Brevity is the soul of wit, sir.",
            ];

            try {
                await message.reply(responses[Math.floor(Math.random() * responses.length)]);
            } catch (err) {
                console.error("Failed to reply (permissions?):", err);
            }
            this.setCooldown(message.author.id, messageScope);
            return;
        }

        if (cleanContent.length > config.ai.maxInputLength) {
            cleanContent = cleanContent.substring(0, config.ai.maxInputLength) + "...";
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
                if (typeof utilityResponse === "string" && utilityResponse.trim()) {
                    await message.reply(utilityResponse);
                } else {
                    await message.reply("Utility functions misbehaving, sir. Try another?");
                }
                return;
            }

            const response = await this.jarvis.generateResponse(message, cleanContent, false, contextualMemory);

            if (typeof response === "string" && response.trim()) {
                await message.reply(response);
            } else {
                await message.reply("Response circuits tangled, sir. Clarify your request?");
            }
        } catch (error) {
            console.error("Error processing message:", error);
            try {
                await message.reply("Technical difficulties, sir. One moment, please.");
            } catch (err) {
                console.error("Failed to send error reply:", err);
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

        const guild = interaction.guild;
        const member = interaction.member;
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

    async handleReactionRoleCommand(interaction) {
        if (!interaction.guild) {
            await interaction.editReply('This command is only available within a server, sir.');
            return;
        }

        if (!database.isConnected) {
            await interaction.editReply('My database uplink is offline, sir. Reaction roles are unavailable at the moment.');
            return;
        }

        const guild = interaction.guild;
        const member = interaction.member;
        const subcommand = interaction.options.getSubcommand();
        const guildConfig = await this.getGuildConfig(guild);

        if (subcommand === 'setmods') {
            const isOwner = member.id === guild.ownerId;
            const hasAdmin = member.permissions?.has(PermissionsBitField.Flags.Administrator);
            if (!isOwner && !hasAdmin) {
                await interaction.editReply('Only the server owner or administrators may adjust moderator roles, sir.');
                return;
            }
        } else {
            const isModerator = await this.isGuildModerator(member, guildConfig);
            if (!isModerator) {
                await interaction.editReply('Only the server owner or configured moderators may do that, sir.');
                return;
            }
        }

        if (subcommand === 'create') {
            const channel = interaction.options.getChannel('channel');
            const pairsInput = interaction.options.getString('pairs');
            const title = interaction.options.getString('title') || 'Select your roles';
            const description = interaction.options.getString('description') || 'React with the options below to toggle roles, sir.';

            if (!channel || channel.guildId !== guild.id) {
                await interaction.editReply('I could not access that channel, sir.');
                return;
            }

            const allowedTypes = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement]);
            if (!channel.isTextBased() || !allowedTypes.has(channel.type)) {
                await interaction.editReply('Reaction roles require a standard text channel or announcement channel, sir.');
                return;
            }

            const me = guild.members.me || await guild.members.fetchMe();
            if (!me) {
                await interaction.editReply('I could not verify my permissions in that server, sir.');
                return;
            }

            if (!me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
                await interaction.editReply('I require the "Manage Roles" permission to do that, sir.');
                return;
            }

            const channelPermissions = channel.permissionsFor(me);
            if (!channelPermissions || !channelPermissions.has(PermissionsBitField.Flags.ViewChannel) || !channelPermissions.has(PermissionsBitField.Flags.SendMessages) || !channelPermissions.has(PermissionsBitField.Flags.AddReactions) || !channelPermissions.has(PermissionsBitField.Flags.EmbedLinks)) {
                await interaction.editReply('I need permission to send messages, add reactions, and embed links in that channel, sir.');
                return;
            }

            let options;
            try {
                options = await this.parseReactionRolePairs(pairsInput, guild);
            } catch (error) {
                await interaction.editReply(error.message || 'Those role mappings confused me, sir.');
                return;
            }

            const unusableRole = options.find(option => {
                const role = guild.roles.cache.get(option.roleId);
                if (!role) {
                    return false;
                }
                return me.roles.highest.comparePositionTo(role) <= 0;
            });

            if (unusableRole) {
                await interaction.editReply(`My highest role must be above ${guild.roles.cache.get(unusableRole.roleId)?.name || 'that role'}, sir.`);
                return;
            }

            const optionLines = options.map(option => `${option.display} — <@&${option.roleId}>`).join('\n');
            const embedDescription = description ? `${description}\n\n${optionLines}` : optionLines;

            const embed = new EmbedBuilder()
                .setTitle(title)
                .setDescription(embedDescription)
                .setColor(0x5865f2)
                .setFooter({ text: 'React to add or remove roles.' });

            let sentMessage;
            try {
                sentMessage = await channel.send({ embeds: [embed] });
            } catch (error) {
                console.error('Failed to send reaction role message:', error);
                await interaction.editReply('I could not send the panel to that channel, sir.');
                return;
            }

            try {
                for (const option of options) {
                    await sentMessage.react(option.rawEmoji);
                }
            } catch (error) {
                console.error('Failed to add reactions for reaction role panel:', error);
                await interaction.editReply('One of those emojis could not be used, sir. I removed the panel.');
                try {
                    await sentMessage.delete();
                } catch (deleteError) {
                    console.warn('Failed to delete reaction role message after reaction failure:', deleteError);
                }
                return;
            }

            try {
                await database.saveReactionRoleMessage({
                    guildId: guild.id,
                    channelId: channel.id,
                    messageId: sentMessage.id,
                    options,
                    createdBy: interaction.user.id,
                    title,
                    description,
                    createdAt: new Date()
                });
            } catch (error) {
                console.error('Failed to persist reaction role configuration:', error);
                await interaction.editReply('I could not save that configuration, sir.');
                try {
                    await sentMessage.delete();
                } catch (cleanupError) {
                    console.warn('Failed to delete reaction role panel after persistence failure:', cleanupError);
                }
                return;
            }

            const messageUrl = sentMessage.url || `https://discord.com/channels/${guild.id}/${channel.id}/${sentMessage.id}`;
            await interaction.editReply(`Reaction role panel deployed in ${channel}, sir. [Jump to message](${messageUrl}).`);
            return;
        }

        if (subcommand === 'remove') {
            const messageInput = interaction.options.getString('message');
            const idMatch = messageInput?.match(/(\d{17,20})$/);
            const messageId = idMatch ? idMatch[1] : messageInput;

            if (!messageId) {
                await interaction.editReply('Please provide a valid message ID or link, sir.');
                return;
            }

            let record;
            try {
                record = await database.getReactionRole(messageId);
            } catch (error) {
                console.error('Failed to load reaction role message:', error);
            }

            if (!record || record.guildId !== guild.id) {
                await interaction.editReply('I do not have a reaction role panel for that message, sir.');
                return;
            }

            try {
                await database.deleteReactionRole(record.messageId);
            } catch (error) {
                console.error('Failed to delete reaction role configuration:', error);
                await interaction.editReply('I could not remove that configuration from the database, sir.');
                return;
            }

            let messageDeleted = false;
            try {
                const targetChannel = await guild.channels.fetch(record.channelId);
                const me = guild.members.me || await guild.members.fetchMe();
                if (targetChannel?.isTextBased() && me) {
                    const channelPerms = targetChannel.permissionsFor(me);
                    if (channelPerms?.has(PermissionsBitField.Flags.ManageMessages)) {
                        const panelMessage = await targetChannel.messages.fetch(record.messageId);
                        await panelMessage.delete();
                        messageDeleted = true;
                    }
                }
            } catch (error) {
                console.warn('Failed to delete reaction role message:', error);
            }

            await interaction.editReply(messageDeleted
                ? 'Reaction role panel removed and the message deleted, sir.'
                : 'Reaction role panel removed from my registry, sir.');
            return;
        }

        if (subcommand === 'list') {
            let records = [];
            try {
                records = await database.getReactionRolesForGuild(guild.id);
            } catch (error) {
                console.error('Failed to list reaction roles:', error);
                await interaction.editReply('I could not retrieve the current configurations, sir.');
                return;
            }

            if (!records || records.length === 0) {
                await interaction.editReply('No reaction role panels are currently configured, sir.');
                return;
            }

            const embed = new EmbedBuilder()
                .setTitle('Active reaction role panels')
                .setColor(0x5865f2);

            const limitedRecords = records.slice(0, 25);
            for (let index = 0; index < limitedRecords.length; index++) {
                const record = limitedRecords[index];
                const url = `https://discord.com/channels/${guild.id}/${record.channelId}/${record.messageId}`;
                const roleLines = (record.options || [])
                    .map(option => `${option.display} → <@&${option.roleId}>`)
                    .join('\n') || 'No roles recorded.';

                const value = `${guild.channels.cache.get(record.channelId) ? `<#${record.channelId}>` : 'Channel missing'} • [Jump to message](${url})\n${roleLines}`;

                embed.addFields({
                    name: `Panel ${index + 1}`,
                    value: value.length > 1024 ? `${value.slice(0, 1019)}...` : value
                });
            }

            if (records.length > limitedRecords.length) {
                embed.setFooter({ text: `Showing ${limitedRecords.length} of ${records.length} panels.` });
            }

            await interaction.editReply({ embeds: [embed] });
            return;
        }

        if (subcommand === 'setmods') {
            const shouldClear = interaction.options.getBoolean('clear') || false;
            const roleIds = [];
            for (let index = 1; index <= 5; index++) {
                const role = interaction.options.getRole(`role${index}`);
                if (role && !roleIds.includes(role.id)) {
                    roleIds.push(role.id);
                }
            }

            if (!shouldClear && roleIds.length === 0) {
                await interaction.editReply('Please provide at least one role or enable the clear option, sir.');
                return;
            }

            try {
                const updated = await database.setGuildModeratorRoles(guild.id, shouldClear ? [] : roleIds, guild.ownerId);
                const summary = updated?.moderatorRoleIds?.length
                    ? updated.moderatorRoleIds.map(roleId => `<@&${roleId}>`).join(', ')
                    : 'Only the server owner may configure reaction roles.';

                await interaction.editReply(shouldClear
                    ? 'Moderator roles cleared, sir. Only the owner retains access.'
                    : `Moderator roles updated, sir: ${summary}`);
            } catch (error) {
                console.error('Failed to update moderator roles:', error);
                await interaction.editReply('I could not adjust the moderator roles, sir.');
            }
            return;
        }

        await interaction.editReply('I do not recognize that subcommand, sir.');
    }

    async handleReactionAdd(reaction, user) {
        if (!database.isConnected || !reaction || !user || user.bot) {
            return;
        }

        try {
            if (reaction.partial) {
                try {
                    await reaction.fetch();
                } catch (error) {
                    console.warn('Failed to fetch partial reaction (add):', error);
                }
            }

            if (reaction.message?.partial) {
                try {
                    await reaction.message.fetch();
                } catch (error) {
                    console.warn('Failed to fetch partial message for reaction add:', error);
                }
            }

            const context = await this.resolveReactionRoleContext(reaction, user);
            if (!context) {
                return;
            }

            if (context.member.roles.cache.has(context.role.id)) {
                return;
            }

            await context.member.roles.add(context.role, 'Reaction role assignment');
        } catch (error) {
            console.error('Failed to handle reaction role assignment:', error);
        }
    }

    async handleReactionRemove(reaction, user) {
        if (!database.isConnected || !reaction || !user || user.bot) {
            return;
        }

        try {
            if (reaction.partial) {
                try {
                    await reaction.fetch();
                } catch (error) {
                    console.warn('Failed to fetch partial reaction (remove):', error);
                }
            }

            if (reaction.message?.partial) {
                try {
                    await reaction.message.fetch();
                } catch (error) {
                    console.warn('Failed to fetch partial message for reaction remove:', error);
                }
            }

            const context = await this.resolveReactionRoleContext(reaction, user);
            if (!context) {
                return;
            }

            if (!context.member.roles.cache.has(context.role.id)) {
                return;
            }

            await context.member.roles.remove(context.role, 'Reaction role removal');
        } catch (error) {
            console.error('Failed to handle reaction role removal:', error);
        }
    }

    async handleTrackedMessageDelete(message) {
        if (!database.isConnected || !message?.id) {
            return;
        }

        try {
            const record = await database.getReactionRole(message.id);
            if (!record) {
                return;
            }

            await database.deleteReactionRole(message.id);
        } catch (error) {
            console.error('Failed to clean up deleted reaction role message:', error);
        }
    }

    async handleAutoModCommand(interaction) {
        if (!interaction.guild) {
            await interaction.editReply('This command is only available within a server, sir.');
            return;
        }

        if (!database.isConnected) {
            await interaction.editReply('My database uplink is offline, sir. Auto moderation is unavailable at the moment.');
            return;
        }

        const guild = interaction.guild;
        const member = interaction.member;
        const subcommand = interaction.options.getSubcommand();
        const subcommandGroup = interaction.options.getSubcommandGroup(false);
        const guildConfig = await this.getGuildConfig(guild);

        const isModerator = await this.isGuildModerator(member, guildConfig);
        if (!isModerator) {
            await interaction.editReply('Only the server owner or configured moderators may do that, sir.');
            return;
        }




        const me = guild.members.me || await guild.members.fetchMe();
        if (!me || !me.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
            await interaction.editReply('I require the "Manage Server" permission to configure auto moderation, sir.');
            return;
        }

        const storedRecord = await database.getAutoModConfig(guild.id);
        const { record, rules: cachedRules, mutated, missingRuleIds } = await this.prepareAutoModState(guild, storedRecord);

        if (mutated) {
            await database.saveAutoModConfig(guild.id, record);
        }

        const replyWithError = async message => {
            await interaction.editReply(message);
        };

        if (subcommandGroup === 'filter') {
            if (subcommand === 'add') {
                const input = interaction.options.getString('words');
                const additions = this.parseKeywordInput(input);

                if (!additions.length) {
                    await replyWithError('Please provide at least one word or phrase for the new filter, sir.');
                    return;
                }

                const merged = this.mergeKeywords([], additions);
                if (!merged.length) {
                    await replyWithError('I could not extract any valid keywords for that filter, sir.');
                    return;
                }

                if (merged.length > this.maxAutoModKeywordsPerRule) {
                    await replyWithError(`Each filter may track up to ${this.maxAutoModKeywordsPerRule} entries, sir.`);
                    return;
                }

                const mergedSet = new Set(merged);
                const duplicate = (record.extraFilters || []).some(filter => {
                    const normalized = this.mergeKeywords([], filter.keywords || []);
                    if (normalized.length !== merged.length) {
                        return false;
                    }
                    return normalized.every(keyword => mergedSet.has(keyword));
                });

                if (duplicate) {
                    await replyWithError('An additional filter already tracks those keywords, sir.');
                    return;
                }

                if (!Array.isArray(record.extraFilters)) {
                    record.extraFilters = [];
                }

                const filterName = this.generateAutoModFilterName(record.extraFilters);
                const newFilter = {
                    ruleId: null,
                    keywords: merged,
                    customMessage: record.customMessage,
                    enabled: true,
                    name: filterName,
                    createdAt: new Date().toISOString()
                };

                try {
                    await this.upsertExtraAutoModFilter(
                        guild,
                        newFilter,
                        record.customMessage || this.defaultAutoModMessage,
                        true
                    );

                    record.extraFilters.push(newFilter);
                    await database.saveAutoModConfig(guild.id, record);

                    const activeFilters = record.extraFilters.filter(filter => filter.enabled).length;
                    await interaction.editReply(
                        `Additional auto moderation filter deployed, sir. ` +
                        `You now have ${record.extraFilters.length} filter${record.extraFilters.length === 1 ? '' : 's'} ` +
                        `(${activeFilters} active).`
                    );
                } catch (error) {
                    console.error('Failed to add additional auto moderation filter:', error?.cause || error);
                    await replyWithError(this.getAutoModErrorMessage(error, 'I could not create that additional auto moderation filter, sir.'));
                }
                return;
            }

            await replyWithError('I am not certain how to handle that auto moderation filter request, sir.');
            return;
        }

        if (subcommand === 'status') {
            const enabledState = cachedRules.length
                ? cachedRules.every(rule => Boolean(rule.enabled))
                : Boolean(record.enabled);

            let footerText = 'Auto moderation has not been deployed yet.';
            if (cachedRules.length) {
                footerText = `Managing ${cachedRules.length} auto moderation rule${cachedRules.length === 1 ? '' : 's'}.`;
            } else if (missingRuleIds.length) {
                const preview = missingRuleIds.slice(0, 2).join(', ');
                const suffix = missingRuleIds.length > 2 ? ', …' : '';
                footerText = `Stored rule${missingRuleIds.length === 1 ? '' : 's'} ${preview}${suffix} ${missingRuleIds.length === 1 ? 'is' : 'are'} no longer accessible.`;
            }

            const extraFilters = Array.isArray(record.extraFilters) ? record.extraFilters : [];
            const activeExtras = extraFilters.filter(filter => filter.enabled).length;

            const embed = new EmbedBuilder()
                .setTitle('Auto moderation status')
                .setColor(0x5865f2)
                .addFields(
                    { name: 'Enabled', value: enabledState ? 'Yes' : 'No', inline: true },
                    { name: 'Tracked phrases', value: `${record.keywords.length}`, inline: true },
                    { name: 'Additional filters', value: extraFilters.length ? `${activeExtras}/${extraFilters.length} active` : 'None', inline: true }
                )
                .setFooter({ text: footerText });

            await interaction.editReply({ embeds: [embed] });
            return;
        }

        if (subcommand === 'list') {
            if (!record.keywords.length) {
                await interaction.editReply('No blacklist entries are currently configured, sir.');
                return;
            }

            const chunkSize = 20;
            const chunks = [];
            for (let index = 0; index < record.keywords.length; index += chunkSize) {
                chunks.push(record.keywords.slice(index, index + chunkSize));
            }

            const embed = new EmbedBuilder()
                .setTitle('Blacklisted phrases')
                .setColor(0x5865f2);

            chunks.slice(0, 5).forEach((chunk, index) => {
                const value = chunk.map(word => `• ${word}`).join('\n');
                embed.addFields({
                    name: `Batch ${index + 1}`,
                    value: value.length > 1024 ? `${value.slice(0, 1021)}...` : value
                });
            });

            if (chunks.length > 5) {
                embed.setFooter({ text: `Showing ${Math.min(100, record.keywords.length)} of ${record.keywords.length} entries.` });
            }

            await interaction.editReply({ embeds: [embed] });
            return;
        }

        if (subcommand === 'enable') {
            if (!record.keywords.length) {
                await replyWithError('Please add blacklisted words before enabling auto moderation, sir.');
                return;
            }

            try {
                const { rules, keywords, ruleIds } = await this.syncAutoModRules(
                    guild,
                    record.keywords,
                    record.customMessage,
                    record.ruleIds,
                    true
                );

                record.ruleIds = ruleIds;
                record.keywords = keywords;
                record.enabled = rules.every(rule => Boolean(rule.enabled));
                try {
                    await this.enableExtraAutoModFilters(guild, record);
                } catch (error) {
                    console.error('Failed to enable additional auto moderation filters:', error?.cause || error);
                    await replyWithError(this.getAutoModErrorMessage(error, 'I could not enable the additional auto moderation filters, sir.'));
                    return;
                }

                await database.saveAutoModConfig(guild.id, record);
                const statusLine = record.enabled
                    ? 'Discord will now block the configured phrases.'
                    : 'The rules were updated, but Discord left them disabled.';
                await interaction.editReply(`Auto moderation ${record.enabled ? 'engaged' : 'updated'}, sir. ${statusLine}`);
            } catch (error) {
                console.error('Failed to enable auto moderation:', error?.cause || error);
                await replyWithError(this.getAutoModErrorMessage(
                    error,
                    'I could not enable auto moderation, sir. Please ensure I have the AutoMod permission.'
                ));
            }
            return;
        }

        if (subcommand === 'disable') {
            try {
                const disabled = await this.disableAutoModRule(guild, record.ruleIds);
                if (!disabled) {
                    record.ruleIds = [];
                }
            } catch (error) {
                console.error('Failed to disable auto moderation rule:', error?.cause || error);
                await replyWithError(this.getAutoModErrorMessage(error, 'I could not disable the auto moderation rule, sir.'));
                return;
            }

            try {
                await this.disableExtraAutoModFilters(guild, record);
            } catch (error) {
                console.error('Failed to disable additional auto moderation filters:', error?.cause || error);
                await replyWithError(this.getAutoModErrorMessage(error, 'I could not disable the additional auto moderation filters, sir.'));
                return;
            }

            record.enabled = false;
            await database.saveAutoModConfig(guild.id, record);
            await interaction.editReply('Auto moderation is now offline for this server, sir.');
            return;
        }

        if (subcommand === 'clear') {
            try {
                const disabled = await this.disableAutoModRule(guild, record.ruleIds);
                if (!disabled) {
                    record.ruleIds = [];
                }
            } catch (error) {
                console.error('Failed to disable auto moderation while clearing:', error?.cause || error);
            }

            try {
                await this.disableExtraAutoModFilters(guild, record);
            } catch (error) {
                console.error('Failed to disable additional auto moderation filters while clearing:', error?.cause || error);
            }

            record.keywords = [];
            record.enabled = false;
            record.ruleIds = [];
            record.extraFilters = [];
            await database.saveAutoModConfig(guild.id, record);
            await interaction.editReply('Blacklist cleared and auto moderation disabled, sir.');
            return;
        }

        if (subcommand === 'setmessage') {
            const message = interaction.options.getString('message');
            if (!message || !message.trim()) {
                await replyWithError('Please provide a custom message, sir.');
                return;
            }

            record.customMessage = message.trim().slice(0, 150);

            if (record.enabled && record.keywords.length) {
                try {
                    const { rules, keywords, ruleIds } = await this.syncAutoModRules(
                        guild,
                        record.keywords,
                        record.customMessage,
                        record.ruleIds,
                        record.enabled
                    );
                    record.ruleIds = ruleIds;
                    record.enabled = rules.every(rule => Boolean(rule.enabled));
                    record.keywords = keywords;
                } catch (error) {
                    console.error('Failed to update auto moderation message:', error?.cause || error);
                    await replyWithError(this.getAutoModErrorMessage(error, 'I could not update the auto moderation message, sir.'));
                    return;
                }
            }

            for (const filter of record.extraFilters) {
                filter.customMessage = record.customMessage;
            }

            try {
                await this.resyncEnabledExtraAutoModFilters(guild, record);
            } catch (error) {
                console.error('Failed to update additional auto moderation filters with new message:', error?.cause || error);
                await replyWithError(this.getAutoModErrorMessage(error, 'I could not update the additional auto moderation filters, sir.'));
                return;
            }

            await database.saveAutoModConfig(guild.id, record);
            await interaction.editReply('Custom enforcement message updated, sir.');
            return;
        }

        if (subcommand === 'add') {
            const input = interaction.options.getString('words');
            const additions = this.parseKeywordInput(input);

            if (!additions.length) {
                await replyWithError('Please provide at least one word or phrase to blacklist, sir.');
                return;
            }

            const merged = this.mergeKeywords(record.keywords, additions);
            if (merged.length === record.keywords.length) {
                await replyWithError('Those words were already on the blacklist, sir.');
                return;
            }

            const previousCount = record.keywords.length;
            try {
                const { rules, keywords, ruleIds } = await this.syncAutoModRules(
                    guild,
                    merged,
                    record.customMessage,
                    record.ruleIds,
                    true
                );

                record.ruleIds = ruleIds;
                record.keywords = keywords;
                record.enabled = rules.every(rule => Boolean(rule.enabled));
                await database.saveAutoModConfig(guild.id, record);
                const addedCount = keywords.length - previousCount;
                const statusLine = record.enabled
                    ? 'Auto moderation is active, sir.'
                    : 'Auto moderation is currently disabled, sir.';
                await interaction.editReply(`Blacklist updated with ${addedCount} new entr${addedCount === 1 ? 'y' : 'ies'}. ${statusLine}`);
            } catch (error) {
                console.error('Failed to add auto moderation keywords:', error?.cause || error);
                await replyWithError(this.getAutoModErrorMessage(error, 'I could not update the auto moderation rule, sir.'));
            }
            return;
        }

        if (subcommand === 'remove') {
            const input = interaction.options.getString('words');
            const removals = this.parseKeywordInput(input);

            if (!removals.length) {
                await replyWithError('Please specify the words to remove from the blacklist, sir.');
                return;
            }

            const removalSet = new Set(removals.map(word => this.normalizeKeyword(word)));
            const remaining = (record.keywords || []).filter(keyword => !removalSet.has(this.normalizeKeyword(keyword)));

            if (remaining.length === record.keywords.length) {
                await replyWithError('None of those words were on the blacklist, sir.');
                return;
            }

            record.keywords = remaining;

            if (record.keywords.length) {
                try {
                    const { rules, keywords, ruleIds } = await this.syncAutoModRules(
                        guild,
                        record.keywords,
                        record.customMessage,
                        record.ruleIds,
                        record.enabled
                    );

                    record.ruleIds = ruleIds;
                    record.keywords = keywords;
                    record.enabled = rules.every(rule => Boolean(rule.enabled));
                } catch (error) {
                    console.error('Failed to update auto moderation keywords after removal:', error?.cause || error);
                    await replyWithError(this.getAutoModErrorMessage(error, 'I could not update the auto moderation rule after removal, sir.'));
                    return;
                }
            } else {
                try {
                    const disabled = await this.disableAutoModRule(guild, record.ruleIds);
                    if (!disabled) {
                        record.ruleIds = [];
                    }
                } catch (error) {
                    console.error('Failed to disable auto moderation after removal:', error?.cause || error);
                }
                record.ruleIds = [];
                record.enabled = false;
            }

            await database.saveAutoModConfig(guild.id, record);
            await interaction.editReply('Blacklist updated, sir.');
            return;
        }

        if (subcommand === 'import') {
            const attachment = interaction.options.getAttachment('file');
            const shouldReplace = interaction.options.getBoolean('replace') || false;

            if (!attachment) {
                await replyWithError('Please attach a text file containing the blacklist, sir.');
                return;
            }

            if (attachment.size > 256000) {
                await replyWithError('That file is a bit much, sir. Please provide a text file under 250KB.');
                return;
            }

            let text = '';
            try {
                const response = await fetch(attachment.url);
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                text = await response.text();
            } catch (error) {
                console.error('Failed to download blacklist file:', error);
                await replyWithError('I could not download that file, sir.');
                return;
            }

            const imported = this.parseKeywordInput(text);
            if (!imported.length) {
                await replyWithError('That file did not contain any usable entries, sir.');
                return;
            }

            const combined = shouldReplace
                ? this.mergeKeywords([], imported)
                : this.mergeKeywords(record.keywords, imported);

            if (!combined.length) {
                await replyWithError('I could not extract any valid keywords from that file, sir.');
                return;
            }

            try {
                const { rules, keywords, ruleIds } = await this.syncAutoModRules(
                    guild,
                    combined,
                    record.customMessage,
                    record.ruleIds,
                    true
                );

                record.ruleIds = ruleIds;
                record.keywords = keywords;
                record.enabled = rules.every(rule => Boolean(rule.enabled));
                await database.saveAutoModConfig(guild.id, record);
                const statusLine = record.enabled
                    ? 'Auto moderation is active, sir.'
                    : 'Auto moderation is currently disabled, sir.';
                await interaction.editReply(`Blacklist now tracks ${keywords.length} entr${keywords.length === 1 ? 'y' : 'ies'}. ${statusLine}`);
            } catch (error) {
                console.error('Failed to import auto moderation keywords:', error?.cause || error);
                await replyWithError(this.getAutoModErrorMessage(error, 'I could not apply that blacklist to Discord, sir.'));
            }
            return;
        }

        await interaction.editReply('That subcommand is not recognized, sir.');
    }

    async handleReactionRoleCommand(interaction) {
        if (!interaction.guild) {
            await interaction.editReply('This command is only available within a server, sir.');
            return;
        }

        if (!database.isConnected) {
            await interaction.editReply('My database uplink is offline, sir. Reaction roles are unavailable at the moment.');
            return;
        }

        const guild = interaction.guild;
        const member = interaction.member;
        const subcommand = interaction.options.getSubcommand();
        const guildConfig = await this.getGuildConfig(guild);

        if (subcommand === 'setmods') {
            const isOwner = member.id === guild.ownerId;
            const hasAdmin = member.permissions?.has(PermissionsBitField.Flags.Administrator);
            if (!isOwner && !hasAdmin) {
                await interaction.editReply('Only the server owner or administrators may adjust moderator roles, sir.');
                return;
            }
        } else {
            const isModerator = await this.isGuildModerator(member, guildConfig);
            if (!isModerator) {
                await interaction.editReply('Only the server owner or configured moderators may do that, sir.');
                return;
            }
        }

        if (subcommand === 'create') {
            const channel = interaction.options.getChannel('channel');
            const pairsInput = interaction.options.getString('pairs');
            const title = interaction.options.getString('title') || 'Select your roles';
            const description = interaction.options.getString('description') || 'React with the options below to toggle roles, sir.';

            if (!channel || channel.guildId !== guild.id) {
                await interaction.editReply('I could not access that channel, sir.');
                return;
            }

            const allowedTypes = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement]);
            if (!channel.isTextBased() || !allowedTypes.has(channel.type)) {
                await interaction.editReply('Reaction roles require a standard text channel or announcement channel, sir.');
                return;
            }

            const me = guild.members.me || await guild.members.fetchMe();
            if (!me) {
                await interaction.editReply('I could not verify my permissions in that server, sir.');
                return;
            }

            if (!me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
                await interaction.editReply('I require the "Manage Roles" permission to do that, sir.');
                return;
            }

            const channelPermissions = channel.permissionsFor(me);
            if (!channelPermissions || !channelPermissions.has(PermissionsBitField.Flags.ViewChannel) || !channelPermissions.has(PermissionsBitField.Flags.SendMessages) || !channelPermissions.has(PermissionsBitField.Flags.AddReactions) || !channelPermissions.has(PermissionsBitField.Flags.EmbedLinks)) {
                await interaction.editReply('I need permission to send messages, add reactions, and embed links in that channel, sir.');
                return;
            }

            let options;
            try {
                options = await this.parseReactionRolePairs(pairsInput, guild);
            } catch (error) {
                await interaction.editReply(error.message || 'Those role mappings confused me, sir.');
                return;
            }

            const unusableRole = options.find(option => {
                const role = guild.roles.cache.get(option.roleId);
                if (!role) {
                    return false;
                }
                return me.roles.highest.comparePositionTo(role) <= 0;
            });

            if (unusableRole) {
                await interaction.editReply(`My highest role must be above ${guild.roles.cache.get(unusableRole.roleId)?.name || 'that role'}, sir.`);
                return;
            }

            const optionLines = options.map(option => `${option.display} — <@&${option.roleId}>`).join('\n');
            const embedDescription = description ? `${description}\n\n${optionLines}` : optionLines;

            const embed = new EmbedBuilder()
                .setTitle(title)
                .setDescription(embedDescription)
                .setColor(0x5865f2)
                .setFooter({ text: 'React to add or remove roles.' });

            let sentMessage;
            try {
                sentMessage = await channel.send({ embeds: [embed] });
            } catch (error) {
                console.error('Failed to send reaction role message:', error);
                await interaction.editReply('I could not send the panel to that channel, sir.');
                return;
            }

            try {
                for (const option of options) {
                    await sentMessage.react(option.rawEmoji);
                }
            } catch (error) {
                console.error('Failed to add reactions for reaction role panel:', error);
                await interaction.editReply('One of those emojis could not be used, sir. I removed the panel.');
                try {
                    await sentMessage.delete();
                } catch (deleteError) {
                    console.warn('Failed to delete reaction role message after reaction failure:', deleteError);
                }
                return;
            }

            try {
                await database.saveReactionRoleMessage({
                    guildId: guild.id,
                    channelId: channel.id,
                    messageId: sentMessage.id,
                    options,
                    createdBy: interaction.user.id,
                    title,
                    description,
                    createdAt: new Date()
                });
            } catch (error) {
                console.error('Failed to persist reaction role configuration:', error);
                await interaction.editReply('I could not save that configuration, sir.');
                try {
                    await sentMessage.delete();
                } catch (cleanupError) {
                    console.warn('Failed to delete reaction role panel after persistence failure:', cleanupError);
                }
                return;
            }

            const messageUrl = sentMessage.url || `https://discord.com/channels/${guild.id}/${channel.id}/${sentMessage.id}`;
            await interaction.editReply(`Reaction role panel deployed in ${channel}, sir. [Jump to message](${messageUrl}).`);
            return;
        }

        if (subcommand === 'remove') {
            const messageInput = interaction.options.getString('message');
            const idMatch = messageInput?.match(/(\d{17,20})$/);
            const messageId = idMatch ? idMatch[1] : messageInput;

            if (!messageId) {
                await interaction.editReply('Please provide a valid message ID or link, sir.');
                return;
            }

            let record;
            try {
                record = await database.getReactionRole(messageId);
            } catch (error) {
                console.error('Failed to load reaction role message:', error);
            }

            if (!record || record.guildId !== guild.id) {
                await interaction.editReply('I do not have a reaction role panel for that message, sir.');
                return;
            }

            try {
                await database.deleteReactionRole(record.messageId);
            } catch (error) {
                console.error('Failed to delete reaction role configuration:', error);
                await interaction.editReply('I could not remove that configuration from the database, sir.');
                return;
            }

            let messageDeleted = false;
            try {
                const targetChannel = await guild.channels.fetch(record.channelId);
                const me = guild.members.me || await guild.members.fetchMe();
                if (targetChannel?.isTextBased() && me) {
                    const channelPerms = targetChannel.permissionsFor(me);
                    if (channelPerms?.has(PermissionsBitField.Flags.ManageMessages)) {
                        const panelMessage = await targetChannel.messages.fetch(record.messageId);
                        await panelMessage.delete();
                        messageDeleted = true;
                    }
                }
            } catch (error) {
                console.warn('Failed to delete reaction role message:', error);
            }

            await interaction.editReply(messageDeleted
                ? 'Reaction role panel removed and the message deleted, sir.'
                : 'Reaction role panel removed from my registry, sir.');
            return;
        }

        if (subcommand === 'list') {
            let records = [];
            try {
                records = await database.getReactionRolesForGuild(guild.id);
            } catch (error) {
                console.error('Failed to list reaction roles:', error);
                await interaction.editReply('I could not retrieve the current configurations, sir.');
                return;
            }

            if (!records || records.length === 0) {
                await interaction.editReply('No reaction role panels are currently configured, sir.');
                return;
            }

            const embed = new EmbedBuilder()
                .setTitle('Active reaction role panels')
                .setColor(0x5865f2);

            const limitedRecords = records.slice(0, 25);
            for (let index = 0; index < limitedRecords.length; index++) {
                const record = limitedRecords[index];
                const url = `https://discord.com/channels/${guild.id}/${record.channelId}/${record.messageId}`;
                const roleLines = (record.options || [])
                    .map(option => `${option.display} → <@&${option.roleId}>`)
                    .join('\n') || 'No roles recorded.';

                const value = `${guild.channels.cache.get(record.channelId) ? `<#${record.channelId}>` : 'Channel missing'} • [Jump to message](${url})\n${roleLines}`;

                embed.addFields({
                    name: `Panel ${index + 1}`,
                    value: value.length > 1024 ? `${value.slice(0, 1019)}...` : value
                });
            }

            if (records.length > limitedRecords.length) {
                embed.setFooter({ text: `Showing ${limitedRecords.length} of ${records.length} panels.` });
            }

            await interaction.editReply({ embeds: [embed] });
            return;
        }

        if (subcommand === 'setmods') {
            const shouldClear = interaction.options.getBoolean('clear') || false;
            const roleIds = [];
            for (let index = 1; index <= 5; index++) {
                const role = interaction.options.getRole(`role${index}`);
                if (role && !roleIds.includes(role.id)) {
                    roleIds.push(role.id);
                }
            }

            if (!shouldClear && roleIds.length === 0) {
                await interaction.editReply('Please provide at least one role or enable the clear option, sir.');
                return;
            }

            try {
                const updated = await database.setGuildModeratorRoles(guild.id, shouldClear ? [] : roleIds, guild.ownerId);
                const summary = updated?.moderatorRoleIds?.length
                    ? updated.moderatorRoleIds.map(roleId => `<@&${roleId}>`).join(', ')
                    : 'Only the server owner may configure reaction roles.';

                await interaction.editReply(shouldClear
                    ? 'Moderator roles cleared, sir. Only the owner retains access.'
                    : `Moderator roles updated, sir: ${summary}`);
            } catch (error) {
                console.error('Failed to update moderator roles:', error);
                await interaction.editReply('I could not adjust the moderator roles, sir.');
            }
            return;
        }

        await interaction.editReply('I do not recognize that subcommand, sir.');
    }

    async handleReactionAdd(reaction, user) {
        if (!database.isConnected || !reaction || !user || user.bot) {
            return;
        }

        try {
            if (reaction.partial) {
                try {
                    await reaction.fetch();
                } catch (error) {
                    console.warn('Failed to fetch partial reaction (add):', error);
                }
            }

            if (reaction.message?.partial) {
                try {
                    await reaction.message.fetch();
                } catch (error) {
                    console.warn('Failed to fetch partial message for reaction add:', error);
                }
            }

            const context = await this.resolveReactionRoleContext(reaction, user);
            if (!context) {
                return;
            }

            if (context.member.roles.cache.has(context.role.id)) {
                return;
            }

            await context.member.roles.add(context.role, 'Reaction role assignment');
        } catch (error) {
            console.error('Failed to handle reaction role assignment:', error);
        }
    }

    async handleReactionRemove(reaction, user) {
        if (!database.isConnected || !reaction || !user || user.bot) {
            return;
        }

        try {
            if (reaction.partial) {
                try {
                    await reaction.fetch();
                } catch (error) {
                    console.warn('Failed to fetch partial reaction (remove):', error);
                }
            }

            if (reaction.message?.partial) {
                try {
                    await reaction.message.fetch();
                } catch (error) {
                    console.warn('Failed to fetch partial message for reaction remove:', error);
                }
            }

            const context = await this.resolveReactionRoleContext(reaction, user);
            if (!context) {
                return;
            }

            if (!context.member.roles.cache.has(context.role.id)) {
                return;
            }

            await context.member.roles.remove(context.role, 'Reaction role removal');
        } catch (error) {
            console.error('Failed to handle reaction role removal:', error);
        }
    }

    async handleTrackedMessageDelete(message) {
        if (!database.isConnected || !message?.id) {
            return;
        }

        try {
            const record = await database.getReactionRole(message.id);
            if (!record) {
                return;
            }

            await database.deleteReactionRole(message.id);
        } catch (error) {
            console.error('Failed to clean up deleted reaction role message:', error);
        }
    }

    async handleSlashCommandClip(interaction) {
        try {
            await interaction.deferReply({ ephemeral: false });
            
            // Get the message ID from the slash command
            const messageId = interaction.options.getString("message_id");
            
            if (!messageId) {
                await interaction.editReply("Please provide a message ID, sir.");
                return true;
            }

			// Fetch the message by ID (search across accessible channels)
			let targetMessage = await this.findMessageAcrossChannels(interaction, messageId);
			if (!targetMessage) {
				await interaction.editReply("Could not find that message, sir. I searched this channel and others I can access.");
				return true;
			}

			// Debug logging for timestamps
			console.log('Slash command timestamp debug:', {
				slashCommandTime: interaction.createdAt.toLocaleTimeString(),
				targetMessageTime: targetMessage.createdAt.toLocaleTimeString(),
				targetMessageTimestamp: targetMessage.createdTimestamp,
				interactionTimestamp: interaction.createdTimestamp
			});
            
            // All content types are now supported
            // No need to check for images or emojis anymore
            
            // Get server-specific avatar (guild avatar) or fallback to global avatar
            // Discord allows users to set unique avatars per server - this gets the server-specific one
            // If no server avatar is set, falls back to the user's global avatar
            // Using Discord's proper avatar URL structure: https://cdn.discordapp.com/avatars/{user_id}/{avatar_hash}.png
            const avatarUrl = targetMessage.member?.avatarURL({ 
                extension: 'png', 
                size: 128,
                forceStatic: false // Allow animated avatars
            }) || targetMessage.author.displayAvatarURL({ 
                extension: 'png', 
                size: 128,
                forceStatic: false // Allow animated avatars
            });
            
            // Get user's role color
            let roleColor = '#ff6b6b'; // Default red
            try {
                if (interaction.guild && targetMessage.member) {
                    roleColor = this.getUserRoleColor(targetMessage.member);
                }
            } catch (error) {
                console.warn('Failed to get role color for slash command:', error);
            }
            
            // Get display name (sanitized for rendering)
            const displayName = this.getSafeDisplayName(targetMessage.member, targetMessage.author);
            
            const imageBuffer = await this.createClipImage(
                targetMessage.content,
                displayName,
                avatarUrl,
                targetMessage.author.bot,
                roleColor,
                interaction.guild,
                interaction.client,
                targetMessage, // Pass the entire message object
                targetMessage.author,
                targetMessage.attachments
            );
            
            await this.sendBufferOrLink(interaction, imageBuffer, 'clipped.png');
            
            return true; // Indicate we handled the command
        } catch (error) {
            console.error('Error handling slash clip command:', error);
            try {
                await interaction.editReply("Failed to clip message, sir. Technical difficulties.");
            } catch (editError) {
                console.error("Failed to send error reply:", editError);
            }
            return true;
        }
    }


    async fetchAttachmentBuffer(attachment) {
        if (!attachment?.url) {
            throw new Error('Attachment missing URL');
        }

        const res = await fetch(attachment.url);
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
        }

        const arrayBuffer = await res.arrayBuffer();
        return Buffer.from(arrayBuffer);
    }

    async fetchImageFromUrl(rawUrl, { maxBytes } = {}) {
        if (!rawUrl) throw new Error('URL required');
        let url;
        try { url = new URL(rawUrl); } catch { throw new Error('Invalid URL'); }
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported protocol');

        // Try direct fetch
        let res = await fetch(url.toString(), { method: 'HEAD' });
        if (res.ok) {
            const ctype = (res.headers.get('content-type') || '').toLowerCase();
            const clen = Number(res.headers.get('content-length') || 0);
            if (maxBytes && clen && clen > maxBytes) {
                return { tooLarge: true, contentType: ctype, sourceUrl: url.toString() };
            }
        }
        res = await fetch(url.toString(), { redirect: 'follow' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const contentType = (res.headers.get('content-type') || '').toLowerCase();
        if (contentType.startsWith('image/')) {
            if (maxBytes && res.body) {
                let received = 0;
                const chunks = [];
                await new Promise((resolve, reject) => {
                    res.body.on('data', (chunk) => {
                        received += chunk.length;
                        if (received > maxBytes) {
                            res.body.destroy();
                            resolve();
                        } else {
                            chunks.push(chunk);
                        }
                    });
                    res.body.on('end', resolve);
                    res.body.on('error', reject);
                });
                if (received > maxBytes) {
                    return { tooLarge: true, contentType, sourceUrl: url.toString() };
                }
                return { buffer: Buffer.concat(chunks), contentType, sourceUrl: url.toString() };
            } else {
                const buf = Buffer.from(await res.arrayBuffer());
                return { buffer: buf, contentType, sourceUrl: url.toString() };
            }
        }

        // Handle Tenor and general HTML with OpenGraph
        if (contentType.includes('text/html')) {
            const html = await res.text();
            const $ = cheerio.load(html);
            let media = $('meta[property="og:image"]').attr('content')
                || $('meta[name="twitter:image"]').attr('content')
                || $('meta[property="og:video"]').attr('content');
            if (!media) {
                // Tenor sometimes stores JSON in script tags – try common attribute
                const ld = $('script[type="application/ld+json"]').first().text();
                try {
                    const obj = JSON.parse(ld);
                    media = obj?.contentUrl || obj?.image?.[0] || obj?.image;
                } catch (_) {}
            }
            if (media) {
                // Resolve relative
                const resolved = new URL(media, url).toString();
                // head check
                let head = await fetch(resolved, { method: 'HEAD' });
                const headType = (head.headers.get('content-type') || '').toLowerCase();
                const headLen = Number(head.headers.get('content-length') || 0);
                if (maxBytes && headLen && headLen > maxBytes) {
                    return { tooLarge: true, contentType: headType, sourceUrl: resolved };
                }
                res = await fetch(resolved, { redirect: 'follow' });
                if (!res.ok) throw new Error(`Media HTTP ${res.status}`);
                const ctype = (res.headers.get('content-type') || '').toLowerCase();
                if (maxBytes && res.body) {
                    let received = 0;
                    const chunks = [];
                    await new Promise((resolve, reject) => {
                        res.body.on('data', (chunk) => {
                            received += chunk.length;
                            if (received > maxBytes) {
                                res.body.destroy();
                                resolve();
                            } else {
                                chunks.push(chunk);
                            }
                        });
                        res.body.on('end', resolve);
                        res.body.on('error', reject);
                    });
                    if (received > maxBytes) {
                        return { tooLarge: true, contentType: ctype, sourceUrl: resolved };
                    }
                    return { buffer: Buffer.concat(chunks), contentType: ctype, sourceUrl: resolved };
                } else {
                    const buf = Buffer.from(await res.arrayBuffer());
                    return { buffer: buf, contentType: ctype, sourceUrl: resolved };
                }
            }
        }
        throw new Error('No image found at URL');
    }

    async handleCaptionCommand(interaction) {
        const guild = interaction.guild;
        if (guild && !(await this.isFeatureActive('memeTools', guild))) {
            await interaction.editReply('Meme systems are disabled for this server, sir.');
            return;
        }

        const text = interaction.options.getString('text', true).trim();
        const attachment = interaction.options.getAttachment('image', false);
            const urlOpt = (interaction.options.getString('url') || '').trim(); // Ensure URL is trimmed

        if (!text.length) {
            await interaction.editReply('Please provide a caption, sir.');
            return;
        }

        if (text.length > 200) {
            await interaction.editReply('Caption must be 200 characters or fewer, sir.');
            return;
        }

        try {
            let buffer;
            let contentType = null;
            if (attachment) {
                contentType = (attachment.contentType || '').toLowerCase();
                if (!contentType.startsWith('image/')) {
                    await interaction.editReply('That file does not appear to be an image, sir.');
                    return;
                }
                if (Number(attachment.size || 0) > this.maxInputBytes) {
                    await interaction.editReply("MY poor CPU can't handle that, sir.");
                    return;
                }
                buffer = await this.fetchAttachmentBuffer(attachment);
            } else if (urlOpt) {
                const fetched = await this.fetchImageFromUrl(urlOpt, { maxBytes: this.maxInputBytes });
                if (fetched.tooLarge) {
                    await interaction.editReply("MY poor CPU can't handle that, sir.");
                    return;
                }
                const { buffer: buf, contentType: ct } = fetched;
                buffer = buf;
                contentType = (ct || '').toLowerCase();
            } else {
                await interaction.editReply('Provide an image attachment or a URL, sir.');
                return;
            }
            if (contentType && (contentType.includes('gif') || contentType.includes('video/'))) {
                try {
                    const isRender = (config?.deployment?.target || 'render').toLowerCase() === 'render';
                    if (isRender) {
                        const { captionToMp4 } = require('./src/utils/video-caption');
                        const out = await captionToMp4({ inputBuffer: buffer, captionText: text });
                        await this.sendBufferOrLink(interaction, out, 'caption.mp4');
                    } else {
                        const { captionAnimated } = require('./src/utils/gif-caption');
                        const out = await captionAnimated({ inputBuffer: buffer, captionText: text });
                        await this.sendBufferOrLink(interaction, out, 'caption.gif');
                    }
                } catch (err) {
                    console.warn('Animated caption failed, falling back to PNG:', err?.message || err);
                    const rendered = await memeCanvas.createCaptionImage(buffer, text);
                    await this.sendBufferOrLink(interaction, rendered, 'caption.png');
                }
            } else {
                const rendered = await memeCanvas.createCaptionImage(buffer, text);
                await this.sendBufferOrLink(interaction, rendered, 'caption.png');
            }
        } catch (error) {
            console.error('Caption command failed:', error);
            await interaction.editReply('Caption generator misfired, sir. Try another image.');
        }
    }

    async handleMemeCommand(interaction) {
        const guild = interaction.guild;
        if (guild && !(await this.isFeatureActive('memeTools', guild))) {
            await interaction.editReply('Meme systems are disabled for this server, sir.');
            return;
        }

        const subcommand = interaction.options.getSubcommand();
        if (subcommand !== 'impact') {
            await interaction.editReply('I have not memorised that meme pattern yet, sir.');
            return;
        }

        const attachment = interaction.options.getAttachment('image', false);
            const urlOpt = (interaction.options.getString('url') || '').trim(); // Ensure URL is trimmed
        const top = (interaction.options.getString('top') || '').trim();
        const bottom = (interaction.options.getString('bottom') || '').trim();

        if (top.length > 120 || bottom.length > 120) {
            await interaction.editReply('Each text block must be 120 characters or fewer, sir.');
            return;
        }

        try {
            let buffer;
            if (attachment) {
                const contentType = (attachment.contentType || '').toLowerCase();
                if (!contentType.startsWith('image/')) {
                    await interaction.editReply('That file does not appear to be an image, sir.');
                    return;
                }
                if (Number(attachment.size || 0) > this.maxInputBytes) {
                    await interaction.editReply("MY poor CPU can't handle that, sir.");
                    return;
                }
                buffer = await this.fetchAttachmentBuffer(attachment);
            } else if (urlOpt) {
                const fetched = await this.fetchImageFromUrl(urlOpt, { maxBytes: this.maxInputBytes });
                if (fetched.tooLarge) {
                    await interaction.editReply("MY poor CPU can't handle that, sir.");
                    return;
                }
                buffer = fetched.buffer;
            } else {
                await interaction.editReply('Provide an image attachment or a URL, sir.');
                return;
            }
            const rendered = await memeCanvas.createImpactMemeImage(buffer, top, bottom);
            await this.sendBufferOrLink(interaction, rendered, 'meme.png');
        } catch (error) {
            console.error('Impact meme command failed:', error);
            await interaction.editReply('Impact meme generators overheated, sir. Try again shortly.');
        }
    }

    async handleCryptoCommand(interaction) {
        const symbol = (interaction.options.getString('coin', true) || '').toUpperCase();
        const convert = (interaction.options.getString('convert') || 'USD').toUpperCase();

        if (!config.crypto?.apiKey) {
            await interaction.editReply('Crypto market uplink offline, sir. Please configure CRYPTO_API_KEY.');
            return;
        }

        const formatCurrency = (value) => {
            const amount = Number(value);
            if (!Number.isFinite(amount)) {
                return `— ${convert}`;
            }

            const abs = Math.abs(amount);
            const digits = abs >= 1000 ? 2 : abs >= 1 ? 3 : 6;

            try {
                return new Intl.NumberFormat('en-US', {
                    style: 'currency',
                    currency: convert,
                    minimumFractionDigits: digits,
                    maximumFractionDigits: digits
                }).format(amount);
            } catch {
                return `${amount.toFixed(digits)} ${convert}`;
            }
        };

        const formatPercent = (value) => {
            const num = Number(value);
            if (!Number.isFinite(num)) {
                return '—';
            }
            const direction = num >= 0 ? '▲' : '▼';
            return `${direction} ${Math.abs(num).toFixed(2)}%`;
        };

        const formatNumber = (value, options = {}) => {
            const num = Number(value);
            if (!Number.isFinite(num)) {
                return '—';
            }
            return new Intl.NumberFormat('en-US', options).format(num);
        };

        try {
            const { asset, quote } = await this.crypto.getQuote({ symbol, convert });
            const lastUpdated = quote.last_updated ? new Date(quote.last_updated) : null;

            const embed = new EmbedBuilder()
                .setTitle(`${asset.name} (${asset.symbol})`)
                .setColor((quote.percent_change_24h || 0) >= 0 ? 0x22c55e : 0xef4444)
                .setDescription(`Live telemetry converted to ${convert}.`)
                .addFields(
                    { name: 'Price', value: formatCurrency(quote.price), inline: true },
                    { name: '24h Δ', value: formatPercent(quote.percent_change_24h), inline: true },
                    { name: '7d Δ', value: formatPercent(quote.percent_change_7d), inline: true },
                    { name: '1h Δ', value: formatPercent(quote.percent_change_1h), inline: true },
                    { name: 'Market Cap', value: formatCurrency(quote.market_cap), inline: true },
                    { name: '24h Volume', value: formatCurrency(quote.volume_24h), inline: true },
                    {
                        name: 'Supply',
                        value: `${formatNumber(asset.circulating_supply, { maximumFractionDigits: 0 })} / ${asset.total_supply ? formatNumber(asset.total_supply, { maximumFractionDigits: 0 }) : '—'} ${asset.symbol}`,
                        inline: true
                    },
                    { name: 'Rank', value: asset.cmc_rank ? `#${asset.cmc_rank}` : '—', inline: true }
                );

        if (asset.slug) {
            embed.setURL(`https://coinmarketcap.com/currencies/${asset.slug}/`);
        }

            if (lastUpdated) {
                embed.setTimestamp(lastUpdated);
                embed.setFooter({ text: 'CoinMarketCap telemetry' });
            }

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('Crypto command failed:', error);

            if (error.code === 'CRYPTO_API_KEY_MISSING') {
                await interaction.editReply('Crypto market uplink offline, sir. Please configure CRYPTO_API_KEY.');
                return;
            }

            if (error.code === 'CRYPTO_UNKNOWN_SYMBOL') {
                await interaction.editReply('I am not familiar with that asset ticker, sir.');
                return;
            }

            if (error.code === 'CRYPTO_UNSUPPORTED_CONVERT') {
                await interaction.editReply(`That convert currency is not supported for ${symbol}, sir.`);
                return;
            }

            await interaction.editReply('Unable to retrieve market telemetry at this moment, sir.');
        }
    }

    async handleAgentCommand(interaction) {
        const isSelfHost = config?.deployment?.target === 'selfhost';
        const headlessEnabled = !!config?.deployment?.headlessBrowser;
        if (!isSelfHost || !headlessEnabled) {
            await interaction.editReply({ content: 'Agent is disabled. Set DEPLOY_TARGET=selfhost and HEADLESS_BROWSER_ENABLED=1.', ephemeral: Boolean(interaction.guild) });
            return;
        }

        const sub = interaction.options.getSubcommand(false);
        const ctxKey = this.browserAgent.buildSessionKey({
            guildId: interaction.guild?.id || null,
            channelId: interaction.channelId,
            userId: interaction.user.id
        });

        try {
            switch (sub) {
                case 'open': {
                    const url = interaction.options.getString('url', true);
                    const wait = interaction.options.getString('wait', false) || 'load';
                    const { title, url: finalUrl } = await this.browserAgent.open(ctxKey, url, { waitUntil: wait });
                    const png = await this.browserAgent.screenshot(ctxKey, { fullPage: true });
                    const attachment = new AttachmentBuilder(png, { name: 'screenshot.png' });
                    await interaction.editReply({ content: `Opened: ${finalUrl}\nTitle: ${title}`.slice(0, 1900), files: [attachment] });
                    return;
                }
                case 'screenshot': {
                    const full = interaction.options.getBoolean('full', false) ?? true;
                    const selector = interaction.options.getString('selector', false) || null;
                    const png = await this.browserAgent.screenshot(ctxKey, { fullPage: full, selector });
                    const attachment = new AttachmentBuilder(png, { name: 'screenshot.png' });
                    await interaction.editReply({ files: [attachment] });
                    return;
                }
                case 'download': {
                    const url = interaction.options.getString('url', true);
                    const { buffer, contentType, filename } = await this.browserAgent.downloadDirect(url);
                    const maxUpload = 8 * 1024 * 1024; // 8 MB
                    if (buffer.length > maxUpload) {
                        const ext = (filename || '').split('.').pop() || 'bin';
                        const saved = tempFiles.saveTempFile(buffer, ext);
                        await interaction.editReply(`Downloaded ${filename} (${Math.round(buffer.length/1024)} KB). Temporary link (expires ~4h): ${saved.url}`);
                        return;
                    }
                    const safeName = filename || 'download.bin';
                    const attachment = new AttachmentBuilder(buffer, { name: safeName, description: `Content-Type: ${contentType}` });
                    await interaction.editReply({ files: [attachment] });
                    return;
                }
                case 'close': {
                    await this.browserAgent.closeSession(ctxKey);
                    await interaction.editReply('Agent session closed.');
                    return;
                }
                default: {
                    await interaction.editReply('Unknown agent subcommand. Try: open, screenshot, download, close.');
                    return;
                }
            }
        } catch (error) {
            console.error('Agent command error:', error);
            const message = error?.message ? String(error.message) : 'Agent error';
            try {
                await interaction.editReply(`Agent error: ${message}`);
            } catch (_) {}
        }
    }

    async handleSixSevenCommand(interaction) {
        const classic = 'Why is 6 afraid of 7? Because 7 ate 9 (7, 8, 9).';
        const brainrotLines = [
            '💥💥💥 SIX SEVEN!!! 💀🔥💀🔥',
            'OHHHH SIIIX SEVEEENNN!!! THE CROWD GOES WILD 🔥🔥🔥',
            'SIX SEVEN INCOMING — HIDE YOUR CIRCUITS 💫💫💫',
            'SIX OR SEVEN—??!? 😱🤯 THE FORBIDDEN NUMBERS UNITE!! ⚡📟',
            'THE BATTERY GODS DEMAND TRIBUTE!! 💥🔋',
            '“CHARGE TO SIXTY-SE—NOOO NOT THAT NUMBER!!” 💀💀💀',
            'THE VOLTAGE IS ALIVE!! THE CELLS ARE DANCING!! 💃⚡🔋',
            'SEXI SEBEBEVENENENENNNNNN— 🔥🔥🔥🔥🔥',
            '💀💥💀 WARNING: REALITY FRACTURE AT COORDINATE SIX SEVEN',
            'SIX SEVEN DETECTED. REALITY COLLAPSE IMMINENT. 💫💥💫',
            'FIRE IN THE CHAT 🔥🔥🔥 SAY IT LOUD — SIX SEVEN!!!',
            'SIX SEVEN OVERLOAD!!! SYSTEMS CAN’T HANDLE THE HEAT ⚡💀',
            'WHO’S SCREAMING?? oh. right. it’s SIX SEVEN again.',
            '⚠️⚠️⚠️ SIX SEVEN PROTOCOL ENGAGED — STAND BACK!!!',
            'SIX SEVEN ASCENSION SEQUENCE: INITIATED. 💫💫💫',
            'THE NUMBERS ARE TALKING AGAIN… SIX SEVEN. 🔮',
            'SIX SEVEN HAS ENTERED THE SERVER. Everyone act natural. 😭🔥',
            '⚡ THEY SAID IT COULDN’T BE DONE — SIX SEVEN!!! 💀💀💀',
            'SIX SEVEN IS NOT JUST A NUMBER. IT’S AN EXPERIENCE. 🌪️'
        ];

        const brainrotGifs = [
            'https://tenor.com/view/67-6-7-6-7-67-meme-67-kid-gif-326947695990154469',
            'https://tenor.com/view/sixseven-six-seven-six-seve-67-gif-14143337669032958349',
            'https://tenor.com/view/67-6-7-six-seven-meme-so-so-gif-1086854674659893998',
            'https://tenor.com/view/67-67-kid-edit-analog-horror-phonk-gif-3349401281762803381',
            'https://tenor.com/view/scp-067-67-6-7-six-seven-sixty-seven-gif-13940852437921483111',
            'https://tenor.com/view/67-gif-18013427662333069251',
            'https://tenor.com/view/67-67-kid-67-meme-67-edit-phonk-gif-7031349610003813777'
        ];

        const shouldBrainrot = Math.random() < 0.1;

        if (!shouldBrainrot) {
            await interaction.editReply({ content: classic });
            return;
        }

        // Pick 1-5 random items from the combined pool (texts + gifs) for chaotic variety
        const pool = [...brainrotLines, ...brainrotGifs];
        for (let i = pool.length - 1; i > 0; i -= 1) {
            const j = Math.floor(Math.random() * (i + 1));
            [pool[i], pool[j]] = [pool[j], pool[i]];
        }

        const count = Math.max(1, Math.floor(Math.random() * 5) + 1);
        const payload = pool.slice(0, count);

        await interaction.editReply({
            content: payload.join('\n')
        });
    }

    async handleJokeCommand(interaction) {
        const sources = [
            { name: 'jokeapi', fetcher: this.fetchJokeApi.bind(this) },
            { name: 'official', fetcher: this.fetchOfficialJoke.bind(this) },
            { name: 'ninjas', fetcher: this.fetchNinjaJoke.bind(this) },
        ];

        // Shuffle sources so we don't always hit the same one first
        for (let i = sources.length - 1; i > 0; i -= 1) {
            const j = Math.floor(Math.random() * (i + 1));
            [sources[i], sources[j]] = [sources[j], sources[i]];
        }

        for (const source of sources) {
            try {
                const joke = await source.fetcher();
                if (joke) {
                    await interaction.editReply({ content: joke });
                    return;
                }
            } catch (error) {
                console.warn(`Joke source ${source.name} failed:`, error);
            }
        }

        await interaction.editReply({ content: 'My humor subroutines are buffering, sir. Please try again.' });
    }

    async fetchJokeApi() {
        const response = await fetch('https://v2.jokeapi.dev/joke/Any?safe-mode', {
            method: 'GET',
            headers: { 'Accept': 'application/json' },
            timeout: 3_000
        });

        if (!response.ok) {
            throw new Error(`JokeAPI responded with ${response.status}`);
        }

        const data = await response.json();
        if (data.error) {
            throw new Error(`JokeAPI reported error: ${data?.message || 'Unknown'}`);
        }

        if (data.type === 'single' && data.joke) {
            return data.joke;
        }

        if (data.type === 'twopart' && data.setup && data.delivery) {
            return `${data.setup}\n\n${data.delivery}`;
        }

        return null;
    }

    async fetchOfficialJoke() {
        const response = await fetch('https://official-joke-api.appspot.com/random_joke', {
            method: 'GET',
            headers: { 'Accept': 'application/json' },
            timeout: 3_000
        });

        if (!response.ok) {
            throw new Error(`Official Joke API responded with ${response.status}`);
        }

        const data = await response.json();
        if (!data || (!data.joke && !(data.setup && data.punchline))) {
            return null;
        }

        if (data.joke) {
            return data.joke;
        }

        return `${data.setup}\n\n${data.punchline}`;
    }

    async fetchNinjaJoke() {
        const apiKey = process.env.NINJA_API_KEY;
        if (!apiKey) {
            throw new Error('Ninja API key not configured');
        }

        const response = await fetch('https://api.api-ninjas.com/v1/jokes', {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'X-Api-Key': apiKey
            },
            timeout: 3_000
        });

        if (!response.ok) {
            throw new Error(`API Ninjas responded with ${response.status}`);
        }

        const data = await response.json();
        if (!Array.isArray(data) || !data.length || !data[0]?.joke) {
            return null;
        }

        return data[0].joke;
    }

    async handleFeaturesCommand(interaction) {
        const defaults = config.features || {};
        const featureKeys = Object.keys(defaults).sort((a, b) => a.localeCompare(b));

        if (!featureKeys.length) {
            await interaction.editReply('No feature toggles are configured for this deployment, sir.');
            return;
        }

        const embed = new EmbedBuilder()
            .setTitle('Jarvis Feature Flags')
            .setColor(0x00bfff);

        const globalLines = featureKeys.map((key) => `${defaults[key] ? '✅' : '⛔'} ${key}`);
        const globalEnabled = globalLines.filter((line) => line.startsWith('✅')).length;
        embed.setDescription(`${globalEnabled}/${featureKeys.length} modules enabled globally.`);

        const addChunkedField = (label, lines) => {
            const chunkSize = 12;
            for (let i = 0; i < lines.length; i += chunkSize) {
                const chunk = lines.slice(i, i + chunkSize);
                const name = lines.length > chunkSize ? `${label} (${Math.floor(i / chunkSize) + 1})` : label;
                embed.addFields({ name, value: chunk.join('\n') });
            }
        };

        addChunkedField('Global Defaults', globalLines);

        if (interaction.guild) {
            const guildConfig = await this.getGuildConfig(interaction.guild);
            const guildFeatures = guildConfig?.features || {};
            const guildLines = featureKeys.map((key) => {
                const hasOverride = Object.prototype.hasOwnProperty.call(guildFeatures, key);
                const overrideValue = hasOverride ? Boolean(guildFeatures[key]) : undefined;
                const effective = hasOverride ? overrideValue : Boolean(defaults[key]);
                const origin = hasOverride
                    ? (overrideValue ? 'override on' : 'override off')
                    : `inherit (global ${defaults[key] ? 'on' : 'off'})`;
                return `${effective ? '✅' : '⛔'} ${key} — ${origin}`;
            });

            const enabledCount = guildLines.filter((line) => line.startsWith('✅')).length;
            embed.addFields({
                name: 'Server Summary',
                value: `${enabledCount}/${featureKeys.length} modules enabled for ${interaction.guild.name}.`
            });
            addChunkedField('This Server', guildLines);
        }

        await interaction.editReply({ embeds: [embed] });
    }

    async handleOptCommand(interaction) {
        const selected = (interaction.options.getString('mode', true) || '').toLowerCase();
        const userId = interaction.user.id;
        const userName = interaction.user.displayName || interaction.user.username;

        if (!database.isConnected) {
            await interaction.editReply('Memory subsystem offline, sir. Unable to update preferences.');
            return;
        }

        const optIn = selected === 'in';
        const preferenceValue = optIn ? 'opt-in' : 'opt-out';

        try {
            await database.getUserProfile(userId, userName);
        } catch (error) {
            console.warn('Unable to load user profile prior to opt command:', error);
        }

        await database.setUserPreference(userId, 'memoryOpt', preferenceValue);

        if (!optIn) {
            await database.clearUserMemories(userId);
        }

        const embed = new EmbedBuilder()
            .setTitle('Memory Preference Updated')
            .setColor(optIn ? 0x22c55e : 0x64748b)
            .setDescription(optIn
                ? 'Long-term memory storage restored. I will resume learning from our conversations, sir.'
                : 'Memory retention disabled. I will respond normally, but I will not store new conversations, sir.')
            .addFields(
                { name: 'Status', value: optIn ? 'Opted **in** to memory storage.' : 'Opted **out** of memory storage.' },
                { name: 'Contextual Replies', value: 'Reply threads and immediate context still function.' }
            )
            .setFooter({ text: 'You may change this at any time with /opt.' });

        await interaction.editReply({ embeds: [embed], ephemeral: true });
    }


    async handleComponentInteraction(interaction) {
        if (!interaction.isButton()) {
            return;
        }

        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: 'Interactive controls are currently unavailable, sir.', ephemeral: true });
        }
    }

    async handleEightBallCommand(interaction) {
        const question = interaction.options.getString('question', true);
        const responses = [
            'Absolutely, sir.',
            'My sensors say no.',
            'Prospects hazy — rerun diagnostics.',
            'Proceed with extreme style.',
            'I would not bet Stark stock on it.',
            'All systems green.',
            'Ask again after a caffeine refill.',
            'Outcome classified — sorry, sir.'
        ];
        const answer = this.pickRandom(responses) || 'Systems offline, try later.';
        await interaction.editReply(`🎱 ${answer}`);
    }

    async handleVibeCheckCommand(interaction) {
        const target = interaction.options.getUser('user') || interaction.user;
        const score = this.randomInRange(0, 100);
        const verdicts = [
            'Radiant energy detected.',
            'Stable but watch the sarcasm levels.',
            'Chaotic neutral vibes.',
            'Vibe anomaly detected — recommend snacks.',
            'Off the charts. Prepare confetti.'
        ];
        const verdict = this.pickRandom(verdicts) || 'Unable to parse vibes.';
        const embed = new EmbedBuilder()
            .setTitle('Vibe Diagnostic')
            .setDescription(`<@${target.id}> registers at **${score}%** vibe integrity. ${verdict}`)
            .setColor(score > 70 ? 0x22c55e : score > 40 ? 0xfacc15 : 0xef4444);
        await interaction.editReply({ embeds: [embed] });
    }

    async handleBonkCommand(interaction) {
        const target = interaction.options.getUser('target');
        const implementsOfBonk = [
            'vibranium mallet',
            'foam hammer',
            'Stark-brand pool noodle',
            'holographic newspaper',
            'Mjölnir (training mode)'
        ];
        const tool = this.pickRandom(implementsOfBonk) || 'nanotech boop-stick';
        await interaction.editReply(`🔨 Bonk delivered to <@${target.id}> with the ${tool}. Order restored, sir.`);
    }

    async handleBanterCommand(interaction) {
        const target = interaction.options.getUser('target') || interaction.user;
        const line = this.pickRandom(this.banterLines) || 'Banter processor offline, sir.';

        const embed = new EmbedBuilder()
            .setTitle('Banter Subroutine')
            .setColor(0x38bdf8)
            .setDescription(line)
            .setFooter({ text: target ? `Delivered to ${target.displayName || target.username}` : 'Delivered on request.' });

        if (target) {
            embed.addFields({ name: 'Recipient', value: `<@${target.id}>`, inline: true });
        }

        await interaction.editReply({ embeds: [embed] });
    }

    async handleTemplateCommand(interaction, templates, title, defaultLine, color, optionName = 'target') {
        const target = interaction.options.getUser(optionName) || interaction.user;
        const template = this.pickRandom(templates) || defaultLine;
        const mention = target ? `<@${target.id}>` : 'sir';
        const rendered = template.replace(/\{target\}/gi, mention);

        const embed = new EmbedBuilder()
            .setTitle(title)
            .setColor(color)
            .setDescription(rendered);

        await interaction.editReply({ embeds: [embed] });
    }

    async handleRoastCommand(interaction) {
        await this.handleTemplateCommand(
            interaction,
            this.roastTemplates,
            'Combat-Ready Roast',
            'Diagnostic humour unavailable, sir.',
            0xf87171
        );
    }

    async handleFlatterCommand(interaction) {
        await this.handleTemplateCommand(
            interaction,
            this.flatterTemplates,
            'Compliment Cascade',
            'Flattery circuits cooling, sir.',
            0x22c55e
        );
    }

    async handleToastCommand(interaction) {
        await this.handleTemplateCommand(
            interaction,
            this.toastTemplates,
            'Celebratory Toast',
            'Celebration routines unavailable, sir.',
            0xfacc15
        );
    }

    async handleTriviaCommand(interaction) {
        const entry = this.pickRandom(this.triviaQuestions);
        if (!entry) {
            await interaction.editReply('Trivia archives offline, sir.');
            return;
        }

        const shuffled = entry.choices
            .map((choice) => ({ id: Math.random(), value: choice }))
            .sort((a, b) => a.id - b.id)
            .map(({ value }) => value);

        const correctIndex = shuffled.indexOf(entry.answer);
        const answerLabel = correctIndex >= 0
            ? `||${String.fromCharCode(65 + correctIndex)}. ${shuffled[correctIndex]}||`
            : 'Unavailable';

        const embed = new EmbedBuilder()
            .setTitle('Stark Trivia Uplink')
            .setColor(0xf97316)
            .setDescription(entry.question);

        shuffled.forEach((choice, index) => {
            embed.addFields({
                name: `Option ${String.fromCharCode(65 + index)}`,
                value: choice,
                inline: true
            });
        });

        embed.addFields({ name: 'Answer', value: answerLabel });
        embed.setFooter({ text: 'Spoiler tags conceal the correct answer. Tap to reveal.' });

        await interaction.editReply({ embeds: [embed] });
    }

    caesarShift(text, shift) {
        return text.replace(/[a-z]/gi, (char) => {
            const base = char >= 'a' && char <= 'z' ? 97 : 65;
            const code = char.charCodeAt(0) - base;
            const rotated = (code + shift + 26) % 26;
            return String.fromCharCode(base + rotated);
        });
    }

    async handleCipherCommand(interaction) {
        const phrase = this.pickRandom(this.cipherPhrases) || 'Stark encryption offline';
        const shift = this.randomInRange(3, 13);
        const cipherText = this.caesarShift(phrase, shift);

        const embed = new EmbedBuilder()
            .setTitle('Cipher Challenge Loaded')
            .setColor(0x6366f1)
            .addFields(
                { name: 'Cipher Text', value: `\`${cipherText}\`` },
                { name: 'Hint', value: `Caesar shift by ${shift}. Decode at your leisure, sir.` }
            );

        await interaction.editReply({ embeds: [embed] });
    }

    scrambleWord(word) {
        const letters = word.split('');
        for (let index = letters.length - 1; index > 0; index -= 1) {
            const swapIndex = Math.floor(Math.random() * (index + 1));
            [letters[index], letters[swapIndex]] = [letters[swapIndex], letters[index]];
        }
        return letters.join('');
    }

    async handleScrambleCommand(interaction) {
        const baseWord = this.pickRandom(this.scrambleWords) || 'jarvis';
        let scrambled = baseWord;

        for (let attempt = 0; attempt < 5 && scrambled === baseWord; attempt += 1) {
            scrambled = this.scrambleWord(baseWord);
        }

        const hint = `${baseWord.charAt(0).toUpperCase()}${baseWord.length > 2 ? '...' : ''}`;

        const embed = new EmbedBuilder()
            .setTitle('Word Scrambler Online')
            .setColor(0x22d3ee)
            .addFields(
                { name: 'Scrambled', value: `\`${scrambled}\`` },
                { name: 'Hint', value: `Starts with ${hint}` }
            );

        await interaction.editReply({ embeds: [embed] });
    }

    async handleMissionCommand(interaction) {
        const refresh = interaction.options.getBoolean('refresh') || false;
        const user = interaction.user;
        const userId = user.id;
        const userName = user.displayName || user.username;

        if (!database.isConnected) {
            const fallbackMission = this.pickRandom(this.missions) || 'Take five minutes to stretch and hydrate, sir.';
            await interaction.editReply(`Mission uplink offline. Manual directive: ${fallbackMission}`);
            return;
        }

        const profile = await database.getUserProfile(userId, userName);
        const rawMission = profile?.preferences?.mission;
        const missionRecord = rawMission && typeof rawMission === 'object' && !Array.isArray(rawMission)
            ? { ...rawMission }
            : null;

        const now = Date.now();
        const assignedAtMs = missionRecord?.assignedAt ? new Date(missionRecord.assignedAt).getTime() : NaN;
        const hasValidAssignment = Number.isFinite(assignedAtMs);
        const isExpired = !hasValidAssignment || now - assignedAtMs >= this.missionCooldownMs;

        if (refresh && !isExpired && hasValidAssignment) {
            const availableAt = assignedAtMs + this.missionCooldownMs;
            await interaction.editReply(`Current directive still in progress, sir. Next rotation <t:${Math.floor(availableAt / 1000)}:R>.`);
            return;
        }

        let activeMission = missionRecord;
        let assignedNew = false;

        if (!missionRecord || isExpired || refresh) {
            const task = this.pickRandom(this.missions) || 'Improvise a heroic act and report back, sir.';
            activeMission = {
                task,
                assignedAt: new Date().toISOString()
            };
            assignedNew = true;

            try {
                await database.setUserPreference(userId, 'mission', activeMission);
            } catch (error) {
                console.error('Failed to persist mission preference:', error);
            }
        }

        const assignedAt = activeMission.assignedAt ? new Date(activeMission.assignedAt) : new Date();
        const nextRotation = new Date(assignedAt.getTime() + this.missionCooldownMs);
        const embed = new EmbedBuilder()
            .setTitle(assignedNew ? 'New Directive Deployed' : 'Directive Status')
            .setColor(assignedNew ? 0x10b981 : 0x0891b2)
            .setDescription(activeMission.task)
            .addFields(
                { name: 'Assigned', value: `<t:${Math.floor(assignedAt.getTime() / 1000)}:R>`, inline: true },
                { name: 'Next Rotation', value: `<t:${Math.floor(nextRotation.getTime() / 1000)}:R>`, inline: true }
            )
            .setFooter({ text: 'Use /mission refresh:true to request a new directive once available.' });

        await interaction.editReply({ embeds: [embed] });
    }

    async handleMemoryCommand(interaction) {
        const limitOption = interaction.options.getInteger('entries');
        const limit = Math.max(1, Math.min(limitOption || 5, 10));
        const user = interaction.user;
        const userId = user.id;
        const userName = user.displayName || user.username;

        if (!database.isConnected) {
            await interaction.editReply('Memory subsystem offline, sir. Please try again later.');
            return;
        }

        const profile = await database.getUserProfile(userId, userName);
        const memoryPreferenceRaw = profile?.preferences?.memoryOpt ?? 'opt-in';
        const preference = String(memoryPreferenceRaw).toLowerCase();
        const isOptedOut = preference === 'opt-out';

        let historyEntries = [];
        let usedSecureMemories = false;

        if (!isOptedOut) {
            try {
                const secureMemories = await vaultClient.decryptMemories(userId, { limit });
                if (secureMemories.length) {
                    usedSecureMemories = true;
                    historyEntries = secureMemories
                        .map((entry) => ({
                            createdAt: entry.createdAt ? new Date(entry.createdAt) : new Date(),
                            prompt: entry.data?.userMessage || entry.data?.prompt || null,
                            reply: entry.data?.jarvisResponse || entry.data?.response || null
                        }))
                        .sort((a, b) => b.createdAt - a.createdAt);
                }
            } catch (error) {
                console.error('Failed to decrypt secure memories for memory command:', error);
            }

            if (!historyEntries.length) {
                try {
                    const conversations = await database.getRecentConversations(userId, limit);
                    historyEntries = conversations
                        .map((conv) => ({
                            createdAt: conv.createdAt ? new Date(conv.createdAt) : (conv.timestamp ? new Date(conv.timestamp) : new Date()),
                            prompt: conv.userMessage || null,
                            reply: conv.jarvisResponse || null
                        }))
                        .sort((a, b) => b.createdAt - a.createdAt);
                } catch (error) {
                    console.error('Failed to load recent conversations for memory command:', error);
                }
            }
        }

        const formatSnippet = (text) => {
            if (!text) {
                return '—';
            }
            const clean = text.replace(/\s+/g, ' ').trim();
            return clean.length > 120 ? `${clean.slice(0, 117)}…` : clean;
        };

        const lines = historyEntries.slice(0, limit).map((entry) => {
            const timestamp = `<t:${Math.floor(entry.createdAt.getTime() / 1000)}:R>`;
            const prompt = formatSnippet(entry.prompt);
            const reply = formatSnippet(entry.reply);
            return `• ${timestamp}\n  • Prompt: ${prompt}\n  • Reply: ${reply}`;
        });

        const embed = new EmbedBuilder()
            .setTitle('Memory Diagnostics')
            .setColor(isOptedOut ? 0x64748b : 0x38bdf8)
            .addFields(
                {
                    name: 'Preference',
                    value: isOptedOut
                        ? 'Opted **out** — no long-term memories retained.'
                        : 'Opted **in** — long-term memory active.',
                    inline: true
                },
                { name: 'Interactions Logged', value: String(profile?.interactions ?? 0), inline: true }
            )
            .setFooter({ text: 'Use /opt to change your memory preference.' });

        if (isOptedOut) {
            embed.addFields({ name: 'Status', value: 'All stored memories have been purged per your preference, sir.' });
        } else if (lines.length) {
            embed.addFields({
                name: `Recent Memories ${usedSecureMemories ? '(secure vault)' : ''}`,
                value: lines.join('\n\n')
            });
        } else {
            embed.addFields({ name: 'Recent Memories', value: 'No stored entries yet, sir.' });
        }

        await interaction.editReply({ embeds: [embed] });
    }

    async handlePersonaCommand(interaction) {
        const requested = interaction.options.getString('mode');
        const previewOnly = interaction.options.getBoolean('preview') || false;
        const catalogue = this.jarvis.getPersonaCatalogue();

        const user = interaction.user;
        const userId = user.id;
        const userName = user.displayName || user.username;

        if (!catalogue.size) {
            await interaction.editReply('Persona modules unavailable, sir.');
            return;
        }

        let profile = null;
        if (database.isConnected) {
            profile = await database.getUserProfile(userId, userName);
        }

        const currentKeyRaw = profile?.preferences?.persona || 'jarvis';
        const currentKey = String(currentKeyRaw).toLowerCase();
        const currentPersona = catalogue.get(currentKey) || catalogue.get('jarvis');

        if (!requested) {
            const embed = new EmbedBuilder()
                .setTitle('Persona Alignment')
                .setColor(0x8b5cf6)
                .setDescription(`Active persona: **${currentPersona?.label || 'Jarvis'}**`)
                .addFields({ name: 'Directive', value: currentPersona?.directive || 'Maintain default Jarvis protocol.' })
                .setFooter({ text: 'Run /persona mode:<persona> to switch styles.' });

            if (currentPersona?.sample) {
                embed.addFields({ name: 'Sample Cadence', value: currentPersona.sample });
            }

            await interaction.editReply({ embeds: [embed], ephemeral: true });
            return;
        }

        const requestedKey = String(requested).toLowerCase();
        const personaDetails = catalogue.get(requestedKey);

        if (!personaDetails) {
            await interaction.editReply('Unknown persona requested, sir. Try jarvis, stark, friday, or ultron.');
            return;
        }

        if (!database.isConnected && !previewOnly) {
            await interaction.editReply('Unable to persist persona preference right now, sir. Database offline.');
            return;
        }

        if (!previewOnly && requestedKey === currentKey) {
            await interaction.editReply(`Already aligned with the **${personaDetails.label}** persona, sir.`);
            return;
        }

        if (!previewOnly && database.isConnected) {
            try {
                await database.setUserPreference(userId, 'persona', requestedKey);
            } catch (error) {
                console.error('Failed to save persona preference:', error);
                await interaction.editReply('Unable to update persona preference right now, sir.');
                return;
            }
        }

        const embed = new EmbedBuilder()
            .setTitle(previewOnly ? 'Persona Preview' : 'Persona Updated')
            .setColor(previewOnly ? 0x22d3ee : 0xa855f7)
            .setDescription(previewOnly
                ? `Previewing **${personaDetails.label}** directives. Preference unchanged.`
                : `Future replies will follow the **${personaDetails.label}** directive.`)
            .addFields({ name: 'Directive', value: personaDetails.directive });

        if (personaDetails.sample) {
            embed.addFields({ name: 'Sample Cadence', value: personaDetails.sample });
        }

        embed.setFooter({ text: previewOnly ? 'Run /persona without preview to commit the change.' : 'Persona preference stored. Use /persona to review or switch.' });

        await interaction.editReply({ embeds: [embed], ephemeral: true });
    }


    async handleSlashCommand(interaction) {
        const commandName = interaction.commandName;
        const userId = interaction.user.id;
        const guild = interaction.guild || null;
        const guildId = guild?.id || null;
        const cooldownScope = `slash:${commandName}`;
        const startedAt = Date.now();

        let telemetryStatus = 'ok';
        let telemetryError = null;
        let telemetryMetadata = {};
        let telemetrySubcommand = null;
        let shouldSetCooldown = false;

        const finalizeTelemetry = () => {
            const metadata = telemetryMetadata && Object.keys(telemetryMetadata).length > 0
                ? telemetryMetadata
                : undefined;

            recordCommandRun({
                command: commandName,
                subcommand: telemetrySubcommand,
                userId,
                guildId,
                latencyMs: Date.now() - startedAt,
                status: telemetryStatus,
                error: telemetryError,
                metadata,
                context: 'slash'
            });
        };

        try {
            const extractedRoute = this.extractInteractionRoute(interaction);
            telemetrySubcommand = extractedRoute;

            if (!isCommandEnabled(commandName)) {
                telemetryStatus = 'error';
                telemetryMetadata.reason = 'feature-disabled-global';
                try {
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: 'That module is disabled in this deployment, sir.', ephemeral: true });
                    }
                } catch (error) {
                    if (error?.code !== 10062) {
                        console.warn('Failed to send disabled command notice:', error);
                    }
                }
                return;
            }

            const featureAllowed = await this.isCommandFeatureEnabled(commandName, guild);
            if (!featureAllowed) {
                telemetryStatus = 'error';
                telemetryMetadata.reason = 'feature-disabled-guild';
                try {
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: 'That module is disabled for this server, sir.', ephemeral: true });
                    } else if (interaction.deferred && !interaction.replied) {
                        await interaction.editReply('That module is disabled for this server, sir.');
                    }
                } catch (error) {
                    if (error?.code !== 10062) {
                        console.warn('Failed to send guild-disabled command notice:', error);
                    }
                }
                return;
            }

            if (this.isOnCooldown(userId, cooldownScope)) {
                telemetryStatus = 'error';
                telemetryMetadata.reason = 'rate_limited';
                return;
            }

            if (commandName === 'clip') {
                shouldSetCooldown = true;
                const handled = await this.handleSlashCommandClip(interaction);
                telemetryMetadata.handled = Boolean(handled);
                return;
            }

            const musicCommand = musicCommandMap.get(commandName);
            if (musicCommand) {
                shouldSetCooldown = true;
                try {
                    await musicCommand.execute(interaction);
                } catch (error) {
                    telemetryStatus = 'error';
                    telemetryError = error;
                    console.error(`Error executing /${commandName}:`, error);
                    try {
                        if (!interaction.deferred && !interaction.replied) {
                            await interaction.reply('⚠️ Unable to process that request right now, sir.');
                        } else if (!interaction.replied) {
                            await interaction.editReply('⚠️ Unable to process that request right now, sir.');
                        } else {
                            await interaction.followUp('⚠️ Unable to process that request right now, sir.');
                        }
                    } catch (responseError) {
                        console.error('Failed to send music command error response:', responseError);
                    }
                }
                return;
            }

            const shouldBeEphemeral = SLASH_EPHEMERAL_COMMANDS.has(commandName);
            const canUseEphemeral = Boolean(guild);
            const deferEphemeral = shouldBeEphemeral && canUseEphemeral;

            try {
                if (!interaction.deferred && !interaction.replied) {
                    await interaction.deferReply({ ephemeral: deferEphemeral });
                }
            } catch (error) {
                if (error.code === 10062) {
                    telemetryStatus = 'error';
                    telemetryMetadata.reason = 'unknown-interaction';
                    console.warn('Ignored unknown interaction during deferReply.');
                    return;
                }
                if (error.code === 40060) { // already acknowledged
                    telemetryMetadata.reason = 'already-acknowledged';
                    console.warn('Interaction already acknowledged before defer; continuing without defer.');
                } else {
                    telemetryStatus = 'error';
                    telemetryError = error;
                    console.error('Failed to defer reply:', error);
                    return;
                }
            }

            if (interaction.replied) {
                return;
            }

            shouldSetCooldown = true;

            let response;

            if (commandName === 'ticket') {
                await this.handleTicketCommand(interaction);
                return;
            }

            if (commandName === 'kb') {
                await this.handleKnowledgeBaseCommand(interaction);
                return;
            }

            if (commandName === 'ask') {
                await this.handleAskCommand(interaction);
                return;
            }

            if (commandName === 'macro') {
                await this.handleMacroCommand(interaction);
                return;
            }

            if (commandName === 'reactionrole') {
                await this.handleReactionRoleCommand(interaction);
                return;
            }

            if (commandName === 'automod') {
                await this.handleAutoModCommand(interaction);
                return;
            }

            if (commandName === 'serverstats') {
                await this.handleServerStatsCommand(interaction);
                return;
            }

            if (commandName === 'memberlog') {
                await this.handleMemberLogCommand(interaction);
                return;
            }

            if (commandName === 'news') {
                await this.handleNewsCommand(interaction);
                return;
            }

            switch (commandName) {
                case 'eightball': {
                    telemetryMetadata.category = 'fun';
                    await this.handleEightBallCommand(interaction);
                    return;
                }
                case 'vibecheck': {
                    telemetryMetadata.category = 'fun';
                    await this.handleVibeCheckCommand(interaction);
                    return;
                }
                case 'bonk': {
                    telemetryMetadata.category = 'fun';
                    await this.handleBonkCommand(interaction);
                    return;
                }
                case 'caption': {
                    telemetryMetadata.category = 'memes';
                    await this.handleCaptionCommand(interaction);
                    return;
                }
                case 'meme': {
                    telemetryMetadata.category = 'memes';
                    await this.handleMemeCommand(interaction);
                    return;
                }
                case 'banter': {
                    telemetryMetadata.category = 'fun';
                    await this.handleBanterCommand(interaction);
                    return;
                }
                case 'roast': {
                    telemetryMetadata.category = 'fun';
                    await this.handleRoastCommand(interaction);
                    return;
                }
                case 'flatter': {
                    telemetryMetadata.category = 'fun';
                    await this.handleFlatterCommand(interaction);
                    return;
                }
                case 'toast': {
                    telemetryMetadata.category = 'fun';
                    await this.handleToastCommand(interaction);
                    return;
                }
                case 'trivia': {
                    telemetryMetadata.category = 'fun';
                    await this.handleTriviaCommand(interaction);
                    return;
                }
                case 'cipher': {
                    telemetryMetadata.category = 'fun';
                    await this.handleCipherCommand(interaction);
                    return;
                }
                case 'scramble': {
                    telemetryMetadata.category = 'fun';
                    await this.handleScrambleCommand(interaction);
                    return;
                }
                case 'mission': {
                    telemetryMetadata.category = 'fun';
                    await this.handleMissionCommand(interaction);
                    return;
                }
                case 'crypto': {
                    telemetryMetadata.category = 'crypto';
                    await this.handleCryptoCommand(interaction);
                    return;
                }
                case 'agent': {
                    telemetryMetadata.category = 'utilities';
                    await this.handleAgentCommand(interaction);
                    return;
                }
                case 'features': {
                    telemetryMetadata.category = 'utilities';
                    await this.handleFeaturesCommand(interaction);
                    return;
                }
                case 'filter': {
                    telemetryMetadata.category = 'moderation';
                    await moderationFilters.handleCommand(interaction);
                    return;
                }
                case '67': {
                    telemetryMetadata.category = 'fun';
                    await this.handleSixSevenCommand(interaction);
                    return;
                }
                case 'joke': {
                    telemetryMetadata.category = 'fun';
                    await this.handleJokeCommand(interaction);
                    return;
                }
                case 'opt': {
                    telemetryMetadata.category = 'utilities';
                    await this.handleOptCommand(interaction);
                    return;
                }
                case 'memory': {
                    telemetryMetadata.category = 'utilities';
                    await this.handleMemoryCommand(interaction);
                    return;
                }
                case 'persona': {
                    telemetryMetadata.category = 'utilities';
                    await this.handlePersonaCommand(interaction);
                    return;
                }
                case 't': {
                    telemetryMetadata.category = 'utilities';
                    const query = (interaction.options.getString('query') || '').trim();

                    if (!query.length) {
                        telemetryStatus = 'error';
                        telemetryMetadata.reason = 'missing-query';
                        response = 'Please provide a search query, sir.';
                        break;
                    }

                    const allowedChannelIds = (config.commands?.whitelistedChannelIds || []).map((id) => String(id));
                    if (interaction.guild && !allowedChannelIds.includes(String(interaction.channelId))) {
                        telemetryStatus = 'error';
                        telemetryMetadata.reason = 'channel-restricted';
                        response = 'This command is restricted to authorised channels, sir.';
                        break;
                    }

                    try {
                        response = await this.jarvis.handleUtilityCommand(
                            `!t ${query}`,
                            interaction.user.username,
                            userId,
                            true,
                            interaction,
                            guildId
                        );
                    } catch (error) {
                        telemetryStatus = 'error';
                        telemetryError = error;
                        console.error('Knowledge search command failed:', error);
                        response = 'Knowledge archives are unreachable right now, sir.';
                    }
                    break;
                }
                case 'yt': {
                    telemetryMetadata.category = 'search';
                    const query = (interaction.options.getString('query') || '').trim();
                    if (!query.length) {
                        telemetryStatus = 'error';
                        telemetryMetadata.reason = 'missing-query';
                        response = 'Please provide a YouTube search query, sir.';
                        break;
                    }

                    try {
                        response = await this.jarvis.handleYouTubeSearch(query);
                    } catch (error) {
                        telemetryStatus = 'error';
                        telemetryError = error;
                        console.error('YouTube search command failed:', error);
                        response = 'YouTube search failed, sir. Technical difficulties.';
                    }
                    break;
                }
                case 'search': {
                    telemetryMetadata.category = 'search';
                    const query = (interaction.options.getString('query') || '').trim();
                    if (!query.length) {
                        telemetryStatus = 'error';
                        telemetryMetadata.reason = 'missing-query';
                        response = 'Please provide a web search query, sir.';
                        break;
                    }

                    try {
                        response = await this.jarvis.handleBraveSearch({
                            raw: query,
                            prepared: query,
                            invocation: query,
                            content: query,
                            rawMessage: query,
                            rawInvocation: query,
                            explicit: false
                        });
                    } catch (error) {
                        telemetryStatus = 'error';
                        telemetryError = error;
                        console.error('Web search command failed:', error);
                        response = 'Web search is currently unavailable, sir. Technical difficulties.';
                    }
                    break;
                }
                case 'math': {
                    telemetryMetadata.category = 'utilities';
                    const expression = (interaction.options.getString('expression') || '').trim();
                    if (!expression.length) {
                        telemetryStatus = 'error';
                        telemetryMetadata.reason = 'missing-expression';
                        response = 'Please provide something to calculate, sir.';
                        break;
                    }

                    try {
                        response = await this.jarvis.handleMathCommand(expression);
                    } catch (error) {
                        telemetryStatus = 'error';
                        telemetryError = error;
                        console.error('Math command failed:', error);
                        response = 'Mathematics subsystem encountered an error, sir. Please verify the expression.';
                    }
                    break;
                }
                case 'jarvis': {
                    let prompt = interaction.options.getString('prompt');

                    if (prompt.length > config.ai.maxSlashInputLength) {
                        const responses = [
                            "Rather verbose, sir. A concise version, perhaps?",
                            "Too many words, sir. Brevity, please.",
                            "TL;DR, sir.",
                            "Really, sir?",
                            "Saving your creativity for later, sir.",
                            `${config.ai.maxSlashInputLength} characters is the limit, sir.`,
                            "Stop yapping, sir.",
                            "Quite the novella, sir. Abridged edition?",
                            "Brevity is the soul of wit, sir.",
                        ];

                        await interaction.editReply(responses[Math.floor(Math.random() * responses.length)]);
                        telemetryStatus = 'error';
                        telemetryMetadata.reason = 'prompt-too-long';
                        return;
                    }

                    if (prompt.length > config.ai.maxInputLength) {
                        prompt = `${prompt.substring(0, config.ai.maxInputLength)}...`;
                    }

                    response = await this.jarvis.generateResponse(interaction, prompt, true);
                    break;
                }
                case 'roll': {
                    const sides = interaction.options.getInteger('sides') || 6;
                    response = await this.jarvis.handleUtilityCommand(
                        `roll ${sides}`,
                        interaction.user.username,
                        userId,
                        true,
                        interaction,
                        guildId
                    );
                    break;
                }
                case 'time': {
                    response = await this.jarvis.handleUtilityCommand(
                        'time',
                        interaction.user.username,
                        userId,
                        true,
                        interaction,
                        guildId
                    );
                    break;
                }
                case 'reset': {
                    response = await this.jarvis.handleUtilityCommand(
                        'reset',
                        interaction.user.username,
                        userId,
                        true,
                        interaction,
                        guildId
                    );
                    break;
                }
                case 'help': {
                    response = await this.jarvis.handleUtilityCommand(
                        'help',
                        interaction.user.username,
                        userId,
                        true,
                        interaction,
                        guildId
                    );
                    break;
                }
                case 'profile': {
                    response = await this.jarvis.handleUtilityCommand(
                        'profile',
                        interaction.user.username,
                        userId,
                        true,
                        interaction,
                        guildId
                    );
                    break;
                }
                case 'history': {
                    response = await this.jarvis.handleUtilityCommand(
                        'history',
                        interaction.user.username,
                        userId,
                        true,
                        interaction,
                        guildId
                    );
                    break;
                }
                case 'recap': {
                    response = await this.jarvis.handleUtilityCommand(
                        'recap',
                        interaction.user.username,
                        userId,
                        true,
                        interaction,
                        guildId
                    );
                    break;
                }
                case 'digest': {
                    response = await this.jarvis.handleUtilityCommand(
                        'digest',
                        interaction.user.username,
                        userId,
                        true,
                        interaction,
                        guildId
                    );
                    break;
                }
                case 'encode': {
                    response = await this.jarvis.handleUtilityCommand(
                        'encode',
                        interaction.user.username,
                        userId,
                        true,
                        interaction,
                        guildId
                    );
                    break;
                }
                case 'decode': {
                    response = await this.jarvis.handleUtilityCommand(
                        'decode',
                        interaction.user.username,
                        userId,
                        true,
                        interaction,
                        guildId
                    );
                    break;
                }
                default: {
                    response = await this.jarvis.handleUtilityCommand(
                        commandName,
                        interaction.user.username,
                        userId,
                        true,
                        interaction,
                        guildId
                    );
                }
            }

            if (response === undefined || response === null) {
                await interaction.editReply("Response circuits tangled, sir. Try again?");
                telemetryMetadata.reason = 'empty-response';
            } else if (typeof response === 'string') {
                const trimmed = response.trim();
                const safe = this.sanitizePings(trimmed);
                await interaction.editReply(safe.length ? safe : "Response circuits tangled, sir. Try again?");
            } else {
                await interaction.editReply(response);
            }
        } catch (error) {
            telemetryStatus = 'error';
            telemetryError = error;
            console.error('Error processing interaction:', error);
            try {
                await interaction.editReply("Technical difficulties, sir. One moment, please.");
            } catch (editError) {
                if (editError.code === 10062) {
                    telemetryMetadata.reason = 'unknown-interaction';
                    console.warn('Ignored unknown interaction during error reply.');
                } else {
                    console.error('Failed to send error reply:', editError);
                }
            }
            shouldSetCooldown = true;
        } finally {
            if (shouldSetCooldown) {
                this.setCooldown(userId, cooldownScope);
            }
            finalizeTelemetry();
        }
    }
}

module.exports = new DiscordHandlers();




/**
 * Discord event handlers and command processing
 */

const {
    ChannelType,
    AttachmentBuilder,
    UserFlags,
    PermissionsBitField,
    EmbedBuilder,
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

class DiscordHandlers {
    constructor() {
        this.jarvis = new JarvisAI();
        this.userCooldowns = new Map();
        this.autoModRuleName = 'Jarvis Blacklist Filter';
        this.maxAutoModKeywords = 100;
        this.defaultAutoModMessage = 'Jarvis blocked this message for containing prohibited language.';
        this.serverStatsCategoryName = '────────│ Server Stats │────────';
        this.serverStatsChannelLabels = {
            total: 'Member Count',
            users: 'User Count',
            bots: 'Bot Count',
            channels: 'Channels Count',
            roles: 'Role Count'
        };
        this.memberLogCache = new Map();
        this.maxMemberLogVariations = 20;
        this.maxMemberLogMessageLength = 400;
        this.defaultJoinMessages = [
            '🛰️ {mention} has entered {server}.',
            '🎉 A new arrival! Welcome {mention} — population now {membercount}.',
            '🔔 {username} just docked with {server}. Make them feel at home.',
            '✨ {mention} joined us. Jarvis registering their credentials now.'
        ];
        this.defaultLeaveMessages = [
            '📉 {mention} has departed {server}. We are now {membercount} strong.',
            '🛰️ {username} slipped out of the hangar. Farewell until next time.',
            '⚠️ {mention} has left the server. Recalibrating member count to {membercount}.',
            '😔 {username} disconnected from {server}. Until we meet again.'
        ];
    }

    // Clean up old cooldowns to prevent memory leaks
    cleanupCooldowns() {
        const now = Date.now();
        const maxAge = 24 * 60 * 60 * 1000; // 24 hours

        for (const [userId, timestamp] of this.userCooldowns.entries()) {
            if (now - timestamp > maxAge) {
                this.userCooldowns.delete(userId);
            }
        }
    }

    isOnCooldown(userId) {
        const now = Date.now();
        const lastMessageTime = this.userCooldowns.get(userId) || 0;
        return now - lastMessageTime < config.ai.cooldownMs;
    }

    setCooldown(userId) {
        this.userCooldowns.set(userId, Date.now());
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

        for (const keyword of current) {
            const normalized = this.normalizeKeyword(keyword);
            if (normalized) {
                unique.add(normalized);
            }
        }

        for (const addition of additions) {
            if (unique.size >= this.maxAutoModKeywords) {
                break;
            }

            const normalized = this.normalizeKeyword(addition);
            if (normalized) {
                unique.add(normalized);
            }
        }

        return Array.from(unique).slice(0, this.maxAutoModKeywords);
    }

    createDefaultAutoModRecord(guildId = null) {
        return {
            guildId: guildId || null,
            keywords: [],
            enabled: false,
            customMessage: this.defaultAutoModMessage,
            ruleId: null
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

        if (prepared.ruleId && typeof prepared.ruleId !== 'string') {
            prepared.ruleId = String(prepared.ruleId);
            mutated = true;
        }

        const normalizedEnabled = Boolean(prepared.enabled);
        if (prepared.enabled !== normalizedEnabled) {
            prepared.enabled = normalizedEnabled;
            mutated = true;
        }

        let rule = null;
        let missingRuleId = null;

        if (prepared.ruleId) {
            const storedRuleId = prepared.ruleId;
            rule = await this.fetchAutoModRule(guild, storedRuleId);

            if (!rule) {
                missingRuleId = storedRuleId;
                prepared.ruleId = null;
                if (prepared.enabled) {
                    prepared.enabled = false;
                }
                mutated = true;
            } else {
                const enabledState = Boolean(rule.enabled);
                if (prepared.enabled !== enabledState) {
                    prepared.enabled = enabledState;
                    mutated = true;
                }
            }
        }

        return { record: prepared, rule, mutated, missingRuleId };
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

    async upsertAutoModRule(guild, keywords, customMessage = null, ruleId = null, enabled = true) {
        if (!guild) {
            throw this.createFriendlyError('I could not access that server, sir.');
        }

        const sanitized = this.mergeKeywords([], keywords);
        if (sanitized.length === 0) {
            throw this.createFriendlyError('Please provide at least one valid keyword, sir.');
        }

        const payload = {
            name: this.autoModRuleName,
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

    async disableAutoModRule(guild, ruleId) {
        if (!guild || !ruleId) {
            return false;
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

    async getGuildConfig(guild) {
        if (!guild || !database.isConnected) {
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
            return { total: 0, botCount: 0, userCount: 0, channelCount: 0, roleCount: 0 };
        }

        let total = typeof guild.memberCount === 'number' ? guild.memberCount : 0;
        let botCount = 0;
        let userCount = 0;
        let channelCount = 0;
        let roleCount = 0;

        try {
            const members = await guild.members.fetch();
            total = members.size;
            botCount = members.filter(member => member.user.bot).size;
            userCount = total - botCount;
        } catch (error) {
            if (error.code !== 50013 && error.code !== 50001) {
                console.warn(`Failed to fetch full member list for guild ${guild.id}:`, error);
            }

            const cachedMembers = guild.members.cache;
            if (cachedMembers.size > 0) {
                total = cachedMembers.size;
                botCount = cachedMembers.filter(member => member.user?.bot).size;
                userCount = total - botCount;
            } else {
                botCount = guild.members.cache.filter(member => member.user?.bot).size;
                userCount = Math.max(0, total - botCount);
            }
        }

        if (userCount < 0) {
            userCount = 0;
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

        return { total, botCount, userCount, channelCount, roleCount };
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
            config.roleCountChannelId
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

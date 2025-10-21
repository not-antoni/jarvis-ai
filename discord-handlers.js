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
    AutoModerationRuleTriggerType
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
        this.maxAutoModRules = 6;
        this.maxAutoModPatternsPerRule = 1000;
        this.maxAutoModStoredKeywords = this.maxAutoModRules * this.maxAutoModPatternsPerRule;
        this.defaultAutoModMessage = 'Jarvis blocked this message for containing prohibited language.';
        this.autoModDefaultsPath = path.join(__dirname, 'automod-defaults.txt');
        this.autoModDefaultKeywords = this.loadDefaultAutoModKeywords();
        this.serverStatsCategoryName = '────────│ Server Stats │────────';
        this.serverStatsChannelLabels = {
            total: 'Member Count',
            users: 'User Count',
            bots: 'Bot Count'
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

    async handleGuildMemberAdd(member) {
        await this.sendMemberLogEvent(member, 'join');
    }

    handleGuildMemberAdd(member) {
        return this.sendMemberLogEvent(member, 'join');
    }

    handleGuildMemberRemove(member) {
        return this.sendMemberLogEvent(member, 'leave');
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

    loadDefaultAutoModKeywords() {
        try {
            const raw = fs.readFileSync(this.autoModDefaultsPath, 'utf8');
            return this.mergeKeywords([], this.parseKeywordInput(raw));
        } catch (error) {
            if (error.code !== 'ENOENT') {
                console.warn('Failed to load default auto moderation keywords:', error);
            }
            return [];
        }
    }

    expandKeywordVariants(keyword) {
        const base = this.normalizeKeyword(keyword);
        if (!base) {
            return [];
        }

        const variants = new Set();
        variants.add(base);

        const hasSeparators = /[\s_\-]/.test(base);

        if (!base.startsWith('*')) {
            variants.add(`*${base}`);
        }

        if (!base.endsWith('*')) {
            variants.add(`${base}*`);
        }

        variants.add(`*${base}*`);

        if (!hasSeparators) {
            const collapsed = base.replace(/[\s_\-]+/g, '');
            if (collapsed && collapsed !== base) {
                variants.add(collapsed);
                variants.add(`*${collapsed}*`);
            }

            const wildcarded = base.replace(/[\s_\-]+/g, '*');
            if (wildcarded && wildcarded !== base) {
                variants.add(wildcarded);
                variants.add(`*${wildcarded}*`);
            }
        }

        const leetMap = {
            a: ['4', '@'],
            e: ['3'],
            i: ['1', '!'],
            o: ['0'],
            s: ['$', '5'],
            t: ['7']
        };

        let leetVariant = '';
        let leetApplied = false;
        if (!hasSeparators) {
            const collapsed = base.replace(/[\s_\-]+/g, '');

            for (const char of collapsed || base) {
                const replacements = leetMap[char];
                if (replacements && replacements.length) {
                    leetVariant += replacements[0];
                    leetApplied = true;
                } else {
                    leetVariant += char;
                }
            }

            if (leetApplied && leetVariant && leetVariant !== base) {
                variants.add(leetVariant);
                variants.add(`*${leetVariant}*`);
            }
        }

        return Array.from(variants).filter(Boolean);
    }

    expandKeywordSet(keywords = [], limit = this.maxAutoModPatternsPerRule) {
        const expanded = new Set();
        const hasLimit = Number.isFinite(limit);

        for (const keyword of keywords) {
            const variants = this.expandKeywordVariants(keyword);
            for (const variant of variants) {
                if (hasLimit && expanded.size >= limit) {
                    break;
                }
                expanded.add(variant);
            }

            if (hasLimit && expanded.size >= limit) {
                break;
            }
        }

        return Array.from(expanded);
    }

    getEffectiveAutoModFilters(record) {
        const info = this.partitionAutoModKeywords(
            Array.isArray(record?.keywords) ? record.keywords : [],
            Boolean(record?.includeDefaults)
        );

        const expanded = [];
        for (const partition of info.partitions) {
            expanded.push(...partition.filters);
        }

        return {
            canonical: info.canonical,
            combined: info.combined,
            expanded,
            includeDefaults: info.includeDefaults,
            partitions: info.partitions,
            overflow: info.overflow
        };
    }

    mergeKeywords(current = [], additions = [], limit = this.maxAutoModStoredKeywords) {
        const unique = new Set();
        const hasLimit = Number.isFinite(limit);

        for (const keyword of current) {
            const normalized = this.normalizeKeyword(keyword);
            if (normalized) {
                unique.add(normalized);
                if (hasLimit && unique.size >= limit) {
                    break;
                }
            }
        }

        if (!hasLimit || unique.size < limit) {
            for (const addition of additions) {
                if (hasLimit && unique.size >= limit) {
                    break;
                }

                const normalized = this.normalizeKeyword(addition);
                if (normalized) {
                    unique.add(normalized);
                    if (hasLimit && unique.size >= limit) {
                        break;
                    }
                }
                expanded.add(variant);
            }

            if (expanded.size >= this.maxAutoModKeywords) {
                break;
            }

            await this.applyServerStatsPermissions(channel, me, everyoneId);
            return channel;
        };

        const totalChannel = await ensureVoiceChannel(existingConfig?.totalChannelId, `${this.serverStatsChannelLabels.total}: 0`);
        const userChannel = await ensureVoiceChannel(existingConfig?.userChannelId, `${this.serverStatsChannelLabels.users}: 0`);
        const botChannel = await ensureVoiceChannel(existingConfig?.botChannelId, `${this.serverStatsChannelLabels.bots}: 0`);

        return { category, totalChannel, userChannel, botChannel, botMember: me, everyoneId };
    }

    async collectGuildMemberStats(guild) {
        if (!guild) {
            return { total: 0, botCount: 0, userCount: 0 };
        }

        const result = Array.from(unique);
        return hasLimit ? result.slice(0, limit) : result;
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

    formatAutoModRuleName(index) {
        return index === 0 ? this.autoModRuleName : `${this.autoModRuleName} #${index + 1}`;
    }

    isJarvisAutoModRuleName(name) {
        if (!name || typeof name !== 'string') {
            return false;
        }

        if (name === this.autoModRuleName) {
            return true;
        }

        return name.startsWith(`${this.autoModRuleName} #`);
    }

    getStoredAutoModRuleIds(record) {
        const ids = [];

        if (record?.ruleId) {
            ids.push(record.ruleId);
        }

        if (Array.isArray(record?.ruleIds)) {
            for (const id of record.ruleIds) {
                if (id && !ids.includes(id)) {
                    ids.push(id);
                }
            }
        }

        return ids;
    }

    partitionAutoModKeywords(customKeywords = [], includeDefaults = true) {
        const canonical = this.mergeKeywords([], Array.isArray(customKeywords) ? customKeywords : []);
        const defaults = includeDefaults ? this.autoModDefaultKeywords : [];
        const combined = this.mergeKeywords(canonical, defaults, null);
        const partitions = [];
        const limit = this.maxAutoModPatternsPerRule;
        const hasLimit = Number.isFinite(limit) && limit > 0;

        let currentKeywords = [];
        let currentFilters = [];

        const flush = () => {
            if (currentFilters.length) {
                partitions.push({
                    keywords: currentKeywords,
                    filters: currentFilters
                });
                currentKeywords = [];
                currentFilters = [];
            }
        };

        for (const keyword of combined) {
            const variants = this.expandKeywordVariants(keyword);
            if (!variants.length) {
                continue;
            }

            if (hasLimit && currentFilters.length && currentFilters.length + variants.length > limit) {
                flush();
            }

            if (hasLimit && variants.length > limit) {
                partitions.push({
                    keywords: [keyword],
                    filters: variants.slice(0, limit)
                });
                continue;
            }

            currentKeywords.push(keyword);
            currentFilters.push(...variants);

            if (hasLimit && currentFilters.length >= limit) {
                flush();
            }
        }

        flush();

        const overflow = this.maxAutoModRules && partitions.length > this.maxAutoModRules;

        return {
            canonical,
            combined,
            partitions,
            includeDefaults,
            overflow
        };
    }

    async fetchJarvisAutoModRules(guild) {
        if (!guild) {
            return [];
        }

        try {
            const rules = await guild.autoModerationRules.fetch();
            const clientId = guild.client?.user?.id || null;
            const matches = [];

            for (const existing of rules.values()) {
                if (!this.isJarvisAutoModRuleName(existing.name)) {
                    continue;
                }

                if (clientId && existing.creatorId && existing.creatorId !== clientId) {
                    continue;
                }

                matches.push(existing);
            }

            matches.sort((a, b) => {
                const nameCompare = (a.name || '').localeCompare(b.name || '');
                if (nameCompare !== 0) {
                    return nameCompare;
                }

                return (a.id || '').localeCompare(b.id || '');
            });

            return matches;
        } catch (error) {
            console.warn('Failed to fetch Jarvis auto moderation rules:', error);
            return [];
        }

        return ids;
    }

    async syncAutoModRules(guild, record, options = {}) {
        if (!guild) {
            throw new Error('I could not access that server, sir.');
        }

        const { enable = true, customMessage = null } = options;
        const info = this.partitionAutoModKeywords(record?.keywords || [], Boolean(record?.includeDefaults));

        if (!info.partitions.length) {
            throw new Error('Please provide at least one valid keyword, sir.');
        }

        if (info.overflow) {
            throw this.createFriendlyError(
                `Discord only allows ${this.maxAutoModRules} keyword rules, sir. Your configuration would require ${info.partitions.length}. Please reduce the blacklist before adding more entries.`
            );
        }

        const actions = [
            {
                type: AutoModerationActionType.BlockMessage,
                metadata:
                    customMessage && customMessage.trim()
                        ? { customMessage: customMessage.slice(0, 150) }
                        : {}
            }
        ];

        const existingRules = await this.fetchJarvisAutoModRules(guild);
        const storedIds = this.getStoredAutoModRuleIds(record);
        const usedRuleIds = new Set();
        const activeRules = [];

        const takeRuleById = id => {
            if (!id) {
                return null;
            }

            const match = existingRules.find(rule => rule.id === id && !usedRuleIds.has(rule.id));
            if (match) {
                usedRuleIds.add(match.id);
                return match;
            }

            return null;
        };

        const takeAnyRule = () => {
            const match = existingRules.find(rule => !usedRuleIds.has(rule.id));
            if (match) {
                usedRuleIds.add(match.id);
                return match;
            }

            return null;
        };

        for (let index = 0; index < info.partitions.length; index += 1) {
            const partition = info.partitions[index];
            const payload = {
                name: this.formatAutoModRuleName(index),
                eventType: AutoModerationRuleEventType.MessageSend,
                triggerType: AutoModerationRuleTriggerType.Keyword,
                triggerMetadata: {
                    keywordFilter: partition.filters
                },
                actions,
                enabled: enable,
                exemptRoles: [],
                exemptChannels: []
            };

            let rule = takeRuleById(storedIds[index]);
            if (!rule) {
                rule = takeAnyRule();
            }

            if (rule) {
                try {
                    rule = await rule.edit(payload);
                } catch (error) {
                    if (error.code === 10066 || error.code === 50001 || error.code === 50013) {
                        throw this.createFriendlyError('I do not have permission to update the auto moderation rule, sir.');
                    }

                    throw error;
                }
            } else {
                try {
                    rule = await guild.autoModerationRules.create(payload);
                } catch (error) {
                    if (error.code === 50013 || error.code === 50001) {
                        throw this.createFriendlyError('I do not have permission to create auto moderation rules, sir.');
                    }

                    throw error;
                }
            }

            usedRuleIds.add(rule.id);
            activeRules.push(rule);
        }

        for (const rule of existingRules) {
            if (!usedRuleIds.has(rule.id)) {
                try {
                    await rule.delete();
                } catch (error) {
                    if (error.code !== 10066 && error.code !== 50001 && error.code !== 50013) {
                        console.warn('Failed to delete unused auto moderation rule:', error);
                    }
                }
            }
        }

        return {
            rules: activeRules,
            ruleIds: activeRules.map(rule => rule.id),
            keywords: info.canonical,
            partitions: info.partitions
        };
    }

    async disableAutoModRules(guild, ruleIds = []) {
        if (!guild || !Array.isArray(ruleIds) || !ruleIds.length) {
            return false;
        }

        let disabledAny = false;
        const uniqueIds = Array.from(new Set(ruleIds.filter(Boolean)));

        for (const ruleId of uniqueIds) {
            try {
                const rule = await guild.autoModerationRules.fetch(ruleId);
                if (!rule) {
                    continue;
                }

                await rule.edit({ enabled: false });
                disabledAny = true;
            } catch (error) {
                if (error.code === 10066 || error.code === 50001) {
                    continue;
                }

                throw error;
            }
        }

        return disabledAny;
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

        return { category, totalChannel, userChannel, botChannel, botMember: me, everyoneId };
    }

    async collectGuildMemberStats(guild) {
        if (!guild) {
            return { total: 0, botCount: 0, userCount: 0 };
        }

        let total = typeof guild.memberCount === 'number' ? guild.memberCount : 0;
        let botCount = 0;
        let userCount = 0;

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

        return { total, botCount, userCount };
    }

    async updateServerStats(guild, existingConfig = null) {
        if (!guild) {
            throw this.createFriendlyError('I could not access that server, sir.');
        }

        const stats = await this.collectGuildMemberStats(guild);
        const ensured = await this.ensureServerStatsChannels(guild, existingConfig);
        const { category, totalChannel, userChannel, botChannel, botMember, everyoneId } = ensured;

        const desiredNames = {
            total: this.formatServerStatsName(this.serverStatsChannelLabels.total, stats.total),
            users: this.formatServerStatsName(this.serverStatsChannelLabels.users, stats.userCount),
            bots: this.formatServerStatsName(this.serverStatsChannelLabels.bots, stats.botCount)
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
        } catch (error) {
            if (error.code === 50013) {
                throw this.createFriendlyError('I lack permission to rename the server stats channels, sir.');
            }
            throw error;
        }

        await this.applyServerStatsPermissions(totalChannel, botMember, everyoneId);
        await this.applyServerStatsPermissions(userChannel, botMember, everyoneId);
        await this.applyServerStatsPermissions(botChannel, botMember, everyoneId);

        const record = await database.saveServerStatsConfig(guild.id, {
            categoryId: category.id,
            totalChannelId: totalChannel.id,
            userChannelId: userChannel.id,
            botChannelId: botChannel.id
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
            config.botChannelId
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
            emojis.push({
                full: match[0],
                name: match[0],
                id: null,
                url: null, // Unicode emojis don't have URLs
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
        tempCtx.font = '14px Arial';

        const segments = this.splitTextWithEmojisAndMentions(text, customEmojis, mentions);
        const lineHeight = 20;
        const emojiSize = 16;

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
                if (segment.isUnicode) {
                    const emojiText = segment.name;
                    tempCtx.font = '16px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Android Emoji", "EmojiSymbols", "EmojiOne Mozilla", "Twemoji Mozilla", "Segoe UI Symbol", sans-serif';
                    const width = tempCtx.measureText(emojiText).width;
                    tempCtx.font = '14px Arial';
                    if (currentLineWidth + width > maxWidth && currentLineWidth > 0) {
                        advanceLine();
                    }
                    currentLineWidth += width;
                } else {
                    const width = emojiSize + 2;
                    if (currentLineWidth + width > maxWidth && currentLineWidth > 0) {
                        advanceLine();
                    }
                    currentLineWidth += width;
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

        const baseHeight = 40;
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
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, totalHeight);

    // Calculate centered positioning with more space for avatar and text
    const avatarSize = 40;
    const contentWidth = width - 80; // More margin
    const contentHeight = totalHeight - 20;
    const avatarX = 50; // Moved further to the right
    const avatarY = 20; // Top-aligned padding instead of vertical centering

    // Draw avatar (circular)
    if (avatarUrl) {
        try {
            ctx.save();
            ctx.beginPath();
            ctx.arc(avatarX + avatarSize/2, avatarY + avatarSize/2, avatarSize/2, 0, Math.PI * 2);
            ctx.clip();
            
            ctx.fillStyle = '#5865f2';
            ctx.fillRect(avatarX, avatarY, avatarSize, avatarSize);
            
            const avatarImg = await loadImage(avatarUrl);
            ctx.drawImage(avatarImg, avatarX, avatarY, avatarSize, avatarSize);
            
            ctx.restore();
        } catch (error) {
            console.warn('Failed to load avatar, using fallback:', error);
            ctx.save();
            ctx.beginPath();
            ctx.arc(avatarX + avatarSize/2, avatarY + avatarSize/2, avatarSize/2, 0, Math.PI * 2);
            ctx.fillStyle = '#5865f2';
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
        ctx.fillStyle = '#5865f2';
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
        const textStartY = avatarY + 2;
    const maxTextWidth = contentWidth - (avatarSize + 20) - 30; // More margin

    // Truncate username if too long to prevent timestamp overlap
    const truncatedUsername = this.truncateText(username, 20);

        // Draw username in role color
    ctx.fillStyle = roleColor;
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
    ctx.fillText(truncatedUsername, textStartX, textStartY);

    let currentX = textStartX + ctx.measureText(truncatedUsername).width + 4;

        // Draw app tag if it's a bot
        if (isBot) {
            const appTagWidth = 35;
            const appTagHeight = 16;
            
            // Draw verification badge if verified (to the left of APP tag)
            if (isVerified) {
                const badgeSize = 16;
                const badgeX = currentX;
                this.drawVerifiedBadge(ctx, badgeX, textStartY, badgeSize);
                currentX += badgeSize + 4;
            }
            
            // App tag background (Discord blue color)
            ctx.fillStyle = 'rgb(88, 101, 242)'; // Discord APP badge color
            ctx.fillRect(currentX, textStartY, appTagWidth, appTagHeight);
            
            // App tag text
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 10px Arial';
            ctx.fillText('APP', currentX + 2, textStartY + 2);
            
            currentX += appTagWidth + 4;
        }

    // Draw timestamp with dynamic formatting
    const timestamp = message ? this.parseDiscordTimestamp(message) : '6:39 PM';
    const timestampWidth = ctx.measureText(timestamp).width;
    
    // Ensure timestamp doesn't overlap with username/bot tag
    const availableWidth = width - currentX - 20;
    if (timestampWidth <= availableWidth) {
        ctx.fillStyle = '#72767d';
        ctx.font = '12px Arial';
        ctx.fillText(timestamp, currentX, textStartY);
    } else {
        // If not enough space, put timestamp on next line
        ctx.fillStyle = '#72767d';
        ctx.font = '12px Arial';
        ctx.fillText(timestamp, textStartX, textStartY + 16);
    }

    // Draw message content with formatting support
    // Position the message content immediately below the username. The username
    // occupies approximately 14px of vertical space, so we add a 2px gap to
    // separate the text from the header. This mirrors the 2px gap between text
    // and images later on, keeping spacing consistent.
    const messageStartY = textStartY + 16;
    await this.drawFormattedText(ctx, sanitizedText, textStartX, messageStartY, maxTextWidth, allEmojis, mentions);

    // Draw images if present (main canvas has enough height already)
    if (hasImages || allImageUrls.length > 0) {
        // Compute the starting Y position for images. We subtract the base 40px
        // reserved in calculateTextHeight (for username/timestamp) from the
        // measured textHeight to get only the height of the rendered lines. Then
        // add a small 2px gap so images sit flush beneath the message text.
        const effectiveTextHeight = Math.max(0, textHeight - 40);
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
        ctx.font = '14px Arial';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';

        let currentY = startY;
        const lineHeight = 20;
        const emojiSize = 16;

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
                if (segment.isUnicode) {
                    const emojiText = segment.name;

                    ctx.font = '16px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Android Emoji", "EmojiSymbols", "EmojiOne Mozilla", "Twemoji Mozilla", "Segoe UI Symbol", sans-serif';
                    const textWidth = ctx.measureText(emojiText).width;
                    if (currentLineWidth + textWidth > maxWidth && currentLineWidth > 0) {
                        advanceLine();
                    }

                    ctx.fillText(emojiText, startX + currentLineWidth, currentY);
                    currentLineWidth += textWidth;

                    ctx.font = '14px Arial';
                } else {
                    try {
                        console.log('Loading emoji:', { name: segment.name, url: segment.url });
                        const emojiImg = await loadImage(segment.url);
                        const emojiWidth = emojiSize;
                        const emojiHeight = emojiSize;

                        if (currentLineWidth + emojiWidth > maxWidth && currentLineWidth > 0) {
                            advanceLine();
                        }

                        ctx.drawImage(emojiImg, startX + currentLineWidth, currentY, emojiWidth, emojiHeight);
                        currentLineWidth += emojiWidth + 2;
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

                                if (currentLineWidth + emojiWidth > maxWidth && currentLineWidth > 0) {
                                    advanceLine();
                                }

                                ctx.drawImage(emojiImg, startX + currentLineWidth, currentY, emojiWidth, emojiHeight);
                                currentLineWidth += emojiWidth + 2;
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
                segments.push({ type: 'emoji', name: emoji.name, url: emoji.url, full: emoji.full, id: emoji.id, isUnicode: emoji.isUnicode });
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
        ctx.font = '14px Arial';
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

        const userId = message.author.id;

        const braveGuardedEarly = await this.enforceImmediateBraveGuard(message);
        if (braveGuardedEarly) {
            this.setCooldown(userId);
            return;
        }

        // 🚫 Ignore mass mentions completely
        if (message.mentions.everyone) {
            return; // NEW: do not respond to @everyone / @here
        }

        const isMentioned = message.mentions.has(client.user);
        const isDM = message.channel.type === ChannelType.DM;
        const containsJarvis = config.wakeWords.some(trigger =>
            message.content.toLowerCase().includes(trigger)
        );
        const isReplyToJarvis = message.reference && message.reference.messageId;
        const isBot = message.author.bot;
        const isTCommand = message.content.toLowerCase().trim().startsWith("!t ");

        if (isDM || isMentioned || containsJarvis || isReplyToJarvis || isTCommand) {
            if (this.isOnCooldown(userId)) {
                return;
            }

            this.setCooldown(userId);
        }

        if (await this.handleAdminCommands(message)) return;
        if (await this.handleUtilityCommands(message)) return;

        await this.handleJarvisInteraction(message, client);
    }

    async handleAdminCommands(message) {
        const content = message.content.trim().toLowerCase();

        if (content === "!cleardbsecret") {
            if (message.author.id !== config.admin.userId) {
                return false;
            }

            try {
                await message.channel.sendTyping();
                const { conv, prof } = await this.jarvis.clearDatabase();
                await message.reply(`Database cleared, sir. Deleted ${conv} conversations and ${prof} profiles.`);
            } catch (error) {
                console.error("Clear DB error:", error);
                await message.reply("Unable to clear database, sir. Technical issue.");
            }
            return true;
        }

        return false;
    }

    async handleUtilityCommands(message) {
        const content = message.content.trim().toLowerCase();
        const rawContent = message.content.trim();

        if (content === "!reset") {
            try {
                await message.channel.sendTyping();
                const { conv, prof } = await this.jarvis.resetUserData(message.author.id);
                await message.reply(`Memories wiped, sir. Deleted ${conv} conversations and ${prof} profile${prof === 1 ? '' : 's'}.`);
            } catch (error) {
                console.error("Reset error:", error);
                await message.reply("Unable to reset memories, sir. Technical issue.");
            }
            return true;
        }

        if (content === "!help") {
            try {
                await message.channel.sendTyping();
                const response = await this.jarvis.handleUtilityCommand(
                    "help",
                    message.author.username,
                    message.author.id
                );
                if (typeof response === "string") {
                    await message.reply(response);
                } else if (response) {
                    await message.reply(response);
                } else {
                    await message.reply("Unable to display help right now, sir.");
                }
            } catch (error) {
                console.error("Help command error:", error);
                await message.reply("Unable to display help right now, sir.");
            }
            return true;
        }

        if (content === "!invite") {
            try {
                await message.channel.sendTyping();
                const response = await this.jarvis.handleUtilityCommand(
                    "invite",
                    message.author.username,
                    message.author.id
                );
                if (typeof response === "string") {
                    await message.reply(response);
                } else if (response) {
                    await message.reply(response);
                } else {
                    await message.reply("Support invite unavailable right now, sir.");
                }
            } catch (error) {
                console.error("Invite command error:", error);
                await message.reply("Support invite unavailable right now, sir.");
            }
            return true;
        }

        if (content.startsWith("!profile")) {
            try {
                await message.channel.sendTyping();
                const response = await this.jarvis.handleUtilityCommand(
                    rawContent.substring(1),
                    message.author.username,
                    message.author.id
                );
                await message.reply(response || "Profile command processed, sir.");
            } catch (error) {
                console.error("Profile command error:", error);
                await message.reply("Unable to access profile systems, sir.");
            }
            return true;
        }

        if (content.startsWith("!history")) {
            try {
                await message.channel.sendTyping();
                const response = await this.jarvis.handleUtilityCommand(
                    rawContent.substring(1),
                    message.author.username,
                    message.author.id
                );
                await message.reply(response || "No history available yet, sir.");
            } catch (error) {
                console.error("History command error:", error);
                await message.reply("Unable to retrieve history, sir.");
            }
            return true;
        }

        if (content.startsWith("!recap")) {
            try {
                await message.channel.sendTyping();
                const response = await this.jarvis.handleUtilityCommand(
                    rawContent.substring(1),
                    message.author.username,
                    message.author.id
                );
                await message.reply(response || "Nothing to report just yet, sir.");
            } catch (error) {
                console.error("Recap command error:", error);
                await message.reply("Unable to compile a recap, sir.");
            }
            return true;
        }

        if (content.startsWith("!encode")) {
            try {
                await message.channel.sendTyping();
                const response = await this.jarvis.handleUtilityCommand(
                    rawContent.substring(1),
                    message.author.username,
                    message.author.id
                );
                await message.reply(response || "Encoding complete, sir.");
            } catch (error) {
                console.error("Encode command error:", error);
                await message.reply("Unable to encode that right now, sir.");
            }
            return true;
        }

        if (content.startsWith("!decode")) {
            try {
                await message.channel.sendTyping();
                const response = await this.jarvis.handleUtilityCommand(
                    rawContent.substring(1),
                    message.author.username,
                    message.author.id
                );
                await message.reply(response || "Decoding complete, sir.");
            } catch (error) {
                console.error("Decode command error:", error);
                await message.reply("Unable to decode that right now, sir.");
            }
            return true;
        }

        if (content.startsWith("!t ")) {
            const whitelistedChannelIds = config.commands.whitelistedChannelIds;
            if (!whitelistedChannelIds.includes(message.channel.id)) {
                return true;
            }

            console.log(`!t command detected: ${message.content}`);
            try {
                await message.channel.sendTyping();
                const response = await this.jarvis.handleUtilityCommand(
                    message.content.trim(),
                    message.author.username,
                    message.author.id
                );

                console.log(`!t command response: ${response}`);
                if (response) {
                    await message.reply(response);
                } else {
                    await message.reply("Search system unavailable, sir. Technical difficulties.");
                }
            } catch (error) {
                console.error("!t command error:", error);
                await message.reply("Search failed, sir. Technical difficulties.");
            }
            return true;
        }

        return false;
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
            this.setCooldown(message.author.id);
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
            this.setCooldown(message.author.id);
            return; // Exit early, no AI response
        }

        const ytCommandPattern = /^jarvis\s+yt\s+(.+)$/i;
        const ytMatch = cleanContent.match(ytCommandPattern);
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

        if (ytMatch) {
            const searchQuery = ytMatch[1].trim();
            if (searchQuery) {
                try {
                    await message.channel.sendTyping();
                    const response = await this.jarvis.handleYouTubeSearch(searchQuery);
                    await message.reply(response);
                    this.setCooldown(message.author.id);
                    return;
                } catch (error) {
                    console.error("YouTube search error:", error);
                    await message.reply("YouTube search failed, sir. Technical difficulties.");
                    this.setCooldown(message.author.id);
                    return;
                }
            }
        }

        if (braveInvocation.triggered || rawBraveInvocation.triggered) {
            const invocationContext =
                (typeof braveInvocation.invocation === 'string' && braveInvocation.invocation.length > 0)
                    ? braveInvocation.invocation
                    : (typeof rawBraveInvocation.invocation === 'string' && rawBraveInvocation.invocation.length > 0)
                        ? rawBraveInvocation.invocation
                        : cleanContent;

            const rawSegmentCandidate =
                (typeof braveInvocation.rawQuery === 'string' && braveInvocation.rawQuery.length > 0)
                    ? braveInvocation.rawQuery
                    : (typeof rawBraveInvocation.rawQuery === 'string' && rawBraveInvocation.rawQuery.length > 0)
                        ? rawBraveInvocation.rawQuery
                        : invocationContext;

            const explicitFromInvocation = (!braveInvocation.explicit && braveSearch.isExplicitQuery)
                ? braveSearch.isExplicitQuery(invocationContext, { rawSegment: invocationContext })
                : false;

            const explicitDetected = (
                braveInvocation.explicit === true
                || rawBraveInvocation.explicit === true
                || explicitFromInvocation === true
            );

            if (explicitDetected) {
                await message.reply({
                    content: braveSearch.getExplicitQueryMessage
                        ? braveSearch.getExplicitQueryMessage()
                        : 'I must decline that request, sir. My safety filters forbid it.'
                });
                this.setCooldown(message.author.id);
                return;
            }

            const querySource =
                (typeof braveInvocation.query === 'string' && braveInvocation.query.length > 0)
                    ? braveInvocation.query
                    : (typeof rawBraveInvocation.query === 'string' && rawBraveInvocation.query.length > 0)
                        ? rawBraveInvocation.query
                        : rawSegmentCandidate;

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
                        this.setCooldown(message.author.id);
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
                    this.setCooldown(message.author.id);
                    return;
                } catch (error) {
                    console.error("Brave search error:", error);
                    await message.reply("Web search failed, sir. Technical difficulties.");
                    this.setCooldown(message.author.id);
                    return;
                }
            } else {
                await message.reply("Please provide a web search query after 'jarvis search', sir.");
                this.setCooldown(message.author.id);
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
            this.setCooldown(message.author.id);
            return;
        }

        if (cleanContent.length > config.ai.maxInputLength) {
            cleanContent = cleanContent.substring(0, config.ai.maxInputLength) + "...";
        }

        try {
            const utilityResponse = await this.jarvis.handleUtilityCommand(
                cleanContent,
                message.author.username,
                message.author.id
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

                const lines = [
                    `Category: ${category ? `<#${category.id}>` : 'Missing'}`,
                    `Member channel: ${totalChannel ? `<#${totalChannel.id}>` : 'Missing'}`,
                    `User channel: ${userChannel ? `<#${userChannel.id}>` : 'Missing'}`,
                    `Bot channel: ${botChannel ? `<#${botChannel.id}>` : 'Missing'}`,
                    `Current totals — Members: ${this.formatServerStatsValue(stats.total)}, Users: ${this.formatServerStatsValue(stats.userCount)}, Bots: ${this.formatServerStatsValue(stats.botCount)}`
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

            if (subcommand === 'disable') {
                const existing = await database.getServerStatsConfig(guild.id);
                if (!existing) {
                    await interaction.editReply('Server statistics channels were not configured, sir.');
                    return;
                }
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

        let record = await database.getAutoModConfig(guild.id);
        if (!record) {
            record = {
                guildId: guild.id,
                keywords: [],
                enabled: false,
                customMessage: this.defaultAutoModMessage,
                ruleId: null,
                ruleIds: [],
                includeDefaults: true
            };
        } else {
            if (!Array.isArray(record.keywords)) {
                record.keywords = [];
            }

            if (!record.customMessage) {
                record.customMessage = this.defaultAutoModMessage;
            }

            if (typeof record.includeDefaults !== 'boolean') {
                record.includeDefaults = true;
            }

            if (!Array.isArray(record.ruleIds)) {
                record.ruleIds = [];
            }
        }

        record.keywords = this.mergeKeywords([], record.keywords);
        record.ruleIds = this.getStoredAutoModRuleIds(record);
        record.ruleId = record.ruleIds[0] || null;

        const replyWithError = async message => {
            await interaction.editReply(message);
        };

        if (subcommand === 'status') {
            const rules = await this.fetchJarvisAutoModRules(guild);
            const primaryRule = rules[0] || (record.ruleId ? await this.fetchAutoModRule(guild, record.ruleId) : null);
            const enabledState = rules.length ? rules.some(rule => rule.enabled) : Boolean(record.enabled);
            const filters = this.getEffectiveAutoModFilters(record);
            const trackedRules = rules.length || record.ruleIds.length;
            const footerText = primaryRule
                ? `Primary rule ID ${primaryRule.id} (${trackedRules} total)`
                : record.ruleIds.length
                    ? 'Stored configuration exists, but the Discord rules are missing.'
                    : 'Auto moderation has not been deployed yet.';
            const embed = new EmbedBuilder()
                .setTitle('Auto moderation status')
                .setColor(0x5865f2)
                .addFields(
                    { name: 'Enabled', value: enabledState ? 'Yes' : 'No', inline: true },
                    { name: 'Custom entries', value: `${filters.canonical.length}`, inline: true },
                    {
                        name: 'Default pack',
                        value:
                            filters.includeDefaults && this.autoModDefaultKeywords.length
                                ? `${this.autoModDefaultKeywords.length}`
                                : 'Disabled',
                        inline: true
                    },
                    { name: 'Discord rules', value: `${trackedRules}`, inline: true },
                    { name: 'Effective filters', value: `${filters.expanded.length}`, inline: true }
                )
                .setFooter({ text: footerText });

            await interaction.editReply({ embeds: [embed] });
            return;
        }

        if (subcommand === 'list') {
            const hasCustom = record.keywords.length > 0;
            const hasDefaults = record.includeDefaults && this.autoModDefaultKeywords.length > 0;

            if (!hasCustom && !hasDefaults) {
                await interaction.editReply('No blacklist entries are currently configured, sir.');
                return;
            }

            const chunkSize = 20;
            const embed = new EmbedBuilder()
                .setTitle('Blacklisted phrases')
                .setColor(0x5865f2);

            if (hasCustom) {
                const chunks = [];
                for (let index = 0; index < record.keywords.length; index += chunkSize) {
                    chunks.push(record.keywords.slice(index, index + chunkSize));
                }

                chunks.slice(0, 5).forEach((chunk, index) => {
                    const value = chunk.map(word => `• ${word}`).join('\n');
                    embed.addFields({
                        name: `Custom batch ${index + 1}`,
                        value: value.length > 1024 ? `${value.slice(0, 1021)}...` : value
                    });
                });

                if (chunks.length > 5) {
                    embed.setFooter({
                        text: `Showing ${Math.min(100, record.keywords.length)} of ${record.keywords.length} custom entries.`
                    });
                }
            } else {
                embed.setDescription('No custom blacklist entries are configured, sir.');
            }

            if (hasDefaults) {
                const defaultLines = this.autoModDefaultKeywords.map(word => `• ${word}`).join('\n');
                embed.addFields({
                    name: 'Default pack',
                    value: defaultLines.length > 1024 ? `${defaultLines.slice(0, 1021)}...` : defaultLines
                });

                if (!hasCustom) {
                    embed.setFooter({ text: 'Showing Jarvis default blacklist entries.' });
                }
            }

            await interaction.editReply({ embeds: [embed] });
            return;
        }

        if (subcommand === 'enable') {
            const canEnable =
                record.keywords.length > 0 || (record.includeDefaults && this.autoModDefaultKeywords.length > 0);

            if (!canEnable) {
                await replyWithError('Please add blacklisted words before enabling auto moderation, sir.');
                return;
            }

            try {
                const result = await this.syncAutoModRules(guild, record, {
                    enable: true,
                    customMessage: record.customMessage
                });

                record.keywords = result.keywords;
                record.ruleIds = result.ruleIds;
                record.ruleId = record.ruleIds[0] || null;
                const activeRules = result.rules.filter(rule => rule.enabled).length;
                record.enabled = activeRules > 0;
                await database.saveAutoModConfig(guild.id, record);
                const effectiveFilters = this.getEffectiveAutoModFilters(record).expanded.length;
                const totalRules = result.rules.length;
                let statusLine = '';

                if (!totalRules) {
                    statusLine = 'No auto moderation rules could be deployed, sir.';
                } else if (activeRules === totalRules) {
                    statusLine = `Discord enabled all ${totalRules} rule${totalRules === 1 ? '' : 's'}.`;
                } else if (activeRules > 0) {
                    statusLine = `Discord enabled ${activeRules} of ${totalRules} rule${totalRules === 1 ? '' : 's'}.`;
                } else {
                    statusLine = 'The rules were updated, but Discord left them disabled.';
                }

                const patternLine = effectiveFilters
                    ? ` Currently enforcing ${effectiveFilters} pattern${effectiveFilters === 1 ? '' : 's'}.`
                    : '';
                const summary = [
                    `Auto moderation synced across ${totalRules} rule${totalRules === 1 ? '' : 's'}, sir.`,
                    statusLine ? ` ${statusLine}` : '',
                    patternLine
                ].join('');
                await interaction.editReply(summary);
            } catch (error) {
                console.error('Failed to enable auto moderation:', error);
                await replyWithError('I could not enable auto moderation, sir. Please ensure I have the AutoMod permission.');
            }
            return;
        }

        if (subcommand === 'disable') {
            try {
                await this.disableAutoModRules(guild, record.ruleIds);
            } catch (error) {
                console.error('Failed to disable auto moderation rule:', error);
                await replyWithError('I could not disable the auto moderation rule, sir.');
                return;
            }

            record.enabled = false;
            await database.saveAutoModConfig(guild.id, record);
            await interaction.editReply('Auto moderation is now offline for this server, sir.');
            return;
        }

        if (subcommand === 'clear') {
            try {
                await this.disableAutoModRules(guild, record.ruleIds);
            } catch (error) {
                console.error('Failed to disable auto moderation while clearing:', error);
            }

            record.keywords = [];
            record.enabled = false;
            record.includeDefaults = false;
            record.ruleIds = this.getStoredAutoModRuleIds(record);
            record.ruleId = record.ruleIds[0] || null;
            await database.saveAutoModConfig(guild.id, record);
            await interaction.editReply('Blacklist cleared and auto moderation disabled, sir.');
            return;
        }

        if (subcommand === 'defaults') {
            const enableDefaults = interaction.options.getBoolean('enabled');

            record.includeDefaults = Boolean(enableDefaults);

            let statusLine = record.includeDefaults
                ? 'Jarvis default blacklist entries are now active, sir.'
                : 'Jarvis default blacklist entries are now disabled, sir.';

            if (record.enabled) {
                const shouldMaintainRule =
                    record.keywords.length > 0 || (record.includeDefaults && this.autoModDefaultKeywords.length > 0);

                if (shouldMaintainRule) {
                    try {
                        const result = await this.syncAutoModRules(guild, record, {
                            enable: true,
                            customMessage: record.customMessage
                        });

                        record.keywords = result.keywords;
                        record.ruleIds = result.ruleIds;
                        record.ruleId = record.ruleIds[0] || null;
                        record.enabled = result.rules.some(rule => rule.enabled);
                    } catch (error) {
                        console.error('Failed to update auto moderation defaults:', error);
                        await replyWithError('I could not update the auto moderation rule, sir.');
                        return;
                    }
                } else {
                    try {
                        await this.disableAutoModRules(guild, record.ruleIds);
                    } catch (error) {
                        console.error('Failed to disable auto moderation after removing defaults:', error);
                    }

                    record.enabled = false;
                    statusLine += ' Auto moderation was disabled because no entries remain, sir.';
                }
            }

            await database.saveAutoModConfig(guild.id, record);
            const effectiveFilters = record.enabled ? this.getEffectiveAutoModFilters(record).expanded.length : 0;
            if (record.enabled && effectiveFilters) {
                statusLine += ` Currently enforcing ${effectiveFilters} pattern${effectiveFilters === 1 ? '' : 's'}, sir.`;
            } else if (!record.enabled) {
                statusLine += ' Auto moderation is currently disabled, sir.';
            }
        }

            await interaction.editReply(statusLine);
            return;
        }

        if (subcommand === 'setmessage') {
            const message = interaction.options.getString('message');
            if (!message || !message.trim()) {
                await replyWithError('Please provide a custom message, sir.');
                return;
            }

            record.customMessage = message.trim().slice(0, 150);

            if (
                record.enabled &&
                (record.keywords.length || (record.includeDefaults && this.autoModDefaultKeywords.length))
            ) {
                try {
                    const result = await this.syncAutoModRules(guild, record, {
                        enable: record.enabled,
                        customMessage: record.customMessage
                    });
                    record.keywords = result.keywords;
                    record.ruleIds = result.ruleIds;
                    record.ruleId = record.ruleIds[0] || null;
                    record.enabled = result.rules.some(rule => rule.enabled);
                } catch (error) {
                    console.error('Failed to update auto moderation message:', error);
                    await replyWithError('I could not update the auto moderation message, sir.');
                    return;
                }
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
                await replyWithError('Those words were already on the blacklist or exceeded the limit, sir.');
                return;
            }

            const previousCount = record.keywords.length;
            record.keywords = merged;
            try {
                const result = await this.syncAutoModRules(guild, record, {
                    enable: true,
                    customMessage: record.customMessage
                });

                record.keywords = result.keywords;
                record.ruleIds = result.ruleIds;
                record.ruleId = record.ruleIds[0] || null;
                const activeRules = result.rules.filter(rule => rule.enabled).length;
                record.enabled = activeRules > 0;
                await database.saveAutoModConfig(guild.id, record);
                const addedCount = Math.max(0, record.keywords.length - previousCount);
                const statusLine = record.enabled
                    ? 'Auto moderation is active, sir.'
                    : 'Auto moderation is currently disabled, sir.';
                const effectiveFilters = this.getEffectiveAutoModFilters(record).expanded.length;
                const patternLine = effectiveFilters
                    ? ` Now enforcing ${effectiveFilters} pattern${effectiveFilters === 1 ? '' : 's'}.`
                    : '';
                await interaction.editReply(
                    `Blacklist updated with ${addedCount} new entr${addedCount === 1 ? 'y' : 'ies'}. ${statusLine}${patternLine}`
                );
            } catch (error) {
                console.error('Failed to add auto moderation keywords:', error);
                await replyWithError('I could not update the auto moderation rule, sir.');
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

            const hasFilters =
                record.keywords.length > 0 || (record.includeDefaults && this.autoModDefaultKeywords.length > 0);

            if (hasFilters) {
                try {
                    const result = await this.syncAutoModRules(guild, record, {
                        enable: record.enabled,
                        customMessage: record.customMessage
                    });

                    record.keywords = result.keywords;
                    record.ruleIds = result.ruleIds;
                    record.ruleId = record.ruleIds[0] || null;
                    record.enabled = result.rules.some(rule => rule.enabled);
                } catch (error) {
                    console.error('Failed to update auto moderation keywords after removal:', error);
                    await replyWithError('I could not update the auto moderation rule after removal, sir.');
                    return;
                }
            } else {
                try {
                    await this.disableAutoModRules(guild, record.ruleIds);
                } catch (error) {
                    console.error('Failed to disable auto moderation after removal:', error);
                }
                record.enabled = false;
            }

            await database.saveAutoModConfig(guild.id, record);
            const effectiveFilters = this.getEffectiveAutoModFilters(record).expanded.length;
            const statusLine = record.enabled && effectiveFilters
                ? `Jarvis will enforce ${effectiveFilters} pattern${effectiveFilters === 1 ? '' : 's'}, sir.`
                : 'Auto moderation is currently disabled, sir.';
            await interaction.editReply(`Blacklist updated, sir. ${statusLine}`);
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

            record.keywords = combined;
            try {
                const result = await this.syncAutoModRules(guild, record, {
                    enable: true,
                    customMessage: record.customMessage
                });

                record.keywords = result.keywords;
                record.ruleIds = result.ruleIds;
                record.ruleId = record.ruleIds[0] || null;
                record.enabled = result.rules.some(rule => rule.enabled);
                await database.saveAutoModConfig(guild.id, record);
                const statusLine = record.enabled
                    ? `Auto moderation is active across ${result.rules.length} rule${result.rules.length === 1 ? '' : 's'}, sir.`
                    : 'Auto moderation is currently disabled, sir.';
                const effectiveFilters = this.getEffectiveAutoModFilters(record).expanded.length;
                const patternLine = effectiveFilters
                    ? ` Now enforcing ${effectiveFilters} pattern${effectiveFilters === 1 ? '' : 's'}.`
                    : '';
                const summary = [
                    `Blacklist now tracks ${record.keywords.length} entr${record.keywords.length === 1 ? 'y' : 'ies'}.`,
                    ` ${statusLine}`,
                    patternLine
                ].join('');
                await interaction.editReply(summary);
            } catch (error) {
                console.error('Failed to import auto moderation keywords:', error);
                await replyWithError('I could not apply that blacklist to Discord, sir.');
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
            
            // Create attachment
            const attachment = new AttachmentBuilder(imageBuffer, { name: 'clipped.png' });
            
            // Send the image with "clipped, sir." message
            await interaction.editReply({ 
                content: 'clipped, sir.', 
                files: [attachment] 
            });
            
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

    async handleSlashCommand(interaction) {
        const userId = interaction.user.id;

        if (this.isOnCooldown(userId)) {
            return;
        }

        // Handle clip command first (special case)
        if (interaction.commandName === "clip") {
            this.setCooldown(userId);
            return await this.handleSlashCommandClip(interaction);
        }

        const ephemeralCommands = new Set(["help", "profile", "history", "recap", "reactionrole", "automod", "serverstats", "memberlog"]);
        const shouldBeEphemeral = ephemeralCommands.has(interaction.commandName);

        try {
            await interaction.deferReply({ ephemeral: shouldBeEphemeral });
        } catch (error) {
            if (error.code === 10062) {
                console.warn("Ignored unknown interaction during deferReply.");
                return;
            }
            console.error("Failed to defer reply:", error);
            return;
        }

        try {
            let response;

            if (interaction.commandName === "jarvis") {
                let prompt = interaction.options.getString("prompt");

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
                    this.setCooldown(userId);
                    return;
                }

                if (prompt.length > config.ai.maxInputLength) {
                    prompt = prompt.substring(0, config.ai.maxInputLength) + "...";
                }

                response = await this.jarvis.generateResponse(interaction, prompt, true);
            } else if (interaction.commandName === "roll") {
                const sides = interaction.options.getInteger("sides") || 6;
                response = await this.jarvis.handleUtilityCommand(
                    `roll ${sides}`,
                    interaction.user.username,
                    interaction.user.id,
                    true,
                    interaction
                );
            } else if (interaction.commandName === "time") {
                response = await this.jarvis.handleUtilityCommand(
                    "time",
                    interaction.user.username,
                    interaction.user.id,
                    true,
                    interaction
                );
            } else if (interaction.commandName === "reset") {
                response = await this.jarvis.handleUtilityCommand(
                    "reset",
                    interaction.user.username,
                    interaction.user.id,
                    true,
                    interaction
                );
            } else if (interaction.commandName === "help") {
                response = await this.jarvis.handleUtilityCommand(
                    "help",
                    interaction.user.username,
                    interaction.user.id,
                    true,
                    interaction
                );
            } else if (interaction.commandName === "profile") {
                response = await this.jarvis.handleUtilityCommand(
                    "profile",
                    interaction.user.username,
                    interaction.user.id,
                    true,
                    interaction
                );
            } else if (interaction.commandName === "history") {
                response = await this.jarvis.handleUtilityCommand(
                    "history",
                    interaction.user.username,
                    interaction.user.id,
                    true,
                    interaction
                );
            } else if (interaction.commandName === "recap") {
                response = await this.jarvis.handleUtilityCommand(
                    "recap",
                    interaction.user.username,
                    interaction.user.id,
                    true,
                    interaction
                );
            } else if (interaction.commandName === "reactionrole") {
                await this.handleReactionRoleCommand(interaction);
                this.setCooldown(userId);
                return;
            } else if (interaction.commandName === "automod") {
                await this.handleAutoModCommand(interaction);
                this.setCooldown(userId);
                return;
            } else if (interaction.commandName === "serverstats") {
                await this.handleServerStatsCommand(interaction);
                this.setCooldown(userId);
                return;
            } else if (interaction.commandName === "memberlog") {
                await this.handleMemberLogCommand(interaction);
                this.setCooldown(userId);
                return;
            } else if (interaction.commandName === "encode") {
                response = await this.jarvis.handleUtilityCommand(
                    "encode",
                    interaction.user.username,
                    interaction.user.id,
                    true,
                    interaction
                );
            } else if (interaction.commandName === "decode") {
                response = await this.jarvis.handleUtilityCommand(
                    "decode",
                    interaction.user.username,
                    interaction.user.id,
                    true,
                    interaction
                );
            } else {
                response = await this.jarvis.handleUtilityCommand(
                    interaction.commandName,
                    interaction.user.username,
                    interaction.user.id,
                    true,
                    interaction
                );
            }

            if (!response) {
                await interaction.editReply("Response circuits tangled, sir. Try again?");
            } else if (typeof response === "string") {
                const trimmed = response.trim();
                await interaction.editReply(trimmed.length ? trimmed : "Response circuits tangled, sir. Try again?");
            } else {
                await interaction.editReply(response);
            }

            this.setCooldown(userId);
        } catch (error) {
            console.error("Error processing interaction:", error);
            try {
                await interaction.editReply("Technical difficulties, sir. One moment, please.");
            } catch (editError) {
                if (editError.code === 10062) {
                    console.warn("Ignored unknown interaction during error reply.");
                    return;
                }
                console.error("Failed to send error reply:", editError);
            }
            this.setCooldown(userId);
        }
    }
}

module.exports = new DiscordHandlers();

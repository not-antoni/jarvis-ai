'use strict';

const { ChannelType, PermissionsBitField } = require('discord.js');
const database = require('../database');

function createDefaultMemberLogConfig(guildId = null) {
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

function normalizeMemberLogMessage(handler, input) {
    if (!input || typeof input !== 'string') {
        return null;
    }

    let normalized = input.trim();
    if (!normalized) {
        return null;
    }

    if (normalized.length > handler.maxMemberLogMessageLength) {
        normalized = normalized.slice(0, handler.maxMemberLogMessageLength);
    }

    return normalized;
}

function sanitizeMemberLogList(handler, list = []) {
    if (!Array.isArray(list)) {
        return [];
    }

    const sanitized = [];
    const seen = new Set();

    for (const entry of list) {
        const normalized = normalizeMemberLogMessage(handler, entry);
        if (!normalized) {
            continue;
        }

        const key = normalized.toLowerCase();
        if (seen.has(key)) {
            continue;
        }

        seen.add(key);
        sanitized.push(normalized);

        if (sanitized.length >= handler.maxMemberLogVariations) {
            break;
        }
    }

    return sanitized;
}

function cloneMemberLogRecord(handler, record) {
    if (!record) {
        return null;
    }

    const cloned = {
        guildId: record.guildId || null,
        enabled: Boolean(record.enabled),
        channelId: record.channelId || null,
        joinMessages: sanitizeMemberLogList(handler, record.joinMessages),
        leaveMessages: sanitizeMemberLogList(handler, record.leaveMessages),
        customJoinMessage: normalizeMemberLogMessage(handler, record.customJoinMessage),
        customLeaveMessage: normalizeMemberLogMessage(handler, record.customLeaveMessage),
        createdAt: record.createdAt || null,
        updatedAt: record.updatedAt || null
    };

    if (record._id) {
        cloned._id = record._id;
    }

    return cloned;
}

async function getCachedMemberLogConfig(handler, guildId, refresh = false) {
    if (!guildId || !database.isConnected) {
        return null;
    }

    if (!refresh) {
        const cached = handler.memberLogCache.get(guildId);
        if (cached) {
            return cloneMemberLogRecord(handler, cached);
        }
    }

    try {
        const record = await database.getMemberLogConfig(guildId);
        if (record) {
            const sanitized = cloneMemberLogRecord(handler, record);
            handler.memberLogCache.set(guildId, sanitized);
            return cloneMemberLogRecord(handler, sanitized);
        }

        handler.memberLogCache.delete(guildId);
        return null;
    } catch (error) {
        console.error('Failed to fetch member log configuration:', error);
        return null;
    }
}

function setCachedMemberLogConfig(handler, guildId, record) {
    if (!guildId) {
        return;
    }

    if (record) {
        const sanitized = cloneMemberLogRecord(handler, record);
        handler.memberLogCache.set(guildId, sanitized);
    } else {
        handler.memberLogCache.delete(guildId);
    }
}

async function persistMemberLogConfig(handler, guildId, config) {
    if (!guildId || !config) {
        throw new Error('Missing guild identifier for member log configuration.');
    }

    const payload = {
        channelId: config.channelId || null,
        enabled: Boolean(config.enabled),
        joinMessages: sanitizeMemberLogList(handler, config.joinMessages),
        leaveMessages: sanitizeMemberLogList(handler, config.leaveMessages),
        customJoinMessage: normalizeMemberLogMessage(handler, config.customJoinMessage),
        customLeaveMessage: normalizeMemberLogMessage(handler, config.customLeaveMessage)
    };

    const saved = await database.saveMemberLogConfig(guildId, payload);
    setCachedMemberLogConfig(handler, guildId, saved);
    return cloneMemberLogRecord(handler, saved);
}

function pickMemberLogMessage(handler, type, config) {
    if (!config) {
        return null;
    }

    const override = type === 'join' ? config.customJoinMessage : config.customLeaveMessage;
    if (override) {
        return override;
    }

    const custom = type === 'join' ? config.joinMessages : config.leaveMessages;
    const defaults = type === 'join' ? handler.defaultJoinMessages : handler.defaultLeaveMessages;

    const pool = Array.isArray(custom) && custom.length > 0
        ? [...custom, ...defaults]
        : defaults;

    if (!pool.length) {
        return null;
    }

    return pool[Math.floor(Math.random() * pool.length)];
}

function formatMemberLogMessage(template, member, type) {
    if (!template || !member || !member.guild) {
        return null;
    }

    const { guild } = member;
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

function previewMemberLogMessage(template) {
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

async function sendMemberLogEvent(handler, member, type) {
    if (!member || !member.guild || !database.isConnected) {
        return;
    }

    const { guild } = member;
    const config = await getCachedMemberLogConfig(handler, guild.id);
    if (!config || !config.enabled || !config.channelId) {
        return;
    }

    const template = pickMemberLogMessage(handler, type, config);
    if (!template) {
        return;
    }

    const formatted = formatMemberLogMessage(template, member, type);
    if (!formatted) {
        return;
    }

    const channel = await handler.resolveGuildChannel(guild, config.channelId);
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

async function handleGuildMemberAdd(handler, member, client) {
    await sendMemberLogEvent(handler, member, 'join');

    // Send welcome message if configured for this guild
    try {
        if (database.isConnected && member.guild) {
            const guildConfig = await handler.getGuildConfig(member.guild);
            if (guildConfig?.welcomeChannelId && guildConfig?.welcomeMessage) {
                const channel = await member.guild.channels.fetch(guildConfig.welcomeChannelId).catch(() => null);
                if (channel) {
                    const msg = guildConfig.welcomeMessage
                        .replace(/\{user\}/g, `<@${member.id}>`)
                        .replace(/\{username\}/g, member.user.username)
                        .replace(/\{server\}/g, member.guild.name)
                        .replace(/\{memberCount\}/g, String(member.guild.memberCount));
                    await channel.send({ content: msg, allowedMentions: { users: [member.id] } });
                }
            }
        }
    } catch (error) {
        console.warn('[Welcome] Failed to send welcome message:', error.message);
    }
}

async function handleGuildMemberRemove(handler, member) {
    await sendMemberLogEvent(handler, member, 'leave');
}

async function handleMemberLogCommand(handler, interaction) {
    const { guild } = interaction;

    if (!guild) {
        await interaction.editReply('This command may only be used within a server, sir.');
        return;
    }

    if (!(await handler.isGuildModerator(interaction.member))) {
        await interaction.editReply('Only the server owner or configured moderators may do that, sir.');
        return;
    }

    const subcommand = interaction.options.getSubcommand();
    let config = await getCachedMemberLogConfig(handler, guild.id, true);
    if (!config) {
        config = createDefaultMemberLogConfig(guild.id);
    }

    config.joinMessages = Array.isArray(config.joinMessages) ? [...config.joinMessages] : [];
    config.leaveMessages = Array.isArray(config.leaveMessages) ? [...config.leaveMessages] : [];

    const replyWithError = async message => {
        await interaction.editReply(message);
    };

    try {
        if (subcommand === 'status') {
            const joinLines = config.joinMessages.length
                ? config.joinMessages.map((msg, idx) => `   ${idx + 1}. ${previewMemberLogMessage(msg)}`)
                : ['   (Using Jarvis defaults)'];
            const leaveLines = config.leaveMessages.length
                ? config.leaveMessages.map((msg, idx) => `   ${idx + 1}. ${previewMemberLogMessage(msg)}`)
                : ['   (Using Jarvis defaults)'];

            const lines = [
                'Here is the current join and leave reporting setup, sir:',
                `• Channel: ${config.channelId ? `<#${config.channelId}>` : 'Not configured'}`,
                `• Enabled: ${config.enabled ? 'Yes' : 'No'}`,
                `• Custom join message: ${config.customJoinMessage ? `"${previewMemberLogMessage(config.customJoinMessage)}"` : 'None'}`,
                `• Custom leave message: ${config.customLeaveMessage ? `"${previewMemberLogMessage(config.customLeaveMessage)}"` : 'None'}`,
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
            config = await persistMemberLogConfig(handler, guild.id, config);
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
            config = await persistMemberLogConfig(handler, guild.id, config);
            await interaction.editReply('Join and leave reporting enabled, sir.');
            return;
        }

        if (subcommand === 'disable') {
            if (!config.enabled) {
                await interaction.editReply('It was already disabled, sir.');
                return;
            }

            config.enabled = false;
            config = await persistMemberLogConfig(handler, guild.id, config);
            await interaction.editReply('Understood. I will keep quiet about joins and leaves for now, sir.');
            return;
        }

        if (subcommand === 'addvariation') {
            const type = interaction.options.getString('type', true);
            const messageInput = interaction.options.getString('message', true);
            const normalized = normalizeMemberLogMessage(handler, messageInput);

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

            if (target.length >= handler.maxMemberLogVariations) {
                await replyWithError('We have reached the variation limit, sir. Please remove one before adding another.');
                return;
            }

            target.push(normalized);
            config = await persistMemberLogConfig(handler, guild.id, config);

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
            config = await persistMemberLogConfig(handler, guild.id, config);

            const label = type === 'leave' ? 'leave' : 'join';
            await interaction.editReply(`Removed the ${label} variation at position ${index}, sir.`);
            return;
        }

        if (subcommand === 'setcustom') {
            const type = interaction.options.getString('type', true);
            const messageInput = interaction.options.getString('message', true);
            const normalized = normalizeMemberLogMessage(handler, messageInput);

            if (!normalized) {
                await replyWithError('Please provide a concise message under 400 characters, sir.');
                return;
            }

            if (type === 'leave') {
                config.customLeaveMessage = normalized;
            } else {
                config.customJoinMessage = normalized;
            }

            config = await persistMemberLogConfig(handler, guild.id, config);
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

            config = await persistMemberLogConfig(handler, guild.id, config);
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

module.exports = {
    createDefaultMemberLogConfig,
    normalizeMemberLogMessage,
    sanitizeMemberLogList,
    cloneMemberLogRecord,
    getCachedMemberLogConfig,
    setCachedMemberLogConfig,
    persistMemberLogConfig,
    pickMemberLogMessage,
    formatMemberLogMessage,
    previewMemberLogMessage,
    sendMemberLogEvent,
    handleGuildMemberAdd,
    handleGuildMemberRemove,
    handleMemberLogCommand
};

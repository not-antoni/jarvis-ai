'use strict';

const { MessageFlags } = require('discord.js');
const { commandMap: musicCommandMap } = require('../../commands/music');
const { splitMessage } = require('../../utils/discord-safe-send');
const { recordCommandRun } = require('../../utils/telemetry');
const { commandFeatureMap, SLASH_EPHEMERAL_COMMANDS } = require('../../core/command-registry');
const { isFeatureGloballyEnabled } = require('../../core/feature-flags');
const automodSlash = require('./automod-slash');
const gameHandlers = require('./game-handlers');
const mediaHandlers = require('./media-handlers');
const memberLog = require('./member-log');
const memoryHandler = require('./memory-handler');
const slashSocial = require('./slash-social');
const slashUtility = require('./slash-utility');
const {
    getBlockedUserIds,
    isGuildUserBlacklisted,
    resolveBlacklistedUsers,
    buildBlacklistAttachment
} = require('../../utils/guild-blacklist');
const {
    getConfiguredAiChannelId,
    resolveActiveAiChannelId,
    isMatchingAiChannel
} = require('../../utils/guild-ai-channel');

function isCommandEnabled(commandName) {
    const featureKey = commandFeatureMap.get(commandName);
    return isFeatureGloballyEnabled(featureKey);
}

const AI_CHANNEL_SCOPED_COMMANDS = new Set(['jarvis']);

async function handleBlacklist(interaction, handler) {
    if (!interaction.guild) {
        return {
            content: 'This command only works inside a server, sir.',
            allowedMentions: { parse: [] }
        };
    }

    const database = require('../database');
    const { guild } = interaction;
    const member = interaction.member?.guild
        ? interaction.member
        : await guild.members.fetch(interaction.user.id).catch(() => null);

    const guildConfig = await handler.getGuildConfig(guild);
    const isModerator = await handler.isGuildModerator(member, guildConfig);

    if (!isModerator) {
        return {
            content: 'Only the server owner or configured moderators may do that, sir.',
            allowedMentions: { parse: [] }
        };
    }

    if (!database.isConnected) {
        return {
            content: 'Database is offline, sir. Cannot manage the blacklist right now.',
            allowedMentions: { parse: [] }
        };
    }

    const subcommand = interaction.options.getSubcommand();
    const currentConfig = await database.getGuildConfig(guild.id, guild.ownerId);
    const blockedUserIds = getBlockedUserIds(currentConfig);

    if (subcommand === 'add') {
        const target = interaction.options.getUser('user', true);

        if (target.id === interaction.client.user?.id) {
            return {
                content: "Sir, I can't blacklist myself.",
                allowedMentions: { parse: [] }
            };
        }

        if (target.id === interaction.user.id) {
            return {
                content: 'You cannot blacklist yourself, sir.',
                allowedMentions: { parse: [] }
            };
        }

        if (target.id === guild.ownerId) {
            return {
                content: 'Cannot blacklist the server owner, sir.',
                allowedMentions: { parse: [] }
            };
        }

        if (blockedUserIds.includes(target.id)) {
            return {
                content: `**${target.tag || target.username}** (\`${target.id}\`) is already blacklisted, sir.`,
                allowedMentions: { parse: [] }
            };
        }

        await database.addGuildBlockedUser(guild.id, target.id);

        return {
            content: `🚫 **${target.tag || target.username}** (\`${target.id}\`) has been blacklisted from using Jarvis in **${guild.name}**, sir.`,
            allowedMentions: { parse: [] }
        };
    }

    if (subcommand === 'remove') {
        const target = interaction.options.getUser('user', true);

        if (!blockedUserIds.includes(target.id)) {
            return {
                content: `**${target.tag || target.username}** (\`${target.id}\`) is not blacklisted, sir.`,
                allowedMentions: { parse: [] }
            };
        }

        await database.removeGuildBlockedUser(guild.id, target.id);

        return {
            content: `✅ **${target.tag || target.username}** (\`${target.id}\`) has been removed from the blacklist in **${guild.name}**, sir.`,
            allowedMentions: { parse: [] }
        };
    }

    if (subcommand === 'list') {
        const entries = await resolveBlacklistedUsers(interaction.client, blockedUserIds);
        const summary = entries.length
            ? `${entries.length} user(s) are currently blacklisted in **${guild.name}**.`
            : `No users are currently blacklisted in **${guild.name}**.`;

        try {
            await interaction.user.send({
                content: `Blacklist export for **${guild.name}**.\n${summary}`,
                files: [buildBlacklistAttachment(guild, entries)]
            });

            return {
                content: `📄 Sent the blacklist file to ${interaction.user}, sir. ${summary}`,
                allowedMentions: { parse: [] }
            };
        } catch (_) {
            return {
                content: `📄 ${interaction.user}, I could not DM you, so here is the blacklist file instead, sir. ${summary}`,
                files: [buildBlacklistAttachment(guild, entries)],
                allowedMentions: { parse: [] }
            };
        }
    }

    return {
        content: 'That blacklist action is not recognized, sir.',
        allowedMentions: { parse: [] }
    };
}

async function handleChannel(interaction, handler) {
    if (!interaction.guild) {
        return {
            content: 'This command only works inside a server, sir.',
            allowedMentions: { parse: [] }
        };
    }

    const database = require('../database');
    if (!database.isConnected) {
        return {
            content: 'Database is offline, sir. Cannot manage the channel restriction right now.',
            allowedMentions: { parse: [] }
        };
    }

    const { guild } = interaction;
    const member = interaction.member?.guild
        ? interaction.member
        : await guild.members.fetch(interaction.user.id).catch(() => null);
    const guildConfig = await handler.getGuildConfig(guild);
    const isModerator = await handler.isGuildModerator(member, guildConfig);

    if (!isModerator) {
        return {
            content: 'Only the server owner or configured moderators may do that, sir.',
            allowedMentions: { parse: [] }
        };
    }

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'set') {
        const channel = interaction.options.getChannel('channel', true);
        const currentChannelId = getConfiguredAiChannelId(guildConfig);

        if (currentChannelId === channel.id) {
            return {
                content: `Jarvis chat is already restricted to ${channel}, sir.`,
                allowedMentions: { parse: [] }
            };
        }

        await database.setGuildAiChannel(guild.id, channel.id);
        return {
            content: `Jarvis chat is now restricted to ${channel} in **${guild.name}**, sir.`,
            allowedMentions: { parse: [] }
        };
    }

    if (subcommand === 'remove') {
        const currentChannelId = getConfiguredAiChannelId(guildConfig);

        if (!currentChannelId) {
            return {
                content: 'Jarvis chat is not restricted to a specific channel in this server, sir.',
                allowedMentions: { parse: [] }
            };
        }

        await database.clearGuildAiChannel(guild.id);
        return {
            content: 'Jarvis chat channel restriction removed. It will work server-wide again, sir.',
            allowedMentions: { parse: [] }
        };
    }

    return {
        content: 'That channel action is not recognized, sir.',
        allowedMentions: { parse: [] }
    };
}

async function handle(handler, interaction) {
    const { commandName } = interaction;
    const userId = interaction.user.id;
    const guild = interaction.guild || null;
    const guildId = guild?.id || null;
    const cooldownScope = `slash:${commandName}`;
    const startedAt = Date.now();

    let telemetryStatus = 'ok';
    let telemetryError = null;
    const telemetryMetadata = {};
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
        const extractedRoute = handler.extractInteractionRoute(interaction);
        telemetrySubcommand = extractedRoute;

        if (commandName !== 'blacklist' && await isGuildUserBlacklisted(guildId, userId)) {
            telemetryStatus = 'error';
            telemetryMetadata.reason = 'guild-blacklisted';
            try {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({
                        content: 'You are blacklisted from using Jarvis in this server, sir.',
                        flags: MessageFlags.Ephemeral
                    });
                } else if (interaction.deferred && !interaction.replied) {
                    await interaction.editReply('You are blacklisted from using Jarvis in this server, sir.');
                }
            } catch (error) {
                if (error?.code !== 10062) {
                    console.warn('Failed to send blacklist notice:', error);
                }
            }
            return;
        }

        if (guild && AI_CHANNEL_SCOPED_COMMANDS.has(commandName)) {
            const configuredAiChannelId = await resolveActiveAiChannelId(guild);
            const interactionChannel = interaction.channel || {
                id: interaction.channelId,
                parentId: interaction.channel?.parentId || null
            };

            if (configuredAiChannelId && !isMatchingAiChannel(configuredAiChannelId, interactionChannel)) {
                telemetryStatus = 'error';
                telemetryMetadata.reason = 'ai-channel-restricted';
                try {
                    const notice = `Use <#${configuredAiChannelId}> for Jarvis chat in this server, sir.`;
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: notice, flags: MessageFlags.Ephemeral });
                    } else if (interaction.deferred && !interaction.replied) {
                        await interaction.editReply(notice);
                    }
                } catch (error) {
                    if (error?.code !== 10062) {
                        console.warn('Failed to send AI channel restriction notice:', error);
                    }
                }
                return;
            }
        }

        if (!isCommandEnabled(commandName)) {
            telemetryStatus = 'error';
            telemetryMetadata.reason = 'feature-disabled-global';
            try {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: 'That module is disabled in this deployment, sir.', flags: MessageFlags.Ephemeral });
                }
            } catch (error) {
                if (error?.code !== 10062) {
                    console.warn('Failed to send disabled command notice:', error);
                }
            }
            return;
        }

        const featureAllowed = await handler.isCommandFeatureEnabled(commandName, guild);
        if (!featureAllowed) {
            telemetryStatus = 'error';
            telemetryMetadata.reason = 'feature-disabled-guild';
            try {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: 'That module is disabled for this server, sir.', flags: MessageFlags.Ephemeral });
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

        if (handler.isOnCooldown(userId, cooldownScope)) {
            telemetryStatus = 'error';
            telemetryMetadata.reason = 'rate_limited';
            return;
        }

        if (commandName === 'voice') {
            shouldSetCooldown = true;
            const voiceChat = require('../voice-chat-service');
            try {
                if (!interaction.deferred && !interaction.replied) {
                    await interaction.deferReply();
                }
                const msg = await voiceChat.join(interaction);
                await interaction.editReply(msg);
            } catch (error) {
                console.error('[/voice] Error:', error);
                try {
                    await interaction.editReply('Voice system error, sir.');
                } catch {}
            }
            return;
        }

        if (commandName === 'clip') {
            shouldSetCooldown = true;
            const handled = await mediaHandlers.handleSlashCommandClip(handler, interaction);
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
                await interaction.deferReply(deferEphemeral ? { flags: MessageFlags.Ephemeral } : {});
            }
        } catch (error) {
            if (error.code === 10062) {
                telemetryStatus = 'error';
                telemetryMetadata.reason = 'unknown-interaction';
                console.warn('Ignored unknown interaction during deferReply.');
                return;
            }
            if (error.code === 40060) {
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

        if (commandName === 'automod') {
            await automodSlash.handleAutoModCommand(handler, interaction);
            return;
        }

        if (commandName === 'serverstats') {
            await handler.handleServerStatsCommand(interaction);
            return;
        }

        if (commandName === 'memberlog') {
            await memberLog.handleMemberLogCommand(handler, interaction);
            return;
        }

        if (commandName === 'news') {
            await handler.handleNewsCommand(interaction);
            return;
        }

        switch (commandName) {
            case 'Make it a Quote': {
                const quoteModules = require('../../commands/utility/quote');
                telemetryMetadata.category = 'utility';
                await quoteModules[0].execute(interaction);
                response = '__QUOTE_HANDLED__';
                break;
            }
            case 'ping': {
                telemetryMetadata.category = 'core';
                response = await slashUtility.handlePing(interaction);
                break;
            }
            case 'features': {
                telemetryMetadata.category = 'utilities';
                await gameHandlers.handleFeaturesCommand(handler, interaction);
                return;
            }
            case 'memory': {
                telemetryMetadata.category = 'utilities';
                await memoryHandler.handleMemoryCommand(handler, interaction);
                return;
            }
            case 'remind': {
                telemetryMetadata.category = 'utilities';
                await handler.handleRemindCommand(interaction);
                return;
            }
            case 'timezone': {
                telemetryMetadata.category = 'utilities';
                await handler.handleTimezoneCommand(interaction);
                return;
            }
            case 'opt': {
                telemetryMetadata.category = 'utilities';
                await gameHandlers.handleOptCommand(handler, interaction);
                return;
            }
            case 'wakeword': {
                telemetryMetadata.category = 'utilities';
                await handler.handleWakewordCommand(interaction);
                return;
            }
            case 'caption': {
                telemetryMetadata.category = 'utility';
                await mediaHandlers.handleCaptionCommand(handler, interaction);
                return;
            }
            case 'avatar': {
                telemetryMetadata.category = 'utility';
                response = await slashUtility.handleAvatar(interaction);
                break;
            }
            case 'banner': {
                telemetryMetadata.category = 'utility';
                response = await slashUtility.handleBanner(interaction);
                break;
            }
            case 'userinfo': {
                telemetryMetadata.category = 'utility';
                response = await slashUtility.handleUserinfo(interaction);
                break;
            }
            case 'serverinfo': {
                telemetryMetadata.category = 'utility';
                response = await slashUtility.handleServerinfo(interaction);
                break;
            }
            case 'ship': {
                telemetryMetadata.category = 'fun';
                response = await slashSocial.handleShip(interaction);
                break;
            }
            case 'yt': {
                telemetryMetadata.category = 'search';
                response = await slashUtility.handleYt(interaction, handler.jarvis);
                break;
            }
            case 'jarvis': {
                response = await slashUtility.handleJarvis(interaction, handler.jarvis);
                break;
            }
            case 'clear': {
                response = await slashUtility.handleClear(interaction, handler.jarvis, userId, guildId);
                break;
            }
            case 'help': {
                response = await slashUtility.handleHelp(interaction, handler.jarvis, userId, guildId);
                break;
            }
            case 'profile': {
                response = await slashUtility.handleProfile(interaction, handler.jarvis, userId, guildId);
                break;
            }
            case 'blacklist': {
                telemetryMetadata.category = 'operations';
                response = await handleBlacklist(interaction, handler);
                break;
            }
            case 'channel': {
                telemetryMetadata.category = 'operations';
                response = await handleChannel(interaction, handler);
                break;
            }
            default: {
                response = await handler.jarvis.handleUtilityCommand(
                    commandName,
                    interaction.member?.displayName || interaction.user.displayName || interaction.user.username,
                    userId,
                    true,
                    interaction,
                    guildId
                );
            }
        }

        if (response === '__QUOTE_HANDLED__' || response === '__JARVIS_HANDLED__') {
            return;
        }

        if (response === undefined || response === null) {
            console.warn(`[/jarvis] Empty response received; commandName=${commandName}`);
            try {
                await interaction.editReply('Temporary AI provider outage, sir. Please try again shortly.');
            } catch (error) {
                console.error('[/jarvis] Failed to editReply, trying followUp:', error.code, error.message);
                await interaction.followUp('Temporary AI provider outage, sir. Please try again shortly.');
            }
            telemetryMetadata.reason = 'empty-response';
            return;
        }

        if (typeof response === 'string') {
            const trimmed = response.trim();
            const safe = handler.sanitizePings(trimmed);
            if (!safe.length) {
                await interaction.editReply('Temporary AI provider outage, sir. Please try again shortly.');
                return;
            }

            const chunks = splitMessage(safe);
            try {
                const sendPromise = interaction.editReply({
                    content: chunks[0],
                    allowedMentions: { parse: [] }
                });
                await Promise.race([
                    sendPromise,
                    new Promise((_, reject) => setTimeout(() => reject(new Error('editReply timeout')), 5000))
                ]);
                for (let i = 1; i < chunks.length; i++) {
                    await interaction.followUp({
                        content: chunks[i],
                        allowedMentions: { parse: [] }
                    });
                }
            } catch (error) {
                try {
                    await interaction.followUp({
                        content: chunks[0],
                        allowedMentions: { parse: [] }
                    });
                } catch (followUpError) {
                    console.error('[/jarvis] Response send failed:', error.message, followUpError.message);
                }
            }
            return;
        }

        const buildPayload = () => {
            const payload = response && typeof response === 'object'
                ? { ...response }
                : { content: String(response || '') };
            payload.allowedMentions = payload.allowedMentions || { parse: [] };
            payload.allowedMentions.parse = Array.isArray(payload.allowedMentions.parse)
                ? payload.allowedMentions.parse
                : [];
            return payload;
        };

        try {
            await Promise.race([
                interaction.editReply(buildPayload()),
                new Promise((_, reject) => setTimeout(() => reject(new Error('editReply timeout')), 5000))
            ]);
        } catch (error) {
            try {
                await interaction.followUp(buildPayload());
            } catch (followUpError) {
                console.error('[/jarvis] Embed send failed:', error.message, followUpError.message);
            }
        }
    } catch (error) {
        telemetryStatus = 'error';
        telemetryError = error;

        const errorId = `J-${Date.now().toString(36).slice(-4).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
        console.error(`[${errorId}] Error processing interaction:`, error);

        try {
            const errorMessage = `Technical difficulties, sir. (${errorId}) Please try again shortly.`;
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply(errorMessage);
            } else if (interaction.deferred && !interaction.replied) {
                await interaction.editReply(errorMessage);
            }
        } catch (editError) {
            if (editError.code === 10062) {
                telemetryMetadata.reason = 'unknown-interaction';
                console.warn(`[${errorId}] Ignored unknown interaction during error reply.`);
            } else {
                console.error(`[${errorId}] Failed to send error reply:`, editError.code, editError.message);
            }
        }
        shouldSetCooldown = true;
    } finally {
        if (shouldSetCooldown) {
            handler.setCooldown(userId, cooldownScope);
        }
        finalizeTelemetry();
    }
}

module.exports = {
    handle,
    handleBlacklist
};

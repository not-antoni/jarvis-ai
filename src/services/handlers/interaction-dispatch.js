'use strict';

const { commandMap: musicCommandMap } = require('../../commands/music');
const { splitMessage } = require('../../utils/discord-safe-send');
const { stripReactionDirectives } = require('../../utils/react-tags');
const { recordCommandRun } = require('../../utils/telemetry');
const { commandFeatureMap, SLASH_EPHEMERAL_COMMANDS } = require('../../core/command-registry');
const { isFeatureGloballyEnabled } = require('../../core/feature-flags');
const slashSocial = require('./slash-social');
const slashUtility = require('./slash-utility');

function isCommandEnabled(commandName) {
    const featureKey = commandFeatureMap.get(commandName);
    return isFeatureGloballyEnabled(featureKey);
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

    const featureAllowed = await handler.isCommandFeatureEnabled(commandName, guild);
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

    if (handler.isOnCooldown(userId, cooldownScope)) {
        telemetryStatus = 'error';
        telemetryMetadata.reason = 'rate_limited';
        return;
    }

    if (commandName === 'clip') {
        shouldSetCooldown = true;
        const handled = await handler.handleSlashCommandClip(interaction);
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

    // Ticket and KB commands removed - features disabled

    if (commandName === 'ask') {
        await handler.handleAskCommand(interaction);
        return;
    }

    if (commandName === 'reactionrole') {
        await handler.handleReactionRoleCommand(interaction);
        return;
    }

    if (commandName === 'automod') {
        await handler.handleAutoModCommand(interaction);
        return;
    }

    if (commandName === 'serverstats') {
        await handler.handleServerStatsCommand(interaction);
        return;
    }

    if (commandName === 'memberlog') {
        await handler.handleMemberLogCommand(interaction);
        return;
    }

    if (commandName === 'news') {
        await handler.handleNewsCommand(interaction);
        return;
    }

    // Delegate moderation commands to specialized handler
    const { handleModerationCommand, MODERATION_COMMANDS } = require('./moderation-handler');
    if (MODERATION_COMMANDS.includes(commandName)) {
        const result = await handleModerationCommand(commandName, interaction, telemetryMetadata);
        if (result.handled && result.response !== null) {
            response = result.response;
            // Skip to response handling section
            if (response === undefined || response === null) {
                console.warn(`[/jarvis] Empty response from moderation handler; commandName=${  commandName}`);
                try {
                    await interaction.editReply('Response circuits tangled, sir. Try again?');
                } catch (e) {
                    await interaction.followUp('Response circuits tangled, sir. Try again?');
                }
            } else if (typeof response === 'string') {
                const cleanedModResponse = stripReactionDirectives(response);
                const trimmed = cleanedModResponse.trim();
                const safe = handler.sanitizePings(trimmed);
                const msg = safe.length > 2000 ? `${safe.slice(0, 1997)  }...` : (safe.length ? safe : 'Response circuits tangled, sir. Try again?');
                try {
                    await interaction.editReply({ content: msg, allowedMentions: { parse: [] } });
                } catch (e) {
                    try { await interaction.followUp({ content: msg, allowedMentions: { parse: [] } }); } catch (_fe) { console.warn('[slash] followUp fallback failed:', _fe.message); }
                }
            } else {
                // Object response (embeds, etc.)
                try {
                    const payload = { ...response };
                    payload.allowedMentions = payload.allowedMentions || { parse: [] };
                    await interaction.editReply(payload);
                } catch (e) {
                    try { await interaction.followUp(response); } catch (_fe) { console.warn('[slash] followUp fallback failed:', _fe.message); }
                }
            }
            finalizeTelemetry();
            return;
        }
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
            await handler.handleFeaturesCommand(interaction);
            return;
        }
        case 'memory': {
            telemetryMetadata.category = 'utilities';
            await handler.handleMemoryCommand(interaction);
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
            await handler.handleOptCommand(interaction);
            return;
        }
        case 'wakeword': {
            telemetryMetadata.category = 'utilities';
            await handler.handleWakewordCommand(interaction);
            return;
        }
        // ============ FUN / SOCIAL COMMANDS ============
        case 'caption': {
            telemetryMetadata.category = 'utility';
            await handler.handleCaptionCommand(interaction);
            return;
        }
        case 'gif': {
            telemetryMetadata.category = 'utility';
            await handler.handleGifCommand(interaction);
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
        case 'search': {
            telemetryMetadata.category = 'search';
            response = await slashUtility.handleSearch(interaction, handler.jarvis);
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
        case 'history': {
            response = await slashUtility.handleHistory(interaction, handler.jarvis, userId, guildId);
            break;
        }
        case 'digest': {
            response = await slashUtility.handleDigest(interaction, handler.jarvis, userId, guildId);
            break;
        }
        default: {
            response = await handler.jarvis.handleUtilityCommand(
                commandName,
                interaction.user.username,
                userId,
                true,
                interaction,
                guildId
            );
        }
    }

    if (response === '__QUOTE_HANDLED__' || response === '__JARVIS_HANDLED__') {
        // These handlers manage their own responses, skip normal handling
        
    } else if (response === undefined || response === null) {
        console.warn(`[/jarvis] Empty response received; commandName=${  commandName}`);
        try {
            await interaction.editReply('Response circuits tangled, sir. Try again?');
        } catch (e) {
            console.error('[/jarvis] Failed to editReply, trying followUp:', e.code, e.message);
            await interaction.followUp('Response circuits tangled, sir. Try again?');
        }
        telemetryMetadata.reason = 'empty-response';
    } else if (typeof response === 'string') {
        // Strip any reaction directive — slash commands can't react on the user's message
        const cleanedResponse = stripReactionDirectives(response);
        const trimmed = cleanedResponse.trim();
        const safe = handler.sanitizePings(trimmed);
        if (!safe.length) {
            await interaction.editReply('Response circuits tangled, sir. Try again?');
        } else {
            const chunks = splitMessage(safe);
            try {
                const sendPromise = interaction.editReply({ content: chunks[0], allowedMentions: { parse: [] } });
                await Promise.race([
                    sendPromise,
                    new Promise((_, reject) => setTimeout(() => reject(new Error('editReply timeout')), 5000))
                ]);
                for (let i = 1; i < chunks.length; i++) {
                    await interaction.followUp({ content: chunks[i], allowedMentions: { parse: [] } });
                }
            } catch (e) {
                try {
                    await interaction.followUp({ content: chunks[0], allowedMentions: { parse: [] } });
                } catch (followUpError) {
                    console.error('[/jarvis] Response send failed:', e.message, followUpError.message);
                }
            }
        }
    } else {
        try {
            const payload = response && typeof response === 'object'
                ? { ...response }
                : { content: String(response || '') };
            payload.allowedMentions = payload.allowedMentions || { parse: [] };
            payload.allowedMentions.parse = Array.isArray(payload.allowedMentions.parse) ? payload.allowedMentions.parse : [];

            const sendPromise = interaction.editReply(payload);
            await Promise.race([
                sendPromise,
                new Promise((_, reject) => setTimeout(() => reject(new Error('editReply timeout')), 5000))
            ]);
        } catch (e) {
            try {
                const payload = response && typeof response === 'object'
                    ? { ...response }
                    : { content: String(response || '') };
                payload.allowedMentions = payload.allowedMentions || { parse: [] };
                payload.allowedMentions.parse = Array.isArray(payload.allowedMentions.parse) ? payload.allowedMentions.parse : [];
                await interaction.followUp(payload);
            } catch (followUpError) {
                console.error('[/jarvis] Embed send failed:', e.message, followUpError.message);
            }
        }
    }
} catch (error) {
    telemetryStatus = 'error';
    telemetryError = error;
    
    // Generate unique error code for debugging
    const errorId = `J-${Date.now().toString(36).slice(-4).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    console.error(`[${errorId}] Error processing interaction:`, error);

    // Report to error log channel for production triage
    try {
        const errorLogger = require('../error-logger');
        await errorLogger.log({
            error,
            errorId,
            context: {
                location: 'slash:handleSlashCommand',
                user: `${interaction.user?.username || 'unknown'} (${interaction.user?.id || 'unknown'})`,
                guild: interaction.guild ? `${interaction.guild.name} (${interaction.guild.id})` : 'DM',
                channel: `${interaction.channelId || 'unknown'}`,
                command: `${interaction.commandName || 'unknown'}`,
                extra: {
                    customId: interaction.customId,
                    options: interaction.options?._hoistedOptions || null
                }
            }
        });
    } catch {
        // ignore
    }
    
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
    handle
};

'use strict';

/**
 * Wire Discord client event handlers and process error/shutdown handlers.
 * Called from index.js after client creation.
 */
function wireEventHandlers(ctx) {
    const {
        client, discordHandlers, dashboardRouter, serverLogger,
        errorLogger, aiManager, database, cron, monitorScheduler,
        starkEconomy, wealthTax, serverStatsRefreshJob, tempSweepJob
    } = ctx;

    // ─── Guild Events ────────────────────────────────────────────────────────

    client.on('guildCreate', async guild => {
        console.log(
            `Joined new guild ${guild.name ?? 'Unknown'} (${guild.id}). Synchronizing slash commands.`
        );

        console.log('Provider status on startup:', aiManager.getProviderStatus());
    });

    client.on('messageCreate', async message => {
        dashboardRouter.trackMessage();
        await discordHandlers.handleMessage(message, client);
    });

    client.on('interactionCreate', async interaction => {
        try {
            if (interaction.isChatInputCommand() || interaction.isContextMenuCommand()) {
                dashboardRouter.trackCommand(interaction.commandName, interaction.user.id);
                await discordHandlers.handleSlashCommand(interaction);
            } else if (interaction.isButton()) {
                await discordHandlers.handleComponentInteraction(interaction);
            }
        } catch (error) {
            console.error('Interaction handler error:', error);
            if (
                typeof interaction.isRepliable === 'function' &&
                interaction.isRepliable() &&
                !interaction.replied &&
                !interaction.deferred
            ) {
                await interaction
                    .reply({ content: 'Technical difficulties, sir.', ephemeral: true })
                    .catch(() => { });
            }
        }
    });

    client.on('voiceStateUpdate', async (oldState, newState) => {
        await discordHandlers.handleVoiceStateUpdate(oldState, newState);
        await serverLogger.logVoiceStateUpdate(oldState, newState);

        try {
            const voiceMaster = require('../services/voice-master');
            await voiceMaster.handleVoiceStateUpdate(oldState, newState);
        } catch (e) {
            console.warn('VoiceMaster Error:', e);
        }
    });

    client.on('messageReactionAdd', async (reaction, user) => {
        await discordHandlers.handleReactionAdd(reaction, user);
    });

    client.on('messageReactionRemove', async (reaction, user) => {
        await discordHandlers.handleReactionRemove(reaction, user);
    });

    client.on('messageDelete', async message => {
        await discordHandlers.handleTrackedMessageDelete(message);
        await serverLogger.logMessageDelete(message);
    });

    client.on('messageUpdate', async (oldMessage, newMessage) => {
        await serverLogger.logMessageUpdate(oldMessage, newMessage);
    });

    client.on('messageDeleteBulk', async (messages, channel) => {
        await serverLogger.logBulkDelete(messages, channel);
    });

    client.on('guildMemberAdd', async member => {
        await discordHandlers.handleGuildMemberAdd(member, client);
        await serverLogger.logMemberJoin(member);
    });

    client.on('guildMemberRemove', async member => {
        await discordHandlers.handleGuildMemberRemove(member);
        await serverLogger.logMemberLeave(member);
    });

    client.on('guildMemberUpdate', async (oldMember, newMember) => {
        await serverLogger.logMemberUpdate(oldMember, newMember);
    });

    client.on('guildBanAdd', async ban => {
        await serverLogger.logBan(ban);
    });

    client.on('guildBanRemove', async ban => {
        await serverLogger.logUnban(ban);
    });

    client.on('roleCreate', async role => {
        await serverLogger.logRoleCreate(role);
    });

    client.on('roleDelete', async role => {
        await serverLogger.logRoleDelete(role);
    });

    client.on('roleUpdate', async (oldRole, newRole) => {
        await serverLogger.logRoleUpdate(oldRole, newRole);
    });

    client.on('channelCreate', async channel => {
        await serverLogger.logChannelCreate(channel);
    });

    client.on('channelDelete', async channel => {
        await serverLogger.logChannelDelete(channel);
    });

    client.on('channelUpdate', async (oldChannel, newChannel) => {
        await serverLogger.logChannelUpdate(oldChannel, newChannel);
    });

    client.on('emojiCreate', async emoji => {
        await serverLogger.logEmojiCreate(emoji);
    });

    client.on('emojiDelete', async emoji => {
        await serverLogger.logEmojiDelete(emoji);
    });

    client.on('emojiUpdate', async (oldEmoji, newEmoji) => {
        await serverLogger.logEmojiUpdate(oldEmoji, newEmoji);
    });

    client.on('guildUpdate', async (oldGuild, newGuild) => {
        await serverLogger.logGuildUpdate(oldGuild, newGuild);
    });

    // ─── Cleanup Cron ────────────────────────────────────────────────────────

    cron.schedule('0 2 * * *', () => {
        console.log('Running daily cleanup...');
        aiManager.cleanupOldMetrics();
        discordHandlers.cleanupCooldowns();
    });

    // ─── Error Handling ──────────────────────────────────────────────────────

    client.on('error', err => {
        console.error('Discord client error:', err);
        try {
            errorLogger.log({
                error: err,
                context: {
                    location: 'discord.client.error',
                    command: 'client.error',
                    extra: { message: err?.message }
                }
            });
        } catch {
            // ignore
        }
    });

    process.on('unhandledRejection', err => {
        console.error('Unhandled promise rejection:', err);
        try {
            errorLogger.log({
                error: err,
                context: {
                    location: 'process.unhandledRejection',
                    command: 'unhandledRejection'
                }
            });
        } catch {
            // ignore
        }
    });

    process.on('uncaughtException', err => {
        console.error('Uncaught exception:', err);
        try {
            errorLogger.log({
                error: err,
                context: {
                    location: 'process.uncaughtException',
                    command: 'uncaughtException'
                }
            });
        } catch {
            // ignore
        }
    });

    // ─── Graceful Shutdown ───────────────────────────────────────────────────

    async function gracefulShutdown(signal) {
        console.log(`Jarvis received ${signal}, shutting down gracefully...`);
        try {
            serverStatsRefreshJob.stop();
            try { monitorScheduler.stop(); } catch (_) { }
            try { starkEconomy.stopMultiplierScheduler(); } catch (_) { }
            try { wealthTax.stopScheduler(); } catch (_) { }
            try { tempSweepJob.stop(); } catch (_) { }
            await database.disconnect();
            try { await require('../utils/logger').flush(); } catch (_) { }
            client.destroy();
        } catch (error) {
            console.error('Error during shutdown:', error);
        }
        process.exit(0);
    }

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

module.exports = { wireEventHandlers };

'use strict';

/**
 * Wire Discord client event handlers and process error/shutdown handlers.
 * Called from index.js after client creation.
 */
function wireEventHandlers(ctx) {
    const {
        client, discordHandlers, dashboardRouter,
        aiManager, database, cron,
        serverStatsRefreshJob, tempSweepJob, uptimeSnapshotJob
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
            } else if (interaction.isAutocomplete()) {
                await discordHandlers.handleAutocomplete(interaction);
            } else if (interaction.isButton() || interaction.isModalSubmit()) {
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

    client.on('voiceStateUpdate', async(oldState, newState) => {
        await discordHandlers.handleVoiceStateUpdate(oldState, newState);
        try {
            const voiceMaster = require('../services/voice-master');
            await voiceMaster.handleVoiceStateUpdate(oldState, newState);
        } catch (e) {
            console.warn('VoiceMaster Error:', e);
        }
    });

    client.on('messageUpdate', async(oldMessage, newMessage) => {
    });

    client.on('messageDeleteBulk', async(messages, channel) => {
    });

    client.on('guildMemberAdd', async member => {
        await discordHandlers.handleGuildMemberAdd(member, client);
    });

    client.on('guildMemberRemove', async member => {
        await discordHandlers.handleGuildMemberRemove(member);
    });

    client.on('guildMemberUpdate', async(oldMember, newMember) => {
    });

    client.on('guildBanAdd', async ban => {
    });

    client.on('guildBanRemove', async ban => {
    });

    client.on('roleCreate', async role => {
    });

    client.on('roleDelete', async role => {
    });

    client.on('roleUpdate', async(oldRole, newRole) => {
    });

    client.on('channelCreate', async channel => {
    });

    client.on('channelDelete', async channel => {
    });

    client.on('channelUpdate', async(oldChannel, newChannel) => {
    });

    client.on('emojiCreate', async emoji => {
    });

    client.on('emojiDelete', async emoji => {
    });

    client.on('emojiUpdate', async(oldEmoji, newEmoji) => {
    });

    client.on('guildUpdate', async(oldGuild, newGuild) => {
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
    });

    process.on('unhandledRejection', err => {
        console.error('Unhandled promise rejection:', err);
    });

    process.on('uncaughtException', err => {
        console.error('Uncaught exception:', err);
    });

    // ─── Graceful Shutdown ───────────────────────────────────────────────────

    async function gracefulShutdown(signal) {
        console.log(`Jarvis received ${signal}, shutting down gracefully...`);
        try {
            serverStatsRefreshJob.stop();
            try { tempSweepJob.stop(); } catch (_) { }
            try { uptimeSnapshotJob.stop(); } catch (_) { }
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

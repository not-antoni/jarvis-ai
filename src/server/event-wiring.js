'use strict';

const { MessageFlags, Partials } = require('discord.js');
const interactionAutocomplete = require('../services/handlers/interaction-autocomplete');
const interactionDispatch = require('../services/handlers/interaction-dispatch');
const gameHandlers = require('../services/handlers/game-handlers');
const memberLog = require('../services/handlers/member-log');
const messageProcessing = require('../services/handlers/message-processing');
const voiceChatService = require('../services/voice-chat-service');

/**
 * Wire Discord client event handlers and process error/shutdown handlers.
 * Called from index.js after client creation.
 *
 * IMPORTANT — Partials:
 * The Discord gateway sends reaction events as partials when the message that
 * was reacted to is not already cached (e.g. older messages, or messages the
 * bot missed while offline). Without fetching the partial, reaction.message.id
 * is unreliable and handleContingencyReaction will silently never match.
 *
 * Make sure your Client is constructed with:
 *   partials: [Partials.Message, Partials.Channel, Partials.Reaction]
 * in addition to the GuildMessageReactions intent. Without those two the
 * messageReactionAdd event won't fire for uncached messages at all.
 */
function wireEventHandlers(ctx) {
    const {
        client, discordHandlers,
        aiManager, database, cron,
        serverStatsRefreshJob, tempSweepJob, uptimeSnapshotJob
    } = ctx;

    // ─── Voice Chat Init ──────────────────────────────────────────────────────
    voiceChatService.init(client, discordHandlers.jarvis);

    // ─── Guild Events ────────────────────────────────────────────────────────

    client.on('guildCreate', async guild => {
        console.log(
            `Joined new guild ${guild.name ?? 'Unknown'} (${guild.id}). Synchronizing slash commands.`
        );
    });


    client.on('messageCreate', async message => {
        await messageProcessing.handleMessage(discordHandlers, message, client);
    });

    // Re-scan on messageUpdate to catch embeds that load after the initial message
    client.on('messageUpdate', async (_oldMessage, newMessage) => {
        try {
            // Partial messages won't have author — skip
            if (newMessage.partial) return;
            const furryDetector = require('../services/furry-detector');
            await furryDetector.scanAndDelete(newMessage);
        } catch (e) {
            console.error('[FurryDetector] messageUpdate scan error:', e.message);
        }
    });

    // ─── Contingency Reaction Handler ────────────────────────────────────────
    // Handles the ✅ reaction that admins add to activate contingency protocols.
    // Reactions on old/uncached messages arrive as partials and MUST be fetched
    // before use — otherwise reaction.message.id and emoji data are missing.
    client.on('messageReactionAdd', async (reaction, user) => {
        try {
            // Skip non-✅ reactions immediately (cheap early-exit before any fetches)
            if (reaction.emoji.name !== '✅') return;

            // Fetch partials — Discord sends partial objects for uncached messages
            if (reaction.partial) {
                try {
                    await reaction.fetch();
                } catch (e) {
                    console.warn('[FurryDetector] Failed to fetch partial reaction:', e.message);
                    return;
                }
            }
            if (reaction.message.partial) {
                try {
                    await reaction.message.fetch();
                } catch (e) {
                    console.warn('[FurryDetector] Failed to fetch partial reaction message:', e.message);
                    return;
                }
            }
            if (user.partial) {
                try {
                    await user.fetch();
                } catch (e) {
                    console.warn('[FurryDetector] Failed to fetch partial reacting user:', e.message);
                    return;
                }
            }

            const furryDetector = require('../services/furry-detector');
            await furryDetector.handleContingencyReaction(reaction, user);
        } catch (e) {
            console.error('[FurryDetector] messageReactionAdd handler error:', e.message);
        }
    });

    client.on('interactionCreate', async interaction => {
        try {
            if (interaction.isChatInputCommand() || interaction.isContextMenuCommand()) {
                await interactionDispatch.handle(discordHandlers, interaction);
            } else if (interaction.isAutocomplete()) {
                await interactionAutocomplete.handle(discordHandlers, interaction);
            } else if (interaction.isButton() || interaction.isModalSubmit()) {
                await gameHandlers.handleComponentInteraction(discordHandlers, interaction);
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
                    .reply({ content: 'Technical difficulties, sir.', flags: MessageFlags.Ephemeral })
                    .catch(() => { });
            }
        }
    });

    client.on('voiceStateUpdate', async(oldState, newState) => {
        try {
            const voiceMaster = require('../services/voice-master');
            await voiceMaster.handleVoiceStateUpdate(oldState, newState);
        } catch (e) {
            console.warn('VoiceMaster Error:', e);
        }
        try {
            voiceChatService.handleVoiceStateUpdate(oldState, newState);
        } catch (e) {
            console.warn('VoiceChat auto-leave error:', e);
        }
    });

    client.on('guildMemberAdd', async member => {
        await memberLog.handleGuildMemberAdd(discordHandlers, member, client);
    });

    client.on('guildMemberRemove', async member => {
        await memberLog.handleGuildMemberRemove(discordHandlers, member);
    });

    // ─── Cleanup Cron ────────────────────────────────────────────────────────

    cron.schedule('0 2 * * *', async () => {
        console.log('Running daily cleanup...');
        aiManager.cleanupOldMetrics();
        discordHandlers.cleanupCooldowns();
        // Explicit prune of cooldown entries older than 1 hour
        try { discordHandlers.cooldowns?.prune(60 * 60 * 1000); } catch (_) {}
        // Flush guild activity data to database before it expires from LRU cache
        try {
            const activityTracker = require('../services/GUILDS_FEATURES/activity-tracker');
            const flushed = await activityTracker.flushToDatabase(database);
            if (flushed) console.log(`[ActivityTracker] Flushed ${flushed} guild(s) to database`);
        } catch (e) { console.warn('[ActivityTracker] Flush failed:', e.message); }
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
            try { require('../services/meme-sender').stop(); } catch (_) { }
            try { require('../services/user-features').stopReminderChecker(); } catch (_) { }
            try { voiceChatService.sessions.forEach((_, gid) => voiceChatService._destroy(gid)); } catch (_) { }
            // Flush debounced AI provider state before closing DB
            try { if (aiManager.stateDirty) await aiManager.saveState(); } catch (_) { }
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

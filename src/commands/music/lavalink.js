'use strict';

const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const { lavalinkManager } = require('../../services/lavalink-manager');
const { isGuildAllowed } = require('../../utils/musicGuildWhitelist');

// Cache for autocomplete results (avoid spamming Lavalink)
const searchCache = new Map();
const CACHE_TTL_MS = 30000; // 30 seconds

module.exports = {
    data: new SlashCommandBuilder()
        .setName('lavalink')
        .setDescription('Play music via Lavalink (selfhost only)')
        .addSubcommand(sub =>
            sub.setName('play')
                .setDescription('Search and play a track')
                .addStringOption(opt =>
                    opt.setName('query')
                        .setDescription('Song name or YouTube URL')
                        .setRequired(true)
                        .setAutocomplete(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('skip')
                .setDescription('Skip the current track')
        )
        .addSubcommand(sub =>
            sub.setName('pause')
                .setDescription('Pause playback')
        )
        .addSubcommand(sub =>
            sub.setName('resume')
                .setDescription('Resume playback')
        )
        .addSubcommand(sub =>
            sub.setName('stop')
                .setDescription('Stop playback and clear queue')
        )
        .addSubcommand(sub =>
            sub.setName('queue')
                .setDescription('Show the current queue')
        )
        .addSubcommand(sub =>
            sub.setName('nowplaying')
                .setDescription('Show currently playing track')
        )
        .setDMPermission(false)
        .setContexts([InteractionContextType.Guild]),

    /**
     * Handle autocomplete for live YouTube search
     */
    async autocomplete(interaction) {
        if (!lavalinkManager.isAvailable()) {
            return interaction.respond([
                { name: '⚠️ Lavalink not connected', value: 'lavalink-unavailable' }
            ]);
        }

        const focused = interaction.options.getFocused();
        
        if (!focused || focused.length < 2) {
            return interaction.respond([]);
        }

        // Check cache first
        const cacheKey = focused.toLowerCase();
        const cached = searchCache.get(cacheKey);
        if (cached && Date.now() - cached.time < CACHE_TTL_MS) {
            return interaction.respond(cached.results);
        }

        try {
            const results = await lavalinkManager.search(focused);
            
            const choices = results.slice(0, 25).map(track => ({
                name: `${track.title.slice(0, 80)} [${lavalinkManager.formatDuration(track.duration)}]`.slice(0, 100),
                value: track.url || track.identifier
            }));

            // Cache results
            searchCache.set(cacheKey, { results: choices, time: Date.now() });

            // Cleanup old cache entries
            if (searchCache.size > 100) {
                const now = Date.now();
                for (const [key, val] of searchCache) {
                    if (now - val.time > CACHE_TTL_MS) {
                        searchCache.delete(key);
                    }
                }
            }

            return interaction.respond(choices);
        } catch (error) {
            console.error('Lavalink autocomplete error:', error.message);
            return interaction.respond([
                { name: `🔍 Search: "${focused}"`, value: focused }
            ]);
        }
    },

    async execute(interaction) {
        if (!interaction.guild) {
            return interaction.reply({ content: '⚠️ This command only works in servers, sir.', ephemeral: true });
        }

        if (!isGuildAllowed(interaction.guild.id)) {
            return interaction.reply({ content: '⚠️ Music playback is not enabled for this server, sir.', ephemeral: true });
        }

        if (!lavalinkManager.isAvailable()) {
            return interaction.reply({ 
                content: '⚠️ Lavalink is not available. This feature only works on selfhost with Lavalink server running.', 
                ephemeral: true 
            });
        }

        const sub = interaction.options.getSubcommand();

        // Commands that don't need voice channel
        if (sub === 'queue') {
            const queueInfo = lavalinkManager.getQueue(interaction.guild.id);
            if (!queueInfo || (!queueInfo.current && queueInfo.length === 0)) {
                return interaction.reply({ content: '📭 Queue is empty.', ephemeral: true });
            }

            const lines = [];
            if (queueInfo.current) {
                lines.push(`🎶 **Now Playing:** ${queueInfo.current.title}`);
            }
            if (queueInfo.queue.length > 0) {
                lines.push('', '**Up Next:**');
                queueInfo.queue.slice(0, 10).forEach((track, i) => {
                    lines.push(`${i + 1}. ${track.title} [${lavalinkManager.formatDuration(track.duration)}]`);
                });
                if (queueInfo.queue.length > 10) {
                    lines.push(`... and ${queueInfo.queue.length - 10} more`);
                }
            }
            return interaction.reply({ content: lines.join('\n'), ephemeral: true });
        }

        if (sub === 'nowplaying') {
            const queueInfo = lavalinkManager.getQueue(interaction.guild.id);
            if (!queueInfo?.current) {
                return interaction.reply({ content: '🔇 Nothing is currently playing.', ephemeral: true });
            }
            const track = queueInfo.current;
            return interaction.reply({
                content: `🎶 **Now Playing:** ${track.title}\n👤 ${track.author} • ⏱️ ${lavalinkManager.formatDuration(track.duration)}\n🔗 ${track.url}`,
                ephemeral: true
            });
        }

        // Simple commands
        if (sub === 'skip') {
            const result = await lavalinkManager.skip(interaction.guild.id);
            return interaction.reply(result);
        }

        if (sub === 'pause') {
            const result = lavalinkManager.pause(interaction.guild.id);
            return interaction.reply(result);
        }

        if (sub === 'resume') {
            const result = lavalinkManager.resume(interaction.guild.id);
            return interaction.reply(result);
        }

        if (sub === 'stop') {
            const result = lavalinkManager.stop(interaction.guild.id);
            return interaction.reply(result);
        }

        // Play command - needs voice channel
        if (sub === 'play') {
            const query = interaction.options.getString('query', true);

            if (query === 'lavalink-unavailable') {
                return interaction.reply({ content: '⚠️ Lavalink is not connected.', ephemeral: true });
            }

            const member = await interaction.guild.members.fetch(interaction.user.id);
            const voiceChannel = member.voice?.channel;

            if (!voiceChannel) {
                return interaction.reply({ content: '⚠️ Join a voice channel first, sir.', ephemeral: true });
            }

            if (!voiceChannel.joinable) {
                return interaction.reply({ content: '⚠️ I cannot join that voice channel, sir.', ephemeral: true });
            }

            await interaction.deferReply();

            try {
                // Search for the track
                const results = await lavalinkManager.search(query);
                
                if (results.length === 0) {
                    return interaction.editReply('❌ No results found, sir.');
                }

                const track = results[0];
                const message = await lavalinkManager.play(
                    interaction.guild.id,
                    voiceChannel,
                    track,
                    interaction.channel
                );

                return interaction.editReply(message);
            } catch (error) {
                console.error('Lavalink play error:', error);
                return interaction.editReply(`⚠️ ${error.message || 'Unable to play that track, sir.'}`);
            }
        }
    }
};

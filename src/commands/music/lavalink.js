'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { lavalinkManager } = require('../../services/lavalink-manager');
const { isGuildAllowed } = require('../../utils/musicGuildWhitelist');

// Cache for autocomplete
const searchCache = new Map();
const CACHE_TTL = 30000;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('lavalink')
        .setDescription('Play music via Lavalink (selfhost)')
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
        .addSubcommand(sub => sub.setName('skip').setDescription('Skip current track'))
        .addSubcommand(sub => sub.setName('pause').setDescription('Pause playback'))
        .addSubcommand(sub => sub.setName('resume').setDescription('Resume playback'))
        .addSubcommand(sub => sub.setName('stop').setDescription('Stop and clear queue'))
        .addSubcommand(sub => sub.setName('queue').setDescription('Show queue'))
        .addSubcommand(sub => sub.setName('np').setDescription('Now playing'))
        .setDMPermission(false),

    async autocomplete(interaction) {
        if (!lavalinkManager.isAvailable()) {
            return interaction.respond([{ name: '⚠️ Lavalink not connected', value: 'unavailable' }]);
        }

        const query = interaction.options.getFocused();
        if (!query || query.length < 2) {
            return interaction.respond([]);
        }

        // Check cache
        const cached = searchCache.get(query.toLowerCase());
        if (cached && Date.now() - cached.time < CACHE_TTL) {
            return interaction.respond(cached.results);
        }

        try {
            console.log('[Lavalink][autocomplete] Searching for:', query);
            // Use Promise.race to timeout after 2.5 seconds (Discord has 3s limit)
            const searchPromise = lavalinkManager.search(query, 10);
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Autocomplete timeout')), 2500)
            );
            
            const results = await Promise.race([searchPromise, timeoutPromise]);
            console.log('[Lavalink][autocomplete] Got', results?.length || 0, 'results');
            
            if (!results || results.length === 0) {
                console.log('[Lavalink][autocomplete] No results, returning fallback');
                return interaction.respond([{ name: `🔍 "${query}"`, value: query }]);
            }
            
            const choices = results.map(t => ({
                name: `${t.title.slice(0, 70)} [${lavalinkManager.formatDuration(t.duration)}]`.slice(0, 100),
                value: t.url || t.identifier
            }));

            console.log('[Lavalink][autocomplete] Returning', choices.length, 'choices');
            searchCache.set(query.toLowerCase(), { results: choices, time: Date.now() });
            
            // Cleanup old cache
            if (searchCache.size > 50) {
                for (const [k, v] of searchCache) {
                    if (Date.now() - v.time > CACHE_TTL) searchCache.delete(k);
                }
            }

            return interaction.respond(choices);
        } catch (error) {
            console.error('[Lavalink][autocomplete] Error:', error.message, error.stack);
            // Return the query as fallback so user can still submit
            return interaction.respond([{ name: `🔍 "${query}"`, value: query }]);
        }
    },

    async execute(interaction) {
        if (!interaction.guild) {
            return interaction.reply({ content: '⚠️ Server only.', ephemeral: true });
        }

        if (!isGuildAllowed(interaction.guild.id)) {
            return interaction.reply({ content: '⚠️ Music not enabled here.', ephemeral: true });
        }

        if (!lavalinkManager.isAvailable()) {
            return interaction.reply({ 
                content: '⚠️ Lavalink not connected. Check if Lavalink server is running.',
                ephemeral: true 
            });
        }

        const sub = interaction.options.getSubcommand();

        // Queue command
        if (sub === 'queue') {
            const q = lavalinkManager.getQueue(interaction.guild.id);
            if (!q || (!q.current && q.length === 0)) {
                return interaction.reply({ content: '📭 Queue empty.', ephemeral: true });
            }

            const lines = [];
            if (q.current) {
                lines.push(`🎶 **Now:** ${q.current.title}`);
            }
            if (q.tracks.length > 0) {
                lines.push('', '**Queue:**');
                q.tracks.slice(0, 10).forEach((t, i) => {
                    lines.push(`${i + 1}. ${t.title}`);
                });
                if (q.tracks.length > 10) lines.push(`...+${q.tracks.length - 10} more`);
            }
            return interaction.reply({ content: lines.join('\n'), ephemeral: true });
        }

        // Now playing
        if (sub === 'np') {
            const q = lavalinkManager.getQueue(interaction.guild.id);
            if (!q?.current) {
                return interaction.reply({ content: '🔇 Nothing playing.', ephemeral: true });
            }
            return interaction.reply({
                content: `🎶 **${q.current.title}** by ${q.current.author}`,
                ephemeral: true
            });
        }

        // Skip
        if (sub === 'skip') {
            const result = await lavalinkManager.skip(interaction.guild.id);
            return interaction.reply(result);
        }

        // Pause
        if (sub === 'pause') {
            const result = await lavalinkManager.pause(interaction.guild.id);
            return interaction.reply(result);
        }

        // Resume
        if (sub === 'resume') {
            const result = await lavalinkManager.resume(interaction.guild.id);
            return interaction.reply(result);
        }

        // Stop
        if (sub === 'stop') {
            const result = await lavalinkManager.stop(interaction.guild.id);
            return interaction.reply(result);
        }

        // Play
        if (sub === 'play') {
            const query = interaction.options.getString('query', true);
            
            if (query === 'unavailable') {
                return interaction.reply({ content: '⚠️ Lavalink not connected.', ephemeral: true });
            }

            const member = await interaction.guild.members.fetch(interaction.user.id);
            const vc = member.voice?.channel;

            if (!vc) {
                return interaction.reply({ content: '⚠️ Join a voice channel first.', ephemeral: true });
            }

            await interaction.deferReply();

            try {
                const results = await lavalinkManager.search(query, 1);
                if (results.length === 0) {
                    return interaction.editReply('❌ No results found.');
                }

                const track = results[0];
                const msg = await lavalinkManager.play(
                    interaction.guild.id,
                    vc.id,
                    interaction.channel.id,
                    track
                );

                return interaction.editReply(msg);
            } catch (error) {
                console.error('Lavalink play error:', error);
                return interaction.editReply(`⚠️ ${error.message}`);
            }
        }
    }
};

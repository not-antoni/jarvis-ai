const { DisTube } = require('distube');
const { SpotifyPlugin } = require('@distube/spotify');
const { SoundCloudPlugin } = require('@distube/soundcloud');
const { YtDlpPlugin } = require('@distube/yt-dlp');
const { EmbedBuilder } = require('discord.js');

let distube = null;

module.exports = {
    init: (client) => {
        console.log('[Distube] Init called');
        if (distube) return distube;

        // Debug logging for FFMPEG
        try {
            console.log('[Distube] requiring ffmpeg-static...');
            const ffmpegPath = require('ffmpeg-static');
            console.log('[Distube] ffmpeg path:', ffmpegPath);

            console.log('[Distube] Creating new DisTube instance...');
            distube = new DisTube(client, {
                ffmpeg: {
                    path: ffmpegPath
                },
                plugins: [
                    new SpotifyPlugin(),
                    new SoundCloudPlugin(),
                    new YtDlpPlugin({ update: false })
                ]
            });
        } catch (e) {
            console.error('[Distube] Crash during initialization:', e);
            throw e; // Re-throw to be caught by index.js
        }

        // Event Listeners
        distube
            .on('playSong', (queue, song) => {
                const source = song.source === 'youtube' ? 'YouTube' :
                    song.source === 'spotify' ? 'Spotify' :
                        song.source === 'soundcloud' ? 'SoundCloud' : song.source;

                const embed = new EmbedBuilder()
                    .setTitle('🎶 Now Playing')
                    .setDescription(`[${song.name}](${song.url})`)
                    .addFields(
                        { name: 'Duration', value: song.formattedDuration, inline: true },
                        { name: 'Source', value: source, inline: true },
                        { name: 'Requested By', value: `${song.user}`, inline: true }
                    )
                    .setThumbnail(song.thumbnail)
                    .setColor('#FF0000');

                // If we have the interaction that triggered this, edit it to remove "Searching..."
                const interaction = song.metadata?.originalInteraction;
                if (interaction && !song.metadata.hasReplied) {
                    interaction.editReply({ content: null, embeds: [embed] }).catch(err => {
                        // If interaction expired or failed, fall back to sending
                        queue.textChannel?.send({ embeds: [embed] }).catch(console.error);
                    });
                    song.metadata.hasReplied = true;
                } else {
                    queue.textChannel?.send({ embeds: [embed] }).catch(console.error);
                }
            })
            .on('addSong', (queue, song) => {
                const source = song.source === 'youtube' ? 'YouTube' :
                    song.source === 'spotify' ? 'Spotify' :
                        song.source === 'soundcloud' ? 'SoundCloud' : song.source;

                const embed = new EmbedBuilder()
                    .setTitle('✅ Added to Queue')
                    .setDescription(`[${song.name}](${song.url})`)
                    .addFields(
                        { name: 'Duration', value: song.formattedDuration, inline: true },
                        { name: 'Source', value: source, inline: true }
                    )
                    .setThumbnail(song.thumbnail)
                    .setColor('#00FF00');

                const interaction = song.metadata?.originalInteraction;
                if (interaction && !song.metadata.hasReplied) {
                    interaction.editReply({ content: null, embeds: [embed] }).catch(err => {
                        queue.textChannel?.send({ embeds: [embed] }).catch(console.error);
                    });
                    song.metadata.hasReplied = true;
                } else {
                    queue.textChannel?.send({ embeds: [embed] }).catch(console.error);
                }
            })
            .on('addList', (queue, playlist) => {
                queue.textChannel?.send(
                    `✅ Added playlist **${playlist.name}** (${playlist.songs.length} songs) to queue.`
                ).catch(console.error);
            })
            .on('error', (channel, e) => {
                console.error('[Distube Error]', e);
                if (channel) channel.send(`❌ An error encountered: ${e.toString().slice(0, 1974)}`);
            })
            .on('empty', channel => channel.send('Voice channel is empty! Leaving...'))
            .on('searchNoResult', (message, query) =>
                message.channel.send(`❌ No result found for \`${query}\`!`)
            )
            .on('finish', queue => queue.textChannel?.send('🏁 Queue finished!'));

        console.log('[Distube] Music System Initialized 🎵');
        return distube;
    },

    get: () => {
        if (!distube) throw new Error('Distube not initialized!');
        return distube;
    }
};

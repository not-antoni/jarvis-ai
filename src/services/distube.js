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
                    new YtDlpPlugin()
                ]
            });
        } catch (e) {
            console.error('[Distube] Crash during initialization:', e);
            throw e; // Re-throw to be caught by index.js
        }

        // Event Listeners
        distube
            .on('playSong', (queue, song) => {
                const embed = new EmbedBuilder()
                    .setTitle('🎶 Now Playing')
                    .setDescription(`[${song.name}](${song.url})`)
                    .addFields(
                        { name: 'Duration', value: song.formattedDuration, inline: true },
                        { name: 'Requested By', value: `${song.user}`, inline: true }
                    )
                    .setThumbnail(song.thumbnail)
                    .setColor('#FF0000');

                queue.textChannel?.send({ embeds: [embed] }).catch(console.error);
            })
            .on('addSong', (queue, song) => {
                // Duration Limit Check (20 minutes)
                if (song.duration > 1200) {
                    queue.textChannel?.send(`⚠️ **${song.name}** is too long (>20m). Skipping...`).catch(console.error);
                    // If it's the only song, stop? Or just let it play and skip? 
                    // Distube adds then plays. If we want to prevent it, we might need a custom plugin or just skip it immediately.
                    // For now, warning is good, but let's try to remove it from the queue if possible or just skip.
                    // queue.songs.pop(); // This might be risky if async.
                    // Best approach: Let it add, but if it plays, we skip it.
                    return;
                }

                const embed = new EmbedBuilder()
                    .setTitle('✅ Added to Queue')
                    .setDescription(`[${song.name}](${song.url})`)
                    .setColor('#00FF00');

                queue.textChannel?.send({ embeds: [embed] }).catch(console.error);
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

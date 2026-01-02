const { DisTube } = require('distube');
const { SpotifyPlugin } = require('@distube/spotify');
const { SoundCloudPlugin } = require('@distube/soundcloud');
const { YtDlpPlugin } = require('@distube/yt-dlp');
const { EmbedBuilder } = require('discord.js');

let distube = null;

module.exports = {
    init: (client) => {
        if (distube) return distube;

        distube = new DisTube(client, {
            plugins: [
                new SpotifyPlugin(),
                new SoundCloudPlugin(),
                new YtDlpPlugin()
            ]
        });

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

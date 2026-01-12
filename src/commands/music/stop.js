const { SlashCommandBuilder } = require('discord.js');
const distube = require('../../services/distube');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stop')
        .setDescription('Stop music and clear queue (stays in VC)'),
    async execute(interaction) {
        if (!interaction.guild) return;

        // DJ / Blocking Check
        const { canControlMusic } = require('../../utils/dj-system');
        if (!await canControlMusic(interaction)) return;

        let distubeInstance;
        try {
            distubeInstance = distube.get();
        } catch (e) {
            await interaction.reply({ content: '⚠️ Music system is still starting up.', flags: 64 });
            return;
        }

        const queue = distubeInstance.getQueue(interaction.guild);

        // If there's a queue, stop playback but stay in VC
        if (queue) {
            // Clear the queue songs first
            queue.songs = [];
            queue.previousSongs = [];
            // Stop current playback (but don't leave)
            try {
                queue.stop();
            } catch (e) {
                // Ignore stop errors
            }
            await interaction.reply('⏹️ Stopped music and cleared queue.');
            return;
        }

        // Not playing anything
        const voiceConnection = distubeInstance.voices.get(interaction.guild);
        if (voiceConnection) {
            await interaction.reply({ content: '⚠️ Nothing is playing. Use `/leave` to disconnect.', flags: 64 });
        } else {
            await interaction.reply({ content: '⚠️ Not in a voice channel.', flags: 64 });
        }
    }
};

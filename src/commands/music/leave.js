const { SlashCommandBuilder } = require('discord.js');
const distube = require('../../services/distube');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('leave')
        .setDescription('Disconnect from voice channel'),
    async execute(interaction) {
        if (!interaction.guild) return;

        let distubeInstance;
        try {
            distubeInstance = distube.get();
        } catch (e) {
            await interaction.reply({ content: '⚠️ Music system is still starting up.', flags: 64 });
            return;
        }

        // Check if there's an active queue
        const queue = distubeInstance.getQueue(interaction.guild);
        if (queue) {
            queue.stop();
        }

        // Leave voice channel
        const voiceConnection = distubeInstance.voices.get(interaction.guild);
        if (voiceConnection) {
            voiceConnection.leave();
            await interaction.reply('👋 Disconnected from voice channel.');
        } else {
            await interaction.reply({ content: '⚠️ Not in a voice channel.', flags: 64 });
        }
    }
};

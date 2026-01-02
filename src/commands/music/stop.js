const { SlashCommandBuilder } = require('discord.js');
const distube = require('../../services/distube');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stop')
        .setDescription('Stop music and clear queue'),
    async execute(interaction) {
        if (!interaction.guild) return;

        let distubeInstance;
        try {
            distubeInstance = distube.get();
        } catch (e) {
            await interaction.reply({ content: '⚠️ Music system is still starting up.', ephemeral: true });
            return;
        }

        const queue = distubeInstance.getQueue(interaction.guild);

        // 1. If there's a queue, stop it
        if (queue) {
            queue.stop();
            await interaction.reply('⏹️ Stopped music and cleared queue.');
            return;
        }

        // 2. If no queue, but bot is in voice, leave
        const voiceConnection = distubeInstance.voices.get(interaction.guild);
        if (voiceConnection) {
            voiceConnection.leave();
            await interaction.reply('👋 Left the voice channel.');
            return;
        }

        // 3. Not in voice, nothing playing
        await interaction.reply({ content: '⚠️ I am not playing anything or connected to a voice channel.', ephemeral: true });
    }
};

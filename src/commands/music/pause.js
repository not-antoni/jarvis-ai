const { SlashCommandBuilder } = require('discord.js');
const distube = require('../../services/distube');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('pause')
        .setDescription('Pause playback'),
    async execute(interaction) {
        if (!interaction.guild) return;
        const queue = distube.get().getQueue(interaction.guild);

        if (!queue) {
            await interaction.reply({ content: '⚠️ Nothing playing.', ephemeral: true });
            return;
        }

        if (queue.paused) {
            await interaction.reply('Already paused.');
            return;
        }

        queue.pause();
        await interaction.reply('⏸️ Paused.');
    }
};

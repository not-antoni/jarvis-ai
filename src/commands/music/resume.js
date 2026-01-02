const { SlashCommandBuilder } = require('discord.js');
const distube = require('../../services/distube');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('resume')
        .setDescription('Resume playback'),
    async execute(interaction) {
        if (!interaction.guild) return;
        const queue = distube.get().getQueue(interaction.guild);

        if (!queue) {
            await interaction.reply({ content: '⚠️ Nothing playing.', ephemeral: true });
            return;
        }

        if (!queue.paused) {
            await interaction.reply('Already playing.');
            return;
        }

        queue.resume();
        await interaction.reply('▶️ Resumed.');
    }
};

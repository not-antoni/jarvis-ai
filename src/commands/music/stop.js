const { SlashCommandBuilder } = require('discord.js');
const distube = require('../../services/distube');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stop')
        .setDescription('Stop music and clear queue'),
    async execute(interaction) {
        if (!interaction.guild) return;
        const queue = distube.get().getQueue(interaction.guild);

        if (!queue) {
            await interaction.reply({ content: '⚠️ Nothing is playing right now, sir.', ephemeral: true });
            return;
        }

        queue.stop();
        await interaction.reply('⏹️ Stopped and cleared queue.');
    }
};

const { SlashCommandBuilder } = require('discord.js');
const distube = require('../../services/distube');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('skip')
        .setDescription('Skip the current song'),
    async execute(interaction) {
        if (!interaction.guild) return;
        const queue = distube.get().getQueue(interaction.guild);

        if (!queue) {
            await interaction.reply({ content: '⚠️ Nothing is playing right now, sir.', ephemeral: true });
            return;
        }

        try {
            await queue.skip();
            await interaction.reply('⏭️ Skipped.');
        } catch (e) {
            await interaction.reply({ content: '❌ Could not skip (maybe end of queue).', ephemeral: true });
        }
    }
};

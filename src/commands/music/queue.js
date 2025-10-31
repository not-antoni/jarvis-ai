const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const { musicManager } = require('../../core/musicManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('queue')
        .setDescription('Show the current music queue.')
        .setDMPermission(false)
        .setContexts([InteractionContextType.Guild]),

    async execute(interaction) {
        if (!interaction.guild) {
            await interaction.reply('⚠️ This command is only available inside servers, sir.');
            return;
        }

        await interaction.deferReply();
        const queue = musicManager.showQueue(interaction.guild.id);
        await interaction.editReply(queue);
    }
};


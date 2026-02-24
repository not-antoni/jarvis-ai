const { SlashCommandBuilder } = require('discord.js');
const { musicManager } = require('../../core/musicManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('resume')
        .setDescription('Resume playback'),
    async execute(interaction) {
        if (!interaction.guild) {return;}

        // DJ / Blocking Check
        const { canControlMusic } = require('../../utils/dj-system');
        if (!await canControlMusic(interaction)) {return;}

        const manager = musicManager.get();
        const message = manager.resume(interaction.guildId);
        await interaction.reply({ content: message, flags: 64 });
    }
};

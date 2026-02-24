const { SlashCommandBuilder } = require('discord.js');
const { musicManager } = require('../../core/musicManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('skip')
        .setDescription('Skip the current song or jump to a position in queue')
        .addIntegerOption(option =>
            option.setName('position')
                .setDescription('Queue position to skip to (e.g., 3 to jump to song #3)')
                .setRequired(false)
                .setMinValue(1)
        ),
    async execute(interaction) {
        if (!interaction.guild) {return;}

        // DJ / Blocking Check
        const { canControlMusic } = require('../../utils/dj-system');
        if (!await canControlMusic(interaction)) {return;}

        const manager = musicManager.get();
        const position = interaction.options.getInteger('position');

        let result;
        if (position) {
            result = await manager.jumpToPosition(interaction.guildId, position);
        } else {
            result = await manager.skip(interaction.guildId);
        }

        await interaction.reply({ content: result || '⏭️ Skipped.', flags: 64 });
    }
};

'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { musicManager } = require('../../core/musicManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('clearqueue')
        .setDescription('Clear pending tracks without stopping the current one'),
    async execute(interaction) {
        if (!interaction.guild) {return;}

        const { canControlMusic } = require('../../utils/dj-system');
        if (!await canControlMusic(interaction)) {return;}

        const manager = musicManager.get();
        const removed = manager.clearQueue(interaction.guildId);
        if (removed === 0) {
            await interaction.reply({ content: '⚠️ Queue is already empty, sir.', flags: 64 });
            return;
        }
        await interaction.reply({
            content: `🧹 Cleared **${removed}** track${removed === 1 ? '' : 's'} from the queue, sir.`
        });
    }
};

const { SlashCommandBuilder } = require('discord.js');
const { musicManager } = require('../../core/musicManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('loop')
        .setDescription('Toggle loop mode for the current song or queue')
        .addStringOption(option =>
            option.setName('mode')
                .setDescription('Loop mode')
                .setRequired(false)
                .addChoices(
                    { name: '🔂 Song (repeat current)', value: 'song' },
                    { name: '🔁 Queue (repeat all)', value: 'queue' },
                    { name: '❌ Off', value: 'off' }
                )
        ),
    async execute(interaction) {
        if (!interaction.guild) {return;}

        // DJ / Blocking Check
        const { canControlMusic } = require('../../utils/dj-system');
        if (!await canControlMusic(interaction)) {return;}

        const manager = musicManager.get();
        const mode = interaction.options.getString('mode');

        let newMode = null;
        if (!mode) {
            newMode = manager.cycleLoopMode(interaction.guildId);
        } else {
            newMode = manager.setLoopMode(interaction.guildId, mode);
        }

        if (!newMode) {
            await interaction.reply({ content: '⚠️ Nothing is playing right now.' });
            return;
        }

        const modeName = newMode === 'song' ? '🔂 Song' : newMode === 'queue' ? '🔁 Queue' : '❌ Off';
        await interaction.reply({ content: `🔄 Loop mode: **${modeName}**` });
    }
};

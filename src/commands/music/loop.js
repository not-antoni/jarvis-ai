const { SlashCommandBuilder } = require('discord.js');
const distube = require('../../services/distube');

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
        if (!interaction.guild) return;

        let distubeInstance;
        try {
            distubeInstance = distube.get();
        } catch (e) {
            await interaction.reply({ content: '⚠️ Music system is still starting up.', flags: 64 });
            return;
        }

        const queue = distubeInstance.getQueue(interaction.guild);

        if (!queue) {
            await interaction.reply({ content: '⚠️ Nothing is playing right now.', flags: 64 });
            return;
        }

        const mode = interaction.options.getString('mode');

        // If no mode specified, cycle through: off -> song -> queue -> off
        let newMode;
        if (!mode) {
            if (queue.repeatMode === 0) newMode = 1;      // off -> song
            else if (queue.repeatMode === 1) newMode = 2; // song -> queue
            else newMode = 0;                              // queue -> off
        } else {
            newMode = mode === 'song' ? 1 : mode === 'queue' ? 2 : 0;
        }

        queue.setRepeatMode(newMode);

        const modeNames = ['❌ Off', '🔂 Song', '🔁 Queue'];
        await interaction.reply(`🔄 Loop mode: **${modeNames[newMode]}**`);
    }
};

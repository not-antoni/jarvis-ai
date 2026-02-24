const { SlashCommandBuilder } = require('discord.js');
const { musicManager } = require('../../core/musicManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stop')
        .setDescription('Stop music and clear queue (stays in VC)'),
    async execute(interaction) {
        if (!interaction.guild) {return;}

        // DJ / Blocking Check
        const { canControlMusic } = require('../../utils/dj-system');
        if (!await canControlMusic(interaction)) {return;}

        const manager = musicManager.get();
        const state = manager.getState(interaction.guildId);
        if (!state) {
            await interaction.reply({ content: '⚠️ Not in a voice channel.', flags: 64 });
            return;
        }

        if (!state.currentVideo && !state.pendingVideoId && state.queue.length === 0) {
            await interaction.reply({
                content: '⚠️ Nothing is playing. I\'m still connected and will auto-leave after inactivity.',
                flags: 64
            });
            return;
        }

        const message = manager.stop(interaction.guildId, { disconnect: false });
        await interaction.reply({ content: message, flags: 64 });
    }
};

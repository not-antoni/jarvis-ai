const { SlashCommandBuilder } = require('discord.js');
const distube = require('../../services/distube');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('skip')
        .setDescription('Skip the current song'),
    async execute(interaction) {
        if (!interaction.guild) return;

        let distubeInstance;
        try {
            distubeInstance = distube.get();
        } catch (e) {
            await interaction.reply({ content: '⚠️ Music system is still starting up.', ephemeral: true });
            return;
        }

        const queue = distubeInstance.getQueue(interaction.guild);

        if (!queue || !queue.songs.length) {
            await interaction.reply({ content: '⚠️ Nothing is playing right now.', ephemeral: true });
            return;
        }

        if (queue.songs.length === 1) {
            // Only one song, stop instead
            await queue.stop();
            await interaction.reply('⏹️ No more songs in queue. Stopped.');
            return;
        }

        try {
            const skippedSong = queue.songs[0];
            await distubeInstance.skip(interaction.guild);
            await interaction.reply(`⏭️ Skipped **${skippedSong.name}**`);
        } catch (e) {
            console.error('Skip error:', e);
            await interaction.reply({ content: '❌ Could not skip. Try /stop to clear the queue.', ephemeral: true });
        }
    }
};

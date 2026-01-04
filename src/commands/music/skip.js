const { SlashCommandBuilder } = require('discord.js');
const distube = require('../../services/distube');

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
        if (!interaction.guild) return;

        let distubeInstance;
        try {
            distubeInstance = distube.get();
        } catch (e) {
            await interaction.reply({ content: '⚠️ Music system is still starting up.', flags: 64 });
            return;
        }

        const queue = distubeInstance.getQueue(interaction.guild);

        if (!queue || !queue.songs.length) {
            await interaction.reply({ content: '⚠️ Nothing is playing right now.', flags: 64 });
            return;
        }

        const position = interaction.options.getInteger('position');

        // If position specified, jump to that song
        if (position) {
            if (position > queue.songs.length) {
                await interaction.reply({ content: `⚠️ Queue only has **${queue.songs.length}** songs.`, flags: 64 });
                return;
            }

            if (position === 1) {
                await interaction.reply({ content: `⚠️ Song #1 is already playing! Use \`/skip\` to skip it.`, flags: 64 });
                return;
            }

            try {
                // Jump to position by skipping (position - 1) songs
                const targetSong = queue.songs[position - 1];
                await distubeInstance.jump(interaction.guild, position - 1);
                await interaction.reply(`⏭️ Jumped to #${position}: **${targetSong.name}**`);
            } catch (e) {
                console.error('Jump error:', e);
                await interaction.reply({ content: '❌ Could not jump to that position.', flags: 64 });
            }
            return;
        }

        // Default: skip current song
        if (queue.songs.length === 1) {
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
            await interaction.reply({ content: '❌ Could not skip. Try /stop to clear the queue.', flags: 64 });
        }
    }
};

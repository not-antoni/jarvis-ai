const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const { musicManager } = require('../../core/musicManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stop')
        .setDescription('Stop playback and clear the queue.')
        .setDMPermission(false)
        .setContexts([InteractionContextType.Guild]),

    async execute(interaction) {
        if (!interaction.guild) {
            await interaction.reply('⚠️ This command is only available inside servers, sir.');
            return;
        }

        const member = await interaction.guild.members.fetch(interaction.user.id);
        const voiceChannel = member.voice?.channel;

        if (!voiceChannel) {
            await interaction.reply('⚠️ Join a voice channel first, sir.');
            return;
        }

        const state = musicManager.getState(interaction.guild.id);

        if (!state) {
            await interaction.reply('⚠️ Nothing is playing right now, sir.');
            return;
        }

        if (state.voiceChannelId && state.voiceChannelId !== voiceChannel.id) {
            await interaction.reply('⚠️ Join the same voice channel as me to control playback, sir.');
            return;
        }

        state.textChannel = interaction.channel ?? state.textChannel;

        await interaction.deferReply();
        const message = musicManager.stop(interaction.guild.id);
        await interaction.editReply(message);
    }
};

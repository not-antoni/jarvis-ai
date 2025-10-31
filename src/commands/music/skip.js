const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const { musicManager } = require('../../core/musicManager');
const { isGuildAllowed } = require('../../utils/musicGuildWhitelist');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('skip')
        .setDescription('Skip the currently playing track.')
        .setDMPermission(false)
        .setContexts([InteractionContextType.Guild]),

    async execute(interaction) {
        if (!interaction.guild) {
            await interaction.reply('⚠️ This command is only available inside servers, sir.');
            return;
        }

        if (!isGuildAllowed(interaction.guild.id)) {
            await interaction.reply('⚠️ Music playback is not enabled for this server, sir.');
            return;
        }

        const member = await interaction.guild.members.fetch(interaction.user.id);
        const voiceChannel = member.voice?.channel;

        if (!voiceChannel) {
            await interaction.reply('⚠️ Join a voice channel first, sir.');
            return;
        }

        const state = musicManager.getState(interaction.guild.id);

        if (!state || (!state.currentVideo && !state.pendingVideoId)) {
            await interaction.reply('⚠️ Nothing is playing right now, sir.');
            return;
        }

        if (state.voiceChannelId && state.voiceChannelId !== voiceChannel.id) {
            await interaction.reply('⚠️ Join the same voice channel as me to control playback, sir.');
            return;
        }

        state.textChannel = interaction.channel ?? state.textChannel;

        await interaction.deferReply();
        const message = await musicManager.skip(interaction.guild.id);
        await interaction.editReply(message);
    }
};

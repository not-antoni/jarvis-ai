const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const { musicManager } = require('../../core/musicManager');
const { getVideo } = require('../../utils/youtube');
const { isGuildAllowed } = require('../../utils/musicGuildWhitelist');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('play')
        .setDescription('Play a YouTube video or add it to the queue.')
        .addStringOption(option =>
            option
                .setName('query')
                .setDescription('Search term or YouTube URL')
                .setRequired(true)
        )
        .setDMPermission(false)
        .setContexts([InteractionContextType.Guild]),

    async execute(interaction) {
        if (!interaction.guild) {
            await interaction.reply('⚠️ This command is only available inside servers, sir.');
            return;
        }

        const query = interaction.options.getString('query');
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

        if (!voiceChannel.joinable) {
            await interaction.reply('⚠️ I cannot join that voice channel, sir.');
            return;
        }

        if (!voiceChannel.speakable) {
            await interaction.reply('⚠️ I cannot speak in that voice channel, sir.');
            return;
        }

        await interaction.deferReply();

        let video;
        try {
            video = await getVideo(query);
        } catch (error) {
            await interaction.editReply('⚠️ Failed to contact YouTube, sir.');
            return;
        }

        if (!video) {
            await interaction.editReply('❌ No results found, sir.');
            return;
        }

        try {
            const message = await musicManager.enqueue(interaction.guild.id, voiceChannel, video, interaction);
            await interaction.editReply(message);
        } catch (error) {
            console.error('Failed to enqueue track:', error);
            await interaction.editReply('⚠️ Unable to start playback right now, sir.');
        }
    }
};

const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const { musicManager } = require('../../core/musicManager');
const { getVideo } = require('../../utils/youtube');
const { isGuildAllowed } = require('../../utils/musicGuildWhitelist');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('play')
        .setDescription('Play a YouTube video or add it to the queue.')
        .addStringOption(option =>
            option.setName('query').setDescription('Search term or YouTube URL').setRequired(true)
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

        // Check video duration (Limit: 20 minutes)
        const MAX_DURATION_MINS = 20;
        const MAX_DURATION_SECONDS = MAX_DURATION_MINS * 60;

        let durationSec = 0;
        if (typeof video.duration === 'number') {
            durationSec = video.duration;
        } else if (typeof video.duration === 'string') {
            // Parse "HH:MM:SS" or "MM:SS"
            const parts = video.duration.split(':').map(Number);
            if (parts.length === 3) durationSec = parts[0] * 3600 + parts[1] * 60 + parts[2];
            else if (parts.length === 2) durationSec = parts[0] * 60 + parts[1];
            else if (parts.length === 1) durationSec = parts[0];
        }

        // If duration is missing or 0, fetch details directly to be sure
        if (!durationSec) {
            try {
                const { getVideoInfo } = require('../../utils/playDl');
                const info = await getVideoInfo(video.url);
                if (info && info.duration) {
                    durationSec = info.duration;
                    // Update video object with better info
                    video.title = info.title || video.title;
                    video.thumbnail = info.thumbnail || video.thumbnail;
                    video.duration = info.duration;
                }
            } catch (e) {
                console.warn('Failed to fetch detailed video info for duration check:', e.message);
                // Proceed with caution or block? 
                // Allowing it risks the bypass. 
                // But blocking valid videos where metadata fails is annoying.
                // We'll proceed but log it.
            }
        }

        if (durationSec > MAX_DURATION_SECONDS) {
            await interaction.editReply(`❌ Video is too long, sir. Maximum duration is ${MAX_DURATION_MINS} minutes.\nThis video is approximately ${Math.floor(durationSec / 60)} minutes.`);
            return;
        }

        try {
            const message = await musicManager.get().enqueue(
                interaction.guild.id,
                voiceChannel,
                video,
                interaction
            );
            await interaction.editReply(message);
        } catch (error) {
            console.error('Failed to enqueue track:', error);
            await interaction.editReply('⚠️ Unable to start playback right now, sir.');
        }
    }
};

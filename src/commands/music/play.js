const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const { musicManager } = require('../../core/musicManager');
const { resolveTrackInput } = require('../../services/music-resolver');

// Max file size: 10MB
const MAX_FILE_SIZE = 10 * 1024 * 1024;

// Allowed audio extensions
const AUDIO_EXTENSIONS = ['.mp3', '.ogg', '.oga', '.flac', '.wav', '.m4a', '.opus', '.webm', '.aac', '.wma', '.mp4', '.mov', '.mkv'];

// Check if filename has audio extension (strips query params first)
function isAudioFile(filename) {
    const cleanName = String(filename || '').split('?')[0].toLowerCase();
    return AUDIO_EXTENSIONS.some(ext => cleanName.endsWith(ext));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('play')
        .setDescription('Play a song or playlist')
        .addStringOption(option =>
            option.setName('query').setDescription('Song name, YouTube/SoundCloud URL or playlist').setRequired(false)
        )
        .addAttachmentOption(option =>
            option.setName('file1').setDescription('Audio file #1 (10MB max each)').setRequired(false)
        )
        .addAttachmentOption(option =>
            option.setName('file2').setDescription('Audio file #2').setRequired(false)
        )
        .addAttachmentOption(option =>
            option.setName('file3').setDescription('Audio file #3').setRequired(false)
        )
        .addAttachmentOption(option =>
            option.setName('file4').setDescription('Audio file #4').setRequired(false)
        )
        .addAttachmentOption(option =>
            option.setName('file5').setDescription('Audio file #5').setRequired(false)
        )
        .addAttachmentOption(option =>
            option.setName('file6').setDescription('Audio file #6').setRequired(false)
        )
        .addAttachmentOption(option =>
            option.setName('file7').setDescription('Audio file #7').setRequired(false)
        )
        .addAttachmentOption(option =>
            option.setName('file8').setDescription('Audio file #8').setRequired(false)
        )
        .addAttachmentOption(option =>
            option.setName('file9').setDescription('Audio file #9').setRequired(false)
        )
        .addAttachmentOption(option =>
            option.setName('file10').setDescription('Audio file #10').setRequired(false)
        )
        .setDMPermission(false)
        .setContexts([InteractionContextType.Guild]),

    async execute(interaction) {
        if (!interaction.guild) {return;}

        // DJ / Blocking Check
        const { canControlMusic } = require('../../utils/dj-system');
        if (!await canControlMusic(interaction)) {return;}

        const queryOption = interaction.options.getString('query');

        // Collect all file attachments
        const files = [];
        for (let i = 1; i <= 10; i++) {
            const file = interaction.options.getAttachment(`file${i}`);
            if (file) {files.push(file);}
        }

        const { member } = interaction;
        const voiceChannel = member.voice?.channel;

        // Must provide either query OR files
        if (!queryOption && files.length === 0) {
            await interaction.reply({ content: '⚠️ Provide a song name, URL, or upload a file, sir.', flags: 64 });
            return;
        }

        // Voice Checks
        if (!voiceChannel) {
            await interaction.reply({ content: '⚠️ Join a voice channel first, sir.', flags: 64 });
            return;
        }

        if (!voiceChannel.joinable || !voiceChannel.speakable) {
            await interaction.reply({ content: '⚠️ I cannot join or speak in that voice channel, sir.', flags: 64 });
            return;
        }

        // Handle file uploads
        if (files.length > 0) {
            for (const file of files) {
                if (file.size > MAX_FILE_SIZE) {
                    await interaction.reply({ content: `Sir, **${file.name}** is over 10MB! I'm gonna explode 💥` });
                    return;
                }
                if (!isAudioFile(file.name)) {
                    await interaction.reply({ content: `⚠️ **${file.name}** doesn't look like an audio file, sir.` });
                    return;
                }
            }

            // Ensure music manager has initialized before queueing uploads.
            try {
                musicManager.get();
            } catch (_error) {
                await interaction.reply({
                    content: '⚠️ Music system is still starting up. Please try again in a few seconds.',
                    flags: 64
                });
                return;
            }

            if (files.length === 1) {
                await interaction.reply(`📂 Processing upload: **${files[0].name}**`);
            } else {
                await interaction.reply(`📂 Processing **${files.length}** uploads...`);
            }

            const uploadQueue = require('../../services/upload-queue');
            for (const file of files) {
                const position = uploadQueue.add(
                    interaction.guildId,
                    voiceChannel,
                    file.url,
                    file.name,
                    member,
                    interaction.channel,
                    interaction
                );
                console.log(`[Play] File queued: ${file.name} - Position: ${position}`);
            }

            if (files.length > 1) {
                await interaction.followUp({ content: `✅ All **${files.length}** files queued!` });
            }
            return;
        }

        await interaction.deferReply();

        try {
            const manager = musicManager.get();
            const { track, fromCache, fallbackToSoundCloud } = await resolveTrackInput(queryOption);
            const enqueueMessage = await manager.enqueue(
                interaction.guildId,
                voiceChannel,
                track,
                interaction
            );

            const contextLines = [];
            if (fromCache) {
                contextLines.push(`⚡ **${track.title}**`);
                contextLines.push('_From cache._');
            } else if (fallbackToSoundCloud) {
                contextLines.push('🎧 YouTube search failed, using SoundCloud fallback.');
            } else if (track.source === 'soundcloud' && /^https?:\/\//i.test(queryOption)) {
                contextLines.push('🎧 Resolved SoundCloud track.');
            }

            const message = [...contextLines, enqueueMessage].filter(Boolean).join('\n');
            await interaction.editReply(message || '✅ Queued.');
        } catch (error) {
            console.error('[Play] Playback error:', error);

            let message = '❌ Playback failed. Please try again.';
            if (error?.code === 'UNSUPPORTED_SPOTIFY') {
                message = error.message;
            } else if (error?.code === 'UNSUPPORTED_URL') {
                message = error.message;
            } else if (error?.code === 'NO_RESULT') {
                message = error.message;
            } else if (error?.message) {
                message = `❌ ${error.message.slice(0, 180)}`;
            }

            await interaction.editReply(message);
        }
    }
};

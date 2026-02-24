const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const { musicManager } = require('../../core/musicManager');
const { resolveTrackInput } = require('../../services/music-resolver');
const soundcloudApi = require('../../services/soundcloud-api');

// Max file size: 10MB
const MAX_FILE_SIZE = 10 * 1024 * 1024;

// Allowed audio extensions
const AUDIO_EXTENSIONS = ['.mp3', '.ogg', '.oga', '.flac', '.wav', '.m4a', '.opus', '.webm', '.aac', '.wma', '.mp4', '.mov', '.mkv'];

// Check if filename has audio extension (strips query params first)
function isAudioFile(filename) {
    const cleanName = String(filename || '').split('?')[0].toLowerCase();
    return AUDIO_EXTENSIONS.some(ext => cleanName.endsWith(ext));
}

function clampChoiceText(value, max = 100) {
    const text = String(value || '').trim();
    if (text.length <= max) {
        return text;
    }
    return `${text.slice(0, max - 3)}...`;
}

function buildQueryChoice(track) {
    const title = String(track?.title || 'SoundCloud Track').trim();
    const meta = [track?.uploader, track?.duration].filter(Boolean).join(' • ');
    const name = clampChoiceText(meta ? `${title} — ${meta}` : title, 100);
    const rawValue = String(track?.url || '').trim();
    const value = rawValue.length > 0 && rawValue.length <= 100 ? rawValue : clampChoiceText(title, 100);

    if (!name || !value) {
        return null;
    }

    return { name, value };
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('play')
        .setDescription('Play a song or playlist')
        .addStringOption(option =>
            option
                .setName('query')
                .setDescription('Song name, YouTube/SoundCloud URL or playlist')
                .setRequired(false)
                .setAutocomplete(true)
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

    async autocomplete(interaction) {
        const focused = interaction.options.getFocused(true);
        if (!focused || focused.name !== 'query') {
            await interaction.respond([]).catch(() => {});
            return;
        }

        const query = String(focused.value || '').trim();
        if (!query || query.length < 2 || /^https?:\/\//i.test(query)) {
            await interaction.respond([]).catch(() => {});
            return;
        }

        if (!soundcloudApi.isConfigured()) {
            await interaction.respond([]).catch(() => {});
            return;
        }

        try {
            const tracks = await soundcloudApi.searchTracks(query, 10);
            const choices = [];
            const seenValues = new Set();
            for (const track of tracks) {
                const choice = buildQueryChoice(track);
                if (!choice || seenValues.has(choice.value)) {
                    continue;
                }
                seenValues.add(choice.value);
                choices.push(choice);
                if (choices.length >= 25) {
                    break;
                }
            }
            await interaction.respond(choices);
        } catch (error) {
            console.warn('[Play] Autocomplete failed:', error?.message || error);
            await interaction.respond([]).catch(() => {});
        }
    },

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
            const { track, fromCache } = await resolveTrackInput(queryOption);
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
            } else if (/^https?:\/\//i.test(queryOption)) {
                contextLines.push('🎧 Resolved track.');
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

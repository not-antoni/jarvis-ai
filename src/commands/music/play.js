const crypto = require('crypto');
const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const { musicManager } = require('../../core/musicManager');
const { resolveTrackInput, isUrl } = require('../../services/music-resolver');
const soundcloudApi = require('../../services/soundcloud-api');
const youtubeSearch = require('../../services/youtube-search');

// Max file size: 10MB
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const AUTOCOMPLETE_SELECTION_TTL_MS = 10 * 60 * 1000;
const AUTOCOMPLETE_SELECTION_MAX = 512;
const AUTOCOMPLETE_TOKEN_PREFIX = 'ac:';
const autocompleteSelectionCache = new Map();
const VOICE_HINT_MESSAGE = 'Use `/voice` too if you want to talk over music.';

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

function pruneAutocompleteSelections(now = Date.now()) {
    for (const [key, entry] of autocompleteSelectionCache.entries()) {
        if (!entry || entry.expiresAt <= now) {
            autocompleteSelectionCache.delete(key);
        }
    }

    while (autocompleteSelectionCache.size > AUTOCOMPLETE_SELECTION_MAX) {
        const oldestKey = autocompleteSelectionCache.keys().next().value;
        if (!oldestKey) {break;}
        autocompleteSelectionCache.delete(oldestKey);
    }
}

function rememberAutocompleteSelection(url, source = 'track') {
    const rawUrl = String(url || '').trim();
    if (!rawUrl) {
        return null;
    }
    if (rawUrl.length <= 100) {
        return rawUrl;
    }

    const token = `${AUTOCOMPLETE_TOKEN_PREFIX}${source}:${crypto.createHash('sha1').update(rawUrl).digest('hex').slice(0, 24)}`;
    autocompleteSelectionCache.set(token, {
        url: rawUrl,
        expiresAt: Date.now() + AUTOCOMPLETE_SELECTION_TTL_MS
    });
    pruneAutocompleteSelections();
    return token;
}

function resolveAutocompleteSelection(value) {
    const rawValue = String(value || '').trim();
    if (!rawValue.startsWith(AUTOCOMPLETE_TOKEN_PREFIX)) {
        return rawValue;
    }

    const entry = autocompleteSelectionCache.get(rawValue);
    if (!entry) {
        return rawValue;
    }
    if (entry.expiresAt <= Date.now()) {
        autocompleteSelectionCache.delete(rawValue);
        return rawValue;
    }
    return entry.url;
}

function buildSoundCloudChoice(track) {
    const title = String(track?.title || 'SoundCloud Track').trim();
    const meta = [track?.uploader, track?.duration].filter(Boolean).join(' • ');
    const name = clampChoiceText(meta ? `${title} — ${meta}` : title, 100);
    const rawValue = String(track?.url || '').trim();
    const value = rawValue.length > 0
        ? rememberAutocompleteSelection(rawValue, 'soundcloud')
        : clampChoiceText(title, 100);

    if (!name || !value) {
        return null;
    }

    return { name, value };
}

function buildYouTubeChoice(video) {
    const title = String(video?.title || 'YouTube Video').trim();
    const channel = video?.channel || '';
    const name = clampChoiceText(channel ? `${title} — ${channel}` : title, 100);
    const value = rememberAutocompleteSelection(video?.url, 'youtube');

    if (!name || !value || value.length > 100) {
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
                .setName('soundcloud')
                .setDescription('SoundCloud search or URL')
                .setRequired(false)
                .setAutocomplete(true)
        )
        .addStringOption(option =>
            option
                .setName('youtube')
                .setDescription('YouTube search or URL')
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
        .setDMPermission(false)
        .setContexts([InteractionContextType.Guild]),

    async autocomplete(interaction) {
        const focused = interaction.options.getFocused(true);
        if (!focused || (focused.name !== 'soundcloud' && focused.name !== 'youtube')) {
            await interaction.respond([]).catch(() => {});
            return;
        }

        const query = String(focused.value || '').trim();
        if (!query || query.length < 2 || /^https?:\/\//i.test(query)) {
            await interaction.respond([]).catch(() => {});
            return;
        }

        try {
            if (focused.name === 'youtube') {
                const response = await youtubeSearch.searchVideos(query, 10);
                const items = Array.isArray(response?.items) ? response.items : [];
                const choices = [];
                const seenValues = new Set();
                for (const video of items) {
                    const choice = buildYouTubeChoice(video);
                    if (!choice || seenValues.has(choice.value)) continue;
                    seenValues.add(choice.value);
                    choices.push(choice);
                    if (choices.length >= 25) break;
                }
                await interaction.respond(choices);
            } else {
                if (!soundcloudApi.isConfigured()) {
                    await interaction.respond([]).catch(() => {});
                    return;
                }
                const tracks = await soundcloudApi.searchTracks(query, 10);
                const choices = [];
                const seenValues = new Set();
                for (const track of tracks) {
                    const choice = buildSoundCloudChoice(track);
                    if (!choice || seenValues.has(choice.value)) continue;
                    seenValues.add(choice.value);
                    choices.push(choice);
                    if (choices.length >= 25) break;
                }
                await interaction.respond(choices);
            }
        } catch (error) {
            console.warn(`[Play] Autocomplete (${focused.name}) failed:`, error?.message || error);
            await interaction.respond([]).catch(() => {});
        }
    },

    async execute(interaction) {
        if (!interaction.guild) {return;}

        // DJ / Blocking Check
        const { canControlMusic } = require('../../utils/dj-system');
        if (!await canControlMusic(interaction)) {return;}

        const scOption = resolveAutocompleteSelection(interaction.options.getString('soundcloud'));
        const ytOption = resolveAutocompleteSelection(interaction.options.getString('youtube'));
        const queryOption = scOption || ytOption;

        // Collect all file attachments
        const files = [];
        for (let i = 1; i <= 9; i++) {
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
                await interaction.followUp({ content: `✅ All **${files.length}** files queued!\n${VOICE_HINT_MESSAGE}` });
            } else {
                await interaction.followUp({ content: VOICE_HINT_MESSAGE });
            }
            return;
        }

        await interaction.deferReply();

        try {
            const manager = musicManager.get();

            // If YouTube option was used with a plain query (not URL), search YouTube first
            let resolvedInput = queryOption;
            if (ytOption && !isUrl(ytOption)) {
                const response = await youtubeSearch.searchVideos(ytOption, 1);
                const topResult = response?.items?.[0];
                if (!topResult?.url) {
                    await interaction.editReply('❌ No YouTube results found for that query, sir.');
                    return;
                }
                resolvedInput = topResult.url;
            }

            const { track, fromCache } = await resolveTrackInput(resolvedInput);
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

            const message = [...contextLines, enqueueMessage, VOICE_HINT_MESSAGE].filter(Boolean).join('\n');
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
    },

    _test: {
        rememberAutocompleteSelection,
        resolveAutocompleteSelection,
        buildSoundCloudChoice,
        buildYouTubeChoice,
        pruneAutocompleteSelections,
        autocompleteSelectionCache
    }
};

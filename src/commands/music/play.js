const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const distube = require('../../services/distube');
const youtubeSearch = require('../../services/youtube-search');
const searchCache = require('../../services/search-cache');

// Max file size: 10MB
const MAX_FILE_SIZE = 10 * 1024 * 1024;

// Allowed audio extensions
const AUDIO_EXTENSIONS = ['.mp3', '.ogg', '.oga', '.flac', '.wav', '.m4a', '.opus', '.webm', '.aac', '.wma', '.mp4', '.mov', '.mkv'];

// Check if a string looks like a URL
function isUrl(str) {
    return /^https?:\/\//i.test(str) || str.includes('youtube.com') || str.includes('youtu.be') || str.includes('soundcloud.com') || str.includes('spotify.com');
}

// Strip playlist parameter from YouTube URLs (avoid blocked playlist fetch on datacenter IPs)
function cleanYouTubeUrl(url) {
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
        // Remove &list= or ?list= parameters
        url = url.replace(/[&?]list=[^&]+/g, '');
        // Remove &index= parameter
        url = url.replace(/[&?]index=\d+/g, '');
        // Clean up any leftover ? or & at the end
        url = url.replace(/[&?]$/, '');
    }
    return url;
}

// Check if filename has audio extension (strips query params first)
function isAudioFile(filename) {
    // Discord CDN can add query params, strip them
    const cleanName = filename.split('?')[0].toLowerCase();
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
        if (!interaction.guild) return;

        const queryOption = interaction.options.getString('query');

        // Collect all file attachments
        const files = [];
        for (let i = 1; i <= 10; i++) {
            const file = interaction.options.getAttachment(`file${i}`);
            if (file) files.push(file);
        }

        const member = interaction.member;
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
            // Validate all files first
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

            // Check if music system is ready
            try {
                distube.get();
            } catch (initError) {
                await interaction.reply({ content: '⚠️ Music system is still starting up. Please try again in a few seconds.', flags: 64 });
                return;
            }

            // Acknowledge first
            if (files.length === 1) {
                await interaction.reply(`📂 Processing upload: **${files[0].name}**`);
            } else {
                await interaction.reply(`📂 Processing **${files.length}** uploads...`);
            }

            const uploadQueue = require('../../services/upload-queue');
            let firstPosition = -1;

            // Queue files in order
            for (const file of files) {
                const pos = uploadQueue.add(
                    interaction.guildId,
                    voiceChannel,
                    file.url,
                    file.name,
                    member,
                    interaction.channel,
                    interaction
                );
                if (firstPosition === -1) firstPosition = pos;
                console.log(`[Play] File queued: ${file.name} - Position: ${pos}`);
            }

            // Follow-up feedback for multiple files
            if (files.length > 1) {
                await interaction.followUp({ content: `✅ All **${files.length}** files queued!` });
            }
            return;
        }

        // Handle query (existing logic)
        let query = queryOption;
        await interaction.deferReply();

        try {
            // Check if Distube is ready
            let distubeInstance;
            try {
                distubeInstance = distube.get();
            } catch (initError) {
                await interaction.editReply('⚠️ Music system is still starting up. Please try again in a few seconds.');
                return;
            }

            // If query is NOT a URL, search for it
            if (!isUrl(query)) {
                // Check cache first
                const cached = searchCache.get(query);
                if (cached) {
                    console.log(`[Play] Cache HIT: "${query}" -> ${cached.url}`);
                    await interaction.editReply(`⚡ **${cached.title}**\n_From cache, queuing..._`);
                    query = cached.url;
                } else {
                    // Cache miss - use YouTube API
                    try {
                        console.log(`[Play] Cache MISS, searching API for: "${query}"`);
                        const result = await youtubeSearch.searchVideo(query);
                        if (result && result.url) {
                            console.log(`[Play] Found via API: ${result.title} -> ${result.url}`);
                            await interaction.editReply(`🔍 Found: **${result.title}**\n_Queuing..._`);

                            // Store in cache for next time
                            searchCache.set(query, result);
                            query = result.url;
                        } else {
                            await interaction.editReply(`❌ **No results found**\nCouldn't find anything for: \`${query.slice(0, 50)}\``);
                            return;
                        }
                    } catch (searchError) {
                        console.error('[Play] YouTube API search failed:', searchError.message);
                        console.log('[Play] Falling back to yt-dlp internal search...');
                    }
                }
            }

            // Clean YouTube URLs to avoid playlist blocking issues
            if (isUrl(query)) {
                query = cleanYouTubeUrl(query);
            }

            await distubeInstance.play(voiceChannel, query, {
                member: member,
                textChannel: interaction.channel,
                metadata: { originalInteraction: interaction }
            });

            // Only show this if we haven't already shown "Found: ..."
            if (isUrl(interaction.options.getString('query'))) {
                await interaction.editReply('🔍 Queuing...');
            }
        } catch (e) {
            console.error('Distube Play Error:', e);
            const errorMsg = e.message || e.toString();

            // Determine error type and provide helpful message
            let userMessage;

            if (e.errorCode === 'NO_RESULT' || errorMsg.includes('Cannot find any song') || errorMsg.includes('Video unavailable')) {
                userMessage = `❌ **No results found**\nCouldn't find anything for: \`${query.slice(0, 50)}\``;
            } else if (errorMsg === 'Error: null' || errorMsg.includes(': null')) {
                userMessage = `❌ **YouTube is blocked**\nUse SoundCloud links instead.`;
            } else if (e.errorCode === 'VOICE_CONNECT_FAILED' || errorMsg.includes('VOICE_CONNECT_FAILED')) {
                userMessage = `❌ **Connection failed**\nCouldn't connect to the voice channel. Check my permissions.`;
            } else if (errorMsg.includes('Sign in to confirm') || errorMsg.includes('bot') || errorMsg.includes('confirm your age')) {
                userMessage = `❌ **YouTube blocked this request**\nThis usually happens on datacenter IPs. Try a different song or use SoundCloud links.`;
            } else if (errorMsg.includes('rate limit') || errorMsg.includes('429')) {
                userMessage = `❌ **Rate limited**\nToo many requests. Please wait a moment and try again.`;
            } else if (errorMsg.includes('private') || errorMsg.includes('members-only')) {
                userMessage = `❌ **Access denied**\nThis content is private or members-only.`;
            } else if (errorMsg.includes('copyright') || errorMsg.includes('not available')) {
                userMessage = `❌ **Unavailable**\nThis content is not available (copyright or region blocked).`;
            } else {
                // Generic error - keep it clean
                userMessage = `❌ **Playback failed**\n${errorMsg.slice(0, 150)}`;
            }

            await interaction.editReply({ content: userMessage });
        }
    }
};


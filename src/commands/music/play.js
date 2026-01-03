const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const distube = require('../../services/distube');
const youtubeSearch = require('../../services/youtube-search');
const searchCache = require('../../services/search-cache');

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

module.exports = {
    data: new SlashCommandBuilder()
        .setName('play')
        .setDescription('Play a song or playlist')
        .addStringOption(option =>
            option.setName('query').setDescription('Song name, YouTube/SoundCloud URL or playlist').setRequired(true)
        )
        .setDMPermission(false)
        .setContexts([InteractionContextType.Guild]),

    async execute(interaction) {
        if (!interaction.guild) return;

        let query = interaction.options.getString('query');
        const member = interaction.member;
        const voiceChannel = member.voice?.channel;

        // Voice Checks
        if (!voiceChannel) {
            await interaction.reply({ content: '⚠️ Join a voice channel first, sir.', flags: 64 });
            return;
        }

        if (!voiceChannel.joinable || !voiceChannel.speakable) {
            await interaction.reply({ content: '⚠️ I cannot join or speak in that voice channel, sir.', flags: 64 });
            return;
        }

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

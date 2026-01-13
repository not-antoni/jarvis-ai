const { DisTube } = require('distube');
const { YtDlpPlugin } = require('@distube/yt-dlp');
const { DirectLinkPlugin } = require('@distube/direct-link');
const { EmbedBuilder } = require('discord.js');
const soundcloudCache = require('./soundcloud-cache');

let distube = null;

// Proxy configuration
const YTDLP_PROXY_ENABLED = String(process.env.YTDLP_PROXY_ENABLED || '').toLowerCase() === 'true';
const YTDLP_PROXIES = (process.env.YTDLP_PROXIES || '').split(',').filter(Boolean);
let proxyIndex = 0;

// Get next proxy in rotation (round-robin)
function getNextProxy() {
    if (!YTDLP_PROXY_ENABLED || YTDLP_PROXIES.length === 0) return null;
    const proxy = YTDLP_PROXIES[proxyIndex % YTDLP_PROXIES.length];
    proxyIndex++;
    // Format: ip:port:user:pass -> http://user:pass@ip:port
    const parts = proxy.split(':');
    if (parts.length === 4) {
        return `http://${parts[2]}:${parts[3]}@${parts[0]}:${parts[1]}`;
    }
    return proxy; // Already formatted
}

module.exports = {
    init: (client) => {
        console.log('[Distube] Init called');
        if (distube) return distube;

        try {
            console.log('[Distube] requiring ffmpeg-static...');
            const ffmpegPath = require('ffmpeg-static');
            console.log('[Distube] ffmpeg path:', ffmpegPath);

            // Build yt-dlp args
            const ytdlpArgs = [
                '--no-warnings',
                '--audio-quality', '0',
                // Prefer opus/vorbis (less transcoding loss), fallback to best
                '--format', 'bestaudio[acodec=opus]/bestaudio[acodec=vorbis]/bestaudio/best',
                // Network resilience
                '--socket-timeout', '10',
                '--retries', '10'
            ];

            // Add proxy if enabled
            const proxy = getNextProxy();
            if (proxy) {
                ytdlpArgs.push('--proxy', proxy);
                console.log(`[Distube] Proxy enabled, using: ${proxy.replace(/:[^:]+@/, ':***@')}`);
            } else if (YTDLP_PROXY_ENABLED) {
                console.log('[Distube] Proxy enabled but no proxies configured (YTDLP_PROXIES empty)');
            }

            console.log('[Distube] Creating new DisTube instance (yt-dlp + direct-link)...');
            distube = new DisTube(client, {
                emitNewSongOnly: true,
                savePreviousSongs: false,
                nsfw: true,
                ffmpeg: {
                    path: ffmpegPath,
                    args: {
                        global: {},
                        input: {
                            reconnect: '1',
                            reconnect_streamed: '1',
                            reconnect_delay_max: '5',
                            // Increased queue size (24k) for network jitter
                            thread_queue_size: '24576',
                            // 8MB probe size (better for longer tracks)
                            probesize: '8388608',
                            analyzeduration: '0',
                            fflags: '+genpts+discardcorrupt'
                        },
                        output: {
                            ar: '48000',
                            ac: '2',
                            // 6MB Output buffer (more resilience)
                            bufsize: '6144k',
                            // Simplified resampling (let FFmpeg allow async)
                            af: 'aresample=48000:async=1'
                        }
                    }
                },
                plugins: [
                    // DirectLinkPlugin FIRST - handles Discord CDN and other direct URLs
                    new DirectLinkPlugin(),
                    new YtDlpPlugin({
                        update: false,
                        ytdlpArgs
                    })
                ]
            });
        } catch (e) {
            console.error('[Distube] Crash during initialization:', e);
            throw e; // Re-throw to be caught by index.js
        }

        // Event Listeners
        distube
            .on('playSong', (queue, song) => {
                // Cache SoundCloud tracks for faster replay
                if (song.source === 'soundcloud' && song.url) {
                    soundcloudCache.set(song.url, {
                        title: song.name,
                        duration: song.duration,
                        thumbnail: song.thumbnail,
                        uploader: song.uploader
                    });
                }

                const source = song.source === 'youtube' ? 'YouTube' :
                    song.source === 'spotify' ? 'Spotify' :
                        song.source === 'soundcloud' ? 'SoundCloud' :
                            song.source === 'direct_link' ? '📁 File' : song.source;

                // For direct links, use probed duration from metadata
                const isDirectLink = song.source === 'direct_link';
                const displayDuration = isDirectLink
                    ? (song.metadata?.formattedDuration || song.formattedDuration || '0:00')
                    : song.formattedDuration;
                const displayName = song.metadata?.filename || song.name;

                const embed = new EmbedBuilder()
                    .setTitle('🎶 Now Playing')
                    .setDescription(isDirectLink ? `**${displayName}**` : `[${song.name}](${song.url})`)
                    .addFields(
                        { name: 'Duration', value: displayDuration, inline: true },
                        { name: 'Source', value: source, inline: true },
                        { name: 'Requested By', value: `${song.user}`, inline: true }
                    )
                    .setColor(isDirectLink ? '#3498db' : '#FF0000');

                // If we have the interaction that triggered this, edit it to remove "Searching..."
                const interaction = song.metadata?.originalInteraction;
                if (interaction && !song.metadata.hasReplied) {
                    interaction.editReply({ content: null, embeds: [embed] }).catch(err => {
                        // If interaction expired or failed, fall back to sending
                        queue.textChannel?.send({ embeds: [embed] }).catch(console.error);
                    });
                    song.metadata.hasReplied = true;
                }
            })
            .on('addSong', (queue, song) => {
                const source = song.source === 'youtube' ? 'YouTube' :
                    song.source === 'spotify' ? 'Spotify' :
                        song.source === 'soundcloud' ? 'SoundCloud' :
                            song.source === 'direct_link' ? '📁 File' : song.source;

                const isDirectLink = song.source === 'direct_link';
                const displayDuration = isDirectLink
                    ? (song.metadata?.formattedDuration || song.formattedDuration || '0:00')
                    : song.formattedDuration;
                const displayName = song.metadata?.filename || song.name;

                const embed = new EmbedBuilder()
                    .setTitle('✅ Added to Queue')
                    .setDescription(isDirectLink ? `**${displayName}**` : `[${song.name}](${song.url})`)
                    .addFields(
                        { name: 'Duration', value: displayDuration, inline: true },
                        { name: 'Source', value: source, inline: true }
                    )
                    .setColor(isDirectLink ? '#3498db' : '#00FF00');

                const interaction = song.metadata?.originalInteraction;
                if (interaction && !song.metadata.hasReplied) {
                    interaction.editReply({ content: null, embeds: [embed] }).catch(err => {
                        queue.textChannel?.send({ embeds: [embed] }).catch(console.error);
                    });
                    song.metadata.hasReplied = true;
                } else {
                    queue.textChannel?.send({ embeds: [embed] }).catch(console.error);
                }
            })
            .on('addList', (queue, playlist) => {
                queue.textChannel?.send(
                    `✅ Added playlist **${playlist.name}** (${playlist.songs.length} songs) to queue.`
                ).catch(console.error);
            })
            .on('error', (error, queue, song) => {
                // Only log non-ffmpeg errors in full
                if (error.errorCode !== 'FFMPEG_EXITED') {
                    console.error('[Distube Error]', error);
                } else {
                    console.warn('[Distube] FFMPEG stream error - track may be unavailable');
                }

                // queue might be a TextChannel, a Queue, or undefined depending on where error originated
                let channel = queue?.textChannel || (queue?.send ? queue : null);

                if (channel) {
                    // Provide user-friendly error messages
                    let userMessage = '❌ Music error';
                    if (error.errorCode === 'FFMPEG_EXITED') {
                        userMessage = '❌ Stream error - this track may be unavailable or region-locked. Try another song.';
                    } else if (error.message?.includes('410')) {
                        userMessage = '❌ This video is unavailable. It may have been removed or made private.';
                    } else if (error.message) {
                        userMessage = `❌ ${error.message.slice(0, 150)}`;
                    }
                    channel.send(userMessage).catch(() => { });
                }
            })
            .on('empty', queue => {
                queue.textChannel?.send('Voice channel is empty! Leaving...').catch(console.error);
            })
            .on('finish', queue => queue.textChannel?.send('🏁 Queue finished!').catch(console.error));

        console.log('[Distube] Music System Initialized 🎵');
        return distube;
    },

    get: () => {
        if (!distube) throw new Error('Distube not initialized!');
        return distube;
    }
};

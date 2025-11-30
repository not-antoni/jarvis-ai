'use strict';

const play = require('play-dl');

// Track active streams for cancellation
const activeStreams = new Map(); // videoId -> { stream, aborted }

/**
 * Initialize play-dl with YouTube cookies/tokens if available
 */
async function initializeAuth() {
    // Check for refresh token (preferred - lasts months)
    if (process.env.YOUTUBE_REFRESH_TOKEN) {
        try {
            await play.setToken({
                youtube: {
                    cookie: process.env.YOUTUBE_COOKIES || ''
                }
            });
            console.log('play-dl: YouTube auth initialized with refresh token');
            return true;
        } catch (error) {
            console.warn('play-dl: Failed to set YouTube token:', error.message);
        }
    }

    // Fallback to cookies if available
    const cookieEnvKeys = [
        'YOUTUBE_COOKIES',
        'YT_COOKIES',
        'YTDLP_COOKIES'
    ];

    for (const key of cookieEnvKeys) {
        const cookies = process.env[key];
        if (cookies && cookies.trim()) {
            try {
                await play.setToken({
                    youtube: {
                        cookie: cookies.trim()
                    }
                });
                console.log(`play-dl: YouTube auth initialized from ${key}`);
                return true;
            } catch (error) {
                console.warn(`play-dl: Failed to set cookies from ${key}:`, error.message);
            }
        }
    }

    console.log('play-dl: Running without YouTube auth (may hit rate limits)');
    return false;
}

// Initialize on module load
let authInitialized = false;
const initPromise = initializeAuth().then(result => {
    authInitialized = result;
}).catch(error => {
    console.warn('play-dl: Auth initialization failed:', error.message);
});

/**
 * Get audio stream for a YouTube video
 * @param {string} videoId - YouTube video ID
 * @param {string} videoUrl - Full YouTube URL
 * @returns {Promise<{stream: Readable, type: StreamType, cleanup: Function}>}
 */
async function getAudioStream(videoId, videoUrl) {
    // Ensure auth is initialized
    await initPromise;

    // Cancel any existing stream for this video
    cancelStream(videoId);

    const streamState = { stream: null, aborted: false };
    activeStreams.set(videoId, streamState);

    try {
        // Validate the URL first
        const validated = await play.validate(videoUrl);
        if (!validated || validated === false) {
            throw new Error('Invalid YouTube URL');
        }

        // Get stream - play-dl handles all the heavy lifting
        const streamResult = await play.stream(videoUrl, {
            quality: 2, // 0 = best, 1 = medium, 2 = lowest (fastest for voice)
            discordPlayerCompatibility: true
        });

        if (streamState.aborted) {
            streamResult.stream.destroy();
            throw new Error('Stream cancelled');
        }

        streamState.stream = streamResult.stream;

        return {
            stream: streamResult.stream,
            type: streamResult.type,
            cleanup: () => {
                try {
                    streamResult.stream.destroy();
                } catch (e) {
                    // Ignore cleanup errors
                }
                activeStreams.delete(videoId);
            }
        };
    } catch (error) {
        activeStreams.delete(videoId);
        
        // Provide helpful error messages
        const msg = error.message || String(error);
        
        if (msg.includes('Sign in') || msg.includes('age') || msg.includes('confirm')) {
            throw new Error('This video requires YouTube sign-in (age-restricted or private)');
        }
        
        if (msg.includes('unavailable') || msg.includes('private')) {
            throw new Error('Video is unavailable or private');
        }
        
        if (msg.includes('429') || msg.includes('rate')) {
            throw new Error('YouTube rate limit hit - try again in a few minutes');
        }

        throw error;
    }
}

/**
 * Cancel an active stream
 * @param {string} videoId 
 */
function cancelStream(videoId) {
    const state = activeStreams.get(videoId);
    if (state) {
        state.aborted = true;
        if (state.stream) {
            try {
                state.stream.destroy();
            } catch (e) {
                // Ignore
            }
        }
        activeStreams.delete(videoId);
    }
}

/**
 * Search YouTube for videos
 * @param {string} query - Search query
 * @param {number} limit - Max results
 * @returns {Promise<Array<{title: string, url: string, duration: string, thumbnail: string}>>}
 */
async function searchYouTube(query, limit = 5) {
    await initPromise;

    try {
        const results = await play.search(query, {
            source: { youtube: 'video' },
            limit
        });

        return results.map(video => ({
            title: video.title || 'Unknown Title',
            url: video.url,
            duration: video.durationRaw || '0:00',
            thumbnail: video.thumbnails?.[0]?.url || null,
            channel: video.channel?.name || 'Unknown'
        }));
    } catch (error) {
        console.error('play-dl search error:', error.message);
        return [];
    }
}

/**
 * Get video info without streaming
 * @param {string} url - YouTube URL
 * @returns {Promise<{title: string, duration: number, thumbnail: string}>}
 */
async function getVideoInfo(url) {
    await initPromise;

    try {
        const info = await play.video_info(url);
        const details = info.video_details;

        return {
            title: details.title || 'Unknown Title',
            duration: details.durationInSec || 0,
            durationFormatted: details.durationRaw || '0:00',
            thumbnail: details.thumbnails?.[0]?.url || null,
            channel: details.channel?.name || 'Unknown',
            url: details.url || url
        };
    } catch (error) {
        console.error('play-dl video info error:', error.message);
        throw error;
    }
}

/**
 * Check if play-dl is ready and YouTube is accessible
 */
async function healthCheck() {
    try {
        await initPromise;
        
        // Quick validation test
        const valid = await play.validate('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
        
        return {
            ready: true,
            authenticated: authInitialized,
            youtubeAccessible: valid === 'yt_video'
        };
    } catch (error) {
        return {
            ready: false,
            authenticated: false,
            youtubeAccessible: false,
            error: error.message
        };
    }
}

module.exports = {
    getAudioStream,
    cancelStream,
    searchYouTube,
    getVideoInfo,
    healthCheck
};

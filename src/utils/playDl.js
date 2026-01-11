'use strict';

/**
 * Hybrid YouTube audio streaming - tries play-dl first (fast), falls back to yt-dlp (reliable)
 */

// play-dl disabled - too unreliable on shared IPs, yt-dlp works better
const play = null;

const {
    acquireAudio,
    cancelDownload,
    isNetscapeFormat,
    parseNetscapeCookies,
    COOKIE_ENV_KEYS
} = require('./ytDlp');
const fs = require('fs');
const { PassThrough } = require('stream');
const { StreamType } = require('@discordjs/voice');

// Track active streams for cancellation
const activeStreams = new Map(); // videoId -> { stream, aborted, method }

// Track 429 errors to skip play-dl when rate limited
let playDlRateLimited = false;
let rateLimitResetTime = 0;
const RATE_LIMIT_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Convert cookies to the string format play-dl expects
 */
function cookiesToString(cookies) {
    return cookies.map(c => `${c.name}=${c.value}`).join('; ');
}

/**
 * Initialize play-dl with YouTube cookies if available
 */
async function initializePlayDl() {
    if (!play) return false;

    for (const key of COOKIE_ENV_KEYS) {
        const raw = process.env[key];
        if (!raw || !raw.trim()) continue;

        let cookieString = null;

        // Check if Netscape format
        if (isNetscapeFormat(raw)) {
            const cookies = parseNetscapeCookies(raw);
            if (cookies.length > 0) {
                cookieString = cookiesToString(cookies);
                console.log(
                    `play-dl: Parsed ${cookies.length} cookies from Netscape format (${key})`
                );
            }
        } else if (raw.includes('=') && raw.includes(';')) {
            // Already in cookie string format
            cookieString = raw.trim();
            console.log(`play-dl: Using cookie string from ${key}`);
        }

        if (cookieString) {
            try {
                await play.setToken({
                    youtube: {
                        cookie: cookieString
                    }
                });
                console.log(`play-dl: Initialized with cookies from ${key}`);
                return true;
            } catch (error) {
                console.warn(`play-dl: Cookie init failed:`, error.message);
            }
        }
    }

    console.log('play-dl: No cookies set, will be rate-limited on shared IPs');
    return false;
}

// Initialize on module load
let authInitialized = false;
const initPromise = initializePlayDl()
    .then(result => {
        authInitialized = result;
    })
    .catch(error => {
        console.warn('play-dl init failed:', error.message);
    });

/**
 * Try to get stream via play-dl (fast, but can be rate-limited)
 */
async function tryPlayDl(videoUrl, streamState) {
    if (!play) throw new Error('play-dl not available');

    // Check if we're in rate limit cooldown
    if (playDlRateLimited && Date.now() < rateLimitResetTime) {
        throw new Error('play-dl rate limited, skipping');
    }

    // Normalize URL - play-dl can be picky about format
    let normalizedUrl = videoUrl;

    // Extract video ID and rebuild clean URL
    const videoIdMatch = videoUrl.match(/(?:v=|\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    if (videoIdMatch) {
        normalizedUrl = `https://www.youtube.com/watch?v=${videoIdMatch[1]}`;
    }

    // Skip validation - just try to stream directly
    // play-dl's validate() can fail even for valid videos
    const streamResult = await play.stream(normalizedUrl, {
        quality: 2,
        discordPlayerCompatibility: true
    });

    if (streamState.aborted) {
        streamResult.stream.destroy();
        throw new Error('Stream cancelled');
    }

    // Clear rate limit flag on success
    playDlRateLimited = false;

    streamState.stream = streamResult.stream;
    streamState.method = 'play-dl';

    return {
        stream: streamResult.stream,
        type: streamResult.type,
        cleanup: () => {
            try {
                streamResult.stream.destroy();
            } catch (e) { }
            activeStreams.delete(streamState.videoId);
        }
    };
}

/**
 * Fallback to yt-dlp (slower but more reliable with cookies)
 * Uses pre-buffering to prevent audio glitches on long tracks
 */
async function tryYtDlp(videoId, videoUrl, streamState) {
    console.log(`Falling back to yt-dlp for ${videoId}`);

    const ticket = await acquireAudio(videoId, videoUrl);

    if (streamState.aborted) {
        ticket.release();
        throw new Error('Stream cancelled');
    }

    // Create a PassThrough stream with large buffer for sustained playback
    // This maintains a buffer throughout the track, not just at the start
    const BUFFER_SIZE = 1024 * 1024; // 1MB sustained buffer
    const PRE_BUFFER_SIZE = 2 * 1024 * 1024; // Pre-buffer 2MB before starting

    const bufferedStream = new PassThrough({
        highWaterMark: BUFFER_SIZE,
        // Allow more data to be buffered before backpressure kicks in
        readableHighWaterMark: BUFFER_SIZE,
        writableHighWaterMark: BUFFER_SIZE
    });

    // Read file with large chunks for efficient I/O
    const fileStream = fs.createReadStream(ticket.filePath, {
        highWaterMark: 512 * 1024 // Read in 512KB chunks
    });

    // Pre-buffer: wait for initial data before returning the stream
    let preBuffered = 0;
    let preBufferResolve;
    const preBufferPromise = new Promise(resolve => { preBufferResolve = resolve; });

    const onData = (chunk) => {
        preBuffered += chunk.length;
        if (preBuffered >= PRE_BUFFER_SIZE) {
            fileStream.off('data', onData);
            preBufferResolve();
        }
    };

    // Start piping file to buffered stream
    fileStream.pipe(bufferedStream);

    // Listen for pre-buffer completion (but don't block indefinitely for small files)
    fileStream.on('data', onData);
    fileStream.once('end', () => preBufferResolve()); // Resolve if file ends before pre-buffer target

    // Wait for pre-buffer (max 5 seconds to prevent hanging)
    await Promise.race([
        preBufferPromise,
        new Promise(resolve => setTimeout(resolve, 5000))
    ]);

    console.log(`Pre-buffered ${Math.round(preBuffered / 1024)}KB for ${videoId}`);

    streamState.stream = bufferedStream;
    streamState.method = 'yt-dlp';

    return {
        stream: bufferedStream,
        type: StreamType.OggOpus,
        cleanup: () => {
            try {
                fileStream.destroy();
            } catch (e) { }
            try {
                bufferedStream.destroy();
            } catch (e) { }
            try {
                ticket.release();
            } catch (e) { }
            activeStreams.delete(streamState.videoId);
        }
    };
}

/**
 * Get audio stream for a YouTube video - hybrid approach
 * @param {string} videoId - YouTube video ID
 * @param {string} videoUrl - Full YouTube URL
 * @returns {Promise<{stream: Readable, type: StreamType, cleanup: Function}>}
 */
async function getAudioStream(videoId, videoUrl) {
    await initPromise;

    cancelStream(videoId);

    const streamState = { stream: null, aborted: false, videoId, method: null };
    activeStreams.set(videoId, streamState);

    // Try play-dl first (fast)
    if (play && !playDlRateLimited) {
        try {
            const result = await tryPlayDl(videoUrl, streamState);
            console.log(`Stream started via play-dl for ${videoId}`);
            return result;
        } catch (error) {
            const msg = error.message || String(error);

            // Mark rate limited and set cooldown
            if (msg.includes('429') || msg.includes('rate')) {
                console.warn('play-dl hit 429, switching to yt-dlp for next 10 minutes');
                playDlRateLimited = true;
                rateLimitResetTime = Date.now() + RATE_LIMIT_COOLDOWN_MS;
            }

            console.warn(`play-dl failed: ${msg}, trying yt-dlp...`);
        }
    }

    // Fallback to yt-dlp (reliable)
    try {
        const result = await tryYtDlp(videoId, videoUrl, streamState);
        console.log(`Stream started via yt-dlp for ${videoId}`);
        return result;
    } catch (error) {
        activeStreams.delete(videoId);

        const msg = error.message || String(error);

        if (msg === 'Download cancelled') {
            throw new Error('Stream cancelled');
        }

        if (msg.includes('Sign in') || msg.includes('age')) {
            throw new Error('This video requires sign-in (age-restricted)');
        }

        if (msg.includes('unavailable') || msg.includes('private')) {
            throw new Error('Video is unavailable or private');
        }

        throw new Error(`Unable to play: ${msg}`);
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
            } catch (e) { }
        }
        // Also cancel yt-dlp download if in progress
        try {
            cancelDownload(videoId);
        } catch (e) { }
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
    if (!play) return [];
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
    if (!play) throw new Error('play-dl not available');
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
 * Check if music system is ready
 */
async function healthCheck() {
    try {
        await initPromise;

        return {
            ready: true,
            playDlAvailable: !!play,
            playDlRateLimited,
            authenticated: authInitialized,
            ytDlpAvailable: true // Always available as fallback
        };
    } catch (error) {
        return {
            ready: false,
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

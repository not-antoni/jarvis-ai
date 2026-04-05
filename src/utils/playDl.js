'use strict';

/**
 * Music streaming pipeline:
 * 1) direct yt-dlp URL + ffmpeg transcode (fast start)
 * 2) cached yt-dlp download + local buffered read (reliable fallback)
 */

const { spawn } = require('child_process');
const fs = require('fs');
const { PassThrough } = require('stream');
const { StreamType } = require('@discordjs/voice');

const {
    acquireAudio,
    cancelDownload,
    checkVideoLimits,
    createLiveAudioStream
} = require('./ytDlp');
const { ensureFfmpeg } = require('./ffmpeg');
const { parseBooleanEnv } = require('./parse-bool-env');

// videoId -> { stream, aborted, method, childProcess, source }
const activeStreams = new Map();

const FAST_START_MODE = parseBooleanEnv(process.env.MUSIC_FAST_START_MODE, true);
const DIRECT_STREAM_ENABLED = parseBooleanEnv(process.env.MUSIC_DIRECT_STREAM_ENABLED, true);
const DIRECT_STREAM_SOURCES = new Set(
    String(process.env.MUSIC_DIRECT_STREAM_SOURCES || 'youtube,soundcloud')
        .split(',')
        .map(value => value.trim().toLowerCase())
        .filter(Boolean)
);

const BUFFER_SIZE = Number(process.env.MUSIC_STREAM_BUFFER_BYTES) || (2 * 1024 * 1024);
const PRE_BUFFER_SIZE = Number(process.env.MUSIC_PREBUFFER_BYTES) || (
    FAST_START_MODE ? 512 * 1024 : 4 * 1024 * 1024
);
const PRE_BUFFER_TIMEOUT_MS = Number(process.env.MUSIC_PREBUFFER_TIMEOUT_MS) || (
    FAST_START_MODE ? 1500 : 5000
);

const DIRECT_PREBUFFER_BYTES = Number(process.env.MUSIC_DIRECT_PREBUFFER_BYTES) || (192 * 1024);
const DIRECT_PREBUFFER_TIMEOUT_MS = Number(process.env.MUSIC_DIRECT_PREBUFFER_TIMEOUT_MS) || 9000;
const DIRECT_OPUS_BITRATE = String(process.env.MUSIC_DIRECT_OPUS_BITRATE || '160k');
const DIRECT_OPUS_COMPLEXITY = String(process.env.MUSIC_DIRECT_OPUS_COMPLEXITY || '8');
const OUTPUT_HEADROOM_DB = Number(process.env.MUSIC_OUTPUT_HEADROOM_DB ?? '5');
const OUTPUT_LIMITER_ENABLED = parseBooleanEnv(process.env.MUSIC_OUTPUT_LIMITER_ENABLED, true);

function safeKill(proc) {
    try { if (proc && !proc.killed) {proc.kill('SIGKILL');} } catch (_e) { }
}

function safeDestroy(stream) {
    try { if (stream && !stream.destroyed) {stream.destroy();} } catch (_e) { }
}

function createBufferedStream() {
    return new PassThrough({
        highWaterMark: BUFFER_SIZE,
        readableHighWaterMark: BUFFER_SIZE,
        writableHighWaterMark: BUFFER_SIZE
    });
}

function inferSource(videoUrl) {
    const url = String(videoUrl || '').toLowerCase();
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
        return 'youtube';
    }
    if (url.includes('soundcloud.com')) {
        return 'soundcloud';
    }
    return 'unknown';
}

function normalizeStreamRequest(inputOrVideoId, maybeUrl, maybeOptions = {}) {
    if (inputOrVideoId && typeof inputOrVideoId === 'object') {
        const id = String(inputOrVideoId.id || '').trim();
        const url = String(inputOrVideoId.url || '').trim();
        const source = String(
            inputOrVideoId.source || maybeOptions.source || inferSource(inputOrVideoId.url)
        ).trim().toLowerCase() || 'unknown';
        return { id, url, source };
    }

    const id = String(inputOrVideoId || '').trim();
    const url = String(maybeUrl || '').trim();
    const source = String(maybeOptions.source || inferSource(maybeUrl)).trim().toLowerCase() || 'unknown';
    return { id, url, source };
}

function shouldUseDirectStream(source) {
    if (!DIRECT_STREAM_ENABLED) {
        return false;
    }

    return DIRECT_STREAM_SOURCES.has(String(source || '').toLowerCase());
}

function buildOutputFilter() {
    const filters = [];
    if (Number.isFinite(OUTPUT_HEADROOM_DB) && OUTPUT_HEADROOM_DB > 0) {
        filters.push(`volume=-${OUTPUT_HEADROOM_DB}dB`);
    }
    if (OUTPUT_LIMITER_ENABLED) {
        filters.push('alimiter=limit=0.95:level=disabled');
    }
    return filters.length ? filters.join(',') : null;
}

function waitForPrebuffer(stream, targetBytes, timeoutMs) {
    let buffered = 0;

    return new Promise(resolve => {
        const timeout = setTimeout(() => {
            cleanup();
            resolve(buffered);
        }, timeoutMs);

        const onData = chunk => {
            buffered += chunk.length;
            if (buffered >= targetBytes) {
                cleanup();
                resolve(buffered);
            }
        };

        const onEnd = () => {
            cleanup();
            resolve(buffered);
        };

        const cleanup = () => {
            clearTimeout(timeout);
            stream.off('data', onData);
            stream.off('end', onEnd);
            stream.off('close', onEnd);
        };

        stream.on('data', onData);
        stream.once('end', onEnd);
        stream.once('close', onEnd);
    });
}

async function tryDirectFfmpegStream(videoId, videoUrl, source, streamState) {
    const streamLookupStart = Date.now();
    const live = await createLiveAudioStream(videoId, videoUrl, { source });
    const lookupMs = Date.now() - streamLookupStart;

    if (streamState.aborted) {
        safeKill(live.process);
        throw new Error('Stream cancelled');
    }

    const { ffmpegPath } = await ensureFfmpeg();

    const ffmpegArgs = [
        '-hide_banner',
        '-loglevel',
        'warning',
        '-i',
        'pipe:0',
        '-vn',
        '-ac',
        '2',
        '-ar',
        '48000',
        '-af',
        buildOutputFilter() || 'anull',
        '-c:a',
        'libopus',
        '-b:a',
        DIRECT_OPUS_BITRATE,
        '-vbr',
        'on',
        '-compression_level',
        DIRECT_OPUS_COMPLEXITY,
        '-application',
        'audio',
        '-f',
        'ogg',
        'pipe:1'
    ];

    const ffmpeg = spawn(ffmpegPath, ffmpegArgs, {
        stdio: ['pipe', 'pipe', 'pipe']
    });

    const stderrChunks = [];
    if (ffmpeg.stderr) {
        ffmpeg.stderr.on('data', chunk => {
            if (stderrChunks.length < 40) {
                stderrChunks.push(chunk.toString());
            }
        });
    }

    if (live.stream && ffmpeg.stdin) {
        ffmpeg.stdin.on('error', err => {
            if (err?.code !== 'EPIPE') {
                console.warn(`[music][direct] stdin pipe error: ${err?.message || err}`);
            }
        });
        live.stream.on('error', err => {
            if (err?.code !== 'EPIPE') {
                console.warn(`[music][direct] yt-dlp stream error: ${err?.message || err}`);
            }
        });
        live.stream.pipe(ffmpeg.stdin);
    }

    let ytDlpExitCode = null;
    live.process.once('close', (code) => {
        ytDlpExitCode = code;
        if (code !== 0 && ffmpeg && !ffmpeg.killed) {
            try {
                ffmpeg.kill('SIGKILL');
            } catch (_e) { }
        }
    });

    const bufferedStream = createBufferedStream();

    let hadOutput = false;
    if (ffmpeg.stdout) {
        ffmpeg.stdout.on('data', () => {
            hadOutput = true;
        });
        ffmpeg.stdout.pipe(bufferedStream);
    }

    streamState.childProcess = ffmpeg;
    streamState.stream = bufferedStream;
    streamState.method = 'ffmpeg-direct';

    // Measure prebuffer from source to avoid draining playback container headers.
    const prebufferStart = Date.now();
    const bufferedBytes = await waitForPrebuffer(
        ffmpeg.stdout || bufferedStream,
        DIRECT_PREBUFFER_BYTES,
        DIRECT_PREBUFFER_TIMEOUT_MS
    );
    const prebufferMs = Date.now() - prebufferStart;

    if (streamState.aborted) {
        safeKill(ffmpeg);
        throw new Error('Stream cancelled');
    }

    if (!hadOutput) {
        const stderr = [
            stderrChunks.join(' ').trim(),
            live.getStderr()
        ].filter(Boolean).join(' ');
        safeKill(live.process);
        safeKill(ffmpeg);
        throw new Error(stderr || 'ffmpeg direct stream produced no output');
    }

    console.log(
        `[music][direct] source=${source} id=${videoId} lookupMs=${lookupMs} prebufferBytes=${bufferedBytes} prebufferMs=${prebufferMs} ytdlpExit=${ytDlpExitCode ?? 'running'}`
    );

    return {
        stream: bufferedStream,
        type: StreamType.OggOpus,
        cleanup: () => {
            safeKill(live.process);
            safeKill(ffmpeg);
            safeDestroy(bufferedStream);
            activeStreams.delete(streamState.videoId);
        }
    };
}

async function tryCachedYtDlpStream(videoId, videoUrl, source, streamState, options = {}) {
    const acquireStart = Date.now();
    const ticket = await acquireAudio(videoId, videoUrl, {
        source,
        skipLimitCheck: options.skipLimitCheck === true
    });
    const acquireMs = Date.now() - acquireStart;

    if (streamState.aborted) {
        ticket.release();
        throw new Error('Stream cancelled');
    }

    const bufferedStream = createBufferedStream();

    const fileStream = fs.createReadStream(ticket.filePath, {
        highWaterMark: 512 * 1024
    });

    fileStream.pipe(bufferedStream);

    // Measure prebuffer from source stream, not playback stream.
    const prebufferStart = Date.now();
    const bufferedBytes = await waitForPrebuffer(fileStream, PRE_BUFFER_SIZE, PRE_BUFFER_TIMEOUT_MS);
    const prebufferMs = Date.now() - prebufferStart;

    if (streamState.aborted) {
        safeDestroy(fileStream);
        safeDestroy(bufferedStream);
        ticket.release();
        throw new Error('Stream cancelled');
    }

    streamState.stream = bufferedStream;
    streamState.method = 'yt-dlp-cache';

    console.log(
        `[music][cache] source=${source} id=${videoId} acquireMs=${acquireMs} prebufferBytes=${bufferedBytes} prebufferMs=${prebufferMs}`
    );

    return {
        stream: bufferedStream,
        type: StreamType.OggOpus,
        cleanup: () => {
            safeDestroy(fileStream);
            safeDestroy(bufferedStream);
            try { ticket.release(); } catch (_e) { }
            activeStreams.delete(streamState.videoId);
        }
    };
}

/**
 * Get audio stream for a track.
 * @param {{id: string, url: string, source?: string}|string} inputOrVideoId
 * @param {string=} maybeUrl
 * @param {{source?: string}=} maybeOptions
 * @returns {Promise<{stream: Readable, type: StreamType, cleanup: Function}>}
 */
async function getAudioStream(inputOrVideoId, maybeUrl, maybeOptions = {}) {
    const request = normalizeStreamRequest(inputOrVideoId, maybeUrl, maybeOptions);
    const { id: videoId, url: videoUrl, source } = request;

    if (!videoId || !videoUrl) {
        throw new Error('Invalid stream request');
    }

    cancelStream(videoId);

    const streamState = {
        stream: null,
        aborted: false,
        videoId,
        method: null,
        childProcess: null,
        source
    };
    activeStreams.set(videoId, streamState);

    try {
        const limitCheck = await checkVideoLimits(videoId, videoUrl, { source });
        if (!limitCheck.allowed) {
            throw new Error(limitCheck.reason);
        }

        if (shouldUseDirectStream(source)) {
            try {
                const directResult = await tryDirectFfmpegStream(videoId, videoUrl, source, streamState);
                console.log(`[music][stream] ready source=${source} id=${videoId} method=ffmpeg-direct`);
                return directResult;
            } catch (error) {
                const message = String(error?.message || error);
                console.warn(
                    `[music][direct] source=${source} id=${videoId} failed="${message}" -> fallback=yt-dlp-cache`
                );
            }
        }

        const fallback = await tryCachedYtDlpStream(videoId, videoUrl, source, streamState, {
            skipLimitCheck: true
        });
        console.log(`[music][stream] ready source=${source} id=${videoId} method=yt-dlp-cache`);
        return fallback;
    } catch (error) {
        activeStreams.delete(videoId);

        const msg = error.message || String(error);
        const lowerMsg = msg.toLowerCase();

        if (msg === 'Download cancelled') {
            throw new Error('Stream cancelled');
        }

        if (
            lowerMsg.includes('sign in to confirm') ||
            lowerMsg.includes("confirm you're not a bot") ||
            lowerMsg.includes('confirm youre not a bot')
        ) {
            throw new Error('YouTube requested sign-in verification (anti-bot challenge).');
        }

        if (lowerMsg.includes('age-restricted') || lowerMsg.includes('age restricted')) {
            throw new Error('This video is age-restricted and requires a signed-in YouTube account.');
        }

        if (lowerMsg.includes('sign in')) {
            throw new Error('This video requires a signed-in YouTube session to play.');
        }

        if (lowerMsg.includes('unavailable') || lowerMsg.includes('private')) {
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

        safeKill(state.childProcess);
        safeDestroy(state.stream);

        try {
            cancelDownload(videoId);
        } catch (_e) { }

        activeStreams.delete(videoId);
    }
}

module.exports = {
    getAudioStream,
    cancelStream
};

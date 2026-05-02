'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { spawn } = require('child_process');
const { pipeline } = require('stream/promises');
const { ensureFfmpeg } = require('./ffmpeg');
const { CLIENTS: DEFAULT_CLIENTS, FALLBACK_CLIENTS } = require('./youtubeClients');
const { parseBooleanEnv } = require('./parse-bool-env');
const UPDATE_RECORD_NAME = 'yt-dlp-update.json';
const DEFAULT_UPDATE_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours
const BINARY_NAMES = {
    linux: 'yt-dlp',
    darwin: 'yt-dlp_macos',
    win32: 'yt-dlp.exe'
};
const BINARY_URLS = {
    linux: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp',
    darwin: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos',
    win32: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
};
// Unified cookie env var - supports Netscape format, JSON array, or cookie string
const COOKIE_ENV_KEYS = [
    'YT_COOKIES', // Primary - use this one!
    'YTDLP_COOKIES',
    'YOUTUBE_COOKIES'
];
const TEMP_DIR = path.join(os.tmpdir(), 'jarvis-music-cache');
const BIN_DIR = path.join(os.tmpdir(), 'jarvis-tools');
const MAX_FILE_AGE_MS = 15 * 60 * 1000;
const CLEANUP_DELAY_MS = 2 * 60 * 1000;
const COOKIE_FILE_NAME = 'youtube-cookies.txt';
// Track/file size limits to prevent VPS crashes
const MAX_FILESIZE_MB = parseInt(process.env.YTDLP_MAX_FILESIZE_MB || '50', 10);
const MAX_DURATION_SECONDS = parseInt(process.env.YTDLP_MAX_DURATION || '900', 10); // 15 min default
const DOCUMENTARY_OPENER =
    '🦁 Sir, with all due respect... are you listening to National Geographic documentaries?';
const cache = new Map(); // videoId -> { path, refs, timer, lastAccess }
const pendingDownloads = new Map(); // videoId -> { promise, cancel }
const FAST_START_MODE = parseBooleanEnv(process.env.MUSIC_FAST_START_MODE, true);
const DEFAULT_FORMAT_SELECTOR = 'bestaudio/best';
const YOUTUBE_FORMAT_SELECTOR =
    'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/worst[acodec!=none]/best[acodec!=none]/best';
// SoundCloud has been brittle lately: some tracks crash on hls_mp3 probing.
// Prefer stable direct HTTP audio first, then safer HLS variants.
const SOUNDCLOUD_FORMAT_SELECTOR =
    'bestaudio[protocol^=https][ext=opus]/bestaudio[protocol^=https][ext=aac]/bestaudio[protocol^=https][ext=mp3]/bestaudio[protocol^=http][ext=opus]/bestaudio[protocol^=http][ext=aac]/bestaudio[protocol^=http][ext=mp3]/bestaudio[ext=opus]/bestaudio[ext=aac]/bestaudio[ext=mp3]/bestaudio/best';
const SOUNDCLOUD_EXTRACTOR_FORMATS = ['http_opus', 'http_aac', 'http_mp3', 'hls_opus', 'hls_aac'];
function resolveSource(source, videoUrl) {
    const normalized = String(source || '').trim().toLowerCase();
    let resolved = normalized;
    if (!resolved) {
        const value = String(videoUrl || '').toLowerCase();
        if (value.includes('youtube.com') || value.includes('youtu.be')) {
            resolved = 'youtube';
        } else if (value.includes('soundcloud.com')) {
            resolved = 'soundcloud';
        } else {
            resolved = 'unknown';
        }
    }
    const isYouTube = resolved === 'youtube';
    const isSoundCloud = resolved === 'soundcloud';
    return {
        source: resolved,
        isYouTube,
        isSoundCloud,
        shouldRunPreLimitCheck: !FAST_START_MODE,
        shouldUseYouTubeCookies: isYouTube
    };
}
function buildDurationLimitReason(durationSeconds) {
    const minutes = Math.max(1, Math.floor(durationSeconds / 60));
    const maxMinutes = Math.max(1, Math.floor(MAX_DURATION_SECONDS / 60));
    return `${DOCUMENTARY_OPENER} This is ${minutes} minutes long! Max is ${maxMinutes} minutes.`;
}
function buildFilesizeLimitReason(sizeMb = null) {
    if (Number.isFinite(sizeMb) && sizeMb > 0) {
        return `${DOCUMENTARY_OPENER} This is ~${Math.round(sizeMb)}MB! Max is ${MAX_FILESIZE_MB}MB.`;
    }
    return `${DOCUMENTARY_OPENER} This is too large! Max is ${MAX_FILESIZE_MB}MB.`;
}
function extractApproxSizeMb(text) {
    if (!text || typeof text !== 'string') {
        return null;
    }
    const match = text.match(/(\d+(?:\.\d+)?)\s*(?:mib|mb)\b/i);
    if (!match) {
        return null;
    }
    const parsed = Number.parseFloat(match[1]);
    return Number.isFinite(parsed) ? parsed : null;
}
function extractBestYtDlpErrorLine(stderr) {
    if (!stderr || typeof stderr !== 'string') {
        return '';
    }
    const lines = stderr
        .split('\n')
        .map(line =>
            line
                .replace(/^\s*ERROR:\s*/i, '')
                .replace(/^\s*\[[^\]]+\]\s*/g, '')
                .trim()
        )
        .filter(Boolean);
    if (!lines.length) {
        return '';
    }
    const preferred = lines
        .slice()
        .reverse()
        .find(line =>
            /(error|failed|unable|max-filesize|too large|private|unavailable|sign in|cookies|forbidden|429)/i
                .test(line)
        );
    return preferred || lines[lines.length - 1];
}
function normalizeYtDlpError(error) {
    if (!error || typeof error !== 'object') {
        return error;
    }
    const message = String(error.message || '');
    const stderr = String(error.stderr || '');
    const combined = `${message}\n${stderr}`.toLowerCase();
    if (combined.includes('national geographic documentaries')) {
        return error;
    }
    const isSizeLimitError =
        combined.includes('max-filesize') ||
        combined.includes('file is larger than') ||
        combined.includes('requested formats are incompatible for merge and this file is too large') ||
        combined.includes('too large');
    if (isSizeLimitError) {
        error.message = buildFilesizeLimitReason(extractApproxSizeMb(`${message}\n${stderr}`));
        return error;
    }
    if (/yt-dlp exited with code \d+/i.test(message) && stderr.trim()) {
        const bestLine = extractBestYtDlpErrorLine(stderr);
        if (bestLine) {
            error.message = bestLine;
        }
    }
    return error;
}
async function fileIsFresh(filePath) {
    try {
        const stats = await fs.promises.stat(filePath);
        const ageMs = Date.now() - stats.mtimeMs;
        return ageMs >= 0 && ageMs <= MAX_FILE_AGE_MS;
    } catch {
        return false;
    }
}
async function ensureDirectories() {
    await fs.promises.mkdir(TEMP_DIR, { recursive: true });
    await fs.promises.mkdir(BIN_DIR, { recursive: true });
}
function isAutoUpdateDisabled() {
    const flag = process.env.YTDLP_DISABLE_AUTO_UPDATE || process.env.YTDL_NO_UPDATE;
    if (!flag) {
        return false;
    }
    return ['1', 'true', 'yes'].includes(String(flag).toLowerCase());
}
async function ensureBinary() {
    await ensureDirectories();
    const binaryName = BINARY_NAMES[process.platform];
    if (!binaryName) {
        throw new Error(`Unsupported platform for yt-dlp: ${process.platform}`);
    }
    const binaryPath = path.join(BIN_DIR, binaryName);
    try {
        await fs.promises.access(binaryPath, fs.constants.X_OK);
        await autoUpdateBinary(binaryPath);
        return binaryPath;
    } catch {
        // continue to download
    }
    const downloadUrl = BINARY_URLS[process.platform];
    if (!downloadUrl) {
        throw new Error('No yt-dlp download URL for this platform.');
    }
    const tempPath = path.join(BIN_DIR, `${binaryName}.download`);
    await new Promise((resolve, reject) => {
        const onResponse = res => {
            const status = res.statusCode || 0;
            if (status >= 300 && status < 400 && res.headers.location) {
                const location = res.headers.location.startsWith('http')
                    ? res.headers.location
                    : new URL(res.headers.location, 'https://github.com').toString();
                res.destroy();
                https.get(location, onResponse).on('error', reject);
                return;
            }
            if (status !== 200) {
                res.resume();
                reject(new Error(`Failed to download yt-dlp (status ${status}).`));
                return;
            }
            const fileStream = fs.createWriteStream(tempPath, { mode: 0o755 });
            pipeline(res, fileStream).then(resolve).catch(reject);
        };
        https.get(downloadUrl, onResponse).on('error', reject);
    });
    await fs.promises.rename(tempPath, binaryPath);
    await fs.promises.chmod(binaryPath, 0o755);
    await autoUpdateBinary(binaryPath, { force: true });
    return binaryPath;
}
/**
 * Check if the string is in Netscape cookie format
 */
function isNetscapeFormat(str) {
    return (
        str.includes('# Netscape HTTP Cookie File') ||
        str.includes('# HTTP Cookie File') ||
        // Check for tab-separated cookie lines (7 fields)
        str.split('\n').some(line => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) {return false;}
            const parts = trimmed.split('\t');
            return (
                parts.length >= 7 &&
                (parts[0].includes('.youtube.com') || parts[0].includes('.google.com'))
            );
        })
    );
}
async function ensureCookiesFile() {
    await ensureDirectories();
    const filePath = path.join(BIN_DIR, COOKIE_FILE_NAME);
    // Check for raw Netscape format first - use directly!
    for (const key of COOKIE_ENV_KEYS) {
        const raw = process.env[key];
        if (raw && isNetscapeFormat(raw)) {
            // Already in Netscape format - write directly
            await fs.promises.writeFile(filePath, raw, 'utf8');
            console.log(`Using Netscape cookies from ${key}`);
            return filePath;
        }
    }
    // Fall back to parsing other formats
    const cookies = readCookiesFromEnv();
    if (!cookies?.length) {
        return null;
    }
    const lines = [
        '# Netscape HTTP Cookie File',
        '# Generated by Jarvis so yt-dlp can authenticate requests.'
    ];
    for (const cookie of cookies) {
        const name = cookie.name ?? cookie.key;
        const value = cookie.value ?? cookie.val ?? cookie.content;
        if (!name || typeof value === 'undefined') {
            continue;
        }
        const domain = cookie.domain?.startsWith('.')
            ? cookie.domain
            : `.${(cookie.domain || 'youtube.com').replace(/^\.?/, '')}`;
        const hostOnly = cookie.hostOnly ? 'FALSE' : 'TRUE';
        const pathValue = cookie.path ?? '/';
        const secure = cookie.secure ? 'TRUE' : 'FALSE';
        const expiry = cookie.expires ?? cookie.expirationDate ?? cookie.expiry ?? 0;
        const expiresAt =
            typeof expiry === 'number' && expiry > 0
                ? Math.floor(expiry > 10_000_000_000 ? expiry / 1000 : expiry)
                : 0;
        lines.push(
            [domain, hostOnly, pathValue, secure, expiresAt, String(name), String(value)].join('\t')
        );
    }
    await fs.promises.writeFile(filePath, `${lines.join('\n')}\n`, 'utf8');
    return filePath;
}
function readCookiesFromEnv() {
    for (const key of COOKIE_ENV_KEYS) {
        const raw = process.env[key];
        if (!raw || typeof raw !== 'string') {
            continue;
        }
        const trimmed = raw.trim();
        if (!trimmed.length) {
            continue;
        }
        if (trimmed.startsWith('[')) {
            try {
                return normaliseCookieArray(JSON.parse(trimmed));
            } catch (error) {
                console.warn(`Failed to parse ${key} JSON cookies:`, error?.message || error);
                continue;
            }
        }
        if (trimmed.startsWith('{')) {
            try {
                const parsed = JSON.parse(trimmed);
                if (Array.isArray(parsed?.cookies)) {
                    return normaliseCookieArray(parsed.cookies);
                }
            } catch (error) {
                console.warn(`Failed to parse ${key} cookie object:`, error?.message || error);
                continue;
            }
        }
        return convertLegacyCookieString(trimmed);
    }
    return null;
}
async function prepareCookiesAndExtractor(resolved) {
    // Cookies disabled - self-hosted on residential IP, no need for auth
    const cookieFile = null;
    const extractorArgs = buildExtractorArgs({ hasCookies: false, resolved });
    return { cookieFile, extractorArgs };
}
function buildExtractorArgs({ hasCookies, resolved }) {
    const override = process.env.YTDLP_EXTRACTOR_ARGS;
    if (override && override.trim().length) {
        return [override.trim()];
    }

    const args = [];

    if (resolved?.isYouTube) {
        const clients = [...DEFAULT_CLIENTS];
        if (!hasCookies && FALLBACK_CLIENTS.length) {
            clients.push(...FALLBACK_CLIENTS);
        }
        if (process.env.YTDLP_EXTRA_CLIENTS) {
            const extras = process.env.YTDLP_EXTRA_CLIENTS.split(',')
                .map(value => value.trim())
                .filter(Boolean);
            clients.push(...extras);
        }
        const uniqueClients = Array.from(new Set(clients));
        args.push(`youtube:player_client=${uniqueClients.join(',')}`);
    }

    if (resolved?.isSoundCloud) {
        const customFormats = String(process.env.YTDLP_SOUNDCLOUD_FORMATS || '').trim();
        const selectedFormats = customFormats.length
            ? customFormats
            : SOUNDCLOUD_EXTRACTOR_FORMATS.join(',');
        args.push(`soundcloud:formats=${selectedFormats}`);
    }

    return args.length ? args : null;
}
function appendExtractorArgs(args, extractorArgs) {
    if (!extractorArgs?.length) {
        return;
    }
    for (const entry of extractorArgs) {
        if (!entry) {
            continue;
        }
        args.push('--extractor-args', entry);
    }
}

function buildFormatSelector(resolved) {
    const override = resolved?.isYouTube
        ? process.env.YTDLP_YOUTUBE_FORMAT
        : resolved?.isSoundCloud
            ? process.env.YTDLP_SOUNDCLOUD_FORMAT
            : process.env.YTDLP_FORMAT;
    const globalOverride = process.env.YTDLP_FORMAT;
    const selectedOverride = override || globalOverride;
    if (selectedOverride && selectedOverride.trim().length) {
        return selectedOverride.trim();
    }
    if (resolved?.isYouTube) {
        return YOUTUBE_FORMAT_SELECTOR;
    }
    if (resolved?.isSoundCloud) {
        return SOUNDCLOUD_FORMAT_SELECTOR;
    }
    return DEFAULT_FORMAT_SELECTOR;
}
let updateTask = null;
async function autoUpdateBinary(binaryPath, options = {}) {
    const { force = false } = options;
    const markerPath = path.join(BIN_DIR, UPDATE_RECORD_NAME);
    if (isAutoUpdateDisabled()) {
        return;
    }
    const runUpdate = async() => {
        let lastUpdate = 0;
        if (!force) {
            try {
                const raw = await fs.promises.readFile(markerPath, 'utf8');
                const data = JSON.parse(raw);
                if (typeof data?.timestamp === 'number') {
                    lastUpdate = data.timestamp;
                }
            } catch {
                // ignore
            }
        }
        const interval = Number(process.env.YTDLP_UPDATE_INTERVAL_MS) || DEFAULT_UPDATE_INTERVAL_MS;
        if (!force && Date.now() - lastUpdate < interval) {
            return;
        }
        await new Promise(resolve => {
            const updater = spawn(binaryPath, ['-U'], {
                stdio: ['ignore', 'ignore', 'inherit'],
                env: {
                    ...process.env,
                    YTDLP_NO_CHECK: '1'
                }
            });
            updater.on('error', error => {
                console.warn('yt-dlp auto-update failed:', error?.message || error);
                resolve();
            });
            updater.on('close', code => {
                if (code !== 0 && code !== 100) {
                    console.warn(`yt-dlp auto-update exited with code ${code}`);
                }
                resolve();
            });
        });
        try {
            await fs.promises.writeFile(
                markerPath,
                JSON.stringify({ timestamp: Date.now() }),
                'utf8'
            );
        } catch (error) {
            console.warn('Unable to persist yt-dlp update marker:', error?.message || error);
        }
    };
    if (force) {
        return runUpdate();
    }
    if (!updateTask) {
        updateTask = runUpdate().finally(() => {
            updateTask = null;
        });
    }
    return updateTask;
}
function normaliseCookieArray(input) {
    if (!Array.isArray(input)) {
        return null;
    }
    return input
        .map(cookie => {
            if (!cookie || typeof cookie !== 'object') {
                return null;
            }
            const name = cookie.name ?? cookie.key;
            const value = cookie.value ?? cookie.val ?? cookie.content;
            const domain = cookie.domain ?? '.youtube.com';
            if (!name || typeof value === 'undefined') {
                return null;
            }
            return {
                name: String(name),
                value: String(value),
                domain,
                hostOnly: Boolean(cookie.hostOnly),
                path: cookie.path ?? '/',
                secure: cookie.secure ?? true,
                expires: cookie.expires ?? cookie.expirationDate ?? cookie.expiry ?? 0
            };
        })
        .filter(Boolean);
}
function convertLegacyCookieString(raw) {
    const segments = raw
        .split(/;\s*/g)
        .map(segment => segment.trim())
        .filter(Boolean);
    if (!segments.length) {
        return null;
    }
    return segments
        .map(segment => {
            const [namePart, ...valueParts] = segment.split('=');
            if (!namePart || valueParts.length === 0) {
                return null;
            }
            const name = namePart.trim();
            const value = valueParts.join('=').trim();
            if (!name || !value) {
                return null;
            }
            return {
                name,
                value,
                domain: '.youtube.com',
                path: '/',
                secure: true,
                expires: 0
            };
        })
        .filter(Boolean);
}
function getTargetPaths(videoId) {
    const safeId = videoId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const base = path.join(TEMP_DIR, safeId);
    return {
        base,
        finalPath: `${base}.opus`
    };
}
async function cleanupArtifacts(base) {
    const dir = path.dirname(base);
    const prefix = path.basename(base);
    try {
        const files = await fs.promises.readdir(dir);
        await Promise.all(
            files
                .filter(file => file.startsWith(prefix))
                .map(file => fs.promises.rm(path.join(dir, file), { force: true }))
        );
    } catch {
        // ignore
    }
}
/**
 * Check video duration/size limits BEFORE downloading
 * Returns { allowed: true } or { allowed: false, reason: string }
 */
async function checkVideoLimits(videoId, videoUrl, options = {}) {
    const resolved = resolveSource(options.source, videoUrl);
    const source = resolved.source;
    if (!resolved.shouldRunPreLimitCheck) {
        return { allowed: true, skipped: true };
    }
    const startedAt = Date.now();
    try {
        const binaryPath = await ensureBinary();
        const { cookieFile, extractorArgs } = await prepareCookiesAndExtractor(resolved);
        const result = await new Promise((resolve, reject) => {
            const args = ['-j', '--no-warnings', '--no-playlist'];
            appendExtractorArgs(args, extractorArgs);
            if (cookieFile) {
                args.push('--cookies', cookieFile);
            }
            args.push(videoUrl);
            const proc = spawn(binaryPath, args, {
                timeout: 30000,
                env: { ...process.env, YTDLP_NO_CHECK: '1', YTDL_NO_UPDATE: '1' }
            });
            let stdout = '';
            let stderr = '';
            proc.stdout.on('data', data => { stdout += data.toString(); });
            proc.stderr.on('data', data => { stderr += data.toString(); });
            proc.on('close', code => {
                if (code === 0 && stdout.trim()) {
                    try {
                        resolve(JSON.parse(stdout));
                    } catch {
                        reject(new Error('Failed to parse video info'));
                    }
                } else {
                    const ytdlpError = new Error(`yt-dlp exited with code ${code}`);
                    ytdlpError.stderr = stderr;
                    reject(normalizeYtDlpError(ytdlpError));
                }
            });
            proc.on('error', reject);
        });
        const durationSec = result.duration || 0;
        const filesizeApprox = result.filesize_approx || result.filesize || 0;
        const filesizeMB = filesizeApprox / (1024 * 1024);
        if (durationSec > MAX_DURATION_SECONDS) {
            return {
                allowed: false,
                reason: buildDurationLimitReason(durationSec)
            };
        }
        if (filesizeMB > MAX_FILESIZE_MB) {
            return {
                allowed: false,
                reason: buildFilesizeLimitReason(filesizeMB)
            };
        }
        console.log(
            `[yt-dlp][limits] source=${source} id=${videoId} checkedMs=${Date.now() - startedAt}`
        );
        return { allowed: true, duration: durationSec, title: result.title };
    } catch (error) {
        const normalized = normalizeYtDlpError(error);
        if (normalized?.message && normalized.message.includes('National Geographic documentaries')) {
            return { allowed: false, reason: normalized.message };
        }
        console.warn(
            `[yt-dlp][limits] source=${source} id=${videoId} skippedOnErrorMs=${Date.now() - startedAt} reason=${normalized?.message || error?.message}`
        );
        return { allowed: true, error: normalized?.message || error?.message };
    }
}
async function createLiveAudioStream(videoId, videoUrl, options = {}) {
    const resolved = resolveSource(options.source, videoUrl);
    const source = resolved.source;
    const startedAt = Date.now();
    const binaryPath = await ensureBinary();
    const { cookieFile, extractorArgs } = await prepareCookiesAndExtractor(resolved);
    const args = [
        '--force-ipv4',
        '--ignore-errors',
        '--no-warnings',
        '--no-playlist',
        '--no-progress',
        '--hls-prefer-native',
        '--hls-use-mpegts',
        '-f',
        buildFormatSelector(resolved),
        '-o',
        '-'
    ];
    appendExtractorArgs(args, extractorArgs);
    if (cookieFile) { args.push('--cookies', cookieFile); }
    args.push(videoUrl);
    const stderrChunks = [];
    const proc = spawn(binaryPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, YTDLP_NO_CHECK: '1', YTDL_NO_UPDATE: '1' }
    });
    if (proc.stderr) {
        proc.stderr.on('data', chunk => {
            if (stderrChunks.length < 80) {
                stderrChunks.push(chunk.toString());
            }
        });
    }
    console.log(
        `[yt-dlp][live] source=${source} id=${videoId} cookieMode=${cookieFile ? 'on' : 'off'} spawnMs=${Date.now() - startedAt}`
    );
    return {
        process: proc,
        stream: proc.stdout,
        source,
        usedCookies: Boolean(cookieFile),
        getStderr: () => stderrChunks.join('')
    };
}
async function createDownloadTask(videoId, videoUrl, options = {}) {
    const resolved = resolveSource(options.source, videoUrl);
    const source = resolved.source;
    const canUseCookies = resolved.shouldUseYouTubeCookies;
    const skipLimitCheck = options.skipLimitCheck === true;
    const limitCheck = skipLimitCheck
        ? { allowed: true }
        : await checkVideoLimits(videoId, videoUrl, { source });
    if (!limitCheck.allowed) {
        throw new Error(limitCheck.reason);
    }
    const binaryPath = await ensureBinary();
    const { ffmpegPath, ffprobePath } = await ensureFfmpeg();
    const { base, finalPath } = getTargetPaths(videoId);
    let currentChild = null;
    const runOnce = async useCookies => {
        const startedAt = Date.now();
        await cleanupArtifacts(base);
        const cookieFile = canUseCookies && useCookies ? await ensureCookiesFile() : null;
        const extractorArgs = buildExtractorArgs({
            hasCookies: Boolean(cookieFile),
            resolved
        });
        const args = [
            '--force-ipv4',
            '--ignore-errors',
            '--no-warnings',
            '--no-continue',
            '--no-overwrites',
            '--no-part',
            '--no-mtime',
            '--hls-prefer-native',
            '--hls-use-mpegts',
            '-f',
            buildFormatSelector(resolved),
            '--no-playlist',
            '--extract-audio',
            '--audio-format',
            'opus',
            '--audio-quality',
            '0',
            '--output',
            `${base}.%(ext)s`,
            '--no-progress',
            '--concurrent-fragments',
            '4',
            // Enforce max file size during download as backup
            '--max-filesize',
            `${MAX_FILESIZE_MB}M`
        ];
        appendExtractorArgs(args, extractorArgs);
        if (cookieFile) {
            args.push('--cookies', cookieFile);
        }
        args.push(
            '--ffmpeg-location',
            ffmpegPath,
            videoUrl
        );
        const envVars = { ...process.env, YTDLP_NO_CHECK: '1', YTDL_NO_UPDATE: '1' };
        if (ffprobePath) {
            envVars.FFPROBE = ffprobePath;
        }
        const stderrChunks = [];
        currentChild = spawn(binaryPath, args, {
            stdio: ['ignore', 'pipe', 'pipe'],
            env: envVars
        });
        if (currentChild.stdout) {
            currentChild.stdout.on('data', chunk => {
                process.stdout.write(chunk);
            });
        }
        if (currentChild.stderr) {
            currentChild.stderr.on('data', chunk => {
                stderrChunks.push(chunk.toString());
                process.stderr.write(chunk);
            });
        }
        const awaitCompletion = () =>
            new Promise((resolve, reject) => {
                const handleError = async error => {
                    await cleanupArtifacts(base).catch(() => {});
                    error.stderr = stderrChunks.join('');
                    normalizeYtDlpError(error);
                    reject(error);
                };
                currentChild.on('error', handleError);
                currentChild.on('close', async code => {
                    if (code !== 0) {
                        await handleError(new Error(`yt-dlp exited with code ${code}`));
                        return;
                    }
                    try {
                        const files = await fs.promises.readdir(TEMP_DIR);
                        const output = files
                            .map(file => path.join(TEMP_DIR, file))
                            .find(file => file.startsWith(base) && file.endsWith('.opus'));
                        if (!output) {
                            throw new Error('Extraction finished without producing an Opus file.');
                        }
                        await fs.promises.rename(output, finalPath);
                        console.log(
                            `[yt-dlp][download] source=${source} id=${videoId} cookieMode=${cookieFile ? 'on' : 'off'} doneMs=${Date.now() - startedAt}`
                        );
                        resolve(finalPath);
                    } catch (error) {
                        await handleError(error);
                    }
                });
            });
        try {
            return await awaitCompletion();
        } finally {
            currentChild = null;
        }
    };
    const promise = (async() => {
        try {
            return await runOnce(true);
        } catch (error) {
            if (canUseCookies && shouldRetryWithoutCookies(error)) {
                console.warn(
                    `[yt-dlp][download] source=${source} id=${videoId} retrying-without-cookies`
                );
                return runOnce(false);
            }
            throw error;
        }
    })();
    const cancel = () => {
        if (currentChild) {
            currentChild.kill('SIGKILL');
        }
    };
    return { promise, cancel };
}
function scheduleCleanup(videoId, entry) {
    if (entry.timer) {
        clearTimeout(entry.timer);
    }
    entry.timer = setTimeout(async() => {
        try {
            if (entry.path) {
                await fs.promises.rm(entry.path, { force: true });
            }
        } catch (error) {
            console.warn('Failed to remove cached audio:', error.message || error);
        } finally {
            cache.delete(videoId);
        }
    }, CLEANUP_DELAY_MS);
    if (entry.timer.unref) {
        entry.timer.unref();
    }
}
function shouldRetryWithoutCookies(error) {
    const msg = String(error?.message || error?.stderr || '').toLowerCase();
    return msg.includes('sign in') || msg.includes('forbidden') || msg.includes('unauthorized') || msg.includes('401') || msg.includes('403');
}
async function acquireAudio(videoId, videoUrl, options = {}) {
    const source = resolveSource(options.source, videoUrl).source;
    const existing = cache.get(videoId);
    if (existing && existing.path) {
        existing.refs = (existing.refs || 0) + 1;
        existing.lastAccess = Date.now();
        return {
            filePath: existing.path,
            release: () => releaseCacheRef(videoId)
        };
    }
    const pending = pendingDownloads.get(videoId);
    if (pending) {
        const filePath = await pending.promise;
        return {
            filePath,
            release: () => releaseCacheRef(videoId)
        };
    }
    const task = createDownloadTask(videoId, videoUrl, { source, skipLimitCheck: options.skipLimitCheck === true });
    pendingDownloads.set(videoId, { promise: task.promise, cancel: task.cancel });
    try {
        const filePath = await task.promise;
        cache.set(videoId, { path: filePath, refs: 1, timer: null, lastAccess: Date.now() });
        scheduleCleanup(videoId, cache.get(videoId));
        return {
            filePath,
            release: () => releaseCacheRef(videoId)
        };
    } finally {
        pendingDownloads.delete(videoId);
    }
}
function releaseCacheRef(videoId) {
    const entry = cache.get(videoId);
    if (!entry) {
        return;
    }
    entry.refs = Math.max(0, (entry.refs || 1) - 1);
    entry.lastAccess = Date.now();
    if (entry.refs === 0) {
        scheduleCleanup(videoId, entry);
    }
}
function cancelDownload(videoId) {
    const pending = pendingDownloads.get(videoId);
    if (pending?.cancel) {
        pending.cancel();
    }
}
module.exports = {
    acquireAudio,
    cancelDownload,
    checkVideoLimits,
    createLiveAudioStream
};

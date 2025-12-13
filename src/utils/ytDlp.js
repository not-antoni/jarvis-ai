const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { spawn } = require('child_process');
const { pipeline } = require('stream/promises');
const { ensureFfmpeg } = require('./ffmpeg');

const { CLIENTS: DEFAULT_CLIENTS, FALLBACK_CLIENTS } = require('./youtubeClients');
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

const cache = new Map(); // videoId -> { path, refs, timer, lastAccess }
const pendingDownloads = new Map(); // videoId -> { promise, cancel }

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
            if (!trimmed || trimmed.startsWith('#')) return false;
            const parts = trimmed.split('\t');
            return (
                parts.length >= 7 &&
                (parts[0].includes('.youtube.com') || parts[0].includes('.google.com'))
            );
        })
    );
}

/**
 * Parse Netscape format cookies to array
 */
function parseNetscapeCookies(str) {
    const cookies = [];
    const lines = str.split('\n');

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        const parts = trimmed.split('\t');
        if (parts.length < 7) continue;

        const [domain, , cookiePath, secure, expiry, name, value] = parts;
        if (!name || !value) continue;

        cookies.push({
            domain,
            path: cookiePath,
            secure: secure === 'TRUE',
            expires: parseInt(expiry, 10) || 0,
            name,
            value
        });
    }

    return cookies;
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

function buildExtractorArgs(hasCookies) {
    const override = process.env.YTDLP_EXTRACTOR_ARGS;
    if (override && override.trim().length) {
        return override.trim();
    }

    const clients = [...DEFAULT_CLIENTS];

    if (!hasCookies && FALLBACK_CLIENTS.length) {
        clients.unshift(...FALLBACK_CLIENTS);
    }

    if (process.env.YTDLP_EXTRA_CLIENTS) {
        const extras = process.env.YTDLP_EXTRA_CLIENTS.split(',')
            .map(value => value.trim())
            .filter(Boolean);
        clients.push(...extras);
    }

    const uniqueClients = Array.from(new Set(clients));
    return `youtube:player_client=${uniqueClients.join(',')}`;
}

let updateTask = null;

async function autoUpdateBinary(binaryPath, options = {}) {
    const { force = false } = options;
    const markerPath = path.join(BIN_DIR, UPDATE_RECORD_NAME);

    if (isAutoUpdateDisabled()) {
        return;
    }

    const runUpdate = async () => {
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

async function createDownloadTask(videoId, videoUrl) {
    const binaryPath = await ensureBinary();
    const { ffmpegPath, ffprobePath } = await ensureFfmpeg();
    const { base, finalPath } = getTargetPaths(videoId);
    let currentChild = null;

    const runOnce = async useCookies => {
        await cleanupArtifacts(base);

        const cookieFile = useCookies ? await ensureCookiesFile() : null;
        const extractorArgs = buildExtractorArgs(Boolean(cookieFile));

        const args = [
            '--force-ipv4',
            '--ignore-errors',
            '--no-continue',
            '--no-overwrites',
            '--no-part',
            '--no-mtime',
            '-f',
            'bestaudio/best',
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
            '--extractor-args',
            extractorArgs,
            '--ffmpeg-location',
            ffmpegPath,
            videoUrl
        ];

        if (cookieFile) {
            args.splice(args.length - 1, 0, '--cookies', cookieFile);
        }

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

    const promise = (async () => {
        try {
            return await runOnce(true);
        } catch (error) {
            if (shouldRetryWithoutCookies(error)) {
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

    entry.timer = setTimeout(async () => {
        try {
            if (entry.path) {
                await fs.promises.rm(entry.path, { force: true });
            }
        } catch (error) {
            console.warn('Failed to remove cached audio:', error.message || error);
        } finally {
            cache.delete(videoId);
        }
    }, CLEANUP_DELAY_MS).unref?.();
}

function cancelCleanup(entry) {
    if (entry?.timer) {
        clearTimeout(entry.timer);
        entry.timer = null;
    }
}

async function acquireAudio(videoId, videoUrl) {
    let entry = cache.get(videoId);

    if (entry && entry.path) {
        const fresh = await fileIsFresh(entry.path);
        if (!fresh) {
            await fs.promises.rm(entry.path, { force: true }).catch(() => {});
            cache.delete(videoId);
            entry = null;
        }
    }

    if (entry && entry.path) {
        cancelCleanup(entry);
        entry.refs += 1;
        entry.lastAccess = Date.now();
        return {
            filePath: entry.path,
            release: () => releaseAudio(videoId)
        };
    }

    const pending = pendingDownloads.get(videoId);
    if (pending) {
        const finalPath = await pending.promise;
        return {
            filePath: finalPath,
            release: () => releaseAudio(videoId)
        };
    }

    const task = await createDownloadTask(videoId, videoUrl);
    const wrappedPromise = task.promise
        .then(path => {
            const cacheEntry = {
                path,
                refs: 1,
                lastAccess: Date.now(),
                timer: null
            };
            cache.set(videoId, cacheEntry);
            pendingDownloads.delete(videoId);
            return path;
        })
        .catch(error => {
            pendingDownloads.delete(videoId);
            cache.delete(videoId);
            throw error;
        });

    pendingDownloads.set(videoId, { promise: wrappedPromise, cancel: task.cancel });

    const finalPath = await wrappedPromise;
    return {
        filePath: finalPath,
        release: () => releaseAudio(videoId)
    };
}

function cancelDownload(videoId) {
    const pending = pendingDownloads.get(videoId);
    if (pending) {
        pending.cancel();
    }
}

function releaseAudio(videoId) {
    const entry = cache.get(videoId);
    if (!entry) {
        return;
    }

    entry.refs = Math.max(0, entry.refs - 1);
    entry.lastAccess = Date.now();

    if (entry.refs === 0) {
        scheduleCleanup(videoId, entry);
    }
}

function shouldRetryWithoutCookies(error) {
    if (!error) {
        return false;
    }
    const stderr = String(error.stderr || '').toLowerCase();
    if (!stderr) {
        return false;
    }

    const retryIndicators = [
        'cookies are no longer valid',
        'watch video on youtube',
        'error 153',
        'player configuration error',
        'signature extraction failed'
    ];

    return retryIndicators.some(indicator => stderr.includes(indicator));
}

module.exports = {
    acquireAudio,
    cancelDownload,
    isNetscapeFormat,
    parseNetscapeCookies,
    COOKIE_ENV_KEYS
};

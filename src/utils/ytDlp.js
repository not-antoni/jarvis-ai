const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { pipeline } = require('stream/promises');
const https = require('https');

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

const TEMP_DIR = path.join(os.tmpdir(), 'jarvis-music-cache');
const BIN_DIR = path.join(os.tmpdir(), 'jarvis-tools');
const MAX_FILE_AGE_MS = 15 * 60 * 1000;
const CLEANUP_DELAY_MS = 2 * 60 * 1000;

const cache = new Map(); // videoId -> { path, refs, lastAccess, timer }
const pendingDownloads = new Map();

async function ensureDirectories() {
    await fs.promises.mkdir(TEMP_DIR, { recursive: true });
    await fs.promises.mkdir(BIN_DIR, { recursive: true });
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
        const request = https.get(downloadUrl, (res) => {
            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                // follow redirect
                res.destroy();
                https.get(res.headers.location, response => handleResponse(response, resolve, reject));
                return;
            }

            handleResponse(res, resolve, reject);
        });

        request.on('error', reject);

        function handleResponse(res, resolveCb, rejectCb) {
            if (res.statusCode !== 200) {
                rejectCb(new Error(`Failed to download yt-dlp (status ${res.statusCode}).`));
                res.resume();
                return;
            }

            const fileStream = fs.createWriteStream(tempPath, { mode: 0o755 });
            pipeline(res, fileStream)
                .then(resolveCb)
                .catch(rejectCb);
        }
    });

    await fs.promises.rename(tempPath, binaryPath);
    await fs.promises.chmod(binaryPath, 0o755);

    return binaryPath;
}

function getTargetPaths(videoId) {
    const safeId = videoId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const base = path.join(TEMP_DIR, safeId);
    return {
        base,
        finalPath: `${base}.opus`
    };
}

async function fileIsFresh(filePath) {
    try {
        const stats = await fs.promises.stat(filePath);
        return Date.now() - stats.mtimeMs <= MAX_FILE_AGE_MS;
    } catch {
        return false;
    }
}

async function downloadAudio(videoId, videoUrl) {
    const binaryPath = await ensureBinary();
    const { base, finalPath } = getTargetPaths(videoId);

    // Clean up lingering files
    await fs.promises.rm(`${base}.opus`, { force: true }).catch(() => {});
    await fs.promises.rm(`${base}.m4a`, { force: true }).catch(() => {});
    await fs.promises.rm(`${base}.webm`, { force: true }).catch(() => {});
    await fs.promises.rm(`${base}.part`, { force: true }).catch(() => {});

    const args = [
        '-f', 'bestaudio/best',
        '--no-playlist',
        '--extract-audio',
        '--audio-format', 'opus',
        '--audio-quality', '0',
        '--output', `${base}.%(ext)s`,
        '--no-progress',
        videoUrl
    ];

    await new Promise((resolve, reject) => {
        const child = spawn(binaryPath, args, {
            stdio: ['ignore', 'inherit', 'inherit'],
            env: { ...process.env, YTDLP_NO_CHECK: '1' }
        });

        child.on('error', reject);
        child.on('close', async (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`yt-dlp exited with code ${code}`));
            }
        });
    });

    await fs.promises.access(finalPath, fs.constants.R_OK);
    return finalPath;
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
        const isFresh = await fileIsFresh(entry.path);
        if (!isFresh) {
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
        await pending;
        return acquireAudio(videoId, videoUrl);
    }

    const downloadPromise = downloadAudio(videoId, videoUrl)
        .then((path) => {
            const newEntry = {
                path,
                refs: 1,
                lastAccess: Date.now(),
                timer: null
            };
            cache.set(videoId, newEntry);
            pendingDownloads.delete(videoId);
            return path;
        })
        .catch((error) => {
            pendingDownloads.delete(videoId);
            cache.delete(videoId);
            throw error;
        });

    pendingDownloads.set(videoId, downloadPromise);
    const finalPath = await downloadPromise;

    return {
        filePath: finalPath,
        release: () => releaseAudio(videoId)
    };
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

module.exports = {
    acquireAudio
};

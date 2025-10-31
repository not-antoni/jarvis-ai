const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { pipeline } = require('stream/promises');
const extract = require('extract-zip');
const tar = require('tar');

let ffmpegStatic = null;
try {
    // Prefer the precompiled binary provided by the dependency when available.
    // eslint-disable-next-line import/no-extraneous-dependencies
    ffmpegStatic = require('ffmpeg-static');
} catch {
    ffmpegStatic = null;
}

const BIN_DIR = path.join(os.tmpdir(), 'jarvis-tools');

const RELEASES = {
    linux: {
        assetName: 'ffmpeg-master-latest-linux64-gpl-shared.tar.xz',
        archiveType: 'tar.xz',
        binaryPath: 'ffmpeg-master-latest-linux64-gpl-shared/bin/ffmpeg'
    },
    darwin: {
        assetName: 'ffmpeg-master-latest-macOS64-gpl-shared.zip',
        archiveType: 'zip',
        binaryPath: 'ffmpeg'
    },
    win32: {
        assetName: 'ffmpeg-master-latest-win64-gpl-shared.zip',
        archiveType: 'zip',
        binaryPath: 'ffmpeg-master-latest-win64-gpl-shared/bin/ffmpeg.exe'
    }
};

async function ensureDirectories() {
    await fs.promises.mkdir(BIN_DIR, { recursive: true });
}

async function fetchJson(url) {
    return new Promise((resolve, reject) => {
        https
            .get(url, res => {
                const status = res.statusCode || 0;
                if (status >= 300 && status < 400 && res.headers.location) {
                    res.destroy();
                    fetchJson(res.headers.location).then(resolve).catch(reject);
                    return;
                }

                if (status !== 200) {
                    res.resume();
                    reject(new Error(`Failed to fetch ${url} (status ${status}).`));
                    return;
                }

                let raw = '';
                res.setEncoding('utf8');
                res.on('data', chunk => {
                    raw += chunk;
                });
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(raw));
                    } catch (error) {
                        reject(error);
                    }
                });
            })
            .on('error', reject);
    });
}

async function downloadAsset(url, destination) {
    await new Promise((resolve, reject) => {
        const onResponse = (res) => {
            const status = res.statusCode || 0;
            if (status >= 300 && status < 400 && res.headers.location) {
                res.destroy();
                https.get(res.headers.location, onResponse).on('error', reject);
                return;
            }

            if (status !== 200) {
                res.resume();
                reject(new Error(`Failed to download ffmpeg (status ${status}).`));
                return;
            }

            const fileStream = fs.createWriteStream(destination);
            pipeline(res, fileStream).then(resolve).catch(reject);
        };

        https.get(url, onResponse).on('error', reject);
    });
}

async function ensureFfmpeg() {
    if (ffmpegStatic) {
        return ffmpegStatic;
    }

    await ensureDirectories();

    const releaseConfig = RELEASES[process.platform];
    if (!releaseConfig) {
        throw new Error(`Unsupported platform for ffmpeg bootstrap: ${process.platform}`);
    }

    const binaryName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
    const binaryPath = path.join(BIN_DIR, binaryName);

    try {
        await fs.promises.access(binaryPath, fs.constants.X_OK);
        return binaryPath;
    } catch {
        // continue to download
    }

    // Attempt to fetch metadata from GitHub; if we hit rate limits fall back to the
    // static "latest" download URLs that redirect to the most recent build.
    let assetUrl = null;
    try {
        const release = await fetchJson('https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/latest');
        const asset = (release.assets || []).find(item => item.name === releaseConfig.assetName);
        if (asset?.browser_download_url) {
            assetUrl = asset.browser_download_url;
        }
    } catch (error) {
        console.warn('Failed to query GitHub release API for ffmpeg:', error?.message || error);
    }

    if (!assetUrl) {
        assetUrl = `https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/${releaseConfig.assetName}`;
    }

    const archivePath = path.join(BIN_DIR, releaseConfig.assetName);
    await downloadAsset(assetUrl, archivePath);

    if (releaseConfig.archiveType === 'zip') {
        await extract(archivePath, { dir: BIN_DIR });
    } else if (releaseConfig.archiveType === 'tar.xz') {
        await tar.x({ file: archivePath, cwd: BIN_DIR });
    } else {
        throw new Error(`Unsupported archive type ${releaseConfig.archiveType}`);
    }

    await fs.promises.rm(archivePath, { force: true });

    const extractedPath = path.join(BIN_DIR, releaseConfig.binaryPath);
    await fs.promises.access(extractedPath, fs.constants.R_OK);
    await fs.promises.copyFile(extractedPath, binaryPath);
    await fs.promises.chmod(binaryPath, 0o755);

    return binaryPath;
}

module.exports = {
    ensureFfmpeg
};

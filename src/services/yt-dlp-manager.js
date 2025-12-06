/**
 * yt-dlp Manager - Auto-updating yt-dlp for YouTube playback
 * 
 * Features:
 * - Auto-downloads latest yt-dlp on startup
 * - Auto-updates when new version available
 * - Works on both Windows and Linux (Render)
 * - Fallback audio extraction for when Lavalink fails
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const https = require('https');
const http = require('http');

const GITHUB_API_RELEASES = 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest';
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // Check every 6 hours

// GitHub token for authenticated requests (higher rate limits: 5000/hour vs 60/hour)
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || null;

class YtDlpManager {
    constructor() {
        this.binDir = path.join(__dirname, '../../bin');
        this.isWindows = process.platform === 'win32';
        this.executableName = this.isWindows ? 'yt-dlp.exe' : 'yt-dlp';
        this.executablePath = path.join(this.binDir, this.executableName);
        this.versionFile = path.join(this.binDir, '.yt-dlp-version');
        this.currentVersion = null;
        this.latestVersion = null;
        this.ready = false;
        this.updating = false;
        this.lastUpdateCheck = 0;
    }

    /**
     * Initialize yt-dlp - download if missing, update if outdated
     */
    async initialize() {
        console.log('[yt-dlp] Initializing...');
        
        // Ensure bin directory exists
        if (!fs.existsSync(this.binDir)) {
            fs.mkdirSync(this.binDir, { recursive: true });
            console.log('[yt-dlp] Created bin directory');
        }

        // Load current version from file
        this.currentVersion = this.loadVersionFromFile();
        
        // Check if executable exists
        if (!fs.existsSync(this.executablePath)) {
            console.log('[yt-dlp] Not found, downloading...');
            await this.downloadLatest();
        } else {
            // Check for updates
            await this.checkAndUpdate();
        }

        // Verify it works
        if (await this.verify()) {
            this.ready = true;
            console.log(`[yt-dlp] Ready! Version: ${this.currentVersion || 'unknown'}`);
            
            // Schedule periodic update checks
            this.scheduleUpdateChecks();
        } else {
            console.error('[yt-dlp] Failed to verify installation');
        }

        return this.ready;
    }

    /**
     * Load saved version from file
     */
    loadVersionFromFile() {
        try {
            if (fs.existsSync(this.versionFile)) {
                return fs.readFileSync(this.versionFile, 'utf8').trim();
            }
        } catch (error) {
            console.warn('[yt-dlp] Could not read version file:', error.message);
        }
        return null;
    }

    /**
     * Save version to file
     */
    saveVersionToFile(version) {
        try {
            fs.writeFileSync(this.versionFile, version);
        } catch (error) {
            console.warn('[yt-dlp] Could not save version file:', error.message);
        }
    }

    /**
     * Fetch latest release info from GitHub
     */
    async fetchLatestRelease() {
        return new Promise((resolve, reject) => {
            const headers = {
                'User-Agent': 'Jarvis-Discord-Bot/1.0',
                'Accept': 'application/vnd.github.v3+json'
            };
            
            // Add auth token if available (increases rate limit from 60 to 5000/hour)
            if (GITHUB_TOKEN) {
                headers['Authorization'] = `token ${GITHUB_TOKEN}`;
                console.log('[yt-dlp] Using authenticated GitHub request');
            }
            
            const options = { headers };

            https.get(GITHUB_API_RELEASES, options, (res) => {
                if (res.statusCode === 302 || res.statusCode === 301) {
                    // Follow redirect
                    https.get(res.headers.location, options, (res2) => {
                        this.handleGitHubResponse(res2, resolve, reject);
                    }).on('error', reject);
                    return;
                }
                this.handleGitHubResponse(res, resolve, reject);
            }).on('error', reject);
        });
    }

    handleGitHubResponse(res, resolve, reject) {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
            try {
                if (res.statusCode !== 200) {
                    reject(new Error(`GitHub API returned ${res.statusCode}: ${data.substring(0, 200)}`));
                    return;
                }
                const release = JSON.parse(data);
                resolve(release);
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Get download URL for current platform
     */
    getDownloadUrl(release) {
        const assets = release.assets || [];
        
        let assetName;
        if (this.isWindows) {
            assetName = 'yt-dlp.exe';
        } else {
            // Linux - prefer the standalone binary
            assetName = 'yt-dlp_linux';
            // Fallback to regular yt-dlp if linux version not found
            const linuxAsset = assets.find(a => a.name === 'yt-dlp_linux');
            if (!linuxAsset) {
                assetName = 'yt-dlp';
            }
        }

        const asset = assets.find(a => a.name === assetName);
        if (!asset) {
            // Try alternative names
            const alternatives = this.isWindows 
                ? ['yt-dlp_win.exe', 'yt-dlp_x86.exe']
                : ['yt-dlp', 'yt-dlp_linux_aarch64'];
            
            for (const alt of alternatives) {
                const altAsset = assets.find(a => a.name === alt);
                if (altAsset) return altAsset.browser_download_url;
            }
            
            throw new Error(`No suitable yt-dlp binary found for ${process.platform}`);
        }

        return asset.browser_download_url;
    }

    /**
     * Download file with redirect following
     */
    downloadFile(url, destPath) {
        return new Promise((resolve, reject) => {
            const file = fs.createWriteStream(destPath);
            const protocol = url.startsWith('https') ? https : http;
            
            // Build headers with optional auth
            const downloadHeaders = { 'User-Agent': 'Jarvis-Discord-Bot/1.0' };
            if (GITHUB_TOKEN) {
                downloadHeaders['Authorization'] = `token ${GITHUB_TOKEN}`;
            }

            const request = (downloadUrl) => {
                protocol.get(downloadUrl, {
                    headers: downloadHeaders
                }, (response) => {
                    // Handle redirects
                    if (response.statusCode === 302 || response.statusCode === 301) {
                        file.close();
                        fs.unlinkSync(destPath);
                        const newFile = fs.createWriteStream(destPath);
                        const redirectProtocol = response.headers.location.startsWith('https') ? https : http;
                        
                        redirectProtocol.get(response.headers.location, {
                            headers: downloadHeaders
                        }, (redirectRes) => {
                            if (redirectRes.statusCode !== 200) {
                                newFile.close();
                                reject(new Error(`Download failed: ${redirectRes.statusCode}`));
                                return;
                            }
                            redirectRes.pipe(newFile);
                            newFile.on('finish', () => {
                                newFile.close();
                                resolve();
                            });
                        }).on('error', (err) => {
                            newFile.close();
                            fs.unlinkSync(destPath);
                            reject(err);
                        });
                        return;
                    }

                    if (response.statusCode !== 200) {
                        file.close();
                        fs.unlinkSync(destPath);
                        reject(new Error(`Download failed: ${response.statusCode}`));
                        return;
                    }

                    response.pipe(file);
                    file.on('finish', () => {
                        file.close();
                        resolve();
                    });
                }).on('error', (err) => {
                    file.close();
                    fs.unlinkSync(destPath);
                    reject(err);
                });
            };

            request(url);
        });
    }

    /**
     * Download latest yt-dlp
     */
    async downloadLatest() {
        if (this.updating) {
            console.log('[yt-dlp] Update already in progress');
            return false;
        }

        this.updating = true;
        console.log('[yt-dlp] Fetching latest release info...');

        try {
            const release = await this.fetchLatestRelease();
            this.latestVersion = release.tag_name;
            console.log(`[yt-dlp] Latest version: ${this.latestVersion}`);

            const downloadUrl = this.getDownloadUrl(release);
            console.log(`[yt-dlp] Downloading from: ${downloadUrl}`);

            // Download to temp file first
            const tempPath = this.executablePath + '.tmp';
            await this.downloadFile(downloadUrl, tempPath);

            // Replace old executable
            if (fs.existsSync(this.executablePath)) {
                fs.unlinkSync(this.executablePath);
            }
            fs.renameSync(tempPath, this.executablePath);

            // Make executable on Linux
            if (!this.isWindows) {
                fs.chmodSync(this.executablePath, 0o755);
            }

            this.currentVersion = this.latestVersion;
            this.saveVersionToFile(this.currentVersion);
            console.log(`[yt-dlp] Downloaded successfully: ${this.currentVersion}`);

            this.updating = false;
            return true;
        } catch (error) {
            console.error('[yt-dlp] Download failed:', error.message);
            this.updating = false;
            return false;
        }
    }

    /**
     * Check if update is needed and update if so
     */
    async checkAndUpdate() {
        try {
            console.log('[yt-dlp] Checking for updates...');
            const release = await this.fetchLatestRelease();
            this.latestVersion = release.tag_name;

            if (!this.currentVersion || this.currentVersion !== this.latestVersion) {
                console.log(`[yt-dlp] Update available: ${this.currentVersion || 'none'} -> ${this.latestVersion}`);
                await this.downloadLatest();
            } else {
                console.log(`[yt-dlp] Already up to date: ${this.currentVersion}`);
            }

            this.lastUpdateCheck = Date.now();
        } catch (error) {
            console.warn('[yt-dlp] Update check failed:', error.message);
            // Continue with existing version if available
        }
    }

    /**
     * Schedule periodic update checks
     */
    scheduleUpdateChecks() {
        setInterval(async () => {
            if (Date.now() - this.lastUpdateCheck > UPDATE_CHECK_INTERVAL_MS) {
                await this.checkAndUpdate();
            }
        }, UPDATE_CHECK_INTERVAL_MS).unref();
    }

    /**
     * Verify yt-dlp works
     */
    async verify() {
        try {
            const version = execSync(`"${this.executablePath}" --version`, {
                encoding: 'utf8',
                timeout: 30000,
                windowsHide: true
            }).trim();
            
            console.log(`[yt-dlp] Verified working: ${version}`);
            if (!this.currentVersion) {
                this.currentVersion = version;
                this.saveVersionToFile(version);
            }
            return true;
        } catch (error) {
            console.error('[yt-dlp] Verification failed:', error.message);
            return false;
        }
    }

    /**
     * Get audio stream URL for a video
     */
    async getAudioUrl(videoUrl) {
        if (!this.ready) {
            throw new Error('yt-dlp not initialized');
        }

        return new Promise((resolve, reject) => {
            const args = [
                '-f', 'bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio',
                '-g', // Get URL only
                '--no-warnings',
                '--no-playlist',
                videoUrl
            ];

            const proc = spawn(this.executablePath, args, {
                timeout: 30000
            });

            let stdout = '';
            let stderr = '';

            proc.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            proc.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            proc.on('close', (code) => {
                if (code === 0 && stdout.trim()) {
                    resolve(stdout.trim().split('\n')[0]);
                } else {
                    reject(new Error(stderr || `yt-dlp exited with code ${code}`));
                }
            });

            proc.on('error', reject);
        });
    }

    /**
     * Get video info (title, duration, etc)
     */
    async getVideoInfo(videoUrl) {
        if (!this.ready) {
            throw new Error('yt-dlp not initialized');
        }

        return new Promise((resolve, reject) => {
            const args = [
                '-j', // JSON output
                '--no-warnings',
                '--no-playlist',
                videoUrl
            ];

            const proc = spawn(this.executablePath, args, {
                timeout: 30000
            });

            let stdout = '';
            let stderr = '';

            proc.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            proc.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            proc.on('close', (code) => {
                if (code === 0 && stdout.trim()) {
                    try {
                        const info = JSON.parse(stdout);
                        resolve({
                            title: info.title || 'Unknown',
                            author: info.uploader || info.channel || 'Unknown',
                            duration: (info.duration || 0) * 1000, // Convert to ms
                            url: info.webpage_url || videoUrl,
                            identifier: info.id || null,
                            thumbnail: info.thumbnail || null
                        });
                    } catch (error) {
                        reject(new Error('Failed to parse video info'));
                    }
                } else {
                    reject(new Error(stderr || `yt-dlp exited with code ${code}`));
                }
            });

            proc.on('error', reject);
        });
    }

    /**
     * Search YouTube for videos
     */
    async search(query, limit = 5) {
        if (!this.ready) {
            throw new Error('yt-dlp not initialized');
        }

        return new Promise((resolve, reject) => {
            const args = [
                `ytsearch${limit}:${query}`,
                '-j',
                '--flat-playlist',
                '--no-warnings'
            ];

            const proc = spawn(this.executablePath, args, {
                timeout: 30000
            });

            let stdout = '';
            let stderr = '';

            proc.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            proc.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            proc.on('close', (code) => {
                if (code === 0 && stdout.trim()) {
                    try {
                        const results = stdout.trim().split('\n')
                            .filter(line => line.trim())
                            .map(line => {
                                try {
                                    const info = JSON.parse(line);
                                    return {
                                        title: info.title || 'Unknown',
                                        author: info.uploader || info.channel || 'Unknown',
                                        duration: (info.duration || 0) * 1000,
                                        url: info.url || `https://www.youtube.com/watch?v=${info.id}`,
                                        identifier: info.id || null
                                    };
                                } catch {
                                    return null;
                                }
                            })
                            .filter(Boolean);
                        resolve(results);
                    } catch (error) {
                        reject(new Error('Failed to parse search results'));
                    }
                } else {
                    reject(new Error(stderr || `yt-dlp exited with code ${code}`));
                }
            });

            proc.on('error', reject);
        });
    }

    /**
     * Get status info
     */
    getStatus() {
        return {
            ready: this.ready,
            updating: this.updating,
            currentVersion: this.currentVersion,
            latestVersion: this.latestVersion,
            executablePath: this.executablePath,
            platform: this.isWindows ? 'windows' : 'linux',
            lastUpdateCheck: this.lastUpdateCheck ? new Date(this.lastUpdateCheck).toISOString() : null,
            githubAuth: !!GITHUB_TOKEN // Shows if GitHub auth is configured
        };
    }

    /**
     * Force update check
     */
    async forceUpdate() {
        console.log('[yt-dlp] Force update requested');
        await this.checkAndUpdate();
        return this.getStatus();
    }
}

// Singleton instance
const ytDlpManager = new YtDlpManager();

module.exports = ytDlpManager;

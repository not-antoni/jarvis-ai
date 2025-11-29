/**
 * Image Manager - Download, store, process, and manage scraped images
 * Handles image downloading, caching, resizing, and metadata extraction
 */

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const http = require('http');

class ImageManager {
    constructor(options = {}) {
        this.storageDir = options.storageDir || './scraped-images';
        this.maxImageSize = options.maxImageSize || 50 * 1024 * 1024; // 50 MB
        this.maxDimensions = options.maxDimensions || 10000;
        this.supportedFormats = options.supportedFormats || ['jpg', 'jpeg', 'png', 'gif', 'webp'];
        this.timeout = options.timeout || 30000;
        
        this.stats = {
            downloaded: 0,
            failed: 0,
            cached: 0,
            totalSize: 0,
            skipped: 0
        };

        this.downloadCache = new Map(); // URL -> file info
        this.initStorage();
    }

    /**
     * Initialize storage directory
     */
    async initStorage() {
        try {
            await fs.mkdir(this.storageDir, { recursive: true });
            await fs.mkdir(path.join(this.storageDir, 'thumbnails'), { recursive: true });
            await fs.mkdir(path.join(this.storageDir, 'originals'), { recursive: true });
            console.log(`[ImageManager] Storage initialized at ${this.storageDir}`);
        } catch (error) {
            console.error(`[ImageManager] Failed to initialize storage:`, error.message);
        }
    }

    /**
     * Download image from URL
     */
    async downloadImage(url, options = {}) {
        try {
            // Validate URL
            if (!url || typeof url !== 'string') {
                this.stats.skipped++;
                return null;
            }

            // Check cache first
            if (this.downloadCache.has(url)) {
                this.stats.cached++;
                return this.downloadCache.get(url);
            }

            // Validate URL format
            const urlObj = new URL(url);
            const extension = this.getExtensionFromURL(url);
            
            if (!this.supportedFormats.includes(extension.toLowerCase())) {
                console.warn(`[ImageManager] Unsupported format: ${extension}`);
                this.stats.skipped++;
                return null;
            }

            // Generate filename
            const hash = crypto.createHash('sha256').update(url).digest('hex');
            const filename = `${hash}.${extension}`;
            const filepath = path.join(this.storageDir, 'originals', filename);

            // Check if already exists
            try {
                const stats = await fs.stat(filepath);
                const cached = {
                    url,
                    filename,
                    filepath,
                    size: stats.size,
                    cached: true
                };
                this.downloadCache.set(url, cached);
                this.stats.cached++;
                console.log(`[ImageManager] Image already cached: ${filename}`);
                return cached;
            } catch {
                // File doesn't exist, proceed with download
            }

            // Download image
            const buffer = await this.fetchImage(url);
            
            if (!buffer) {
                this.stats.failed++;
                return null;
            }

            // Validate size
            if (buffer.length > this.maxImageSize) {
                console.warn(`[ImageManager] Image too large: ${buffer.length} bytes`);
                this.stats.skipped++;
                return null;
            }

            // Save image
            await fs.writeFile(filepath, buffer);

            const result = {
                url,
                filename,
                filepath,
                size: buffer.length,
                cached: false
            };

            this.downloadCache.set(url, result);
            this.stats.downloaded++;
            this.stats.totalSize += buffer.length;

            console.log(`[ImageManager] Downloaded image: ${filename} (${buffer.length} bytes)`);
            return result;

        } catch (error) {
            console.error(`[ImageManager] Failed to download ${url}:`, error.message);
            this.stats.failed++;
            return null;
        }
    }

    /**
     * Fetch image buffer from URL
     */
    async fetchImage(url) {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Download timeout'));
            }, this.timeout);

            const protocol = url.startsWith('https') ? https : http;

            try {
                protocol.get(url, { timeout: this.timeout }, (response) => {
                    clearTimeout(timeout);

                    if (response.statusCode !== 200) {
                        reject(new Error(`HTTP ${response.statusCode}`));
                        return;
                    }

                    const chunks = [];
                    response.on('data', chunk => chunks.push(chunk));
                    response.on('end', () => {
                        resolve(Buffer.concat(chunks));
                    });
                    response.on('error', reject);
                }).on('error', reject);
            } catch (error) {
                clearTimeout(timeout);
                reject(error);
            }
        });
    }

    /**
     * Get file extension from URL
     */
    getExtensionFromURL(url) {
        try {
            const urlPath = new URL(url).pathname;
            const extension = path.extname(urlPath).slice(1).toLowerCase();
            
            if (extension && this.supportedFormats.includes(extension)) {
                return extension;
            }

            // Fallback: check content-type from filename or default to jpg
            return 'jpg';
        } catch {
            return 'jpg';
        }
    }

    /**
     * Download multiple images
     */
    async downloadImages(urls, options = {}) {
        console.log(`[ImageManager] Downloading ${urls.length} images...`);

        const results = [];
        const concurrency = options.concurrency || 3;

        for (let i = 0; i < urls.length; i += concurrency) {
            const batch = urls.slice(i, i + concurrency);
            const batchResults = await Promise.all(
                batch.map(url => this.downloadImage(url, options))
            );
            results.push(...batchResults.filter(r => r !== null));
        }

        console.log(`[ImageManager] Downloaded ${results.length}/${urls.length} images`);
        return results;
    }

    /**
     * Get image info
     */
    async getImageInfo(filepath) {
        try {
            const stats = await fs.stat(filepath);
            const filename = path.basename(filepath);

            return {
                filename,
                filepath,
                size: stats.size,
                created: stats.birthtime,
                modified: stats.mtime
            };
        } catch (error) {
            console.error(`[ImageManager] Failed to get image info:`, error.message);
            return null;
        }
    }

    /**
     * Create thumbnail using sharp (if available)
     */
    async createThumbnail(filepath, options = {}) {
        try {
            // Try to require sharp, fall back if not available
            let sharp;
            try {
                sharp = require('sharp');
            } catch {
                console.warn('[ImageManager] Sharp not available for thumbnails. Install with: npm install sharp');
                return null;
            }

            const width = options.width || 150;
            const height = options.height || 150;
            const filename = path.basename(filepath);
            const thumbnailPath = path.join(this.storageDir, 'thumbnails', `thumb_${width}x${height}_${filename}`);

            await sharp(filepath)
                .resize(width, height, {
                    fit: 'cover',
                    position: 'center'
                })
                .toFile(thumbnailPath);

            console.log(`[ImageManager] Created thumbnail: ${path.basename(thumbnailPath)}`);
            return thumbnailPath;

        } catch (error) {
            console.warn(`[ImageManager] Failed to create thumbnail:`, error.message);
            return null;
        }
    }

    /**
     * Get all downloaded images
     */
    async getDownloadedImages() {
        try {
            const originalsDir = path.join(this.storageDir, 'originals');
            const files = await fs.readdir(originalsDir);

            const images = [];
            for (const file of files) {
                const filepath = path.join(originalsDir, file);
                const info = await this.getImageInfo(filepath);
                if (info) {
                    images.push(info);
                }
            }

            return images;
        } catch (error) {
            console.error(`[ImageManager] Failed to get downloaded images:`, error.message);
            return [];
        }
    }

    /**
     * Delete image
     */
    async deleteImage(filename) {
        try {
            const filepath = path.join(this.storageDir, 'originals', filename);
            await fs.unlink(filepath);

            // Delete associated thumbnails
            const thumbnailsDir = path.join(this.storageDir, 'thumbnails');
            const thumbFiles = await fs.readdir(thumbnailsDir);
            
            for (const thumbFile of thumbFiles) {
                if (thumbFile.includes(filename)) {
                    await fs.unlink(path.join(thumbnailsDir, thumbFile));
                }
            }

            console.log(`[ImageManager] Deleted image: ${filename}`);
            return true;
        } catch (error) {
            console.error(`[ImageManager] Failed to delete image:`, error.message);
            return false;
        }
    }

    /**
     * Clear all images
     */
    async clearAll() {
        try {
            const originalsDir = path.join(this.storageDir, 'originals');
            const files = await fs.readdir(originalsDir);

            for (const file of files) {
                await fs.unlink(path.join(originalsDir, file));
            }

            console.log(`[ImageManager] Cleared ${files.length} images`);
            this.downloadCache.clear();
            this.stats = { downloaded: 0, failed: 0, cached: 0, totalSize: 0, skipped: 0 };
            return true;
        } catch (error) {
            console.error(`[ImageManager] Failed to clear images:`, error.message);
            return false;
        }
    }

    /**
     * Get statistics
     */
    getStats() {
        return {
            ...this.stats,
            cacheSize: this.downloadCache.size,
            totalSizeMB: (this.stats.totalSize / (1024 * 1024)).toFixed(2),
            successRate: (this.stats.downloaded / (this.stats.downloaded + this.stats.failed)) * 100 || 0
        };
    }

    /**
     * Export image manifest
     */
    async exportManifest(filename = 'images-manifest.json') {
        try {
            const images = await this.getDownloadedImages();
            const manifest = {
                timestamp: new Date().toISOString(),
                stats: this.getStats(),
                images: images.map(img => ({
                    filename: img.filename,
                    size: img.size,
                    created: img.created
                }))
            };

            const filepath = path.join(this.storageDir, filename);
            await fs.writeFile(filepath, JSON.stringify(manifest, null, 2));
            console.log(`[ImageManager] Exported manifest: ${filepath}`);
            return filepath;
        } catch (error) {
            console.error(`[ImageManager] Failed to export manifest:`, error.message);
            return null;
        }
    }
}

module.exports = ImageManager;

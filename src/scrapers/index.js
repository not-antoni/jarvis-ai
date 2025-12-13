/**
 * Scraping System Index - Central export point for all scraping components
 * Use this file to import all scrapers and utilities in your code
 */

// Core Components
const BaseScraper = require('./baseScraper');
const WikipediaScraper = require('./wikipediaScraper');
const ImageManager = require('./imageManager');
const ScraperUtils = require('./scraperUtils');

// Routes
const createScrapingRouter = require('../utils/scrapingRoutes');

// Demos
const {
    runAllDemos,
    runDemo,
    demoSimpleArticleScrape,
    demoArticleWithImages,
    demoSearchAndScrape,
    demoBatchScraping,
    demoExtractMetadata,
    demoTextStatistics,
    demoRelatedArticles,
    demoDataExport
} = require('./scrapingDemo');

/**
 * Quick Start Helper
 */
class ScrapingSystem {
    constructor(browserAgent, productionAgent = null) {
        this.browserAgent = browserAgent;
        this.productionAgent = productionAgent;

        // Initialize components
        this.scraper = new WikipediaScraper(browserAgent);
        this.imageManager = new ImageManager();
        this.utils = ScraperUtils;
    }

    /**
     * Scrape a Wikipedia article with images
     */
    async scrapeArticle(articleTitle, options = {}) {
        const { downloadImages = true, includeStats = false } = options;

        const page = await this.browserAgent.startSession(`scrape_${Date.now()}_${Math.random()}`);

        try {
            const article = await this.scraper.scrapeArticle(page, articleTitle);

            if (downloadImages && article.images.length > 0) {
                const imageURLs = article.images.map(img => img.src);
                const results = await this.imageManager.downloadImages(imageURLs);
                article.images = results;
            }

            if (includeStats) {
                article.stats = this.scraper.getStats();
                article.imageStats = this.imageManager.getStats();
            }

            return article;
        } finally {
            // Cleanup session
            if (page && page.browser) {
                await page
                    .browser()
                    .disconnect()
                    .catch(() => {});
            }
        }
    }

    /**
     * Search and get results
     */
    async search(query, limit = 10) {
        const page = await this.browserAgent.startSession(`search_${Date.now()}`);

        try {
            return await this.scraper.searchArticles(page, query, limit);
        } finally {
            if (page && page.browser) {
                await page
                    .browser()
                    .disconnect()
                    .catch(() => {});
            }
        }
    }

    /**
     * Get related articles
     */
    async getRelated(articleTitle) {
        const page = await this.browserAgent.startSession(`related_${Date.now()}`);

        try {
            return await this.scraper.getRelatedArticles(page, articleTitle);
        } finally {
            if (page && page.browser) {
                await page
                    .browser()
                    .disconnect()
                    .catch(() => {});
            }
        }
    }

    /**
     * Download images from URLs
     */
    async downloadImages(urls, options = {}) {
        return await this.imageManager.downloadImages(urls, options);
    }

    /**
     * Get image statistics
     */
    getImageStats() {
        return this.imageManager.getStats();
    }

    /**
     * Get all downloaded images
     */
    async getDownloadedImages() {
        return await this.imageManager.getDownloadedImages();
    }

    /**
     * Export images manifest
     */
    async exportImageManifest() {
        return await this.imageManager.exportManifest();
    }

    /**
     * Analyze text
     */
    analyzeText(text) {
        return ScraperUtils.getTextStats(text);
    }

    /**
     * Export data
     */
    async exportData(data, format = 'json') {
        const filename = `export_${Date.now()}`;

        if (format === 'json') {
            await ScraperUtils.saveJSON(`./exports/${filename}.json`, data);
        } else if (format === 'csv') {
            const headers = Object.keys(Array.isArray(data) ? data[0] : {});
            await ScraperUtils.saveCSV(`./exports/${filename}.csv`, data, headers);
        }

        return filename;
    }

    /**
     * Get scraper statistics
     */
    getStats() {
        return {
            scraper: this.scraper.getStats(),
            images: this.imageManager.getStats()
        };
    }
}

/**
 * Factory function for Express integration
 */
function createScrapingAPI(discordHandlers, productionAgent) {
    return createScrapingRouter(discordHandlers, productionAgent);
}

module.exports = {
    // Components
    BaseScraper,
    WikipediaScraper,
    ImageManager,
    ScraperUtils,

    // System class
    ScrapingSystem,

    // Router factory
    createScrapingAPI,
    createScrapingRouter,

    // Demos
    runAllDemos,
    runDemo,
    demoSimpleArticleScrape,
    demoArticleWithImages,
    demoSearchAndScrape,
    demoBatchScraping,
    demoExtractMetadata,
    demoTextStatistics,
    demoRelatedArticles,
    demoDataExport
};

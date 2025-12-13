/**
 * Scraping API Routes - Express endpoints for all scraping operations
 */

const express = require('express');
const router = express.Router();

function createScrapingRouter(discordHandlers, productionAgent) {
    const BrowserAgent = require('../agents/browserAgent');
    const WikipediaScraper = require('./wikipediaScraper');
    const ImageManager = require('./imageManager');
    const ScraperUtils = require('./scraperUtils');

    const browserAgent = discordHandlers?.browserAgent || new BrowserAgent();
    const imageManager = new ImageManager();

    /**
     * GET /scrape/wikipedia/:article
     * Scrape Wikipedia article
     */
    router.get('/scrape/wikipedia/:article', async (req, res) => {
        const { article } = req.params;
        const { images = false, stats = false } = req.query;

        if (!article) {
            return res.status(400).json({
                success: false,
                error: 'Article name required'
            });
        }

        try {
            // Start trace
            const traceId =
                productionAgent?.tracer?.startTrace('wikipedia_scrape', { article }) || 'local';
            const spanId = productionAgent?.tracer?.startSpan(traceId, 'scrape_article') || 'local';

            // Get or create page
            const page = await browserAgent.startSession(`wiki_${Date.now()}_${Math.random()}`);
            const scraper = new WikipediaScraper(browserAgent);

            // Scrape article
            const articleData = await scraper.scrapeArticle(page, article);

            // Download images if requested
            if (images === 'true' && articleData.images.length > 0) {
                console.log(`[ScrapingAPI] Downloading ${articleData.images.length} images...`);
                const imageURLs = articleData.images.map(img => img.src);
                const downloadedImages = await imageManager.downloadImages(imageURLs);
                articleData.images = downloadedImages;
            }

            // Add stats if requested
            if (stats === 'true') {
                articleData.stats = await scraper.getArticleStats(page, article);
                articleData.scraperStats = scraper.getStats();
                articleData.imageStats = imageManager.getStats();
            }

            // Log trace
            if (productionAgent?.tracer) {
                productionAgent.tracer.recordSpanEvent(spanId, 'article_scraped', {
                    articleLength: articleData.content.totalLength,
                    imageCount: articleData.images.length
                });
                productionAgent.tracer.endSpan(spanId);
                productionAgent.tracer.endTrace(traceId);
            }

            res.json({
                success: true,
                data: articleData
            });
        } catch (error) {
            console.error('[ScrapingAPI] Scrape failed:', error.message);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    /**
     * GET /scrape/wikipedia/search/:query
     * Search Wikipedia
     */
    router.get('/scrape/wikipedia/search/:query', async (req, res) => {
        const { query } = req.params;
        const { limit = 10 } = req.query;

        try {
            const page = await browserAgent.startSession(`wiki_search_${Date.now()}`);
            const scraper = new WikipediaScraper(browserAgent);

            const results = await scraper.searchArticles(page, query, parseInt(limit));

            res.json({
                success: true,
                query,
                results: results || []
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    /**
     * GET /scrape/wikipedia/related/:article
     * Get related Wikipedia articles
     */
    router.get('/scrape/wikipedia/related/:article', async (req, res) => {
        const { article } = req.params;

        try {
            const page = await browserAgent.startSession(`wiki_related_${Date.now()}`);
            const scraper = new WikipediaScraper(browserAgent);

            const related = await scraper.getRelatedArticles(page, article);

            res.json({
                success: true,
                article,
                related: related || []
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    /**
     * GET /scrape/images
     * Get all downloaded images
     */
    router.get('/scrape/images', async (req, res) => {
        try {
            const images = await imageManager.getDownloadedImages();
            const stats = imageManager.getStats();

            res.json({
                success: true,
                images,
                stats
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    /**
     * GET /scrape/images/stats
     * Get image download statistics
     */
    router.get('/scrape/images/stats', async (req, res) => {
        try {
            const stats = imageManager.getStats();
            res.json({
                success: true,
                stats
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    /**
     * POST /scrape/images/clear
     * Clear all downloaded images
     */
    router.post('/scrape/images/clear', async (req, res) => {
        try {
            const success = await imageManager.clearAll();
            res.json({
                success,
                message: success ? 'Images cleared' : 'Failed to clear images'
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    /**
     * GET /scrape/images/manifest
     * Export image manifest
     */
    router.get('/scrape/images/manifest', async (req, res) => {
        try {
            const manifestPath = await imageManager.exportManifest();
            res.json({
                success: true,
                manifestPath
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    /**
     * POST /scrape/batch
     * Scrape multiple Wikipedia articles
     */
    router.post('/scrape/batch', async (req, res) => {
        const { articles = [] } = req.body;
        const { images = false } = req.query;

        if (!Array.isArray(articles) || articles.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Articles array required'
            });
        }

        try {
            const results = [];
            const errors = [];

            for (const article of articles) {
                try {
                    const page = await browserAgent.startSession(`wiki_batch_${Date.now()}`);
                    const scraper = new WikipediaScraper(browserAgent);
                    const articleData = await scraper.scrapeArticle(page, article);

                    if (images === 'true' && articleData.images.length > 0) {
                        const imageURLs = articleData.images.map(img => img.src);
                        const downloadedImages = await imageManager.downloadImages(imageURLs);
                        articleData.images = downloadedImages;
                    }

                    results.push(articleData);
                } catch (error) {
                    errors.push({
                        article,
                        error: error.message
                    });
                }
            }

            res.json({
                success: true,
                total: articles.length,
                successful: results.length,
                failed: errors.length,
                results,
                errors: errors.length > 0 ? errors : undefined
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    /**
     * GET /scrape/text-stats
     * Get text statistics
     */
    router.post('/scrape/text-stats', (req, res) => {
        const { text } = req.body;

        if (!text) {
            return res.status(400).json({
                success: false,
                error: 'Text required'
            });
        }

        try {
            const stats = ScraperUtils.getTextStats(text);
            res.json({
                success: true,
                stats
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    /**
     * POST /scrape/export/:format
     * Export scraped data
     */
    router.post('/scrape/export/:format', async (req, res) => {
        const { format } = req.params;
        const { data = [] } = req.body;

        if (!Array.isArray(data) || data.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Data array required'
            });
        }

        try {
            const filename = `export_${Date.now()}`;

            if (format === 'json') {
                await ScraperUtils.saveJSON(`./exports/${filename}.json`, data);
                res.json({
                    success: true,
                    file: `${filename}.json`,
                    format: 'json'
                });
            } else if (format === 'csv') {
                await ScraperUtils.saveCSV(`./exports/${filename}.csv`, data);
                res.json({
                    success: true,
                    file: `${filename}.csv`,
                    format: 'csv'
                });
            } else {
                res.status(400).json({
                    success: false,
                    error: 'Unsupported format. Use json or csv'
                });
            }
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    return router;
}

module.exports = createScrapingRouter;

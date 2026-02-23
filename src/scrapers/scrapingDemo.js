/**
 * Complete Scraping Demo - Demonstrates all scraper capabilities
 * This file shows practical examples of how to use the scraping system
 */

const WikipediaScraper = require('../scrapers/wikipediaScraper');
const ImageManager = require('../scrapers/imageManager');
const ScraperUtils = require('../scrapers/scraperUtils');
const BrowserAgent = require('../agents/browserAgent');

/**
 * DEMO 1: Simple Wikipedia Article Scrape
 */
async function demoSimpleArticleScrape() {
    console.log('\n=== DEMO 1: Simple Wikipedia Article Scrape ===');

    const browserAgent = new BrowserAgent();
    const scraper = new WikipediaScraper(browserAgent);

    try {
        const page = await browserAgent.startSession('demo_simple');
        const article = await scraper.scrapeArticle(page, 'Machine Learning');

        console.log(`✓ Title: ${article.title}`);
        console.log(`✓ Sections: ${article.content.sections.length}`);
        console.log(`✓ Paragraphs: ${article.content.paragraphs.length}`);
        console.log(`✓ Images found: ${article.images.length}`);
        console.log(`✓ References: ${article.references.length}`);

        return article;
    } catch (error) {
        console.error('✗ Demo failed:', error.message);
    }
}

/**
 * DEMO 2: Scrape with Image Download
 */
async function demoArticleWithImages() {
    console.log('\n=== DEMO 2: Scrape with Image Download ===');

    const browserAgent = new BrowserAgent();
    const scraper = new WikipediaScraper(browserAgent);
    const imageManager = new ImageManager();

    try {
        const page = await browserAgent.startSession('demo_images');
        const article = await scraper.scrapeArticle(page, 'Python (programming language)');

        console.log(`✓ Article: ${article.title}`);
        console.log(`✓ Found ${article.images.length} images`);

        // Download images
        if (article.images.length > 0) {
            console.log('⏳ Downloading images...');
            const imageURLs = article.images.map(img => img.src);
            const results = await imageManager.downloadImages(imageURLs, { concurrency: 3 });

            console.log(`✓ Downloaded: ${results.successful}`);
            console.log(`✗ Failed: ${results.failed}`);
            console.log(`⚡ Cached: ${results.cached}`);

            // Show image stats
            const stats = imageManager.getStats();
            console.log('\n📊 Image Statistics:');
            console.log(`   Downloaded: ${stats.downloaded}`);
            console.log(`   Cached: ${stats.cached}`);
            console.log(`   Total Size: ${(stats.totalSize / 1024 / 1024).toFixed(2)} MB`);
        }
    } catch (error) {
        console.error('✗ Demo failed:', error.message);
    }
}

/**
 * DEMO 3: Search and Scrape
 */
async function demoSearchAndScrape() {
    console.log('\n=== DEMO 3: Search and Scrape ===');

    const browserAgent = new BrowserAgent();
    const scraper = new WikipediaScraper(browserAgent);

    try {
        const page = await browserAgent.startSession('demo_search');

        // Search for articles
        console.log('🔍 Searching for "Artificial Intelligence"...');
        const results = await scraper.searchArticles(page, 'Artificial Intelligence', 5);

        if (results && results.length > 0) {
            console.log(`✓ Found ${results.length} results:`);
            results.forEach((result, i) => {
                console.log(`   ${i + 1}. ${result}`);
            });

            // Scrape first result
            console.log(`\n⏳ Scraping: ${results[0]}...`);
            const article = await scraper.scrapeArticle(page, results[0]);
            console.log(`✓ Scraped: ${article.title}`);
            console.log(`   Content length: ${article.content.totalLength} chars`);
            console.log(`   Images: ${article.images.length}`);
        }
    } catch (error) {
        console.error('✗ Demo failed:', error.message);
    }
}

/**
 * DEMO 4: Batch Scraping
 */
async function demoBatchScraping() {
    console.log('\n=== DEMO 4: Batch Scraping ===');

    const browserAgent = new BrowserAgent();
    const scraper = new WikipediaScraper(browserAgent);

    const articles = ['React (JavaScript library)', 'Vue.js', 'Angular'];
    const results = [];

    try {
        for (let i = 0; i < articles.length; i++) {
            const article = articles[i];
            console.log(`[${i + 1}/${articles.length}] Scraping: ${article}...`);

            try {
                const page = await browserAgent.startSession(`demo_batch_${i}`);
                const data = await scraper.scrapeArticle(page, article);
                results.push({
                    title: data.title,
                    contentLength: data.content.totalLength,
                    images: data.images.length,
                    links: data.links.length
                });
                console.log(`✓ Success: ${data.title}`);
            } catch (error) {
                console.log(`✗ Failed: ${error.message}`);
            }
        }

        console.log(`\n✓ Completed: ${results.length}/${articles.length}`);
        console.log('\n📋 Summary:');
        results.forEach(r => {
            console.log(`   ${r.title}`);
            console.log(`      Content: ${r.contentLength} chars`);
            console.log(`      Images: ${r.images}, Links: ${r.links}`);
        });
    } catch (error) {
        console.error('✗ Demo failed:', error.message);
    }
}

/**
 * DEMO 5: Extract Metadata
 */
async function demoExtractMetadata() {
    console.log('\n=== DEMO 5: Extract Metadata ===');

    const browserAgent = new BrowserAgent();
    const scraper = new WikipediaScraper(browserAgent);

    try {
        const page = await browserAgent.startSession('demo_metadata');
        const article = await scraper.scrapeArticle(page, 'Quantum Computing');

        console.log(`✓ Article: ${article.title}`);
        console.log(`\n📚 Sections (${article.content.sections.length}):`);
        article.content.sections.slice(0, 5).forEach(section => {
            console.log(`   • ${section}`);
        });

        if (article.infobox && Object.keys(article.infobox).length > 0) {
            console.log(`\n📋 Infobox (${Object.keys(article.infobox).length} fields):`);
            Object.entries(article.infobox)
                .slice(0, 5)
                .forEach(([key, value]) => {
                    console.log(`   • ${key}: ${value}`);
                });
        }

        if (article.categories && article.categories.length > 0) {
            console.log(`\n🏷️  Categories (${article.categories.length}):`);
            article.categories.slice(0, 5).forEach(cat => {
                console.log(`   • ${cat}`);
            });
        }
    } catch (error) {
        console.error('✗ Demo failed:', error.message);
    }
}

/**
 * DEMO 6: Text Statistics
 */
async function demoTextStatistics() {
    console.log('\n=== DEMO 6: Text Statistics ===');

    const browserAgent = new BrowserAgent();
    const scraper = new WikipediaScraper(browserAgent);

    try {
        const page = await browserAgent.startSession('demo_stats');
        const article = await scraper.scrapeArticle(page, 'History');

        // Get all text content
        const fullText = article.content.paragraphs.join(' ');

        // Calculate statistics
        const stats = ScraperUtils.getTextStats(fullText);
        const scraperStats = scraper.getStats();

        console.log(`✓ Article: ${article.title}`);
        console.log('\n📊 Text Statistics:');
        console.log(`   Word Count: ${stats.wordCount}`);
        console.log(`   Sentence Count: ${stats.sentenceCount}`);
        console.log(`   Paragraph Count: ${stats.paragraphCount}`);
        console.log(`   Average Word Length: ${stats.averageWordLength.toFixed(2)} chars`);
        console.log(`   Unique Words: ${stats.uniqueWords}`);
        console.log(`   Reading Time: ~${stats.readingTimeMinutes} minutes`);
        console.log(`   Estimated Lecture Time: ~${stats.lectureTimeMinutes} minutes`);

        console.log('\n📈 Scraper Statistics:');
        console.log(`   Total Pages: ${scraperStats.totalPages}`);
        console.log(`   Successful Scrapes: ${scraperStats.successfulScrapes}`);
        console.log(`   Failed Scrapes: ${scraperStats.failedScrapes}`);
        console.log(`   Total Images: ${scraperStats.totalImages}`);
    } catch (error) {
        console.error('✗ Demo failed:', error.message);
    }
}

/**
 * DEMO 7: Related Articles
 */
async function demoRelatedArticles() {
    console.log('\n=== DEMO 7: Related Articles ===');

    const browserAgent = new BrowserAgent();
    const scraper = new WikipediaScraper(browserAgent);

    try {
        const page = await browserAgent.startSession('demo_related');

        console.log('🔗 Finding related articles for "Climate Change"...');
        const related = await scraper.getRelatedArticles(page, 'Climate Change');

        if (related && related.length > 0) {
            console.log(`✓ Found ${related.length} related articles:`);
            related.slice(0, 10).forEach((article, i) => {
                console.log(`   ${i + 1}. ${article}`);
            });
        }
    } catch (error) {
        console.error('✗ Demo failed:', error.message);
    }
}

/**
 * DEMO 8: Data Export
 */
async function demoDataExport() {
    console.log('\n=== DEMO 8: Data Export ===');

    const browserAgent = new BrowserAgent();
    const scraper = new WikipediaScraper(browserAgent);

    try {
        const page = await browserAgent.startSession('demo_export');
        const article = await scraper.scrapeArticle(page, 'Data Science');

        // Prepare data for export
        const exportData = {
            title: article.title,
            contentLength: article.content.totalLength,
            sections: article.content.sections.length,
            images: article.images.length,
            references: article.references.length,
            categories: article.categories.length,
            links: article.links.length,
            scraped_at: new Date().toISOString()
        };

        // Save as JSON
        const jsonPath = './exports/article_export.json';
        await ScraperUtils.saveJSON(jsonPath, [exportData]);
        console.log(`✓ Saved to: ${jsonPath}`);

        // Save as CSV
        const csvPath = './exports/article_export.csv';
        await ScraperUtils.saveCSV(csvPath, [exportData], Object.keys(exportData));
        console.log(`✓ Saved to: ${csvPath}`);

        console.log('\n📊 Export Data:');
        Object.entries(exportData).forEach(([key, value]) => {
            console.log(`   ${key}: ${value}`);
        });
    } catch (error) {
        console.error('✗ Demo failed:', error.message);
    }
}

/**
 * Run all demos
 */
async function runAllDemos() {
    console.log('🚀 Starting Scraping System Demos...\n');

    try {
        await demoSimpleArticleScrape();
        await demoArticleWithImages();
        await demoSearchAndScrape();
        await demoBatchScraping();
        await demoExtractMetadata();
        await demoTextStatistics();
        await demoRelatedArticles();
        await demoDataExport();

        console.log('\n✅ All demos completed!\n');
    } catch (error) {
        console.error('\n❌ Demo suite failed:', error);
    }
}

/**
 * Run individual demo
 */
async function runDemo(demoName) {
    const demos = {
        simple: demoSimpleArticleScrape,
        images: demoArticleWithImages,
        search: demoSearchAndScrape,
        batch: demoBatchScraping,
        metadata: demoExtractMetadata,
        stats: demoTextStatistics,
        related: demoRelatedArticles,
        export: demoDataExport
    };

    const demo = demos[demoName];
    if (!demo) {
        console.error(`Unknown demo: ${demoName}`);
        console.log('Available demos:', Object.keys(demos).join(', '));
        return;
    }

    try {
        await demo();
        console.log('\n✅ Demo completed!\n');
    } catch (error) {
        console.error('\n❌ Demo failed:', error);
    }
}

module.exports = {
    demoSimpleArticleScrape,
    demoArticleWithImages,
    demoSearchAndScrape,
    demoBatchScraping,
    demoExtractMetadata,
    demoTextStatistics,
    demoRelatedArticles,
    demoDataExport,
    runAllDemos,
    runDemo
};

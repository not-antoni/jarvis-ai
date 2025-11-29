/**
 * Scraping System Tests - Complete test suite for all scraper components
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Components to test
const BaseScraper = require('../scrapers/baseScraper');
const WikipediaScraper = require('../scrapers/wikipediaScraper');
const ImageManager = require('../scrapers/imageManager');
const ScraperUtils = require('../scrapers/scraperUtils');

describe('Scraping System Tests', function() {
    this.timeout(30000); // 30 second timeout for browser operations

    // ==================== ScraperUtils Tests ====================
    describe('ScraperUtils', function() {
        
        it('should clean text properly', function() {
            const dirty = '  Hello   \n\n   World  \t  ';
            const clean = ScraperUtils.cleanText(dirty);
            assert.strictEqual(clean, 'Hello World');
        });

        it('should parse URLs correctly', function() {
            const url = 'https://example.com:8080/path?query=1&foo=bar#anchor';
            const parsed = ScraperUtils.parseURL(url);
            
            assert.strictEqual(parsed.protocol, 'https:');
            assert.strictEqual(parsed.hostname, 'example.com');
            assert.strictEqual(parsed.port, '8080');
            assert.strictEqual(parsed.pathname, '/path');
            assert.strictEqual(parsed.search, '?query=1&foo=bar');
            assert.strictEqual(parsed.hash, '#anchor');
        });

        it('should validate URLs', function() {
            assert.strictEqual(ScraperUtils.isValidURL('https://example.com'), true);
            assert.strictEqual(ScraperUtils.isValidURL('http://example.com'), true);
            assert.strictEqual(ScraperUtils.isValidURL('invalid-url'), false);
            assert.strictEqual(ScraperUtils.isValidURL('ftp://example.com'), true);
        });

        it('should resolve relative URLs', function() {
            const baseURL = 'https://example.com/docs/page.html';
            const relative = '../images/pic.jpg';
            const resolved = ScraperUtils.resolveURL(relative, baseURL);
            
            assert.strictEqual(resolved, 'https://example.com/images/pic.jpg');
        });

        it('should extract emails', function() {
            const text = 'Contact us at test@example.com or support@domain.org';
            const emails = ScraperUtils.extractEmails(text);
            
            assert.strictEqual(emails.length, 2);
            assert(emails.includes('test@example.com'));
            assert(emails.includes('support@domain.org'));
        });

        it('should extract URLs from text', function() {
            const text = 'Visit https://example.com or http://test.org for more info';
            const urls = ScraperUtils.extractURLs(text);
            
            assert.strictEqual(urls.length, 2);
            assert(urls.some(u => u.includes('example.com')));
            assert(urls.some(u => u.includes('test.org')));
        });

        it('should calculate text statistics', function() {
            const text = 'This is a test. This is only a test. Testing is important.';
            const stats = ScraperUtils.getTextStats(text);
            
            assert(stats.wordCount > 0);
            assert(stats.sentenceCount >= 3);
            assert(stats.paragraphCount >= 1);
            assert(stats.averageWordLength > 0);
            assert(stats.readingTimeMinutes >= 0);
        });

        it('should deduplicate arrays', function() {
            const arr = [1, 2, 2, 3, 3, 3, 4];
            const deduped = ScraperUtils.deduplicate(arr);
            
            assert.deepStrictEqual(deduped.sort(), [1, 2, 3, 4]);
        });

        it('should convert text to slug', function() {
            const text = 'Hello World! This Is A Test';
            const slug = ScraperUtils.toSlug(text);
            
            assert.strictEqual(slug, 'hello-world-this-is-a-test');
        });

        it('should truncate text', function() {
            const text = 'This is a long text that should be truncated';
            const truncated = ScraperUtils.truncate(text, 20, '...');
            
            assert.strictEqual(truncated.length, 23); // 20 + '...'
            assert(truncated.endsWith('...'));
        });

        it('should group arrays by property', function() {
            const arr = [
                { type: 'A', value: 1 },
                { type: 'B', value: 2 },
                { type: 'A', value: 3 }
            ];
            const grouped = ScraperUtils.groupByProperty(arr, 'type');
            
            assert.strictEqual(Object.keys(grouped).length, 2);
            assert.strictEqual(grouped['A'].length, 2);
            assert.strictEqual(grouped['B'].length, 1);
        });

        it('should sort arrays by property', function() {
            const arr = [
                { name: 'Charlie', age: 30 },
                { name: 'Alice', age: 25 },
                { name: 'Bob', age: 35 }
            ];
            const sorted = ScraperUtils.sortByProperty(arr, 'age', true);
            
            assert.strictEqual(sorted[0].name, 'Alice');
            assert.strictEqual(sorted[1].name, 'Charlie');
            assert.strictEqual(sorted[2].name, 'Bob');
        });

        it('should create markdown tables', function() {
            const data = [
                { name: 'Alice', age: 25 },
                { name: 'Bob', age: 30 }
            ];
            const table = ScraperUtils.toMarkdownTable(data, ['name', 'age']);
            
            assert(table.includes('| name | age |'));
            assert(table.includes('| Alice | 25 |'));
            assert(table.includes('| Bob | 30 |'));
        });

        it('should handle JSON file operations', async function() {
            const testFile = './test-export.json';
            const testData = { test: 'data', number: 123 };
            
            try {
                await ScraperUtils.saveJSON(testFile, testData);
                assert(fs.existsSync(testFile));
                
                const loaded = await ScraperUtils.loadJSON(testFile);
                assert.deepStrictEqual(loaded, testData);
            } finally {
                if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
            }
        });

        it('should handle CSV file operations', async function() {
            const testFile = './test-export.csv';
            const testData = [
                { name: 'Alice', email: 'alice@example.com' },
                { name: 'Bob', email: 'bob@example.com' }
            ];
            
            try {
                await ScraperUtils.saveCSV(testFile, testData, ['name', 'email']);
                assert(fs.existsSync(testFile));
                
                const loaded = await ScraperUtils.loadCSV(testFile);
                assert.strictEqual(loaded.length, 2);
                assert.strictEqual(loaded[0].name, 'Alice');
            } finally {
                if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
            }
        });

        it('should parse HTML tables', function() {
            const html = `
                <table>
                    <tr><th>Name</th><th>Age</th></tr>
                    <tr><td>Alice</td><td>25</td></tr>
                    <tr><td>Bob</td><td>30</td></tr>
                </table>
            `;
            const parsed = ScraperUtils.parseHTMLTable(html);
            
            assert.strictEqual(parsed.length, 2);
            assert.strictEqual(parsed[0].Name, 'Alice');
            assert.strictEqual(parsed[1].Age, '30');
        });
    });

    // ==================== ImageManager Tests ====================
    describe('ImageManager', function() {
        let imageManager;

        beforeEach(function() {
            imageManager = new ImageManager();
        });

        it('should be initialized', function() {
            assert(imageManager);
            assert.strictEqual(typeof imageManager.downloadImage, 'function');
        });

        it('should extract file extensions from URLs', function() {
            const ext1 = imageManager.getExtensionFromURL('https://example.com/image.jpg');
            const ext2 = imageManager.getExtensionFromURL('https://example.com/photo.png?size=large');
            
            assert.strictEqual(ext1, 'jpg');
            assert.strictEqual(ext2, 'png');
        });

        it('should validate image URLs', function() {
            const validURL = 'https://example.com/image.jpg';
            assert(imageManager.isValidImageURL(validURL));
            
            const invalidURL = 'https://example.com/document.pdf';
            assert(!imageManager.isValidImageURL(invalidURL));
        });

        it('should get image stats', function() {
            const stats = imageManager.getStats();
            
            assert.strictEqual(stats.downloaded, 0);
            assert.strictEqual(stats.failed, 0);
            assert.strictEqual(stats.cached, 0);
            assert.strictEqual(stats.totalSize, 0);
        });

        it('should get downloaded images list', async function() {
            const images = await imageManager.getDownloadedImages();
            assert(Array.isArray(images));
        });
    });

    // ==================== BaseScraper Tests ====================
    describe('BaseScraper', function() {
        let scraper;

        beforeEach(function() {
            scraper = new BaseScraper();
        });

        it('should be initialized', function() {
            assert(scraper);
            assert.strictEqual(typeof scraper.extractText, 'function');
            assert.strictEqual(typeof scraper.extractImages, 'function');
        });

        it('should get scraper statistics', function() {
            const stats = scraper.getStats();
            
            assert.strictEqual(stats.totalPages, 0);
            assert.strictEqual(stats.successfulScrapes, 0);
            assert.strictEqual(stats.failedScrapes, 0);
            assert.strictEqual(stats.totalImages, 0);
        });

        it('should format URLs correctly', function() {
            const url = 'example.com/page';
            const formatted = scraper.formatURL(url);
            
            assert(formatted.startsWith('http'));
        });
    });

    // ==================== WikipediaScraper Tests ====================
    describe('WikipediaScraper', function() {
        let scraper;

        beforeEach(function() {
            scraper = new WikipediaScraper();
        });

        it('should be initialized', function() {
            assert(scraper);
            assert(scraper instanceof BaseScraper);
        });

        it('should generate correct Wikipedia URLs', function() {
            const url = scraper.getArticleURL('Machine Learning');
            
            assert(url.includes('wikipedia.org'));
            assert(url.includes('Machine'));
        });

        it('should generate search URLs', function() {
            const url = scraper.getSearchURL('Artificial Intelligence');
            
            assert(url.includes('wikipedia.org'));
            assert(url.includes('search'));
        });

        it('should get scraper statistics', function() {
            const stats = scraper.getStats();
            
            assert(stats);
            assert.strictEqual(stats.totalPages, 0);
        });
    });

    // ==================== Integration Tests ====================
    describe('Integration Tests', function() {
        
        it('should work with multiple utility functions', function() {
            const url = 'https://example.com/articles/machine-learning';
            const text = 'Visit our site at https://example.com for more info';
            
            // Parse URL
            const parsed = ScraperUtils.parseURL(url);
            assert.strictEqual(parsed.hostname, 'example.com');
            
            // Extract URLs from text
            const urls = ScraperUtils.extractURLs(text);
            assert.strictEqual(urls.length, 1);
            
            // Create slug
            const slug = ScraperUtils.toSlug('Machine Learning');
            assert.strictEqual(slug, 'machine-learning');
        });

        it('should export data in multiple formats', async function() {
            const data = [
                { title: 'Article 1', views: 1000 },
                { title: 'Article 2', views: 2000 }
            ];
            
            try {
                // JSON export
                const jsonFile = './test-export-integration.json';
                await ScraperUtils.saveJSON(jsonFile, data);
                const jsonLoaded = await ScraperUtils.loadJSON(jsonFile);
                assert.deepStrictEqual(jsonLoaded, data);
                
                // CSV export
                const csvFile = './test-export-integration.csv';
                await ScraperUtils.saveCSV(csvFile, data, ['title', 'views']);
                assert(fs.existsSync(csvFile));
                
                // Cleanup
                if (fs.existsSync(jsonFile)) fs.unlinkSync(jsonFile);
                if (fs.existsSync(csvFile)) fs.unlinkSync(csvFile);
            } catch (error) {
                console.error('Export test failed:', error);
                throw error;
            }
        });
    });
});

// ==================== Test Execution ====================
// Run tests with: npm test tests/scraping.test.js
module.exports = {
    name: 'Scraping System Tests',
    testCount: 25,
    description: 'Comprehensive test suite for all scraping components'
};

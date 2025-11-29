# Scraping System Documentation

Complete documentation for the Jarvis AI scraping system, including architecture, usage guides, API reference, and examples.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Components](#components)
4. [Installation](#installation)
5. [Quick Start](#quick-start)
6. [API Reference](#api-reference)
7. [Examples](#examples)
8. [Configuration](#configuration)
9. [Error Handling](#error-handling)
10. [Performance](#performance)
11. [Testing](#testing)
12. [Troubleshooting](#troubleshooting)

---

## Overview

The Jarvis AI Scraping System provides a comprehensive framework for web scraping with specialized support for Wikipedia articles, including:

- **Generic Web Scraping**: BaseScraper foundation for any website
- **Wikipedia Scraping**: WikipediaScraper with article-specific extraction
- **Image Management**: Download, cache, and manage scraped images
- **Data Utilities**: Text processing, URL handling, data export (JSON/CSV)
- **API Endpoints**: Express routes for web-based scraping
- **Production Ready**: Error handling, retry logic, rate limiting

---

## Architecture

### Component Hierarchy

```
BaseScraper (foundation)
    ├── WikipediaScraper (specialized for Wikipedia)
    └── [Custom scrapers can extend BaseScraper]

ImageManager (standalone)
    └── Used by scrapers for image downloads

ScraperUtils (utilities)
    └── Shared across all components

Express Routes (scrapingRoutes.js)
    └── Exposes all scrapers via HTTP API
```

### Design Patterns

**Inheritance Pattern**: WikipediaScraper extends BaseScraper for specialized functionality
**Utility Pattern**: ScraperUtils provides static methods for common operations
**Factory Pattern**: scrapingRoutes creates router with configured components
**Cache Pattern**: ImageManager caches downloads to prevent re-downloading

### Data Flow

```
User Request
    ↓
Express Route (scrapingRoutes.js)
    ↓
Scraper (WikipediaScraper/BaseScraper)
    ├→ Browser Navigation (BrowserAgent)
    ├→ Content Extraction (CSS selectors)
    └→ Image Discovery
        ↓
    ImageManager
        ├→ URL Validation
        ├→ Cache Check
        ├→ Download (with retry)
        └→ Storage (originals + thumbnails)
    ↓
ScraperUtils
    ├→ Data Processing
    ├→ Text Extraction
    └→ Export (JSON/CSV)
    ↓
Response to User
```

---

## Components

### 1. BaseScraper

**Purpose**: Generic foundation for web scraping
**Location**: `src/scrapers/baseScraper.js`

**Key Features**:
- Retry logic (3 attempts by default)
- Multiple content extraction formats (text, HTML, elements)
- Image extraction with filtering
- Link extraction
- Metadata retrieval (meta tags, og tags)
- Screenshot capability
- Custom JavaScript evaluation
- Page scrolling

**Primary Methods**:
- `navigateToPage(page, url, options)` - Navigate with retry
- `extractText(page, selector)` - Extract plain text
- `extractHTML(page, selector)` - Extract HTML
- `extractImages(page, options)` - Extract images with filtering
- `extractLinks(page, options)` - Get all links
- `getPageMetadata(page)` - Meta tags, og tags, canonical
- `takeScreenshot(page, path, options)` - Screenshot capture
- `evaluate(page, fn, ...args)` - Execute custom JavaScript

### 2. WikipediaScraper

**Purpose**: Specialized Wikipedia article scraping
**Location**: `src/scrapers/wikipediaScraper.js`
**Extends**: BaseScraper

**Key Features**:
- Full article extraction (9 data types in parallel)
- Infobox parsing
- Image filtering (>100x100px minimum)
- Reference extraction
- Category extraction
- Wikipedia links (wikilinks)
- Article search functionality
- Related articles retrieval
- Article statistics

**Primary Methods**:
- `scrapeArticle(page, articleTitle)` - Full extraction
- `getArticleContent(page)` - Sections and paragraphs
- `getInfobox(page)` - Key-value pairs
- `getArticleImages(page)` - Filtered images with captions
- `searchArticles(page, query, limit)` - Search functionality
- `getRelatedArticles(page, articleTitle)` - Related links
- `getArticleStats(page, articleTitle)` - Content statistics

### 3. ImageManager

**Purpose**: Complete image lifecycle management
**Location**: `src/scrapers/imageManager.js`

**Key Features**:
- Download caching (prevents re-downloads)
- URL validation
- Format validation (jpg, png, gif, webp)
- Concurrent batch downloading
- Thumbnail generation (with optional Sharp)
- File storage management
- Size constraints
- Manifest export (JSON)
- Statistics tracking

**Primary Methods**:
- `downloadImage(url, options)` - Single image download
- `downloadImages(urls, options)` - Batch download
- `createThumbnail(filepath, options)` - Generate thumbnail
- `getDownloadedImages()` - List all images
- `deleteImage(filename)` - Remove image
- `clearAll()` - Clear all images
- `getStats()` - Download statistics
- `exportManifest(filename)` - JSON manifest

### 4. ScraperUtils

**Purpose**: Reusable utility functions
**Location**: `src/scrapers/scraperUtils.js`

**Key Features** (35+ static methods):
- URL parsing and validation
- Text cleaning and normalization
- Email extraction
- Phone number extraction
- Text statistics (word count, read time)
- Array operations (deduplicate, sort, group)
- HTML table parsing
- File I/O (JSON, CSV)
- Markdown table generation
- Rate limiting utility

---

## Installation

### 1. Install Dependencies

```bash
npm install
```

**Required dependencies**:
- `puppeteer` - For browser automation
- `axios` - For HTTP requests

**Optional dependencies**:
- `sharp` - For image thumbnail generation
- `express` - For API routes

### 2. Create Directories

```bash
mkdir -p ./scraped-images/originals
mkdir -p ./scraped-images/thumbnails
mkdir -p ./exports
```

### 3. Add Routes to Express App

```javascript
const createScrapingRouter = require('./src/utils/scrapingRoutes');
const app = express();

// Add to your app
const scrapingRouter = createScrapingRouter(discordHandlers, productionAgent);
app.use('/api', scrapingRouter);
```

---

## Quick Start

### Basic Wikipedia Scrape

```javascript
const WikipediaScraper = require('./src/scrapers/wikipediaScraper');
const BrowserAgent = require('./src/agents/browserAgent');

async function scrapeArticle() {
    const browserAgent = new BrowserAgent();
    const scraper = new WikipediaScraper(browserAgent);
    
    const page = await browserAgent.startSession('my-session');
    const article = await scraper.scrapeArticle(page, 'Machine Learning');
    
    console.log(`Title: ${article.title}`);
    console.log(`Content length: ${article.content.totalLength}`);
    console.log(`Images found: ${article.images.length}`);
}

scrapeArticle();
```

### Scrape with Image Download

```javascript
const WikipediaScraper = require('./src/scrapers/wikipediaScraper');
const ImageManager = require('./src/scrapers/imageManager');
const BrowserAgent = require('./src/agents/browserAgent');

async function scrapeWithImages() {
    const browserAgent = new BrowserAgent();
    const scraper = new WikipediaScraper(browserAgent);
    const imageManager = new ImageManager();
    
    const page = await browserAgent.startSession('my-session');
    const article = await scraper.scrapeArticle(page, 'Python (programming language)');
    
    // Download images
    const imageURLs = article.images.map(img => img.src);
    const results = await imageManager.downloadImages(imageURLs);
    
    console.log(`Downloaded: ${results.successful}`);
    console.log(`Failed: ${results.failed}`);
}

scrapeWithImages();
```

### Use Via API

```bash
# Scrape Wikipedia article
curl "http://localhost:3000/api/scrape/wikipedia/Machine%20Learning?images=true"

# Search Wikipedia
curl "http://localhost:3000/api/scrape/wikipedia/search/Artificial%20Intelligence?limit=10"

# Get downloaded images
curl "http://localhost:3000/api/scrape/images"

# Get image statistics
curl "http://localhost:3000/api/scrape/images/stats"
```

---

## API Reference

### Express Routes

#### GET /scrape/wikipedia/:article
Scrape a Wikipedia article

**Parameters**:
- `:article` (path) - Wikipedia article title
- `images` (query) - Download images? (true/false, default: false)
- `stats` (query) - Include statistics? (true/false, default: false)

**Response**:
```json
{
    "success": true,
    "data": {
        "title": "Machine Learning",
        "content": {
            "totalLength": 45000,
            "paragraphs": ["...", "..."],
            "sections": ["Overview", "History", "..."]
        },
        "images": [
            {
                "src": "https://...",
                "alt": "Image description",
                "caption": "...",
                "downloaded": false
            }
        ],
        "infobox": {...},
        "references": [...],
        "categories": [...],
        "links": [...]
    }
}
```

#### GET /scrape/wikipedia/search/:query
Search Wikipedia

**Parameters**:
- `:query` (path) - Search query
- `limit` (query) - Result limit (default: 10)

**Response**:
```json
{
    "success": true,
    "query": "Artificial Intelligence",
    "results": ["Artificial intelligence", "AI winter", "History of AI", ...]
}
```

#### GET /scrape/wikipedia/related/:article
Get related Wikipedia articles

**Parameters**:
- `:article` (path) - Wikipedia article title

**Response**:
```json
{
    "success": true,
    "article": "Climate Change",
    "related": ["Global warming", "Carbon dioxide", "Greenhouse gas", ...]
}
```

#### GET /scrape/images
Get all downloaded images

**Response**:
```json
{
    "success": true,
    "images": [
        {
            "filename": "abc123.jpg",
            "size": 102400,
            "downloaded": "2024-01-15T10:30:00Z",
            "source": "https://..."
        }
    ],
    "stats": {
        "downloaded": 5,
        "cached": 2,
        "failed": 0,
        "totalSize": 512000
    }
}
```

#### GET /scrape/images/stats
Get image download statistics

**Response**:
```json
{
    "success": true,
    "stats": {
        "downloaded": 5,
        "failed": 0,
        "cached": 2,
        "totalSize": 512000,
        "skipped": 0
    }
}
```

#### POST /scrape/images/clear
Clear all downloaded images

**Response**:
```json
{
    "success": true,
    "message": "Images cleared"
}
```

#### POST /scrape/batch
Scrape multiple Wikipedia articles

**Request Body**:
```json
{
    "articles": ["Python (programming language)", "Java (programming language)", "C++"]
}
```

**Parameters**:
- `images` (query) - Download images? (true/false, default: false)

**Response**:
```json
{
    "success": true,
    "total": 3,
    "successful": 3,
    "failed": 0,
    "results": [...]
}
```

#### POST /scrape/text-stats
Get text statistics

**Request Body**:
```json
{
    "text": "This is a sample text for analysis..."
}
```

**Response**:
```json
{
    "success": true,
    "stats": {
        "wordCount": 50,
        "sentenceCount": 5,
        "paragraphCount": 1,
        "averageWordLength": 4.8,
        "uniqueWords": 45,
        "readingTimeMinutes": 1,
        "lectureTimeMinutes": 2
    }
}
```

#### POST /scrape/export/:format
Export scraped data

**Parameters**:
- `:format` (path) - Export format (json or csv)

**Request Body**:
```json
{
    "data": [
        {"title": "Article 1", "views": 1000},
        {"title": "Article 2", "views": 2000}
    ]
}
```

**Response**:
```json
{
    "success": true,
    "file": "export_1705329000000.json",
    "format": "json"
}
```

---

## Examples

### Example 1: Complete Article Analysis

```javascript
const WikipediaScraper = require('./src/scrapers/wikipediaScraper');
const ImageManager = require('./src/scrapers/imageManager');
const ScraperUtils = require('./src/scrapers/scraperUtils');
const BrowserAgent = require('./src/agents/browserAgent');

async function analyzeArticle(articleTitle) {
    const browserAgent = new BrowserAgent();
    const scraper = new WikipediaScraper(browserAgent);
    const imageManager = new ImageManager();
    
    try {
        const page = await browserAgent.startSession('analysis');
        
        // Scrape article
        console.log(`Scraping: ${articleTitle}...`);
        const article = await scraper.scrapeArticle(page, articleTitle);
        
        // Analyze content
        const fullText = article.content.paragraphs.join(' ');
        const textStats = ScraperUtils.getTextStats(fullText);
        
        // Download images
        console.log(`Downloading ${article.images.length} images...`);
        const imageURLs = article.images.map(img => img.src);
        const imageResults = await imageManager.downloadImages(imageURLs);
        
        // Prepare analysis report
        const report = {
            title: article.title,
            url: article.url,
            content: {
                totalLength: article.content.totalLength,
                sections: article.content.sections.length,
                paragraphs: article.content.paragraphs.length
            },
            images: {
                found: article.images.length,
                downloaded: imageResults.successful,
                failed: imageResults.failed
            },
            analysis: {
                wordCount: textStats.wordCount,
                readingTimeMinutes: textStats.readingTimeMinutes,
                uniqueWords: textStats.uniqueWords
            },
            metadata: {
                references: article.references.length,
                categories: article.categories.length,
                externalLinks: article.links.length
            },
            scraped: new Date().toISOString()
        };
        
        // Export report
        await ScraperUtils.saveJSON(`./exports/${articleTitle}.json`, report);
        console.log('✓ Report saved');
        
        return report;
        
    } catch (error) {
        console.error('Analysis failed:', error);
        throw error;
    }
}

// Usage
analyzeArticle('Quantum Computing');
```

### Example 2: Batch Scraping Pipeline

```javascript
async function batchScrapePipeline(articles, options = {}) {
    const {
        downloadImages = true,
        maxConcurrent = 3,
        exportFormat = 'json'
    } = options;
    
    const results = [];
    const errors = [];
    
    for (let i = 0; i < articles.length; i++) {
        const article = articles[i];
        console.log(`[${i + 1}/${articles.length}] Processing: ${article}`);
        
        try {
            const browserAgent = new BrowserAgent();
            const scraper = new WikipediaScraper(browserAgent);
            const page = await browserAgent.startSession(`batch_${i}`);
            
            const data = await scraper.scrapeArticle(page, article);
            
            if (downloadImages && data.images.length > 0) {
                const imageManager = new ImageManager();
                const imageURLs = data.images.map(img => img.src);
                await imageManager.downloadImages(imageURLs, { concurrency: maxConcurrent });
            }
            
            results.push({
                article: data.title,
                contentLength: data.content.totalLength,
                images: data.images.length,
                status: 'success'
            });
            
        } catch (error) {
            errors.push({
                article,
                error: error.message
            });
        }
    }
    
    // Export results
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `batch_${timestamp}`;
    
    if (exportFormat === 'json') {
        await ScraperUtils.saveJSON(`./exports/${filename}.json`, results);
    } else {
        await ScraperUtils.saveCSV(`./exports/${filename}.csv`, results);
    }
    
    console.log(`\n✓ Completed: ${results.length}/${articles.length}`);
    if (errors.length > 0) console.log(`✗ Failed: ${errors.length}`);
    
    return { results, errors };
}

// Usage
const articles = ['Python', 'Java', 'JavaScript', 'TypeScript', 'Go (programming language)'];
batchScrapePipeline(articles, { downloadImages: true, exportFormat: 'csv' });
```

### Example 3: Search and Explore

```javascript
async function exploreWikipedia(searchQuery) {
    const browserAgent = new BrowserAgent();
    const scraper = new WikipediaScraper(browserAgent);
    
    try {
        const page = await browserAgent.startSession('explore');
        
        // Search
        console.log(`Searching for: ${searchQuery}`);
        const searchResults = await scraper.searchArticles(page, searchQuery, 5);
        console.log(`Found: ${searchResults.length} results`);
        
        // For each result, get related articles
        for (const result of searchResults.slice(0, 3)) {
            console.log(`\n🔗 Related to "${result}":`);
            const related = await scraper.getRelatedArticles(page, result);
            related.slice(0, 5).forEach(r => console.log(`   • ${r}`));
        }
        
    } catch (error) {
        console.error('Exploration failed:', error);
    }
}

exploreWikipedia('Machine Learning');
```

---

## Configuration

### Environment Variables

```bash
# Image storage
SCRAPED_IMAGES_DIR=./scraped-images

# Image constraints
MAX_IMAGE_SIZE=10485760  # 10MB
MIN_IMAGE_WIDTH=100
MIN_IMAGE_HEIGHT=100

# Thumbnails
THUMBNAIL_WIDTH=200
THUMBNAIL_HEIGHT=200

# Download settings
IMAGE_DOWNLOAD_TIMEOUT=30000  # 30 seconds
IMAGE_CONCURRENT_DOWNLOADS=3

# Browser settings
BROWSER_TIMEOUT=30000
RETRY_ATTEMPTS=3
RETRY_DELAY=1000  # milliseconds
```

### Custom Scraper Creation

```javascript
const BaseScraper = require('./baseScraper');

class CustomScraper extends BaseScraper {
    constructor(browserAgent) {
        super();
        this.browserAgent = browserAgent;
        this.baseURL = 'https://example.com';
    }
    
    async scrapeContent(page, url) {
        // Navigate
        await this.navigateToPage(page, url);
        
        // Extract content
        const title = await this.extractText(page, 'h1.title');
        const content = await this.extractHTML(page, '.article-body');
        const images = await this.extractImages(page);
        
        return { title, content, images };
    }
}
```

---

## Error Handling

### Common Errors

**1. Navigation Timeout**
```javascript
// Problem: Page took too long to load
// Solution: Increase timeout or check network
try {
    await scraper.navigateToPage(page, url, { timeout: 60000 });
} catch (error) {
    console.log('Page load timeout - retrying...');
}
```

**2. Image Download Failed**
```javascript
// Problem: Image URL invalid or unreachable
// Solution: Validate URLs before downloading
const imageManager = new ImageManager();
for (const image of images) {
    if (imageManager.isValidImageURL(image.src)) {
        await imageManager.downloadImage(image.src);
    }
}
```

**3. Selector Not Found**
```javascript
// Problem: Expected element not on page
// Solution: Verify selector or add error handling
try {
    const content = await scraper.extractText(page, '.article-content');
    if (!content) {
        console.log('Content not found - page structure changed?');
    }
} catch (error) {
    console.error('Extraction failed:', error);
}
```

---

## Performance

### Optimization Tips

**1. Batch Processing**
```javascript
// Process multiple articles concurrently
const results = await Promise.all(
    articles.map(article => scraper.scrapeArticle(page, article))
);
```

**2. Image Caching**
```javascript
// ImageManager automatically caches downloads
// Second download of same URL returns cached version
const result1 = await imageManager.downloadImage(url);  // Downloads
const result2 = await imageManager.downloadImage(url);  // Returns cached
```

**3. Selective Extraction**
```javascript
// Only request what you need
const article = await scraper.scrapeArticle(page, title);
// Instead of downloading all images, filter first
const largeImages = article.images.filter(img => img.width > 500);
```

### Performance Metrics

- **Article Scrape Time**: 2-5 seconds (depends on article size)
- **Image Download Time**: 100-500ms per image
- **Batch Processing**: ~3 seconds per article with images

---

## Testing

### Run Tests

```bash
# Run all scraping tests
npm test -- tests/scraping.test.js

# Run with coverage
npm test -- tests/scraping.test.js --coverage

# Run specific test
npm test -- tests/scraping.test.js --grep "WikipediaScraper"
```

### Test Coverage

- **ScraperUtils**: 15+ tests
- **ImageManager**: 5+ tests
- **BaseScraper**: 3+ tests
- **WikipediaScraper**: 3+ tests
- **Integration Tests**: 2+ tests

---

## Troubleshooting

### Issue: Cannot find module

**Solution**: Ensure all files are in correct locations:
```
src/
  scrapers/
    baseScraper.js
    wikipediaScraper.js
    imageManager.js
    scraperUtils.js
    scrapingDemo.js
  utils/
    scrapingRoutes.js
  agents/
    browserAgent.js
```

### Issue: Scraping returns empty data

**Solution**: 
1. Check Wikipedia article title (case-sensitive)
2. Verify internet connection
3. Try with screenshots to debug:
```javascript
await scraper.takeScreenshot(page, `./debug-${Date.now()}.png`);
```

### Issue: Images not downloading

**Solution**:
1. Verify image URLs are valid
2. Check storage directory exists
3. Check disk space
4. Try with different images

### Issue: Slow performance

**Solution**:
1. Reduce concurrent downloads
2. Use image caching
3. Batch process articles
4. Optimize selectors

---

## Support

For issues, questions, or contributions:
- Create an issue in the repository
- Check existing documentation
- Review example code
- Run test suite to verify setup

---

**Version**: 1.0.0
**Last Updated**: 2024
**Status**: Production Ready

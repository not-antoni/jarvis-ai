/**
 * Wikipedia Scraper - Specialized scraper for Wikipedia articles
 * Extracts article content, metadata, infoboxes, images, and references
 */

const BaseScraper = require('./baseScraper');

class WikipediaScraper extends BaseScraper {
    constructor(browserAgent, options = {}) {
        super(browserAgent, options);
        this.baseURL = 'https://en.wikipedia.org';
        this.options = {
            ...this.options,
            language: options.language || 'en',
            ...options
        };
    }

    /**
     * Get Wikipedia URL for article
     */
    getArticleURL(title) {
        return `${this.baseURL}/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
    }

    /**
     * Scrape full Wikipedia article
     */
    async scrapeArticle(page, articleTitle) {
        console.log(`[WikipediaScraper] Scraping article: ${articleTitle}`);
        const url = this.getArticleURL(articleTitle);

        try {
            // Navigate to article
            await this.navigateToPage(page, url);

            // Wait for content to load
            await page.waitForSelector('#mw-content-text', { timeout: this.options.timeout });

            // Extract all data in parallel
            const [
                metadata,
                title,
                content,
                infobox,
                images,
                references,
                links,
                categories,
                wikilinks
            ] = await Promise.all([
                this.getArticleMetadata(page),
                this.getArticleTitle(page),
                this.getArticleContent(page),
                this.getInfobox(page),
                this.getArticleImages(page),
                this.getReferences(page),
                this.getArticleLinks(page),
                this.getCategories(page),
                this.getWikilinks(page)
            ]);

            const article = {
                title,
                url,
                metadata,
                content,
                infobox,
                images,
                references,
                links,
                categories,
                wikilinks,
                scrapedAt: new Date().toISOString()
            };

            this.stats.successfulScapes++;
            return article;

        } catch (error) {
            console.error(`[WikipediaScraper] Failed to scrape article:`, error.message);
            this.stats.failedScrapes++;
            this.stats.totalErrors.push({ article: articleTitle, error: error.message });
            throw error;
        }
    }

    /**
     * Get article title
     */
    async getArticleTitle(page) {
        try {
            const title = await page.$eval('.mw-page-title-main', el => el.innerText);
            return title;
        } catch (error) {
            return await this.extractAttribute(page, 'meta[property="og:title"]', 'content');
        }
    }

    /**
     * Get article metadata
     */
    async getArticleMetadata(page) {
        return await this.getPageMetadata(page);
    }

    /**
     * Get main article content (without infobox, etc)
     */
    async getArticleContent(page) {
        try {
            // Get all paragraphs
            const paragraphs = await page.$$eval(
                '#mw-content-text > .mw-parser-output > p',
                ps => ps.map(p => p.innerText.trim()).filter(p => p.length > 0)
            );

            // Get all headings and sections
            const sections = await page.$$eval(
                '#mw-content-text .mw-parser-output',
                el => {
                    const sections = [];
                    let currentSection = null;

                    Array.from(el.children).forEach(child => {
                        if (child.tagName.match(/^H[2-6]$/)) {
                            if (currentSection) sections.push(currentSection);
                            currentSection = {
                                heading: child.innerText,
                                content: []
                            };
                        } else if (currentSection && child.tagName === 'P') {
                            currentSection.content.push(child.innerText);
                        }
                    });

                    if (currentSection) sections.push(currentSection);
                    return sections;
                }
            );

            return {
                paragraphs,
                sections,
                totalLength: paragraphs.join(' ').length
            };
        } catch (error) {
            console.warn(`[WikipediaScraper] Failed to get article content:`, error.message);
            return { paragraphs: [], sections: [], totalLength: 0 };
        }
    }

    /**
     * Get infobox data
     */
    async getInfobox(page) {
        try {
            const infobox = await page.evaluate(() => {
                const infoboxEl = document.querySelector('.infobox');
                if (!infoboxEl) return null;

                const data = {};
                const rows = infoboxEl.querySelectorAll('tr');

                rows.forEach(row => {
                    const th = row.querySelector('th');
                    const td = row.querySelector('td');

                    if (th && td) {
                        const key = th.innerText.trim();
                        const value = td.innerText.trim();
                        data[key] = value;
                    }
                });

                return data;
            });

            return infobox;
        } catch (error) {
            console.warn(`[WikipediaScraper] Failed to get infobox:`, error.message);
            return null;
        }
    }

    /**
     * Get article images with detailed info
     */
    async getArticleImages(page) {
        try {
            const images = await page.$$eval(
                '#mw-content-text img',
                imgs => imgs
                    .filter(img => img.src && !img.src.includes('pixel'))
                    .map(img => ({
                        src: img.src,
                        alt: img.alt || '',
                        title: img.title || '',
                        width: img.width || 0,
                        height: img.height || 0,
                        naturalWidth: img.naturalWidth || 0,
                        naturalHeight: img.naturalHeight || 0,
                        // Get caption if it exists
                        caption: img.closest('figure')?.querySelector('figcaption')?.innerText || ''
                    }))
                    .filter(img => img.naturalWidth > 100 && img.naturalHeight > 100) // Only large images
            );

            console.log(`[WikipediaScraper] Found ${images.length} article images`);
            this.stats.totalImages += images.length;

            return images;
        } catch (error) {
            console.warn(`[WikipediaScraper] Failed to get images:`, error.message);
            return [];
        }
    }

    /**
     * Get references/citations
     */
    async getReferences(page) {
        try {
            const references = await page.$$eval(
                '.reference a',
                as => as.map(a => ({
                    text: a.innerText,
                    href: a.href || '',
                    title: a.title || ''
                }))
            );

            return references;
        } catch (error) {
            console.warn(`[WikipediaScraper] Failed to get references:`, error.message);
            return [];
        }
    }

    /**
     * Get external links
     */
    async getArticleLinks(page) {
        try {
            const links = await page.$$eval(
                '#mw-content-text a[href*="http"]',
                as => as.map(a => ({
                    href: a.href,
                    text: a.innerText,
                    title: a.title || ''
                }))
            );

            return links;
        } catch (error) {
            console.warn(`[WikipediaScraper] Failed to get links:`, error.message);
            return [];
        }
    }

    /**
     * Get Wikipedia categories
     */
    async getCategories(page) {
        try {
            const categories = await page.$$eval(
                '#mw-normal-catlinks ul li a',
                as => as.map(a => ({
                    name: a.innerText,
                    href: a.href
                }))
            );

            return categories;
        } catch (error) {
            console.warn(`[WikipediaScraper] Failed to get categories:`, error.message);
            return [];
        }
    }

    /**
     * Get internal Wikipedia links (wikilinks)
     */
    async getWikilinks(page) {
        try {
            const wikilinks = await page.$$eval(
                '#mw-content-text a.mw-link-target',
                as => as.map(a => ({
                    title: a.innerText,
                    href: a.href
                }))
            );

            return wikilinks;
        } catch (error) {
            console.warn(`[WikipediaScraper] Failed to get wikilinks:`, error.message);
            return [];
        }
    }

    /**
     * Search for Wikipedia articles
     */
    async searchArticles(page, query, limit = 10) {
        console.log(`[WikipediaScraper] Searching for: ${query}`);
        
        try {
            const searchURL = `${this.baseURL}/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=${limit}`;
            
            await this.navigateToPage(page, searchURL, { waitUntil: 'load' });

            const results = await page.evaluate(() => {
                const text = document.body.innerText;
                try {
                    const json = JSON.parse(text);
                    return json.query.search.map(r => ({
                        title: r.title,
                        snippet: r.snippet,
                        wordcount: r.wordcount,
                        timestamp: r.timestamp
                    }));
                } catch {
                    return [];
                }
            });

            return results;
        } catch (error) {
            console.error(`[WikipediaScraper] Search failed:`, error.message);
            return [];
        }
    }

    /**
     * Get article suggestions
     */
    async getRelatedArticles(page, articleTitle) {
        console.log(`[WikipediaScraper] Getting related articles for: ${articleTitle}`);
        
        try {
            const url = this.getArticleURL(articleTitle);
            await this.navigateToPage(page, url);

            // Get links in the first few paragraphs
            const relatedLinks = await page.$$eval(
                '#mw-content-text .mw-parser-output > p a.mw-link-target',
                as => as.slice(0, 10).map(a => ({
                    title: a.innerText,
                    href: a.href
                }))
            );

            return relatedLinks;
        } catch (error) {
            console.warn(`[WikipediaScraper] Failed to get related articles:`, error.message);
            return [];
        }
    }

    /**
     * Get article statistics
     */
    async getArticleStats(page, articleTitle) {
        try {
            const url = this.getArticleURL(articleTitle);
            await this.navigateToPage(page, url);

            const stats = await page.evaluate(() => {
                const contentEl = document.querySelector('#mw-content-text');
                if (!contentEl) return null;

                const paragraphs = contentEl.querySelectorAll('p').length;
                const headings = contentEl.querySelectorAll('h2, h3, h4').length;
                const links = contentEl.querySelectorAll('a[href*="/wiki/"]').length;
                const images = contentEl.querySelectorAll('img').length;
                const tables = contentEl.querySelectorAll('table').length;
                const text = contentEl.innerText;
                const words = text.split(/\s+/).length;
                const characters = text.length;

                return {
                    paragraphs,
                    headings,
                    links,
                    images,
                    tables,
                    words,
                    characters,
                    estimatedReadTime: Math.ceil(words / 200) // Assume 200 words per minute
                };
            });

            return stats;
        } catch (error) {
            console.warn(`[WikipediaScraper] Failed to get stats:`, error.message);
            return null;
        }
    }
}

module.exports = WikipediaScraper;

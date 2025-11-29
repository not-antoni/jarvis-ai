/**
 * Base Web Scraper - Foundation for all scraping operations
 * Handles page navigation, content extraction, retry logic, and error handling
 */

class BaseScraper {
    constructor(browserAgent, options = {}) {
        this.browserAgent = browserAgent;
        this.options = {
            timeout: options.timeout || 30000,
            waitUntil: options.waitUntil || 'networkidle2',
            retries: options.retries || 3,
            retryDelay: options.retryDelay || 1000,
            userAgent: options.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            ...options
        };
        
        this.stats = {
            totalPages: 0,
            successfulScapes: 0,
            failedScrapes: 0,
            totalImages: 0,
            totalErrors: []
        };
    }

    /**
     * Navigate to URL with retry logic
     */
    async navigateToPage(page, url, options = {}) {
        const finalOptions = { ...this.options, ...options };
        let lastError;

        for (let attempt = 1; attempt <= finalOptions.retries; attempt++) {
            try {
                const response = await page.goto(url, {
                    waitUntil: finalOptions.waitUntil,
                    timeout: finalOptions.timeout
                });

                if (!response) {
                    throw new Error('No response from page');
                }

                // Check for HTTP errors
                if (response.status() >= 400) {
                    throw new Error(`HTTP ${response.status()}`);
                }

                console.log(`[BaseScraper] Successfully navigated to ${url}`);
                this.stats.totalPages++;
                return response;

            } catch (error) {
                lastError = error;
                console.warn(`[BaseScraper] Navigation attempt ${attempt}/${finalOptions.retries} failed:`, error.message);

                if (attempt < finalOptions.retries) {
                    await new Promise(r => setTimeout(r, finalOptions.retryDelay * attempt));
                }
            }
        }

        this.stats.failedScrapes++;
        this.stats.totalErrors.push({ url, error: lastError.message });
        throw lastError;
    }

    /**
     * Extract text content from page
     */
    async extractText(page, selector = 'body') {
        try {
            const text = await page.$eval(selector, el => el.innerText);
            return text;
        } catch (error) {
            console.warn(`[BaseScraper] Failed to extract text from "${selector}":`, error.message);
            return null;
        }
    }

    /**
     * Extract HTML content from page
     */
    async extractHTML(page, selector = 'body') {
        try {
            const html = await page.$eval(selector, el => el.outerHTML);
            return html;
        } catch (error) {
            console.warn(`[BaseScraper] Failed to extract HTML from "${selector}":`, error.message);
            return null;
        }
    }

    /**
     * Extract all elements matching selector
     */
    async extractElements(page, selector) {
        try {
            const elements = await page.$$eval(selector, els =>
                els.map(el => ({
                    text: el.innerText,
                    html: el.outerHTML,
                    className: el.className,
                    id: el.id
                }))
            );
            return elements;
        } catch (error) {
            console.warn(`[BaseScraper] Failed to extract elements:`, error.message);
            return [];
        }
    }

    /**
     * Extract attribute from element
     */
    async extractAttribute(page, selector, attribute) {
        try {
            const value = await page.$eval(selector, (el, attr) => el.getAttribute(attr), attribute);
            return value;
        } catch (error) {
            return null;
        }
    }

    /**
     * Extract all images from page
     */
    async extractImages(page, options = {}) {
        try {
            const images = await page.$$eval('img', (imgs, opts) =>
                imgs
                    .filter(img => img.src && img.src.trim() !== '')
                    .map(img => ({
                        src: img.src,
                        alt: img.alt || '',
                        title: img.title || '',
                        width: img.width || 0,
                        height: img.height || 0,
                        naturalWidth: img.naturalWidth || 0,
                        naturalHeight: img.naturalHeight || 0,
                        className: img.className || '',
                        id: img.id || '',
                        isVisible: img.offsetParent !== null
                    }))
                    .filter(img => opts.visibleOnly ? img.isVisible : true)
                    .filter(img => opts.minWidth ? img.naturalWidth >= opts.minWidth : true)
                    .filter(img => opts.minHeight ? img.naturalHeight >= opts.minHeight : true),
                options
            );

            this.stats.totalImages += images.length;
            return images;
        } catch (error) {
            console.warn(`[BaseScraper] Failed to extract images:`, error.message);
            return [];
        }
    }

    /**
     * Extract links from page
     */
    async extractLinks(page, options = {}) {
        try {
            const links = await page.$$eval('a', (as, opts) =>
                as
                    .map(a => ({
                        href: a.href,
                        text: a.innerText.trim(),
                        title: a.title || '',
                        target: a.target || '_self'
                    }))
                    .filter(link => link.href && link.href.trim() !== '')
                    .filter(link => !opts.excludeExternal || link.href.includes(window.location.hostname)),
                options
            );

            return links;
        } catch (error) {
            console.warn(`[BaseScraper] Failed to extract links:`, error.message);
            return [];
        }
    }

    /**
     * Evaluate custom JavaScript on page
     */
    async evaluate(page, fn, ...args) {
        try {
            const result = await page.evaluate(fn, ...args);
            return result;
        } catch (error) {
            console.error(`[BaseScraper] Evaluation failed:`, error.message);
            throw error;
        }
    }

    /**
     * Wait for element and click
     */
    async clickElement(page, selector) {
        try {
            await page.waitForSelector(selector, { timeout: this.options.timeout });
            await page.click(selector);
            console.log(`[BaseScraper] Clicked element: ${selector}`);
            return true;
        } catch (error) {
            console.warn(`[BaseScraper] Failed to click element:`, error.message);
            return false;
        }
    }

    /**
     * Type text into input
     */
    async typeInInput(page, selector, text) {
        try {
            await page.waitForSelector(selector);
            await page.focus(selector);
            await page.keyboard.type(text, { delay: 50 });
            console.log(`[BaseScraper] Typed into ${selector}: ${text}`);
            return true;
        } catch (error) {
            console.warn(`[BaseScraper] Failed to type:`, error.message);
            return false;
        }
    }

    /**
     * Take screenshot
     */
    async takeScreenshot(page, path, options = {}) {
        try {
            await page.screenshot({
                path,
                type: options.type || 'png',
                fullPage: options.fullPage !== false,
                quality: options.quality || 100,
                ...options
            });
            console.log(`[BaseScraper] Screenshot saved to ${path}`);
            return true;
        } catch (error) {
            console.error(`[BaseScraper] Screenshot failed:`, error.message);
            return false;
        }
    }

    /**
     * Get page metadata
     */
    async getPageMetadata(page) {
        try {
            const metadata = await page.evaluate(() => {
                const head = document.head;
                
                return {
                    title: document.title,
                    description: head.querySelector('meta[name="description"]')?.content || '',
                    keywords: head.querySelector('meta[name="keywords"]')?.content || '',
                    author: head.querySelector('meta[name="author"]')?.content || '',
                    language: document.documentElement.lang || '',
                    charset: head.querySelector('meta[charset]')?.getAttribute('charset') || '',
                    viewport: head.querySelector('meta[name="viewport"]')?.content || '',
                    ogTitle: head.querySelector('meta[property="og:title"]')?.content || '',
                    ogDescription: head.querySelector('meta[property="og:description"]')?.content || '',
                    ogImage: head.querySelector('meta[property="og:image"]')?.content || '',
                    url: window.location.href,
                    canonical: head.querySelector('link[rel="canonical"]')?.href || '',
                    favicon: head.querySelector('link[rel="icon"]')?.href || ''
                };
            });

            return metadata;
        } catch (error) {
            console.warn(`[BaseScraper] Failed to get metadata:`, error.message);
            return null;
        }
    }

    /**
     * Scroll page
     */
    async scrollPage(page, options = {}) {
        try {
            const scrollAmount = options.amount || 500;
            const scrollCount = options.count || 5;
            const delay = options.delay || 500;

            for (let i = 0; i < scrollCount; i++) {
                await page.evaluate((amount) => {
                    window.scrollBy(0, amount);
                }, scrollAmount);
                await new Promise(r => setTimeout(r, delay));
            }

            console.log(`[BaseScraper] Scrolled page ${scrollCount} times`);
            return true;
        } catch (error) {
            console.warn(`[BaseScraper] Scroll failed:`, error.message);
            return false;
        }
    }

    /**
     * Get statistics
     */
    getStats() {
        return {
            ...this.stats,
            successRate: this.stats.totalPages > 0 
                ? ((this.stats.successfulScapes / this.stats.totalPages) * 100).toFixed(2) + '%'
                : 'N/A'
        };
    }
}

module.exports = BaseScraper;

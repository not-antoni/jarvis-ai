/**
 * ScreenshotTool - Robust screenshot handler with resilience patterns
 * Inspired by Codex's robust tool handling
 */

const { ToolHandler, ToolOutput, ToolKind } = require('../ToolHandler');
const path = require('path');
const fs = require('fs');

class ScreenshotTool extends ToolHandler {
    constructor(browserAgent, options = {}) {
        super({
            name: 'screenshot',
            description:
                'Capture a screenshot of a web page or browser session. Supports full page, viewport, and element-specific captures.',
            kind: ToolKind.BROWSER,
            category: 'browser',
            timeout: options.timeout || 30000,
            parallel: false,
            isMutating: false,
            parameters: {
                type: 'object',
                properties: {
                    url: {
                        type: 'string',
                        description:
                            'URL to navigate to before taking screenshot (optional if session exists)'
                    },
                    sessionId: {
                        type: 'string',
                        description: 'Existing browser session ID to use'
                    },
                    selector: {
                        type: 'string',
                        description: 'CSS selector to capture specific element'
                    },
                    fullPage: {
                        type: 'boolean',
                        description: 'Capture full scrollable page (default: true)'
                    },
                    viewport: {
                        type: 'object',
                        description: 'Viewport dimensions',
                        properties: {
                            width: { type: 'number' },
                            height: { type: 'number' }
                        }
                    },
                    waitFor: {
                        type: 'string',
                        description:
                            'Wait condition: "load", "domcontentloaded", "networkidle0", "networkidle2"'
                    },
                    waitForSelector: {
                        type: 'string',
                        description: 'CSS selector to wait for before capture'
                    },
                    waitMs: {
                        type: 'number',
                        description: 'Additional wait time in milliseconds after page load'
                    },
                    quality: {
                        type: 'number',
                        description: 'JPEG quality (1-100), only for JPEG format'
                    },
                    format: {
                        type: 'string',
                        description: 'Image format: "png" or "jpeg" (default: png)'
                    }
                }
            }
        });

        this.browserAgent = browserAgent;
        this.options = {
            maxRetries: 3,
            retryDelay: 1000,
            defaultViewport: { width: 1920, height: 1080 },
            defaultWaitFor: 'networkidle2',
            defaultWaitMs: 500,
            ...options
        };
    }

    /**
     * Main screenshot handler with full resilience
     */
    async handle(invocation) {
        const args = invocation.arguments;
        const contextKey = this._buildContextKey(invocation);

        let lastError = null;

        for (let attempt = 1; attempt <= this.options.maxRetries; attempt++) {
            try {
                const result = await this._attemptScreenshot(args, contextKey, attempt);
                return result;
            } catch (error) {
                lastError = error;
                console.warn(
                    `[ScreenshotTool] Attempt ${attempt}/${this.options.maxRetries} failed: ${error.message}`
                );

                if (attempt < this.options.maxRetries) {
                    // Exponential backoff
                    const delay = this.options.retryDelay * Math.pow(2, attempt - 1);
                    await this._sleep(delay);

                    // Try to recover session if needed
                    if (this._isSessionError(error)) {
                        await this._recoverSession(contextKey);
                    }
                }
            }
        }

        return ToolOutput.error(
            `Screenshot failed after ${this.options.maxRetries} attempts: ${lastError?.message}`,
            {
                metadata: { attempts: this.options.maxRetries, lastError: lastError?.message }
            }
        );
    }

    /**
     * Single screenshot attempt
     */
    async _attemptScreenshot(args, contextKey, attempt) {
        const {
            url,
            sessionId,
            selector,
            fullPage = true,
            viewport,
            waitFor = this.options.defaultWaitFor,
            waitForSelector,
            waitMs = this.options.defaultWaitMs,
            quality,
            format = 'png'
        } = args;

        // Get or create session
        let session = sessionId
            ? this.browserAgent.getSession(sessionId)
            : this.browserAgent.getSession(contextKey);

        if (!session && url) {
            // Start new session and navigate
            session = await this.browserAgent.startSession(contextKey);
            await this._navigateWithRetry(session.page, url, waitFor);
        } else if (!session) {
            throw new Error('No active session and no URL provided');
        } else if (url) {
            // Navigate existing session
            await this._navigateWithRetry(session.page, url, waitFor);
        }

        const page = session.page;

        // Set viewport if specified
        if (viewport) {
            await page.setViewport({
                width: viewport.width || this.options.defaultViewport.width,
                height: viewport.height || this.options.defaultViewport.height
            });
        }

        // Wait for specific selector if requested
        if (waitForSelector) {
            try {
                await page.waitForSelector(waitForSelector, { timeout: 10000 });
            } catch (e) {
                console.warn(`[ScreenshotTool] Selector wait timeout: ${waitForSelector}`);
            }
        }

        // Ensure page is stable
        await this._waitForPageStable(page);

        // Additional wait
        if (waitMs > 0) {
            await this._sleep(waitMs);
        }

        // Take screenshot
        let imageBuffer;
        const screenshotOptions = {
            type: format === 'jpeg' ? 'jpeg' : 'png',
            fullPage: !selector && fullPage,
            ...(format === 'jpeg' && quality ? { quality } : {})
        };

        if (selector) {
            // Element screenshot
            imageBuffer = await this._captureElement(page, selector, screenshotOptions);
        } else {
            // Full page or viewport screenshot
            imageBuffer = await this._captureWithFallback(page, screenshotOptions);
        }

        if (!imageBuffer || imageBuffer.length === 0) {
            throw new Error('Screenshot returned empty buffer');
        }

        return ToolOutput.success(imageBuffer, {
            metadata: {
                format: screenshotOptions.type,
                size: imageBuffer.length,
                fullPage: screenshotOptions.fullPage,
                selector: selector || null,
                url: page.url(),
                attempt
            }
        });
    }

    /**
     * Navigate with retry logic
     */
    async _navigateWithRetry(page, url, waitFor) {
        const maxNavigationRetries = 2;

        for (let i = 0; i < maxNavigationRetries; i++) {
            try {
                await page.goto(url, {
                    waitUntil: waitFor,
                    timeout: 20000
                });
                return;
            } catch (error) {
                if (i === maxNavigationRetries - 1) throw error;
                console.warn(`[ScreenshotTool] Navigation retry ${i + 1}: ${error.message}`);
                await this._sleep(1000);
            }
        }
    }

    /**
     * Wait for page to be stable (no pending requests, animations complete)
     */
    async _waitForPageStable(page) {
        try {
            // Wait for network to be idle
            await Promise.race([
                page.waitForNetworkIdle({ idleTime: 300, timeout: 5000 }),
                this._sleep(5000)
            ]);
        } catch (e) {
            // Network idle timeout is okay, continue
        }

        // Wait for any animations to complete
        try {
            await page.evaluate(() => {
                return new Promise(resolve => {
                    // Check for pending animations
                    const animations = document.getAnimations ? document.getAnimations() : [];
                    if (animations.length === 0) {
                        resolve();
                        return;
                    }

                    Promise.all(animations.map(a => a.finished))
                        .then(resolve)
                        .catch(resolve);

                    // Fallback timeout
                    setTimeout(resolve, 2000);
                });
            });
        } catch (e) {
            // Animation wait failed, continue anyway
        }

        // Scroll to ensure lazy-loaded content is visible (for full page)
        try {
            await page.evaluate(async () => {
                await new Promise(resolve => {
                    let totalHeight = 0;
                    const distance = 500;
                    const timer = setInterval(() => {
                        const scrollHeight = document.body.scrollHeight;
                        window.scrollBy(0, distance);
                        totalHeight += distance;

                        if (totalHeight >= scrollHeight || totalHeight > 10000) {
                            clearInterval(timer);
                            window.scrollTo(0, 0);
                            setTimeout(resolve, 200);
                        }
                    }, 100);
                });
            });
        } catch (e) {
            // Scroll failed, continue
        }
    }

    /**
     * Capture element with fallback
     */
    async _captureElement(page, selector, options) {
        try {
            const element = await page.$(selector);
            if (!element) {
                throw new Error(`Element not found: ${selector}`);
            }

            // Scroll element into view
            await element.evaluate(el => el.scrollIntoView({ block: 'center' }));
            await this._sleep(200);

            return await element.screenshot(options);
        } catch (error) {
            console.warn(
                `[ScreenshotTool] Element capture failed, falling back to viewport: ${error.message}`
            );
            // Fallback to viewport capture
            return await page.screenshot({ ...options, fullPage: false });
        }
    }

    /**
     * Capture with fallback strategies
     */
    async _captureWithFallback(page, options) {
        // Strategy 1: Full page screenshot
        if (options.fullPage) {
            try {
                return await page.screenshot(options);
            } catch (error) {
                console.warn(`[ScreenshotTool] Full page capture failed: ${error.message}`);
            }
        }

        // Strategy 2: Viewport screenshot
        try {
            return await page.screenshot({ ...options, fullPage: false });
        } catch (error) {
            console.warn(`[ScreenshotTool] Viewport capture failed: ${error.message}`);
        }

        // Strategy 3: Minimal screenshot
        try {
            return await page.screenshot({
                type: 'png',
                fullPage: false,
                omitBackground: true
            });
        } catch (error) {
            throw new Error(`All screenshot strategies failed: ${error.message}`);
        }
    }

    /**
     * Check if error is session-related
     */
    _isSessionError(error) {
        const message = error.message.toLowerCase();
        return (
            message.includes('session') ||
            message.includes('target') ||
            message.includes('browser') ||
            message.includes('closed') ||
            message.includes('disconnected')
        );
    }

    /**
     * Attempt to recover session
     */
    async _recoverSession(contextKey) {
        try {
            await this.browserAgent.closeSession(contextKey);
        } catch (e) {
            // Ignore close errors
        }

        // Browser agent should auto-recover on next startSession
    }

    /**
     * Build context key from invocation
     */
    _buildContextKey(invocation) {
        const { userId, guildId, channelId } = invocation;
        return `${guildId || 'dm'}:${channelId || 'unknown'}:${userId || 'system'}`;
    }

    /**
     * Sleep helper
     */
    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

/**
 * Quick screenshot function for direct URL capture (no session needed)
 */
class QuickScreenshotTool extends ToolHandler {
    constructor(options = {}) {
        super({
            name: 'quick_screenshot',
            description:
                'Take a quick screenshot of a URL without managing sessions. Uses a temporary browser instance.',
            kind: ToolKind.BROWSER,
            category: 'browser',
            timeout: options.timeout || 60000,
            parallel: true,
            isMutating: false,
            parameters: {
                type: 'object',
                properties: {
                    url: {
                        type: 'string',
                        description: 'URL to capture'
                    },
                    fullPage: {
                        type: 'boolean',
                        description: 'Capture full page (default: false for speed)'
                    },
                    width: {
                        type: 'number',
                        description: 'Viewport width (default: 1280)'
                    },
                    height: {
                        type: 'number',
                        description: 'Viewport height (default: 720)'
                    }
                },
                required: ['url']
            }
        });

        this.options = options;
        this.puppeteer = null;
    }

    async handle(invocation) {
        const { url, fullPage = false, width = 1280, height = 720 } = invocation.arguments;

        // Lazy load puppeteer
        if (!this.puppeteer) {
            try {
                this.puppeteer = require('puppeteer');
            } catch (e) {
                return ToolOutput.error('Puppeteer not installed. Run: npm install puppeteer');
            }
        }

        let browser = null;

        try {
            browser = await this.puppeteer.launch({
                headless: 'new',
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu'
                ]
            });

            const page = await browser.newPage();
            await page.setViewport({ width, height });

            await page.goto(url, {
                waitUntil: 'networkidle2',
                timeout: 30000
            });

            // Brief stability wait
            await new Promise(r => setTimeout(r, 500));

            const buffer = await page.screenshot({
                type: 'png',
                fullPage
            });

            return ToolOutput.success(buffer, {
                metadata: {
                    url,
                    width,
                    height,
                    fullPage,
                    size: buffer.length
                }
            });
        } catch (error) {
            return ToolOutput.error(`Screenshot failed: ${error.message}`);
        } finally {
            if (browser) {
                try {
                    await browser.close();
                } catch (e) {
                    // Ignore close errors
                }
            }
        }
    }
}

module.exports = { ScreenshotTool, QuickScreenshotTool };

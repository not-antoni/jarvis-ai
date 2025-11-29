/**
 * Browser Optimizer - Implements stealth detection bypass, fingerprint randomization,
 * bot detection mitigation, CDP optimizations, and resource blocking
 */

class BrowserOptimizer {
    constructor(page = null) {
        this.page = page;
        this.optimizations = [];
    }

    /**
     * Apply all optimizations to a page
     */
    async applyOptimizations(page) {
        this.page = page;

        try {
            await this.bypassStealthDetection();
            await this.randomizeFingerprint();
            await this.blockUnnecessaryResources();
            await this.optimizeCDP();
            await this.antiBot();
        } catch (error) {
            console.warn('[BrowserOptimizer] Error applying optimizations:', error.message);
        }
    }

    /**
     * Bypass stealth detection (puppeteer-extra-plugin-stealth equivalent)
     */
    async bypassStealthDetection() {
        if (!this.page) return;

        try {
            // Override navigator.webdriver
            await this.page.evaluateOnNewDocument(() => {
                Object.defineProperty(navigator, 'webdriver', { get: () => false });
                Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
                Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
                Object.defineProperty(navigator, 'permissions', { 
                    get: () => ({
                        query: () => Promise.resolve({ state: 'granted' })
                    })
                });
            });

            // Override Chrome detection
            await this.page.evaluateOnNewDocument(() => {
                if (window.chrome === undefined) {
                    window.chrome = { runtime: {} };
                }
            });

            this.optimizations.push('bypass_stealth_detection');
        } catch (error) {
            console.warn('[BrowserOptimizer] Stealth bypass failed:', error.message);
        }
    }

    /**
     * Randomize browser fingerprint
     */
    async randomizeFingerprint() {
        if (!this.page) return;

        try {
            const randomString = () => Math.random().toString(36).substring(2, 15);
            
            await this.page.evaluateOnNewDocument(() => {
                // Override canvas fingerprinting
                const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
                HTMLCanvasElement.prototype.toDataURL = function(...args) {
                    const context = this.getContext('2d');
                    if (context) {
                        context.fillStyle = 'rgb(' + Math.floor(Math.random() * 255) + ',' + Math.floor(Math.random() * 255) + ',' + Math.floor(Math.random() * 255) + ')';
                        context.fillRect(0, 0, 1, 1);
                    }
                    return originalToDataURL.apply(this, args);
                };

                // Override WebGL fingerprinting
                const getParameter = WebGLRenderingContext.prototype.getParameter;
                WebGLRenderingContext.prototype.getParameter = function(parameter) {
                    if (parameter === 37445) {
                        return 'Intel Inc.';
                    }
                    if (parameter === 37446) {
                        return 'Intel Iris OpenGL Engine';
                    }
                    return getParameter.call(this, parameter);
                };
            });

            // Random screen resolution variations
            await this.page.evaluateOnNewDocument(() => {
                Object.defineProperty(window, 'devicePixelRatio', { 
                    get: () => Math.random() > 0.5 ? 1 : 2 
                });
            });

            this.optimizations.push('randomize_fingerprint');
        } catch (error) {
            console.warn('[BrowserOptimizer] Fingerprint randomization failed:', error.message);
        }
    }

    /**
     * Block ads, tracking, and non-essential resources
     */
    async blockUnnecessaryResources() {
        if (!this.page) return;

        try {
            await this.page.setRequestInterception(true);

            this.page.on('request', (request) => {
                const resourceType = request.resourceType();
                const url = request.url();

                // Block tracking and ads
                if (/google-analytics|googletagmanager|facebook\.com|doubleclick\.net|hotjar|mixpanel|segment\.com|amplitude\.com/.test(url)) {
                    request.abort();
                    return;
                }

                // Block media unless needed
                if (resourceType === 'image' || resourceType === 'media' || resourceType === 'font') {
                    // Allow images but with lower priority
                    request.continue({ resourceType: 'image' });
                    return;
                }

                // Block stylesheets if not critical
                if (resourceType === 'stylesheet' && !url.includes('critical')) {
                    request.abort();
                    return;
                }

                request.continue();
            });

            this.optimizations.push('block_unnecessary_resources');
        } catch (error) {
            console.warn('[BrowserOptimizer] Resource blocking failed:', error.message);
        }
    }

    /**
     * Optimize Chrome DevTools Protocol operations
     */
    async optimizeCDP() {
        if (!this.page) return;

        try {
            const client = await this.page.target().createCDPSession();

            // Enable CPU profiling
            await client.send('Profiler.enable');

            // Set CPU throttling to realistic speeds
            await client.send('Emulation.setCPUThrottlingRate', { rate: 1 });

            // Optimize network
            await client.send('Network.emulateNetworkConditions', {
                offline: false,
                downloadThroughput: 1024 * 1024, // 1 Mbps
                uploadThroughput: 512 * 1024, // 512 Kbps
                latency: 50 // 50ms
            });

            this.optimizations.push('optimize_cdp');
            await client.detach();
        } catch (error) {
            console.warn('[BrowserOptimizer] CDP optimization failed:', error.message);
        }
    }

    /**
     * Anti-bot detection measures
     */
    async antiBot() {
        if (!this.page) return;

        try {
            // Add realistic behavior
            await this.page.evaluateOnNewDocument(() => {
                window.__antiBot__ = {
                    clicks: 0,
                    mouseMoves: 0,
                    typing: 0
                };

                document.addEventListener('mousemove', () => {
                    window.__antiBot__.mouseMoves++;
                }, true);

                document.addEventListener('click', () => {
                    window.__antiBot__.clicks++;
                }, true);

                document.addEventListener('keypress', () => {
                    window.__antiBot__.typing++;
                }, true);
            });

            // Add navigation timing delays
            await this.page.evaluateOnNewDocument(() => {
                const originalFetch = window.fetch;
                window.fetch = function(...args) {
                    // Add slight delay to make it look human
                    return new Promise(resolve => {
                        setTimeout(() => {
                            originalFetch.apply(this, args).then(resolve);
                        }, Math.random() * 100 + 50);
                    });
                };
            });

            this.optimizations.push('anti_bot');
        } catch (error) {
            console.warn('[BrowserOptimizer] Anti-bot measures failed:', error.message);
        }
    }

    /**
     * Add random delays between actions to appear human
     */
    async addHumanDelay(minMs = 100, maxMs = 500) {
        const delay = Math.random() * (maxMs - minMs) + minMs;
        await new Promise(resolve => setTimeout(resolve, delay));
    }

    /**
     * Human-like scrolling
     */
    async humanScroll(page, scrollHeight = null) {
        await page.evaluate((height) => {
            return new Promise((resolve) => {
                let totalScroll = 0;
                const scrollStep = Math.floor(Math.random() * 100) + 50; // 50-150px
                const delayBetweenScrolls = Math.random() * 300 + 100; // 100-400ms

                const scrollInterval = setInterval(() => {
                    window.scrollBy(0, scrollStep);
                    totalScroll += scrollStep;

                    if (height && totalScroll >= height) {
                        clearInterval(scrollInterval);
                        resolve();
                    }
                }, delayBetweenScrolls);
            });
        }, scrollHeight);
    }

    /**
     * Human-like click with slight offsets
     */
    async humanClick(selector) {
        if (!this.page) throw new Error('No page instance');

        await this.page.evaluate((sel) => {
            const element = document.querySelector(sel);
            if (!element) throw new Error(`Element not found: ${sel}`);

            // Calculate offset
            const offsetX = Math.random() * 10 - 5;
            const offsetY = Math.random() * 10 - 5;

            // Dispatch mouse events
            element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
            element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
            element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        }, selector);

        await this.addHumanDelay();
    }

    /**
     * Get optimization report
     */
    getReport() {
        return {
            appliedOptimizations: this.optimizations,
            count: this.optimizations.length,
            active: [
                'bypass_stealth_detection',
                'randomize_fingerprint',
                'block_unnecessary_resources',
                'optimize_cdp',
                'anti_bot'
            ].filter(opt => this.optimizations.includes(opt))
        };
    }
}

module.exports = BrowserOptimizer;

/**
 * Robustness Enhancer - Adds resilience patterns and error recovery strategies
 * Handles crashes, timeouts, rate limits, and network issues gracefully
 */

class RobustnessEnhancer {
    constructor() {
        this.strategies = {};
        this.setupDefaultStrategies();
    }

    setupDefaultStrategies() {
        // Timeout recovery
        this.strategies.handleTimeout = async (page, operation, timeoutMs) => {
            try {
                // Try to stop ongoing navigation
                await Promise.race([
                    page.goto('about:blank').catch(() => {}),
                    new Promise(r => setTimeout(r, 2000))
                ]);
                return { recovered: true, action: 'page_blank' };
            } catch (e) {
                return { recovered: false, error: e.message };
            }
        };

        // Network error recovery
        this.strategies.handleNetworkError = async (page, error) => {
            const isTemporary = /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ERR_NETWORK/.test(error.message);
            if (isTemporary) {
                // Wait and retry
                await new Promise(r => setTimeout(r, 5000));
                return { recovered: true, action: 'retry_after_delay' };
            }
            return { recovered: false, error: error.message };
        };

        // Browser crash recovery
        this.strategies.handleBrowserCrash = async (browser, session) => {
            return { recovered: false, action: 'restart_browser', requiresRestart: true };
        };

        // Rate limit recovery
        this.strategies.handleRateLimit = async (page, retryAfter) => {
            const waitTime = Math.min(retryAfter || 30, 300); // Max 5 minutes
            console.log(`[RobustnessEnhancer] Rate limited, waiting ${waitTime}s...`);
            await new Promise(r => setTimeout(r, waitTime * 1000));
            return { recovered: true, action: 'rate_limit_wait', waitedSeconds: waitTime };
        };

        // JavaScript error recovery
        this.strategies.handleJSError = async (page, error) => {
            console.log('[RobustnessEnhancer] JS error detected, attempting to continue...');
            try {
                // Try to navigate to error page or reload
                await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
                return { recovered: true, action: 'page_reload' };
            } catch (e) {
                return { recovered: false, error: e.message };
            }
        };

        // Memory pressure recovery
        this.strategies.handleMemoryPressure = async (browser) => {
            try {
                // Collect garbage
                await browser.close().catch(() => {});
                return { recovered: true, action: 'browser_restart' };
            } catch (e) {
                return { recovered: false, error: e.message };
            }
        };
    }

    /**
     * Wrap page navigation with resilience
     */
    async navigateWithResilience(page, url, options = {}) {
        const maxRetries = options.maxRetries || 3;
        const timeoutMs = options.timeout || 30000;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const response = await page.goto(url, {
                    waitUntil: options.waitUntil || 'networkidle2',
                    timeout: timeoutMs
                });

                // Check for HTTP errors
                if (response && response.status() >= 400) {
                    if (response.status() === 429) {
                        const retryAfter = response.headers()['retry-after'];
                        await this.strategies.handleRateLimit(page, parseInt(retryAfter));
                        continue;
                    }
                    throw new Error(`HTTP ${response.status()}`);
                }

                return { success: true, response, attempts: attempt };
            } catch (error) {
                const errorMsg = error.message.toLowerCase();

                if (errorMsg.includes('timeout')) {
                    console.log(`[RobustnessEnhancer] Timeout on attempt ${attempt}/${maxRetries}`);
                    const recovery = await this.strategies.handleTimeout(page, 'goto', timeoutMs);
                    if (!recovery.recovered || attempt === maxRetries) throw error;
                    continue;
                }

                if (errorMsg.includes('econnrefused') || errorMsg.includes('enotfound')) {
                    console.log(`[RobustnessEnhancer] Network error on attempt ${attempt}/${maxRetries}`);
                    const recovery = await this.strategies.handleNetworkError(page, error);
                    if (!recovery.recovered || attempt === maxRetries) throw error;
                    continue;
                }

                throw error;
            }
        }

        throw new Error(`Navigation failed after ${maxRetries} attempts`);
    }

    /**
     * Wrap page evaluation with error handling
     */
    async evaluateWithResilience(page, fn, args = [], options = {}) {
        try {
            return await page.evaluate(fn, ...args);
        } catch (error) {
            if (options.onError) {
                const recovery = await options.onError(error);
                if (recovery?.shouldRetry) {
                    // Retry after recovery
                    await new Promise(r => setTimeout(r, 1000));
                    return await page.evaluate(fn, ...args);
                }
            }
            throw error;
        }
    }

    /**
     * Wrap screenshot with resilience
     */
    async screenshotWithResilience(page, options = {}) {
        try {
            // Ensure page is ready
            await page.waitForTimeout(500);

            const screenshot = await page.screenshot({
                fullPage: options.fullPage !== false,
                type: 'png',
                encoding: 'binary',
                timeout: options.timeout || 10000
            });

            return { success: true, screenshot };
        } catch (error) {
            console.error('[RobustnessEnhancer] Screenshot failed:', error.message);

            // Try minimal screenshot
            try {
                const fallback = await page.screenshot({
                    fullPage: false,
                    type: 'png',
                    encoding: 'binary',
                    omitBackground: true
                });
                return { success: true, screenshot: fallback, fallback: true };
            } catch (e) {
                return { success: false, error: e.message };
            }
        }
    }

    /**
     * Detect and recover from common error states
     */
    async detectAndRecover(page, browser) {
        const issues = [];

        try {
            // Check for crash/disconnect
            if (!page.browser?.connected) {
                issues.push({ type: 'browser_disconnected', recovered: false });
            }

            // Check for JS errors
            const jsErrors = await page.evaluate(() => {
                return window.__jsErrors || [];
            }).catch(() => []);

            if (jsErrors.length > 0) {
                issues.push({ type: 'js_error', count: jsErrors.length });
                const recovery = await this.strategies.handleJSError(page);
                issues[issues.length - 1].recovered = recovery.recovered;
            }

            // Check for memory issues
            const metrics = await page.metrics();
            if (metrics && metrics.JSHeapUsedSize > 1e9) { // > 1GB
                issues.push({ type: 'high_memory', recoverable: true });
            }

            // Check for network issues
            const unreachable = await page.evaluate(() => {
                return !navigator.onLine;
            }).catch(() => false);

            if (unreachable) {
                issues.push({ type: 'offline', recovered: false });
            }

            return issues;
        } catch (error) {
            return [{ type: 'detection_failed', error: error.message }];
        }
    }

    /**
     * Get resilience statistics
     */
    getStats() {
        return {
            strategiesAvailable: Object.keys(this.strategies).length,
            strategies: Object.keys(this.strategies)
        };
    }
}

module.exports = RobustnessEnhancer;

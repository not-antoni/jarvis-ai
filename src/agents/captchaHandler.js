/**
 * Captcha Detection and Bypass Handler
 * Detects reCAPTCHA, hCaptcha, reCAPTCHA v3, and implements bypass strategies
 */

class CaptchaHandler {
    constructor(options = {}) {
        this.solvingService = options.solvingService || 'none'; // 'none', '2captcha', 'anticaptcha'
        this.apiKey = options.apiKey || null;
        this.timeout = options.timeout || 120000; // 2 minutes default
        this.retries = options.retries || 3;
    }

    /**
     * Detect captcha type on current page
     */
    async detectCaptcha(page) {
        try {
            const captchaType = await page.evaluate(() => {
                // Check for reCAPTCHA v2/v3
                if (window.grecaptcha) {
                    const container = document.querySelector('.g-recaptcha');
                    if (container && container.getAttribute('data-size') === 'invisible') {
                        return 'recaptcha_v3';
                    }
                    return 'recaptcha_v2';
                }

                // Check for hCaptcha
                if (window.hcaptcha || document.querySelector('.h-captcha')) {
                    return 'hcaptcha';
                }

                // Check for other common captchas
                if (document.querySelector('[data-captcha-type="cloudflare"]')) {
                    return 'cloudflare_turnstile';
                }

                // Check for generic "challenge" pages
                if (document.body.textContent.includes('Verify you are human') ||
                    document.body.textContent.includes('challenge')) {
                    return 'unknown_challenge';
                }

                return null;
            });

            return captchaType;
        } catch (error) {
            console.error('[CaptchaHandler] Detection failed:', error.message);
            return null;
        }
    }

    /**
     * Try to solve captcha using external service
     */
    async solveCaptcha(page, captchaType) {
        if (this.solvingService === 'none') {
            throw new Error('No captcha solving service configured');
        }

        try {
            const siteKey = await page.evaluate(() => {
                // Try to extract site key
                const script = document.querySelector('[data-sitekey]');
                if (script) return script.getAttribute('data-sitekey');

                const elem = document.querySelector('.g-recaptcha, .h-captcha');
                if (elem) {
                    return elem.getAttribute('data-sitekey');
                }

                // Try to find in window object
                if (window.grecaptcha && window.grecaptcha.getResponse) {
                    return 'embedded';
                }

                return null;
            });

            if (!siteKey) {
                throw new Error('Could not extract captcha site key');
            }

            const pageUrl = page.url();
            const token = await this.solveWithService(siteKey, pageUrl, captchaType);

            // Inject token into page
            await page.evaluate((token) => {
                if (window.grecaptcha) {
                    window.grecaptcha.callback(token);
                } else if (window.hcaptcha) {
                    window.hcaptcha.remove();
                    // Submit form if available
                    const form = document.querySelector('form');
                    if (form) form.submit();
                }
            }, token);

            return token;
        } catch (error) {
            console.error('[CaptchaHandler] Solve failed:', error.message);
            throw error;
        }
    }

    /**
     * Send captcha to solving service
     */
    async solveWithService(siteKey, pageUrl, captchaType) {
        if (this.solvingService === '2captcha') {
            return await this.solve2Captcha(siteKey, pageUrl, captchaType);
        } else if (this.solvingService === 'anticaptcha') {
            return await this.solveAntiCaptcha(siteKey, pageUrl, captchaType);
        }
        throw new Error(`Unknown captcha service: ${this.solvingService}`);
    }

    /**
     * Solve using 2Captcha service
     */
    async solve2Captcha(siteKey, pageUrl, captchaType) {
        const fetch = require('node-fetch');
        const params = new URLSearchParams({
            clientkey: this.apiKey,
            task: 'NoCaptchaTaskProxyless',
            websiteURL: pageUrl,
            websiteKey: siteKey,
            method: 'post'
        });

        if (captchaType === 'hcaptcha') {
            params.set('isInvisible', 'false');
        }

        try {
            const res = await fetch('http://2captcha.com/api/captcha', {
                method: 'POST',
                body: params,
                timeout: this.timeout
            });
            const text = await res.text();

            if (text.includes('ERROR')) {
                throw new Error(`2Captcha error: ${text}`);
            }

            const captchaId = text.split('=')[1];
            return await this.wait2CaptchaResult(captchaId);
        } catch (error) {
            throw new Error(`2Captcha solve failed: ${error.message}`);
        }
    }

    /**
     * Poll 2Captcha for result
     */
    async wait2CaptchaResult(captchaId) {
        const fetch = require('node-fetch');
        const startTime = Date.now();

        while (Date.now() - startTime < this.timeout) {
            const res = await fetch(`http://2captcha.com/api/res.php?key=${this.apiKey}&action=get&id=${captchaId}`);
            const text = await res.text();

            if (text === 'CAPCHA_NOT_READY') {
                await new Promise(r => setTimeout(r, 5000));
                continue;
            }

            if (text.startsWith('OK|')) {
                return text.split('|')[1];
            }

            throw new Error(`2Captcha error: ${text}`);
        }

        throw new Error('2Captcha timeout');
    }

    /**
     * Solve using AntiCaptcha service
     */
    async solveAntiCaptcha(siteKey, pageUrl, captchaType) {
        const fetch = require('node-fetch');

        const taskData = {
            type: captchaType === 'hcaptcha' ? 'HCaptchaTaskProxyless' : 'NoCaptchaTaskProxyless',
            websiteURL: pageUrl,
            websiteKey: siteKey
        };

        try {
            const res = await fetch('https://api.anticaptcha.com/createTask', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    clientKey: this.apiKey,
                    task: taskData,
                    languagePool: 'en'
                }),
                timeout: this.timeout
            });

            const data = await res.json();

            if (data.errorId !== 0) {
                throw new Error(`AntiCaptcha error: ${data.errorDescription}`);
            }

            return await this.waitAntiCaptchaResult(data.taskId);
        } catch (error) {
            throw new Error(`AntiCaptcha solve failed: ${error.message}`);
        }
    }

    /**
     * Poll AntiCaptcha for result
     */
    async waitAntiCaptchaResult(taskId) {
        const fetch = require('node-fetch');
        const startTime = Date.now();

        while (Date.now() - startTime < this.timeout) {
            const res = await fetch('https://api.anticaptcha.com/getTaskResult', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    clientKey: this.apiKey,
                    taskId: taskId
                })
            });

            const data = await res.json();

            if (data.errorId !== 0) {
                throw new Error(`AntiCaptcha error: ${data.errorDescription}`);
            }

            if (data.isReady) {
                return data.solution.gRecaptchaResponse;
            }

            await new Promise(r => setTimeout(r, 3000));
        }

        throw new Error('AntiCaptcha timeout');
    }

    /**
     * Attempt to bypass with stealth techniques (no external service)
     */
    async stealthBypass(page) {
        try {
            // Mask headless browser
            await page.evaluateOnNewDocument(() => {
                Object.defineProperty(navigator, 'webdriver', {
                    get: () => false
                });
                Object.defineProperty(navigator, 'chromeFlags', {
                    get: () => []
                });
            });

            // Handle reCAPTCHA v3 (usually automatic)
            await page.evaluate(() => {
                if (window.grecaptcha) {
                    // v3 executes automatically
                    window.grecaptcha.ready(() => {
                        window.grecaptcha.execute();
                    });
                }
            });

            return true;
        } catch (error) {
            console.error('[CaptchaHandler] Stealth bypass failed:', error.message);
            return false;
        }
    }

    /**
     * Main handler: detect and attempt solve
     */
    async handleCaptcha(page) {
        const captchaType = await this.detectCaptcha(page);

        if (!captchaType) {
            return { detected: false };
        }

        console.log(`[CaptchaHandler] Detected: ${captchaType}`);

        // Try stealth first if no service configured
        if (this.solvingService === 'none') {
            const success = await this.stealthBypass(page);
            return { detected: true, type: captchaType, solved: success, method: 'stealth' };
        }

        // Try external service
        try {
            await this.solveCaptcha(page, captchaType);
            return { detected: true, type: captchaType, solved: true, method: this.solvingService };
        } catch (error) {
            console.error(`[CaptchaHandler] Failed to solve ${captchaType}:`, error.message);
            return { detected: true, type: captchaType, solved: false, error: error.message };
        }
    }
}

module.exports = CaptchaHandler;

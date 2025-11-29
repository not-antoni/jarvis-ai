const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const fetch = require('node-fetch');

function inAllowlist(hostname, allowlist = []) {
    if (!allowlist || !allowlist.length) return true;
    const host = String(hostname || '').toLowerCase();
    return allowlist.some((d) => host === d || host.endsWith(`.${d}`));
}

function inDenylist(hostname, denylist = []) {
    if (!denylist || !denylist.length) return false;
    const host = String(hostname || '').toLowerCase();
    return denylist.some((d) => host === d || host.endsWith(`.${d}`));
}

function sanitizeUrl(rawUrl, { allowlist, denylist }) {
    let url;
    try {
        url = new URL(rawUrl);
    } catch (_) {
        throw new Error('Invalid URL');
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
        throw new Error('Unsupported protocol');
    }
    if (inDenylist(url.hostname, denylist)) {
        throw new Error('Domain denied');
    }
    if (allowlist && allowlist.length && !inAllowlist(url.hostname, allowlist)) {
        throw new Error('Domain not allowlisted');
    }
    return url.toString();
}

class BrowserAgent {
    constructor(config) {
        this.config = config;
        this.sessions = new Map();
        this.puppeteer = null; // lazy load
        this.browser = null;
        this.defaultTimeoutMs = 20000;
        this.ttlMs = 10 * 60 * 1000; // 10 min inactivity TTL per session
        this.cleanupInterval = setInterval(() => this.prune(), 60 * 1000).unref();
        this.maxDownloadBytes = 50 * 1024 * 1024; // 50MB cap
        
        // Resilience & monitoring
        this.metrics = { totalSessions: 0, failedSessions: 0, succeededOperations: 0, failedOperations: 0 };
        this.sessionErrors = new Map(); // contextKey -> { error, timestamp, retryCount }
        this.browserRestarts = 0;
        this.lastBrowserRestartMs = 0;
        this.circuitBreakerOpen = false;
        this.circuitBreakerResets = 0;
        this.maxConcurrentSessions = 10;
        this.globalErrorThreshold = 5; // consecutive errors before circuit break
        this.consecutiveErrorCount = 0;
    }

    get enabled() {
        return this.config?.deployment?.target === 'selfhost' && !!this.config?.deployment?.headlessBrowser;
    }
    
    getMetrics() {
        const now = Date.now();
        const activeSessions = this.sessions.size;
        const browserHealth = this.browser ? 'ok' : 'down';
        const circuitStatus = this.circuitBreakerOpen ? 'open' : 'closed';
        
        return {
            activeSessions,
            totalSessions: this.metrics.totalSessions,
            failedSessions: this.metrics.failedSessions,
            succeededOperations: this.metrics.succeededOperations,
            failedOperations: this.metrics.failedOperations,
            browserRestarts: this.browserRestarts,
            timeSinceLastRestart: now - this.lastBrowserRestartMs,
            circuitBreakerStatus: circuitStatus,
            consecutiveErrors: this.consecutiveErrorCount,
            systemMemory: process.memoryUsage()
        };
    }
    
    recordOperation(success) {
        if (success) {
            this.metrics.succeededOperations++;
            this.consecutiveErrorCount = 0;
            this.circuitBreakerResets++;
            if (this.circuitBreakerOpen) {
                this.circuitBreakerOpen = false;
                console.log('[BrowserAgent] Circuit breaker reset after successful operation');
            }
        } else {
            this.metrics.failedOperations++;
            this.consecutiveErrorCount++;
            if (this.consecutiveErrorCount >= this.globalErrorThreshold) {
                this.circuitBreakerOpen = true;
                console.warn(`[BrowserAgent] Circuit breaker opened after ${this.consecutiveErrorCount} consecutive errors`);
            }
        }
    }

    async ensurePuppeteer() {
        if (!this.puppeteer) {
            try {
                // Defer require so render deployments without the package don't break
                // eslint-disable-next-line global-require
                this.puppeteer = require('puppeteer');
            } catch (err) {
                throw new Error('Headless browser not available. Install dependency: npm install puppeteer');
            }
        }
        if (!this.browser) {
            try {
                this.browser = await this.puppeteer.launch({
                    headless: 'new',
                    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage']
                });
                this.lastBrowserRestartMs = Date.now();
                this.consecutiveErrorCount = 0;
                console.log('[BrowserAgent] Puppeteer browser launched successfully');
            } catch (err) {
                this.browserRestarts++;
                console.error('[BrowserAgent] Failed to launch browser:', err.message);
                throw err;
            }
        }
    }
    
    async restartBrowser() {
        console.warn('[BrowserAgent] Attempting browser restart...');
        try {
            if (this.browser) {
                try { await this.browser.close(); } catch (_) {}
                this.browser = null;
            }
            // Close all sessions first
            for (const key of Array.from(this.sessions.keys())) {
                this.sessions.delete(key);
            }
            this.browserRestarts++;
            await this.ensurePuppeteer();
            console.log('[BrowserAgent] Browser restart successful');
            return true;
        } catch (err) {
            console.error('[BrowserAgent] Browser restart failed:', err.message);
            return false;
        }
    }
    
    async withRetry(fn, { maxRetries = 2, label = 'operation' } = {}) {
        let lastError;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                const result = await fn();
                this.recordOperation(true);
                return result;
            } catch (err) {
                lastError = err;
                console.warn(`[BrowserAgent] ${label} failed (attempt ${attempt + 1}/${maxRetries + 1}): ${err.message}`);
                
                if (attempt < maxRetries) {
                    // Exponential backoff
                    const delayMs = Math.min(1000 * Math.pow(2, attempt), 5000);
                    await new Promise(r => setTimeout(r, delayMs));
                    
                    // If it's a browser error, restart
                    if (err.message.includes('Target page, context or browser has been closed') || err.message.includes('FATAL')) {
                        await this.restartBrowser();
                    }
                }
            }
        }
        this.recordOperation(false);
        throw lastError;
    }

    buildSessionKey({ guildId, channelId, userId }) {
        return `${guildId || 'dm'}:${channelId || 'unknown'}:${userId}`;
    }

    async startSession(contextKey, options = {}) {
        if (!this.enabled) {
            throw new Error('Agent disabled: selfhost + HEADLESS_BROWSER_ENABLED required');
        }
        
        // Check circuit breaker
        if (this.circuitBreakerOpen) {
            throw new Error('Agent circuit breaker is open - too many consecutive errors. Please try again later.');
        }
        
        // Check concurrent limit
        if (this.sessions.size >= this.maxConcurrentSessions) {
            throw new Error(`Maximum concurrent sessions (${this.maxConcurrentSessions}) reached. Please close a session or wait.`);
        }

        try {
            await this.ensurePuppeteer();
            const page = await this.browser.newPage();
            
            // Memory & safety
            await page.setBypassCSP(true);
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) JarvisAgent/1.0 Chrome/120 Safari/537.36');
            page.setDefaultTimeout(this.defaultTimeoutMs);
            
            // Enable request interception before setting up handlers
            await page.setRequestInterception(true);
            
            // Abort excessive requests
            await page.on('request', (req) => {
                const resourceType = req.resourceType();
                if (['font', 'stylesheet', 'media'].includes(resourceType)) {
                    req.abort().catch(() => {});
                } else {
                    req.continue().catch(() => {});
                }
            });

            const downloadDir = path.join(os.tmpdir(), 'jarvis-agent-downloads');
            fs.mkdirSync(downloadDir, { recursive: true });

            const session = {
                page,
                createdAt: Date.now(),
                touchedAt: Date.now(),
                downloadDir,
                options,
                errorCount: 0,
                requestCount: 0
            };
            
            this.sessions.set(contextKey, session);
            this.metrics.totalSessions++;
            console.log(`[BrowserAgent] Session started: ${contextKey} (${this.sessions.size}/${this.maxConcurrentSessions})`);
            return session;
        } catch (err) {
            this.metrics.failedSessions++;
            throw err;
        }
    }

    getSession(contextKey) {
        const session = this.sessions.get(contextKey) || null;
        if (session) {
            session.touchedAt = Date.now();
            session.requestCount++;
        }
        return session;
    }

    async closeSession(contextKey) {
        const session = this.sessions.get(contextKey);
        if (session) {
            try {
                await session.page.close({ runBeforeUnload: false });
                console.log(`[BrowserAgent] Session closed: ${contextKey}`);
            } catch (err) {
                console.warn(`[BrowserAgent] Error closing session ${contextKey}: ${err.message}`);
            }
        }
        this.sessions.delete(contextKey);
        return true;
    }

    async open(contextKey, url, { waitUntil = 'load' } = {}) {
        const safeUrl = sanitizeUrl(url, {
            allowlist: this.config?.deployment?.agentAllowlist || [],
            denylist: this.config?.deployment?.agentDenylist || []
        });
        
        return this.withRetry(async () => {
            let session = this.getSession(contextKey);
            if (!session) {
                session = await this.startSession(contextKey);
            }
            
            try {
                await Promise.race([
                    session.page.goto(safeUrl, { waitUntil }),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Navigation timeout')), this.defaultTimeoutMs))
                ]);
                const title = (await session.page.title()) || safeUrl;
                return { title, url: safeUrl };
            } catch (err) {
                session.errorCount++;
                throw err;
            }
        }, { maxRetries: 2, label: `open(${url})` });
    }

    async screenshot(contextKey, { fullPage = true, selector = null } = {}) {
        return this.withRetry(async () => {
            const session = this.getSession(contextKey);
            if (!session) throw new Error('No active session');
            const page = session.page;
            let imageBuffer;

            try {
                if (selector) {
                    const handle = await page.$(selector);
                    if (!handle) throw new Error(`Selector not found: ${selector}`);
                    imageBuffer = await handle.screenshot({ type: 'png' });
                    await handle.dispose();
                } else {
                    imageBuffer = await page.screenshot({ type: 'png', fullPage });
                }
                return imageBuffer;
            } catch (err) {
                session.errorCount++;
                throw err;
            }
        }, { maxRetries: 1, label: `screenshot(${selector || 'full'})` });
    }

    async click(contextKey, selector) {
        return this.withRetry(async () => {
            const session = this.getSession(contextKey);
            if (!session) throw new Error('No active session');
            await session.page.click(selector, { delay: 10 });
            return true;
        }, { maxRetries: 1, label: `click(${selector})` });
    }

    async type(contextKey, selector, text) {
        return this.withRetry(async () => {
            const session = this.getSession(contextKey);
            if (!session) throw new Error('No active session');
            await session.page.focus(selector);
            await session.page.type(selector, text, { delay: 10 });
            return true;
        }, { maxRetries: 1, label: `type(${selector})` });
    }

    async evaluate(contextKey, script) {
        return this.withRetry(async () => {
            const session = this.getSession(contextKey);
            if (!session) throw new Error('No active session');
            const result = await session.page.evaluate(script);
            return result;
        }, { maxRetries: 1, label: 'evaluate' });
    }

    async downloadDirect(url) {
        const safeUrl = sanitizeUrl(url, {
            allowlist: this.config?.deployment?.agentAllowlist || [],
            denylist: this.config?.deployment?.agentDenylist || []
        });

        return this.withRetry(async () => {
            // HEAD check with timeout
            try {
                const headController = new AbortController();
                const headTimeout = setTimeout(() => headController.abort(), 5000);
                const head = await fetch(safeUrl, { 
                    method: 'HEAD',
                    signal: headController.signal
                });
                clearTimeout(headTimeout);
                
                const len = Number(head.headers.get('content-length') || 0);
                if (this.maxDownloadBytes && len && len > this.maxDownloadBytes) {
                    const err = new Error(`Download size ${(len / 1024 / 1024).toFixed(1)}MB exceeds 50MB limit`);
                    err.code = 'DOWNLOAD_TOO_LARGE';
                    throw err;
                }
            } catch (err) {
                // Non-fatal HEAD check failure, continue with GET
                if (err.name === 'AbortError') {
                    console.warn('[BrowserAgent] HEAD check timeout, proceeding with GET');
                } else if (err.code !== 'DOWNLOAD_TOO_LARGE') {
                    console.warn('[BrowserAgent] HEAD check failed:', err.message);
                } else {
                    throw err;
                }
            }

            // GET with timeout
            const getController = new AbortController();
            const getTimeout = setTimeout(() => getController.abort(), 30000);
            
            try {
                const res = await fetch(safeUrl, { 
                    redirect: 'follow',
                    signal: getController.signal
                });
                
                if (!res.ok) throw new Error(`HTTP ${res.status}`);

                let received = 0;
                const chunks = [];
                
                await new Promise((resolve, reject) => {
                    res.body.on('data', (chunk) => {
                        received += chunk.length;
                        if (this.maxDownloadBytes && received > this.maxDownloadBytes) {
                            try { res.body.destroy(); } catch {}
                            const err = new Error(`Download exceeded ${(this.maxDownloadBytes / 1024 / 1024).toFixed(0)}MB limit`);
                            err.code = 'DOWNLOAD_TOO_LARGE';
                            reject(err);
                            return;
                        }
                        chunks.push(chunk);
                    });
                    res.body.on('end', resolve);
                    res.body.on('error', reject);
                });
                
                clearTimeout(getTimeout);
                const buf = Buffer.concat(chunks);
                const contentType = res.headers.get('content-type') || 'application/octet-stream';
                const disposition = res.headers.get('content-disposition') || '';
                let filename = (disposition.match(/filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i) || [])[1] || null;
                
                if (filename) {
                    try { filename = decodeURIComponent(filename); } catch (_) {}
                }
                if (!filename) {
                    const urlObj = new URL(safeUrl);
                    const base = path.basename(urlObj.pathname) || 'download';
                    const ext = (contentType.split('/')[1] || '').split(';')[0];
                    filename = base.includes('.') ? base : `${base}.${ext || 'bin'}`;
                }
                
                return { buffer: buf, contentType, filename };
            } catch (err) {
                clearTimeout(getTimeout);
                if (err.name === 'AbortError') {
                    throw new Error('Download timeout (>30s)');
                }
                throw err;
            }
        }, { maxRetries: 1, label: `download(${url})` });
    }

    async prune() {
        const now = Date.now();
        const beforeCount = this.sessions.size;
        
        for (const [key, session] of this.sessions.entries()) {
            const inactiveTime = now - session.touchedAt;
            const shouldClose = inactiveTime > this.ttlMs || session.errorCount > 10;
            
            if (shouldClose) {
                try {
                    await session.page.close({ runBeforeUnload: false });
                    this.sessions.delete(key);
                    const reason = inactiveTime > this.ttlMs ? 'TTL' : 'high error count';
                    console.log(`[BrowserAgent] Pruned session ${key} (${reason})`);
                } catch (err) {
                    // Force remove if close fails
                    this.sessions.delete(key);
                    console.warn(`[BrowserAgent] Force removed broken session ${key}`);
                }
            }
        }
        
        if (beforeCount !== this.sessions.size) {
            console.log(`[BrowserAgent] Pruned ${beforeCount - this.sessions.size} sessions, ${this.sessions.size} remaining`);
        }
    }

    async shutdown() {
        console.log('[BrowserAgent] Initiating graceful shutdown...');
        clearInterval(this.cleanupInterval);
        
        // Close all sessions
        const sessionKeys = Array.from(this.sessions.keys());
        for (const key of sessionKeys) {
            try {
                await this.closeSession(key);
            } catch (err) {
                console.warn(`[BrowserAgent] Error closing session during shutdown: ${err.message}`);
            }
        }
        
        // Close browser
        if (this.browser) {
            try {
                await this.browser.close();
                console.log('[BrowserAgent] Browser closed successfully');
            } catch (err) {
                console.warn(`[BrowserAgent] Error closing browser: ${err.message}`);
            }
            this.browser = null;
        }
        
        console.log('[BrowserAgent] Shutdown complete. Final metrics:', this.getMetrics());
    }
}

module.exports = BrowserAgent;

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
    }

    get enabled() {
        return this.config?.deployment?.target === 'selfhost' && !!this.config?.deployment?.headlessBrowser;
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
            this.browser = await this.puppeteer.launch({
                headless: 'new',
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });
        }
    }

    buildSessionKey({ guildId, channelId, userId }) {
        return `${guildId || 'dm'}:${channelId || 'unknown'}:${userId}`;
    }

    async startSession(contextKey, options = {}) {
        if (!this.enabled) {
            throw new Error('Agent disabled: selfhost + HEADLESS_BROWSER_ENABLED required');
        }

        await this.ensurePuppeteer();
        const page = await this.browser.newPage();
        await page.setBypassCSP(true);
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) JarvisAgent/1.0 Chrome/120 Safari/537.36');
        page.setDefaultTimeout(this.defaultTimeoutMs);

        const downloadDir = path.join(os.tmpdir(), 'jarvis-agent-downloads');
        fs.mkdirSync(downloadDir, { recursive: true });
        // Puppeteer uses CDPSession for downloads via click; we will support direct fetch for now

        const session = {
            page,
            createdAt: Date.now(),
            touchedAt: Date.now(),
            downloadDir,
            options
        };
        this.sessions.set(contextKey, session);
        return session;
    }

    getSession(contextKey) {
        const session = this.sessions.get(contextKey) || null;
        if (session) session.touchedAt = Date.now();
        return session;
    }

    async closeSession(contextKey) {
        const session = this.sessions.get(contextKey);
        if (session) {
            try { await session.page.close({ runBeforeUnload: false }); } catch (_) {}
        }
        this.sessions.delete(contextKey);
        return true;
    }

    async open(contextKey, url, { waitUntil = 'load' } = {}) {
        const safeUrl = sanitizeUrl(url, {
            allowlist: this.config?.deployment?.agentAllowlist || [],
            denylist: this.config?.deployment?.agentDenylist || []
        });
        let session = this.getSession(contextKey);
        if (!session) {
            session = await this.startSession(contextKey);
        }
        await session.page.goto(safeUrl, { waitUntil });
        const title = (await session.page.title()) || safeUrl;
        return { title, url: safeUrl };
    }

    async screenshot(contextKey, { fullPage = true, selector = null } = {}) {
        const session = this.getSession(contextKey);
        if (!session) throw new Error('No active session');
        const page = session.page;
        let imageBuffer;

        if (selector) {
            const handle = await page.$(selector);
            if (!handle) throw new Error('Selector not found');
            imageBuffer = await handle.screenshot({ type: 'png' });
            await handle.dispose();
        } else {
            imageBuffer = await page.screenshot({ type: 'png', fullPage });
        }
        return imageBuffer;
    }

    async click(contextKey, selector) {
        const session = this.getSession(contextKey);
        if (!session) throw new Error('No active session');
        await session.page.click(selector, { delay: 10 });
        return true;
    }

    async type(contextKey, selector, text) {
        const session = this.getSession(contextKey);
        if (!session) throw new Error('No active session');
        await session.page.focus(selector);
        await session.page.type(selector, text, { delay: 10 });
        return true;
    }

    async evaluate(contextKey, script) {
        const session = this.getSession(contextKey);
        if (!session) throw new Error('No active session');
        const result = await session.page.evaluate(script);
        return result;
    }

    async downloadDirect(url) {
        const safeUrl = sanitizeUrl(url, {
            allowlist: this.config?.deployment?.agentAllowlist || [],
            denylist: this.config?.deployment?.agentDenylist || []
        });

        // HEAD check
        try {
            const head = await fetch(safeUrl, { method: 'HEAD' });
            const len = Number(head.headers.get('content-length') || 0);
            if (this.maxDownloadBytes && len && len > this.maxDownloadBytes) {
                const err = new Error('Download exceeds 50MB limit');
                err.code = 'DOWNLOAD_TOO_LARGE';
                throw err;
            }
        } catch {}

        const res = await fetch(safeUrl, { redirect: 'follow' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        let received = 0;
        const chunks = [];
        await new Promise((resolve, reject) => {
            res.body.on('data', (chunk) => {
                received += chunk.length;
                if (this.maxDownloadBytes && received > this.maxDownloadBytes) {
                    try { res.body.destroy(); } catch {}
                    const err = new Error('Download exceeds 50MB limit');
                    err.code = 'DOWNLOAD_TOO_LARGE';
                    reject(err);
                    return;
                }
                chunks.push(chunk);
            });
            res.body.on('end', resolve);
            res.body.on('error', reject);
        });
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
    }

    async prune() {
        const now = Date.now();
        for (const [key, session] of this.sessions.entries()) {
            if (now - session.touchedAt > this.ttlMs) {
                try { await session.page.close({ runBeforeUnload: false }); } catch (_) {}
                this.sessions.delete(key);
            }
        }
    }

    async shutdown() {
        clearInterval(this.cleanupInterval);
        for (const key of Array.from(this.sessions.keys())) {
            await this.closeSession(key);
        }
        if (this.browser) {
            try { await this.browser.close(); } catch (_) {}
            this.browser = null;
        }
    }
}

module.exports = BrowserAgent;

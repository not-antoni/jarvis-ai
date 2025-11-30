/**
 * Agent Preview - JARVIS CODEX Edition
 * Now with browser rendering, screenshots, and smart AI
 */

const fetch = require('node-fetch');
const cheerio = require('cheerio');
const config = require('../../config');

// Try to use new systems, fallback to old
let FreeAIProvider, BrowserAgent, aiManager;
try {
    FreeAIProvider = require('../core/FreeAIProvider').FreeAIProvider;
} catch { FreeAIProvider = null; }
try {
    BrowserAgent = require('../agents/browserAgent');
} catch { BrowserAgent = null; }
try {
    aiManager = require('../services/ai-providers');
} catch { aiManager = null; }

const DEFAULT_MAX_BYTES = 200_000;
const FETCH_TIMEOUT_MS = 10_000;

// Shared browser instance for efficiency
let sharedBrowser = null;

function sanitizeUrl(url) {
    try {
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            throw new Error('Invalid protocol');
        }
        const host = parsed.hostname.toLowerCase();
        if (Array.isArray(config?.deployment?.agentDenylist) && config.deployment.agentDenylist.length) {
            if (config.deployment.agentDenylist.some((d) => host === d || host.endsWith(`.${d}`))) {
                throw new Error('Domain is denied for agent preview');
            }
        }
        if (Array.isArray(config?.deployment?.agentAllowlist) && config.deployment.agentAllowlist.length) {
            const allowed = config.deployment.agentAllowlist.some((d) => host === d || host.endsWith(`.${d}`));
            if (!allowed) {
                throw new Error('Domain not in allowlist for agent preview');
            }
        }
        // Strip trackers
        ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid', 'ref'].forEach((k) => parsed.searchParams.delete(k));
        parsed.search = parsed.searchParams.toString();
        return parsed.toString();
    } catch (err) {
        throw new Error(`Invalid URL: ${err.message}`);
    }
}

/**
 * Get or create shared browser agent
 */
function getBrowserAgent() {
    if (!BrowserAgent) return null;
    
    if (!sharedBrowser) {
        const browserConfig = {
            ...config,
            deployment: {
                ...config.deployment,
                target: 'selfhost',
                headlessBrowser: true
            }
        };
        sharedBrowser = new BrowserAgent(browserConfig);
    }
    return sharedBrowser;
}

/**
 * Fetch page with real browser (JS rendering + screenshot)
 */
async function fetchWithBrowser(url) {
    const browser = getBrowserAgent();
    if (!browser || !browser.enabled) {
        return null; // Fall back to simple fetch
    }
    
    const sessionKey = `preview-${Date.now()}`;
    
    try {
        await browser.startSession(sessionKey);
        const session = browser.getSession(sessionKey);
        
        if (!session?.page) {
            throw new Error('Failed to create browser session');
        }
        
        const page = session.page;
        await page.setViewport({ width: 1280, height: 800 });
        
        // Navigate with timeout
        await page.goto(url, { 
            waitUntil: 'networkidle2',
            timeout: 15000 
        });
        
        // Extract content
        const title = await page.title();
        const text = await page.evaluate(() => {
            // Remove scripts and styles
            document.querySelectorAll('script, style, noscript, iframe').forEach(el => el.remove());
            
            // Try to find main content
            const main = document.querySelector('article, main, [role="main"]');
            if (main) return main.innerText;
            
            return document.body?.innerText || '';
        });
        
        // Take screenshot
        let screenshot = null;
        try {
            screenshot = await page.screenshot({ 
                type: 'png',
                fullPage: false,
                encoding: 'base64'
            });
        } catch (e) {
            console.warn('Screenshot failed:', e.message);
        }
        
        await browser.closeSession(sessionKey);
        
        return {
            title: title || '',
            text: text?.replace(/\s+/g, ' ').trim() || '',
            screenshot,
            rendered: true
        };
        
    } catch (error) {
        try { await browser.closeSession(sessionKey); } catch {}
        console.warn('Browser fetch failed:', error.message);
        return null;
    }
}

/**
 * Simple fetch fallback (no JS rendering)
 */
async function fetchPage(url, { maxBytes = DEFAULT_MAX_BYTES } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
        const res = await fetch(url, {
            redirect: 'follow',
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (JarvisAgent/2.0; CODEX)',
                'Accept': 'text/html',
                'Accept-Language': 'en-US,en;q=0.9'
            }
        });

        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
        }

        const contentType = res.headers.get('content-type') || '';
        if (!contentType.toLowerCase().includes('text/html')) {
            throw new Error(`Unsupported content-type: ${contentType}`);
        }

        if (!res.body) {
            throw new Error('No response body');
        }

        let received = 0;
        const chunks = [];

        await new Promise((resolve, reject) => {
            res.body.on('data', (chunk) => {
                received += chunk.length;
                if (received > maxBytes) {
                    const keep = maxBytes - (received - chunk.length);
                    if (keep > 0) chunks.push(chunk.slice(0, keep));
                    res.body.destroy();
                    resolve();
                } else {
                    chunks.push(chunk);
                }
            });
            res.body.on('end', resolve);
            res.body.on('error', reject);
            controller.signal.addEventListener('abort', () => reject(new Error('Fetch aborted')));
        });

        const buf = Buffer.concat(chunks);
        return buf.toString('utf8');
    } finally {
        clearTimeout(timer);
    }
}

function extractText(html) {
    const $ = cheerio.load(html);
    $('script, style, noscript, iframe, template').remove();
    const title = ($('title').first().text() || '').trim();

    const candidates = [];
    const selectors = ['article', 'main', 'div'];
    selectors.forEach((sel) => {
        $(sel).each((_, el) => {
            const text = $(el).text().replace(/\s+/g, ' ').trim();
            candidates.push({ text, length: text.length });
        });
    });

    candidates.sort((a, b) => b.length - a.length);
    const best = candidates.find((c) => c.length > 300) || candidates[0];

    const bodyText = best?.text
        ? best.text
        : $('body').text().replace(/\s+/g, ' ').trim();

    return { title, text: bodyText };
}

/**
 * Get AI provider (new or old)
 */
function getAI() {
    if (FreeAIProvider) {
        const ai = new FreeAIProvider();
        if (ai.isAvailable()) return ai;
    }
    return aiManager;
}

/**
 * Summarize text with AI
 */
async function summarizeText({ title, text, url, hasScreenshot }) {
    const truncated = text.slice(0, 4000);
    const ai = getAI();
    
    const systemPrompt = `You are JARVIS, an advanced AI assistant. Provide a concise, informative summary of the web page. Use bullet points for key information. Keep it under 150 words. Be helpful and precise.`;
    
    const userPrompt = `URL: ${url}
Title: ${title || 'N/A'}
${hasScreenshot ? '(Screenshot captured)' : ''}

Content:
${truncated}`;

    let summary;
    
    try {
        if (ai?.generateResponse) {
            // New FreeAIProvider
            summary = await ai.generateResponse(systemPrompt, userPrompt, 400);
            if (typeof summary === 'object') {
                summary = summary?.content || summary?.text || JSON.stringify(summary);
            }
        } else if (ai?.generateResponse) {
            // Old aiManager
            const resp = await ai.generateResponse(systemPrompt, userPrompt, 400);
            summary = resp?.choices?.[0]?.message?.content;
        }
    } catch (e) {
        console.warn('AI summarization failed:', e.message);
    }
    
    if (!summary || !String(summary).trim()) {
        // Fallback: extract key sentences
        const sentences = truncated.match(/[^.!?]+[.!?]+/g) || [];
        const fallback = sentences.slice(0, 3).join(' ').trim();
        summary = fallback 
            ? `📄 **${title || 'Page'}**\n\n${fallback}...`
            : `Page loaded but no summary available.`;
    }
    
    return String(summary).trim();
}

/**
 * Main function: Summarize a URL with optional screenshot
 */
async function summarizeUrl(url, options = {}) {
    if (config?.deployment?.target !== 'selfhost' || !config?.deployment?.liveAgentMode) {
        throw new Error('Agent preview is disabled (selfhost/liveAgentMode required).');
    }

    const safeUrl = sanitizeUrl(url);
    let title, text, screenshot = null, rendered = false;
    
    // Try browser first (JS rendering + screenshot)
    if (options.useBrowser !== false) {
        const browserResult = await fetchWithBrowser(safeUrl);
        if (browserResult) {
            title = browserResult.title;
            text = browserResult.text;
            screenshot = browserResult.screenshot;
            rendered = browserResult.rendered;
        }
    }
    
    // Fallback to simple fetch
    if (!text) {
        const html = await fetchPage(safeUrl);
        const extracted = extractText(html);
        title = extracted.title;
        text = extracted.text;
    }
    
    if (!text) {
        throw new Error('No readable text extracted from page.');
    }
    
    const summary = await summarizeText({ 
        title, 
        text, 
        url: safeUrl,
        hasScreenshot: !!screenshot
    });
    
    return {
        title: title || safeUrl,
        url: safeUrl,
        summary,
        screenshot,  // Base64 PNG or null
        rendered     // true if browser was used
    };
}

/**
 * Quick screenshot without summarization
 */
async function screenshotUrl(url) {
    const safeUrl = sanitizeUrl(url);
    const browser = getBrowserAgent();
    
    if (!browser || !browser.enabled) {
        throw new Error('Browser not available for screenshots');
    }
    
    const sessionKey = `screenshot-${Date.now()}`;
    
    try {
        await browser.startSession(sessionKey);
        const session = browser.getSession(sessionKey);
        const page = session.page;
        
        await page.setViewport({ width: 1280, height: 800 });
        await page.goto(safeUrl, { waitUntil: 'networkidle2', timeout: 15000 });
        
        const title = await page.title();
        const screenshot = await page.screenshot({ 
            type: 'png',
            fullPage: false 
        });
        
        await browser.closeSession(sessionKey);
        
        return {
            title: title || safeUrl,
            url: safeUrl,
            screenshot  // Buffer
        };
    } catch (error) {
        try { await browser.closeSession(sessionKey); } catch {}
        throw error;
    }
}

/**
 * Cleanup shared browser
 */
async function cleanup() {
    if (sharedBrowser) {
        await sharedBrowser.shutdown();
        sharedBrowser = null;
    }
}

module.exports = {
    summarizeUrl,
    screenshotUrl,
    sanitizeUrl,
    fetchPage,
    extractText,
    cleanup
};

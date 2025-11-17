const fetch = require('node-fetch');
const cheerio = require('cheerio');
const aiManager = require('../../ai-providers');
const config = require('../../config');

const DEFAULT_MAX_BYTES = 200_000; // ~200 KB
const FETCH_TIMEOUT_MS = 10_000;

function sanitizeUrl(url) {
    try {
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            throw new Error('Invalid protocol');
        }
        // Strip common trackers
        ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid', 'ref'].forEach((k) => parsed.searchParams.delete(k));
        parsed.search = parsed.searchParams.toString();
        return parsed.toString();
    } catch (err) {
        throw new Error(`Invalid URL: ${err.message}`);
    }
}

async function fetchPage(url, { maxBytes = DEFAULT_MAX_BYTES } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
        const res = await fetch(url, {
            redirect: 'follow',
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (JarvisAgent/1.0)',
                'Accept': 'text/html',
                'Accept-Language': 'en-US,en;q=0.9'
            }
        });

        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
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
                    res.body.destroy(); // stop reading
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
    const bodyText = $('body').text().replace(/\\s+/g, ' ').trim();
    return { title, text: bodyText };
}

async function summarizeText({ title, text, url }) {
    const truncated = text.slice(0, 4000); // limit to ~4k chars
    const systemPrompt = `You are Jarvis. Provide a brief, safe summary of the fetched page. Use bullet points if helpful. Include the title if present. Keep it under 120 words. Never return an empty response.`;
    const userPrompt = `URL: ${url}\nTitle: ${title || 'N/A'}\nContent (truncated):\n${truncated}`;

    const resp = await aiManager.generateResponse(systemPrompt, userPrompt, 300);
    let summary = resp?.choices?.[0]?.message?.content;
    if (!summary || !String(summary).trim()) {
        const fallback = truncated.slice(0, 300);
        if (!fallback) {
            throw new Error('Empty summary from AI provider');
        }
        summary = `Page excerpt (no AI summary available): ${fallback}`;
    }
    return String(summary).trim();
}

async function summarizeUrl(url) {
    if (config?.deployment?.target !== 'selfhost' || !config?.deployment?.liveAgentMode) {
        throw new Error('Agent preview is disabled (selfhost/liveAgentMode required).');
    }

    const safeUrl = sanitizeUrl(url);
    const html = await fetchPage(safeUrl);
    const { title, text } = extractText(html);
    if (!text) {
        throw new Error('No readable text extracted from page.');
    }
    const summary = await summarizeText({ title, text, url: safeUrl });
    return {
        title: title || safeUrl,
        url: safeUrl,
        summary
    };
}

module.exports = {
    summarizeUrl,
    sanitizeUrl,
    fetchPage,
    extractText
};

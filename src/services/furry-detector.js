'use strict';

const { generateText } = require('ai');
const { createOpenAI } = require('@ai-sdk/openai');

// ── Config ───────────────────────────────────────────────────────────────────
const FURRY_GUILD_ID = '858444090374881301';
const CONFIDENCE_THRESHOLD = 0.7;
const MODEL_ID = 'google/gemini-2.5-flash-lite';

// Vercel AI Gateway keys
const GATEWAY_KEYS = Object.keys(process.env)
    .filter(k => /^AI_GATEWAY_API_KEY\d*$/.test(k))
    .sort()
    .map(k => process.env[k])
    .filter(Boolean);

const DETECTION_PROMPT = [
    'Analyze this image. Is it furry content?',
    'Furry content includes:',
    '- Anthropomorphic animal characters (animals with human features: standing upright, wearing clothes, human expressions/poses)',
    '- Furry fandom artwork, fursona art',
    '- The "boykisser" meme or similar furry memes',
    '- Stylized cartoon/anime animals with a distinctly "furry fandom" aesthetic',
    '',
    'NOT furry: normal photos of real animals, standard cartoon mascots, regular emoji/stickers of animals.',
    '',
    'Respond with ONLY valid JSON, no markdown:',
    '{"furry": true/false, "confidence": 0.0-1.0, "reason": "brief description"}',
].join('\n');

// ── Rate limiting ────────────────────────────────────────────────────────────
const scanCooldowns = new Map();       // userId -> timestamp
const SCAN_COOLDOWN_MS = 30_000;
const guildScanTimestamps = [];        // rolling window of guild-wide scans
const GUILD_RATE_WINDOW_MS = 60_000;
const GUILD_RATE_MAX = 10;

// ── Service ──────────────────────────────────────────────────────────────────

class FurryDetector {
    constructor() {
        if (GATEWAY_KEYS.length === 0) {
            console.warn('[FurryDetector] No AI_GATEWAY_API_KEY found — furry detection disabled.');
        } else {
            console.log(`[FurryDetector] Loaded ${GATEWAY_KEYS.length} Vercel AI Gateway key(s) — model=${MODEL_ID}`);
        }
        this._providers = GATEWAY_KEYS.map(k => createOpenAI({
            apiKey: k,
            baseURL: 'https://ai-gateway.vercel.sh/v1',
        }));
        this._keyIndex = 0;
        this._deadKeys = new Set(); // indices of keys that return 403
    }

    get enabled() {
        return this._providers.length > this._deadKeys.size;
    }

    _getProvider() {
        // Skip dead keys
        for (let i = 0; i < this._providers.length; i++) {
            const idx = (this._keyIndex + i) % this._providers.length;
            if (!this._deadKeys.has(idx)) {
                this._keyIndex = idx + 1;
                return { provider: this._providers[idx], index: idx };
            }
        }
        return null;
    }

    async _fetchImage(url) {
        try {
            const res = await fetch(url);
            if (!res.ok) return null;
            const buf = Buffer.from(await res.arrayBuffer());
            const mime = (res.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
            if (!mime.startsWith('image/')) return null;
            return { data: buf, mime };
        } catch (e) {
            console.warn('[FurryDetector] Failed to fetch image:', e.message);
            return null;
        }
    }

    async _analyzeImage(imageData, mime) {
        // Try each working key until one succeeds
        for (let attempt = 0; attempt < this._providers.length - this._deadKeys.size; attempt++) {
            const pick = this._getProvider();
            if (!pick) return null;

            try {
                const b64url = `data:${mime};base64,${imageData.toString('base64')}`;
                const { text } = await generateText({
                    model: pick.provider(MODEL_ID),
                    messages: [{
                        role: 'user',
                        content: [
                            { type: 'text', text: DETECTION_PROMPT },
                            { type: 'image', image: b64url },
                        ],
                    }],
                });
                const match = text.trim().match(/\{[\s\S]*\}/);
                if (!match) return null;
                return JSON.parse(match[0]);
            } catch (e) {
                if (/forbidden|403/i.test(e.message)) {
                    this._deadKeys.add(pick.index);
                    console.warn(`[FurryDetector] Key ${pick.index + 1} returned 403 — disabled (${this._providers.length - this._deadKeys.size} keys remaining)`);
                    continue;
                }
                console.warn('[FurryDetector] Analysis error:', e.message);
                return null;
            }
        }
        return null;
    }

    _extractImageUrls(message) {
        const urls = [];
        for (const [, att] of message.attachments) {
            const ct = (att.contentType || '').toLowerCase();
            if (ct.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(att.name || '')) {
                urls.push(att.url);
            }
        }
        for (const embed of message.embeds) {
            if (embed.image?.url) urls.push(embed.image.url);
            if (embed.thumbnail?.url && !urls.includes(embed.thumbnail.url)) {
                urls.push(embed.thumbnail.url);
            }
        }
        if (message.stickers?.size) {
            for (const [, sticker] of message.stickers) {
                if (sticker.url) urls.push(sticker.url);
            }
        }
        return urls;
    }

    async _sendAlert(message, result) {
        try {
            const owner = await message.guild.fetchOwner();
            const pct = Math.round(result.confidence * 100);
            const alert =
                `🚨 **Furry content detected**\n` +
                `${owner} — ${message.author} posted a furry image in ${message.channel}\n` +
                `Confidence: **${pct}%** — ${result.reason}\n` +
                `[Jump to message](${message.url})`;
            await message.channel.send(alert);
            console.log(
                `[FurryDetector] ALERT user=${message.author.id} ch=${message.channel.id} ` +
                `confidence=${pct}% reason="${result.reason}"`
            );
        } catch (e) {
            console.error('[FurryDetector] Failed to send alert:', e.message);
        }
    }

    async scanMessage(message) {
        if (!this.enabled) return false;
        if (!message.guild || message.guild.id !== FURRY_GUILD_ID) return false;
        if (message.author.bot) return false;

        const urls = this._extractImageUrls(message);
        if (urls.length === 0) return false;

        const now = Date.now();

        // Per-user cooldown
        const last = scanCooldowns.get(message.author.id) || 0;
        if (now - last < SCAN_COOLDOWN_MS) return false;

        // Guild-wide rate limit
        while (guildScanTimestamps.length && now - guildScanTimestamps[0] > GUILD_RATE_WINDOW_MS) {
            guildScanTimestamps.shift();
        }
        if (guildScanTimestamps.length >= GUILD_RATE_MAX) return false;

        scanCooldowns.set(message.author.id, now);
        guildScanTimestamps.push(now);

        for (const url of urls) {
            const img = await this._fetchImage(url);
            if (!img) continue;

            const result = await this._analyzeImage(img.data, img.mime);
            if (result?.furry && result.confidence >= CONFIDENCE_THRESHOLD) {
                await this._sendAlert(message, result);
                return false;
            }
        }

        return false;
    }
}

const _instance = new FurryDetector();

async function scanAndDelete(message) {
    return _instance.scanMessage(message);
}

_instance.scanAndDelete = scanAndDelete;
module.exports = _instance;

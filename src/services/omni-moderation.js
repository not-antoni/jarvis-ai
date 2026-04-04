'use strict';

const { GoogleGenerativeAI } = require('@google/generative-ai');

// ── Config ───────────────────────────────────────────────────────────────────
const FURRY_GUILD_ID = '858444090374881301';
const CONFIDENCE_THRESHOLD = 0.7;

// Rotate through available Google AI keys
const GOOGLE_AI_KEYS = Object.keys(process.env)
    .filter(k => /^GOOGLE_AI_API_KEY\d*$/.test(k))
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
// Don't spam the API — max 1 scan per user per 30s
const scanCooldowns = new Map(); // `userId` -> timestamp
const SCAN_COOLDOWN_MS = 30_000;

// ── Service ──────────────────────────────────────────────────────────────────

class FurryDetector {
    constructor() {
        if (GOOGLE_AI_KEYS.length === 0) {
            console.warn('[FurryDetector] No GOOGLE_AI_API_KEY found — furry detection disabled.');
            this._clients = [];
        } else {
            this._clients = GOOGLE_AI_KEYS.map(k => new GoogleGenerativeAI(k));
            console.log(`[FurryDetector] Loaded ${this._clients.length} Google AI key(s) for guild ${FURRY_GUILD_ID}`);
        }
        this._keyIndex = 0;
    }

    get enabled() {
        return this._clients.length > 0;
    }

    /** Round-robin through available keys */
    _getClient() {
        const client = this._clients[this._keyIndex % this._clients.length];
        this._keyIndex++;
        return client;
    }

    async _fetchImage(url) {
        try {
            const res = await fetch(url);
            if (!res.ok) return null;
            const buf = Buffer.from(await res.arrayBuffer());
            const mime = (res.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
            // Skip non-image types
            if (!mime.startsWith('image/')) return null;
            return { b64: buf.toString('base64'), mime };
        } catch (e) {
            console.warn('[FurryDetector] Failed to fetch image:', e.message);
            return null;
        }
    }

    async _analyzeImage(b64, mime) {
        const client = this._getClient();
        const model = client.getGenerativeModel({ model: 'gemini-2.0-flash-lite' });
        try {
            const result = await model.generateContent([
                DETECTION_PROMPT,
                { inlineData: { data: b64, mimeType: mime } },
            ]);
            const text = result.response.text().trim();
            const match = text.match(/\{[\s\S]*\}/);
            if (!match) return null;
            return JSON.parse(match[0]);
        } catch (e) {
            console.warn('[FurryDetector] Analysis error:', e.message);
            return null;
        }
    }

    /** Collect all image URLs from a message (attachments, embeds, stickers) */
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

    /**
     * Scan a message for furry images. Returns false always (never blocks
     * further message processing — this is a detector, not a filter).
     */
    async scanMessage(message) {
        if (!this.enabled) return false;
        if (!message.guild || message.guild.id !== FURRY_GUILD_ID) return false;
        if (message.author.bot) return false;

        const urls = this._extractImageUrls(message);
        if (urls.length === 0) return false;

        // Per-user cooldown to avoid API spam
        const now = Date.now();
        const last = scanCooldowns.get(message.author.id) || 0;
        if (now - last < SCAN_COOLDOWN_MS) return false;
        scanCooldowns.set(message.author.id, now);

        for (const url of urls) {
            const img = await this._fetchImage(url);
            if (!img) continue;

            const result = await this._analyzeImage(img.b64, img.mime);
            if (result?.furry && result.confidence >= CONFIDENCE_THRESHOLD) {
                await this._sendAlert(message, result);
                return false; // still don't block message processing
            }
        }

        return false;
    }
}

// ── Export with same interface as old omni-moderation ─────────────────────────
const _instance = new FurryDetector();

async function scanAndDelete(message) {
    return _instance.scanMessage(message);
}

_instance.scanAndDelete = scanAndDelete;
module.exports = _instance;

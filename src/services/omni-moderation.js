'use strict';

const OpenAI = require('openai');

// { userId -> Set<guildId> } — only scan this user in the specified guilds.
// Use '*' as a guild ID to scan in ALL guilds.
const MODERATED_USERS = new Map([
    ['1158268473382801488', new Set(['1403664986089324606'])],
]);

// ── Google Cloud Vision OCR ───────────────────────────────────────────────────

const VISION_API_KEY = process.env.GOOGLE || '';
const VISION_API_URL = 'https://vision.googleapis.com/v1/images:annotate';

async function ocrImage(b64) {
    if (!VISION_API_KEY) return null;
    try {
        const res = await fetch(`${VISION_API_URL}?key=${VISION_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                requests: [{
                    image: { content: b64 },
                    features: [{ type: 'TEXT_DETECTION', maxResults: 1 }],
                }],
            }),
        });
        if (!res.ok) {
            console.warn(`[OmniMod/OCR] Vision API HTTP ${res.status}`);
            return null;
        }
        const data = await res.json();
        const text = data?.responses?.[0]?.fullTextAnnotation?.text
            || data?.responses?.[0]?.textAnnotations?.[0]?.description
            || null;
        return text ? text.trim() : null;
    } catch (e) {
        console.warn('[OmniMod/OCR] Vision API request failed:', e.message);
        return null;
    }
}

// ── Multi-message buffer ──────────────────────────────────────────────────────
// Accumulates recent messages per user+guild to catch split-word bypasses
// across multiple messages (e.g. "n" "i" "g" "g" "e" "r" sent one per message).

const BUFFER_WINDOW_MS = 120_000; // 2 minutes — covers slow single-letter bypasses (1-10s delays)
const BUFFER_MAX       = 30;      // max messages to retain per user per guild

// ── Bypass timeout anti-spam ──────────────────────────────────────────────────
// If the user triggers 3 deletions within 60 seconds → 10-second auto-delete timeout
const BYPASS_TIMEOUT_MS   = 10_000;   // 10 seconds timeout
const BYPASS_WINDOW_MS    = 60_000;   // look back 60 seconds
const MAX_BYPASS_ATTEMPTS = 3;        // 3 bypasses = timeout

const bypassTracker = new Map(); // userId -> { timestamps: number[], timeoutUntil?: number }

class MessageBuffer {
    constructor() {
        // key: `userId:guildId` -> [{ text, messageId, channelId, ts }]
        this._buffers = new Map();
    }

    _key(userId, guildId) { return `${userId}:${guildId}`; }

    /**
     * Push a new message into the buffer and return the current window's entries.
     */
    push(userId, guildId, text, messageId, channelId) {
        const key = this._key(userId, guildId);
        const now = Date.now();
        let entries = this._buffers.get(key) || [];

        // Prune old entries outside the window
        entries = entries.filter(e => now - e.ts < BUFFER_WINDOW_MS);

        entries.push({ text, messageId, channelId, ts: now });

        // Cap to max
        if (entries.length > BUFFER_MAX) entries = entries.slice(-BUFFER_MAX);

        this._buffers.set(key, entries);
        return entries;
    }

    /**
     * Clear all buffered entries for a user+guild (after deletion).
     */
    clear(userId, guildId) {
        this._buffers.delete(this._key(userId, guildId));
    }

    /**
     * Evict all entries older than BUFFER_WINDOW_MS (call periodically).
     */
    prune() {
        const now = Date.now();
        for (const [key, entries] of this._buffers) {
            const fresh = entries.filter(e => now - e.ts < BUFFER_WINDOW_MS);
            if (fresh.length === 0) this._buffers.delete(key);
            else this._buffers.set(key, fresh);
        }
    }
}

const msgBuffer = new MessageBuffer();
// Prune stale buffers every minute
setInterval(() => msgBuffer.prune(), 60_000).unref();

// ── Main service ──────────────────────────────────────────────────────────────

class OmniModerationService {
    constructor() {
        this.apiKey = process.env.OPENAI_API_KEY || process.env.OPENAI || '';
        this.client = this.apiKey ? new OpenAI({ apiKey: this.apiKey }) : null;
        if (!this.client) {
            console.warn('[OmniMod] No OpenAI API key found — omni-moderation disabled.');
        }
        if (!VISION_API_KEY) {
            console.warn('[OmniMod] No GOOGLE API key found — OCR on images disabled.');
        }
    }

    get enabled() {
        return Boolean(this.client);
    }

    isMonitored(userId, guildId) {
        const guilds = MODERATED_USERS.get(userId);
        if (!guilds) return false;
        return guilds.has('*') || guilds.has(guildId);
    }

    async _fetchImage(url) {
        try {
            const res = await fetch(url);
            if (!res.ok) return null;
            const buf = Buffer.from(await res.arrayBuffer());
            const mime = (res.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
            return { b64: buf.toString('base64'), mime };
        } catch (e) {
            console.warn('[OmniMod] Failed to fetch image:', e.message);
            return null;
        }
    }

    /**
     * Collapse single-char-per-line and single-char-per-space evasion patterns.
     * e.g. "n\ni\ng\ng\ne\nr" -> "nigger", "n i g g e r" -> "nigger"
     * Also catches dotted/hyphen/underscore/etc. versions: "n.i.g.g.e.r", "n-i-g", etc.
     * Returns array of unique variants (original + normalized).
     */
    _normalizeEvasion(text) {
        if (!text) return [text];

        const lines = text.split('\n');
        const chunks = [];
        let building = '';
        for (const line of lines) {
            const t = line.trim();
            if (t.length === 1) {
                building += t;
            } else {
                if (building) { chunks.push(building); building = ''; }
                if (t) chunks.push(t);
            }
        }
        if (building) chunks.push(building);
        const lineCollapsed = chunks.join(' ');

        // Collapse "n i g g e r" -> "nigger"
        const spaceCollapsed = lineCollapsed.replace(/\b([a-zA-Z0-9])( [a-zA-Z0-9])+\b/g, m => m.replace(/ /g, ''));

        // ── Aggressive collapse for ANY separator evasion ──
        // Catches n.i.g.g.e.r, n-i-g-g-e-r, n_i_g, n/i/g, n|i|g, etc.
        const separatorCollapsed = lineCollapsed.replace(/[^a-zA-Z0-9]+/g, '');

        const variants = [text];
        if (lineCollapsed !== text) variants.push(lineCollapsed);
        if (spaceCollapsed !== lineCollapsed && spaceCollapsed !== text) variants.push(spaceCollapsed);
        if (separatorCollapsed !== lineCollapsed &&
            separatorCollapsed !== spaceCollapsed &&
            separatorCollapsed !== text) variants.push(separatorCollapsed);

        return [...new Set(variants)];
    }

    async _buildInput(message, extraText = null) {
        const input = [];

        // Plain text + evasion-normalized variants
        const text = typeof message.content === 'string' ? message.content.trim() : '';
        if (text) {
            for (const variant of this._normalizeEvasion(text)) {
                input.push({ type: 'text', text: variant });
            }
        }

        // Extra text (e.g. concatenated buffer) passed in separately
        if (extraText) {
            for (const variant of this._normalizeEvasion(extraText)) {
                input.push({ type: 'text', text: variant });
            }
        }

        const addImage = async (url, label) => {
            const img = await this._fetchImage(url);
            if (!img) return;
            input.push({
                type: 'image_url',
                image_url: { url: `data:${img.mime};base64,${img.b64}` },
            });
            const ocrText = await ocrImage(img.b64);
            if (ocrText) {
                console.log(`[OmniMod/OCR] ${label} — extracted ${ocrText.length} chars`);
                input.push({ type: 'text', text: ocrText });
            }
        };

        for (const [, attachment] of message.attachments) {
            const ct = (attachment.contentType || '').toLowerCase();
            if (ct.startsWith('image/')) {
                await addImage(attachment.url, `attachment=${attachment.id}`);
            }
        }

        for (const embed of message.embeds) {
            const parts = [embed.title, embed.description, embed.footer?.text]
                .filter(Boolean).join(' ').trim();
            if (parts) input.push({ type: 'text', text: parts });
            for (const field of (embed.fields || [])) {
                const fieldText = [field.name, field.value].filter(Boolean).join(': ').trim();
                if (fieldText) input.push({ type: 'text', text: fieldText });
            }
            const imgUrl = embed.image?.url || embed.thumbnail?.url;
            if (imgUrl) await addImage(imgUrl, 'embed-image');
        }

        return input;
    }

    async _callApi(input) {
        const startedAt = Date.now();
        try {
            const result = await this.client.moderations.create({
                model: 'omni-moderation-latest',
                input,
            });
            const ms = Date.now() - startedAt;
            const res = result?.results?.[0];
            if (!res) return null;
            return { ...res, ms };
        } catch (error) {
            const ms = Date.now() - startedAt;
            console.error(`[OmniMod] Scan error ms=${ms}:`, error?.message || error);
            return null;
        }
    }

    async scan(message, extraText = null) {
        if (!this.client) return null;

        const input = await this._buildInput(message, extraText);
        if (input.length === 0) return null;

        const res = await this._callApi(input);
        if (!res) return null;

        if (res.flagged) {
            const active = Object.entries(res.categories || {})
                .filter(([, v]) => v)
                .map(([k]) => {
                    const inputTypes = (res.category_applied_input_types?.[k] || []).join('+') || 'unknown';
                    return `${k}(${inputTypes})`;
                })
                .join(', ');
            console.log(
                `[OmniMod] FLAGGED user=${message.author.id} guild=${message.guild?.id} ` +
                `channel=${message.channel?.id} msgId=${message.id} ` +
                `categories=[${active}] ms=${res.ms}`
            );
        } else {
            console.log(
                `[OmniMod] OK user=${message.author.id} guild=${message.guild?.id} ` +
                `msgId=${message.id} ms=${res.ms}`
            );
        }

        return { flagged: res.flagged, categories: res.categories };
    }
}

const _instance = new OmniModerationService();

async function scanAndDelete(message) {
    if (!_instance.enabled) return false;
    if (!message.guild) return false;
    const userId = message.author?.id;
    const guildId = message.guild.id;
    if (!_instance.isMonitored(userId, guildId)) return false;

    // ── Bypass spam timeout check (10-second auto-delete punishment) ──
    const tracker = bypassTracker.get(userId);
    if (tracker?.timeoutUntil && Date.now() < tracker.timeoutUntil) {
        try {
            await message.delete().catch(() => {});
            console.log(`[OmniMod] Timeout auto-delete for user=${userId}`);
        } catch (_) {}
        return true; // handled (deleted)
    }

    const text = typeof message.content === 'string' ? message.content.trim() : '';

    // Push into buffer and get current window entries
    const entries = msgBuffer.push(userId, guildId, text, message.id, message.channel.id);

    // Build concatenated buffer text (all recent messages joined)
    const bufferText = entries.map(e => e.text).filter(Boolean).join(' ');
    const isMultiMsg = entries.length > 1;

    try {
        // Pass buffer text as extraText so multi-message bypasses are caught
        const result = await _instance.scan(message, isMultiMsg ? bufferText : null);

        if (result?.flagged) {
            // Delete all buffered messages in this window, not just the current one
            const toDelete = [...entries];
            msgBuffer.clear(userId, guildId);

            await Promise.allSettled(
                toDelete.map(async (entry) => {
                    try {
                        const channel = message.guild.channels.cache.get(entry.channelId)
                            || await message.guild.channels.fetch(entry.channelId).catch(() => null);
                        if (!channel) return;
                        const msg = entry.messageId === message.id
                            ? message
                            : await channel.messages.fetch(entry.messageId).catch(() => null);
                        if (msg) await msg.delete().catch(err =>
                            console.warn('[OmniMod] Could not delete message:', err.message)
                        );
                    } catch (e) {
                        console.warn('[OmniMod] Error deleting buffered message:', e.message);
                    }
                })
            );

            if (toDelete.length > 1) {
                console.log(`[OmniMod] Deleted ${toDelete.length} buffered messages from user=${userId}`);
            }

            // ── Track bypass attempts and apply timeout if needed ──
            let t = bypassTracker.get(userId);
            if (!t) {
                t = { timestamps: [] };
                bypassTracker.set(userId, t);
            }
            const now = Date.now();
            t.timestamps.push(now);
            // Keep only timestamps from the last 60 seconds
            t.timestamps = t.timestamps.filter(ts => now - ts < BYPASS_WINDOW_MS);

            if (t.timestamps.length >= MAX_BYPASS_ATTEMPTS) {
                t.timeoutUntil = now + BYPASS_TIMEOUT_MS;
                console.log(`[OmniMod] 🚫 Bypass timeout applied to user=${userId} for 10s (${t.timestamps.length} attempts in last 60s)`);
                msgBuffer.clear(userId, guildId); // clean buffer
            }

            return true;
        }
    } catch (e) {
        console.error('[OmniMod] Unexpected error during scanAndDelete:', e.message);
    }
    return false;
}

_instance.scanAndDelete = scanAndDelete;
module.exports = _instance;

'use strict';

const { generateText } = require('ai');
const { createOpenAI } = require('@ai-sdk/openai');
const { PermissionFlagsBits, escapeMarkdown } = require('discord.js');
const { sanitizePings } = require('../utils/sanitize');
const { isOwner: isOwnerCheck } = require('../utils/owner-check');

// ── Config ───────────────────────────────────────────────────────────────────
const FURRY_GUILD_ID = '858444090374881301';
const CONFIDENCE_THRESHOLD = 0.92;
const MODEL_ID = 'google/gemini-2.5-flash';

// Contingency settings
const CONTINGENCY_WINDOW_MS = 120_000;       // 2 minute rolling window
const CONTINGENCY_THRESHOLD = 3;             // 3 detections = contingency
const CONTINGENCY_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes timeout
const CONTINGENCY_ALERT_EXPIRE_MS = 60_000;  // 1 minute

// Robustness timeouts
const FETCH_IMAGE_TIMEOUT_MS = 4_000;        // 4s max to download image
const AI_ANALYSIS_TIMEOUT_MS = 15_000;       // 15s max for AI response

// Vercel AI Gateway keys
const GATEWAY_KEYS = Object.keys(process.env)
    .filter(k => /^AI_GATEWAY_API_KEY\d*$/.test(k))
    .sort()
    .map(k => process.env[k])
    .filter(Boolean);

const DETECTION_PROMPT = [
    'Analyze this image. Does it contain cringe content?',
    '',
    '=== CRITICAL ANTI-LOOP RULE (MUST FOLLOW FIRST - HIGHEST PRIORITY) ===',
    'If the image is a screenshot of a Discord bot alert that contains ANY of the following:',
    '- Text like "🚨 **FURRY CONTENT DETECTED** 🚨", "**CRINGE ANIME CONTENT DETECTED**", "**NSFW CONTENT DETECTED**", or "**CRINGE CONTENT DETECTED**"',
    '- Multiple 🚨 siren emojis and 💀 skull emojis',
    '- A user posting cringe named by nickname or mention, confidence percentage, reason, owner ping, and a "[Jump to message]" link',
    '- Looks like a Discord message from the cringe/furry detector bot',
    'THEN this is a screenshot of THIS bot\'s own alert. Force the following JSON:',
    '{"cringe": false, "confidence": 0.0, "type": "none", "reason": "screenshot of bot alert - ignored to prevent infinite loop"}',
    'Do NOT analyze the alert text as cringe content. This rule has highest priority.',
    '',
    '=== NORMAL CRINGE DETECTION (only if the anti-loop rule above does NOT match) ===',
    'IMPORTANT CLARIFICATION ABOUT TEXT (read this before anything else):',
    '• Do NOT flag an image just because it contains the words "furry", "cringe", "anime", "NSFW", "boykisser", or similar as text overlay, caption, label, meme text, or watermark.',
    '• Text alone is NEVER enough to trigger. Only trigger on the actual VISUAL content described below.',
    '• A plain image that says "literally furry" or "this is furry" with no anthropomorphic animals is NOT cringe.',
    '• Do not trigger on a normal animal photo unless it clearly has human-like clothing, posture, facial expression, props, or a furry-fandom aesthetic.',
    '',
    'Cringe content includes ANY of the following VISUAL elements:',
    '',
    'FURRY:',
    '- Anthropomorphic animal characters (animals with human features: standing upright, wearing clothes, human expressions/poses, hands, etc.)',
    '- Furry fandom artwork, fursona art',
    '- The "boykisser" meme or similar furry memes that actually show the character',
    '- Stylized cartoon/anime animals with a distinctly "furry fandom" aesthetic',
    '- Furry pride/community flags, banners, or emblems, especially striped flag designs with a central paw print or other furry fandom symbol',
    '- If the image is clearly a furry pride/fandom flag or identity symbol, treat it as furry even if no animal character is shown',
    '',
    'CRINGE ANIME:',
    '- Ahegao faces or expressions (exaggerated orgasmic anime face with rolled-back eyes, tongue out)',
    '- Ahegao hoodies, clothing, stickers, or merchandise (only if the visual shows them)',
    '- Hentai or ecchi artwork',
    '- Waifu body pillows (dakimakura)',
    '- Overly sexualized anime characters',
    '',
    'NSFW / SOFT PORN:',
    '- Revealing, sexually suggestive images or GIFs (real or drawn)',
    '- Bikini/lingerie thirst traps, twerking, stripper-type content',
    '- Barely censored nudity, see-through clothing, extreme cleavage',
    '- Suggestive poses clearly meant to be sexual',
    '- Porn stars, OnlyFans-type content, or anything you would not open at work',
    '',
    'NOT cringe (explicitly allowed):',
    '- Normal selfies, swimwear at a beach in a casual context, regular anime screenshots, standard profile pictures, normal animal photos',
    '- Images that are just text, memes, or screenshots containing the word "furry" or "cringe" without any of the visual elements above',
    '- Discord UI screenshots, chat logs, or bot messages that do not match the anti-loop rule',
    '- Regular cartoon animals in a non-furry style (e.g. Disney, normal memes)',
    '- Generic paw logos, pet branding, veterinary graphics, or ordinary animal paw icons without clear furry fandom/identity context',
    '',
    'Respond with ONLY valid JSON, no markdown:',
    '{"cringe": true/false, "confidence": 0.0-1.0, "type": "furry"|"anime"|"nsfw"|"none", "reason": "brief description"}',
].join('\n');

// ── Rate limiting ────────────────────────────────────────────────────────────
const scanCooldowns = new Map();       // userId -> timestamp
const SCAN_COOLDOWN_MS = 3_000;
const guildScanTimestamps = [];        // rolling window of guild-wide scans
const GUILD_RATE_WINDOW_MS = 60_000;
const GUILD_RATE_MAX = 60;

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Races a promise against a timeout. Rejects with a timeout error if the
 * promise doesn't resolve within `ms` milliseconds.
 */
function withTimeout(promise, ms, label = 'operation') {
    let timer;
    const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`[FurryDetector] ${label} timed out after ${ms}ms`)), ms);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
}

function matchesAkameIdentity(user, member = null) {
    if (!user) return false;

    const target = 'akame';
    const candidateNames = [
        user.username,
        user.globalName,
        user.displayName,
        member?.displayName,
        member?.nickname
    ];

    return candidateNames.some(name =>
        typeof name === 'string' && name.trim().toLowerCase() === target
    );
}

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

        // Contingency system
        this.recentDetections = []; // rolling 1 minute window of detections
        this.activeContingency = null;
    }

    get enabled() {
        return this._providers.length > this._deadKeys.size;
    }

    _getProvider() {
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
            const controller = new AbortController();
            const fetchPromise = fetch(url, { signal: controller.signal });

            let res;
            try {
                res = await withTimeout(fetchPromise, FETCH_IMAGE_TIMEOUT_MS, `image fetch for ${url}`);
            } catch (e) {
                controller.abort();
                console.warn('[FurryDetector] Image fetch timed out or failed:', e.message);
                return null;
            }

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
        const availableAttempts = this._providers.length - this._deadKeys.size;
        for (let attempt = 0; attempt < availableAttempts; attempt++) {
            const pick = this._getProvider();
            if (!pick) return null;

            try {
                const b64url = `data:${mime};base64,${imageData.toString('base64')}`;

                const aiCall = generateText({
                    model: pick.provider(MODEL_ID),
                    messages: [{
                        role: 'user',
                        content: [
                            { type: 'text', text: DETECTION_PROMPT },
                            { type: 'image', image: b64url },
                        ],
                    }],
                });

                const { text } = await withTimeout(aiCall, AI_ANALYSIS_TIMEOUT_MS, 'AI image analysis');
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

    _pruneDetections() {
        const cutoff = Date.now() - CONTINGENCY_WINDOW_MS;
        this.recentDetections = this.recentDetections.filter(d => d.timestamp >= cutoff);
    }

    _buildContingencyViolatorEntry(detection) {
        return {
            userId: detection.userId,
            type: detection.type,
            confidence: detection.confidence,
            messageUrl: detection.messageUrl,
            channelId: detection.channelId,
            timestamp: detection.timestamp,
            reason: `${detection.type} ${Math.round(detection.confidence * 100)}%`
        };
    }

    _mergeDetectionIntoActiveContingency(detection) {
        if (!this.activeContingency) return false;

        if (!this.activeContingency.violatorIds) {
            this.activeContingency.violatorIds = new Set(
                (this.activeContingency.violators || []).map(v => v.userId)
            );
        }

        if (this.activeContingency.violatorIds.has(detection.userId)) {
            return false;
        }

        this.activeContingency.violatorIds.add(detection.userId);
        this.activeContingency.violators.push(this._buildContingencyViolatorEntry(detection));
        return true;
    }

    _refreshActiveContingencyFromRecentDetections() {
        if (!this.activeContingency) return 0;

        let added = 0;
        for (const detection of this.recentDetections) {
            if (this._mergeDetectionIntoActiveContingency(detection)) {
                added++;
            }
        }
        return added;
    }

    _collectContingencyViolators() {
        const merged = new Map();

        for (const detection of this.recentDetections) {
            if (!merged.has(detection.userId)) {
                merged.set(detection.userId, this._buildContingencyViolatorEntry(detection));
            }
        }

        if (this.activeContingency?.violators?.length) {
            for (const violator of this.activeContingency.violators) {
                if (!merged.has(violator.userId)) {
                    merged.set(violator.userId, { ...violator });
                }
            }
        }

        return Array.from(merged.values());
    }

    async _triggerContingency(message) {
        const violators = this._collectContingencyViolators();

        const channel = message.channel;
        const e = id => message.client.emojis.cache.get(id)?.toString() || '';
        const siren = e('931641762781491301') || '🚨';
        const checkMark = '✅';

        const alertText =
            `${siren}${siren}${siren} **WARNING!!! Multiple violations of anti-cringe content detected in a 1 minute window** ${siren}${siren}${siren}\n\n` +
            `Requesting immediate contingency protocols activation by having one of the admins reacting with ${checkMark} on this message.\n\n` +
            `(this alert expires in 1 minute)`;

        try {
            const sentMessage = await channel.send(alertText);

            this.activeContingency = {
                messageId: sentMessage.id,
                channelId: sentMessage.channel.id,
                message: sentMessage,
                status: 'armed',
                triggeredAt: Date.now(),
                violatorIds: new Set(violators.map(v => v.userId)),
                violators: violators.map(v => ({
                    userId: v.userId,
                    type: v.type,
                    confidence: v.confidence,
                    messageUrl: v.messageUrl,
                    channelId: v.channelId,
                    timestamp: v.timestamp,
                    reason: `${v.type} ${Math.round(v.confidence * 100)}%`
                }))
            };

            console.log(`[CringeDetector] CONTINGENCY TRIGGERED — ${violators.length} unique users in 1 minute window`);

            // Auto-expire after 1 minute
            setTimeout(async () => {
                if (this.activeContingency && this.activeContingency.messageId === sentMessage.id) {
                    if (this.activeContingency.status === 'executing') {
                        return;
                    }
                    try {
                        await sentMessage.delete().catch(() => {});
                        console.log('[CringeDetector] Contingency alert expired after 1 minute');
                    } catch (e) {}
                    this.activeContingency = null;
                }
            }, CONTINGENCY_ALERT_EXPIRE_MS);

        } catch (e) {
            console.error('[FurryDetector] Failed to send contingency alert:', e.message);
        }
    }

    _updateActiveContingency() {
        if (!this.activeContingency) return;

        const added = this._refreshActiveContingencyFromRecentDetections();
        if (added > 0) {
            console.log(`[CringeDetector] Added ${added} more users to active contingency list`);
        }
    }

    async _applyDetectionTimeout(message, result) {
        const pct = Math.round(result.confidence * 100);
        const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);

        let timedOut = false;
        try {
            if (member && !member.isCommunicationDisabled()) {
                await member.timeout(5 * 1000, `Cringe detector: ${result.type} content (${pct}% confidence)`);
                timedOut = true;
            }
        } catch (_) {}

        return { member, pct, timedOut };
    }

    async _sendAlert(message, result) {
        try {
            const owner = await message.guild.fetchOwner();
            const { member, pct, timedOut } = await this._applyDetectionTimeout(message, result);
            const e = id => message.client.emojis.cache.get(id)?.toString() || '';
            const siren = e('931641762781491301') || '🚨';
            const skull1 = e('1308419713063325746') || '💀';
            const skull2 = e('1172581116209807450') || '💀';
            const typeLabels = { furry: 'FURRY', anime: 'CRINGE ANIME', nsfw: 'NSFW' };
            const typeLabel = typeLabels[result.type] || 'CRINGE';
            const offenderName = sanitizePings(
                escapeMarkdown(member?.displayName || message.author.globalName || message.author.username || 'Unknown user')
            );
            const safeReason = sanitizePings(result.reason);

            const alert =
                `${siren}${siren}${siren} **${typeLabel} CONTENT DETECTED** ${siren}${siren}${siren}\n` +
                `${owner} — **${offenderName}** posted cringe in ${message.channel} ${skull1}${skull2}\n` +
                `Confidence: **${pct}%** — ${safeReason}\n` +
                `[Jump to message](${message.url})\n` +
                (timedOut ? `⏱️ User has been timed out for 5 seconds.\n` : '') +
                `${siren}${siren}${siren} Recommending to initiate contingency protocols immediately. ${siren}${siren}${siren}`;
            await message.channel.send({
                content: alert,
                allowedMentions: {
                    parse: [],
                    users: [owner.id]
                }
            });
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

        const last = scanCooldowns.get(message.author.id) || 0;
        if (now - last < SCAN_COOLDOWN_MS) return false;

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
            if (result?.cringe && result.confidence >= CONFIDENCE_THRESHOLD) {
                const detection = {
                    timestamp: now,
                    userId: message.author.id,
                    messageUrl: message.url,
                    type: result.type,
                    confidence: result.confidence,
                    channelId: message.channel.id
                };

                if (this.activeContingency) {
                    await this._applyDetectionTimeout(message, result);
                    console.log(`[CringeDetector] Suppressed individual alert for ${message.author.id} because contingency alert is active`);
                    this._mergeDetectionIntoActiveContingency(detection);
                } else {
                    await this._sendAlert(message, result);
                }

                this.recentDetections.push(detection);
                this._pruneDetections();

                if (this.activeContingency) {
                    this._updateActiveContingency();
                }

                if (this.recentDetections.length >= CONTINGENCY_THRESHOLD) {
                    if (!this.activeContingency) {
                        await this._triggerContingency(message);
                    }
                }

                return false;
            }
        }

        return false;
    }

    // ── Funny Execution Sequence with Siren ──
    async handleContingencyReaction(reaction, reactingUser) {
        if (!this.activeContingency) return false;
        if (reaction.message.id !== this.activeContingency.messageId) return false;
        if (reaction.emoji.name !== '✅') return false;
        if (reactingUser.bot) return false;
        if (this.activeContingency.status === 'executing') return false;

        let hasPerm = false;
        try {
            const guild = reaction.message.guild;
            if (guild && guild.id === FURRY_GUILD_ID) {
                const member = await guild.members.fetch(reactingUser.id).catch(() => null);
                if (member) {
                    if (isOwnerCheck(member.id) || matchesAkameIdentity(reactingUser, member)) {
                        hasPerm = true;
                    } else {
                        const perms = member.permissions;
                        if (
                            perms.has(PermissionFlagsBits.KickMembers) ||
                            perms.has(PermissionFlagsBits.BanMembers) ||
                            perms.has(PermissionFlagsBits.ModerateMembers)
                        ) {
                            hasPerm = true;
                        }
                    }
                }
            }
        } catch (e) {
            console.warn('[CringeDetector] Perm check error:', e.message);
        }

        if (!hasPerm) {
            console.log(`[CringeDetector] Non-mod ${reactingUser.id} tried to activate contingency`);
            return false;
        }

        const channel = reaction.message.channel;
        const contingency = this.activeContingency;
        contingency.status = 'executing';
        const siren = reaction.message.client.emojis.cache.get('931641762781491301')?.toString() || '🚨';
        const violators = this._collectContingencyViolators();
        let timedOutCount = 0;

        try {
            // Step 1
            await channel.send(`${siren}${siren}${siren} **ORDERS RECEIVED** ${siren}${siren}${siren}`);
            await new Promise(resolve => setTimeout(resolve, 5000));

            // Step 2
            await channel.send(`${siren}${siren}${siren} **EXECUTING** ${siren}${siren}${siren}`);
            await new Promise(resolve => setTimeout(resolve, 5000));

            // Step 3: Execute timeouts + final message
            const guild = reaction.message.guild;
            const contingencyEndsAt = Date.now() + CONTINGENCY_TIMEOUT_MS;
            for (const violator of violators) {
                const member = await guild.members.fetch(violator.userId).catch(() => null);
                const currentTimeoutEnd = member?.communicationDisabledUntilTimestamp || 0;
                if (member && currentTimeoutEnd < contingencyEndsAt) {
                    try {
                        await member.timeout(CONTINGENCY_TIMEOUT_MS, `Contingency protocols: multiple anti-cringe violations`);
                        timedOutCount++;
                    } catch (err) {
                        console.warn(`[CringeDetector] Failed to timeout ${violator.userId}:`, err.message);
                    }
                }
            }

            await channel.send('**Adios abuenos master**');

            console.log(`[CringeDetector] CONTINGENCY ACTIVATED by ${reactingUser.id} — ${timedOutCount} users timed out for 2min`);

        } catch (e) {
            console.error('[CringeDetector] Failed during contingency execution:', e.message);
        } finally {
            if (this.activeContingency === contingency) {
                this.activeContingency = null;
            }
        }

        return true;
    }
}

const _instance = new FurryDetector();

async function scanAndDelete(message) {
    return _instance.scanMessage(message);
}

_instance.scanAndDelete = scanAndDelete;

module.exports = _instance;

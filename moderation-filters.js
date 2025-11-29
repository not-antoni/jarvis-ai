const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const { PermissionsBitField, EmbedBuilder } = require('discord.js');
const database = require('./database');
const config = require('./config');
const { isFeatureGloballyEnabled } = require('./src/core/feature-flags');

// Storage mode: default to Mongo for Render; optional fallback to file with MODERATION_FILTERS_STORAGE=file
const STORAGE_MODE = (process.env.MODERATION_FILTERS_STORAGE || 'mongo').toLowerCase();
const USE_MONGO = STORAGE_MODE !== 'file';

const DATA_DIR = path.join(__dirname, 'data');
const STATE_PATH = path.join(DATA_DIR, 'moderation-filters.json');

const MEMOIZE_FILTERS_MS = 30 * 1000;
const MAX_WORDS_PER_GUILD = 2000;
const MAX_IMPORT_LINES = 500;
const DELETE_LIMIT_PER_MIN = 20;
const SPAM_WINDOW_MS = 3000;
const SPAM_THRESHOLD = 5;
const TIMEOUT_MS = 30 * 1000;
const TIMEOUT_ESCALATION = [30 * 1000, 5 * 60 * 1000, 60 * 60 * 1000]; // 30s, 5m, 1h
const DM_THROTTLE_MS = 60 * 1000;
const ATTACHMENT_SIZE_LIMIT = 512 * 1024;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const MOD_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const BASELINE_WORDS = [
    'asshole', 'bastard', 'bitch', 'cunt', 'dick', 'douche', 'fag', 'fuck',
    'motherfucker', 'nazi', 'nigga', 'nigger', 'prick', 'slut', 'whore'
];

// ASCII + Cyrillic + simple leet characters to make bypassing harder while avoiding over-blocking.
const CONFUSABLE_MAP = {
    a: 'aа@4', b: 'bв8', c: 'cс', d: 'd', e: 'eе3', f: 'f', g: 'g9', h: 'hн',
    i: 'iі1!|', j: 'j', k: 'kк', l: 'l1|', m: 'mм', n: 'n', o: 'oо0', p: 'pр',
    q: 'q', r: 'r', s: 's$5', t: 'tт7', u: 'u', v: 'v', w: 'w', x: 'xх',
    y: 'yу', z: 'z2'
};

const cache = new Map(); // guildId -> { words, regexPatterns, regex, cachedAt, autoRegexEnabled }
const deleteRate = new Map(); // guildId -> { ts, count }
const spamTracker = new Map(); // guildId -> Map(userId -> { arr: [ts], violations: number })
const dmThrottle = new Map(); // key -> ts
const modCache = new Map(); // guildId -> { mods: Set, cachedAt }

// ---------- Persistence helpers ----------

function ensureDataDir() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadFileState() {
    try {
        if (fs.existsSync(STATE_PATH)) {
            const raw = fs.readFileSync(STATE_PATH, 'utf8');
            if (raw) return JSON.parse(raw);
        }
    } catch (error) {
        console.warn('Failed to load moderation filter state (file):', error);
    }
    return { guilds: {} };
}

function saveFileState(state) {
    try {
        ensureDataDir();
        fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
    } catch (error) {
        console.warn('Failed to persist moderation filter state (file):', error);
    }
}

async function getCollection() {
    if (!USE_MONGO) return null;
    await database.connect();
    return database.db.collection(config.database.collections.moderationFilters);
}

function sanitizeDoc(doc = {}) {
    return {
        guildId: doc.guildId,
        words: Array.isArray(doc.words) ? doc.words.map(normalize) : [],
        regex: Array.isArray(doc.regex) ? doc.regex.map((p) => String(p)) : [],
        autoRegexEnabled: doc.autoRegexEnabled !== false
    };
}

async function loadGuildState(guildId) {
    if (USE_MONGO) {
        const col = await getCollection();
        const now = new Date();
        const result = await col.findOneAndUpdate(
            { guildId },
            {
                $setOnInsert: {
                    guildId,
                    words: [],
                    regex: [],
                    autoRegexEnabled: true,
                    createdAt: now
                },
                $set: { updatedAt: now }
            },
            { upsert: true, returnDocument: 'after' }
        );
        return sanitizeDoc(result.value || {});
    }

    const state = loadFileState();
    if (!state.guilds[guildId]) {
        state.guilds[guildId] = { words: [], regex: [], autoRegexEnabled: true };
        saveFileState(state);
    }
    return sanitizeDoc({ guildId, ...state.guilds[guildId] });
}

async function saveGuildState(guildId, data) {
    const entry = sanitizeDoc({ guildId, ...data });
    if (USE_MONGO) {
        const col = await getCollection();
        const now = new Date();
        await col.updateOne(
            { guildId },
            {
                $set: {
                    words: entry.words,
                    regex: entry.regex,
                    autoRegexEnabled: entry.autoRegexEnabled,
                    updatedAt: now
                },
                $setOnInsert: { createdAt: now }
            },
            { upsert: true }
        );
    } else {
        const state = loadFileState();
        state.guilds[guildId] = {
            words: entry.words,
            regex: entry.regex,
            autoRegexEnabled: entry.autoRegexEnabled
        };
        saveFileState(state);
    }
    cache.delete(guildId); // stale cache
}

// ---------- Helpers ----------

function escapeRegex(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildFlexibleRegex(word) {
    const between = '[^\\p{L}\\p{N}]{0,1}';
    const parts = [];
    for (const ch of word.toLowerCase()) {
        const bucket = CONFUSABLE_MAP[ch] || ch;
        const escaped = bucket.split('').map(escapeRegex).join('');
        parts.push(`[${escaped}]`);
    }
    const core = parts.join(between);
    return `(?<![\\p{L}\\p{N}])${core}(?![\\p{L}\\p{N}])`;
}

function normalize(text) {
    return String(text || '').trim().toLowerCase();
}

function formatList(items, label) {
    if (!items || !items.length) return 'None set';
    const body = items.join('\n');
    if (body.length <= 1000) return body;
    return `${body.slice(0, 980)}...\n(+${items.length} total ${label || 'items'})`;
}

function allowDelete(guildId) {
    const now = Date.now();
    const entry = deleteRate.get(guildId) || { ts: now, count: 0 };
    if (now - entry.ts > 60_000) {
        deleteRate.set(guildId, { ts: now, count: 0 });
        return true;
    }
    if (entry.count >= DELETE_LIMIT_PER_MIN) return false;
    entry.count += 1;
    deleteRate.set(guildId, entry);
    return true;
}

// ---------- Cache + compilation ----------

async function refreshCache(guildId) {
    const entry = await loadGuildState(guildId);
    const regexSet = new Set(entry.regex);
    let dirty = false;

    if (entry.autoRegexEnabled) {
        for (const word of entry.words) {
            const pat = buildFlexibleRegex(word);
            if (!regexSet.has(pat)) {
                regexSet.add(pat);
                entry.regex.push(pat);
                dirty = true;
            }
        }
    }

    if (dirty) {
        await saveGuildState(guildId, entry);
    }

    const compiled = entry.regex.map((p) => {
        try { return new RegExp(p, 'iu'); } catch { return null; }
    }).filter(Boolean);
    
    // Only add wordRegex if autoRegex is disabled (otherwise words are already in regex)
    let wordRegex = [];
    if (!entry.autoRegexEnabled) {
        // Use Unicode word boundaries to match buildFlexibleRegex behavior
        wordRegex = entry.words.map((w) => {
            try {
                return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(w)}(?![\\p{L}\\p{N}])`, 'iu');
            } catch {
                return null;
            }
        }).filter(Boolean);
    }

    const payload = {
        words: [...entry.words],
        regexPatterns: [...entry.regex],
        regex: [...compiled, ...wordRegex],
        autoRegexEnabled: entry.autoRegexEnabled,
        cachedAt: Date.now()
    };

    cache.set(guildId, payload);
    return payload;
}

async function getFilters(guildId) {
    const cached = cache.get(guildId);
    if (cached && cached.cachedAt && Date.now() - cached.cachedAt < MEMOIZE_FILTERS_MS) {
        return cached;
    }
    return refreshCache(guildId);
}

// ---------- Runtime enforcement ----------

async function handleMessage(message) {
    if (!message.guild || message.author.bot) return;
    if (!isFeatureGloballyEnabled('moderationFilters')) return;
    if (!message.content) return;

    // Check bot permissions before processing
    const me = message.guild.members.me || await message.guild.members.fetch(message.client.user.id).catch(() => null);
    if (!me || !me.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
        return; // Bot doesn't have permission to delete messages
    }

    const filters = await getFilters(message.guild.id);
    if (!filters.regex.length) return;

    const content = message.content;
    let matchedPattern = null;
    for (const re of filters.regex) {
        try {
            if (re.test(content)) {
                matchedPattern = re.source;
                if (!allowDelete(message.guild.id)) {
                    console.warn(`[ModerationFilters] Rate limit reached for guild ${message.guild.id}, skipping deletion`);
                    return;
                }
                const deleted = await message.delete().catch((err) => {
                    console.error(`[ModerationFilters] Failed to delete message in guild ${message.guild.id}:`, err.message);
                    return null;
                });
                if (deleted) {
                    console.log(`[ModerationFilters] Deleted message from ${message.author.tag} (${message.author.id}) in ${message.guild.name} (${message.guild.id}) - matched pattern: ${matchedPattern.substring(0, 100)}`);
                    trackSpam(message, matchedPattern);
                }
                return;
            }
        } catch {
            /* ignore bad regex */
        }
    }
}

function trackSpam(message, matchedPattern) {
    const guildId = message.guild.id;
    const userId = message.author.id;
    const now = Date.now();
    if (!spamTracker.has(guildId)) spamTracker.set(guildId, new Map());
    const guildMap = spamTracker.get(guildId);
    const userData = guildMap.get(userId) || { arr: [], violations: 0 };
    userData.arr.push(now);
    while (userData.arr.length && now - userData.arr[0] > SPAM_WINDOW_MS) userData.arr.shift();
    guildMap.set(userId, userData);
    if (userData.arr.length >= SPAM_THRESHOLD) {
        userData.violations = (userData.violations || 0) + 1;
        userData.arr = [];
        guildMap.set(userId, userData);
        applyTimeout(message, userData.violations, matchedPattern).catch(() => {});
    }
}

async function applyTimeout(message, violationCount = 1, matchedPattern = null) {
    const member = message.member;
    if (!member) return;
    
    // Escalate timeout based on violation count
    const timeoutIndex = Math.min(violationCount - 1, TIMEOUT_ESCALATION.length - 1);
    const timeoutDuration = TIMEOUT_ESCALATION[timeoutIndex];
    
    try {
        await member.timeout(timeoutDuration, `Repeated blocked messages (violation #${violationCount})`);
    } catch (err) {
        console.warn(`[ModerationFilters] Failed to timeout user ${member.id} in guild ${message.guild.id}:`, err.message);
        // ignore permission failures
    }
    notifyStaff(message, member, violationCount, matchedPattern).catch(() => {});
}

async function getModerators(guild) {
    const cached = modCache.get(guild.id);
    if (cached && Date.now() - cached.cachedAt < MOD_CACHE_TTL_MS) {
        return cached.mods;
    }

    let mods = guild.members.cache.filter((m) =>
        m.permissions.has(PermissionsBitField.Flags.ManageGuild) || m.permissions.has(PermissionsBitField.Flags.Administrator)
    );

    if (mods.size === 0) {
        try {
            const fetched = await guild.members.fetch({ withPresences: false, limit: 50 });
            mods = fetched.filter((m) =>
                m.permissions.has(PermissionsBitField.Flags.ManageGuild) || m.permissions.has(PermissionsBitField.Flags.Administrator)
            );
        } catch {
            /* ignore */
        }
    }

    const modSet = new Set(mods.map(m => m.id));
    modCache.set(guild.id, { mods: modSet, cachedAt: Date.now() });
    return modSet;
}

async function notifyStaff(message, member, violationCount = 1, matchedPattern = null) {
    const guild = message.guild;
    if (!guild) return;
    const dmKey = `${guild.id}:${member.id}`;
    const last = dmThrottle.get(dmKey) || 0;
    if (Date.now() - last < DM_THROTTLE_MS) return;
    dmThrottle.set(dmKey, Date.now());

    const timeoutIndex = Math.min(violationCount - 1, TIMEOUT_ESCALATION.length - 1);
    const timeoutDuration = TIMEOUT_ESCALATION[timeoutIndex];
    const messagePreview = message.content ? (message.content.length > 200 ? message.content.substring(0, 200) + '...' : message.content) : '[No content]';
    const patternInfo = matchedPattern ? `\nMatched pattern: \`${matchedPattern.substring(0, 100)}${matchedPattern.length > 100 ? '...' : ''}\`` : '';
    
    const summary = `User ${member.user.tag} (${member.id}) timed out for ${Math.round(timeoutDuration / 1000)}s after ${violationCount} violation(s) of blocked messages in #${message.channel?.name || message.channelId}.\n\nMessage content: ${messagePreview}${patternInfo}`;

    try {
        const owner = await guild.fetchOwner();
        await owner.send(summary).catch(() => {});
    } catch {
        // ignore owner DM failure
    }

    const mods = await getModerators(guild);
    for (const modId of mods) {
        if (modId === member.id) continue;
        try {
            const mod = guild.members.cache.get(modId) || await guild.members.fetch(modId).catch(() => null);
            if (mod) await mod.send(summary).catch(() => {});
        } catch {
            /* ignore */
        }
    }
}

// ---------- Mutations ----------

async function upsertWord(guildId, value) {
    const entry = await loadGuildState(guildId);
    const norm = normalize(value);
    if (!norm) return false;
    if (entry.words.includes(norm)) return false;
    if (entry.words.length >= MAX_WORDS_PER_GUILD) return false;

    entry.words.push(norm);
    if (entry.autoRegexEnabled) {
        const flex = buildFlexibleRegex(norm);
        if (!entry.regex.includes(flex)) entry.regex.push(flex);
    }
    await saveGuildState(guildId, entry);
    await refreshCache(guildId);
    return true;
}

async function removeWord(guildId, value) {
    const entry = await loadGuildState(guildId);
    const norm = normalize(value);
    entry.words = entry.words.filter((w) => w !== norm);
    const flex = buildFlexibleRegex(norm);
    entry.regex = entry.regex.filter((r) => r !== flex);
    await saveGuildState(guildId, entry);
    await refreshCache(guildId);
}

async function addRegex(guildId, pattern) {
    const entry = await loadGuildState(guildId);
    if (!entry.regex.includes(pattern)) {
        entry.regex.push(pattern);
        await saveGuildState(guildId, entry);
        await refreshCache(guildId);
    }
}

async function removeRegex(guildId, pattern) {
    const entry = await loadGuildState(guildId);
    entry.regex = entry.regex.filter((r) => r !== pattern);
    await saveGuildState(guildId, entry);
    await refreshCache(guildId);
}

async function setAutoRegex(guildId, enabled, backfill = false) {
    const entry = await loadGuildState(guildId);
    entry.autoRegexEnabled = Boolean(enabled);
    if (enabled && backfill) {
        for (const w of entry.words) {
            const pat = buildFlexibleRegex(w);
            if (!entry.regex.includes(pat)) entry.regex.push(pat);
        }
    }
    await saveGuildState(guildId, entry);
    await refreshCache(guildId);
}

// ---------- Commands ----------

async function handleCommand(interaction) {
    const guildId = interaction.guildId;
    const sub = interaction.options.getSubcommand();

    if (sub === 'add-word') {
        const value = interaction.options.getString('value', true);
        const entry = await loadGuildState(guildId);
        if (entry.words.length >= MAX_WORDS_PER_GUILD) {
            return interaction.reply({ content: 'Word limit reached (2k).', ephemeral: true });
        }
        await upsertWord(guildId, value);
        return interaction.reply({ content: `Added blocked word: \`${normalize(value)}\``, ephemeral: true });
    }

    if (sub === 'remove-word') {
        const value = interaction.options.getString('value', true);
        await removeWord(guildId, value);
        return interaction.reply({ content: `Removed blocked word: \`${normalize(value)}\``, ephemeral: true });
    }

    if (sub === 'add-regex') {
        const pattern = interaction.options.getString('pattern', true).trim();
        try {
            new RegExp(pattern);
        } catch (err) {
            return interaction.reply({ content: `Invalid regex: ${err.message}`, ephemeral: true });
        }
        await addRegex(guildId, pattern);
        return interaction.reply({ content: `Added blocked regex: \`${pattern}\``, ephemeral: true });
    }

    if (sub === 'remove-regex') {
        const pattern = interaction.options.getString('pattern', true).trim();
        await removeRegex(guildId, pattern);
        return interaction.reply({ content: `Removed blocked regex: \`${pattern}\``, ephemeral: true });
    }

    if (sub === 'list') {
        const filters = await getFilters(guildId);
        const embed = new EmbedBuilder()
            .setTitle('Current Filters')
            .setColor(0xff0000)
            .addFields(
                { name: `Words/Phrases (${filters.words.length})`, value: formatList(filters.words, 'words'), inline: true },
                { name: `Regex (${filters.regexPatterns.length})`, value: formatList(filters.regexPatterns, 'regex patterns'), inline: true }
            );
        return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (sub === 'auto-regex') {
        const enabled = interaction.options.getBoolean('enabled', true);
        const backfill = interaction.options.getBoolean('backfill') || false;
        await setAutoRegex(guildId, enabled, backfill);
        return interaction.reply({ content: `Auto-regex ${enabled ? 'enabled' : 'disabled'}.${enabled && backfill ? ' Backfilled.' : ''}`, ephemeral: true });
    }

    if (sub === 'import') {
        const attachment = interaction.options.getAttachment('file', true);
        const mode = interaction.options.getString('mode') || 'words';
        if (!attachment?.url || attachment.size > ATTACHMENT_SIZE_LIMIT) {
            return interaction.reply({ content: 'Provide a text file ≤ 512KB.', ephemeral: true });
        }
        const res = await fetch(attachment.url);
        const text = await res.text();
        const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, MAX_IMPORT_LINES);
        let added = 0;
        if (mode === 'regex') {
            for (const line of lines) {
                try {
                    new RegExp(line);
                    await addRegex(guildId, line);
                    added += 1;
                } catch {
                    /* skip invalid regex */
                }
            }
        } else {
            const entry = await loadGuildState(guildId);
            for (const line of lines) {
                if (entry.words.length >= MAX_WORDS_PER_GUILD) break;
                const ok = await upsertWord(guildId, line);
                if (ok) {
                    added += 1;
                    entry.words.push(normalize(line));
                }
            }
        }
        return interaction.reply({ content: `Imported ${added} ${mode === 'regex' ? 'regex' : 'word'} entries${lines.length === MAX_IMPORT_LINES ? ' (truncated to 500)' : ''}.`, ephemeral: true });
    }

    if (sub === 'baseline') {
        const enabled = interaction.options.getBoolean('enabled', true);
        if (enabled) {
            const entry = await loadGuildState(guildId);
            for (const word of BASELINE_WORDS) {
                if (entry.words.length >= MAX_WORDS_PER_GUILD) break;
                await upsertWord(guildId, word);
            }
            return interaction.reply({ content: 'Baseline loaded (up to 2k cap).', ephemeral: true });
        }
        for (const word of BASELINE_WORDS) {
            await removeWord(guildId, word);
        }
        return interaction.reply({ content: 'Baseline removed.', ephemeral: true });
    }

    if (sub === 'clear-all') {
        await saveGuildState(guildId, { words: [], regex: [], autoRegexEnabled: true });
        await refreshCache(guildId);
        return interaction.reply({ content: 'Cleared all filters for this guild.', ephemeral: true });
    }

    return interaction.reply({ content: 'Unknown subcommand.', ephemeral: true });
}

// ---------- Memory cleanup ----------

function cleanupOldEntries() {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours

    // Clean up deleteRate entries older than 1 hour
    for (const [guildId, entry] of deleteRate.entries()) {
        if (now - entry.ts > 60 * 60 * 1000) {
            deleteRate.delete(guildId);
        }
    }

    // Clean up spamTracker entries
    for (const [guildId, userMap] of spamTracker.entries()) {
        let hasActiveUsers = false;
        for (const [userId, userData] of userMap.entries()) {
            // Remove old timestamps
            userData.arr = userData.arr.filter(ts => now - ts < SPAM_WINDOW_MS);
            if (userData.arr.length === 0 && userData.violations === 0) {
                userMap.delete(userId);
            } else {
                hasActiveUsers = true;
            }
        }
        if (!hasActiveUsers) {
            spamTracker.delete(guildId);
        }
    }

    // Clean up dmThrottle entries older than 1 hour
    for (const [key, ts] of dmThrottle.entries()) {
        if (now - ts > 60 * 60 * 1000) {
            dmThrottle.delete(key);
        }
    }

    // Clean up modCache entries older than TTL
    for (const [guildId, cached] of modCache.entries()) {
        if (now - cached.cachedAt > MOD_CACHE_TTL_MS * 2) {
            modCache.delete(guildId);
        }
    }
}

// Start periodic cleanup
if (typeof setInterval !== 'undefined') {
    setInterval(cleanupOldEntries, CLEANUP_INTERVAL_MS);
}

// ---------- Exports ----------

module.exports = {
    handleMessage,
    handleCommand,
    isModerator: (member) => member && (member.permissions.has(PermissionsBitField.Flags.ManageGuild) || member.permissions.has(PermissionsBitField.Flags.Administrator)),
    getFilters
};

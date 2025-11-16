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
const DM_THROTTLE_MS = 60 * 1000;
const ATTACHMENT_SIZE_LIMIT = 512 * 1024;

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
const spamTracker = new Map(); // guildId -> Map(userId -> [ts])
const dmThrottle = new Map(); // key -> ts

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
    const wordRegex = entry.words.map((w) => new RegExp(`\\b${escapeRegex(w)}\\b`, 'iu'));

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

    const filters = await getFilters(message.guild.id);
    if (!filters.regex.length) return;

    const content = message.content;
    for (const re of filters.regex) {
        try {
            if (re.test(content)) {
                if (!allowDelete(message.guild.id)) return;
                await message.delete().catch(() => {});
                trackSpam(message);
                return;
            }
        } catch {
            /* ignore bad regex */
        }
    }
}

function trackSpam(message) {
    const guildId = message.guild.id;
    const userId = message.author.id;
    const now = Date.now();
    if (!spamTracker.has(guildId)) spamTracker.set(guildId, new Map());
    const guildMap = spamTracker.get(guildId);
    const arr = guildMap.get(userId) || [];
    arr.push(now);
    while (arr.length && now - arr[0] > SPAM_WINDOW_MS) arr.shift();
    guildMap.set(userId, arr);
    if (arr.length >= SPAM_THRESHOLD) {
        guildMap.set(userId, []);
        applyTimeout(message).catch(() => {});
    }
}

async function applyTimeout(message) {
    const member = message.member;
    if (!member) return;
    try {
        await member.timeout(TIMEOUT_MS, 'Repeated blocked messages');
    } catch {
        // ignore permission failures
    }
    notifyStaff(message, member).catch(() => {});
}

async function notifyStaff(message, member) {
    const guild = message.guild;
    if (!guild) return;
    const dmKey = `${guild.id}:${member.id}`;
    const last = dmThrottle.get(dmKey) || 0;
    if (Date.now() - last < DM_THROTTLE_MS) return;
    dmThrottle.set(dmKey, Date.now());

    const summary = `User ${member.user.tag} (${member.id}) timed out for ${Math.round(TIMEOUT_MS / 1000)}s after repeated blocked messages in #${message.channel?.name || message.channelId}.`;

    try {
        const owner = await guild.fetchOwner();
        await owner.send(summary).catch(() => {});
    } catch {
        // ignore owner DM failure
    }

    let mods = guild.members.cache.filter((m) =>
        m.id !== member.id &&
        (m.permissions.has(PermissionsBitField.Flags.ManageGuild) || m.permissions.has(PermissionsBitField.Flags.Administrator))
    );

    if (mods.size === 0) {
        try {
            const fetched = await guild.members.fetch({ withPresences: false, limit: 50 });
            mods = fetched.filter((m) =>
                m.id !== member.id &&
                (m.permissions.has(PermissionsBitField.Flags.ManageGuild) || m.permissions.has(PermissionsBitField.Flags.Administrator))
            );
        } catch {
            /* ignore */
        }
    }

    for (const m of mods.values()) {
        try { await m.send(summary).catch(() => {}); } catch { /* ignore */ }
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
            for (const line of lines) {
                const entry = await loadGuildState(guildId);
                if (entry.words.length >= MAX_WORDS_PER_GUILD) break;
                const ok = await upsertWord(guildId, line);
                if (ok) added += 1;
            }
        }
        return interaction.reply({ content: `Imported ${added} ${mode === 'regex' ? 'regex' : 'word'} entries${lines.length === MAX_IMPORT_LINES ? ' (truncated to 500)' : ''}.`, ephemeral: true });
    }

    if (sub === 'baseline') {
        const enabled = interaction.options.getBoolean('enabled', true);
        if (enabled) {
            for (const word of BASELINE_WORDS) {
                const entry = await loadGuildState(guildId);
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

// ---------- Exports ----------

module.exports = {
    handleMessage,
    handleCommand,
    isModerator: (member) => member && (member.permissions.has(PermissionsBitField.Flags.ManageGuild) || member.permissions.has(PermissionsBitField.Flags.Administrator)),
    getFilters
};

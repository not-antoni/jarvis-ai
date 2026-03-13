'use strict';

const config = require('../../config');
const database = require('./database');

const EMOJI_POSITIVE = '<a:socialcredit:1477736880127869039>';
const EMOJI_NEGATIVE = '<:nosocialcredit:1477737004195123230>';

// Thresholds
const BLOCK_THRESHOLD      = -100000; // -100k = blocked
const ACCEPTABLE_THRESHOLD =  20000;  // 20k = acceptable
const GOOD_THRESHOLD       =  100000; // 100k = fine

// Block duration: 10 minutes
const BLOCK_DURATION_MS = 2 * 60 * 1000;

// Chance to show credit notification (5%)
const NOTIFY_CHANCE = 0.05;

// Chance to react with social credit emoji on user's message
const REACT_CHANCE = 0.08;

// ── Number formatting ──────────────────────────────────────────────────────────

const SUFFIXES = [
    { value: 10n**3n,  symbol: 'k'    },
    { value: 10n**6n,  symbol: 'M'    },
    { value: 10n**9n,  symbol: 'B'    },
    { value: 10n**12n, symbol: 'T'    },
    { value: 10n**15n, symbol: 'Qa'   },
    { value: 10n**18n, symbol: 'Qi'   },
    { value: 10n**21n, symbol: 'Sx'   },
    { value: 10n**24n, symbol: 'Sp'   },
    { value: 10n**27n, symbol: 'Oc'   },
    { value: 10n**30n, symbol: 'No'   },
    { value: 10n**33n, symbol: 'De'   },
    { value: 10n**36n, symbol: 'UDe'  },
    { value: 10n**39n, symbol: 'DDe'  },
    { value: 10n**42n, symbol: 'TDe'  },
    { value: 10n**45n, symbol: 'QaDe' },
    { value: 10n**48n, symbol: 'QiDe' },
    { value: 10n**51n, symbol: 'SxDe' },
    { value: 10n**54n, symbol: 'SpDe' },
    { value: 10n**57n, symbol: 'OcDe' },
    { value: 10n**60n, symbol: 'NoDe' },
    { value: 10n**63n, symbol: 'Vg'   },
    { value: 10n**66n, symbol: 'UVg'  },
    { value: 10n**69n, symbol: 'DVg'  },
    { value: 10n**72n, symbol: 'TVg'  },
    { value: 10n**75n, symbol: 'QaVg' },
    { value: 10n**78n, symbol: 'QiVg' },
    { value: 10n**81n, symbol: 'SxVg' },
    { value: 10n**84n, symbol: 'SpVg' },
    { value: 10n**87n, symbol: 'OcVg' },
    { value: 10n**90n, symbol: 'NoVg' },
    { value: 10n**93n, symbol: 'Tg'   },
];

function formatNumber(value) {
    // ✅ FIX: null-safe conversion before BigInt
    if (value == null) return '0';
    let n = typeof value === 'bigint' ? value : BigInt(value);

    const sign = n < 0n ? '-' : '';
    if (n < 0n) n = -n;

    for (let i = SUFFIXES.length - 1; i >= 0; --i) {
        const { value: threshold, symbol } = SUFFIXES[i];
        if (n >= threshold) {
            const whole     = n / threshold;
            const remainder = n % threshold;
            const decimal   = (remainder * 10n) / threshold;
            return (
                sign +
                whole.toString() +
                (decimal > 0n ? '.' + decimal.toString() : '') +
                symbol
            );
        }
    }

    return sign + n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// ── Mention stripping ─────────────────────────────────────────────────────────
// Remove all bot mentions from content before cringe scoring so a bot nickname
// like "uwu" doesn't penalise the person who just pinged it.

function stripBotMentions(content, client) {
    if (!content || !client) return content;
    return content.replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '').trim();
}

// ── Cringe detection ───────────────────────────────────────────────────────────

// Tier 1: nuclear cringe — instant obliteration
const CRINGE_NUCLEAR = [
    /\*\s*(?:moans?|blushes|purrs?|nuzzles?|licks?\s*(?:lips?|you)|whispers?\s*(?:seductively|softly)|pins?\s*you|straddles?|undress)/i,
    /(?:uwu|owo|nya+h?|rawr\s*x?d|hewwo|pwease|sowwy|glomps?|nuzzle)/i,
    /(?:daddy|mommy|master|senpai)\s*(?:please|~|♥|❤|😩|🥺)/i,
    /~{2,}|♥{2,}|❤{2,}/,
    /\*\s*(?:gets?\s*(?:on\s*(?:knees|all\s*fours)|closer|undressed|naked)|takes?\s*off|strips?|spreads?)/i,
    /(?:breed|knot|mating\s*press|ahegao|hentai)/i,
    /\*\s*(?:tail\s*(?:wags?|swish)|ears?\s*(?:perk|twitch|flatten)|whiskers?\s*twitch)/i,
    /(?:i'?m\s*(?:your|ur)\s*(?:good\s*(?:girl|boy|kitty|pet)|kitten|puppy|slut|toy))/i,
];

// Tier 2: high cringe — heavy penalty
const CRINGE_HIGH = [
    /\*[^*]{3,60}\*(?:\s*\*[^*]{3,60}\*)/,
    /(?:chan|kun|sama|oni+chan)\b/i,
    /(?:b-?baka|tsundere|yandere|waifu|husbando)/i,
    /(?:notices?\s*(?:your|ur)\s*bulge|pounces?\s*on\s*you)/i,
    /(?:^|\s)(?:hehe~|hihi~|teehee|fufufu|ara\s*ara)/i,
    /(?:snuggles?|cuddles?)\s*(?:up\s*(?:to|against)|closer|tightly)/i,
    /(?:i\s*(?:wuv|wub|luv)\s*(?:you|u)|pwetty|wittle|smol\s*bean)/i,
    /(?:role\s*?play|rp)\s*(?:with\s*me|as\s*(?:my|a))/i,
    /(?:be\s*my\s*(?:girlfriend|boyfriend|gf|bf|lover|pet|master))/i,
];

// Tier 3: moderate cringe — noticeable penalty
const CRINGE_MODERATE = [
    /\*[^*]{3,80}\*/,
    /(?:>_<|>\.<|;-;|T_T|TwT|QwQ|UwU|OwO)/,
    /(?:meow|woof|bark)\s*[~!]{2,}/i,
    /(?:so\s*(?:kawaii|sugoi|desu))/i,
    /(?:^|\s):3(?:\s|$)/,
    /(?:headpats?|pats?\s*(?:your|ur)\s*head)/i,
    /(?:(?:you|u)\s*(?:are|r)\s*(?:so\s*)?(?:cute|adorable|precious)\s*[~!♥❤]{1,})/i,
];

function getCringeLevel(text) {
    if (!text || typeof text !== 'string') { return 0n; }
    const lower = text.toLowerCase();

    let score = 0n;

    for (const pattern of CRINGE_NUCLEAR) {
        if (pattern.test(text) || pattern.test(lower)) {
            score += 10n;
            score *= 1000n;
        }
    }

    for (const pattern of CRINGE_HIGH) {
        if (pattern.test(text) || pattern.test(lower)) {
            score += 5n;
            score *= 100n;
        }
    }

    for (const pattern of CRINGE_MODERATE) {
        if (pattern.test(text) || pattern.test(lower)) {
            score += 1n;
            score *= 50n;
        }
    }

    const tildeCount = (text.match(/~/g) || []).length;
    if (tildeCount > 1) {
        score *= (BigInt(tildeCount - 1) ** 2n);
    }

    if (/[!?]{4,}/.test(text) && score > 0n) { score += 15n; }

    if (text.includes('Glory to Stark Industries!')) {
        score *= -1n;
    }

    return score;
}

// ── Credit calculation ─────────────────────────────────────────────────────────

function rollCreditChange(messageContent, client) {
    let socialCreditChange = 0n;

    const content = client ? stripBotMentions(messageContent, client) : messageContent;
    socialCreditChange -= getCringeLevel(content);

    const roll = Math.random();
    if (roll < 0.001) {
        const magnitude = [1e9, 1e10, 1e11, 1e12];
        const pick = magnitude[Math.floor(Math.random() * magnitude.length)];
        socialCreditChange -= BigInt(Math.floor(Math.random() * pick + pick / 10));
    } else if (roll < 0.002) {
        const magnitude = [1e6, 1e7, 1e8, 1e9];
        const pick = magnitude[Math.floor(Math.random() * magnitude.length)];
        socialCreditChange += BigInt(Math.floor(Math.random() * pick + pick / 10));
    } else if (roll < 0.022) {
        socialCreditChange -= BigInt(Math.floor(Math.random() * 15000 + 5000));
    } else if (roll < 0.06) {
        socialCreditChange -= BigInt(Math.floor(Math.random() * 500 + 50));
    } else if (roll < 0.12) {
        socialCreditChange += BigInt(Math.floor(Math.random() * 20000 + 5000));
    } else if (roll < 0.30) {
        socialCreditChange += BigInt(Math.floor(Math.random() * 2000 + 200));
    } else if (roll < 0.50) {
        socialCreditChange += BigInt(Math.floor(Math.random() * 100 + 10));
    }

    return socialCreditChange;
}

// ── Passive recovery ───────────────────────────────────────────────────────────

function getRecoveryBonus(currentScore) {
    if (currentScore >= 0n) { return 0n; }
    const absScore = -currentScore;
    const recovery = Number(absScore) * 0.02;
    return BigInt(Math.min(5000, Math.max(100, Math.floor(recovery))));
}

// ── Notification logic ─────────────────────────────────────────────────────────

function shouldNotify(amount, cringeScore) {
    if (amount === 0n) { return false; }
    if (cringeScore >= 15n) { return true; }
    const absAmount = amount < 0n ? -amount : amount;
    if (absAmount >= 10000n) { return true; }
    return Math.random() < NOTIFY_CHANCE;
}

function shouldReact(cringeScore) {
    if (cringeScore >= 40n) { return true; }
    if (cringeScore >= 15n) { return Math.random() < 0.5; }
    return Math.random() < REACT_CHANCE;
}

function buildNotifyMessage(amount, newScore) {
    const absAmount  = amount < 0n ? -amount : amount;
    const fmtAmount  = formatNumber(absAmount);
    const emoji      = amount > 0n ? EMOJI_POSITIVE : EMOJI_NEGATIVE;
    const spamCount  = absAmount >= 1000000000n ? 7 : absAmount >= 1000000n ? 6 : absAmount >= 30000n ? 5 : absAmount >= 10000n ? 3 : absAmount >= 3000n ? 2 : 1;
    const emojiSpam  = emoji.repeat(spamCount);
    const sign       = amount > 0n ? '+' : '-';

    let msg = `${emojiSpam} ${sign}${fmtAmount} social credit ${emojiSpam}`;

    if (newScore <= -50000n) {
        msg += `\n*current social credit: ${formatNumber(newScore)}* ${EMOJI_NEGATIVE}`;
    } else if (newScore >= BigInt(GOOD_THRESHOLD)) {
        msg += `\n*current social credit: ${formatNumber(newScore)}* ${EMOJI_POSITIVE}`;
    }

    return msg;
}

// ── Database operations ────────────────────────────────────────────────────────

async function getCredit(userId) {
    if (!database.isConnected) { return { score: 0n, blockedUntil: null }; }
    const col = database.getCollection(config.database?.collections?.socialCredit || 'socialCredit');
    if (!col) { return { score: 0n, blockedUntil: null }; }

    const doc = await col.findOne({ userId });
    if (!doc) { return { score: 0n, blockedUntil: null }; }

    // ✅ FIX 1: null-safe BigInt conversion — handle BSON Long or string
    const score = doc.score != null
        ? BigInt(typeof doc.score === 'object' ? doc.score.toString() : doc.score)
        : 0n;
    return { score, blockedUntil: doc.blockedUntil || null };
}

async function adjustCredit(userId, amount) {
    if (!database.isConnected) { return 0n; }
    const col = database.getCollection(config.database?.collections?.socialCredit || 'socialCredit');
    if (!col) { return 0n; }

    const doc          = await col.findOne({ userId });
    const currentScore = doc?.score != null
        ? BigInt(typeof doc.score === 'object' ? doc.score.toString() : doc.score)
        : 0n;
    const newSocialCredit = currentScore + BigInt(amount);

    console.log(currentScore, BigInt(amount));

    // ✅ FIX 2: merged $set — duplicate $set keys silently drop the first one (score was never saving)
    const result = await col.findOneAndUpdate(
        { userId },
        {
            $set: { score: newSocialCredit.toString(), lastUpdated: new Date() },
            $setOnInsert: { userId, createdAt: new Date() }
        },
        { upsert: true, returnDocument: 'after' }
    );

    // ✅ FIX 3: null-safe BigInt on result — driver version differences affect result shape
    const raw      = result?.score ?? result?.value?.score;
    const newScore = raw != null
        ? BigInt(typeof raw === 'object' ? raw.toString() : raw)
        : newSocialCredit;

    if (newScore <= BigInt(BLOCK_THRESHOLD)) {
        await col.updateOne(
            { userId, blockedUntil: null },
            { $set: { blockedUntil: new Date(Date.now() + BLOCK_DURATION_MS) } }
        );
    }

    return newScore;
}

function isBlocked(credit) {
    if (!credit.blockedUntil) { return false; }
    return new Date() < new Date(credit.blockedUntil);
}

async function clearBlock(userId) {
    if (!database.isConnected) { return; }
    const col = database.getCollection(config.database?.collections?.socialCredit || 'socialCredit');
    if (!col) { return; }
    await col.updateOne({ userId }, { $set: { blockedUntil: null, score: (0n).toString() } });
}

function getBlockMessage(credit) {
    const blockedUntil = credit.blockedUntil ? new Date(credit.blockedUntil) : null;
    let timeLeft = '';
    if (blockedUntil) {
        const remaining = blockedUntil.getTime() - Date.now();
        if (remaining > 0) {
            const mins = Math.ceil(remaining / 60000);
            timeLeft = mins > 60 ? `${Math.ceil(mins / 60)} hours` : `${mins} minutes`;
        }
    }

    return `${EMOJI_NEGATIVE}${EMOJI_NEGATIVE}${EMOJI_NEGATIVE}\n\n` +
        `Not enough social credit.\n` +
        `Your social credit: **${formatNumber(credit.score)}**\n` +
        `*this rate limit expires in ${timeLeft || '10 minutes'}*\n\n`;
}

module.exports = {
    getCredit,
    stripBotMentions,
    adjustCredit,
    isBlocked,
    clearBlock,
    getBlockMessage,
    rollCreditChange,
    getCringeLevel,
    shouldNotify,
    shouldReact,
    buildNotifyMessage,
    getRecoveryBonus,
    formatNumber,
    EMOJI_POSITIVE,
    EMOJI_NEGATIVE,
    BLOCK_THRESHOLD,
    ACCEPTABLE_THRESHOLD,
    GOOD_THRESHOLD,
};

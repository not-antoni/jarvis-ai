'use strict';

const database = require('./database');

const EMOJI_POSITIVE = '<a:socialcredit:1477736880127869039>';
const EMOJI_NEGATIVE = '<:nosocialcredit:1477737004195123230>';

// Thresholds
const BLOCK_THRESHOLD = -100000;    // -100k = blocked
const ACCEPTABLE_THRESHOLD = 20000; // 20k = acceptable
const GOOD_THRESHOLD = 100000;      // 100k = fine

// Block duration: 10 minutes
const BLOCK_DURATION_MS = 10 * 60 * 1000;

// Chance to show credit notification (5%)
const NOTIFY_CHANCE = 0.05;

// Chance to react with social credit emoji on user's message
const REACT_CHANCE = 0.08;

// ── Number formatting ──

function formatNumber(n) {
    const abs = Math.abs(n);
    const sign = n < 0 ? '-' : '';
    if (abs >= 1e12) { return sign + (abs / 1e12).toFixed(1).replace(/\.0$/, '') + 'T'; }
    if (abs >= 1e9)  { return sign + (abs / 1e9).toFixed(1).replace(/\.0$/, '') + 'B'; }
    if (abs >= 1e6)  { return sign + (abs / 1e6).toFixed(1).replace(/\.0$/, '') + 'M'; }
    if (abs >= 1e4)  { return sign + (abs / 1e3).toFixed(1).replace(/\.0$/, '') + 'k'; }
    return n.toLocaleString();
}

// ── Cringe detection ──

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
    /\*[^*]{3,60}\*(?:\s*\*[^*]{3,60}\*)/,  // multiple roleplay asterisk actions
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
    /\*[^*]{3,80}\*/,  // single roleplay asterisk action
    /(?:>_<|>\.<|;-;|T_T|TwT|QwQ|UwU|OwO)/,
    /(?:meow|woof|bark)\s*[~!]{2,}/i,
    /(?:so\s*(?:kawaii|sugoi|desu))/i,
    /(?:^|\s):3(?:\s|$)/,
    /(?:headpats?|pats?\s*(?:your|ur)\s*head)/i,
    /(?:(?:you|u)\s*(?:are|r)\s*(?:so\s*)?(?:cute|adorable|precious)\s*[~!♥❤]{1,})/i,
];

function getCringeLevel(text) {
    if (!text || typeof text !== 'string') { return 0; }
    const lower = text.toLowerCase();

    let score = 0;

    for (const pattern of CRINGE_NUCLEAR) {
        if (pattern.test(text) || pattern.test(lower)) {
            score += 100;
        }
    }

    for (const pattern of CRINGE_HIGH) {
        if (pattern.test(text) || pattern.test(lower)) {
            score += 40;
        }
    }

    for (const pattern of CRINGE_MODERATE) {
        if (pattern.test(text) || pattern.test(lower)) {
            score += 15;
        }
    }

    // Bonus multiplier: tilde spam
    const tildeCount = (text.match(/~/g) || []).length;
    if (tildeCount >= 5) { score += 30; }
    else if (tildeCount >= 2) { score += 10; }

    // Bonus: excessive exclamation/question marks with uwu-adjacent text
    if (/[!?]{4,}/.test(text) && score > 0) { score += 15; }

    return score;
}

// ── Credit calculation ──

function rollCreditChange(messageContent) {
    const cringeScore = getCringeLevel(messageContent);

    // Nuclear cringe: instant obliteration
    if (cringeScore >= 100) {
        return -Math.floor(Math.random() * 80000 + 50000); // -50k to -130k
    }

    // High cringe: heavy hit
    if (cringeScore >= 40) {
        return -Math.floor(Math.random() * 30000 + 15000); // -15k to -45k
    }

    // Moderate cringe: noticeable loss
    if (cringeScore >= 15) {
        return -Math.floor(Math.random() * 8000 + 2000); // -2k to -10k
    }

    // Normal message: standard random roll
    const roll = Math.random();
    if (roll < 0.001) {
        // 0.1%: catastrophic — up to -1 trillion
        const magnitude = [1e9, 1e10, 1e11, 1e12];
        const pick = magnitude[Math.floor(Math.random() * magnitude.length)];
        return -Math.floor(Math.random() * pick + pick / 10);
    } else if (roll < 0.002) {
        // 0.1%: jackpot — up to +1 billion
        const magnitude = [1e6, 1e7, 1e8, 1e9];
        const pick = magnitude[Math.floor(Math.random() * magnitude.length)];
        return Math.floor(Math.random() * pick + pick / 10);
    } else if (roll < 0.022) {
        // 2%: random big loss (keeps people on their toes)
        return -Math.floor(Math.random() * 15000 + 5000);
    } else if (roll < 0.06) {
        // 4%: small loss
        return -Math.floor(Math.random() * 500 + 50);
    } else if (roll < 0.12) {
        // 6%: big gain
        return Math.floor(Math.random() * 20000 + 5000);
    } else if (roll < 0.30) {
        // 18%: moderate gain
        return Math.floor(Math.random() * 2000 + 200);
    } else if (roll < 0.50) {
        // 20%: small gain
        return Math.floor(Math.random() * 100 + 10);
    }

    // 50%: no change
    return 0;
}

// ── Notification logic ──

function shouldNotify(amount, cringeScore) {
    if (amount === 0) { return false; }

    // Always notify on cringe detections
    if (cringeScore >= 15) { return true; }

    // Always notify on extreme changes
    if (Math.abs(amount) >= 10000) { return true; }

    // 5% chance for normal changes
    return Math.random() < NOTIFY_CHANCE;
}

function shouldReact(cringeScore) {
    // Always react on cringe
    if (cringeScore >= 40) { return true; }

    // 50% chance on moderate cringe
    if (cringeScore >= 15) { return Math.random() < 0.5; }

    return Math.random() < REACT_CHANCE;
}

function buildNotifyMessage(amount, newScore) {
    const fmtAmount = formatNumber(Math.abs(amount));
    const emoji = amount > 0 ? EMOJI_POSITIVE : EMOJI_NEGATIVE;
    const spamCount = Math.abs(amount) >= 1e9 ? 7 : Math.abs(amount) >= 1e6 ? 6 : Math.abs(amount) >= 30000 ? 5 : Math.abs(amount) >= 10000 ? 3 : Math.abs(amount) >= 3000 ? 2 : 1;
    const emojiSpam = emoji.repeat(spamCount);

    const sign = amount > 0 ? '+' : '-';
    let msg = `${emojiSpam} ${sign}${fmtAmount} social credit ${emojiSpam}`;

    if (newScore <= -50000) {
        msg += `\n*current social credit: ${formatNumber(newScore)}* ${EMOJI_NEGATIVE}`;
    } else if (newScore >= GOOD_THRESHOLD) {
        msg += `\n*current social credit: ${formatNumber(newScore)}* ${EMOJI_POSITIVE}`;
    }

    return msg;
}

// ── Database operations ──

async function getCredit(userId) {
    if (!database.isConnected) { return { score: 0, blockedUntil: null }; }
    const col = database.getCollection('socialCredit');
    if (!col) { return { score: 0, blockedUntil: null }; }

    const doc = await col.findOne({ userId });
    if (!doc) { return { score: 0, blockedUntil: null }; }
    return { score: doc.score || 0, blockedUntil: doc.blockedUntil || null };
}

async function adjustCredit(userId, amount) {
    if (!database.isConnected) { return 0; }
    const col = database.getCollection('socialCredit');
    if (!col) { return 0; }

    const result = await col.findOneAndUpdate(
        { userId },
        {
            $inc: { score: amount },
            $set: { lastUpdated: new Date() },
            $setOnInsert: { userId, createdAt: new Date() }
        },
        { upsert: true, returnDocument: 'after' }
    );

    const newScore = result?.score ?? result?.value?.score ?? 0;

    // If they crossed -100k, set the block timer
    if (newScore <= BLOCK_THRESHOLD) {
        await col.updateOne(
            { userId, blockedUntil: null },
            { $set: { blockedUntil: new Date(Date.now() + BLOCK_DURATION_MS) } }
        );
    }

    return newScore;
}

function isBlocked(credit) {
    if (!credit.blockedUntil) { return false; }
    if (new Date() < new Date(credit.blockedUntil)) { return true; }
    return false;
}

async function clearBlock(userId) {
    if (!database.isConnected) { return; }
    const col = database.getCollection('socialCredit');
    if (!col) { return; }
    await col.updateOne({ userId }, { $set: { blockedUntil: null, score: 0 } });
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
        `Sorry, you are scheduled to do manual labor in China for 4 weeks.\n` +
        `Your social credit: **${formatNumber(credit.score)}**\n` +
        `*this rate limit expires in ${timeLeft || '10 minutes'}*\n\n` +
        `${EMOJI_NEGATIVE}${EMOJI_NEGATIVE}${EMOJI_NEGATIVE}`;
}

module.exports = {
    getCredit,
    adjustCredit,
    isBlocked,
    clearBlock,
    getBlockMessage,
    rollCreditChange,
    getCringeLevel,
    shouldNotify,
    shouldReact,
    buildNotifyMessage,
    formatNumber,
    EMOJI_POSITIVE,
    EMOJI_NEGATIVE,
    BLOCK_THRESHOLD,
    ACCEPTABLE_THRESHOLD,
    GOOD_THRESHOLD
};

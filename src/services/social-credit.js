'use strict';

const database = require('./database');

const EMOJI_POSITIVE = '<a:socialcredit:1477736880127869039>';
const EMOJI_NEGATIVE = '<:nosocialcredit:1477737004195123230>';

// Thresholds
const BLOCK_THRESHOLD = -100000;    // -100k = blocked
const ACCEPTABLE_THRESHOLD = 20000; // 20k = acceptable
const GOOD_THRESHOLD = 100000;      // 100k = fine

// Block duration: 10 minutes 
const BLOCK_DURATION_MS = 2 * 60 * 1000;

// Chance to show credit notification (5%)
const NOTIFY_CHANCE = 0.05;

// Chance to react with social credit emoji on user's message
const REACT_CHANCE = 0.08;

// ── Number formatting ──

const SUFFIXES = [
  { value: 10n**3n,  symbol: "k" },   // thousand
  { value: 10n**6n,  symbol: "M" },   // million
  { value: 10n**9n,  symbol: "B" },   // billion
  { value: 10n**12n, symbol: "T" },   // trillion
  { value: 10n**15n, symbol: "Qa" },  // quadrillion
  { value: 10n**18n, symbol: "Qi" },  // quintillion
  { value: 10n**21n, symbol: "Sx" },  // sextillion
  { value: 10n**24n, symbol: "Sp" },  // septillion
  { value: 10n**27n, symbol: "Oc" },  // octillion
  { value: 10n**30n, symbol: "No" },  // nonillion
  { value: 10n**33n, symbol: "De" },  // decillion
  { value: 10n**36n, symbol: "UDe" }, // undecillion
  { value: 10n**39n, symbol: "DDe" }, // duodecillion
  { value: 10n**42n, symbol: "TDe" }, // tredecillion
  { value: 10n**45n, symbol: "QaDe" },// quattuordecillion
  { value: 10n**48n, symbol: "QiDe" },// quindecillion
  { value: 10n**51n, symbol: "SxDe" },// sexdecillion
  { value: 10n**54n, symbol: "SpDe" },// septendecillion
  { value: 10n**57n, symbol: "OcDe" },// octodecillion
  { value: 10n**60n, symbol: "NoDe" },// novemdecillion
  { value: 10n**63n, symbol: "Vg" },  // vigintillion
  { value: 10n**66n, symbol: "UVg" }, // unvigintillion
  { value: 10n**69n, symbol: "DVg" }, // duovigintillion
  { value: 10n**72n, symbol: "TVg" }, // trevigintillion
  { value: 10n**75n, symbol: "QaVg" },// quattuorvigintillion
  { value: 10n**78n, symbol: "QiVg" },// quinvigintillion
  { value: 10n**81n, symbol: "SxVg" },// sexvigintillion
  { value: 10n**84n, symbol: "SpVg" },// septenvigintillion
  { value: 10n**87n, symbol: "OcVg" },// octovigintillion
  { value: 10n**90n, symbol: "NoVg" },// novemvigintillion
  { value: 10n**93n, symbol: "Tg" },  // trigintillion
];

function formatNumber(value) {
  // normalize input
  let n = typeof value === "bigint" ? value : BigInt(value);

  const sign = n < 0n ? "-" : "";
  if (n < 0n) n = -n;

  // choose the largest applicable suffix by iterating in reverse order
  for (let i = SUFFIXES.length - 1; i >= 0; --i) {
    const { value: threshold, symbol } = SUFFIXES[i];
    if (n >= threshold) {
      const whole = n / threshold;
      const remainder = n % threshold;

      // compute first decimal digit using integer math
      const decimal = (remainder * 10n) / threshold;

      return (
        sign +
        whole.toString() +
        (decimal > 0n ? "." + decimal.toString() : "") +
        symbol
      );
    }
  }

  // small numbers → locale formatting
  return sign + n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
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

    // Bonus multiplier: tilde spam
    const tildeCount = (text.match(/~/g) || []).length;
    if (tildeCount > 1) {
        score *= (BigInt(tildeCount - 1) ** 2n) // exponential multiplier the more tildes you have
    }

    // Bonus: excessive exclamation/question marks with uwu-adjacent text
    if (/[!?]{4,}/.test(text) && score > 0) { score += 15n; }

    if (text.includes("Glory to Stark Industries!")) {
        score *= -1n // Glory to Stark Industries!
    }

    return score;
}

// ── Credit calculation ──

function rollCreditChange(messageContent) {

    let socialCreditChange = 0n // BIGINT TIME BABYEE

    socialCreditChange -= getCringeLevel(messageContent)

    // Normal message: standard random roll
    const roll = Math.random();
    if (roll < 0.001) {
        // 0.1%: catastrophic — up to -1 trillion
        const magnitude = [1e9, 1e10, 1e11, 1e12];
        const pick = magnitude[Math.floor(Math.random() * magnitude.length)];
        socialCreditChange -= BigInt(Math.floor(Math.random() * pick + pick / 10));
    } else if (roll < 0.002) {
        // 0.1%: jackpot — up to +1 billion
        const magnitude = [1e6, 1e7, 1e8, 1e9];
        const pick = magnitude[Math.floor(Math.random() * magnitude.length)];
        socialCreditChange += BigInt(Math.floor(Math.random() * pick + pick / 10));
    } else if (roll < 0.022) {
        // 2%: random big loss (keeps people on their toes)
        socialCreditChange -= BigInt(Math.floor(Math.random() * 15000 + 5000));
    } else if (roll < 0.06) {
        // 4%: small loss
        socialCreditChange -= BigInt(Math.floor(Math.random() * 500 + 50));
    } else if (roll < 0.12) {
        // 6%: big gain
        socialCreditChange += BigInt(Math.floor(Math.random() * 20000 + 5000));
    } else if (roll < 0.30) {
        // 18%: moderate gain
        socialCreditChange += BigInt(Math.floor(Math.random() * 2000 + 200));
    } else if (roll < 0.50) {
        // 20%: small gain
        socialCreditChange += BigInt(Math.floor(Math.random() * 100 + 10));
    }

    // 50%: no change
    return socialCreditChange;
}

// ── Passive recovery ──

function getRecoveryBonus(currentScore) {
    if (currentScore >= 0) { return 0n; }
    // Recover 2% of deficit per message, min 100, max 5000
    return BigInt(Math.min(5000, Math.max(100, Math.floor(Math.abs(currentScore) * 0.02))));
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
    if (!database.isConnected) { return { score: 0n, blockedUntil: null }; }
    const col = database.getCollection('socialCredit');
    if (!col) { return { score: 0n, blockedUntil: null }; }

    const doc = await col.findOne({ userId });
    if (!doc) { return { score: 0n, blockedUntil: null }; }
    return { score: BigInt(doc.score) || 0n, blockedUntil: doc.blockedUntil || null };
}

async function adjustCredit(userId, amount) {
    if (!database.isConnected) { return 0n; }
    const col = database.getCollection('socialCredit');
    if (!col) { return 0n; }

    const credit = await col.findOne({ userId })
    var newSocialCredit = BigInt(doc.score) += BigInt(amount)

    console.logg(BigInt(doc.score), BigInt(amount))

    const result = await col.findOneAndUpdate(
        { userId },
        {
            $set: { score: newSocialCredit.toString() },
            $set: { lastUpdated: new Date() },
            $setOnInsert: { userId, createdAt: new Date() }
        },
        { upsert: true, returnDocument: 'after' }
    );

    const newScore = BigInt(result?.score ?? result?.value?.score ?? 0n);

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
        `*this rate limit expires in ${timeLeft || '10 minutes'}*\n\n`
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
    getRecoveryBonus,
    formatNumber,
    EMOJI_POSITIVE,
    EMOJI_NEGATIVE,
    BLOCK_THRESHOLD,
    ACCEPTABLE_THRESHOLD,
    GOOD_THRESHOLD
};

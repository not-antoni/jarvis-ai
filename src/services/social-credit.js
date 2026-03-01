'use strict';

const database = require('./database');

const EMOJI_POSITIVE = '<a:socialcredit:1477736880127869039>';
const EMOJI_NEGATIVE = '<:nosocialcredit:1477737004195123230>';

// Thresholds
const BLOCK_THRESHOLD = -100000;    // -100k = blocked
const ACCEPTABLE_THRESHOLD = 20000; // 20k = acceptable
const GOOD_THRESHOLD = 100000;      // 100k = fine

// Block duration: 1 hour
const BLOCK_DURATION_MS = 60 * 60 * 1000;

// Chance to show credit notification (5%)
const NOTIFY_CHANCE = 0.05;

// Chance to react with social credit emoji on user's message
const REACT_CHANCE = 0.08;

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

    // If they just crossed -100k, set the block timer
    if (newScore <= BLOCK_THRESHOLD) {
        await col.updateOne(
            { userId, blockedUntil: null },
            { $set: { blockedUntil: new Date(Date.now() + BLOCK_DURATION_MS) } }
        );
    }

    return newScore;
}

function isBlocked(credit) {
    if (credit.score > BLOCK_THRESHOLD) { return false; }
    if (!credit.blockedUntil) { return true; }
    if (new Date() < new Date(credit.blockedUntil)) { return true; }
    return false;
}

async function clearBlock(userId) {
    if (!database.isConnected) { return; }
    const col = database.getCollection('socialCredit');
    if (!col) { return; }
    await col.updateOne({ userId }, { $set: { blockedUntil: null } });
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
        `Your social credit: **${credit.score.toLocaleString()}**\n` +
        `*this rate limit expires in ${timeLeft || '1 hour'}*\n\n` +
        `${EMOJI_NEGATIVE}${EMOJI_NEGATIVE}${EMOJI_NEGATIVE}`;
}

// Roll random credit change for a message interaction
function rollCreditChange() {
    const roll = Math.random();

    if (roll < 0.02) {
        // 2% chance: big loss
        return -Math.floor(Math.random() * 50000 + 10000);
    } else if (roll < 0.05) {
        // 3% chance: moderate loss
        return -Math.floor(Math.random() * 5000 + 1000);
    } else if (roll < 0.15) {
        // 10% chance: small loss
        return -Math.floor(Math.random() * 500 + 50);
    } else if (roll < 0.20) {
        // 5% chance: big gain
        return Math.floor(Math.random() * 30000 + 5000);
    } else if (roll < 0.35) {
        // 15% chance: moderate gain
        return Math.floor(Math.random() * 3000 + 500);
    } else if (roll < 0.55) {
        // 20% chance: small gain
        return Math.floor(Math.random() * 200 + 10);
    }

    // 45% chance: no change
    return 0;
}

function shouldNotify(amount) {
    if (amount === 0) { return false; }

    // Always notify on extreme changes
    if (Math.abs(amount) >= 10000) { return true; }

    // 5% chance for normal changes
    return Math.random() < NOTIFY_CHANCE;
}

function shouldReact() {
    return Math.random() < REACT_CHANCE;
}

function buildNotifyMessage(amount, newScore) {
    const absAmount = Math.abs(amount).toLocaleString();
    const emoji = amount > 0 ? EMOJI_POSITIVE : EMOJI_NEGATIVE;
    const spamCount = Math.abs(amount) >= 10000 ? 3 : Math.abs(amount) >= 3000 ? 2 : 1;
    const emojiSpam = emoji.repeat(spamCount);

    let msg;
    if (amount <= -50000) {
        msg = `${emojiSpam} this prompt made you lose ALL your social credit lmao (-${absAmount}) ${emojiSpam}`;
    } else if (amount <= -10000) {
        msg = `${emojiSpam} this prompt made you lose **${absAmount}** social credit ${emojiSpam}`;
    } else if (amount < 0) {
        msg = `${emoji} -${absAmount} social credit`;
    } else if (amount >= 10000) {
        msg = `${emojiSpam} +${absAmount} social credit, the party is pleased ${emojiSpam}`;
    } else if (amount >= 3000) {
        msg = `${emojiSpam} +${absAmount} social credit ${emojiSpam}`;
    } else {
        msg = `${emoji} +${absAmount} social credit`;
    }

    // Add score context for extreme scores
    if (newScore <= -50000) {
        msg += `\n*current social credit: ${newScore.toLocaleString()}* ${EMOJI_NEGATIVE}`;
    } else if (newScore >= GOOD_THRESHOLD) {
        msg += `\n*current social credit: ${newScore.toLocaleString()}* ${EMOJI_POSITIVE}`;
    }

    return msg;
}

module.exports = {
    getCredit,
    adjustCredit,
    isBlocked,
    clearBlock,
    getBlockMessage,
    rollCreditChange,
    shouldNotify,
    shouldReact,
    buildNotifyMessage,
    EMOJI_POSITIVE,
    EMOJI_NEGATIVE,
    BLOCK_THRESHOLD,
    ACCEPTABLE_THRESHOLD,
    GOOD_THRESHOLD
};

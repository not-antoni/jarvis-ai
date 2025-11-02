const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DISCORD_TOKEN = process.env.DISCORD_TOKEN || 'test-token';
process.env.MONGO_URI_MAIN = process.env.MONGO_URI_MAIN || 'mongodb://localhost:27017/test';
process.env.MONGO_URI_VAULT = process.env.MONGO_URI_VAULT || 'mongodb://localhost:27017/test_vault';
process.env.MASTER_KEY_BASE64 = process.env.MASTER_KEY_BASE64 || Buffer.alloc(32).toString('base64');

const economy = require('../src/core/economy-manager');
const database = require('../database');

test('claimDaily enforces cooldown window', async () => {
    const originalEnsure = database.ensureEconomyProfile;
    try {
        database.ensureEconomyProfile = async () => ({
            lastDailyAt: new Date(),
            streak: 2,
            balance: 750
        });

        await assert.rejects(
            () => economy.claimDaily('guild', 'user'),
            (error) => error.code === economy.ERROR_CODES.COOLDOWN
        );
    } finally {
        database.ensureEconomyProfile = originalEnsure;
    }
});

test('coinflip rejects non-positive wagers', async () => {
    await assert.rejects(
        () => economy.coinflip('guild', 'user', 0, 'heads'),
        (error) => error.code === economy.ERROR_CODES.INSUFFICIENT_FUNDS
    );
});

test('coinflip victory updates balance', async () => {
    const originalEnsure = database.ensureEconomyProfile;
    const originalAdjust = database.adjustEconomyBalance;
    const originalRandom = Math.random;

    try {
        database.ensureEconomyProfile = async () => ({ balance: 100 });
        database.adjustEconomyBalance = async (_guildId, _userId, delta) => ({ balance: 100 + delta });
        Math.random = () => 0.2; // heads

        const result = await economy.coinflip('guild', 'user', 25, 'heads');
        assert.equal(result.didWin, true);
        assert.equal(result.outcome, 'heads');
        assert.equal(result.profile.balance, 125);
    } finally {
        database.ensureEconomyProfile = originalEnsure;
        database.adjustEconomyBalance = originalAdjust;
        Math.random = originalRandom;
    }
});

test('coinflip surfaces insufficient funds from database layer', async () => {
    const originalEnsure = database.ensureEconomyProfile;
    const originalAdjust = database.adjustEconomyBalance;
    const originalRandom = Math.random;

    try {
        database.ensureEconomyProfile = async () => ({ balance: 10 });
        database.adjustEconomyBalance = async () => {
            const error = new Error('insufficient');
            error.code = 'INSUFFICIENT_FUNDS';
            throw error;
        };
        Math.random = () => 0.8; // tails

        await assert.rejects(
            () => economy.coinflip('guild', 'user', 50, 'heads'),
            (error) => error.code === economy.ERROR_CODES.INSUFFICIENT_FUNDS
        );
    } finally {
        database.ensureEconomyProfile = originalEnsure;
        database.adjustEconomyBalance = originalAdjust;
        Math.random = originalRandom;
    }
});

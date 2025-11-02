const assert = require('node:assert/strict');
const test = require('node:test');

process.env.DISCORD_TOKEN = process.env.DISCORD_TOKEN || 'test-token';
process.env.MONGO_URI_MAIN = process.env.MONGO_URI_MAIN || 'mongodb://localhost:27017/test';
process.env.MONGO_URI_VAULT = process.env.MONGO_URI_VAULT || 'mongodb://localhost:27017/test_vault';
process.env.MASTER_KEY_BASE64 = process.env.MASTER_KEY_BASE64 || Buffer.alloc(32).toString('base64');

const leveling = require('../src/core/leveling-manager');

test('xpForLevel follows configured curve', () => {
    assert.equal(leveling.xpForLevel(0), 100);
    assert.equal(leveling.xpForLevel(1), 155);
    assert.equal(leveling.xpForLevel(2), 220);
});

test('totalXpForLevel accumulates correctly', () => {
    assert.equal(leveling.totalXpForLevel(0), 0);
    assert.equal(leveling.totalXpForLevel(1), 100);
    assert.equal(leveling.totalXpForLevel(2), 255);
});

test('calculateLevelProgress computes level and remainder', () => {
    const initial = leveling.calculateLevelProgress(0);
    assert.equal(initial.level, 0);
    assert.equal(initial.xpIntoLevel, 0);

    const levelOne = leveling.calculateLevelProgress(120);
    assert.equal(levelOne.level, 1);
    assert.equal(levelOne.xpIntoLevel, 20);

    const levelTwo = leveling.calculateLevelProgress(300);
    assert.equal(levelTwo.level, 2);
    assert.equal(levelTwo.xpIntoLevel, 45);
});

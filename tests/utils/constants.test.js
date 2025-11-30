/**
 * Tests for constants
 */

const { test } = require('node:test');
const assert = require('node:assert');
const constants = require('../../src/core/constants');

test('Constants: Time constants exist', () => {
    assert.ok(constants.TIME.SECOND === 1000);
    assert.ok(constants.TIME.MINUTE === 60 * 1000);
    assert.ok(constants.TIME.HOUR === 60 * 60 * 1000);
});

test('Constants: Discord limits exist', () => {
    assert.ok(constants.DISCORD.MAX_MESSAGE_LENGTH === 2000);
    assert.ok(constants.DISCORD.MAX_EMBED_TITLE_LENGTH === 256);
});

test('Constants: Rate limits exist', () => {
    assert.ok(constants.RATE_LIMITS.DEFAULT_COOLDOWN_MS > 0);
    assert.ok(constants.RATE_LIMITS.MAX_REQUESTS_PER_MINUTE > 0);
});

test('Constants: HTTP status codes exist', () => {
    assert.ok(constants.HTTP_STATUS.OK === 200);
    assert.ok(constants.HTTP_STATUS.NOT_FOUND === 404);
    assert.ok(constants.HTTP_STATUS.INTERNAL_SERVER_ERROR === 500);
});

test('Constants: Error codes exist', () => {
    assert.ok(constants.ERROR_CODES.INVALID_REQUEST);
    assert.ok(constants.ERROR_CODES.NOT_FOUND);
    assert.ok(constants.ERROR_CODES.INTERNAL_ERROR);
});


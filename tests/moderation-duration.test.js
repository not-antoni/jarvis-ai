'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    parseDuration,
    formatDuration
} = require('../src/services/handlers/moderation-commands');

test('parseDuration — simple units resolve to milliseconds', () => {
    assert.equal(parseDuration('30s'), 30_000);
    assert.equal(parseDuration('10m'), 600_000);
    assert.equal(parseDuration('2h'), 7_200_000);
    assert.equal(parseDuration('1d'), 86_400_000);
    assert.equal(parseDuration('1w'), 604_800_000);
});

test('parseDuration — composite forms sum correctly', () => {
    assert.equal(parseDuration('1h30m'), 3_600_000 + 30 * 60_000);
    assert.equal(parseDuration('2d 4h'), 2 * 86_400_000 + 4 * 3_600_000);
    assert.equal(parseDuration('45min'), 45 * 60_000);
});

test('parseDuration — bare number treated as minutes', () => {
    assert.equal(parseDuration('15'), 15 * 60_000);
});

test('parseDuration — returns null for invalid input', () => {
    assert.equal(parseDuration(''), null);
    assert.equal(parseDuration(null), null);
    assert.equal(parseDuration('nope'), null);
    assert.equal(parseDuration('-1d'), null);
});

test('formatDuration — renders a readable summary', () => {
    assert.equal(formatDuration(10 * 60_000), '10m');
    assert.equal(formatDuration(3_600_000 + 30 * 60_000), '1h 30m');
    assert.equal(formatDuration(86_400_000 + 3_600_000), '1d 1h');
    assert.equal(formatDuration(500), '<1s');
});

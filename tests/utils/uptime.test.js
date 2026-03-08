'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { formatUptime, normalizeUptimeSeconds } = require('../../src/utils/uptime');

test('normalizeUptimeSeconds clamps invalid values to zero', () => {
    assert.equal(normalizeUptimeSeconds(-1), 0);
    assert.equal(normalizeUptimeSeconds('nope'), 0);
    assert.equal(normalizeUptimeSeconds(9.9), 9);
});

test('formatUptime renders compact hour/minute/second values', () => {
    assert.equal(formatUptime(0), '0h 0m 0s');
    assert.equal(formatUptime(65), '0h 1m 5s');
    assert.equal(formatUptime(3661), '1h 1m 1s');
});

test('formatUptime includes days when uptime exceeds 24 hours', () => {
    assert.equal(formatUptime(90061), '1d 1h 1m 1s');
});

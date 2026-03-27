'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseBooleanEnv } = require('../src/utils/parse-bool-env');

test('returns fallback for null/undefined', () => {
    assert.equal(parseBooleanEnv(null), false);
    assert.equal(parseBooleanEnv(undefined), false);
    assert.equal(parseBooleanEnv(null, true), true);
});

test('returns true for truthy strings', () => {
    for (const val of ['1', 'true', 'yes', 'on', 'enabled', 'TRUE', ' Yes ', 'ON']) {
        assert.equal(parseBooleanEnv(val), true, `Expected true for "${val}"`);
    }
});

test('returns false for falsy strings', () => {
    for (const val of ['0', 'false', 'no', 'off', 'disabled', 'FALSE', ' No ']) {
        assert.equal(parseBooleanEnv(val, true), false, `Expected false for "${val}"`);
    }
});

test('returns fallback for unrecognized values', () => {
    assert.equal(parseBooleanEnv('maybe'), false);
    assert.equal(parseBooleanEnv('maybe', true), true);
});

test('handles empty string', () => {
    assert.equal(parseBooleanEnv(''), false);
    assert.equal(parseBooleanEnv('  '), false);
    assert.equal(parseBooleanEnv('', true), true);
});

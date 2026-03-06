/**
 * Tests for sanitize utility
 */

const { test } = require('node:test');
const assert = require('node:assert');
const { sanitizePings } = require('../../src/utils/sanitize');

test('sanitizePings: neutralizes @everyone', () => {
    const result = sanitizePings('hello @everyone');
    assert.ok(!result.includes('@everyone'));
    assert.ok(result.includes('@\u200Beveryone'));
});

test('sanitizePings: neutralizes @here', () => {
    const result = sanitizePings('hello @here');
    assert.ok(!result.includes('@here'));
    assert.ok(result.includes('@\u200Bhere'));
});

test('sanitizePings: neutralizes role mentions', () => {
    const result = sanitizePings('hello <@&123456789012345678>');
    assert.ok(!result.includes('<@&'));
    assert.ok(result.includes('@\u200Brole'));
});

test('sanitizePings: neutralizes user mentions', () => {
    const result = sanitizePings('hello <@123456789012345678>');
    assert.ok(!result.includes('<@1'));
    assert.ok(result.includes('@\u200Buser'));
});

test('sanitizePings: neutralizes nickname user mentions', () => {
    const result = sanitizePings('hello <@!123456789012345678>');
    assert.ok(!result.includes('<@!'));
    assert.ok(result.includes('@\u200Buser'));
});

test('sanitizePings: case insensitive for @everyone and @here', () => {
    assert.ok(sanitizePings('@EVERYONE').includes('@\u200Beveryone'));
    assert.ok(sanitizePings('@Here').includes('@\u200Bhere'));
});

test('sanitizePings: returns empty string for non-string input', () => {
    assert.strictEqual(sanitizePings(null), '');
    assert.strictEqual(sanitizePings(undefined), '');
    assert.strictEqual(sanitizePings(123), '');
});

test('sanitizePings: leaves normal text unchanged', () => {
    assert.strictEqual(sanitizePings('hello world'), 'hello world');
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    estimateTokenCount,
    truncateTextToTokenLimit
} = require('../src/utils/token-estimator');

test('estimateTokenCount returns a sensible value for plain english', () => {
    const text = 'Jarvis, run diagnostics on the arc reactor and keep the answer brief.';
    const estimated = estimateTokenCount(text);

    assert.ok(estimated > 5);
    assert.ok(estimated < text.length);
});

test('estimateTokenCount treats dense CJK text as higher token density', () => {
    const plain = 'a'.repeat(400);
    const dense = '漢'.repeat(400);

    assert.ok(estimateTokenCount(dense) > estimateTokenCount(plain));
});

test('truncateTextToTokenLimit preserves text already under the limit', () => {
    const text = 'Short prompt for Jarvis.';
    const result = truncateTextToTokenLimit(text, 1024);

    assert.equal(result.text, text);
    assert.equal(result.truncated, false);
});

test('truncateTextToTokenLimit trims dense content to the requested limit', () => {
    const text = '漢'.repeat(1500);
    const result = truncateTextToTokenLimit(text, 1024);

    assert.equal(result.truncated, true);
    assert.ok(result.text.length < text.length);
    assert.ok(result.estimatedTokens <= 1024);
});

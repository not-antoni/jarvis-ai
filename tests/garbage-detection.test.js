'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { isGarbageOutput } = require('../src/utils/garbage-detection');

test('returns false for short text', () => {
    assert.equal(isGarbageOutput('Hello world'), false);
});

test('returns false for normal conversational text', () => {
    const normal = 'The quick brown fox jumps over the lazy dog. This is a perfectly normal sentence that contains a variety of different words and should not be flagged as garbage output at all.';
    assert.equal(isGarbageOutput(normal), false);
});

test('returns false for null/empty input', () => {
    assert.equal(isGarbageOutput(null), false);
    assert.equal(isGarbageOutput(''), false);
    assert.equal(isGarbageOutput(undefined), false);
});

test('detects word repetition loops', () => {
    const garbage = Array(60).fill('certainly absolutely certainly').join(' ');
    assert.equal(isGarbageOutput(garbage), true);
});

test('detects high CJK density mixed with English', () => {
    const mixed = 'Hello this is some English text ' + '\u4e00'.repeat(50) + ' more English words here for padding to reach the length requirement';
    assert.equal(isGarbageOutput(mixed), true);
});

test('ignores code blocks in repetition check', () => {
    const codeHeavy = '```js\nfor(;;){console.log("test");console.log("test");console.log("test");}\n```';
    assert.equal(isGarbageOutput(codeHeavy), false);
});

test('returns false for text shorter than 80 chars', () => {
    assert.equal(isGarbageOutput('test test test test test'), false);
});

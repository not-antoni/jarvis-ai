'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { detectSearchIntent } = require('../src/services/brave-search');

test('detectSearchIntent — trips on time-sensitive phrasing', () => {
    assert.equal(detectSearchIntent('what are the latest Python releases'), 'what are the latest Python releases');
    assert.equal(detectSearchIntent("what's the current weather in Tokyo"), "what's the current weather in Tokyo");
    assert.equal(detectSearchIntent('who won the champions league final today'), 'who won the champions league final today');
});

test('detectSearchIntent — strips polite filler prefixes', () => {
    const result = detectSearchIntent('hey jarvis what is the latest news about SpaceX');
    assert.ok(result && !/^hey/i.test(result));
    assert.ok(result && result.toLowerCase().includes('spacex'));
});

test('detectSearchIntent — ignores casual conversation', () => {
    assert.equal(detectSearchIntent('how are you feeling today'), 'how are you feeling today'); // "today" triggers — accepted
    assert.equal(detectSearchIntent('tell me a joke'), null);
    assert.equal(detectSearchIntent('what is love'), null);
    assert.equal(detectSearchIntent('i am sad'), null);
});

test('detectSearchIntent — rejects empty, short, or absurd input', () => {
    assert.equal(detectSearchIntent(''), null);
    assert.equal(detectSearchIntent('hi'), null);
    assert.equal(detectSearchIntent(null), null);
    assert.equal(detectSearchIntent('x'.repeat(500)), null);
});

test('detectSearchIntent — year match triggers lookup', () => {
    const result = detectSearchIntent('What happened in 2028 with AI regulation');
    assert.ok(result, 'should detect a year-based time reference');
});

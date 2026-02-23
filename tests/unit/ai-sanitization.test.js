/**
 * Tests for AI output sanitization — ensures model responses are cleaned
 * before being sent to Discord.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

// Config validation requires these
process.env.DISCORD_TOKEN = process.env.DISCORD_TOKEN || 'test-token';
process.env.MASTER_KEY_BASE64 = process.env.MASTER_KEY_BASE64 || crypto.randomBytes(32).toString('base64');
process.env.LOCAL_DB_MODE = '1';

const { sanitizeAssistantMessage } = require('../../src/services/ai-providers-execution');

test('sanitizeAssistantMessage: returns falsy values unchanged', () => {
    assert.strictEqual(sanitizeAssistantMessage(null), null);
    assert.strictEqual(sanitizeAssistantMessage(undefined), undefined);
    assert.strictEqual(sanitizeAssistantMessage(''), '');
});

test('sanitizeAssistantMessage: normal text passes through', () => {
    const input = 'Good morning, sir. The weather looks promising today.';
    assert.strictEqual(sanitizeAssistantMessage(input), input);
});

test('sanitizeAssistantMessage: strips thinking tags', () => {
    const input = '<thinking>Internal reasoning here</thinking>The actual response.';
    assert.strictEqual(sanitizeAssistantMessage(input), 'The actual response.');
});

test('sanitizeAssistantMessage: strips <think> tags', () => {
    const input = '<think>let me reason about this</think>Here is your answer.';
    assert.strictEqual(sanitizeAssistantMessage(input), 'Here is your answer.');
});

test('sanitizeAssistantMessage: strips wrapping quotes', () => {
    const input = '"Hello there, sir."';
    assert.strictEqual(sanitizeAssistantMessage(input), 'Hello there, sir.');
});

test('sanitizeAssistantMessage: strips unicode wrapping quotes', () => {
    const input = '\u201CHello there, sir.\u201D';
    assert.strictEqual(sanitizeAssistantMessage(input), 'Hello there, sir.');
});

test('sanitizeAssistantMessage: strips Jarvis speaker prefix', () => {
    const input = 'Jarvis: Here is the answer.';
    assert.strictEqual(sanitizeAssistantMessage(input), 'Here is the answer.');
});

test('sanitizeAssistantMessage: strips bold Jarvis speaker prefix', () => {
    const input = '**Jarvis:** Here is the answer.';
    assert.strictEqual(sanitizeAssistantMessage(input), 'Here is the answer.');
});

test('sanitizeAssistantMessage: removes channel artifacts', () => {
    const input = 'Here is the answer. (channel)';
    const result = sanitizeAssistantMessage(input);
    assert.ok(!result.includes('channel'), `Should not contain "channel", got: ${result}`);
    assert.ok(result.startsWith('Here is the answer'));
});

test('sanitizeAssistantMessage: strips leading prompt leaks', () => {
    const input = 'channel: Here is the actual response.';
    assert.strictEqual(sanitizeAssistantMessage(input), 'Here is the actual response.');
});

test('sanitizeAssistantMessage: strips commentary prompt leaks', () => {
    const input = 'commentary: The answer is 42.';
    assert.strictEqual(sanitizeAssistantMessage(input), 'The answer is 42.');
});

test('sanitizeAssistantMessage: removes dangerous markup injection', () => {
    const input = '</message></start>assistant</channel>final</message>Safe content.';
    const result = sanitizeAssistantMessage(input);
    assert.ok(!result.includes('</message>'));
    assert.ok(!result.includes('</start>'));
    assert.ok(result.includes('Safe content'));
});

test('sanitizeAssistantMessage: normalizes unicode punctuation to ASCII', () => {
    const input = '\u201CQuoted\u201D text with \u2013 dash and \u2026 ellipsis';
    const result = sanitizeAssistantMessage(input);
    assert.ok(result.includes('"Quoted"'));
    assert.ok(result.includes('-'));
    assert.ok(result.includes('...'));
});

test('sanitizeAssistantMessage: collapses excessive whitespace', () => {
    const input = 'Hello    there    sir.';
    const result = sanitizeAssistantMessage(input);
    assert.strictEqual(result, 'Hello there sir.');
});

test('sanitizeAssistantMessage: collapses excessive newlines', () => {
    const input = 'Line one.\n\n\n\n\nLine two.';
    const result = sanitizeAssistantMessage(input);
    assert.strictEqual(result, 'Line one.\n\nLine two.');
});

test('sanitizeAssistantMessage: removes control characters', () => {
    const input = 'Hello\x00\x01\x02 world';
    const result = sanitizeAssistantMessage(input);
    assert.strictEqual(result, 'Hello world');
});

test('sanitizeAssistantMessage: collapses repetitive filler words', () => {
    const input = 'Certainly! Certainly! Certainly! Here is the answer.';
    const result = sanitizeAssistantMessage(input);
    // Should collapse the repeated fillers
    const certainlyCount = (result.match(/Certainly/g) || []).length;
    assert.ok(certainlyCount <= 2, `Expected <= 2 occurrences of "Certainly", got ${certainlyCount}`);
});

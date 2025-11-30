/**
 * Tests for sanitize utility
 */

const { test } = require('node:test');
const assert = require('node:assert');
const {
    sanitizeString,
    sanitizeDiscordMessage,
    sanitizeUrl,
    sanitizeObjectId,
    sanitizeDiscordId,
    sanitizeInteger,
    sanitizeBoolean,
    sanitizeObject,
    removeDangerousChars
} = require('../../src/utils/sanitize');

test('sanitizeString: Basic sanitization', () => {
    const input = '  Hello World  ';
    const result = sanitizeString(input, { trim: true });
    assert.strictEqual(result, 'Hello World');
});

test('sanitizeString: Max length', () => {
    const input = 'A'.repeat(100);
    const result = sanitizeString(input, { maxLength: 50 });
    assert.strictEqual(result.length, 50);
});

test('sanitizeString: Remove null bytes', () => {
    const input = 'Hello\0World';
    const result = sanitizeString(input, { removeNullBytes: true });
    assert.strictEqual(result, 'HelloWorld');
});

test('sanitizeDiscordMessage: Basic sanitization', () => {
    const input = '  Hello Discord!  ';
    const result = sanitizeDiscordMessage(input);
    assert.strictEqual(result, 'Hello Discord!');
});

test('sanitizeDiscordMessage: Max length', () => {
    const input = 'A'.repeat(3000);
    const result = sanitizeDiscordMessage(input);
    assert.strictEqual(result.length, 2000); // Discord max message length
});

test('sanitizeUrl: Valid URL', () => {
    const url = 'https://example.com';
    const result = sanitizeUrl(url);
    assert.strictEqual(result, 'https://example.com/');
});

test('sanitizeUrl: Invalid URL', () => {
    const url = 'not-a-url';
    const result = sanitizeUrl(url);
    assert.strictEqual(result, null);
});

test('sanitizeUrl: Non-HTTP URL', () => {
    const url = 'javascript:alert(1)';
    const result = sanitizeUrl(url);
    assert.strictEqual(result, null);
});

test('sanitizeObjectId: Valid ObjectId', () => {
    const id = '507f1f77bcf86cd799439011';
    const result = sanitizeObjectId(id);
    assert.strictEqual(result, id);
});

test('sanitizeObjectId: Invalid ObjectId', () => {
    const id = 'invalid-id';
    const result = sanitizeObjectId(id);
    assert.strictEqual(result, null);
});

test('sanitizeDiscordId: Valid Discord ID', () => {
    const id = '123456789012345678';
    const result = sanitizeDiscordId(id);
    assert.strictEqual(result, id);
});

test('sanitizeDiscordId: Invalid Discord ID', () => {
    const id = '123';
    const result = sanitizeDiscordId(id);
    assert.strictEqual(result, null);
});

test('sanitizeInteger: Valid integer', () => {
    const result = sanitizeInteger('123', { min: 0, max: 200 });
    assert.strictEqual(result, 123);
});

test('sanitizeInteger: Out of range', () => {
    const result = sanitizeInteger('300', { min: 0, max: 200 });
    assert.strictEqual(result, null);
});

test('sanitizeBoolean: True values', () => {
    assert.strictEqual(sanitizeBoolean('true'), true);
    assert.strictEqual(sanitizeBoolean('1'), true);
    assert.strictEqual(sanitizeBoolean(1), true);
});

test('sanitizeBoolean: False values', () => {
    assert.strictEqual(sanitizeBoolean('false'), false);
    assert.strictEqual(sanitizeBoolean('0'), false);
    assert.strictEqual(sanitizeBoolean(0), false);
});

test('sanitizeObject: With schema', () => {
    const schema = {
        name: { type: 'string', required: true },
        age: { type: 'integer', options: { min: 0, max: 150 } },
        active: { type: 'boolean', default: false }
    };
    
    const input = {
        name: '  John  ',
        age: '25',
        active: 'true'
    };
    
    const result = sanitizeObject(input, schema);
    assert.strictEqual(result.name, 'John');
    assert.strictEqual(result.age, 25);
    assert.strictEqual(result.active, true);
});

test('removeDangerousChars: Remove dangerous patterns', () => {
    const input = '<script>alert(1)</script>javascript:void(0)';
    const result = removeDangerousChars(input);
    assert.ok(!result.includes('<script>'));
    assert.ok(!result.includes('javascript:'));
});


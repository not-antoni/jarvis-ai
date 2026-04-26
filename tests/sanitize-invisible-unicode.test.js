'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
    stripInvisibleUnicode,
    sanitizeAssistantMessage,
    stripWrappingQuotes
} = require('../src/services/ai/sanitize');
const {
    sanitizeMemoryContent,
    sanitizeUserInput
} = require('../src/utils/memory-sanitizer');

// ─── Issue #273: invisible unicode is stripped from outputs and memory ────

test('stripInvisibleUnicode removes zero-width and bidi controls', () => {
    const dirty = 'hi\u200Bthere\u202Eworld\u061Cend';
    assert.equal(stripInvisibleUnicode(dirty), 'hithereworldend');
});

test('stripInvisibleUnicode removes variation selectors and BOM', () => {
    const dirty = 'A\uFE0FB\uFEFFC';
    assert.equal(stripInvisibleUnicode(dirty), 'ABC');
});

test('stripInvisibleUnicode removes Tag-character stego payload', () => {
    const dirty = 'open\u{E0073}\u{E0065}\u{E0063}door';
    assert.equal(stripInvisibleUnicode(dirty), 'opendoor');
});

test('sanitizeAssistantMessage strips invisible unicode end-to-end', () => {
    const out = sanitizeAssistantMessage('Indeed\u202Esir\u200B.');
    assert.equal(out, 'Indeedsir.');
});

test('sanitizeMemoryContent strips invisible unicode before storing', () => {
    const stored = sanitizeMemoryContent('hello\u200Bworld\u202E');
    assert.ok(!/[\u200B\u202E]/.test(stored));
    assert.ok(stored.includes('helloworld'));
});

test('sanitizeUserInput strips invisible unicode from user prompts', () => {
    const cleaned = sanitizeUserInput('what\u200Bis\u202Egoing on');
    assert.ok(!/[\u200B\u202E]/.test(cleaned));
});

// ─── Issue #269: stripWrappingQuotes no longer cuts off contractions ─────

test('stripWrappingQuotes preserves single-quoted contractions', () => {
    // Used to be incorrectly stripped; the leading/trailing apostrophes are
    // valid possessives, not a wrapping quote pair.
    assert.equal(
        stripWrappingQuotes("'don't worry sir.'"),
        "'don't worry sir.'"
    );
});

test('stripWrappingQuotes still strips clean double-quote wrappers', () => {
    assert.equal(stripWrappingQuotes('"hello sir."'), 'hello sir.');
});

test('stripWrappingQuotes refuses to strip when the body has nested quotes', () => {
    const input = '"He said "hi" then left."';
    assert.equal(stripWrappingQuotes(input), input);
});

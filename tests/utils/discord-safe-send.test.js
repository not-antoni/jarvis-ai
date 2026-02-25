'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { splitMessage } = require('../../src/utils/discord-safe-send');

test('splitMessage preserves all content across chunks', () => {
    const input = [
        '**Thought for: 13.7s**',
        '',
        '**[Phase 1: Analysis]**',
        `  ${'A'.repeat(1400)}`,
        '',
        '**[Phase 2: Deconstruction]**',
        `\t${'B'.repeat(1450)}`,
        '',
        '**[Phase 3: Synthesis]**',
        `${'C'.repeat(1500)}`
    ].join('\n');

    const chunks = splitMessage(input, 500);
    assert.ok(chunks.length > 1);
    assert.ok(chunks.every(chunk => chunk.length <= 500));
    assert.strictEqual(chunks.join(''), input);
});

test('splitMessage handles long unbroken strings', () => {
    const input = 'X'.repeat(1600);
    const chunks = splitMessage(input, 400);

    assert.deepStrictEqual(chunks.map(chunk => chunk.length), [400, 400, 400, 400]);
    assert.strictEqual(chunks.join(''), input);
});

test('splitMessage coerces non-string content safely', () => {
    const chunks = splitMessage(12345, 3);
    assert.deepStrictEqual(chunks, ['123', '45']);
});

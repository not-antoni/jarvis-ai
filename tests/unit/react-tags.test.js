const { test } = require('node:test');
const assert = require('node:assert');
const { extractReactionDirective, stripReactionDirectives } = require('../../src/utils/react-tags');

test('extractReactionDirective: strips standard bracket tag and captures unicode emoji', () => {
    const input = 'All systems nominal. [REACT:🔥]';
    const parsed = extractReactionDirective(input);

    assert.strictEqual(parsed.cleanText, 'All systems nominal.');
    assert.strictEqual(parsed.reaction, '🔥');
    assert.deepStrictEqual(parsed.reactionCandidates, ['🔥']);
    assert.strictEqual(parsed.hadDirective, true);
});

test('extractReactionDirective: supports varied casing, spaces, and bracket types', () => {
    const input = 'Status green { react = 😎 }';
    const parsed = extractReactionDirective(input);

    assert.strictEqual(parsed.cleanText, 'Status green');
    assert.strictEqual(parsed.reaction, '😎');
});

test('extractReactionDirective: supports bare trailing directive', () => {
    const input = 'Handled. react: 👍';
    const parsed = extractReactionDirective(input);

    assert.strictEqual(parsed.cleanText, 'Handled.');
    assert.strictEqual(parsed.reaction, '👍');
});

test('extractReactionDirective: supports dangling trailing directive', () => {
    const input = 'On it [REACT:💯';
    const parsed = extractReactionDirective(input);

    assert.strictEqual(parsed.cleanText, 'On it');
    assert.strictEqual(parsed.reaction, '💯');
});

test('extractReactionDirective: captures custom emoji token and id candidates', () => {
    const input = 'Neat one [REACT:<:jarvis:123456789012345678>]';
    const parsed = extractReactionDirective(input);

    assert.strictEqual(parsed.cleanText, 'Neat one');
    assert.strictEqual(parsed.reaction, '<:jarvis:123456789012345678>');
    assert.deepStrictEqual(parsed.reactionCandidates, [
        '<:jarvis:123456789012345678>',
        '123456789012345678'
    ]);
});

test('extractReactionDirective: handles multiple directives and picks first valid emoji', () => {
    const input = 'Done [REACT: not-an-emoji] [react:✅]';
    const parsed = extractReactionDirective(input);

    assert.strictEqual(parsed.cleanText, 'Done');
    assert.strictEqual(parsed.reaction, '✅');
    assert.deepStrictEqual(parsed.reactionCandidates, ['✅']);
});

test('stripReactionDirectives: removes empty directive variants without emoji', () => {
    const input = 'All good [REACT:] (react= ) react:';
    const cleaned = stripReactionDirectives(input);

    assert.strictEqual(cleaned, 'All good');
});

test('stripReactionDirectives: removes directive leaks from anywhere in response', () => {
    const input = '[REACT:😄] Hello there [REACT:🔥]';
    const cleaned = stripReactionDirectives(input);

    assert.strictEqual(cleaned, 'Hello there');
});

test('stripReactionDirectives: ignores non-directive words', () => {
    const input = 'The reactor is stable.';
    const cleaned = stripReactionDirectives(input);

    assert.strictEqual(cleaned, input);
});

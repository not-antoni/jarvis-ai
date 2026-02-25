const { test } = require('node:test');
const assert = require('node:assert');
const { sanitizeQuoteText } = require('../../src/utils/quote-text-sanitize');

test('sanitizeQuoteText: strips Discord heading and subtext markers', () => {
    const input = '# this\n## this\n### this\n-# and this';
    const output = sanitizeQuoteText(input);
    assert.strictEqual(output, 'this\nthis\nthis\nand this');
});

test('sanitizeQuoteText: strips list and quote prefixes', () => {
    const input = '> quoted\n- bullet\n1. number\n- [x] task';
    const output = sanitizeQuoteText(input);
    assert.strictEqual(output, 'quoted\nbullet\nnumber\ntask');
});

test('sanitizeQuoteText: strips markdown wrappers and spoilers', () => {
    const input = '***bold italic*** **bold** *italic* __underline__ ~~strike~~ ||secret||';
    const output = sanitizeQuoteText(input);
    assert.strictEqual(output, 'bold italic bold italic underline strike secret');
});

test('sanitizeQuoteText: converts links and code fences', () => {
    const input = '[Jarvis](https://example.com) <https://discord.com> `inline` ```js\nconst x = 1;\n```';
    const output = sanitizeQuoteText(input);
    assert.strictEqual(output, 'Jarvis https://discord.com inline const x = 1;');
});

test('sanitizeQuoteText: unescapes escaped markdown symbols', () => {
    const input = '\\# heading \\*italic\\* \\[label\\]';
    const output = sanitizeQuoteText(input);
    assert.strictEqual(output, '# heading *italic* [label]');
});

test('sanitizeQuoteText: keeps emoji and normal text intact', () => {
    const input = 'hello 😎 <:wave:123456789012345678> world';
    const output = sanitizeQuoteText(input);
    assert.strictEqual(output, input);
});

'use strict';

require('dotenv').config();

const test = require('node:test');
const assert = require('node:assert/strict');

const { _test } = require('../src/utils/quote-generator');

test('tokenizeText preserves styled mention markers as mention tokens', () => {
    const tokens = _test.tokenizeText('\u0001@mentioned-user\u0002 found a bug');

    assert.deepEqual(tokens, [
        { type: 'mention', content: '@mentioned-user' },
        { type: 'text', content: ' ' },
        { type: 'text', content: 'found' },
        { type: 'text', content: ' ' },
        { type: 'text', content: 'a' },
        { type: 'text', content: ' ' },
        { type: 'text', content: 'bug' }
    ]);
});

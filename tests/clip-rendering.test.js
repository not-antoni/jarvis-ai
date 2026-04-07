'use strict';

require('dotenv').config();

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCanvas } = require('canvas');

const { _test } = require('../src/services/handlers/clip-rendering');

test('fitTextToWidth keeps full nickname when width allows it', () => {
    const canvas = createCanvas(1, 1);
    const ctx = canvas.getContext('2d');
    ctx.font = 'bold 16px Arial';

    const nickname = 'Shibva_, D.E.M. Ritualist';
    const fitted = _test.fitTextToWidth(ctx, nickname, 1000);

    assert.equal(fitted, nickname);
});

test('splitTextWithEmojisAndMentions emits mention segments for raw user mentions', () => {
    const segments = _test.splitTextWithEmojisAndMentions(
        '<@123456789012345678> found a bug',
        [],
        [{
            full: '<@123456789012345678>',
            userId: '123456789012345678',
            display: '@jona23',
            start: 0,
            end: 21
        }]
    );

    assert.deepEqual(segments, [
        { type: 'mention', text: '@jona23' },
        { type: 'text', text: ' found a bug' }
    ]);
});

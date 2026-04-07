'use strict';

require('dotenv').config();

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCanvas } = require('canvas');

const { _test, parseMentions } = require('../src/services/handlers/clip-rendering');

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
        '<@111111111111111111> found a bug',
        [],
        [{
            full: '<@111111111111111111>',
            userId: '111111111111111111',
            display: '@mentioned-user',
            start: 0,
            end: 21
        }]
    );

    assert.deepEqual(segments, [
        { type: 'mention', text: '@mentioned-user' },
        { type: 'text', text: ' found a bug' }
    ]);
});

test('parseMentions picks up styled rich-text markers', async() => {
    const mentions = await parseMentions(
        null,
        'Please read \u0001#rules\u0002 and ping \u0001@Quasar Mod\u0002'
    );

    assert.deepEqual(
        mentions.map(mention => mention.display),
        ['#rules', '@Quasar Mod']
    );
});

test('sanitizeMessageText strips markdown links down to their labels', () => {
    const sanitized = _test.sanitizeMessageText('Read [the rules](https://discord.com/channels/1/2/3) now');
    assert.equal(sanitized, 'Read the rules now');
});

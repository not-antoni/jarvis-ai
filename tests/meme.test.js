const test = require('node:test');
const assert = require('node:assert/strict');
const { createCanvas } = require('canvas');

const memeCanvas = require('../src/utils/meme-canvas');

function createSampleImageBuffer() {
    const canvas = createCanvas(320, 240);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1f2937';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#3b82f6';
    ctx.fillRect(20, 40, 280, 120);
    ctx.fillStyle = '#f59e0b';
    ctx.font = 'bold 32px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Jarvis', canvas.width / 2, canvas.height / 2);
    return canvas.toBuffer('image/png');
}

test('caption image renders output buffer', async () => {
    const source = createSampleImageBuffer();
    const buffer = await memeCanvas.createCaptionImage(source, 'Systems online');
    assert.ok(Buffer.isBuffer(buffer));
    assert.ok(buffer.length > 0);
});

test('impact meme renders with top and bottom text', async () => {
    const source = createSampleImageBuffer();
    const buffer = await memeCanvas.createImpactMemeImage(source, 'Top Text', 'Bottom Text');
    assert.ok(Buffer.isBuffer(buffer));
    assert.ok(buffer.length > 0);
});

test('caption image requests unicode emoji assets from Twemoji CDN', async (t) => {
    const source = createSampleImageBuffer();
    const calls = [];
    const emojiCanvas = createCanvas(48, 48);

    memeCanvas._internal.emojiImageCache.clear();
    memeCanvas._internal.setEmojiImageLoader(async (url) => {
        if (typeof url === 'string') {
            calls.push(url);
        }
        return emojiCanvas;
    });

    t.after(() => {
        memeCanvas._internal.setEmojiImageLoader(null);
        memeCanvas._internal.emojiImageCache.clear();
    });

    const buffer = await memeCanvas.createCaptionImage(source, 'Status 😄 nominal');
    assert.ok(Buffer.isBuffer(buffer));
    assert.ok(buffer.length > 0);
    assert.ok(
        calls.some((url) => typeof url === 'string' && url.includes('twemoji@latest')),
        'Expected Twemoji CDN request for unicode emoji'
    );
});

test('caption image resolves custom emoji assets via Discord CDN', async (t) => {
    const source = createSampleImageBuffer();
    const calls = [];
    const emojiCanvas = createCanvas(48, 48);

    memeCanvas._internal.emojiImageCache.clear();
    memeCanvas._internal.setEmojiImageLoader(async (url) => {
        if (typeof url === 'string') {
            calls.push(url);
        }
        return emojiCanvas;
    });

    t.after(() => {
        memeCanvas._internal.setEmojiImageLoader(null);
        memeCanvas._internal.emojiImageCache.clear();
    });

    const buffer = await memeCanvas.createCaptionImage(
        source,
        'Diagnostics <:arc:123456789012345678> complete'
    );
    assert.ok(Buffer.isBuffer(buffer));
    assert.ok(buffer.length > 0);
    assert.ok(
        calls.some((url) => url.startsWith('https://cdn.discordapp.com/emojis/123456789012345678')),
        'Expected Discord CDN request for custom emoji'
    );
});

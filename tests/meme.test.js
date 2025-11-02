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

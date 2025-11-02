const { createCanvas, loadImage } = require('canvas');

function normaliseText(text) {
    return (text || '').replace(/\s+/g, ' ').trim();
}

function wrapText(ctx, text, maxWidth) {
    const lines = [];
    const paragraphs = text.split(/\n+/);

    for (const paragraph of paragraphs) {
        const words = paragraph.split(/\s+/);
        let current = '';

        for (const word of words) {
            if (!word) continue;
            const candidate = current ? `${current} ${word}` : word;
            const metrics = ctx.measureText(candidate);
            if (metrics.width <= maxWidth || !current) {
                current = candidate;
            } else {
                lines.push(current);
                current = word;
            }
        }

        if (current) {
            lines.push(current);
        }
    }

    return lines.length ? lines : [''];
}

function calculateFontSize(ctx, text, maxWidth, startingSize, minSize = 18) {
    let size = startingSize;
    let lines = [];

    while (size >= minSize) {
        ctx.font = `bold ${size}px "Impact", "Arial Black", sans-serif`;
        lines = wrapText(ctx, text, maxWidth);
        const widest = Math.max(...lines.map((line) => ctx.measureText(line).width));
        if (widest <= maxWidth) {
            break;
        }
        size -= 2;
    }

    if (size < minSize) {
        size = minSize;
        ctx.font = `bold ${size}px "Impact", "Arial Black", sans-serif`;
        lines = wrapText(ctx, text, maxWidth);
    }

    return { fontSize: size, lines };
}

async function createCaptionImage(imageBuffer, captionText) {
    const caption = normaliseText(captionText);
    if (!caption) {
        throw new Error('Caption text is required.');
    }

    const image = await loadImage(imageBuffer);
    const width = image.width;
    const padding = Math.max(16, Math.round(width * 0.04));
    const maxWidth = Math.max(10, width - padding * 2);

    const canvas = createCanvas(width, width); // temporary to measure
    const ctx = canvas.getContext('2d');
    const { fontSize, lines } = calculateFontSize(ctx, caption, maxWidth, Math.max(32, Math.round(width / 14)));
    const lineHeight = fontSize * 1.15;
    const boxHeight = Math.round(lines.length * lineHeight + padding * 2);

    const output = createCanvas(width, image.height + boxHeight);
    const outCtx = output.getContext('2d');

    outCtx.fillStyle = '#ffffff';
    outCtx.fillRect(0, 0, width, boxHeight);
    outCtx.drawImage(image, 0, boxHeight);

    outCtx.font = `bold ${fontSize}px "Impact", "Arial Black", sans-serif`;
    outCtx.fillStyle = '#000000';
    outCtx.textAlign = 'center';
    outCtx.textBaseline = 'top';

    lines.forEach((line, index) => {
        const y = padding + index * lineHeight;
        outCtx.fillText(line, width / 2, y);
    });

    return output.toBuffer('image/png');
}

async function createImpactMemeImage(imageBuffer, topText = '', bottomText = '') {
    const image = await loadImage(imageBuffer);
    const width = image.width;
    const height = image.height;
    const padding = Math.max(16, Math.round(width * 0.03));
    const maxWidth = Math.max(10, width - padding * 2);

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);

    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#000000';
    ctx.fillStyle = '#ffffff';

    const renderBlock = (text, position) => {
        const cleanText = normaliseText(text);
        if (!cleanText) {
            return;
        }

        const upper = cleanText.toUpperCase();
        const baseFont = Math.max(28, Math.round(width / 10));
        const measureCanvas = createCanvas(width, height);
        const measureCtx = measureCanvas.getContext('2d');
        const { fontSize, lines } = calculateFontSize(measureCtx, upper, maxWidth, baseFont);
        const lineHeight = fontSize * 1.1;

        ctx.font = `bold ${fontSize}px "Impact", "Arial Black", sans-serif`;
        ctx.lineWidth = Math.max(4, Math.round(fontSize * 0.12));

        if (position === 'top') {
            ctx.textBaseline = 'top';
            lines.forEach((line, index) => {
                const y = padding + index * lineHeight;
                ctx.strokeText(line, width / 2, y);
                ctx.fillText(line, width / 2, y);
            });
        } else if (position === 'bottom') {
            ctx.textBaseline = 'bottom';
            lines.slice().reverse().forEach((line, idx) => {
                const y = height - padding - idx * lineHeight;
                ctx.strokeText(line, width / 2, y);
                ctx.fillText(line, width / 2, y);
            });
        }
    };

    renderBlock(topText, 'top');
    renderBlock(bottomText, 'bottom');

    return canvas.toBuffer('image/png');
}

module.exports = {
    createCaptionImage,
    createImpactMemeImage
};

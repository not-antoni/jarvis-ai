const { createCanvas, loadImage } = require('canvas');

/**
 * Split text into lines that fit within a max width
 */
function wrapText(ctx, text, maxWidth) {
    const lines = [];
    const words = text.split(' ');
    let currentLine = words[0];

    for (let i = 1; i < words.length; i++) {
        const word = words[i];
        const width = ctx.measureText(currentLine + " " + word).width;
        if (width < maxWidth) {
            currentLine += " " + word;
        } else {
            lines.push(currentLine);
            currentLine = word;
        }
    }
    lines.push(currentLine);
    return lines;
}

/**
 * Generate a "Make it a Quote" style image with Gradient Background
 * @param {string} text - Message text
 * @param {string} username - User display name
 * @param {string} avatarUrl - Avatar URL (png/jpg)
 * @param {Date} timestamp - Message timestamp (unused in new design but kept for compat)
 * @returns {Promise<Buffer>}
 */
async function generateQuoteImage(text, username, avatarUrl, timestamp) {
    const width = 1800;
    const padding = 80;
    const minHeight = 600;

    // Calculate Text Lines first to determine height
    const tempCanvas = createCanvas(width, minHeight);
    const tempCtx = tempCanvas.getContext('2d');

    // Robust Font Stack
    // We also SANITIZE the username below to avoid missing glyphs
    const fontStack = '"Noto Sans", "Noto Sans CJK SC", "Dejavu Sans", "Arial", sans-serif';
    const fontSize = 80;
    tempCtx.font = `${fontSize}px ${fontStack}`;

    // Max width for text
    const maxTextWidth = (width / 2) - padding;
    const lines = wrapText(tempCtx, text || '', maxTextWidth);

    const lineHeight = fontSize * 1.5;
    const textBlockHeight = lines.length * lineHeight;
    const nameHeight = 60;
    const handleHeight = 40;

    const canvasHeight = Math.max(minHeight, textBlockHeight + nameHeight + handleHeight + (padding * 3));

    // Create Real Canvas
    const canvas = createCanvas(width, canvasHeight);
    const ctx = canvas.getContext('2d');

    // 1. Solid Black Background
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, width, canvasHeight);

    // 2. Draw Avatar
    try {
        const avatar = await loadImage(avatarUrl);

        const imgRatio = avatar.width / avatar.height;
        let drawWidth = canvasHeight * imgRatio;
        let drawHeight = canvasHeight;

        if (drawWidth < width * 0.6) {
            drawWidth = width * 0.6;
            drawHeight = drawWidth / imgRatio;
        }

        // Draw avatar to isolated canvas
        const avCanvas = createCanvas(drawWidth, drawHeight);
        const avCtx = avCanvas.getContext('2d');

        if (avCtx.filter) {
            avCtx.filter = 'grayscale(100%) contrast(1.2) brightness(0.8)';
        }
        avCtx.drawImage(avatar, 0, 0, drawWidth, drawHeight);

        const drawX = 0;
        const drawY = (canvasHeight - drawHeight) / 2;

        ctx.drawImage(avCanvas, drawX, drawY);

    } catch (e) {
        ctx.fillStyle = '#222';
        ctx.fillRect(0, 0, width / 2, canvasHeight);
        console.error("Avatar error", e);
    }

    // 3. Gradient
    const gradient = ctx.createLinearGradient(0, 0, width * 0.75, 0);
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0.2)');
    gradient.addColorStop(0.4, 'rgba(0, 0, 0, 0.6)');
    gradient.addColorStop(0.8, 'rgba(0, 0, 0, 1)');
    gradient.addColorStop(1, 'black');

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, canvasHeight);

    // 4. Draw Text
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const textCenterX = (width * 0.75);
    const textCenterY = canvasHeight / 2;

    ctx.fillStyle = '#ffffff';
    ctx.font = `${fontSize}px ${fontStack}`;

    let currentY = textCenterY - ((lines.length - 1) * lineHeight) / 2 - 40;

    for (const line of lines) {
        ctx.fillText(line, textCenterX, currentY);
        currentY += lineHeight;
    }

    // Draw Name - With Sanitization for symbols
    const nameY = currentY + 30;

    // Strip non-visual characters or complex symbols if they fail rendering
    // We allow basic latin, numbers, common punctuation
    let cleanName = username.replace(/[^\x20-\x7E\xA0-\xFF]/g, '');
    if (cleanName.length < 2) cleanName = username; // Fallback if name is ALL symbols

    ctx.fillStyle = '#ffffff';
    ctx.font = `italic 48px ${fontStack}`;
    ctx.fillText(`- ${cleanName}`, textCenterX, nameY);

    // 5. Watermark
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.font = '24px sans-serif';
    ctx.fillText('Jarvis Quotes', width - 30, canvasHeight - 30);

    // RETURN JPEG TO PREVENT TRANSPARENCY
    return canvas.toBuffer('image/jpeg', { quality: 0.95 });
}

module.exports = { generateQuoteImage };

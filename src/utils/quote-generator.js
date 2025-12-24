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
 * @param {Date} timestamp - Message timestamp
 * @returns {Promise<Buffer>}
 */
async function generateQuoteImage(text, username, avatarUrl, timestamp) {
    const width = 1800;
    const padding = 80;
    const minHeight = 600;

    // Calculate Text Lines
    const tempCanvas = createCanvas(width, minHeight);
    const tempCtx = tempCanvas.getContext('2d');

    // Font Stack
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

    // 1. Solid Black Base
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, width, canvasHeight);

    try {
        const avatar = await loadImage(avatarUrl);

        // 2. BACKGROUND LAYER: Blurred Avatar (Fill "smth")
        // This ensures no transparent/checkered gaps
        const bgCanvas = createCanvas(width, canvasHeight);
        const bgCtx = bgCanvas.getContext('2d');

        // Stretch to fill
        if (bgCtx.filter) {
            // Heavy blur and dark
            bgCtx.filter = 'blur(40px) brightness(0.4)';
        }
        bgCtx.drawImage(avatar, 0, 0, width, canvasHeight);

        ctx.drawImage(bgCanvas, 0, 0);

        // 3. FOREGROUND AVATAR (Left Side)
        const imgRatio = avatar.width / avatar.height;
        let drawWidth = canvasHeight * imgRatio;
        let drawHeight = canvasHeight;

        if (drawWidth < width * 0.6) {
            drawWidth = width * 0.6;
            drawHeight = drawWidth / imgRatio;
        }

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
        // Fallback
        ctx.fillStyle = '#222';
        ctx.fillRect(0, 0, width, canvasHeight);
        console.error("Avatar error", e);
    }

    // 4. Gradient Overlay (Left to Right)
    // We adjust it to be darker on right to ensure text reads well
    const gradient = ctx.createLinearGradient(0, 0, width * 0.75, 0);
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0.2)');
    gradient.addColorStop(0.4, 'rgba(0, 0, 0, 0.7)');
    gradient.addColorStop(0.8, 'rgba(0, 0, 0, 1)');
    gradient.addColorStop(1, 'black');

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, canvasHeight);

    // 5. Text
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

    // 6. Name
    const nameY = currentY + 30;
    let cleanName = username.replace(/[^\x20-\x7E\xA0-\xFF]/g, '');
    if (cleanName.length < 2) cleanName = username;

    ctx.fillStyle = '#ffffff';
    ctx.font = `italic 48px ${fontStack}`;
    ctx.fillText(`- ${cleanName}`, textCenterX, nameY);

    // 7. Watermark
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.font = '24px sans-serif';
    ctx.fillText('Jarvis Quotes', width - 30, canvasHeight - 30);

    return canvas.toBuffer('image/jpeg', { quality: 0.95 });
}

module.exports = { generateQuoteImage };

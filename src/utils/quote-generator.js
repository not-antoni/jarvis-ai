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
    const width = 1200;
    const padding = 60;
    const minHeight = 400;

    // Calculate Text Lines first to determine height
    const tempCanvas = createCanvas(width, minHeight);
    const tempCtx = tempCanvas.getContext('2d');

    // Font settings
    const fontSize = 60;
    const fontFamily = 'sans-serif'; // Fallback
    tempCtx.font = `${fontSize}px ${fontFamily}`;

    // Max width for text (Right side, ~50% of screen)
    const maxTextWidth = (width / 2) - padding;
    const lines = wrapText(tempCtx, text || '', maxTextWidth);

    const lineHeight = fontSize * 1.5;
    const textBlockHeight = lines.length * lineHeight;
    const nameHeight = 50;
    const handleHeight = 30;

    // Dynamic height based on text
    const canvasHeight = Math.max(minHeight, textBlockHeight + nameHeight + handleHeight + (padding * 3));

    // Create Real Canvas
    const canvas = createCanvas(width, canvasHeight);
    const ctx = canvas.getContext('2d');

    // 1. Black Background
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, canvasHeight);

    // 2. Draw Grayscale Avatar on Left
    try {
        const avatar = await loadImage(avatarUrl);

        // Use filter if supported (Canvas 2.x+)
        ctx.save();
        // Make it cover the left half+ a bit
        // Aspect fill logic
        const imgRatio = avatar.width / avatar.height;
        let drawWidth = canvasHeight * imgRatio;
        let drawHeight = canvasHeight;

        if (drawWidth < width * 0.6) {
            drawWidth = width * 0.6;
            drawHeight = drawWidth / imgRatio;
        }

        ctx.filter = 'grayscale(100%) contrast(1.2) brightness(0.8)';
        ctx.drawImage(avatar, 0, (canvasHeight - drawHeight) / 2, drawWidth, drawHeight);
        ctx.restore();
    } catch (e) {
        // Fallback pattern if avatar fails
        ctx.fillStyle = '#222';
        ctx.fillRect(0, 0, width / 2, canvasHeight);
        console.error("Avatar load failed", e);
    }

    // 3. Gradient Overlay (Left to Right: Transparent -> Black)
    const gradient = ctx.createLinearGradient(0, 0, width * 0.7, 0);
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0.2)'); // Slight tint on left
    gradient.addColorStop(0.4, 'rgba(0, 0, 0, 0.6)');
    gradient.addColorStop(0.8, 'rgba(0, 0, 0, 1)'); // Solid black at 80% mark
    gradient.addColorStop(1, '#000000');

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, canvasHeight);

    // 4. Draw Text (Right side)
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const textCenterX = (width * 0.75); // Center of right half (roughly)
    const textCenterY = canvasHeight / 2;

    // Draw Message
    ctx.fillStyle = '#ffffff';
    ctx.font = `${fontSize}px ${fontFamily}`;

    let currentY = textCenterY - ((lines.length - 1) * lineHeight) / 2 - 40; // Shift up a bit for name space

    for (const line of lines) {
        ctx.fillText(line, textCenterX, currentY);
        currentY += lineHeight;
    }

    // Draw Name
    const nameY = currentY + 20;
    ctx.fillStyle = '#ffffff';
    ctx.font = `italic 36px ${fontFamily}`;
    ctx.fillText(`- ${username}`, textCenterX, nameY);

    // Draw Handle (fake handle logic for design)
    // We don't have handle passed easily, so we skip or use username lowercased
    /*
    const handleY = nameY + 30;
    ctx.fillStyle = '#888888';
    ctx.font = `24px ${fontFamily}`;
    ctx.fillText(`@${username.replace(/\s+/g, '_').toLowerCase()}`, textCenterX, handleY);
    */

    // 5. Watermark
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.font = '20px sans-serif';
    ctx.fillText('Jarvis Quotes', width - 20, canvasHeight - 20);

    return canvas.toBuffer();
}

module.exports = { generateQuoteImage };

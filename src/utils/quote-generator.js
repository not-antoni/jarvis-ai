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
 * Generate a "Make it a Quote" style image
 * @param {string} text - Message text
 * @param {string} username - User display name
 * @param {string} avatarUrl - Avatar URL (png/jpg)
 * @param {Date} timestamp - Message timestamp
 * @param {string} [attachmentImage] - Optional attachment image URL
 * @returns {Promise<Buffer>}
 */
async function generateQuoteImage(text, username, avatarUrl, timestamp, attachmentImage = null) {
    const width = 800;
    const padding = 40;
    const avatarSize = 150;

    // Setup temporary canvas to measure text
    const canvas = createCanvas(width, 500); // Initial height, will resize
    const ctx = canvas.getContext('2d');

    // Font settings
    const fontSize = 42;
    const fontFamily = 'sans-serif';
    ctx.font = `${fontSize}px ${fontFamily}`;

    // Wrap text
    const maxTextWidth = width - (padding * 3) - avatarSize;
    const lines = wrapText(ctx, text || '', maxTextWidth);

    // Calculate Height
    const lineHeight = fontSize * 1.4;
    const textHeight = Math.max(lines.length * lineHeight, avatarSize); // ensure at least as tall as avatar
    const nameHeight = 60;

    let canvasHeight = padding + nameHeight + textHeight + padding;

    // Start drawing real canvas
    const finalCanvas = createCanvas(width, canvasHeight);
    const finalCtx = finalCanvas.getContext('2d');

    // Background (Dark Theme)
    finalCtx.fillStyle = '#161618'; // Dark gray
    finalCtx.fillRect(0, 0, width, canvasHeight);

    // Avatar
    try {
        const avatar = await loadImage(avatarUrl);
        finalCtx.save();
        const avX = padding;
        const avY = padding;
        const radius = avatarSize / 2;

        finalCtx.beginPath();
        finalCtx.arc(avX + radius, avY + radius, radius, 0, Math.PI * 2, true);
        finalCtx.closePath();
        finalCtx.clip();

        finalCtx.drawImage(avatar, avX, avY, avatarSize, avatarSize);
        finalCtx.restore();
    } catch (e) {
        // Fallback for failed avatar
        finalCtx.fillStyle = '#7289da';
        finalCtx.beginPath();
        finalCtx.arc(padding + avatarSize / 2, padding + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
        finalCtx.fill();
    }

    // Text Position
    const textX = padding * 2 + avatarSize;
    let textY = padding + 50; // Text start Y

    // Metadata (Date)
    const dateStr = timestamp.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

    // Draw Username
    finalCtx.fillStyle = '#ffffff';
    finalCtx.font = `bold 36px ${fontFamily}`;
    finalCtx.fillText(username, textX, padding + 30);

    // Draw Date (next to username or below?)
    finalCtx.fillStyle = '#72767d'; // Dim gray
    finalCtx.font = `24px ${fontFamily}`;
    const nameWidth = finalCtx.measureText(username).width;
    finalCtx.fillText(dateStr, textX + nameWidth + 20, padding + 30);

    // Draw Message Text
    finalCtx.fillStyle = '#dcddde'; // Discord text color
    finalCtx.font = `${fontSize}px ${fontFamily}`;

    textY = padding + nameHeight + 10;

    for (const line of lines) {
        finalCtx.fillText(line, textX, textY);
        textY += lineHeight;
    }

    // Watermark
    finalCtx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    finalCtx.font = '20px sans-serif';
    finalCtx.fillText('Jarvis Quotes', width - 150, canvasHeight - 20);

    return finalCanvas.toBuffer();
}

module.exports = { generateQuoteImage };

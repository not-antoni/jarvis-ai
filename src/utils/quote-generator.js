const { createCanvas, loadImage } = require('canvas');
const emojiRegex = require('emoji-regex');

/**
 * Convert unicode emoji to Twemoji URL code points
 */
function getTwemojiCode(emoji) {
    return [...emoji].map(c => c.codePointAt(0).toString(16)).join('-');
}

/**
 * Tokenize text into words, whitespace, custom emojis, and unicode emojis
 */
function tokenizeText(text) {
    const tokens = [];
    const customEmojiRegex = /<a?:(\w+):(\d+)>/g;
    const unicodeEmojiRegex = emojiRegex();

    let currentIndex = 0;

    const customMatches = [...text.matchAll(customEmojiRegex)];

    const processPlain = (plainText) => {
        const subTokens = [];
        const subMatches = [...plainText.matchAll(unicodeEmojiRegex)];
        let lastIdx = 0;

        const addWords = (str) => {
            const words = str.split(/(\s+)/);
            for (const w of words) {
                if (w.length > 0) subTokens.push({ type: 'text', content: w });
            }
        };

        for (const m of subMatches) {
            if (m.index > lastIdx) {
                addWords(plainText.substring(lastIdx, m.index));
            }
            subTokens.push({ type: 'unicode', content: m[0] });
            lastIdx = m.index + m[0].length;
        }
        if (lastIdx < plainText.length) {
            addWords(plainText.substring(lastIdx));
        }
        return subTokens;
    };

    let lastIndex = 0;
    for (const match of customMatches) {
        if (match.index > lastIndex) {
            tokens.push(...processPlain(text.substring(lastIndex, match.index)));
        }
        tokens.push({ type: 'custom', name: match[1], id: match[2] });
        lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) {
        tokens.push(...processPlain(text.substring(lastIndex)));
    }

    return tokens;
}

/**
 * Process wrapping for tokens
 */
function wrapTokens(ctx, tokens, maxWidth, fontSize) {
    const lines = [];
    let currentLine = [];
    let currentWidth = 0;

    for (const token of tokens) {
        let tokenWidth = 0;
        if (token.type === 'text') {
            tokenWidth = ctx.measureText(token.content).width;
        } else {
            tokenWidth = fontSize * 1.1;
        }

        if (token.type === 'text' && /^\s+$/.test(token.content)) {
            currentLine.push(token);
            currentWidth += tokenWidth;
            continue;
        }

        if (currentWidth + tokenWidth > maxWidth && currentLine.length > 0) {
            lines.push(currentLine);
            currentLine = [token];
            currentWidth = tokenWidth;
        } else {
            currentLine.push(token);
            currentWidth += tokenWidth;
        }
    }
    if (currentLine.length > 0) lines.push(currentLine);
    return lines;
}

/**
 * Generate Quote Image
 */
async function generateQuoteImage(text, username, avatarUrl, timestamp, attachmentImageUrl) {
    const width = 1800;
    const padding = 80;
    const minHeight = 600;

    const canvas = createCanvas(width, minHeight);
    const ctx = canvas.getContext('2d');

    const fontStack = '"Noto Sans", "Noto Sans CJK SC", "Dejavu Sans", "Arial", sans-serif';
    const fontSize = 80;
    ctx.font = `${fontSize}px ${fontStack}`;

    // 1. Tokenize & Asset Load
    const tokens = tokenizeText(text || '');

    // Load Emojis & Attachment
    const assetsToLoad = [];

    // Emojis
    tokens.forEach(t => {
        if (t.type === 'custom') {
            assetsToLoad.push((async () => {
                try { t.image = await loadImage(`https://cdn.discordapp.com/emojis/${t.id}.png`); }
                catch (e) { t.type = 'text'; t.content = `:${t.name}:`; }
            })());
        } else if (t.type === 'unicode') {
            assetsToLoad.push((async () => {
                try {
                    // Strip Variation Selectors (FE0F) for Twemoji compatibility
                    const cleanEmoji = t.content.replace(/\uFE0F/g, '');
                    const code = getTwemojiCode(cleanEmoji);
                    t.image = await loadImage(`https://raw.githubusercontent.com/twitter/twemoji/master/assets/72x72/${code}.png`);
                }
                catch (e) { t.failed = true; }
            })());
        }
    });

    // Attachment
    let attachmentImage = null;
    if (attachmentImageUrl) {
        assetsToLoad.push((async () => {
            try { attachmentImage = await loadImage(attachmentImageUrl); }
            catch (e) { console.warn("Failed to load attachment", e); }
        })());
    }

    await Promise.all(assetsToLoad);

    // 2. Layout Calculation
    const maxTextWidth = (width / 2) - padding;
    const lines = wrapTokens(ctx, tokens, maxTextWidth, fontSize);

    const lineHeight = fontSize * 1.5;
    const textBlockHeight = lines.length * lineHeight;

    // Image Layout
    let imageDrawWidth = 0;
    let imageDrawHeight = 0;
    if (attachmentImage) {
        const ratio = attachmentImage.width / attachmentImage.height;
        imageDrawWidth = Math.min(maxTextWidth, attachmentImage.width); // Don't upscale small images
        // Actually for quote, better to fit width if large
        if (imageDrawWidth < maxTextWidth * 0.5 && attachmentImage.width < maxTextWidth) {
            imageDrawWidth = attachmentImage.width; // Keep small
        } else {
            imageDrawWidth = maxTextWidth; // Fit width
        }
        imageDrawHeight = imageDrawWidth / ratio;
    }

    const contentSpacing = (lines.length > 0 && attachmentImage) ? 40 : 0;
    const totalContentHeight = textBlockHeight + imageDrawHeight + contentSpacing;

    const nameHeight = 60;
    const handleHeight = 40;

    const canvasHeight = Math.max(minHeight, totalContentHeight + nameHeight + handleHeight + (padding * 3));

    // Resize Canvas
    canvas.width = width;
    canvas.height = canvasHeight;
    ctx.font = `${fontSize}px ${fontStack}`;

    // 3. Draw Backgrounds
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, width, canvasHeight);

    try {
        const avatar = await loadImage(avatarUrl);

        // Blurred BG
        const bgCanvas = createCanvas(width, canvasHeight);
        const bgCtx = bgCanvas.getContext('2d');
        if (bgCtx.filter) bgCtx.filter = 'blur(40px) brightness(0.4)';
        bgCtx.drawImage(avatar, 0, 0, width, canvasHeight);
        ctx.drawImage(bgCanvas, 0, 0);

        // Foreground Avatar
        const imgRatio = avatar.width / avatar.height;
        let drawWidth = canvasHeight * imgRatio;
        let drawHeight = canvasHeight;
        if (drawWidth < width * 0.6) {
            drawWidth = width * 0.6;
            drawHeight = drawWidth / imgRatio;
        }

        const avCanvas = createCanvas(drawWidth, drawHeight);
        const avCtx = avCanvas.getContext('2d');
        if (avCtx.filter) avCtx.filter = 'grayscale(100%) contrast(1.2) brightness(0.8)';
        avCtx.drawImage(avatar, 0, 0, drawWidth, drawHeight);
        ctx.drawImage(avCanvas, 0, (canvasHeight - drawHeight) / 2);

    } catch (e) {
        ctx.fillStyle = '#222';
        ctx.fillRect(0, 0, width, canvasHeight);
    }

    // Gradient
    const gradient = ctx.createLinearGradient(0, 0, width * 0.75, 0);
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0.2)');
    gradient.addColorStop(0.4, 'rgba(0, 0, 0, 0.7)');
    gradient.addColorStop(0.8, 'rgba(0, 0, 0, 1)');
    gradient.addColorStop(1, 'black');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, canvasHeight);

    // 4. Draw Content
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    const textCenterX = (width * 0.75);
    // Center the whole content block (Text + Image) vertically
    let currentY = (canvasHeight / 2) - (totalContentHeight / 2);

    ctx.fillStyle = '#ffffff';

    // Draw Text Lines
    lines.forEach((line) => {
        let lineWidth = 0;
        line.forEach(t => {
            if (t.type === 'text') lineWidth += ctx.measureText(t.content).width;
            else lineWidth += fontSize * 1.1;
        });

        let currentX = textCenterX - (lineWidth / 2);
        const baselineY = currentY + (lineHeight / 2);

        line.forEach(token => {
            if (token.type === 'text') {
                ctx.fillText(token.content, currentX, baselineY);
                currentX += ctx.measureText(token.content).width;
            } else if ((token.type === 'custom' || token.type === 'unicode') && token.image) {
                const size = fontSize;
                ctx.drawImage(token.image, currentX, baselineY - (size / 2), size, size);
                currentX += size * 1.1;
            } else {
                ctx.fillText(token.content || '', currentX, baselineY);
                currentX += ctx.measureText(token.content || '').width;
            }
        });
        currentY += lineHeight;
    });

    // Draw Attachment Image
    if (attachmentImage) {
        currentY += contentSpacing;
        const imgX = textCenterX - (imageDrawWidth / 2);

        // Rounded corners for image
        ctx.save();
        ctx.beginPath();
        // Simple manual rounded rect
        const radius = 20;
        ctx.moveTo(imgX + radius, currentY);
        ctx.lineTo(imgX + imageDrawWidth - radius, currentY);
        ctx.quadraticCurveTo(imgX + imageDrawWidth, currentY, imgX + imageDrawWidth, currentY + radius);
        ctx.lineTo(imgX + imageDrawWidth, currentY + imageDrawHeight - radius);
        ctx.quadraticCurveTo(imgX + imageDrawWidth, currentY + imageDrawHeight, imgX + imageDrawWidth - radius, currentY + imageDrawHeight);
        ctx.lineTo(imgX + radius, currentY + imageDrawHeight);
        ctx.quadraticCurveTo(imgX, currentY + imageDrawHeight, imgX, currentY + imageDrawHeight - radius);
        ctx.lineTo(imgX, currentY + radius);
        ctx.quadraticCurveTo(imgX, currentY, imgX + radius, currentY);
        ctx.closePath();
        ctx.clip();

        ctx.drawImage(attachmentImage, imgX, currentY, imageDrawWidth, imageDrawHeight);
        ctx.restore();

        currentY += imageDrawHeight;
    }

    // 5. Name
    const nameY = currentY + 40;
    // Wait, nameY usually is relative to Text? No, relative to bottom of content.
    // If we center content, Name should hang below it.
    // Actually, `currentY` is now at bottom of text+image.

    let cleanName = username.replace(/[^\x20-\x7E\xA0-\xFF]/g, '');
    if (cleanName.length < 2) cleanName = username;

    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font = `italic 48px ${fontStack}`;
    ctx.fillText(`- ${cleanName}`, textCenterX, nameY);

    // 6. Watermark
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.font = '24px sans-serif';
    ctx.fillText('Jarvis Quotes', width - 30, canvasHeight - 30);

    return canvas.toBuffer('image/jpeg', { quality: 0.95 });
}

module.exports = { generateQuoteImage };

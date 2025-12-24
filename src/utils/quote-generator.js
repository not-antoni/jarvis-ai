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

    // We process by finding Custom Emojis first, then splitting text around them for words/unicode
    const customMatches = [...text.matchAll(customEmojiRegex)];

    // Helper to process plain text segments (splitting words and finding unicode emojis)
    const processPlain = (plainText) => {
        const subTokens = [];
        // Find unicode emojis in this segment
        const subMatches = [...plainText.matchAll(unicodeEmojiRegex)];
        let lastIdx = 0;

        const addWords = (str) => {
            // Split by spaces but keep them attached or separate?
            // Simple: split by spaces
            const words = str.split(/(\s+)/); // Keep delimiters
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
    const spaceWidth = ctx.measureText(" ").width;

    for (const token of tokens) {
        let tokenWidth = 0;
        if (token.type === 'text') {
            // Text word
            tokenWidth = ctx.measureText(token.content).width;
        } else {
            // Emoji (square)
            tokenWidth = fontSize * 1.1; // Slight padding
        }

        // Check overflow
        // If it's whitespace, we don't break line usually, unless it's huge? 
        // Logic: Add to line. If line width > max, break.
        // But if breaking, move current token to next line.

        // Handling spaces strictly
        if (token.type === 'text' && /^\s+$/.test(token.content)) {
            // It's space
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
async function generateQuoteImage(text, username, avatarUrl, timestamp) {
    const width = 1800;
    const padding = 80;
    const minHeight = 600;

    const canvas = createCanvas(width, minHeight); // Initial sizing context
    const ctx = canvas.getContext('2d');

    const fontStack = '"Noto Sans", "Noto Sans CJK SC", "Dejavu Sans", "Arial", sans-serif';
    const fontSize = 80;
    ctx.font = `${fontSize}px ${fontStack}`;

    // 1. Tokenize & Asset Load
    const tokens = tokenizeText(text || '');

    // Load Emojis
    const emojiLoadPromises = tokens.map(async (t) => {
        if (t.type === 'custom') {
            try {
                t.image = await loadImage(`https://cdn.discordapp.com/emojis/${t.id}.png`);
            } catch (e) {
                console.warn(`Failed to load custom emoji ${t.id}`);
                t.type = 'text'; t.content = `:${t.name}:`; // Fallback
            }
        } else if (t.type === 'unicode') {
            try {
                // Try Twemoji
                // Note: Removing VS16 (fe0f) is often needed for Twemoji filenames
                // But let's try strict code points first
                let code = getTwemojiCode(t.content);
                // Sanitize variation selectors if needed logic could go here
                // Simple attempt: 
                t.image = await loadImage(`https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/${code}.png`);
            } catch (e) {
                // Fallback to text rendering (font)
                console.warn(`Failed to load unicode emoji ${t.content}`);
                // Keep type unicode; render loop will fallback to text
                t.failed = true;
            }
        }
    });

    await Promise.all(emojiLoadPromises);

    // 2. Wrap
    const maxTextWidth = (width / 2) - padding;
    const lines = wrapTokens(ctx, tokens, maxTextWidth, fontSize);

    const lineHeight = fontSize * 1.5;
    const textBlockHeight = lines.length * lineHeight;
    const nameHeight = 60;
    const handleHeight = 40;

    const canvasHeight = Math.max(minHeight, textBlockHeight + nameHeight + handleHeight + (padding * 3));

    // Resize Canvas
    canvas.width = width;
    canvas.height = canvasHeight;
    // Context properties reset on resize!
    ctx.font = `${fontSize}px ${fontStack}`;

    // 3. Draw Backgrounds (Copied from previous design)
    // Black Base
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

    // 4. Draw Lines with Tokens
    ctx.textAlign = 'left'; // We must draw token by token manually
    ctx.textBaseline = 'middle';

    const textCenterX = (width * 0.75);
    // Center block vertically
    const textStartY = (canvasHeight / 2) - ((lines.length * lineHeight) / 2);

    ctx.fillStyle = '#ffffff';

    lines.forEach((line, lineIndex) => {
        // Calculate line width to center it horizontally relative to textCenterX
        let lineWidth = 0;
        line.forEach(t => {
            if (t.type === 'text') lineWidth += ctx.measureText(t.content).width;
            else lineWidth += fontSize * 1.1;
        });

        // Since textCenterX is center of the right block, we align center to it
        let currentX = textCenterX - (lineWidth / 2);
        const currentY = textStartY + (lineIndex * lineHeight); // + adjustment? top align
        // Actually textStartY is TOP of block. + half line height for baseline middle
        const baselineY = currentY + (lineHeight / 2);

        line.forEach(token => {
            if (token.type === 'text') {
                ctx.fillText(token.content, currentX, baselineY);
                currentX += ctx.measureText(token.content).width;
            } else if (token.type === 'custom' && token.image) {
                // Draw Image centered on baseline?
                const size = fontSize;
                const y = baselineY - (size / 2);
                ctx.drawImage(token.image, currentX, y, size, size);
                currentX += size * 1.1;
            } else if (token.type === 'unicode') {
                if (token.image) {
                    const size = fontSize;
                    const y = baselineY - (size / 2);
                    ctx.drawImage(token.image, currentX, y, size, size);
                    currentX += size * 1.1;
                } else {
                    // Fallback to text
                    ctx.fillText(token.content, currentX, baselineY);
                    currentX += fontSize; // approx width
                }
            } else {
                // fallback
                ctx.fillText(token.content || '', currentX, baselineY);
                currentX += ctx.measureText(token.content || '').width;
            }
        });
    });

    // 5. Name
    const nameY = textStartY + (lines.length * lineHeight) + 40;
    let cleanName = username.replace(/[^\x20-\x7E\xA0-\xFF]/g, '');
    if (cleanName.length < 2) cleanName = username;

    ctx.textAlign = 'center'; // Name is simple text
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

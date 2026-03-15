const { createCanvas, loadImage } = require('canvas');
const emojiRegex = require('emoji-regex');
const fs = require('fs');
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const path = require('path');
const { sanitizeQuoteText } = require('./quote-text-sanitize');
const { fetchBuffer } = require('./net-guard');

const MAX_QUOTE_IMAGE_BYTES = 10 * 1024 * 1024;

async function loadImageFromUrlSafe(url) {
    const fetched = await fetchBuffer(url, { method: 'GET' }, { maxBytes: MAX_QUOTE_IMAGE_BYTES });
    if (fetched.tooLarge) {
        throw new Error('Image too large');
    }
    const contentType = String(fetched.contentType || '').toLowerCase();
    if (contentType && !contentType.startsWith('image/')) {
        throw new Error('Invalid image content type');
    }
    return await loadImage(fetched.buffer);
}

// Helper to interact with temp files
async function loadGifFrame(url) {
    const tempDir = '/tmp';
    // Ensure temp dir logic is safe? /tmp usually exists.
    const id = `${Date.now()  }_${  Math.floor(Math.random() * 10000)}`;
    const inputPath = path.join(tempDir, `quote_${id}.gif`);
    const outputPath = path.join(tempDir, `quote_${id}.png`);

    try {
        // Download
        const fetched = await fetchBuffer(url, { method: 'GET' }, { maxBytes: MAX_QUOTE_IMAGE_BYTES });
        if (fetched.tooLarge) {throw new Error('Image too large');}
        fs.writeFileSync(inputPath, fetched.buffer);

        // Extract Frame 10 (heuristic to skip start/blank frames)
        // -y: overwrite
        // -vframes 1: output 1 frame
        // This handles transparency (compositing on transparent bg) correctly mostly
        // If the GIF is transparent, ffmpeg output png will preserve it usually?
        // Use 'thumbnail' filter to automatically pick a representative frame
        // This is better than guessing a specific frame number (skips blank starts)
        const cmd = `ffmpeg -i "${inputPath}" -vf "thumbnail" -vframes 1 "${outputPath}" -y`;

        await exec(cmd);

        if (!fs.existsSync(outputPath)) {
            throw new Error('FFmpeg produced no output');
        }

        const image = await loadImage(outputPath);

        // Cleanup
        try { fs.unlinkSync(inputPath); } catch (e) { }
        try { fs.unlinkSync(outputPath); } catch (e) { }

        return image;

    } catch (e) {
        console.warn('GIF processing failed, falling back to direct load', e.message);
        try { if (fs.existsSync(inputPath)) {fs.unlinkSync(inputPath);} } catch (err) { }
        try { if (fs.existsSync(outputPath)) {fs.unlinkSync(outputPath);} } catch (err) { }

        return await loadImageFromUrlSafe(url);
    }
}

/**
 * Normalize Discord Nitro fancy fonts back to regular ASCII
 * Handles: Bold, Italic, Bold Italic, Script, Fraktur, Double-Struck, Monospace, etc.
 */
function normalizeNitroFonts(text) {
    if (!text) {return text;}

    // Unicode math font ranges -> ASCII. Letter pairs: [upperStart, lowerStart] (26 chars each).
    // Fraktur/Double-Struck lower starts are +1 offset due to Unicode gaps.
    const letterBases = [
        [0x1D400, 0x1D41A], [0x1D434, 0x1D44E], [0x1D468, 0x1D482], // Bold, Italic, Bold Italic
        [0x1D49C, 0x1D4B6], [0x1D4D0, 0x1D4EA], [0x1D504, 0x1D51E], // Script, Bold Script, Fraktur
        [0x1D538, 0x1D552], [0x1D56C, 0x1D586], [0x1D5A0, 0x1D5BA], // Double-Struck, Bold Fraktur, Sans
        [0x1D5D4, 0x1D5EE], [0x1D608, 0x1D622], [0x1D63C, 0x1D656], // Sans Bold, Sans Italic, Sans Bold Italic
        [0x1D670, 0x1D68A]  // Monospace
    ];
    const digitBases = [0x1D7CE, 0x1D7D8, 0x1D7E2, 0x1D7EC, 0x1D7F6]; // Bold, Double-Struck, Sans, Sans Bold, Mono
    const fontRanges = [];
    for (const [upper, lower] of letterBases) {
        fontRanges.push({ start: upper, end: upper + 25, baseChar: 'A' }, { start: lower, end: lower + 25, baseChar: 'a' });
    }
    for (const base of digitBases) {
        fontRanges.push({ start: base, end: base + 9, baseChar: '0' });
    }

    let result = '';
    for (const char of text) {
        const codePoint = char.codePointAt(0);
        let replaced = false;

        for (const range of fontRanges) {
            if (codePoint >= range.start && codePoint <= range.end) {
                const offset = codePoint - range.start;
                result += String.fromCharCode(range.baseChar.charCodeAt(0) + offset);
                replaced = true;
                break;
            }
        }

        if (!replaced) {
            result += char;
        }
    }

    return result;
}

/**
 * Convert unicode emoji to Twemoji URL code points
 * Handles ZWJ sequences (like rainbow flag 🏳️‍🌈) correctly
 */
function getTwemojiCode(emoji) {
    // Convert to codepoints, filtering out VS16 (fe0f) except when needed
    const codepoints = [...emoji]
        .map(c => c.codePointAt(0))
        .filter(cp => cp !== 0xfe0f) // Remove VS16 variant selector
        .map(cp => cp.toString(16));

    return codepoints.join('-');
}

/**
 * Tokenize text
 */
function tokenizeText(text) {
    const tokens = [];
    const customEmojiRegex = /<a?:(\w+):(\d+)>/g;
    const unicodeEmojiRegex = emojiRegex();

    const customMatches = [...text.matchAll(customEmojiRegex)];

    const processPlain = (plainText) => {
        const subTokens = [];
        const subMatches = [...plainText.matchAll(unicodeEmojiRegex)];
        let lastIdx = 0;

        const addWords = (str) => {
            const words = str.split(/(\n|[^\S\n]+)/);
            for (const w of words) {
                if (!w) {continue;}
                if (w === '\n') {
                    subTokens.push({ type: 'newline' });
                } else {
                    subTokens.push({ type: 'text', content: w });
                }
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
 * Wrap Tokens
 */
function wrapTokens(ctx, tokens, maxWidth, fontSize) {
    const lines = [];
    let currentLine = [];
    let currentWidth = 0;

    for (const token of tokens) {
        if (token.type === 'newline') {
            lines.push(currentLine);
            currentLine = [];
            currentWidth = 0;
            continue;
        }

        let tokenWidth = 0;
        if (token.type === 'text') {
            tokenWidth = ctx.measureText(token.content).width;
        } else {
            tokenWidth = fontSize * 1.1;
        }

        if (token.type === 'text' && /^\s+$/.test(token.content)) {
            if (currentLine.length === 0) {continue;}
            currentLine.push(token);
            currentWidth += tokenWidth;
            continue;
        }

        if (currentWidth + tokenWidth > maxWidth && currentLine.length > 0) {
            lines.push(currentLine);
            if (token.type === 'text' && /^\s+$/.test(token.content)) {
                currentLine = [];
                currentWidth = 0;
            } else {
                currentLine = [token];
                currentWidth = tokenWidth;
            }
        } else {
            currentLine.push(token);
            currentWidth += tokenWidth;
        }
    }
    if (currentLine.length > 0) {lines.push(currentLine);}
    return lines;
}

/**
 * Load emoji image assets for an array of tokens (custom Discord emojis + unicode Twemoji).
 * Mutates tokens in-place: sets .image on success, converts to text fallback on failure.
 */
function loadTokenEmojiAssets(tokens) {
    const tasks = [];
    for (const t of tokens) {
        if (t.type === 'custom') {
            tasks.push((async () => {
                for (const format of ['webp', 'gif', 'png']) {
                    try { t.image = await loadImage(`https://cdn.discordapp.com/emojis/${t.id}.${format}?size=96`); return; } catch (_) {}
                }
                t.type = 'text'; t.content = `:${t.name}:`;
            })());
        } else if (t.type === 'unicode') {
            tasks.push((async () => {
                const code = getTwemojiCode(t.content);
                const urls = [
                    `https://cdn.jsdelivr.net/gh/twitter/twemoji@latest/assets/72x72/${code}.png`,
                    `https://raw.githubusercontent.com/twitter/twemoji/master/assets/72x72/${code}.png`,
                    `https://cdn.jsdelivr.net/gh/twitter/twemoji@latest/assets/72x72/${[...t.content].map(c => c.codePointAt(0).toString(16)).join('-')}.png`
                ];
                for (const url of urls) {
                    try { t.image = await loadImage(url); return; } catch (_) {}
                }
                t.failed = true; t.type = 'text';
            })());
        }
    }
    return tasks;
}

/**
 * Generate Quote Image
 */
async function generateQuoteImage(text, displayName, avatarUrl, timestamp, attachmentImageUrl, actualUsername = null) {
    // Fixed canvas size - max Discord resolution
    const width = 1599;
    const height = 899;
    const padding = 60;

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    const fontStack = '"Noto Sans", "Noto Sans CJK SC", "Dejavu Sans", "Arial", sans-serif';
    const fontSize = 80;
    ctx.font = `${fontSize}px ${fontStack}`;

    // 1. Normalize Nitro fonts, sanitize Discord markdown, then tokenize.
    const normalizedText = normalizeNitroFonts(text || '');
    const cleanText = sanitizeQuoteText(normalizedText);
    const tokens = tokenizeText(cleanText);

    const assetsToLoad = loadTokenEmojiAssets(tokens);

    // Attachment
    let attachmentImage = null;
    if (attachmentImageUrl) {
        assetsToLoad.push((async() => {
            try {
                const isGif = attachmentImageUrl.split('?')[0].toLowerCase().endsWith('.gif');
                if (isGif) {
                    attachmentImage = await loadGifFrame(attachmentImageUrl);
                } else {
                    attachmentImage = await loadImageFromUrlSafe(attachmentImageUrl);
                }
            }
            catch (e) { console.warn('Failed to load attachment', e); }
        })());
    }

    await Promise.all(assetsToLoad);

    // 2. Layout - fixed canvas, dynamically scale font if text is too long
    const maxTextWidth = (width / 2) - padding;
    const nameHeight = 50;
    const handleHeight = 35;
    const footerHeight = 40;
    const minFontSize = 32; // Minimum readable font size

    // Try to fit text by reducing font size if needed
    let currentFontSize = fontSize;
    let lines;
    let lineHeight;
    let maxLines;

    while (currentFontSize >= minFontSize) {
        ctx.font = `${currentFontSize}px ${fontStack}`;
        lines = wrapTokens(ctx, tokens, maxTextWidth, currentFontSize);
        lineHeight = currentFontSize * 1.4;
        maxLines = Math.floor((height - padding * 2 - nameHeight - handleHeight - footerHeight) / lineHeight);

        // If text fits, we're done
        if (lines.length <= maxLines) {
            break;
        }

        // Reduce font size and try again
        currentFontSize -= 4;
    }

    // Use final calculated values
    const finalFontSize = currentFontSize;
    lineHeight = finalFontSize * 1.4;
    ctx.font = `${finalFontSize}px ${fontStack}`;

    // Truncate if still too long even at minimum font
    if (lines.length > maxLines) {
        lines = lines.slice(0, maxLines);
        // Add ellipsis to last line (guard against empty)
        if (lines.length > 0) {
            const lastLine = lines[lines.length - 1];
            lastLine.push({ type: 'text', content: '...' });
        }
    }

    const textBlockHeight = lines.length * lineHeight;

    let imageDrawWidth = 0;
    let imageDrawHeight = 0;
    if (attachmentImage) {
        const ratio = attachmentImage.width / attachmentImage.height;
        // Scale image to fit remaining space
        const availableHeight = height - padding * 2 - textBlockHeight - nameHeight - handleHeight - footerHeight - 30;
        imageDrawWidth = Math.min(maxTextWidth, availableHeight * ratio);
        imageDrawHeight = imageDrawWidth / ratio;
        // Cap maximum
        if (imageDrawHeight > availableHeight) {
            imageDrawHeight = availableHeight;
            imageDrawWidth = imageDrawHeight * ratio;
        }
    }

    const contentSpacing = (lines.length > 0 && attachmentImage) ? 30 : 0;
    const totalContentHeight = textBlockHeight + imageDrawHeight + contentSpacing;

    // Canvas is fixed size
    const canvasHeight = height;

    // 3. Backgrounds
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, width, canvasHeight);

    try {
        const avatar = await loadImage(avatarUrl);

        const bgCanvas = createCanvas(width, canvasHeight);
        const bgCtx = bgCanvas.getContext('2d');
        if (bgCtx.filter) {bgCtx.filter = 'blur(40px) brightness(0.4)';}
        bgCtx.drawImage(avatar, 0, 0, width, canvasHeight);
        ctx.drawImage(bgCanvas, 0, 0);

        const imgRatio = avatar.width / avatar.height;
        let drawWidth = canvasHeight * imgRatio;
        let drawHeight = canvasHeight;
        if (drawWidth < width * 0.6) {
            drawWidth = width * 0.6;
            drawHeight = drawWidth / imgRatio;
        }

        const avCanvas = createCanvas(drawWidth, drawHeight);
        const avCtx = avCanvas.getContext('2d');
        if (avCtx.filter) {avCtx.filter = 'grayscale(100%) contrast(1.2) brightness(0.8)';}
        avCtx.drawImage(avatar, 0, 0, drawWidth, drawHeight);
        ctx.drawImage(avCanvas, 0, (canvasHeight - drawHeight) / 2);

    } catch (e) {
        ctx.fillStyle = '#222';
        ctx.fillRect(0, 0, width, canvasHeight);
    }

    const gradient = ctx.createLinearGradient(0, 0, width * 0.75, 0);
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0.2)');
    gradient.addColorStop(0.4, 'rgba(0, 0, 0, 0.7)');
    gradient.addColorStop(0.8, 'rgba(0, 0, 0, 1)');
    gradient.addColorStop(1, 'black');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, canvasHeight);

    // 4. Content
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    const textCenterX = (width * 0.75);
    let currentY = (canvasHeight / 2) - (totalContentHeight / 2);

    ctx.fillStyle = '#ffffff';

    lines.forEach((line) => {
        let lineWidth = 0;
        line.forEach(t => {
            if (t.type === 'text') {lineWidth += ctx.measureText(t.content).width;}
            else {lineWidth += finalFontSize * 1.1;}
        });

        let currentX = textCenterX - (lineWidth / 2);
        const baselineY = currentY + (lineHeight / 2);

        line.forEach(token => {
            if (token.type === 'text') {
                ctx.fillText(token.content, currentX, baselineY);
                currentX += ctx.measureText(token.content).width;
            } else if ((token.type === 'custom' || token.type === 'unicode') && token.image) {
                const size = finalFontSize;
                ctx.drawImage(token.image, currentX, baselineY - (size / 2), size, size);
                currentX += size * 1.1;
            } else {
                ctx.fillText(token.content || '', currentX, baselineY);
                currentX += ctx.measureText(token.content || '').width;
            }
        });
        currentY += lineHeight;
    });

    if (attachmentImage) {
        currentY += contentSpacing;
        const imgX = textCenterX - (imageDrawWidth / 2);
        const radius = 20;

        // Draw Visibility Backdrop
        ctx.save();
        ctx.beginPath();
        if (ctx.roundRect) {
            ctx.roundRect(imgX, currentY, imageDrawWidth, imageDrawHeight, radius);
        } else {
            // Fallback for older canvas versions
            ctx.moveTo(imgX + radius, currentY);
            ctx.lineTo(imgX + imageDrawWidth - radius, currentY);
            ctx.quadraticCurveTo(imgX + imageDrawWidth, currentY, imgX + imageDrawWidth, currentY + radius);
            ctx.lineTo(imgX + imageDrawWidth, currentY + imageDrawHeight - radius);
            ctx.quadraticCurveTo(imgX + imageDrawWidth, currentY + imageDrawHeight, imgX + imageDrawWidth - radius, currentY + imageDrawHeight);
            ctx.lineTo(imgX + radius, currentY + imageDrawHeight);
            ctx.quadraticCurveTo(imgX, currentY + imageDrawHeight, imgX, currentY + imageDrawHeight - radius);
            ctx.lineTo(imgX, currentY + radius);
            ctx.quadraticCurveTo(imgX, currentY, imgX + radius, currentY);
        }
        ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Clip and Draw Image
        ctx.clip(); // Clip to the rect we just drew
        ctx.drawImage(attachmentImage, imgX, currentY, imageDrawWidth, imageDrawHeight);
        ctx.restore();

        currentY += imageDrawHeight;
    }

    const nameY = currentY + 40;

    // Process displayName - normalize fancy fonts and support emojis
    const normalizedDisplayName = normalizeNitroFonts(displayName).replace(/[\r\n]+/g, ' ');
    const nameTokens = tokenizeText(normalizedDisplayName);

    await Promise.all(loadTokenEmojiAssets(nameTokens));

    ctx.textAlign = 'left'; // Helper calculates positions, we draw manually
    ctx.fillStyle = '#ffffff';
    // Removed italic to improve unicode support (many fonts lack italic for symbols)
    ctx.font = `48px ${fontStack}`;

    // Calculate total width of the name block
    let nameTotalWidth = 0;
    const nameFontSize = 48;
    // Prefix width "- "
    nameTotalWidth += ctx.measureText('- ').width;

    nameTokens.forEach(t => {
        if (t.type === 'text') {nameTotalWidth += ctx.measureText(t.content).width;}
        else {nameTotalWidth += nameFontSize * 1.1;}
    });

    let currentNameX = textCenterX - (nameTotalWidth / 2);

    // Draw Prefix
    ctx.fillText('- ', currentNameX, nameY);
    currentNameX += ctx.measureText('- ').width;

    // Draw Name Tokens
    nameTokens.forEach(token => {
        if (token.type === 'text') {
            ctx.fillText(token.content, currentNameX, nameY);
            currentNameX += ctx.measureText(token.content).width;
        } else if ((token.type === 'custom' || token.type === 'unicode') && token.image) {
            const size = nameFontSize;
            ctx.drawImage(token.image, currentNameX, nameY - (size / 2), size, size);
            currentNameX += size * 1.1;
        } else {
            ctx.fillText(token.content || '', currentNameX, nameY);
            currentNameX += ctx.measureText(token.content || '').width;
        }
    });

    // Draw username in grey below displayName (if provided and different)
    if (actualUsername && actualUsername !== displayName) {
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.font = `32px ${fontStack}`;
        ctx.fillText(`@${actualUsername}`, textCenterX, nameY + 45);
    }

    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.font = '24px sans-serif';
    ctx.fillText('Jarvis Quotes', width - 30, canvasHeight - 30);

    return canvas.toBuffer('image/png');
}

module.exports = { generateQuoteImage };

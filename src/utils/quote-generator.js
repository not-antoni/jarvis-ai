const { createCanvas, loadImage } = require('canvas');
const emojiRegex = require('emoji-regex');
const fs = require('fs');
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const path = require('path');

// Helper to interact with temp files
async function loadGifFrame(url) {
    const tempDir = '/tmp';
    // Ensure temp dir logic is safe? /tmp usually exists.
    const id = Date.now() + '_' + Math.floor(Math.random() * 10000);
    const inputPath = path.join(tempDir, `quote_${id}.gif`);
    const outputPath = path.join(tempDir, `quote_${id}.png`);

    try {
        // Download
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Fetch failed: ${res.statusText}`);
        const buffer = await res.arrayBuffer();
        fs.writeFileSync(inputPath, Buffer.from(buffer));

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
            throw new Error("FFmpeg produced no output");
        }

        const image = await loadImage(outputPath);

        // Cleanup
        try { fs.unlinkSync(inputPath); } catch (e) { }
        try { fs.unlinkSync(outputPath); } catch (e) { }

        return image;

    } catch (e) {
        console.warn("GIF processing failed, falling back to direct load", e.message);
        try { if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath); } catch (err) { }
        try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch (err) { }

        return await loadImage(url);
    }
}

/**
 * Strip Discord markdown from text for clean display
 */
function stripMarkdown(text) {
    if (!text) return text;
    return text
        // Bold/italic combinations
        .replace(/\*\*\*(.+?)\*\*\*/g, '$1')
        // Bold
        .replace(/\*\*(.+?)\*\*/g, '$1')
        // Italic (underscore)
        .replace(/__(.+?)__/g, '$1')
        // Italic (asterisk)
        .replace(/\*(.+?)\*/g, '$1')
        // Italic (single underscore - be careful not to break emoji names)
        .replace(/(?<![:\w])_([^_]+)_(?![:\w])/g, '$1')
        // Strikethrough
        .replace(/~~(.+?)~~/g, '$1')
        // Inline code
        .replace(/`(.+?)`/g, '$1')
        // Spoilers
        .replace(/\|\|(.+?)\|\|/g, '$1');
}

/**
 * Normalize Discord Nitro fancy fonts back to regular ASCII
 * Handles: Bold, Italic, Bold Italic, Script, Fraktur, Double-Struck, Monospace, etc.
 */
function normalizeNitroFonts(text) {
    if (!text) return text;

    // Unicode ranges for fancy fonts -> ASCII mappings
    const fontRanges = [
        // Mathematical Bold (𝐀-𝐙, 𝐚-𝐳)
        { start: 0x1D400, end: 0x1D419, baseChar: 'A' },
        { start: 0x1D41A, end: 0x1D433, baseChar: 'a' },
        // Mathematical Italic (𝐴-𝑍, 𝑎-𝑧)
        { start: 0x1D434, end: 0x1D44D, baseChar: 'A' },
        { start: 0x1D44E, end: 0x1D467, baseChar: 'a' },
        // Mathematical Bold Italic (𝑨-𝒁, 𝒂-𝒛)
        { start: 0x1D468, end: 0x1D481, baseChar: 'A' },
        { start: 0x1D482, end: 0x1D49B, baseChar: 'a' },
        // Mathematical Script (𝒜-𝒵, 𝒶-𝓏)
        { start: 0x1D49C, end: 0x1D4B5, baseChar: 'A' },
        { start: 0x1D4B6, end: 0x1D4CF, baseChar: 'a' },
        // Mathematical Bold Script (𝓐-𝓩, 𝓪-𝔃)
        { start: 0x1D4D0, end: 0x1D4E9, baseChar: 'A' },
        { start: 0x1D4EA, end: 0x1D503, baseChar: 'a' },
        // Mathematical Fraktur (𝔄-𝔜, 𝔞-𝔷)
        { start: 0x1D504, end: 0x1D51C, baseChar: 'A' },
        { start: 0x1D51E, end: 0x1D537, baseChar: 'a' },
        // Mathematical Double-Struck (𝔸-𝕐, 𝕒-𝕫)
        { start: 0x1D538, end: 0x1D550, baseChar: 'A' },
        { start: 0x1D552, end: 0x1D56B, baseChar: 'a' },
        // Mathematical Bold Fraktur (𝕬-𝖅, 𝖆-𝖟)
        { start: 0x1D56C, end: 0x1D585, baseChar: 'A' },
        { start: 0x1D586, end: 0x1D59F, baseChar: 'a' },
        // Mathematical Sans-Serif (𝖠-𝖹, 𝖺-𝗓)
        { start: 0x1D5A0, end: 0x1D5B9, baseChar: 'A' },
        { start: 0x1D5BA, end: 0x1D5D3, baseChar: 'a' },
        // Mathematical Sans-Serif Bold (𝗔-𝗭, 𝗮-𝘇)
        { start: 0x1D5D4, end: 0x1D5ED, baseChar: 'A' },
        { start: 0x1D5EE, end: 0x1D607, baseChar: 'a' },
        // Mathematical Sans-Serif Italic (𝘈-𝘡, 𝘢-𝘻)
        { start: 0x1D608, end: 0x1D621, baseChar: 'A' },
        { start: 0x1D622, end: 0x1D63B, baseChar: 'a' },
        // Mathematical Sans-Serif Bold Italic (𝘼-𝙕, 𝙖-𝙯)
        { start: 0x1D63C, end: 0x1D655, baseChar: 'A' },
        { start: 0x1D656, end: 0x1D66F, baseChar: 'a' },
        // Mathematical Monospace (𝙰-𝚉, 𝚊-𝚣)
        { start: 0x1D670, end: 0x1D689, baseChar: 'A' },
        { start: 0x1D68A, end: 0x1D6A3, baseChar: 'a' },
        // Mathematical Bold Digits (𝟎-𝟗)
        { start: 0x1D7CE, end: 0x1D7D7, baseChar: '0' },
        // Mathematical Double-Struck Digits (𝟘-𝟡)
        { start: 0x1D7D8, end: 0x1D7E1, baseChar: '0' },
        // Mathematical Sans-Serif Digits (𝟢-𝟫)
        { start: 0x1D7E2, end: 0x1D7EB, baseChar: '0' },
        // Mathematical Sans-Serif Bold Digits (𝟬-𝟵)
        { start: 0x1D7EC, end: 0x1D7F5, baseChar: '0' },
        // Mathematical Monospace Digits (𝟶-𝟿)
        { start: 0x1D7F6, end: 0x1D7FF, baseChar: '0' },
    ];

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
 * Wrap Tokens
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
async function generateQuoteImage(text, displayName, avatarUrl, timestamp, attachmentImageUrl, actualUsername = null) {
    const width = 1800;
    const padding = 80;
    const minHeight = 600;

    const canvas = createCanvas(width, minHeight);
    const ctx = canvas.getContext('2d');

    const fontStack = '"Noto Sans", "Noto Sans CJK SC", "Dejavu Sans", "Arial", sans-serif';
    const fontSize = 80;
    ctx.font = `${fontSize}px ${fontStack}`;

    // 1. Normalize Nitro fancy fonts to ASCII, strip markdown, then tokenize
    const normalizedText = normalizeNitroFonts(text || '');
    const cleanText = stripMarkdown(normalizedText);
    const tokens = tokenizeText(cleanText);

    const assetsToLoad = [];

    // Emojis
    tokens.forEach(t => {
        if (t.type === 'custom') {
            assetsToLoad.push((async () => {
                // Try webp first (Discord's preferred format), then gif for animated, then png
                const formats = ['webp', 'gif', 'png'];
                for (const format of formats) {
                    try {
                        t.image = await loadImage(`https://cdn.discordapp.com/emojis/${t.id}.${format}?size=96`);
                        return; // Success!
                    } catch (e) {
                        // Try next format
                    }
                }
                // All failed - fallback to text
                t.type = 'text';
                t.content = `:${t.name}:`;
            })());
        } else if (t.type === 'unicode') {
            assetsToLoad.push((async () => {
                // Try multiple URL patterns for Twemoji
                const code = getTwemojiCode(t.content);

                // Different Twemoji URL patterns to try (they changed hosting)
                const urls = [
                    `https://cdn.jsdelivr.net/gh/twitter/twemoji@latest/assets/72x72/${code}.png`,
                    `https://raw.githubusercontent.com/twitter/twemoji/master/assets/72x72/${code}.png`,
                    // Some ZWJ emojis need the full codepoints including fe0f
                    `https://cdn.jsdelivr.net/gh/twitter/twemoji@latest/assets/72x72/${[...t.content].map(c => c.codePointAt(0).toString(16)).join('-')}.png`
                ];

                for (const url of urls) {
                    try {
                        t.image = await loadImage(url);
                        return; // Success, stop trying
                    } catch (e) {
                        // Try next URL
                    }
                }

                // All URLs failed - mark as text fallback (will render the actual emoji character)
                t.failed = true;
                t.type = 'text';
                t.content = t.content; // Keep original emoji to render as text
            })());
        }
    });

    // Attachment
    let attachmentImage = null;
    if (attachmentImageUrl) {
        assetsToLoad.push((async () => {
            try {
                const isGif = attachmentImageUrl.split('?')[0].toLowerCase().endsWith('.gif');
                if (isGif) {
                    attachmentImage = await loadGifFrame(attachmentImageUrl);
                } else {
                    attachmentImage = await loadImage(attachmentImageUrl);
                }
            }
            catch (e) { console.warn("Failed to load attachment", e); }
        })());
    }

    await Promise.all(assetsToLoad);

    // 2. Layout
    const maxTextWidth = (width / 2) - padding;
    const lines = wrapTokens(ctx, tokens, maxTextWidth, fontSize);

    const lineHeight = fontSize * 1.5;
    const textBlockHeight = lines.length * lineHeight;

    let imageDrawWidth = 0;
    let imageDrawHeight = 0;
    if (attachmentImage) {
        const ratio = attachmentImage.width / attachmentImage.height;
        // User requested large images: Force width to fill column (maxTextWidth)
        // This will upscale small images, but that's better than tiny specks.
        imageDrawWidth = maxTextWidth;
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

    // 3. Backgrounds
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, width, canvasHeight);

    try {
        const avatar = await loadImage(avatarUrl);

        const bgCanvas = createCanvas(width, canvasHeight);
        const bgCtx = bgCanvas.getContext('2d');
        if (bgCtx.filter) bgCtx.filter = 'blur(40px) brightness(0.4)';
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
        if (avCtx.filter) avCtx.filter = 'grayscale(100%) contrast(1.2) brightness(0.8)';
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
    const normalizedDisplayName = normalizeNitroFonts(displayName);
    const nameTokens = tokenizeText(normalizedDisplayName);

    // Load emoji assets for displayName
    const nameAssets = [];
    nameTokens.forEach(t => {
        if (t.type === 'custom') {
            nameAssets.push((async () => {
                // Try webp first, then gif for animated, then png
                const formats = ['webp', 'gif', 'png'];
                for (const format of formats) {
                    try {
                        t.image = await loadImage(`https://cdn.discordapp.com/emojis/${t.id}.${format}?size=96`);
                        return;
                    } catch (e) {
                        // Try next format
                    }
                }
                t.type = 'text';
                t.content = `:${t.name}:`;
            })());
        } else if (t.type === 'unicode') {
            nameAssets.push((async () => {
                const code = getTwemojiCode(t.content);
                const urls = [
                    `https://cdn.jsdelivr.net/gh/twitter/twemoji@latest/assets/72x72/${code}.png`,
                    `https://raw.githubusercontent.com/twitter/twemoji/master/assets/72x72/${code}.png`,
                    `https://cdn.jsdelivr.net/gh/twitter/twemoji@latest/assets/72x72/${[...t.content].map(c => c.codePointAt(0).toString(16)).join('-')}.png`
                ];
                for (const url of urls) {
                    try {
                        t.image = await loadImage(url);
                        return;
                    } catch (e) {
                        // Try next URL
                    }
                }
                t.failed = true;
                t.type = 'text';
                t.content = t.content;
            })());
        }
    });

    await Promise.all(nameAssets);

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
        if (t.type === 'text') nameTotalWidth += ctx.measureText(t.content).width;
        else nameTotalWidth += nameFontSize * 1.1;
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

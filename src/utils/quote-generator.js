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
        
        // Extract Frame at 1.0s
        // -y: overwrite
        // -ss 1.0: seek to 1 second
        // -vframes 1: output 1 frame
        // This handles transparency (compositing on transparent bg) correctly mostly
        // If the GIF is transparent, ffmpeg output png will preserve it usually?
        // Or we might need complex filters. But default is usually good.
        // If duration < 1s, we might fail. If so, fallback catch will handle it.
        const cmd = `ffmpeg -i "${inputPath}" -ss 1.0 -vframes 1 "${outputPath}" -y`;
        
        await exec(cmd);
        
        if (!fs.existsSync(outputPath)) {
            // Try seeking 0.0 if 1.0 failed (short gif?)
            // Fallback to standard load
            throw new Error("FFmpeg produced no output");
        }
        
        const image = await loadImage(outputPath);
        
        // Cleanup
        try { fs.unlinkSync(inputPath); } catch(e){}
        try { fs.unlinkSync(outputPath); } catch(e){}
        
        return image;

    } catch (e) {
        console.warn("GIF processing failed, falling back to direct load", e.message);
        try { if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath); } catch(err){}
        try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch(err){}
        
        return await loadImage(url);
    }
}


/**
 * Convert unicode emoji to Twemoji URL code points
 */
function getTwemojiCode(emoji) {
    return [...emoji].map(c => c.codePointAt(0).toString(16)).join('-');
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
        imageDrawWidth = Math.min(maxTextWidth, attachmentImage.width * 2); // Allow slight upscale for visibility? Or keep raw?
        // Fit width if huge
        if (imageDrawWidth > maxTextWidth) imageDrawWidth = maxTextWidth;
        
        // If image is tiny, user wants it visible.
        if (imageDrawWidth < 200) imageDrawWidth = 200; // minimum width
        
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
        
        ctx.save();
        ctx.beginPath();
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
    
    const nameY = currentY + 40; 
    let cleanName = username.replace(/[^\x20-\x7E\xA0-\xFF]/g, ''); 
    if (cleanName.length < 2) cleanName = username;

    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font = `italic 48px ${fontStack}`;
    ctx.fillText(`- ${cleanName}`, textCenterX, nameY);
    
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.font = '24px sans-serif';
    ctx.fillText('Jarvis Quotes', width - 30, canvasHeight - 30);

    return canvas.toBuffer('image/jpeg', { quality: 0.95 });
}

module.exports = { generateQuoteImage };

const { createCanvas, loadImage } = require('canvas');
const { LRUCache } = require('lru-cache');
const emojiRegexFactory = require('emoji-regex');

const TWEMOJI_SVG_BASE = 'https://cdn.jsdelivr.net/gh/twitter/twemoji@latest/assets/svg';
const TWEMOJI_PNG_BASE = 'https://cdn.jsdelivr.net/gh/twitter/twemoji@latest/assets/72x72';

const envMax = (name, fallback, min) => Math.max(min, Number(process.env[name] || '') || fallback);
const EMOJI_IMAGE_CACHE_MAX = envMax('EMOJI_IMAGE_CACHE_MAX', 500, 200);
const EMOJI_IMAGE_CACHE_TTL_MS = envMax('EMOJI_IMAGE_CACHE_TTL_MS', 24 * 60 * 60 * 1000, 60 * 1000);
const UNICODE_ASSET_CACHE_MAX = envMax('UNICODE_ASSET_CACHE_MAX', 5000, 500);

const emojiImageCache = new LRUCache({ max: EMOJI_IMAGE_CACHE_MAX, ttl: EMOJI_IMAGE_CACHE_TTL_MS });
const unicodeAssetCache = new LRUCache({ max: UNICODE_ASSET_CACHE_MAX });
let emojiImageLoader = null;

function unicodeEmojiToCodePoints(emoji) {
    if (!emoji) {return null;}
    const cacheHit = unicodeAssetCache.get(emoji);
    if (cacheHit !== undefined) {
        return cacheHit;
    }

    const codePoints = [];
    for (const symbol of Array.from(emoji)) {
        const codePoint = symbol.codePointAt(0);
        if (typeof codePoint === 'number' && codePoint !== 0xfe0f) {
            const hex = codePoint.toString(16).toLowerCase();
            const padded = codePoint > 0xffff ? hex : hex.padStart(4, '0');
            codePoints.push(padded);
        }
    }

    const codeString = codePoints.length ? codePoints.join('-') : null;
    unicodeAssetCache.set(emoji, codeString);
    return codeString;
}

function buildUnicodeEmojiAsset(emoji) {
    const code = unicodeEmojiToCodePoints(emoji);
    if (!code) {
        return null;
    }

    return {
        svg: `${TWEMOJI_SVG_BASE}/${code}.svg`,
        png: `${TWEMOJI_PNG_BASE}/${code}.png`
    };
}

async function fetchEmojiImage(url) {
    if (!url) {
        return null;
    }

    const cached = emojiImageCache.get(url);
    if (cached) {
        return cached;
    }

    const pending = loadImage(url)
        .then(image => {
            emojiImageCache.set(url, image);
            return image;
        })
        .catch(error => {
            emojiImageCache.delete(url);
            throw error;
        });

    emojiImageCache.set(url, pending);
    return pending;
}

function setEmojiImageLoader(loader) {
    if (typeof loader === 'function') {
        emojiImageLoader = loader;
    } else {
        emojiImageLoader = null;
    }
}

async function loadEmojiAsset(url) {
    if (!url) {
        return null;
    }
    const loader = emojiImageLoader || fetchEmojiImage;
    return loader(url);
}

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
            if (!word) {continue;}
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
        const widest = Math.max(...lines.map(line => ctx.measureText(line).width));
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
    const { width } = image;
    const padding = Math.max(16, Math.round(width * 0.04));
    const maxWidth = Math.max(10, width - padding * 2);

    const canvas = createCanvas(width, width);
    const ctx = canvas.getContext('2d');
    ctx.font = `bold ${Math.max(32, Math.round(width / 14))}px "Impact", "Arial Black", sans-serif`;

    const unicodePart = emojiRegexFactory().source;
    const emojiRe = new RegExp(`<a?:\\w+:(?<eid>\\d+)>|(?:${unicodePart})`, 'g');
    const tokens = [];
    let match;
    let lastIndex = 0;
    while ((match = emojiRe.exec(caption)) !== null) {
        if (match.index > lastIndex) {
            tokens.push({ type: 'text', value: caption.slice(lastIndex, match.index) });
        }
        tokens.push({
            type: 'emoji',
            value: match[0],
            id: match.groups?.eid || null,
            animated: match[0].startsWith('<a:')
        });
        lastIndex = emojiRe.lastIndex;
    }
    if (lastIndex < caption.length) {
        tokens.push({ type: 'text', value: caption.slice(lastIndex) });
    }
    if (!tokens.length) {
        tokens.push({ type: 'text', value: caption });
    }

    const words = [];
    for (const token of tokens) {
        if (token.type === 'text') {
            token.value.split(/(\s+)/).forEach(piece => {
                if (!piece) {return;}
                words.push({ type: /\s+/.test(piece) ? 'space' : 'text', value: piece });
            });
        } else {
            words.push(token);
        }
    }

    const emojiSize = Math.max(32, Math.round(width / 18));
    const lines = [];
    let currentLine = [];
    let currentWidth = 0;

    const pushLine = () => {
        if (currentLine.length) {
            lines.push(currentLine);
            currentLine = [];
            currentWidth = 0;
        }
    };

    const measureText = text => ctx.measureText(text).width;

    for (const word of words) {
        const widthToAdd = word.type === 'emoji' ? emojiSize : measureText(word.value);
        if (currentWidth + widthToAdd > maxWidth && currentWidth > 0) { pushLine(); }
        currentLine.push({ ...word, width: widthToAdd });
        currentWidth += widthToAdd;
    }

    pushLine();

    const fontSize = Math.max(32, Math.round(width / 14));
    const lineHeight = fontSize * 1.15;
    const boxHeight = Math.round(lines.length * lineHeight + padding * 2);

    const output = createCanvas(width, image.height + boxHeight);
    const outCtx = output.getContext('2d');
    outCtx.fillStyle = '#ffffff';
    outCtx.fillRect(0, 0, width, boxHeight);
    outCtx.drawImage(image, 0, boxHeight);

    outCtx.textAlign = 'left';
    outCtx.textBaseline = 'top';
    outCtx.font = `bold ${fontSize}px "Impact", "Arial Black", sans-serif`;
    outCtx.fillStyle = '#000000';

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const line = lines[lineIndex];
        const lineWidth = line.reduce((sum, segment) => sum + segment.width, 0);
        let cursorX = Math.round((width - lineWidth) / 2);
        const cursorY = Math.round(padding + lineIndex * lineHeight);

        for (const segment of line) {
            if (segment.type === 'text' || segment.type === 'space') {
                outCtx.fillText(segment.value, cursorX, cursorY);
                cursorX += segment.width;
            } else if (segment.type === 'emoji') {
                const emojiY = cursorY + (lineHeight - emojiSize) / 2;
                let candidateUrls;
                if (segment.id) {
                    const baseUrl = `https://cdn.discordapp.com/emojis/${segment.id}.${segment.animated ? 'gif' : 'png'}?size=96&quality=lossless`;
                    candidateUrls = segment.animated
                        ? [baseUrl, `https://cdn.discordapp.com/emojis/${segment.id}.png?size=96&quality=lossless`]
                        : [baseUrl];
                } else {
                    const asset = buildUnicodeEmojiAsset(segment.value);
                    candidateUrls = asset ? [asset.svg, asset.png] : [];
                    const rawCode = [...segment.value].map(c => c.codePointAt(0).toString(16)).join('-');
                    if (asset && rawCode !== unicodeEmojiToCodePoints(segment.value)) {
                        candidateUrls.push(`${TWEMOJI_PNG_BASE}/${rawCode}.png`);
                    }
                }
                let rendered = false;
                for (const url of candidateUrls) {
                    try {
                        const emojiImage = await loadEmojiAsset(url);
                        if (emojiImage) {
                            outCtx.drawImage(emojiImage, cursorX, emojiY, emojiSize, emojiSize);
                            rendered = true;
                            break;
                        }
                    } catch (error) { /* Try next candidate */ }
                }
                if (!rendered) {
                    outCtx.font = `${emojiSize}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
                    outCtx.fillText(segment.value, cursorX, emojiY);
                    outCtx.font = `bold ${fontSize}px "Impact", "Arial Black", sans-serif`;
                }
                cursorX += emojiSize;
            }
        }
    }

    return output.toBuffer('image/png');
}

async function createImpactMemeImage(imageBuffer, topText = '', bottomText = '') {
    const image = await loadImage(imageBuffer);
    const { width } = image;
    const { height } = image;
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
            lines
                .slice()
                .reverse()
                .forEach((line, idx) => {
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
    createImpactMemeImage,
    _internal: {
        unicodeEmojiToCodePoints,
        buildUnicodeEmojiAsset,
        fetchEmojiImage,
        emojiImageCache,
        setEmojiImageLoader,
        loadEmojiAsset
    }
};

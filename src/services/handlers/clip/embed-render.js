'use strict';

const { createCanvas } = require('canvas');
const { loadImageSafe } = require('./image-loader');

const EMBED_BAR_WIDTH = 4;
const EMBED_BG_COLOR = '#2b2d31';
const EMBED_PADDING = 16;
const EMBED_MAX_WIDTH = 520;
const EMBED_RADIUS = 4;

function embedColorHex(embed) {
    if (embed.color == null) {return '#1e1f22';}
    return `#${embed.color.toString(16).padStart(6, '0')}`;
}

function truncateText(text, maxLength) {
    if (!text || text.length <= maxLength) {return text;}
    return text.slice(0, maxLength - 1) + '\u2026';
}

function truncateUrls(text, maxLen = 50) {
    return text.replace(/https?:\/\/[^\s\])>]{1,}/g, url => {
        if (url.length <= maxLen) {return url;}
        return url.slice(0, maxLen - 1) + '\u2026';
    });
}

function wrapText(ctx, text, maxWidth) {
    const lines = [];
    for (const rawLine of text.split('\n')) {
        if (!rawLine) {lines.push(''); continue;}
        const words = rawLine.split(/(\s+)/);
        let currentLine = '';
        for (const word of words) {
            if (ctx.measureText(word).width > maxWidth && !currentLine.trim()) {
                let chunk = '';
                for (const ch of word) {
                    if (ctx.measureText(chunk + ch).width > maxWidth && chunk) {
                        lines.push(chunk);
                        chunk = ch;
                    } else {
                        chunk += ch;
                    }
                }
                currentLine = chunk;
                continue;
            }
            const test = currentLine + word;
            if (ctx.measureText(test).width > maxWidth && currentLine.trim()) {
                lines.push(currentLine);
                currentLine = word.trimStart();
            } else {
                currentLine = test;
            }
        }
        if (currentLine) {lines.push(currentLine);}
    }
    return lines;
}

function calculateEmbedHeight(ctx, embed, innerWidth, sanitizeMessageText) {
    let h = EMBED_PADDING;
    if (embed.author?.name) {
        h += 22;
    }
    if (embed.title) {
        ctx.font = 'bold 15px Arial';
        h += wrapText(ctx, embed.title, innerWidth).length * 20 + 4;
    }
    if (embed.description) {
        ctx.font = '14px Arial';
        const descText = truncateUrls(sanitizeMessageText(embed.description));
        h += wrapText(ctx, descText, innerWidth).length * 19 + 4;
    }
    if (embed.fields?.length) {
        h += 8;
        let rowWidth = 0;
        for (const field of embed.fields) {
            ctx.font = 'bold 13px Arial';
            const nameLines = wrapText(ctx, field.name || '', innerWidth).length;
            ctx.font = '13px Arial';
            const valLines = wrapText(ctx, truncateUrls(sanitizeMessageText(field.value || '')), field.inline ? innerWidth * 0.3 : innerWidth).length;
            const fieldH = nameLines * 17 + valLines * 17 + 8;
            if (field.inline) {
                if (rowWidth + innerWidth * 0.33 > innerWidth) {
                    rowWidth = 0;
                }
                if (rowWidth === 0) {h += fieldH;}
                rowWidth += innerWidth * 0.33;
            } else {
                rowWidth = 0;
                h += fieldH;
            }
        }
    }
    if (embed.footer?.text) {
        h += 22;
    }
    h += EMBED_PADDING;
    return h;
}

async function drawEmbed(ctx, embed, startX, startY, maxWidth, deps) {
    const { drawRoundedRect, sanitizeMessageText } = deps;
    const embedWidth = Math.min(maxWidth, EMBED_MAX_WIDTH);
    const innerWidth = embedWidth - EMBED_BAR_WIDTH - EMBED_PADDING * 2;
    const embedHeight = calculateEmbedHeight(ctx, embed, innerWidth, sanitizeMessageText);
    const barColor = embedColorHex(embed);

    drawRoundedRect(ctx, startX, startY, embedWidth, embedHeight, EMBED_RADIUS);
    ctx.fillStyle = EMBED_BG_COLOR;
    ctx.fill();

    ctx.fillStyle = barColor;
    drawRoundedRect(ctx, startX, startY, EMBED_BAR_WIDTH, embedHeight, EMBED_RADIUS);
    ctx.fill();
    ctx.fillRect(startX + EMBED_RADIUS, startY, EMBED_BAR_WIDTH - EMBED_RADIUS, embedHeight);

    const contentX = startX + EMBED_BAR_WIDTH + EMBED_PADDING;
    let cursorY = startY + EMBED_PADDING;

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    if (embed.author?.name) {
        if (embed.author.iconURL) {
            try {
                const iconImg = await loadImageSafe(embed.author.iconURL);
                ctx.save();
                ctx.beginPath();
                ctx.arc(contentX + 10, cursorY + 8, 10, 0, Math.PI * 2);
                ctx.clip();
                ctx.drawImage(iconImg, contentX, cursorY - 2, 20, 20);
                ctx.restore();
                ctx.fillStyle = '#f2f3f5';
                ctx.font = 'bold 13px Arial';
                ctx.fillText(truncateText(embed.author.name, 60), contentX + 26, cursorY);
            } catch (_) {
                ctx.fillStyle = '#f2f3f5';
                ctx.font = 'bold 13px Arial';
                ctx.fillText(truncateText(embed.author.name, 60), contentX, cursorY);
            }
        } else {
            ctx.fillStyle = '#f2f3f5';
            ctx.font = 'bold 13px Arial';
            ctx.fillText(truncateText(embed.author.name, 60), contentX, cursorY);
        }
        cursorY += 22;
    }

    if (embed.title) {
        ctx.fillStyle = embed.url ? '#00a8fc' : '#f2f3f5';
        ctx.font = 'bold 15px Arial';
        for (const line of wrapText(ctx, embed.title, innerWidth)) {
            ctx.fillText(line, contentX, cursorY);
            cursorY += 20;
        }
        cursorY += 4;
    }

    if (embed.description) {
        ctx.font = '14px Arial';
        const descText = truncateUrls(sanitizeMessageText(embed.description));
        for (const line of wrapText(ctx, descText, innerWidth)) {
            const urlPattern = /https?:\/\/[^\s\])>]+[\u2026]?/g;
            let lastIdx = 0;
            let drawX = contentX;
            let match;
            while ((match = urlPattern.exec(line)) !== null) {
                const before = line.slice(lastIdx, match.index);
                if (before) {
                    ctx.fillStyle = '#dbdee1';
                    ctx.fillText(before, drawX, cursorY);
                    drawX += ctx.measureText(before).width;
                }
                ctx.fillStyle = '#00a8fc';
                ctx.fillText(match[0], drawX, cursorY);
                drawX += ctx.measureText(match[0]).width;
                lastIdx = match.index + match[0].length;
            }
            const remaining = line.slice(lastIdx);
            if (remaining) {
                ctx.fillStyle = '#dbdee1';
                ctx.fillText(remaining, drawX, cursorY);
            }
            cursorY += 19;
        }
        cursorY += 4;
    }

    if (embed.fields?.length) {
        cursorY += 4;
        let fieldX = contentX;
        let maxFieldBottomY = cursorY;
        const columnWidth = Math.floor(innerWidth * 0.33);
        for (const field of embed.fields) {
            if (field.inline) {
                if (fieldX + columnWidth > contentX + innerWidth) {
                    fieldX = contentX;
                    cursorY = maxFieldBottomY + 4;
                }
            } else {
                if (fieldX !== contentX) {
                    cursorY = maxFieldBottomY + 4;
                }
                fieldX = contentX;
            }
            const fw = field.inline ? columnWidth - 8 : innerWidth;
            let fy = cursorY;
            ctx.fillStyle = '#f2f3f5';
            ctx.font = 'bold 13px Arial';
            for (const line of wrapText(ctx, field.name || '', fw)) {
                ctx.fillText(line, fieldX, fy);
                fy += 17;
            }
            ctx.fillStyle = '#dbdee1';
            ctx.font = '13px Arial';
            for (const line of wrapText(ctx, truncateUrls(sanitizeMessageText(field.value || '')), fw)) {
                ctx.fillText(line, fieldX, fy);
                fy += 17;
            }
            if (fy > maxFieldBottomY) {maxFieldBottomY = fy;}
            if (field.inline) {
                fieldX += columnWidth;
            } else {
                cursorY = fy + 4;
                maxFieldBottomY = cursorY;
            }
        }
        cursorY = maxFieldBottomY;
    }

    if (embed.footer?.text) {
        cursorY += 4;
        ctx.fillStyle = '#949ba4';
        ctx.font = '12px Arial';
        ctx.fillText(truncateText(embed.footer.text, 80), contentX, cursorY);
        cursorY += 18;
    }

    return embedHeight;
}

function calculateTotalEmbedHeight(ctx, embeds, maxWidth, sanitizeMessageText) {
    if (!embeds?.length) {return 0;}
    let total = 0;
    const embedWidth = Math.min(maxWidth, EMBED_MAX_WIDTH);
    const innerWidth = embedWidth - EMBED_BAR_WIDTH - EMBED_PADDING * 2;
    for (const embed of embeds) {
        if (!embed.description && !embed.title && !embed.author?.name && !embed.fields?.length && !embed.footer?.text) {continue;}
        total += calculateEmbedHeight(ctx, embed, innerWidth, sanitizeMessageText) + 8;
    }
    return total;
}

async function renderEmbedsToBuffer(embeds, maxWidth, deps) {
    const { drawRoundedRect, sanitizeMessageText } = deps;
    const renderableEmbeds = (embeds || []).filter(e => e.description || e.title || e.author?.name || e.fields?.length || e.footer?.text);
    if (!renderableEmbeds.length) {return null;}
    const pad = 12;
    const measCanvas = createCanvas(1, 1);
    const measCtx = measCanvas.getContext('2d');
    const embedWidth = Math.min(maxWidth || EMBED_MAX_WIDTH, EMBED_MAX_WIDTH);
    const innerWidth = embedWidth - EMBED_BAR_WIDTH - EMBED_PADDING * 2;
    let totalHeight = pad;
    for (const embed of renderableEmbeds) {
        totalHeight += calculateEmbedHeight(measCtx, embed, innerWidth, sanitizeMessageText) + 8;
    }
    totalHeight += pad;
    const canvas = createCanvas(embedWidth + pad * 2, totalHeight);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#313338';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    let cursorY = pad;
    for (const embed of renderableEmbeds) {
        const h = await drawEmbed(ctx, embed, pad, cursorY, embedWidth, deps);
        cursorY += h + 8;
    }
    return canvas.toBuffer('image/png');
}

module.exports = {
    EMBED_BAR_WIDTH,
    EMBED_BG_COLOR,
    EMBED_PADDING,
    EMBED_MAX_WIDTH,
    EMBED_RADIUS,
    embedColorHex,
    truncateUrls,
    wrapText,
    calculateEmbedHeight,
    calculateTotalEmbedHeight,
    drawEmbed,
    renderEmbedsToBuffer
};

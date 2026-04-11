'use strict';

const { PermissionsBitField, UserFlags } = require('discord.js');
const { createCanvas, loadImage } = require('canvas');
const sharp = require('sharp');
const { fetchBuffer } = require('../../utils/net-guard');
const {
    escapeRegExp,
    resolveChannelDisplay,
    resolveDiscordRichText,
    resolveRoleDisplay,
    resolveUserDisplay
} = require('../../utils/discord-rich-text');
const emojiRegexFactory = require('emoji-regex');

const DEFAULT_CUSTOM_EMOJI_SIZE = 128;
const TWEMOJI_SVG_BASE = 'https://cdn.jsdelivr.net/gh/twitter/twemoji@latest/assets/svg';
const TWEMOJI_PNG_BASE = 'https://cdn.jsdelivr.net/gh/twitter/twemoji@latest/assets/72x72';
const MENTION_PILL_BACKGROUND = 'rgba(88, 101, 242, 0.3)';
const MENTION_PILL_TEXT = '#dee0fc';
const MENTION_PILL_HORIZONTAL_PADDING = 4;
const MENTION_PILL_HEIGHT = 18;
const MENTION_PILL_RADIUS = 4;

// Discord-style formatting markers (Unicode Private Use Area)
const STYLE = {
    BOLD: '\uE001', ITALIC: '\uE002', UNDERLINE: '\uE003',
    STRIKE: '\uE004', CODE: '\uE005', CODEBLOCK_START: '\uE006',
    CODEBLOCK_END: '\uE007', SPOILER: '\uE008',
};
const STYLE_MARKERS_RE = /[\uE001-\uE008]/g;
const STYLE_PLACEHOLDERS_RE = /[\uE010-\uE013]/g;
function stripStyleMarkers(text) { return text ? text.replace(STYLE_MARKERS_RE, '') : ''; }

const CODE_BG = '#2b2d31';
const CODE_FG = '#b5b9bf';
const INLINE_CODE_BG = '#383a40';
const INLINE_CODE_RADIUS = 3;
const CODE_PADDING = 8;
const CODE_LINE_HEIGHT = 19;
const CODE_FONT = '13px "Consolas", "Andale Mono", "Courier New", monospace';
const CODE_BLOCK_RADIUS = 4;

function envInt(name, fallback, min) { return Math.max(min, Number(process.env[name] || '') || fallback); }
const MAX_REMOTE_IMAGE_BYTES = envInt('REMOTE_IMAGE_MAX_BYTES', 10 * 1024 * 1024, 1024 * 1024);

function ensureDiscordEmojiSize(url, size = DEFAULT_CUSTOM_EMOJI_SIZE) {
    if (!url || typeof url !== 'string') {return url;}
    const base = url.split('?')[0];
    return `${base}?size=${size}&quality=lossless`;
}

function unicodeEmojiToCodePoints(emoji) {
    if (!emoji) {return null;}
    const codePoints = [];
    for (const symbol of Array.from(emoji)) {
        const codePoint = symbol.codePointAt(0);
        if (typeof codePoint === 'number' && codePoint !== 0xfe0f) {
            const hex = codePoint.toString(16).toLowerCase();
            codePoints.push(hex.padStart(codePoint > 0xffff ? hex.length : 4, '0'));
        }
    }
    return codePoints.length ? codePoints.join('-') : null;
}

function buildUnicodeEmojiAsset(emoji) {
    const code = unicodeEmojiToCodePoints(emoji);
    if (!code) {return null;}
    return {
        svg: `${TWEMOJI_SVG_BASE}/${code}.svg`,
        png: `${TWEMOJI_PNG_BASE}/${code}.png`
    };
}

function getUserRoleColor(member) {
    try {
        if (!member || !member.roles) {
            return '#f2f3f5';
        }
        const coloredRoles = member.roles.cache
            .filter(role => role.color !== 0 && role.name !== '@everyone')
            .sort((a, b) => b.position - a.position);
        if (coloredRoles.size > 0) {
            const topRole = coloredRoles.first();
            return `#${topRole.color.toString(16).padStart(6, '0')}`;
        }
        return '#f2f3f5';
    } catch (error) {
        console.warn('Failed to get role color:', error);
        return '#f2f3f5';
    }
}

function getSafeDisplayName(member, author) {
    try {
        const rawName = (member && member.displayName) ? member.displayName : (author && author.username ? author.username : 'User');
        let name = rawName.normalize('NFKC');
        name = name.replace(/[\p{C}\p{Cf}]/gu, '');
        name = name.replace(/[^\p{L}\p{N}\p{M} _\-'.]/gu, '');
        name = name.replace(/\s+/g, ' ').trim();
        if (!name) {name = (author && author.username) ? author.username : 'User';}
        return name;
    } catch (_) {
        return (author && author.username) ? author.username : 'User';
    }
}

function isBotVerified(user) {
    try {
        return user.publicFlags && user.publicFlags.has(UserFlags.VerifiedBot);
    } catch (error) {
        console.warn('Failed to check bot verification status:', error);
        return false;
    }
}

function truncateText(text, maxLength) {
    if (text.length <= maxLength) {return text;}
    return `${text.substring(0, maxLength - 3)}...`;
}

function fitTextToWidth(ctx, text, maxWidth) {
    const value = String(text || '');
    if (!value || maxWidth <= 0) {return '';}
    if (ctx.measureText(value).width <= maxWidth) {
        return value;
    }

    const ellipsis = '...';
    const ellipsisWidth = ctx.measureText(ellipsis).width;
    if (ellipsisWidth >= maxWidth) {
        return ellipsis;
    }

    let end = value.length;
    while (end > 0) {
        const candidate = `${value.slice(0, end)}${ellipsis}`;
        if (ctx.measureText(candidate).width <= maxWidth) {
            return candidate;
        }
        end--;
    }
    return ellipsis;
}

function parseDiscordTimestamp(message) {
    try {
        const date = message.createdAt;
        const options = { hour: 'numeric', minute: '2-digit', hour12: true };
        return date.toLocaleTimeString('en-US', options);
    } catch (error) {
        console.warn('Failed to parse Discord timestamp:', error);
        return '6:39 PM';
    }
}

function extractImageUrls(text) {
    const imageUrlRegex = /(https?:\/\/[^\s]+\.(?:jpg|jpeg|png|gif|webp|bmp|svg)(?:\?[^\s]*)?)/gi;
    const imageMatches = text.match(imageUrlRegex) || [];
    const tenorRegex = /(https?:\/\/tenor\.com\/[^\s]+)/gi;
    const tenorMatches = text.match(tenorRegex) || [];
    const tenorIdPatterns = [/\/view\/[^-]+-(\d+)/, /\/view\/(\d+)/, /-(\d+)(?:-|$)/];
    const tenorGifUrls = tenorMatches.map(tenorUrl => {
        try {
            for (const pat of tenorIdPatterns) {
                const m = tenorUrl.match(pat);
                if (m) {return `https://media.tenor.com/${m[1]}.gif`;}
            }
            console.warn('Could not extract GIF ID from Tenor URL:', tenorUrl);
            return tenorUrl;
        } catch (error) {
            console.warn('Failed to convert Tenor URL:', error);
            return tenorUrl;
        }
    });
    return [...imageMatches, ...tenorGifUrls];
}

function sanitizeMessageText(text) {
    if (!text) {return '';}
    let sanitized = text
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/[\u2028\u2029]/g, '\n');
    sanitized = sanitized.replace(/[\u200B-\u200D\u2060\uFEFF]/g, '');
    sanitized = sanitized.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1');
    sanitized = sanitized.replace(/<(https?:\/\/[^>\s]+)>/g, '$1');
    sanitized = sanitized.replace(/```[^\n]*\n([\s\S]*?)```/g, '$1');
    sanitized = sanitized.replace(/```/g, '');
    sanitized = sanitized.replace(/\*\*(.*?)\*\*/g, '$1');
    sanitized = sanitized.replace(/(?<!\*)\*(?!\*)([^*]+)\*(?!\*)/g, '$1');
    sanitized = sanitized.replace(/(?<!_)_(?!_)([^_]+)_(?!_)/g, '$1');
    sanitized = sanitized.replace(/~~(.*?)~~/g, '$1');
    sanitized = sanitized.replace(/__(.*?)__/g, '$1');
    sanitized = sanitized.replace(/`([^`]+)`/g, '$1');
    sanitized = sanitized.replace(/[^\S\r\n]+/g, ' ');
    sanitized = sanitized.replace(/\n[ \t]+/g, '\n');
    sanitized = sanitized.replace(/[ \t]+\n/g, '\n');
    return sanitized.trimEnd();
}

function parseFormattedText(text) {
    if (!text) {return '';}
    let s = text
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/[\u2028\u2029]/g, '\n');
    s = s.replace(/[\u200B-\u200D\u2060\uFEFF]/g, '');
    s = s.replace(STYLE_MARKERS_RE, '');
    s = s.replace(STYLE_PLACEHOLDERS_RE, '');
    s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1');
    s = s.replace(/<(https?:\/\/[^>\s]+)>/g, '$1');
    const codeBlocks = [];
    s = s.replace(/```[^\n]*\n([\s\S]*?)```/g, (_, content) => {
        codeBlocks.push(content.replace(/\n$/, ''));
        return `\uE010${codeBlocks.length - 1}\uE011`;
    });
    s = s.replace(/```([\s\S]*?)```/g, (_, content) => {
        codeBlocks.push(content);
        return `\uE010${codeBlocks.length - 1}\uE011`;
    });
    const inlineCodes = [];
    s = s.replace(/`([^`\n]+)`/g, (_, content) => {
        inlineCodes.push(content);
        return `\uE012${inlineCodes.length - 1}\uE013`;
    });
    s = s.replace(/\*\*\*([\s\S]+?)\*\*\*/g, `${STYLE.BOLD}${STYLE.ITALIC}$1${STYLE.ITALIC}${STYLE.BOLD}`);
    s = s.replace(/___([\s\S]+?)___/g, `${STYLE.UNDERLINE}${STYLE.ITALIC}$1${STYLE.ITALIC}${STYLE.UNDERLINE}`);
    s = s.replace(/\*\*([\s\S]+?)\*\*/g, `${STYLE.BOLD}$1${STYLE.BOLD}`);
    s = s.replace(/__([\s\S]+?)__/g, `${STYLE.UNDERLINE}$1${STYLE.UNDERLINE}`);
    s = s.replace(/(?<!\*)\*(?!\*)([^*\n]+?)\*(?!\*)/g, `${STYLE.ITALIC}$1${STYLE.ITALIC}`);
    s = s.replace(/(?<!_)_(?!_)([^_\n]+?)_(?!_)/g, `${STYLE.ITALIC}$1${STYLE.ITALIC}`);
    s = s.replace(/~~([\s\S]+?)~~/g, `${STYLE.STRIKE}$1${STYLE.STRIKE}`);
    s = s.replace(/\|\|([\s\S]+?)\|\|/g, `${STYLE.SPOILER}$1${STYLE.SPOILER}`);
    s = s.replace(/[^\S\r\n]+/g, ' ');
    s = s.replace(/\n[ \t]+/g, '\n');
    s = s.replace(/[ \t]+\n/g, '\n');
    s = s.replace(/\uE010(\d+)\uE011/g, (_, i) => `\n${STYLE.CODEBLOCK_START}${codeBlocks[Number(i)]}${STYLE.CODEBLOCK_END}\n`);
    s = s.replace(/\uE012(\d+)\uE013/g, (_, i) => `${STYLE.CODE}${inlineCodes[Number(i)]}${STYLE.CODE}`);
    s = s.replace(/\n{3,}/g, '\n\n');
    return s.trimEnd();
}

function buildStyledFont(styles, baseSize = 15) {
    const isMono = styles.code || styles.codeBlock;
    if (isMono) {return CODE_FONT;}
    const parts = [];
    if (styles.italic) {parts.push('italic');}
    if (styles.bold) {parts.push('bold');}
    parts.push(`${baseSize}px`);
    parts.push('Arial');
    return parts.join(' ');
}

async function fetchEmojiImage(handler, url) {
    if (!url || typeof url !== 'string') {return null;}
    const cached = handler.emojiAssetCache.get(url);
    if (cached) {
        return cached;
    }
    const pending = loadImage(url)
        .then((image) => {
            handler.emojiAssetCache.set(url, image);
            return image;
        })
        .catch((error) => {
            handler.emojiAssetCache.delete(url);
            throw error;
        });
    handler.emojiAssetCache.set(url, pending);
    return pending;
}

async function loadImageSafe(url) {
    const fetched = await fetchBuffer(url, { method: 'GET' }, { maxBytes: MAX_REMOTE_IMAGE_BYTES });
    if (fetched.tooLarge) {
        throw new Error('Image too large');
    }
    const contentType = String(fetched.contentType || '').toLowerCase();
    if (contentType && !contentType.startsWith('image/')) {
        throw new Error('Invalid image content type');
    }
    return await loadImage(fetched.buffer);
}

async function loadStaticImage(url) {
    try {
        const fetched = await fetchBuffer(url, { method: 'GET' }, { maxBytes: MAX_REMOTE_IMAGE_BYTES });
        if (fetched.tooLarge) {throw new Error('Image too large');}
        const input = fetched.buffer;
        const pngBuffer = await sharp(input).ensureAlpha().extractFrame(0).png().toBuffer();
        return await loadImage(pngBuffer);
    } catch (error) {
        console.warn('Failed to load static GIF frame, falling back to direct load:', error);
        return await loadImageSafe(url);
    }
}

async function parseCustomEmojis(text, guild = null) {
    const emojiRegex = /<a?:(\w+):(\d+)>/g;
    const emojis = [];
    let match;
    while ((match = emojiRegex.exec(text)) !== null) {
        const isAnimated = match[0].startsWith('<a:');
        const name = match[1];
        const id = match[2];
        let emojiUrl = `https://cdn.discordapp.com/emojis/${id}.${isAnimated ? 'gif' : 'png'}`;
        let emojiObject = null;
        if (guild) {
            try {
                emojiObject = guild.emojis.cache.get(id);
                if (emojiObject) {
                    emojiUrl = emojiObject.url || emojiUrl;
                } else {
                    try {
                        const fetchedEmoji = await guild.emojis.fetch(id);
                        if (fetchedEmoji) {
                            emojiObject = fetchedEmoji;
                            emojiUrl = fetchedEmoji.url || emojiUrl;
                        }
                    } catch (fetchError) {
                        if (fetchError.code === 10014) {
                            console.warn(`Emoji ${id} not found in guild ${guild.id}`);
                        } else if (fetchError.code === 50013) {
                            console.warn(`Missing permissions to fetch emoji ${id} from guild ${guild.id}`);
                        } else {
                            console.warn('Failed to fetch emoji from Discord API:', fetchError);
                        }
                    }
                }
            } catch (error) {
                console.warn('Failed to fetch emoji from guild:', error);
            }
        }
        emojiUrl = ensureDiscordEmojiSize(emojiUrl, DEFAULT_CUSTOM_EMOJI_SIZE);
        emojis.push({
            full: match[0],
            name: name,
            id: id,
            url: emojiUrl,
            isAnimated: isAnimated,
            emojiObject: emojiObject,
            start: match.index,
            end: match.index + match[0].length
        });
    }
    return emojis;
}

function parseUnicodeEmojis(text) {
    const unicodeEmojiRe = emojiRegexFactory();
    const emojis = [];
    let match;
    while ((match = unicodeEmojiRe.exec(text)) !== null) {
        const emoji = match[0];
        const asset = buildUnicodeEmojiAsset(emoji);
        emojis.push({
            full: emoji,
            name: emoji,
            id: null,
            url: asset ? asset.svg : null,
            fallbackUrl: asset ? asset.png : null,
            isAnimated: false,
            emojiObject: null,
            start: match.index,
            end: match.index + emoji.length,
            isUnicode: true
        });
    }
    return emojis;
}

async function parseMentions(handler, text, guild = null, client = null, message = null) {
    const styledMentionRegex = /\u0001([^\u0002]+)\u0002/g;
    const userMentionRegex = /<@!?([0-9]{5,})>/g;
    const roleMentionRegex = /<@&([0-9]{5,})>/g;
    const channelMentionRegex = /<#([0-9]{5,})>/g;
    const channelUrlRegex = /https?:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/channels\/(?:@me|\d{5,})\/(\d{5,})(?:\/\d{5,})?/g;
    const mentions = [];
    let match;

    const overlapsExisting = (start, end) => mentions.some(entity => !(end <= entity.start || start >= entity.end));
    const addMentionEntry = (full, display, start, end, id = null) => {
        if (!display || overlapsExisting(start, end)) {return;}
        mentions.push({ full, userId: id, display, start, end });
    };

    const buildMentionEntry = async(full, id, start, end, resolver) => {
        const display = await resolver(id, { guild, client, mentions: message?.mentions });
        addMentionEntry(full, display, start, end, id);
    };

    while ((match = styledMentionRegex.exec(text)) !== null) {
        addMentionEntry(match[0], match[1], match.index, match.index + match[0].length);
    }

    while ((match = userMentionRegex.exec(text)) !== null) {
        await buildMentionEntry(match[0], match[1], match.index, match.index + match[0].length, resolveUserDisplay);
    }

    while ((match = roleMentionRegex.exec(text)) !== null) {
        await buildMentionEntry(match[0], match[1], match.index, match.index + match[0].length, resolveRoleDisplay);
    }

    while ((match = channelMentionRegex.exec(text)) !== null) {
        await buildMentionEntry(match[0], match[1], match.index, match.index + match[0].length, resolveChannelDisplay);
    }

    while ((match = channelUrlRegex.exec(text)) !== null) {
        await buildMentionEntry(match[0], match[1], match.index, match.index + match[0].length, resolveChannelDisplay);
    }

    if (message?.mentions?.users?.size) {
        for (const [userId, user] of message.mentions.users.entries()) {
            let member = null;
            try {
                member = message.mentions.members?.get(userId) || null;
            } catch (_) {}
            const candidateDisplays = Array.from(new Set([
                `@${getSafeDisplayName(member, user)}`,
                user?.username ? `@${user.username}` : null
            ].filter(Boolean)));

            for (const display of candidateDisplays) {
                const regex = new RegExp(escapeRegExp(display), 'g');
                let fallbackMatch;
                while ((fallbackMatch = regex.exec(text)) !== null) {
                    addMentionEntry(display, display, fallbackMatch.index, fallbackMatch.index + display.length, userId);
                }
            }
        }
    }

    if (message?.mentions?.roles?.size) {
        for (const [roleId, role] of message.mentions.roles.entries()) {
            const display = `@${role.name}`;
            const regex = new RegExp(escapeRegExp(display), 'g');
            let fallbackMatch;
            while ((fallbackMatch = regex.exec(text)) !== null) {
                addMentionEntry(display, display, fallbackMatch.index, fallbackMatch.index + display.length, roleId);
            }
        }
    }

    if (message?.mentions?.channels?.size) {
        for (const [channelId, channel] of message.mentions.channels.entries()) {
            const display = `#${channel.name}`;
            const regex = new RegExp(escapeRegExp(display), 'g');
            let fallbackMatch;
            while ((fallbackMatch = regex.exec(text)) !== null) {
                addMentionEntry(display, display, fallbackMatch.index, fallbackMatch.index + display.length, channelId);
            }
        }
    }

    mentions.sort((a, b) => a.start - b.start);
    return mentions;
}

function drawVerifiedBadge(ctx, x, y, size = 16) {
    try {
        ctx.save();
        // Blue circle background
        ctx.fillStyle = '#5865f2';
        ctx.beginPath();
        ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
        ctx.fill();
        // White checkmark
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(x + size * 0.28, y + size * 0.5);
        ctx.lineTo(x + size * 0.44, y + size * 0.66);
        ctx.lineTo(x + size * 0.72, y + size * 0.34);
        ctx.stroke();
        ctx.restore();
    } catch (error) {
        console.warn('Failed to draw verified badge:', error);
    }
}

function splitTextWithEmojisAndMentions(text, allEmojis, mentions) {
    const segments = [];
    let lastIndex = 0;
    const sortedEmojis = allEmojis.sort((a, b) => a.start - b.start);
    const sortedMentions = (mentions || []).sort((a, b) => a.start - b.start);
    let i = 0, j = 0;
    const items = [];
    while (i < sortedEmojis.length || j < sortedMentions.length) {
        const nextEmoji = i < sortedEmojis.length ? sortedEmojis[i] : null;
        const nextMention = j < sortedMentions.length ? sortedMentions[j] : null;
        const takeEmoji = nextEmoji && (!nextMention || nextEmoji.start <= nextMention.start);
        if (takeEmoji) { items.push({ kind: 'emoji', item: nextEmoji }); i++; }
        else { items.push({ kind: 'mention', item: nextMention }); j++; }
    }
    for (const entry of items) {
        const posStart = entry.item.start;
        const posEnd = entry.item.end;
        if (posStart > lastIndex) {
            const textSegment = text.substring(lastIndex, posStart);
            if (textSegment) {segments.push({ type: 'text', text: textSegment });}
        }
        if (entry.kind === 'emoji') {
            const emoji = entry.item;
            segments.push({
                type: 'emoji',
                name: emoji.name,
                url: emoji.url,
                fallbackUrl: emoji.fallbackUrl,
                full: emoji.full,
                id: emoji.id,
                isUnicode: emoji.isUnicode
            });
        } else {
            const mention = entry.item;
            segments.push({ type: 'mention', text: mention.display });
        }
        lastIndex = posEnd;
    }
    if (lastIndex < text.length) {
        const remainingText = text.substring(lastIndex);
        if (remainingText) {
            segments.push({ type: 'text', text: remainingText });
        }
    }
    return segments;
}

function measureCodeBlockHeight(ctx, content, maxWidth) {
    ctx.font = CODE_FONT;
    const innerWidth = maxWidth - CODE_PADDING * 2;
    let lineCount = 1;
    for (const rawLine of content.split('\n')) {
        if (!rawLine) {lineCount++; continue;}
        let lineW = 0;
        for (const ch of rawLine) {
            const w = ctx.measureText(ch).width;
            if (lineW + w > innerWidth && lineW > 0) {lineCount++; lineW = 0;}
            lineW += w;
        }
        if (rawLine !== content.split('\n').pop()) {lineCount++;}
    }
    return lineCount * CODE_LINE_HEIGHT + CODE_PADDING * 2 + 8;
}

function calculateTextHeight(handler, text, maxWidth, customEmojis = [], mentions = []) {
    const tempCanvas = createCanvas(1, 1);
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.font = '15px Arial';
    const lineHeight = 22;
    const emojiSize = 18;
    const emojiSpacing = typeof handler.clipEmojiSpacing === 'number' ? handler.clipEmojiSpacing : 3;
    const emojiAdvance = emojiSize + emojiSpacing;
    let totalHeight = 0;
    const cbRe = new RegExp(`${escapeRegExp(STYLE.CODEBLOCK_START)}([\\s\\S]*?)${escapeRegExp(STYLE.CODEBLOCK_END)}`, 'g');
    const blocks = [];
    let lastEnd = 0;
    let m;
    while ((m = cbRe.exec(text)) !== null) {
        if (m.index > lastEnd) {blocks.push({ type: 'normal', text: text.substring(lastEnd, m.index), offset: lastEnd });}
        blocks.push({ type: 'codeblock', text: m[1], offset: m.index });
        lastEnd = m.index + m[0].length;
    }
    if (lastEnd < text.length) {blocks.push({ type: 'normal', text: text.substring(lastEnd), offset: lastEnd });}
    if (!blocks.length) {blocks.push({ type: 'normal', text, offset: 0 });}
    for (const block of blocks) {
        if (block.type === 'codeblock') {
            totalHeight += measureCodeBlockHeight(tempCtx, block.text, maxWidth);
            continue;
        }
        const blockEnd = block.offset + block.text.length;
        const blockEmojis = customEmojis.concat(mentions.length ? [] : [])
            .filter(e => e.start >= block.offset && e.end <= blockEnd)
            .map(e => ({ ...e, start: e.start - block.offset, end: e.end - block.offset }));
        const blockMentions = (mentions || [])
            .filter(mt => mt.start >= block.offset && mt.end <= blockEnd)
            .map(mt => ({ ...mt, start: mt.start - block.offset, end: mt.end - block.offset }));
        const segments = splitTextWithEmojisAndMentions(block.text, blockEmojis, blockMentions);
        tempCtx.font = '15px Arial';
        let lineCount = 1;
        let currentLineWidth = 0;
        const advanceLine = () => { lineCount++; currentLineWidth = 0; };
        const advanceToken = token => {
            if (!token) {return;}
            const clean = stripStyleMarkers(token);
            if (!clean) {return;}
            const { width } = tempCtx.measureText(clean);
            if (currentLineWidth + width > maxWidth && currentLineWidth > 0) { advanceLine(); }
            currentLineWidth += width;
        };
        const processTokens = segText => {
            for (const token of segText.split(/(\n|\s+)/)) {
                if (!token) {continue;}
                if (token === '\n') { advanceLine(); continue; }
                advanceToken(token);
            }
        };
        for (const segment of segments) {
            if (segment.type === 'emoji') {
                if (segment.isUnicode && !segment.url) {
                    tempCtx.font = '18px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Android Emoji", "EmojiSymbols", "EmojiOne Mozilla", "Twemoji Mozilla", "Segoe UI Symbol", sans-serif';
                    const { width } = tempCtx.measureText(segment.name);
                    tempCtx.font = '15px Arial';
                    if (currentLineWidth + width > maxWidth && currentLineWidth > 0) { advanceLine(); }
                    currentLineWidth += width;
                } else {
                    if (currentLineWidth + emojiAdvance > maxWidth && currentLineWidth > 0) { advanceLine(); }
                    currentLineWidth += emojiAdvance;
                }
            } else if (segment.type === 'mention') {
                const pillWidth = tempCtx.measureText(segment.text).width + (MENTION_PILL_HORIZONTAL_PADDING * 2);
                if (currentLineWidth + pillWidth > maxWidth && currentLineWidth > 0) { advanceLine(); }
                currentLineWidth += pillWidth;
            } else {
                processTokens(segment.text);
            }
        }
        totalHeight += lineCount * lineHeight;
    }
    const baseHeight = 44;
    return baseHeight + totalHeight;
}

function drawCodeBlockSection(ctx, content, x, y, maxWidth) {
    const innerWidth = maxWidth - CODE_PADDING * 2;
    ctx.font = CODE_FONT;
    const lines = [];
    for (const rawLine of content.split('\n')) {
        if (!rawLine) {lines.push(''); continue;}
        let current = '';
        for (const ch of rawLine) {
            if (ctx.measureText(current + ch).width > innerWidth && current) {
                lines.push(current);
                current = ch;
            } else {
                current += ch;
            }
        }
        lines.push(current);
    }
    const blockHeight = lines.length * CODE_LINE_HEIGHT + CODE_PADDING * 2;
    ctx.fillStyle = CODE_BG;
    drawRoundedRect(ctx, x, y, maxWidth, blockHeight, CODE_BLOCK_RADIUS);
    ctx.fill();
    ctx.fillStyle = CODE_FG;
    ctx.font = CODE_FONT;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    let textY = y + CODE_PADDING;
    for (const line of lines) {
        ctx.fillText(line, x + CODE_PADDING, textY);
        textY += CODE_LINE_HEIGHT;
    }
    return blockHeight + 4;
}

async function drawFormattedText(handler, ctx, text, startX, startY, maxWidth, customEmojis, mentions = []) {
    ctx.fillStyle = '#dbdee1';
    ctx.font = '15px Arial';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    let currentY = startY;
    const lineHeight = 22;
    const emojiSize = 18;
    const emojiSpacing = typeof handler.clipEmojiSpacing === 'number' ? handler.clipEmojiSpacing : 3;
    const emojiAdvance = emojiSize + emojiSpacing;

    const cbRe = new RegExp(`${escapeRegExp(STYLE.CODEBLOCK_START)}([\\s\\S]*?)${escapeRegExp(STYLE.CODEBLOCK_END)}`, 'g');
    const blocks = [];
    let lastEnd = 0;
    let cbMatch;
    while ((cbMatch = cbRe.exec(text)) !== null) {
        if (cbMatch.index > lastEnd) {blocks.push({ type: 'normal', text: text.substring(lastEnd, cbMatch.index), offset: lastEnd });}
        blocks.push({ type: 'codeblock', text: cbMatch[1], offset: cbMatch.index });
        lastEnd = cbMatch.index + cbMatch[0].length;
    }
    if (lastEnd < text.length) {blocks.push({ type: 'normal', text: text.substring(lastEnd), offset: lastEnd });}
    if (!blocks.length) {blocks.push({ type: 'normal', text, offset: 0 });}

    const styles = { bold: false, italic: false, underline: false, strike: false, code: false, spoiler: false };
    const toggleStyle = ch => {
        if (ch === STYLE.BOLD) {styles.bold = !styles.bold;}
        else if (ch === STYLE.ITALIC) {styles.italic = !styles.italic;}
        else if (ch === STYLE.UNDERLINE) {styles.underline = !styles.underline;}
        else if (ch === STYLE.STRIKE) {styles.strike = !styles.strike;}
        else if (ch === STYLE.CODE) {styles.code = !styles.code;}
        else if (ch === STYLE.SPOILER) {styles.spoiler = !styles.spoiler;}
    };
    const applyFont = () => { ctx.font = buildStyledFont(styles); };
    let currentLineWidth = 0;
    const advanceLine = () => { currentY += lineHeight; currentLineWidth = 0; };

    const handleTextToken = (token, baseColor = '#dbdee1') => {
        if (!token) {return;}
        let clean = '';
        for (const ch of token) {
            if (STYLE_MARKERS_RE.test(ch)) {toggleStyle(ch); STYLE_MARKERS_RE.lastIndex = 0;}
            else {clean += ch;}
        }
        if (!clean) {return;}
        applyFont();
        const color = styles.spoiler ? '#4e4f54' : styles.code ? CODE_FG : baseColor;
        const { width } = ctx.measureText(clean);
        if (currentLineWidth + width > maxWidth && currentLineWidth > 0) { advanceLine(); }
        const drawX = startX + currentLineWidth;
        if (!/^\s+$/.test(clean)) {
            if (styles.code) {
                ctx.fillStyle = INLINE_CODE_BG;
                drawRoundedRect(ctx, drawX - 3, currentY + 1, width + 6, lineHeight - 2, INLINE_CODE_RADIUS);
                ctx.fill();
            }
            if (styles.spoiler) {
                ctx.fillStyle = '#4e4f54';
                drawRoundedRect(ctx, drawX - 2, currentY + 1, width + 4, lineHeight - 2, 3);
                ctx.fill();
            }
            ctx.fillStyle = color;
            applyFont();
            ctx.fillText(clean, drawX, currentY);
            if (styles.strike) {
                ctx.save();
                ctx.strokeStyle = color;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(drawX, currentY + lineHeight * 0.45);
                ctx.lineTo(drawX + width, currentY + lineHeight * 0.45);
                ctx.stroke();
                ctx.restore();
            }
            if (styles.underline) {
                ctx.save();
                ctx.strokeStyle = color;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(drawX, currentY + lineHeight - 5);
                ctx.lineTo(drawX + width, currentY + lineHeight - 5);
                ctx.stroke();
                ctx.restore();
            }
        }
        currentLineWidth += width;
    };
    const processTokens = (segText, baseColor) => {
        for (const token of segText.split(/(\n|\s+)/)) {
            if (!token) {continue;}
            if (token === '\n') { advanceLine(); continue; }
            handleTextToken(token, baseColor);
        }
    };
    const drawMention = mText => {
        ctx.font = '15px Arial';
        const pillWidth = ctx.measureText(mText).width + (MENTION_PILL_HORIZONTAL_PADDING * 2);
        if (currentLineWidth + pillWidth > maxWidth && currentLineWidth > 0) { advanceLine(); }
        const drawX = startX + currentLineWidth;
        const drawY = currentY + 1;
        const previousFill = ctx.fillStyle;
        ctx.fillStyle = MENTION_PILL_BACKGROUND;
        drawRoundedRect(ctx, drawX, drawY, pillWidth, MENTION_PILL_HEIGHT, MENTION_PILL_RADIUS);
        ctx.fill();
        ctx.fillStyle = MENTION_PILL_TEXT;
        ctx.fillText(mText, drawX + MENTION_PILL_HORIZONTAL_PADDING, currentY);
        ctx.fillStyle = previousFill;
        currentLineWidth += pillWidth;
    };

    const renderEmojiSegment = async (segment) => {
        const hasImageAsset = Boolean(segment.url);
        let rendered = false;
        if (hasImageAsset) {
            if (currentLineWidth + emojiSize > maxWidth && currentLineWidth > 0) { advanceLine(); }
            const drawX = startX + currentLineWidth;
            try {
                const emojiImg = await fetchEmojiImage(handler, segment.url);
                ctx.drawImage(emojiImg, drawX, currentY, emojiSize, emojiSize);
                rendered = true;
            } catch (primaryError) {
                console.warn('Failed to load primary emoji asset:', { name: segment.name, url: segment.url, error: primaryError.message });
                if (segment.fallbackUrl) {
                    try {
                        const fallbackImg = await fetchEmojiImage(handler, segment.fallbackUrl);
                        ctx.drawImage(fallbackImg, drawX, currentY, emojiSize, emojiSize);
                        rendered = true;
                    } catch (fallbackError) {
                        console.warn('Fallback emoji asset also failed:', { name: segment.name, url: segment.fallbackUrl, error: fallbackError.message });
                        if (segment.isUnicode && segment.full) {
                            const rawCode = Array.from(segment.full).map(s => s.codePointAt(0).toString(16).toLowerCase()).join('-');
                            const altUrl = `${TWEMOJI_PNG_BASE}/${rawCode}.png`;
                            if (altUrl !== segment.fallbackUrl) {
                                try {
                                    const altImg = await fetchEmojiImage(handler, altUrl);
                                    ctx.drawImage(altImg, drawX, currentY, emojiSize, emojiSize);
                                    rendered = true;
                                } catch (_) {}
                            }
                        }
                    }
                } else if (segment.id) {
                    const alternativeUrl = ensureDiscordEmojiSize(`https://cdn.discordapp.com/emojis/${segment.id}.png`, DEFAULT_CUSTOM_EMOJI_SIZE);
                    if (alternativeUrl !== segment.url) {
                        try {
                            const fallbackImg = await fetchEmojiImage(handler, alternativeUrl);
                            ctx.drawImage(fallbackImg, drawX, currentY, emojiSize, emojiSize);
                            rendered = true;
                        } catch (altError) {
                            console.warn('Alternative emoji URL also failed:', { name: segment.name, url: alternativeUrl, error: altError.message });
                        }
                    }
                }
            }
            if (rendered) { currentLineWidth += emojiAdvance; return; }
        }
        if (segment.isUnicode) {
            const emojiText = segment.name;
            ctx.font = '18px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Android Emoji", "EmojiSymbols", "EmojiOne Mozilla", "Twemoji Mozilla", "Segoe UI Symbol", sans-serif';
            const textWidth = ctx.measureText(emojiText).width;
            if (currentLineWidth + textWidth > maxWidth && currentLineWidth > 0) { advanceLine(); }
            ctx.fillText(emojiText, startX + currentLineWidth, currentY);
            currentLineWidth += textWidth;
            applyFont();
        } else {
            const drawEmojiAt = (img) => {
                if (currentLineWidth + emojiAdvance > maxWidth && currentLineWidth > 0) { advanceLine(); }
                ctx.drawImage(img, startX + currentLineWidth, currentY, emojiSize, emojiSize);
                currentLineWidth += emojiAdvance;
            };
            const urls = [segment.url];
            if (segment.id) { urls.push(`https://cdn.discordapp.com/emojis/${segment.id}.png`); }
            let drawn = false;
            for (const url of urls) {
                if (drawn || !url) {continue;}
                try { drawEmojiAt(await loadImage(url)); drawn = true; } catch (_) {}
            }
            if (!drawn) { handleTextToken(`:${segment.name}:`); }
        }
    };

    for (const block of blocks) {
        if (block.type === 'codeblock') {
            if (currentLineWidth > 0) { advanceLine(); }
            currentY += drawCodeBlockSection(ctx, block.text, startX, currentY, maxWidth) + 2;
            currentLineWidth = 0;
            ctx.font = '15px Arial';
            continue;
        }
        const blockEnd = block.offset + block.text.length;
        const blockEmojis = customEmojis
            .filter(e => e.start >= block.offset && e.end <= blockEnd)
            .map(e => ({ ...e, start: e.start - block.offset, end: e.end - block.offset }));
        const blockMentions = (mentions || [])
            .filter(mt => mt.start >= block.offset && mt.end <= blockEnd)
            .map(mt => ({ ...mt, start: mt.start - block.offset, end: mt.end - block.offset }));
        const segments = splitTextWithEmojisAndMentions(block.text, blockEmojis, blockMentions);
        for (const segment of segments) {
            if (segment.type === 'emoji') {
                await renderEmojiSegment(segment);
            } else if (segment.type === 'mention') {
                drawMention(segment.text);
            } else {
                processTokens(segment.text, '#dbdee1');
            }
        }
    }
}

async function drawImages(ctx, attachments, imageUrls, startX, startY, maxWidth) {
    let currentY = startY;
    const maxImageWidth = Math.min(maxWidth, 400);
    const maxImageHeight = 300;
    const drawFitImage = (img) => {
        const ar = img.width / img.height;
        let w = maxImageWidth, h = w / ar;
        if (h > maxImageHeight) { h = maxImageHeight; w = h * ar; }
        ctx.drawImage(img, startX, currentY, w, h);
        currentY += h + 10;
    };
    if (attachments && attachments.size > 0) {
        for (const attachment of attachments.values()) {
            if (attachment.contentType && attachment.contentType.startsWith('image/')) {
                try {
                    const isGif = attachment.contentType.includes('gif') || /\.gif(\?|$)/i.test(attachment.url);
                    drawFitImage(isGif ? await loadStaticImage(attachment.url) : await loadImageSafe(attachment.url));
                } catch (error) {
                    console.warn('Failed to load attachment image:', error);
                }
            }
        }
    }
    for (const imageUrl of imageUrls) {
        try {
            let sourceUrl = imageUrl;
            if (/tenor\.com\//i.test(sourceUrl)) {
                const staticUrl = await resolveTenorStatic(sourceUrl);
                if (staticUrl) {sourceUrl = staticUrl;}
            }
            const isGifUrl = /\.gif(\?|$)/i.test(sourceUrl) || /media\.discordapp\.net\//i.test(sourceUrl);
            drawFitImage(isGifUrl ? await loadStaticImage(sourceUrl) : await loadImageSafe(sourceUrl));
        } catch (error) {
            console.warn('Failed to load URL image:', error);
        }
    }
    return currentY;
}

async function resolveTenorStatic(url) {
    try {
        const oembedUrl = `https://tenor.com/oembed?url=${encodeURIComponent(url)}`;
        const res = await fetch(oembedUrl, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!res.ok) {throw new Error(`Tenor oEmbed HTTP ${res.status}`);}
        const data = await res.json();
        if (data && data.thumbnail_url) {return data.thumbnail_url;}
        if (data && data.url) {return data.url;}
    } catch (error) {
        console.warn('Failed to resolve Tenor static image via oEmbed:', error);
    }
    try {
        const pageRes = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!pageRes.ok) {throw new Error(`Tenor page HTTP ${pageRes.status}`);}
        const html = await pageRes.text();
        let metaMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
        if (!metaMatch) {metaMatch = html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i);}
        if (metaMatch && metaMatch[1]) {return metaMatch[1];}
    } catch (err) {
        console.warn('Failed to parse Tenor page for image:', err);
    }
    return null;
}

async function findMessageAcrossChannels(interaction, messageId) {
    try {
        if (interaction.channel && interaction.channel.messages) {
            const msg = await interaction.channel.messages.fetch(messageId);
            if (msg) {return msg;}
        }
    } catch (_) {}
    if (!interaction.guild) {return null;}
    const channels = interaction.guild.channels.cache;
    for (const [, channel] of channels) {
        try {
            if (!channel || typeof channel.isTextBased !== 'function' || !channel.isTextBased()) {continue;}
            const perms = channel.permissionsFor(interaction.client.user.id);
            if (!perms) {continue;}
            if (!perms.has(PermissionsBitField.Flags.ViewChannel)) {continue;}
            if (!perms.has(PermissionsBitField.Flags.ReadMessageHistory)) {continue;}
            const msg = await channel.messages.fetch(messageId);
            if (msg) {return msg;}
        } catch (err) {
            continue;
        }
    }
    return null;
}

// ─── Embed rendering ─────────────────────────────────────────────────────────

const EMBED_BAR_WIDTH = 4;
const EMBED_BG_COLOR = '#2b2d31';
const EMBED_PADDING = 16;
const EMBED_MAX_WIDTH = 520;
const EMBED_RADIUS = 4;

function embedColorHex(embed) {
    if (embed.color == null) {return '#1e1f22';}
    return `#${embed.color.toString(16).padStart(6, '0')}`;
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
            // Force-break words wider than maxWidth
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

function calculateEmbedHeight(ctx, embed, innerWidth) {
    let h = EMBED_PADDING; // top padding
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
    h += EMBED_PADDING; // bottom padding
    return h;
}

function drawRoundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

async function drawEmbed(ctx, embed, startX, startY, maxWidth) {
    const embedWidth = Math.min(maxWidth, EMBED_MAX_WIDTH);
    const innerWidth = embedWidth - EMBED_BAR_WIDTH - EMBED_PADDING * 2;
    const embedHeight = calculateEmbedHeight(ctx, embed, innerWidth);
    const barColor = embedColorHex(embed);

    // Background
    drawRoundedRect(ctx, startX, startY, embedWidth, embedHeight, EMBED_RADIUS);
    ctx.fillStyle = EMBED_BG_COLOR;
    ctx.fill();

    // Colored left bar
    ctx.fillStyle = barColor;
    drawRoundedRect(ctx, startX, startY, EMBED_BAR_WIDTH, embedHeight, EMBED_RADIUS);
    ctx.fill();
    // Overlap a square to remove right-side rounding on the bar
    ctx.fillRect(startX + EMBED_RADIUS, startY, EMBED_BAR_WIDTH - EMBED_RADIUS, embedHeight);

    const contentX = startX + EMBED_BAR_WIDTH + EMBED_PADDING;
    let cursorY = startY + EMBED_PADDING;

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    // Author
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

    // Title
    if (embed.title) {
        ctx.fillStyle = embed.url ? '#00a8fc' : '#f2f3f5';
        ctx.font = 'bold 15px Arial';
        for (const line of wrapText(ctx, embed.title, innerWidth)) {
            ctx.fillText(line, contentX, cursorY);
            cursorY += 20;
        }
        cursorY += 4;
    }

    // Description
    if (embed.description) {
        ctx.font = '14px Arial';
        const descText = truncateUrls(sanitizeMessageText(embed.description));
        for (const line of wrapText(ctx, descText, innerWidth)) {
            // Render URLs in blue, rest in normal color
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

    // Fields
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

    // Footer
    if (embed.footer?.text) {
        cursorY += 4;
        ctx.fillStyle = '#949ba4';
        ctx.font = '12px Arial';
        ctx.fillText(truncateText(embed.footer.text, 80), contentX, cursorY);
        cursorY += 18;
    }

    return embedHeight;
}

function calculateTotalEmbedHeight(ctx, embeds, maxWidth) {
    if (!embeds?.length) {return 0;}
    let total = 0;
    const embedWidth = Math.min(maxWidth, EMBED_MAX_WIDTH);
    const innerWidth = embedWidth - EMBED_BAR_WIDTH - EMBED_PADDING * 2;
    for (const embed of embeds) {
        if (!embed.description && !embed.title && !embed.author?.name && !embed.fields?.length && !embed.footer?.text) {continue;}
        total += calculateEmbedHeight(ctx, embed, innerWidth) + 8;
    }
    return total;
}

// ─── Main clip image creation ────────────────────────────────────────────────

async function createClipImage(handler, text, username, avatarUrl, isBot = false, roleColor = '#f2f3f5', guild = null, client = null, message = null, user = null, attachments = null, embeds = null) {
    const isVerified = user ? isBotVerified(user) : false;
    const hasImages = attachments && attachments.size > 0;
    const imageUrls = extractImageUrls(text);
    // Only pull embed images for embeds that have no text content (purely image embeds)
    const textEmbeds = (embeds || []).filter(e => e.description || e.title || e.author?.name || e.fields?.length || e.footer?.text);
    const imageOnlyEmbeds = (embeds || []).filter(e => !e.description && !e.title && !e.author?.name && !e.fields?.length && !e.footer?.text);
    const embedImageUrls = imageOnlyEmbeds.flatMap(e => {
        const urls = [];
        if (e && e.image && e.image.url) {urls.push(e.image.url);}
        if (e && e.thumbnail && e.thumbnail.url) {urls.push(e.thumbnail.url);}
        return urls;
    });
    let trailingGifUrl = null;
    try {
        const trailing = text.trim().match(/(https?:\/\/\S+?\.gif(?:\?\S*)?)$/i);
        if (trailing && trailing[1]) {trailingGifUrl = trailing[1];}
    } catch (_) {}
    const allImageUrls = [...imageUrls, ...embedImageUrls, ...(trailingGifUrl ? [trailingGifUrl] : [])];
    let cleanedText = text;
    try {
        for (const url of allImageUrls) {
            const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            cleanedText = cleanedText.replace(new RegExp(escaped, 'g'), '').trim();
        }
        cleanedText = cleanedText.replace(/https?:\/\/tenor\.com\/\S+/gi, '').trim();
        cleanedText = cleanedText.replace(/[^\S\r\n]+/g, ' ');
        cleanedText = cleanedText.replace(/\n[ \t]+/g, '\n');
        cleanedText = cleanedText.replace(/[ \t]+\n/g, '\n');
        cleanedText = cleanedText.trimEnd();
    } catch (_) {}
    const resolvedText = await resolveDiscordRichText(cleanedText, {
        guild,
        client,
        mentions: message?.mentions,
        style: true
    });
    const sanitizedText = parseFormattedText(resolvedText);
    const customEmojis = await parseCustomEmojis(sanitizedText, guild);
    const unicodeEmojis = parseUnicodeEmojis(sanitizedText);
    const allEmojis = [...customEmojis, ...unicodeEmojis].sort((a, b) => a.start - b.start);
    const mentions = await parseMentions(handler, sanitizedText, guild, client, message);
    const width = 800;
    const minHeight = 120;
    const textHeight = sanitizedText ? calculateTextHeight(handler, sanitizedText, width - 180, allEmojis, mentions) : 44;
    let actualImageHeight = 0;
    if (hasImages || allImageUrls.length > 0) {
        const tempCanvas = createCanvas(width, 1);
        const tempCtx = tempCanvas.getContext('2d');
        const imageEndY = await drawImages(tempCtx, attachments, allImageUrls, 0, 0, width - 180);
        actualImageHeight = imageEndY + 20;
    }
    // Calculate embed height
    const measCanvas = createCanvas(1, 1);
    const measCtx = measCanvas.getContext('2d');
    const embedHeight = calculateTotalEmbedHeight(measCtx, textEmbeds, width - 180);
    const totalHeight = Math.ceil(Math.max(minHeight, textHeight + actualImageHeight + embedHeight + 40));
    const canvas = createCanvas(width, totalHeight);
    const ctx = canvas.getContext('2d');
    ctx.patternQuality = 'best';
    ctx.quality = 'best';
    ctx.antialias = 'subpixel';
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.textDrawingMode = 'path';
    ctx.fillStyle = '#313338';
    ctx.fillRect(0, 0, width, totalHeight);
    const avatarSize = 48;
    const contentWidth = width - 80;
    const avatarX = 50;
    const avatarY = 20;
    const avatarBackgroundColor = '#313338';
    const drawAvatarFallback = () => {
        ctx.save();
        ctx.beginPath();
        ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
        ctx.fillStyle = avatarBackgroundColor;
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 12px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(username.charAt(0).toUpperCase(), avatarX + avatarSize / 2, avatarY + avatarSize / 2);
        ctx.restore();
    };
    if (avatarUrl) {
        try {
            ctx.save();
            ctx.beginPath();
            ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
            ctx.clip();
            ctx.fillStyle = avatarBackgroundColor;
            ctx.fillRect(avatarX, avatarY, avatarSize, avatarSize);
            const avatarImg = await loadImage(avatarUrl);
            ctx.drawImage(avatarImg, avatarX, avatarY, avatarSize, avatarSize);
            ctx.restore();
        } catch (error) {
            console.warn('Failed to load avatar, using fallback:', error);
            drawAvatarFallback();
        }
    } else {
        drawAvatarFallback();
    }
    const textStartX = avatarX + avatarSize + 20;
    const textStartY = avatarY + 3;
    const maxTextWidth = contentWidth - (avatarSize + 20) - 30;
    const usernameToDraw = fitTextToWidth(ctx, username, maxTextWidth);
    ctx.fillStyle = roleColor;
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(usernameToDraw, textStartX, textStartY);
    let currentX = textStartX + ctx.measureText(usernameToDraw).width + 4;
    if (isBot) {
        const appTagHeight = 17;
        const appTagRadius = 3;
        if (isVerified) {
            const badgeSize = 17;
            drawVerifiedBadge(ctx, currentX, textStartY, badgeSize);
            currentX += badgeSize + 3;
        }
        ctx.font = 'bold 10px Arial';
        const appTextWidth = ctx.measureText('APP').width;
        const appTagWidth = appTextWidth + 8;
        const tagY = textStartY + 1;
        ctx.fillStyle = '#5865f2';
        drawRoundedRect(ctx, currentX, tagY, appTagWidth, appTagHeight, appTagRadius);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.fillText('APP', currentX + 4, tagY + 4);
        currentX += appTagWidth + 5;
    }
    const timestamp = message ? parseDiscordTimestamp(message) : '6:39 PM';
    ctx.font = '13px Arial';
    const timestampWidth = ctx.measureText(timestamp).width;
    const availableWidth = width - currentX - 20;
    if (timestampWidth <= availableWidth) {
        ctx.fillStyle = '#949ba4';
        ctx.fillText(timestamp, currentX, textStartY + 1);
    } else {
        ctx.fillStyle = '#949ba4';
        ctx.fillText(timestamp, textStartX, textStartY + 18);
    }
    let drawY = textStartY + 20;
    // Draw message text (if any)
    if (sanitizedText) {
        ctx.font = '15px Arial';
        await drawFormattedText(handler, ctx, sanitizedText, textStartX, drawY, maxTextWidth, allEmojis, mentions);
        const effectiveTextHeight = Math.max(0, textHeight - 44);
        drawY += effectiveTextHeight + 2;
    }
    // Draw attached images
    if (hasImages || allImageUrls.length > 0) {
        const imageEndY = await drawImages(ctx, attachments, allImageUrls, textStartX, drawY, maxTextWidth);
        drawY = imageEndY + 4;
    }
    // Draw embeds
    if (textEmbeds.length > 0) {
        for (const embed of textEmbeds) {
            const h = await drawEmbed(ctx, embed, textStartX, drawY, maxTextWidth);
            drawY += h + 8;
        }
    }
    const buffer = canvas.toBuffer('image/png');
    const processedBuffer = await sharp(buffer)
        .resize({
            width: 800,
            fit: 'inside',
            withoutEnlargement: true,
            kernel: sharp.kernel.lanczos3
        })
        .png({
            compressionLevel: 6,
            adaptiveFiltering: true,
            quality: 100,
            effort: 6,
            palette: false
        })
        .toBuffer();
    return processedBuffer;
}

async function renderEmbedsToBuffer(embeds, maxWidth = 520) {
    const renderableEmbeds = (embeds || []).filter(e => e.description || e.title || e.author?.name || e.fields?.length || e.footer?.text);
    if (!renderableEmbeds.length) {return null;}
    const pad = 12;
    const measCanvas = createCanvas(1, 1);
    const measCtx = measCanvas.getContext('2d');
    const embedWidth = Math.min(maxWidth, EMBED_MAX_WIDTH);
    const innerWidth = embedWidth - EMBED_BAR_WIDTH - EMBED_PADDING * 2;
    let totalHeight = pad;
    for (const embed of renderableEmbeds) {
        totalHeight += calculateEmbedHeight(measCtx, embed, innerWidth) + 8;
    }
    totalHeight += pad;
    const canvas = createCanvas(embedWidth + pad * 2, totalHeight);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#313338';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    let cursorY = pad;
    for (const embed of renderableEmbeds) {
        const h = await drawEmbed(ctx, embed, pad, cursorY, embedWidth);
        cursorY += h + 8;
    }
    return canvas.toBuffer('image/png');
}

module.exports = {
    createClipImage,
    findMessageAcrossChannels,
    getUserRoleColor,
    getSafeDisplayName,
    isBotVerified,
    truncateText,
    parseDiscordTimestamp,
    extractImageUrls,
    sanitizeMessageText,
    parseCustomEmojis,
    parseUnicodeEmojis,
    parseMentions,
    calculateTextHeight,
    ensureDiscordEmojiSize,
    loadImageSafe,
    loadStaticImage,
    resolveTenorStatic,
    renderEmbedsToBuffer
    ,
    _test: {
        fitTextToWidth,
        splitTextWithEmojisAndMentions,
        sanitizeMessageText,
        parseFormattedText,
        stripStyleMarkers
    }
};

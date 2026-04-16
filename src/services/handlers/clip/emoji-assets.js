'use strict';

const emojiRegexFactory = require('emoji-regex');

const DEFAULT_CUSTOM_EMOJI_SIZE = 128;
const TWEMOJI_SVG_BASE = 'https://cdn.jsdelivr.net/gh/twitter/twemoji@latest/assets/svg';
const TWEMOJI_PNG_BASE = 'https://cdn.jsdelivr.net/gh/twitter/twemoji@latest/assets/72x72';

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

module.exports = {
    DEFAULT_CUSTOM_EMOJI_SIZE,
    TWEMOJI_SVG_BASE,
    TWEMOJI_PNG_BASE,
    ensureDiscordEmojiSize,
    unicodeEmojiToCodePoints,
    buildUnicodeEmojiAsset,
    parseCustomEmojis,
    parseUnicodeEmojis
};

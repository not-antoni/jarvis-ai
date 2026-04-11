/**
 * Convert Discord-flavored markdown into plain readable text for quote rendering.
 * The quote image is plain text only, so we strip markers while keeping content.
 */
function sanitizeQuoteText(text) {
    if (!text) {return '';}

    let sanitized = text
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/[\u2028\u2029]/g, '\n')
        .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '');

    // Triple-backtick code blocks and inline code
    sanitized = sanitized.replace(/```[^\n`]*\n?([\s\S]*?)```/g, '$1');
    sanitized = sanitized.replace(/`([^`]+)`/g, '$1');
    sanitized = sanitized.replace(/```/g, '');

    // Links: [label](url) -> label, <https://x> -> https://x
    sanitized = sanitized.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1');
    sanitized = sanitized.replace(/<(https?:\/\/[^>\s]+)>/g, '$1');

    // Remove common markdown wrappers while keeping inner text
    sanitized = sanitized
        .replace(/(?<!\\)\*\*\*([\s\S]+?)(?<!\\)\*\*\*/g, '$1')
        .replace(/(?<!\\)___([\s\S]+?)(?<!\\)___/g, '$1')
        .replace(/(?<!\\)\*\*([\s\S]+?)(?<!\\)\*\*/g, '$1')
        .replace(/(?<!\\)__([\s\S]+?)(?<!\\)__/g, '$1')
        .replace(/(?<!\\)~~([\s\S]+?)(?<!\\)~~/g, '$1')
        .replace(/(?<!\\)\|\|([\s\S]+?)(?<!\\)\|\|/g, '$1')
        .replace(/(?<![\\*])\*(?!\*)([^*]+?)(?<!\\)\*(?!\*)/g, '$1')
        .replace(/(?<![\\_])_(?!_)([^_]+?)(?<!\\)_(?!_)/g, '$1');

    // Line-level Discord formatting markers (headings/lists/quotes/checklists)
    const lines = sanitized.split('\n');
    sanitized = lines.map(line => line
        .replace(/^\s{0,3}>{1,3}\s?/, '')
        .replace(/^\s{0,3}(?:#{1,6}|-#)\s+/, '')
        .replace(/^\s{0,3}-\s\[[ xX]\]\s+/, '')
        .replace(/^\s{0,3}(?:[-*+]\s+|\d+[.)]\s+)/, '')
    ).join('\n');

    // Unescape escaped markdown chars (\* \# \[ etc)
    sanitized = sanitized.replace(/\\([\\`*_{}[\]()#+.!~>|-])/g, '$1');

    // Normalize spacing while preserving intentional line breaks
    sanitized = sanitized.replace(/[^\S\n]+/g, ' ');
    sanitized = sanitized.replace(/\n[ \t]+/g, '\n');
    sanitized = sanitized.replace(/[ \t]+\n/g, '\n');
    sanitized = sanitized.replace(/\n{3,}/g, '\n\n');

    return sanitized.trim();
}

const QSTYLE = {
    BOLD: '\uE001', ITALIC: '\uE002', UNDERLINE: '\uE003',
    STRIKE: '\uE004', CODE: '\uE005', SPOILER: '\uE008',
};
const QSTYLE_RE = /[\uE001-\uE008]/g;

function parseFormattedQuoteText(text) {
    if (!text) {return '';}

    let s = text
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/[\u2028\u2029]/g, '\n')
        .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '');
    s = s.replace(QSTYLE_RE, '');
    s = s.replace(/[\uE010-\uE013]/g, '');

    s = s.replace(/```[^\n`]*\n?([\s\S]*?)```/g, '$1');
    s = s.replace(/`([^`]+)`/g, `${QSTYLE.CODE}$1${QSTYLE.CODE}`);
    s = s.replace(/```/g, '');

    s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1');
    s = s.replace(/<(https?:\/\/[^>\s]+)>/g, '$1');

    s = s.replace(/(?<!\\)\*\*\*([\s\S]+?)(?<!\\)\*\*\*/g, `${QSTYLE.BOLD}${QSTYLE.ITALIC}$1${QSTYLE.ITALIC}${QSTYLE.BOLD}`);
    s = s.replace(/(?<!\\)___([\s\S]+?)(?<!\\)___/g, `${QSTYLE.UNDERLINE}${QSTYLE.ITALIC}$1${QSTYLE.ITALIC}${QSTYLE.UNDERLINE}`);
    s = s.replace(/(?<!\\)\*\*([\s\S]+?)(?<!\\)\*\*/g, `${QSTYLE.BOLD}$1${QSTYLE.BOLD}`);
    s = s.replace(/(?<!\\)__([\s\S]+?)(?<!\\)__/g, `${QSTYLE.UNDERLINE}$1${QSTYLE.UNDERLINE}`);
    s = s.replace(/(?<!\\)~~([\s\S]+?)(?<!\\)~~/g, `${QSTYLE.STRIKE}$1${QSTYLE.STRIKE}`);
    s = s.replace(/(?<!\\)\|\|([\s\S]+?)(?<!\\)\|\|/g, `${QSTYLE.SPOILER}$1${QSTYLE.SPOILER}`);
    s = s.replace(/(?<![\\*])\*(?!\*)([^*]+?)(?<!\\)\*(?!\*)/g, `${QSTYLE.ITALIC}$1${QSTYLE.ITALIC}`);
    s = s.replace(/(?<![\\_])_(?!_)([^_]+?)(?<!\\)_(?!_)/g, `${QSTYLE.ITALIC}$1${QSTYLE.ITALIC}`);

    const lines = s.split('\n');
    s = lines.map(line => line
        .replace(/^\s{0,3}>{1,3}\s?/, '')
        .replace(/^\s{0,3}(?:#{1,6}|-#)\s+/, '')
        .replace(/^\s{0,3}-\s\[[ xX]\]\s+/, '')
        .replace(/^\s{0,3}(?:[-*+]\s+|\d+[.)]\s+)/, '')
    ).join('\n');

    s = s.replace(/\\([\\`*_{}[\]()#+.!~>|-])/g, '$1');
    s = s.replace(/[^\S\n]+/g, ' ');
    s = s.replace(/\n[ \t]+/g, '\n');
    s = s.replace(/[ \t]+\n/g, '\n');
    s = s.replace(/\n{3,}/g, '\n\n');

    return s.trim();
}

function stripQuoteStyleMarkers(text) {
    return text ? text.replace(QSTYLE_RE, '') : '';
}

module.exports = { sanitizeQuoteText, parseFormattedQuoteText, stripQuoteStyleMarkers, QSTYLE, QSTYLE_RE };

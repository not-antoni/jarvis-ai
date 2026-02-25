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

module.exports = { sanitizeQuoteText };

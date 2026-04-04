'use strict';

const CJK_CHAR_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g;
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}]/gu;
const WORD_RE = /[A-Za-z0-9_]+/g;
const SYMBOL_RE = /[{}[\]()<>`=+\-_*\/\\|;:]/g;

function estimateTokenCount(text) {
    if (!text || typeof text !== 'string') {return 0;}

    const normalized = text.replace(/\r\n?/g, '\n');
    if (!normalized.trim()) {return 0;}

    const cjkChars = (normalized.match(CJK_CHAR_RE) || []).length;
    const emojiChars = (normalized.match(EMOJI_RE) || []).length;
    const words = (normalized.match(WORD_RE) || []).length;
    const symbolChars = (normalized.match(SYMBOL_RE) || []).length;
    const newlineChars = (normalized.match(/\n/g) || []).length;
    const asciiLikeChars = Math.max(0, normalized.length - cjkChars - emojiChars);

    const charEstimate = Math.ceil(asciiLikeChars / 4) + cjkChars + (emojiChars * 2);
    const wordFloor = Math.ceil(words * 0.75) + cjkChars + emojiChars;
    const structurePenalty = Math.ceil(symbolChars / 12) + Math.ceil(newlineChars / 10);

    return Math.max(1, charEstimate + structurePenalty, wordFloor);
}

function truncateTextToTokenLimit(text, maxTokens) {
    const value = typeof text === 'string' ? text : String(text || '');
    const limit = Math.max(0, Number(maxTokens) || 0);

    if (!value) {
        return { text: '', truncated: false, estimatedTokens: 0, originalEstimatedTokens: 0 };
    }

    const originalEstimatedTokens = estimateTokenCount(value);
    if (limit <= 0) {
        return {
            text: '',
            truncated: true,
            estimatedTokens: 0,
            originalEstimatedTokens
        };
    }

    if (originalEstimatedTokens <= limit) {
        return {
            text: value,
            truncated: false,
            estimatedTokens: originalEstimatedTokens,
            originalEstimatedTokens
        };
    }

    let low = 0;
    let high = value.length;

    while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (estimateTokenCount(value.slice(0, mid)) <= limit) {
            low = mid;
        } else {
            high = mid - 1;
        }
    }

    let cut = Math.max(0, low);
    const candidate = value.slice(0, cut);
    const boundary = Math.max(
        candidate.lastIndexOf('\n'),
        candidate.lastIndexOf(' '),
        candidate.lastIndexOf('\t')
    );

    if (boundary >= Math.floor(cut * 0.75)) {
        cut = boundary;
    }

    let truncatedText = value.slice(0, cut).trimEnd();
    if (!truncatedText) {
        truncatedText = value.slice(0, low).trimEnd();
    }

    return {
        text: truncatedText,
        truncated: true,
        estimatedTokens: estimateTokenCount(truncatedText),
        originalEstimatedTokens
    };
}

module.exports = {
    estimateTokenCount,
    truncateTextToTokenLimit
};

'use strict';

/**
 * Detect garbage/poisoned AI output — token degeneration loops, prompt injection residue.
 * Returns true if the text looks like garbage that should NOT be saved to history.
 */
function isGarbageOutput(text) {
    if (!text || typeof text !== 'string') return false;
    if (text.length < 80) return false;

    // Strip code blocks before analysis — code legitimately has syntax chars and repetition
    const stripped = text.replace(/```[\s\S]*?```/g, '').trim();
    if (stripped.length < 80) return false;

    // 1. Word repetition ratio — garbage loops repeat the same few words endlessly
    const words = stripped.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(w => w.length > 1);
    if (words.length > 20) {
        const freq = {};
        for (const w of words) freq[w] = (freq[w] || 0) + 1;
        const uniqueRatio = Object.keys(freq).length / words.length;
        // If fewer than 15% of words are unique in a long text, it's degenerate
        if (uniqueRatio < 0.15 && words.length > 40) return true;
        // Top 5 words making up >60% of all words
        const sorted = Object.values(freq).sort((a, b) => b - a);
        const top5Sum = sorted.slice(0, 5).reduce((s, v) => s + v, 0);
        if (top5Sum / words.length > 0.6 && words.length > 30) return true;
    }

    // 2. CJK character density in a supposedly English response (>35% CJK mixed with English = suspicious)
    const cjkChars = (stripped.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
    const latinChars = (stripped.match(/[a-zA-Z]/g) || []).length;
    if (latinChars > 20 && cjkChars > 10 && cjkChars / (cjkChars + latinChars) > 0.35) return true;

    // 3. Excessive semicolons/brackets mixed with natural words (JS-like garbage)
    const syntaxChars = (stripped.match(/[;(){}\[\]]/g) || []).length;
    if (syntaxChars > 15 && syntaxChars / stripped.length > 0.03 && latinChars > 50) return true;

    return false;
}

module.exports = { isGarbageOutput };

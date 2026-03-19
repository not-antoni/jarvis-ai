const emojiRegex = require('emoji-regex');

const REACT_LABEL_PATTERN = '(?:EMOJI\\s*[_ -]?\\s*REACT(?:ION)?|REACT)';
const BRACKETED_REACT_TAG_REGEX = new RegExp(
    `[\\[(\\{]\\s*${REACT_LABEL_PATTERN}\\s*(?::|=|：|-|\\s)\\s*([^\\]\\)\\}\\n\\r]+?)\\s*[\\])\\}]`,
    'gi'
);
const TRAILING_BARE_REACT_TAG_REGEX = new RegExp(
    `(?:^|\\s)${REACT_LABEL_PATTERN}\\s*(?::|=|：)\\s*([^\\n\\r]+?)\\s*$`,
    'i'
);
const TRAILING_DANGLING_REACT_TAG_REGEX = new RegExp(
    `[\\[(\\{]\\s*${REACT_LABEL_PATTERN}\\s*(?::|=|：|-|\\s)\\s*([^\\n\\r\\]\\)\\}]*)$`,
    'i'
);
const EMPTY_BRACKETED_REACT_TAG_REGEX = new RegExp(
    `[\\[(\\{]\\s*${REACT_LABEL_PATTERN}\\s*(?::|=|：|-)?\\s*[\\])\\}]`,
    'gi'
);
const EMPTY_TRAILING_REACT_TAG_REGEX = new RegExp(
    `(?:^|\\s)${REACT_LABEL_PATTERN}\\s*(?::|=|：|-)\\s*$`,
    'i'
);

function normalizeTextAfterTagStrip(input) {
    return input
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\n[ \t]+/g, '\n')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function pushUnique(list, seen, value) {
    if (!value) {return;}
    const normalized = String(value).trim();
    if (!normalized || seen.has(normalized)) {return;}
    seen.add(normalized);
    list.push(normalized);
}

// Numbered emoji map — indices must match the descriptions in jarvis-core.js emoji instruction
const EMOJI_CODE_MAP = [
    '😂', '👍', '🔥', '💀', '🤔', '❤️', '😎', '🫡', '💯',
    '😭', '🗿', '💔', '👀', '🤡', '😈', '🙏', '⚡', '🎯',
    '😐', '🤝', '💪', '🥶', '😤', '🫠', '✅'
];

function extractCandidatesFromPayload(payload) {
    if (!payload) {return [];}

    const cleanPayload = String(payload)
        .trim()
        .replace(/^['"`]+|['"`]+$/g, '')
        .trim();
    if (!cleanPayload) {return [];}

    const candidates = [];
    const seen = new Set();

    // Numbered code (e.g. "3" → EMOJI_CODE_MAP[3])
    const numMatch = cleanPayload.match(/^\d{1,2}$/);
    if (numMatch) {
        const idx = parseInt(numMatch[0], 10);
        if (idx >= 0 && idx < EMOJI_CODE_MAP.length) {
            pushUnique(candidates, seen, EMOJI_CODE_MAP[idx]);
            return candidates;
        }
    }

    // Custom server emoji code (e.g. "C2") — resolved via Discord custom emoji format
    const customCodeMatch = cleanPayload.match(/^C(\d{1,2})$/i);
    if (customCodeMatch) {
        // The AI may output just "C2" — we can't resolve it here without guild context,
        // but the full tag payload may contain the Discord emoji token from the prompt.
        // Fall through to other extractors.
    }

    // Discord custom emoji token and ID
    const customEmojiRegex = /<a?:[\w~]{2,32}:(\d{17,20})>/g;
    for (const match of cleanPayload.matchAll(customEmojiRegex)) {
        pushUnique(candidates, seen, match[0]);
        pushUnique(candidates, seen, match[1]);
    }

    // Raw custom emoji ID fallback
    const customIdRegex = /\b\d{17,20}\b/g;
    for (const match of cleanPayload.matchAll(customIdRegex)) {
        pushUnique(candidates, seen, match[0]);
    }

    // Unicode emoji candidates
    const unicodeEmojiRegex = emojiRegex();
    for (const match of cleanPayload.matchAll(unicodeEmojiRegex)) {
        pushUnique(candidates, seen, match[0]);
    }

    return candidates;
}

function extractReactionDirective(text) {
    if (typeof text !== 'string') {
        return {
            cleanText: text,
            reaction: null,
            reactionCandidates: [],
            hadDirective: false
        };
    }

    const payloads = [];
    let working = text;

    working = working.replace(BRACKETED_REACT_TAG_REGEX, (_full, payload) => {
        payloads.push(payload || '');
        return ' ';
    });

    const bareMatch = working.match(TRAILING_BARE_REACT_TAG_REGEX);
    if (bareMatch) {
        payloads.push(bareMatch[1] || '');
        working = working.slice(0, bareMatch.index).trimEnd();
    }

    const danglingMatch = working.match(TRAILING_DANGLING_REACT_TAG_REGEX);
    if (danglingMatch) {
        payloads.push(danglingMatch[1] || '');
        working = working.slice(0, danglingMatch.index).trimEnd();
    }

    working = working.replace(EMPTY_BRACKETED_REACT_TAG_REGEX, ' ');

    const emptyTrailingMatch = working.match(EMPTY_TRAILING_REACT_TAG_REGEX);
    if (emptyTrailingMatch) {
        working = working.slice(0, emptyTrailingMatch.index).trimEnd();
    }

    const reactionCandidates = [];
    const seen = new Set();
    for (const payload of payloads) {
        const candidates = extractCandidatesFromPayload(payload);
        for (const candidate of candidates) {
            pushUnique(reactionCandidates, seen, candidate);
        }
    }

    return {
        cleanText: normalizeTextAfterTagStrip(working),
        reaction: reactionCandidates[0] || null,
        reactionCandidates,
        hadDirective: payloads.length > 0
    };
}

function stripReactionDirectives(text) {
    return extractReactionDirective(text).cleanText;
}

module.exports = {
    extractReactionDirective,
    stripReactionDirectives
};

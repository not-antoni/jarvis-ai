'use strict';

const MAX_TTS_CHARS = 500;
const MIN_TRANSCRIPT_LEN = 4;

const NOISE_WORDS = new Set([
    'you', 'uh', 'um', 'hmm', 'hm', 'ah', 'oh', 'mhm', 'mm',
    'yeah', 'yep', 'nah', 'the', 'a', 'ok',
    'bye', 'thank', 'thanks', 'so'
]);

const VOICE_HINT = '[Voice chat — reply in 1-2 short spoken sentences. No markdown, no lists, no formatting. Be concise and conversational.]\n';

function cleanForTts(text) {
    return text
        .replace(/```[\s\S]*?```/g, '')
        .replace(/`([^`]+)`/g, '')
        .replace(/\*{1,3}([^*]*)\*{1,3}/g, '$1')
        .replace(/\([^)]*(?:sighs?|adjusts?|pauses?|clears?|nods?|smiles?|laughs?|chuckles?|whispers?|grins?|leans?|tilts?|gestures?|waves?|bows?|glances?)[^)]*\)/gi, '')
        .replace(/_([^_]+)_/g, '$1')
        .replace(/__([^_]+)__/g, '$1')
        .replace(/~~([^~]+)~~/g, '$1')
        .replace(/\|\|([^|]+)\|\|/g, '$1')
        .replace(/^>+\s?/gm, '')
        .replace(/^#{1,3}\s+/gm, '')
        .replace(/^\d+\.\s+/gm, '')
        .replace(/^[-•]\s+/gm, '')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/<@!?\d+>/g, '')
        .replace(/<#\d+>/g, '')
        .replace(/<a?:\w+:\d+>/g, '')
        .replace(/<t:\d+(?::[tTdDfFR])?>/g, '')
        .replace(/https?:\/\/\S+/g, '')
        .replace(/—/g, ', ')
        .replace(/\.{3}/g, ', ')
        .replace(/\n{2,}/g, '. ')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

function truncateForTts(text) {
    if (text.length <= MAX_TTS_CHARS) {return text;}
    const cut = text.slice(0, MAX_TTS_CHARS);
    const last = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
    return last > MAX_TTS_CHARS * 0.4 ? cut.slice(0, last + 1) : cut + '...';
}

function isNoise(text) {
    if (text.length < MIN_TRANSCRIPT_LEN) {return true;}
    const normalized = text.toLowerCase().replace(/[^a-z\s]/g, '').trim();
    return NOISE_WORDS.has(normalized);
}

function escapeRegex(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsWakeWord(text, wakeWord) {
    const normalizedText = String(text || '').trim();
    const normalizedWakeWord = String(wakeWord || '').trim();
    if (!normalizedText || !normalizedWakeWord) {return false;}
    const pattern = new RegExp(`\\b${escapeRegex(normalizedWakeWord)}\\b`, 'i');
    return pattern.test(normalizedText);
}

module.exports = {
    MAX_TTS_CHARS,
    MIN_TRANSCRIPT_LEN,
    NOISE_WORDS,
    VOICE_HINT,
    cleanForTts,
    truncateForTts,
    isNoise,
    escapeRegex,
    containsWakeWord
};

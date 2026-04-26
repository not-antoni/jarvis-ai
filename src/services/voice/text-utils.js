'use strict';

const MAX_TTS_CHARS = 500;
const MIN_TRANSCRIPT_LEN = 4;

// Filler / single-word transcripts that almost never carry a real instruction.
// Trimmed aggressively so STT noise (#270) doesn't trigger Jarvis.
const NOISE_WORDS = new Set([
    // hesitations
    'you', 'uh', 'um', 'hmm', 'hm', 'ah', 'oh', 'mhm', 'mm', 'mhmm', 'huh',
    // affirm/deny
    'yeah', 'yep', 'yup', 'nah', 'no', 'nope', 'sure', 'right', 'correct',
    // articles / fillers
    'the', 'a', 'an', 'so', 'well', 'like', 'okay', 'ok', 'kay',
    // farewells / thanks (whisper auto-emits these constantly)
    'bye', 'goodbye', 'thank', 'thanks', 'cheers',
    // social
    'hello', 'hi', 'hey', 'yo', 'sup',
    // misc subtitler noise
    'music', 'applause', 'laughter', 'silence', 'inaudible'
]);

const VOICE_HINT = '[Voice chat — reply in 1 short spoken sentence (max 2 if essential). No markdown, no lists, no asterisks, no emojis, no quote marks around the whole reply. Plain conversational speech only.]\n';

function cleanForTts(text) {
    return text
        .replace(/```[\s\S]*?```/g, '')
        .replace(/`([^`]+)`/g, '$1')
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
        // Strip leading/trailing wrap quotes the AI sometimes adds in voice mode.
        .replace(/^["'\u201C\u201D\u2018\u2019]+|["'\u201C\u201D\u2018\u2019]+$/g, '')
        // Replace symbols that don't read well aloud
        .replace(/&/g, ' and ')
        .replace(/—/g, ', ')
        .replace(/\.{3,}/g, ', ')
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
    if (!text || text.length < MIN_TRANSCRIPT_LEN) {return true;}
    const normalized = text.toLowerCase().replace(/[^a-z\s]/g, '').trim();
    if (!normalized) {return true;}
    if (NOISE_WORDS.has(normalized)) {return true;}
    // Multi-token utterance is "noise" only if EVERY token is a known filler.
    const tokens = normalized.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) {return true;}
    if (tokens.length <= 4 && tokens.every(token => NOISE_WORDS.has(token))) {
        return true;
    }
    return false;
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

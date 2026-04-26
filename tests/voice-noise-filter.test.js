'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { isNoise, cleanForTts, NOISE_WORDS } = require('../src/services/voice/text-utils');

// ─── Issue #270: voice noise filtering & TTS cleanup ────────────────────

test('isNoise — rejects very short transcripts', () => {
    assert.equal(isNoise(''), true);
    assert.equal(isNoise('hi'), true);
});

test('isNoise — rejects single-word filler transcripts', () => {
    assert.equal(isNoise('thank you.'), true);
    assert.equal(isNoise('Bye!'), true);
    assert.equal(isNoise('umm'), true);
});

test('isNoise — rejects all-filler short transcripts', () => {
    assert.equal(isNoise('uh um yeah'), true);
    assert.equal(isNoise('okay okay'), true);
});

test('isNoise — accepts real instructions even if short', () => {
    assert.equal(isNoise('jarvis play music'), false);
    assert.equal(isNoise('what is the weather'), false);
});

test('cleanForTts — strips wrap quotes the model sometimes adds', () => {
    assert.equal(cleanForTts('"Right away, sir."'), 'Right away, sir.');
    assert.equal(cleanForTts('\u201CIndeed.\u201D'), 'Indeed.');
});

test('cleanForTts — converts ampersand to "and" for TTS readability', () => {
    assert.equal(cleanForTts('coffee & tea'), 'coffee and tea');
});

test('NOISE_WORDS — covers common whisper subtitler tokens', () => {
    for (const token of ['music', 'applause', 'silence']) {
        assert.ok(NOISE_WORDS.has(token), `expected ${token} to be filtered`);
    }
});

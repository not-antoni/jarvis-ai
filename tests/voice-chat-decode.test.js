'use strict';

require('dotenv').config();

const test = require('node:test');
const assert = require('node:assert/strict');

const voiceChat = require('../src/services/voice-chat-service');

test('voice chat reports an available opus backend', () => {
    const backend = voiceChat._getOpusDecoderBackend();
    assert.match(backend, /^(@discordjs\/opus|opusscript\(asm\))$/);
});

test('_decodeOpus skips oversized and corrupt packets when enough valid audio remains', () => {
    const originalCreateOpusDecoder = voiceChat._createOpusDecoder;
    const seen = [];
    let destroyed = false;

    voiceChat._createOpusDecoder = () => ({
        decode(packet) {
            const value = packet.toString();
            seen.push(value);
            if (value === 'bad') {
                throw new Error('The compressed data passed is corrupted');
            }
            return Buffer.from(`${value}!`);
        },
        destroy() {
            destroyed = true;
        }
    });

    try {
        const pcm = voiceChat._decodeOpus([
            Buffer.from('ok1'),
            Buffer.alloc(5000, 1),
            Buffer.from('bad'),
            Buffer.from('ok2')
        ]);

        assert.equal(destroyed, true);
        assert.deepEqual(seen, ['ok1', 'bad', 'ok2']);
        assert.equal(pcm.toString(), 'ok1!ok2!');
    } finally {
        voiceChat._createOpusDecoder = originalCreateOpusDecoder;
    }
});

test('_decodeOpus aborts the utterance on fatal decoder memory corruption', () => {
    const originalCreateOpusDecoder = voiceChat._createOpusDecoder;
    let destroyed = false;

    voiceChat._createOpusDecoder = () => ({
        decode() {
            throw new Error('memory access out of bounds');
        },
        destroy() {
            destroyed = true;
        }
    });

    try {
        const pcm = voiceChat._decodeOpus([Buffer.from('bad')]);

        assert.equal(pcm, null);
        assert.equal(destroyed, true);
    } finally {
        voiceChat._createOpusDecoder = originalCreateOpusDecoder;
    }
});

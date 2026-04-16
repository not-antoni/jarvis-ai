'use strict';

const OPUS_SAMPLE_RATE = 48_000;
const OPUS_CHANNELS = 2;
const OPUS_FRAME_SIZE = 960;
const MAX_OPUS_PACKET_BYTES = 4096;
const MAX_CORRUPT_OPUS_PACKETS = 8;

let opusDecoderFactory = null;
let opusDecoderBackend = null;
let opusDecoderLoadError = null;

function isRecoverableOpusDecodeError(error) {
    const message = String(error?.message || error || '').toLowerCase();
    return message.includes('corrupt') ||
        message.includes('invalid packet') ||
        message.includes('buffer too small') ||
        message.includes('memory access out of bounds');
}

function isFatalOpusDecodeError(error) {
    return String(error?.message || error || '').toLowerCase().includes('memory access out of bounds');
}

function loadOpusDecoderFactory() {
    if (opusDecoderFactory) {return opusDecoderFactory;}
    if (opusDecoderLoadError) {throw opusDecoderLoadError;}

    const failures = [];

    try {
        const { OpusEncoder } = require('@discordjs/opus');
        opusDecoderBackend = '@discordjs/opus';
        opusDecoderFactory = () => {
            const decoder = new OpusEncoder(OPUS_SAMPLE_RATE, OPUS_CHANNELS);
            return {
                decode(packet) {
                    return Buffer.from(decoder.decode(packet, OPUS_FRAME_SIZE));
                },
                destroy() {}
            };
        };
        return opusDecoderFactory;
    } catch (error) {
        failures.push(`@discordjs/opus: ${error?.message || error}`);
    }

    try {
        const OpusScript = require('opusscript');
        opusDecoderBackend = 'opusscript(asm)';
        opusDecoderFactory = () => {
            const decoder = new OpusScript(OPUS_SAMPLE_RATE, OPUS_CHANNELS, undefined, { wasm: false });
            return {
                decode(packet) {
                    return Buffer.from(decoder.decode(packet));
                },
                destroy() {
                    decoder.delete();
                }
            };
        };
        return opusDecoderFactory;
    } catch (error) {
        failures.push(`opusscript: ${error?.message || error}`);
    }

    opusDecoderLoadError = new Error(`No Opus decoder available (${failures.join('; ')})`);
    throw opusDecoderLoadError;
}

function getOpusBackend() {
    return opusDecoderBackend;
}

module.exports = {
    OPUS_SAMPLE_RATE,
    OPUS_CHANNELS,
    OPUS_FRAME_SIZE,
    MAX_OPUS_PACKET_BYTES,
    MAX_CORRUPT_OPUS_PACKETS,
    isRecoverableOpusDecodeError,
    isFatalOpusDecodeError,
    loadOpusDecoderFactory,
    getOpusBackend
};

'use strict';

const { spawn } = require('node:child_process');

const FFMPEG = process.env.FFMPEG_PATH || (() => {
    try { return require('ffmpeg-static'); } catch { return 'ffmpeg'; }
})();

const FFMPEG_TIMEOUT_MS = 10_000;

function pcmEnergy(buf) {
    const step = 200;
    let sum = 0;
    let count = 0;
    for (let i = 0; i < buf.length - 1; i += step) {
        const s = buf.readInt16LE(i);
        sum += s * s;
        count++;
    }
    return count > 0 ? Math.sqrt(sum / count) : 0;
}

function wrapPcmAsWav(pcm, sampleRate = 16000, channels = 1, bits = 16) {
    const header = Buffer.alloc(44);
    const byteRate = sampleRate * channels * (bits >> 3);
    const blockAlign = channels * (bits >> 3);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + pcm.length, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bits, 34);
    header.write('data', 36);
    header.writeUInt32LE(pcm.length, 40);
    return Buffer.concat([header, pcm]);
}

function sliceWav16kMono(wavBuf, maxMs) {
    if (!wavBuf?.length || wavBuf.length <= 44 || !Number.isFinite(maxMs) || maxMs <= 0) {
        return wavBuf;
    }
    if (wavBuf.toString('ascii', 0, 4) !== 'RIFF') {return wavBuf;}
    const maxDataBytes = Math.max(1, Math.floor(16_000 * 2 * (maxMs / 1000)));
    const pcm = wavBuf.subarray(44);
    if (pcm.length <= maxDataBytes) {return wavBuf;}
    return wrapPcmAsWav(pcm.subarray(0, maxDataBytes), 16_000, 1, 16);
}

function _runFfmpeg(args, input) {
    return new Promise((resolve) => {
        const proc = spawn(FFMPEG, args, { stdio: ['pipe', 'pipe', 'pipe'] });
        let settled = false;
        const finish = (val) => { if (!settled) { settled = true; resolve(val); } };
        const killTimer = setTimeout(() => {
            try { proc.kill('SIGKILL'); } catch { /* */ }
            finish(null);
        }, FFMPEG_TIMEOUT_MS);
        killTimer.unref();
        const out = [];
        const err = [];
        proc.stdout.on('data', (c) => out.push(c));
        proc.stderr.on('data', (c) => err.push(c));
        proc.on('close', (code) => {
            clearTimeout(killTimer);
            if (code !== 0) {
                const tail = Buffer.concat(err).toString().slice(-200);
                if (tail) {console.error(`[VoiceChat] ffmpeg exit ${code}: ${tail}`);}
                finish(null);
                return;
            }
            finish(Buffer.concat(out));
        });
        proc.on('error', () => { clearTimeout(killTimer); finish(null); });
        proc.stdin.on('error', () => {});
        proc.stdin.write(input);
        proc.stdin.end();
    });
}

function pcm48kStereoToWav16kMono(pcm) {
    return _runFfmpeg([
        '-f', 's16le', '-ar', '48000', '-ac', '2', '-i', 'pipe:0',
        '-ar', '16000', '-ac', '1', '-f', 'wav', 'pipe:1'
    ], pcm);
}

function audioToWav16k(audioBuf) {
    return _runFfmpeg([
        '-i', 'pipe:0',
        '-ar', '16000', '-ac', '1', '-f', 'wav', 'pipe:1'
    ], audioBuf);
}

function wavToPcm48kStereo(wavBuf) {
    return _runFfmpeg([
        '-i', 'pipe:0',
        '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1'
    ], wavBuf);
}

module.exports = {
    FFMPEG,
    FFMPEG_TIMEOUT_MS,
    pcmEnergy,
    wrapPcmAsWav,
    sliceWav16kMono,
    pcm48kStereoToWav16kMono,
    audioToWav16k,
    wavToPcm48kStereo
};

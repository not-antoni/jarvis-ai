'use strict';

const fs = require('node:fs');
const path = require('node:path');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

// ─── Config ───────────────────────────────────────────────────────────────────
const GRPC_SERVER   = 'grpc.nvcf.nvidia.com:443';
const ASR_FUNC_ID   = '1598d209-5e27-4d3c-8079-4751568b1081';  // Parakeet CTC 1.1B
const TTS_FUNC_ID   = '55cf67bf-600f-4b04-8eac-12ed39537a08';  // Magpie TTS Zeroshot
const PROTO_ROOT    = path.join(__dirname, '../../proto/nvidia-riva-common');

// AudioEncoding enum values from riva_audio.proto
const LINEAR_PCM = 1;

// ─── WAV helpers ──────────────────────────────────────────────────────────────

function stripWavHeader(buf) {
    if (buf.length > 44 && buf.toString('ascii', 0, 4) === 'RIFF') {
        return buf.subarray(44);
    }
    return buf;
}

function wrapPcmAsWav(pcm, sampleRate = 22050, channels = 1, bits = 16) {
    const h = Buffer.alloc(44);
    const byteRate = sampleRate * channels * (bits >> 3);
    const blockAlign = channels * (bits >> 3);
    h.write('RIFF', 0);
    h.writeUInt32LE(36 + pcm.length, 4);
    h.write('WAVE', 8);
    h.write('fmt ', 12);
    h.writeUInt32LE(16, 16);
    h.writeUInt16LE(1, 20);
    h.writeUInt16LE(channels, 22);
    h.writeUInt32LE(sampleRate, 24);
    h.writeUInt32LE(byteRate, 28);
    h.writeUInt16LE(blockAlign, 32);
    h.writeUInt16LE(bits, 34);
    h.write('data', 36);
    h.writeUInt32LE(pcm.length, 40);
    return Buffer.concat([h, pcm]);
}

// ─── Service ──────────────────────────────────────────────────────────────────

/**
 * NVIDIA NIM Speech — Parakeet ASR (STT) + Magpie TTS Zeroshot with JARVIS voice.
 *
 * Mode selection (automatic):
 *   • NVIDIA_STT_URL / NVIDIA_TTS_URL set → HTTP REST (self-hosted NIM)
 *   • NVIDIA_API_KEY set (no URLs)        → gRPC cloud (grpc.nvcf.nvidia.com)
 */
class NvidiaSpeech {
    constructor() {
        this.sttUrl = (process.env.NVIDIA_STT_URL || '').replace(/\/+$/, '');
        this.ttsUrl = (process.env.NVIDIA_TTS_URL || '').replace(/\/+$/, '');
        this.apiKey = process.env.NVIDIA_API_KEY || '';
        this.voiceRefPath = process.env.JARVIS_VOICE_REF ||
            path.join(__dirname, '../../assets/voice/jarvis_reference.wav');

        this._voiceRefPcm = null;
        this._asrClient = null;
        this._ttsClient = null;
        this._protoLoaded = false;
    }

    get sttEnabled() { return Boolean(this.sttUrl) || Boolean(this.apiKey); }
    get ttsEnabled() { return Boolean(this.ttsUrl) || Boolean(this.apiKey); }
    get enabled()    { return this.sttEnabled || this.ttsEnabled; }

    // ─── Lazy init ────────────────────────────────────────────────────────────

    _ensureGrpc() {
        if (this._protoLoaded) return;
        this._protoLoaded = true;

        try {
            const pkgDef = protoLoader.loadSync(
                [
                    path.join(PROTO_ROOT, 'riva/proto/riva_asr.proto'),
                    path.join(PROTO_ROOT, 'riva/proto/riva_tts.proto')
                ],
                {
                    keepCase: true,
                    longs: String,
                    enums: Number,
                    defaults: true,
                    includeDirs: [PROTO_ROOT]
                }
            );

            const defs = grpc.loadPackageDefinition(pkgDef);
            const creds = grpc.credentials.createSsl();

            const AsrSvc = defs.nvidia.riva.asr.RivaSpeechRecognition;
            const TtsSvc = defs.nvidia.riva.tts.RivaSpeechSynthesis;

            this._asrClient = new AsrSvc(GRPC_SERVER, creds);
            this._ttsClient = new TtsSvc(GRPC_SERVER, creds);

            console.log('[NvidiaSpeech] gRPC clients initialized');
        } catch (err) {
            console.error('[NvidiaSpeech] Failed to load protos:', err.message);
        }
    }

    _grpcMeta(functionId) {
        const meta = new grpc.Metadata();
        meta.set('function-id', functionId);
        meta.set('authorization', `Bearer ${this.apiKey}`);
        return meta;
    }

    _getVoiceRefPcm() {
        if (this._voiceRefPcm) return this._voiceRefPcm;
        try {
            const wav = fs.readFileSync(this.voiceRefPath);
            this._voiceRefPcm = stripWavHeader(wav);
            console.log(`[NvidiaSpeech] Loaded voice reference (${(this._voiceRefPcm.length / 1024).toFixed(0)} KB PCM)`);
        } catch {
            console.warn('[NvidiaSpeech] Voice reference not found:', this.voiceRefPath);
            return null;
        }
        return this._voiceRefPcm;
    }

    // ─── Speech-to-Text ───────────────────────────────────────────────────────

    /**
     * Transcribe 16 kHz mono WAV → text.
     * @param {Buffer} wavBuffer
     * @returns {Promise<string|null>}
     */
    async transcribe(wavBuffer) {
        if (this.sttUrl)  return this._transcribeHttp(wavBuffer);
        if (this.apiKey)  return this._transcribeGrpc(wavBuffer);
        return null;
    }

    _transcribeGrpc(wavBuffer) {
        this._ensureGrpc();
        if (!this._asrClient) return Promise.resolve(null);

        const pcm = stripWavHeader(wavBuffer);
        const request = {
            config: {
                encoding: LINEAR_PCM,
                sample_rate_hertz: 16000,
                language_code: 'en-US',
                max_alternatives: 1,
                enable_automatic_punctuation: true
            },
            audio: pcm
        };

        return new Promise((resolve) => {
            this._asrClient.Recognize(
                request,
                this._grpcMeta(ASR_FUNC_ID),
                { deadline: Date.now() + 15000 },
                (err, res) => {
                    if (err) {
                        console.error('[NvidiaSpeech] gRPC STT error:', err.message);
                        return resolve(null);
                    }
                    const text = res?.results?.[0]?.alternatives?.[0]?.transcript?.trim();
                    resolve(text || null);
                }
            );
        });
    }

    async _transcribeHttp(wavBuffer) {
        try {
            const form = new FormData();
            form.append('file', new Blob([wavBuffer], { type: 'audio/wav' }), 'audio.wav');
            form.append('language', 'en-US');

            const headers = this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {};
            const res = await fetch(`${this.sttUrl}/v1/audio/transcriptions`, {
                method: 'POST', headers, body: form
            });
            if (!res.ok) {
                console.error(`[NvidiaSpeech] HTTP STT ${res.status}:`, (await res.text()).slice(0, 200));
                return null;
            }
            const data = await res.json();
            return data.text?.trim() || null;
        } catch (err) {
            console.error('[NvidiaSpeech] HTTP STT failed:', err.message);
            return null;
        }
    }

    // ─── Text-to-Speech ───────────────────────────────────────────────────────

    /**
     * Synthesize text → WAV buffer using JARVIS voice clone.
     * @param {string} text
     * @returns {Promise<Buffer|null>}
     */
    async synthesize(text) {
        if (!text?.trim()) return null;
        if (this.ttsUrl)  return this._synthesizeHttp(text);
        if (this.apiKey)  return this._synthesizeGrpc(text);
        return null;
    }

    _synthesizeGrpc(text) {
        this._ensureGrpc();
        if (!this._ttsClient) return Promise.resolve(null);

        const voicePcm = this._getVoiceRefPcm();
        const request = {
            text: text.trim(),
            language_code: 'en-US',
            encoding: LINEAR_PCM,
            sample_rate_hz: 22050,
            voice_name: ''
        };

        if (voicePcm) {
            request.zero_shot_data = {
                audio_prompt: voicePcm,
                sample_rate_hz: 16000,
                encoding: LINEAR_PCM,
                quality: 20
            };
        }

        return new Promise((resolve) => {
            this._ttsClient.Synthesize(
                request,
                this._grpcMeta(TTS_FUNC_ID),
                { deadline: Date.now() + 30000 },
                (err, res) => {
                    if (err) {
                        console.error('[NvidiaSpeech] gRPC TTS error:', err.message);
                        return resolve(null);
                    }
                    if (!res?.audio?.length) return resolve(null);
                    // Wrap raw PCM as WAV so downstream can play it
                    resolve(wrapPcmAsWav(Buffer.from(res.audio), 22050));
                }
            );
        });
    }

    async _synthesizeHttp(text) {
        try {
            const form = new FormData();
            form.append('text', text.trim());
            form.append('language', 'en-US');

            const voiceRef = this._getVoiceRefPcm();
            if (voiceRef) {
                const wavRef = wrapPcmAsWav(voiceRef, 16000);
                form.append('audio_prompt', new Blob([wavRef], { type: 'audio/wav' }), 'ref.wav');
            }

            const headers = this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {};
            const res = await fetch(`${this.ttsUrl}/v1/audio/synthesize`, {
                method: 'POST', headers, body: form
            });
            if (!res.ok) {
                console.error(`[NvidiaSpeech] HTTP TTS ${res.status}:`, (await res.text()).slice(0, 200));
                return null;
            }
            return Buffer.from(await res.arrayBuffer());
        } catch (err) {
            console.error('[NvidiaSpeech] HTTP TTS failed:', err.message);
            return null;
        }
    }
}

module.exports = new NvidiaSpeech();

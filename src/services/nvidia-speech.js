'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * NVIDIA NIM Speech Services — STT (Parakeet) and TTS (Magpie) client.
 *
 * Env vars:
 *   NVIDIA_STT_URL   — Base URL of the Parakeet ASR NIM  (e.g. http://localhost:9000)
 *   NVIDIA_TTS_URL   — Base URL of the Magpie TTS NIM    (e.g. http://localhost:9001)
 *   NVIDIA_API_KEY   — Bearer token (required for cloud endpoints)
 *   JARVIS_VOICE_REF — Path to the JARVIS voice reference WAV (default: assets/voice/jarvis_reference.wav)
 */
class NvidiaSpeech {
    constructor() {
        this.sttUrl = (process.env.NVIDIA_STT_URL || '').replace(/\/+$/, '');
        this.ttsUrl = (process.env.NVIDIA_TTS_URL || '').replace(/\/+$/, '');
        this.apiKey = process.env.NVIDIA_API_KEY || '';
        this.voiceRefPath = process.env.JARVIS_VOICE_REF ||
            path.join(__dirname, '../../assets/voice/jarvis_reference.wav');
        this._voiceRefBuffer = null;
    }

    get sttEnabled() { return Boolean(this.sttUrl); }
    get ttsEnabled() { return Boolean(this.ttsUrl); }
    get enabled()    { return this.sttEnabled || this.ttsEnabled; }

    /** Lazy-load the voice reference WAV into memory. */
    _getVoiceRef() {
        if (this._voiceRefBuffer) return this._voiceRefBuffer;
        try {
            this._voiceRefBuffer = fs.readFileSync(this.voiceRefPath);
            console.log(`[NvidiaSpeech] Loaded voice reference (${(this._voiceRefBuffer.length / 1024).toFixed(0)} KB)`);
        } catch {
            console.warn('[NvidiaSpeech] Voice reference not found:', this.voiceRefPath);
            return null;
        }
        return this._voiceRefBuffer;
    }

    _authHeaders() {
        return this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {};
    }

    // ─── Speech-to-Text ───────────────────────────────────────────────────────

    /**
     * Transcribe a WAV buffer to text.
     * @param {Buffer} wavBuffer — 16 kHz mono 16-bit PCM WAV
     * @returns {Promise<string|null>}
     */
    async transcribe(wavBuffer) {
        if (!this.sttUrl) return null;

        try {
            const form = new FormData();
            form.append('file', new Blob([wavBuffer], { type: 'audio/wav' }), 'audio.wav');
            form.append('language', 'en-US');

            const res = await fetch(`${this.sttUrl}/v1/audio/transcriptions`, {
                method: 'POST',
                headers: this._authHeaders(),
                body: form
            });

            if (!res.ok) {
                const body = await res.text().catch(() => '');
                console.error(`[NvidiaSpeech] STT ${res.status}:`, body.slice(0, 200));
                return null;
            }

            const data = await res.json();
            return data.text?.trim() || null;
        } catch (err) {
            console.error('[NvidiaSpeech] STT request failed:', err.message);
            return null;
        }
    }

    // ─── Text-to-Speech ───────────────────────────────────────────────────────

    /**
     * Synthesize text to speech using the JARVIS voice reference.
     * @param {string} text
     * @returns {Promise<Buffer|null>} WAV audio buffer
     */
    async synthesize(text) {
        if (!this.ttsUrl || !text?.trim()) return null;

        try {
            const form = new FormData();
            form.append('text', text.trim());
            form.append('language', 'en-US');

            const voiceRef = this._getVoiceRef();
            if (voiceRef) {
                form.append(
                    'audio_prompt',
                    new Blob([voiceRef], { type: 'audio/wav' }),
                    'jarvis_reference.wav'
                );
            }

            const res = await fetch(`${this.ttsUrl}/v1/audio/synthesize`, {
                method: 'POST',
                headers: this._authHeaders(),
                body: form
            });

            if (!res.ok) {
                const body = await res.text().catch(() => '');
                console.error(`[NvidiaSpeech] TTS ${res.status}:`, body.slice(0, 200));
                return null;
            }

            return Buffer.from(await res.arrayBuffer());
        } catch (err) {
            console.error('[NvidiaSpeech] TTS request failed:', err.message);
            return null;
        }
    }
}

module.exports = new NvidiaSpeech();

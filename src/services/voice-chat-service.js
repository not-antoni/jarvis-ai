'use strict';

const {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    VoiceConnectionStatus,
    EndBehaviorType,
    entersState,
    StreamType
} = require('@discordjs/voice');
const { spawn } = require('node:child_process');
const { Readable } = require('node:stream');
const nvidiaSpeech = require('./nvidia-speech');

const FFMPEG = process.env.FFMPEG_PATH || '/home/tony/.local/bin/ffmpeg';
const SILENCE_MS = 1500;    // 1.5 s silence → end of utterance
const MIN_PACKETS = 10;     // ignore very short bursts (< ~200 ms)

/**
 * Voice-chat service: joins a Discord VC, listens to users via STT,
 * generates AI responses, and speaks them back via TTS.
 */
class VoiceChatService {
    constructor() {
        /** @type {Map<string, VCSession>} guildId → session */
        this.sessions = new Map();
        this.client  = null;
        this.jarvis  = null;
    }

    /** Call once after client is ready. */
    init(client, jarvis) {
        this.client = client;
        this.jarvis = jarvis;
        if (nvidiaSpeech.enabled) {
            console.log(
                `[VoiceChat] Ready — STT: ${nvidiaSpeech.sttEnabled ? 'on' : 'off'}, ` +
                `TTS: ${nvidiaSpeech.ttsEnabled ? 'on' : 'off'}`
            );
        }
    }

    // ─── Public API ───────────────────────────────────────────────────────────

    async join(interaction) {
        const vc = interaction.member?.voice?.channel;
        if (!vc) return 'You need to be in a voice channel first, sir.';
        if (this.sessions.has(vc.guildId)) return "I'm already connected in this server, sir.";

        if (!nvidiaSpeech.sttEnabled) {
            return 'Speech recognition is not configured. Set `NVIDIA_STT_URL` and restart, sir.';
        }

        try {
            const connection = joinVoiceChannel({
                channelId: vc.id,
                guildId: vc.guild.id,
                adapterCreator: vc.guild.voiceAdapterCreator,
                selfDeaf: false,
                selfMute: false
            });

            const player = createAudioPlayer();
            connection.subscribe(player);

            const session = {
                connection,
                player,
                channelId: vc.id,
                guildId: vc.guildId,
                textChannelId: interaction.channelId,
                busy: false
            };

            this.sessions.set(vc.guildId, session);
            await entersState(connection, VoiceConnectionStatus.Ready, 10_000);
            this._listen(session);
            this._watchDisconnect(session);

            console.log(`[VoiceChat] Joined "${vc.name}" in ${vc.guild.name}`);
            return `Connected to **${vc.name}**. I'm listening, sir.`;
        } catch (err) {
            console.error('[VoiceChat] Join failed:', err);
            this._destroy(vc.guildId);
            return 'Failed to join the voice channel, sir.';
        }
    }

    leave(guildId) {
        if (!this.sessions.has(guildId)) return "I'm not in a voice channel, sir.";
        this._destroy(guildId);
        return 'Disconnected, sir.';
    }

    /** Called from voiceStateUpdate — auto-leave when VC empties. */
    handleVoiceStateUpdate(oldState) {
        const session = this.sessions.get(oldState.guild.id);
        if (!session) return;
        if (oldState.channelId !== session.channelId) return;

        // Check if we're the only one left
        const channel = oldState.guild.channels.cache.get(session.channelId);
        if (channel && channel.members.size <= 1) {
            console.log('[VoiceChat] Everyone left, disconnecting.');
            this._destroy(oldState.guild.id);
        }
    }

    // ─── Audio Receive Pipeline ───────────────────────────────────────────────

    _listen(session) {
        const receiver = session.connection.receiver;

        receiver.speaking.on('start', (userId) => {
            if (userId === this.client?.user?.id) return;
            if (session.busy) return;

            const opusStream = receiver.subscribe(userId, {
                end: { behavior: EndBehaviorType.AfterSilence, duration: SILENCE_MS }
            });

            const packets = [];
            opusStream.on('data', (pkt) => packets.push(pkt));
            opusStream.on('end', () => {
                if (packets.length >= MIN_PACKETS) {
                    this._process(session, userId, packets);
                }
            });
            opusStream.on('error', (e) => console.warn('[VoiceChat] Opus rx error:', e.message));
        });
    }

    /**
     * Full pipeline: Opus packets → PCM → WAV-16k → STT → AI → TTS → play
     */
    async _process(session, userId, packets) {
        if (session.busy) return;
        session.busy = true;

        try {
            // Decode Opus → 48 kHz stereo PCM
            const pcm = this._decodeOpus(packets);
            if (!pcm || pcm.length < 3200) return;

            // Resample → 16 kHz mono WAV
            const wav = await this._toWav16k(pcm);
            if (!wav) return;

            // STT
            const text = await nvidiaSpeech.transcribe(wav);
            if (!text || text.length < 2) return;
            console.log(`[VoiceChat] <${userId}> ${text}`);

            // AI response
            const reply = await this._askJarvis(session, userId, text);
            if (!reply) return;
            console.log(`[VoiceChat] > ${reply.slice(0, 100)}`);

            // TTS → play, or text fallback
            if (nvidiaSpeech.ttsEnabled) {
                const audio = await nvidiaSpeech.synthesize(reply);
                if (audio) {
                    await this._play(session, audio);
                    return;
                }
            }
            await this._textFallback(session, reply);
        } catch (err) {
            console.error('[VoiceChat] Pipeline error:', err);
        } finally {
            session.busy = false;
        }
    }

    // ─── Audio Decode / Convert ───────────────────────────────────────────────

    /** Decode raw Opus packets → 48 kHz stereo s16le PCM buffer. */
    _decodeOpus(packets) {
        try {
            const OpusEncoder = require('opusscript');
            const dec = new OpusEncoder(48000, 2);
            const frames = [];
            for (const pkt of packets) {
                try { frames.push(Buffer.from(dec.decode(pkt))); } catch { /* skip */ }
            }
            dec.delete();
            return frames.length ? Buffer.concat(frames) : null;
        } catch (err) {
            console.error('[VoiceChat] Opus decode error:', err.message);
            return null;
        }
    }

    /** 48 kHz stereo PCM → 16 kHz mono WAV via ffmpeg. */
    _toWav16k(pcm) {
        return new Promise((resolve) => {
            const proc = spawn(FFMPEG, [
                '-f', 's16le', '-ar', '48000', '-ac', '2', '-i', 'pipe:0',
                '-ar', '16000', '-ac', '1', '-f', 'wav', 'pipe:1'
            ], { stdio: ['pipe', 'pipe', 'pipe'] });

            const out = [];
            proc.stdout.on('data', (c) => out.push(c));
            proc.stderr.on('data', () => {}); // suppress ffmpeg logs
            proc.on('close', (code) => resolve(code === 0 ? Buffer.concat(out) : null));
            proc.on('error', () => resolve(null));
            proc.stdin.write(pcm);
            proc.stdin.end();
        });
    }

    // ─── AI ───────────────────────────────────────────────────────────────────

    async _askJarvis(session, userId, text) {
        if (!this.jarvis) return null;
        try {
            const user = await this.client.users.fetch(userId).catch(() => null);
            // Minimal interaction-like object for generateResponse
            const pseudo = {
                author: {
                    id: userId,
                    username: user?.username || 'User',
                    displayName: user?.displayName || user?.username || 'User'
                },
                guild: { id: session.guildId },
                channel: { id: session.textChannelId }
            };
            return await this.jarvis.generateResponse(pseudo, text);
        } catch (err) {
            console.error('[VoiceChat] AI error:', err.message);
            return null;
        }
    }

    // ─── Audio Playback ───────────────────────────────────────────────────────

    /** Play a WAV buffer through the voice connection. */
    _play(session, wavBuf) {
        return new Promise((resolve) => {
            const resource = createAudioResource(Readable.from(wavBuf), {
                inputType: StreamType.Arbitrary
            });
            session.player.play(resource);

            const done = () => { cleanup(); resolve(); };
            const timer = setTimeout(done, 30_000);
            const cleanup = () => {
                clearTimeout(timer);
                session.player.removeListener(AudioPlayerStatus.Idle, done);
            };
            session.player.once(AudioPlayerStatus.Idle, done);
        });
    }

    async _textFallback(session, text) {
        try {
            const ch = await this.client.channels.fetch(session.textChannelId).catch(() => null);
            if (ch?.send) await ch.send({ content: text, allowedMentions: { parse: [] } });
        } catch { /* best-effort */ }
    }

    // ─── Lifecycle ────────────────────────────────────────────────────────────

    _watchDisconnect(session) {
        session.connection.on(VoiceConnectionStatus.Disconnected, async () => {
            try {
                await Promise.race([
                    entersState(session.connection, VoiceConnectionStatus.Signalling, 5_000),
                    entersState(session.connection, VoiceConnectionStatus.Connecting, 5_000)
                ]);
            } catch {
                this._destroy(session.guildId);
            }
        });
        session.connection.on(VoiceConnectionStatus.Destroyed, () => {
            this.sessions.delete(session.guildId);
        });
    }

    _destroy(guildId) {
        const s = this.sessions.get(guildId);
        if (!s) return;
        try { s.player.stop(true); } catch { /* */ }
        try { s.connection.destroy(); } catch { /* */ }
        this.sessions.delete(guildId);
        console.log(`[VoiceChat] Destroyed session for guild ${guildId}`);
    }
}

module.exports = new VoiceChatService();

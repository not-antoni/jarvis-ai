'use strict';

const {
    joinVoiceChannel,
    getVoiceConnection,
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
const config = require('../../config');
const { musicManager } = require('../core/musicManager');
const { isCpuThrottled, getCpuFreqMHz } = require('../utils/cpu-monitor');
const database = require('./database');

const FFMPEG = process.env.FFMPEG_PATH || '/home/tony/.local/bin/ffmpeg';

// ─── Tuning ───────────────────────────────────────────────────────────────────
const SILENCE_MS         = 1600;      // ms silence before ending capture
const MIN_PACKETS        = 10;        // min opus packets to count as speech
const BARGE_IN_PACKETS   = 40;        // packets to trigger interrupt during playback
const MAX_RESPONSE_QUEUE = 5;         // post-STT addressed requests only
// STT idle timeout removed — energy gate + wake word filter already prevent unnecessary API calls
const MAX_TTS_CHARS      = 500;
const MIN_TRANSCRIPT_LEN = 4;
const PLAY_TIMEOUT_MS    = 30_000;
const STREAM_SAFETY_MS   = 60_000;    // force-close hung opus streams
const PROCESS_SAFETY_MS  = 90_000;    // force-reset stuck processing flag
const MAX_PCM_BYTES      = 48000 * 2 * 2 * 30; // 30s of 48kHz stereo s16le (~5.5MB)
const ECHO_COOLDOWN_MS   = 2500;               // ignore STT right after bot finishes speaking
const MIN_PCM_ENERGY     = 300;                // skip near-silent audio (RMS threshold)
const FFMPEG_TIMEOUT_MS  = 10_000;             // kill hung ffmpeg subprocesses

// Single-word noise the STT picks up from silence/background
const NOISE_WORDS = new Set([
    'you', 'uh', 'um', 'hmm', 'hm', 'ah', 'oh', 'mhm', 'mm',
    'yeah', 'yep', 'nah', 'the', 'a', 'ok',
    'bye', 'thank', 'thanks', 'so'
]);

// Channels where the bot stays connected permanently (guild → channel)
const PERSISTENT_CHANNELS = new Map([
    ['858444090374881301', '858444090949369899']
]);

// Prepended to voice input so the AI keeps replies spoken-friendly
const VOICE_HINT = '[Voice chat — reply in 1-2 short spoken sentences. No markdown, no lists, no formatting. Be concise and conversational.]\n';

// ─── Text helpers ─────────────────────────────────────────────────────────────

function cleanForTts(text) {
    return text
        .replace(/```[\s\S]*?```/g, '')                  // ```multiline code```
        .replace(/`([^`]+)`/g, '')                        // `inline code`
        .replace(/\*{1,3}([^*]*)\*{1,3}/g, '$1')        // *action* **bold** ***both***
        .replace(/\([^)]*(?:sighs?|adjusts?|pauses?|clears?|nods?|smiles?|laughs?|chuckles?|whispers?|grins?|leans?|tilts?|gestures?|waves?|bows?|glances?)[^)]*\)/gi, '') // (roleplay actions)
        .replace(/_([^_]+)_/g, '$1')
        .replace(/__([^_]+)__/g, '$1')
        .replace(/~~([^~]+)~~/g, '$1')
        .replace(/\|\|([^|]+)\|\|/g, '$1')
        .replace(/^>+\s?/gm, '')                          // > blockquote
        .replace(/^#{1,3}\s+/gm, '')                      // ### heading
        .replace(/^\d+\.\s+/gm, '')                       // 1. numbered list
        .replace(/^[-•]\s+/gm, '')                        // - or • bullet
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')          // [link](url)
        .replace(/<@!?\d+>/g, '')                          // <@mention>
        .replace(/<#\d+>/g, '')                            // <#channel>
        .replace(/<a?:\w+:\d+>/g, '')                      // <:emoji:id>
        .replace(/https?:\/\/\S+/g, '')                    // URLs
        .replace(/—/g, ', ')                               // em-dash → pause
        .replace(/\.{3}/g, ', ')                           // ellipsis → pause
        .replace(/\n{2,}/g, '. ')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

function truncateForTts(text) {
    if (text.length <= MAX_TTS_CHARS) return text;
    const cut = text.slice(0, MAX_TTS_CHARS);
    const last = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
    return last > MAX_TTS_CHARS * 0.4 ? cut.slice(0, last + 1) : cut + '...';
}

function isNoise(text) {
    if (text.length < MIN_TRANSCRIPT_LEN) return true;
    const normalized = text.toLowerCase().replace(/[^a-z\s]/g, '').trim();
    return NOISE_WORDS.has(normalized);
}

function pcmEnergy(buf) {
    const step = 200; // sample every 100th s16le sample
    let sum = 0;
    let count = 0;
    for (let i = 0; i < buf.length - 1; i += step) {
        const s = buf.readInt16LE(i);
        sum += s * s;
        count++;
    }
    return count > 0 ? Math.sqrt(sum / count) : 0;
}

function isMusicPlaying(guildId) {
    try {
        const state = musicManager.get().getState(guildId);
        if (!state?.player || !state.currentVideo) return false;
        return state.player.state?.status === 'playing';
    } catch { return false; }
}

// ─── Service ──────────────────────────────────────────────────────────────────

class VoiceChatService {
    constructor() {
        this.sessions = new Map();
        this.client  = null;
        this.jarvis  = null;
        this._userCache = new Map();
        this._optOutCache = new Map(); // userId → { optedOut: bool, ts: number }
    }

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

    // ─── User Cache ──────────────────────────────────────────────────────────

    async _resolveUser(userId) {
        const cached = this._userCache.get(userId);
        if (cached) return cached;

        const user = this.client.users.cache.get(userId)
            || await this.client.users.fetch(userId).catch(() => null);

        const info = user
            ? { username: user.username, displayName: user.displayName || user.username, bot: Boolean(user.bot) }
            : { username: 'User', displayName: 'User', bot: false };

        this._userCache.set(userId, info);
        const timer = setTimeout(() => this._userCache.delete(userId), 10 * 60_000);
        timer.unref();
        return info;
    }

    // ─── Join: user invites bot to their VC ─────────────────────────────────────

    async join(interaction) {
        const member = interaction.member;
        const channel = member?.voice?.channel;
        if (!channel) return 'You need to be in a voice channel first, sir.';

        // Destroy stale connection if any
        const existing = getVoiceConnection(channel.guild.id);
        if (existing) {
            try { existing.destroy(); } catch { /* */ }
            this.sessions.delete(channel.guild.id);
        }

        joinVoiceChannel({
            channelId: channel.id,
            guildId: channel.guild.id,
            adapterCreator: channel.guild.voiceAdapterCreator,
            selfDeaf: false,
            selfMute: false
        });

        return `Joined **${channel.name}**, listening for your commands.`;
    }

    // ─── Auto-attach: listen whenever the bot is in a VC ──────────────────────

    handleVoiceStateUpdate(oldState, newState) {
        const botId = this.client?.user?.id;

        // Bot's own state changed — auto-attach/detach STT
        if (newState.member?.id === botId) {
            console.log(`[VoiceChat] Bot voiceState: old=${oldState.channelId} new=${newState.channelId} hasSession=${this.sessions.has(newState.guild.id)}`);
            if (newState.channelId && !this.sessions.has(newState.guild.id)) {
                // Bot is in a channel but has no STT session — attach
                this._autoAttach(newState.guild.id, newState.channelId);
            } else if (newState.channelId && newState.channelId !== oldState.channelId) {
                // Bot moved to a different channel — update session
                const existing = this.sessions.get(newState.guild.id);
                if (existing) existing.channelId = newState.channelId;
                else this._autoAttach(newState.guild.id, newState.channelId);
            } else if (!newState.channelId && oldState.channelId) {
                // Bot left
                this.sessions.delete(oldState.guild.id);
            }
            return;
        }
    }

    async _autoAttach(guildId, channelId) {
        if (!nvidiaSpeech.sttEnabled) return;
        if (this.sessions.has(guildId)) {
            // Update channel ID if bot moved
            const existing = this.sessions.get(guildId);
            existing.channelId = channelId;
            return;
        }

        const connection = getVoiceConnection(guildId);
        if (!connection) return;

        try {
            if (connection.state.status !== VoiceConnectionStatus.Ready) {
                await entersState(connection, VoiceConnectionStatus.Ready, 10_000);
            }
        } catch { return; }

        const player = createAudioPlayer();

        const session = {
            connection, player,
            channelId,
            guildId,
            textChannelId: null,
            activeListeners: new Set(),
            responseQueue: [],
            responding: false,
            respondingStartedAt: 0,
            respondingGeneration: 0,
            respondingTo: null,
            lastPlaybackEndedAt: 0,
            persistent: PERSISTENT_CHANNELS.has(guildId),
            sttActive: true,
            manuallyPaused: false
        };

        this.sessions.set(guildId, session);
        this._listen(session);
        this._watchDisconnect(session);

        const channel = this.client.channels.cache.get(channelId);
        console.log(`[VoiceChat] Auto-listening in "${channel?.name || channelId}" (guild ${guildId})`);
    }

    // ─── Opt-out Check ─────────────────────────────────────────────────────

    async _isOptedOut(userId) {
        const cached = this._optOutCache.get(userId);
        if (cached && Date.now() - cached.ts < 5 * 60_000) return cached.optedOut;

        let optedOut = false;
        try {
            const col = database.getCollection('userProfiles');
            if (col) {
                const profile = await col.findOne({ userId }, { projection: { 'preferences.memoryOpt': 1 } });
                optedOut = String(profile?.preferences?.memoryOpt ?? 'opt-in').toLowerCase() === 'opt-out';
            }
        } catch { /* db down — default to allowed */ }

        this._optOutCache.set(userId, { optedOut, ts: Date.now() });
        return optedOut;
    }

    // ─── Audio Receive + Barge-in ─────────────────────────────────────────────

    _listen(session) {
        const receiver = session.connection.receiver;

        receiver.speaking.on('start', async (userId) => {
            if (userId === this.client?.user?.id) return;

            // Lock BEFORE async to prevent race
            if (session.activeListeners.has(userId)) return;
            session.activeListeners.add(userId);

            const userInfo = await this._resolveUser(userId);
            if (userInfo.bot || !session.sttActive) {
                session.activeListeners.delete(userId);
                return;
            }

            const opusStream = receiver.subscribe(userId, {
                end: { behavior: EndBehaviorType.AfterSilence, duration: SILENCE_MS }
            });

            const packets = [];

            // Safety valve: force-close hung streams so user isn't locked out
            const safetyTimer = setTimeout(() => {
                try { opusStream.destroy(); } catch { /* */ }
                session.activeListeners.delete(userId);
                if (packets.length >= MIN_PACKETS) {
                    this._ingest(session, userId, packets).catch(() => {});
                }
                console.warn(`[VoiceChat] Safety timeout — stream hung for ${userInfo.displayName}`);
            }, STREAM_SAFETY_MS);
            safetyTimer.unref();

            opusStream.on('data', (pkt) => {
                packets.push(pkt);

                // Barge-in: only the person Jarvis is responding to can interrupt
                if (packets.length === BARGE_IN_PACKETS &&
                    session.player.state.status === AudioPlayerStatus.Playing &&
                    session.respondingTo === userId) {
                    session.player.stop(true);
                    session.responseQueue.length = 0;
                    console.log(`[VoiceChat] Barge-in by ${userInfo.displayName}`);
                }
            });

            opusStream.on('end', () => {
                clearTimeout(safetyTimer);
                session.activeListeners.delete(userId);
                if (packets.length >= MIN_PACKETS) {
                    this._ingest(session, userId, packets).catch(() => {});
                }
            });

            opusStream.on('error', (err) => {
                clearTimeout(safetyTimer);
                session.activeListeners.delete(userId);
                console.warn(`[VoiceChat] Stream error for ${userInfo.displayName}:`, err.message);
            });
        });
    }

    // ─── Processing Pipeline ─────────────────────────────────────────────────
    // Phase 1 (_ingest): runs in PARALLEL per speaker — decode, STT, wake word
    // Phase 2 (_respond): runs SEQUENTIALLY — AI generation, TTS, playback

    async _ingest(session, userId, packets) {
        const capturedAt = Date.now();

        try {
            if (isCpuThrottled()) {
                console.warn(`[VoiceChat] CPU throttled (${getCpuFreqMHz()}MHz) — skipping STT`);
                return;
            }

            // Opted-out users get zero voice processing — no audio sent anywhere
            if (await this._isOptedOut(userId)) return;

            const pcm = this._decodeOpus(packets);
            if (!pcm || pcm.length < 3200 || pcm.length > MAX_PCM_BYTES) return;

            const energy = pcmEnergy(pcm);
            const musicActive = isMusicPlaying(session.guildId);
            const threshold = musicActive ? MIN_PCM_ENERGY * 1.5 : MIN_PCM_ENERGY;
            if (energy < threshold) return;

            if (session.lastPlaybackEndedAt && capturedAt > session.lastPlaybackEndedAt &&
                capturedAt - session.lastPlaybackEndedAt < ECHO_COOLDOWN_MS) return;

            const wav = await this._toWav16k(pcm);
            if (!wav) return;

            const text = await nvidiaSpeech.transcribe(wav);
            if (!text || isNoise(text)) {
                if (text) console.log(`[VoiceChat] Filtered noise: "${text}"`);
                return;
            }

            const userInfo = await this._resolveUser(userId);
            console.log(`[VoiceChat] <${userInfo.displayName}> ${text}`);

            const lower = text.toLowerCase();
            const addressed = config.wakeWords.some(w => lower.includes(w));
            if (!addressed) {
                let customMatch = false;
                try {
                    const uf = require('./user-features');
                    customMatch = await uf.matchesGuildWakeWord(session.guildId, lower)
                        || await uf.matchesWakeWord(userId, lower);
                } catch { /* user-features not available */ }
                if (!customMatch) return;
            }

            this._enqueueResponse(session, userId, text);
        } catch (err) {
            console.error('[VoiceChat] Ingest error:', err.message);
        }
    }

    _enqueueResponse(session, userId, text) {
        if (session.responseQueue.length >= MAX_RESPONSE_QUEUE) session.responseQueue.shift();
        session.responseQueue.push({ userId, text });
        this._drainResponseQueue(session);
    }

    async _drainResponseQueue(session) {
        if (session.responding) {
            if (Date.now() - session.respondingStartedAt > PROCESS_SAFETY_MS) {
                console.warn('[VoiceChat] Response stuck — force reset');
                session.respondingGeneration++;
                session.responding = false;
            } else {
                return;
            }
        }

        session.responding = true;
        session.respondingStartedAt = Date.now();
        const gen = session.respondingGeneration;

        while (session.responseQueue.length > 0 && session.respondingGeneration === gen) {
            const { userId, text } = session.responseQueue.shift();
            await this._respond(session, userId, text);
        }

        if (session.respondingGeneration === gen) {
            session.responding = false;
        }
    }

    async _respond(session, userId, text) {
        try {
            // Hint goes to AI context but NOT saved to memory
            const waiting = session.responseQueue.length;
            const hint = waiting > 0
                ? '[Voice chat — reply in 1 short sentence. Others are waiting. No markdown, no lists.]\n'
                : VOICE_HINT;

            const reply = await this._askJarvis(session, userId, text, hint);
            if (!reply) return;
            console.log(`[VoiceChat] > ${reply.slice(0, 120)}`);

            session.respondingTo = userId;
            try {
                const spokenText = truncateForTts(cleanForTts(reply));
                if (nvidiaSpeech.ttsEnabled && spokenText) {
                    const audio = await nvidiaSpeech.synthesize(spokenText);
                    if (audio) { await this._play(session, audio); session.lastPlaybackEndedAt = Date.now(); return; }
                }
                await this._textFallback(session, reply);
            } finally {
                session.respondingTo = null;
            }
        } catch (err) {
            session.respondingTo = null;
            console.error('[VoiceChat] Response error:', err);
        }
    }

    // ─── Audio Helpers ────────────────────────────────────────────────────────

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

    _toWav16k(pcm) {
        return new Promise((resolve) => {
            const proc = spawn(FFMPEG, [
                '-f', 's16le', '-ar', '48000', '-ac', '2', '-i', 'pipe:0',
                '-ar', '16000', '-ac', '1', '-f', 'wav', 'pipe:1'
            ], { stdio: ['pipe', 'pipe', 'pipe'] });

            let settled = false;
            const finish = (val) => { if (!settled) { settled = true; resolve(val); } };
            const killTimer = setTimeout(() => {
                try { proc.kill('SIGKILL'); } catch { /* */ }
                finish(null);
            }, FFMPEG_TIMEOUT_MS);
            killTimer.unref();

            const out = [];
            proc.stdout.on('data', (c) => out.push(c));
            proc.stderr.on('data', () => {});
            proc.on('close', (code) => { clearTimeout(killTimer); finish(code === 0 ? Buffer.concat(out) : null); });
            proc.on('error', () => { clearTimeout(killTimer); finish(null); });
            proc.stdin.on('error', () => {});
            proc.stdin.write(pcm);
            proc.stdin.end();
        });
    }

    /** Convert any audio buffer (ogg, mp3, etc.) to 16kHz mono WAV via ffmpeg. */
    audioToWav16k(audioBuf) {
        return new Promise((resolve) => {
            const proc = spawn(FFMPEG, [
                '-i', 'pipe:0',
                '-ar', '16000', '-ac', '1', '-f', 'wav', 'pipe:1'
            ], { stdio: ['pipe', 'pipe', 'pipe'] });

            let settled = false;
            const finish = (val) => { if (!settled) { settled = true; resolve(val); } };
            const killTimer = setTimeout(() => {
                try { proc.kill('SIGKILL'); } catch { /* */ }
                finish(null);
            }, FFMPEG_TIMEOUT_MS);
            killTimer.unref();

            const out = [];
            proc.stdout.on('data', (c) => out.push(c));
            proc.stderr.on('data', () => {});
            proc.on('close', (code) => { clearTimeout(killTimer); finish(code === 0 ? Buffer.concat(out) : null); });
            proc.on('error', () => { clearTimeout(killTimer); finish(null); });
            proc.stdin.on('error', () => {});
            proc.stdin.write(audioBuf);
            proc.stdin.end();
        });
    }

    // ─── AI ───────────────────────────────────────────────────────────────────

    async _askJarvis(session, userId, text, contextPrefix = '') {
        if (!this.jarvis) return null;
        try {
            const userInfo = await this._resolveUser(userId);

            const pseudo = {
                author: {
                    id: userId,
                    username: userInfo.displayName,
                    displayName: userInfo.displayName
                },
                user: {
                    id: userId,
                    username: userInfo.username,
                    displayName: userInfo.displayName
                },
                guild: { id: session.guildId },
                channel: { id: session.textChannelId },
                channelId: session.textChannelId
            };

            return await this.jarvis.generateResponse(pseudo, text, false, null, { contextPrefix, voice: true });
        } catch (err) {
            console.error('[VoiceChat] AI error:', err.message);
            return null;
        }
    }

    // ─── Playback ─────────────────────────────────────────────────────────────

    _play(session, wavBuf) {
        console.log(`[VoiceChat] _play called, ${wavBuf.length}b`);
        return new Promise((resolve) => {
            // Convert WAV to OggOpus via our known ffmpeg — discord.js can't find ffmpeg as root
            const ffProc = spawn(FFMPEG, [
                '-i', 'pipe:0',
                '-c:a', 'libopus', '-ar', '48000', '-ac', '2',
                '-f', 'ogg', 'pipe:1'
            ], { stdio: ['pipe', 'pipe', 'pipe'] });
            ffProc.stdin.on('error', (e) => console.error('[VoiceChat] ffProc stdin error:', e.message));
            const ffErr = [];
            ffProc.stderr.on('data', (c) => ffErr.push(c));
            ffProc.on('close', (code) => {
                if (code !== 0) console.error(`[VoiceChat] ffmpeg exit ${code}:`, Buffer.concat(ffErr).toString().slice(-200));
            });
            ffProc.stdin.write(wavBuf);
            ffProc.stdin.end();

            const resource = createAudioResource(ffProc.stdout, {
                inputType: StreamType.OggOpus
            });

            // Temporarily subscribe TTS player to the connection
            const conn = getVoiceConnection(session.guildId) || session.connection;
            const musicState = musicManager.get().getState(session.guildId);

            // Pause music player FIRST so its AutoPaused handler doesn't steal the connection back
            if (musicState?.player) {
                try { musicState.player.pause(true); } catch { /* */ }
            }
            conn.subscribe(session.player);

            session.player.play(resource);

            const done = () => {
                cleanup();
                // Restore music player subscription and resume
                if (musicState?.player) {
                    conn.subscribe(musicState.player);
                    try { musicState.player.unpause(); } catch { /* */ }
                }
                resolve();
            };
            const timeout = () => {
                try { session.player.stop(true); } catch { /* */ }
                done();
            };
            const onError = (err) => {
                console.error('[VoiceChat] Player error:', err.message);
                done();
            };
            const timer = setTimeout(timeout, PLAY_TIMEOUT_MS);
            const cleanup = () => {
                clearTimeout(timer);
                session.player.removeListener(AudioPlayerStatus.Idle, done);
                session.player.removeListener('error', onError);
            };
            session.player.once(AudioPlayerStatus.Idle, done);
            session.player.once('error', onError);
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
                if (session.persistent) {
                    await this._reconnectPersistent(session);
                    return;
                }
                this._destroy(session.guildId);
            }
        });
        session.connection.on(VoiceConnectionStatus.Destroyed, () => {
            const current = this.sessions.get(session.guildId);
            if (current && current.connection === session.connection) {
                this.sessions.delete(session.guildId);
            }
        });
    }

    async _reconnectPersistent(session) {
        try {
            const channel = this.client.channels.cache.get(session.channelId);
            if (!channel) throw new Error('Channel not in cache');

            const newConn = joinVoiceChannel({
                channelId: session.channelId,
                guildId: session.guildId,
                adapterCreator: channel.guild.voiceAdapterCreator,
                selfDeaf: false,
                selfMute: false
            });

            newConn.subscribe(session.player);
            session.connection = newConn;

            await entersState(newConn, VoiceConnectionStatus.Ready, 10_000);
            this._listen(session);
            this._watchDisconnect(session);

            console.log(`[VoiceChat] Reconnected persistent session (guild ${session.guildId})`);
        } catch (err) {
            console.error('[VoiceChat] Persistent reconnect failed:', err.message);
            this._destroy(session.guildId);
        }
    }

    _destroy(guildId) {
        const s = this.sessions.get(guildId);
        if (!s) return;
        s.respondingTo = null;
        try { s.player.stop(true); } catch { /* */ }
        try { s.connection.destroy(); } catch { /* */ }
        this.sessions.delete(guildId);
        console.log(`[VoiceChat] Destroyed session for guild ${guildId}`);
    }
}

module.exports = new VoiceChatService();

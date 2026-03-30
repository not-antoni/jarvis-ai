'use strict';

const {
    joinVoiceChannel,
    getVoiceConnection,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    NoSubscriberBehavior,
    VoiceConnectionStatus,
    EndBehaviorType,
    entersState,
    StreamType
} = require('@discordjs/voice');
const { spawn } = require('node:child_process');
const { Readable } = require('node:stream');
const nvidiaSpeech = require('./nvidia-speech');
const openaiStt = require('./openai-stt');
const config = require('../../config');
const { musicManager } = require('../core/musicManager');
const { isCpuThrottled, getCpuFreqMHz } = require('../utils/cpu-monitor');
const database = require('./database');

const FFMPEG = process.env.FFMPEG_PATH || (() => {
    try { return require('ffmpeg-static'); } catch { return 'ffmpeg'; }
})();

// ─── Tuning ───────────────────────────────────────────────────────────────────
const SILENCE_MS         = 3000;      // ms silence before ending capture
const MIN_PACKETS        = 10;        // min opus packets to count as speech
const BARGE_IN_PACKETS   = 120;       // packets to trigger interrupt during playback
const MAX_RESPONSE_QUEUE = 5;         // post-STT addressed requests only
const ACTIVE_SPEAKER_IDLE_MS = Math.max(15_000, Number(process.env.VOICE_ACTIVE_SPEAKER_IDLE_MS) || 90_000);
const ACTIVE_SPEAKER_FOLLOWUP_MS = Math.max(5_000, Number(process.env.VOICE_ACTIVE_SPEAKER_FOLLOWUP_MS) || 30_000);
const WAKEWORD_PROBE_MS  = Math.max(800, Number(process.env.VOICE_WAKEWORD_PROBE_MS) || 2_000);
// STT idle timeout removed — energy gate + wake word filter already prevent unnecessary API calls
const MAX_TTS_CHARS      = 500;
const MIN_TRANSCRIPT_LEN = 4;
const PLAY_TIMEOUT_MS    = 30_000;
const STREAM_SAFETY_MS   = 60_000;    // force-close hung opus streams
const PROCESS_SAFETY_MS  = 90_000;    // force-reset stuck processing flag
const MAX_PCM_BYTES      = 48000 * 2 * 2 * 30; // 30s of 48kHz stereo s16le (~5.5MB)
const ECHO_COOLDOWN_MS   = 2500;               // ignore STT right after bot finishes speaking
const MIN_PCM_ENERGY     = 300;                // skip near-silent audio (RMS threshold)
const PROBE_COOLDOWN_MS  = 5_000;              // skip re-probing users who didn't say wake word recently
const FFMPEG_TIMEOUT_MS  = 10_000;             // kill hung ffmpeg subprocesses
const TTS_GAIN           = 2.8;                // boost synthesized speech over VC

// Single-word noise the STT picks up from silence/background
const NOISE_WORDS = new Set([
    'you', 'uh', 'um', 'hmm', 'hm', 'ah', 'oh', 'mhm', 'mm',
    'yeah', 'yep', 'nah', 'the', 'a', 'ok',
    'bye', 'thank', 'thanks', 'so'
]);

// Channels where the bot stays connected permanently (guild → channel)
// Configured via env: VOICE_PERSISTENT_CHANNELS=guildId:channelId,guildId:channelId
const PERSISTENT_CHANNELS = new Map(
    (process.env.VOICE_PERSISTENT_CHANNELS || '858444090374881301:858444090949369899')
        .split(',')
        .map(pair => pair.trim().split(':'))
        .filter(([g, c]) => g && c)
);

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
        .replace(/<t:\d+(?::[tTdDfFR])?>/g, '')            // <t:1234567890:R> Discord timestamps
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
    const step = 200; // bytes — every 100th s16le sample (2 bytes each)
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

function escapeRegex(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsWakeWord(text, wakeWord) {
    const normalizedText = String(text || '').trim();
    const normalizedWakeWord = String(wakeWord || '').trim();
    if (!normalizedText || !normalizedWakeWord) {
        return false;
    }

    const pattern = new RegExp(`\\b${escapeRegex(normalizedWakeWord)}\\b`, 'i');
    return pattern.test(normalizedText);
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
    if (wavBuf.toString('ascii', 0, 4) !== 'RIFF') {
        return wavBuf;
    }

    const maxDataBytes = Math.max(1, Math.floor(16_000 * 2 * (maxMs / 1000)));
    const pcm = wavBuf.subarray(44);
    if (pcm.length <= maxDataBytes) {
        return wavBuf;
    }

    return wrapPcmAsWav(pcm.subarray(0, maxDataBytes), 16_000, 1, 16);
}

// ─── Service ──────────────────────────────────────────────────────────────────

class VoiceChatService {
    constructor() {
        this.sessions = new Map();
        this.client  = null;
        this.jarvis  = null;
        this._userCache = new Map();
        this._optOutCache = new Map(); // userId → { optedOut: bool, ts: number }
        this._probeCooldowns = new Map(); // `${guildId}:${userId}` → timestamp of last failed probe
    }

    init(client, jarvis) {
        this.client = client;
        this.jarvis = jarvis;
        const sttStatus = openaiStt.enabled
            ? `openai:${openaiStt.model}`
            : nvidiaSpeech.sttEnabled
                ? 'nvidia'
                : 'off';
        if (openaiStt.enabled || nvidiaSpeech.enabled) {
            console.log(
                `[VoiceChat] Ready — STT: ${sttStatus}, ` +
                `TTS: ${nvidiaSpeech.ttsEnabled ? 'on' : 'off'}`
            );
        }

    }

    _createSessionPlayer(guildId) {
        const player = createAudioPlayer({
            behaviors: {
                noSubscriber: NoSubscriberBehavior.Play
            }
        });

        player.on('stateChange', (oldState, newState) => {
            if (oldState.status === newState.status) return;
            console.log(`[VoiceChat] Player state guild=${guildId} ${oldState.status} -> ${newState.status}`);
        });

        player.on('error', (err) => {
            console.error(`[VoiceChat] Player error guild=${guildId}:`, err.message);
        });

        return player;
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

        const guildId = channel.guild.id;
        const musicState = musicManager.get().getState(guildId);
        const joinConfig = {
            channelId: channel.id,
            guildId,
            adapterCreator: channel.guild.voiceAdapterCreator,
            selfDeaf: false,
            selfMute: false
        };
        const joinFresh = () => joinVoiceChannel(joinConfig);

        let connection = getVoiceConnection(guildId);
        const reusedExistingConnection = Boolean(connection);
        if (connection) {
            const currentChannelId = connection.joinConfig?.channelId;
            if (typeof connection.rejoin === 'function') {
                connection.rejoin({
                    channelId: channel.id,
                    selfDeaf: false,
                    selfMute: false
                });
                if (currentChannelId === channel.id) {
                    console.log(`[VoiceChat] Reused existing VC connection for /voice in "${channel.name}" (guild ${guildId})`);
                } else {
                    console.log(`[VoiceChat] Moved existing VC connection for /voice to "${channel.name}" (guild ${guildId})`);
                }
            } else {
                connection = joinFresh();
            }
        } else {
            connection = joinFresh();
        }

        try {
            await entersState(connection, VoiceConnectionStatus.Ready, 10_000);
        } catch (error) {
            console.warn(`[VoiceChat] Existing VC connection was not ready for /voice in guild ${guildId}:`, error?.message || error);
            try { connection?.destroy(); } catch { /* */ }
            this.sessions.delete(guildId);
            connection = joinFresh();
            await entersState(connection, VoiceConnectionStatus.Ready, 10_000);
        }

        await this.ensureListening(guildId, channel.id);

        const session = this.sessions.get(guildId);
        if (session) {
            session.textChannelId = interaction.channelId || interaction.channel?.id || null;
            session.voiceOwnerId = interaction.user?.id || member?.id || null;
            session.activeSpeakerId = null;
            session.lastEngagementAt = 0;
            session.standbySince = Date.now();
            session.playbackNeedsRefresh = reusedExistingConnection && Boolean(musicState?.player && musicState?.currentVideo);
            session.playbackRefreshMode = session.playbackNeedsRefresh ? 'pending-rejoin' : 'manual';
            console.log(
                `[VoiceChat] Session armed in "${channel.name}" (guild ${guildId}) ` +
                `owner=${session.voiceOwnerId || 'unknown'} standby=true`
            );
        }

        return `Joined **${channel.name}**, listening for your commands.`;
    }

    // ─── Auto-attach: listen whenever the bot is in a VC ──────────────────────

    handleVoiceStateUpdate(oldState, newState) {
        const botId = this.client?.user?.id;

        // Bot's own state changed — auto-attach/detach STT
        if (newState.member?.id === botId) {
            const hasSession = this.sessions.has(newState.guild.id);
            console.log(`[VoiceChat] Bot voiceState: old=${oldState.channelId} new=${newState.channelId} hasSession=${hasSession}`);
            if (newState.channelId && hasSession) {
                // Only keep an already-enabled voice session in sync. `/voice`
                // is the explicit entrypoint; music joins should not auto-enable STT.
                this._autoAttach(newState.guild.id, newState.channelId);
            } else if (!newState.channelId && oldState.channelId) {
                // Bot left
                this.sessions.delete(oldState.guild.id);
            }
            return;
        }
    }

    async _autoAttach(guildId, channelId) {
        if (!openaiStt.enabled && !nvidiaSpeech.sttEnabled) return;
        const connection = getVoiceConnection(guildId);
        if (!connection) return;

        try {
            if (connection.state.status !== VoiceConnectionStatus.Ready) {
                await entersState(connection, VoiceConnectionStatus.Ready, 10_000);
            }
        } catch { return; }

        const existing = this.sessions.get(guildId);
        if (existing) {
            existing.voiceOwnerId ??= null;
            existing.activeSpeakerId ??= null;
            existing.lastEngagementAt ??= 0;
            existing.standbySince ??= Date.now();
            existing.channelId = channelId;
            if (existing.connection === connection) {
                return;
            }

            existing.connection = connection;
            existing.activeListeners = new Set();
            existing.responseQueue = [];
            existing.responding = false;
            existing.respondingTo = null;
            existing.playbackNeedsRefresh = true;
            existing.playbackRefreshMode = 'unknown';
            this._listen(existing);
            this._watchDisconnect(existing);

            const channel = this.client.channels.cache.get(channelId);
            console.log(`[VoiceChat] Reattached listener in "${channel?.name || channelId}" (guild ${guildId})`);
            return;
        }

        const player = this._createSessionPlayer(guildId);

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
            lastResponseCompletedAt: 0,
            voiceOwnerId: null,
            activeSpeakerId: null,
            lastEngagementAt: 0,
            standbySince: Date.now(),
            persistent: PERSISTENT_CHANNELS.has(guildId),
            sttActive: true,
            manuallyPaused: false,
            playbackNeedsRefresh: true,
            playbackRefreshMode: 'unknown'
        };

        this.sessions.set(guildId, session);
        this._listen(session);
        this._watchDisconnect(session);

        const channel = this.client.channels.cache.get(channelId);
        console.log(`[VoiceChat] Auto-listening in "${channel?.name || channelId}" (guild ${guildId})`);
    }

    async ensureListening(guildId, channelId) {
        if (!guildId || !channelId) return;
        await this._autoAttach(guildId, channelId);
    }

    _clearActiveSpeaker(session, reason = 'idle-timeout', now = Date.now()) {
        if (!session?.activeSpeakerId) {
            session.standbySince = session.standbySince || now;
            return false;
        }

        console.log(
            `[VoiceChat] Active speaker cleared guild=${session.guildId} ` +
            `user=${session.activeSpeakerId} reason=${reason}`
        );
        session.activeSpeakerId = null;
        session.lastEngagementAt = 0;
        session.standbySince = now;
        return true;
    }

    _expireActiveSpeakerLock(session, now = Date.now()) {
        if (!session?.activeSpeakerId || !session.lastEngagementAt) {
            return false;
        }
        if (now - session.lastEngagementAt < ACTIVE_SPEAKER_IDLE_MS) {
            return false;
        }
        return this._clearActiveSpeaker(session, 'idle-timeout', now);
    }

    _activateSpeaker(session, userId, reason = 'engaged', now = Date.now()) {
        if (session.activeSpeakerId === userId) {
            session.lastEngagementAt = now;
            session.standbySince = 0;
            return;
        }

        session.activeSpeakerId = userId;
        session.lastEngagementAt = now;
        session.standbySince = 0;
        console.log(
            `[VoiceChat] Active speaker locked guild=${session.guildId} ` +
            `user=${userId} reason=${reason}`
        );
    }

    _isActiveSpeakerFollowupAllowed(session, userId, now = Date.now()) {
        if (!session?.activeSpeakerId || session.activeSpeakerId !== userId) {
            return false;
        }

        if (session.respondingTo === userId) {
            return true;
        }

        if (session.responding && (!session.respondingTo || session.respondingTo === userId)) {
            return true;
        }

        if (!session.lastResponseCompletedAt) {
            return false;
        }

        return now - session.lastResponseCompletedAt <= ACTIVE_SPEAKER_FOLLOWUP_MS;
    }

    async _isExplicitWakeWord(session, userId, lowerText) {
        if (!lowerText) {
            return false;
        }

        if (config.wakeWords.some(w => containsWakeWord(lowerText, w))) {
            return true;
        }

        try {
            const userFeatures = require('./user-features');
            return await userFeatures.matchesGuildWakeWord(session.guildId, lowerText)
                || await userFeatures.matchesWakeWord(userId, lowerText);
        } catch {
            return false;
        }
    }

    async _transcribeSpeech(session, userId, wav, tag = 'full') {
        if (!wav) {
            return null;
        }

        if (openaiStt.enabled) {
            const text = await openaiStt.transcribe(wav, {
                filename: `vc-${session.guildId}-${userId}-${tag}.wav`,
                tag
            });
            if (text) {
                return text;
            }
        }

        if (nvidiaSpeech.sttEnabled) {
            return nvidiaSpeech.transcribe(wav);
        }

        return null;
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
            this._expireActiveSpeakerLock(session, capturedAt);

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

            const isActiveSpeaker = session.activeSpeakerId === userId;
            const hasImplicitFollowup = this._isActiveSpeakerFollowupAllowed(session, userId, capturedAt);
            let explicitWakeWord = false;
            let text = null;

            if (!hasImplicitFollowup) {
                // Skip users who were just probed and didn't say the wake word
                const cooldownKey = `${session.guildId}:${userId}`;
                const lastFailedProbe = this._probeCooldowns.get(cooldownKey) || 0;
                if (capturedAt - lastFailedProbe < PROBE_COOLDOWN_MS) {
                    return;
                }

                const probeWav = sliceWav16kMono(wav, WAKEWORD_PROBE_MS);
                const probeText = await this._transcribeSpeech(session, userId, probeWav, 'wake-probe');
                if (!probeText || isNoise(probeText)) {
                    if (probeText) console.log(`[VoiceChat] Filtered noise: "${probeText}"`);
                    this._probeCooldowns.set(cooldownKey, capturedAt);
                    return;
                }

                explicitWakeWord = await this._isExplicitWakeWord(session, userId, probeText.toLowerCase());
                if (!explicitWakeWord) {
                    this._probeCooldowns.set(cooldownKey, capturedAt);
                    console.log(
                        `[VoiceChat] Ignored non-active speaker guild=${session.guildId} ` +
                        `user=${userId} standby=${!session.activeSpeakerId}`
                    );
                    return;
                }
                // Wake word found — clear cooldown
                this._probeCooldowns.delete(cooldownKey);

                if (probeWav.length === wav.length) {
                    text = probeText;
                }
            }

            if (!text) {
                const tag = explicitWakeWord
                    ? 'full-after-wake'
                    : hasImplicitFollowup
                        ? 'full-followup'
                        : 'full';
                text = await this._transcribeSpeech(session, userId, wav, tag);
            }
            if (!text || isNoise(text)) {
                if (text) console.log(`[VoiceChat] Filtered noise: "${text}"`);
                return;
            }

            const userInfo = await this._resolveUser(userId);
            console.log(`[VoiceChat] <${userInfo.displayName}> ${text}`);

            if (!hasImplicitFollowup && !explicitWakeWord) {
                explicitWakeWord = await this._isExplicitWakeWord(session, userId, text.toLowerCase());
                if (!explicitWakeWord) {
                    return;
                }
            }

            if (hasImplicitFollowup) {
                session.lastEngagementAt = capturedAt;
                session.standbySince = 0;
            } else {
                this._activateSpeaker(
                    session,
                    userId,
                    explicitWakeWord ? (isActiveSpeaker ? 'wake-word-renew' : 'wake-word') : 'engaged',
                    capturedAt
                );
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
                    if (audio) {
                        await this._play(session, audio);
                        session.lastPlaybackEndedAt = Date.now();
                        session.lastResponseCompletedAt = session.lastPlaybackEndedAt;
                        return;
                    }
                }
                await this._textFallback(session, reply);
                session.lastResponseCompletedAt = Date.now();
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
        let dec = null;
        try {
            const OpusEncoder = require('opusscript');
            dec = new OpusEncoder(48000, 2);
            const frames = [];
            for (const pkt of packets) {
                try {
                    frames.push(Buffer.from(dec.decode(pkt)));
                } catch (pktErr) {
                    // WASM memory errors corrupt decoder state — stop decoding
                    if (pktErr?.message?.includes('memory access out of bounds')) break;
                    // Other per-packet errors: skip this packet, continue
                }
            }
            return frames.length ? Buffer.concat(frames) : null;
        } catch (err) {
            console.error('[VoiceChat] Opus decode error:', err.message);
            return null;
        } finally {
            try { dec?.delete(); } catch { /* */ }
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

    _wavToPcm48kStereo(wavBuf) {
        return new Promise((resolve) => {
            const proc = spawn(FFMPEG, [
                '-i', 'pipe:0',
                '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1'
            ], { stdio: ['pipe', 'pipe', 'pipe'] });

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
                    console.error(`[VoiceChat] wav->pcm ffmpeg exit ${code}:`, Buffer.concat(err).toString().slice(-200));
                    finish(null);
                    return;
                }
                finish(Buffer.concat(out));
            });
            proc.on('error', (error) => {
                clearTimeout(killTimer);
                console.error('[VoiceChat] wav->pcm ffmpeg error:', error.message);
                finish(null);
            });
            proc.stdin.on('error', (error) => {
                console.error('[VoiceChat] wav->pcm stdin error:', error.message);
            });
            proc.stdin.write(wavBuf);
            proc.stdin.end();
        });
    }

    async _hardRejoinForPlayback(session) {
        const channel = this.client.channels.cache.get(session.channelId)
            || await this.client.channels.fetch(session.channelId).catch(() => null);
        if (!channel?.guild?.voiceAdapterCreator) {
            throw new Error(`Voice channel ${session.channelId} is unavailable for playback rejoin.`);
        }

        const existing = getVoiceConnection(session.guildId) || session.connection;
        if (existing) {
            try { existing.destroy(); } catch { /* */ }
        }

        const connection = joinVoiceChannel({
            channelId: session.channelId,
            guildId: session.guildId,
            adapterCreator: channel.guild.voiceAdapterCreator,
            selfDeaf: false,
            selfMute: false
        });

        await entersState(connection, VoiceConnectionStatus.Ready, 10_000);
        session.connection = connection;
        session.activeListeners = new Set();
        this._listen(session);
        this._watchDisconnect(session);
        session.playbackNeedsRefresh = false;
        session.playbackRefreshMode = 'hard';

        console.log(`[VoiceChat] Rejoined VC for TTS in "${channel.name}" (guild ${session.guildId})`);
        return connection;
    }

    async _softRefreshForPlayback(session) {
        const connection = getVoiceConnection(session.guildId) || session.connection;
        if (!connection) {
            throw new Error('No active voice connection to refresh.');
        }

        if (typeof connection.rejoin !== 'function') {
            throw new Error('Voice connection does not support non-destructive rejoin refresh.');
        }

        const channelId = session.channelId || connection.joinConfig?.channelId;
        if (!channelId) {
            throw new Error('Voice connection is missing a target channel for rejoin refresh.');
        }

        const previousNetworking = connection.state?.networking;
        const hasRebuiltTransport = (state) =>
            state?.status === VoiceConnectionStatus.Ready &&
            state?.networking &&
            state.networking !== previousNetworking;

        await new Promise((resolve, reject) => {
            let settled = false;
            const cleanup = () => {
                clearTimeout(timer);
                connection.removeListener('stateChange', onStateChange);
            };
            const finish = (error = null) => {
                if (settled) return;
                settled = true;
                cleanup();
                if (error) reject(error);
                else resolve();
            };
            const onStateChange = (_oldState, newState) => {
                if (hasRebuiltTransport(newState)) {
                    finish();
                }
            };
            const timer = setTimeout(() => {
                if (hasRebuiltTransport(connection.state)) {
                    finish();
                    return;
                }
                finish(new Error('Voice rejoin did not rebuild the voice transport.'));
            }, 5_000);
            timer.unref();

            connection.on('stateChange', onStateChange);
            const ok = connection.rejoin({
                channelId,
                selfDeaf: false,
                selfMute: false
            });
            if (!ok) {
                finish(new Error('Voice connection rejected rejoin refresh.'));
                return;
            }

            console.log(`[VoiceChat] Requested VC rejoin refresh for TTS (guild ${session.guildId})`);
            if (hasRebuiltTransport(connection.state)) {
                finish();
            }
        });

        await entersState(connection, VoiceConnectionStatus.Ready, 5_000);

        session.connection = connection;
        session.playbackNeedsRefresh = false;
        session.playbackRefreshMode = 'soft-rejoin';

        console.log(`[VoiceChat] VC rejoin refresh complete for TTS (guild ${session.guildId})`);
        return connection;
    }

    async _refreshForPlayback(session) {
        if (!session.playbackNeedsRefresh) {
            return getVoiceConnection(session.guildId) || session.connection;
        }

        try {
            return await this._softRefreshForPlayback(session);
        } catch (error) {
            console.warn(`[VoiceChat] Soft VC refresh failed for guild ${session.guildId}:`, error?.message || error);
        }

        return this._hardRejoinForPlayback(session);
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

    async _play(session, wavBuf) {
        console.log(`[VoiceChat] _play called, ${wavBuf.length}b`);

        const pcmBuf = await this._wavToPcm48kStereo(wavBuf);
        if (!pcmBuf?.length) {
            console.warn(`[VoiceChat] Failed to convert TTS clip to PCM for guild ${session.guildId}`);
            return;
        }

        console.log(`[VoiceChat] TTS pcm bytes guild=${session.guildId} size=${pcmBuf.length} gain=${TTS_GAIN}`);

        const resource = createAudioResource(Readable.from(pcmBuf), {
            inputType: StreamType.Raw,
            inlineVolume: true
        });
        if (resource.volume) {
            resource.volume.setVolume(TTS_GAIN);
        }

        const musicState = musicManager.get().getState(session.guildId);
        if (musicState?.player) {
            musicState.voiceOverrideActive = true;
            try { musicState.player.pause(true); } catch { /* */ }
        }

        let conn = getVoiceConnection(session.guildId) || session.connection;
        if (conn && conn !== session.connection) {
            session.connection = conn;
            session.playbackNeedsRefresh = true;
            session.playbackRefreshMode = 'unknown';
        }
        if (musicState?.player && session.playbackNeedsRefresh) {
            try {
                conn = await this._refreshForPlayback(session);
            } catch (error) {
                if (musicState?.player) {
                    musicState.voiceOverrideActive = false;
                    try { musicState.player.unpause(); } catch { /* */ }
                }
                console.warn(`[VoiceChat] Failed to refresh VC for TTS in guild ${session.guildId}:`, error?.message || error);
                return;
            }
        }

        if (!conn) {
            console.warn(`[VoiceChat] Missing voice connection for guild ${session.guildId}; skipping TTS playback`);
            if (musicState?.player) {
                musicState.voiceOverrideActive = false;
                try { musicState.player.unpause(); } catch { /* */ }
            }
            return;
        }
        session.connection = conn;

        try {
            if (conn.state.status !== VoiceConnectionStatus.Ready) {
                await entersState(conn, VoiceConnectionStatus.Ready, 10_000);
            }
        } catch (error) {
            if (musicState?.player) {
                musicState.voiceOverrideActive = false;
                try { musicState.player.unpause(); } catch { /* */ }
            }
            console.warn(`[VoiceChat] Voice connection not ready for TTS in guild ${session.guildId}:`, error?.message || error);
            return;
        }

        if (musicState) {
            musicState.connection = conn;
        }

        const previousSubscription = conn.state?.subscription || null;
        const previousPlayer =
            previousSubscription?.player === session.player ? 'tts'
                : previousSubscription?.player === musicState?.player ? 'music'
                    : previousSubscription?.player ? 'other' : 'none';
        const packetsBefore = conn.state?.networking?.state?.connectionData?.packetsPlayed;

        console.log(
            `[VoiceChat] TTS handoff guild=${session.guildId} previous=${previousPlayer} ` +
            `music=${musicState?.player?.state?.status || 'none'} tts=${session.player.state?.status || 'unknown'} ` +
            `packetsBefore=${typeof packetsBefore === 'number' ? packetsBefore : 'n/a'} ` +
            `refresh=${session.playbackRefreshMode}`
        );

        if (previousSubscription?.player && previousSubscription.player !== session.player) {
            try { previousSubscription.unsubscribe(); } catch { /* */ }
        }

        const subscription = conn.subscribe(session.player);
        console.log(
            `[VoiceChat] TTS subscribed guild=${session.guildId} ` +
            `ok=${subscription?.player === session.player} conn=${conn.state.status}`
        );

        try { session.player.stop(true); } catch { /* */ }
        session.player.play(resource);

        const startResult = await Promise.race([
            entersState(session.player, AudioPlayerStatus.Playing, 5_000).then(() => 'playing').catch(() => null),
            entersState(session.player, AudioPlayerStatus.AutoPaused, 5_000).then(() => 'autopaused').catch(() => null),
            entersState(session.player, AudioPlayerStatus.Idle, 5_000).then(() => 'idle').catch(() => null),
            new Promise((resolve) => {
                const timer = setTimeout(() => resolve('timeout'), 5_000);
                timer.unref();
            })
        ]);

        console.log(
            `[VoiceChat] TTS start guild=${session.guildId} result=${startResult || 'none'} ` +
            `status=${session.player.state.status}`
        );

        if (session.player.state.status === AudioPlayerStatus.AutoPaused) {
            console.warn(`[VoiceChat] TTS auto-paused in guild ${session.guildId}; retrying subscription handoff`);
            try { conn.state?.subscription?.unsubscribe(); } catch { /* */ }
            conn.subscribe(session.player);
            try { session.player.unpause(); } catch { /* */ }
        }

        await new Promise((resolve) => {
            const done = () => {
                cleanup();
                const packetsAfter = conn.state?.networking?.state?.connectionData?.packetsPlayed;
                console.log(
                    `[VoiceChat] TTS done guild=${session.guildId} ` +
                    `packetsAfter=${typeof packetsAfter === 'number' ? packetsAfter : 'n/a'}`
                );
                if (musicState?.player) {
                    musicState.voiceOverrideActive = false;
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
                console.error('[VoiceChat] Player error during TTS:', err.message);
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
        // Purge probe cooldowns for this guild to prevent memory leak
        const prefix = `${guildId}:`;
        for (const key of this._probeCooldowns.keys()) {
            if (key.startsWith(prefix)) this._probeCooldowns.delete(key);
        }
        console.log(`[VoiceChat] Destroyed session for guild ${guildId}`);
    }
}

module.exports = new VoiceChatService();

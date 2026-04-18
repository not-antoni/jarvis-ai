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
const { Readable } = require('node:stream');
const nvidiaSpeech = require('./nvidia-speech');
const config = require('../../config');
const { musicManager } = require('../core/musicManager');
const { isCpuThrottled, getCpuFreqMHz } = require('../utils/cpu-monitor');
const database = require('./database');

const {
    VOICE_HINT,
    cleanForTts,
    truncateForTts,
    isNoise,
    containsWakeWord
} = require('./voice/text-utils');
const {
    pcmEnergy,
    sliceWav16kMono,
    pcm48kStereoToWav16kMono,
    audioToWav16k: audioToWav16kFn,
    wavToPcm48kStereo
} = require('./voice/audio-utils');
const {
    MAX_OPUS_PACKET_BYTES,
    MAX_CORRUPT_OPUS_PACKETS,
    isRecoverableOpusDecodeError,
    isFatalOpusDecodeError,
    loadOpusDecoderFactory,
    getOpusBackend
} = require('./voice/opus-decoder');

// ─── Tuning ───────────────────────────────────────────────────────────────────
const SILENCE_MS         = 3000;      // ms silence before ending capture
const MIN_PACKETS        = 10;        // min opus packets to count as speech
const BARGE_IN_PACKETS   = 120;       // packets to trigger interrupt during playback
const MAX_RESPONSE_QUEUE = 5;         // post-STT addressed requests only
const ACTIVE_SPEAKER_IDLE_MS = Math.max(15_000, Number(process.env.VOICE_ACTIVE_SPEAKER_IDLE_MS) || 90_000);
const ACTIVE_SPEAKER_FOLLOWUP_MS = Math.max(5_000, Number(process.env.VOICE_ACTIVE_SPEAKER_FOLLOWUP_MS) || 30_000);
const WAKEWORD_PROBE_MS  = Math.max(800, Number(process.env.VOICE_WAKEWORD_PROBE_MS) || 2_000);
const PLAY_TIMEOUT_MS    = 30_000;
const STREAM_SAFETY_MS   = 60_000;    // force-close hung opus streams
const PROCESS_SAFETY_MS  = 90_000;    // force-reset stuck processing flag
const MAX_PCM_BYTES      = 48000 * 2 * 2 * 30; // 30s of 48kHz stereo s16le (~5.5MB)
const ECHO_COOLDOWN_MS   = 2500;               // ignore STT right after bot finishes speaking
const MIN_PCM_ENERGY     = 300;                // skip near-silent audio (RMS threshold)
const PROBE_COOLDOWN_MS  = 5_000;              // skip re-probing users who didn't say wake word recently
const TTS_GAIN           = 2.8;                // boost synthesized speech over VC

// Channels where the bot stays connected permanently (guild → channel)
// Configured via env: VOICE_PERSISTENT_CHANNELS=guildId:channelId,guildId:channelId
const PERSISTENT_CHANNELS = new Map(
    (process.env.VOICE_PERSISTENT_CHANNELS || '858444090374881301:858444090949369899')
        .split(',')
        .map(pair => pair.trim().split(':'))
        .filter(([g, c]) => g && c)
);
const SILENT_LEAVE_GUILD_IDS = new Set(['858444090374881301']);

function isMusicPlaying(guildId) {
    try {
        const state = musicManager.get().getState(guildId);
        if (!state?.player || !state.currentVideo) {return false;}
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
        this._probeCooldowns = new Map(); // `${guildId}:${userId}` → timestamp of last failed probe
    }

    init(client, jarvis) {
        this.client = client;
        this.jarvis = jarvis;
        const sttStatus = nvidiaSpeech.sttEnabled ? 'nvidia' : 'off';
        const opusStatus = this._getOpusDecoderBackend();
        if (nvidiaSpeech.enabled) {
            console.log(
                `[VoiceChat] Ready — STT: ${sttStatus}, ` +
                `TTS: ${nvidiaSpeech.ttsEnabled ? 'on' : 'off'}, ` +
                `Opus: ${opusStatus}`
            );
        }

    }

    _getOpusDecoderBackend() {
        try {
            loadOpusDecoderFactory();
            return getOpusBackend() || 'unavailable';
        } catch {
            return 'unavailable';
        }
    }

    _createOpusDecoder() {
        return loadOpusDecoderFactory()();
    }

    shouldSilentlyIgnoreLeave(guildId) {
        return SILENT_LEAVE_GUILD_IDS.has(String(guildId || ''));
    }

    _getVoiceConnection(guildId) {
        return getVoiceConnection(guildId);
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

    leave(guildId) {
        if (!guildId) {
            return 'This command only works inside a server, sir.';
        }

        const normalizedGuildId = String(guildId);
        let disconnected = false;

        try {
            const music = musicManager.get();
            if (music.getState(normalizedGuildId)) {
                music.cleanup(normalizedGuildId);
                disconnected = true;
            }
        } catch (error) {
            console.warn(`[VoiceChat] Failed to clean up music state for guild ${normalizedGuildId}:`, error?.message || error);
        }

        if (this.sessions.has(normalizedGuildId)) {
            this._destroy(normalizedGuildId);
            disconnected = true;
        } else {
            const connection = this._getVoiceConnection(normalizedGuildId);
            if (connection) {
                try {
                    connection.destroy();
                    disconnected = true;
                } catch (error) {
                    console.warn(`[VoiceChat] Failed to destroy raw VC connection for guild ${normalizedGuildId}:`, error?.message || error);
                }
            }
        }

        return disconnected ? 'Disconnected from voice, sir.' : 'I am not in a voice channel, sir.';
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
        if (!nvidiaSpeech.sttEnabled) return;
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

        return config.wakeWords.some(w => containsWakeWord(lowerText, w));
    }

    async _transcribeSpeech(session, userId, wav, tag = 'full') {
        if (!wav) return null;
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

            const wav = await pcm48kStereoToWav16kMono(pcm);
            if (!wav) return;

            let text = null;

            // Always require "jarvis" — no implicit follow-ups
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

            if (!await this._isExplicitWakeWord(session, userId, probeText.toLowerCase())) {
                this._probeCooldowns.set(cooldownKey, capturedAt);
                return;
            }
            this._probeCooldowns.delete(cooldownKey);

            if (probeWav.length === wav.length) {
                text = probeText;
            }

            if (!text) {
                text = await this._transcribeSpeech(session, userId, wav, 'full-after-wake');
            }
            if (!text || isNoise(text)) {
                if (text) console.log(`[VoiceChat] Filtered noise: "${text}"`);
                return;
            }

            const userInfo = await this._resolveUser(userId);
            console.log(`[VoiceChat] <${userInfo.displayName}> ${text}`);

            this._activateSpeaker(session, userId, 'wake-word', capturedAt);
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
        let decoder = null;
        try {
            decoder = this._createOpusDecoder();
            const frames = [];
            let corruptPackets = 0;
            for (const pkt of packets) {
                if (!Buffer.isBuffer(pkt) || pkt.length === 0 || pkt.length > MAX_OPUS_PACKET_BYTES) {
                    corruptPackets++;
                    if (corruptPackets >= MAX_CORRUPT_OPUS_PACKETS) return null;
                    continue;
                }

                try {
                    const frame = decoder.decode(pkt);
                    if (frame?.length) frames.push(Buffer.from(frame));
                } catch (pktErr) {
                    if (!isRecoverableOpusDecodeError(pktErr)) throw pktErr;
                    corruptPackets++;
                    if (isFatalOpusDecodeError(pktErr) || corruptPackets >= MAX_CORRUPT_OPUS_PACKETS) {
                        return null;
                    }
                }
            }
            return frames.length ? Buffer.concat(frames) : null;
        } catch (err) {
            console.error('[VoiceChat] Opus decode error:', err.message);
            return null;
        } finally {
            try { decoder?.destroy(); } catch { /* */ }
        }
    }

    audioToWav16k(audioBuf) {
        return audioToWav16kFn(audioBuf);
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

        const pcmBuf = await wavToPcm48kStereo(wavBuf);
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

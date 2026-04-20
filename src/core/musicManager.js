const {
    joinVoiceChannel,
    getVoiceConnection,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    NoSubscriberBehavior,
    VoiceConnectionStatus,
    entersState
} = require('@discordjs/voice');
const { AttachmentBuilder } = require('discord.js');
const { getAudioStream, cancelStream } = require('../utils/playDl');
const { extractVideoId } = require('../utils/youtube');
const { isGuildAllowed } = require('../utils/musicGuildWhitelist');
const { safeSend } = require('../utils/discord-safe-send');
const LOOP_MODES = ['off', 'song', 'queue'];
const envNum = (k, d) => Number(process.env[k]) || d;
const VOICE_READY_TIMEOUT_MS = envNum('MUSIC_VOICE_READY_TIMEOUT_MS', 30_000);
const VOICE_JOIN_RETRIES = envNum('MUSIC_VOICE_JOIN_RETRIES', 4);
const VOICE_RECONNECT_ATTEMPTS = envNum('MUSIC_VOICE_RECONNECT_ATTEMPTS', 10);
const VOICE_RECONNECT_DELAY_MS = envNum('MUSIC_VOICE_RECONNECT_DELAY_MS', 1_500);
const VOICE_JOIN_RETRY_DELAY_MS = envNum('MUSIC_VOICE_JOIN_RETRY_DELAY_MS', 1_500);
const VOICE_ENSURE_READY_RETRIES = envNum('MUSIC_VOICE_ENSURE_READY_RETRIES', 3);
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
function cloneTrack(track) {
    return track ? { ...track } : null;
}
function extractVoiceCloseCode(state) {
    const candidates = [
        state?.closeCode,
        state?.reason?.code,
        state?.networking?.closeCode,
        state?.networking?.state?.closeCode,
        state?.ws?.closeCode,
        state?.adapterData?.closeCode
    ];
    for (const value of candidates) {
        if (typeof value === 'number' && Number.isFinite(value)) {
            return value;
        }
    }
    return null;
}
function normalizePlaybackFailureReason(rawMessage) {
    const text = String(rawMessage || '').trim();
    if (!text) {
        return 'Unable to play that track right now, sir.';
    }
    const normalized = text.startsWith('Unable to play:')
        ? (text.slice('Unable to play:'.length).trim() || text)
        : text;
    if (normalized.length > 500) {
        return `${normalized.slice(0, 497)}...`;
    }
    return normalized;
}
function sanitizeAttachmentFilename(name) {
    const raw = String(name || '').trim();
    if (!raw) {
        return 'upload-audio.mp3';
    }
    const cleaned = raw
        .replace(/[\\/:*?"<>|]/g, '_')
        .replace(/\s+/g, ' ')
        .trim();
    return (cleaned || 'upload-audio.mp3').slice(0, 180);
}
class MusicManager {
    constructor(client) {
        this.queues = new Map(); // guildId -> state
        this.client = client;
    }
    getState(guildId) {
        return this.queues.get(guildId) ?? null;
    }
    getActiveGuildIds() {
        return Array.from(this.queues.keys());
    }
    getQueueSnapshot(guildId) {
        const state = this.getState(guildId);
        if (!state) {
            return {
                guildId: String(guildId),
                active: false,
                current: null,
                pendingVideoId: null,
                queuedCount: 0,
                voiceChannelId: null,
                loopMode: 'off'
            };
        }
        return {
            guildId: String(guildId),
            active: Boolean(state.currentVideo) || Boolean(state.pendingVideoId) || state.queue.length > 0,
            current: state.currentVideo
                ? {
                    title: state.currentVideo.title,
                    url: state.currentVideo.url
                }
                : null,
            pendingVideoId: state.pendingVideoId || null,
            queuedCount: Array.isArray(state.queue) ? state.queue.length : 0,
            voiceChannelId: state.voiceChannelId || null,
            loopMode: state.loopMode || 'off'
        };
    }
    async enqueue(guildId, voiceChannel, video, interaction) {
        if (!isGuildAllowed(guildId)) {
            return '⚠️ Music playback is not enabled for this server, sir.';
        }
        let state = this.queues.get(guildId);
        if (!state) {
            const connection = await this.createConnection(guildId, voiceChannel);
            const player = this.createPlayer(guildId);
            this.safeSubscribe(connection, player);
            state = {
                connection,
                player,
                queue: [],
                currentVideo: null,
                currentRelease: null,
                pendingVideoId: null,
                skipInProgress: false,
                timeout: null,
                textChannel: interaction.channel ?? null,
                voiceChannelId: voiceChannel.id,
                loopMode: 'off'
            };
            this.queues.set(guildId, state);
        } else {
            state.voiceChannelId = voiceChannel.id;
            state.textChannel = interaction.channel ?? state.textChannel;
        }
        if (state.timeout) {
            clearTimeout(state.timeout);
            state.timeout = null;
        }
        if (!state.currentVideo && !state.pendingVideoId) {
            const announcement = await this.play(guildId, video, { announce: 'command' });
            return announcement || this.buildNowPlayingAnnouncement(video);
        }
        state.queue.push(video);
        return `🧃 Queued **${video.title}** (position ${state.queue.length + 1})`;
    }
    async play(guildId, video, options = {}) {
        const announce = options.announce ?? 'command';
        const queueAdvance = options.queueAdvance === true;
        const state = this.queues.get(guildId);
        if (!state) {
            return '⚠️ Nothing to play, sir.';
        }
        if (state.timeout) {
            clearTimeout(state.timeout);
            state.timeout = null;
        }
        try {
            await this.ensureVoiceReady(guildId, state);
        } catch (error) {
            const reason = normalizePlaybackFailureReason(error?.message);
            const failureMessage = queueAdvance
                ? `⚠️ Skipping **${video.title}**: ${reason}`
                : `⚠️ Unable to play **${video.title}**: ${reason}`;
            if (announce === 'channel' && state.textChannel) {
                safeSend(state.textChannel, { content: failureMessage }, this.client).catch(() => { });
            }
            return failureMessage;
        }
        const videoId = extractVideoId(video.url) ?? video.url;
        state.pendingVideoId = videoId;
        const playStart = Date.now();
        let streamResult;
        try {
            streamResult = await getAudioStream({
                id: videoId,
                url: video.url,
                source: video.source || null
            });
            state.pendingVideoId = null;
        } catch (error) {
            state.pendingVideoId = null;
            if (error.message === 'Stream cancelled') {
                return null;
            }
            console.error('music stream failed:', error.message);
            const reason = normalizePlaybackFailureReason(error.message);
            const failureMessage = queueAdvance
                ? `⚠️ Skipping **${video.title}**: ${reason}`
                : `⚠️ Unable to play **${video.title}**: ${reason}`;
            if (announce === 'channel' && state.textChannel) {
                safeSend(state.textChannel, { content: failureMessage }, this.client).catch(() => { });
            }
            return failureMessage;
        }
        try {
            // Create resource from stream - plays immediately!
            // Disable inlineVolume for better performance (less CPU overhead)
            // Add silence padding to prevent cutoffs between tracks
            const resource = createAudioResource(streamResult.stream, {
                inputType: streamResult.type,
                inlineVolume: false,
                silencePaddingFrames: 15  // More aggressive silence buffer for smoother playback
            });
            this.releaseCurrent(state);
            this.safeSubscribe(state.connection, state.player);
            state.player.play(resource);
            state.currentVideo = video;
            state.currentStartedAt = Date.now();
            state.currentRelease = streamResult.cleanup;
            console.log(
                `[music][play] guild=${guildId} source=${video.source || 'unknown'} id=${videoId} ttfbMs=${Date.now() - playStart}`
            );
            const message = this.buildNowPlayingAnnouncement(video);
            if (announce === 'command') {
                return message;
            }
            if (announce === 'channel' && state.textChannel) {
                await this.sendNowPlayingAnnouncement(state, video, message);
            }
        } catch (error) {
            console.error('Music playback error:', error);
            streamResult.cleanup();
            const reason = normalizePlaybackFailureReason(error?.message);
            const failureMessage = queueAdvance
                ? `⚠️ Skipping **${video.title}**: ${reason}`
                : `⚠️ Could not play **${video.title}**.`;
            if (announce === 'command') {
                return failureMessage;
            }
            if (announce === 'channel' && state.textChannel) {
                safeSend(state.textChannel, { content: failureMessage }, this.client).catch(() => { });
            }
            return failureMessage;
        }
        return null;
    }
    buildNowPlayingAnnouncement(video) {
        const title = String(video?.title || 'Unknown track');
        const fallbackMessage = `🎶 Now playing: **${title}**\n${video?.url || ''}`.trim();
        if (!video?.isUpload || !video?.uploadPreviewUrl) {
            return fallbackMessage;
        }
        try {
            const filename = sanitizeAttachmentFilename(video?.filename || video?.title);
            return {
                content: `🎶 Now playing: **${title}**`,
                files: [new AttachmentBuilder(video.uploadPreviewUrl, { name: filename })]
            };
        } catch (error) {
            console.warn('[MusicManager] Failed to build upload attachment message:', error?.message || error);
            return fallbackMessage;
        }
    }
    async sendNowPlayingAnnouncement(state, video, payload = null) {
        if (!state?.textChannel) {
            return;
        }
        const announcement = payload || this.buildNowPlayingAnnouncement(video);
        if (typeof announcement === 'string') {
            await safeSend(state.textChannel, { content: announcement }, this.client);
            return;
        }
        const sent = await safeSend(state.textChannel, announcement, this.client);
        if (sent?.ok) {
            return;
        }
        // Fallback when URL-based attachment upload fails (expired URL, fetch failure, etc.).
        const fallback = `🎶 Now playing: **${video?.title || 'Unknown track'}**\n${video?.url || ''}`.trim();
        await safeSend(state.textChannel, { content: fallback }, this.client);
    }
    async playNextAvailableFromQueue(guildId, state, options = {}) {
        const announce = options.announce ?? 'channel';
        let attempted = 0;
        while (state.queue.length > 0) {
            const liveState = this.queues.get(guildId);
            if (!liveState || liveState !== state) {
                return null;
            }
            const next = state.queue.shift();
            attempted += 1;
            const result = await this.play(guildId, next, {
                announce,
                queueAdvance: true
            });
            if (state.currentVideo) {
                return result;
            }
            if (result === null) {
                return null;
            }
        }
        if (announce === 'channel' && attempted > 0 && state.textChannel) {
            safeSend(
                state.textChannel,
                { content: '⚠️ No playable tracks left in queue, sir.' },
                this.client
            ).catch(() => { });
        }
        return null;
    }
    async skip(guildId) {
        const state = this.queues.get(guildId);
        if (!state) {
            return '⚠️ Nothing is playing, sir.';
        }
        const hasActive = Boolean(state.currentVideo) || Boolean(state.pendingVideoId);
        if (!hasActive) {
            return '⚠️ Nothing is playing, sir.';
        }
        const loopBeforeSkip = state.loopMode;
        state.loopMode = 'off';
        this.cancelPendingDownload(state);
        this.releaseCurrent(state);
        const upcoming = state.queue[0] ?? null;
        state.skipInProgress = true;
        state.player.stop(true);
        if (!upcoming) {
            return '⏭️ Skipped — queue empty. Staying connected.';
        }
        state.loopMode = loopBeforeSkip;
        return `⏭️ Skipping to **${upcoming.title}**…`;
    }
    async jumpToPosition(guildId, position) {
        const state = this.queues.get(guildId);
        if (!state) {
            return '⚠️ Nothing is playing right now.';
        }
        const total = (state.currentVideo || state.pendingVideoId) ? state.queue.length + 1 : state.queue.length;
        if (!Number.isInteger(position) || position < 1 || position > total) {
            return `⚠️ Queue only has **${total}** song${total === 1 ? '' : 's'}.`;
        }
        if (position === 1) {
            return '⚠️ Song #1 is already playing! Use `/skip` to skip it.';
        }
        const targetIndex = position - 2;
        const target = state.queue[targetIndex];
        if (!target) {
            return '⚠️ Could not jump to that queue position.';
        }
        state.queue = state.queue.slice(targetIndex);
        await this.skip(guildId);
        return `⏭️ Jumped to #${position}: **${target.title}**`;
    }
    stop(guildId, options = {}) {
        const disconnect = options.disconnect !== false;
        const state = this.queues.get(guildId);
        if (!state) {
            return '⚠️ Nothing to stop, sir.';
        }
        // Clear timeout first to prevent race conditions
        if (state.timeout) {
            clearTimeout(state.timeout);
            state.timeout = null;
        }
        this.cancelPendingDownload(state);
        this.releaseCurrent(state);
        state.queue = [];
        state.loopMode = 'off';
        state.skipInProgress = false;
        // Stop the player to interrupt active playback.
        try {
            if (state.player) {
                state.player.stop(true);
            }
        } catch (e) {
            console.warn('Failed to stop player:', e?.message || e);
        }
        if (disconnect) {
            this.cleanup(guildId);
            return '🛑 Stopped playback and cleared queue.';
        }
        return '⏹️ Stopped music and cleared queue. Staying connected.';
    }
    pause(guildId) {
        const state = this.queues.get(guildId);
        if (!state?.player || !state.currentVideo) {
            return '⚠️ Nothing is playing, sir.';
        }
        const success = state.player.pause();
        return success ? '⏸️ Paused playback.' : '⚠️ Unable to pause playback.';
    }
    resume(guildId) {
        const state = this.queues.get(guildId);
        if (!state?.player) {
            return '⚠️ Nothing is playing, sir.';
        }
        const success = state.player.unpause();
        return success ? '▶️ Resumed playback.' : '⚠️ Playback is not paused, sir.';
    }
    getLoopMode(guildId) {
        const state = this.queues.get(guildId);
        if (!state) {
            return null;
        }
        return state.loopMode || 'off';
    }
    setLoopMode(guildId, mode) {
        const state = this.queues.get(guildId);
        if (!state || (!state.currentVideo && !state.pendingVideoId && state.queue.length === 0)) {
            return null;
        }
        const normalized = LOOP_MODES.includes(mode) ? mode : 'off';
        state.loopMode = normalized;
        return normalized;
    }
    cycleLoopMode(guildId) {
        const current = this.getLoopMode(guildId) || 'off';
        const idx = LOOP_MODES.indexOf(current);
        const next = LOOP_MODES[(idx + 1) % LOOP_MODES.length];
        return this.setLoopMode(guildId, next);
    }
    getQueueView(guildId) {
        const state = this.queues.get(guildId);
        if (!state) {
            return null;
        }
        return {
            current: state.currentVideo ? cloneTrack(state.currentVideo) : null,
            queue: state.queue.map(track => cloneTrack(track)),
            loopMode: state.loopMode || 'off',
            pendingVideoId: state.pendingVideoId || null
        };
    }
    /**
     * Snapshot for /nowplaying — includes timing info for progress bars.
     * Returns null when nothing is playing.
     */
    getNowPlaying(guildId) {
        const state = this.queues.get(guildId);
        if (!state || !state.currentVideo) {return null;}
        const startedAt = state.currentStartedAt || null;
        const elapsedMs = startedAt ? Math.max(0, Date.now() - startedAt) : null;
        return {
            track: cloneTrack(state.currentVideo),
            startedAt,
            elapsedMs,
            paused: state.player?.state?.status === AudioPlayerStatus.Paused,
            loopMode: state.loopMode || 'off',
            queueLength: state.queue.length
        };
    }
    /**
     * Clear the pending queue without touching the currently playing track.
     * Returns the number of tracks removed.
     */
    clearQueue(guildId) {
        const state = this.queues.get(guildId);
        if (!state) {return 0;}
        const removed = state.queue.length;
        state.queue = [];
        return removed;
    }
    showQueue(guildId) {
        const state = this.queues.get(guildId);
        if (!state) {
            return 'Queue is empty.';
        }
        const lines = [];
        if (state.currentVideo) {
            lines.push(`• Now playing: **${state.currentVideo.title}**`);
        }
        if (state.queue.length) {
            state.queue.forEach((track, index) => {
                lines.push(`${index + 1}. ${track.title}${track.duration ? ` - \`${track.duration}\`` : ''}`);
            });
        }
        lines.push(`• Loop: **${state.loopMode || 'off'}**`);
        return lines.length ? lines.join('\n') : 'Queue is empty.';
    }
    async createConnection(guildId, voiceChannel) {
        // Reusing a stale guild voice connection can leave audio receive broken
        // even though outbound playback still works. `/voice` fixes that by
        // destroying first, so match that behavior here.
        const existing = getVoiceConnection(guildId);
        if (existing) {
            try {
                existing.destroy();
            } catch (error) {
                console.warn('[Voice] Failed to destroy stale connection before music join:', error?.message || error);
            }
        }
        const buildConnection = () =>
            joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: voiceChannel.guild.id,
                adapterCreator: voiceChannel.guild.voiceAdapterCreator,
                selfDeaf: false,
                selfMute: false
            });
        let connection = null;
        let joined = false;
        let lastJoinError = null;
        for (let attempt = 1; attempt <= VOICE_JOIN_RETRIES; attempt += 1) {
            connection = buildConnection();
            try {
                await entersState(connection, VoiceConnectionStatus.Ready, VOICE_READY_TIMEOUT_MS);
                joined = true;
                if (attempt > 1) {
                    console.warn(`[Voice] Connected on retry ${attempt}/${VOICE_JOIN_RETRIES} for guild ${guildId}`);
                }
                break;
            } catch (error) {
                lastJoinError = error;
                console.warn(
                    `[Voice] Join attempt ${attempt}/${VOICE_JOIN_RETRIES} failed for guild ${guildId}:`,
                    error?.message || error
                );
                try {
                    connection.destroy();
                } catch (_e) { }
                if (attempt < VOICE_JOIN_RETRIES) {
                    await delay(VOICE_JOIN_RETRY_DELAY_MS * attempt);
                }
            }
        }
        if (!joined || !connection) {
            console.error('Failed to join voice channel:', lastJoinError);
            throw new Error('Unable to join the voice channel.');
        }
        let reconnectAttempts = 0;
        let recovering = false;
        let leaving = false;
        const notifyAndLeave = async message => {
            if (leaving) {
                return;
            }
            leaving = true;
            const state = this.queues.get(guildId);
            if (state?.connection === connection && state.textChannel && message) {
                await safeSend(state.textChannel, { content: message }, this.client).catch(() => { });
            }
            this.cleanup(guildId);
        };
        const attemptRecovery = async(trigger, closeCode = null) => {
            if (leaving || recovering) {
                return;
            }
            recovering = true;
            reconnectAttempts += 1;
            const attempt = reconnectAttempts;
            try {
                const state = this.queues.get(guildId);
                if (!state || state.connection !== connection) {
                    return;
                }
                // Never give up -- keep trying with capped backoff
                const delayMs = Math.min(VOICE_RECONNECT_DELAY_MS * attempt, 60_000);
                console.warn(
                    `[Voice] Recovery attempt ${attempt} for guild ${guildId} (trigger=${trigger}, code=${closeCode ?? 'n/a'}, next in ${delayMs}ms)`
                );
                await delay(delayMs);
                const liveState = this.queues.get(guildId);
                if (!liveState || liveState.connection !== connection || leaving) {
                    return;
                }

                // After 3 failed rejoins, rebuild the connection entirely.
                // rejoin() reuses the same (possibly dead) media server endpoint;
                // a fresh joinVoiceChannel() lets Discord assign a new one.
                if (attempt > 3) {
                    const voiceChannel = liveState.voiceChannelId
                        ? this.client.channels.cache.get(liveState.voiceChannelId)
                        : null;
                    if (voiceChannel) {
                        console.warn(`[Voice] Recovery rebuilding connection for guild ${guildId} (attempt ${attempt})`);
                        const newConnection = await this.createConnection(guildId, voiceChannel);
                        liveState.connection = newConnection;
                        if (liveState.player) {
                            this.safeSubscribe(newConnection, liveState.player);
                        }
                        reconnectAttempts = 0;
                        console.log(`[Voice] Recovery rebuilt connection for guild ${guildId}`);
                        return;
                    }
                }

                try {
                    connection.rejoin();
                } catch (_error) {
                    // Fall through and let entersState determine readiness.
                }
                await entersState(connection, VoiceConnectionStatus.Ready, VOICE_READY_TIMEOUT_MS);
                reconnectAttempts = 0;
                console.log(`[Voice] Recovered voice connection for guild ${guildId} after ${attempt} attempt(s)`);
            } catch (error) {
                console.warn(
                    `[Voice] Recovery attempt ${attempt} failed for guild ${guildId}:`,
                    error?.message || error
                );
            } finally {
                recovering = false;
            }
            const stateAfter = this.queues.get(guildId);
            if (
                !leaving &&
                stateAfter?.connection === connection &&
                connection.state.status === VoiceConnectionStatus.Disconnected
            ) {
                attemptRecovery('still-disconnected', closeCode).catch(() => { });
            }
        };
        connection.on('stateChange', (_, newState) => {
            if (newState.status === VoiceConnectionStatus.Ready) {
                reconnectAttempts = 0;
                const state = this.queues.get(guildId);
                if (state?.connection === connection && state.player) {
                    setImmediate(() => {
                        const latest = this.queues.get(guildId);
                        if (!latest || latest.connection !== connection || !latest.player) {
                            return;
                        }
                        try {
                            this.safeSubscribe(connection, latest.player);
                        } catch (error) {
                            console.warn('[Voice] Failed to resubscribe player on ready:', error?.message || error);
                        }
                    });
                }
                return;
            }
            if (newState.status === VoiceConnectionStatus.Disconnected) {
                const closeCode = extractVoiceCloseCode(newState);
                if (closeCode === 4017) {
                    console.error(
                        '[Voice] Disconnected with close code 4017 (DAVE required). ' +
                        'Voice library/runtime may be out of date for Discord E2EE.'
                    );
                    notifyAndLeave(
                        '⚠️ Voice session rejected (Discord close code 4017: DAVE/E2EE required). Please update voice runtime and try again.'
                    ).catch(() => { });
                    return;
                }
                attemptRecovery('disconnected', closeCode).catch(() => { });
            }
        });
        connection.on('error', error => {
            console.error('Voice connection error:', error);
            attemptRecovery('error').catch(() => { });
        });
        return connection;
    }
    createPlayer(guildId) {
        const player = createAudioPlayer({
            behaviors: {
                // Prevent silent "playing" when no voice subscriber is attached.
                noSubscriber: NoSubscriberBehavior.Pause
            }
        });
        player.on(AudioPlayerStatus.AutoPaused, () => {
            const state = this.queues.get(guildId);
            if (!state?.connection) {
                return;
            }
            if (state.voiceOverrideActive) {
                return;
            }
            try {
                this.safeSubscribe(state.connection, player);
                player.unpause();
            } catch (error) {
                console.warn('[Voice] Failed to recover from auto-paused state:', error?.message || error);
            }
        });
        player.on(AudioPlayerStatus.Idle, async() => {
            const state = this.queues.get(guildId);
            if (!state) {
                return;
            }
            if (state.skipInProgress) {
                state.skipInProgress = false;
            } else {
                const finishedTrack = cloneTrack(state.currentVideo);
                this.releaseCurrent(state);
                if (state.loopMode === 'queue' && finishedTrack) {
                    state.queue.push(finishedTrack);
                }
                if (state.loopMode === 'song' && finishedTrack) {
                    await this.play(guildId, finishedTrack, {
                        announce: 'silent',
                        queueAdvance: true
                    });
                    if (!state.currentVideo && state.queue.length > 0) {
                        await this.playNextAvailableFromQueue(guildId, state, { announce: 'channel' });
                    }
                    return;
                }
            }
            // Clear any existing timeout before deciding what to do
            if (state.timeout) {
                clearTimeout(state.timeout);
                state.timeout = null;
            }
            if (state.queue.length > 0) {
                await this.playNextAvailableFromQueue(guildId, state, { announce: 'channel' });
            }
        });
        player.on('error', error => {
            console.error('Audio player error:', error);
            const state = this.queues.get(guildId);
            if (state?.textChannel) {
                safeSend(state.textChannel, { content: '⚠️ Playback error.' }, this.client).catch(() => { });
            }
            // Stay connected -- try next track or idle in VC
            if (state) {
                this.releaseCurrent(state);
                if (state.queue.length > 0) {
                    this.playNextAvailableFromQueue(guildId, state, { announce: 'channel' }).catch(e => {
                        console.warn('[Voice] Failed to advance queue after player error:', e?.message || e);
                    });
                }
            }
        });
        return player;
    }
    safeSubscribe(connection, player) {
        if (!connection || !player) {
            return null;
        }
        const currentSubscription = connection.state?.subscription;
        const subscription =
            currentSubscription?.player === player
                ? currentSubscription
                : connection.subscribe(player);
        const status = player.state?.status;
        if (status === AudioPlayerStatus.AutoPaused || status === AudioPlayerStatus.Paused) {
            try {
                player.unpause();
            } catch (error) {
                console.warn('[Voice] Failed to unpause player after subscribe:', error?.message || error);
            }
        }
        return subscription;
    }
    async ensureVoiceReady(guildId, state) {
        if (!state?.connection) {
            throw new Error('Voice connection is not initialized.');
        }
        const connection = state.connection;
        for (let attempt = 1; attempt <= VOICE_ENSURE_READY_RETRIES; attempt += 1) {
            try {
                if (connection.state.status !== VoiceConnectionStatus.Ready) {
                    try {
                        connection.rejoin();
                    } catch (_e) { }
                    await entersState(connection, VoiceConnectionStatus.Ready, VOICE_READY_TIMEOUT_MS);
                }
                if (state.player) {
                    this.safeSubscribe(connection, state.player);
                }
                return;
            } catch (error) {
                console.warn(
                    `[Voice] ensure-ready attempt ${attempt}/${VOICE_ENSURE_READY_RETRIES} failed for guild ${guildId}:`,
                    error?.message || error
                );
                if (attempt < VOICE_ENSURE_READY_RETRIES) {
                    await delay(VOICE_JOIN_RETRY_DELAY_MS * attempt);
                }
            }
        }
        // All rejoin attempts failed — rebuild the connection from scratch.
        // This handles cases where the Discord media server is unreachable
        // (DNS failure, server rotation, etc.) and rejoin keeps hitting the dead endpoint.
        const voiceChannel = state.voiceChannelId
            ? this.client.channels.cache.get(state.voiceChannelId)
            : null;
        if (voiceChannel) {
            console.warn(`[Voice] Rebuilding connection for guild ${guildId} after ${VOICE_ENSURE_READY_RETRIES} failed rejoin attempts`);
            try {
                const newConnection = await this.createConnection(guildId, voiceChannel);
                state.connection = newConnection;
                if (state.player) {
                    this.safeSubscribe(newConnection, state.player);
                }
                return;
            } catch (rebuildError) {
                console.warn('[Voice] Connection rebuild also failed:', rebuildError?.message || rebuildError);
            }
        }
        throw new Error('Voice connection is unstable right now. Please try again in a few seconds.');
    }
    releaseCurrent(state) {
        if (state.currentRelease) {
            try {
                state.currentRelease();
            } catch (error) {
                console.warn('Failed to release cached audio:', error?.message || error);
            }
        }
        state.currentRelease = null;
        state.currentVideo = null;
        state.currentStartedAt = null;
    }
    cancelPendingDownload(state) {
        if (state.pendingVideoId) {
            cancelStream(state.pendingVideoId);
            state.pendingVideoId = null;
        }
    }
    cleanup(guildId) {
        const state = this.queues.get(guildId);
        if (!state) {
            return;
        }
        this.cancelPendingDownload(state);
        this.releaseCurrent(state);
        state.queue = [];
        state.loopMode = 'off';
        if (state.timeout) {
            clearTimeout(state.timeout);
            state.timeout = null;
        }
        try {
            state.player.stop(true);
        } catch (error) {
            console.warn('Failed to stop player:', error?.message || error);
        }
        try {
            state.connection.destroy();
        } catch (error) {
            console.warn('Failed to destroy connection:', error?.message || error);
        }
        this.queues.delete(guildId);
    }
}
let instance = null;
module.exports = {
    MusicManager,
    musicManager: {
        init(client) {
            if (!instance) {
                instance = new MusicManager(client);
            }
            return instance;
        },
        get() {
            if (!instance) {
                throw new Error('MusicManager not initialized. Call musicManager.init(client) first.');
            }
            return instance;
        }
    }
};

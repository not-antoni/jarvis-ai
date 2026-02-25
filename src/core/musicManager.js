const {
    joinVoiceChannel,
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

            connection.subscribe(player);

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

        const videoId = extractVideoId(video.url) ?? video.url;
        state.pendingVideoId = videoId;

        let streamResult;
        try {
            // Get stream directly - no download wait!
            streamResult = await getAudioStream(videoId, video.url);
            state.pendingVideoId = null;
        } catch (error) {
            state.pendingVideoId = null;
            if (error.message === 'Stream cancelled') {
                return null;
            }
            console.error('play-dl stream failed:', error.message);
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

            state.player.play(resource);
            state.currentVideo = video;
            state.currentRelease = streamResult.cleanup;

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

            if (state.textChannel) {
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
        try {
            const connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: voiceChannel.guild.id,
                adapterCreator: voiceChannel.guild.voiceAdapterCreator,
                selfDeaf: true
            });

            await entersState(connection, VoiceConnectionStatus.Ready, 20_000);

            connection.on('stateChange', (_, newState) => {
                if (newState.status === VoiceConnectionStatus.Disconnected) {
                    const closeCode = extractVoiceCloseCode(newState);
                    if (closeCode === 4017) {
                        console.error(
                            '[Voice] Disconnected with close code 4017 (DAVE required). ' +
                            'Voice library/runtime may be out of date for Discord E2EE.'
                        );
                    }
                    setTimeout(() => {
                        const state = this.queues.get(guildId);
                        if (
                            state?.connection === connection &&
                            newState.status === VoiceConnectionStatus.Disconnected
                        ) {
                            if (closeCode === 4017 && state.textChannel) {
                                safeSend(
                                    state.textChannel,
                                    {
                                        content:
                                            '⚠️ Voice session rejected (Discord close code 4017: DAVE/E2EE required). ' +
                                            'Please update voice runtime and try again.'
                                    },
                                    this.client
                                ).catch(() => { });
                            }
                            this.cleanup(guildId);
                        }
                    }, 5000);
                }
            });

            connection.on('error', error => {
                console.error('Voice connection error:', error);
                const state = this.queues.get(guildId);
                if (state?.textChannel) {
                    state.textChannel
                        .send('⚠️ Voice connection error, leaving channel.')
                        .catch(() => { });
                }
                this.cleanup(guildId);
            });

            return connection;
        } catch (error) {
            console.error('Failed to join voice channel:', error);
            throw new Error('Unable to join the voice channel.');
        }
    }

    createPlayer(guildId) {
        const player = createAudioPlayer({
            behaviors: {
                // Use Play instead of Pause to prevent audio interruptions during brief connection drops
                noSubscriber: NoSubscriberBehavior.Play
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
                        announce: 'channel',
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
            this.cleanup(guildId);
        });

        return player;
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

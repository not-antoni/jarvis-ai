const {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    NoSubscriberBehavior,
    VoiceConnectionStatus,
    entersState,
    StreamType
} = require('@discordjs/voice');
const { getAudioStream, cancelStream } = require('../utils/playDl');
const { extractVideoId } = require('../utils/youtube');
const { isGuildAllowed } = require('../utils/musicGuildWhitelist');
const { safeSend } = require('../utils/discord-safe-send');

const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

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
                voiceChannelId: null
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
            voiceChannelId: state.voiceChannelId || null
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
                voiceChannelId: voiceChannel.id
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
            const message = await this.play(guildId, video, { announce: 'command' });
            return message || `🎶 Now playing: **${video.title}**\n${video.url}`;
        }

        state.queue.push(video);
        return `🧃 Queued **${video.title}** (position ${state.queue.length})`;
    }

    async play(guildId, video, options = {}) {
        const announce = options.announce ?? 'command';
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
            return `⚠️ ${error.message || 'Unable to play that track right now, sir.'}`;
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

            const message = `🎶 Now playing: **${video.title}**\n${video.url}`;

            if (announce === 'command') {
                return message;
            }

            if (announce === 'channel' && state.textChannel) {
                safeSend(state.textChannel, { content: message }, this.client).catch(() => { });
            }
        } catch (error) {
            console.error('Music playback error:', error);
            streamResult.cleanup();

            const failureMessage = `⚠️ Could not play **${video.title}**.`;
            if (announce === 'command') {
                return failureMessage;
            }

            if (state.textChannel) {
                safeSend(state.textChannel, { content: failureMessage }, this.client).catch(() => { });
            }

            this.cleanup(guildId);
            return failureMessage;
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

        this.cancelPendingDownload(state);
        this.releaseCurrent(state);

        const upcoming = state.queue[0] ?? null;

        state.skipInProgress = true;
        state.player.stop(true);

        if (!upcoming) {
            this.cleanup(guildId);
            return '⏭️ Skipped — queue empty.';
        }

        return `⏭️ Skipping to **${upcoming.title}**…`;
    }

    stop(guildId) {
        const state = this.queues.get(guildId);
        if (!state) {
            return '⚠️ Nothing to stop, sir.';
        }

        // Clear timeout first to prevent race conditions
        if (state.timeout) {
            clearTimeout(state.timeout);
            state.timeout = null;
        }

        // Stop the player before cleanup to ensure it actually stops
        try {
            if (state.player) {
                state.player.stop(true);
            }
        } catch (e) {
            console.warn('Failed to stop player:', e?.message || e);
        }

        this.cleanup(guildId);
        return '🛑 Stopped playback and cleared queue.';
    }

    pause(guildId) {
        const state = this.queues.get(guildId);
        if (!state?.player) {
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
                lines.push(`${index + 1}. ${track.title}`);
            });
        }

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
                    setTimeout(() => {
                        const state = this.queues.get(guildId);
                        if (
                            state?.connection === connection &&
                            newState.status === VoiceConnectionStatus.Disconnected
                        ) {
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

        player.on(AudioPlayerStatus.Idle, async () => {
            const state = this.queues.get(guildId);
            if (!state) {
                return;
            }

            if (state.skipInProgress) {
                state.skipInProgress = false;
            } else {
                this.releaseCurrent(state);
            }

            // Clear any existing timeout before deciding what to do
            if (state.timeout) {
                clearTimeout(state.timeout);
                state.timeout = null;
            }

            if (state.queue.length > 0) {
                const next = state.queue.shift();
                await this.play(guildId, next, { announce: 'channel' });
            } else if (!state.currentVideo && !state.pendingVideoId) {
                // Only set inactivity timeout if truly idle (no current song, no pending, no queue)
                state.timeout = setTimeout(() => {
                    const queueState = this.queues.get(guildId);
                    // Double-check we're still idle before leaving
                    if (queueState && !queueState.currentVideo && !queueState.pendingVideoId && queueState.queue.length === 0) {
                        if (queueState.textChannel) {
                            queueState.textChannel
                                .send('⌛ Leaving voice channel due to inactivity.')
                                .catch(() => { });
                        }
                        this.cleanup(guildId);
                    }
                }, IDLE_TIMEOUT_MS);
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

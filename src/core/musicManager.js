const {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    NoSubscriberBehavior,
    VoiceConnectionStatus,
    entersState
} = require('@discordjs/voice');
const play = require('play-dl');

const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

class MusicManager {
    constructor() {
        this.queues = new Map(); // guildId -> state
    }

    getState(guildId) {
        return this.queues.get(guildId) ?? null;
    }

    async enqueue(guildId, voiceChannel, video, interaction) {
        let state = this.queues.get(guildId);

        if (!state) {
            const connection = await this.createConnection(guildId, voiceChannel);
            const player = this.createPlayer(guildId);

            connection.subscribe(player);

            state = {
                connection,
                player,
                queue: [],
                current: null,
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

        if (!state.current) {
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

        try {
            if (typeof play.is_expired === 'function' && typeof play.refreshToken === 'function') {
                try {
                    if (play.is_expired()) {
                        await play.refreshToken();
                    }
                } catch (tokenError) {
                    console.warn('play-dl token refresh skipped:', tokenError?.message || tokenError);
                }
            }

            const stream = await play.stream(video.url, { discordPlayerCompatibility: true });
            const resource = createAudioResource(stream.stream, { inputType: stream.type });

            state.player.play(resource);
            state.current = video;

            const message = `🎶 Now playing: **${video.title}**\n${video.url}`;

            if (announce === 'command') {
                return message;
            }

            if (announce === 'channel' && state.textChannel) {
                state.textChannel.send(message).catch(() => {});
            }
        } catch (error) {
            console.error('Music playback error:', error);
            const failureMessage = `⚠️ Could not play **${video.title}**.`;

            if (announce === 'command') {
                return failureMessage;
            }

            if (state.textChannel) {
                state.textChannel.send(failureMessage).catch(() => {});
            }

            this.cleanup(guildId);
        }
    }

    async skip(guildId) {
        const state = this.queues.get(guildId);
        if (!state || !state.player) {
            return '⚠️ Nothing is playing, sir.';
        }

        if (state.queue.length > 0) {
            const next = state.queue.shift();
            const message = await this.play(guildId, next, { announce: 'command' });
            return message || `🎶 Now playing: **${next.title}**`;
        }

        this.cleanup(guildId);
        return '⏭️ Skipped — queue empty.';
    }

    stop(guildId) {
        const state = this.queues.get(guildId);
        if (!state) {
            return '⚠️ Nothing to stop, sir.';
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

        if (state.current) {
            lines.push(`• Now playing: **${state.current.title}**`);
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
                        if (state?.connection === connection && newState.status === VoiceConnectionStatus.Disconnected) {
                            this.cleanup(guildId);
                        }
                    }, 5000);
                }
            });

            connection.on('error', error => {
                console.error('Voice connection error:', error);
                const state = this.queues.get(guildId);
                if (state?.textChannel) {
                    state.textChannel.send('⚠️ Voice connection error, leaving channel.').catch(() => {});
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
                noSubscriber: NoSubscriberBehavior.Pause
            }
        });

        player.on(AudioPlayerStatus.Idle, async () => {
            const state = this.queues.get(guildId);
            if (!state) {
                return;
            }

            state.current = null;

            if (state.queue.length > 0) {
                const next = state.queue.shift();
                await this.play(guildId, next, { announce: 'channel' });
            } else {
                state.timeout = setTimeout(() => {
                    if (this.queues.has(guildId)) {
                        const queueState = this.queues.get(guildId);
                        if (queueState?.textChannel) {
                            queueState.textChannel.send('⌛ Leaving voice channel due to inactivity.').catch(() => {});
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
                state.textChannel.send('⚠️ Playback error.').catch(() => {});
            }
            this.cleanup(guildId);
        });

        return player;
    }

    cleanup(guildId) {
        const state = this.queues.get(guildId);
        if (!state) {
            return;
        }

        state.queue = [];
        state.current = null;

        if (state.timeout) {
            clearTimeout(state.timeout);
        }

        try {
            state.player.stop();
        } catch (error) {
            console.error('Error stopping player:', error);
        }

        try {
            state.connection.destroy();
        } catch (error) {
            console.error('Error destroying connection:', error);
        }

        this.queues.delete(guildId);
    }
}

module.exports = {
    musicManager: new MusicManager()
};

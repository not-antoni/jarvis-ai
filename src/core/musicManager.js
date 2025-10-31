const fs = require('fs');
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
const { acquireAudio } = require('../utils/ytDlp');

const SETTINGS = Object.freeze({
    idleTimeoutMs: 5 * 60 * 1000,
    streamCacheTtlMs: 10 * 60 * 1000,
    retryDelaysMs: [500, 1500, 4000],
    cookieEnvKeys: [
        'YT_COOKIE',
        'YT_COOKIES',
        'YTDL_COOKIE',
        'YTDL_COOKIES',
        'YOUTUBE_COOKIE',
        'YOUTUBE_COOKIES'
    ],
    playerClients: [
        {
            name: 'ANDROID',
            key: 'AIzaSyA1bryuAMG9PG0t1gCFuQ8k0A4vTQ0nXJM',
            headers: {
                'User-Agent': 'com.google.android.youtube/19.44.38 (Linux; U; Android 11)',
                Origin: 'https://www.youtube.com'
            },
            payload: {
                clientName: 'ANDROID',
                clientVersion: '19.44.38',
                platform: 'MOBILE',
                osName: 'Android',
                osVersion: '11',
                androidSdkVersion: 30,
                hl: 'en',
                gl: 'US'
            }
        },
        {
            name: 'IOS',
            key: 'AIzaSyB9yMuPGcl021sZPX91CGqF2N8ttWhJS9g',
            headers: {
                'User-Agent': 'com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X; en_US)',
                Origin: 'https://www.youtube.com'
            },
            payload: {
                clientName: 'IOS',
                clientVersion: '19.45.4',
                deviceMake: 'Apple',
                deviceModel: 'iPhone16,2',
                platform: 'MOBILE',
                osName: 'IOS',
                osVersion: '17.5.1',
                hl: 'en',
                gl: 'US'
            }
        },
        {
            name: 'WEB',
            key: 'AIzaSyAOqaUZ5hYjDUwcZnAcsFYEs7f38nPhe8',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
                Origin: 'https://www.youtube.com'
            },
            payload: {
                clientName: 'WEB',
                clientVersion: '2.20241210.01.00',
                hl: 'en',
                gl: 'US',
                utcOffsetMinutes: 0
            }
        }
    ]
});

class MusicManager {
    constructor() {
        this.queues = new Map(); // guildId -> state
        this.streamCache = new Map(); // videoId -> { url, expiresAt, clientName }
        this.clientCursor = 0;
        this.rateLimitUntil = 0;
        this.cookieHeader = this.buildCookieHeaderFromEnv();
    }

    // Legacy helper retained for compatibility with older runtime references.
    buildCookieHeaderFromEnv() {
        return null;
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
                currentVideo: null,
                currentRelease: null,
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

        if (!state.currentVideo) {
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

        let ticket;
        try {
            const videoId = this.extractVideoId(video.url);
            ticket = await acquireAudio(videoId ?? video.url, video.url);
        } catch (error) {
            console.error('yt-dlp download failed:', error);
            return '⚠️ Unable to prepare that track right now, sir.';
        }

        try {
            const stream = fs.createReadStream(ticket.filePath);
            const resource = createAudioResource(stream, { inputType: StreamType.OggOpus });

            this.releaseCurrent(state);

            state.player.play(resource);
            state.currentVideo = video;
            state.currentRelease = ticket.release;

            const message = `🎶 Now playing: **${video.title}**\n${video.url}`;

            if (announce === 'command') {
                return message;
            }

            if (announce === 'channel' && state.textChannel) {
                state.textChannel.send(message).catch(() => {});
            }
        } catch (error) {
            console.error('Music playback error:', error);
            if (ticket) {
                ticket.release();
            }

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

    getStreamOptions(overrides = {}) {
        const mergedRequestOptions = {
            ...YTDL_BASE_OPTIONS.requestOptions,
            ...(overrides.requestOptions || {})
        };

        return {
            ...YTDL_BASE_OPTIONS,
            ...overrides,
            agent: this.youtubeAgent ?? undefined,
            requestOptions: mergedRequestOptions
        };
    }

    getInfoOptions(overrides = {}) {
        return {
            agent: this.youtubeAgent ?? undefined,
            requestOptions: {
                ...YTDL_BASE_OPTIONS.requestOptions,
                ...(overrides.requestOptions || {})
            },
            playerClients: YTDL_PLAYER_CLIENTS,
            ...overrides
        };
    }

    async createYouTubeStream(videoUrl) {
        const streamOptions = this.getStreamOptions();

        try {
            return await this.tryWithRetries(() => this.probeStream(() => ytdl(videoUrl, streamOptions)));
        } catch (error) {
            if (!this.isRecoverableYouTubeError(error)) {
                throw error;
            }

            return await this.tryWithRetries(async () => {
                const info = await ytdl.getInfo(videoUrl, this.getInfoOptions());

                const audioFormat = ytdl.chooseFormat(info.formats, {
                    quality: streamOptions.quality,
                    filter: streamOptions.filter
                });

                if (!audioFormat || !audioFormat.url) {
                    throw new Error('No suitable audio format found.');
                }

                return await this.probeStream(() =>
                    ytdl.downloadFromInfo(info, this.getStreamOptions({ format: audioFormat }))
                );
            });
        }
    }

    async probeStream(factory) {
        return new Promise((resolve, reject) => {
            let sourceStream;

            const finalize = () => {
                if (sourceStream) {
                    sourceStream.removeListener('error', handleError);
                }
            };

            const handleError = (error) => {
                finalize();
                if (sourceStream && typeof sourceStream.destroy === 'function') {
                    try {
                        sourceStream.destroy(error);
                    } catch (destroyError) {
                        console.error('Failed to destroy YouTube stream:', destroyError);
                    }
                }
                reject(error);
            };

            try {
                sourceStream = factory();
            } catch (factoryError) {
                reject(factoryError);
                return;
            }

            sourceStream.once('error', handleError);

            demuxProbe(sourceStream)
                .then(({ stream, type }) => {
                    finalize();
                    resolve({ stream, type });
                })
                .catch(handleError);
        });
    }

    isRecoverableYouTubeError(error) {
        if (!error) {
            return false;
        }

        if (typeof error.statusCode === 'number' && [403, 410, 429].includes(error.statusCode)) {
            return true;
        }

        const message = String(error.message || '').toLowerCase();
        return ['410', '403', '429', 'throttle', 'signature', 'error checking for updates'].some((token) =>
            message.includes(token)
        );
    }

    async tryWithRetries(factory, maxAttempts = RETRY_DELAYS_MS.length + 1) {
        let attempt = 0;
        let lastError;

        while (attempt < maxAttempts) {
            try {
                return await factory();
            } catch (error) {
                lastError = error;
                if (!this.isRecoverableYouTubeError(error) || attempt >= maxAttempts - 1) {
                    throw lastError;
                }

                const delayMs = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
                await this.wait(delayMs + Math.floor(Math.random() * 250));
                attempt += 1;
            }
        }

        throw lastError ?? new Error('Unknown YouTube streaming error.');
    }

    wait(ms) {
        if (ms <= 0) {
            return Promise.resolve();
        }

        return new Promise((resolve) => {
            setTimeout(resolve, ms);
        });
    }

    createYouTubeAgent() {
        const cookies = this.loadCookiesFromEnv();
        if (!cookies || cookies.length === 0) {
            return null;
        }

        try {
            return ytdl.createAgent(cookies);
        } catch (error) {
            console.warn('Failed to initialize YouTube cookie agent:', error?.message || error);
            return null;
        }
    }

    loadCookiesFromEnv() {
        for (const key of COOKIE_ENV_KEYS) {
            const rawValue = process.env[key];
            if (typeof rawValue !== 'string') {
                continue;
            }

            const trimmed = rawValue.trim();
            if (!trimmed.length) {
                continue;
            }

            const parsed = this.normalizeCookies(trimmed);
            if (parsed?.length) {
                return parsed;
            }
        }

        return null;
    }

    normalizeCookies(raw) {
        if (!raw) {
            return null;
        }

        if (raw.startsWith('[')) {
            try {
                const parsed = JSON.parse(raw);
                return this.normalizeCookieArray(parsed);
            } catch (error) {
                console.warn('Failed to parse JSON cookie string:', error?.message || error);
                return null;
            }
        }

        if (raw.startsWith('{')) {
            try {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed?.cookies)) {
                    return this.normalizeCookieArray(parsed.cookies);
                }
            } catch (error) {
                // fall back to legacy parsing below
            }
        }

        return this.convertLegacyCookieString(raw);
    }

    normalizeCookieArray(input) {
        if (!Array.isArray(input)) {
            return null;
        }

        const normalized = input
            .map((cookie) => {
                if (!cookie || typeof cookie !== 'object') {
                    return null;
                }

                const name = cookie.name ?? cookie.key;
                const value = cookie.value ?? cookie.val ?? cookie.content;

                if (!name || typeof value === 'undefined') {
                    return null;
                }

                return {
                    ...DEFAULT_COOKIE_TEMPLATE,
                    ...cookie,
                    name: String(name),
                    value: String(value)
                };
            })
            .filter(Boolean);

        return normalized.length ? normalized : null;
    }

    convertLegacyCookieString(raw) {
        const segments = raw
            .split(/;\s*/)
            .map((segment) => segment.trim())
            .filter(Boolean);

        if (!segments.length) {
            return null;
        }

        const cookies = segments
            .map((segment) => {
                const [namePart, ...valueParts] = segment.split('=');
                if (!namePart || valueParts.length === 0) {
                    return null;
                }

                const name = namePart.trim();
                const value = valueParts.join('=').trim();

                if (!name || !value) {
                    return null;
                }

                return {
                    ...DEFAULT_COOKIE_TEMPLATE,
                    name,
                    value
                };
            })
            .filter(Boolean);

        return cookies.length ? cookies : null;
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

            this.releaseCurrent(state);

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
                }, SETTINGS.idleTimeoutMs);
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

    cleanup(guildId) {
        const state = this.queues.get(guildId);
        if (!state) {
            return;
        }

        this.releaseCurrent(state);

        state.queue = [];

        if (state.timeout) {
            clearTimeout(state.timeout);
            state.timeout = null;
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

    extractVideoId(input) {
        if (!input) {
            return null;
        }

        const trimmed = String(input).trim();
        if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
            return trimmed;
        }

        let url;
        try {
            url = new URL(trimmed);
        } catch {
            return null;
        }

        if (url.hostname === 'youtu.be') {
            return url.pathname.slice(1);
        }

        if (url.searchParams.has('v')) {
            return url.searchParams.get('v');
        }

        const segments = url.pathname.split('/').filter(Boolean);
        if (segments[0] === 'shorts' && segments[1]) {
            return segments[1];
        }

        const last = segments[segments.length - 1];
        if (last && last.length === 11) {
            return last;
        }

        return null;
    }
}

module.exports = {
    musicManager: new MusicManager()
};

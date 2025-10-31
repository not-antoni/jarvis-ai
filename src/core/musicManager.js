process.env.YTDL_NO_UPDATE = process.env.YTDL_NO_UPDATE || '1';
if (typeof global.File === 'undefined') {
    global.File = class File {};
}

const COOKIE_ENV_KEYS = [
    'YT_COOKIE',
    'YTDL_COOKIE',
    'YTDL_COOKIES',
    'YOUTUBE_COOKIE',
    'YOUTUBE_COOKIES'
];
const DEFAULT_COOKIE_TEMPLATE = {
    domain: '.youtube.com',
    path: '/',
    secure: true,
    httpOnly: false,
    sameSite: 'no_restriction'
};

const {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    NoSubscriberBehavior,
    VoiceConnectionStatus,
    entersState,
    demuxProbe
} = require('@discordjs/voice');
const { request } = require('undici');

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
            const { stream, type } = await this.createYouTubeStream(video.url);
            const resource = createAudioResource(stream, { inputType: type });

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
            const isRateLimited = this.isRecoverableYouTubeError(error);

            if (isRateLimited) {
                this.rateLimitUntil = Date.now() + 15_000;
            }

            const failureMessage = isRateLimited
                ? '⚠️ YouTube is throttling requests right now. Please try again in a moment, sir.'
                : `⚠️ Could not play **${video.title}**.`;

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

    async createYouTubeStream(videoUrl) {
        const videoId = this.extractVideoId(videoUrl);
        if (!videoId) {
            throw new Error('Unable to determine video identifier, sir.');
        }

        const cached = this.streamCache.get(videoId);
        if (cached && cached.expiresAt > Date.now()) {
            const client = SETTINGS.playerClients.find(entry => entry.name === cached.clientName) ?? SETTINGS.playerClients[0];
            try {
                return await this.probeStream(() => this.requestStream(cached.url, client));
            } catch {
                this.streamCache.delete(videoId);
            }
        }

        if (this.rateLimitUntil > Date.now()) {
            await this.wait(this.rateLimitUntil - Date.now());
        }

        let lastError = null;
        const clientCount = SETTINGS.playerClients.length;

        for (let offset = 0; offset < clientCount; offset += 1) {
            const client = SETTINGS.playerClients[(this.clientCursor + offset) % clientCount];
            try {
                const response = await this.callPlayerApiWithRetries(videoId, client);
                const format = this.selectAudioFormat(response);

                if (!format) {
                    throw new Error('No audio formats available, sir.');
                }

                const streamUrl = this.resolveFormatUrl(format);
                if (!streamUrl) {
                    throw new Error('Unable to resolve audio stream url, sir.');
                }

                const { stream, type } = await this.probeStream(() => this.requestStream(streamUrl, client));

                this.streamCache.set(videoId, {
                    url: streamUrl,
                    clientName: client.name,
                    expiresAt: Date.now() + SETTINGS.streamCacheTtlMs
                });

                this.clientCursor = (this.clientCursor + offset) % clientCount;
                this.rateLimitUntil = 0;

                return { stream, type };
            } catch (error) {
                lastError = error;
                if (!this.isRecoverableYouTubeError(error)) {
                    break;
                }

                const delay = SETTINGS.retryDelaysMs[Math.min(offset, SETTINGS.retryDelaysMs.length - 1)];
                await this.wait(delay + Math.floor(Math.random() * 250));
            }
        }

        throw lastError ?? new Error('Unable to establish a YouTube audio stream, sir.');
    }

    async callPlayerApiWithRetries(videoId, client) {
        let attempt = 0;
        let lastError = null;

        while (attempt < SETTINGS.retryDelaysMs.length + 1) {
            try {
                return await this.callPlayerApi(videoId, client);
            } catch (error) {
                lastError = error;
                if (!this.isRecoverableYouTubeError(error) || attempt >= SETTINGS.retryDelaysMs.length) {
                    throw lastError;
                }

                const waitMs = SETTINGS.retryDelaysMs[attempt] + Math.floor(Math.random() * 250);
                await this.wait(waitMs);
                attempt += 1;
            }
        }

        throw lastError ?? new Error('Unable to reach YouTube player API, sir.');
    }

    async callPlayerApi(videoId, client) {
        const body = {
            context: {
                client: {
                    ...client.payload,
                    hl: client.payload.hl ?? 'en',
                    gl: client.payload.gl ?? 'US'
                },
                user: {
                    lockedSafetyMode: false
                },
                request: {
                    internalExperimentFlags: [],
                    useSsl: true
                }
            },
            videoId,
            playbackContext: {
                contentPlaybackContext: {
                    html5Preference: 'HTML5_PREF_WANTS'
                }
            },
            contentCheckOk: true,
            racyCheckOk: true
        };

        const response = await fetch(`https://youtubei.googleapis.com/youtubei/v1/player?key=${client.key}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': client.headers['User-Agent'],
                Origin: client.headers.Origin,
                Referer: client.headers.Origin,
                ...(this.cookieHeader ? { Cookie: this.cookieHeader } : {})
            },
            body: JSON.stringify(body)
        });

        if (response.status === 429) {
            const error = new Error('YouTube responded with HTTP 429.');
            error.statusCode = 429;
            throw error;
        }

        if (response.status >= 400) {
            const error = new Error(`YouTube returned HTTP ${response.status}.`);
            error.statusCode = response.status;
            throw error;
        }

        const payload = await response.json();
        const playabilityStatus = payload?.playabilityStatus?.status ?? 'OK';
        if (!['OK', 'LIVE_STREAM_OFFLINE'].includes(playabilityStatus)) {
            const reason = payload?.playabilityStatus?.reason || 'The requested video is unavailable, sir.';
            const error = new Error(reason);
            error.statusCode = response.status;
            throw error;
        }

        return payload;
    }

    selectAudioFormat(playerResponse) {
        const adaptiveFormats = playerResponse?.streamingData?.adaptiveFormats ?? [];
        const candidates = adaptiveFormats.filter(format => (format.mimeType || '').includes('audio/'));
        if (!candidates.length) {
            return null;
        }

        candidates.sort((a, b) => {
            const bitrateA = Number(a.averageBitrate ?? a.bitrate ?? 0);
            const bitrateB = Number(b.averageBitrate ?? b.bitrate ?? 0);
            return bitrateB - bitrateA;
        });

        return candidates.find(format => this.resolveFormatUrl(format)) ?? candidates[0];
    }

    resolveFormatUrl(format) {
        if (format?.url) {
            return format.url;
        }

        if (typeof format?.signatureCipher === 'string') {
            const params = new URLSearchParams(format.signatureCipher);
            const url = params.get('url');
            const sig = params.get('sig');
            const sp = params.get('sp') || 'signature';

            if (url && sig) {
                return `${url}&${sp}=${sig}`;
            }
        }

        return null;
    }

    async requestStream(streamUrl, client) {
        const { body, statusCode } = await request(streamUrl, {
            headers: {
                'User-Agent': client.headers['User-Agent'],
                Origin: client.headers.Origin,
                Referer: client.headers.Origin,
                Range: 'bytes=0-'
            }
        });

        if (statusCode >= 400) {
            try {
                body.resume();
            } catch {
                // ignore
            }

            const error = new Error(`YouTube stream responded with HTTP ${statusCode}.`);
            error.statusCode = statusCode;
            throw error;
        }

        return body;
    }

    async probeStream(factory) {
        return new Promise((resolve, reject) => {
            let sourceStream;

            const handleError = error => {
                if (sourceStream) {
                    sourceStream.removeListener('error', handleError);
                    try {
                        sourceStream.destroy(error);
                    } catch {
                        // ignore
                    }
                }
                reject(error);
            };

            try {
                sourceStream = factory();
            } catch (error) {
                return reject(error);
            }

            sourceStream.once('error', handleError);

            demuxProbe(sourceStream)
                .then(probed => {
                    sourceStream.removeListener('error', handleError);
                    resolve(probed);
                })
                .catch(handleError);
        });
    }

    isRecoverableYouTubeError(error) {
        if (!error) {
            return false;
        }

        if (error.statusCode && [403, 410, 429].includes(error.statusCode)) {
            return true;
        }

        const message = String(error.message || '').toLowerCase();
        return ['429', 'throttle', 'quota', 'too many', 'rate'].some(token => message.includes(token));
    }

    wait(ms) {
        if (!ms || ms <= 0) {
            return Promise.resolve();
        }

        return new Promise(resolve => {
            setTimeout(resolve, ms);
        });
    }

    extractVideoId(input) {
        if (!input) {
            return null;
        }

        const trimmed = input.trim();
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

        if (segments[segments.length - 1]?.length === 11) {
            return segments[segments.length - 1];
        }

        return null;
    }

    buildCookieHeaderFromEnv() {
        for (const key of SETTINGS.cookieEnvKeys) {
            const raw = process.env[key];
            if (!raw || typeof raw !== 'string') {
                continue;
            }

            const trimmed = raw.trim();
            if (!trimmed.length) {
                continue;
            }

            const normalised = this.normaliseCookies(trimmed);
            if (normalised && normalised.length) {
                return normalised.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
            }
        }

        return null;
    }

    normaliseCookies(raw) {
        if (raw.startsWith('[')) {
            try {
                const parsed = JSON.parse(raw);
                return this.normaliseCookieArray(parsed);
            } catch (error) {
                console.warn('Failed to parse cookie JSON:', error?.message || error);
                return null;
            }
        }

        if (raw.startsWith('{')) {
            try {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed?.cookies)) {
                    return this.normaliseCookieArray(parsed.cookies);
                }
            } catch (error) {
                console.warn('Failed to parse cookie object:', error?.message || error);
                return null;
            }
        }

        return raw
            .split(/;+/)
            .map(entry => entry.trim())
            .filter(Boolean)
            .map(entry => {
                const [name, ...valueParts] = entry.split('=');
                if (!name || valueParts.length === 0) {
                    return null;
                }
                return {
                    name: name.trim(),
                    value: valueParts.join('=').trim()
                };
            })
            .filter(Boolean);
    }

    normaliseCookieArray(cookies) {
        if (!Array.isArray(cookies)) {
            return null;
        }

        return cookies
            .map(cookie => {
                if (!cookie || typeof cookie !== 'object') {
                    return null;
                }

                const name = cookie.name ?? cookie.key;
                const value = cookie.value ?? cookie.val ?? cookie.content;
                if (!name || typeof value === 'undefined') {
                    return null;
                }

                return {
                    name: String(name),
                    value: String(value)
                };
            })
            .filter(Boolean);
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

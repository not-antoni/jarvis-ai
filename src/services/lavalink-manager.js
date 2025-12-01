'use strict';

/**
 * Lavalink Manager - Reliable music playback for selfhost
 * Uses Shoukaku for Lavalink v4 connection
 */

const { Shoukaku, Connectors } = require('shoukaku');

// Lavalink nodes configuration
const NODES = [
    {
        name: 'main',
        url: process.env.LAVALINK_HOST || 'localhost:2333',
        auth: process.env.LAVALINK_PASSWORD || 'youshallnotpass'
    }
];

// Shoukaku options
const SHOUKAKU_OPTIONS = {
    moveOnDisconnect: false,
    resumable: true,
    resumableTimeout: 60,
    reconnectTries: 3,
    restTimeout: 60000
};

class LavalinkManager {
    constructor() {
        this.shoukaku = null;
        this.client = null;
        this.queues = new Map(); // guildId -> { player, queue, current, textChannel }
        this.enabled = false;
    }

    /**
     * Initialize Lavalink connection
     * @param {Client} client - Discord.js client
     */
    initialize(client) {
        if (!process.env.LAVALINK_HOST && !process.env.LAVALINK_ENABLED) {
            console.log('Lavalink: Disabled (no LAVALINK_HOST configured)');
            return false;
        }

        this.client = client;
        this.shoukaku = new Shoukaku(new Connectors.DiscordJS(client), NODES, SHOUKAKU_OPTIONS);

        this.shoukaku.on('ready', (name) => {
            console.log(`Lavalink: Node ${name} connected`);
            this.enabled = true;
        });

        this.shoukaku.on('error', (name, error) => {
            console.error(`Lavalink: Node ${name} error:`, error.message);
        });

        this.shoukaku.on('close', (name, code, reason) => {
            console.warn(`Lavalink: Node ${name} closed (${code}): ${reason}`);
        });

        this.shoukaku.on('disconnect', (name, players, moved) => {
            if (moved) return;
            console.log(`Lavalink: Node ${name} disconnected, cleaning up ${players.size} players`);
            for (const [guildId] of players) {
                this.cleanup(guildId);
            }
        });

        console.log('Lavalink: Initializing connection...');
        return true;
    }

    /**
     * Check if Lavalink is available
     */
    isAvailable() {
        return this.enabled && this.shoukaku?.players !== undefined;
    }

    /**
     * Get the best available node
     */
    getNode() {
        const node = this.shoukaku?.options?.nodeResolver?.(this.shoukaku.nodes) 
            || this.shoukaku?.nodes?.values()?.next()?.value;
        return node;
    }

    /**
     * Search YouTube for tracks
     * @param {string} query - Search query
     * @returns {Promise<Array>} Search results
     */
    async search(query) {
        const node = this.getNode();
        if (!node) {
            throw new Error('No Lavalink nodes available');
        }

        // Determine if it's a URL or search query
        const isUrl = query.startsWith('http://') || query.startsWith('https://');
        const searchQuery = isUrl ? query : `ytsearch:${query}`;

        try {
            const result = await node.rest.resolve(searchQuery);
            
            if (!result || result.loadType === 'empty' || result.loadType === 'error') {
                return [];
            }

            if (result.loadType === 'playlist') {
                return result.data.tracks.slice(0, 10).map(track => ({
                    title: track.info.title,
                    author: track.info.author,
                    duration: track.info.length,
                    url: track.info.uri,
                    identifier: track.info.identifier,
                    track: track
                }));
            }

            // Single track or search results
            const tracks = result.data.tracks || [result.data];
            return tracks.slice(0, 10).map(track => ({
                title: track.info.title,
                author: track.info.author,
                duration: track.info.length,
                url: track.info.uri,
                identifier: track.info.identifier,
                track: track
            }));
        } catch (error) {
            console.error('Lavalink search error:', error.message);
            return [];
        }
    }

    /**
     * Play a track in a voice channel
     * @param {string} guildId 
     * @param {VoiceChannel} voiceChannel 
     * @param {Object} trackData 
     * @param {TextChannel} textChannel 
     */
    async play(guildId, voiceChannel, trackData, textChannel) {
        let state = this.queues.get(guildId);

        if (!state) {
            // Create new player
            const node = this.getNode();
            if (!node) {
                throw new Error('No Lavalink nodes available');
            }

            const player = await this.shoukaku.joinVoiceChannel({
                guildId: guildId,
                channelId: voiceChannel.id,
                shardId: 0,
                deaf: true
            });

            player.on('end', async (data) => {
                if (data.reason === 'replaced') return;
                
                const queueState = this.queues.get(guildId);
                if (!queueState) return;

                queueState.current = null;

                if (queueState.queue.length > 0) {
                    const next = queueState.queue.shift();
                    await this.playTrack(guildId, next);
                } else {
                    // Auto-disconnect after 5 minutes of inactivity
                    queueState.timeout = setTimeout(() => {
                        if (this.queues.has(guildId)) {
                            const s = this.queues.get(guildId);
                            if (s.textChannel) {
                                s.textChannel.send('⌛ Leaving voice channel due to inactivity.').catch(() => {});
                            }
                            this.cleanup(guildId);
                        }
                    }, 5 * 60 * 1000);
                }
            });

            player.on('exception', (error) => {
                console.error(`Lavalink player error in ${guildId}:`, error.message);
                const queueState = this.queues.get(guildId);
                if (queueState?.textChannel) {
                    queueState.textChannel.send('⚠️ Playback error occurred.').catch(() => {});
                }
            });

            state = {
                player,
                queue: [],
                current: null,
                textChannel,
                timeout: null
            };
            this.queues.set(guildId, state);
        }

        // Clear any pending timeout
        if (state.timeout) {
            clearTimeout(state.timeout);
            state.timeout = null;
        }

        state.textChannel = textChannel;

        // If nothing is playing, play immediately
        if (!state.current) {
            await this.playTrack(guildId, trackData);
            return `🎶 Now playing: **${trackData.title}**`;
        }

        // Add to queue
        state.queue.push(trackData);
        return `🧃 Queued **${trackData.title}** (position ${state.queue.length})`;
    }

    /**
     * Internal: Play a track
     */
    async playTrack(guildId, trackData) {
        const state = this.queues.get(guildId);
        if (!state) return;

        state.current = trackData;
        await state.player.playTrack({ track: trackData.track.encoded });

        if (state.textChannel && state.queue.length > 0) {
            state.textChannel.send(`🎶 Now playing: **${trackData.title}**`).catch(() => {});
        }
    }

    /**
     * Skip current track
     */
    async skip(guildId) {
        const state = this.queues.get(guildId);
        if (!state || !state.current) {
            return '⚠️ Nothing is playing, sir.';
        }

        const upcoming = state.queue[0];
        await state.player.stopTrack();

        if (!upcoming) {
            return '⏭️ Skipped — queue empty.';
        }
        return `⏭️ Skipping to **${upcoming.title}**…`;
    }

    /**
     * Pause playback
     */
    pause(guildId) {
        const state = this.queues.get(guildId);
        if (!state?.player) {
            return '⚠️ Nothing is playing, sir.';
        }
        state.player.setPaused(true);
        return '⏸️ Paused playback.';
    }

    /**
     * Resume playback
     */
    resume(guildId) {
        const state = this.queues.get(guildId);
        if (!state?.player) {
            return '⚠️ Nothing is playing, sir.';
        }
        state.player.setPaused(false);
        return '▶️ Resumed playback.';
    }

    /**
     * Stop and clear queue
     */
    stop(guildId) {
        const state = this.queues.get(guildId);
        if (!state) {
            return '⚠️ Nothing to stop, sir.';
        }
        this.cleanup(guildId);
        return '🛑 Stopped playback and cleared queue.';
    }

    /**
     * Get queue info
     */
    getQueue(guildId) {
        const state = this.queues.get(guildId);
        if (!state) return null;

        return {
            current: state.current,
            queue: state.queue,
            length: state.queue.length
        };
    }

    /**
     * Cleanup player and queue
     */
    cleanup(guildId) {
        const state = this.queues.get(guildId);
        if (!state) return;

        if (state.timeout) {
            clearTimeout(state.timeout);
        }

        try {
            this.shoukaku.leaveVoiceChannel(guildId);
        } catch (e) {
            // Ignore
        }

        this.queues.delete(guildId);
    }

    /**
     * Format duration from ms to mm:ss
     */
    formatDuration(ms) {
        const seconds = Math.floor(ms / 1000);
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }
}

// Singleton instance
const lavalinkManager = new LavalinkManager();

module.exports = { lavalinkManager };

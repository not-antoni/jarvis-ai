'use strict';

/**
 * Lavalink Manager using lavalink-client
 * Much simpler than Shoukaku with built-in queue
 */

const { LavalinkManager } = require('lavalink-client');

class LavalinkService {
    constructor() {
        this.manager = null;
        this.client = null;
        this.ready = false;
    }

    /**
     * Initialize Lavalink with Discord client
     */
    initialize(client) {
        if (!process.env.LAVALINK_HOST && !process.env.LAVALINK_ENABLED) {
            console.log('Lavalink: Disabled (no LAVALINK_HOST configured)');
            return false;
        }

        this.client = client;
        
        const [host, port] = (process.env.LAVALINK_HOST || 'localhost:2333').split(':');
        
        this.manager = new LavalinkManager({
            nodes: [{
                id: 'main',
                host: host,
                port: parseInt(port) || 2333,
                authorization: process.env.LAVALINK_PASSWORD || 'youshallnotpass'
            }],
            sendToShard: (guildId, payload) => {
                const guild = client.guilds.cache.get(guildId);
                if (guild) guild.shard.send(payload);
            },
            client: {
                id: client.user?.id,
                username: client.user?.username || 'Jarvis'
            },
            autoSkip: true,
            playerOptions: {
                defaultSearchPlatform: 'ytsearch',
                onDisconnect: {
                    autoReconnect: true,
                    destroyPlayer: false
                },
                onEmptyQueue: {
                    destroyAfterMs: 300000 // 5 minutes
                }
            }
        });

        // Handle raw gateway events
        client.on('raw', d => this.manager.sendRawData(d));

        const nodeManager = this.manager.nodeManager;
        if (nodeManager) {
            nodeManager.on('create', (node) => {
                console.log(`Lavalink: Node ${node.id} registered`);
            });

            nodeManager.on('connect', (node) => {
                console.log(`Lavalink: Node ${node.id} connected ✓`);
                this.ready = true;
            });

            nodeManager.on('disconnect', (node, reason) => {
                console.warn(`Lavalink: Node ${node.id} disconnected: ${reason?.message || reason}`);
                this.ready = this.hasConnectedNode();
            });

            nodeManager.on('reconnecting', (node) => {
                console.log(`Lavalink: Node ${node.id} reconnecting...`);
            });

            nodeManager.on('destroy', (node) => {
                console.warn(`Lavalink: Node ${node.id} destroyed`);
                this.ready = this.hasConnectedNode();
            });

            nodeManager.on('error', (node, error) => {
                console.error(`Lavalink: Node ${node.id} error:`, error?.message || error);
            });
        }

        this.manager.on('trackStart', (player, track) => {
            console.log(`Lavalink: Playing "${track.info.title}" in ${player.guildId}`);
        });

        console.log(`Lavalink: Connecting to ${host}:${port}...`);
        return true;
    }

    /**
     * Init the manager (call after Discord ready)
     */
    async init() {
        if (!this.manager || !this.client?.user) return false;
        
        try {
            await this.manager.init({
                id: this.client.user.id,
                username: this.client.user.username
            });
            console.log('Lavalink: Manager initialized');
            return true;
        } catch (error) {
            console.error('Lavalink: Init failed:', error.message);
            return false;
        }
    }

    /**
     * Check if ready
     */
    isAvailable() {
        return this.ready && this.hasConnectedNode();
    }

    /**
     * Check if any node is connected
     */
    hasConnectedNode() {
        const nodes = this.manager?.nodeManager?.nodes;
        if (!nodes || nodes.size === 0) return false;
        for (const node of nodes.values()) {
            if (node.connected) {
                return true;
            }
        }
        return false;
    }

    /**
     * Search YouTube
     */
    async search(query, limit = 10) {
        if (!this.isAvailable()) return [];

        try {
            const nodeManager = this.manager?.nodeManager;
            if (!nodeManager) {
                console.warn('[Lavalink][search] nodeManager not ready');
                return [];
            }

            const candidates = nodeManager.leastUsedNodes?.() || [];
            const node = candidates.find((n) => n.connected) || candidates[0];
            if (!node || !node.connected) return [];

            const isUrl = query.startsWith('http');
            const searchQuery = isUrl ? query : `ytsearch:${query}`;
            
            const baseUrl = `http://${node.options.host}:${node.options.port}`;
            const url = `${baseUrl}/v4/loadtracks?identifier=${encodeURIComponent(searchQuery)}`;
            const response = await fetch(url, {
                headers: {
                    Authorization: node.options.authorization || process.env.LAVALINK_PASSWORD || 'youshallnotpass'
                }
            });
            if (!response.ok) {
                console.error('[Lavalink][search] HTTP', response.status, response.statusText);
                return [];
            }
            const result = await response.json();
            console.log('[Lavalink][search]', { query: searchQuery, loadType: result?.loadType, trackCount: result?.tracks?.length });

            if (result.loadType === 'empty' || result.loadType === 'error' || !result.tracks?.length) {
                return [];
            }

            const tracks = result.loadType === 'playlist'
                ? result.tracks || []
                : result.tracks;

            return tracks.slice(0, limit).map(track => ({
                title: track.info.title,
                author: track.info.author,
                duration: track.info.length,
                url: track.info.uri,
                identifier: track.info.identifier,
                encoded: track.encoded,
                track: track
            }));
        } catch (error) {
            console.error('Lavalink search error:', error.message);
            return [];
        }
    }

    /**
     * Play a track
     */
    async play(guildId, voiceChannelId, textChannelId, trackData) {
        if (!this.isAvailable()) {
            throw new Error('Lavalink not available');
        }

        let player = this.manager.players.get(guildId);

        if (!player) {
            player = await this.manager.createPlayer({
                guildId,
                voiceChannelId,
                textChannelId,
                selfDeaf: true,
                volume: 100
            });
        }

        if (!player.connected) {
            await player.connect();
        }

        // Add to queue
        await player.queue.add(trackData.track);

        // Play if not playing
        if (!player.playing && !player.paused) {
            await player.play();
            return `🎶 Now playing: **${trackData.title}**`;
        }

        return `🧃 Queued: **${trackData.title}** (position ${player.queue.tracks.length})`;
    }

    /**
     * Skip track
     */
    async skip(guildId) {
        const player = this.manager?.players?.get(guildId);
        if (!player) return '⚠️ Nothing is playing.';

        await player.skip();
        return '⏭️ Skipped!';
    }

    /**
     * Pause
     */
    async pause(guildId) {
        const player = this.manager?.players?.get(guildId);
        if (!player) return '⚠️ Nothing is playing.';

        await player.pause();
        return '⏸️ Paused.';
    }

    /**
     * Resume
     */
    async resume(guildId) {
        const player = this.manager?.players?.get(guildId);
        if (!player) return '⚠️ Nothing is playing.';

        await player.resume();
        return '▶️ Resumed.';
    }

    /**
     * Stop and destroy player
     */
    async stop(guildId) {
        const player = this.manager?.players?.get(guildId);
        if (!player) return '⚠️ Nothing to stop.';

        await player.destroy();
        return '🛑 Stopped and cleared queue.';
    }

    /**
     * Get queue
     */
    getQueue(guildId) {
        const player = this.manager?.players?.get(guildId);
        if (!player) return null;

        return {
            current: player.queue.current ? {
                title: player.queue.current.info.title,
                author: player.queue.current.info.author,
                duration: player.queue.current.info.length
            } : null,
            tracks: player.queue.tracks.map(t => ({
                title: t.info.title,
                author: t.info.author,
                duration: t.info.length
            })),
            length: player.queue.tracks.length
        };
    }

    /**
     * Format duration
     */
    formatDuration(ms) {
        const seconds = Math.floor(ms / 1000);
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }
}

const lavalinkManager = new LavalinkService();

module.exports = { lavalinkManager };

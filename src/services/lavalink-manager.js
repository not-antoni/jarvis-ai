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
            console.log(`Lavalink: Track info - duration: ${track.info.length}ms, identifier: ${track.info.identifier}`);
        });

        this.manager.on('trackEnd', (player, track, reason) => {
            console.log(`Lavalink: Track ended "${track.info.title}" in ${player.guildId}, reason: ${reason}`);
        });

        this.manager.on('playerUpdate', (player, state) => {
            if (state) {
                console.log(`Lavalink: Player update in ${player.guildId}, playing: ${state.playing}, paused: ${state.paused}, position: ${state.position}ms, connected: ${player.connected}`);
            }
        });

        this.manager.on('playerException', (player, error) => {
            console.error(`Lavalink: Player exception in ${player.guildId}:`, error);
        });

        this.manager.on('playerDestroy', (player) => {
            console.log(`Lavalink: Player destroyed in ${player.guildId}`);
        });

        this.manager.on('playerCreate', (player) => {
            console.log(`Lavalink: Player created in ${player.guildId}, connected: ${player.connected}`);
        });

        this.manager.on('playerDestroy', (player) => {
            console.log(`Lavalink: Player destroyed in ${player.guildId}`);
        });

        this.manager.on('playerCreate', (player) => {
            console.log(`Lavalink: Player created in ${player.guildId}`);
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
            
            // Log full response for debugging
            console.log('[Lavalink][search] Full response:', JSON.stringify({
                loadType: result?.loadType,
                trackCount: result?.tracks?.length,
                dataCount: result?.data?.length,
                playlistInfo: result?.playlistInfo,
                hasTracks: !!result?.tracks,
                hasData: !!result?.data,
                tracksIsArray: Array.isArray(result?.tracks),
                dataIsArray: Array.isArray(result?.data),
                firstTrackSample: (result?.data?.[0] || result?.tracks?.[0]) ? {
                    hasInfo: !!(result.data?.[0] || result.tracks?.[0])?.info,
                    title: (result.data?.[0] || result.tracks?.[0])?.info?.title,
                    identifier: (result.data?.[0] || result.tracks?.[0])?.info?.identifier
                } : null
            }, null, 2));

            if (result.loadType === 'empty' || result.loadType === 'error') {
                console.warn('[Lavalink][search] Empty or error response:', result.loadType);
                return [];
            }

            // Handle different response types
            let tracks = [];
            if (result.loadType === 'search') {
                // Search response - tracks are in result.data (Lavalink v4)
                tracks = Array.isArray(result.data) ? result.data : [];
                console.log('[Lavalink][search] Search response, tracks count:', tracks.length);
            } else if (result.loadType === 'playlist') {
                // Playlist response - tracks are in result.tracks
                tracks = Array.isArray(result.tracks) ? result.tracks : [];
                console.log('[Lavalink][search] Playlist response, tracks count:', tracks.length);
            } else if (result.loadType === 'searchResult') {
                // Search result (older format)
                tracks = Array.isArray(result.tracks) ? result.tracks : [];
                console.log('[Lavalink][search] SearchResult response, tracks count:', tracks.length);
            } else if (result.loadType === 'track') {
                // Single track
                tracks = result.tracks ? [result.tracks] : [];
                console.log('[Lavalink][search] Track response, tracks count:', tracks.length);
            } else if (result.data && Array.isArray(result.data)) {
                // Fallback: check result.data
                tracks = result.data;
                console.log('[Lavalink][search] Fallback (data), tracks count:', tracks.length);
            } else if (result.tracks) {
                // Fallback: any response with tracks
                tracks = Array.isArray(result.tracks) ? result.tracks : (result.tracks ? [result.tracks] : []);
                console.log('[Lavalink][search] Fallback (tracks), tracks count:', tracks.length);
            } else {
                console.warn('[Lavalink][search] Unknown response type or no tracks:', result.loadType);
            }

            if (!tracks || tracks.length === 0) {
                console.warn('[Lavalink][search] No tracks found. Full response:', JSON.stringify(result, null, 2));
                return [];
            }

            console.log('[Lavalink][search] Successfully parsed', tracks.length, 'tracks');
            if (tracks[0]?.info) {
                console.log('[Lavalink][search] First track:', tracks[0].info.title);
            }

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

        // Get guild for REST API access
        const guild = this.client.guilds.cache.get(guildId);
        if (!guild) {
            throw new Error('Guild not found');
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

        // Connect to voice channel - lavalink-client handles this via gateway events
        if (!player.connected) {
            console.log('[Lavalink][play] Connecting to voice channel...');
            await player.connect();
            
            // Wait for connection with retries
            let connected = player.connected;
            for (let i = 0; i < 10 && !connected; i++) {
                await new Promise(resolve => setTimeout(resolve, 300));
                connected = player.connected;
            }
            console.log('[Lavalink][play] Connection status:', connected);
        } else {
            console.log('[Lavalink][play] Already connected');
        }

        // Add to queue - use the full track object
        const trackToAdd = trackData.track || trackData;
        console.log('[Lavalink][play] Adding track:', trackData.title, 'encoded:', !!trackToAdd.encoded);
        
        await player.queue.add(trackToAdd);

        // Play if not playing
        if (!player.playing && !player.paused) {
            console.log('[Lavalink][play] Starting playback, connected:', player.connected, 'queue length:', player.queue.tracks.length);
            await player.play();
            console.log('[Lavalink][play] Play called, player state - playing:', player.playing, 'paused:', player.paused);
            return `🎶 Now playing: **${trackData.title}**`;
        }

        console.log('[Lavalink][play] Already playing, queueing track. Queue position:', player.queue.tracks.length);
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

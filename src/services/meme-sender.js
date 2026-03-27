/**
 * Daily Meme Sender Service
 * Fetches memes from meme-api.com and sends them to a specific channel.
 */
class MemeSender {
    constructor() {
        this.interval = null;
        this.client = null;
        this.targetGuildId = process.env.MEME_GUILD_ID || '';
        this.targetChannelId = process.env.MEME_CHANNEL_ID || '';
        this.apiUrl = 'https://meme-api.com/gimme';
        this.hasWarnedMissingTarget = false;
        this.recentUrls = new Set(); // Track last 20 meme URLs to avoid duplicates
        this.maxRecent = 20;
        this.consecutiveFailures = 0;
        this.maxBackoffHours = 8;
    }

    /**
     * Start the meme scheduler
     * @param {import('discord.js').Client} client 
     */
    start(client) {
        this.client = client;
        console.log('[MemeSender] 🐸 Scheduler started (Every 1 hour)');

        // Run immediately on startup (for testing/gratification)
        this.sendMeme();

        // Schedule every 1 hour (3600000 ms), with backoff on failure
        this.interval = setInterval(() => {
            const backoffHours = Math.min(
                Math.pow(2, this.consecutiveFailures) - 1,
                this.maxBackoffHours - 1
            );
            if (backoffHours > 0 && this.consecutiveFailures > 0) {
                console.log(`[MemeSender] Backing off (${this.consecutiveFailures} failures), skipping this cycle`);
                this.consecutiveFailures--; // Decay toward retry
                return;
            }
            this.sendMeme();
        }, 1000 * 60 * 60);
        this.interval.unref();
    }

    stop() {
        if (this.interval) {clearInterval(this.interval);}
    }

    /**
     * Fetch a random meme
     */
    async fetchMeme() {
        try {
            const response = await fetch(this.apiUrl);
            if (!response.ok) {throw new Error(`API Error: ${response.statusText}`);}
            const data = await response.json();
            return data;
        } catch (error) {
            console.error('[MemeSender] Failed to fetch meme:', error);
            return null;
        }
    }

    /**
     * Send meme to the target channel
     */
    async sendMeme() {
        if (!this.client) {return;}
        if (!this.targetGuildId || !this.targetChannelId) {
            if (!this.hasWarnedMissingTarget) {
                console.warn('[MemeSender] MEME_GUILD_ID or MEME_CHANNEL_ID is not set; skipping.');
                this.hasWarnedMissingTarget = true;
            }
            return;
        }

        try {
            const guild = await this.client.guilds.fetch(this.targetGuildId).catch(() => null);
            if (!guild) {return console.warn(`[MemeSender] Target guild ${this.targetGuildId} not found`);}

            let channel = null;
            if (guild.channels?.fetch) {
                channel = await guild.channels.fetch(this.targetChannelId).catch(() => null);
            }
            if (!channel) {
                channel = await this.client.channels.fetch(this.targetChannelId).catch(() => null);
            }
            if (!channel) {return console.warn(`[MemeSender] Target channel ${this.targetChannelId} not found`);}
            if (channel.guildId && channel.guildId !== guild.id) {
                return console.warn(`[MemeSender] Target channel ${this.targetChannelId} does not belong to guild ${guild.id}`);
            }
            if (typeof channel.send !== 'function') {
                return console.warn(`[MemeSender] Target channel ${this.targetChannelId} is not a text channel`);
            }

            // Fetch meme (retry up to 3 times if we get a duplicate)
            let meme = null;
            for (let attempt = 0; attempt < 3; attempt++) {
                const candidate = await this.fetchMeme();
                if (!candidate) return;
                if (candidate.nsfw && channel.nsfw === false) continue;
                if (this.recentUrls.has(candidate.url)) continue;
                meme = candidate;
                break;
            }
            if (!meme) return;

            // Track URL to avoid sending the same meme again soon
            this.recentUrls.add(meme.url);
            if (this.recentUrls.size > this.maxRecent) {
                const oldest = this.recentUrls.values().next().value;
                this.recentUrls.delete(oldest);
            }

            // Send only the URL so Discord auto-embeds it cleanly
            await channel.send(meme.url);
            this.consecutiveFailures = 0;
            console.log(`[MemeSender] Sent meme "${meme.title}" to #${channel.name}`);

        } catch (error) {
            this.consecutiveFailures++;
            console.error(`[MemeSender] Error sending meme (failure #${this.consecutiveFailures}):`, error);
        }
    }
}

module.exports = new MemeSender();

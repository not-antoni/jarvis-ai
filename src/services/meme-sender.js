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

        // Schedule every 1 hour (3600000 ms)
        this.interval = setInterval(() => {
            this.sendMeme();
        }, 1000 * 60 * 60);
    }

    stop() {
        if (this.interval) clearInterval(this.interval);
    }

    /**
     * Fetch a random meme
     */
    async fetchMeme() {
        try {
            const response = await fetch(this.apiUrl);
            if (!response.ok) throw new Error(`API Error: ${response.statusText}`);
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
        if (!this.client) return;
        if (!this.targetGuildId || !this.targetChannelId) {
            if (!this.hasWarnedMissingTarget) {
                console.warn('[MemeSender] MEME_GUILD_ID or MEME_CHANNEL_ID is not set; skipping.');
                this.hasWarnedMissingTarget = true;
            }
            return;
        }

        try {
            const guild = await this.client.guilds.fetch(this.targetGuildId).catch(() => null);
            if (!guild) return console.warn(`[MemeSender] Target guild ${this.targetGuildId} not found`);

            let channel = null;
            if (guild.channels?.fetch) {
                channel = await guild.channels.fetch(this.targetChannelId).catch(() => null);
            }
            if (!channel) {
                channel = await this.client.channels.fetch(this.targetChannelId).catch(() => null);
            }
            if (!channel) return console.warn(`[MemeSender] Target channel ${this.targetChannelId} not found`);
            if (channel.guildId && channel.guildId !== guild.id) {
                return console.warn(`[MemeSender] Target channel ${this.targetChannelId} does not belong to guild ${guild.id}`);
            }
            if (typeof channel.send !== 'function') {
                return console.warn(`[MemeSender] Target channel ${this.targetChannelId} is not a text channel`);
            }

            // Fetch meme
            const meme = await this.fetchMeme();
            if (!meme) return;

            // NSFW Filter (Auto-skip NSFW if channel isn't NSFW)
            if (meme.nsfw && channel.nsfw === false) {
                console.log('[MemeSender] Skipped NSFW meme in SFW channel');
                return; // Retry logic could go here, but keep it simple for now
            }

            // Send only the URL so Discord auto-embeds it cleanly
            await channel.send(meme.url);
            console.log(`[MemeSender] Sent meme "${meme.title}" to #${channel.name}`);

        } catch (error) {
            console.error('[MemeSender] Error sending meme:', error);
        }
    }
}

module.exports = new MemeSender();

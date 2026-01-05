/**
 * Upload Queue Service
 * Processes file uploads one at a time to prevent bot overload
 * When many users upload simultaneously, they get queued and processed sequentially
 */
const distube = require('./distube');

class UploadQueue {
    constructor() {
        this.queue = []; // { guildId, voiceChannel, fileUrl, filename, member, textChannel, interaction, addedAt }
        this.processing = false;
        this.guildQueues = new Map(); // guildId -> [...items] for per-guild tracking
    }

    /**
     * Add an upload to the queue
     * @returns {number} Position in queue (1 = next up)
     */
    add(guildId, voiceChannel, fileUrl, filename, member, textChannel, interaction) {
        const item = {
            guildId,
            voiceChannel,
            fileUrl,
            filename,
            member,
            textChannel,
            interaction,
            addedAt: Date.now()
        };

        this.queue.push(item);

        // Track per-guild for position info
        if (!this.guildQueues.has(guildId)) {
            this.guildQueues.set(guildId, []);
        }
        this.guildQueues.get(guildId).push(item);

        const position = this.queue.length;
        console.log(`[UploadQueue] Added: ${filename} (Position: ${position}, Guild: ${guildId})`);

        // Start processing if not already
        if (!this.processing) {
            this.processNext();
        }

        return position;
    }

    /**
     * Get queue position for a guild
     */
    getGuildQueueLength(guildId) {
        return this.guildQueues.get(guildId)?.length || 0;
    }

    /**
     * Process the next item in the queue
     */
    async processNext() {
        if (this.queue.length === 0) {
            this.processing = false;
            return;
        }

        this.processing = true;
        const item = this.queue.shift();

        // Remove from guild queue tracking
        const guildQueue = this.guildQueues.get(item.guildId);
        if (guildQueue) {
            const idx = guildQueue.indexOf(item);
            if (idx > -1) guildQueue.splice(idx, 1);
            if (guildQueue.length === 0) this.guildQueues.delete(item.guildId);
        }

        console.log(`[UploadQueue] Processing: ${item.filename} (Remaining: ${this.queue.length})`);

        try {
            const distubeInstance = distube.get();

            await distubeInstance.play(item.voiceChannel, item.fileUrl, {
                member: item.member,
                textChannel: item.textChannel,
                metadata: {
                    originalInteraction: item.interaction,
                    isUpload: true,
                    filename: item.filename
                }
            });

            console.log(`[UploadQueue] Success: ${item.filename}`);

        } catch (e) {
            console.error(`[UploadQueue] Failed: ${item.filename}`, e.message);

            // Notify user of failure
            try {
                await item.textChannel.send(`❌ Failed to process upload **${item.filename}**: ${e.message?.slice(0, 100) || 'Unknown error'}`);
            } catch (notifyErr) {
                // Ignore notification errors
            }
        }

        // Small delay between processing to be gentle on resources
        setTimeout(() => this.processNext(), 500);
    }

    /**
     * Get overall queue stats
     */
    getStats() {
        return {
            queueLength: this.queue.length,
            isProcessing: this.processing,
            guildsWithUploads: this.guildQueues.size
        };
    }
}

// Singleton instance
const uploadQueue = new UploadQueue();

module.exports = uploadQueue;

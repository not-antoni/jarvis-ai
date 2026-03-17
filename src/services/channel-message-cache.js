'use strict';

/**
 * Channel Message Cache - Store last N messages per channel in-memory
 * FIX for missing channel context that was causing hallucinations
 *
 * This caches messages to provide proper channel-specific context
 * instead of relying only on user memories
 */

const MAX_MESSAGES_PER_CHANNEL = 20;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Main cache: channelId -> {messages: [], createdAt}
const channelCache = new Map();

// Track per-guild cleanup to handle guild deletions
const guildChannels = new Map(); // guildId -> Set<channelId>

/**
 * Add a message to the channel cache
 */
function addMessage(channelId, guildId, message) {
    if (!channelId || !message) return;

    // Track channel for guild
    if (guildId) {
        if (!guildChannels.has(guildId)) {
            guildChannels.set(guildId, new Set());
        }
        guildChannels.get(guildId).add(channelId);
    }

    // Get or create channel cache
    if (!channelCache.has(channelId)) {
        channelCache.set(channelId, {
            messages: [],
            createdAt: Date.now(),
            guildId
        });
    }

    const cache = channelCache.get(channelId);

    // Add message to front (newest first)
    const messageEntry = {
        id: message.id || Math.random().toString(36),
        author: message.author?.username || 'Unknown',
        authorId: message.author?.id,
        content: (message.content || '').slice(0, 500),
        isBot: message.author?.bot || false,
        timestamp: message.createdTimestamp || Date.now()
    };

    cache.messages.unshift(messageEntry);

    // Keep only last MAX_MESSAGES_PER_CHANNEL
    if (cache.messages.length > MAX_MESSAGES_PER_CHANNEL) {
        cache.messages = cache.messages.slice(0, MAX_MESSAGES_PER_CHANNEL);
    }
}

/**
 * Get recent messages for a channel
 * Returns last N messages in chronological order (oldest first)
 */
function getMessages(channelId, limit = 10) {
    const cache = channelCache.get(channelId);
    if (!cache) return [];

    // Return in chronological order (oldest first)
    return cache.messages.slice(0, limit).reverse();
}

/**
 * Get formatted context block for prompt injection
 */
function getContextBlock(channelId, limit = 10) {
    const messages = getMessages(channelId, limit);
    if (messages.length === 0) {
        return '[CHANNEL_CONTEXT]\n[NO MESSAGE HISTORY]\n[/CHANNEL_CONTEXT]';
    }

    const contextLines = messages
        .map((msg, idx) => {
            const author = msg.isBot ? `${msg.author}[BOT]` : msg.author;
            const content = msg.content.slice(0, 300);
            return `[MSG_${idx + 1}] ${author}: "${content}"`;
        })
        .join('\n');

    return `[CHANNEL_CONTEXT]\n${contextLines}\n[/CHANNEL_CONTEXT]`;
}

/**
 * Clear all messages for a channel
 */
function clearChannel(channelId) {
    channelCache.delete(channelId);
}

/**
 * Clear all messages for a guild (on guild delete)
 */
function clearGuild(guildId) {
    const channels = guildChannels.get(guildId);
    if (!channels) return;

    for (const channelId of channels) {
        channelCache.delete(channelId);
    }

    guildChannels.delete(guildId);
}

/**
 * Get cache statistics for monitoring
 */
function getStats() {
    let totalMessages = 0;
    let totalChannels = 0;
    const totalGuilds = guildChannels.size;

    for (const cache of channelCache.values()) {
        totalMessages += cache.messages.length;
        totalChannels++;
    }

    return {
        totalChannels,
        totalMessages,
        totalGuilds,
        avgMessagesPerChannel: totalChannels > 0 ? Math.round(totalMessages / totalChannels) : 0
    };
}

/**
 * Clean up expired cache entries (optional, runs periodically)
 */
function cleanup() {
    const now = Date.now();
    let removed = 0;

    for (const [channelId, cache] of channelCache.entries()) {
        // remove channels not accessed in 24 hours
        if (now - cache.createdAt > CACHE_TTL_MS) {
            channelCache.delete(channelId);
            removed++;
        }
    }

    if (removed > 0) {
        console.log(`[ChannelCache] Cleaned up ${removed} expired channels`);
    }
}

// run cleanup every 6 hours
setInterval(cleanup, 6 * 60 * 60 * 1000).unref?.();

module.exports = {
    addMessage,
    getMessages,
    getContextBlock,
    clearChannel,
    clearGuild,
    getStats
};


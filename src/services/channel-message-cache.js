'use strict';

const MAX_INTERACTIONS_PER_USER = 20;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

const userCache = new Map();


function addMessage(channelId, guildId, message) {
    if (!channelId || !message) return;

    const userId = message.author?.id;
    if (!userId) return;

    // Only record the user's own messages and Jarvis responses to them
    // Don't record other users' messages (privacy)
    if (!message.author?.id) return;

    // Get or create user cache
    if (!userCache.has(userId)) {
        userCache.set(userId, {
            interactions: [],
            createdAt: Date.now(),
            userId
        });
    }

    const cache = userCache.get(userId);

    // Add message to front (newest first)
    const messageEntry = {
        id: message.id || Math.random().toString(36),
        author: message.author?.username || 'Unknown',
        authorId: message.author?.id,
        content: (message.content || '').slice(0, 500),
        isBot: message.author?.bot || false,
        timestamp: message.createdTimestamp || Date.now(),
        channelId,
        guildId
    };

    cache.interactions.unshift(messageEntry);

    // Keep only last MAX_INTERACTIONS_PER_USER
    if (cache.interactions.length > MAX_INTERACTIONS_PER_USER) {
        cache.interactions = cache.interactions.slice(0, MAX_INTERACTIONS_PER_USER);
    }
}

function getMessages(userId, limit = 10) {
    if (!userId) return [];

    const cache = userCache.get(userId);
    if (!cache) return [];

    // Return in chronological order (oldest first)
    return cache.interactions.slice(0, limit).reverse();
}

function getContextBlock(userId, limit = 10) {
    const messages = getMessages(userId, limit);
    if (messages.length === 0) {
        return '[USER_CONTEXT]\n[NO RECENT INTERACTIONS]\n[/USER_CONTEXT]';
    }

    const contextLines = messages
        .map((msg, idx) => {
            const author = msg.isBot ? `Jarvis[BOT]` : msg.author;
            const content = msg.content.slice(0, 300);
            return `[INTERACTION_${idx + 1}] ${author}: "${content}"`;
        })
        .join('\n');

    return `[USER_CONTEXT]\n${contextLines}\n[/USER_CONTEXT]`;
}

function clearUser(userId) {
    if (!userId) return;
    userCache.delete(userId);
}

function clearAll() {
    userCache.clear();
}


function getStats() {
    let totalInteractions = 0;
    let totalUsers = userCache.size;

    for (const cache of userCache.values()) {
        totalInteractions += cache.interactions.length;
    }

    return {
        totalUsers,
        totalInteractions,
        avgInteractionsPerUser: totalUsers > 0 ? Math.round(totalInteractions / totalUsers) : 0
    };
}


function cleanup() {
    const now = Date.now();
    let removed = 0;

    for (const [userId, cache] of userCache.entries()) {
        // Remove user caches not accessed in 24 hours
        if (now - cache.createdAt > CACHE_TTL_MS) {
            userCache.delete(userId);
            removed++;
        }
    }

    if (removed > 0) {
        console.log(`[UserContext] Cleaned up ${removed} expired user caches`);
    }
}

// run cleanup every 6 hours
setInterval(cleanup, 6 * 60 * 60 * 1000).unref?.();

module.exports = {
    addMessage,
    getMessages,
    getContextBlock,
    clearUser,
    clearAll,
    getStats
};


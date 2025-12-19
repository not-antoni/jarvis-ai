'use strict';

/**
 * API Keys Service
 * Manages API key generation, validation, and tracking for the Jarvis public API
 */

const crypto = require('crypto');

const COLLECTION_NAME = 'api_keys';
const API_LOGS_COLLECTION = 'api_request_logs';
const MAX_KEYS_PER_USER = 5;
const KEY_PREFIX = 'jv-';
const KEY_LENGTH = 32;

// Rate limiting: requests per minute per key
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 60;

// In-memory rate limit tracking
const rateLimitMap = new Map();

// Suspicious activity thresholds
const SUSPICIOUS_REQUESTS_PER_MINUTE = 100;
const SUSPICIOUS_ERRORS_PER_MINUTE = 20;

let database = null;
let discordClient = null;
let ownerUserId = null;

/**
 * Initialize the API keys service
 */
function init(db, client, ownerId) {
    database = db;
    discordClient = client;
    ownerUserId = ownerId || process.env.OWNER_ID || process.env.DISCORD_OWNER_ID;
}

/**
 * Get the API keys collection
 */
function getCollection() {
    if (!database || !database.isConnected || !database.db) {
        return null;
    }
    return database.db.collection(COLLECTION_NAME);
}

/**
 * Get the API logs collection
 */
function getLogsCollection() {
    if (!database || !database.isConnected || !database.db) {
        return null;
    }
    return database.db.collection(API_LOGS_COLLECTION);
}

/**
 * Generate a secure random API key
 */
function generateKey() {
    const randomBytes = crypto.randomBytes(KEY_LENGTH);
    const key = randomBytes.toString('base64url').slice(0, KEY_LENGTH);
    return `${KEY_PREFIX}${key}`;
}

/**
 * Hash a key for storage (we store hashed keys for security)
 */
function hashKey(key) {
    return crypto.createHash('sha256').update(key).digest('hex');
}

/**
 * Create a new API key for a user
 */
async function createKey(userId, keyName = 'Default') {
    const collection = getCollection();
    if (!collection) {
        throw new Error('Database not available');
    }

    // Check existing keys count
    const userDoc = await collection.findOne({ userId });
    const existingKeys = userDoc?.keys || [];
    
    if (existingKeys.length >= MAX_KEYS_PER_USER) {
        throw new Error(`Maximum ${MAX_KEYS_PER_USER} API keys allowed per user`);
    }

    // Generate new key
    const plainKey = generateKey();
    const hashedKey = hashKey(plainKey);
    const keyId = crypto.randomBytes(8).toString('hex');

    const newKey = {
        id: keyId,
        keyHash: hashedKey,
        keyPreview: plainKey.slice(0, 8) + '...' + plainKey.slice(-4),
        name: keyName.slice(0, 50),
        createdAt: new Date(),
        lastUsedAt: null,
        requestCount: 0,
        isActive: true
    };

    await collection.updateOne(
        { userId },
        { 
            $push: { keys: newKey },
            $setOnInsert: { userId, createdAt: new Date() }
        },
        { upsert: true }
    );

    // Return the plain key (only time it's visible)
    return {
        id: keyId,
        key: plainKey,
        name: newKey.name,
        createdAt: newKey.createdAt
    };
}

/**
 * Get all keys for a user (without the actual key values)
 */
async function getUserKeys(userId) {
    const collection = getCollection();
    if (!collection) {
        return [];
    }

    const userDoc = await collection.findOne({ userId });
    if (!userDoc || !userDoc.keys) {
        return [];
    }

    return userDoc.keys.map(k => ({
        id: k.id,
        name: k.name,
        keyPreview: k.keyPreview,
        createdAt: k.createdAt,
        lastUsedAt: k.lastUsedAt,
        requestCount: k.requestCount,
        isActive: k.isActive
    }));
}

/**
 * Revoke (delete) an API key
 */
async function revokeKey(userId, keyId) {
    const collection = getCollection();
    if (!collection) {
        throw new Error('Database not available');
    }

    const result = await collection.updateOne(
        { userId },
        { $pull: { keys: { id: keyId } } }
    );

    return result.modifiedCount > 0;
}

/**
 * Validate an API key and return the user info
 */
async function validateKey(plainKey) {
    if (!plainKey || !plainKey.startsWith(KEY_PREFIX)) {
        return null;
    }

    const collection = getCollection();
    if (!collection) {
        return null;
    }

    const hashedKey = hashKey(plainKey);
    
    // Find user with this key
    const userDoc = await collection.findOne({
        'keys.keyHash': hashedKey,
        'keys.isActive': true
    });

    if (!userDoc) {
        return null;
    }

    const key = userDoc.keys.find(k => k.keyHash === hashedKey && k.isActive);
    if (!key) {
        return null;
    }

    // Update last used
    await collection.updateOne(
        { userId: userDoc.userId, 'keys.id': key.id },
        { 
            $set: { 'keys.$.lastUsedAt': new Date() },
            $inc: { 'keys.$.requestCount': 1 }
        }
    );

    return {
        userId: userDoc.userId,
        keyId: key.id,
        keyName: key.name
    };
}

/**
 * Check rate limit for a key
 */
function checkRateLimit(keyId) {
    const now = Date.now();
    const windowStart = now - RATE_LIMIT_WINDOW_MS;

    let record = rateLimitMap.get(keyId);
    if (!record) {
        record = { requests: [], errors: [] };
        rateLimitMap.set(keyId, record);
    }

    // Clean old requests
    record.requests = record.requests.filter(t => t > windowStart);
    record.errors = record.errors.filter(t => t > windowStart);

    if (record.requests.length >= RATE_LIMIT_MAX_REQUESTS) {
        return {
            allowed: false,
            remaining: 0,
            resetAt: Math.min(...record.requests) + RATE_LIMIT_WINDOW_MS
        };
    }

    record.requests.push(now);

    return {
        allowed: true,
        remaining: RATE_LIMIT_MAX_REQUESTS - record.requests.length,
        resetAt: now + RATE_LIMIT_WINDOW_MS
    };
}

/**
 * Record an error for rate limiting tracking
 */
function recordError(keyId) {
    const record = rateLimitMap.get(keyId);
    if (record) {
        record.errors.push(Date.now());
    }
}

/**
 * Log an API request
 */
async function logRequest(data) {
    const collection = getLogsCollection();
    if (!collection) {
        return;
    }

    const logEntry = {
        userId: data.userId,
        keyId: data.keyId,
        endpoint: data.endpoint,
        method: data.method,
        ip: data.ip,
        userAgent: data.userAgent,
        country: data.country,
        city: data.city,
        isp: data.isp,
        statusCode: data.statusCode,
        responseTime: data.responseTime,
        tokensUsed: data.tokensUsed || 0,
        timestamp: new Date(),
        suspicious: data.suspicious || false
    };

    try {
        await collection.insertOne(logEntry);
    } catch (err) {
        console.error('[APIKeys] Failed to log request:', err.message);
    }

    // Check for suspicious activity
    await checkSuspiciousActivity(data.keyId, data.userId, data.ip);
}

/**
 * Get IP geolocation info using free service
 */
async function getIpInfo(ip) {
    // Skip for local/private IPs
    if (!ip || ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
        return { country: 'Local', city: 'Local', isp: 'Local' };
    }

    try {
        // Using ip-api.com (free, no API key needed, 45 req/min limit)
        const response = await fetch(`http://ip-api.com/json/${ip}?fields=status,country,city,isp,proxy,hosting`);
        if (response.ok) {
            const data = await response.json();
            if (data.status === 'success') {
                return {
                    country: data.country || 'Unknown',
                    city: data.city || 'Unknown',
                    isp: data.isp || 'Unknown',
                    isProxy: data.proxy || false,
                    isHosting: data.hosting || false
                };
            }
        }
    } catch (err) {
        // Silently fail
    }

    return { country: 'Unknown', city: 'Unknown', isp: 'Unknown' };
}

/**
 * Check for suspicious activity and notify owner
 */
async function checkSuspiciousActivity(keyId, userId, ip) {
    const record = rateLimitMap.get(keyId);
    if (!record) {
        return;
    }

    const now = Date.now();
    const windowStart = now - RATE_LIMIT_WINDOW_MS;
    const recentRequests = record.requests.filter(t => t > windowStart).length;
    const recentErrors = record.errors.filter(t => t > windowStart).length;

    let suspicious = false;
    let reason = '';

    if (recentRequests > SUSPICIOUS_REQUESTS_PER_MINUTE) {
        suspicious = true;
        reason = `High request volume: ${recentRequests} requests/min`;
    } else if (recentErrors > SUSPICIOUS_ERRORS_PER_MINUTE) {
        suspicious = true;
        reason = `High error rate: ${recentErrors} errors/min`;
    }

    if (suspicious) {
        await notifyOwner(userId, keyId, ip, reason);
    }
}

/**
 * Send DM notification to owner about suspicious activity
 */
async function notifyOwner(userId, keyId, ip, reason) {
    if (!discordClient || !ownerUserId) {
        return;
    }

    try {
        const owner = await discordClient.users.fetch(ownerUserId);
        if (!owner) {
            return;
        }

        const ipInfo = await getIpInfo(ip);
        
        const message = `🚨 **Suspicious API Activity Detected**\n\n` +
            `**User ID:** ${userId}\n` +
            `**Key ID:** ${keyId}\n` +
            `**IP:** ${ip}\n` +
            `**Location:** ${ipInfo.city}, ${ipInfo.country}\n` +
            `**ISP:** ${ipInfo.isp}\n` +
            `**Reason:** ${reason}\n` +
            `**Time:** ${new Date().toISOString()}`;

        await owner.send(message);
        console.log(`[APIKeys] Sent suspicious activity alert to owner`);
    } catch (err) {
        console.error('[APIKeys] Failed to notify owner:', err.message);
    }
}

/**
 * Get API usage stats for admin dashboard
 */
async function getUsageStats(options = {}) {
    const collection = getLogsCollection();
    if (!collection) {
        return null;
    }

    const { days = 7, limit = 100 } = options;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    try {
        // Total requests
        const totalRequests = await collection.countDocuments({ timestamp: { $gte: since } });
        
        // Requests by endpoint
        const byEndpoint = await collection.aggregate([
            { $match: { timestamp: { $gte: since } } },
            { $group: { _id: '$endpoint', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 10 }
        ]).toArray();

        // Requests by country
        const byCountry = await collection.aggregate([
            { $match: { timestamp: { $gte: since } } },
            { $group: { _id: '$country', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 10 }
        ]).toArray();

        // Recent requests
        const recentRequests = await collection
            .find({})
            .sort({ timestamp: -1 })
            .limit(limit)
            .toArray();

        // Suspicious requests
        const suspiciousCount = await collection.countDocuments({ 
            timestamp: { $gte: since },
            suspicious: true 
        });

        // Unique users
        const uniqueUsers = await collection.distinct('userId', { timestamp: { $gte: since } });

        // Total tokens used
        const tokensAgg = await collection.aggregate([
            { $match: { timestamp: { $gte: since } } },
            { $group: { _id: null, total: { $sum: '$tokensUsed' } } }
        ]).toArray();

        return {
            totalRequests,
            uniqueUsers: uniqueUsers.length,
            suspiciousCount,
            totalTokens: tokensAgg[0]?.total || 0,
            byEndpoint: byEndpoint.map(e => ({ endpoint: e._id, count: e.count })),
            byCountry: byCountry.map(c => ({ country: c._id, count: c.count })),
            recentRequests
        };
    } catch (err) {
        console.error('[APIKeys] Failed to get usage stats:', err.message);
        return null;
    }
}

/**
 * Get all API keys (admin only)
 */
async function getAllKeys() {
    const collection = getCollection();
    if (!collection) {
        return [];
    }

    const docs = await collection.find({}).toArray();
    return docs.map(doc => ({
        userId: doc.userId,
        keyCount: doc.keys?.length || 0,
        keys: (doc.keys || []).map(k => ({
            id: k.id,
            name: k.name,
            keyPreview: k.keyPreview,
            createdAt: k.createdAt,
            lastUsedAt: k.lastUsedAt,
            requestCount: k.requestCount,
            isActive: k.isActive
        }))
    }));
}

/**
 * Disable a key (admin action)
 */
async function disableKey(userId, keyId) {
    const collection = getCollection();
    if (!collection) {
        return false;
    }

    const result = await collection.updateOne(
        { userId, 'keys.id': keyId },
        { $set: { 'keys.$.isActive': false } }
    );

    return result.modifiedCount > 0;
}

/**
 * Enable a key (admin action)
 */
async function enableKey(userId, keyId) {
    const collection = getCollection();
    if (!collection) {
        return false;
    }

    const result = await collection.updateOne(
        { userId, 'keys.id': keyId },
        { $set: { 'keys.$.isActive': true } }
    );

    return result.modifiedCount > 0;
}

module.exports = {
    init,
    generateKey,
    createKey,
    getUserKeys,
    revokeKey,
    validateKey,
    checkRateLimit,
    recordError,
    logRequest,
    getIpInfo,
    getUsageStats,
    getAllKeys,
    disableKey,
    enableKey,
    MAX_KEYS_PER_USER,
    RATE_LIMIT_MAX_REQUESTS
};

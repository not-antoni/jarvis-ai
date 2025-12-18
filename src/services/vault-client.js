const crypto = require('crypto');
const { LRUCache } = require('../utils/lru-cache');
const { connectVault, getVaultDb } = require('./db');
const config = require('../../config');

// Lazy-loaded master key to avoid crash on startup for selfhosters without vault
let _masterKey = null;
function getMasterKey() {
    if (_masterKey) return _masterKey;
    
    const keyBase64 = config.security.masterKeyBase64;
    if (!keyBase64) {
        throw new Error('MASTER_KEY_BASE64 is required for vault operations');
    }
    
    _masterKey = Buffer.from(keyBase64, 'base64');
    if (_masterKey.length !== 32) {
        _masterKey = null;
        throw new Error('MASTER_KEY_BASE64 must decode to a 32-byte key');
    }
    
    return _masterKey;
}

const CACHE_TTL_MS = config.security.vaultCacheTtlMs;
const CACHE_MAX_ENTRIES = 500;

// Memory limits: 20 long-term + 10 short-term = 30 total per user
const LONG_TERM_MEMORY_LIMIT = 20;
const SHORT_TERM_MEMORY_LIMIT = 10;
const TOTAL_MEMORY_LIMIT = LONG_TERM_MEMORY_LIMIT + SHORT_TERM_MEMORY_LIMIT;
const SHORT_TERM_TTL_MS = 5 * 60 * 60 * 1000; // 5 hours
const USE_LOCAL_DB_MODE = parseBooleanEnv(process.env.LOCAL_DB_MODE, false);

function parseBooleanEnv(value, fallback) {
    if (value === undefined || value === null) return fallback;
    if (typeof value === 'boolean') return value;
    return !['false', '0', 'no', 'off'].includes(String(value).toLowerCase());
}

let localDbOps = null;
if (USE_LOCAL_DB_MODE) {
    try {
        localDbOps = require('../localdb').vaultOps;
    } catch (e) {
        console.warn('Failed to load localdb vault ops:', e.message);
    }
}

const keyCache = new LRUCache({ max: CACHE_MAX_ENTRIES, ttl: CACHE_TTL_MS });
const memoryCache = new LRUCache({ max: CACHE_MAX_ENTRIES, ttl: CACHE_TTL_MS });

let vaultCollectionsPromise = null;
let testCollectionsOverride = null;

const {
    database: {
        vaultCollections: {
            userKeys: userKeysCollectionName = 'vaultUserKeys',
            memories: memoriesCollectionName = 'vaultMemories'
        } = {}
    } = {}
} = config;

async function getCollections() {
    if (USE_LOCAL_DB_MODE) {
        throw new Error('Vault not available in LOCAL_DB_MODE');
    }

    if (testCollectionsOverride) {
        return testCollectionsOverride;
    }

    if (!vaultCollectionsPromise) {
        vaultCollectionsPromise = (async () => {
            await connectVault();
            const db = getVaultDb();

            if (!db) {
                throw new Error('Vault database connection failed');
            }

            const userKeys = db.collection(userKeysCollectionName);
            const memories = db.collection(memoriesCollectionName);

            await Promise.all([
                userKeys.createIndex(
                    { userId: 1 },
                    { unique: true, name: 'userKeys_userId_unique' }
                ),
                memories.createIndex(
                    { userId: 1, createdAt: -1 },
                    { name: 'memories_userId_createdAt' }
                ),
                memories.createIndex(
                    { createdAt: 1 },
                    {
                        name: 'memories_createdAt_ttl_30d',
                        expireAfterSeconds: 30 * 24 * 60 * 60
                    }
                )
            ]);

            return { userKeys, memories };
        })().catch(error => {
            vaultCollectionsPromise = null;
            throw error;
        });
    }

    return vaultCollectionsPromise;
}

function encryptWithKey(key, plaintextBuffer) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintextBuffer), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return {
        iv: iv.toString('base64'),
        authTag: authTag.toString('base64'),
        ciphertext: ciphertext.toString('base64')
    };
}

function decryptWithKey(key, payload) {
    const { ciphertext, iv, authTag } = payload;
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(authTag, 'base64'));
    const decrypted = Buffer.concat([
        decipher.update(Buffer.from(ciphertext, 'base64')),
        decipher.final()
    ]);
    return decrypted;
}

function serializePlaintext(plaintext) {
    if (Buffer.isBuffer(plaintext)) {
        return { buffer: plaintext, format: 'buffer' };
    }

    if (typeof plaintext === 'string') {
        return { buffer: Buffer.from(plaintext, 'utf8'), format: 'text' };
    }

    return {
        buffer: Buffer.from(JSON.stringify(plaintext)),
        format: 'json'
    };
}

function deserializePlaintext(buffer, format) {
    if (format === 'buffer') {
        return Buffer.from(buffer);
    }
    if (format === 'text') {
        return buffer.toString('utf8');
    }

    try {
        return JSON.parse(buffer.toString('utf8'));
    } catch (error) {
        console.warn('Failed to parse decrypted JSON payload. Dropping record.');
        return null;
    }
}

function cloneData(data) {
    if (Buffer.isBuffer(data)) {
        return Buffer.from(data);
    }
    if (data == null) {
        return data;
    }
    if (typeof structuredClone === 'function') {
        try {
            return structuredClone(data);
        } catch {
            // fall through to JSON clone
        }
    }
    if (typeof data === 'object') {
        return JSON.parse(JSON.stringify(data));
    }
    return data;
}

function cloneMemoryEntry(entry) {
    return {
        createdAt: entry.createdAt,
        data: cloneData(entry.data)
    };
}

async function getOrCreateUserKey(userId) {
    if (!userId) {
        throw new Error('userId is required');
    }

    const cached = keyCache.get(userId);
    if (cached) {
        return Buffer.from(cached);
    }

    if (USE_LOCAL_DB_MODE && localDbOps) {
        let record = await localDbOps.getUserKey(userId);

        if (!record) {
            const userKey = crypto.randomBytes(32);
            const payload = encryptWithKey(getMasterKey(), userKey);

            await localDbOps.saveUserKey(userId, {
                encryptedKey: payload.ciphertext,
                iv: payload.iv,
                authTag: payload.authTag,
                version: 1
            });

            keyCache.set(userId, userKey);
            return userKey;
        }

        const decryptedKey = decryptWithKey(getMasterKey(), {
            ciphertext: record.encryptedKey,
            iv: record.iv,
            authTag: record.authTag
        });

        const userKey = Buffer.from(decryptedKey);
        keyCache.set(userId, userKey);
        return userKey;
    }

    const { userKeys } = await getCollections();
    let record = await userKeys.findOne({ userId });

    if (!record) {
        const now = new Date();
        const userKey = crypto.randomBytes(32);
        const payload = encryptWithKey(getMasterKey(), userKey);

        record = {
            userId,
            encryptedKey: payload.ciphertext,
            iv: payload.iv,
            authTag: payload.authTag,
            createdAt: now,
            lastRotatedAt: now,
            version: 1
        };

        await userKeys.insertOne(record);
        keyCache.set(userId, userKey);
        return userKey;
    }

    const decryptedKey = decryptWithKey(getMasterKey(), {
        ciphertext: record.encryptedKey,
        iv: record.iv,
        authTag: record.authTag
    });

    const userKey = Buffer.from(decryptedKey);
    keyCache.set(userId, userKey);
    return userKey;
}

async function registerUserKey(userId) {
    const { userKeys } = await getCollections();
    const existing = await userKeys.findOne({ userId });

    if (existing) {
        return { created: false, createdAt: existing.createdAt };
    }

    const now = new Date();
    const userKey = crypto.randomBytes(32);
    const payload = encryptWithKey(getMasterKey(), userKey);

    await userKeys.insertOne({
        userId,
        encryptedKey: payload.ciphertext,
        iv: payload.iv,
        authTag: payload.authTag,
        createdAt: now,
        lastRotatedAt: now,
        version: 1
    });

    keyCache.set(userId, userKey);
    return { created: true, createdAt: now };
}

async function encryptMemory(userId, plaintext, options = {}) {
    if (USE_LOCAL_DB_MODE && localDbOps) {
        const { type = 'conversation', isShortTerm = false } = options || {};
        const { buffer, format } = serializePlaintext(plaintext);

        if (buffer.byteLength > 64 * 1024) {
            throw new Error('Memory payload exceeds 64KB limit');
        }

        const userKey = await getOrCreateUserKey(userId);
        const payload = encryptWithKey(userKey, buffer);

        await localDbOps.saveMemory(userId, {
            type,
            payload,
            format,
            bytes: buffer.byteLength,
            isShortTerm: isShortTerm,
            shortTermExpiresAt: isShortTerm ? Date.now() + SHORT_TERM_TTL_MS : null,
            version: 1
        });

        // Enforce memory limits
        await enforceMemoryLimitsLocal(userId);

        memoryCache.delete(userId);
        return `local_${userId}_${Date.now()}`;
    }

    const { type = 'conversation', expiresAt = null, isShortTerm = false } = options || {};
    const { buffer, format } = serializePlaintext(plaintext);

    if (buffer.byteLength > 64 * 1024) {
        throw new Error('Memory payload exceeds 64KB limit');
    }

    const userKey = await getOrCreateUserKey(userId);
    const payload = encryptWithKey(userKey, buffer);

    const doc = {
        userId,
        type,
        payload,
        format,
        createdAt: new Date(),
        meta: {
            bytes: buffer.byteLength
        },
        isShortTerm: isShortTerm,
        shortTermExpiresAt: isShortTerm ? new Date(Date.now() + SHORT_TERM_TTL_MS) : null,
        expiresAt,
        version: 1
    };

    const { memories } = await getCollections();
    const result = await memories.insertOne(doc);

    // Enforce memory limits: delete oldest if over limit
    await enforceMemoryLimits(userId, memories);

    memoryCache.delete(userId);
    return result.insertedId;
}

/**
 * Enforce memory limits per user (20 long-term + 10 short-term = 30 total)
 * If over limit, delete oldest memories
 */
async function enforceMemoryLimits(userId, memoriesCollection) {
    try {
        // Clean up expired short-term memories first
        await memoriesCollection.deleteMany({
            userId,
            isShortTerm: true,
            shortTermExpiresAt: { $lt: new Date() }
        });

        // Get current counts
        const totalCount = await memoriesCollection.countDocuments({ userId });

        if (totalCount > TOTAL_MEMORY_LIMIT) {
            // Find oldest memories to delete
            const excess = totalCount - TOTAL_MEMORY_LIMIT;
            const oldestDocs = await memoriesCollection
                .find({ userId })
                .sort({ createdAt: 1 })
                .limit(excess)
                .toArray();

            const idsToDelete = oldestDocs.map(d => d._id);
            if (idsToDelete.length > 0) {
                await memoriesCollection.deleteMany({ _id: { $in: idsToDelete } });
            }
        }
    } catch (error) {
        console.error('[VaultClient] Failed to enforce memory limits:', error);
    }
}

/**
 * Enforce memory limits for local DB mode
 */
async function enforceMemoryLimitsLocal(userId) {
    if (!localDbOps) return;

    try {
        // Get all memories for user
        const allMemories = await localDbOps.getMemories(userId, 1000);

        // Clean expired short-term memories and filter valid ones
        const now = Date.now();
        const validMemories = allMemories.filter(m => {
            if (m.isShortTerm && m.shortTermExpiresAt && m.shortTermExpiresAt < now) {
                return false; // Expired
            }
            return true;
        });

        // If over limit, keep only the newest TOTAL_MEMORY_LIMIT and delete the rest
        if (validMemories.length > TOTAL_MEMORY_LIMIT) {
            // Memories are already sorted by createdAt desc, so keep first TOTAL_MEMORY_LIMIT
            const memoriesToKeep = validMemories.slice(0, TOTAL_MEMORY_LIMIT);
            
            // Clear all and re-save only the ones to keep
            await localDbOps.clearMemories(userId);
            for (const mem of memoriesToKeep.reverse()) {
                // Re-save in chronological order (oldest first)
                const { userId: uid, ...memData } = mem;
                await localDbOps.saveMemory(uid, memData);
            }
        }
    } catch (error) {
        console.error('[VaultClient] Failed to enforce local memory limits:', error);
    }
}

async function decryptMemories(userId, options = {}) {
    // ALWAYS query DB - don't use cache for robustness
    // Cache is only used for performance optimization, not as source of truth

    if (USE_LOCAL_DB_MODE && localDbOps) {
        const { type = 'conversation', limit = 30 } = options || {};

        // Clean expired short-term memories first
        const allDocs = await localDbOps.getMemories(userId, 1000);
        const now = Date.now();
        const validDocs = allDocs
            .filter(m => {
                if (m.isShortTerm && m.shortTermExpiresAt && m.shortTermExpiresAt < now) {
                    return false;
                }
                return true;
            })
            .slice(0, limit);

        if (validDocs.length === 0) {
            return [];
        }

        const userKey = await getOrCreateUserKey(userId);
        const decrypted = [];

        for (const doc of validDocs) {
            try {
                const plaintext = decryptWithKey(userKey, doc.payload);
                const value = deserializePlaintext(plaintext, doc.format);
                if (value !== null) {
                    decrypted.push({
                        _id: doc._id || `local_${userId}_${doc.createdAt}`,
                        type: doc.type || type,
                        value,
                        isShortTerm: doc.isShortTerm || false,
                        createdAt: new Date(doc.createdAt)
                    });
                }
            } catch (error) {
                console.warn(`Failed to decrypt memory for user ${userId}:`, error.message);
            }
        }

        return decrypted.map(cloneMemoryEntry);
    }

    const { type = 'conversation', limit = 30 } = options || {};

    const { memories } = await getCollections();

    // Clean expired short-term memories first
    await memories.deleteMany({
        userId,
        isShortTerm: true,
        shortTermExpiresAt: { $lt: new Date() }
    });

    const docs = await memories
        .find({ userId, type })
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray();

    if (docs.length === 0) {
        return [];
    }

    const userKey = await getOrCreateUserKey(userId);
    const decrypted = [];

    for (const doc of docs) {
        try {
            const buffer = decryptWithKey(userKey, doc.payload);
            const payload = deserializePlaintext(buffer, doc.format);
            if (payload == null) {
                continue;
            }
            decrypted.push({
                createdAt: doc.createdAt,
                data: payload,
                isShortTerm: doc.isShortTerm || false
            });
        } catch (error) {
            console.error('Failed to decrypt vault memory for user', userId, error);
        }
    }

    return decrypted.map(cloneMemoryEntry);
}

async function purgeUserMemories(userId) {
    const { memories, userKeys } = await getCollections();
    await memories.deleteMany({ userId });
    await userKeys.deleteOne({ userId });
    keyCache.delete(userId);
    memoryCache.delete(userId);
}

function __dangerouslySetCollectionsForTests(collections) {
    testCollectionsOverride = collections;
    vaultCollectionsPromise = null;
}

function __resetCachesForTests() {
    keyCache.clear();
    memoryCache.clear();
}

module.exports = {
    encryptMemory,
    decryptMemories,
    registerUserKey,
    purgeUserMemories,
    __dangerouslySetCollectionsForTests,
    __resetCachesForTests
};

const crypto = require('crypto');
const LruModule = require('lru-cache');
const { connectVault, getVaultDb } = require('./db');
const config = require('./config');

const LRUCache =
    typeof LruModule === 'function'
        ? LruModule
        : typeof LruModule?.LRUCache === 'function'
            ? LruModule.LRUCache
            : typeof LruModule?.default === 'function'
                ? LruModule.default
                : null;

if (!LRUCache) {
    throw new Error('Failed to load LRUCache constructor from lru-cache module');
}

const MASTER_KEY = Buffer.from(config.security.masterKeyBase64, 'base64');
if (MASTER_KEY.length !== 32) {
    throw new Error('MASTER_KEY_BASE64 must decode to a 32-byte key');
}

const CACHE_TTL_MS = config.security.vaultCacheTtlMs;
const CACHE_MAX_ENTRIES = 500;
const USE_LOCAL_DB_MODE = parseBooleanEnv(process.env.LOCAL_DB_MODE, false);

function parseBooleanEnv(value, fallback) {
    if (value === undefined || value === null) return fallback;
    if (typeof value === 'boolean') return value;
    return !['false', '0', 'no', 'off'].includes(String(value).toLowerCase());
}

let localDbOps = null;
if (USE_LOCAL_DB_MODE) {
    try {
        localDbOps = require('./src/localdb').vaultOps;
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
                userKeys.createIndex({ userId: 1 }, { unique: true, name: 'userKeys_userId_unique' }),
                memories.createIndex({ userId: 1, createdAt: -1 }, { name: 'memories_userId_createdAt' }),
                memories.createIndex(
                    { createdAt: 1 },
                    {
                        name: 'memories_createdAt_ttl_30d',
                        expireAfterSeconds: 30 * 24 * 60 * 60
                    }
                )
            ]);

            return { userKeys, memories };
        })().catch((error) => {
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
            const payload = encryptWithKey(MASTER_KEY, userKey);

            await localDbOps.saveUserKey(userId, {
                encryptedKey: payload.ciphertext,
                iv: payload.iv,
                authTag: payload.authTag,
                version: 1
            });

            keyCache.set(userId, userKey);
            return userKey;
        }

        const decryptedKey = decryptWithKey(MASTER_KEY, {
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
        const payload = encryptWithKey(MASTER_KEY, userKey);

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

    const decryptedKey = decryptWithKey(MASTER_KEY, {
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
    const payload = encryptWithKey(MASTER_KEY, userKey);

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
        const { type = 'conversation' } = options || {};
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
            version: 1
        });

        memoryCache.delete(userId);
        return `local_${userId}_${Date.now()}`;
    }

    const { type = 'conversation', expiresAt = null } = options || {};
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
        expiresAt,
        version: 1
    };

    const { memories } = await getCollections();
    const result = await memories.insertOne(doc);

    memoryCache.delete(userId);
    return result.insertedId;
}

async function decryptMemories(userId, options = {}) {
    if (USE_LOCAL_DB_MODE && localDbOps) {
        const cacheHit = memoryCache.get(userId);
        if (cacheHit) {
            return cacheHit.map(cloneMemoryEntry);
        }

        const { type = 'conversation', limit = 12 } = options || {};
        const docs = await localDbOps.getMemories(userId, limit);
        
        if (docs.length === 0) {
            memoryCache.set(userId, []);
            return [];
        }

        const userKey = await getOrCreateUserKey(userId);
        const decrypted = [];

        for (const doc of docs) {
            try {
                const plaintext = decryptWithKey(userKey, doc.payload);
                const value = deserializePlaintext(plaintext, doc.format);
                if (value !== null) {
                    decrypted.push({
                        _id: doc._id || `local_${userId}_${doc.createdAt}`,
                        type: doc.type || type,
                        value,
                        createdAt: new Date(doc.createdAt)
                    });
                }
            } catch (error) {
                console.warn(`Failed to decrypt memory for user ${userId}:`, error.message);
            }
        }

        memoryCache.set(userId, decrypted);
        return decrypted.map(cloneMemoryEntry);
    }

    const cacheHit = memoryCache.get(userId);
    if (cacheHit) {
        return cacheHit.map(cloneMemoryEntry);
    }

    const { type = 'conversation', limit = 12 } = options || {};

    const { memories } = await getCollections();
    const docs = await memories
        .find({ userId, type })
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray();

    if (docs.length === 0) {
        memoryCache.set(userId, []);
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
                data: payload
            });
        } catch (error) {
            console.error('Failed to decrypt vault memory for user', userId, error);
        }
    }

    memoryCache.set(userId, decrypted);
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

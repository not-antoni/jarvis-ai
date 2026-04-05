/**
 * Database connection and operations for Jarvis Bot
 */
const { MongoClient } = require('mongodb');
const config = require('../../config');
const localdb = require('../localdb');
const { LRUCache } = require('lru-cache');
const { parseBooleanEnv } = require('../utils/parse-bool-env');
const IS_RENDER = Boolean(process.env.RENDER || process.env.RENDER_SERVICE_ID || process.env.RENDER_EXTERNAL_URL);
const IS_SELFHOST = !IS_RENDER && (
    process.env.DEPLOY_TARGET === 'selfhost' ||
    process.env.SELFHOST_MODE === 'true'
);
const LOCAL_DB_MODE =
    !IS_RENDER &&
    (parseBooleanEnv(process.env.LOCAL_DB_MODE) || parseBooleanEnv(process.env.ALLOW_START_WITHOUT_DB));
const {
    database: {
        mainUri,
        vaultUri,
        names: { main: mainDbName, vault: vaultDbName }
    }
} = config;
if (!mainUri || !vaultUri) {
    if (!LOCAL_DB_MODE) {
        if (!mainUri) {throw new Error('MONGO_URI_MAIN is not configured');}
        if (!vaultUri) {throw new Error('MONGO_URI_VAULT is not configured');}
    }
}
const mongoOptions = {
    maxPoolSize: IS_SELFHOST ? 10 : 25,
    minPoolSize: IS_SELFHOST ? 1 : 2,
    serverSelectionTimeoutMS: IS_SELFHOST ? 10000 : 5000,
    socketTimeoutMS: 45000,
    retryWrites: true,
    retryReads: true,
    connectTimeoutMS: 10000,
    heartbeatFrequencyMS: IS_SELFHOST ? 10000 : 30000,
    maxIdleTimeMS: IS_SELFHOST ? 60000 : 120000
};
let mainClient =
    !LOCAL_DB_MODE && mainUri
        ? new MongoClient(mainUri, mongoOptions)
        : null;
let vaultMongoClient =
    !LOCAL_DB_MODE && vaultUri
        ? new MongoClient(vaultUri, { ...mongoOptions, maxPoolSize: IS_SELFHOST ? 5 : 20 })
        : null;
let mainDb = null;
let vaultDb = null;
let mainConnectPromise = null;
let vaultConnectPromise = null;
let connectionMonitorInterval = null;
let lastConnectionCheck = 0;
const CONNECTION_CHECK_INTERVAL = 30 * 1000;
const RECONNECT_DELAY = 5 * 1000;

async function connectMain() {
    if (LOCAL_DB_MODE) {
        return null;
    }
    if (mainDb) {
        if (IS_SELFHOST) {
            try {
                await mainClient.db('admin').command({ ping: 1 });
            } catch (pingErr) {
                console.warn('[DB] Main connection lost, reconnecting...');
                mainDb = null;
                mainConnectPromise = null;
            }
        }
        if (mainDb) {return mainDb;}
    }
    if (!mainConnectPromise) {
        mainConnectPromise = mainClient
            .connect()
            .then(client => {
                mainDb = client.db(mainDbName);
                console.log('[DB] Main database connected:', mainDbName);
                if (IS_SELFHOST) {
                    setupConnectionMonitoring();
                }
                return mainDb;
            })
            .catch(error => {
                mainConnectPromise = null;
                console.error('[DB] Main connection failed:', error.message);
                throw error;
            });
    }
    return mainConnectPromise;
}

async function connectVault() {
    if (LOCAL_DB_MODE) {
        return null;
    }
    if (vaultDb) {
        return vaultDb;
    }
    if (!vaultConnectPromise) {
        vaultConnectPromise = vaultMongoClient
            .connect()
            .then(client => {
                vaultDb = client.db(vaultDbName);
                return vaultDb;
            })
            .catch(error => {
                vaultConnectPromise = null;
                throw error;
            });
    }
    return vaultConnectPromise;
}

async function initializeDatabaseClients() {
    if (LOCAL_DB_MODE) {
        return { jarvisDB: null, vaultDB: null };
    }
    await Promise.all([connectMain(), connectVault()]);
    return { jarvisDB: mainDb, vaultDB: vaultDb };
}

function getJarvisDb() {
    if (LOCAL_DB_MODE) {return null;}
    if (!mainDb) {
        throw new Error(
            'Main database not connected. Call connectMain or initializeDatabaseClients first.'
        );
    }
    return mainDb;
}

function getVaultDb() {
    if (LOCAL_DB_MODE) {return null;}
    if (!vaultDb) {
        throw new Error(
            'Vault database not connected. Call connectVault or initializeDatabaseClients first.'
        );
    }
    return vaultDb;
}

async function closeMain() {
    if (mainClient) {
        await mainClient.close();
        mainDb = null;
        mainConnectPromise = null;
    }
}

async function closeVault() {
    if (vaultMongoClient) {
        await vaultMongoClient.close();
        vaultDb = null;
        vaultConnectPromise = null;
    }
}

function setupConnectionMonitoring() {
    if (connectionMonitorInterval) {
        return;
    }
    console.log('[DB] Starting connection monitor for selfhost mode');
    connectionMonitorInterval = setInterval(async() => {
        const now = Date.now();
        if (now - lastConnectionCheck < CONNECTION_CHECK_INTERVAL) {
            return;
        }
        lastConnectionCheck = now;
        if (mainClient && mainDb) {
            try {
                await mainClient.db('admin').command({ ping: 1 });
            } catch (err) {
                console.warn('[DB] Main connection check failed, attempting reconnect...');
                mainDb = null;
                mainConnectPromise = null;
                setTimeout(async() => {
                    try {
                        await connectMain();
                        console.log('[DB] Main database reconnected successfully');
                    } catch (reconnectErr) {
                        console.error('[DB] Main reconnect failed:', reconnectErr.message);
                    }
                }, RECONNECT_DELAY);
            }
        }
        if (vaultMongoClient && vaultDb) {
            try {
                await vaultMongoClient.db('admin').command({ ping: 1 });
            } catch (err) {
                console.warn('[DB] Vault connection check failed, attempting reconnect...');
                vaultDb = null;
                vaultConnectPromise = null;
                setTimeout(async() => {
                    try {
                        await connectVault();
                        console.log('[DB] Vault database reconnected successfully');
                    } catch (reconnectErr) {
                        console.error('[DB] Vault reconnect failed:', reconnectErr.message);
                    }
                }, RECONNECT_DELAY);
            }
        }
    }, CONNECTION_CHECK_INTERVAL);
    connectionMonitorInterval.unref();
}

function stopConnectionMonitoring() {
    if (connectionMonitorInterval) {
        clearInterval(connectionMonitorInterval);
        connectionMonitorInterval = null;
    }
}
// Cache configuration
const GUILD_CONFIG_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const GUILD_CONFIG_CACHE_MAX = 200; // Max 200 guilds cached
class DatabaseManager {
    constructor() {
        this.client = null;
        this.db = null;
        this.isConnected = false;
        // LRU Caches for hot data
        this.guildConfigCache = LRUCache
            ? new LRUCache({
                max: GUILD_CONFIG_CACHE_MAX,
                ttl: GUILD_CONFIG_CACHE_TTL
            })
            : null;
    }
    getDefaultFeatureFlags() {
        const rawFeatures = config.features || {};
        const defaults = {};
        for (const [key, value] of Object.entries(rawFeatures)) {
            defaults[key] = Boolean(value);
        }
        return defaults;
    }
    async connect() {
        if (this.isConnected) {
            return;
        }
        if (LOCAL_DB_MODE) {
            // Local mode: operate without a DB connection
            this.client = null;
            this.db = null;
            this.isConnected = false;
            console.warn('Database in LOCAL_DB_MODE: continuing without Mongo connection.');
            return;
        }
        try {
            await connectMain();
            this.client = mainClient;
            this.db = getJarvisDb();
            this.isConnected = true;
            console.log('MongoDB connected successfully for Jarvis++');
            await this.createIndexes();
        } catch (error) {
            console.error('MongoDB connection failed:', error);
            throw error;
        }
    }
    getCollection(collectionName) {
        if (!this.isConnected || !this.db) {return null;}
        if (!collectionName) {return null;}
        return this.db.collection(String(collectionName));
    }
    async createIndexes() {
        if (!this.db) {return;}
        const sixtyDays = 60 * 60 * 24 * 60;
        const thirtyDays = 60 * 60 * 24 * 30;
        const collections = {
            userProfiles: this.db.collection(config.database.collections.userProfiles),
            guildConfigs: this.db.collection(config.database.collections.guildConfigs),
            memberLogs: this.db.collection(config.database.collections.memberLogs),
            autoModeration: this.db.collection(config.database.collections.autoModeration),
            serverStats: this.db.collection(config.database.collections.serverStats),
            counters: this.db.collection(config.database.collections.counters),
            newsCache: this.db.collection(config.database.collections.newsCache),
            migrations: this.db.collection(config.database.collections.migrations),
            statusMessages: this.db.collection(config.database.collections.statusMessages),
            commandMetrics: this.db.collection(config.database.collections.commandMetrics),
            reminders: this.db.collection(config.database.collections.reminders)
        };
        const indexPlans = [
            {
                label: 'userProfiles',
                collection: collections.userProfiles,
                definitions: [{ key: { userId: 1 }, unique: true }]
            },
            {
                label: 'guildConfigs',
                collection: collections.guildConfigs,
                definitions: [{ key: { guildId: 1, key: 1 }, unique: true }]
            },
            {
                label: 'autoModeration',
                collection: collections.autoModeration,
                definitions: [{ key: { guildId: 1 }, unique: true }]
            },
            {
                label: 'serverStats',
                collection: collections.serverStats,
                definitions: [{ key: { guildId: 1 }, unique: true }]
            },
            {
                label: 'memberLogs',
                collection: collections.memberLogs,
                definitions: [
                    {
                        key: { guildId: 1 },
                        unique: true,
                        partialFilterExpression: { isConfig: true }
                    },
                    {
                        key: { createdAt: 1 },
                        expireAfterSeconds: sixtyDays,
                        name: 'ttl_memberLogs_createdAt',
                        partialFilterExpression: {
                            createdAt: { $exists: true },
                            isConfig: false
                        }
                    }
                ]
            },
            {
                label: 'counters',
                collection: collections.counters,
                definitions: [{ key: { key: 1 }, unique: true }]
            },
            {
                label: 'newsCache',
                collection: collections.newsCache,
                definitions: [
                    { key: { topic: 1 }, unique: true },
                    {
                        key: { createdAt: 1 },
                        expireAfterSeconds: 3 * 60 * 60,
                        name: 'ttl_newsCache_createdAt'
                    }
                ]
            },
            {
                label: 'migrations',
                collection: collections.migrations,
                definitions: [{ key: { id: 1 }, unique: true }, { key: { appliedAt: -1 } }]
            },
            {
                label: 'statusMessages',
                collection: collections.statusMessages,
                definitions: [
                    { key: { enabled: 1 }, name: 'statusMessages_enabled_idx' },
                    {
                        key: { priority: 1, createdAt: 1 },
                        name: 'statusMessages_priority_createdAt'
                    }
                ]
            },
            {
                label: 'commandMetrics',
                collection: collections.commandMetrics,
                definitions: [
                    { key: { command: 1, subcommand: 1, context: 1 }, unique: true },
                    { key: { updatedAt: -1 }, name: 'commandMetrics_updatedAt_idx' },
                    {
                        key: { updatedAt: 1 },
                        expireAfterSeconds: thirtyDays,
                        name: 'commandMetrics_ttl'
                    }
                ]
            },
            {
                label: 'reminders',
                collection: collections.reminders,
                definitions: [
                    { key: { id: 1 }, unique: true },
                    { key: { userId: 1, scheduledFor: 1 } },
                    { key: { scheduledFor: 1 } }
                ]
            }
        ];
        const failures = [];
        for (const plan of indexPlans) {
            if (!plan?.collection || !Array.isArray(plan.definitions) || !plan.definitions.length) {
                continue;
            }
            try {
                await plan.collection.createIndexes(plan.definitions);
            } catch (error) {
                failures.push(plan.label);
                console.warn(`Failed to create indexes for ${plan.label}:`, error);
            }
        }
        if (failures.length) {
            console.warn(`Index creation completed with issues for: ${failures.join(', ')}`);
        } else {
            console.log('Database indexes created successfully');
        }
    }
    async getUserProfile(userId, userName, options = {}) {
        if (!this.isConnected) {return null;}
        const update = {
            $setOnInsert: {
                userId,
                firstMet: new Date(),
                preferences: {},
                relationship: 'new',
                personalityDrift: 0,
                activityPatterns: []
            },
            $set: { lastSeen: new Date(), name: userName }
        };
        if (!options.skipIncrement) {
            update.$inc = { interactions: 1 };
        }
        const result = await this.db
            .collection(config.database.collections.userProfiles)
            .findOneAndUpdate(
                { userId },
                update,
                { upsert: true, returnDocument: 'after' }
            );
        return result;
    }
    async isUserOptedOut(userId) {
        if (!this.isConnected || !userId) {return false;}
        try {
            const profile = await this.db
                .collection(config.database.collections.userProfiles)
                .findOne({ userId }, { projection: { 'preferences.memoryOpt': 1 } });
            return String(profile?.preferences?.memoryOpt ?? 'opt-in').toLowerCase() === 'opt-out';
        } catch { return false; }
    }
    async getPresenceMessages() {
        if (!this.isConnected || !this.db) {
            try {
                const docs = localdb.readCollection(config.database.collections.statusMessages);
                return docs
                    .filter(d => d && d.enabled !== false)
                    .map(d => ({ message: String(d.message || '').trim(), type: d.type }))
                    .filter(e => e.message);
            } catch (_) {
                return [];
            }
        }
        const collection = this.db.collection(config.database.collections.statusMessages);
        const documents = await collection
            .find({ enabled: { $ne: false } })
            .sort({ priority: 1, createdAt: 1 })
            .project({ message: 1, type: 1, _id: 0 })
            .toArray();
        return documents
            .map(doc => ({
                message: typeof doc.message === 'string' ? doc.message.trim() : '',
                type: doc.type
            }))
            .filter(entry => Boolean(entry.message));
    }
    async resetUserData(userId) {
        if (!this.isConnected || !this.db) {throw new Error('Database not connected');}
        const profileResult = await this.db
            .collection(config.database.collections.userProfiles)
            .deleteOne({ userId });
        try {
            const vaultService = require('./vault-client');
            await vaultService.purgeUserMemories(userId);
        } catch (error) {
            console.error('Failed to purge vault memories for user', userId, error);
        }
        return {
            prof: profileResult.deletedCount
        };
    }
    async setUserPreference(userId, key, value) {
        if (!this.isConnected || !this.db) {throw new Error('Database not connected');}
        await this.db.collection(config.database.collections.userProfiles).updateOne(
            { userId },
            {
                $set: {
                    [`preferences.${key}`]: value,
                    lastSeen: new Date()
                }
            },
            { upsert: true }
        );
    }
    async updateUserProfile(userId, updates = {}) {
        if (!this.isConnected || !this.db) {throw new Error('Database not connected');}
        if (!userId) {throw new Error('Missing userId');}
        const sanitizedUpdates = updates && typeof updates === 'object' ? { ...updates } : {};
        delete sanitizedUpdates.userId;
        await this.db.collection(config.database.collections.userProfiles).updateOne(
            { userId },
            {
                $set: {
                    ...sanitizedUpdates,
                    lastSeen: new Date()
                },
                $setOnInsert: {
                    userId,
                    firstMet: new Date()
                }
            },
            { upsert: true }
        );
    }
    async saveReminder(reminder) {
        if (!this.isConnected || !this.db) {throw new Error('Database not connected');}
        if (!reminder || !reminder.id) {throw new Error('Invalid reminder payload');}
        const { createdAt, scheduledFor, ...rest } = reminder;
        await this.db.collection(config.database.collections.reminders).updateOne(
            { id: reminder.id },
            {
                $set: {
                    ...rest,
                    scheduledFor: Number(scheduledFor),
                    updatedAt: new Date()
                },
                $setOnInsert: {
                    createdAt: createdAt ? new Date(createdAt) : new Date()
                }
            },
            { upsert: true }
        );
    }
    async deleteReminder(reminderId) {
        if (!this.isConnected || !this.db) {throw new Error('Database not connected');}
        await this.db
            .collection(config.database.collections.reminders)
            .deleteOne({ id: reminderId });
    }
    async getActiveReminders() {
        if (!this.isConnected || !this.db) {return [];}
        const now = Date.now();
        const graceMs = 24 * 60 * 60 * 1000;
        return this.db
            .collection(config.database.collections.reminders)
            .find({ scheduledFor: { $gt: now - graceMs } })
            .sort({ scheduledFor: 1 })
            .limit(500)
            .toArray();
    }
    async clearUserMemories(userId) {
        if (!this.isConnected) {throw new Error('Database not connected');}
        try {
            const vaultService = require('./vault-client');
            await vaultService.purgeUserMemories(userId);
        } catch (error) {
            console.error('Failed to purge secure memories for user', userId, error);
        }
    }
    async clearDatabase() {
        if (!this.isConnected) {throw new Error('Database not connected');}
        const profileResult = await this.db
            .collection(config.database.collections.userProfiles)
            .deleteMany({});
        return {
            prof: profileResult.deletedCount
        };
    }
    async getGuildConfig(guildId, ownerId = null) {
        if (!this.isConnected) {return null;}
        // Check cache first (skip if ownerId needs update)
        if (this.guildConfigCache && !ownerId) {
            const cached = this.guildConfigCache.get(guildId);
            if (cached) {return cached;}
        }
        const collection = this.db.collection(config.database.collections.guildConfigs);
        const defaultFeatures = this.getDefaultFeatureFlags();
        let guildConfig = await collection.findOne({ guildId });
        const now = new Date();
        let needsUpdate = false;
        if (!guildConfig) {
            guildConfig = {
                guildId,
                ownerId: ownerId || null,
                moderatorRoleIds: [],
                moderatorUserIds: [],
                aiChannelId: null,
                djRoleIds: [],
                djUserIds: [],
                blockedUserIds: [],
                features: { ...defaultFeatures },
                createdAt: now,
                updatedAt: now
            };
            await collection.insertOne(guildConfig);
            return guildConfig;
        }
        if (ownerId && guildConfig.ownerId !== ownerId) {
            guildConfig.ownerId = ownerId;
            needsUpdate = true;
        }
        const currentFeatures =
            guildConfig.features && typeof guildConfig.features === 'object'
                ? guildConfig.features
                : {};
        const normalizedFeatures = {};
        let featuresChanged = !guildConfig.features || typeof guildConfig.features !== 'object';
        for (const [key, defaultValue] of Object.entries(defaultFeatures)) {
            const hasKey = Object.prototype.hasOwnProperty.call(currentFeatures, key);
            const normalizedValue = hasKey ? Boolean(currentFeatures[key]) : Boolean(defaultValue);
            normalizedFeatures[key] = normalizedValue;
            if (!hasKey || Boolean(currentFeatures[key]) !== normalizedValue) {
                featuresChanged = true;
            }
        }
        for (const [key, value] of Object.entries(currentFeatures)) {
            if (Object.prototype.hasOwnProperty.call(normalizedFeatures, key)) {
                continue;
            }
            const normalizedValue = Boolean(value);
            normalizedFeatures[key] = normalizedValue;
            if (Boolean(value) !== normalizedValue) {
                featuresChanged = true;
            }
        }
        guildConfig.features = normalizedFeatures;
        if (featuresChanged) {
            needsUpdate = true;
        }
        if (!guildConfig.createdAt) {
            guildConfig.createdAt = now;
            needsUpdate = true;
        }
        if (needsUpdate) {
            guildConfig.updatedAt = now;
            await collection.updateOne(
                { guildId },
                {
                    $set: {
                        ownerId: guildConfig.ownerId || null,
                        features: guildConfig.features,
                        moderatorRoleIds: Array.isArray(guildConfig.moderatorRoleIds)
                            ? guildConfig.moderatorRoleIds
                            : [],
                        moderatorUserIds: Array.isArray(guildConfig.moderatorUserIds)
                            ? guildConfig.moderatorUserIds
                            : [],
                        aiChannelId: typeof guildConfig.aiChannelId === 'string' ? guildConfig.aiChannelId : null,
                        djRoleIds: Array.isArray(guildConfig.djRoleIds) ? guildConfig.djRoleIds : [],
                        djUserIds: Array.isArray(guildConfig.djUserIds) ? guildConfig.djUserIds : [],
                        blockedUserIds: Array.isArray(guildConfig.blockedUserIds) ? guildConfig.blockedUserIds : [],
                        updatedAt: guildConfig.updatedAt
                    },
                    $setOnInsert: {
                        createdAt: guildConfig.createdAt
                    }
                },
                { upsert: true }
            );
        }
        // Update cache
        if (this.guildConfigCache) {
            this.guildConfigCache.set(guildId, guildConfig);
        }
        return guildConfig;
    }
    // Invalidate guild config cache when config is updated
    _invalidateGuildConfigCache(guildId) {
        if (this.guildConfigCache) {
            this.guildConfigCache.delete(guildId);
        }
    }
    async _patchGuildConfig(guildId, update, options = { upsert: true }) {
        if (!this.isConnected) {throw new Error('Database not connected');}
        await this.db.collection(config.database.collections.guildConfigs).updateOne(
            { guildId },
            update,
            options
        );
        this._invalidateGuildConfigCache(guildId);
        return this.getGuildConfig(guildId);
    }
    async _setOrUnsetField(guildId, field, value) {
        if (!this.isConnected) {throw new Error('Database not connected');}
        const collection = this.db.collection(config.database.collections.guildConfigs);
        const now = new Date();
        const update = value
            ? {
                $set: { [field]: value, updatedAt: now },
                $setOnInsert: { createdAt: now }
            }
            : {
                $unset: { [field]: 1 },
                $set: { updatedAt: now },
                $setOnInsert: { createdAt: now }
            };
        await collection.updateOne({ guildId }, update, { upsert: true });
        this._invalidateGuildConfigCache(guildId);
        return this.getGuildConfig(guildId);
    }
    async setGuildDjRoles(guildId, roleIds = []) {
        return this._patchGuildConfig(guildId, {
            $set: { djRoleIds: roleIds, updatedAt: new Date() },
            $setOnInsert: { createdAt: new Date() }
        });
    }
    async setGuildDjUsers(guildId, userIds = []) {
        return this._patchGuildConfig(guildId, {
            $set: { djUserIds: userIds, updatedAt: new Date() },
            $setOnInsert: { createdAt: new Date() }
        });
    }
    async addGuildBlockedUser(guildId, userId) {
        return this._patchGuildConfig(guildId, {
            $addToSet: { blockedUserIds: userId },
            $set: { updatedAt: new Date() },
            $setOnInsert: { createdAt: new Date() }
        });
    }
    async setGuildWakeWord(guildId, wakeWord) {
        return this._setOrUnsetField(guildId, 'customWakeWord', wakeWord);
    }
    async setGuildWakeWordsDisabled(guildId, disabled) {
        return this._setOrUnsetField(guildId, 'wakeWordsDisabled', disabled ? true : null);
    }
    async setGuildAiChannel(guildId, channelId) {
        return this._setOrUnsetField(guildId, 'aiChannelId', channelId);
    }
    async clearGuildAiChannel(guildId) {
        return this._setOrUnsetField(guildId, 'aiChannelId', null);
    }
    async removeGuildBlockedUser(guildId, userId) {
        return this._patchGuildConfig(
            guildId,
            {
                $pull: { blockedUserIds: userId },
                $set: { updatedAt: new Date() }
            },
            { upsert: false }
        );
    }
    async updateGuildFeatures(guildId, features = {}) {
        if (!this.isConnected) {throw new Error('Database not connected');}
        const normalized = Object.entries(features || {}).reduce((acc, [key, value]) => {
            acc[key] = Boolean(value);
            return acc;
        }, {});
        if (!Object.keys(normalized).length) {
            return this.getGuildConfig(guildId);
        }
        const collection = this.db.collection(config.database.collections.guildConfigs);
        const now = new Date();
        const existing = await collection.findOne({ guildId });
        if (existing) {
            const featureUpdates = Object.entries(normalized).reduce((acc, [key, value]) => {
                acc[`features.${key}`] = value;
                return acc;
            }, {});
            await collection.updateOne(
                { guildId },
                {
                    $set: {
                        ...featureUpdates,
                        updatedAt: now
                    }
                }
            );
        } else {
            const defaultFeatures = this.getDefaultFeatureFlags();
            const mergedFeatures = {
                ...defaultFeatures,
                ...normalized
            };
            await collection.insertOne({
                guildId,
                ownerId: null,
                moderatorRoleIds: [],
                moderatorUserIds: [],
                features: mergedFeatures,
                createdAt: now,
                updatedAt: now
            });
        }
        this._invalidateGuildConfigCache(guildId);
        return this.getGuildConfig(guildId);
    }
    async getAutoModConfig(guildId) {
        if (!this.isConnected) {return null;}
        return this.db.collection(config.database.collections.autoModeration).findOne({ guildId });
    }
    async _upsertGuildDoc(collectionName, guildId, data, extraFields = {}) {
        if (!this.isConnected) {throw new Error('Database not connected');}
        const collection = this.db.collection(collectionName);
        const now = new Date();
        const sanitized = { ...data };
        delete sanitized._id;
        delete sanitized.createdAt;
        delete sanitized.updatedAt;
        delete sanitized.isConfig;
        const update = { ...sanitized, guildId, updatedAt: now, ...extraFields };
        const result = await collection.findOneAndUpdate(
            { guildId },
            { $set: update, $setOnInsert: { createdAt: now } },
            { upsert: true, returnDocument: 'after' }
        );
        return result || update;
    }
    async saveAutoModConfig(guildId, data) {
        return this._upsertGuildDoc(config.database.collections.autoModeration, guildId, data, { isConfig: true });
    }
    async getNewsDigest(topic) {
        if (!this.isConnected || !topic) {return null;}
        return this.db
            .collection(config.database.collections.newsCache)
            .findOne({ topic: topic.toLowerCase() });
    }
    async saveNewsDigest(topic, articles, metadata = {}) {
        if (!this.isConnected) {throw new Error('Database not connected');}
        const now = new Date();
        const sanitizedArticles = Array.isArray(articles) ? articles.slice(0, 10) : [];
        const payload = {
            topic: topic.toLowerCase(),
            articles: sanitizedArticles,
            metadata,
            createdAt: now,
            updatedAt: now
        };
        await this.db
            .collection(config.database.collections.newsCache)
            .updateOne({ topic: payload.topic }, { $set: payload }, { upsert: true });
        return payload;
    }
    async getServerStatsConfig(guildId) {
        if (!this.isConnected) {return null;}
        return this.db.collection(config.database.collections.serverStats).findOne({ guildId });
    }
    async saveServerStatsConfig(guildId, data) {
        return this._upsertGuildDoc(config.database.collections.serverStats, guildId, data, { isConfig: true });
    }
    async deleteServerStatsConfig(guildId) {
        if (!this.isConnected) {throw new Error('Database not connected');}
        await this.db.collection(config.database.collections.serverStats).deleteOne({ guildId });
    }
    async getAllServerStatsConfigs() {
        if (!this.isConnected) {return [];}
        return this.db.collection(config.database.collections.serverStats).find({}).toArray();
    }
    async getMemberLogConfig(guildId) {
        if (!this.isConnected) {return null;}
        return this.db.collection(config.database.collections.memberLogs).findOne({ guildId });
    }
    async saveMemberLogConfig(guildId, data) {
        return this._upsertGuildDoc(config.database.collections.memberLogs, guildId, data);
    }
    async recordCommandMetric({
        command,
        subcommand = null,
        context = 'slash',
        status = 'ok',
        latencyMs = null
    } = {}) {
        if (!this.isConnected || !command) {
            return;
        }
        const collection = this.db.collection(config.database.collections.commandMetrics);
        const now = new Date();
        const normalizedSubcommand = subcommand || null;
        const increments = {
            totalRuns: 1
        };
        if (status === 'ok') {
            increments.okRuns = 1;
        } else {
            increments.errorRuns = 1;
        }
        if (Number.isFinite(latencyMs) && latencyMs >= 0) {
            increments.sumLatencyMs = latencyMs;
        }
        await collection.updateOne(
            { command, subcommand: normalizedSubcommand, context },
            {
                $setOnInsert: {
                    command,
                    subcommand: normalizedSubcommand,
                    context,
                    createdAt: now
                },
                $set: {
                    updatedAt: now
                },
                $inc: increments
            },
            { upsert: true }
        );
    }
    async getCommandMetricsSummary({ limit = 25, sortBy = 'runs' } = {}) {
        if (!this.isConnected) {
            return [];
        }
        const sanitizedLimit = Math.max(1, Math.min(Number(limit) || 25, 200));
        const collection = this.db.collection(config.database.collections.commandMetrics);
        const sort =
            sortBy === 'errors'
                ? { errorRuns: -1, totalRuns: -1, updatedAt: -1 }
                : { totalRuns: -1, updatedAt: -1 };
        const cursor = collection.find({}, { sort, limit: sanitizedLimit });
        const records = await cursor.toArray();
        return records.map(doc => {
            const totalRuns = doc.totalRuns || 0;
            const avgLatencyMs =
                totalRuns > 0 ? Math.round((doc.sumLatencyMs || 0) / totalRuns) : null;
            return {
                command: doc.command,
                subcommand: doc.subcommand,
                context: doc.context,
                totalRuns,
                okRuns: doc.okRuns || 0,
                errorRuns: doc.errorRuns || 0,
                avgLatencyMs,
                lastRunAt: doc.updatedAt || doc.createdAt
            };
        });
    }
    // ==================== Command Sync State (for Render) ====================
    /**
     * Get command sync state from MongoDB
     * Used on Render where local filesystem is ephemeral
     */
    async getCommandSyncState() {
        if (!this.isConnected) {return null;}
        try {
            const doc = await this.db
                .collection(config.database.collections.commandSyncState)
                .findOne({ _id: 'global' });
            return doc
                ? {
                    globalHash: doc.globalHash,
                    lastRegisteredAt: doc.lastRegisteredAt,
                    guildClears: doc.guildClears || {}
                }
                : null;
        } catch (error) {
            console.warn('Failed to get command sync state from MongoDB:', error.message);
            return null;
        }
    }
    /**
     * Save command sync state to MongoDB
     * Used on Render where local filesystem is ephemeral
     */
    async saveCommandSyncState(state) {
        if (!this.isConnected) {return false;}
        try {
            await this.db.collection(config.database.collections.commandSyncState).updateOne(
                { _id: 'global' },
                {
                    $set: {
                        globalHash: state.globalHash,
                        lastRegisteredAt: state.lastRegisteredAt,
                        guildClears: state.guildClears || {},
                        updatedAt: new Date()
                    },
                    $setOnInsert: {
                        createdAt: new Date()
                    }
                },
                { upsert: true }
            );
            return true;
        } catch (error) {
            console.warn('Failed to save command sync state to MongoDB:', error.message);
            return false;
        }
    }
    async getAiProxyConfig() {
        if (!this.isConnected) {return null;}
        try {
            const doc = await this.db
                .collection(config.database.collections.commandSyncState)
                .findOne({ _id: 'ai_proxy' });
            if (!doc) {return null;}
            return {
                enabled: typeof doc.enabled === 'boolean' ? doc.enabled : true,
                urls: Array.isArray(doc.urls) ? doc.urls.map(String).filter(Boolean) : []
            };
        } catch (error) {
            console.warn('Failed to get AI proxy config from MongoDB:', error.message);
            return null;
        }
    }
    async saveAiProxyConfig({ enabled = true, urls = [] } = {}) {
        if (!this.isConnected) {return false;}
        const normalizedUrls = Array.isArray(urls) ? urls.map(String).filter(Boolean) : [];
        try {
            await this.db.collection(config.database.collections.commandSyncState).updateOne(
                { _id: 'ai_proxy' },
                {
                    $set: {
                        enabled: Boolean(enabled),
                        urls: normalizedUrls,
                        updatedAt: new Date()
                    },
                    $setOnInsert: {
                        createdAt: new Date()
                    }
                },
                { upsert: true }
            );
            return true;
        } catch (error) {
            console.warn('Failed to save AI proxy config to MongoDB:', error.message);
            return false;
        }
    }
    async disconnect() {
        if (this.isConnected) {
            stopConnectionMonitoring();
            await closeMain();
            await closeVault().catch(() => {});
            this.client = null;
            this.db = null;
            this.isConnected = false;
            console.log('MongoDB disconnected');
        }
    }
}
const databaseManager = new DatabaseManager();
databaseManager.initializeDatabaseClients = initializeDatabaseClients;
databaseManager.connectVault = connectVault;
databaseManager.getVaultDb = getVaultDb;
databaseManager.closeVault = closeVault;
databaseManager.stopConnectionMonitoring = stopConnectionMonitoring;
module.exports = databaseManager;

/**
 * Database connection and operations for Jarvis Bot
 */

const { ObjectId } = require('mongodb');
const config = require('../../config');
const vaultClient = require('./vault-client');
const { connectMain, getJarvisDb, mainClient, closeMain } = require('./db');
const localdb = require('../localdb');
const LOCAL_DB_MODE =
    String(process.env.LOCAL_DB_MODE || process.env.ALLOW_START_WITHOUT_DB || '').toLowerCase() ===
    '1';

// LRU Cache for performance optimization
const LruModule = require('lru-cache');
const LRUCache =
    typeof LruModule === 'function'
        ? LruModule
        : typeof LruModule?.LRUCache === 'function'
          ? LruModule.LRUCache
          : typeof LruModule?.default === 'function'
            ? LruModule.default
            : null;

// Cache configuration
const GUILD_CONFIG_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const GUILD_CONFIG_CACHE_MAX = 200; // Max 200 guilds cached
const CONVERSATION_CACHE_TTL = 2 * 60 * 1000; // 2 minutes
const CONVERSATION_CACHE_MAX = 500; // Max 500 user contexts cached

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

        this.conversationCache = LRUCache
            ? new LRUCache({
                  max: CONVERSATION_CACHE_MAX,
                  ttl: CONVERSATION_CACHE_TTL
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
        if (!this.isConnected || !this.db) return null;
        if (!collectionName) return null;
        return this.db.collection(String(collectionName));
    }

    async createIndexes() {
        if (!this.db) return;

        const ninetyDays = 60 * 60 * 24 * 90;
        const sixtyDays = 60 * 60 * 24 * 60;
        const thirtyDays = 60 * 60 * 24 * 30;

        const collections = {
            conversations: this.db.collection(config.database.collections.conversations),
            userProfiles: this.db.collection(config.database.collections.userProfiles),
            guildConfigs: this.db.collection(config.database.collections.guildConfigs),
            memberLogs: this.db.collection(config.database.collections.memberLogs),
            reactionRoles: this.db.collection(config.database.collections.reactionRoles),
            autoModeration: this.db.collection(config.database.collections.autoModeration),
            moderationFilters: this.db.collection(config.database.collections.moderationFilters),
            serverStats: this.db.collection(config.database.collections.serverStats),
            tickets: this.db.collection(config.database.collections.tickets),
            ticketTranscripts: this.db.collection(config.database.collections.ticketTranscripts),
            knowledgeBase: this.db.collection(config.database.collections.knowledgeBase),
            counters: this.db.collection(config.database.collections.counters),
            newsCache: this.db.collection(config.database.collections.newsCache),
            migrations: this.db.collection(config.database.collections.migrations),
            statusMessages: this.db.collection(config.database.collections.statusMessages),
            commandMetrics: this.db.collection(config.database.collections.commandMetrics),
            reminders: this.db.collection(config.database.collections.reminders),
            announcements: this.db.collection(config.database.collections.announcements),
            subscriptions: this.db.collection(config.database.collections.subscriptions)
        };

        const indexPlans = [
            {
                label: 'conversations',
                collection: collections.conversations,
                definitions: [
                    { key: { userId: 1, guildId: 1, createdAt: -1 } },
                    {
                        key: { createdAt: 1 },
                        expireAfterSeconds: ninetyDays,
                        name: 'ttl_conversations_createdAt'
                    }
                ]
            },
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
                label: 'reactionRoles',
                collection: collections.reactionRoles,
                definitions: [{ key: { messageId: 1 }, unique: true }, { key: { guildId: 1 } }]
            },
            {
                label: 'autoModeration',
                collection: collections.autoModeration,
                definitions: [{ key: { guildId: 1 }, unique: true }]
            },
            {
                label: 'moderationFilters',
                collection: collections.moderationFilters,
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
                label: 'tickets',
                collection: collections.tickets,
                definitions: [
                    { key: { guildId: 1, channelId: 1 }, unique: true },
                    { key: { guildId: 1, openerId: 1, status: 1 } },
                    { key: { createdAt: -1 } }
                ]
            },
            {
                label: 'ticketTranscripts',
                collection: collections.ticketTranscripts,
                definitions: [{ key: { ticketId: 1 }, unique: true }]
            },
            {
                label: 'knowledgeBase',
                collection: collections.knowledgeBase,
                definitions: [
                    { key: { guildId: 1, createdAt: -1 } },
                    { key: { guildId: 1, tags: 1 } }
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
            },
            {
                label: 'announcements',
                collection: collections.announcements,
                definitions: [
                    { key: { id: 1 }, unique: true },
                    { key: { guildId: 1, enabled: 1, nextRunAt: 1 } },
                    { key: { guildId: 1, channelId: 1, enabled: 1 } },
                    { key: { createdByUserId: 1, guildId: 1 } },
                    { key: { lockedUntil: 1 } }
                ]
            },
            {
                label: 'subscriptions',
                collection: collections.subscriptions,
                definitions: [
                    { key: { id: 1 }, unique: true },
                    { key: { guild_id: 1, monitor_type: 1, source_id: 1 }, unique: true },
                    { key: { guild_id: 1, channel_id: 1 } },
                    { key: { monitor_type: 1 } }
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

    async getUserProfile(userId, userName) {
        if (!this.isConnected) return null;

        let profile = await this.db
            .collection(config.database.collections.userProfiles)
            .findOne({ userId });

        if (!profile) {
            profile = {
                userId,
                name: userName,
                firstMet: new Date(),
                interactions: 0,
                preferences: {},
                relationship: 'new',
                lastSeen: new Date(),
                personalityDrift: 0,
                activityPatterns: []
            };
            await this.db.collection(config.database.collections.userProfiles).insertOne(profile);
        }
        return profile;
    }

    async getRecentConversations(userId, limit = 20) {
        if (!this.isConnected) return [];

        // Check cache first (only for standard limit)
        const cacheKey = `${userId}:${limit}`;
        if (this.conversationCache && limit === 20) {
            const cached = this.conversationCache.get(cacheKey);
            if (cached) return cached;
        }

        const conversations = await this.db
            .collection(config.database.collections.conversations)
            .find({ userId })
            .sort({ createdAt: -1, timestamp: -1 })
            .limit(limit)
            .toArray();

        const result = conversations.reverse();

        // Cache standard limit queries
        if (this.conversationCache && limit === 20) {
            this.conversationCache.set(cacheKey, result);
        }

        return result;
    }

    async getConversationsSince(userId, since) {
        if (!this.isConnected) return [];

        const conversations = await this.db
            .collection(config.database.collections.conversations)
            .find({
                userId,
                $or: [
                    { createdAt: { $gte: since } },
                    { createdAt: { $exists: false }, timestamp: { $gte: since } }
                ]
            })
            .sort({ createdAt: 1, timestamp: 1 })
            .toArray();

        return conversations;
    }

    async getGuildConversationsSince(guildId, since, { limit = 200 } = {}) {
        if (!this.isConnected || !guildId) return [];

        const query = {
            guildId,
            $or: [
                { createdAt: { $gte: since } },
                { createdAt: { $exists: false }, timestamp: { $gte: since } }
            ]
        };

        return this.db
            .collection(config.database.collections.conversations)
            .find(query)
            .sort({ createdAt: 1, timestamp: 1 })
            .limit(limit)
            .toArray();
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

    async saveConversation(userId, userName, userInput, jarvisResponse, guildId = null) {
        if (!this.isConnected || !this.db) return;

        const now = new Date();
        const conversation = {
            userId,
            userName,
            userMessage: userInput,
            jarvisResponse,
            timestamp: now,
            createdAt: now,
            guildId
        };

        await this.db.collection(config.database.collections.conversations).insertOne(conversation);

        // Invalidate conversation cache for this user
        if (this.conversationCache) {
            this.conversationCache.delete(`${userId}:20`);
        }

        // Clean up old conversations (keep only last 100 per user)
        const totalCount = await this.db
            .collection(config.database.collections.conversations)
            .countDocuments({ userId });

        if (totalCount > 100) {
            const excessCount = totalCount - 100;
            const oldest = await this.db
                .collection(config.database.collections.conversations)
                .find({ userId })
                .sort({ createdAt: 1, timestamp: 1 })
                .limit(excessCount)
                .toArray();

            await this.db
                .collection(config.database.collections.conversations)
                .deleteMany({ _id: { $in: oldest.map(x => x._id) } });
        }

        // Update user profile
        await this.db.collection(config.database.collections.userProfiles).updateOne(
            { userId },
            {
                $inc: { interactions: 1 },
                $set: { lastSeen: new Date(), name: userName }
            }
        );
    }

    async resetUserData(userId) {
        if (!this.isConnected || !this.db) throw new Error('Database not connected');

        const convResult = await this.db
            .collection(config.database.collections.conversations)
            .deleteMany({ userId });

        const profileResult = await this.db
            .collection(config.database.collections.userProfiles)
            .deleteOne({ userId });

        try {
            await vaultClient.purgeUserMemories(userId);
        } catch (error) {
            console.error('Failed to purge vault memories for user', userId, error);
        }

        // Invalidate conversation cache
        if (this.conversationCache) {
            this.conversationCache.delete(`${userId}:20`);
        }

        return {
            conv: convResult.deletedCount,
            prof: profileResult.deletedCount
        };
    }

    async setUserPreference(userId, key, value) {
        if (!this.isConnected || !this.db) throw new Error('Database not connected');

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
        if (!this.isConnected || !this.db) throw new Error('Database not connected');
        if (!userId) throw new Error('Missing userId');

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
        if (!this.isConnected || !this.db) throw new Error('Database not connected');
        if (!reminder || !reminder.id) throw new Error('Invalid reminder payload');

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
        if (!this.isConnected || !this.db) throw new Error('Database not connected');
        await this.db
            .collection(config.database.collections.reminders)
            .deleteOne({ id: reminderId });
    }

    async getActiveReminders() {
        if (!this.isConnected || !this.db) return [];
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
        if (!this.isConnected) throw new Error('Database not connected');

        try {
            await this.db
                .collection(config.database.collections.conversations)
                .deleteMany({ userId });
        } catch (error) {
            console.error('Failed to purge stored conversations for user', userId, error);
        }

        try {
            await vaultClient.purgeUserMemories(userId);
        } catch (error) {
            console.error('Failed to purge secure memories for user', userId, error);
        }
    }

    async clearDatabase() {
        if (!this.isConnected) throw new Error('Database not connected');

        const convResult = await this.db
            .collection(config.database.collections.conversations)
            .deleteMany({});

        const profileResult = await this.db
            .collection(config.database.collections.userProfiles)
            .deleteMany({});

        return {
            conv: convResult.deletedCount,
            prof: profileResult.deletedCount
        };
    }

    async getGuildConfig(guildId, ownerId = null) {
        if (!this.isConnected) return null;

        // Check cache first (skip if ownerId needs update)
        if (this.guildConfigCache && !ownerId) {
            const cached = this.guildConfigCache.get(guildId);
            if (cached) return cached;
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

    async setGuildModeratorRoles(guildId, roleIds = [], ownerId = null) {
        if (!this.isConnected) throw new Error('Database not connected');

        const collection = this.db.collection(config.database.collections.guildConfigs);
        const now = new Date();

        await collection.updateOne(
            { guildId },
            {
                $set: {
                    moderatorRoleIds: roleIds,
                    updatedAt: now,
                    ...(ownerId ? { ownerId } : {})
                },
                $setOnInsert: {
                    moderatorUserIds: [],
                    createdAt: now
                }
            },
            { upsert: true }
        );

        this._invalidateGuildConfigCache(guildId);
        return this.getGuildConfig(guildId, ownerId);
    }

    async updateGuildFeatures(guildId, features = {}) {
        if (!this.isConnected) throw new Error('Database not connected');

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

    async saveReactionRoleMessage(reactionRole) {
        if (!this.isConnected) throw new Error('Database not connected');

        const collection = this.db.collection(config.database.collections.reactionRoles);
        const now = new Date();
        const { createdAt, ...reactionRoleData } = reactionRole;

        const updateDoc = {
            $set: {
                ...reactionRoleData,
                updatedAt: now
            },
            $setOnInsert: {
                createdAt: createdAt || now
            }
        };

        await collection.updateOne({ messageId: reactionRole.messageId }, updateDoc, {
            upsert: true
        });
    }

    async getReactionRole(messageId) {
        if (!this.isConnected) return null;

        return this.db.collection(config.database.collections.reactionRoles).findOne({ messageId });
    }

    async getReactionRolesForGuild(guildId) {
        if (!this.isConnected) return [];

        return this.db
            .collection(config.database.collections.reactionRoles)
            .find({ guildId })
            .sort({ createdAt: 1 })
            .toArray();
    }

    async deleteReactionRole(messageId) {
        if (!this.isConnected) throw new Error('Database not connected');

        await this.db
            .collection(config.database.collections.reactionRoles)
            .deleteOne({ messageId });
    }
    async getAutoModConfig(guildId) {
        if (!this.isConnected) return null;

        return this.db.collection(config.database.collections.autoModeration).findOne({ guildId });
    }

    async saveAutoModConfig(guildId, data) {
        if (!this.isConnected) throw new Error('Database not connected');

        const collection = this.db.collection(config.database.collections.autoModeration);
        const now = new Date();

        const sanitized = { ...data };
        delete sanitized._id;
        delete sanitized.createdAt;
        delete sanitized.updatedAt;
        delete sanitized.isConfig;

        const update = {
            ...sanitized,
            guildId,
            updatedAt: now,
            isConfig: true
        };

        const result = await collection.findOneAndUpdate(
            { guildId },
            {
                $set: update,
                $setOnInsert: {
                    createdAt: now
                }
            },
            { upsert: true, returnDocument: 'after' }
        );

        return result?.value || update;
    }

    async deleteAutoModConfig(guildId) {
        if (!this.isConnected) throw new Error('Database not connected');

        await this.db.collection(config.database.collections.autoModeration).deleteOne({ guildId });
    }

    async reserveCounter(key) {
        if (!this.isConnected) throw new Error('Database not connected');

        const result = await this.db
            .collection(config.database.collections.counters)
            .findOneAndUpdate(
                { key },
                { $inc: { value: 1 } },
                { upsert: true, returnDocument: 'after' }
            );

        const value = result?.value?.value ?? 1;
        return value;
    }

    async createTicket(ticket) {
        if (!this.isConnected) throw new Error('Database not connected');

        const now = new Date();
        const payload = {
            ...ticket,
            status: ticket.status || 'open',
            createdAt: now,
            updatedAt: now
        };

        const result = await this.db
            .collection(config.database.collections.tickets)
            .insertOne(payload);

        return { ...payload, _id: result.insertedId };
    }

    async getOpenTicket(guildId, openerId) {
        if (!this.isConnected) return null;

        return this.db
            .collection(config.database.collections.tickets)
            .findOne({ guildId, openerId, status: 'open' });
    }

    async getTicketByChannel(channelId) {
        if (!this.isConnected) return null;

        return this.db.collection(config.database.collections.tickets).findOne({ channelId });
    }

    async getTicketByNumber(guildId, ticketNumber) {
        if (!this.isConnected) return null;

        return this.db
            .collection(config.database.collections.tickets)
            .findOne({ guildId, ticketNumber });
    }

    async getTicketById(ticketId) {
        if (!this.isConnected) return null;

        const id = typeof ticketId === 'string' ? new ObjectId(ticketId) : ticketId;

        return this.db.collection(config.database.collections.tickets).findOne({ _id: id });
    }

    async closeTicket(ticketId, updates = {}) {
        if (!this.isConnected) throw new Error('Database not connected');

        const id = typeof ticketId === 'string' ? new ObjectId(ticketId) : ticketId;
        const now = new Date();

        const result = await this.db
            .collection(config.database.collections.tickets)
            .findOneAndUpdate(
                { _id: id },
                {
                    $set: {
                        status: 'closed',
                        closedAt: now,
                        updatedAt: now,
                        ...updates
                    }
                },
                { returnDocument: 'after' }
            );

        return result?.value || null;
    }

    async saveTicketTranscript(ticketId, transcript) {
        if (!this.isConnected) throw new Error('Database not connected');

        const id = typeof ticketId === 'string' ? new ObjectId(ticketId) : ticketId;

        await this.db.collection(config.database.collections.ticketTranscripts).updateOne(
            { ticketId: id },
            {
                $set: {
                    ticketId: id,
                    messages: transcript.messages,
                    exportedAt: new Date(),
                    messageCount: transcript.messageCount,
                    summary: transcript.summary || null
                }
            },
            { upsert: true }
        );
    }

    async getTicketTranscript(ticketId) {
        if (!this.isConnected) return null;

        const id = typeof ticketId === 'string' ? new ObjectId(ticketId) : ticketId;

        return this.db
            .collection(config.database.collections.ticketTranscripts)
            .findOne({ ticketId: id });
    }

    async saveKnowledgeEntry(entry) {
        if (!this.isConnected) throw new Error('Database not connected');

        const now = new Date();
        const payload = {
            ...entry,
            createdAt: entry.createdAt || now,
            updatedAt: now
        };

        const result = await this.db
            .collection(config.database.collections.knowledgeBase)
            .insertOne(payload);

        return { ...payload, _id: result.insertedId };
    }

    async getKnowledgeEntriesForGuild(guildId) {
        if (!this.isConnected) return [];

        return this.db
            .collection(config.database.collections.knowledgeBase)
            .find({ guildId })
            .sort({ createdAt: -1 })
            .toArray();
    }

    async getRecentKnowledgeEntries(guildId, limit = 5) {
        if (!this.isConnected) return [];

        const sanitizedLimit = Math.max(1, Math.min(Number(limit) || 5, 25));

        return this.db
            .collection(config.database.collections.knowledgeBase)
            .find({ guildId })
            .sort({ createdAt: -1 })
            .limit(sanitizedLimit)
            .toArray();
    }

    async getKnowledgeEntriesByTag(guildId, tag, limit = 10) {
        if (!this.isConnected || !tag) return [];

        return this.db
            .collection(config.database.collections.knowledgeBase)
            .find({
                guildId,
                tags: tag
            })
            .sort({ updatedAt: -1, createdAt: -1 })
            .limit(limit)
            .toArray();
    }

    async getKnowledgeEntryById(guildId, entryId) {
        if (!this.isConnected) return null;

        const id = typeof entryId === 'string' ? new ObjectId(entryId) : entryId;

        return this.db
            .collection(config.database.collections.knowledgeBase)
            .findOne({ _id: id, guildId });
    }

    async deleteKnowledgeEntry(guildId, entryId) {
        if (!this.isConnected) throw new Error('Database not connected');

        const id = typeof entryId === 'string' ? new ObjectId(entryId) : entryId;

        const result = await this.db
            .collection(config.database.collections.knowledgeBase)
            .deleteOne({ _id: id, guildId });

        return result.deletedCount > 0;
    }

    async getNewsDigest(topic) {
        if (!this.isConnected || !topic) return null;

        return this.db
            .collection(config.database.collections.newsCache)
            .findOne({ topic: topic.toLowerCase() });
    }

    async saveNewsDigest(topic, articles, metadata = {}) {
        if (!this.isConnected) throw new Error('Database not connected');

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
        if (!this.isConnected) return null;

        return this.db.collection(config.database.collections.serverStats).findOne({ guildId });
    }

    async saveServerStatsConfig(guildId, data) {
        if (!this.isConnected) throw new Error('Database not connected');

        const collection = this.db.collection(config.database.collections.serverStats);
        const now = new Date();

        const sanitized = { ...data };
        delete sanitized._id;
        delete sanitized.createdAt;
        delete sanitized.updatedAt;
        delete sanitized.isConfig;

        const update = {
            ...sanitized,
            guildId,
            updatedAt: now,
            isConfig: true
        };

        const result = await collection.findOneAndUpdate(
            { guildId },
            {
                $set: update,
                $setOnInsert: {
                    createdAt: now
                }
            },
            { upsert: true, returnDocument: 'after' }
        );

        return result?.value || update;
    }

    async deleteServerStatsConfig(guildId) {
        if (!this.isConnected) throw new Error('Database not connected');

        await this.db.collection(config.database.collections.serverStats).deleteOne({ guildId });
    }

    async getAllServerStatsConfigs() {
        if (!this.isConnected) return [];

        return this.db.collection(config.database.collections.serverStats).find({}).toArray();
    }

    async getMemberLogConfig(guildId) {
        if (!this.isConnected) return null;

        return this.db.collection(config.database.collections.memberLogs).findOne({ guildId });
    }

    async saveMemberLogConfig(guildId, data) {
        if (!this.isConnected) throw new Error('Database not connected');

        const collection = this.db.collection(config.database.collections.memberLogs);
        const now = new Date();

        const sanitized = { ...data };
        delete sanitized._id;
        delete sanitized.createdAt;
        delete sanitized.updatedAt;

        const update = {
            ...sanitized,
            guildId,
            updatedAt: now
        };

        const result = await collection.findOneAndUpdate(
            { guildId },
            {
                $set: update,
                $setOnInsert: {
                    createdAt: now
                }
            },
            { upsert: true, returnDocument: 'after' }
        );

        return result?.value || update;
    }

    async deleteMemberLogConfig(guildId) {
        if (!this.isConnected) throw new Error('Database not connected');

        await this.db.collection(config.database.collections.memberLogs).deleteOne({ guildId });
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
        if (!this.isConnected) return null;

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
        if (!this.isConnected) return false;

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
        if (!this.isConnected) return null;

        try {
            const doc = await this.db
                .collection(config.database.collections.commandSyncState)
                .findOne({ _id: 'ai_proxy' });

            if (!doc) return null;

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
        if (!this.isConnected) return false;

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
            await closeMain();
            this.client = null;
            this.db = null;
            this.isConnected = false;
            console.log('MongoDB disconnected');
        }
    }
}

module.exports = new DatabaseManager();

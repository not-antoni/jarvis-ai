/**
 * Database connection and operations for Jarvis Bot
 */

const { ObjectId } = require('mongodb');
const config = require('./config');
const vaultClient = require('./vault-client');
const { connectMain, getJarvisDb, mainClient, closeMain } = require('./db');

class DatabaseManager {
    constructor() {
        this.client = null;
        this.db = null;
        this.isConnected = false;
    }

    getDefaultFeatureFlags() {
        const rawFeatures = config.features || {};
        const defaults = {};

        for (const [key, value] of Object.entries(rawFeatures)) {
            defaults[key] = Boolean(value);
        }

        return defaults;
    }

    normalizeEconomyConfig(input) {
        if (!input || typeof input !== 'object') {
            return { channelIds: [] };
        }

        const channelIds = Array.from(new Set((input.channelIds || []).map((id) => String(id)))).filter(Boolean);

        return {
            channelIds
        };
    }

    async connect() {
        if (this.isConnected) {
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

    async createIndexes() {
        if (!this.db) return;

        try {
            const ninetyDays = 60 * 60 * 24 * 90;
            const sixtyDays = 60 * 60 * 24 * 60;

            const conversations = this.db.collection(config.database.collections.conversations);
            const userProfiles = this.db.collection(config.database.collections.userProfiles);
            const guildConfigs = this.db.collection(config.database.collections.guildConfigs);
            const memberLogs = this.db.collection(config.database.collections.memberLogs);
            const reactionRoles = this.db.collection(config.database.collections.reactionRoles);
            const autoModeration = this.db.collection(config.database.collections.autoModeration);
            const serverStats = this.db.collection(config.database.collections.serverStats);
            const tickets = this.db.collection(config.database.collections.tickets);
            const ticketTranscripts = this.db.collection(config.database.collections.ticketTranscripts);
            const knowledgeBase = this.db.collection(config.database.collections.knowledgeBase);
            const counters = this.db.collection(config.database.collections.counters);
            const newsCache = this.db.collection(config.database.collections.newsCache);
            const migrations = this.db.collection(config.database.collections.migrations);
            const xpUsers = this.db.collection(config.database.collections.xpUsers);
            const xpRewards = this.db.collection(config.database.collections.xpRewards);
            const economyUsers = this.db.collection(config.database.collections.economyUsers);
            const economyShop = this.db.collection(config.database.collections.economyShop);
            const economyTransactions = this.db.collection(config.database.collections.economyTransactions);

            await conversations.createIndex({ userId: 1, guildId: 1, createdAt: -1 });
            await conversations.createIndex(
                { createdAt: 1 },
                { expireAfterSeconds: ninetyDays, name: 'ttl_conversations_createdAt' }
            );

            await userProfiles.createIndex({ userId: 1 }, { unique: true });

            await guildConfigs.createIndex({ guildId: 1, key: 1 }, { unique: true });

            await reactionRoles.createIndex({ messageId: 1 }, { unique: true });
            await reactionRoles.createIndex({ guildId: 1 });

            await autoModeration.createIndex({ guildId: 1 }, { unique: true });
            await serverStats.createIndex({ guildId: 1 }, { unique: true });

            await memberLogs.createIndex(
                { guildId: 1 },
                { unique: true, partialFilterExpression: { isConfig: true } }
            );
            await memberLogs.createIndex(
                { createdAt: 1 },
                {
                    expireAfterSeconds: sixtyDays,
                    name: 'ttl_memberLogs_createdAt',
                    partialFilterExpression: { isConfig: { $ne: true }, createdAt: { $exists: true } }
                }
            );

            await tickets.createIndex({ guildId: 1, channelId: 1 }, { unique: true });
            await tickets.createIndex({ guildId: 1, openerId: 1, status: 1 });
            await tickets.createIndex({ createdAt: -1 });

            await ticketTranscripts.createIndex({ ticketId: 1 }, { unique: true });

            await knowledgeBase.createIndex({ guildId: 1, createdAt: -1 });
            await knowledgeBase.createIndex({ guildId: 1, tags: 1 });

            await counters.createIndex({ key: 1 }, { unique: true });

            await newsCache.createIndex({ topic: 1 }, { unique: true });
            await newsCache.createIndex(
                { createdAt: 1 },
                { expireAfterSeconds: 3 * 60 * 60, name: 'ttl_newsCache_createdAt' }
            );

            await migrations.createIndex({ id: 1 }, { unique: true });
            await migrations.createIndex({ appliedAt: -1 });

            await xpUsers.createIndex({ guildId: 1, userId: 1 }, { unique: true });
            await xpUsers.createIndex({ guildId: 1, xp: -1 });

            await xpRewards.createIndex({ guildId: 1, level: 1 }, { unique: true });

            await economyUsers.createIndex({ guildId: 1, userId: 1 }, { unique: true });
            await economyUsers.createIndex({ guildId: 1, balance: -1 });

            await economyShop.createIndex({ guildId: 1, sku: 1 }, { unique: true });

            await economyTransactions.createIndex({ guildId: 1, userId: 1, ts: -1 });
            await economyTransactions.createIndex({ guildId: 1, ts: -1 });

            console.log('Database indexes created successfully');
        } catch (error) {
            console.error('Failed to create indexes:', error);
            throw error;
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
                relationship: "new",
                lastSeen: new Date(),
                personalityDrift: 0,
                activityPatterns: [],
            };
            await this.db
                .collection(config.database.collections.userProfiles)
                .insertOne(profile);
        }
        return profile;
    }

    async getRecentConversations(userId, limit = 20) {
        if (!this.isConnected) return [];

        const conversations = await this.db
            .collection(config.database.collections.conversations)
            .find({ userId })
            .sort({ createdAt: -1, timestamp: -1 })
            .limit(limit)
            .toArray();

        return conversations.reverse();
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

    async saveConversation(userId, userName, userInput, jarvisResponse, guildId = null) {
        if (!this.isConnected) return;
        
        const now = new Date();
        const conversation = {
            userId,
            userName,
            userMessage: userInput,
            jarvisResponse,
            timestamp: now,
            createdAt: now,
            guildId,
        };
        
        await this.db
            .collection(config.database.collections.conversations)
            .insertOne(conversation);

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
                .deleteMany({ _id: { $in: oldest.map((x) => x._id) } });
        }

        // Update user profile
        await this.db
            .collection(config.database.collections.userProfiles)
            .updateOne(
                { userId },
                {
                    $inc: { interactions: 1 },
                    $set: { lastSeen: new Date(), name: userName },
                }
            );
    }

    async resetUserData(userId) {
        if (!this.isConnected) throw new Error("Database not connected");
        
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
        
        return {
            conv: convResult.deletedCount,
            prof: profileResult.deletedCount
        };
    }

    async setUserPreference(userId, key, value) {
        if (!this.isConnected) throw new Error("Database not connected");

        await this.db
            .collection(config.database.collections.userProfiles)
            .updateOne(
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

    async clearDatabase() {
        if (!this.isConnected) throw new Error("Database not connected");

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
                economyConfig: { channelIds: [] },
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

        const currentFeatures = (guildConfig.features && typeof guildConfig.features === 'object')
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

        const normalizedEconomy = this.normalizeEconomyConfig(guildConfig.economyConfig);
        const previousEconomy = Array.isArray(guildConfig.economyConfig?.channelIds)
            ? new Set(guildConfig.economyConfig.channelIds.map((id) => String(id)))
            : new Set();
        const normalizedEconomySet = new Set(normalizedEconomy.channelIds);
        if (previousEconomy.size !== normalizedEconomySet.size || normalizedEconomy.channelIds.some((id) => !previousEconomy.has(id))) {
            needsUpdate = true;
        }
        guildConfig.economyConfig = normalizedEconomy;

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
                        moderatorRoleIds: Array.isArray(guildConfig.moderatorRoleIds) ? guildConfig.moderatorRoleIds : [],
                        moderatorUserIds: Array.isArray(guildConfig.moderatorUserIds) ? guildConfig.moderatorUserIds : [],
                        economyConfig: guildConfig.economyConfig,
                        updatedAt: guildConfig.updatedAt
                    },
                    $setOnInsert: {
                        createdAt: guildConfig.createdAt
                    }
                },
                { upsert: true }
            );
        }

        return guildConfig;
    }

    async setGuildModeratorRoles(guildId, roleIds = [], ownerId = null) {
        if (!this.isConnected) throw new Error("Database not connected");

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

        return this.getGuildConfig(guildId, ownerId);
    }

    async updateGuildFeatures(guildId, features = {}) {
        if (!this.isConnected) throw new Error("Database not connected");

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
        const defaultFeatures = this.getDefaultFeatureFlags();
        const mergedFeatures = {
            ...defaultFeatures,
            ...(existing?.features || {}),
            ...normalized
        };

        await collection.updateOne(
            { guildId },
            {
                $set: {
                    features: mergedFeatures,
                    updatedAt: now
                },
                $setOnInsert: {
                    guildId,
                    ownerId: null,
                    moderatorRoleIds: [],
                    moderatorUserIds: [],
                    features: mergedFeatures,
                    economyConfig: { channelIds: [] },
                    createdAt: now
                }
            },
            { upsert: true }
        );

        return this.getGuildConfig(guildId);
    }

    async saveReactionRoleMessage(reactionRole) {
        if (!this.isConnected) throw new Error("Database not connected");

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

        await collection.updateOne(
            { messageId: reactionRole.messageId },
            updateDoc,
            { upsert: true }
        );
    }

    async getReactionRole(messageId) {
        if (!this.isConnected) return null;

        return this.db
            .collection(config.database.collections.reactionRoles)
            .findOne({ messageId });
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
        if (!this.isConnected) throw new Error("Database not connected");

        await this.db
            .collection(config.database.collections.reactionRoles)
            .deleteOne({ messageId });
    }

    async getXpUser(guildId, userId) {
        if (!this.isConnected) return null;

        return this.db
            .collection(config.database.collections.xpUsers)
            .findOne({ guildId, userId });
    }

    async incrementXpUser(guildId, userId, {
        xpDelta = 0,
        lastMessageAt = undefined,
        joinedVoiceAt = undefined
    } = {}) {
        if (!this.isConnected) throw new Error('Database not connected');

        const collection = this.db.collection(config.database.collections.xpUsers);
        const now = new Date();

        const update = {
            $setOnInsert: {
                guildId,
                userId,
                level: 0,
                createdAt: now
            },
            $set: {
                updatedAt: now
            }
        };

        if (lastMessageAt !== undefined) {
            update.$set.lastMsgAt = lastMessageAt;
        } else {
            update.$setOnInsert.lastMsgAt = null;
        }

        if (joinedVoiceAt !== undefined) {
            update.$set.joinedVoiceAt = joinedVoiceAt;
        } else {
            update.$setOnInsert.joinedVoiceAt = null;
        }

        if (Number.isFinite(xpDelta) && xpDelta !== 0) {
            update.$inc = { xp: xpDelta };
        } else {
            update.$setOnInsert.xp = 0;
        }

        const result = await collection.findOneAndUpdate(
            { guildId, userId },
            update,
            { upsert: true, returnDocument: 'after' }
        );

        if (!result.value) {
            return null;
        }

        const document = result.value;

        if (document.xp < 0) {
            document.xp = 0;
            await collection.updateOne(
                { _id: document._id },
                { $set: { xp: 0 } }
            );
        }

        return document;
    }

    async setUserVoiceJoin(guildId, userId, joinedAt) {
        return this.incrementXpUser(guildId, userId, { joinedVoiceAt: joinedAt });
    }

    async clearUserVoiceJoin(guildId, userId) {
        return this.incrementXpUser(guildId, userId, { joinedVoiceAt: null });
    }

    async listGuildXpUsers(guildId, { skip = 0, limit = 10 } = {}) {
        if (!this.isConnected) return [];

        return this.db
            .collection(config.database.collections.xpUsers)
            .find({ guildId })
            .sort({ xp: -1, updatedAt: -1 })
            .skip(Math.max(0, skip))
            .limit(Math.max(1, limit))
            .toArray();
    }

    async countGuildXpUsers(guildId) {
        if (!this.isConnected) return 0;

        return this.db
            .collection(config.database.collections.xpUsers)
            .countDocuments({ guildId });
    }

    async countGuildXpUsersAbove(guildId, xp) {
        if (!this.isConnected) return 0;

        return this.db
            .collection(config.database.collections.xpUsers)
            .countDocuments({ guildId, xp: { $gt: xp } });
    }

    async getLevelRoles(guildId) {
        if (!this.isConnected) return [];

        return this.db
            .collection(config.database.collections.xpRewards)
            .find({ guildId })
            .sort({ level: 1 })
            .toArray();
    }

    async upsertLevelRole(guildId, level, roleId) {
        if (!this.isConnected) throw new Error('Database not connected');

        const collection = this.db.collection(config.database.collections.xpRewards);
        const now = new Date();

        await collection.updateOne(
            { guildId, level },
            {
                $set: {
                    roleId,
                    updatedAt: now
                },
                $setOnInsert: {
                    createdAt: now
                }
            },
            { upsert: true }
        );
    }

    async removeLevelRole(guildId, level) {
        if (!this.isConnected) throw new Error('Database not connected');

        await this.db
            .collection(config.database.collections.xpRewards)
            .deleteOne({ guildId, level });
    }

    async setUserLevel(guildId, userId, level) {
        if (!this.isConnected) throw new Error('Database not connected');

        const now = new Date();
        await this.db
            .collection(config.database.collections.xpUsers)
            .updateOne(
                { guildId, userId },
                {
                    $set: {
                        level,
                        updatedAt: now
                    },
                    $setOnInsert: {
                        xp: 0,
                        lastMsgAt: null,
                        joinedVoiceAt: null,
                        createdAt: now
                    }
                },
                { upsert: true }
            );
    }

    async ensureEconomyProfile(guildId, userId) {
        if (!this.isConnected) throw new Error('Database not connected');

        const collection = this.db.collection(config.database.collections.economyUsers);
        const now = new Date();
        const result = await collection.findOneAndUpdate(
            { guildId, userId },
            {
                $set: { updatedAt: now },
                $setOnInsert: {
                    guildId,
                    userId,
                    balance: 0,
                    streak: 0,
                    lastDailyAt: null,
                    lastWorkAt: null,
                    lastCrateAt: null,
                    createdAt: now
                }
            },
            { upsert: true, returnDocument: 'after' }
        );

        return result.value;
    }

    async getEconomyProfile(guildId, userId) {
        if (!this.isConnected) return null;

        return this.db
            .collection(config.database.collections.economyUsers)
            .findOne({ guildId, userId });
    }

    async updateEconomyUser(guildId, userId, update = {}) {
        if (!this.isConnected) throw new Error('Database not connected');

        const collection = this.db.collection(config.database.collections.economyUsers);
        const now = new Date();

        const result = await collection.findOneAndUpdate(
            { guildId, userId },
            {
                $set: {
                    ...update,
                    updatedAt: now
                },
                $setOnInsert: {
                    guildId,
                    userId,
                    balance: 0,
                    streak: 0,
                    lastDailyAt: null,
                    lastWorkAt: null,
                    lastCrateAt: null,
                    createdAt: now
                }
            },
            { upsert: true, returnDocument: 'after' }
        );

        return result.value;
    }

    async adjustEconomyBalance(guildId, userId, delta, { type = 'adjust', reason = null, metadata = null } = {}) {
        if (!this.isConnected) throw new Error('Database not connected');

        await this.ensureEconomyProfile(guildId, userId);

        const collection = this.db.collection(config.database.collections.economyUsers);
        const now = new Date();

        const query = { guildId, userId };
        if (delta < 0) {
            query.balance = { $gte: Math.abs(delta) };
        }

        const result = await collection.findOneAndUpdate(
            query,
            {
                $inc: { balance: delta },
                $set: { updatedAt: now }
            },
            { returnDocument: 'after' }
        );

        if (!result.value) {
            const error = new Error('Insufficient funds');
            error.code = 'INSUFFICIENT_FUNDS';
            throw error;
        }

        await this.logEconomyTransaction({
            guildId,
            userId,
            type,
            delta,
            balance: result.value.balance,
            reason,
            metadata,
            ts: now
        });

        return result.value;
    }

    async logEconomyTransaction({ guildId, userId, type, delta, balance, reason = null, metadata = null, ts = new Date() }) {
        if (!this.isConnected) throw new Error('Database not connected');

        await this.db
            .collection(config.database.collections.economyTransactions)
            .insertOne({
                guildId,
                userId,
                type,
                delta,
                balance,
                reason,
                metadata: metadata || null,
                ts
            });
    }

    async getEconomyLeaderboard(guildId, { limit = 10 } = {}) {
        if (!this.isConnected) return [];

        return this.db
            .collection(config.database.collections.economyUsers)
            .find({ guildId })
            .sort({ balance: -1, updatedAt: -1 })
            .limit(Math.max(1, Math.min(50, limit)))
            .toArray();
    }

    async getEconomySettings(guildId) {
        if (!this.isConnected) throw new Error('Database not connected');

        const configRecord = await this.getGuildConfig(guildId);
        return this.normalizeEconomyConfig(configRecord.economyConfig);
    }

    async setEconomyChannel(guildId, channelId, enabled) {
        if (!this.isConnected) throw new Error('Database not connected');

        const economy = await this.getEconomySettings(guildId);
        const channelSet = new Set(economy.channelIds);

        if (enabled) {
            channelSet.add(String(channelId));
        } else {
            channelSet.delete(String(channelId));
        }

        const now = new Date();

        await this.db
            .collection(config.database.collections.guildConfigs)
            .updateOne(
                { guildId },
                {
                    $set: {
                        'economyConfig.channelIds': Array.from(channelSet),
                        updatedAt: now
                    }
                },
                { upsert: true }
            );

        return Array.from(channelSet);
    }

    async isEconomyChannelEnabled(guildId, channelId) {
        const economy = await this.getEconomySettings(guildId);
        return economy.channelIds.includes(String(channelId));
    }

    async upsertShopItem(guildId, sku, data) {
        if (!this.isConnected) throw new Error('Database not connected');

        const collection = this.db.collection(config.database.collections.economyShop);
        const now = new Date();

        await collection.updateOne(
            { guildId, sku },
            {
                $set: {
                    ...data,
                    guildId,
                    sku,
                    updatedAt: now
                },
                $setOnInsert: {
                    createdAt: now
                }
            },
            { upsert: true }
        );
    }

    async removeShopItem(guildId, sku) {
        if (!this.isConnected) throw new Error('Database not connected');

        await this.db
            .collection(config.database.collections.economyShop)
            .deleteOne({ guildId, sku });
    }

    async listShopItems(guildId) {
        if (!this.isConnected) return [];

        return this.db
            .collection(config.database.collections.economyShop)
            .find({ guildId })
            .sort({ price: 1 })
            .toArray();
    }

    async getShopItem(guildId, sku) {
        if (!this.isConnected) return null;

        return this.db
            .collection(config.database.collections.economyShop)
            .findOne({ guildId, sku });
    }

    async getAutoModConfig(guildId) {
        if (!this.isConnected) return null;

        return this.db
            .collection(config.database.collections.autoModeration)
            .findOne({ guildId });
    }

    async saveAutoModConfig(guildId, data) {
        if (!this.isConnected) throw new Error("Database not connected");

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
        if (!this.isConnected) throw new Error("Database not connected");

        await this.db
            .collection(config.database.collections.autoModeration)
            .deleteOne({ guildId });
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

        return this.db
            .collection(config.database.collections.tickets)
            .findOne({ channelId });
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

        return this.db
            .collection(config.database.collections.tickets)
            .findOne({ _id: id });
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

        await this.db
            .collection(config.database.collections.ticketTranscripts)
            .updateOne(
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
            .updateOne(
                { topic: payload.topic },
                { $set: payload },
                { upsert: true }
            );

        return payload;
    }

    async getServerStatsConfig(guildId) {
        if (!this.isConnected) return null;

        return this.db
            .collection(config.database.collections.serverStats)
            .findOne({ guildId });
    }

    async saveServerStatsConfig(guildId, data) {
        if (!this.isConnected) throw new Error("Database not connected");

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
        if (!this.isConnected) throw new Error("Database not connected");

        await this.db
            .collection(config.database.collections.serverStats)
            .deleteOne({ guildId });
    }

    async getAllServerStatsConfigs() {
        if (!this.isConnected) return [];

        return this.db
            .collection(config.database.collections.serverStats)
            .find({})
            .toArray();
    }

    async getMemberLogConfig(guildId) {
        if (!this.isConnected) return null;

        return this.db
            .collection(config.database.collections.memberLogs)
            .findOne({ guildId });
    }

    async saveMemberLogConfig(guildId, data) {
        if (!this.isConnected) throw new Error("Database not connected");

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
        if (!this.isConnected) throw new Error("Database not connected");

        await this.db
            .collection(config.database.collections.memberLogs)
            .deleteOne({ guildId });
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

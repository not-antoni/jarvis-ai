/**
 * Database connection and operations for Jarvis Bot
 */

const { MongoClient } = require('mongodb');
const config = require('./config');

class DatabaseManager {
    constructor() {
        this.client = null;
        this.db = null;
        this.isConnected = false;
    }

    async connect() {
        try {
            this.client = new MongoClient(config.database.uri);
            await this.client.connect();
            this.db = this.client.db(config.database.name);
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
            // Create indexes for better query performance
            await this.db
                .collection(config.database.collections.conversations)
                .createIndex({ userId: 1, timestamp: -1 });

            await this.db
                .collection(config.database.collections.userProfiles)
                .createIndex({ userId: 1 });

            await this.db
                .collection(config.database.collections.guildConfigs)
                .createIndex({ guildId: 1 }, { unique: true });

            await this.db
                .collection(config.database.collections.reactionRoles)
                .createIndex({ messageId: 1 }, { unique: true });

            await this.db
                .collection(config.database.collections.reactionRoles)
                .createIndex({ guildId: 1 });

            await this.db
                .collection(config.database.collections.autoModeration)
                .createIndex({ guildId: 1 }, { unique: true });

            console.log('Database indexes created successfully');
        } catch (error) {
            console.error('Failed to create indexes:', error);
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
            .sort({ timestamp: -1 })
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
                timestamp: { $gte: since }
            })
            .sort({ timestamp: 1 })
            .toArray();

        return conversations;
    }

    async saveConversation(userId, userName, userInput, jarvisResponse, guildId = null) {
        if (!this.isConnected) return;
        
        const conversation = {
            userId,
            userName,
            userMessage: userInput,
            jarvisResponse,
            timestamp: new Date(),
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
                .sort({ timestamp: 1 })
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
        let guildConfig = await collection.findOne({ guildId });

        if (!guildConfig) {
            const now = new Date();
            guildConfig = {
                guildId,
                ownerId: ownerId || null,
                moderatorRoleIds: [],
                moderatorUserIds: [],
                createdAt: now,
                updatedAt: now
            };
            await collection.insertOne(guildConfig);
        } else if (ownerId && guildConfig.ownerId !== ownerId) {
            guildConfig.ownerId = ownerId;
            guildConfig.updatedAt = new Date();
            await collection.updateOne(
                { guildId },
                {
                    $set: {
                        ownerId: guildConfig.ownerId,
                        updatedAt: guildConfig.updatedAt
                    }
                }
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

    async saveReactionRoleMessage(reactionRole) {
        if (!this.isConnected) throw new Error("Database not connected");

        const collection = this.db.collection(config.database.collections.reactionRoles);
        const now = new Date();
        const document = {
            ...reactionRole,
            updatedAt: now
        };

        if (!document.createdAt) {
            document.createdAt = now;
        }

        await collection.updateOne(
            { messageId: reactionRole.messageId },
            {
                $set: document,
                $setOnInsert: {
                    createdAt: document.createdAt
                }
            },
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

        const update = {
            ...data,
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

    async deleteAutoModConfig(guildId) {
        if (!this.isConnected) throw new Error("Database not connected");

        await this.db
            .collection(config.database.collections.autoModeration)
            .deleteOne({ guildId });
    }

    async disconnect() {
        if (this.client) {
            await this.client.close();
            this.isConnected = false;
            console.log('MongoDB disconnected');
        }
    }
}

module.exports = new DatabaseManager();

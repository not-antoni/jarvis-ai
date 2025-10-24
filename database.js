/**
 * Database connection and operations for Jarvis Bot
 */

const { MongoClient, ObjectId } = require('mongodb');
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
        if (this.client) {
            await this.client.close();
            this.isConnected = false;
            console.log('MongoDB disconnected');
        }
    }
}

module.exports = new DatabaseManager();

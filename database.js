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

    async disconnect() {
        if (this.client) {
            await this.client.close();
            this.isConnected = false;
            console.log('MongoDB disconnected');
        }
    }
}

module.exports = new DatabaseManager();

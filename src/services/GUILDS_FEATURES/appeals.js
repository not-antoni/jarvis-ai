/**
 * Moderation Appeals System
 * 
 * Allows users to appeal bans, mutes, and kicks.
 * Creates a review queue for moderators.
 */

const database = require('../database');

// Appeal statuses
const APPEAL_STATUS = {
    PENDING: 'pending',
    APPROVED: 'approved',
    DENIED: 'denied',
    EXPIRED: 'expired'
};

// Appeal expiry (7 days)
const APPEAL_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Create a new appeal
 */
async function createAppeal(options) {
    const {
        guildId,
        userId,
        username,
        actionType, // 'ban', 'mute', 'kick', 'warn'
        actionId,   // Original mod action ID if available
        reason,     // User's appeal reason
        evidence    // Optional evidence/context
    } = options;

    const db = database.getMainDb();
    const collection = db.collection('moderationAppeals');

    // Check for existing pending appeal
    const existing = await collection.findOne({
        guildId,
        userId,
        status: APPEAL_STATUS.PENDING
    });

    if (existing) {
        return {
            success: false,
            error: 'You already have a pending appeal. Please wait for it to be reviewed.',
            existingAppeal: existing
        };
    }

    // Check cooldown (can't appeal if denied in last 7 days)
    const recentDenied = await collection.findOne({
        guildId,
        userId,
        status: APPEAL_STATUS.DENIED,
        reviewedAt: { $gt: Date.now() - APPEAL_EXPIRY_MS }
    });

    if (recentDenied) {
        const waitTime = APPEAL_EXPIRY_MS - (Date.now() - recentDenied.reviewedAt);
        const daysLeft = Math.ceil(waitTime / (24 * 60 * 60 * 1000));
        return {
            success: false,
            error: `Your last appeal was denied. Please wait ${daysLeft} more day(s) before appealing again.`
        };
    }

    const appeal = {
        id: `appeal_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        guildId,
        userId,
        username,
        actionType,
        actionId,
        reason: reason.substring(0, 2000),
        evidence: evidence?.substring(0, 1000),
        status: APPEAL_STATUS.PENDING,
        createdAt: Date.now(),
        expiresAt: Date.now() + APPEAL_EXPIRY_MS,
        reviewedBy: null,
        reviewedAt: null,
        reviewNotes: null
    };

    await collection.insertOne(appeal);

    return { success: true, appeal };
}

/**
 * Get pending appeals for a guild
 */
async function getPendingAppeals(guildId, limit = 50) {
    const db = database.getMainDb();
    const collection = db.collection('moderationAppeals');

    return collection.find({
        guildId,
        status: APPEAL_STATUS.PENDING,
        expiresAt: { $gt: Date.now() }
    })
        .sort({ createdAt: 1 })
        .limit(limit)
        .toArray();
}

/**
 * Get all appeals for a guild (with filters)
 */
async function getAppeals(guildId, options = {}) {
    const { status, userId, limit = 50, skip = 0 } = options;

    const db = database.getMainDb();
    const collection = db.collection('moderationAppeals');

    const query = { guildId };
    if (status) query.status = status;
    if (userId) query.userId = userId;

    return collection.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray();
}

/**
 * Get appeal by ID
 */
async function getAppeal(appealId) {
    const db = database.getMainDb();
    const collection = db.collection('moderationAppeals');
    return collection.findOne({ id: appealId });
}

/**
 * Review an appeal (approve or deny)
 */
async function reviewAppeal(appealId, reviewerInfo) {
    const {
        reviewerId,
        reviewerUsername,
        approved,
        notes
    } = reviewerInfo;

    const db = database.getMainDb();
    const collection = db.collection('moderationAppeals');

    const appeal = await collection.findOne({ id: appealId });
    if (!appeal) {
        return { success: false, error: 'Appeal not found.' };
    }

    if (appeal.status !== APPEAL_STATUS.PENDING) {
        return { success: false, error: `Appeal already ${appeal.status}.` };
    }

    const update = {
        status: approved ? APPEAL_STATUS.APPROVED : APPEAL_STATUS.DENIED,
        reviewedBy: {
            id: reviewerId,
            username: reviewerUsername
        },
        reviewedAt: Date.now(),
        reviewNotes: notes?.substring(0, 1000)
    };

    await collection.updateOne(
        { id: appealId },
        { $set: update }
    );

    return {
        success: true,
        approved,
        appeal: { ...appeal, ...update }
    };
}

/**
 * Get user's appeal history
 */
async function getUserAppeals(userId, guildId = null) {
    const db = database.getMainDb();
    const collection = db.collection('moderationAppeals');

    const query = { userId };
    if (guildId) query.guildId = guildId;

    return collection.find(query)
        .sort({ createdAt: -1 })
        .limit(20)
        .toArray();
}

/**
 * Get appeal statistics for a guild
 */
async function getAppealStats(guildId) {
    const db = database.getMainDb();
    const collection = db.collection('moderationAppeals');

    const [pending, approved, denied, total] = await Promise.all([
        collection.countDocuments({ guildId, status: APPEAL_STATUS.PENDING }),
        collection.countDocuments({ guildId, status: APPEAL_STATUS.APPROVED }),
        collection.countDocuments({ guildId, status: APPEAL_STATUS.DENIED }),
        collection.countDocuments({ guildId })
    ]);

    return {
        pending,
        approved,
        denied,
        total,
        approvalRate: total > 0 ? ((approved / (approved + denied)) * 100).toFixed(1) : '0.0'
    };
}

/**
 * Expire old appeals
 */
async function expireOldAppeals() {
    const db = database.getMainDb();
    const collection = db.collection('moderationAppeals');

    const result = await collection.updateMany(
        {
            status: APPEAL_STATUS.PENDING,
            expiresAt: { $lt: Date.now() }
        },
        {
            $set: { status: APPEAL_STATUS.EXPIRED }
        }
    );

    if (result.modifiedCount > 0) {
        console.log(`[Appeals] Expired ${result.modifiedCount} old appeals`);
    }

    return result.modifiedCount;
}

/**
 * Delete old appeals (cleanup)
 */
async function cleanupOldAppeals(daysOld = 90) {
    const db = database.getMainDb();
    const collection = db.collection('moderationAppeals');

    const cutoff = Date.now() - (daysOld * 24 * 60 * 60 * 1000);

    const result = await collection.deleteMany({
        createdAt: { $lt: cutoff },
        status: { $ne: APPEAL_STATUS.PENDING }
    });

    if (result.deletedCount > 0) {
        console.log(`[Appeals] Cleaned up ${result.deletedCount} old appeals`);
    }

    return result.deletedCount;
}

module.exports = {
    APPEAL_STATUS,
    createAppeal,
    getPendingAppeals,
    getAppeals,
    getAppeal,
    reviewAppeal,
    getUserAppeals,
    getAppealStats,
    expireOldAppeals,
    cleanupOldAppeals
};

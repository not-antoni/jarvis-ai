/**
 * Server Management and Analytics Service
 * Handles server analytics, auto-moderation, and management features
 */

const { Collection } = require('discord.js');
const database = require('./database');

class ServerManagementService {
    constructor() {
        this.serverStats = new Map();
        this.userActivity = new Map();
        this.moderationRules = new Map();
        this.welcomeMessages = new Map();
        this.autoRoles = new Map();
        this.analyticsData = new Collection();
        
        this.initializeDefaultRules();
    }

    initializeDefaultRules() {
        // Default moderation rules
        this.moderationRules.set('default', {
            spamThreshold: 5, // Messages per minute
            profanityFilter: true,
            linkFilter: false,
            mentionLimit: 3, // Max mentions per message
            capsThreshold: 70, // Percentage of caps
            autoDelete: false,
            autoWarn: true,
            autoKick: false,
            autoBan: false
        });
    }

    // Server Analytics
    trackUserActivity(userId, guildId, activityType, metadata = {}) {
        const key = `${guildId}_${userId}`;
        const now = Date.now();
        
        if (!this.userActivity.has(key)) {
            this.userActivity.set(key, {
                userId: userId,
                guildId: guildId,
                activities: [],
                totalMessages: 0,
                totalReactions: 0,
                totalVoiceTime: 0,
                firstSeen: now,
                lastSeen: now
            });
        }

        const userData = this.userActivity.get(key);
        userData.lastSeen = now;
        
        const activity = {
            type: activityType,
            timestamp: now,
            metadata: metadata
        };
        
        userData.activities.push(activity);
        
        // Update counters
        switch (activityType) {
            case 'message':
                userData.totalMessages++;
                break;
            case 'reaction':
                userData.totalReactions++;
                break;
            case 'voice_join':
                userData.voiceJoinTime = now;
                break;
            case 'voice_leave':
                if (userData.voiceJoinTime) {
                    userData.totalVoiceTime += now - userData.voiceJoinTime;
                    userData.voiceJoinTime = null;
                }
                break;
        }

        // Keep only last 1000 activities to prevent memory issues
        if (userData.activities.length > 1000) {
            userData.activities = userData.activities.slice(-1000);
        }

        this.userActivity.set(key, userData);
    }

    getServerAnalytics(guildId, timeframe = '24h') {
        const timeframeMs = this.getTimeframeMs(timeframe);
        const cutoff = Date.now() - timeframeMs;
        
        const serverUsers = Array.from(this.userActivity.values())
            .filter(user => user.guildId === guildId);
        
        const recentUsers = serverUsers.filter(user => user.lastSeen > cutoff);
        
        // Calculate metrics
        const totalMessages = recentUsers.reduce((sum, user) => sum + user.totalMessages, 0);
        const totalReactions = recentUsers.reduce((sum, user) => sum + user.totalReactions, 0);
        const totalVoiceTime = recentUsers.reduce((sum, user) => sum + user.totalVoiceTime, 0);
        
        // Most active users
        const mostActiveUsers = recentUsers
            .sort((a, b) => (b.totalMessages + b.totalReactions) - (a.totalMessages + a.totalReactions))
            .slice(0, 10)
            .map(user => ({
                userId: user.userId,
                messages: user.totalMessages,
                reactions: user.totalReactions,
                voiceTime: Math.round(user.totalVoiceTime / 60000) // minutes
            }));

        // Activity over time
        const activityOverTime = this.calculateActivityOverTime(recentUsers, timeframe);
        
        return {
            guildId: guildId,
            timeframe: timeframe,
            totalUsers: recentUsers.length,
            totalMessages: totalMessages,
            totalReactions: totalReactions,
            totalVoiceTime: Math.round(totalVoiceTime / 60000), // minutes
            mostActiveUsers: mostActiveUsers,
            activityOverTime: activityOverTime,
            averageMessagesPerUser: recentUsers.length > 0 ? 
                Math.round(totalMessages / recentUsers.length * 100) / 100 : 0
        };
    }

    calculateActivityOverTime(users, timeframe) {
        const intervals = this.getTimeIntervals(timeframe);
        const activity = new Array(intervals.length).fill(0);
        
        users.forEach(user => {
            user.activities.forEach(activityItem => {
                const intervalIndex = this.getIntervalIndex(activityItem.timestamp, intervals);
                if (intervalIndex >= 0 && intervalIndex < activity.length) {
                    activity[intervalIndex]++;
                }
            });
        });
        
        return intervals.map((interval, index) => ({
            time: interval,
            count: activity[index]
        }));
    }

    getTimeframeMs(timeframe) {
        const timeframes = {
            '1h': 60 * 60 * 1000,
            '24h': 24 * 60 * 60 * 1000,
            '7d': 7 * 24 * 60 * 60 * 1000,
            '30d': 30 * 24 * 60 * 60 * 1000
        };
        return timeframes[timeframe] || timeframes['24h'];
    }

    getTimeIntervals(timeframe) {
        const now = Date.now();
        const intervalMs = this.getTimeframeMs(timeframe) / 24; // 24 intervals
        const intervals = [];
        
        for (let i = 0; i < 24; i++) {
            intervals.push(new Date(now - (intervalMs * (23 - i))));
        }
        
        return intervals;
    }

    getIntervalIndex(timestamp, intervals) {
        for (let i = 0; i < intervals.length - 1; i++) {
            if (timestamp >= intervals[i].getTime() && timestamp < intervals[i + 1].getTime()) {
                return i;
            }
        }
        return intervals.length - 1;
    }

    // Auto-Moderation
    analyzeMessage(message, rules = null) {
        const guildRules = rules || this.moderationRules.get('default');
        const violations = [];
        
        // Check for spam
        const spamViolation = this.checkSpam(message, guildRules);
        if (spamViolation) violations.push(spamViolation);
        
        // Check for profanity
        if (guildRules.profanityFilter) {
            const profanityViolation = this.checkProfanity(message);
            if (profanityViolation) violations.push(profanityViolation);
        }
        
        // Check for excessive caps
        const capsViolation = this.checkCaps(message, guildRules.capsThreshold);
        if (capsViolation) violations.push(capsViolation);
        
        // Check mention limits
        const mentionViolation = this.checkMentions(message, guildRules.mentionLimit);
        if (mentionViolation) violations.push(mentionViolation);
        
        // Check for links
        if (guildRules.linkFilter) {
            const linkViolation = this.checkLinks(message);
            if (linkViolation) violations.push(linkViolation);
        }
        
        return {
            hasViolations: violations.length > 0,
            violations: violations,
            severity: this.calculateSeverity(violations)
        };
    }

    checkSpam(message, rules) {
        const userId = message.author.id;
        const now = Date.now();
        const timeWindow = 60000; // 1 minute
        const threshold = rules.spamThreshold;
        
        // Get recent messages from this user
        const recentMessages = this.getRecentMessages(userId, timeWindow);
        
        if (recentMessages >= threshold) {
            return {
                type: 'spam',
                severity: 'high',
                reason: `Posted ${recentMessages} messages in ${timeWindow/1000} seconds`,
                action: rules.autoDelete ? 'delete' : 'warn'
            };
        }
        
        return null;
    }

    checkProfanity(message) {
        const profanityWords = [
            // Add your profanity filter words here
            // This is a basic example - you'd want a more comprehensive list
        ];
        
        const content = message.content.toLowerCase();
        const foundWords = profanityWords.filter(word => content.includes(word));
        
        if (foundWords.length > 0) {
            return {
                type: 'profanity',
                severity: 'medium',
                reason: `Contains inappropriate language: ${foundWords.join(', ')}`,
                action: 'warn'
            };
        }
        
        return null;
    }

    checkCaps(message, threshold) {
        const content = message.content;
        if (content.length < 10) return null; // Ignore short messages
        
        const capsCount = (content.match(/[A-Z]/g) || []).length;
        const capsPercentage = (capsCount / content.length) * 100;
        
        if (capsPercentage > threshold) {
            return {
                type: 'caps',
                severity: 'low',
                reason: `${capsPercentage.toFixed(1)}% of message is in caps`,
                action: 'warn'
            };
        }
        
        return null;
    }

    checkMentions(message, limit) {
        const mentionCount = message.mentions.users.size + message.mentions.roles.size;
        
        if (mentionCount > limit) {
            return {
                type: 'mentions',
                severity: 'medium',
                reason: `Mentioned ${mentionCount} users/roles (limit: ${limit})`,
                action: 'warn'
            };
        }
        
        return null;
    }

    checkLinks(message) {
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        const links = message.content.match(urlRegex);
        
        if (links && links.length > 0) {
            return {
                type: 'links',
                severity: 'medium',
                reason: `Contains ${links.length} link(s)`,
                action: 'review'
            };
        }
        
        return null;
    }

    calculateSeverity(violations) {
        if (violations.length === 0) return 'none';
        
        const severityCounts = violations.reduce((counts, violation) => {
            counts[violation.severity] = (counts[violation.severity] || 0) + 1;
            return counts;
        }, {});
        
        if (severityCounts.high > 0) return 'high';
        if (severityCounts.medium > 0) return 'medium';
        return 'low';
    }

    getRecentMessages(userId, timeWindow) {
        const now = Date.now();
        const cutoff = now - timeWindow;
        
        // This would normally query a database
        // For now, we'll use a simple counter
        return Math.floor(Math.random() * 3); // Mock data
    }

    // Welcome System
    setWelcomeMessage(guildId, message, channelId = null) {
        this.welcomeMessages.set(guildId, {
            message: message,
            channelId: channelId,
            enabled: true
        });
    }

    getWelcomeMessage(guildId) {
        return this.welcomeMessages.get(guildId);
    }

    disableWelcomeMessage(guildId) {
        const welcome = this.welcomeMessages.get(guildId);
        if (welcome) {
            welcome.enabled = false;
            this.welcomeMessages.set(guildId, welcome);
        }
    }

    // Auto-Role System
    setAutoRole(guildId, roleId, conditions) {
        this.autoRoles.set(guildId, {
            roleId: roleId,
            conditions: conditions,
            enabled: true
        });
    }

    checkAutoRole(member, guildId) {
        const autoRole = this.autoRoles.get(guildId);
        if (!autoRole || !autoRole.enabled) return null;
        
        const conditions = autoRole.conditions;
        
        // Check join date
        if (conditions.minAccountAge) {
            const accountAge = Date.now() - member.user.createdTimestamp;
            if (accountAge < conditions.minAccountAge) return null;
        }
        
        // Check server join date
        if (conditions.minServerAge) {
            const serverAge = Date.now() - member.joinedTimestamp;
            if (serverAge < conditions.minServerAge) return null;
        }
        
        // Check role requirements
        if (conditions.requiredRoles) {
            const hasRequiredRole = conditions.requiredRoles.some(roleId => 
                member.roles.cache.has(roleId)
            );
            if (!hasRequiredRole) return null;
        }
        
        return autoRole.roleId;
    }

    // Moderation Actions
    async logModerationAction(guildId, action, moderatorId, targetId, reason, metadata = {}) {
        const logEntry = {
            id: Date.now().toString(),
            guildId: guildId,
            action: action,
            moderatorId: moderatorId,
            targetId: targetId,
            reason: reason,
            metadata: metadata,
            timestamp: new Date().toISOString()
        };
        
        // Store in database
        try {
            await database.logModerationAction(logEntry);
        } catch (error) {
            console.error('Failed to log moderation action:', error);
        }
        
        return logEntry;
    }

    async getModerationLogs(guildId, limit = 50) {
        try {
            return await database.getModerationLogs(guildId, limit);
        } catch (error) {
            console.error('Failed to get moderation logs:', error);
            return [];
        }
    }

    // Server Settings
    updateServerSettings(guildId, settings) {
        const currentSettings = this.serverStats.get(guildId) || {};
        const newSettings = { ...currentSettings, ...settings };
        this.serverStats.set(guildId, newSettings);
        return newSettings;
    }

    getServerSettings(guildId) {
        return this.serverStats.get(guildId) || {};
    }

    // Cleanup
    cleanup() {
        const now = Date.now();
        const maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
        
        // Clean up old user activity data
        for (const [key, userData] of this.userActivity.entries()) {
            if (now - userData.lastSeen > maxAge) {
                this.userActivity.delete(key);
            }
        }
        
        console.log('Server management cleanup completed');
    }

    // Export data
    exportServerData(guildId) {
        const analytics = this.getServerAnalytics(guildId, '30d');
        const settings = this.getServerSettings(guildId);
        const welcome = this.getWelcomeMessage(guildId);
        const autoRole = this.autoRoles.get(guildId);
        
        return {
            guildId: guildId,
            exportedAt: new Date().toISOString(),
            analytics: analytics,
            settings: settings,
            welcomeMessage: welcome,
            autoRole: autoRole
        };
    }
}

module.exports = new ServerManagementService();

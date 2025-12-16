/**
 * Cost & Rate Limiter - Per-user rate limits, cost tracking, quotas, and usage enforcement
 * Prevents abuse and tracks resource consumption
 */

class CostRateLimiter {
    constructor(config = {}) {
        this.users = new Map(); // userId -> userData
        this.globalLimitMs = config.globalLimitMs || 1000; // 1 request per second global
        this.windowSizeMs = config.windowSizeMs || 60 * 1000; // 1 minute window

        // Default per-user limits
        this.defaultLimits = {
            requestsPerMinute: config.requestsPerMinute || 60,
            requestsPerHour: config.requestsPerHour || 1000,
            requestsPerDay: config.requestsPerDay || 10000,
            costPerRequest: config.costPerRequest || 1,
            dailyCostLimit: config.dailyCostLimit || 1000,
            maxConcurrentSessions: config.maxConcurrentSessions || 5,
            maxBytesPerRequest: config.maxBytesPerRequest || 50 * 1024 * 1024 // 50 MB
        };

        this.stats = {
            totalRequestsAllowed: 0,
            totalRequestsDenied: 0,
            totalCostTracked: 0,
            usersOverQuota: 0
        };

        this.cleanupInterval = setInterval(() => this.cleanup(), 60 * 1000); // Every 60s
        if (typeof this.cleanupInterval.unref === 'function') {
            this.cleanupInterval.unref();
        }
    }

    /**
     * Register user with optional custom limits
     */
    registerUser(userId, customLimits = {}) {
        const user = {
            userId,
            registeredAt: Date.now(),
            limits: { ...this.defaultLimits, ...customLimits },
            usage: {
                minuteWindow: [],
                hourWindow: [],
                dayWindow: [],
                totalCostToday: 0,
                concurrentSessions: 0,
                status: 'active' // active, suspended, over_quota
            }
        };

        this.users.set(userId, user);
        return user;
    }

    /**
     * Check if request allowed
     */
    checkRateLimit(userId, metadata = {}) {
        let user = this.users.get(userId);

        if (!user) {
            user = this.registerUser(userId);
        }

        const now = Date.now();
        const result = {
            allowed: true,
            reason: 'ok',
            retryAfterMs: 0,
            costEstimated: metadata.costEstimate || this.defaultLimits.costPerRequest
        };

        // Check user status
        if (user.usage.status === 'suspended') {
            result.allowed = false;
            result.reason = 'user_suspended';
            return result;
        }

        // Check concurrent sessions
        if (user.usage.concurrentSessions >= user.limits.maxConcurrentSessions) {
            result.allowed = false;
            result.reason = 'max_concurrent_sessions';
            result.retryAfterMs = 5000;
            return result;
        }

        // Check request size
        if (metadata.bytesEstimate && metadata.bytesEstimate > user.limits.maxBytesPerRequest) {
            result.allowed = false;
            result.reason = 'request_too_large';
            return result;
        }

        // Clean old entries
        this.cleanUserWindows(user, now);

        // Check minute limit
        if (user.usage.minuteWindow.length >= user.limits.requestsPerMinute) {
            result.allowed = false;
            result.reason = 'minute_limit_exceeded';
            const oldestInWindow = user.usage.minuteWindow[0];
            result.retryAfterMs = Math.max(0, oldestInWindow + this.windowSizeMs - now);
            return result;
        }

        // Check hour limit
        if (user.usage.hourWindow.length >= user.limits.requestsPerHour) {
            result.allowed = false;
            result.reason = 'hour_limit_exceeded';
            result.retryAfterMs = 3600000; // 1 hour
            return result;
        }

        // Check day limit
        if (user.usage.dayWindow.length >= user.limits.requestsPerDay) {
            result.allowed = false;
            result.reason = 'day_limit_exceeded';
            result.retryAfterMs = 86400000; // 1 day
            return result;
        }

        // Check daily cost
        const estimatedCost = metadata.costEstimate || this.defaultLimits.costPerRequest;
        if (user.usage.totalCostToday + estimatedCost > user.limits.dailyCostLimit) {
            result.allowed = false;
            result.reason = 'daily_cost_exceeded';
            result.remainingBudget = user.limits.dailyCostLimit - user.usage.totalCostToday;
            return result;
        }

        return result;
    }

    /**
     * Record request
     */
    recordRequest(userId, metadata = {}) {
        let user = this.users.get(userId);

        if (!user) {
            user = this.registerUser(userId);
        }

        const now = Date.now();
        const cost = metadata.cost || this.defaultLimits.costPerRequest;

        // Record in windows
        user.usage.minuteWindow.push(now);
        user.usage.hourWindow.push(now);
        user.usage.dayWindow.push(now);

        // Track cost
        user.usage.totalCostToday += cost;
        this.stats.totalCostTracked += cost;
        this.stats.totalRequestsAllowed++;

        // Check if over quota
        if (user.usage.totalCostToday > user.limits.dailyCostLimit) {
            user.usage.status = 'over_quota';
            this.stats.usersOverQuota++;
        }

        return {
            recorded: true,
            cost,
            totalCostToday: user.usage.totalCostToday,
            remainingDaily: Math.max(0, user.limits.dailyCostLimit - user.usage.totalCostToday),
            minuteUsed: user.usage.minuteWindow.length,
            hourUsed: user.usage.hourWindow.length
        };
    }

    /**
     * Increment concurrent sessions
     */
    incrementSession(userId) {
        let user = this.users.get(userId);
        if (!user) {
            user = this.registerUser(userId);
        }

        user.usage.concurrentSessions++;
        return user.usage.concurrentSessions;
    }

    /**
     * Decrement concurrent sessions
     */
    decrementSession(userId) {
        let user = this.users.get(userId);
        if (!user) return 0;

        user.usage.concurrentSessions = Math.max(0, user.usage.concurrentSessions - 1);
        return user.usage.concurrentSessions;
    }

    /**
     * Clean old entries from windows
     */
    cleanUserWindows(user, now) {
        const minuteAgo = now - this.windowSizeMs;
        const hourAgo = now - 60 * this.windowSizeMs;
        const dayAgo = now - 1440 * this.windowSizeMs;

        // Clean minute window (1 minute)
        user.usage.minuteWindow = user.usage.minuteWindow.filter(t => t > minuteAgo);

        // Clean hour window (60 minutes)
        user.usage.hourWindow = user.usage.hourWindow.filter(t => t > hourAgo);

        // Clean day window (1440 minutes)
        user.usage.dayWindow = user.usage.dayWindow.filter(t => t > dayAgo);

        // Reset daily cost if new day
        if (user.dayStartedAt && now - user.dayStartedAt > 86400000) {
            user.usage.totalCostToday = 0;
            user.usage.status = user.usage.status === 'over_quota' ? 'active' : user.usage.status;
            user.dayStartedAt = now;
        }

        if (!user.dayStartedAt) {
            user.dayStartedAt = now;
        }
    }

    /**
     * Cleanup stale users
     */
    cleanup() {
        const now = Date.now();
        const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;

        for (const [userId, user] of this.users.entries()) {
            if (user.registeredAt < oneWeekAgo && user.usage.concurrentSessions === 0) {
                this.users.delete(userId);
            }
        }
    }

    /**
     * Get user stats
     */
    getUserStats(userId) {
        const user = this.users.get(userId);
        if (!user) return null;

        return {
            userId,
            limits: user.limits,
            usage: {
                minuteRequests: user.usage.minuteWindow.length,
                hourRequests: user.usage.hourWindow.length,
                dayRequests: user.usage.dayWindow.length,
                totalCostToday: user.usage.totalCostToday,
                remainingDaily: Math.max(0, user.limits.dailyCostLimit - user.usage.totalCostToday),
                concurrentSessions: user.usage.concurrentSessions,
                status: user.usage.status
            },
            limits: {
                minuteLimit: user.limits.requestsPerMinute,
                hourLimit: user.limits.requestsPerHour,
                dayLimit: user.limits.requestsPerDay,
                dailyCostLimit: user.limits.dailyCostLimit,
                maxConcurrentSessions: user.limits.maxConcurrentSessions
            }
        };
    }

    /**
     * Get global stats
     */
    getStats() {
        return {
            ...this.stats,
            totalUsers: this.users.size,
            activeUsers: Array.from(this.users.values()).filter(u => u.usage.concurrentSessions > 0)
                .length,
            suspendedUsers: Array.from(this.users.values()).filter(
                u => u.usage.status === 'suspended'
            ).length
        };
    }

    /**
     * Suspend user
     */
    suspendUser(userId, reason = 'admin_action') {
        const user = this.users.get(userId);
        if (!user) return false;

        user.usage.status = 'suspended';
        user.suspensionReason = reason;
        user.suspendedAt = Date.now();

        console.warn(`[CostRateLimiter] User ${userId} suspended: ${reason}`);
        return true;
    }

    /**
     * Unsuspend user
     */
    unsuspendUser(userId) {
        const user = this.users.get(userId);
        if (!user) return false;

        user.usage.status = 'active';
        delete user.suspensionReason;
        delete user.suspendedAt;

        return true;
    }

    /**
     * Update user limits
     */
    updateUserLimits(userId, newLimits) {
        let user = this.users.get(userId);
        if (!user) {
            user = this.registerUser(userId);
        }

        user.limits = { ...user.limits, ...newLimits };
        return user.limits;
    }

    /**
     * Shutdown
     */
    shutdown() {
        clearInterval(this.cleanupInterval);
        this.users.clear();
    }
}

module.exports = CostRateLimiter;

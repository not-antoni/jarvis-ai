const { LRUCache } = require('lru-cache');
const { safeSend, safeDM } = require('../utils/discord-safe-send');

// Conversation threading - tracks multi-turn sessions
const conversationSessions = new LRUCache({
    max: 1000,
    ttl: 1000 * 60 * 10 // 10 minute expiry
});

// User preferences cache (timezone, wake words, etc.)
const userPrefsCache = new LRUCache({
    max: 5000,
    ttl: 1000 * 60 * 30 // 30 minute cache
});

// Reminder storage (in-memory, persisted to DB on set)
const activeReminders = new Map();

// Stats tracking (bounded to prevent unbounded growth — flushStats is rarely called)
const sessionStats = new LRUCache({ max: 10000, ttl: 1000 * 60 * 60 * 4 });

function escapeRegex(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Mood patterns for detection
const MOOD_PATTERNS = {
    frustrated: {
        keywords: ['ugh', 'annoying', 'frustrated', 'angry', 'mad', 'stupid', 'broken', "doesn't work", 'not working', 'hate', 'useless', 'trash', 'garbage', 'wtf', 'ffs', 'damn', 'dammit'],
        punctuation: /[!?]{2,}|\.{3,}/, caps: 0.5
    },
    excited: {
        keywords: ['awesome', 'amazing', 'incredible', 'love', 'great', 'fantastic', 'wonderful', 'perfect', 'yay', 'woohoo', 'omg', 'wow'],
        punctuation: /!{2,}/, caps: 0.4
    },
    sad: {
        keywords: ['sad', 'depressed', 'unhappy', 'crying', 'tears', 'lonely', 'alone', 'miss', 'lost', 'heartbroken', 'devastated'],
        punctuation: /\.{3,}/, caps: 0
    },
    confused: {
        keywords: ['confused', "don't understand", 'what do you mean', 'huh', 'what?', 'how?', 'why?', 'makes no sense', 'lost'],
        punctuation: /\?{2,}/, caps: 0
    }
};

// Tone adjustments based on mood
const TONE_ADJUSTMENTS = {
    frustrated:
        'The user sounds frustrated. Cut the banter, be direct, and just help. No jokes unless they crack one first.',
    excited: 'The user is hype. Match the energy — ride the wave with them.',
    sad: 'The user seems down. Ease off the roasts. Be real with them — still Jarvis, just the version that actually gives a damn.',
    confused:
        'The user is lost. Keep it simple, straight answer, no showing off.',
    neutral: '' // No adjustment
};

class UserFeaturesService {
    constructor() {
        this.database = null;
        this.discordClient = null;
        this.reminderCheckInterval = null;
        this.isInitialized = false;
        this._warned = new Set();
        this._lastReminderLoadAt = 0;
    }

    init(database, discordClient = null) {
        if (this.isInitialized) {
            console.log('[UserFeatures] Already initialized, skipping');
            return;
        }

        this.database = database;
        this.discordClient = discordClient;
        this.startReminderChecker();
        this.loadRemindersFromDatabase();
        this.isInitialized = true;
        console.log(
            `[UserFeatures] Service initialized${ 
                discordClient ? ' with Discord client' : ' (no Discord client)'}`
        );
    }

    setDiscordClient(client) {
        this.discordClient = client;
        console.log('[UserFeatures] Discord client attached');
    }

    async loadRemindersFromDatabase() {
        if (!this.database) {return;}

        if (typeof this.database.getActiveReminders !== 'function') {
            if (!this._warned.has('reminders:getActiveReminders')) {
                this._warned.add('reminders:getActiveReminders');
                console.warn(
                    '[UserFeatures] Reminder persistence not fully configured (missing database.getActiveReminders).'
                );
            }
            return;
        }

        try {
            const reminders = await this.database.getActiveReminders();
            if (Array.isArray(reminders)) {
                for (const rem of reminders) {
                    const scheduledFor =
                        rem?.scheduledFor instanceof Date
                            ? rem.scheduledFor.getTime()
                            : Number(rem?.scheduledFor);
                    if (!Number.isFinite(scheduledFor)) {continue;}

                    const createdAt =
                        rem?.createdAt instanceof Date
                            ? rem.createdAt.getTime()
                            : Number(rem?.createdAt || Date.now());

                    activeReminders.set(rem.id, { ...rem, scheduledFor, createdAt });
                }
                if (activeReminders.size > 0) {
                    console.log(
                        `[UserFeatures] Loaded ${activeReminders.size} active reminders from database`
                    );
                }
                this._lastReminderLoadAt = Date.now();
                this.checkAndDeliverReminders().catch(() => {});
            }
        } catch (e) {
            console.warn('[UserFeatures] Could not load reminders from database:', e.message);
        }
    }

    // ==================== CONVERSATION THREADING ====================

    getSession(userId, channelId) {
        const key = `${userId}:${channelId}`;
        let session = conversationSessions.get(key);

        if (!session) {
            session = {
                userId,
                channelId,
                messages: [],
                startedAt: Date.now(),
                lastActivity: Date.now(),
                turnCount: 0
            };
            conversationSessions.set(key, session);
        }

        return session;
    }

    addToSession(userId, channelId, role, content) {
        const session = this.getSession(userId, channelId);
        session.messages.push({
            role,
            content,
            timestamp: Date.now()
        });

        // Keep only last 10 messages for context
        if (session.messages.length > 10) {
            session.messages = session.messages.slice(-10);
        }

        session.lastActivity = Date.now();
        session.turnCount++;

        conversationSessions.set(`${userId}:${channelId}`, session);

        // Update stats
        this.incrementStat(userId, 'messageCount');

        return session;
    }

    getConversationContext(userId, channelId) {
        const session = this.getSession(userId, channelId);

        if (session.messages.length === 0) {
            return null;
        }

        // Format for AI context
        const context = session.messages
            .map(m => `${m.role === 'user' ? 'User' : 'Jarvis'}: ${m.content}`)
            .join('\n');

        return {
            context,
            turnCount: session.turnCount,
            sessionDuration: Date.now() - session.startedAt
        };
    }

    clearSession(userId, channelId) {
        conversationSessions.delete(`${userId}:${channelId}`);
    }

    // ==================== TIMEZONE ====================

    async setTimezone(userId, timezone) {
        try {
            // Validate timezone
            Intl.DateTimeFormat(undefined, { timeZone: timezone });
        } catch {
            return {
                success: false,
                error: 'Invalid timezone. Use format like "America/New_York" or "Europe/London".'
            };
        }

        const prefs = await this.getUserPrefs(userId);
        prefs.timezone = timezone;
        await this.saveUserPrefs(userId, prefs);

        return { success: true, timezone };
    }

    async getTimezone(userId) {
        const prefs = await this.getUserPrefs(userId);
        return prefs.timezone || 'UTC';
    }

    async formatTimeForUser(userId, date = new Date()) {
        const timezone = await this.getTimezone(userId);
        return new Intl.DateTimeFormat('en-US', {
            timeZone: timezone,
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
            weekday: 'short',
            month: 'short',
            day: 'numeric'
        }).format(date);
    }

    // ==================== REMINDERS ====================

    parseReminderTime(input, userTimezone = 'UTC') {
        const now = new Date();
        let targetTime = null;
        let humanReadable = '';

        // Match patterns like "in 2 hours", "in 30 minutes", "in 1 day"
        const relativeMatch = input.match(
            /in\s+(\d+)\s*(second|sec|minute|min|hour|hr|day|week)s?/i
        );
        if (relativeMatch) {
            const amount = parseInt(relativeMatch[1], 10);
            const unit = relativeMatch[2].toLowerCase();

            const multipliers = {
                second: 1000,
                sec: 1000,
                minute: 60000,
                min: 60000,
                hour: 3600000,
                hr: 3600000,
                day: 86400000,
                week: 604800000
            };

            const ms = amount * (multipliers[unit] || 60000);
            targetTime = new Date(now.getTime() + ms);
            humanReadable = `in ${amount} ${unit}${amount > 1 ? 's' : ''}`;
        }

        // Match "at 3pm", "at 15:00"
        const atTimeMatch = input.match(/at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
        if (atTimeMatch && !targetTime) {
            let hours = parseInt(atTimeMatch[1], 10);
            const minutes = parseInt(atTimeMatch[2] || '0', 10);
            const period = atTimeMatch[3]?.toLowerCase();

            if (period === 'pm' && hours < 12) {hours += 12;}
            if (period === 'am' && hours === 12) {hours = 0;}

            targetTime = new Date(now);
            targetTime.setHours(hours, minutes, 0, 0);

            // If time already passed today, schedule for tomorrow
            if (targetTime <= now) {
                targetTime.setDate(targetTime.getDate() + 1);
            }

            humanReadable = `at ${atTimeMatch[0].replace(/^at\s+/i, '')}`;
        }

        // Match "tomorrow", "tomorrow at 9am"
        if (/tomorrow/i.test(input)) {
            targetTime = targetTime || new Date(now);
            targetTime.setDate(targetTime.getDate() + 1);
            if (!atTimeMatch) {
                targetTime.setHours(9, 0, 0, 0); // Default to 9am
            }
            humanReadable = `tomorrow${  atTimeMatch ? ` ${humanReadable}` : ' at 9:00 AM'}`;
        }

        return targetTime ? { time: targetTime, humanReadable } : null;
    }

    async createReminder(userId, channelId, message, timeInput) {
        const timezone = await this.getTimezone(userId);
        const parsed = this.parseReminderTime(timeInput, timezone);

        if (!parsed) {
            return {
                success: false,
                error: 'Could not parse time. Try "in 2 hours", "at 3pm", or "tomorrow".'
            };
        }

        const reminder = {
            id: `rem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            userId,
            channelId,
            message,
            scheduledFor: parsed.time.getTime(),
            createdAt: Date.now(),
            humanTime: parsed.humanReadable
        };

        activeReminders.set(reminder.id, reminder);

        // Persist to database
        if (this.database && typeof this.database.saveReminder === 'function') {
            try {
                await this.database.saveReminder(reminder);
            } catch (e) {
                console.error('[Reminders] Failed to persist:', e);
            }
        } else if (this.database) {
            if (!this._warned.has('reminders:saveReminder')) {
                this._warned.add('reminders:saveReminder');
                console.warn(
                    '[UserFeatures] Reminder persistence not fully configured (missing database.saveReminder).'
                );
            }
        }

        this.incrementStat(userId, 'remindersCreated');

        return {
            success: true,
            reminder,
            formattedTime: await this.formatTimeForUser(userId, parsed.time)
        };
    }

    async getUserReminders(userId) {
        const reminders = [];
        for (const [, rem] of activeReminders) {
            if (rem.userId === userId && rem.scheduledFor > Date.now()) {
                reminders.push(rem);
            }
        }
        return reminders.sort((a, b) => a.scheduledFor - b.scheduledFor);
    }

    async cancelReminder(userId, reminderId) {
        const reminder = activeReminders.get(reminderId);
        if (!reminder || reminder.userId !== userId) {
            return { success: false, error: 'Reminder not found.' };
        }

        activeReminders.delete(reminderId);

        if (this.database && typeof this.database.deleteReminder === 'function') {
            try {
                await this.database.deleteReminder(reminderId);
            } catch (e) {
                console.error('[Reminders] Failed to delete:', e);
            }
        } else if (this.database) {
            if (!this._warned.has('reminders:deleteReminder')) {
                this._warned.add('reminders:deleteReminder');
                console.warn(
                    '[UserFeatures] Reminder persistence not fully configured (missing database.deleteReminder).'
                );
            }
        }

        return { success: true };
    }

    startReminderChecker() {
        if (this.reminderCheckInterval) {return;}

        // Check every 15 seconds for better accuracy
        this.reminderCheckInterval = setInterval(() => {
            this.checkAndDeliverReminders();
        }, 15000);
        this.reminderCheckInterval.unref();

        console.log('[UserFeatures] Reminder checker started (15s interval)');
    }

    stopReminderChecker() {
        if (this.reminderCheckInterval) {
            clearInterval(this.reminderCheckInterval);
            this.reminderCheckInterval = null;
            console.log('[UserFeatures] Reminder checker stopped');
        }
    }

    async checkAndDeliverReminders() {
        if (this.database?.isConnected && typeof this.database.getActiveReminders === 'function') {
            const now = Date.now();
            if (
                activeReminders.size === 0 &&
                now - (this._lastReminderLoadAt || 0) > 5 * 60 * 1000
            ) {
                this._lastReminderLoadAt = now;
                await this.loadRemindersFromDatabase();
            }
        }

        const now = Date.now();

        const dueIds = [];
        for (const [id, reminder] of activeReminders) {
            if (reminder?.scheduledFor <= now) {
                dueIds.push(id);
            }
        }

        if (dueIds.length === 0) {return;}

        console.log(`[UserFeatures] Processing ${dueIds.length} due reminder(s)`);

        for (const id of dueIds) {
            const reminder = activeReminders.get(id);
            if (!reminder) {continue;}

            const ok = await this.deliverReminder(reminder);
            if (ok) {
                activeReminders.delete(id);
                if (this.database?.deleteReminder) {
                    await this.database.deleteReminder(id).catch(() => {});
                }
                continue;
            }

            const retryCount = Number(reminder.retryCount) || 0;
            const retryDelayMs = 5 * 60 * 1000;
            const nextRetryAt = Date.now() + retryDelayMs;

            reminder.retryCount = retryCount + 1;
            reminder.scheduledFor = nextRetryAt;
            reminder.updatedAt = Date.now();
            activeReminders.set(id, reminder);

            if (this.database?.saveReminder) {
                await this.database.saveReminder(reminder).catch(() => {});
            }

            console.warn(`[UserFeatures] Reminder ${id} delivery failed; retrying in 5 minutes`);
        }
    }

    async deliverReminder(reminder) {
        if (!this.discordClient) {
            console.warn('[UserFeatures] Cannot deliver reminder - no Discord client');
            return false;
        }

        const reminderEmbed = {
            color: 0x3498db,
            title: '⏰ Reminder',
            description: reminder.message,
            footer: {
                text: `Set ${this.formatRelativeTime(reminder.createdAt)}`
            },
            timestamp: new Date().toISOString()
        };

        const trySendToChannel = async() => {
            const { channelId } = reminder;
            if (!channelId) {return false;}
            const channel = await this.discordClient.channels.fetch(channelId).catch(() => null);
            if (!channel || typeof channel.send !== 'function') {
                return false;
            }
            await safeSend(channel, {
                content: `<@${reminder.userId}> ⏰ Reminder: ${reminder.message}`,
                allowedMentions: { users: [reminder.userId] }
            }, this.discordClient);
            return true;
        };

        try {
            const user = await this.discordClient.users.fetch(reminder.userId).catch(() => null);
            if (!user) {
                console.warn(`[UserFeatures] Could not find user ${reminder.userId} for reminder`);
                return await trySendToChannel().catch(() => false);
            }

            const dmChannel = await user.createDM().catch(() => null);
            if (!dmChannel) {
                console.warn(`[UserFeatures] Could not create DM with user ${reminder.userId}`);
                return await trySendToChannel().catch(() => false);
            }

            await safeDM(user, {
                content: `Hey <@${reminder.userId}>, here's your reminder:`,
                embeds: [reminderEmbed]
            });

            console.log(
                `[UserFeatures] Delivered reminder to ${user.tag}: "${reminder.message.substring(0, 50)}..."`
            );
            return true;
        } catch (error) {
            console.error(
                `[UserFeatures] Failed to deliver reminder ${reminder.id}:`,
                error.message
            );
            return await trySendToChannel().catch(() => false);
        }
    }

    formatRelativeTime(timestamp) {
        const seconds = Math.floor((Date.now() - timestamp) / 1000);

        if (seconds < 60) {return 'just now';}
        if (seconds < 3600) {return `${Math.floor(seconds / 60)} minute(s) ago`;}
        if (seconds < 86400) {return `${Math.floor(seconds / 3600)} hour(s) ago`;}
        return `${Math.floor(seconds / 86400)} day(s) ago`;
    }

    getActiveReminderCount() {
        return activeReminders.size;
    }

    // ==================== CUSTOM WAKE WORDS ====================

    _validateWakeWord(wakeWord) {
        if (!wakeWord || wakeWord.length < 2 || wakeWord.length > 20) {
            return { valid: false, error: 'Wake word must be 2-20 characters.' };
        }
        const sanitized = wakeWord.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
        if (sanitized.length < 2) {
            return { valid: false, error: 'Wake word must contain letters or numbers.' };
        }
        return { valid: true, sanitized };
    }

    async setWakeWord(userId, wakeWord) {
        const v = this._validateWakeWord(wakeWord);
        if (!v.valid) { return { success: false, error: v.error }; }

        const prefs = await this.getUserPrefs(userId);
        prefs.customWakeWord = v.sanitized;
        await this.saveUserPrefs(userId, prefs);

        return { success: true, wakeWord: v.sanitized };
    }

    async clearWakeWord(userId) {
        const prefs = await this.getUserPrefs(userId);
        prefs.customWakeWord = null;
        await this.saveUserPrefs(userId, prefs);
        return { success: true };
    }

    async getWakeWord(userId) {
        const prefs = await this.getUserPrefs(userId);
        return prefs.customWakeWord || null;
    }

    async matchesWakeWord(userId, content) {
        const customWord = await this.getWakeWord(userId);
        if (!customWord) {return false;}

        const pattern = new RegExp(`\\b${escapeRegex(customWord)}\\b`, 'i');
        return pattern.test(content);
    }

    // ==================== GUILD WAKE WORDS ====================

    async setGuildWakeWord(guildId, wakeWord) {
        const v = this._validateWakeWord(wakeWord);
        if (!v.valid) { return { success: false, error: v.error }; }

        const database = require('./database');
        await database.setGuildWakeWord(guildId, v.sanitized);
        return { success: true, wakeWord: v.sanitized };
    }

    async getGuildWakeWord(guildId) {
        const database = require('./database');
        if (!database.isConnected) {return null;}
        const guildConfig = await database.getGuildConfig(guildId);
        return guildConfig?.customWakeWord || null;
    }

    async removeGuildWakeWord(guildId) {
        const database = require('./database');
        await database.setGuildWakeWord(guildId, null);
        return { success: true };
    }

    async setGuildWakeWordsDisabled(guildId, disabled) {
        const database = require('./database');
        await database.setGuildWakeWordsDisabled(guildId, Boolean(disabled));
        return { success: true, disabled: Boolean(disabled) };
    }

    async isGuildWakeWordsDisabled(guildId) {
        const database = require('./database');
        if (!database.isConnected) {return false;}
        const guildConfig = await database.getGuildConfig(guildId);
        return Boolean(guildConfig?.wakeWordsDisabled);
    }

    async matchesGuildWakeWord(guildId, content) {
        if (!guildId) {return false;}
        const guildWord = await this.getGuildWakeWord(guildId);
        if (!guildWord) {return false;}

        const pattern = new RegExp(`\\b${escapeRegex(guildWord)}\\b`, 'i');
        return pattern.test(content);
    }

    // ==================== STATS ====================

    incrementStat(userId, statName, amount = 1) {
        const key = `${userId}:${statName}`;
        const current = sessionStats.get(key) || 0;
        sessionStats.set(key, current + amount);
    }

    async flushStats(userId) {
        if (!this.database) {return;}

        const prefs = await this.getUserPrefs(userId);
        prefs.stats = prefs.stats || {};

        // Merge session stats
        for (const [key, value] of sessionStats) {
            if (key.startsWith(`${userId}:`)) {
                const statName = key.split(':')[1];
                prefs.stats[statName] = (prefs.stats[statName] || 0) + value;
                sessionStats.delete(key);
            }
        }

        await this.saveUserPrefs(userId, prefs);
    }

    // ==================== MOOD DETECTION ====================

    detectMood(content) {
        if (!content || typeof content !== 'string') {return 'neutral';}

        const lower = content.toLowerCase();
        const scores = { frustrated: 0, excited: 0, sad: 0, confused: 0 };

        for (const [mood, patterns] of Object.entries(MOOD_PATTERNS)) {
            // Check keywords
            for (const keyword of patterns.keywords) {
                if (lower.includes(keyword)) {
                    scores[mood] += 2;
                }
            }

            // Check punctuation patterns
            if (patterns.punctuation && patterns.punctuation.test(content)) {
                scores[mood] += 1;
            }

            // Check caps ratio
            if (patterns.caps > 0) {
                const letters = content.replace(/[^a-zA-Z]/g, '');
                const upperCount = (content.match(/[A-Z]/g) || []).length;
                const capsRatio = letters.length > 0 ? upperCount / letters.length : 0;

                if (capsRatio >= patterns.caps) {
                    scores[mood] += 1;
                }
            }
        }

        // Find highest scoring mood
        let maxScore = 0;
        let detectedMood = 'neutral';

        for (const [mood, score] of Object.entries(scores)) {
            if (score > maxScore && score >= 2) {
                // Minimum threshold
                maxScore = score;
                detectedMood = mood;
            }
        }

        return detectedMood;
    }

    getToneAdjustment(mood) {
        return TONE_ADJUSTMENTS[mood] || '';
    }

    analyzeMoodContext(content) {
        const mood = this.detectMood(content);
        const adjustment = this.getToneAdjustment(mood);

        return {
            mood,
            adjustment,
            shouldAdjust: mood !== 'neutral'
        };
    }

    // ==================== USER PREFERENCES ====================

    async getUserPrefs(userId) {
        // Check cache first
        let prefs = userPrefsCache.get(userId);
        if (prefs) {return prefs;}

        // Load from database
        if (this.database) {
            try {
                const profile = await this.database.getUserProfile(userId);
                prefs = profile?.userFeatures || {};
            } catch {
                prefs = {};
            }
        } else {
            prefs = {};
        }

        userPrefsCache.set(userId, prefs);
        return prefs;
    }

    async saveUserPrefs(userId, prefs) {
        userPrefsCache.set(userId, prefs);

        if (this.database) {
            try {
                await this.database.updateUserProfile(userId, { userFeatures: prefs });
            } catch (e) {
                console.error('[UserFeatures] Failed to save prefs:', e);
            }
        }
    }
}

module.exports = new UserFeaturesService();

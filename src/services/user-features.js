/**
 * User Features Service
 * Handles conversation threading, timezone, reminders, custom wake words, stats, and mood detection
 */

const { LRUCache } = require('lru-cache');

// Conversation threading - tracks multi-turn sessions
const conversationSessions = new LRUCache({
    max: 1000,
    ttl: 1000 * 60 * 10, // 10 minute expiry
});

// User preferences cache (timezone, wake words, etc.)
const userPrefsCache = new LRUCache({
    max: 5000,
    ttl: 1000 * 60 * 30, // 30 minute cache
});

// Reminder storage (in-memory, persisted to DB on set)
const activeReminders = new Map();

// Stats tracking
const sessionStats = new Map();

// Mood patterns for detection
const MOOD_PATTERNS = {
    frustrated: {
        keywords: ['ugh', 'annoying', 'frustrated', 'angry', 'mad', 'stupid', 'broken', 'doesn\'t work', 'not working', 'hate', 'useless', 'trash', 'garbage', 'wtf', 'ffs', 'damn', 'dammit'],
        punctuation: /[!?]{2,}|\.{3,}/,
        caps: 0.5, // 50% caps threshold
    },
    excited: {
        keywords: ['awesome', 'amazing', 'incredible', 'love', 'great', 'fantastic', 'wonderful', 'perfect', 'yay', 'woohoo', 'omg', 'wow'],
        punctuation: /!{2,}/,
        caps: 0.4,
    },
    sad: {
        keywords: ['sad', 'depressed', 'unhappy', 'crying', 'tears', 'lonely', 'alone', 'miss', 'lost', 'heartbroken', 'devastated'],
        punctuation: /\.{3,}/,
        caps: 0,
    },
    confused: {
        keywords: ['confused', 'don\'t understand', 'what do you mean', 'huh', 'what?', 'how?', 'why?', 'makes no sense', 'lost'],
        punctuation: /\?{2,}/,
        caps: 0,
    },
};

// Tone adjustments based on mood
const TONE_ADJUSTMENTS = {
    frustrated: 'The user seems frustrated. Be extra patient, empathetic, and solution-focused. Acknowledge their frustration briefly and get straight to helping.',
    excited: 'The user is excited! Match their energy with enthusiasm while remaining helpful.',
    sad: 'The user seems down. Be gentle, supportive, and encouraging. Show empathy.',
    confused: 'The user is confused. Break things down simply, ask clarifying questions if needed, and be patient.',
    neutral: '', // No adjustment
};

class UserFeaturesService {
    constructor() {
        this.database = null;
        this.reminderCheckInterval = null;
    }

    /**
     * Initialize with database reference
     */
    init(database) {
        this.database = database;
        this.startReminderChecker();
        console.log('[UserFeatures] Service initialized');
    }

    // ==================== CONVERSATION THREADING ====================

    /**
     * Get or create a conversation session for a user in a channel
     */
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
                turnCount: 0,
            };
            conversationSessions.set(key, session);
        }
        
        return session;
    }

    /**
     * Add a message to the conversation session
     */
    addToSession(userId, channelId, role, content) {
        const session = this.getSession(userId, channelId);
        session.messages.push({
            role,
            content,
            timestamp: Date.now(),
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

    /**
     * Get conversation context for AI
     */
    getConversationContext(userId, channelId) {
        const session = this.getSession(userId, channelId);
        
        if (session.messages.length === 0) {
            return null;
        }
        
        // Format for AI context
        const context = session.messages.map(m => 
            `${m.role === 'user' ? 'User' : 'Jarvis'}: ${m.content}`
        ).join('\n');
        
        return {
            context,
            turnCount: session.turnCount,
            sessionDuration: Date.now() - session.startedAt,
        };
    }

    /**
     * Clear a conversation session
     */
    clearSession(userId, channelId) {
        conversationSessions.delete(`${userId}:${channelId}`);
    }

    // ==================== TIMEZONE ====================

    /**
     * Set user timezone
     */
    async setTimezone(userId, timezone) {
        try {
            // Validate timezone
            Intl.DateTimeFormat(undefined, { timeZone: timezone });
        } catch {
            return { success: false, error: 'Invalid timezone. Use format like "America/New_York" or "Europe/London".' };
        }
        
        const prefs = await this.getUserPrefs(userId);
        prefs.timezone = timezone;
        await this.saveUserPrefs(userId, prefs);
        
        return { success: true, timezone };
    }

    /**
     * Get user timezone
     */
    async getTimezone(userId) {
        const prefs = await this.getUserPrefs(userId);
        return prefs.timezone || 'UTC';
    }

    /**
     * Format time for user's timezone
     */
    async formatTimeForUser(userId, date = new Date()) {
        const timezone = await this.getTimezone(userId);
        return new Intl.DateTimeFormat('en-US', {
            timeZone: timezone,
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
            weekday: 'short',
            month: 'short',
            day: 'numeric',
        }).format(date);
    }

    // ==================== REMINDERS ====================

    /**
     * Parse reminder time from natural language
     */
    parseReminderTime(input, userTimezone = 'UTC') {
        const now = new Date();
        let targetTime = null;
        let humanReadable = '';
        
        // Match patterns like "in 2 hours", "in 30 minutes", "in 1 day"
        const relativeMatch = input.match(/in\s+(\d+)\s*(second|sec|minute|min|hour|hr|day|week)s?/i);
        if (relativeMatch) {
            const amount = parseInt(relativeMatch[1], 10);
            const unit = relativeMatch[2].toLowerCase();
            
            const multipliers = {
                'second': 1000, 'sec': 1000,
                'minute': 60000, 'min': 60000,
                'hour': 3600000, 'hr': 3600000,
                'day': 86400000,
                'week': 604800000,
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
            
            if (period === 'pm' && hours < 12) hours += 12;
            if (period === 'am' && hours === 12) hours = 0;
            
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
            humanReadable = 'tomorrow' + (atTimeMatch ? ` ${humanReadable}` : ' at 9:00 AM');
        }
        
        return targetTime ? { time: targetTime, humanReadable } : null;
    }

    /**
     * Create a reminder
     */
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
            humanTime: parsed.humanReadable,
        };
        
        activeReminders.set(reminder.id, reminder);
        
        // Persist to database
        if (this.database) {
            try {
                await this.database.saveReminder(reminder);
            } catch (e) {
                console.error('[Reminders] Failed to persist:', e);
            }
        }
        
        this.incrementStat(userId, 'remindersCreated');
        
        return { 
            success: true, 
            reminder,
            formattedTime: await this.formatTimeForUser(userId, parsed.time),
        };
    }

    /**
     * Get user's reminders
     */
    async getUserReminders(userId) {
        const reminders = [];
        for (const [id, rem] of activeReminders) {
            if (rem.userId === userId && rem.scheduledFor > Date.now()) {
                reminders.push(rem);
            }
        }
        return reminders.sort((a, b) => a.scheduledFor - b.scheduledFor);
    }

    /**
     * Cancel a reminder
     */
    async cancelReminder(userId, reminderId) {
        const reminder = activeReminders.get(reminderId);
        if (!reminder || reminder.userId !== userId) {
            return { success: false, error: 'Reminder not found.' };
        }
        
        activeReminders.delete(reminderId);
        
        if (this.database) {
            try {
                await this.database.deleteReminder(reminderId);
            } catch (e) {
                console.error('[Reminders] Failed to delete:', e);
            }
        }
        
        return { success: true };
    }

    /**
     * Start the reminder checker interval
     */
    startReminderChecker() {
        if (this.reminderCheckInterval) return;
        
        this.reminderCheckInterval = setInterval(() => {
            this.checkReminders();
        }, 30000); // Check every 30 seconds
    }

    /**
     * Check and fire due reminders
     */
    async checkReminders() {
        const now = Date.now();
        const dueReminders = [];
        
        for (const [id, reminder] of activeReminders) {
            if (reminder.scheduledFor <= now) {
                dueReminders.push(reminder);
                activeReminders.delete(id);
            }
        }
        
        return dueReminders;
    }

    // ==================== CUSTOM WAKE WORDS ====================

    /**
     * Set custom wake word for user
     */
    async setWakeWord(userId, wakeWord) {
        if (!wakeWord || wakeWord.length < 2 || wakeWord.length > 20) {
            return { success: false, error: 'Wake word must be 2-20 characters.' };
        }
        
        // Sanitize - alphanumeric only
        const sanitized = wakeWord.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
        if (sanitized.length < 2) {
            return { success: false, error: 'Wake word must contain letters or numbers.' };
        }
        
        const prefs = await this.getUserPrefs(userId);
        prefs.customWakeWord = sanitized;
        await this.saveUserPrefs(userId, prefs);
        
        return { success: true, wakeWord: sanitized };
    }

    /**
     * Get user's custom wake word
     */
    async getWakeWord(userId) {
        const prefs = await this.getUserPrefs(userId);
        return prefs.customWakeWord || null;
    }

    /**
     * Check if message contains user's wake word
     */
    async matchesWakeWord(userId, content) {
        const customWord = await this.getWakeWord(userId);
        if (!customWord) return false;
        
        const pattern = new RegExp(`\\b${customWord}\\b`, 'i');
        return pattern.test(content);
    }

    // ==================== STATS ====================

    /**
     * Increment a stat for user
     */
    incrementStat(userId, statName, amount = 1) {
        const key = `${userId}:${statName}`;
        const current = sessionStats.get(key) || 0;
        sessionStats.set(key, current + amount);
    }

    /**
     * Get user stats
     */
    async getUserStats(userId) {
        const prefs = await this.getUserPrefs(userId);
        
        // Combine persisted stats with session stats
        const stats = {
            messageCount: (prefs.stats?.messageCount || 0) + (sessionStats.get(`${userId}:messageCount`) || 0),
            remindersCreated: (prefs.stats?.remindersCreated || 0) + (sessionStats.get(`${userId}:remindersCreated`) || 0),
            searchesPerformed: (prefs.stats?.searchesPerformed || 0) + (sessionStats.get(`${userId}:searchesPerformed`) || 0),
            commandsUsed: (prefs.stats?.commandsUsed || 0) + (sessionStats.get(`${userId}:commandsUsed`) || 0),
            firstInteraction: prefs.stats?.firstInteraction || Date.now(),
            favoriteHour: prefs.stats?.favoriteHour || null,
        };
        
        return stats;
    }

    /**
     * Persist session stats to database
     */
    async flushStats(userId) {
        if (!this.database) return;
        
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

    /**
     * Detect user mood from message
     */
    detectMood(content) {
        if (!content || typeof content !== 'string') return 'neutral';
        
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
            if (score > maxScore && score >= 2) { // Minimum threshold
                maxScore = score;
                detectedMood = mood;
            }
        }
        
        return detectedMood;
    }

    /**
     * Get tone adjustment prompt based on mood
     */
    getToneAdjustment(mood) {
        return TONE_ADJUSTMENTS[mood] || '';
    }

    /**
     * Analyze message and return mood context for AI
     */
    analyzeMoodContext(content) {
        const mood = this.detectMood(content);
        const adjustment = this.getToneAdjustment(mood);
        
        return {
            mood,
            adjustment,
            shouldAdjust: mood !== 'neutral',
        };
    }

    // ==================== USER PREFERENCES ====================

    /**
     * Get user preferences
     */
    async getUserPrefs(userId) {
        // Check cache first
        let prefs = userPrefsCache.get(userId);
        if (prefs) return prefs;
        
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

    /**
     * Save user preferences
     */
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

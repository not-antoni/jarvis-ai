'use strict';

const fs = require('fs');
const path = require('path');
const { AGENT_CONFIG } = require('./config');

// ============================================================================
// MEMORY SYSTEM
// ============================================================================

class AgentMemory {
    constructor() {
        this.shortTerm = []; // Recent context (in-memory)
        this.workingMemory = {}; // Current task state
        this.goals = []; // Active goals
        this.learnings = []; // Things learned from interactions
        this.longTermPath = path.join(__dirname, '../../../', AGENT_CONFIG.longTermMemoryFile);

        this.loadLongTermMemory();
    }

    loadLongTermMemory() {
        try {
            if (fs.existsSync(this.longTermPath)) {
                const data = JSON.parse(fs.readFileSync(this.longTermPath, 'utf8'));
                this.learnings = data.learnings || [];
                this.goals = data.goals || [];
                console.log(`[SentientCore] Loaded ${this.learnings.length} learnings from memory`);
            }
        } catch (error) {
            console.warn('[SentientCore] Could not load long-term memory:', error.message);
        }
    }

    saveLongTermMemory() {
        try {
            const dir = path.dirname(this.longTermPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(
                this.longTermPath,
                JSON.stringify(
                    {
                        learnings: this.learnings.slice(-50), // Keep last 50
                        goals: this.goals,
                        savedAt: new Date().toISOString()
                    },
                    null,
                    2
                )
            );
        } catch (error) {
            console.warn('[SentientCore] Could not save long-term memory:', error.message);
        }
    }

    addToShortTerm(entry) {
        this.shortTerm.push({
            ...entry,
            timestamp: Date.now()
        });

        // Trim to size limit
        if (this.shortTerm.length > AGENT_CONFIG.shortTermMemorySize) {
            // Move important items to learnings before discarding
            const overflow = this.shortTerm.shift();
            if (overflow.important) {
                this.learn(overflow.content, overflow.category);
            }
        }
    }

    learn(content, category = 'general') {
        this.learnings.push({
            content,
            category,
            learnedAt: Date.now()
        });
        this.saveLongTermMemory();
    }

    addGoal(goal, priority = 'medium') {
        this.goals.push({
            id: Date.now().toString(36),
            goal,
            priority,
            status: 'active',
            createdAt: Date.now(),
            progress: []
        });
        this.saveLongTermMemory();
    }

    /**
     * Search learnings by keyword relevance
     */
    findRelevantLearnings(query, limit = 5) {
        if (!query || this.learnings.length === 0) {return [];}
        const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
        if (words.length === 0) {return this.learnings.slice(-limit);}

        const scored = this.learnings.map(l => {
            const text = (l.content || '').toLowerCase();
            let score = 0;
            for (const w of words) {
                if (text.includes(w)) {score++;}
            }
            // Recency bonus: newer learnings get a small boost
            const age = Date.now() - (l.learnedAt || 0);
            const recencyBonus = Math.max(0, 1 - age / (7 * 24 * 60 * 60 * 1000)); // 7-day decay
            return { learning: l, score: score + recencyBonus * 0.5 };
        });

        return scored
            .filter(s => s.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, limit)
            .map(s => s.learning);
    }

    /**
     * Store a conversation snippet for a user
     */
    rememberConversation(userId, message, role = 'user') {
        if (!this.workingMemory.conversations) {this.workingMemory.conversations = {};}
        if (!this.workingMemory.conversations[userId]) {this.workingMemory.conversations[userId] = [];}
        this.workingMemory.conversations[userId].push({
            role, message: String(message).substring(0, 300), timestamp: Date.now()
        });
        // Keep only last 10 messages per user
        if (this.workingMemory.conversations[userId].length > 10) {
            this.workingMemory.conversations[userId] = this.workingMemory.conversations[userId].slice(-10);
        }
    }

    /**
     * Get recent conversation context for a user
     */
    getConversationContext(userId) {
        return (this.workingMemory.conversations || {})[userId] || [];
    }

    getContext(query) {
        return {
            recentActions: this.shortTerm.slice(-10),
            activeGoals: this.goals.filter(g => g.status === 'active'),
            relevantLearnings: query
                ? this.findRelevantLearnings(query)
                : this.learnings.slice(-20),
            workingMemory: this.workingMemory
        };
    }
}

module.exports = { AgentMemory };

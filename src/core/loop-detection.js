/**
 * Loop Detection Service
 * Detects when AI responses are stuck in unproductive loops
 * Inspired by Google's Gemini CLI implementation
 */

const { LRUCache } = require('lru-cache');
const crypto = require('crypto');

// Configuration
const TOOL_CALL_LOOP_THRESHOLD = 5; // Same tool called 5+ times
const CONTENT_LOOP_THRESHOLD = 4; // Same content 4+ times
const ALTERNATING_LOOP_THRESHOLD = 3; // A-B-A-B pattern 3+ times
const MAX_HISTORY_LENGTH = 50; // Max turns to track
const SIMILARITY_THRESHOLD = 0.85; // 85% similarity = duplicate

// Per-user/channel conversation tracking
const conversationHistory = new LRUCache({
    max: 1000,
    ttl: 1000 * 60 * 30 // 30 minute sessions
});

// Loop detection results cache (avoid re-checking same content)
const loopResultsCache = new LRUCache({
    max: 500,
    ttl: 1000 * 60 * 5 // 5 minute cache
});

/**
 * Loop types that can be detected
 */
const LoopType = {
    NONE: 'none',
    REPETITIVE_CONTENT: 'repetitive_content',
    ALTERNATING_PATTERN: 'alternating_pattern',
    TOOL_CALL_LOOP: 'tool_call_loop',
    SEMANTIC_LOOP: 'semantic_loop'
};

/**
 * Hash content for quick comparison
 */
function hashContent(content) {
    if (!content || typeof content !== 'string') return '';
    const normalized = content.toLowerCase().trim().replace(/\s+/g, ' ');
    return crypto.createHash('md5').update(normalized).digest('hex');
}

/**
 * Calculate simple similarity between two strings
 * Uses character-level Jaccard similarity for speed
 */
function calculateSimilarity(str1, str2) {
    if (!str1 || !str2) return 0;

    const normalize = s => s.toLowerCase().trim().replace(/\s+/g, ' ');
    const a = normalize(str1);
    const b = normalize(str2);

    if (a === b) return 1;
    if (a.length === 0 || b.length === 0) return 0;

    // Use trigrams for better accuracy
    const getTrigrams = s => {
        const trigrams = new Set();
        for (let i = 0; i <= s.length - 3; i++) {
            trigrams.add(s.substring(i, i + 3));
        }
        return trigrams;
    };

    const trigramsA = getTrigrams(a);
    const trigramsB = getTrigrams(b);

    if (trigramsA.size === 0 || trigramsB.size === 0) return 0;

    let intersection = 0;
    for (const t of trigramsA) {
        if (trigramsB.has(t)) intersection++;
    }

    const union = trigramsA.size + trigramsB.size - intersection;
    return union > 0 ? intersection / union : 0;
}

/**
 * Extract key patterns from response for comparison
 */
function extractPatterns(content) {
    if (!content || typeof content !== 'string') return [];

    const patterns = [];

    // Extract sentences
    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 10);
    patterns.push(...sentences.slice(0, 5).map(s => s.trim().toLowerCase()));

    // Extract key phrases (capitalized words, numbers, etc.)
    const keyPhrases = content.match(/[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*|\d+(?:\.\d+)?/g) || [];
    patterns.push(...keyPhrases.slice(0, 10));

    return patterns;
}

class LoopDetectionService {
    constructor() {
        this.enabled = true;
    }

    /**
     * Get conversation key for user/channel
     */
    getKey(userId, channelId) {
        return `${userId}:${channelId}`;
    }

    /**
     * Get or create conversation history for user/channel
     */
    getHistory(userId, channelId) {
        const key = this.getKey(userId, channelId);
        let history = conversationHistory.get(key);

        if (!history) {
            history = {
                turns: [],
                lastCheck: 0,
                loopCount: 0
            };
            conversationHistory.set(key, history);
        }

        return history;
    }

    /**
     * Record an AI response turn
     */
    recordTurn(userId, channelId, content, metadata = {}) {
        const history = this.getHistory(userId, channelId);

        const turn = {
            content: content?.substring(0, 2000) || '', // Limit stored content
            hash: hashContent(content),
            timestamp: Date.now(),
            toolCalls: metadata.toolCalls || [],
            patterns: extractPatterns(content)
        };

        history.turns.push(turn);

        // Keep history bounded
        if (history.turns.length > MAX_HISTORY_LENGTH) {
            history.turns = history.turns.slice(-MAX_HISTORY_LENGTH);
        }

        conversationHistory.set(this.getKey(userId, channelId), history);

        return turn;
    }

    /**
     * Check if the conversation is in a loop
     * @returns {Object} { isLoop: boolean, type: LoopType, confidence: number, message: string }
     */
    checkForLoop(userId, channelId, newContent = null) {
        if (!this.enabled) {
            return { isLoop: false, type: LoopType.NONE, confidence: 0, message: null };
        }

        const history = this.getHistory(userId, channelId);
        const turns = history.turns;

        if (turns.length < 3) {
            return { isLoop: false, type: LoopType.NONE, confidence: 0, message: null };
        }

        // Include new content if provided
        const checkTurns = newContent
            ? [
                  ...turns,
                  {
                      content: newContent,
                      hash: hashContent(newContent),
                      patterns: extractPatterns(newContent)
                  }
              ]
            : turns;

        // Check cache
        const cacheKey = checkTurns
            .slice(-5)
            .map(t => t.hash)
            .join(':');
        const cached = loopResultsCache.get(cacheKey);
        if (cached) return cached;

        let result = { isLoop: false, type: LoopType.NONE, confidence: 0, message: null };

        // 1. Check for exact content repetition
        result = this.checkExactRepetition(checkTurns);
        if (result.isLoop) {
            loopResultsCache.set(cacheKey, result);
            return result;
        }

        // 2. Check for alternating patterns (A-B-A-B)
        result = this.checkAlternatingPattern(checkTurns);
        if (result.isLoop) {
            loopResultsCache.set(cacheKey, result);
            return result;
        }

        // 3. Check for semantic similarity loops
        result = this.checkSemanticLoop(checkTurns);
        if (result.isLoop) {
            loopResultsCache.set(cacheKey, result);
            return result;
        }

        loopResultsCache.set(cacheKey, result);
        return result;
    }

    /**
     * Check for exact content repetition
     */
    checkExactRepetition(turns) {
        const recent = turns.slice(-10);
        const hashCounts = new Map();

        for (const turn of recent) {
            if (!turn.hash) continue;
            const count = (hashCounts.get(turn.hash) || 0) + 1;
            hashCounts.set(turn.hash, count);

            if (count >= CONTENT_LOOP_THRESHOLD) {
                return {
                    isLoop: true,
                    type: LoopType.REPETITIVE_CONTENT,
                    confidence: Math.min(count / CONTENT_LOOP_THRESHOLD, 1),
                    message: `Detected repetitive content (${count} occurrences)`
                };
            }
        }

        return { isLoop: false, type: LoopType.NONE, confidence: 0, message: null };
    }

    /**
     * Check for alternating patterns (A-B-A-B or A-B-C-A-B-C)
     */
    checkAlternatingPattern(turns) {
        const recent = turns.slice(-12);
        if (recent.length < 4)
            return { isLoop: false, type: LoopType.NONE, confidence: 0, message: null };

        const hashes = recent.map(t => t.hash).filter(Boolean);

        // Check for 2-element alternating pattern
        for (let patternLen = 2; patternLen <= 3; patternLen++) {
            if (hashes.length < patternLen * ALTERNATING_LOOP_THRESHOLD) continue;

            const pattern = hashes.slice(-patternLen);
            let matches = 0;

            for (let i = hashes.length - patternLen; i >= 0; i -= patternLen) {
                const chunk = hashes.slice(i, i + patternLen);
                if (chunk.length === patternLen && chunk.every((h, idx) => h === pattern[idx])) {
                    matches++;
                } else {
                    break;
                }
            }

            if (matches >= ALTERNATING_LOOP_THRESHOLD) {
                return {
                    isLoop: true,
                    type: LoopType.ALTERNATING_PATTERN,
                    confidence: Math.min(matches / ALTERNATING_LOOP_THRESHOLD, 1),
                    message: `Detected alternating pattern (${patternLen}-cycle repeated ${matches} times)`
                };
            }
        }

        return { isLoop: false, type: LoopType.NONE, confidence: 0, message: null };
    }

    /**
     * Check for semantic similarity loops (similar but not identical content)
     */
    checkSemanticLoop(turns) {
        const recent = turns.slice(-8);
        if (recent.length < 4)
            return { isLoop: false, type: LoopType.NONE, confidence: 0, message: null };

        let similarCount = 0;
        const last = recent[recent.length - 1];

        for (let i = recent.length - 2; i >= 0; i--) {
            const similarity = calculateSimilarity(last.content, recent[i].content);
            if (similarity >= SIMILARITY_THRESHOLD) {
                similarCount++;
            }
        }

        if (similarCount >= 3) {
            return {
                isLoop: true,
                type: LoopType.SEMANTIC_LOOP,
                confidence: Math.min(similarCount / 4, 1),
                message: `Detected semantically similar responses (${similarCount} similar turns)`
            };
        }

        return { isLoop: false, type: LoopType.NONE, confidence: 0, message: null };
    }

    /**
     * Clear history for a user/channel (call when conversation resets)
     */
    clearHistory(userId, channelId) {
        conversationHistory.delete(this.getKey(userId, channelId));
    }

    /**
     * Clear all conversation histories (call on bot restart or memory pressure)
     */
    clearAll() {
        conversationHistory.clear();
        loopResultsCache.clear();
    }

    /**
     * Get a recovery prompt to help break out of a loop
     */
    getRecoveryPrompt(loopType) {
        const prompts = {
            [LoopType.REPETITIVE_CONTENT]:
                'I notice I may be repeating myself. Let me try a completely different approach to help you.',
            [LoopType.ALTERNATING_PATTERN]:
                'I seem to be going in circles. Let me step back and reconsider your request from scratch.',
            [LoopType.SEMANTIC_LOOP]:
                'My responses are becoming too similar. Let me try to provide something more useful.',
            [LoopType.TOOL_CALL_LOOP]:
                'I appear to be stuck in a repetitive pattern. Let me try a different method.'
        };

        return prompts[loopType] || 'Let me try a different approach.';
    }

    /**
     * Enable/disable loop detection
     */
    setEnabled(enabled) {
        this.enabled = enabled;
    }

    /**
     * Get stats for debugging
     */
    getStats() {
        return {
            enabled: this.enabled,
            activeConversations: conversationHistory.size,
            cachedResults: loopResultsCache.size
        };
    }
}

module.exports = {
    loopDetection: new LoopDetectionService(),
    LoopType,
    calculateSimilarity
};

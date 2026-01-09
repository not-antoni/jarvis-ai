/**
 * Message Queue Manager for Batch AI Analysis
 * 
 * Purpose: Queue messages for batch analysis instead of per-message AI calls
 * - Real-time analysis for: new accounts, first messages, links, high-risk
 * - Batch analysis for: normal messages (every 60s or 50 msgs)
 * - Disk persistence for restart survival
 * - Message ID tracking for post-analysis actions
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Queue storage
const QUEUE_PATH = path.join(__dirname, '..', '..', '..', 'data', 'moderation-queue.json');
const ANALYSIS_LOG_PATH = path.join(__dirname, '..', '..', '..', 'data', 'moderation-analysis-log.json');
const USER_RISK_PATH = path.join(__dirname, '..', '..', '..', 'data', 'user-risk-profiles.json');

// Configuration
const BATCH_INTERVAL_MS = 60 * 1000; // 60 seconds
const BASE_BATCH_SIZE = 50; // Base batch size
const MAX_QUEUE_SIZE = 200; // Max messages in queue
const MAX_ANALYSIS_LOG = 100; // Keep last 100 analysis results
const MAX_RISK_HISTORY = 50; // Keep last 50 risk scores per user

/**
 * Calculate optimal batch size based on queue depth
 * - Small queues (<10): process all immediately
 * - Medium queues (10-50): batches of 10
 * - Large queues (50-100): batches of 20
 * - Huge queues (100+): batches of 30
 */
function getDynamicBatchSize(queueLength) {
    if (queueLength <= 10) return queueLength;
    if (queueLength <= 50) return 10;
    if (queueLength <= 100) return 20;
    return 30;
}

// In-memory state
let messageQueue = []; // [{guildId, channelId, messageId, userId, content, timestamp, context}]
let analysisLog = []; // [{timestamp, guildId, userId, result, messageIds}]
let userRiskProfiles = new Map(); // userId -> {scores: [], lastSeen, totalMessages, flags}
let batchTimer = null;
let isProcessing = false;

// ============ PERSISTENCE ============

function ensureDataDir() {
    const dir = path.dirname(QUEUE_PATH);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function loadQueue() {
    try {
        ensureDataDir();
        if (fs.existsSync(QUEUE_PATH)) {
            const data = JSON.parse(fs.readFileSync(QUEUE_PATH, 'utf8'));
            messageQueue = data.queue || [];
            console.log(`[ModerationQueue] Loaded ${messageQueue.length} queued messages`);
        }
        if (fs.existsSync(ANALYSIS_LOG_PATH)) {
            analysisLog = JSON.parse(fs.readFileSync(ANALYSIS_LOG_PATH, 'utf8')) || [];
        }
        if (fs.existsSync(USER_RISK_PATH)) {
            const riskData = JSON.parse(fs.readFileSync(USER_RISK_PATH, 'utf8')) || {};
            userRiskProfiles = new Map(Object.entries(riskData));
        }
    } catch (error) {
        console.warn('[ModerationQueue] Load failed:', error.message);
    }
}

function saveQueue() {
    try {
        ensureDataDir();
        fs.writeFileSync(QUEUE_PATH, JSON.stringify({ queue: messageQueue, savedAt: Date.now() }));
    } catch (error) {
        console.warn('[ModerationQueue] Save failed:', error.message);
    }
}

function saveAnalysisLog() {
    try {
        ensureDataDir();
        fs.writeFileSync(ANALYSIS_LOG_PATH, JSON.stringify(analysisLog.slice(-MAX_ANALYSIS_LOG)));
    } catch (error) {
        console.warn('[ModerationQueue] Analysis log save failed:', error.message);
    }
}

function saveUserRiskProfiles() {
    try {
        ensureDataDir();
        const obj = Object.fromEntries(userRiskProfiles);
        fs.writeFileSync(USER_RISK_PATH, JSON.stringify(obj));
    } catch (error) {
        console.warn('[ModerationQueue] Risk profiles save failed:', error.message);
    }
}

// ============ QUEUE MANAGEMENT ============

/**
 * Determine if a message should be analyzed in real-time vs batched
 */
function shouldAnalyzeRealtime(context) {
    // Real-time triggers
    if (context.isNewAccount) return true; // Account < 7 days
    if (context.isFirstMessage) return true; // First message in server
    if (context.hasLinks) return true; // Contains URLs
    if (context.hasMassMention) return true; // @everyone/@here
    if (context.riskScore >= 50) return true; // High risk score
    if (context.hasAttachments) return true; // Images to analyze

    return false;
}

/**
 * Add message to batch queue
 */
function queueMessage(message, context) {
    const entry = {
        id: crypto.randomBytes(8).toString('hex'),
        guildId: message.guild?.id,
        channelId: message.channel?.id,
        messageId: message.id,
        userId: message.author.id,
        username: message.author.username,
        content: (message.content || '').substring(0, 500),
        timestamp: Date.now(),
        context: {
            accountAgeDays: context.accountAgeDays,
            memberAgeDays: context.memberAgeDays,
            isFirstMessage: context.isFirstMessage || false,
            riskScore: context.riskScore || 0,
            riskFactors: context.riskFactors || []
        }
    };

    messageQueue.push(entry);

    // Trim queue if too large
    if (messageQueue.length > MAX_QUEUE_SIZE) {
        messageQueue = messageQueue.slice(-MAX_QUEUE_SIZE);
    }

    saveQueue();

    // Check if batch threshold reached
    if (messageQueue.length >= BASE_BATCH_SIZE) {
        triggerBatchAnalysis();
    }

    return entry.id;
}

/**
 * Get queue status
 */
function getQueueStatus() {
    return {
        pendingMessages: messageQueue.length,
        isProcessing,
        oldestMessage: messageQueue[0]?.timestamp || null,
        newestMessage: messageQueue[messageQueue.length - 1]?.timestamp || null
    };
}

/**
 * Get pending messages for dashboard display
 */
function getPendingMessages(guildId = null, limit = 50) {
    let filtered = messageQueue;
    if (guildId) {
        filtered = messageQueue.filter(m => m.guildId === guildId);
    }
    return filtered.slice(-limit).reverse();
}

// ============ BATCH ANALYSIS ============

/**
 * Start the batch timer
 */
function startBatchTimer() {
    if (batchTimer) return;

    batchTimer = setInterval(() => {
        if (messageQueue.length > 0 && !isProcessing) {
            triggerBatchAnalysis();
        }
    }, BATCH_INTERVAL_MS);

    console.log('[ModerationQueue] Batch timer started (60s interval)');
}

/**
 * Trigger batch analysis
 */
async function triggerBatchAnalysis() {
    if (isProcessing || messageQueue.length === 0) return;

    isProcessing = true;
    const batchSize = getDynamicBatchSize(messageQueue.length);
    const batch = messageQueue.splice(0, batchSize);
    saveQueue();

    console.log(`[ModerationQueue] Processing batch of ${batch.length} messages`);

    try {
        const result = await analyzeBatch(batch);

        // Log the analysis
        analysisLog.push({
            timestamp: Date.now(),
            messageCount: batch.length,
            flaggedCount: result.flagged?.length || 0,
            result: result.summary,
            messageIds: batch.map(m => m.messageId)
        });
        saveAnalysisLog();

        // Update user risk profiles
        for (const msg of batch) {
            updateUserRiskProfile(msg.userId, msg.context.riskScore || 0, result.flagged?.includes(msg.messageId));
        }
        saveUserRiskProfiles();

        // Execute actions on flagged messages
        if (result.flagged && result.flagged.length > 0) {
            await executeQueuedActions(result);
        }

    } catch (error) {
        console.error('[ModerationQueue] Batch analysis failed:', error.message);
        // Put messages back in queue on failure
        messageQueue.unshift(...batch);
        saveQueue();
    } finally {
        isProcessing = false;
    }
}

/**
 * Analyze a batch of messages with AI
 */
async function analyzeBatch(batch) {
    if (batch.length === 0) return { flagged: [], summary: 'Empty batch' };

    try {
        const aiManager = require('../ai-providers');

        // Build context for batch analysis
        const batchContext = batch.map((m, i) =>
            `[MSG${i + 1}] User: ${m.username} (${m.userId}) | Age: ${m.context.accountAgeDays}d | Risk: ${m.context.riskScore}%\nContent: ${m.content}`
        ).join('\n\n');

        const systemPrompt = `You are a batch content moderation system. Analyze these ${batch.length} messages for patterns.

Look for:
- COORDINATED ATTACKS: Same/similar messages from multiple users
- SCAM PATTERNS: Crypto, fake giveaways, phishing across messages
- SPAM CAMPAIGNS: Promotional content from multiple accounts
- RAID INDICATORS: Suspicious timing or content correlation

Respond with:
FLAGGED_INDICES: [comma-separated indices of suspicious messages, e.g., 1,3,5 or NONE]
PATTERN: [detected pattern or "none"]
SEVERITY: [low/medium/high/critical]
SUMMARY: [brief analysis]`;

        const response = await aiManager.generateResponse(systemPrompt, batchContext, 300);

        if (!response?.content) {
            return { flagged: [], summary: 'AI returned empty response' };
        }

        // Parse response
        const content = response.content;
        const flaggedMatch = content.match(/FLAGGED_INDICES:\s*\[?([^\]\n]+)\]?/i);
        const patternMatch = content.match(/PATTERN:\s*(.+)/i);
        const severityMatch = content.match(/SEVERITY:\s*(low|medium|high|critical)/i);
        const summaryMatch = content.match(/SUMMARY:\s*(.+)/i);

        let flaggedIndices = [];
        if (flaggedMatch && flaggedMatch[1].toLowerCase() !== 'none') {
            flaggedIndices = flaggedMatch[1].split(',')
                .map(s => parseInt(s.trim()) - 1) // Convert to 0-indexed
                .filter(i => !isNaN(i) && i >= 0 && i < batch.length);
        }

        const flaggedMessageIds = flaggedIndices.map(i => batch[i]?.messageId).filter(Boolean);

        return {
            flagged: flaggedMessageIds,
            flaggedDetails: flaggedIndices.map(i => batch[i]),
            pattern: patternMatch?.[1] || 'none',
            severity: severityMatch?.[1] || 'low',
            summary: summaryMatch?.[1] || 'Analysis complete'
        };

    } catch (error) {
        console.error('[ModerationQueue] AI batch analysis error:', error.message);
        return { flagged: [], summary: `Error: ${error.message}` };
    }
}

/**
 * Execute actions on flagged messages from queue
 */
async function executeQueuedActions(result) {
    // This would need access to Discord client - handled by moderation.js
    console.log(`[ModerationQueue] ${result.flagged.length} messages flagged: ${result.pattern}`);

    // Emit event for moderation.js to handle
    if (typeof global.moderationQueueCallback === 'function') {
        global.moderationQueueCallback(result);
    }
}

// ============ USER RISK PROFILES ============

/**
 * Update user's risk profile
 */
function updateUserRiskProfile(userId, riskScore, wasFlagged) {
    let profile = userRiskProfiles.get(userId) || {
        scores: [],
        lastSeen: null,
        totalMessages: 0,
        flaggedCount: 0,
        averageRisk: 0
    };

    profile.scores.push({ score: riskScore, timestamp: Date.now(), flagged: wasFlagged });
    if (profile.scores.length > MAX_RISK_HISTORY) {
        profile.scores = profile.scores.slice(-MAX_RISK_HISTORY);
    }

    profile.lastSeen = Date.now();
    profile.totalMessages++;
    if (wasFlagged) profile.flaggedCount++;

    // Calculate average risk
    profile.averageRisk = Math.round(
        profile.scores.reduce((sum, s) => sum + s.score, 0) / profile.scores.length
    );

    userRiskProfiles.set(userId, profile);
}

/**
 * Get user risk profile
 */
function getUserRiskProfile(userId) {
    return userRiskProfiles.get(userId) || null;
}

/**
 * Get all user risk profiles for a guild
 */
function getGuildUserProfiles(guildId, limit = 50) {
    // Filter would need guild association - for now return top by risk
    const profiles = Array.from(userRiskProfiles.entries())
        .map(([userId, profile]) => ({ userId, ...profile }))
        .sort((a, b) => b.averageRisk - a.averageRisk)
        .slice(0, limit);

    return profiles;
}

// ============ ANALYSIS LOGS ============

/**
 * Get recent analysis logs
 */
function getAnalysisLogs(limit = 50) {
    return analysisLog.slice(-limit).reverse();
}

/**
 * Get analysis logs for a specific guild
 */
function getGuildAnalysisLogs(guildId, limit = 50) {
    return analysisLog
        .filter(log => log.guildId === guildId)
        .slice(-limit)
        .reverse();
}

// ============ INIT ============

// Load on startup
loadQueue();
startBatchTimer();

module.exports = {
    // Queue management
    queueMessage,
    shouldAnalyzeRealtime,
    getQueueStatus,
    getPendingMessages,
    triggerBatchAnalysis,

    // User profiles
    getUserRiskProfile,
    getGuildUserProfiles,
    updateUserRiskProfile,

    // Analysis logs
    getAnalysisLogs,
    getGuildAnalysisLogs,

    // For moderation.js to register callback
    setQueueCallback: (callback) => { global.moderationQueueCallback = callback; }
};

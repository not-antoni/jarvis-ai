/**
 * Cross-Guild Threat Sharing Database
 * 
 * Shares scammer/threat IDs across all guilds where Jarvis operates.
 * Enables proactive blocking of known bad actors.
 */

const fs = require('fs');
const path = require('path');

// Storage paths
const THREAT_DB_PATH = path.join(__dirname, '..', '..', '..', 'data', 'global-threat-db.json');
const USER_OFFENSES_PATH = path.join(__dirname, '..', '..', '..', 'data', 'user-offenses.json');

// In-memory caches
let globalThreats = new Map(); // oduserId -> {reason, reportedBy, reportedAt, severity, guilds}
let userOffenses = new Map(); // oduserId -> [{guildId, offense, timestamp, action}]

// ============ PERSISTENCE ============

function ensureDataDir() {
    const dir = path.dirname(THREAT_DB_PATH);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function loadThreatDB() {
    try {
        ensureDataDir();
        if (fs.existsSync(THREAT_DB_PATH)) {
            const data = JSON.parse(fs.readFileSync(THREAT_DB_PATH, 'utf8'));
            globalThreats = new Map(Object.entries(data.threats || {}));
            console.log(`[ThreatDB] Loaded ${globalThreats.size} global threats`);
        }
        if (fs.existsSync(USER_OFFENSES_PATH)) {
            const data = JSON.parse(fs.readFileSync(USER_OFFENSES_PATH, 'utf8'));
            userOffenses = new Map(Object.entries(data));
        }
    } catch (error) {
        console.warn('[ThreatDB] Load failed:', error.message);
    }
}

function saveThreatDB() {
    try {
        ensureDataDir();
        fs.writeFileSync(THREAT_DB_PATH, JSON.stringify({
            threats: Object.fromEntries(globalThreats),
            savedAt: Date.now()
        }));
    } catch (error) {
        console.warn('[ThreatDB] Save failed:', error.message);
    }
}

function saveUserOffenses() {
    try {
        ensureDataDir();
        fs.writeFileSync(USER_OFFENSES_PATH, JSON.stringify(Object.fromEntries(userOffenses)));
    } catch (error) {
        console.warn('[ThreatDB] Offenses save failed:', error.message);
    }
}

// ============ THREAT DATABASE ============

/**
 * Report a user as a threat (cross-guild)
 */
function reportThreat(userId, guildId, reason, severity = 'medium', reportedBy = 'system') {
    const existing = globalThreats.get(userId) || {
        reason: '',
        reportedBy,
        reportedAt: Date.now(),
        severity,
        guilds: [],
        reportCount: 0
    };

    // Update threat info
    existing.reason = reason;
    existing.severity = severity;
    existing.reportCount++;
    existing.lastReportedAt = Date.now();

    if (!existing.guilds.includes(guildId)) {
        existing.guilds.push(guildId);
    }

    // Escalate severity if reported by multiple guilds
    if (existing.guilds.length >= 3 && existing.severity !== 'critical') {
        existing.severity = 'high';
    }
    if (existing.guilds.length >= 5) {
        existing.severity = 'critical';
    }

    globalThreats.set(userId, existing);
    saveThreatDB();

    return existing;
}

/**
 * Check if user is a known threat
 */
function isKnownThreat(userId) {
    return globalThreats.get(userId) || null;
}

/**
 * Get all known threats
 */
function getAllThreats(limit = 100) {
    return Array.from(globalThreats.entries())
        .map(([userId, data]) => ({ userId, ...data }))
        .sort((a, b) => b.reportCount - a.reportCount)
        .slice(0, limit);
}

/**
 * Remove a threat (false positive)
 */
function removeThreat(userId) {
    const existed = globalThreats.has(userId);
    globalThreats.delete(userId);
    saveThreatDB();
    return existed;
}

// ============ USER OFFENSES (for auto-escalation) ============

/**
 * Record an offense for a user
 */
function recordOffense(userId, guildId, offense, action, severity) {
    const offenses = userOffenses.get(userId) || [];

    offenses.push({
        guildId,
        offense,
        action,
        severity,
        timestamp: Date.now()
    });

    // Keep last 50 offenses per user
    if (offenses.length > 50) {
        offenses.splice(0, offenses.length - 50);
    }

    userOffenses.set(userId, offenses);
    saveUserOffenses();

    return offenses;
}

/**
 * Get recent offenses for a user (for escalation calculation)
 */
function getRecentOffenses(userId, guildId, windowHours = 24) {
    const offenses = userOffenses.get(userId) || [];
    const cutoff = Date.now() - (windowHours * 60 * 60 * 1000);

    return offenses.filter(o =>
        o.guildId === guildId && o.timestamp > cutoff
    );
}

/**
 * Calculate escalated action based on offense history
 * Escalation path: warn -> mute -> kick -> ban
 */
function getEscalatedAction(userId, guildId, baseAction, settings) {
    if (!settings.autoEscalation) return baseAction;

    const recentOffenses = getRecentOffenses(userId, guildId, settings.escalationWindow || 24);
    const offenseCount = recentOffenses.length;

    if (offenseCount < settings.escalationThreshold) {
        return baseAction;
    }

    // Escalation path
    const escalationPath = ['warn', 'mute', 'kick', 'ban'];
    const currentIndex = escalationPath.indexOf(baseAction);

    if (currentIndex === -1) return baseAction;

    // Escalate based on number of thresholds exceeded
    const escalationLevel = Math.floor(offenseCount / settings.escalationThreshold);
    const newIndex = Math.min(currentIndex + escalationLevel, escalationPath.length - 1);

    return escalationPath[newIndex];
}

/**
 * Clear offenses for a user (after ban or appeal)
 */
function clearOffenses(userId, guildId = null) {
    if (guildId) {
        const offenses = userOffenses.get(userId) || [];
        const filtered = offenses.filter(o => o.guildId !== guildId);
        userOffenses.set(userId, filtered);
    } else {
        userOffenses.delete(userId);
    }
    saveUserOffenses();
}

// ============ STATS ============

function getThreatStats() {
    const threats = Array.from(globalThreats.values());
    return {
        totalThreats: globalThreats.size,
        bySeverity: {
            critical: threats.filter(t => t.severity === 'critical').length,
            high: threats.filter(t => t.severity === 'high').length,
            medium: threats.filter(t => t.severity === 'medium').length,
            low: threats.filter(t => t.severity === 'low').length
        },
        multiGuildThreats: threats.filter(t => t.guilds.length >= 2).length
    };
}

// Load on startup
loadThreatDB();

module.exports = {
    // Threat database
    reportThreat,
    isKnownThreat,
    getAllThreats,
    removeThreat,
    getThreatStats,

    // Offense tracking
    recordOffense,
    getRecentOffenses,
    getEscalatedAction,
    clearOffenses
};

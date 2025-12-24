/**
 * Duration parsing utility
 * Parses strings like "10m", "1h", "30s", "7d", "1w" into milliseconds
 */

const MULTIPLIERS = {
    s: 1000,           // seconds
    m: 60 * 1000,      // minutes
    h: 60 * 60 * 1000, // hours
    d: 24 * 60 * 60 * 1000, // days
    w: 7 * 24 * 60 * 60 * 1000 // weeks
};

/**
 * Parse a duration string into milliseconds
 * @param {string} str - Duration string (e.g., "10m", "1h", "30s")
 * @param {string} defaultUnit - Default unit if none provided (default: 'm')
 * @returns {number|null} - Duration in milliseconds, or null if invalid
 */
function parseDuration(str, defaultUnit = 'm') {
    if (!str || typeof str !== 'string') return null;

    const match = str.trim().match(/^(\d+)(s|m|h|d|w)?$/i);
    if (!match) return null;

    const amount = parseInt(match[1], 10);
    if (amount <= 0 || !Number.isFinite(amount)) return null;

    const unit = (match[2] || defaultUnit).toLowerCase();
    const multiplier = MULTIPLIERS[unit];

    if (!multiplier) return null;

    return amount * multiplier;
}

/**
 * Format milliseconds into a human-readable duration string
 * @param {number} ms - Duration in milliseconds
 * @returns {string} - Formatted duration (e.g., "2 hours", "30 minutes")
 */
function formatDuration(ms) {
    if (!ms || ms < 1000) return '0 seconds';

    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const weeks = Math.floor(days / 7);

    if (weeks > 0) return `${weeks} week${weeks !== 1 ? 's' : ''}`;
    if (days > 0) return `${days} day${days !== 1 ? 's' : ''}`;
    if (hours > 0) return `${hours} hour${hours !== 1 ? 's' : ''}`;
    if (minutes > 0) return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
    return `${seconds} second${seconds !== 1 ? 's' : ''}`;
}

/**
 * Discord timeout limit (28 days in milliseconds)
 */
const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000;

module.exports = {
    parseDuration,
    formatDuration,
    MAX_TIMEOUT_MS,
    MULTIPLIERS
};

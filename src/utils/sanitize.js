/**
 * Input Sanitization Utilities
 */

/**
 * Sanitize Discord pings/mentions to prevent mass pings
 * Neutralizes @everyone, @here, and role mentions
 * @param {string} input - Input string
 * @returns {string} Sanitized string with neutralized mentions
 */
function sanitizePings(input) {
    if (typeof input !== 'string') {return '';}

    return input
        .replace(/@everyone/gi, '@\u200Beveryone') // Zero-width space
        .replace(/@here/gi, '@\u200Bhere')
        .replace(/<@&(\d+)>/g, '@\u200Brole') // Role mentions
        .replace(/<@!?(\d+)>/g, '@\u200Buser'); // User mentions
}

module.exports = { sanitizePings };

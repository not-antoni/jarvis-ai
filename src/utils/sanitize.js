/**
 * Input Sanitization Utilities
 * Provides functions to sanitize and validate user inputs
 */

const constants = require('../core/constants');

/**
 * Sanitize string input
 * @param {string} input - Input string to sanitize
 * @param {Object} options - Sanitization options
 * @returns {string} Sanitized string
 */
function sanitizeString(input, options = {}) {
    if (typeof input !== 'string') {
        if (input === null || input === undefined) return '';
        input = String(input);
    }

    const {
        maxLength = Infinity,
        trim = true,
        removeNullBytes = true,
        normalizeWhitespace = false,
        allowNewlines = true
    } = options;

    let sanitized = input;

    // Remove null bytes
    if (removeNullBytes) {
        sanitized = sanitized.replace(/\0/g, '');
    }

    // Normalize whitespace
    if (normalizeWhitespace) {
        sanitized = sanitized.replace(/\s+/g, ' ');
    }

    // Remove newlines if not allowed
    if (!allowNewlines) {
        sanitized = sanitized.replace(/[\r\n]/g, ' ');
    }

    // Trim
    if (trim) {
        sanitized = sanitized.trim();
    }

    // Enforce max length
    if (maxLength !== Infinity && sanitized.length > maxLength) {
        sanitized = sanitized.substring(0, maxLength);
    }

    return sanitized;
}

/**
 * Sanitize Discord message content
 * @param {string} input - Message content
 * @returns {string} Sanitized message
 */
function sanitizeDiscordMessage(input) {
    return sanitizeString(input, {
        maxLength: constants.DISCORD.MAX_MESSAGE_LENGTH,
        trim: true,
        removeNullBytes: true,
        normalizeWhitespace: false,
        allowNewlines: true
    });
}

/**
 * Sanitize URL
 * @param {string} url - URL to sanitize
 * @returns {string|null} Sanitized URL or null if invalid
 */
function sanitizeUrl(url) {
    if (typeof url !== 'string') return null;

    const trimmed = url.trim();
    if (!trimmed) return null;

    try {
        const parsed = new URL(trimmed);

        // Only allow http/https
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            return null;
        }

        // Check for dangerous patterns
        if (
            parsed.hostname.includes('localhost') ||
            parsed.hostname.includes('127.0.0.1') ||
            parsed.hostname.includes('0.0.0.0')
        ) {
            // Allow localhost in development only
            if (process.env.NODE_ENV === 'production') {
                return null;
            }
        }

        return parsed.toString();
    } catch {
        return null;
    }
}

/**
 * Sanitize MongoDB ObjectId
 * @param {string} id - ObjectId string
 * @returns {string|null} Valid ObjectId or null
 */
function sanitizeObjectId(id) {
    if (typeof id !== 'string') return null;

    const trimmed = id.trim();
    if (!trimmed) return null;

    // MongoDB ObjectId is 24 hex characters
    if (!/^[0-9a-fA-F]{24}$/.test(trimmed)) {
        return null;
    }

    return trimmed;
}

/**
 * Sanitize Discord ID (snowflake)
 * @param {string} id - Discord ID
 * @returns {string|null} Valid Discord ID or null
 */
function sanitizeDiscordId(id) {
    if (typeof id !== 'string') return null;

    const trimmed = id.trim();
    if (!trimmed) return null;

    // Discord snowflakes are 17-19 digit numbers
    if (!/^\d{17,19}$/.test(trimmed)) {
        return null;
    }

    return trimmed;
}

/**
 * Sanitize integer
 * @param {*} value - Value to sanitize
 * @param {Object} options - Options
 * @returns {number|null} Sanitized integer or null
 */
function sanitizeInteger(value, options = {}) {
    const { min = -Infinity, max = Infinity, defaultValue = null } = options;

    if (value === null || value === undefined) return defaultValue;

    const num = parseInt(value, 10);
    if (isNaN(num)) return defaultValue;

    if (num < min || num > max) return defaultValue;

    return num;
}

/**
 * Sanitize boolean
 * @param {*} value - Value to sanitize
 * @param {boolean} defaultValue - Default value
 * @returns {boolean} Sanitized boolean
 */
function sanitizeBoolean(value, defaultValue = false) {
    if (value === true || value === 'true' || value === '1' || value === 1) {
        return true;
    }
    if (value === false || value === 'false' || value === '0' || value === 0) {
        return false;
    }
    return defaultValue;
}

/**
 * Sanitize object (recursive)
 * @param {Object} obj - Object to sanitize
 * @param {Object} schema - Schema defining sanitization rules
 * @returns {Object} Sanitized object
 */
function sanitizeObject(obj, schema) {
    if (!obj || typeof obj !== 'object') return {};

    const sanitized = {};

    for (const [key, rules] of Object.entries(schema)) {
        const value = obj[key];

        if (rules.required && (value === undefined || value === null)) {
            throw new Error(`Required field missing: ${key}`);
        }

        if (value === undefined || value === null) {
            if (rules.default !== undefined) {
                sanitized[key] = rules.default;
            }
            continue;
        }

        switch (rules.type) {
            case 'string':
                sanitized[key] = sanitizeString(value, rules.options || {});
                break;
            case 'url':
                sanitized[key] = sanitizeUrl(value);
                break;
            case 'integer':
                sanitized[key] = sanitizeInteger(value, rules.options || {});
                break;
            case 'boolean':
                sanitized[key] = sanitizeBoolean(value, rules.default || false);
                break;
            case 'object':
                sanitized[key] = sanitizeObject(value, rules.schema || {});
                break;
            case 'array':
                if (Array.isArray(value)) {
                    sanitized[key] = value.map(item => {
                        if (rules.itemType === 'string') {
                            return sanitizeString(item, rules.options || {});
                        }
                        return item;
                    });
                }
                break;
            default:
                sanitized[key] = value;
        }
    }

    return sanitized;
}

/**
 * Remove potentially dangerous characters
 * @param {string} input - Input string
 * @returns {string} Sanitized string
 */
function removeDangerousChars(input) {
    if (typeof input !== 'string') return '';

    return input
        .replace(/[<>]/g, '') // Remove HTML brackets
        .replace(/javascript:/gi, '') // Remove javascript: protocol
        .replace(/on\w+\s*=/gi, '') // Remove event handlers
        .replace(/data:/gi, ''); // Remove data: protocol
}

/**
 * Sanitize Discord pings/mentions to prevent mass pings
 * Neutralizes @everyone, @here, and role mentions
 * @param {string} input - Input string
 * @returns {string} Sanitized string with neutralized mentions
 */
function sanitizePings(input) {
    if (typeof input !== 'string') return '';

    return input
        .replace(/@everyone/gi, '@\u200Beveryone') // Zero-width space
        .replace(/@here/gi, '@\u200Bhere')
        .replace(/<@&(\d+)>/g, '@\u200Brole'); // Role mentions
}

module.exports = {
    sanitizeString,
    sanitizeDiscordMessage,
    sanitizeUrl,
    sanitizeObjectId,
    sanitizeDiscordId,
    sanitizeInteger,
    sanitizeBoolean,
    sanitizeObject,
    removeDangerousChars,
    sanitizePings
};

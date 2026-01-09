/**
 * Log Sanitizer
 * 
 * Masks sensitive data (API keys, tokens, passwords) in log output
 * to prevent accidental exposure in production logs.
 */

// Common secret patterns with their masks
const SECRET_PATTERNS = [
    // API Keys (various formats)
    { pattern: /sk-[a-zA-Z0-9]{48}/g, mask: 'sk-***OPENAI_KEY***' },
    { pattern: /sk-proj-[a-zA-Z0-9-_]{50,}/g, mask: 'sk-proj-***OPENAI_KEY***' },
    { pattern: /gsk_[a-zA-Z0-9]{50,}/g, mask: 'gsk_***GROQ_KEY***' },
    { pattern: /AIza[a-zA-Z0-9_-]{35}/g, mask: '***GOOGLE_KEY***' },
    { pattern: /xai-[a-zA-Z0-9]{50,}/g, mask: 'xai-***XAI_KEY***' },

    // Discord tokens
    { pattern: /[MN][A-Za-z\d]{23,}\.[\w-]{6}\.[\w-]{27,}/g, mask: '***DISCORD_TOKEN***' },
    { pattern: /mfa\.[a-zA-Z0-9_-]{84}/g, mask: '***MFA_TOKEN***' },

    // MongoDB connection strings
    { pattern: /mongodb(\+srv)?:\/\/[^:]+:[^@]+@/gi, mask: 'mongodb://*****:*****@' },

    // Generic secrets
    { pattern: /Bearer\s+[a-zA-Z0-9._-]+/gi, mask: 'Bearer ***TOKEN***' },
    { pattern: /token[=:]["']?[a-zA-Z0-9._-]{20,}["']?/gi, mask: 'token=***MASKED***' },
    { pattern: /password[=:]["']?[^"'\s]+["']?/gi, mask: 'password=***MASKED***' },
    { pattern: /secret[=:]["']?[^"'\s]+["']?/gi, mask: 'secret=***MASKED***' },
    { pattern: /api[_-]?key[=:]["']?[a-zA-Z0-9._-]+["']?/gi, mask: 'api_key=***MASKED***' },

    // Base64 encoded secrets (32+ bytes)
    { pattern: /[A-Za-z0-9+/]{43}=/g, mask: '***BASE64_SECRET***' },

    // IP addresses (optional - may want to keep these)
    // { pattern: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, mask: '***.***.***.***' },

    // Email addresses
    { pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, mask: '***@***.***' },

    // Credit card patterns (basic)
    { pattern: /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g, mask: '****-****-****-****' },
];

/**
 * Mask all secrets in a text string
 * @param {string} text - Text to sanitize
 * @returns {string} - Sanitized text
 */
function maskSecrets(text) {
    if (!text || typeof text !== 'string') return text;

    let sanitized = text;
    for (const { pattern, mask } of SECRET_PATTERNS) {
        sanitized = sanitized.replace(pattern, mask);
    }

    return sanitized;
}

/**
 * Mask secrets in an error object
 * @param {Error} error - Error to sanitize
 * @returns {Error} - Sanitized error
 */
function maskError(error) {
    if (!error) return error;

    const sanitized = new Error(maskSecrets(error.message));
    sanitized.name = error.name;
    sanitized.code = error.code;

    if (error.stack) {
        sanitized.stack = maskSecrets(error.stack);
    }

    return sanitized;
}

/**
 * Create a wrapped console that auto-masks secrets
 * @returns {Object} - Wrapped console object
 */
function createSafeConsole() {
    const safeConsole = {};

    ['log', 'info', 'warn', 'error', 'debug'].forEach(method => {
        safeConsole[method] = (...args) => {
            const sanitizedArgs = args.map(arg => {
                if (typeof arg === 'string') {
                    return maskSecrets(arg);
                }
                if (arg instanceof Error) {
                    return maskError(arg);
                }
                if (typeof arg === 'object' && arg !== null) {
                    try {
                        return JSON.parse(maskSecrets(JSON.stringify(arg)));
                    } catch {
                        return arg;
                    }
                }
                return arg;
            });

            console[method](...sanitizedArgs);
        };
    });

    return safeConsole;
}

/**
 * Sanitize an object's values recursively
 * @param {Object} obj - Object to sanitize
 * @param {Set} sensitiveKeys - Keys to completely redact
 * @returns {Object} - Sanitized object
 */
function sanitizeObject(obj, sensitiveKeys = new Set(['password', 'token', 'secret', 'apiKey', 'key'])) {
    if (!obj || typeof obj !== 'object') return obj;

    const sanitized = Array.isArray(obj) ? [] : {};

    for (const [key, value] of Object.entries(obj)) {
        const lowerKey = key.toLowerCase();

        // Completely redact sensitive keys
        if (sensitiveKeys.has(lowerKey) ||
            lowerKey.includes('password') ||
            lowerKey.includes('secret') ||
            lowerKey.includes('token') ||
            lowerKey.includes('key') && !lowerKey.includes('keyboard')) {
            sanitized[key] = '***REDACTED***';
            continue;
        }

        // Recursively sanitize nested objects
        if (typeof value === 'object' && value !== null) {
            sanitized[key] = sanitizeObject(value, sensitiveKeys);
        } else if (typeof value === 'string') {
            sanitized[key] = maskSecrets(value);
        } else {
            sanitized[key] = value;
        }
    }

    return sanitized;
}

module.exports = {
    maskSecrets,
    maskError,
    createSafeConsole,
    sanitizeObject,
    SECRET_PATTERNS,
};

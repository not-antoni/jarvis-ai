/**
 * Jarvis Error Codes System
 * Provides unique error codes for easier debugging and user support
 */

const ERROR_CODES = {
    // AI Provider errors (J-1xxx)
    AI_NO_PROVIDERS: { code: 'J-1001', message: 'No AI providers available' },
    AI_ALL_FAILED: { code: 'J-1002', message: 'All AI providers failed to respond' },
    AI_TIMEOUT: { code: 'J-1003', message: 'AI response timed out' },
    AI_RATE_LIMITED: { code: 'J-1004', message: 'AI provider rate limited' },
    AI_CONTEXT_TOO_LONG: { code: 'J-1005', message: 'Input exceeds maximum context length' },
    AI_SAFETY_BLOCKED: { code: 'J-1006', message: 'Response blocked by safety filters' },
    
    // Database errors (J-2xxx)
    DB_CONNECTION_FAILED: { code: 'J-2001', message: 'Database connection failed' },
    DB_QUERY_FAILED: { code: 'J-2002', message: 'Database query failed' },
    DB_WRITE_FAILED: { code: 'J-2003', message: 'Failed to write to database' },
    DB_NOT_CONNECTED: { code: 'J-2004', message: 'Database not connected' },
    
    // Memory/Vault errors (J-3xxx)
    VAULT_DECRYPT_FAILED: { code: 'J-3001', message: 'Failed to decrypt memories' },
    VAULT_ENCRYPT_FAILED: { code: 'J-3002', message: 'Failed to encrypt memory' },
    VAULT_KEY_MISSING: { code: 'J-3003', message: 'Encryption key not found' },
    MEMORY_LIMIT_EXCEEDED: { code: 'J-3004', message: 'Memory storage limit reached' },
    
    // Discord/Interaction errors (J-4xxx)
    DISCORD_PERMISSION_DENIED: { code: 'J-4001', message: 'Missing Discord permissions' },
    DISCORD_INTERACTION_EXPIRED: { code: 'J-4002', message: 'Interaction expired' },
    DISCORD_MESSAGE_FAILED: { code: 'J-4003', message: 'Failed to send message' },
    DISCORD_FETCH_FAILED: { code: 'J-4004', message: 'Failed to fetch Discord resource' },
    
    // Search errors (J-5xxx)
    SEARCH_API_FAILED: { code: 'J-5001', message: 'Search API request failed' },
    SEARCH_NO_RESULTS: { code: 'J-5002', message: 'No search results found' },
    SEARCH_BLOCKED: { code: 'J-5003', message: 'Search blocked by safety filters' },
    SEARCH_RATE_LIMITED: { code: 'J-5004', message: 'Search API rate limited' },
    
    // Command errors (J-6xxx)
    COMMAND_NOT_FOUND: { code: 'J-6001', message: 'Command not recognized' },
    COMMAND_INVALID_ARGS: { code: 'J-6002', message: 'Invalid command arguments' },
    COMMAND_COOLDOWN: { code: 'J-6003', message: 'Command on cooldown' },
    COMMAND_DISABLED: { code: 'J-6004', message: 'Command is disabled' },
    
    // User errors (J-7xxx)
    USER_NOT_FOUND: { code: 'J-7001', message: 'User not found' },
    USER_OPTED_OUT: { code: 'J-7002', message: 'User has opted out' },
    USER_BANNED: { code: 'J-7003', message: 'User is banned' },
    
    // General errors (J-9xxx)
    UNKNOWN_ERROR: { code: 'J-9001', message: 'An unknown error occurred' },
    INTERNAL_ERROR: { code: 'J-9002', message: 'Internal server error' },
    CONFIG_MISSING: { code: 'J-9003', message: 'Required configuration missing' },
    FEATURE_DISABLED: { code: 'J-9004', message: 'Feature is disabled' },
};

/**
 * Create a Jarvis error with code
 */
function createJarvisError(errorType, details = null) {
    const errorDef = ERROR_CODES[errorType] || ERROR_CODES.UNKNOWN_ERROR;
    const error = new Error(errorDef.message);
    error.code = errorDef.code;
    error.type = errorType;
    error.details = details;
    error.isJarvisError = true;
    return error;
}

/**
 * Format error for user display (Jarvis style)
 */
function formatErrorForUser(error) {
    if (error?.isJarvisError) {
        return `Technical difficulties, sir. (${error.code}) ${error.message}`;
    }
    
    // Generate a random error code for unknown errors
    const randomId = Math.random().toString(36).substring(2, 6).toUpperCase();
    const code = `J-9999-${randomId}`;
    
    // Log the full error for debugging
    console.error(`[${code}] Unhandled error:`, error);
    
    return `Technical difficulties, sir. (${code}) Please try again shortly.`;
}

/**
 * Log error with code for debugging
 */
function logError(errorType, error, context = {}) {
    const errorDef = ERROR_CODES[errorType] || ERROR_CODES.UNKNOWN_ERROR;
    console.error(`[${errorDef.code}] ${errorDef.message}`, {
        type: errorType,
        error: error?.message || error,
        stack: error?.stack,
        ...context
    });
}

module.exports = {
    ERROR_CODES,
    createJarvisError,
    formatErrorForUser,
    logError
};

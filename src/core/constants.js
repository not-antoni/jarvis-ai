/**
 * Application Constants
 * Centralized constants to avoid magic numbers and strings throughout the codebase
 */

const ONE_DAY_SECONDS = 60 * 60 * 24;

module.exports = {
    // Time constants (in milliseconds)
    TIME: {
        SECOND: 1000,
        MINUTE: 60 * 1000,
        HOUR: 60 * 60 * 1000,
        DAY: 24 * 60 * 60 * 1000,
        WEEK: 7 * 24 * 60 * 60 * 1000,
        MONTH: 30 * 24 * 60 * 60 * 1000
    },

    // Database TTL values (in seconds)
    DB_TTL: {
        NINETY_DAYS: ONE_DAY_SECONDS * 90,
        SIXTY_DAYS: ONE_DAY_SECONDS * 60,
        THIRTY_DAYS: ONE_DAY_SECONDS * 30,
        SEVEN_DAYS: ONE_DAY_SECONDS * 7,
        ONE_DAY: ONE_DAY_SECONDS
    },

    // Rate limiting
    RATE_LIMITS: {
        DEFAULT_COOLDOWN_MS: 5000,
        MAX_REQUESTS_PER_MINUTE: 60,
        MAX_REQUESTS_PER_HOUR: 1000,
        MAX_REQUESTS_PER_DAY: 10000,
        MAX_CONCURRENT_SESSIONS: 5,
        MAX_BYTES_PER_REQUEST: 50 * 1024 * 1024 // 50 MB
    },

    // Discord limits
    DISCORD: {
        MAX_MESSAGE_LENGTH: 2000,
        MAX_EMBED_TITLE_LENGTH: 256,
        MAX_EMBED_DESCRIPTION_LENGTH: 4096,
        MAX_EMBED_FIELD_NAME_LENGTH: 256,
        MAX_EMBED_FIELD_VALUE_LENGTH: 1024,
        MAX_EMBED_FIELDS: 25,
        MAX_EMBED_FOOTER_LENGTH: 2048,
        MAX_EMBED_AUTHOR_NAME_LENGTH: 256,
        MAX_BUTTONS_PER_ROW: 5,
        MAX_ROWS_PER_MESSAGE: 5,
        MAX_SELECT_MENU_OPTIONS: 25
    },

    // AI Provider limits
    AI: {
        DEFAULT_MAX_TOKENS: 1024,
        MAX_TOKENS: 4096,
        DEFAULT_TEMPERATURE: 0.7,
        MIN_TEMPERATURE: 0,
        MAX_TEMPERATURE: 2.0
    },

    // File size limits (in bytes)
    FILE_LIMITS: {
        MAX_IMAGE_SIZE: 10 * 1024 * 1024, // 10 MB
        MAX_FILE_SIZE: 25 * 1024 * 1024, // 25 MB
        MAX_ATTACHMENT_SIZE: 25 * 1024 * 1024 // 25 MB (Discord limit)
    },

    // Cache TTL (in milliseconds)
    CACHE_TTL: {
        SHORT: 60 * 1000, // 1 minute
        MEDIUM: 5 * 60 * 1000, // 5 minutes
        LONG: 60 * 60 * 1000, // 1 hour
        VERY_LONG: 24 * 60 * 60 * 1000 // 24 hours
    },

    // Retry configuration
    RETRY: {
        DEFAULT_MAX_RETRIES: 3,
        DEFAULT_BASE_DELAY_MS: 1000,
        DEFAULT_MAX_DELAY_MS: 30000,
        DEFAULT_JITTER: true
    },

    // Timeout values (in milliseconds)
    TIMEOUT: {
        HTTP_REQUEST: 30000, // 30 seconds
        DATABASE_QUERY: 10000, // 10 seconds
        AI_RESPONSE: 60000, // 60 seconds
        BROWSER_OPERATION: 30000, // 30 seconds
        WEBHOOK_RESPONSE: 3000 // 3 seconds
    },

    // Pagination
    PAGINATION: {
        DEFAULT_PAGE_SIZE: 10,
        MAX_PAGE_SIZE: 100,
        MIN_PAGE_SIZE: 1
    },

    // Encoding/Decoding
    ENCODING: {
        MAX_DECODE_DISPLAY_CHARS: 1800,
        BINARY_PREVIEW_BYTES: 32
    },

    // Webhook
    WEBHOOK: {
        MAX_TIMESTAMP_SKEW_MS: 5 * 60 * 1000, // 5 minutes
        MAX_RETRY_ATTEMPTS: 3,
        MIN_INTERVAL_MS: 750,
        FAILURE_LOG_TTL_MS: 7 * 24 * 60 * 60 * 1000 // 7 days
    },

    // Status codes
    HTTP_STATUS: {
        OK: 200,
        CREATED: 201,
        BAD_REQUEST: 400,
        UNAUTHORIZED: 401,
        FORBIDDEN: 403,
        NOT_FOUND: 404,
        CONFLICT: 409,
        UNPROCESSABLE_ENTITY: 422,
        TOO_MANY_REQUESTS: 429,
        INTERNAL_SERVER_ERROR: 500,
        SERVICE_UNAVAILABLE: 503
    },

    // Error codes
    ERROR_CODES: {
        INVALID_REQUEST: 'INVALID_REQUEST',
        MISSING_PARAMETER: 'MISSING_PARAMETER',
        INVALID_PARAMETER: 'INVALID_PARAMETER',
        UNAUTHORIZED: 'UNAUTHORIZED',
        FORBIDDEN: 'FORBIDDEN',
        NOT_FOUND: 'NOT_FOUND',
        RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
        INTERNAL_ERROR: 'INTERNAL_ERROR',
        SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
        DATABASE_ERROR: 'DATABASE_ERROR',
        EXTERNAL_SERVICE_ERROR: 'EXTERNAL_SERVICE_ERROR'
    }
};

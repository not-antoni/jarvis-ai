# Utilities Documentation

This directory contains reusable utilities for the Jarvis AI Discord Bot.

## Available Utilities

### Logger (`logger.js`)
Structured logging with file and console output.

```javascript
const logger = require('./src/utils/logger');
logger.info('Operation completed', { userId: '123' });
logger.error('Error occurred', { error: error.message });
```

**Features:**
- JSON-formatted logs
- File and console logging
- Log levels (error, warn, info, debug)
- Child loggers with context

**Configuration:**
- `LOG_LEVEL` - Set log level (error, warn, info, debug)
- `LOG_DIR` - Directory for log files (default: ./logs)
- `ENABLE_FILE_LOGGING` - Enable file logging (default: true)
- `ENABLE_CONSOLE_LOGGING` - Enable console logging (default: true)

### Sanitize (`sanitize.js`)
Input sanitization and validation utilities.

```javascript
const { sanitizeString, sanitizeUrl, sanitizeDiscordMessage } = require('./src/utils/sanitize');

// Sanitize Discord message
const clean = sanitizeDiscordMessage(userInput);

// Validate and sanitize URL
const url = sanitizeUrl(userUrl); // Returns null if invalid

// Sanitize with options
const sanitized = sanitizeString(input, {
    maxLength: 100,
    trim: true,
    removeNullBytes: true
});
```

**Functions:**
- `sanitizeString()` - General string sanitization
- `sanitizeDiscordMessage()` - Discord message sanitization
- `sanitizeUrl()` - URL validation and sanitization
- `sanitizeObjectId()` - MongoDB ObjectId validation
- `sanitizeDiscordId()` - Discord snowflake validation
- `sanitizeInteger()` - Integer validation
- `sanitizeBoolean()` - Boolean validation
- `sanitizeObject()` - Object sanitization with schema
- `removeDangerousChars()` - Remove dangerous characters

### Request ID (`request-id.js`)
Request ID generation and tracking for request tracing.

```javascript
const { requestIdMiddleware, getRequestId } = require('./src/utils/request-id');

// Express middleware
app.use(requestIdMiddleware());

// Get current request ID
const requestId = getRequestId();
```

**Features:**
- Automatic request ID generation
- Express middleware
- AsyncLocalStorage support
- X-Request-ID header

### Error Handler (`error-handler.js`)
Centralized error handling with custom error classes.

```javascript
const { 
    ValidationError, 
    NotFoundError, 
    asyncHandler, 
    errorHandler 
} = require('./src/utils/error-handler');

// Express error handler
app.use(errorHandler);

// Async route handler
app.get('/api/users/:id', asyncHandler(async (req, res) => {
    if (!req.params.id) {
        throw new ValidationError('User ID is required');
    }
    // ...
}));
```

**Error Classes:**
- `AppError` - Base error class
- `ValidationError` - Validation errors (400)
- `NotFoundError` - Not found errors (404)
- `UnauthorizedError` - Unauthorized errors (401)
- `ForbiddenError` - Forbidden errors (403)
- `RateLimitError` - Rate limit errors (429)

### Metrics (`metrics.js`)
Performance and system metrics collection.

```javascript
const metrics = require('./src/utils/metrics');

// Record request
metrics.recordRequest('/api/users', 150, true, 200);

// Record error
metrics.recordError(error, { context: 'user-operation' });

// Record AI provider call
metrics.recordAIProviderCall('openai', 1000, 0.002);

// Get metrics
const allMetrics = metrics.getMetrics();

// Get Prometheus format
const prometheusMetrics = metrics.getPrometheusMetrics();
```

**Features:**
- Request tracking
- Performance metrics (p50, p95, p99)
- Error tracking
- AI provider usage tracking
- Prometheus format export
- System metrics

### Constants (`../core/constants.js`)
Application-wide constants.

```javascript
const constants = require('./src/core/constants');

// Discord limits
const maxLength = constants.DISCORD.MAX_MESSAGE_LENGTH;

// Time constants
const timeout = constants.TIMEOUT.HTTP_REQUEST;

// Rate limits
const cooldown = constants.RATE_LIMITS.DEFAULT_COOLDOWN_MS;
```

**Categories:**
- `TIME` - Time constants (milliseconds)
- `DB_TTL` - Database TTL values (seconds)
- `RATE_LIMITS` - Rate limiting constants
- `DISCORD` - Discord API limits
- `AI` - AI provider limits
- `FILE_LIMITS` - File size limits
- `CACHE_TTL` - Cache TTL values
- `RETRY` - Retry configuration
- `TIMEOUT` - Timeout values
- `PAGINATION` - Pagination defaults
- `HTTP_STATUS` - HTTP status codes
- `ERROR_CODES` - Error code constants

## Usage Examples

### Complete Example: Command Handler

```javascript
const logger = require('./src/utils/logger');
const { sanitizeDiscordMessage } = require('./src/utils/sanitize');
const { ValidationError, asyncHandler } = require('./src/utils/error-handler');
const metrics = require('./src/utils/metrics');
const constants = require('./src/core/constants');

app.post('/api/command', asyncHandler(async (req, res) => {
    const startTime = Date.now();
    const requestId = req.requestId;

    try {
        // Sanitize input
        const userInput = sanitizeDiscordMessage(req.body.input);
        if (!userInput || userInput.length === 0) {
            throw new ValidationError('Input is required');
        }

        // Check length
        if (userInput.length > constants.DISCORD.MAX_MESSAGE_LENGTH) {
            throw new ValidationError('Input too long');
        }

        // Process command
        const result = await processCommand(userInput);

        // Record success
        metrics.recordRequest(req.path, Date.now() - startTime, true, 200);
        logger.info('Command processed', { requestId, command: userInput });

        res.json({ success: true, result });
    } catch (error) {
        // Record failure
        metrics.recordRequest(req.path, Date.now() - startTime, false, error.statusCode || 500);
        metrics.recordError(error, { requestId, path: req.path });
        logger.error('Command failed', { requestId, error: error.message });
        throw error; // Let error handler deal with it
    }
}));
```

## Best Practices

1. **Always sanitize user input** before processing
2. **Use logger instead of console.log** for better debugging
3. **Track metrics** for important operations
4. **Use constants** instead of magic numbers
5. **Handle errors** with custom error classes
6. **Include request ID** in logs for tracing

## Environment Variables

See `.env.example` for all available environment variables related to utilities:
- `LOG_LEVEL` - Logging level
- `LOG_DIR` - Log directory
- `ENABLE_FILE_LOGGING` - Enable file logging
- `ENABLE_CONSOLE_LOGGING` - Enable console logging


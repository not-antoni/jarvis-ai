/**
 * API Response Standardizer - Structured error responses, consistent pagination,
 * rate limit headers, and unified response format
 */

class APIResponseStandardizer {
    constructor(config = {}) {
        this.errorCodes = config.errorCodes || this.getDefaultErrorCodes();
        this.pageSize = config.pageSize || 20;
        this.maxPageSize = config.maxPageSize || 100;
    }

    /**
     * Get default error codes
     */
    getDefaultErrorCodes() {
        return {
            // Client errors (4xx)
            INVALID_REQUEST: { code: 40001, httpStatus: 400, message: 'Invalid request' },
            MISSING_PARAMETER: {
                code: 40002,
                httpStatus: 400,
                message: 'Missing required parameter'
            },
            INVALID_PARAMETER: { code: 40003, httpStatus: 400, message: 'Invalid parameter value' },
            UNAUTHORIZED: { code: 40101, httpStatus: 401, message: 'Unauthorized' },
            FORBIDDEN: { code: 40301, httpStatus: 403, message: 'Forbidden' },
            NOT_FOUND: { code: 40401, httpStatus: 404, message: 'Resource not found' },
            CONFLICT: { code: 40901, httpStatus: 409, message: 'Conflict' },
            UNPROCESSABLE: { code: 42201, httpStatus: 422, message: 'Unprocessable entity' },

            // Rate limiting (429)
            RATE_LIMIT_EXCEEDED: { code: 42901, httpStatus: 429, message: 'Rate limit exceeded' },
            MINUTE_LIMIT: { code: 42902, httpStatus: 429, message: 'Minute rate limit exceeded' },
            HOUR_LIMIT: { code: 42903, httpStatus: 429, message: 'Hour rate limit exceeded' },
            DAY_LIMIT: { code: 42904, httpStatus: 429, message: 'Day rate limit exceeded' },
            COST_LIMIT: { code: 42905, httpStatus: 429, message: 'Cost quota exceeded' },

            // Server errors (5xx)
            INTERNAL_ERROR: { code: 50001, httpStatus: 500, message: 'Internal server error' },
            SERVICE_UNAVAILABLE: { code: 50301, httpStatus: 503, message: 'Service unavailable' },
            DATABASE_ERROR: { code: 50002, httpStatus: 500, message: 'Database error' },
            EXTERNAL_SERVICE_ERROR: {
                code: 50201,
                httpStatus: 502,
                message: 'External service error'
            },

            // Agent-specific errors
            AGENT_UNAVAILABLE: { code: 50401, httpStatus: 503, message: 'Agent unavailable' },
            SESSION_EXPIRED: { code: 40902, httpStatus: 409, message: 'Session expired' },
            MAX_SESSIONS_EXCEEDED: {
                code: 42906,
                httpStatus: 429,
                message: 'Max concurrent sessions exceeded'
            },
            BROWSER_CRASH: { code: 50402, httpStatus: 500, message: 'Browser crashed' },
            NAVIGATION_TIMEOUT: { code: 50403, httpStatus: 500, message: 'Navigation timeout' }
        };
    }

    /**
     * Success response
     */
    success(data, metadata = {}) {
        return {
            success: true,
            status: 'ok',
            code: 20000,
            httpStatus: 200,
            data,
            timestamp: Date.now(),
            ...metadata
        };
    }

    /**
     * Paginated response
     */
    paginated(items, pagination = {}, metadata = {}) {
        const page = pagination.page || 1;
        const pageSize = Math.min(pagination.pageSize || this.pageSize, this.maxPageSize);
        const total = pagination.total || items.length;
        const totalPages = Math.ceil(total / pageSize);
        const hasNextPage = page < totalPages;
        const hasPreviousPage = page > 1;

        return {
            success: true,
            status: 'ok',
            code: 20000,
            httpStatus: 200,
            data: items,
            pagination: {
                page,
                pageSize,
                total,
                totalPages,
                hasNextPage,
                hasPreviousPage,
                nextPage: hasNextPage ? page + 1 : null,
                previousPage: hasPreviousPage ? page - 1 : null
            },
            timestamp: Date.now(),
            ...metadata
        };
    }

    /**
     * Error response
     */
    error(errorKey, details = {}, httpOverride = null) {
        const errorDef = this.errorCodes[errorKey] || this.errorCodes['INTERNAL_ERROR'];

        return {
            success: false,
            status: 'error',
            code: errorDef.code,
            httpStatus: httpOverride || errorDef.httpStatus,
            error: {
                type: errorKey,
                message: errorDef.message,
                details,
                timestamp: Date.now()
            }
        };
    }

    /**
     * Rate limit error with retry info
     */
    rateLimitError(errorKey, retryAfterMs, quota = null) {
        const errorDef = this.errorCodes[errorKey] || this.errorCodes['RATE_LIMIT_EXCEEDED'];

        return {
            success: false,
            status: 'rate_limited',
            code: errorDef.code,
            httpStatus: 429,
            error: {
                type: errorKey,
                message: errorDef.message,
                timestamp: Date.now()
            },
            rateLimit: {
                retryAfterMs,
                retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
                ...quota
            }
        };
    }

    /**
     * Validation error with field details
     */
    validationError(fields = {}) {
        return {
            success: false,
            status: 'validation_failed',
            code: 40003,
            httpStatus: 422,
            error: {
                type: 'VALIDATION_ERROR',
                message: 'Validation failed',
                timestamp: Date.now()
            },
            validationErrors: Object.entries(fields).map(([field, details]) => ({
                field,
                message: details.message || 'Invalid value',
                value: details.value,
                expected: details.expected
            }))
        };
    }

    /**
     * Convert error to response
     */
    fromError(error, context = {}) {
        // Try to identify error type
        const message = error.message?.toUpperCase() || '';

        let errorKey = 'INTERNAL_ERROR';

        if (message.includes('TIMEOUT')) errorKey = 'NAVIGATION_TIMEOUT';
        if (message.includes('RATE_LIMIT') || message.includes('429'))
            errorKey = 'RATE_LIMIT_EXCEEDED';
        if (message.includes('UNAUTHORIZED')) errorKey = 'UNAUTHORIZED';
        if (message.includes('FORBIDDEN')) errorKey = 'FORBIDDEN';
        if (message.includes('NOT_FOUND') || message.includes('404')) errorKey = 'NOT_FOUND';
        if (message.includes('SESSION')) errorKey = 'SESSION_EXPIRED';
        if (message.includes('BROWSER')) errorKey = 'BROWSER_CRASH';
        if (message.includes('CRASH')) errorKey = 'BROWSER_CRASH';

        return this.error(errorKey, {
            message: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
            ...context
        });
    }

    /**
     * Add rate limit headers to response
     */
    addRateLimitHeaders(headers, rateInfo = {}) {
        return {
            ...headers,
            'X-RateLimit-Limit': rateInfo.limit?.toString() || '60',
            'X-RateLimit-Remaining': rateInfo.remaining?.toString() || '0',
            'X-RateLimit-Reset': rateInfo.resetAt?.toString() || '0',
            'X-RateLimit-RetryAfter': rateInfo.retryAfterMs?.toString() || '0',
            'X-Cost-Used': rateInfo.costUsed?.toString() || '0',
            'X-Cost-Remaining': rateInfo.costRemaining?.toString() || '0'
        };
    }

    /**
     * Add trace headers
     */
    addTraceHeaders(headers, traceInfo = {}) {
        return {
            ...headers,
            'X-Trace-ID': traceInfo.traceId || 'unknown',
            'X-Span-ID': traceInfo.spanId || 'unknown',
            'X-Request-ID': traceInfo.requestId || 'unknown',
            'X-Duration-Ms': traceInfo.durationMs?.toString() || '0'
        };
    }

    /**
     * Wrap Express middleware
     */
    expressMiddleware(app) {
        // Response formatting helper
        app.use((req, res, next) => {
            // Store original json method
            const originalJson = res.json;

            // Override json method
            res.json = function (data) {
                // If already formatted, send as-is
                if (data && (data.success === true || data.success === false)) {
                    return originalJson.call(this, data);
                }

                // Wrap in success response
                return originalJson.call(this, this.standardizer.success(data));
            };

            // Add helper methods
            res.standardizer = this;
            res.success = (data, metadata) => res.json(this.success(data, metadata));
            res.paginated = (items, pagination) => res.json(this.paginated(items, pagination));
            res.error = (errorKey, details) => {
                const errorResp = this.error(errorKey, details);
                res.status(errorResp.httpStatus);
                return res.json(errorResp);
            };
            res.rateLimit = (errorKey, retryAfterMs, quota) => {
                const errorResp = this.rateLimitError(errorKey, retryAfterMs, quota);
                res.status(429);
                return res.json(errorResp);
            };

            next();
        });
    }

    /**
     * Get response stats
     */
    getHTTPStatusDescriptions() {
        return {
            200: 'OK',
            201: 'Created',
            204: 'No Content',
            400: 'Bad Request',
            401: 'Unauthorized',
            403: 'Forbidden',
            404: 'Not Found',
            409: 'Conflict',
            422: 'Unprocessable Entity',
            429: 'Too Many Requests',
            500: 'Internal Server Error',
            503: 'Service Unavailable'
        };
    }
}

module.exports = APIResponseStandardizer;

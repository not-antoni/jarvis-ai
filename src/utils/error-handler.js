/**
 * Centralized Error Handling
 * Provides consistent error handling patterns across the application
 */

const logger = require('./logger');
const metrics = require('./metrics');
const { getRequestId } = require('./request-id');
const constants = require('../core/constants');

/**
 * Custom error classes
 */
class AppError extends Error {
    constructor(message, statusCode = 500, code = 'INTERNAL_ERROR', metadata = {}) {
        super(message);
        this.name = 'AppError';
        this.statusCode = statusCode;
        this.code = code;
        this.metadata = metadata;
        this.isOperational = true;
        Error.captureStackTrace(this, this.constructor);
    }
}

class ValidationError extends AppError {
    constructor(message, metadata = {}) {
        super(
            message,
            constants.HTTP_STATUS.BAD_REQUEST,
            constants.ERROR_CODES.INVALID_PARAMETER,
            metadata
        );
        this.name = 'ValidationError';
    }
}

class NotFoundError extends AppError {
    constructor(resource, metadata = {}) {
        super(
            `${resource} not found`,
            constants.HTTP_STATUS.NOT_FOUND,
            constants.ERROR_CODES.NOT_FOUND,
            metadata
        );
        this.name = 'NotFoundError';
    }
}

class UnauthorizedError extends AppError {
    constructor(message = 'Unauthorized', metadata = {}) {
        super(
            message,
            constants.HTTP_STATUS.UNAUTHORIZED,
            constants.ERROR_CODES.UNAUTHORIZED,
            metadata
        );
        this.name = 'UnauthorizedError';
    }
}

class ForbiddenError extends AppError {
    constructor(message = 'Forbidden', metadata = {}) {
        super(message, constants.HTTP_STATUS.FORBIDDEN, constants.ERROR_CODES.FORBIDDEN, metadata);
        this.name = 'ForbiddenError';
    }
}

class RateLimitError extends AppError {
    constructor(message = 'Rate limit exceeded', retryAfter = 0, metadata = {}) {
        super(
            message,
            constants.HTTP_STATUS.TOO_MANY_REQUESTS,
            constants.ERROR_CODES.RATE_LIMIT_EXCEEDED,
            {
                ...metadata,
                retryAfter
            }
        );
        this.name = 'RateLimitError';
    }
}

/**
 * Error handler middleware for Express
 */
function errorHandler(err, req, res, next) {
    const requestId = getRequestId() || req.requestId || 'unknown';

    // Log error
    logger.error('Request error', {
        error: {
            name: err.name,
            message: err.message,
            stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
        },
        request: {
            method: req.method,
            path: req.path,
            requestId
        }
    });

    // Record error in metrics
    metrics.recordError(err, {
        requestId,
        method: req.method,
        path: req.path
    });

    // Determine status code
    const statusCode = err.statusCode || err.status || 500;

    // Determine error response
    const isOperational = err.isOperational || false;
    const isDevelopment = process.env.NODE_ENV === 'development';

    const errorResponse = {
        success: false,
        error: {
            code: err.code || constants.ERROR_CODES.INTERNAL_ERROR,
            message: isOperational || isDevelopment ? err.message : 'Internal server error',
            requestId
        }
    };

    // Add stack trace in development
    if (isDevelopment && err.stack) {
        errorResponse.error.stack = err.stack;
    }

    // Add metadata if present
    if (err.metadata && Object.keys(err.metadata).length > 0) {
        errorResponse.error.metadata = err.metadata;
    }

    // Add retry-after header for rate limit errors
    if (err instanceof RateLimitError && err.metadata.retryAfter) {
        res.setHeader('Retry-After', Math.ceil(err.metadata.retryAfter / 1000));
    }

    res.status(statusCode).json(errorResponse);
}

/**
 * Async error wrapper
 * Wraps async route handlers to catch errors
 */
function asyncHandler(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

/**
 * Handle unhandled promise rejections
 */
function setupUnhandledRejectionHandler() {
    process.on('unhandledRejection', (reason, promise) => {
        logger.error('Unhandled promise rejection', {
            reason:
                reason instanceof Error
                    ? {
                          name: reason.name,
                          message: reason.message,
                          stack: reason.stack
                      }
                    : reason,
            promise
        });

        metrics.recordError(reason instanceof Error ? reason : new Error(String(reason)), {
            type: 'unhandledRejection'
        });
    });
}

/**
 * Handle uncaught exceptions
 */
function setupUncaughtExceptionHandler() {
    process.on('uncaughtException', error => {
        logger.error('Uncaught exception', {
            error: {
                name: error.name,
                message: error.message,
                stack: error.stack
            }
        });

        metrics.recordError(error, { type: 'uncaughtException' });

        // Give time for logs to flush, then exit
        setTimeout(() => {
            process.exit(1);
        }, 1000);
    });
}

/**
 * Setup all error handlers
 */
function setupErrorHandlers() {
    setupUnhandledRejectionHandler();
    setupUncaughtExceptionHandler();
}

module.exports = {
    AppError,
    ValidationError,
    NotFoundError,
    UnauthorizedError,
    ForbiddenError,
    RateLimitError,
    errorHandler,
    asyncHandler,
    setupErrorHandlers
};

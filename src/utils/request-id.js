/**
 * Request ID Tracking
 * Generates and tracks request IDs for request tracing across the application
 */

const { randomBytes } = require('crypto');

/**
 * Generate a unique request ID
 * @returns {string} Request ID
 */
function generateRequestId() {
    return randomBytes(16).toString('hex');
}

/**
 * Request ID middleware for Express
 * Adds request ID to request object and response headers
 */
function requestIdMiddleware() {
    return (req, res, next) => {
        // Get existing request ID from header or generate new one
        const requestId = req.headers['x-request-id'] || generateRequestId();
        
        // Attach to request object
        req.requestId = requestId;
        
        // Add to response headers
        res.setHeader('X-Request-ID', requestId);
        
        next();
    };
}

/**
 * Get request ID from context (for non-Express contexts)
 * Uses AsyncLocalStorage if available, otherwise falls back to a simple context
 */
let requestContext = null;

if (typeof AsyncLocalStorage !== 'undefined') {
    const { AsyncLocalStorage } = require('async_hooks');
    requestContext = new AsyncLocalStorage();
}

/**
 * Run function with request context
 * @param {string} requestId - Request ID
 * @param {Function} fn - Function to run
 * @returns {*} Function result
 */
function runWithRequestId(requestId, fn) {
    if (requestContext) {
        return requestContext.run({ requestId }, fn);
    }
    
    // Fallback for environments without AsyncLocalStorage
    const oldContext = global.__requestContext;
    global.__requestContext = { requestId };
    try {
        return fn();
    } finally {
        global.__requestContext = oldContext;
    }
}

/**
 * Get current request ID
 * @returns {string|null} Request ID or null
 */
function getRequestId() {
    if (requestContext) {
        const store = requestContext.getStore();
        return store ? store.requestId : null;
    }
    
    // Fallback
    return global.__requestContext?.requestId || null;
}

module.exports = {
    generateRequestId,
    requestIdMiddleware,
    runWithRequestId,
    getRequestId
};


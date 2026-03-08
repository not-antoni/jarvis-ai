'use strict';

/**
 * Public API Routes
 * OpenAI-compatible API endpoints for external applications
 */

const express = require('express');
const router = express.Router();
const apiKeys = require('../src/services/api-keys');

let aiManager = null;
let database = null;

/**
 * Initialize the public API with dependencies
 */
function init(deps) {
    if (deps.aiManager) {
        aiManager = deps.aiManager;
    }
    if (deps.database) {
        database = deps.database;
        apiKeys.init(database, deps.discordClient, deps.ownerId);
    }
}

/**
 * Get client IP from request
 */
function getClientIp(req) {
    return req.headers['cf-connecting-ip'] ||
           req.headers['x-real-ip'] ||
           req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
           req.ip ||
           req.connection?.remoteAddress ||
           '127.0.0.1';
}

/**
 * API Key Authentication Middleware
 */
async function authenticate(req, res, next) {
    const startTime = Date.now();
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
            error: {
                message: 'Missing or invalid Authorization header. Use: Bearer jv-your-api-key',
                type: 'authentication_error',
                code: 'missing_api_key'
            }
        });
    }

    const apiKey = authHeader.slice(7);
    const keyInfo = await apiKeys.validateKey(apiKey);

    if (!keyInfo) {
        return res.status(401).json({
            error: {
                message: 'Invalid API key',
                type: 'authentication_error',
                code: 'invalid_api_key'
            }
        });
    }

    // Check rate limit
    const rateLimit = apiKeys.checkRateLimit(keyInfo.keyId);
    res.set('X-RateLimit-Limit', apiKeys.RATE_LIMIT_MAX_REQUESTS);
    res.set('X-RateLimit-Remaining', rateLimit.remaining);
    res.set('X-RateLimit-Reset', Math.ceil(rateLimit.resetAt / 1000));

    if (!rateLimit.allowed) {
        return res.status(429).json({
            error: {
                message: 'Rate limit exceeded. Please wait before making more requests.',
                type: 'rate_limit_error',
                code: 'rate_limit_exceeded'
            }
        });
    }

    // Attach user info to request
    req.apiUser = keyInfo;
    req.apiStartTime = startTime;
    req.clientIp = getClientIp(req);

    next();
}

/**
 * Request logging middleware
 */
async function logApiRequest(req, res, next) {
    // Capture the original end function
    const originalEnd = res.end;
    
    res.end = async function(chunk, encoding) {
        // Call original end
        originalEnd.call(this, chunk, encoding);

        // Log the request
        if (req.apiUser) {
            const responseTime = Date.now() - req.apiStartTime;
            const ipInfo = await apiKeys.getIpInfo(req.clientIp);

            await apiKeys.logRequest({
                userId: req.apiUser.userId,
                keyId: req.apiUser.keyId,
                endpoint: req.path,
                method: req.method,
                ip: req.clientIp,
                userAgent: req.headers['user-agent'],
                country: ipInfo.country,
                city: ipInfo.city,
                isp: ipInfo.isp,
                statusCode: res.statusCode,
                responseTime,
                tokensUsed: req.tokensUsed || 0,
                suspicious: ipInfo.isProxy || ipInfo.isHosting
            });
        }
    };

    next();
}

// Apply middleware to all routes
router.use(authenticate);
router.use(logApiRequest);

/**
 * GET /api/v1/models
 * List available AI models
 */
router.get('/models', async(req, res) => {
    try {
        let models = [];
        
        if (aiManager) {
            const providers = aiManager.getActiveProviders ? 
                aiManager.getActiveProviders() : [];
            
            models = providers.map(p => ({
                id: p.name || p.id,
                object: 'model',
                created: Date.now(),
                owned_by: 'jarvis',
                permission: [],
                root: p.model || p.name,
                parent: null
            }));
        }

        // Add default model if no providers
        if (models.length === 0) {
            models.push({
                id: 'jarvis-default',
                object: 'model',
                created: Date.now(),
                owned_by: 'jarvis',
                permission: [],
                root: 'jarvis-default',
                parent: null
            });
        }

        res.json({
            object: 'list',
            data: models
        });
    } catch (error) {
        console.error('[PublicAPI] Error listing models:', error);
        res.status(500).json({
            error: {
                message: 'Failed to list models',
                type: 'api_error',
                code: 'internal_error'
            }
        });
    }
});

/**
 * POST /api/v1/chat/completions
 * OpenAI-compatible chat completions endpoint
 * DISABLED: Too abusable - use the Discord bot instead
 */
router.post('/chat/completions', async(req, res) => {
    // API temporarily disabled
    return res.status(999).json({
        error: {
            message: 'api disabled, sir, use the discord bot',
            type: 'api_disabled',
            code: 999
        }
    });
});

/**
 * GET /api/v1/user
 * Get current authenticated user info
 */
router.get('/user', async(req, res) => {
    try {
        const keys = await apiKeys.getUserKeys(req.apiUser.userId);
        
        res.json({
            userId: req.apiUser.userId,
            keyId: req.apiUser.keyId,
            keyName: req.apiUser.keyName,
            totalKeys: keys.length,
            maxKeys: apiKeys.MAX_KEYS_PER_USER
        });
    } catch (error) {
        res.status(500).json({
            error: {
                message: 'Failed to get user info',
                type: 'api_error',
                code: 'internal_error'
            }
        });
    }
});

/**
 * GET /api/v1/usage
 * Get API usage stats for the current user
 */
router.get('/usage', async(req, res) => {
    try {
        const keys = await apiKeys.getUserKeys(req.apiUser.userId);
        
        const totalRequests = keys.reduce((sum, k) => sum + (k.requestCount || 0), 0);
        
        res.json({
            userId: req.apiUser.userId,
            totalRequests,
            keys: keys.map(k => ({
                id: k.id,
                name: k.name,
                requestCount: k.requestCount,
                lastUsedAt: k.lastUsedAt
            }))
        });
    } catch (error) {
        res.status(500).json({
            error: {
                message: 'Failed to get usage stats',
                type: 'api_error',
                code: 'internal_error'
            }
        });
    }
});

// Export router and init function
router.init = init;
module.exports = router;

'use strict';

/**
 * Centralised rate-limit middleware factories.
 *
 * Rate limits are in-memory per-process (fine for a single-node deployment).
 * The keyGenerator uses Express's trust-proxy-aware `req.ip`, so Cloudflare's
 * `CF-Connecting-IP` propagates correctly.
 *
 * Local/loopback requests are always allowed through - avoids self-pings
 * tripping the limiter during health checks.
 */

const rateLimit = require('express-rate-limit');
const { isRenderHealthCheck, isRenderHealthUserAgent } = require('./health-helpers');

function isLocalRequest(req) {
    const ip = (req.ip || req.socket?.remoteAddress || '').replace('::ffff:', '');
    return ip === '127.0.0.1' || ip === '::1' || ip === 'localhost';
}

function createLimiter({
    windowMs = 60 * 1000,
    max = 60,
    name = 'general',
    skip = null
} = {}) {
    return rateLimit({
        windowMs,
        max,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        skip: req => {
            if (isLocalRequest(req)) {return true;}
            if (typeof skip === 'function') {return skip(req);}
            return false;
        },
        handler(req, res) {
            res.status(429).json({
                status: 'rate_limited',
                limiter: name,
                retryAfterSeconds: Math.ceil(windowMs / 1000)
            });
        }
    });
}

/** Public stats endpoint: short burst-friendly, used by the landing page */
const publicStatsLimiter = createLimiter({
    windowMs: 60 * 1000,
    max: 120,
    name: 'public-stats'
});

/** Health endpoint: Render health probe gets a free pass, others capped */
const healthLimiter = createLimiter({
    windowMs: 60 * 1000,
    max: 60,
    name: 'health',
    skip: req => isRenderHealthCheck(req) || isRenderHealthUserAgent(req)
});

/** Webhook forwarder: generous since legitimate services may batch */
const webhookLimiter = createLimiter({
    windowMs: 60 * 1000,
    max: 240,
    name: 'webhook'
});

/** Default site-wide guard for everything else */
const siteLimiter = createLimiter({
    windowMs: 60 * 1000,
    max: 300,
    name: 'site'
});

/** OAuth endpoints: tight cap to prevent brute-forcing state/code params */
const authLimiter = createLimiter({
    windowMs: 60 * 1000,
    max: 20,
    name: 'auth'
});

/** Portal/dashboard API: stricter, per-IP */
const portalLimiter = createLimiter({
    windowMs: 60 * 1000,
    max: 120,
    name: 'portal-api'
});

module.exports = {
    createLimiter,
    publicStatsLimiter,
    healthLimiter,
    webhookLimiter,
    siteLimiter,
    authLimiter,
    portalLimiter
};

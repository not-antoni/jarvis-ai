/**
 * Express Server Setup
 * Configures Express app with middleware, routes, and error handling
 */

const express = require('express');
const { requestIdMiddleware } = require('../utils/request-id');
const { errorHandler, asyncHandler } = require('../utils/error-handler');
const metrics = require('../utils/metrics');
const logger = require('../utils/logger');
const { gatherHealthSnapshot } = require('../services/diagnostics');
const webhookRouter = require('../../routes/webhook');
const { createAgentDiagnosticsRouter } = require('../utils/agent-diagnostics');

/**
 * Create and configure Express app
 * @param {Object} options - Configuration options
 * @returns {express.Application} Configured Express app
 */
function createExpressApp(options = {}) {
    const app = express();

    // Trust proxy (for Render, etc.)
    app.set('trust proxy', true);

    // Request ID middleware (must be first)
    app.use(requestIdMiddleware());

    // Body parsing
    app.use(express.json({ limit: '10mb' }));
    app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Metrics middleware
    app.use((req, res, next) => {
        const startTime = Date.now();
        const requestId = req.requestId;

        // Log request
        logger.debug('Incoming request', {
            method: req.method,
            path: req.path,
            requestId
        });

        // Track response
        res.on('finish', () => {
            const duration = Date.now() - startTime;
            metrics.recordRequest(req.path, duration, res.statusCode < 400, res.statusCode);
            
            logger.info('Request completed', {
                method: req.method,
                path: req.path,
                statusCode: res.statusCode,
                duration,
                requestId
            });
        });

        next();
    });

    // Health check endpoint
    app.get('/health', asyncHandler(async (req, res) => {
        const HEALTH_TOKEN = process.env.HEALTH_TOKEN;
        
        // Check authentication if token is set
        if (HEALTH_TOKEN && !isRenderHealthCheck(req)) {
            const authHeader = req.headers?.authorization;
            const providedToken = authHeader?.startsWith('Bearer ') 
                ? authHeader.slice(7).trim()
                : req.query?.token;
            
            if (providedToken !== HEALTH_TOKEN) {
                return res.status(401).json({
                    status: 'unauthorized',
                    error: 'Valid bearer token required'
                });
            }
        }

        // Fast path for Render health checks
        if (isRenderHealthUserAgent(req) && !req.query.deep) {
            return res.status(200).json({ status: 'ok' });
        }

        const deep = ['1', 'true', 'yes', 'deep'].includes(
            String(req.query.deep || '').toLowerCase()
        );

        try {
            const snapshot = await gatherHealthSnapshot({
                includeProviders: true,
                redactProviders: false,
                pingDatabase: deep,
                attemptReconnect: deep
            });

            const healthyProviders = snapshot.providers.filter(
                p => !p.hasError && !p.isDisabled
            ).length;

            const status = snapshot.env.hasAllRequired && 
                          snapshot.database.connected && 
                          healthyProviders > 0
                ? 'ok'
                : 'degraded';

            res.json({
                status,
                env: snapshot.env,
                database: snapshot.database,
                providers: snapshot.providers,
                system: snapshot.system,
                counts: {
                    providersTotal: snapshot.providers.length,
                    providersHealthy: healthyProviders
                }
            });
        } catch (error) {
            logger.error('Health endpoint failed', { error: error.message });
            res.status(500).json({
                status: 'error',
                error: error.message
            });
        }
    }));

    // Metrics endpoint
    app.get('/metrics', asyncHandler(async (req, res) => {
        const format = req.query.format || 'json';
        
        if (format === 'prometheus') {
            res.setHeader('Content-Type', 'text/plain');
            res.send(metrics.getPrometheusMetrics());
        } else {
            res.json(metrics.getMetrics());
        }
    }));

    // Webhook routes
    app.use('/webhook', webhookRouter);

    // Agent diagnostics routes
    const agentDiagnosticsRouter = createAgentDiagnosticsRouter();
    if (agentDiagnosticsRouter) {
        app.use('/diagnostics', agentDiagnosticsRouter);
    }

    // Root endpoint
    app.get('/', (req, res) => {
        res.send(`
            <pre>
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   ██╗ █████╗ ██████╗ ██╗   ██╗██╗███████╗                    ║
║   ██║██╔══██╗██╔══██╗██║   ██║██║██╔════╝                    ║
║   ██║███████║██████╔╝██║   ██║██║███████╗                    ║
║   ██║██╔══██║██╔══██╗╚██╗ ██╔╝██║╚════██║                    ║
║   ██║██║  ██║██║  ██║ ╚████╔╝ ██║███████║                    ║
║   ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝  ╚═══╝  ╚═╝╚══════╝                    ║
║                                                              ║
║   Discord Bot - AI-Powered Assistant                         ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝

Status: Online
Health: /health
Metrics: /metrics
            </pre>
        `);
    });

    // 404 handler
    app.use((req, res) => {
        res.status(404).json({
            success: false,
            error: {
                code: 'NOT_FOUND',
                message: 'Endpoint not found',
                path: req.path
            }
        });
    });

    // Error handler (must be last)
    app.use(errorHandler);

    return app;
}

/**
 * Check if request is from Render health check
 */
function isRenderHealthCheck(req) {
    const ua = String(req.headers?.['user-agent'] || '').toLowerCase();
    if (ua.includes('render/health')) return true;

    const forwardedFor = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
    if (forwardedFor.startsWith('10.') || forwardedFor === '127.0.0.1' || forwardedFor === '::1') {
        return true;
    }

    const remoteAddr = (req.ip || '').replace('::ffff:', '');
    return remoteAddr === '127.0.0.1' || remoteAddr === '::1';
}

/**
 * Check if request has Render health check user agent
 */
function isRenderHealthUserAgent(req) {
    const ua = String(req.headers?.['user-agent'] || '').toLowerCase();
    return ua.includes('render/health');
}

module.exports = {
    createExpressApp
};


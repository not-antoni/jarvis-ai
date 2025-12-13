/**
 * Startup Utilities
 * Handles application initialization and validation
 */

const logger = require('../utils/logger');
const { validateEnvOrThrow } = require('../../config/validate-env');
const { setupErrorHandlers } = require('../utils/error-handler');

/**
 * Validate environment and setup error handlers
 * @throws {Error} If environment validation fails
 */
function initializeApplication() {
    // Setup error handlers first
    setupErrorHandlers();

    // Validate environment variables
    try {
        const validated = validateEnvOrThrow();
        logger.info('Environment validation passed', {
            validatedVars: Object.keys(validated).length
        });
    } catch (error) {
        logger.error('Environment validation failed', {
            error: error.message
        });
        throw error;
    }

    logger.info('Application initialized successfully');
}

/**
 * Graceful shutdown handler
 * @param {Object} resources - Resources to cleanup (server, database, etc.)
 */
function setupGracefulShutdown(resources = {}) {
    const shutdown = async signal => {
        logger.info(`Received ${signal}, starting graceful shutdown...`);

        try {
            // Close HTTP server
            if (resources.server) {
                await new Promise(resolve => {
                    resources.server.close(() => {
                        logger.info('HTTP server closed');
                        resolve();
                    });
                });
            }

            // Close database connections
            if (resources.database && typeof resources.database.close === 'function') {
                await resources.database.close();
                logger.info('Database connections closed');
            }

            // Close Discord client
            if (resources.client && typeof resources.client.destroy === 'function') {
                resources.client.destroy();
                logger.info('Discord client destroyed');
            }

            logger.info('Graceful shutdown completed');
            process.exit(0);
        } catch (error) {
            logger.error('Error during shutdown', { error: error.message });
            process.exit(1);
        }
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    // Handle uncaught exceptions
    process.on('uncaughtException', error => {
        logger.error('Uncaught exception', {
            error: {
                name: error.name,
                message: error.message,
                stack: error.stack
            }
        });
        shutdown('uncaughtException');
    });
}

module.exports = {
    initializeApplication,
    setupGracefulShutdown
};

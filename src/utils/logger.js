/**
 * Structured Logging Utility
 * Provides consistent, structured logging across the application
 */

const path = require('path');
const fs = require('fs');

// Simple structured logger (Winston can be added later if needed)
class Logger {
    constructor() {
        this.logLevel = process.env.LOG_LEVEL || 'info';
        this.logDir = process.env.LOG_DIR || path.join(process.cwd(), 'logs');
        this.enableFileLogging = process.env.ENABLE_FILE_LOGGING !== 'false';
        this.enableConsoleLogging = process.env.ENABLE_CONSOLE_LOGGING !== 'false';

        // Ensure log directory exists
        if (this.enableFileLogging && !fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir, { recursive: true });
        }

        this.levels = {
            error: 0,
            warn: 1,
            info: 2,
            debug: 3
        };
    }

    /**
     * Check if log level should be logged
     */
    shouldLog(level) {
        return this.levels[level] <= this.levels[this.logLevel];
    }

    /**
     * Format log entry
     */
    format(level, message, meta = {}) {
        const timestamp = new Date().toISOString();
        const entry = {
            timestamp,
            level: level.toUpperCase(),
            message,
            ...meta
        };

        return JSON.stringify(entry);
    }

    /**
     * Write to file
     */
    writeToFile(level, formatted) {
        if (!this.enableFileLogging) return;

        try {
            const logFile = path.join(this.logDir, `${level}.log`);
            const allLogFile = path.join(this.logDir, 'combined.log');

            fs.appendFileSync(logFile, formatted + '\n');
            fs.appendFileSync(allLogFile, formatted + '\n');
        } catch (error) {
            // Fallback to console if file write fails
            console.error('Failed to write log file:', error.message);
            console.log(formatted);
        }
    }

    /**
     * Write to console
     */
    writeToConsole(level, message, meta) {
        if (!this.enableConsoleLogging) return;

        const prefix = `[${new Date().toISOString()}] [${level.toUpperCase()}]`;
        const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';

        switch (level) {
            case 'error':
                console.error(prefix, message, metaStr);
                break;
            case 'warn':
                console.warn(prefix, message, metaStr);
                break;
            case 'debug':
                if (this.shouldLog('debug')) {
                    console.debug(prefix, message, metaStr);
                }
                break;
            default:
                console.log(prefix, message, metaStr);
        }
    }

    /**
     * Log error
     */
    error(message, meta = {}) {
        if (!this.shouldLog('error')) return;

        const formatted = this.format('error', message, meta);
        this.writeToFile('error', formatted);
        this.writeToConsole('error', message, meta);
    }

    /**
     * Log warning
     */
    warn(message, meta = {}) {
        if (!this.shouldLog('warn')) return;

        const formatted = this.format('warn', message, meta);
        this.writeToFile('warn', formatted);
        this.writeToConsole('warn', message, meta);
    }

    /**
     * Log info
     */
    info(message, meta = {}) {
        if (!this.shouldLog('info')) return;

        const formatted = this.format('info', message, meta);
        this.writeToFile('info', formatted);
        this.writeToConsole('info', message, meta);
    }

    /**
     * Log debug
     */
    debug(message, meta = {}) {
        if (!this.shouldLog('debug')) return;

        const formatted = this.format('debug', message, meta);
        this.writeToFile('debug', formatted);
        this.writeToConsole('debug', message, meta);
    }

    /**
     * Create child logger with additional context
     */
    child(defaultMeta = {}) {
        const childLogger = Object.create(this);
        childLogger.defaultMeta = { ...this.defaultMeta, ...defaultMeta };

        const originalFormat = this.format.bind(this);
        childLogger.format = (level, message, meta = {}) => {
            return originalFormat(level, message, { ...this.defaultMeta, ...defaultMeta, ...meta });
        };

        return childLogger;
    }
}

// Create singleton instance
const logger = new Logger();

module.exports = logger;

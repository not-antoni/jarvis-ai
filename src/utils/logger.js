const path = require('path');
const fs = require('fs');

function serializeError(err) {
    if (!err || typeof err !== 'object') {return err;}
    const out = {
        name: err.name || 'Error',
        message: err.message || String(err)
    };
    if (err.stack) {out.stack = err.stack;}
    if (err.code !== undefined) {out.code = err.code;}
    if (err.status !== undefined) {out.status = err.status;}
    if (err.cause) {
        out.cause = serializeError(err.cause);
    }
    return out;
}

function normalizeMeta(meta) {
    if (!meta) {return {};}
    if (meta instanceof Error) {return { err: serializeError(meta) };}
    if (typeof meta !== 'object') {return { value: meta };}
    if (meta.err instanceof Error) {
        return { ...meta, err: serializeError(meta.err) };
    }
    if (meta.error instanceof Error) {
        return { ...meta, error: serializeError(meta.error) };
    }
    return meta;
}

class Logger {
    constructor() {
        this.logLevel = process.env.LOG_LEVEL || 'info';
        this.logDir = process.env.LOG_DIR || path.join(process.cwd(), 'logs');
        this.enableFileLogging = process.env.ENABLE_FILE_LOGGING !== 'false';
        this.enableConsoleLogging = process.env.ENABLE_CONSOLE_LOGGING !== 'false';
        this.defaultMeta = {};

        // Ensure log directory exists
        if (this.enableFileLogging) {
            try {
                if (!fs.existsSync(this.logDir)) {
                    fs.mkdirSync(this.logDir, { recursive: true });
                }
            } catch (error) {
                this.enableFileLogging = false;
                console.error('Failed to create log directory:', error.message);
            }
        }

        this.levels = {
            error: 0,
            warn: 1,
            info: 2,
            debug: 3
        };

        this._fileWriteQueue = Promise.resolve();
    }

    shouldLog(level) {
        return this.levels[level] <= this.levels[this.logLevel];
    }

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

    writeToFile(level, formatted) {
        if (!this.enableFileLogging) {return;}

        const line = `${formatted  }\n`;
        const logFile = path.join(this.logDir, `${level}.log`);
        const allLogFile = path.join(this.logDir, 'combined.log');

        this._fileWriteQueue = this._fileWriteQueue
            .then(() => Promise.all([fs.promises.appendFile(logFile, line), fs.promises.appendFile(allLogFile, line)]))
            .catch(error => {
                console.error('Failed to write log file:', error.message);
                try {
                    console.log(formatted);
                } catch {
                    // ignore
                }
            });
    }

    writeToConsole(level, message, meta) {
        if (!this.enableConsoleLogging) {return;}

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

    _emit(level, message, meta) {
        if (!this.shouldLog(level)) {return;}
        const normalized = { ...(this.defaultMeta || {}), ...normalizeMeta(meta) };
        const formatted = this.format(level, message, normalized);
        this.writeToFile(level, formatted);
        this.writeToConsole(level, message, normalized);
    }

    error(message, meta = {}) { this._emit('error', message, meta); }
    warn(message, meta = {}) { this._emit('warn', message, meta); }
    info(message, meta = {}) { this._emit('info', message, meta); }
    debug(message, meta = {}) { this._emit('debug', message, meta); }

    child(defaultMeta = {}) {
        const childLogger = Object.create(this);
        childLogger.defaultMeta = { ...(this.defaultMeta || {}), ...defaultMeta };
        return childLogger;
    }

    async flush() {
        if (!this.enableFileLogging) {return;}
        await this._fileWriteQueue;
    }
}

// Create singleton instance
const logger = new Logger();

module.exports = logger;
module.exports.serializeError = serializeError;
module.exports.Logger = Logger;

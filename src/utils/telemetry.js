/**
 * Lightweight telemetry helper for structured command logging.
 * Emits JSON lines to stdout so external systems can ingest easily.
 */

const os = require('node:os');
const database = require('../services/database');

function sanitizeError(error) {
    if (!error) {
        return null;
    }

    if (typeof error === 'string') {
        return { message: error };
    }

    return {
        message: error.message || 'Unknown error',
        code: error.code || null,
        name: error.name || error.constructor?.name || 'Error'
    };
}

function createTelemetryBase() {
    return {
        ts: new Date().toISOString(),
        host: os.hostname()
    };
}

function recordCommandRun({
    command,
    subcommand = null,
    userId = null,
    guildId = null,
    latencyMs = null,
    status = 'ok',
    error = null,
    metadata = null,
    context = 'slash'
}) {
    const payload = {
        ...createTelemetryBase(),
        event: 'command_run',
        context,
        command,
        subcommand,
        userId,
        guildId,
        latencyMs,
        status: status === 'ok' ? 'ok' : 'error'
    };

    if (metadata && typeof metadata === 'object') {
        payload.metadata = metadata;
    }

    if (payload.status === 'error') {
        payload.error = sanitizeError(error);
    }

    // eslint-disable-next-line no-console
    console.log(JSON.stringify(payload));

    if (database?.recordCommandMetric) {
        database
            .recordCommandMetric({
                command,
                subcommand,
                context,
                status: payload.status,
                latencyMs
            })
            .catch(error => {
                console.warn('Failed to persist command metric:', error?.message || error);
            });
    }
}

module.exports = {
    recordCommandRun
};

'use strict';

const { recordCommandRun } = require('../../utils/telemetry');

function createSlashTelemetry(commandName, userId, guildId, startedAt) {
    return {
        commandName,
        userId,
        guildId,
        startedAt,
        status: 'ok',
        error: null,
        metadata: {},
        subcommand: null
    };
}

function finalizeSlashTelemetry(state) {
    const metadata = state.metadata && Object.keys(state.metadata).length > 0
        ? state.metadata
        : undefined;

    recordCommandRun({
        command: state.commandName,
        subcommand: state.subcommand,
        userId: state.userId,
        guildId: state.guildId,
        latencyMs: Date.now() - state.startedAt,
        status: state.status,
        error: state.error,
        metadata,
        context: 'slash'
    });
}

module.exports = {
    createSlashTelemetry,
    finalizeSlashTelemetry
};

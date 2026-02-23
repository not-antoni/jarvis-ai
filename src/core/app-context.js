/**
 * Shared application context — replaces global.discordClient, global.discordHandlers,
 * global.jarvisWarnings, and global.sentientThinkQueue.
 *
 * Usage:
 *   const ctx = require('./app-context');      // or appropriate relative path
 *   ctx.setClient(client);                     // in index.js at ready
 *   const client = ctx.getClient();            // anywhere else
 */
'use strict';

let _client = null;
let _handlers = null;
const _warnings = new Map();
const _sentientThinkQueue = new Map();

module.exports = {
    // Discord client
    setClient(client) { _client = client; },
    getClient() { return _client; },

    // Discord handlers
    setHandlers(handlers) { _handlers = handlers; },
    getHandlers() { return _handlers; },

    // Per-guild warnings map (guildId -> Map(userId -> warning[]))
    getWarnings() { return _warnings; },

    // Sentient think queue
    getSentientThinkQueue() { return _sentientThinkQueue; }
};

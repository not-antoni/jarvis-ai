/**
 * Command Handler Index
 * 
 * Central registry for all modular command handlers.
 * Maps command names to their handler functions.
 */

const economyHandlers = require('./economy-commands');

// Aggregate all command handlers
const allHandlers = {
    ...economyHandlers.commandMap,
    // Future handler modules will be added here:
    // ...funHandlers.commandMap,
    // ...utilityHandlers.commandMap,
    // ...moderationHandlers.commandMap,
};

/**
 * Check if a command has a modular handler
 * @param {string} commandName 
 * @returns {boolean}
 */
function hasHandler(commandName) {
    return commandName in allHandlers;
}

/**
 * Get the handler function for a command
 * @param {string} commandName 
 * @returns {Function|null}
 */
function getHandler(commandName) {
    return allHandlers[commandName] || null;
}

/**
 * Execute a command handler
 * @param {string} commandName 
 * @param {Interaction} interaction 
 * @returns {Promise<any>}
 */
async function executeHandler(commandName, interaction) {
    const handler = allHandlers[commandName];
    if (!handler) {
        throw new Error(`No handler found for command: ${commandName}`);
    }
    return handler(interaction);
}

/**
 * Get list of all commands with modular handlers
 * @returns {string[]}
 */
function getHandledCommands() {
    return Object.keys(allHandlers);
}

module.exports = {
    hasHandler,
    getHandler,
    executeHandler,
    getHandledCommands,

    // Re-export helpers
    formatNum: economyHandlers.formatNum,
    parseFormattedNumber: economyHandlers.parseFormattedNumber,
};

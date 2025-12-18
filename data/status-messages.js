/**
 * Default status messages for Jarvis bot presence rotation.
 * Extracted from index.js for maintainability.
 */

const { ActivityType } = require('discord.js');

// This file is loaded dynamically - the array is very large for variety
const DEFAULT_STATUS_MESSAGES = require('./status-messages.json').map(item => {
    // Convert string activity types back to ActivityType enum
    if (item.type && typeof item.type === 'string') {
        return { ...item, type: ActivityType[item.type] };
    }
    return item;
});

module.exports = { DEFAULT_STATUS_MESSAGES };

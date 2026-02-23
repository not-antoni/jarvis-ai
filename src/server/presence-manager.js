'use strict';

const { ActivityType } = require('discord.js');
const { DEFAULT_STATUS_MESSAGES } = require('../../data/status-messages');

let rotatingStatusMessages = [...DEFAULT_STATUS_MESSAGES];
let rotatingStatusIndex = rotatingStatusMessages.length
    ? Math.floor(Math.random() * rotatingStatusMessages.length)
    : 0;
let lastStatusIndex = -1;

const activityTypeEntries = Object.entries(ActivityType);

function resolveActivityType(value) {
    if (
        typeof value === 'number' &&
        activityTypeEntries.some(([, enumValue]) => enumValue === value)
    ) {
        return value;
    }
    if (typeof value === 'string' && value.trim()) {
        const normalized = value.trim().replace(/\s+/g, '').toUpperCase();
        const entry = activityTypeEntries.find(([name]) => name.toUpperCase() === normalized);
        return entry ? entry[1] : undefined;
    }
    return undefined;
}

async function refreshPresenceMessages(database, forceFallback = false) {
    if (!database.isConnected) {
        if (forceFallback) {
            rotatingStatusMessages = [...DEFAULT_STATUS_MESSAGES];
        }
        return false;
    }

    try {
        const records = await database.getPresenceMessages();
        const normalized = records
            .map(record => {
                const activityType = resolveActivityType(record.type);
                return typeof record.message === 'string'
                    ? { message: record.message.trim(), type: activityType }
                    : null;
            })
            .filter(entry => entry && entry.message.length);

        if (normalized.length) {
            rotatingStatusMessages = normalized;
            rotatingStatusIndex = Math.floor(Math.random() * rotatingStatusMessages.length);
            console.log(`Loaded ${normalized.length} custom presence message(s) from MongoDB.`);
            return true;
        }
    } catch (error) {
        console.error('Failed to load custom presence messages:', error);
    }

    if (forceFallback) {
        rotatingStatusMessages = [...DEFAULT_STATUS_MESSAGES];
        rotatingStatusIndex = rotatingStatusMessages.length
            ? Math.floor(Math.random() * rotatingStatusMessages.length)
            : 0;
    }
    return false;
}

function getNextRotatingStatus() {
    if (!rotatingStatusMessages.length) {
        return { message: 'Calibrating Stark Industries protocols.' };
    }

    let nextIndex;
    if (rotatingStatusMessages.length === 1) {
        nextIndex = 0;
    } else {
        do {
            nextIndex = Math.floor(Math.random() * rotatingStatusMessages.length);
        } while (nextIndex === lastStatusIndex);
    }

    lastStatusIndex = nextIndex;
    rotatingStatusIndex = nextIndex;
    return rotatingStatusMessages[nextIndex];
}

function updateBotPresence(client) {
    if (!client?.user) {
        return;
    }

    const { message } = getNextRotatingStatus();
    const activity = {
        name: 'Custom Status',
        type: ActivityType.Custom,
        state: message
    };

    try {
        client.user.setPresence({
            status: 'online',
            activities: [activity],
            afk: false
        });
    } catch (error) {
        console.error('Failed to update bot presence:', error);
    }
}

function getRotatingStatusIndex() {
    return rotatingStatusIndex;
}

module.exports = {
    refreshPresenceMessages,
    updateBotPresence,
    getNextRotatingStatus,
    getRotatingStatusIndex,
    resolveActivityType
};

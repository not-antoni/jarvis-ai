'use strict';

const { PermissionsBitField } = require('discord.js');

/**
 * Safely send a message to a channel with permission checks
 * @param {Channel} channel - Discord channel to send to
 * @param {Object} options - Message options (content, embeds, etc.)
 * @param {Client} client - Discord client instance
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
async function safeSend(channel, options, client) {
    if (!channel || typeof channel.send !== 'function') {
        return { ok: false, error: 'Invalid channel' };
    }

    // Check if we have permission to send messages
    if (channel.guild) {
        const permissions = channel.permissionsFor(client.user);
        if (!permissions) {
            return { ok: false, error: 'Could not check permissions' };
        }

        if (!permissions.has(PermissionsBitField.Flags.SendMessages)) {
            return { ok: false, error: 'Missing SendMessages permission' };
        }

        // Check embed permissions if sending embeds
        if (options.embeds && options.embeds.length > 0) {
            if (!permissions.has(PermissionsBitField.Flags.EmbedLinks)) {
                // Fallback to text-only message
                const textContent = options.content || 'Please check the console for details.';
                return await channel.send(textContent)
                    .then(() => ({ ok: true }))
                    .catch(err => ({ ok: false, error: err.message }));
            }
        }
    }

    // Try to send the message
    try {
        await channel.send(options);
        return { ok: true };
    } catch (error) {
        return { ok: false, error: error.message };
    }
}

/**
 * Safely send a DM to a user
 * @param {User} user - Discord user to DM
 * @param {Object} options - Message options
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
async function safeDM(user, options) {
    if (!user || typeof user.send !== 'function') {
        return { ok: false, error: 'Invalid user' };
    }

    try {
        await user.send(options);
        return { ok: true };
    } catch (error) {
        // Common DM errors
        if (error.code === 50007) {
            return { ok: false, error: 'Cannot send DMs to this user' };
        }
        return { ok: false, error: error.message };
    }
}

module.exports = {
    safeSend,
    safeDM
};

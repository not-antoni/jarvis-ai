'use strict';

async function sendSimpleError(interaction, message) {
    try {
        if (!interaction.deferred && !interaction.replied) {
            await interaction.reply(message);
        } else if (!interaction.replied) {
            await interaction.editReply(message);
        } else {
            await interaction.followUp(message);
        }
    } catch (error) {
        console.error('Failed to send slash error response:', error);
    }
}

function withSafeMentions(payload) {
    const resolved = payload && typeof payload === 'object'
        ? { ...payload }
        : { content: String(payload || '') };

    resolved.allowedMentions = resolved.allowedMentions || { parse: [] };
    resolved.allowedMentions.parse = Array.isArray(resolved.allowedMentions.parse)
        ? resolved.allowedMentions.parse
        : [];

    return resolved;
}

module.exports = {
    sendSimpleError,
    withSafeMentions
};

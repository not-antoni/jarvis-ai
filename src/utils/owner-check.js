/**
 * Owner Check Utility
 * Unified function to check if a user is the bot owner
 * Checks multiple sources: ADMIN_USER_ID, BOT_OWNER_ID, config.admin.userId
 */

const config = require('../../config');

/**
 * Check if a user ID belongs to the bot owner
 * @param {string} userId - Discord user ID to check
 * @returns {boolean} - True if user is the owner
 */
function isOwner(userId) {
    if (!userId) return false;

    const userIdStr = String(userId).trim();

    // Check all possible owner ID sources
    const ownerIds = [
        process.env.ADMIN_USER_ID,
        process.env.BOT_OWNER_ID,
        config?.admin?.userId
    ].filter(Boolean).map(id => String(id).trim());

    return ownerIds.includes(userIdStr);
}

/**
 * Get the owner's user ID
 * @returns {string|null} - Owner's user ID or null
 */
function getOwnerId() {
    return (
        process.env.ADMIN_USER_ID ||
        process.env.BOT_OWNER_ID ||
        config?.admin?.userId ||
        null
    );
}

module.exports = {
    isOwner,
    getOwnerId
};

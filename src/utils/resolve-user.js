/**
 * Resolve a user from various input formats:
 * - User ID (e.g., "123456789012345678")
 * - Mention (e.g., "<@123456789012345678>" or "<@!123456789012345678>")
 * - Username (e.g., "username" or "User#1234")
 * 
 * @param {object} client - Discord client
 * @param {object} guild - Discord guild
 * @param {string} input - User input (ID, mention, or username)
 * @returns {Promise<{user: User|null, member: GuildMember|null, error: string|null}>}
 */
async function resolveUser(client, guild, input) {
    if (!input || typeof input !== 'string') {
        return { user: null, member: null, error: 'No user specified' };
    }

    const trimmed = input.trim();

    // Try extracting ID from mention format: <@123> or <@!123>
    const mentionMatch = trimmed.match(/^<@!?(\d+)>$/);
    const userId = mentionMatch ? mentionMatch[1] : (
        // Check if it's a raw snowflake ID (17-20 digits)
        /^\d{17,20}$/.test(trimmed) ? trimmed : null
    );

    // Try to fetch by ID first (most reliable)
    if (userId) {
        try {
            const user = await client.users.fetch(userId).catch(() => null);
            if (user) {
                const member = guild ? await guild.members.fetch(userId).catch(() => null) : null;
                return { user, member, error: null };
            }
        } catch { }
    }

    // Fall back to searching by username in guild
    if (guild) {
        try {
            // Fetch all members (needed for username search)
            // Note: This can be slow for large guilds
            const members = await guild.members.fetch();

            // Try exact username match first
            let foundMember = members.find(m =>
                m.user.username.toLowerCase() === trimmed.toLowerCase() ||
                m.user.tag.toLowerCase() === trimmed.toLowerCase() ||
                (m.nickname && m.nickname.toLowerCase() === trimmed.toLowerCase())
            );

            // Try partial match if exact match fails
            if (!foundMember) {
                foundMember = members.find(m =>
                    m.user.username.toLowerCase().includes(trimmed.toLowerCase()) ||
                    (m.nickname && m.nickname.toLowerCase().includes(trimmed.toLowerCase()))
                );
            }

            if (foundMember) {
                return { user: foundMember.user, member: foundMember, error: null };
            }
        } catch { }
    }

    // If we have an ID but user wasn't found (e.g., banned user not in guild)
    if (userId) {
        try {
            // Try client.users.fetch with force option
            const user = await client.users.fetch(userId, { force: true }).catch(() => null);
            if (user) {
                return { user, member: null, error: null };
            }
        } catch { }

        // Return a partial object for banned users (ID known but can't fetch user)
        return {
            user: { id: userId, tag: `Unknown#0000 (${userId})` },
            member: null,
            error: null
        };
    }

    return { user: null, member: null, error: `Could not find user: ${trimmed}` };
}

module.exports = { resolveUser };

'use strict';

const STYLED_SPAN_OPEN = '\u0001';
const STYLED_SPAN_CLOSE = '\u0002';

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wrapStyledText(text, style = false) {
    return style ? `${STYLED_SPAN_OPEN}${text}${STYLED_SPAN_CLOSE}` : text;
}

function getCached(collection, id) {
    try {
        return collection?.get(id) || null;
    } catch (_) {
        return null;
    }
}

async function resolveUserDisplay(userId, { guild = null, client = null, mentions = null } = {}) {
    try {
        let member = getCached(mentions?.members, userId) || getCached(guild?.members?.cache, userId);
        if (!member && guild?.members?.fetch) {
            try {
                member = await guild.members.fetch(userId);
            } catch (_) {}
        }

        let user = member?.user || getCached(mentions?.users, userId) || getCached(client?.users?.cache, userId);
        if (!user && client?.users?.fetch) {
            try {
                user = await client.users.fetch(userId);
            } catch (_) {}
        }

        const name = member?.displayName || user?.globalName || user?.displayName || user?.username;
        return name ? `@${name}` : null;
    } catch (_) {
        return null;
    }
}

async function resolveRoleDisplay(roleId, { guild = null, mentions = null } = {}) {
    try {
        let role = getCached(mentions?.roles, roleId) || getCached(guild?.roles?.cache, roleId);
        if (!role && guild?.roles?.fetch) {
            try {
                role = await guild.roles.fetch(roleId);
            } catch (_) {}
        }
        return role?.name ? `@${role.name}` : null;
    } catch (_) {
        return null;
    }
}

async function resolveChannelDisplay(channelId, { guild = null, client = null, mentions = null } = {}) {
    try {
        let channel = getCached(mentions?.channels, channelId) || getCached(guild?.channels?.cache, channelId) || getCached(client?.channels?.cache, channelId);
        if (!channel && guild?.channels?.fetch) {
            try {
                channel = await guild.channels.fetch(channelId);
            } catch (_) {}
        }
        if (!channel && client?.channels?.fetch) {
            try {
                channel = await client.channels.fetch(channelId);
            } catch (_) {}
        }
        return channel?.name ? `#${channel.name}` : null;
    } catch (_) {
        return null;
    }
}

async function replaceResolvedMatches(text, matches, resolver, options, style) {
    const seen = new Set();

    for (const match of matches) {
        const full = match[0];
        const id = match[1];
        if (!full || !id) {continue;}

        const key = `${full}\u0000${id}`;
        if (seen.has(key)) {continue;}
        seen.add(key);

        const display = await resolver(id, options);
        if (!display) {continue;}

        text = text.split(full).join(wrapStyledText(display, style));
    }

    return text;
}

async function resolveDiscordRichText(text, { guild = null, client = null, mentions = null, style = false } = {}) {
    if (!text) {return text;}

    const options = { guild, client, mentions };
    let resolved = String(text);

    resolved = await replaceResolvedMatches(
        resolved,
        Array.from(resolved.matchAll(/<@!?(\d{5,})>/g)),
        resolveUserDisplay,
        options,
        style
    );

    resolved = await replaceResolvedMatches(
        resolved,
        Array.from(resolved.matchAll(/<@&(\d{5,})>/g)),
        resolveRoleDisplay,
        options,
        style
    );

    resolved = await replaceResolvedMatches(
        resolved,
        Array.from(resolved.matchAll(/<#(\d{5,})>/g)),
        resolveChannelDisplay,
        options,
        style
    );

    const markdownChannelLinks = Array.from(
        resolved.matchAll(/\[[^\]\n]+\]\((https?:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/channels\/(?:@me|\d{5,})\/(\d{5,})(?:\/\d{5,})?)\)/g)
    ).map(match => [match[0], match[2]]);
    resolved = await replaceResolvedMatches(
        resolved,
        markdownChannelLinks,
        resolveChannelDisplay,
        options,
        style
    );

    const channelUrls = Array.from(
        resolved.matchAll(/https?:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/channels\/(?:@me|\d{5,})\/(\d{5,})(?:\/\d{5,})?/g)
    );
    resolved = await replaceResolvedMatches(
        resolved,
        channelUrls,
        resolveChannelDisplay,
        options,
        style
    );

    return resolved;
}

module.exports = {
    STYLED_SPAN_OPEN,
    STYLED_SPAN_CLOSE,
    escapeRegExp,
    resolveUserDisplay,
    resolveRoleDisplay,
    resolveChannelDisplay,
    resolveDiscordRichText,
    wrapStyledText
};

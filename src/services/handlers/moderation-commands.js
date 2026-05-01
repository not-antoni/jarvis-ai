'use strict';

const logger = require('../../utils/logger');

const log = logger.child({ module: 'moderation' });

const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000; // Discord limit

/**
 * Parse a duration string like "10m", "2h", "1d", "30s" → milliseconds.
 * Accepts composite forms like "1h30m" as well.
 */
function parseDuration(input) {
    if (!input || typeof input !== 'string') {return null;}
    const clean = input.trim().toLowerCase();
    if (!clean) {return null;}
    // Reject anything containing a minus sign so "-1d" or "1d -5m" aren't silently accepted.
    if (clean.includes('-')) {return null;}
    const unitMs = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 7 * 86_400_000 };
    const regex = /(\d+)\s*(s|sec|secs|m|min|mins|h|hr|hrs|d|day|days|w|wk|wks)/g;
    let total = 0;
    let matched = false;
    let m;
    while ((m = regex.exec(clean)) !== null) {
        matched = true;
        const qty = parseInt(m[1], 10);
        const unit = m[2].charAt(0);
        const factor = unitMs[unit];
        if (!Number.isFinite(qty) || !factor) {return null;}
        total += qty * factor;
    }
    if (!matched) {
        const num = Number(clean);
        if (Number.isFinite(num) && num > 0) {return num * 60_000;} // bare number → minutes
        return null;
    }
    return total > 0 ? total : null;
}

function formatDuration(ms) {
    if (!Number.isFinite(ms) || ms <= 0) {return '0 seconds';}
    const units = [
        ['d', 86_400_000],
        ['h', 3_600_000],
        ['m', 60_000],
        ['s', 1_000]
    ];
    const parts = [];
    let remaining = ms;
    for (const [label, factor] of units) {
        const value = Math.floor(remaining / factor);
        if (value > 0) {
            parts.push(`${value}${label}`);
            remaining -= value * factor;
        }
    }
    return parts.length ? parts.join(' ') : '<1s';
}

async function ensureModerator(interaction, handler) {
    if (!interaction.guild) {
        return { ok: false, reason: 'This command only works inside a server, sir.' };
    }
    const guild = interaction.guild;
    const member = interaction.member?.guild
        ? interaction.member
        : await guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member) {
        return { ok: false, reason: 'Unable to verify your server membership, sir.' };
    }
    const guildConfig = await handler.getGuildConfig(guild);
    const isModerator = await handler.isGuildModerator(member, guildConfig);
    if (!isModerator) {
        return { ok: false, reason: 'Only the server owner or configured moderators may do that, sir.' };
    }
    return { ok: true, member, guildConfig, guild };
}

async function fetchTargetMember(guild, userId) {
    try {
        return await guild.members.fetch(userId);
    } catch {
        return null;
    }
}

function canActOn(actor, target, bot) {
    if (!actor || !target) {return { ok: false, reason: 'Target could not be resolved.' };}
    if (target.id === actor.id) {return { ok: false, reason: 'You cannot target yourself, sir.' };}
    if (target.id === bot?.id) {return { ok: false, reason: "Sir, I can't do that to myself." };}
    if (target.id === actor.guild.ownerId) {
        return { ok: false, reason: 'The server owner is beyond my reach, sir.' };
    }
    // Role hierarchy (owner skips this)
    if (actor.id !== actor.guild.ownerId) {
        if (target.roles.highest.comparePositionTo(actor.roles.highest) >= 0) {
            return { ok: false, reason: 'Target member has an equal or higher role, sir.' };
        }
    }
    const me = actor.guild.members.me;
    if (me && target.roles.highest.comparePositionTo(me.roles.highest) >= 0) {
        return { ok: false, reason: 'Target member sits above my role, sir. Move my role higher.' };
    }
    return { ok: true };
}

function formatAuditReason(actor, reason) {
    const base = reason && reason.trim() ? reason.trim() : 'No reason provided';
    const signature = `via ${actor.user?.tag || actor.user?.username || actor.id}`;
    const combined = `${base} (${signature})`;
    return combined.slice(0, 512);
}

// ─────────────────────────────────────────────────────────────────────────────
// /purge
// ─────────────────────────────────────────────────────────────────────────────
async function handlePurge(interaction, handler) {
    const gate = await ensureModerator(interaction, handler);
    if (!gate.ok) {
        await interaction.editReply({ content: gate.reason });
        return;
    }
    const count = interaction.options.getInteger('count', true);
    const userFilter = interaction.options.getUser('user', false);
    const channel = interaction.channel;
    if (!channel || typeof channel.bulkDelete !== 'function') {
        await interaction.editReply({ content: 'This channel does not support bulk delete, sir.' });
        return;
    }
    const me = interaction.guild.members.me;
    if (!me?.permissionsIn(channel).has('ManageMessages')) {
        await interaction.editReply({ content: 'I lack the Manage Messages permission in this channel, sir.' });
        return;
    }
    try {
        let deletedCount = 0;
        if (userFilter) {
            // Fetch up to 100 recent messages, then filter by user
            const fetched = await channel.messages.fetch({ limit: 100 });
            const filtered = fetched.filter(m => m.author.id === userFilter.id).first(count);
            if (filtered.length === 0) {
                await interaction.editReply({
                    content: `No recent messages from ${userFilter} found in the last 100, sir.`
                });
                return;
            }
            const result = await channel.bulkDelete(filtered, true);
            deletedCount = result.size;
        } else {
            const result = await channel.bulkDelete(count, true);
            deletedCount = result.size;
        }
        log.info('Purge complete', {
            guildId: interaction.guildId,
            channelId: channel.id,
            actorId: interaction.user.id,
            requested: count,
            deleted: deletedCount,
            userFilter: userFilter?.id || null
        });
        const suffix = userFilter ? ` from ${userFilter}` : '';
        await interaction.editReply({
            content: `🧹 Deleted **${deletedCount}** message${deletedCount === 1 ? '' : 's'}${suffix}, sir.`
        });
    } catch (error) {
        log.error('Purge failed', { err: error, guildId: interaction.guildId });
        const reason = error?.code === 50034
            ? 'Some messages are older than 14 days and cannot be bulk deleted, sir.'
            : 'Failed to delete messages, sir.';
        await interaction.editReply({ content: reason });
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// /timeout
// ─────────────────────────────────────────────────────────────────────────────
async function handleTimeout(interaction, handler) {
    const gate = await ensureModerator(interaction, handler);
    if (!gate.ok) {
        await interaction.editReply({ content: gate.reason });
        return;
    }
    const targetUser = interaction.options.getUser('user', true);
    const durationRaw = interaction.options.getString('duration', true);
    const reason = interaction.options.getString('reason', false);
    const ms = parseDuration(durationRaw);
    if (!ms) {
        await interaction.editReply({
            content: 'Duration not recognised, sir. Try `10m`, `2h`, `1d`, or `1h30m`.'
        });
        return;
    }
    if (ms > MAX_TIMEOUT_MS) {
        await interaction.editReply({
            content: 'Discord caps timeouts at 28 days, sir.'
        });
        return;
    }
    const target = await fetchTargetMember(interaction.guild, targetUser.id);
    if (!target) {
        await interaction.editReply({ content: 'That user is not a member of this server, sir.' });
        return;
    }
    const check = canActOn(gate.member, target, interaction.client.user);
    if (!check.ok) {
        await interaction.editReply({ content: check.reason });
        return;
    }
    try {
        await target.timeout(ms, formatAuditReason(gate.member, reason));
        log.info('Timeout applied', {
            guildId: interaction.guildId,
            actorId: gate.member.id,
            targetId: target.id,
            durationMs: ms
        });
        const reasonText = reason ? ` - ${reason}` : '';
        await interaction.editReply({
            content: `⏲️ Timed out ${target.user} for **${formatDuration(ms)}**${reasonText}, sir.`
        });
    } catch (error) {
        log.error('Timeout failed', { err: error, guildId: interaction.guildId });
        await interaction.editReply({
            content: `Failed to timeout that member, sir. ${error?.message || ''}`.trim()
        });
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// /untimeout
// ─────────────────────────────────────────────────────────────────────────────
async function handleUntimeout(interaction, handler) {
    const gate = await ensureModerator(interaction, handler);
    if (!gate.ok) {
        await interaction.editReply({ content: gate.reason });
        return;
    }
    const targetUser = interaction.options.getUser('user', true);
    const target = await fetchTargetMember(interaction.guild, targetUser.id);
    if (!target) {
        await interaction.editReply({ content: 'That user is not a member of this server, sir.' });
        return;
    }
    if (!target.communicationDisabledUntil || target.communicationDisabledUntil.getTime() <= Date.now()) {
        await interaction.editReply({ content: `${target.user} is not currently timed out, sir.` });
        return;
    }
    try {
        await target.timeout(null, formatAuditReason(gate.member, 'Manual untimeout'));
        await interaction.editReply({ content: `✅ Released ${target.user} from timeout, sir.` });
    } catch (error) {
        log.error('Untimeout failed', { err: error, guildId: interaction.guildId });
        await interaction.editReply({
            content: `Failed to clear timeout, sir. ${error?.message || ''}`.trim()
        });
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// /ban
// ─────────────────────────────────────────────────────────────────────────────
async function handleBan(interaction, handler) {
    const gate = await ensureModerator(interaction, handler);
    if (!gate.ok) {
        await interaction.editReply({ content: gate.reason });
        return;
    }
    const targetUser = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason', false);
    const deleteDays = interaction.options.getInteger('delete_days', false) ?? 0;
    if (targetUser.id === interaction.user.id) {
        await interaction.editReply({ content: 'You cannot ban yourself, sir.' });
        return;
    }
    if (targetUser.id === interaction.client.user?.id) {
        await interaction.editReply({ content: "Sir, I can't ban myself." });
        return;
    }
    if (targetUser.id === interaction.guild.ownerId) {
        await interaction.editReply({ content: 'The server owner is beyond my reach, sir.' });
        return;
    }
    // Member may not be in the guild (banning by ID); fetch is best-effort.
    const target = await fetchTargetMember(interaction.guild, targetUser.id);
    if (target) {
        const check = canActOn(gate.member, target, interaction.client.user);
        if (!check.ok) {
            await interaction.editReply({ content: check.reason });
            return;
        }
    }
    try {
        await interaction.guild.members.ban(targetUser.id, {
            deleteMessageSeconds: deleteDays * 86_400,
            reason: formatAuditReason(gate.member, reason)
        });
        log.info('Ban applied', {
            guildId: interaction.guildId,
            actorId: gate.member.id,
            targetId: targetUser.id,
            deleteDays
        });
        const reasonText = reason ? ` - ${reason}` : '';
        await interaction.editReply({
            content: `🔨 Banned **${targetUser.tag || targetUser.username}** (\`${targetUser.id}\`)${reasonText}, sir.`
        });
    } catch (error) {
        log.error('Ban failed', { err: error, guildId: interaction.guildId });
        await interaction.editReply({
            content: `Failed to ban that member, sir. ${error?.message || ''}`.trim()
        });
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// /kick
// ─────────────────────────────────────────────────────────────────────────────
async function handleKick(interaction, handler) {
    const gate = await ensureModerator(interaction, handler);
    if (!gate.ok) {
        await interaction.editReply({ content: gate.reason });
        return;
    }
    const targetUser = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason', false);
    const target = await fetchTargetMember(interaction.guild, targetUser.id);
    if (!target) {
        await interaction.editReply({ content: 'That user is not a member of this server, sir.' });
        return;
    }
    const check = canActOn(gate.member, target, interaction.client.user);
    if (!check.ok) {
        await interaction.editReply({ content: check.reason });
        return;
    }
    try {
        await target.kick(formatAuditReason(gate.member, reason));
        log.info('Kick applied', {
            guildId: interaction.guildId,
            actorId: gate.member.id,
            targetId: target.id
        });
        const reasonText = reason ? ` - ${reason}` : '';
        await interaction.editReply({
            content: `👢 Kicked ${target.user}${reasonText}, sir.`
        });
    } catch (error) {
        log.error('Kick failed', { err: error, guildId: interaction.guildId });
        await interaction.editReply({
            content: `Failed to kick that member, sir. ${error?.message || ''}`.trim()
        });
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// /unban
// ─────────────────────────────────────────────────────────────────────────────
async function handleUnban(interaction, handler) {
    const gate = await ensureModerator(interaction, handler);
    if (!gate.ok) {
        await interaction.editReply({ content: gate.reason });
        return;
    }
    const me = interaction.guild.members.me;
    if (!me?.permissions?.has('BanMembers')) {
        await interaction.editReply({
            content: 'I lack the Ban Members permission, sir. Cannot unban.'
        });
        return;
    }
    const targetUser = interaction.options.getUser('user', false);
    const userIdRaw = (interaction.options.getString('user_id', false) || '').trim();
    const userId = targetUser?.id || userIdRaw;
    const reason = interaction.options.getString('reason', false);
    if (!userId || !/^\d{5,30}$/.test(userId)) {
        await interaction.editReply({
            content: 'Provide a valid user or numeric user ID, sir.'
        });
        return;
    }
    try {
        const ban = await interaction.guild.bans.fetch(userId).catch(() => null);
        if (!ban) {
            await interaction.editReply({
                content: 'That user is not currently banned, sir.'
            });
            return;
        }
        await interaction.guild.bans.remove(userId, formatAuditReason(gate.member, reason));
        log.info('Unban applied', {
            guildId: interaction.guildId,
            actorId: gate.member.id,
            targetId: userId
        });
        const tag = ban.user?.tag || ban.user?.username || userId;
        const reasonText = reason ? ` - ${reason}` : '';
        await interaction.editReply({
            content: `🕊️ Unbanned **${tag}** (\`${userId}\`)${reasonText}, sir.`
        });
    } catch (error) {
        log.error('Unban failed', { err: error, guildId: interaction.guildId });
        await interaction.editReply({
            content: `Failed to unban that user, sir. ${error?.message || ''}`.trim()
        });
    }
}

module.exports = {
    parseDuration,
    formatDuration,
    ensureModerator,
    canActOn,
    formatAuditReason,
    handlePurge,
    handleTimeout,
    handleUntimeout,
    handleBan,
    handleUnban,
    handleKick
};

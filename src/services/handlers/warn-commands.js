'use strict';

const { EmbedBuilder } = require('discord.js');
const database = require('../database');
const logger = require('../../utils/logger');
const { ensureModerator, canActOn, formatAuditReason, formatDuration } = require('./moderation-commands');

const log = logger.child({ module: 'warn' });

/**
 * Relaxed default escalation thresholds. Override with env vars in production:
 *   WARN_TIER1_COUNT=3 WARN_TIER1_TIMEOUT_MS=600000
 *   WARN_TIER2_COUNT=5 WARN_TIER2_TIMEOUT_MS=3600000
 *   WARN_TIER3_COUNT=10 WARN_TIER3_ACTION=kick
 *
 * We never auto-ban. Kicks only trigger at the hard ceiling and can be disabled
 * by setting WARN_TIER3_ACTION=none.
 */
const TIER1_COUNT = Number(process.env.WARN_TIER1_COUNT) || 3;
const TIER1_TIMEOUT_MS = Number(process.env.WARN_TIER1_TIMEOUT_MS) || 10 * 60_000;
const TIER2_COUNT = Number(process.env.WARN_TIER2_COUNT) || 5;
const TIER2_TIMEOUT_MS = Number(process.env.WARN_TIER2_TIMEOUT_MS) || 60 * 60_000;
const TIER3_COUNT = Number(process.env.WARN_TIER3_COUNT) || 10;
const TIER3_ACTION = (process.env.WARN_TIER3_ACTION || 'kick').toLowerCase();
const TIER_WINDOW_MS = Number(process.env.WARN_WINDOW_MS) || 30 * 24 * 60 * 60_000;

function formatWarningLine(w) {
    const date = w.createdAt ? new Date(w.createdAt).toISOString().slice(0, 10) : '-';
    const moderator = w.moderatorId ? `<@${w.moderatorId}>` : 'unknown';
    const reason = (w.reason || '-').replace(/\n/g, ' ').slice(0, 140);
    return `\`${w.id}\` · <@${w.userId}> · ${date} · by ${moderator}\n   ${reason}`;
}

async function applyEscalation({ interaction, gate, target, total, windowedTotal }) {
    const bot = interaction.client.user;
    const check = canActOn(gate.member, target, bot);
    // If hierarchy forbids us, still record the warning but skip the escalation.
    if (!check.ok) {
        return { action: 'none', note: `escalation skipped: ${check.reason}` };
    }

    if (total >= TIER3_COUNT && TIER3_ACTION === 'kick') {
        try {
            await target.kick(formatAuditReason(gate.member, `Auto-kick: ${total} total warnings`));
            return { action: 'kick', note: `Auto-kicked at ${total} total warnings.` };
        } catch (error) {
            log.error('Auto-kick failed', { err: error, guildId: interaction.guildId, userId: target.id });
            return { action: 'none', note: `Auto-kick failed: ${error?.message || 'unknown error'}` };
        }
    }
    if (windowedTotal >= TIER2_COUNT) {
        try {
            await target.timeout(TIER2_TIMEOUT_MS, formatAuditReason(gate.member, `Auto-timeout: ${windowedTotal} warnings in window`));
            return {
                action: 'timeout',
                note: `Auto-timed out for ${formatDuration(TIER2_TIMEOUT_MS)} at ${windowedTotal} warnings.`
            };
        } catch (error) {
            log.error('Tier2 auto-timeout failed', { err: error, guildId: interaction.guildId, userId: target.id });
        }
    } else if (windowedTotal >= TIER1_COUNT) {
        try {
            await target.timeout(TIER1_TIMEOUT_MS, formatAuditReason(gate.member, `Auto-timeout: ${windowedTotal} warnings in window`));
            return {
                action: 'timeout',
                note: `Auto-timed out for ${formatDuration(TIER1_TIMEOUT_MS)} at ${windowedTotal} warnings.`
            };
        } catch (error) {
            log.error('Tier1 auto-timeout failed', { err: error, guildId: interaction.guildId, userId: target.id });
        }
    }
    return { action: 'none' };
}

async function handleWarnAdd(interaction, gate) {
    if (!database.isConnected) {
        await interaction.editReply({ content: 'Database is offline, sir. Cannot record warnings.' });
        return;
    }
    const targetUser = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason', true);
    const target = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    if (!target) {
        await interaction.editReply({ content: 'That user is not a member of this server, sir.' });
        return;
    }
    const check = canActOn(gate.member, target, interaction.client.user);
    if (!check.ok) {
        await interaction.editReply({ content: check.reason });
        return;
    }
    const warning = await database.addMemberWarning({
        guildId: interaction.guildId,
        userId: target.id,
        moderatorId: gate.member.id,
        reason
    });
    const total = await database.countMemberWarnings({ guildId: interaction.guildId, userId: target.id });
    const windowedTotal = await database.countMemberWarnings({
        guildId: interaction.guildId,
        userId: target.id,
        sinceMs: TIER_WINDOW_MS
    });
    const escalation = await applyEscalation({ interaction, gate, target, total, windowedTotal });

    log.info('Warning issued', {
        guildId: interaction.guildId,
        actorId: gate.member.id,
        targetId: target.id,
        warningId: warning.id,
        total,
        windowedTotal,
        escalationAction: escalation.action
    });

    const embed = new EmbedBuilder()
        .setTitle('⚠️ Warning Issued')
        .setColor(0xffcc33)
        .addFields(
            { name: 'Member', value: `${target.user} (\`${target.id}\`)`, inline: false },
            { name: 'Moderator', value: `${gate.member.user}`, inline: true },
            { name: 'Warning ID', value: `\`${warning.id}\``, inline: true },
            {
                name: 'Strikes',
                value: `**${windowedTotal}** in last 30d · **${total}** total`,
                inline: true
            },
            { name: 'Reason', value: reason.slice(0, 1024), inline: false }
        )
        .setTimestamp();
    if (escalation.note) {
        embed.addFields({ name: 'Auto-action', value: escalation.note, inline: false });
    }
    await interaction.editReply({ embeds: [embed] });

    // DM the warned user best-effort
    try {
        const dm = await target.createDM();
        await dm.send({
            content: `You received a warning in **${interaction.guild.name}** from ${gate.member.user}.\n> ${reason.slice(0, 500)}`
        });
    } catch {
        // user has DMs closed - silent
    }
}

async function handleWarnList(interaction, gate) {
    if (!database.isConnected) {
        await interaction.editReply({ content: 'Database is offline, sir.' });
        return;
    }
    const targetUser = interaction.options.getUser('user', false);
    const rows = await database.listMemberWarnings({
        guildId: interaction.guildId,
        userId: targetUser?.id || null,
        limit: 25
    });
    if (rows.length === 0) {
        await interaction.editReply({
            content: targetUser
                ? `No warnings on record for ${targetUser}, sir.`
                : 'No warnings on record in this server, sir.'
        });
        return;
    }
    const title = targetUser
        ? `Warnings for ${targetUser.tag || targetUser.username}`
        : `Recent warnings in ${interaction.guild.name}`;
    const description = rows.map(formatWarningLine).join('\n\n').slice(0, 4000);
    const embed = new EmbedBuilder()
        .setTitle(title)
        .setColor(0xffaa55)
        .setDescription(description)
        .setFooter({
            text: targetUser
                ? `${rows.length} shown · thresholds: ${TIER1_COUNT}→timeout, ${TIER2_COUNT}→long timeout, ${TIER3_COUNT}→${TIER3_ACTION}`
                : `${rows.length} most recent shown`
        });
    // unused in the non-targetted branch but must keep gate referenced
    void gate;
    await interaction.editReply({ embeds: [embed] });
}

async function handleWarnRemove(interaction) {
    if (!database.isConnected) {
        await interaction.editReply({ content: 'Database is offline, sir.' });
        return;
    }
    const warningId = interaction.options.getString('id', true).trim();
    const removed = await database.removeMemberWarning({
        guildId: interaction.guildId,
        warningId
    });
    if (!removed) {
        await interaction.editReply({ content: `No warning found with id \`${warningId}\` in this server.` });
        return;
    }
    await interaction.editReply({ content: `✅ Warning \`${warningId}\` removed, sir.` });
}

async function handleWarnClear(interaction, gate) {
    if (!database.isConnected) {
        await interaction.editReply({ content: 'Database is offline, sir.' });
        return;
    }
    const targetUser = interaction.options.getUser('user', true);
    const cleared = await database.clearMemberWarnings({
        guildId: interaction.guildId,
        userId: targetUser.id
    });
    log.info('Warnings cleared', {
        guildId: interaction.guildId,
        actorId: gate.member.id,
        targetId: targetUser.id,
        cleared
    });
    await interaction.editReply({
        content: `🧹 Cleared **${cleared}** warning${cleared === 1 ? '' : 's'} for ${targetUser}, sir.`
    });
}

async function handleWarnCommand(interaction, handler) {
    const gate = await ensureModerator(interaction, handler);
    if (!gate.ok) {
        await interaction.editReply({ content: gate.reason });
        return;
    }
    const sub = interaction.options.getSubcommand();
    if (sub === 'add') {return handleWarnAdd(interaction, gate);}
    if (sub === 'list') {return handleWarnList(interaction, gate);}
    if (sub === 'remove') {return handleWarnRemove(interaction, gate);}
    if (sub === 'clear') {return handleWarnClear(interaction, gate);}
    await interaction.editReply({ content: 'Unknown warn subcommand, sir.' });
}

module.exports = {
    handleWarnCommand,
    // exported for tests
    _internals: {
        TIER1_COUNT,
        TIER2_COUNT,
        TIER3_COUNT,
        TIER_WINDOW_MS,
        applyEscalation
    }
};

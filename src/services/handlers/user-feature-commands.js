'use strict';

const { PermissionsBitField } = require('discord.js');
const { isOwner: isOwnerCheck } = require('../../utils/owner-check');

async function handleRemindCommand(interaction) {
    const userFeatures = require('../user-features');
    const subcommand = interaction.options.getSubcommand();
    const userId = interaction.user.id;
    const { channelId } = interaction;
    try {
        if (subcommand === 'set') {
            const message = interaction.options.getString('message');
            const timeInput = interaction.options.getString('time');
            const result = await userFeatures.createReminder(userId, channelId, message, timeInput);
            if (!result.success) {
                await interaction.editReply(result.error);
                return;
            }
            await interaction.editReply(
                `⏰ Reminder set, sir.\n**Message:** ${message}\n**When:** ${result.formattedTime}\n**ID:** \`${result.reminder.id}\``
            );
        } else if (subcommand === 'list') {
            const reminders = await userFeatures.getUserReminders(userId);
            if (reminders.length === 0) {
                await interaction.editReply('No pending reminders, sir. Use `/remind set` to create one.');
                return;
            }
            const lines = await Promise.all(reminders.map(async(r, i) => {
                const time = await userFeatures.formatTimeForUser(userId, new Date(r.scheduledFor));
                return `${i + 1}. **${r.message}**\n   ⏰ ${time} | ID: \`${r.id}\``;
            }));
            await interaction.editReply(`📋 **Your Reminders:**\n\n${lines.join('\n\n')}`);
        } else if (subcommand === 'cancel') {
            const reminderId = interaction.options.getString('id');
            const result = await userFeatures.cancelReminder(userId, reminderId);
            if (!result.success) {
                await interaction.editReply(result.error);
                return;
            }
            await interaction.editReply('✅ Reminder cancelled, sir.');
        }
    } catch (error) {
        console.error('[/remind] Error:', error);
        await interaction.editReply('Failed to process reminder command, sir.');
    }
}

async function handleTimezoneCommand(interaction) {
    const userFeatures = require('../user-features');
    const userId = interaction.user.id;
    const zone = interaction.options.getString('zone');
    try {
        if (!zone) {
            const currentZone = await userFeatures.getTimezone(userId);
            const currentTime = await userFeatures.formatTimeForUser(userId);
            await interaction.editReply(
                `🌍 **Your Timezone:** ${currentZone}\n🕐 **Current Time:** ${currentTime}\n\nUse \`/timezone zone:America/New_York\` to change.`
            );
            return;
        }
        const result = await userFeatures.setTimezone(userId, zone);
        if (!result.success) {
            await interaction.editReply(result.error);
            return;
        }
        const currentTime = await userFeatures.formatTimeForUser(userId);
        await interaction.editReply(`✅ Timezone set to **${result.timezone}**\n🕐 Current time: ${currentTime}`);
    } catch (error) {
        console.error('[/timezone] Error:', error);
        await interaction.editReply('Failed to update timezone, sir.');
    }
}

async function handleWakewordCommand(handler, interaction) {
    const userFeatures = require('../user-features');
    const userId = interaction.user.id;
    const sub = interaction.options.getSubcommand(false);
    const subcommandGroup = interaction.options.getSubcommandGroup(false);

    // Legacy compat: if no subcommand (old-style optional params), map to new subcommands
    const word = interaction.options.getString('word');
    const scope = interaction.options.getString('scope');
    const clearOpt = interaction.options.getBoolean('clear');
    const disableDefaultsOpt = interaction.options.getBoolean('disable_defaults');
    const legacyMode = !sub;

    let action = sub;
    if (subcommandGroup === 'server' && sub) {
        action = `server-${sub}`;
    } else if (legacyMode) {
        if (scope === 'server') {
            if (disableDefaultsOpt !== null && disableDefaultsOpt !== undefined) action = 'server-defaults';
            else if (clearOpt) action = 'server-clear';
            else if (word) action = 'server-set';
            else action = 'show';
        } else {
            if (clearOpt) action = 'clear';
            else if (word) action = 'set';
            else action = 'show';
        }
    }

    try {
        // ── Show personal settings ──
        if (action === 'view' || action === 'show') {
            const currentWord = await userFeatures.getWakeWord(userId);
            const lines = [];
            if (currentWord) {
                lines.push(`**Personal wake word:** "${currentWord}"`);
            } else {
                lines.push('**Personal wake word:** Not set');
            }
            if (interaction.guild) {
                const guildWord = await userFeatures.getGuildWakeWord(interaction.guild.id);
                const defaultsDisabled = await userFeatures.isGuildWakeWordsDisabled(interaction.guild.id);
                lines.push(guildWord ? `**Server wake word:** "${guildWord}"` : '**Server wake word:** Not set');
                lines.push(`**Default wake words:** ${defaultsDisabled ? 'Off' : 'On'}${defaultsDisabled ? ' (custom words or mentions only)' : ' ("jarvis" / "garmin")'}`);
            }
            lines.push('');
            lines.push('Use `/wakeword set word:friday` to set your own wake word.');
            if (interaction.guild) {
                lines.push('Admins can use `/wakeword server set word:friday` or `/wakeword server defaults enabled:false`.');
            }
            lines.push('You can always mention me directly.');
            await interaction.editReply(lines.join('\n'));
            return;
        }

        // ── Set personal ──
        if (action === 'set') {
            const w = word || interaction.options.getString('word');
            if (!w) { await interaction.editReply('Provide a word, sir. `/wakeword set word:something`'); return; }
            const result = await userFeatures.setWakeWord(userId, w);
            if (!result.success) { await interaction.editReply(result.error); return; }
            await interaction.editReply(`Wake word set to **"${result.wakeWord}"**. Use \`/wakeword show\` any time to check your settings.`);
            return;
        }

        // ── Clear personal ──
        if (action === 'clear') {
            await userFeatures.clearWakeWord(userId);
            await interaction.editReply('Personal wake word removed.');
            return;
        }

        // ── Show server settings ──
        if (action === 'server-show') {
            if (!interaction.guild) {
                await interaction.editReply('This only works in a server, sir.');
                return;
            }

            const guildWord = await userFeatures.getGuildWakeWord(interaction.guild.id);
            const defaultsDisabled = await userFeatures.isGuildWakeWordsDisabled(interaction.guild.id);
            const lines = [
                guildWord ? `**Server wake word:** "${guildWord}"` : '**Server wake word:** Not set',
                `**Default wake words:** ${defaultsDisabled ? 'Off' : 'On'}${defaultsDisabled ? ' (custom words or mentions only)' : ' ("jarvis" / "garmin")'}`,
                '',
                'Admins can use `/wakeword server set word:friday`, `/wakeword server clear`, or `/wakeword server defaults enabled:false`.'
            ];
            await interaction.editReply(lines.join('\n'));
            return;
        }

        // ── Server commands (admin only) ──
        if (action.startsWith('server-')) {
            if (!interaction.guild) {
                await interaction.editReply('This only works in a server, sir.');
                return;
            }
            const { member } = interaction;
            const isAdmin = isOwnerCheck(member.id) ||
                member.permissions?.has(PermissionsBitField.Flags.Administrator) ||
                member.permissions?.has(PermissionsBitField.Flags.ManageGuild) ||
                member.id === interaction.guild.ownerId;
            if (!isAdmin) {
                await interaction.editReply('Only admins can change the server wake word.');
                return;
            }
            const guildId = interaction.guild.id;

            if (action === 'server-set') {
                const w = word || interaction.options.getString('word');
                if (!w) { await interaction.editReply('Provide a word, sir.'); return; }
                const result = await userFeatures.setGuildWakeWord(guildId, w);
                if (!result.success) { await interaction.editReply(result.error); return; }
                await interaction.editReply(`Server wake word set to **"${result.wakeWord}"**. Default triggers ("jarvis" / "garmin") are now disabled for this server.`);
                return;
            }

            if (action === 'server-clear') {
                await userFeatures.removeGuildWakeWord(guildId);
                const defaultsDisabled = await userFeatures.isGuildWakeWordsDisabled(guildId);
                await interaction.editReply(defaultsDisabled
                    ? 'Server wake word removed. Defaults are still off - I\'ll only respond to personal wake words or mentions.'
                    : 'Server wake word removed. Back to the defaults ("jarvis" / "garmin").');
                return;
            }

            if (action === 'server-defaults') {
                const enabled = legacyMode ? !disableDefaultsOpt : interaction.options.getBoolean('enabled');
                await userFeatures.setGuildWakeWordsDisabled(guildId, !enabled);
                await interaction.editReply(enabled
                    ? 'Default wake words ("jarvis" / "garmin") enabled for this server.'
                    : 'Default wake words disabled. I\'ll only respond to custom or personal wake words.');
                return;
            }
        }
    } catch (error) {
        console.error('[/wakeword] Error:', error);
        await interaction.editReply('Failed to update wake word, sir.');
    }
}

module.exports = { handleRemindCommand, handleTimezoneCommand, handleWakewordCommand };

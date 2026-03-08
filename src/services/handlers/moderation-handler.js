/**
 * Moderation Command Handlers - Split from part-05.js for maintainability
 * 
 * This module handles all moderation slash commands (ban, kick, mute, etc.)
 */

const { EmbedBuilder } = require('discord.js');
const appContext = require('../../core/app-context');

/**
 * Handle moderation slash commands
 * @param {string} command - The command name
 * @param {Object} interaction - Discord interaction
 * @param {Object} telemetryMetadata - Telemetry metadata object
 * @returns {Object} - { response, handled }
 */
async function handleModerationCommand(command, interaction, telemetryMetadata) {
    let response = null;
    let handled = true;

    switch (command) {
        case 'ban': {
            telemetryMetadata.category = 'moderation';
            const userInput = interaction.options.getString('user', true);
            const duration = interaction.options.getString('duration');
            const reason = interaction.options.getString('reason') || `Banned by ${interaction.user.tag}`;

            if (!interaction.guild) { response = 'This command only works in servers.'; break; }

            const { resolveUser } = require('../../utils/resolve-user');
            const { user: targetUser, member: targetMember, error: resolveError } = await resolveUser(interaction.client, interaction.guild, userInput);
            if (!targetUser) { response = `❌ ${resolveError || 'User not found.'}`; break; }

            // Self-targeting check
            if (targetUser.id === interaction.user.id) {
                response = '❌ You cannot ban yourself.';
                break;
            }
            // Server owner check
            if (targetUser.id === interaction.guild.ownerId) {
                response = '❌ You cannot ban the server owner.';
                break;
            }
            // Role hierarchy check (moderator vs target)
            if (targetMember) {
                const executor = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
                if (executor && targetMember.roles.highest.position >= executor.roles.highest.position) {
                    response = '❌ You cannot ban members with equal or higher roles than you.';
                    break;
                }
            }
            if (targetMember && !targetMember.bannable) {
                response = '❌ I cannot ban that member (role hierarchy issue).';
                break;
            }

            // Parse duration using shared utility
            const { parseDuration } = require('../../utils/parse-duration');
            let banDuration = null;
            if (duration) {
                banDuration = parseDuration(duration);
            }

            try {
                await interaction.guild.members.ban(targetUser.id, { reason, deleteMessageSeconds: 0 });

                let durationText = 'permanently';
                if (banDuration) {
                    const mins = Math.floor(banDuration / 60000);
                    const hours = Math.floor(mins / 60);
                    const days = Math.floor(hours / 24);
                    if (days > 0) {durationText = `for ${days} day(s)`;}
                    else if (hours > 0) {durationText = `for ${hours} hour(s)`;}
                    else {durationText = `for ${mins} minute(s)`;}

                    // Schedule unban
                    setTimeout(async() => {
                        try {
                            await interaction.guild.members.unban(targetUser.id, 'Temporary ban expired');
                        } catch (err) {
                            console.warn(`[Moderation] Auto-unban failed for ${targetUser.id}:`, err.message);
                        }
                    }, banDuration);
                }

                response = `🔨 **${targetUser.tag}** has been banned ${durationText}.`;
                // Send GIF as followup so it embeds properly
                setTimeout(() => {
                    interaction.followUp('https://c.tenor.com/9zCgefg___cAAAAC/tenor.gif').catch(() => { });
                }, 500);
            } catch (error) {
                response = `❌ Ban failed: ${error.message}`;
            }
            break;
        }

        case 'unban': {
            telemetryMetadata.category = 'moderation';
            const userInput = interaction.options.getString('user', true);
            const reason = interaction.options.getString('reason') || `Unbanned by ${interaction.user.tag}`;

            if (!interaction.guild) { response = 'This command only works in servers.'; break; }

            const { resolveUser } = require('../../utils/resolve-user');
            const { user: targetUser, error: resolveError } = await resolveUser(interaction.client, interaction.guild, userInput);
            if (!targetUser) { response = `❌ ${resolveError || 'User not found.'}`; break; }

            try {
                await interaction.guild.members.unban(targetUser.id, reason);
                response = `🔓 **${targetUser.tag}** has been unbanned.`;
            } catch (error) {
                response = `❌ Unban failed: ${error.message}`;
            }
            break;
        }

        case 'kick': {
            telemetryMetadata.category = 'moderation';
            const userInput = interaction.options.getString('user', true);
            const reason = interaction.options.getString('reason') || `Kicked by ${interaction.user.tag}`;

            if (!interaction.guild) { response = 'This command only works in servers.'; break; }

            const { resolveUser } = require('../../utils/resolve-user');
            const { user: targetUser, member: targetMember, error: resolveError } = await resolveUser(interaction.client, interaction.guild, userInput);
            if (!targetUser) { response = `❌ ${resolveError || 'User not found.'}`; break; }
            if (!targetMember) { response = '❌ User not found in this server.'; break; }

            // Self-targeting check
            if (targetUser.id === interaction.user.id) {
                response = '❌ You cannot kick yourself.';
                break;
            }
            // Server owner check
            if (targetUser.id === interaction.guild.ownerId) {
                response = '❌ You cannot kick the server owner.';
                break;
            }
            // Role hierarchy check (moderator vs target)
            const kickExecutor = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
            if (kickExecutor && targetMember.roles.highest.position >= kickExecutor.roles.highest.position) {
                response = '❌ You cannot kick members with equal or higher roles than you.';
                break;
            }
            if (!targetMember.kickable) { response = '❌ I cannot kick that member.'; break; }

            try {
                await targetMember.kick(reason);
                response = `👢 **${targetUser.tag}** has been kicked.\nReason: ${reason}`;
            } catch (error) {
                response = `❌ Kick failed: ${error.message}`;
            }
            break;
        }

        case 'unmute': {
            telemetryMetadata.category = 'moderation';
            const userInput = interaction.options.getString('user', true);
            const reason = interaction.options.getString('reason') || `Unmuted by ${interaction.user.tag}`;

            if (!interaction.guild) { response = 'This command only works in servers.'; break; }

            const { resolveUser } = require('../../utils/resolve-user');
            const { user: targetUser, member: targetMember, error: resolveError } = await resolveUser(interaction.client, interaction.guild, userInput);
            if (!targetUser || !targetMember) { response = `❌ ${resolveError || 'User not found in this server.'}`; break; }

            try {
                await targetMember.timeout(null, reason);
                response = `🔊 **${targetUser.tag}** has been unmuted.`;
            } catch (error) {
                response = `❌ Unmute failed: ${error.message}`;
            }
            break;
        }

        case 'mute': {
            telemetryMetadata.category = 'moderation';
            const userInput = interaction.options.getString('user', true);
            const duration = interaction.options.getString('duration', true);
            const reason = interaction.options.getString('reason') || `Muted by ${interaction.user.tag}`;

            if (!interaction.guild) { response = 'This command only works in servers.'; break; }

            const { resolveUser } = require('../../utils/resolve-user');
            const { user: targetUser, member: targetMember, error: resolveError } = await resolveUser(interaction.client, interaction.guild, userInput);
            if (!targetUser || !targetMember) { response = `❌ ${resolveError || 'User not found in this server.'}`; break; }

            // Self-targeting check
            if (targetUser.id === interaction.user.id) {
                response = '❌ You cannot mute yourself.';
                break;
            }
            // Server owner check
            if (targetUser.id === interaction.guild.ownerId) {
                response = '❌ You cannot mute the server owner.';
                break;
            }
            // Role hierarchy check (moderator vs target)
            const muteExecutor = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
            if (muteExecutor && targetMember.roles.highest.position >= muteExecutor.roles.highest.position) {
                response = '❌ You cannot mute members with equal or higher roles than you.';
                break;
            }
            if (!targetMember.moderatable) { response = '❌ I cannot mute that member.'; break; }

            // Parse duration using shared utility
            const { parseDuration } = require('../../utils/parse-duration');
            const durationMs = parseDuration(duration);
            if (!durationMs) { response = '❌ Invalid duration. Use format like 10m, 1h, 1d'; break; }

            if (durationMs > 28 * 24 * 60 * 60 * 1000) { response = '❌ Maximum mute is 28 days.'; break; }

            try {
                await targetMember.timeout(durationMs, reason);
                response = `🔇 **${targetUser.tag}** has been muted for **${duration}**.\nReason: ${reason}`;
            } catch (error) {
                response = `❌ Mute failed: ${error.message}`;
            }
            break;
        }

        case 'warn': {
            telemetryMetadata.category = 'moderation';
            const userInput = interaction.options.getString('user', true);
            const reason = interaction.options.getString('reason', true);

            if (!interaction.guild) { response = 'This command only works in servers.'; break; }

            const { resolveUser } = require('../../utils/resolve-user');
            const { user: targetUser } = await resolveUser(interaction.client, interaction.guild, userInput);
            if (!targetUser) { response = '❌ User not found.'; break; }

            // Store warning
            const guildId = interaction.guild.id;
            const userId = targetUser.id;

            const warnings = appContext.getWarnings();
            if (!warnings.has(guildId)) {warnings.set(guildId, new Map());}

            const guildWarnings = warnings.get(guildId);
            const userWarnings = guildWarnings.get(userId) || [];
            userWarnings.push({ reason, warnedBy: interaction.user.id, timestamp: Date.now() });
            guildWarnings.set(userId, userWarnings);

            const embed = new EmbedBuilder()
                .setTitle('⚠️ Warning Issued')
                .setColor(0xf39c12)
                .setDescription(`**${targetUser.tag}** has been warned.`)
                .addFields(
                    { name: 'Reason', value: reason, inline: false },
                    { name: 'Total Warnings', value: `${userWarnings.length}`, inline: true }
                )
                .setFooter({ text: `Warned by ${interaction.user.tag}` })
                .setTimestamp();

            // Try to DM user
            try { await targetUser.send(`⚠️ You have been warned in **${interaction.guild.name}**\nReason: ${reason}`); } catch { }

            response = { embeds: [embed] };
            break;
        }

        case 'purge': {
            telemetryMetadata.category = 'moderation';
            const count = interaction.options.getInteger('count', true);
            const targetUser = interaction.options.getUser('user');

            if (!interaction.guild) { response = 'This command only works in servers.'; break; }
            if (!interaction.channel) { response = '❌ Cannot access channel.'; break; }

            try {
                let messages;
                if (targetUser) {
                    // Fetch more messages to filter by user
                    const fetched = await interaction.channel.messages.fetch({ limit: 100 });
                    messages = fetched.filter(m => m.author.id === targetUser.id).first(count);
                } else {
                    messages = await interaction.channel.messages.fetch({ limit: count });
                }

                const deleted = await interaction.channel.bulkDelete(messages, true);
                response = `🗑️ Deleted **${deleted.size}** message${deleted.size !== 1 ? 's' : ''}.${targetUser ? ` (from ${targetUser.tag})` : ''}`;
            } catch (error) {
                response = `❌ Purge failed: ${error.message}`;
            }
            break;
        }

        case 'userinfo': {
            telemetryMetadata.category = 'utility';
            const targetUser = interaction.options.getUser('user') || interaction.user;

            if (!interaction.guild) { response = 'This command only works in servers.'; break; }

            const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

            const embed = new EmbedBuilder()
                .setTitle(`👤 ${targetUser.tag}`)
                .setThumbnail(targetUser.displayAvatarURL({ size: 256 }))
                .setColor(member?.displayHexColor || 0x3498db)
                .addFields(
                    { name: 'ID', value: targetUser.id, inline: true },
                    { name: 'Bot', value: targetUser.bot ? 'Yes' : 'No', inline: true },
                    { name: 'Created', value: `<t:${Math.floor(targetUser.createdTimestamp / 1000)}:R>`, inline: true }
                );

            if (member) {
                embed.addFields(
                    { name: 'Joined', value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`, inline: true },
                    { name: 'Nickname', value: member.nickname || 'None', inline: true },
                    { name: 'Roles', value: member.roles.cache.size > 1 ? `${member.roles.cache.size - 1} roles` : 'None', inline: true }
                );
                if (member.premiumSinceTimestamp) {
                    embed.addFields({ name: 'Boosting Since', value: `<t:${Math.floor(member.premiumSinceTimestamp / 1000)}:R>`, inline: true });
                }
            }

            response = { embeds: [embed] };
            break;
        }

        case 'serverinfo': {
            telemetryMetadata.category = 'utility';

            if (!interaction.guild) { response = 'This command only works in servers.'; break; }

            const { guild } = interaction;
            const owner = await guild.fetchOwner().catch(() => null);

            const iconUrl = guild.iconURL({ size: 256 });
            const bannerUrl = guild.bannerURL({ size: 1024 });

            const embed = new EmbedBuilder()
                .setAuthor({
                    name: guild.name,
                    iconURL: iconUrl || undefined
                })
                .setTitle('🏰 Server Overview')
                .setThumbnail(iconUrl)
                .setColor(0x9b59b6)
                .addFields(
                    { name: '🆔 ID', value: guild.id, inline: true },
                    { name: '👑 Owner', value: owner ? owner.user.tag : 'Unknown', inline: true },
                    { name: '📅 Created', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`, inline: true },
                    { name: '👥 Members', value: `${guild.memberCount.toLocaleString()}`, inline: true },
                    { name: '💬 Channels', value: `${guild.channels.cache.size}`, inline: true },
                    { name: '🛡️ Roles', value: `${guild.roles.cache.size}`, inline: true },
                    { name: '🚀 Boost Level', value: `Tier ${guild.premiumTier}`, inline: true },
                    { name: '💎 Boosts', value: `${guild.premiumSubscriptionCount || 0}`, inline: true },
                    { name: '😄 Emojis', value: `${guild.emojis.cache.size}`, inline: true }
                );

            if (guild.description) {
                embed.setDescription(guild.description);
            }
            if (bannerUrl) {
                embed.setImage(bannerUrl);
            }

            response = { embeds: [embed] };
            break;
        }

        default:
            handled = false;
    }

    return { response, handled };
}

// List of commands this module handles
const MODERATION_COMMANDS = [
    'ban', 'unban', 'kick', 'mute', 'unmute',
    'warn', 'purge',
    'userinfo', 'serverinfo'
];

module.exports = {
    handleModerationCommand,
    MODERATION_COMMANDS
};

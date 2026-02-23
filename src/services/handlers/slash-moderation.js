'use strict';

const { EmbedBuilder } = require('discord.js');
const { resolveUser } = require('../../utils/resolve-user');
const { parseDuration, formatDuration, MAX_TIMEOUT_MS } = require('../../utils/parse-duration');
const database = require('../database');

async function handleBan(interaction) {
    const userInput = interaction.options.getString('user', true);
    const duration = interaction.options.getString('duration');
    const reason = interaction.options.getString('reason') || `Banned by ${interaction.user.tag}`;

    if (!interaction.guild) { return 'This command only works in servers.'; }

    const { user: targetUser, member: targetMember, error: resolveError } = await resolveUser(interaction.client, interaction.guild, userInput);
    if (!targetUser) { return `❌ ${resolveError || 'User not found.'}`; }
    // Self-targeting check
    if (targetUser.id === interaction.user.id) {
        return '❌ You cannot ban yourself.';
    }
    // Server owner check
    if (targetUser.id === interaction.guild.ownerId) {
        return '❌ You cannot ban the server owner.';
    }
    // Role hierarchy check (moderator vs target)
    if (targetMember) {
        const executor = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
        if (executor && targetMember.roles.highest.position >= executor.roles.highest.position) {
            return '❌ You cannot ban members with equal or higher roles than you.';
        }
    }
    if (targetMember && !targetMember.bannable) {
        return '❌ I cannot ban that member (role hierarchy issue).';
    }

    // Parse duration using shared utility
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
                } catch (_e) { console.warn('[ban] Auto-unban failed:', _e.message); }
            }, banDuration);
        }

        const response = `🔨 **${targetUser.tag}** has been banned ${durationText}.`;
        // Send GIF as followup so it embeds properly
        setTimeout(() => {
            interaction.followUp('https://c.tenor.com/9zCgefg___cAAAAC/tenor.gif').catch(() => {});
        }, 500);
        return response;
    } catch (error) {
        return `❌ Ban failed: ${error.message}`;
    }
}

async function handleUnban(interaction) {
    const userInput = interaction.options.getString('user', true);
    const reason = interaction.options.getString('reason') || `Unbanned by ${interaction.user.tag}`;

    if (!interaction.guild) { return 'This command only works in servers.'; }

    const { user: targetUser, error: resolveError } = await resolveUser(interaction.client, interaction.guild, userInput);
    if (!targetUser) { return `❌ ${resolveError || 'User not found.'}`; }

    try {
        await interaction.guild.members.unban(targetUser.id, reason);
        return `🔓 **${targetUser.tag}** has been unbanned.`;
    } catch (error) {
        return `❌ Unban failed: ${error.message}`;
    }
}

async function handleKick(interaction) {
    const userInput = interaction.options.getString('user', true);
    const reason = interaction.options.getString('reason') || `Kicked by ${interaction.user.tag}`;

    if (!interaction.guild) { return 'This command only works in servers.'; }

    const { user: targetUser, member: targetMember, error: resolveError } = await resolveUser(interaction.client, interaction.guild, userInput);
    if (!targetUser) { return `❌ ${resolveError || 'User not found.'}`; }
    if (!targetMember) { return '❌ User not found in this server.'; }
    // Self-targeting check
    if (targetUser.id === interaction.user.id) {
        return '❌ You cannot kick yourself.';
    }
    // Server owner check
    if (targetUser.id === interaction.guild.ownerId) {
        return '❌ You cannot kick the server owner.';
    }
    // Role hierarchy check (moderator vs target)
    const kickExecutor = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (kickExecutor && targetMember.roles.highest.position >= kickExecutor.roles.highest.position) {
        return '❌ You cannot kick members with equal or higher roles than you.';
    }
    if (!targetMember.kickable) { return '❌ I cannot kick that member.'; }

    try {
        await targetMember.kick(reason);
        return `👢 **${targetUser.tag}** has been kicked.\nReason: ${reason}`;
    } catch (error) {
        return `❌ Kick failed: ${error.message}`;
    }
}

async function handleMute(interaction) {
    const userInput = interaction.options.getString('user', true);
    const duration = interaction.options.getString('duration', true);
    const reason = interaction.options.getString('reason') || `Muted by ${interaction.user.tag}`;

    if (!interaction.guild) { return 'This command only works in servers.'; }

    const { user: targetUser, member: targetMember, error: resolveError } = await resolveUser(interaction.client, interaction.guild, userInput);
    if (!targetUser || !targetMember) { return `❌ ${resolveError || 'User not found in this server.'}`; }
    if (!targetMember) { return '❌ User not found in this server.'; }
    // Self-targeting check
    if (targetUser.id === interaction.user.id) {
        return '❌ You cannot mute yourself.';
    }
    // Server owner check
    if (targetUser.id === interaction.guild.ownerId) {
        return '❌ You cannot mute the server owner.';
    }
    // Role hierarchy check (moderator vs target)
    const muteExecutor = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (muteExecutor && targetMember.roles.highest.position >= muteExecutor.roles.highest.position) {
        return '❌ You cannot mute members with equal or higher roles than you.';
    }
    if (!targetMember.moderatable) { return '❌ I cannot mute that member.'; }

    // Parse duration using shared utility
    const durationMs = parseDuration(duration);
    if (!durationMs) { return '❌ Invalid duration. Use format like 10m, 1h, 1d'; }

    if (durationMs > 28 * 24 * 60 * 60 * 1000) { return '❌ Maximum mute is 28 days.'; }

    try {
        await targetMember.timeout(durationMs, reason);
        return `🔇 **${targetUser.tag}** has been muted for **${duration}**.\nReason: ${reason}`;
    } catch (error) {
        return `❌ Mute failed: ${error.message}`;
    }
}

async function handleUnmute(interaction) {
    const userInput = interaction.options.getString('user', true);
    const reason = interaction.options.getString('reason') || `Unmuted by ${interaction.user.tag}`;

    if (!interaction.guild) { return 'This command only works in servers.'; }

    const { user: targetUser, member: targetMember, error: resolveError } = await resolveUser(interaction.client, interaction.guild, userInput);
    if (!targetUser || !targetMember) { return `❌ ${resolveError || 'User not found in this server.'}`; }
    if (!targetMember) { return '❌ User not found in this server.'; }

    try {
        // Remove timeout
        await targetMember.timeout(null, reason);
        return `🔊 **${targetUser.tag}** has been unmuted.`;
    } catch (error) {
        return `❌ Unmute failed: ${error.message}`;
    }
}

async function handleWarn(interaction) {
    const userInput = interaction.options.getString('user', true);
    const reason = interaction.options.getString('reason', true);

    if (!interaction.guild) { return 'This command only works in servers.'; }

    const { user: targetUser, member: targetMember, error: resolveError } = await resolveUser(interaction.client, interaction.guild, userInput);
    if (!targetUser) { return `❌ ${resolveError || 'User not found.'}`; }

    // Store warning in database
    const guildId = interaction.guild.id;
    const userId = targetUser.id;

    let warningCount = 1;
    try {
        const warningDoc = {
            guildId,
            userId,
            reason,
            warnedBy: interaction.user.id,
            timestamp: new Date()
        };
        if (database.isConnected) {
            const col = database.db.collection('warnings');
            await col.insertOne(warningDoc);
            warningCount = await col.countDocuments({ guildId, userId });
        }
    } catch (dbErr) {
        console.warn('[warn] Failed to persist warning:', dbErr.message);
    }
    const userWarnings = { length: warningCount };

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

    // Try to DM user (may fail if DMs are closed)
    try { await targetUser.send(`⚠️ You have been warned in **${interaction.guild.name}**\nReason: ${reason}`); } catch (_e) { /* DMs disabled */ }

    return { embeds: [embed] };
}

async function handlePurge(interaction) {
    const count = interaction.options.getInteger('count', true);
    const targetUser = interaction.options.getUser('user');

    if (!interaction.guild) { return 'This command only works in servers.'; }
    if (!interaction.channel) { return '❌ Cannot access channel.'; }

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
        return `🗑️ Deleted **${deleted.size}** message${deleted.size !== 1 ? 's' : ''}.${targetUser ? ` (from ${targetUser.tag})` : ''}`;
    } catch (error) {
        return `❌ Purge failed: ${error.message}`;
    }
}

async function handleSlowmode(interaction) {
    const durationStr = interaction.options.getString('duration', true);

    if (!interaction.guild) { return 'This command only works in servers.'; }
    if (!interaction.channel || !interaction.channel.setRateLimitPerUser) {
        return '❌ Cannot modify this channel type.';
    }

    // Parse duration (0 to disable)
    let seconds = 0;
    if (durationStr !== '0' && durationStr !== 'off') {
        const ms = parseDuration(durationStr);
        if (!ms) {
            return '❌ Invalid duration. Use format like `5s`, `1m`, `0` to disable.';
        }
        seconds = Math.floor(ms / 1000);
        if (seconds > 21600) { // 6 hours max
            return '❌ Maximum slowmode is 6 hours (21600 seconds).';
        }
    }

    try {
        await interaction.channel.setRateLimitPerUser(seconds);
        if (seconds === 0) {
            return '⚡ Slowmode disabled for this channel.';
        } 
        return `🐌 Slowmode set to **${durationStr}** for this channel.`;
        
    } catch (error) {
        return `❌ Failed to set slowmode: ${error.message}`;
    }
}

async function handleLockdown(interaction) {
    const action = interaction.options.getString('action', true);
    const reason = interaction.options.getString('reason') || `Channel ${action}ed by ${interaction.user.tag}`;

    if (!interaction.guild) { return 'This command only works in servers.'; }
    if (!interaction.channel || !interaction.channel.permissionOverwrites) {
        return '❌ Cannot modify this channel type.';
    }

    try {
        const { everyone } = interaction.guild.roles;
        if (action === 'lock') {
            await interaction.channel.permissionOverwrites.edit(everyone, { SendMessages: false }, { reason });
            return `🔒 Channel locked.\nReason: ${reason}`;
        } 
        await interaction.channel.permissionOverwrites.edit(everyone, { SendMessages: null }, { reason });
        return '🔓 Channel unlocked.';
        
    } catch (error) {
        return `❌ Lockdown failed: ${error.message}`;
    }
}

async function handleUserinfo(interaction) {
    const targetUser = interaction.options.getUser('user') || interaction.user;

    if (!interaction.guild) { return 'This command only works in servers.'; }

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

    return { embeds: [embed] };
}

async function handleServerinfo(interaction) {
    if (!interaction.guild) { return 'This command only works in servers.'; }

    const { guild } = interaction;
    const owner = await guild.fetchOwner().catch(() => null);

    const embed = new EmbedBuilder()
        .setTitle(`🏰 ${guild.name}`)
        .setThumbnail(guild.iconURL({ size: 256 }))
        .setColor(0x9b59b6)
        .addFields(
            { name: 'ID', value: guild.id, inline: true },
            { name: 'Owner', value: owner ? owner.user.tag : 'Unknown', inline: true },
            { name: 'Created', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`, inline: true },
            { name: 'Members', value: `${guild.memberCount.toLocaleString()}`, inline: true },
            { name: 'Channels', value: `${guild.channels.cache.size}`, inline: true },
            { name: 'Roles', value: `${guild.roles.cache.size}`, inline: true },
            { name: 'Boost Level', value: `Tier ${guild.premiumTier}`, inline: true },
            { name: 'Boosts', value: `${guild.premiumSubscriptionCount || 0}`, inline: true },
            { name: 'Emojis', value: `${guild.emojis.cache.size}`, inline: true }
        );

    if (guild.description) {
        embed.setDescription(guild.description);
    }

    return { embeds: [embed] };
}

module.exports = {
    handleBan,
    handleUnban,
    handleKick,
    handleMute,
    handleUnmute,
    handleWarn,
    handlePurge,
    handleSlowmode,
    handleLockdown,
    handleUserinfo,
    handleServerinfo
};

'use strict';

const { ChannelType, PermissionsBitField } = require('discord.js');
const { createCanvas } = require('canvas');
const database = require('../database');

function formatServerStatsValue(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return '0';
    }

    return Math.max(0, Math.floor(value)).toLocaleString();
}

function formatServerStatsName(label, value) {
    return `${label}: ${formatServerStatsValue(value)}`;
}

async function ensureBotCanManageChannels(handler, guild) {
    if (!guild) {
        throw handler.createFriendlyError('I could not access that server, sir.');
    }

    let botMember = guild.members.me || null;

    try {
        if (!botMember) {
            botMember = await guild.members.fetchMe();
        }
    } catch (error) {
        console.warn('Failed to fetch bot membership for server stats:', error);
        throw handler.createFriendlyError('I could not verify my permissions in that server, sir.');
    }

    if (!botMember) {
        throw handler.createFriendlyError('I am not present in that server, sir.');
    }

    if (!botMember.permissions?.has(PermissionsBitField.Flags.ManageChannels)) {
        throw handler.createFriendlyError('I require the Manage Channels permission to manage server stats, sir.');
    }

    return botMember;
}

async function applyServerStatsPermissions(channel, botMember, everyoneId) {
    if (!channel?.permissionOverwrites || !everyoneId) {
        return;
    }

    try {
        await channel.permissionOverwrites.edit(everyoneId, {
            ViewChannel: true,
            Connect: false,
            Speak: false
        });
    } catch (error) {
        if (error.code !== 50013 && error.code !== 50001) {
            console.warn('Failed to update @everyone permissions for server stats channel:', error);
        }
    }

    if (botMember) {
        try {
            await channel.permissionOverwrites.edit(botMember.id, {
                ViewChannel: true,
                Connect: true,
                Speak: true,
                ManageChannels: true,
                MoveMembers: true
            });
        } catch (error) {
            if (error.code !== 50013 && error.code !== 50001) {
                console.warn('Failed to update bot permissions for server stats channel:', error);
            }
        }
    }
}

async function ensureServerStatsChannels(handler, guild, existingConfig = null, botMember = null) {
    if (!guild) {
        throw handler.createFriendlyError('I could not access that server, sir.');
    }

    const me = botMember || await ensureBotCanManageChannels(handler, guild);
    const everyoneId = guild.roles.everyone?.id;

    if (!everyoneId) {
        throw handler.createFriendlyError('I could not determine the default role for that server, sir.');
    }

    const creationOverwrites = [
        {
            id: everyoneId,
            allow: [PermissionsBitField.Flags.ViewChannel],
            deny: [PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.Speak]
        },
        {
            id: me.id,
            allow: [
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.ManageChannels,
                PermissionsBitField.Flags.Connect,
                PermissionsBitField.Flags.Speak,
                PermissionsBitField.Flags.MoveMembers
            ]
        }
    ];

    let category = null;

    if (existingConfig?.categoryId) {
        category = await handler.resolveGuildChannel(guild, existingConfig.categoryId);
    }

    if (!category || category.type !== ChannelType.GuildCategory) {
        category = guild.channels.cache.find(channel => channel.type === ChannelType.GuildCategory && channel.name === handler.serverStatsCategoryName) || null;
    }

    if (!category || category.type !== ChannelType.GuildCategory) {
        try {
            category = await guild.channels.create({
                name: handler.serverStatsCategoryName,
                type: ChannelType.GuildCategory,
                permissionOverwrites: creationOverwrites
            });
        } catch (error) {
            if (error.code === 50013) {
                throw handler.createFriendlyError('I lack permission to create the server stats category, sir.');
            }
            throw error;
        }
    } else {
        if (category.name !== handler.serverStatsCategoryName) {
            try {
                await category.setName(handler.serverStatsCategoryName);
            } catch (error) {
                if (error.code === 50013) {
                    throw handler.createFriendlyError('I lack permission to rename the server stats category, sir.');
                }
                console.warn('Failed to rename server stats category:', error);
            }
        }

        await applyServerStatsPermissions(category, me, everyoneId);
    }

    const ensureVoiceChannel = async(channelId, placeholderName) => {
        let channel = null;
        if (channelId) {
            channel = await handler.resolveGuildChannel(guild, channelId);
        }

        if (!channel || channel.type !== ChannelType.GuildVoice) {
            try {
                channel = await guild.channels.create({
                    name: placeholderName,
                    type: ChannelType.GuildVoice,
                    parent: category.id,
                    permissionOverwrites: creationOverwrites
                });
            } catch (error) {
                if (error.code === 50013) {
                    throw handler.createFriendlyError('I lack permission to create the server stats channels, sir.');
                }
                throw error;
            }
        } else if (channel.parentId !== category.id) {
            try {
                await channel.setParent(category.id);
            } catch (error) {
                if (error.code !== 50013 && error.code !== 50001) {
                    console.warn('Failed to reparent server stats channel:', error);
                }
            }
        }

        await applyServerStatsPermissions(channel, me, everyoneId);
        return channel;
    };

    const totalChannel = await ensureVoiceChannel(existingConfig?.totalChannelId, `${handler.serverStatsChannelLabels.total}: 0`);
    const userChannel = await ensureVoiceChannel(existingConfig?.userChannelId, `${handler.serverStatsChannelLabels.users}: 0`);
    const botChannel = await ensureVoiceChannel(existingConfig?.botChannelId, `${handler.serverStatsChannelLabels.bots}: 0`);
    const channelCountChannel = await ensureVoiceChannel(
        existingConfig?.channelCountChannelId,
        `${handler.serverStatsChannelLabels.channels}: 0`
    );
    const roleCountChannel = await ensureVoiceChannel(
        existingConfig?.roleCountChannelId,
        `${handler.serverStatsChannelLabels.roles}: 0`
    );
    return {
        category,
        totalChannel,
        userChannel,
        botChannel,
        channelCountChannel,
        roleCountChannel,
        botMember: me,
        everyoneId
    };
}

async function collectGuildMemberStats(guild) {
    if (!guild) {
        return {
            total: 0,
            botCount: 0,
            userCount: 0,
            channelCount: 0,
            roleCount: 0,
            onlineUserCount: 0,
            offlineUserCount: 0
        };
    }

    let total = typeof guild.memberCount === 'number' ? guild.memberCount : 0;
    let botCount = 0;
    let userCount = 0;
    let channelCount = 0;
    let roleCount = 0;
    let onlineUserCount = 0;
    let offlineUserCount = 0;

    const shouldFetchMembers = guild.available !== false && typeof guild.memberCount === 'number' && guild.memberCount <= 4000;

    if (shouldFetchMembers) {
        try {
            const members = await guild.members.fetch({ time: 15000 }).catch(() => null);
            if (!members) {throw new Error('Fetch timed out');}
            total = members.size;
            botCount = members.filter(member => member.user.bot).size;
            userCount = total - botCount;

            onlineUserCount = members.filter(member => {
                if (member.user?.bot) {
                    return false;
                }

                const status = member.presence?.status;
                return status === 'online' || status === 'idle' || status === 'dnd';
            }).size;
        } catch (error) {
            // Silently fall back to cached - timeout/permission errors are expected
        }
    }

    if (botCount === 0 && userCount === 0) {
        const cachedMembers = guild.members.cache;
        if (cachedMembers.size > 0) {
            total = cachedMembers.size;
            botCount = cachedMembers.filter(member => member.user?.bot).size;
            userCount = total - botCount;
            onlineUserCount = cachedMembers.filter(member => {
                if (member.user?.bot) {
                    return false;
                }

                const status = member.presence?.status;
                return status === 'online' || status === 'idle' || status === 'dnd';
            }).size;
        } else {
            botCount = guild.members.cache.filter(member => member.user?.bot).size;
            userCount = Math.max(0, total - botCount);
        }
    }

    if (userCount < 0) {
        userCount = 0;
    }

    if (onlineUserCount < 0) {
        onlineUserCount = 0;
    }

    if (onlineUserCount > userCount) {
        onlineUserCount = userCount;
    }

    try {
        const channels = await guild.channels.fetch();
        channelCount = channels.filter(channel => channel && channel.type !== ChannelType.GuildCategory).size;
    } catch (error) {
        if (error.code !== 50013 && error.code !== 50001) {
            console.warn(`Failed to fetch full channel list for guild ${guild.id}:`, error);
        }

        const cachedChannels = guild.channels.cache;
        if (cachedChannels.size > 0) {
            channelCount = cachedChannels.filter(channel => channel && channel.type !== ChannelType.GuildCategory).size;
        }
    }

    try {
        const roles = await guild.roles.fetch();
        roleCount = roles.size;
    } catch (error) {
        if (error.code !== 50013 && error.code !== 50001) {
            console.warn(`Failed to fetch full role list for guild ${guild.id}:`, error);
        }

        const cachedRoles = guild.roles.cache;
        if (cachedRoles.size > 0) {
            roleCount = cachedRoles.size;
        }
    }

    offlineUserCount = Math.max(0, userCount - onlineUserCount);

    return { total, botCount, userCount, channelCount, roleCount, onlineUserCount, offlineUserCount };
}

function renderServerStatsChart(stats, guildName = 'Server Snapshot') {
    const width = 640;
    const height = 360;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#0b1221';
    ctx.fillRect(0, 0, width, height);

    const metrics = [
        { key: 'total', label: 'Members', color: '#64b5f6' },
        { key: 'userCount', label: 'Humans', color: '#81c784' },
        { key: 'botCount', label: 'Bots', color: '#ffb74d' },
        { key: 'onlineUserCount', label: 'Online', color: '#4dd0e1' },
        { key: 'offlineUserCount', label: 'Offline', color: '#9575cd' },
        { key: 'channelCount', label: 'Channels', color: '#f06292' },
        { key: 'roleCount', label: 'Roles', color: '#ba68c8' }
    ];

    const values = metrics.map((metric) => Number(stats?.[metric.key]) || 0);
    const maxValue = Math.max(...values, 1);

    const padding = { top: 60, bottom: 70, left: 60, right: 40 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;
    const barSpacing = chartWidth / metrics.length;
    const barWidth = barSpacing * 0.6;

    ctx.strokeStyle = '#233044';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(padding.left, padding.top);
    ctx.lineTo(padding.left, padding.top + chartHeight);
    ctx.lineTo(padding.left + chartWidth, padding.top + chartHeight);
    ctx.stroke();

    ctx.font = '20px "Segoe UI", sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.fillText(`${guildName}`, width / 2, 34);
    ctx.font = '16px "Segoe UI", sans-serif';
    ctx.fillStyle = '#8aa4c1';
    ctx.fillText('Server Health Snapshot', width / 2, 56);

    ctx.font = '12px "Segoe UI", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#8aa4c1';
    for (let i = 0; i <= 4; i += 1) {
        const y = padding.top + (chartHeight * (i / 4));
        const value = Math.round(maxValue * (1 - i / 4));
        ctx.fillText(String(value), padding.left - 48, y + 4);
        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(padding.left + chartWidth, y);
        ctx.stroke();
    }

    metrics.forEach((metric, index) => {
        const value = values[index];
        const x = padding.left + barSpacing * index + (barSpacing - barWidth) / 2;
        const heightRatio = value / maxValue;
        const barHeight = Math.max(4, chartHeight * heightRatio);
        const y = padding.top + chartHeight - barHeight;

        ctx.fillStyle = metric.color;
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, 6);
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.font = '14px "Segoe UI", sans-serif';
        ctx.fillText(value.toLocaleString(), x + barWidth / 2, y - 8);

        ctx.fillStyle = '#8aa4c1';
        ctx.font = '13px "Segoe UI", sans-serif';
        ctx.fillText(metric.label, x + barWidth / 2, padding.top + chartHeight + 20);
    });

    return canvas.toBuffer('image/png');
}

async function updateServerStats(handler, guild, existingConfig = null) {
    if (!guild) {
        throw handler.createFriendlyError('I could not access that server, sir.');
    }

    const stats = await collectGuildMemberStats(guild);
    const ensured = await ensureServerStatsChannels(handler, guild, existingConfig);
    const {
        category,
        totalChannel,
        userChannel,
        botChannel,
        channelCountChannel,
        roleCountChannel,
        botMember,
        everyoneId
    } = ensured;

    const desiredNames = {
        total: formatServerStatsName(handler.serverStatsChannelLabels.total, stats.total),
        users: formatServerStatsName(handler.serverStatsChannelLabels.users, stats.userCount),
        bots: formatServerStatsName(handler.serverStatsChannelLabels.bots, stats.botCount),
        channels: formatServerStatsName(handler.serverStatsChannelLabels.channels, stats.channelCount),
        roles: formatServerStatsName(handler.serverStatsChannelLabels.roles, stats.roleCount)
    };

    try {
        if (totalChannel && totalChannel.name !== desiredNames.total) {
            await totalChannel.setName(desiredNames.total);
        }

        if (userChannel && userChannel.name !== desiredNames.users) {
            await userChannel.setName(desiredNames.users);
        }

        if (botChannel && botChannel.name !== desiredNames.bots) {
            await botChannel.setName(desiredNames.bots);
        }

        if (channelCountChannel && channelCountChannel.name !== desiredNames.channels) {
            await channelCountChannel.setName(desiredNames.channels);
        }

        if (roleCountChannel && roleCountChannel.name !== desiredNames.roles) {
            await roleCountChannel.setName(desiredNames.roles);
        }

    } catch (error) {
        if (error.code === 50013) {
            throw handler.createFriendlyError('I lack permission to rename the server stats channels, sir.');
        }
        throw error;
    }

    await applyServerStatsPermissions(totalChannel, botMember, everyoneId);
    await applyServerStatsPermissions(userChannel, botMember, everyoneId);
    await applyServerStatsPermissions(botChannel, botMember, everyoneId);
    await applyServerStatsPermissions(channelCountChannel, botMember, everyoneId);
    await applyServerStatsPermissions(roleCountChannel, botMember, everyoneId);
    const record = await database.saveServerStatsConfig(guild.id, {
        categoryId: category.id,
        totalChannelId: totalChannel.id,
        userChannelId: userChannel.id,
        botChannelId: botChannel.id,
        channelCountChannelId: channelCountChannel.id,
        roleCountChannelId: roleCountChannel.id
    });

    return { record, stats };
}

async function disableServerStats(handler, guild, existingConfig = null) {
    if (!guild) {
        throw handler.createFriendlyError('I could not access that server, sir.');
    }

    const config = existingConfig || await database.getServerStatsConfig(guild.id);
    if (!config) {
        return false;
    }

    await ensureBotCanManageChannels(handler, guild);

    const channelIds = new Set([
        config.totalChannelId,
        config.userChannelId,
        config.botChannelId,
        config.channelCountChannelId,
        config.roleCountChannelId,
        config.onlineUsersChannelId,
        config.offlineUsersChannelId
    ]);

    for (const channelId of channelIds) {
        if (!channelId) {
            continue;
        }

        const channel = await handler.resolveGuildChannel(guild, channelId);
        if (!channel) {
            continue;
        }

        try {
            await channel.delete('Removing Jarvis server statistics channel');
        } catch (error) {
            if (error.code === 50013) {
                throw handler.createFriendlyError('I do not have permission to remove the server stats channels, sir.');
            }

            if (error.code !== 10003 && error.code !== 50001) {
                console.warn('Failed to delete server stats channel:', error);
            }
        }
    }

    if (config.categoryId) {
        const category = await handler.resolveGuildChannel(guild, config.categoryId);
        if (category?.type === ChannelType.GuildCategory) {
            const remaining = guild.channels.cache.filter(ch => ch.parentId === category.id).size;
            if (remaining === 0) {
                try {
                    await category.delete('Removing Jarvis server statistics category');
                } catch (error) {
                    if (error.code !== 10003 && error.code !== 50001 && error.code !== 50013) {
                        console.warn('Failed to delete server stats category:', error);
                    }
                }
            }
        }
    }

    await database.deleteServerStatsConfig(guild.id);
    return true;
}

module.exports = {
    formatServerStatsValue,
    formatServerStatsName,
    ensureBotCanManageChannels,
    applyServerStatsPermissions,
    ensureServerStatsChannels,
    collectGuildMemberStats,
    renderServerStatsChart,
    updateServerStats,
    disableServerStats
};

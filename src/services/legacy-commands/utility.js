/**
 * Legacy Utility Commands
 * Extracted from legacy-commands.js
 */

const { EmbedBuilder } = require('discord.js');
const { safeSend } = require('../../utils/discord-safe-send');

function parseScheduleTime(timeStr) {
    const match = timeStr.match(
        /in\s+(\d+)\s*(min|minute|minutes|hour|hours|h|m|second|seconds|s)/i
    );
    if (!match) return null;

    const amount = parseInt(match[1]);
    const unit = match[2].toLowerCase();

    let ms = 0;
    if (unit.startsWith('s')) ms = amount * 1000;
    else if (unit.startsWith('m')) ms = amount * 60 * 1000;
    else if (unit.startsWith('h')) ms = amount * 60 * 60 * 1000;

    return ms;
}

const utilityCommands = {
    // Server Info command
    serverinfo: {
        description: 'View server information',
        usage: '*j serverinfo',
        aliases: ['server', 'guild'],
        execute: async (message, args) => {
            const guild = message.guild;
            if (!guild) {
                await message.reply('This command can only be used in a server!');
                return true;
            }
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
                    { name: 'Boosts', value: `${guild.premiumSubscriptionCount || 0}`, inline: true }
                );

            if (guild.description) {
                embed.setDescription(guild.description);
            }

            await message.reply({ embeds: [embed] });
            return true;
        }
    },

    // Ping command
    ping: {
        description: 'Check bot latency',
        usage: '*j ping',
        execute: async (message, args, client) => {
            const latency = Date.now() - message.createdTimestamp;
            const apiLatency = Math.round(client.ws.ping);
            await message.reply(`🏓 Pong! Latency: ${latency}ms | API: ${apiLatency}ms`);
            return true;
        }
    },

    // Reminder command
    remind: {
        description: 'Set a reminder',
        usage: '*j remind in <time> <message>',
        aliases: ['reminder', 'schedule'],
        execute: async (message, args) => {
            const fullArgs = args.join(' ');
            const timeMatch = fullArgs.match(
                /in\s+(\d+)\s*(min|minute|minutes|hour|hours|h|m|second|seconds|s)/i
            );

            if (!timeMatch) {
                await message.reply(
                    'Usage: `*j remind in <time> <message>`\nExample: `*j remind in 5 minutes check the oven`'
                );
                return true;
            }

            const ms = parseScheduleTime(fullArgs);
            if (!ms || ms > 24 * 60 * 60 * 1000) {
                await message.reply('Invalid time, sir. Maximum is 24 hours.');
                return true;
            }

            const reminderText = fullArgs.replace(timeMatch[0], '').trim() || "Time's up!";
            const userId = message.author.id;
            const channelId = message.channel.id;

            setTimeout(async () => {
                try {
                    const channel = await message.client.channels.fetch(channelId);
                    await safeSend(channel, { content: `⏰ <@${userId}> Reminder: ${reminderText}` }, message.client);
                } catch (e) {
                    console.error('Failed to send reminder:', e);
                }
            }, ms);

            const timeAmount = timeMatch[1];
            const timeUnit = timeMatch[2];
            await message.reply(
                `⏰ Got it, sir. I'll remind you in ${timeAmount} ${timeUnit}: "${reminderText}"`
            );
            return true;
        }
    }
};

module.exports = { utilityCommands };

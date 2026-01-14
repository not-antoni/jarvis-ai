/**
 * Moderation Commands for Jarvis AI Legacy System
 * Split from legacy-commands.js for maintainability
 */

const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const moderation = require('../GUILDS_FEATURES/moderation');
const { safeSend } = require('../../utils/discord-safe-send');

const moderationCommands = {
    kick: {
        description: 'Kick a member from the server',
        usage: '*j kick @user [reason]',
        execute: async (message, args) => {
            if (!message.guild) {
                await message.reply('This command only works in servers, sir.');
                return true;
            }

            const authorMember = message.member;
            if (!authorMember) {
                await message.reply('Could not resolve your member permissions, sir.');
                return true;
            }

            if (!authorMember.permissions?.has(PermissionFlagsBits.KickMembers)) {
                await message.reply('🔒 You need **Kick Members** permission to do that, sir.');
                return true;
            }

            const botMember =
                message.guild.members.me ||
                (await message.guild.members.fetchMe().catch(() => null));

            if (!botMember) {
                await message.reply('I could not verify my permissions in this server, sir.');
                return true;
            }

            if (!botMember.permissions?.has(PermissionFlagsBits.KickMembers)) {
                await message.reply('❌ I do not have **Kick Members** permission in this server.');
                return true;
            }

            const mentionedUser = message.mentions.users.first();
            if (!mentionedUser) {
                await message.reply('Usage: `*j kick @user [reason]`');
                return true;
            }

            const targetMember =
                message.mentions.members.first() ||
                (await message.guild.members.fetch(mentionedUser.id).catch(() => null));

            if (!targetMember) {
                await message.reply('I could not find that member in this server, sir.');
                return true;
            }

            if (targetMember.id === message.guild.ownerId) {
                await message.reply('I cannot kick the server owner, sir.');
                return true;
            }

            if (targetMember.id === message.author.id) {
                await message.reply("Kicking yourself is… ambitious, sir. I'll decline.");
                return true;
            }

            if (targetMember.id === botMember.id) {
                await message.reply("I will not be kicking myself today, sir.");
                return true;
            }

            const isOwner = message.guild.ownerId === message.author.id;
            if (!isOwner) {
                const authorHigher =
                    authorMember.roles?.highest &&
                    targetMember.roles?.highest &&
                    authorMember.roles.highest.comparePositionTo(targetMember.roles.highest) > 0;

                if (!authorHigher) {
                    await message.reply(
                        '🔒 You cannot kick that member due to role hierarchy, sir.'
                    );
                    return true;
                }
            }

            if (!targetMember.kickable) {
                await message.reply(
                    '❌ I cannot kick that member (missing permissions or role hierarchy issue).'
                );
                return true;
            }

            const mentionIndex = args.findIndex(token => /^<@!?\d+>$/.test(token));
            const reason =
                mentionIndex >= 0
                    ? args.slice(mentionIndex + 1).join(' ').trim()
                    : args.slice(1).join(' ').trim();

            try {
                await targetMember.kick(
                    reason || `Kicked by ${message.author.tag}`
                );
                await message.reply(
                    `✅ Kicked **${targetMember.user?.tag || targetMember.user?.username || 'member'}**.`
                );
            } catch (error) {
                console.error('[LegacyCommands] Kick failed:', error);
                await message.reply('❌ Kick failed, sir.');
            }

            return true;
        }
    },

    ban: {
        description: 'Ban a member from the server',
        usage: '*j ban @user [time] [reason]',
        aliases: ['banish'],
        execute: async (message, args) => {
            if (!message.guild) {
                await message.reply('This command only works in servers, sir.');
                return true;
            }

            const authorMember = message.member;
            if (!authorMember) {
                await message.reply('Could not resolve your member permissions, sir.');
                return true;
            }

            if (!authorMember.permissions?.has(PermissionFlagsBits.BanMembers)) {
                await message.reply('🔒 You need **Ban Members** permission to do that, sir.');
                return true;
            }

            const botMember =
                message.guild.members.me ||
                (await message.guild.members.fetchMe().catch(() => null));

            if (!botMember) {
                await message.reply('I could not verify my permissions in this server, sir.');
                return true;
            }

            if (!botMember.permissions?.has(PermissionFlagsBits.BanMembers)) {
                await message.reply('❌ I do not have **Ban Members** permission in this server.');
                return true;
            }

            const mentionedUser = message.mentions.users.first();
            if (!mentionedUser) {
                await message.reply('Usage: `*j ban @user [time] [reason]`\nTime examples: `10m`, `2h`, `7d`, `forever`');
                return true;
            }

            const targetMember =
                message.mentions.members.first() ||
                (await message.guild.members.fetch(mentionedUser.id).catch(() => null));

            if (targetMember) {
                if (targetMember.id === message.guild.ownerId) {
                    await message.reply('I cannot ban the server owner, sir.');
                    return true;
                }

                if (targetMember.id === message.author.id) {
                    await message.reply("Banning yourself? That's... creative, sir. I'll decline.");
                    return true;
                }

                if (targetMember.id === botMember.id) {
                    await message.reply("I will not be banning myself today, sir.");
                    return true;
                }

                const isOwner = message.guild.ownerId === message.author.id;
                if (!isOwner) {
                    const authorHigher =
                        authorMember.roles?.highest &&
                        targetMember.roles?.highest &&
                        authorMember.roles.highest.comparePositionTo(targetMember.roles.highest) > 0;

                    if (!authorHigher) {
                        await message.reply(
                            '🔒 You cannot ban that member due to role hierarchy, sir.'
                        );
                        return true;
                    }
                }

                if (!targetMember.bannable) {
                    await message.reply(
                        '❌ I cannot ban that member (missing permissions or role hierarchy issue).'
                    );
                    return true;
                }
            }

            // Parse time and reason from args
            const mentionIndex = args.findIndex(token => /^<@!?\d+>$/.test(token));
            const afterMention = mentionIndex >= 0 ? args.slice(mentionIndex + 1) : args.slice(1);

            let banDuration = null; // null = permanent
            let reason = '';

            if (afterMention.length > 0) {
                const timeArg = afterMention[0].toLowerCase();
                const timeMatch = timeArg.match(/^(\d+)(m|min|mins|minutes?|h|hr|hrs|hours?|d|day|days?)$/i);

                if (timeMatch) {
                    const amount = parseInt(timeMatch[1], 10);
                    const unit = timeMatch[2].toLowerCase();

                    if (unit.startsWith('m')) {
                        banDuration = amount * 60 * 1000; // minutes
                    } else if (unit.startsWith('h')) {
                        banDuration = amount * 60 * 60 * 1000; // hours
                    } else if (unit.startsWith('d')) {
                        banDuration = amount * 24 * 60 * 60 * 1000; // days
                    }

                    reason = afterMention.slice(1).join(' ').trim();
                } else if (timeArg === 'forever' || timeArg === 'permanent' || timeArg === 'perm') {
                    banDuration = null; // permanent
                    reason = afterMention.slice(1).join(' ').trim();
                } else {
                    // No time specified, all args are reason
                    reason = afterMention.join(' ').trim();
                }
            }

            const BANE_GIF = 'https://tenor.com/view/bane-no-banned-and-you-are-explode-gif-16047504';

            try {
                await message.guild.members.ban(mentionedUser.id, {
                    reason: reason || `Banned by ${message.author.tag}`,
                    deleteMessageSeconds: 0
                });

                // Format duration text
                let durationText = '**permanently**';
                if (banDuration) {
                    const mins = Math.floor(banDuration / 60000);
                    const hours = Math.floor(mins / 60);
                    const days = Math.floor(hours / 24);

                    if (days > 0) {
                        durationText = `for **${days} day${days > 1 ? 's' : ''}**`;
                    } else if (hours > 0) {
                        durationText = `for **${hours} hour${hours > 1 ? 's' : ''}**`;
                    } else {
                        durationText = `for **${mins} minute${mins > 1 ? 's' : ''}**`;
                    }

                    // Schedule unban if temporary
                    setTimeout(async () => {
                        try {
                            await message.guild.members.unban(mentionedUser.id, 'Temporary ban expired');
                            const channel = message.channel;
                            if (channel) {
                                await safeSend(channel, { content: `✅ **${mentionedUser.tag || mentionedUser.username}** has been automatically unbanned (temp ban expired).` }, message.client);
                            }
                        } catch (e) {
                            console.error('[LegacyCommands] Auto-unban failed:', e);
                        }
                    }, banDuration);
                }

                // Simple text message + gif
                let banMessage = `🔨 **${mentionedUser.tag || mentionedUser.username}** has been banned ${durationText}.`;
                if (reason) {
                    banMessage += `\nReason: ${reason}`;
                }

                await message.reply(banMessage);
                await message.channel.send(BANE_GIF);
            } catch (error) {
                console.error('[LegacyCommands] Ban failed:', error);
                await message.reply('❌ Ban failed, sir.');
            }

            return true;
        }
    },

    unban: {
        description: 'Unban a user from the server',
        usage: '*j unban <user_id> [reason]',
        execute: async (message, args) => {
            if (!message.guild) {
                await message.reply('This command only works in servers, sir.');
                return true;
            }

            const authorMember = message.member;
            if (!authorMember?.permissions?.has(PermissionFlagsBits.BanMembers)) {
                await message.reply('🔒 You need **Ban Members** permission to do that, sir.');
                return true;
            }

            const botMember = message.guild.members.me ||
                (await message.guild.members.fetchMe().catch(() => null));
            if (!botMember?.permissions?.has(PermissionFlagsBits.BanMembers)) {
                await message.reply('❌ I do not have **Ban Members** permission in this server.');
                return true;
            }

            // Get user ID from args or mention
            let userId = args[0];
            const mentionMatch = userId?.match(/^<@!?(\d+)>$/);
            if (mentionMatch) {
                userId = mentionMatch[1];
            }

            if (!userId || !/^\d+$/.test(userId)) {
                await message.reply('Usage: `*j unban <user_id> [reason]`\nYou can find the user ID in the server ban list.');
                return true;
            }

            const reason = args.slice(1).join(' ').trim() || `Unbanned by ${message.author.tag}`;

            try {
                await message.guild.members.unban(userId, reason);
                await message.reply(`✅ Unbanned user ID \`${userId}\`.`);
            } catch (error) {
                console.error('[LegacyCommands] Unban failed:', error);
                await message.reply('❌ Unban failed. User may not be banned or ID is invalid.');
            }

            return true;
        }
    },

    mute: {
        description: 'Timeout a member',
        usage: '*j mute @user <time> [reason]',
        aliases: ['timeout'],
        execute: async (message, args) => {
            if (!message.guild) {
                await message.reply('This command only works in servers, sir.');
                return true;
            }

            const authorMember = message.member;
            if (!authorMember?.permissions?.has(PermissionFlagsBits.ModerateMembers)) {
                await message.reply('🔒 You need **Timeout Members** permission to do that, sir.');
                return true;
            }

            const botMember = message.guild.members.me ||
                (await message.guild.members.fetchMe().catch(() => null));
            if (!botMember?.permissions?.has(PermissionFlagsBits.ModerateMembers)) {
                await message.reply('❌ I do not have **Timeout Members** permission in this server.');
                return true;
            }

            const mentionedUser = message.mentions.users.first();
            if (!mentionedUser) {
                await message.reply('Usage: `*j mute @user <time> [reason]`\nTime examples: `10m`, `1h`, `1d`');
                return true;
            }

            const targetMember = message.mentions.members.first() ||
                (await message.guild.members.fetch(mentionedUser.id).catch(() => null));

            if (!targetMember) {
                await message.reply('Could not find that member in this server, sir.');
                return true;
            }

            if (!targetMember.moderatable) {
                await message.reply('❌ I cannot timeout that member (role hierarchy issue).');
                return true;
            }

            // Prevent self-muting
            if (targetMember.id === message.author.id) {
                await message.reply("You **cannot** mute yourself, sir.");
                return true;
            }

            // Prevent banning server owner
            if (targetMember.id === message.guild.ownerId) {
                await message.reply('I cannot mute the server owner, sir.');
                return true;
            }

            // Prevent mods from muting other mods (unless they're the server owner)
            const isOwner = message.guild.ownerId === message.author.id;
            if (!isOwner && (targetMember.permissions.has(PermissionFlagsBits.ModerateMembers) || targetMember.permissions.has(PermissionFlagsBits.BanMembers))) {
                await message.reply('🔒 You cannot mute other moderators, sir.');
                return true;
            }

            // Check role hierarchy (unless executor is owner)
            if (!isOwner) {
                const authorHigher = authorMember.roles?.highest && targetMember.roles?.highest &&
                    authorMember.roles.highest.comparePositionTo(targetMember.roles.highest) > 0;
                if (!authorHigher) {
                    await message.reply('🔒 You cannot mute that member due to role hierarchy, sir.');
                    return true;
                }
            }

            // Parse time
            const mentionIndex = args.findIndex(token => /^<@!?\d+>$/.test(token));
            const afterMention = mentionIndex >= 0 ? args.slice(mentionIndex + 1) : args.slice(1);

            if (afterMention.length === 0) {
                await message.reply('Please specify a time. Example: `*j mute @user 10m being annoying`');
                return true;
            }

            const timeArg = afterMention[0].toLowerCase();
            const timeMatch = timeArg.match(/^(\d+)(m|min|mins|minutes?|h|hr|hrs|hours?|d|day|days?)$/i);

            if (!timeMatch) {
                await message.reply('Invalid time format. Use: `10m`, `1h`, `1d`');
                return true;
            }

            const amount = parseInt(timeMatch[1], 10);
            const unit = timeMatch[2].toLowerCase();
            let durationMs;

            if (unit.startsWith('m')) {
                durationMs = amount * 60 * 1000;
            } else if (unit.startsWith('h')) {
                durationMs = amount * 60 * 60 * 1000;
            } else if (unit.startsWith('d')) {
                durationMs = amount * 24 * 60 * 60 * 1000;
            }

            // Max timeout is 28 days
            if (durationMs > 28 * 24 * 60 * 60 * 1000) {
                await message.reply('Maximum timeout is 28 days, sir.');
                return true;
            }

            const reason = afterMention.slice(1).join(' ').trim() || `Timed out by ${message.author.tag}`;

            try {
                await targetMember.timeout(durationMs, reason);
                await message.reply(`🔇 **${targetMember.user.tag}** has been muted for **${afterMention[0]}**.${reason !== `Timed out by ${message.author.tag}` ? `\nReason: ${reason}` : ''}`);
            } catch (error) {
                console.error('[LegacyCommands] Mute failed:', error);
                await message.reply('❌ Mute failed, sir.');
            }

            return true;
        }
    },

    unmute: {
        description: 'Remove timeout from a member',
        usage: '*j unmute @user',
        aliases: ['untimeout'],
        execute: async (message, args) => {
            if (!message.guild) {
                await message.reply('This command only works in servers, sir.');
                return true;
            }

            const authorMember = message.member;
            if (!authorMember?.permissions?.has(PermissionFlagsBits.ModerateMembers)) {
                await message.reply('🔒 You need **Timeout Members** permission to do that, sir.');
                return true;
            }

            const mentionedUser = message.mentions.users.first();
            if (!mentionedUser) {
                await message.reply('Usage: `*j unmute @user`');
                return true;
            }

            const targetMember = message.mentions.members.first() ||
                (await message.guild.members.fetch(mentionedUser.id).catch(() => null));

            if (!targetMember) {
                await message.reply('Could not find that member in this server, sir.');
                return true;
            }

            try {
                await targetMember.timeout(null, `Unmuted by ${message.author.tag}`);
                await message.reply(`🔊 **${targetMember.user.tag}** has been unmuted.`);
            } catch (error) {
                console.error('[LegacyCommands] Unmute failed:', error);
                await message.reply('❌ Unmute failed, sir.');
            }

            return true;
        }
    },

    warn: {
        description: 'Warn a member (stored in memory)',
        usage: '*j warn @user <reason>',
        execute: async (message, args) => {
            if (!message.guild) {
                await message.reply('This command only works in servers, sir.');
                return true;
            }

            const authorMember = message.member;
            if (!authorMember?.permissions?.has(PermissionFlagsBits.ModerateMembers)) {
                await message.reply('🔒 You need **Timeout Members** permission to do that, sir.');
                return true;
            }

            const mentionedUser = message.mentions.users.first();
            if (!mentionedUser) {
                await message.reply('Usage: `*j warn @user <reason>`');
                return true;
            }

            const mentionIndex = args.findIndex(token => /^<@!?\d+>$/.test(token));
            const reason = mentionIndex >= 0
                ? args.slice(mentionIndex + 1).join(' ').trim()
                : args.slice(1).join(' ').trim();

            if (!reason) {
                await message.reply('Please provide a reason for the warning.');
                return true;
            }

            // Store warning (in-memory for now, but you can add DB persistence later)
            const guildId = message.guild.id;
            const userId = mentionedUser.id;

            if (!global.jarvisWarnings) {
                global.jarvisWarnings = new Map();
            }
            if (!global.jarvisWarnings.has(guildId)) {
                global.jarvisWarnings.set(guildId, new Map());
            }

            const guildWarnings = global.jarvisWarnings.get(guildId);
            const userWarnings = guildWarnings.get(userId) || [];
            userWarnings.push({
                reason,
                warnedBy: message.author.id,
                timestamp: Date.now()
            });
            guildWarnings.set(userId, userWarnings);

            const embed = new EmbedBuilder()
                .setTitle('⚠️ Warning Issued')
                .setColor(0xf39c12)
                .setDescription(`**${mentionedUser.tag}** has been warned.`)
                .addFields(
                    { name: 'Reason', value: reason, inline: false },
                    { name: 'Total Warnings', value: `${userWarnings.length}`, inline: true }
                )
                .setFooter({ text: `Warned by ${message.author.tag}` })
                .setTimestamp();

            await message.reply({ embeds: [embed] });

            // DM the user
            try {
                await mentionedUser.send(`⚠️ You have been warned in **${message.guild.name}**\nReason: ${reason}\nTotal warnings: ${userWarnings.length}`);
            } catch {
                // Can't DM user
            }

            return true;
        }
    },

    warnings: {
        description: 'View warnings for a member',
        usage: '*j warnings @user',
        aliases: ['warns'],
        execute: async (message, args) => {
            if (!message.guild) {
                await message.reply('This command only works in servers, sir.');
                return true;
            }

            const mentionedUser = message.mentions.users.first() || message.author;
            const guildId = message.guild.id;
            const userId = mentionedUser.id;

            const guildWarnings = global.jarvisWarnings?.get(guildId);
            const userWarnings = guildWarnings?.get(userId) || [];

            if (userWarnings.length === 0) {
                await message.reply(`**${mentionedUser.tag}** has no warnings. Clean record! ✨`);
                return true;
            }

            const warningList = userWarnings.slice(-10).map((w, i) =>
                `**${i + 1}.** ${w.reason} - <t:${Math.floor(w.timestamp / 1000)}:R>`
            ).join('\n');

            const embed = new EmbedBuilder()
                .setTitle(`⚠️ Warnings for ${mentionedUser.tag}`)
                .setColor(0xf39c12)
                .setDescription(warningList)
                .setFooter({ text: `Total: ${userWarnings.length} warning(s)` });

            await message.reply({ embeds: [embed] });
            return true;
        }
    },

    clearwarnings: {
        description: 'Clear warnings for a member',
        usage: '*j clearwarnings @user',
        aliases: ['clearwarns'],
        execute: async (message, args) => {
            if (!message.guild) {
                await message.reply('This command only works in servers, sir.');
                return true;
            }

            const authorMember = message.member;
            if (!authorMember?.permissions?.has(PermissionFlagsBits.ModerateMembers)) {
                await message.reply('🔒 You need **Timeout Members** permission to do that, sir.');
                return true;
            }

            const mentionedUser = message.mentions.users.first();
            if (!mentionedUser) {
                await message.reply('Usage: `*j clearwarnings @user`');
                return true;
            }

            const guildId = message.guild.id;
            const userId = mentionedUser.id;

            const guildWarnings = global.jarvisWarnings?.get(guildId);
            if (guildWarnings) {
                guildWarnings.delete(userId);
            }

            await message.reply(`✅ Cleared all warnings for **${mentionedUser.tag}**.`);
            return true;
        }
    },

    purge: {
        description: 'Delete multiple messages at once',
        usage: '*j purge <amount> [@user]',
        aliases: ['clear', 'prune', 'clean'],
        execute: async (message, args) => {
            if (!message.guild) {
                await message.reply('This command only works in servers, sir.');
                return true;
            }

            const authorMember = message.member;
            if (!authorMember?.permissions?.has(PermissionFlagsBits.ManageMessages)) {
                await message.reply('🔒 You need **Manage Messages** permission to do that, sir.');
                return true;
            }

            const amount = parseInt(args[0], 10);
            if (isNaN(amount) || amount < 1 || amount > 100) {
                await message.reply('Please specify a number between 1 and 100. Usage: `*j purge 50`');
                return true;
            }

            const targetUser = message.mentions.users.first();

            try {
                // Delete the command message first
                await message.delete().catch(() => { });

                let deleted;
                if (targetUser) {
                    // Fetch messages and filter by user
                    const messages = await message.channel.messages.fetch({ limit: 100 });
                    const userMessages = messages.filter(m => m.author.id === targetUser.id).first(amount);
                    deleted = await message.channel.bulkDelete(userMessages, true);
                } else {
                    deleted = await message.channel.bulkDelete(amount, true);
                }

                const response = await message.channel.send(
                    `🧹 Deleted **${deleted.size}** message(s)${targetUser ? ` from ${targetUser.tag}` : ''}.`
                );

                // Auto-delete response after 3 seconds
                setTimeout(() => response.delete().catch(() => { }), 3000);
            } catch (error) {
                await message.channel.send(`❌ Failed to delete messages: ${error.message}`);
            }
            return true;
        }
    },

    strike: {
        description: 'Issue a strike (escalating punishment)',
        usage: '*j strike @user <reason>',
        aliases: ['str'],
        execute: async (message, args) => {
            if (!message.guild) {
                await message.reply('This command only works in servers, sir.');
                return true;
            }

            const authorMember = message.member;
            if (!authorMember?.permissions?.has(PermissionFlagsBits.ModerateMembers)) {
                await message.reply('🔒 You need **Timeout Members** permission to do that, sir.');
                return true;
            }

            const mentionedUser = message.mentions.users.first();
            if (!mentionedUser) {
                await message.reply('Usage: `*j strike @user <reason>`');
                return true;
            }

            const reason = args.slice(1).join(' ') || 'No reason provided';
            const guildId = message.guild.id;
            const userId = mentionedUser.id;

            // Initialize strike storage
            if (!global.jarvisStrikes) global.jarvisStrikes = new Map();
            if (!global.jarvisStrikes.has(guildId)) global.jarvisStrikes.set(guildId, new Map());

            const guildStrikes = global.jarvisStrikes.get(guildId);
            const userStrikes = guildStrikes.get(userId) || [];
            userStrikes.push({ reason, issuedBy: message.author.id, timestamp: Date.now() });
            guildStrikes.set(userId, userStrikes);

            const strikeCount = userStrikes.length;

            // Escalation actions
            let actionTaken = '';
            const targetMember = await message.guild.members.fetch(userId).catch(() => null);

            // Strike escalation policy (like Sapphire)
            if (strikeCount >= 5 && targetMember?.bannable) {
                // 5+ strikes = ban
                await targetMember.ban({ reason: `Strike ${strikeCount}: ${reason}` });
                actionTaken = '🔨 **BANNED** (5 strikes reached)';
            } else if (strikeCount >= 3 && targetMember?.moderatable) {
                // 3-4 strikes = 24 hour mute
                await targetMember.timeout(24 * 60 * 60 * 1000, `Strike ${strikeCount}: ${reason}`);
                actionTaken = '🔇 **24h MUTE** (3+ strikes)';
            } else if (strikeCount >= 2 && targetMember?.moderatable) {
                // 2 strikes = 1 hour mute
                await targetMember.timeout(60 * 60 * 1000, `Strike ${strikeCount}: ${reason}`);
                actionTaken = '🔇 **1h MUTE** (2 strikes)';
            }

            // Build embed
            const embed = new EmbedBuilder()
                .setTitle('⚡ Strike Issued')
                .setColor(strikeCount >= 5 ? 0xe74c3c : strikeCount >= 3 ? 0xe67e22 : 0xf1c40f)
                .setDescription(`**${mentionedUser.tag}** has received a strike.`)
                .addFields(
                    { name: 'Reason', value: reason, inline: false },
                    { name: 'Strike Count', value: `${strikeCount}/5`, inline: true },
                    { name: 'Action', value: actionTaken || '⚠️ Warning only', inline: true }
                )
                .setFooter({ text: `Issued by ${message.author.tag}` })
                .setTimestamp();

            // DM user about strike
            try {
                await mentionedUser.send({
                    embeds: [new EmbedBuilder()
                        .setTitle(`⚡ Strike Received in ${message.guild.name}`)
                        .setColor(0xe74c3c)
                        .setDescription(`You have received strike #${strikeCount}`)
                        .addFields(
                            { name: 'Reason', value: reason, inline: false },
                            { name: 'Action', value: actionTaken || 'Warning - behavior noted', inline: false }
                        )
                        .setFooter({ text: `${5 - strikeCount} strike(s) until permanent ban` })
                    ]
                });
            } catch { }

            await message.reply({ embeds: [embed] });
            return true;
        }
    },

    strikes: {
        description: 'View strikes for a member',
        usage: '*j strikes [@user]',
        execute: async (message, args) => {
            if (!message.guild) {
                await message.reply('This command only works in servers, sir.');
                return true;
            }

            const mentionedUser = message.mentions.users.first() || message.author;
            const guildId = message.guild.id;
            const userId = mentionedUser.id;

            const guildStrikes = global.jarvisStrikes?.get(guildId);
            const userStrikes = guildStrikes?.get(userId) || [];

            if (userStrikes.length === 0) {
                await message.reply(`**${mentionedUser.tag}** has no strikes. Clean record! ✨`);
                return true;
            }

            const strikeList = userStrikes.slice(-10).map((s, i) =>
                `**Strike ${i + 1}.** ${s.reason} - <t:${Math.floor(s.timestamp / 1000)}:R>`
            ).join('\n');

            const embed = new EmbedBuilder()
                .setTitle(`⚡ Strikes for ${mentionedUser.tag}`)
                .setColor(userStrikes.length >= 3 ? 0xe74c3c : 0xf1c40f)
                .setDescription(strikeList)
                .setFooter({ text: `Total: ${userStrikes.length}/5 strikes` });

            await message.reply({ embeds: [embed] });
            return true;
        }
    },

    clearstrikes: {
        description: 'Clear strikes for a member',
        usage: '*j clearstrikes @user',
        execute: async (message, args) => {
            if (!message.guild) {
                await message.reply('This command only works in servers, sir.');
                return true;
            }

            const authorMember = message.member;
            if (!authorMember?.permissions?.has(PermissionFlagsBits.ModerateMembers)) {
                await message.reply('🔒 You need **Timeout Members** permission to do that, sir.');
                return true;
            }

            const mentionedUser = message.mentions.users.first();
            if (!mentionedUser) {
                await message.reply('Usage: `*j clearstrikes @user`');
                return true;
            }

            const guildId = message.guild.id;
            const userId = mentionedUser.id;

            const guildStrikes = global.jarvisStrikes?.get(guildId);
            if (guildStrikes) {
                guildStrikes.delete(userId);
            }

            await message.reply(`✅ Cleared all strikes for **${mentionedUser.tag}**.`);
            return true;
        }
    },

    enable: {
        description: 'Enable a feature (moderation)',
        usage: '*j enable moderation',
        execute: async (message, args) => {
            if (!message.guild) {
                await message.reply('This command only works in servers, sir.');
                return true;
            }

            const isOwner = message.guild.ownerId === message.author.id;
            const isAdmin = message.member?.permissions?.has(PermissionFlagsBits.Administrator);

            if (!isOwner && !isAdmin) {
                await message.reply(
                    '🔒 This command requires Administrator permissions or Server Owner status.'
                );
                return true;
            }

            const feature = (args[0] || '').toLowerCase();

            if (feature !== 'moderation') {
                await message.reply(
                    '**Usage:** `*j enable moderation`\n\nAvailable features: `moderation`'
                );
                return true;
            }

            if (!moderation.canEnableModeration(message.guild.id)) {
                await message.reply(
                    '❌ This server is not authorized to enable moderation features.\n\nContact the bot developer for access.'
                );
                return true;
            }

            const result = moderation.enableModeration(message.guild.id, message.author.id);

            if (result.success) {
                const embed = new EmbedBuilder()
                    .setTitle('✅ Moderation Enabled')
                    .setColor(0x2ecc71)
                    .setDescription('Moderation features are now **enabled** for this server.')
                    .addFields(
                        {
                            name: '🛡️ Features Activated',
                            value: '• New account detection\n• Alt account warnings\n• Spam pattern detection\n• Bot-like username flags\n• Suspicious avatar alerts',
                            inline: false
                        },
                        {
                            name: '📢 Alerts',
                            value: 'Suspicious members will be reported to the server owner via DM.',
                            inline: false
                        },
                        {
                            name: '⚙️ Configure',
                            value: 'Use `*j moderation settings` to customize (coming soon)',
                            inline: false
                        }
                    )
                    .setFooter({ text: `Enabled by ${message.author.tag}` })
                    .setTimestamp();

                await message.reply({ embeds: [embed] });
            } else {
                await message.reply(`❌ Failed to enable moderation: ${result.error}`);
            }

            return true;
        }
    },

    disable: {
        description: 'Disable a feature (moderation)',
        usage: '*j disable moderation',
        execute: async (message, args) => {
            if (!message.guild) {
                await message.reply('This command only works in servers, sir.');
                return true;
            }

            const isOwner = message.guild.ownerId === message.author.id;
            const isAdmin = message.member?.permissions?.has(PermissionFlagsBits.Administrator);

            if (!isOwner && !isAdmin) {
                await message.reply(
                    '🔒 This command requires Administrator permissions or Server Owner status.'
                );
                return true;
            }

            const feature = (args[0] || '').toLowerCase();

            if (feature !== 'moderation') {
                await message.reply(
                    '**Usage:** `*j disable moderation`\n\nAvailable features: `moderation`'
                );
                return true;
            }

            const result = moderation.disableModeration(message.guild.id, message.author.id);

            if (result.success) {
                const embed = new EmbedBuilder()
                    .setTitle('❌ Moderation Disabled')
                    .setColor(0xe74c3c)
                    .setDescription('Moderation features are now **disabled** for this server.')
                    .addFields({
                        name: '🔇 Alerts Stopped',
                        value: 'New member alerts will no longer be sent.',
                        inline: false
                    })
                    .setFooter({ text: `Disabled by ${message.author.tag}` })
                    .setTimestamp();

                await message.reply({ embeds: [embed] });
            } else {
                await message.reply(`❌ ${result.error}`);
            }

            return true;
        }
    }
};

module.exports = { moderationCommands };

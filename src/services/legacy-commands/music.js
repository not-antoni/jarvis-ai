/**
 * Legacy Music Commands
 * Extracted from legacy-commands.js
 */

const { EmbedBuilder } = require('discord.js');
const distube = require('../distube');
const database = require('../database');
const { canControlMusic, isDjAdmin } = require('../../utils/dj-system');

const BOT_OWNER_ID = process.env.BOT_OWNER_ID;

const musicCommands = {
    // ============ MUSIC COMMANDS ============

    dj: {
        description: 'Manage DJ system settings (Admin Only)',
        usage: '*j dj [toggle|user|role|block|list]',
        execute: async (message, args) => {
            const guildId = message.guild?.id;
            if (!guildId) return true;

            const guildConfig = await database.getGuildConfig(guildId);
            const subcommand = (args[0] || 'list').toLowerCase();

            // LIST - Public
            if (subcommand === 'list') {
                const djMode = guildConfig.features?.dj_mode ? '✅ Enabled' : '❌ Disabled';
                const djRoles = (guildConfig.djRoleIds || []).map(id => `<@&${id}>`).join(', ') || 'None';
                const djUsers = (guildConfig.djUserIds || []).map(id => `<@${id}>`).join(', ') || 'None';
                const blockedUsers = (guildConfig.blockedUserIds || []).map(id => `<@${id}>`).join(', ') || 'None';

                const embed = new EmbedBuilder()
                    .setTitle('🎧 DJ System Configuration')
                    .setColor(0x3498db)
                    .addFields(
                        { name: 'Status', value: `DJ Mode: ${djMode}`, inline: false },
                        { name: 'DJ Roles', value: djRoles, inline: false },
                        { name: 'DJ Users', value: djUsers, inline: false },
                        { name: 'Blocked Users', value: blockedUsers, inline: false }
                    )
                    .setFooter({ text: 'Admins & True Mods always have access' });

                await message.reply({ embeds: [embed] });
                return true;
            }

            // PERMISSION CHECK for other commands
            if (!isDjAdmin(message.member, guildConfig)) {
                await message.reply('❌ You do not have permission to configure the DJ system.');
                return true;
            }

            if (subcommand === 'toggle') {
                const enabled = args[1]?.toLowerCase() === 'on' || (!guildConfig.features?.dj_mode);
                // Simple toggle if no arg, or respect arg
                const newState = args[1] ? (args[1] === 'on' || args[1] === 'true') : !guildConfig.features?.dj_mode;

                await database.updateGuildFeatures(guildId, { dj_mode: newState });
                await message.reply(newState
                    ? '🔒 **DJ Mode Enabled**: Only Admins and DJs can control music.'
                    : '🔓 **DJ Mode Disabled**: Everyone can control music (unless blocked).');
                return true;
            }

            if (subcommand === 'user' || subcommand === 'users') {
                const action = args[1];
                const target = message.mentions.users.first();
                if (!action || !target) {
                    await message.reply('Usage: `*j dj user [add|remove] @user`');
                    return true;
                }

                const currentUsers = guildConfig.djUserIds || [];
                if (action === 'add') {
                    if (currentUsers.includes(target.id)) {
                        await message.reply('User is already a DJ.');
                    } else {
                        await database.setGuildDjUsers(guildId, [...currentUsers, target.id]);
                        await message.reply(`✅ Added ${target.tag} to DJ users.`);
                    }
                } else if (action === 'remove') {
                    await database.setGuildDjUsers(guildId, currentUsers.filter(id => id !== target.id));
                    await message.reply(`✅ Removed ${target.tag} from DJ users.`);
                }
                return true;
            }

            if (subcommand === 'role' || subcommand === 'roles') {
                const action = args[1];
                const target = message.mentions.roles.first();
                if (!action || !target) {
                    await message.reply('Usage: `*j dj role [add|remove] @role`');
                    return true;
                }

                const currentRoles = guildConfig.djRoleIds || [];
                if (action === 'add') {
                    if (currentRoles.includes(target.id)) {
                        await message.reply('Role is already a DJ role.');
                    } else {
                        await database.setGuildDjRoles(guildId, [...currentRoles, target.id]);
                        await message.reply(`✅ Added ${target.name} to DJ roles.`);
                    }
                } else if (action === 'remove') {
                    await database.setGuildDjRoles(guildId, currentRoles.filter(id => id !== target.id));
                    await message.reply(`✅ Removed ${target.name} from DJ roles.`);
                }
                return true;
            }

            if (subcommand === 'block') {
                const target = message.mentions.users.first();
                if (!target) {
                    await message.reply('Usage: `*j dj block @user`');
                    return true;
                }

                const targetMember = message.guild.members.cache.get(target.id);
                if (targetMember && isDjAdmin(targetMember, guildConfig)) {
                    await message.reply('❌ Cannot block an admin/mod.');
                    return true;
                }

                await database.addGuildBlockedUser(guildId, target.id);
                await message.reply(`🚫 Blocked ${target.tag} from music commands.`);
                return true;
            }

            if (subcommand === 'unblock') {
                const target = message.mentions.users.first();
                if (!target) {
                    await message.reply('Usage: `*j dj unblock @user`');
                    return true;
                }

                await database.removeGuildBlockedUser(guildId, target.id);
                await message.reply(`✅ Unblocked ${target.tag}.`);
                return true;
            }

            await message.reply('Usage: `*j dj [toggle|user|role|block|list]`');
            return true;
        }
    },

    play: {
        description: 'Play a song',
        usage: '*j play <query>',
        execute: async (message, args) => {
            if (!message.guild) return true;
            if (!await canControlMusic(message)) return true;

            const query = args.join(' ');
            if (!query) {
                await message.reply('Please provide a song name or link.');
                return true;
            }

            const voiceChannel = message.member.voice.channel;
            if (!voiceChannel) {
                await message.reply('Join a voice channel first!');
                return true;
            }

            try {
                await message.reply(`🔍 Searching: **${query}**...`);
                await distube.get().play(voiceChannel, query, {
                    member: message.member,
                    textChannel: message.channel,
                    message
                });
            } catch (e) {
                await message.reply(`❌ Playback failed: ${e.message}`);
            }
            return true;
        }
    },

    skip: {
        description: 'Skip current song',
        usage: '*j skip',
        execute: async (message, args) => {
            if (!message.guild) return true;
            if (!await canControlMusic(message)) return true;

            try {
                const queue = distube.get().getQueue(message.guild);
                if (!queue) {
                    await message.reply('Nothing playing.');
                    return true;
                }
                await distube.get().skip(message.guild);
                await message.reply('⏭️ Skipped.');
            } catch (e) {
                await message.reply('❌ Failed to skip.');
            }
            return true;
        }
    },

    stop: {
        description: 'Stop playing',
        usage: '*j stop',
        execute: async (message, args) => {
            if (!message.guild) return true;
            if (!await canControlMusic(message)) return true;

            try {
                const queue = distube.get().getQueue(message.guild);
                if (queue) {
                    queue.stop();
                    await message.reply('⏹️ Stopped.');
                } else {
                    await message.reply('Nothing playing.');
                }
            } catch (e) {
                await message.reply('❌ Failed to stop.');
            }
            return true;
        }
    },

    pause: {
        description: 'Pause playback',
        usage: '*j pause',
        execute: async (message, args) => {
            if (!message.guild) return true;
            if (!await canControlMusic(message)) return true;
            const queue = distube.get().getQueue(message.guild);
            if (!queue) { await message.reply('Nothing playing'); return true; }
            queue.pause();
            await message.reply('⏸️ Paused.');
            return true;
        }
    },

    resume: {
        description: 'Resume playback',
        usage: '*j resume',
        execute: async (message, args) => {
            if (!message.guild) return true;
            if (!await canControlMusic(message)) return true;
            const queue = distube.get().getQueue(message.guild);
            if (!queue) { await message.reply('Nothing playing'); return true; }
            queue.resume();
            await message.reply('▶️ Resumed.');
            return true;
        }
    },

    // Cookie update command (bot owner only)
    cookies: {
        description: 'Update YouTube cookies for music playback (bot owner only)',
        usage: '*j cookies "<netscape cookie string>"',
        ownerOnly: true,
        async execute(message, args) {
            // Only bot owner can run this
            if (message.author.id !== BOT_OWNER_ID) {
                await message.reply('❌ This command is restricted to the bot owner only, sir.');
                return true;
            }

            // Get the full content after the command
            const content = message.content;
            let cookieString = '';

            // Check for file attachment first
            const attachment = message.attachments.first();
            if (attachment) {
                if (attachment.contentType && !attachment.contentType.includes('text/')) {
                    await message.reply('❌ Please upload a text file (.txt)');
                    return true;
                }
                try {
                    const response = await fetch(attachment.url);
                    if (!response.ok) throw new Error('Failed to fetch attachment');
                    cookieString = await response.text();
                } catch (e) {
                    await message.reply(`❌ Failed to read attachment: ${e.message}`);
                    return true;
                }
            } else {
                // Try parsing from message content
                const cookieMatch = content.match(/cookies\s+"([^"]+)"/i) || content.match(/cookies\s+(.+)/i);
                if (cookieMatch) cookieString = cookieMatch[1];
            }

            if (!cookieString) {
                await message.reply(
                    '**🍪 YouTube Cookie Update**\n\n' +
                    '**Option 1 (Recommended):** Upload your `cookies.txt` file with this command.\n' +
                    '**Option 2:** Usage: `*j cookies "<cookies>"` (if short enough)\n\n' +
                    'To get cookies:\n' +
                    '1. Install "Get cookies.txt LOCALLY" extension\n' +
                    '2. Export as Netscape format\n' +
                    '3. Upload the text file here'
                );
                return true;
            }

            cookieString = cookieString.trim();

            // Validate it looks like Netscape format
            const isNetscape = cookieString.includes('.youtube.com') ||
                cookieString.includes('# Netscape') ||
                cookieString.includes('# HTTP Cookie');

            if (!isNetscape) {
                await message.reply('❌ Invalid cookie format. Please use Netscape format (from browser extension).');
                return true;
            }

            try {
                // Update in memory by setting environment variable
                process.env.YT_COOKIES = cookieString;

                // Delete the user's message for security (contains sensitive cookies)
                try {
                    await message.delete();
                } catch {
                    // Can't delete - warn user
                    await message.channel.send('⚠️ Could not delete your message. Please delete it manually to protect your cookies!');
                }

                await message.channel.send(
                    '✅ YouTube cookies updated in memory!\n\n' +
                    '**Note:** These will be used for the next music playback.\n' +
                    'For permanent storage, add to your `.env` file:\n' +
                    '```\nYT_COOKIES="<your cookies>"\n```'
                );

                console.log('[Cookies] YouTube cookies updated by bot owner');
                return true;
            } catch (error) {
                console.error('[Cookies] Failed to update:', error);
                await message.reply('❌ Failed to update cookies.');
                return true;
            }
        }
    }
};

module.exports = { musicCommands };

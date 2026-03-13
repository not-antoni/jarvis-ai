'use strict';

const { EmbedBuilder } = require('discord.js');
const config = require('../../../config');
const youtubeSearch = require('../youtube-search');
const ytSearchUi = require('./yt-search-ui');
const { formatUptime, getProcessUptimeSeconds } = require('../../utils/uptime');

async function handlePing(interaction) {
    const sent = await interaction.editReply({ content: 'Pinging system...', fetchReply: true });
    const roundtripLatency = sent.createdTimestamp - interaction.createdTimestamp;
    const apiLatency = Math.round(interaction.client.ws.ping);

    const os = require('os');
    const fs = require('fs');
    const path = require('path');

    let botVersion = 'Unknown';
    try {
        const pkg = require(path.join(process.cwd(), 'package.json'));
        botVersion = pkg.version;
    } catch (e) {}

    // Get detailed OS info
    let hostOs = `${os.type()} ${os.release()}`;
    try {
        if (fs.existsSync('/etc/os-release')) {
            const fileContent = fs.readFileSync('/etc/os-release', 'utf8');
            const match = fileContent.match(/PRETTY_NAME="([^"]+)"/);
            if (match && match[1]) {
                hostOs = match[1];
            }
        }
    } catch (e) {}

    // Robust CPU detection with multiple fallbacks
    let cpuModel = 'Unknown CPU';
    try {
        const cpus = os.cpus();
        if (cpus && cpus.length > 0 && cpus[0].model) {
            cpuModel = cpus[0].model;
        } else if (fs.existsSync('/proc/cpuinfo')) {
            // Fallback for ARM/UserLand environments
            const cpuinfo = fs.readFileSync('/proc/cpuinfo', 'utf8');
            const modelMatch = cpuinfo.match(/model name\s*:\s*(.+)/i) ||
                              cpuinfo.match(/Hardware\s*:\s*(.+)/i) ||
                              cpuinfo.match(/Processor\s*:\s*(.+)/i) ||
                              cpuinfo.match(/CPU part\s*:\s*(.+)/i);
            if (modelMatch) {
                cpuModel = modelMatch[1].trim();
            } else {
                // Count cores as fallback
                const coreCount = (cpuinfo.match(/processor\s*:/gi) || []).length;
                cpuModel = coreCount > 0 ? `${coreCount}-core processor` : 'Unknown';
            }
        }

        // If still unknown, try lscpu command
        if (cpuModel === 'Unknown CPU' || cpuModel === 'Unknown') {
            try {
                const { execSync } = require('child_process');
                const lscpuOutput = execSync('lscpu 2>/dev/null || cat /proc/cpuinfo 2>/dev/null', { encoding: 'utf8', timeout: 2000 });
                const nameMatch = lscpuOutput.match(/Model name:\s*(.+)/i) ||
                                 lscpuOutput.match(/Architecture:\s*(.+)/i);
                if (nameMatch) {
                    cpuModel = nameMatch[1].trim();
                }
            } catch (cmdErr) {}
        }

        // Final fallback: just show architecture
        if (cpuModel === 'Unknown CPU' || cpuModel === 'Unknown') {
            cpuModel = `${os.arch()} processor`;
        }
    } catch (e) {
        cpuModel = `${os.arch()} processor`;
    }
    const freeMem = (os.freemem() / 1024 / 1024 / 1024).toFixed(2);
    const totalMem = (os.totalmem() / 1024 / 1024 / 1024).toFixed(2);

    const uptime = formatUptime(getProcessUptimeSeconds());

    const embed = new EmbedBuilder()
        .setTitle('🏓 Pong!')
        .setColor(0x3498db)
        .addFields(
            { name: '🤖 Bot Version', value: `v${botVersion}`, inline: true },
            { name: '🛠️ Node Runtime', value: `${process.version}`, inline: true },
            { name: '📶 Latency', value: `API: \`${apiLatency}ms\`\nRT: \`${roundtripLatency}ms\``, inline: true },
            { name: '⏱️ Uptime', value: `\`${uptime}\``, inline: true },
            { name: '🧠 Memory', value: `${freeMem}GB / ${totalMem}GB Free`, inline: true },
            { name: '⚙️ Processor', value: cpuModel, inline: true },
            { name: '🐧 Host OS', value: hostOs, inline: true }
        )
        .setFooter({ text: 'Jarvis Systems Online' })
        .setTimestamp();

    return { embeds: [embed] };
}

async function handleYt(interaction, _jarvis) {
    const query = (interaction.options.getString('query') || '').trim();
    if (!query.length) {
        return 'Please provide a YouTube search query, sir.';
    }

    try {
        const response = await youtubeSearch.searchVideos(query, 24);
        const items = Array.isArray(response?.items) ? response.items : [];
        if (!items.length) {
            return 'No relevant videos found, sir. Perhaps try a different search term?';
        }

        return ytSearchUi.buildInitialResponse({
            ownerId: interaction.user.id,
            query,
            results: items
        });
    } catch (error) {
        console.error('YouTube search command failed:', error);
        return 'YouTube search failed, sir. Technical difficulties.';
    }
}

async function handleJarvis(interaction, jarvis) {
    let prompt = interaction.options.getString('prompt') || '';

    // Fuh Naw bypass
    if (prompt && /\bis\s+this\s+tuff\b/i.test(prompt)) {
        const emojiString = '<:wilted_rose:1462415423327703260>';
        return `Fuh naw, sir 💔 ${emojiString}`;
    }

    // Peak bypass
    if (prompt && /\bis\s+this\s+peak\b/i.test(prompt)) {
        return 'Indubitably peak, sir. 🏔️🔥';
    }

    try {
        const guild = interaction.guild || (interaction.guildId
            ? await interaction.client.guilds.fetch(interaction.guildId).catch(() => null)
            : null);

        if (guild) {
            const userIds = Array.from(prompt.matchAll(/<@!?(\d{17,20})>/g)).map(match => match[1]);
            for (const mentionedUserId of new Set(userIds)) {
                const member = guild.members.cache.get(mentionedUserId)
                    || await guild.members.fetch(mentionedUserId).catch(() => null);
                const displayName = member?.displayName
                    || member?.user?.globalName
                    || member?.user?.username
                    || 'user';
                prompt = prompt.replace(new RegExp(`<@!?${mentionedUserId}>`, 'g'), `@${displayName}`);
            }

            const roleIds = Array.from(prompt.matchAll(/<@&(\d{17,20})>/g)).map(match => match[1]);
            for (const mentionedRoleId of new Set(roleIds)) {
                const role = guild.roles.cache.get(mentionedRoleId)
                    || await guild.roles.fetch(mentionedRoleId).catch(() => null);
                const roleName = role?.name || 'role';
                prompt = prompt.replace(new RegExp(`<@&${mentionedRoleId}>`, 'g'), `@${roleName}`);
            }

            const channelIds = Array.from(prompt.matchAll(/<#(\d{17,20})>/g)).map(match => match[1]);
            for (const mentionedChannelId of new Set(channelIds)) {
                const channel = guild.channels.cache.get(mentionedChannelId)
                    || await guild.channels.fetch(mentionedChannelId).catch(() => null);
                const channelName = channel?.name || 'channel';
                prompt = prompt.replace(new RegExp(`<#${mentionedChannelId}>`, 'g'), `#${channelName}`);
            }
        }
    } catch (error) {
        console.warn('Failed to resolve mention display names for /jarvis prompt:', error);
    }

    try {
        if (interaction.client?.user?.id) {
            prompt = prompt.replace(new RegExp(`<@!?${interaction.client.user.id}>`, 'g'), '').trim();
        }
    } catch (_) {}

    prompt = prompt
        .replace(/@everyone/g, '')
        .replace(/@here/g, '')
        .trim();

    if (!prompt) {
        prompt = 'jarvis';
    }

    if (prompt.length > config.ai.maxSlashInputLength) {
        const responses = [
            'Rather verbose, sir. A concise version, perhaps?',
            'Too many words, sir. Brevity, please.',
            'TL;DR, sir.',
            'Really, sir?',
            'Saving your creativity for later, sir.',
            `${config.ai.maxSlashInputLength} characters is the limit, sir.`,
            'Stop yapping, sir.',
            'Quite the novella, sir. Abridged edition?',
            'Brevity is the soul of wit, sir.'
        ];

        await interaction.editReply(responses[Math.floor(Math.random() * responses.length)]);
        return '__JARVIS_HANDLED__';
    }

    if (prompt.length > config.ai.maxInputLength) {
        prompt = `${prompt.substring(0, config.ai.maxInputLength)}...`;
    }

    // Extract image attachment if provided (for vision processing)
    const imageAttachment = interaction.options.getAttachment('image');
    const imageAttachments = [];
    if (imageAttachment) {
        const contentType = imageAttachment.contentType || '';
        const ext = (imageAttachment.name || '').split('.').pop()?.toLowerCase();
        const imageExts = ['jpg', 'jpeg', 'png', 'webp', 'gif'];
        if (contentType.startsWith('image/') || imageExts.includes(ext)) {
            imageAttachments.push({ url: imageAttachment.url, contentType: imageAttachment.contentType });
        }
    }

    // ── Social Credit check ──
    const socialCredit = require('../social-credit');
    const userCredit = await socialCredit.getCredit(interaction.user.id);
    if (socialCredit.isBlocked(userCredit)) {
        await interaction.editReply({ content: socialCredit.getBlockMessage(userCredit), allowedMentions: { parse: [] } });
        return '__JARVIS_HANDLED__';
    }
    if (userCredit.blockedUntil && new Date() >= new Date(userCredit.blockedUntil)) {
        socialCredit.clearBlock(interaction.user.id).catch(() => {});
    }

    const aiResponse = await jarvis.generateResponse(interaction, prompt, true, null, imageAttachments);

    // ── Social Credit roll ──
    try {
        const cringeScore = socialCredit.getCringeLevel(prompt);
        let creditChange = socialCredit.rollCreditChange(prompt);
        if (cringeScore < 15 && userCredit.score < 0) {
            creditChange += socialCredit.getRecoveryBonus(userCredit.score);
        }
        if (creditChange !== 0) {
            const newScore = await socialCredit.adjustCredit(interaction.user.id, creditChange);
            if (socialCredit.shouldNotify(creditChange, cringeScore)) {
                const suffix = socialCredit.buildNotifyMessage(creditChange, newScore);
                if (typeof aiResponse === 'string') {
                    return aiResponse + '\n' + suffix;
                }
            }
        }
    } catch (_) { /* social credit non-critical */ }

    return aiResponse;
}

async function handleClear(interaction, jarvis, userId, guildId) {
    return await jarvis.handleUtilityCommand(
        'reset',
        interaction.user.username,
        userId,
        true,
        interaction,
        guildId
    );
}

async function handleHelp(interaction, jarvis, userId, guildId) {
    return await jarvis.handleUtilityCommand(
        'help',
        interaction.user.username,
        userId,
        true,
        interaction,
        guildId
    );
}

async function handleProfile(interaction, jarvis, userId, guildId) {
    return await jarvis.handleUtilityCommand(
        'profile',
        interaction.user.username,
        userId,
        true,
        interaction,
        guildId
    );
}

async function handleHistory(interaction, jarvis, userId, guildId) {
    return await jarvis.handleUtilityCommand(
        'history',
        interaction.user.username,
        userId,
        true,
        interaction,
        guildId
    );
}

async function handleDigest(interaction, jarvis, userId, guildId) {
    return await jarvis.handleUtilityCommand(
        'digest',
        interaction.user.username,
        userId,
        true,
        interaction,
        guildId
    );
}

async function handleAvatar(interaction) {
    const targetUser = interaction.options.getUser('user') || interaction.user;
    const useServerAvatar = interaction.options.getBoolean('server') === true;

    if (useServerAvatar && !interaction.guild) {
        return 'Server avatars can only be fetched inside a server, sir.';
    }

    try {
        let avatarUrl = null;
        if (useServerAvatar && interaction.guild) {
            const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
            if (!member) {
                return 'I could not resolve that member in this server, sir.';
            }
            avatarUrl = member.displayAvatarURL({ size: 4096, forceStatic: false });
        }

        if (!avatarUrl) {
            avatarUrl = targetUser.displayAvatarURL({ size: 4096, forceStatic: false });
        }

        return avatarUrl;
    } catch (error) {
        console.error('Avatar command failed:', error);
        return 'Unable to fetch avatar right now, sir.';
    }
}

async function handleBanner(interaction) {
    const targetUser = interaction.options.getUser('user') || interaction.user;
    const useServerBanner = interaction.options.getBoolean('server') === true;

    if (useServerBanner && !interaction.guild) {
        return 'Server banners can only be fetched inside a server, sir.';
    }

    try {
        let bannerUrl = null;
        if (useServerBanner && interaction.guild) {
            const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
            if (!member) {
                return 'I could not resolve that member in this server, sir.';
            }
            bannerUrl = member.bannerURL?.({ size: 4096, forceStatic: false }) || null;
            if (!bannerUrl) {
                return 'No server banner found for that user, sir.';
            }
        } else {
            const fetchedUser = await interaction.client.users.fetch(targetUser.id, { force: true }).catch(() => targetUser);
            bannerUrl = fetchedUser.bannerURL({ size: 4096, forceStatic: false });
            if (!bannerUrl) {
                return 'No banner found for that user, sir.';
            }
        }

        const embed = new EmbedBuilder()
            .setColor(0x2f3136)
            .setTitle(`Banner • ${targetUser.tag}`)
            .setURL(bannerUrl)
            .setImage(bannerUrl)
            .setFooter({ text: useServerBanner ? 'Server banner' : 'Global banner' });

        return { embeds: [embed] };
    } catch (error) {
        console.error('Banner command failed:', error);
        return 'Unable to fetch banner right now, sir.';
    }
}

async function handleUserinfo(interaction) {
    const targetUser = interaction.options.getUser('user') || interaction.user;

    if (!interaction.guild) {
        return 'This command only works in servers, sir.';
    }

    const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

    const embed = new EmbedBuilder()
        .setTitle(`👤 ${targetUser.tag || targetUser.username}`)
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
            embed.addFields({
                name: 'Boosting Since',
                value: `<t:${Math.floor(member.premiumSinceTimestamp / 1000)}:R>`,
                inline: true
            });
        }
    }

    return { embeds: [embed] };
}

async function handleServerinfo(interaction) {
    if (!interaction.guild) {
        return 'This command only works in servers, sir.';
    }

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
            { name: '👥 Members', value: `${guild.memberCount?.toLocaleString?.() || guild.memberCount || 'Unknown'}`, inline: true },
            { name: '💬 Channels', value: `${guild.channels?.cache?.size ?? 'Unknown'}`, inline: true },
            { name: '🛡️ Roles', value: `${guild.roles?.cache?.size ?? 'Unknown'}`, inline: true },
            { name: '🚀 Boost Level', value: `Tier ${guild.premiumTier ?? 0}`, inline: true },
            { name: '💎 Boosts', value: `${guild.premiumSubscriptionCount || 0}`, inline: true },
            { name: '😄 Emojis', value: `${guild.emojis?.cache?.size ?? 'Unknown'}`, inline: true }
        );

    if (guild.description) {
        embed.setDescription(guild.description);
    }
    if (bannerUrl) {
        embed.setImage(bannerUrl);
    }

    return { embeds: [embed] };
}

module.exports = {
    handlePing,
    handleYt,
    handleJarvis,
    handleClear,
    handleHelp,
    handleProfile,
    handleHistory,
    handleDigest,
    handleAvatar,
    handleBanner,
    handleUserinfo,
    handleServerinfo
};

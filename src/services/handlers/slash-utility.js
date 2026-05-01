'use strict';

const { EmbedBuilder } = require('discord.js');
const config = require('../../../config');
const youtubeSearch = require('../youtube-search');
const ytSearchUi = require('./yt-search-ui');
const { formatUptime, getProcessUptimeSeconds } = require('../../utils/uptime');

// Cache static system info once at startup (never changes during process lifetime)
const os = require('os');
const fs = require('fs');
const path = require('path');

const _sysInfo = (() => {
    let botVersion = 'Unknown';
    try {
        botVersion = require(path.join(process.cwd(), 'package.json')).version;
    } catch (_) {}

    let hostOs = `${os.type()} ${os.release()}`;
    try {
        if (fs.existsSync('/etc/os-release')) {
            const match = fs.readFileSync('/etc/os-release', 'utf8').match(/PRETTY_NAME="([^"]+)"/);
            if (match?.[1]) hostOs = match[1];
        }
    } catch (_) {}

    let cpuModel = 'Unknown CPU';
    try {
        const cpus = os.cpus();
        if (cpus?.[0]?.model) {
            cpuModel = cpus[0].model;
        } else if (fs.existsSync('/proc/cpuinfo')) {
            const cpuinfo = fs.readFileSync('/proc/cpuinfo', 'utf8');
            const m = cpuinfo.match(/model name\s*:\s*(.+)/i) || cpuinfo.match(/Hardware\s*:\s*(.+)/i) || cpuinfo.match(/Processor\s*:\s*(.+)/i);
            if (m) cpuModel = m[1].trim();
            else {
                const cores = (cpuinfo.match(/processor\s*:/gi) || []).length;
                if (cores > 0) cpuModel = `${cores}-core processor`;
            }
        }
        if (cpuModel === 'Unknown CPU' || cpuModel === 'Unknown') {
            try {
                const { execSync } = require('child_process');
                const out = execSync('lscpu 2>/dev/null', { encoding: 'utf8', timeout: 2000 });
                const m = out.match(/Model name:\s*(.+)/i);
                if (m) cpuModel = m[1].trim();
            } catch (_) {}
        }
        if (cpuModel === 'Unknown CPU' || cpuModel === 'Unknown') cpuModel = `${os.arch()} processor`;
    } catch (_) {
        cpuModel = `${os.arch()} processor`;
    }

    return { botVersion, hostOs, cpuModel, totalMem: (os.totalmem() / 1024 / 1024 / 1024).toFixed(2) };
})();

async function handlePing(interaction) {
    // No editReply roundtrip - send the embed directly to save bot quota.
    // RT latency is approximated from interaction creation to send time.
    const apiLatency = Math.round(interaction.client.ws.ping);
    const roundtripLatency = Math.max(0, Date.now() - interaction.createdTimestamp);
    const freeMem = (os.freemem() / 1024 / 1024 / 1024).toFixed(2);
    const uptime = formatUptime(getProcessUptimeSeconds());

    const embed = new EmbedBuilder()
        .setTitle('🏓 Pong!')
        .setColor(0x3498db)
        .addFields(
            { name: '🤖 Bot Version', value: `v${_sysInfo.botVersion}`, inline: true },
            { name: '🛠️ Node Runtime', value: `${process.version}`, inline: true },
            { name: '📶 Latency', value: `API: \`${apiLatency}ms\`\nRT: \`${roundtripLatency}ms\``, inline: true },
            { name: '⏱️ Uptime', value: `\`${uptime}\``, inline: true },
            { name: '🧠 Memory', value: `${freeMem}GB / ${_sysInfo.totalMem}GB Free`, inline: true },
            { name: '⚙️ Processor', value: _sysInfo.cpuModel, inline: true },
            { name: '🐧 Host OS', value: _sysInfo.hostOs, inline: true }
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
        return 'Fuh naw, sir 💔 <:wilted_rose:1462415423327703260>';
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
            const mentionTypes = [
                { regex: /<@!?(\d{17,20})>/g, pattern: id => `<@!?${id}>`, prefix: '@', resolve: id => guild.members.cache.get(id) || guild.members.fetch(id).catch(() => null), name: m => m?.displayName || m?.user?.globalName || m?.user?.username || 'user' },
                { regex: /<@&(\d{17,20})>/g, pattern: id => `<@&${id}>`, prefix: '@', resolve: id => guild.roles.cache.get(id) || guild.roles.fetch(id).catch(() => null), name: r => r?.name || 'role' },
                { regex: /<#(\d{17,20})>/g, pattern: id => `<#${id}>`, prefix: '#', resolve: id => guild.channels.cache.get(id) || guild.channels.fetch(id).catch(() => null), name: c => c?.name || 'channel' }
            ];
            for (const { regex, pattern, prefix, resolve, name } of mentionTypes) {
                for (const id of new Set(Array.from(prompt.matchAll(regex)).map(m => m[1]))) {
                    const entity = await resolve(id);
                    prompt = prompt.replace(new RegExp(pattern(id), 'g'), `${prefix}${name(entity)}`);
                }
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

    if (prompt.length > config.ai.maxInputLength) {
        const responses = [
            'Rather verbose, sir. A concise version, perhaps?',
            'Too many words, sir. Brevity, please.',
            'TL;DR, sir.',
            'Really, sir?',
            'Saving your creativity for later, sir.',
            `${config.ai.maxInputLength} characters is the limit, sir.`,
            'Stop yapping, sir.',
            'Quite the novella, sir. Abridged edition?',
            'Brevity is the soul of wit, sir.'
        ];

        await interaction.editReply(responses[Math.floor(Math.random() * responses.length)]);
        return '__JARVIS_HANDLED__';
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

    const aiResponse = await jarvis.generateResponse(interaction, prompt, true, imageAttachments);
    return aiResponse;
}

const makeUtilityHandler = cmd => (interaction, jarvis, userId, guildId) =>
    jarvis.handleUtilityCommand(cmd, interaction.member?.displayName || interaction.user.displayName || interaction.user.username, userId, true, interaction, guildId);
const handleClear = makeUtilityHandler('reset');
const handleHelp = makeUtilityHandler('help');
const handleProfile = makeUtilityHandler('profile');

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
    handleAvatar,
    handleBanner,
    handleUserinfo,
    handleServerinfo,
};

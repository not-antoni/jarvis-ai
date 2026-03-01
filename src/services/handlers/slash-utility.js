'use strict';

const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const config = require('../../../config');
const youtubeSearch = require('../youtube-search');
const ytSearchUi = require('./yt-search-ui');

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

    const uptimeSeconds = process.uptime();
    const uptime = `${Math.floor(uptimeSeconds / 3600)}h ${Math.floor((uptimeSeconds % 3600) / 60)}m ${Math.floor(uptimeSeconds % 60)}s`;

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

async function handleT(interaction, jarvis, userId, guildId) {
    const query = (interaction.options.getString('query') || '').trim();

    if (!query.length) {
        return 'Please provide a search query, sir.';
    }

    const allowedChannelIds = (config.commands?.whitelistedChannelIds || []).map((id) => String(id));
    if (interaction.guild && !allowedChannelIds.includes(String(interaction.channelId))) {
        return 'This command is restricted to authorised channels, sir.';
    }

    try {
        return await jarvis.handleUtilityCommand(
            `!t ${query}`,
            interaction.user.username,
            userId,
            true,
            interaction,
            guildId
        );
    } catch (error) {
        console.error('Knowledge search command failed:', error);
        return 'Knowledge archives are unreachable right now, sir.';
    }
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

async function handleSearch(interaction, jarvis) {
    const query = (interaction.options.getString('query') || '').trim();
    if (!query.length) {
        return 'Please provide a web search query, sir.';
    }

    try {
        return await jarvis.handleBraveSearch({
            raw: query,
            prepared: query,
            invocation: query,
            content: query,
            rawMessage: query,
            rawInvocation: query,
            explicit: false
        });
    } catch (error) {
        console.error('Web search command failed:', error);
        return 'Web search is currently unavailable, sir. Technical difficulties.';
    }
}

async function handleMath(interaction, jarvis) {
    const expression = (interaction.options.getString('expression') || '').trim();
    if (!expression.length) {
        return 'Please provide something to calculate, sir.';
    }

    try {
        const result = await jarvis.handleMathCommand(expression);
        const embed = new EmbedBuilder()
            .setColor(0x0078d4)
            .setTitle('📐 Mathematics')
            .addFields(
                { name: 'Input', value: `\`\`\`${expression}\`\`\``, inline: false },
                { name: 'Result', value: `\`\`\`${result}\`\`\``, inline: false }
            )
            .setFooter({ text: 'Jarvis Math Engine • Powered by Nerdamer' })
            .setTimestamp();
        return { embeds: [embed] };
    } catch (error) {
        console.error('Math command failed:', error);
        return 'Mathematics subsystem encountered an error, sir. Please verify the expression.';
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
        const creditChange = socialCredit.rollCreditChange(prompt);
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

async function handleRoll(interaction, jarvis, userId, guildId) {
    const sides = interaction.options.getInteger('sides') || 6;
    return await jarvis.handleUtilityCommand(
        `roll ${sides}`,
        interaction.user.username,
        userId,
        true,
        interaction,
        guildId
    );
}

async function handleTime(interaction, jarvis, userId, guildId) {
    return await jarvis.handleUtilityCommand(
        'time',
        interaction.user.username,
        userId,
        true,
        interaction,
        guildId
    );
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

async function handleRecap(interaction, jarvis, userId, guildId) {
    return await jarvis.handleUtilityCommand(
        'recap',
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

async function handleEncode(interaction, jarvis, userId, guildId) {
    return await jarvis.handleUtilityCommand(
        'encode',
        interaction.user.username,
        userId,
        true,
        interaction,
        guildId
    );
}

async function handleDecode(interaction, jarvis, userId, guildId) {
    return await jarvis.handleUtilityCommand(
        'decode',
        interaction.user.username,
        userId,
        true,
        interaction,
        guildId
    );
}

async function handlePwdgen(interaction) {
    try {
        const crypto = require('crypto');
        const lengthRaw = interaction.options.getInteger('length');
        const length = Math.max(8, Math.min(64, Number.isFinite(lengthRaw) ? lengthRaw : 16));
        const includeSymbols = interaction.options.getBoolean('symbols') !== false;

        const lowers = 'abcdefghijklmnopqrstuvwxyz';
        const uppers = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        const digits = '0123456789';
        const symbols = '!@#$%^&*()-_=+[]{};:,.?/';

        let pool = lowers + uppers + digits;
        if (includeSymbols) {pool += symbols;}

        // Ensure at least one from each required class
        const required = [
            lowers[crypto.randomInt(lowers.length)],
            uppers[crypto.randomInt(uppers.length)],
            digits[crypto.randomInt(digits.length)]
        ];
        if (includeSymbols) {
            required.push(symbols[crypto.randomInt(symbols.length)]);
        }

        if (length < required.length) {
            return 'Length too short for the selected character requirements, sir.';
        }

        const chars = [...required];
        while (chars.length < length) {
            chars.push(pool[crypto.randomInt(pool.length)]);
        }

        // Fisher-Yates shuffle
        for (let i = chars.length - 1; i > 0; i--) {
            const j = crypto.randomInt(i + 1);
            [chars[i], chars[j]] = [chars[j], chars[i]];
        }

        const password = chars.join('');
        return {
            content: `Here is your generated password (keep it private), sir:\n\n\`\`\`${password}\`\`\``
        };
    } catch (error) {
        try {
            const errorLogger = require('../error-logger');
            await errorLogger.log({
                error,
                context: {
                    location: 'slash:pwdgen',
                    user: `${interaction.user.username} (${interaction.user.id})`,
                    guild: interaction.guild ? `${interaction.guild.name} (${interaction.guild.id})` : 'DM',
                    channel: `${interaction.channelId}`,
                    command: 'pwdgen'
                }
            });
        } catch (_logErr) { /* error logger failed */ }
        return 'Password generator failed, sir.';
    }
}

async function handleQrcode(interaction) {
    try {
        const text = (interaction.options.getString('text') || '').trim();
        if (!text.length) {
            return 'Provide text to encode, sir.';
        }

        // Prefer local qrcode library if installed, fallback to a remote QR image endpoint.
        let pngBuffer = null;
        try {
            const qrcode = require('qrcode');
            pngBuffer = await qrcode.toBuffer(text, {
                type: 'png',
                errorCorrectionLevel: 'M',
                margin: 2,
                width: 512
            });
        } catch {
            const allowExternalFallback = String(process.env.ALLOW_QR_EXTERNAL_FALLBACK || '1').toLowerCase() === '1';
            if (!allowExternalFallback) {
                throw new Error('External QR fallback disabled');
            }
            const fetch = require('node-fetch');
            const url = `https://api.qrserver.com/v1/create-qr-code/?size=512x512&data=${encodeURIComponent(text)}`;
            const res = await fetch(url);
            if (!res.ok) {
                throw new Error(`QR service failed: ${res.status}`);
            }
            const arr = await res.arrayBuffer();
            pngBuffer = Buffer.from(arr);
        }

        const attachment = new AttachmentBuilder(pngBuffer, { name: 'qrcode.png' });
        return {
            content: 'QR code generated, sir.',
            files: [attachment]
        };
    } catch (error) {
        try {
            const errorLogger = require('../error-logger');
            await errorLogger.log({
                error,
                context: {
                    location: 'slash:qrcode',
                    user: `${interaction.user.username} (${interaction.user.id})`,
                    guild: interaction.guild ? `${interaction.guild.name} (${interaction.guild.id})` : 'DM',
                    channel: `${interaction.channelId}`,
                    command: 'qrcode'
                }
            });
        } catch (_logErr) { /* error logger failed */ }
        return 'QR code generation failed, sir.';
    }
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

module.exports = {
    handlePing,
    handleT,
    handleYt,
    handleSearch,
    handleMath,
    handleJarvis,
    handleRoll,
    handleTime,
    handleClear,
    handleHelp,
    handleProfile,
    handleHistory,
    handleRecap,
    handleDigest,
    handleEncode,
    handleDecode,
    handlePwdgen,
    handleQrcode,
    handleAvatar,
    handleBanner
};

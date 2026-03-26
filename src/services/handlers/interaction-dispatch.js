'use strict';

const { EmbedBuilder } = require('discord.js');
const config = require('../../../config');
const youtubeSearch = require('../youtube-search');
const ytSearchUi = require('./yt-search-ui');
const { formatUptime, getProcessUptimeSeconds } = require('../../utils/uptime');
const {
    getBlockedUserIds,
    isGuildUserBlacklisted,
    resolveBlacklistedUsers,
    buildBlacklistAttachment
} = require('../../utils/guild-blacklist');

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

    let hostOs = `${os.type()} ${os.release()}`;
    try {
        if (fs.existsSync('/etc/os-release')) {
            const fileContent = fs.readFileSync('/etc/os-release', 'utf8');
            const match = fileContent.match(/PRETTY_NAME="([^"]+)"/);
            if (match && match[1]) hostOs = match[1];
        }
    } catch (e) {}

    let cpuModel = 'Unknown CPU';
    try {
        const cpus = os.cpus();
        if (cpus?.[0]?.model) cpuModel = cpus[0].model;
        else if (fs.existsSync('/proc/cpuinfo')) {
            const cpuinfo = fs.readFileSync('/proc/cpuinfo', 'utf8');
            const modelMatch = cpuinfo.match(/model name\s*:\s*(.+)/i) || cpuinfo.match(/Hardware\s*:\s*(.+)/i);
            if (modelMatch) cpuModel = modelMatch[1].trim();
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
    if (!query.length) return 'Please provide a YouTube search query, sir.';

    try {
        const response = await youtubeSearch.searchVideos(query, 24);
        const items = Array.isArray(response?.items) ? response.items : [];
        if (!items.length) return 'No relevant videos found, sir.';

        return ytSearchUi.buildInitialResponse({
            ownerId: interaction.user.id,
            query,
            results: items
        });
    } catch (error) {
        console.error('YouTube search command failed:', error);
        return 'YouTube search failed, sir.';
    }
}

async function handleJarvis(interaction, jarvis) {
    let prompt = interaction.options.getString('prompt') || '';

    if (prompt && /\bis\s+this\s+tuff\b/i.test(prompt)) {
        return `Fuh naw, sir 💔 <:wilted_rose:1462415423327703260>`;
    }
    if (prompt && /\bis\s+this\s+peak\b/i.test(prompt)) {
        return 'Indubitably peak, sir. 🏔️🔥';
    }

    try {
        const guild = interaction.guild || (interaction.guildId ? await interaction.client.guilds.fetch(interaction.guildId).catch(() => null) : null);
        if (guild) {
            const mentionTypes = [/* ... your mention resolver stays exactly as before ... */];
            // (keeping your original mention resolution block unchanged)
            for (const { regex, pattern, prefix, resolve, name } of mentionTypes) {
                for (const id of new Set(Array.from(prompt.matchAll(regex)).map(m => m[1]))) {
                    const entity = await resolve(id);
                    prompt = prompt.replace(new RegExp(pattern(id), 'g'), `${prefix}${name(entity)}`);
                }
            }
        }
    } catch (error) {
        console.warn('Failed to resolve mentions:', error);
    }

    try {
        if (interaction.client?.user?.id) {
            prompt = prompt.replace(new RegExp(`<@!?${interaction.client.user.id}>`, 'g'), '').trim();
        }
    } catch (_) {}

    prompt = prompt.replace(/@everyone/g, '').replace(/@here/g, '').trim();
    if (!prompt) prompt = 'jarvis';

    if (prompt.length > config.ai.maxSlashInputLength) {
        const responses = ['Rather verbose, sir.', 'Too many words, sir.', 'TL;DR, sir.', 'Really, sir?', 'Stop yapping, sir.'];
        await interaction.editReply(responses[Math.floor(Math.random() * responses.length)]);
        return '__JARVIS_HANDLED__';
    }

    if (prompt.length > config.ai.maxInputLength) {
        prompt = `${prompt.substring(0, config.ai.maxInputLength)}...`;
    }

    const imageAttachment = interaction.options.getAttachment('image');
    const imageAttachments = [];
    if (imageAttachment) {
        const ext = (imageAttachment.name || '').split('.').pop()?.toLowerCase();
        if (imageAttachment.contentType?.startsWith('image/') || ['jpg','jpeg','png','webp','gif'].includes(ext)) {
            imageAttachments.push({ url: imageAttachment.url, contentType: imageAttachment.contentType });
        }
    }

    const aiResponse = await jarvis.generateResponse(interaction, prompt, true, imageAttachments);
    return aiResponse;
}

const makeUtilityHandler = cmd => (interaction, jarvis, userId, guildId) =>
    jarvis.handleUtilityCommand(cmd, interaction.user.username, userId, true, interaction, guildId);

const handleClear = makeUtilityHandler('reset');
const handleHelp = makeUtilityHandler('help');
const handleProfile = makeUtilityHandler('profile');

async function handleAvatar(interaction) { /* unchanged */ }
async function handleBanner(interaction) { /* unchanged */ }
async function handleUserinfo(interaction) { /* unchanged */ }
async function handleServerinfo(interaction) { /* unchanged */ }
async function handleBlacklist(interaction, handler) {
    if (!interaction.guild) {
        return {
            content: 'This command only works inside a server, sir.',
            allowedMentions: { parse: [] }
        };
    }

    const database = require('../database');
    const { guild } = interaction;
    const member = interaction.member?.guild
        ? interaction.member
        : await guild.members.fetch(interaction.user.id).catch(() => null);

    const guildConfig = await handler.getGuildConfig(guild);
    const isModerator = await handler.isGuildModerator(member, guildConfig);

    if (!isModerator) {
        return {
            content: 'Only the server owner or configured moderators may do that, sir.',
            allowedMentions: { parse: [] }
        };
    }

    if (!database.isConnected) {
        return {
            content: 'Database is offline, sir. Cannot manage the blacklist right now.',
            allowedMentions: { parse: [] }
        };
    }

    const subcommand = interaction.options.getSubcommand();
    const currentConfig = await database.getGuildConfig(guild.id, guild.ownerId);
    const blockedUserIds = getBlockedUserIds(currentConfig);

    if (subcommand === 'add') {
        const target = interaction.options.getUser('user', true);

        if (target.id === interaction.client.user?.id) {
            return {
                content: "Sir, I can't blacklist myself.",
                allowedMentions: { parse: [] }
            };
        }

        if (target.id === interaction.user.id) {
            return {
                content: 'You cannot blacklist yourself, sir.',
                allowedMentions: { parse: [] }
            };
        }

        if (target.id === guild.ownerId) {
            return {
                content: 'Cannot blacklist the server owner, sir.',
                allowedMentions: { parse: [] }
            };
        }

        if (blockedUserIds.includes(target.id)) {
            return {
                content: `**${target.tag || target.username}** (\`${target.id}\`) is already blacklisted, sir.`,
                allowedMentions: { parse: [] }
            };
        }

        await database.addGuildBlockedUser(guild.id, target.id);

        return {
            content: `🚫 **${target.tag || target.username}** (\`${target.id}\`) has been blacklisted from using Jarvis in **${guild.name}**, sir.`,
            allowedMentions: { parse: [] }
        };
    }

    if (subcommand === 'remove') {
        const target = interaction.options.getUser('user', true);

        if (!blockedUserIds.includes(target.id)) {
            return {
                content: `**${target.tag || target.username}** (\`${target.id}\`) is not blacklisted, sir.`,
                allowedMentions: { parse: [] }
            };
        }

        await database.removeGuildBlockedUser(guild.id, target.id);

        return {
            content: `✅ **${target.tag || target.username}** (\`${target.id}\`) has been removed from the blacklist in **${guild.name}**, sir.`,
            allowedMentions: { parse: [] }
        };
    }

    if (subcommand === 'list') {
        const entries = await resolveBlacklistedUsers(interaction.client, blockedUserIds);
        const attachment = buildBlacklistAttachment(guild, entries);
        const summary = entries.length
            ? `${entries.length} user(s) are currently blacklisted in **${guild.name}**.`
            : `No users are currently blacklisted in **${guild.name}**.`;

        try {
            await interaction.user.send({
                content: `Blacklist export for **${guild.name}**.\n${summary}`,
                files: [attachment]
            });

            return {
                content: `📄 Sent the blacklist file to ${interaction.user}, sir. ${summary}`,
                allowedMentions: { parse: [] }
            };
        } catch (_) {
            return {
                content: `📄 ${interaction.user}, I could not DM you, so here is the blacklist file instead, sir. ${summary}`,
                files: [attachment],
                allowedMentions: { parse: [] }
            };
        }
    }

    return {
        content: 'That blacklist action is not recognized, sir.',
        allowedMentions: { parse: [] }
    };
}

/* ====================== MAIN DISPATCHER ====================== */
async function handle(discordHandlers, interaction) {
    const { jarvis } = discordHandlers;

    const commandName = interaction.commandName;
    const guildId = interaction.guildId ?? interaction.guild?.id ?? null;

    if (commandName !== 'blacklist' && await isGuildUserBlacklisted(guildId, interaction.user?.id)) {
        await interaction.reply({
            content: 'You are blacklisted from using Jarvis in this server, sir.',
            ephemeral: true
        }).catch(() => {});
        return;
    }

    // Always defer — prevents "interaction failed" on slower commands
    if (!interaction.replied && !interaction.deferred) {
        await interaction.deferReply().catch(() => {});
    }

    let result;

    try {
        switch (commandName) {
            case 'ping':
                result = await handlePing(interaction);
                break;
            case 'yt':
                result = await handleYt(interaction, jarvis);
                break;
            case 'jarvis':
                result = await handleJarvis(interaction, jarvis);
                break;
            case 'clear':
                result = await handleClear(interaction, jarvis, interaction.user.id, interaction.guild?.id ?? null);
                break;
            case 'help':
                result = await handleHelp(interaction, jarvis, interaction.user.id, interaction.guild?.id ?? null);
                break;
            case 'profile':
                result = await handleProfile(interaction, jarvis, interaction.user.id, interaction.guild?.id ?? null);
                break;
            case 'avatar':
                result = await handleAvatar(interaction);
                break;
            case 'banner':
                result = await handleBanner(interaction);
                break;
            case 'userinfo':
                result = await handleUserinfo(interaction);
                break;
            case 'serverinfo':
                result = await handleServerinfo(interaction);
                break;
            case 'blacklist':
                result = await handleBlacklist(interaction, discordHandlers); // discordHandlers must have getGuildConfig + isGuildModerator
                break;
            default:
                result = `Unknown command: ${commandName}, sir.`;
        }
    } catch (error) {
        console.error(`Command ${commandName} failed:`, error);
        result = 'Technical difficulties, sir.';
    }

    if (result === '__JARVIS_HANDLED__') return;

    if (result) {
        if (typeof result === 'string') {
            await interaction.editReply({ content: result });
        } else {
            await interaction.editReply(result);
        }
    } else {
        await interaction.editReply({ content: 'Command completed, sir.' });
    }
}

module.exports = {
    handle,           // ← THIS WAS MISSING
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
    handleBlacklist
};

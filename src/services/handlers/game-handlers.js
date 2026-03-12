'use strict';

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField } = require('discord.js');
const database = require('../../services/database');
const config = require('../../../config');
const ytSearchUi = require('./yt-search-ui');

// ── Handler-dependent functions ────────────────────────────────────────

async function handleFeaturesCommand(handler, interaction) {
    const defaults = config.features || {};
    const featureKeys = Object.keys(defaults).sort((a, b) => a.localeCompare(b));

    if (!featureKeys.length) {
        await interaction.editReply('No feature toggles are configured for this deployment, sir.');
        return;
    }

    // Handle toggle mode
    const toggleKey = interaction.options.getString('toggle');
    if (toggleKey) {
        if (!interaction.guild) {
            await interaction.editReply('Feature toggling is only available in servers, sir.');
            return;
        }

        const { member } = interaction;
        const isAdmin = member.permissions?.has(PermissionsBitField.Flags.Administrator) ||
            member.permissions?.has(PermissionsBitField.Flags.ManageGuild) ||
            member.id === interaction.guild.ownerId;

        if (!isAdmin) {
            await interaction.editReply('Only server admins can toggle features.');
            return;
        }

        const normalizedKey = toggleKey.trim().toLowerCase();
        const matchedKey = featureKeys.find(k => k.toLowerCase() === normalizedKey);
        if (!matchedKey) {
            await interaction.editReply(`Unknown feature: "${toggleKey}". Use \`/features\` to see all available features.`);
            return;
        }

        const explicitValue = interaction.options.getBoolean('enabled');
        const guildConfig = await handler.getGuildConfig(interaction.guild);
        const currentValue = guildConfig?.features?.[matchedKey];
        const newValue = explicitValue !== null ? explicitValue : !currentValue;

        await database.updateGuildFeatures(interaction.guild.id, { [matchedKey]: newValue });

        await interaction.editReply(`${newValue ? '\u2705' : '\u26D4'} **${matchedKey}** is now **${newValue ? 'enabled' : 'disabled'}** for this server.`);
        return;
    }

    // Display mode
    const embed = new EmbedBuilder()
        .setTitle('Jarvis Feature Flags')
        .setColor(0x00bfff);

    const globalLines = featureKeys.map((key) => `${defaults[key] ? '\u2705' : '\u26D4'} ${key}`);
    const globalEnabled = globalLines.filter((line) => line.startsWith('\u2705')).length;
    embed.setDescription(`${globalEnabled}/${featureKeys.length} modules enabled globally.`);

    const addChunkedField = (label, lines) => {
        const chunkSize = 12;
        for (let i = 0; i < lines.length; i += chunkSize) {
            const chunk = lines.slice(i, i + chunkSize);
            const name = lines.length > chunkSize ? `${label} (${Math.floor(i / chunkSize) + 1})` : label;
            embed.addFields({ name, value: chunk.join('\n') });
        }
    };

    addChunkedField('Global Defaults', globalLines);

    if (interaction.guild) {
        const guildConfig = await handler.getGuildConfig(interaction.guild);
        const guildFeatures = guildConfig?.features || {};
        const guildLines = featureKeys.map((key) => {
            const hasOverride = Object.prototype.hasOwnProperty.call(guildFeatures, key);
            const overrideValue = hasOverride ? Boolean(guildFeatures[key]) : undefined;
            const effective = hasOverride ? overrideValue : Boolean(defaults[key]);
            const origin = hasOverride
                ? (overrideValue ? 'override on' : 'override off')
                : `inherit (global ${defaults[key] ? 'on' : 'off'})`;
            return `${effective ? '\u2705' : '\u26D4'} ${key} \u2014 ${origin}`;
        });

        const enabledCount = guildLines.filter((line) => line.startsWith('\u2705')).length;
        embed.addFields({
            name: 'Server Summary',
            value: `${enabledCount}/${featureKeys.length} modules enabled for ${interaction.guild.name}.`
        });
        addChunkedField('This Server', guildLines);

        embed.setFooter({ text: 'Admins: /features toggle:<feature> to toggle' });
    }

    await interaction.editReply({ embeds: [embed] });
}

async function handleOptCommand(handler, interaction) {
    const selected = (interaction.options.getString('mode', true) || '').toLowerCase();
    const userId = interaction.user.id;
    const userName = interaction.user.displayName || interaction.user.username;

    if (!database.isConnected) {
        await interaction.editReply('Memory subsystem offline, sir. Unable to update preferences.');
        return;
    }

    const optIn = selected === 'in';
    const preferenceValue = optIn ? 'opt-in' : 'opt-out';

    try {
        await database.getUserProfile(userId, userName);
    } catch (error) {
        console.warn('Unable to load user profile prior to opt command:', error);
    }

    await database.setUserPreference(userId, 'memoryOpt', preferenceValue);

    if (!optIn) {
        await database.clearUserMemories(userId);
    }

    const embed = new EmbedBuilder()
        .setTitle('Memory Preference Updated')
        .setColor(optIn ? 0x22c55e : 0x64748b)
        .setDescription(optIn
            ? 'Long-term memory storage restored. I will resume learning from our conversations, sir.'
            : 'Memory retention disabled. I will respond normally, but I will not store new conversations, sir.')
        .addFields(
            { name: 'Status', value: optIn ? 'Opted **in** to memory storage.' : 'Opted **out** of memory storage.' },
            { name: 'Contextual Replies', value: 'Reply threads and immediate context still function.' }
        )
        .setFooter({ text: 'You may change this at any time with /opt.' });

    await interaction.editReply({ embeds: [embed], ephemeral: true });
}

async function handleComponentInteraction(handler, interaction) {
    const ytHandled = await ytSearchUi.handleInteraction(interaction);
    if (ytHandled) {
        return;
    }

    if (interaction.isModalSubmit()) {
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: 'Interactive controls are currently unavailable, sir.', ephemeral: true });
        }
        return;
    }

    if (!interaction.isButton()) {
        return;
    }

    // Help menu category buttons
    if (interaction.customId.startsWith('help_')) {
        const categoryKey = interaction.customId.replace('help_', '');
        const categories = {
            overview: {
                emoji: '\u{1F4CB}',
                title: 'Command Overview',
                description: 'Welcome to Jarvis Legacy Commands!\nSelect a category below to see commands.',
                fields: [
                    { name: '\u{1F3AE} Fun', value: '`*j help fun`', inline: true },
                    { name: '\u2699\uFE0F Utility', value: '`*j help utility`', inline: true }
                ]
            },
            fun: {
                emoji: '\u{1F3AE}',
                title: 'Fun Commands',
                description: 'Entertainment and social commands!',
                fields: [
                    { name: '\u{1F495} Social', value: '`/ship @u1 @u2` - Ship people', inline: false }
                ]
            },
            utility: {
                emoji: '\u2699\uFE0F',
                title: 'Utility Commands',
                description: 'Helpful utility commands',
                fields: [
                    { name: '\u{1F527} Tools', value: '`*j ping` - Bot latency\n`*j remind in <time> <msg>` - Set reminder\n`*j profile` - View profile', inline: false }
                ]
            }
        };

        const category = categories[categoryKey] || categories.overview;

        const embed = new EmbedBuilder()
            .setTitle(`${category.emoji} ${category.title}`)
            .setDescription(category.description)
            .setColor(0x3498db)
            .setFooter({ text: 'Use *j help <category> to view specific commands' });

        category.fields.forEach(f => embed.addFields(f));

        const row1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('help_overview')
                .setLabel('Overview')
                .setEmoji('\u{1F4CB}')
                .setStyle(categoryKey === 'overview' ? ButtonStyle.Primary : ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('help_fun')
                .setLabel('Fun')
                .setEmoji('\u{1F3AE}')
                .setStyle(categoryKey === 'fun' ? ButtonStyle.Primary : ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('help_utility')
                .setLabel('Utility')
                .setEmoji('\u2699\uFE0F')
                .setStyle(categoryKey === 'utility' ? ButtonStyle.Primary : ButtonStyle.Secondary)
        );

        try {
            await interaction.update({ embeds: [embed], components: [row1] });
        } catch {
            // Fallback if update fails
            await interaction.reply({ embeds: [embed], components: [row1], ephemeral: true });
        }
        return;
    }

    if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: 'Interactive controls are currently unavailable, sir.', ephemeral: true });
    }
}

module.exports = {
    handleFeaturesCommand,
    handleOptCommand,
    handleComponentInteraction
};

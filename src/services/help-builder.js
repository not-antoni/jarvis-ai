'use strict';

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { buildHelpCatalog } = require('../core/command-registry');
const { isFeatureGloballyEnabled, isFeatureEnabledForGuild } = require('../core/feature-flags');

const SUPPORT_SERVER_URL = 'https://discord.gg/ksXzuBtmK5';

function buildSupportLinkRow() {
    const supportButton = new ButtonBuilder()
        .setLabel('Join the Support Server')
        .setStyle(ButtonStyle.Link)
        .setURL(SUPPORT_SERVER_URL)
        .setEmoji('🤝');

    return new ActionRowBuilder().addComponents(supportButton);
}

function buildSupportEmbed(includeGuide = false) {
    const embed = new EmbedBuilder()
        .setTitle('Join Jarvis HQ ⚙️')
        .setDescription('Need help or want updates? Join the official Jarvis Support Server!')
        .setURL(SUPPORT_SERVER_URL)
        .setColor('#00BFFF');

    if (includeGuide) {
        embed
            .addFields(
                {
                    name: 'Core Systems',
                    value: [
                        '`/jarvis <prompt>` Ask Jarvis anything.',
                        '`/help` Quick reference & support invite.',
                        '`/invite` Share the support server banner.'
                    ].join('\n')
                },
                {
                    name: 'Personal Tools',
                    value: [
                        '`/profile show` Review your dossier.',
                        '`/profile set` Update preferences.',
                        '`/history` Review recent chats.',
                        '`/wakeword` Tune your summon phrase.'
                    ].join('\n')
                },
                {
                    name: 'Server Utilities',
                    value: [
                        '`/reactionrole` Configure reaction role panels.',
                        '`/automod` Manage blacklist & automod rules.',
                        '`/serverstats` Maintain live member counters.',
                        '`/memberlog` Customize join & leave messages.'
                    ].join('\n')
                },
                {
                    name: 'Power Tools',
                    value: [
                        '`/search` Pull live web results.',
                        '`/clip` Render a message as an image.',
                        '`/clear` Wipe conversations when needed.'
                    ].join('\n')
                }
            )
            .setFooter({ text: 'Use /invite any time to grab the support link for your team.' });
    } else {
        embed.setFooter({ text: 'Share this link so everyone can reach Jarvis HQ when needed.' });
    }

    return { embeds: [embed], components: [buildSupportLinkRow()] };
}

function buildHelpPayload(guildConfig = null) {
    const catalog = buildHelpCatalog();
    const embed = new EmbedBuilder()
        .setTitle('Jarvis Command Index')
        .setColor('#00BFFF')
        .setDescription(
            'Active slash commands for this server. Modules respect per-guild feature toggles.'
        );

    let visibleCategories = 0;

    for (const entry of catalog) {
        const { category, commands } = entry;
        const visible = commands.filter(command => {
            if (!command || !command.name) {
                return false;
            }

            if (command.feature && !isFeatureGloballyEnabled(command.feature, true)) {
                return false;
            }

            if (!command.feature || !guildConfig) {
                return true;
            }

            return isFeatureEnabledForGuild(command.feature, guildConfig, true);
        });

        if (!visible.length) {
            continue;
        }

        const lines = visible.map(command => {
            const label = command.name.startsWith('/') ? command.name : `/${command.name}`;
            return `• **${label}** — ${command.description}`;
        });

        let value = lines.join('\n');
        if (value.length > 1024) {
            value = `${value.slice(0, 1019)}…`;
        }

        embed.addFields({ name: category, value });
        visibleCategories += 1;
    }

    if (!visibleCategories) {
        embed
            .setDescription(
                'All modules are currently disabled. Use `/features` to enable systems for this guild.'
            )
            .setColor('#f59e0b');
    } else {
        embed.setFooter({ text: 'Use /invite to share the support server link.' });
    }

    return {
        embeds: [embed],
        components: [buildSupportLinkRow()]
    };
}

module.exports = { buildSupportEmbed, buildHelpPayload, buildSupportLinkRow, SUPPORT_SERVER_URL };

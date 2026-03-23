'use strict';

const { EmbedBuilder, PermissionsBitField } = require('discord.js');
const database = require('../database');
const automodUtils = require('./automod-utils');

/**
 * Extracted from DiscordHandlers.handleAutoModCommand (part-03 line 868 + part-04 lines 1-459).
 * All `this.*` references replaced with `handler` or helper calls.
 */
async function handleAutoModCommand(handler, interaction) {
    if (!interaction.guild) {
        await interaction.editReply('This command is only available within a server, sir.');
        return;
    }

    if (!database.isConnected) {
        await interaction.editReply('My database uplink is offline, sir. Auto moderation is unavailable at the moment.');
        return;
    }

    const { guild } = interaction;
    const { member } = interaction;
    const subcommand = interaction.options.getSubcommand();
    const subcommandGroup = interaction.options.getSubcommandGroup(false);
    const guildConfig = await handler.getGuildConfig(guild);

    const isModerator = await handler.isGuildModerator(member, guildConfig);
    if (!isModerator) {
        await interaction.editReply('Only the server owner or configured moderators may do that, sir.');
        return;
    }

    const me = guild.members.me || await guild.members.fetchMe();
    if (!me || !me.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
        await interaction.editReply('I require the "Manage Server" permission to configure auto moderation, sir.');
        return;
    }

    const storedRecord = await database.getAutoModConfig(guild.id);
    const { record, rules: cachedRules, mutated, missingRuleIds } = await automodUtils.prepareAutoModState(
        handler,
        guild,
        storedRecord
    );

    if (mutated) {
        await database.saveAutoModConfig(guild.id, record);
    }

    const replyWithError = async message => {
        await interaction.editReply(message);
    };

    if (subcommandGroup === 'filter') {
        if (subcommand === 'add') {
            const input = interaction.options.getString('words');
            const additions = automodUtils.parseKeywordInput(input);

            if (!additions.length) {
                await replyWithError('Please provide at least one word or phrase for the new filter, sir.');
                return;
            }

            const merged = automodUtils.mergeKeywords([], additions);
            if (!merged.length) {
                await replyWithError('I could not extract any valid keywords for that filter, sir.');
                return;
            }

            if (merged.length > handler.maxAutoModKeywordsPerRule) {
                await replyWithError(`Each filter may track up to ${handler.maxAutoModKeywordsPerRule} entries, sir.`);
                return;
            }

            const mergedSet = new Set(merged);
            const duplicate = (record.extraFilters || []).some(filter => {
                const normalized = automodUtils.mergeKeywords([], filter.keywords || []);
                if (normalized.length !== merged.length) {
                    return false;
                }
                return normalized.every(keyword => mergedSet.has(keyword));
            });

            if (duplicate) {
                await replyWithError('An additional filter already tracks those keywords, sir.');
                return;
            }

            if (!Array.isArray(record.extraFilters)) {
                record.extraFilters = [];
            }

            const filterName = automodUtils.generateAutoModFilterName(handler, record.extraFilters);
            const newFilter = {
                ruleId: null,
                keywords: merged,
                customMessage: record.customMessage,
                enabled: true,
                name: filterName,
                createdAt: new Date().toISOString()
            };

            try {
                await automodUtils.upsertExtraAutoModFilter(
                    handler,
                    guild,
                    newFilter,
                    record.customMessage || handler.defaultAutoModMessage,
                    true
                );

                record.extraFilters.push(newFilter);
                await database.saveAutoModConfig(guild.id, record);

                const activeFilters = record.extraFilters.filter(filter => filter.enabled).length;
                await interaction.editReply(
                    'Additional auto moderation filter deployed, sir. ' +
                    `You now have ${record.extraFilters.length} filter${record.extraFilters.length === 1 ? '' : 's'} ` +
                    `(${activeFilters} active).`
                );
            } catch (error) {
                console.error('Failed to add additional auto moderation filter:', error?.cause || error);
                await replyWithError(automodUtils.getAutoModErrorMessage(
                    handler,
                    error,
                    'I could not create that additional auto moderation filter, sir.'
                ));
            }
            return;
        }

        await replyWithError('I am not certain how to handle that auto moderation filter request, sir.');
        return;
    }

    if (subcommand === 'status') {
        const enabledState = cachedRules.length
            ? cachedRules.every(rule => Boolean(rule.enabled))
            : Boolean(record.enabled);

        let footerText = 'Auto moderation has not been deployed yet.';
        if (cachedRules.length) {
            footerText = `Managing ${cachedRules.length} auto moderation rule${cachedRules.length === 1 ? '' : 's'}.`;
        } else if (missingRuleIds.length) {
            const preview = missingRuleIds.slice(0, 2).join(', ');
            const suffix = missingRuleIds.length > 2 ? ', …' : '';
            footerText = `Stored rule${missingRuleIds.length === 1 ? '' : 's'} ${preview}${suffix} ${missingRuleIds.length === 1 ? 'is' : 'are'} no longer accessible.`;
        }

        const extraFilters = Array.isArray(record.extraFilters) ? record.extraFilters : [];
        const activeExtras = extraFilters.filter(filter => filter.enabled).length;

        const embed = new EmbedBuilder()
            .setTitle('Auto moderation status')
            .setColor(0x5865f2)
            .addFields(
                { name: 'Enabled', value: enabledState ? 'Yes' : 'No', inline: true },
                { name: 'Tracked phrases', value: `${record.keywords.length}`, inline: true },
                { name: 'Additional filters', value: extraFilters.length ? `${activeExtras}/${extraFilters.length} active` : 'None', inline: true }
            )
            .setFooter({ text: footerText });

        await interaction.editReply({ embeds: [embed] });
        return;
    }

    if (subcommand === 'list') {
        if (!record.keywords.length) {
            await interaction.editReply('No blacklist entries are currently configured, sir.');
            return;
        }

        const chunkSize = 20;
        const chunks = [];
        for (let index = 0; index < record.keywords.length; index += chunkSize) {
            chunks.push(record.keywords.slice(index, index + chunkSize));
        }

        const embed = new EmbedBuilder()
            .setTitle('Blacklisted phrases')
            .setColor(0x5865f2);

        chunks.slice(0, 5).forEach((chunk, index) => {
            const value = chunk.map(word => `• ${word}`).join('\n');
            embed.addFields({
                name: `Batch ${index + 1}`,
                value: value.length > 1024 ? `${value.slice(0, 1021)}...` : value
            });
        });

        if (chunks.length > 5) {
            embed.setFooter({ text: `Showing ${Math.min(100, record.keywords.length)} of ${record.keywords.length} entries.` });
        }

        await interaction.editReply({ embeds: [embed] });
        return;
    }

    if (subcommand === 'enable') {
        if (!record.keywords.length) {
            await replyWithError('Please add blacklisted words before enabling auto moderation, sir.');
            return;
        }

        try {
            const { rules, keywords, ruleIds } = await automodUtils.syncAutoModRules(
                handler,
                guild,
                record.keywords,
                record.customMessage,
                record.ruleIds,
                true
            );

            record.ruleIds = ruleIds;
            record.keywords = keywords;
            record.enabled = rules.every(rule => Boolean(rule.enabled));
            try {
                await automodUtils.enableExtraAutoModFilters(handler, guild, record);
            } catch (error) {
                console.error('Failed to enable additional auto moderation filters:', error?.cause || error);
                await replyWithError(automodUtils.getAutoModErrorMessage(
                    handler,
                    error,
                    'I could not enable the additional auto moderation filters, sir.'
                ));
                return;
            }

            await database.saveAutoModConfig(guild.id, record);
            const statusLine = record.enabled
                ? 'Discord will now block the configured phrases.'
                : 'The rules were updated, but Discord left them disabled.';
            await interaction.editReply(`Auto moderation ${record.enabled ? 'engaged' : 'updated'}, sir. ${statusLine}`);
        } catch (error) {
            console.error('Failed to enable auto moderation:', error?.cause || error);
            await replyWithError(automodUtils.getAutoModErrorMessage(
                handler,
                error,
                'I could not enable auto moderation, sir. Please ensure I have the AutoMod permission.'
            ));
        }
        return;
    }

    if (subcommand === 'disable') {
        try {
            const disabled = await automodUtils.disableAutoModRule(guild, record.ruleIds);
            if (!disabled) {
                record.ruleIds = [];
            }
        } catch (error) {
            console.error('Failed to disable auto moderation rule:', error?.cause || error);
            await replyWithError(automodUtils.getAutoModErrorMessage(
                handler,
                error,
                'I could not disable the auto moderation rule, sir.'
            ));
            return;
        }

        try {
            await automodUtils.disableExtraAutoModFilters(handler, guild, record);
        } catch (error) {
            console.error('Failed to disable additional auto moderation filters:', error?.cause || error);
            await replyWithError(automodUtils.getAutoModErrorMessage(
                handler,
                error,
                'I could not disable the additional auto moderation filters, sir.'
            ));
            return;
        }

        record.enabled = false;
        await database.saveAutoModConfig(guild.id, record);
        await interaction.editReply('Auto moderation is now offline for this server, sir.');
        return;
    }

    if (subcommand === 'clear') {
        try {
            const disabled = await automodUtils.disableAutoModRule(guild, record.ruleIds);
            if (!disabled) {
                record.ruleIds = [];
            }
        } catch (error) {
            console.error('Failed to disable auto moderation while clearing:', error?.cause || error);
        }

        try {
            await automodUtils.disableExtraAutoModFilters(handler, guild, record);
        } catch (error) {
            console.error('Failed to disable additional auto moderation filters while clearing:', error?.cause || error);
        }

        record.keywords = [];
        record.enabled = false;
        record.ruleIds = [];
        record.extraFilters = [];
        await database.saveAutoModConfig(guild.id, record);
        await interaction.editReply('Blacklist cleared and auto moderation disabled, sir.');
        return;
    }

    if (subcommand === 'setmessage') {
        const message = interaction.options.getString('message');
        if (!message || !message.trim()) {
            await replyWithError('Please provide a custom message, sir.');
            return;
        }

        record.customMessage = message.trim().slice(0, 150);

        if (record.enabled && record.keywords.length) {
            try {
                const { rules, keywords, ruleIds } = await automodUtils.syncAutoModRules(
                    handler,
                    guild,
                    record.keywords,
                    record.customMessage,
                    record.ruleIds,
                    record.enabled
                );
                record.ruleIds = ruleIds;
                record.enabled = rules.every(rule => Boolean(rule.enabled));
                record.keywords = keywords;
            } catch (error) {
                console.error('Failed to update auto moderation message:', error?.cause || error);
                await replyWithError(automodUtils.getAutoModErrorMessage(
                    handler,
                    error,
                    'I could not update the auto moderation message, sir.'
                ));
                return;
            }
        }

        for (const filter of record.extraFilters) {
            filter.customMessage = record.customMessage;
        }

        try {
            await automodUtils.resyncEnabledExtraAutoModFilters(handler, guild, record);
        } catch (error) {
            console.error('Failed to update additional auto moderation filters with new message:', error?.cause || error);
            await replyWithError(automodUtils.getAutoModErrorMessage(
                handler,
                error,
                'I could not update the additional auto moderation filters, sir.'
            ));
            return;
        }

        await database.saveAutoModConfig(guild.id, record);
        await interaction.editReply('Custom enforcement message updated, sir.');
        return;
    }

    if (subcommand === 'add') {
        const input = interaction.options.getString('words');
        const additions = automodUtils.parseKeywordInput(input);

        if (!additions.length) {
            await replyWithError('Please provide at least one word or phrase to blacklist, sir.');
            return;
        }

        const merged = automodUtils.mergeKeywords(record.keywords, additions);
        if (merged.length === record.keywords.length) {
            await replyWithError('Those words were already on the blacklist, sir.');
            return;
        }

        const previousCount = record.keywords.length;
        try {
            const { rules, keywords, ruleIds } = await automodUtils.syncAutoModRules(
                handler,
                guild,
                merged,
                record.customMessage,
                record.ruleIds,
                true
            );

            record.ruleIds = ruleIds;
            record.keywords = keywords;
            record.enabled = rules.every(rule => Boolean(rule.enabled));
            await database.saveAutoModConfig(guild.id, record);
            const addedCount = keywords.length - previousCount;
            const statusLine = record.enabled
                ? 'Auto moderation is active, sir.'
                : 'Auto moderation is currently disabled, sir.';
            await interaction.editReply(`Blacklist updated with ${addedCount} new entr${addedCount === 1 ? 'y' : 'ies'}. ${statusLine}`);
        } catch (error) {
            console.error('Failed to add auto moderation keywords:', error?.cause || error);
            await replyWithError(automodUtils.getAutoModErrorMessage(
                handler,
                error,
                'I could not update the auto moderation rule, sir.'
            ));
        }
        return;
    }

    if (subcommand === 'remove') {
        const input = interaction.options.getString('words');
        const removals = automodUtils.parseKeywordInput(input);

        if (!removals.length) {
            await replyWithError('Please specify the words to remove from the blacklist, sir.');
            return;
        }

        const removalSet = new Set(removals.map(word => automodUtils.normalizeKeyword(word)));
        const remaining = (record.keywords || []).filter(keyword => !removalSet.has(automodUtils.normalizeKeyword(keyword)));

        if (remaining.length === record.keywords.length) {
            await replyWithError('None of those words were on the blacklist, sir.');
            return;
        }

        record.keywords = remaining;

        if (record.keywords.length) {
            try {
                const { rules, keywords, ruleIds } = await automodUtils.syncAutoModRules(
                    handler,
                    guild,
                    record.keywords,
                    record.customMessage,
                    record.ruleIds,
                    record.enabled
                );

                record.ruleIds = ruleIds;
                record.keywords = keywords;
                record.enabled = rules.every(rule => Boolean(rule.enabled));
            } catch (error) {
                console.error('Failed to update auto moderation keywords after removal:', error?.cause || error);
                await replyWithError(automodUtils.getAutoModErrorMessage(
                    handler,
                    error,
                    'I could not update the auto moderation rule after removal, sir.'
                ));
                return;
            }
        } else {
            try {
                const disabled = await automodUtils.disableAutoModRule(guild, record.ruleIds);
                if (!disabled) {
                    record.ruleIds = [];
                }
            } catch (error) {
                console.error('Failed to disable auto moderation after removal:', error?.cause || error);
            }
            record.ruleIds = [];
            record.enabled = false;
        }

        await database.saveAutoModConfig(guild.id, record);
        await interaction.editReply('Blacklist updated, sir.');
        return;
    }

    if (subcommand === 'import') {
        const attachment = interaction.options.getAttachment('file');
        const shouldReplace = interaction.options.getBoolean('replace') || false;

        if (!attachment) {
            await replyWithError('Please attach a text file containing the blacklist, sir.');
            return;
        }

        if (attachment.size > 256000) {
            await replyWithError('That file is a bit much, sir. Please provide a text file under 250KB.');
            return;
        }

        let text = '';
        try {
            const response = await fetch(attachment.url);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            text = await response.text();
        } catch (error) {
            console.error('Failed to download blacklist file:', error);
            await replyWithError('I could not download that file, sir.');
            return;
        }

        const imported = automodUtils.parseKeywordInput(text);
        if (!imported.length) {
            await replyWithError('That file did not contain any usable entries, sir.');
            return;
        }

        const combined = shouldReplace
            ? automodUtils.mergeKeywords([], imported)
            : automodUtils.mergeKeywords(record.keywords, imported);

        if (!combined.length) {
            await replyWithError('I could not extract any valid keywords from that file, sir.');
            return;
        }

        try {
            const { rules, keywords, ruleIds } = await automodUtils.syncAutoModRules(
                handler,
                guild,
                combined,
                record.customMessage,
                record.ruleIds,
                true
            );

            record.ruleIds = ruleIds;
            record.keywords = keywords;
            record.enabled = rules.every(rule => Boolean(rule.enabled));
            await database.saveAutoModConfig(guild.id, record);
            const statusLine = record.enabled
                ? 'Auto moderation is active, sir.'
                : 'Auto moderation is currently disabled, sir.';
            await interaction.editReply(`Blacklist now tracks ${keywords.length} entr${keywords.length === 1 ? 'y' : 'ies'}. ${statusLine}`);
        } catch (error) {
            console.error('Failed to import auto moderation keywords:', error?.cause || error);
            await replyWithError(automodUtils.getAutoModErrorMessage(
                handler,
                error,
                'I could not apply that blacklist to Discord, sir.'
            ));
        }
        return;
    }

    await interaction.editReply('That subcommand is not recognized, sir.');
}

module.exports = { handleAutoModCommand };

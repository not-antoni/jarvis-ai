
        const me = guild.members.me || await guild.members.fetchMe();
        if (!me || !me.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
            await interaction.editReply('I require the "Manage Server" permission to configure auto moderation, sir.');
            return;
        }

        const storedRecord = await database.getAutoModConfig(guild.id);
        const { record, rules: cachedRules, mutated, missingRuleIds } = await this.prepareAutoModState(guild, storedRecord);

        if (mutated) {
            await database.saveAutoModConfig(guild.id, record);
        }

        const replyWithError = async message => {
            await interaction.editReply(message);
        };

        if (subcommandGroup === 'filter') {
            if (subcommand === 'add') {
                const input = interaction.options.getString('words');
                const additions = this.parseKeywordInput(input);

                if (!additions.length) {
                    await replyWithError('Please provide at least one word or phrase for the new filter, sir.');
                    return;
                }

                const merged = this.mergeKeywords([], additions);
                if (!merged.length) {
                    await replyWithError('I could not extract any valid keywords for that filter, sir.');
                    return;
                }

                if (merged.length > this.maxAutoModKeywordsPerRule) {
                    await replyWithError(`Each filter may track up to ${this.maxAutoModKeywordsPerRule} entries, sir.`);
                    return;
                }

                const mergedSet = new Set(merged);
                const duplicate = (record.extraFilters || []).some(filter => {
                    const normalized = this.mergeKeywords([], filter.keywords || []);
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

                const filterName = this.generateAutoModFilterName(record.extraFilters);
                const newFilter = {
                    ruleId: null,
                    keywords: merged,
                    customMessage: record.customMessage,
                    enabled: true,
                    name: filterName,
                    createdAt: new Date().toISOString()
                };

                try {
                    await this.upsertExtraAutoModFilter(
                        guild,
                        newFilter,
                        record.customMessage || this.defaultAutoModMessage,
                        true
                    );

                    record.extraFilters.push(newFilter);
                    await database.saveAutoModConfig(guild.id, record);

                    const activeFilters = record.extraFilters.filter(filter => filter.enabled).length;
                    await interaction.editReply(
                        `Additional auto moderation filter deployed, sir. ` +
                        `You now have ${record.extraFilters.length} filter${record.extraFilters.length === 1 ? '' : 's'} ` +
                        `(${activeFilters} active).`
                    );
                } catch (error) {
                    console.error('Failed to add additional auto moderation filter:', error?.cause || error);
                    await replyWithError(this.getAutoModErrorMessage(error, 'I could not create that additional auto moderation filter, sir.'));
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
                const { rules, keywords, ruleIds } = await this.syncAutoModRules(
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
                    await this.enableExtraAutoModFilters(guild, record);
                } catch (error) {
                    console.error('Failed to enable additional auto moderation filters:', error?.cause || error);
                    await replyWithError(this.getAutoModErrorMessage(error, 'I could not enable the additional auto moderation filters, sir.'));
                    return;
                }

                await database.saveAutoModConfig(guild.id, record);
                const statusLine = record.enabled
                    ? 'Discord will now block the configured phrases.'
                    : 'The rules were updated, but Discord left them disabled.';
                await interaction.editReply(`Auto moderation ${record.enabled ? 'engaged' : 'updated'}, sir. ${statusLine}`);
            } catch (error) {
                console.error('Failed to enable auto moderation:', error?.cause || error);
                await replyWithError(this.getAutoModErrorMessage(
                    error,
                    'I could not enable auto moderation, sir. Please ensure I have the AutoMod permission.'
                ));
            }
            return;
        }

        if (subcommand === 'disable') {
            try {
                const disabled = await this.disableAutoModRule(guild, record.ruleIds);
                if (!disabled) {
                    record.ruleIds = [];
                }
            } catch (error) {
                console.error('Failed to disable auto moderation rule:', error?.cause || error);
                await replyWithError(this.getAutoModErrorMessage(error, 'I could not disable the auto moderation rule, sir.'));
                return;
            }

            try {
                await this.disableExtraAutoModFilters(guild, record);
            } catch (error) {
                console.error('Failed to disable additional auto moderation filters:', error?.cause || error);
                await replyWithError(this.getAutoModErrorMessage(error, 'I could not disable the additional auto moderation filters, sir.'));
                return;
            }

            record.enabled = false;
            await database.saveAutoModConfig(guild.id, record);
            await interaction.editReply('Auto moderation is now offline for this server, sir.');
            return;
        }

        if (subcommand === 'clear') {
            try {
                const disabled = await this.disableAutoModRule(guild, record.ruleIds);
                if (!disabled) {
                    record.ruleIds = [];
                }
            } catch (error) {
                console.error('Failed to disable auto moderation while clearing:', error?.cause || error);
            }

            try {
                await this.disableExtraAutoModFilters(guild, record);
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
                    const { rules, keywords, ruleIds } = await this.syncAutoModRules(
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
                    await replyWithError(this.getAutoModErrorMessage(error, 'I could not update the auto moderation message, sir.'));
                    return;
                }
            }

            for (const filter of record.extraFilters) {
                filter.customMessage = record.customMessage;
            }

            try {
                await this.resyncEnabledExtraAutoModFilters(guild, record);
            } catch (error) {
                console.error('Failed to update additional auto moderation filters with new message:', error?.cause || error);
                await replyWithError(this.getAutoModErrorMessage(error, 'I could not update the additional auto moderation filters, sir.'));
                return;
            }

            await database.saveAutoModConfig(guild.id, record);
            await interaction.editReply('Custom enforcement message updated, sir.');
            return;
        }

        if (subcommand === 'add') {
            const input = interaction.options.getString('words');
            const additions = this.parseKeywordInput(input);

            if (!additions.length) {
                await replyWithError('Please provide at least one word or phrase to blacklist, sir.');
                return;
            }

            const merged = this.mergeKeywords(record.keywords, additions);
            if (merged.length === record.keywords.length) {
                await replyWithError('Those words were already on the blacklist, sir.');
                return;
            }

            const previousCount = record.keywords.length;
            try {
                const { rules, keywords, ruleIds } = await this.syncAutoModRules(
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
                await replyWithError(this.getAutoModErrorMessage(error, 'I could not update the auto moderation rule, sir.'));
            }
            return;
        }

        if (subcommand === 'remove') {
            const input = interaction.options.getString('words');
            const removals = this.parseKeywordInput(input);

            if (!removals.length) {
                await replyWithError('Please specify the words to remove from the blacklist, sir.');
                return;
            }

            const removalSet = new Set(removals.map(word => this.normalizeKeyword(word)));
            const remaining = (record.keywords || []).filter(keyword => !removalSet.has(this.normalizeKeyword(keyword)));

            if (remaining.length === record.keywords.length) {
                await replyWithError('None of those words were on the blacklist, sir.');
                return;
            }

            record.keywords = remaining;

            if (record.keywords.length) {
                try {
                    const { rules, keywords, ruleIds } = await this.syncAutoModRules(
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
                    await replyWithError(this.getAutoModErrorMessage(error, 'I could not update the auto moderation rule after removal, sir.'));
                    return;
                }
            } else {
                try {
                    const disabled = await this.disableAutoModRule(guild, record.ruleIds);
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

            const imported = this.parseKeywordInput(text);
            if (!imported.length) {
                await replyWithError('That file did not contain any usable entries, sir.');
                return;
            }

            const combined = shouldReplace
                ? this.mergeKeywords([], imported)
                : this.mergeKeywords(record.keywords, imported);

            if (!combined.length) {
                await replyWithError('I could not extract any valid keywords from that file, sir.');
                return;
            }

            try {
                const { rules, keywords, ruleIds } = await this.syncAutoModRules(
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
                await replyWithError(this.getAutoModErrorMessage(error, 'I could not apply that blacklist to Discord, sir.'));
            }
            return;
        }

        await interaction.editReply('That subcommand is not recognized, sir.');
    }

    async handleReactionRoleCommand(interaction) {
        if (!interaction.guild) {
            await interaction.editReply('This command is only available within a server, sir.');
            return;
        }

        if (!database.isConnected) {
            await interaction.editReply('My database uplink is offline, sir. Reaction roles are unavailable at the moment.');
            return;
        }

        const guild = interaction.guild;
        const member = interaction.member;
        const subcommand = interaction.options.getSubcommand();
        const guildConfig = await this.getGuildConfig(guild);

        if (subcommand === 'setmods') {
            const isOwner = member.id === guild.ownerId;
            const hasAdmin = member.permissions?.has(PermissionsBitField.Flags.Administrator);
            if (!isOwner && !hasAdmin) {
                await interaction.editReply('Only the server owner or administrators may adjust moderator roles, sir.');
                return;
            }
        } else {
            const isModerator = await this.isGuildModerator(member, guildConfig);
            if (!isModerator) {
                await interaction.editReply('Only the server owner or configured moderators may do that, sir.');
                return;
            }
        }

        if (subcommand === 'create') {
            const channel = interaction.options.getChannel('channel');
            const pairsInput = interaction.options.getString('pairs');
            const title = interaction.options.getString('title') || 'Select your roles';
            const description = interaction.options.getString('description') || 'React with the options below to toggle roles, sir.';

            if (!channel || channel.guildId !== guild.id) {
                await interaction.editReply('I could not access that channel, sir.');
                return;
            }

            const allowedTypes = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement]);
            if (!channel.isTextBased() || !allowedTypes.has(channel.type)) {
                await interaction.editReply('Reaction roles require a standard text channel or announcement channel, sir.');
                return;
            }

            const me = guild.members.me || await guild.members.fetchMe();
            if (!me) {
                await interaction.editReply('I could not verify my permissions in that server, sir.');
                return;
            }

            if (!me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
                await interaction.editReply('I require the "Manage Roles" permission to do that, sir.');
                return;
            }

            const channelPermissions = channel.permissionsFor(me);
            if (!channelPermissions || !channelPermissions.has(PermissionsBitField.Flags.ViewChannel) || !channelPermissions.has(PermissionsBitField.Flags.SendMessages) || !channelPermissions.has(PermissionsBitField.Flags.AddReactions) || !channelPermissions.has(PermissionsBitField.Flags.EmbedLinks)) {
                await interaction.editReply('I need permission to send messages, add reactions, and embed links in that channel, sir.');
                return;
            }

            let options;
            try {
                options = await this.parseReactionRolePairs(pairsInput, guild);
            } catch (error) {
                await interaction.editReply(error.message || 'Those role mappings confused me, sir.');
                return;
            }

            const unusableRole = options.find(option => {
                const role = guild.roles.cache.get(option.roleId);
                if (!role) {
                    return false;
                }
                return me.roles.highest.comparePositionTo(role) <= 0;
            });

            if (unusableRole) {
                await interaction.editReply(`My highest role must be above ${guild.roles.cache.get(unusableRole.roleId)?.name || 'that role'}, sir.`);
                return;
            }

            const optionLines = options.map(option => `${option.display} — <@&${option.roleId}>`).join('\n');
            const embedDescription = description ? `${description}\n\n${optionLines}` : optionLines;

            const embed = new EmbedBuilder()
                .setTitle(title)
                .setDescription(embedDescription)
                .setColor(0x5865f2)
                .setFooter({ text: 'React to add or remove roles.' });

            let sentMessage;
            try {
                sentMessage = await channel.send({ embeds: [embed] });
            } catch (error) {
                console.error('Failed to send reaction role message:', error);
                await interaction.editReply('I could not send the panel to that channel, sir.');
                return;
            }

            try {
                for (const option of options) {
                    await sentMessage.react(option.rawEmoji);
                }
            } catch (error) {
                console.error('Failed to add reactions for reaction role panel:', error);
                await interaction.editReply('One of those emojis could not be used, sir. I removed the panel.');
                try {
                    await sentMessage.delete();
                } catch (deleteError) {
                    console.warn('Failed to delete reaction role message after reaction failure:', deleteError);
                }
                return;
            }

            try {
                await database.saveReactionRoleMessage({
                    guildId: guild.id,
                    channelId: channel.id,
                    messageId: sentMessage.id,
                    options,
                    createdBy: interaction.user.id,
                    title,
                    description,
                    createdAt: new Date()
                });
            } catch (error) {
                console.error('Failed to persist reaction role configuration:', error);
                await interaction.editReply('I could not save that configuration, sir.');
                try {
                    await sentMessage.delete();
                } catch (cleanupError) {
                    console.warn('Failed to delete reaction role panel after persistence failure:', cleanupError);
                }
                return;
            }

            const messageUrl = sentMessage.url || `https://discord.com/channels/${guild.id}/${channel.id}/${sentMessage.id}`;
            await interaction.editReply(`Reaction role panel deployed in ${channel}, sir. [Jump to message](${messageUrl}).`);
            return;
        }

        if (subcommand === 'remove') {
            const messageInput = interaction.options.getString('message');
            const idMatch = messageInput?.match(/(\d{17,20})$/);
            const messageId = idMatch ? idMatch[1] : messageInput;

            if (!messageId) {
                await interaction.editReply('Please provide a valid message ID or link, sir.');
                return;
            }

            let record;
            try {
                record = await database.getReactionRole(messageId);
            } catch (error) {
                console.error('Failed to load reaction role message:', error);
            }

            if (!record || record.guildId !== guild.id) {
                await interaction.editReply('I do not have a reaction role panel for that message, sir.');
                return;
            }

            try {
                await database.deleteReactionRole(record.messageId);
            } catch (error) {
                console.error('Failed to delete reaction role configuration:', error);
                await interaction.editReply('I could not remove that configuration from the database, sir.');
                return;
            }

            let messageDeleted = false;
            try {
                const targetChannel = await guild.channels.fetch(record.channelId);
                const me = guild.members.me || await guild.members.fetchMe();
                if (targetChannel?.isTextBased() && me) {
                    const channelPerms = targetChannel.permissionsFor(me);
                    if (channelPerms?.has(PermissionsBitField.Flags.ManageMessages)) {
                        const panelMessage = await targetChannel.messages.fetch(record.messageId);
                        await panelMessage.delete();
                        messageDeleted = true;
                    }
                }
            } catch (error) {
                console.warn('Failed to delete reaction role message:', error);
            }

            await interaction.editReply(messageDeleted
                ? 'Reaction role panel removed and the message deleted, sir.'
                : 'Reaction role panel removed from my registry, sir.');
            return;
        }

        if (subcommand === 'list') {
            let records = [];
            try {
                records = await database.getReactionRolesForGuild(guild.id);
            } catch (error) {
                console.error('Failed to list reaction roles:', error);
                await interaction.editReply('I could not retrieve the current configurations, sir.');
                return;
            }

            if (!records || records.length === 0) {
                await interaction.editReply('No reaction role panels are currently configured, sir.');
                return;
            }

            const embed = new EmbedBuilder()
                .setTitle('Active reaction role panels')
                .setColor(0x5865f2);

            const limitedRecords = records.slice(0, 25);
            for (let index = 0; index < limitedRecords.length; index++) {
                const record = limitedRecords[index];
                const url = `https://discord.com/channels/${guild.id}/${record.channelId}/${record.messageId}`;
                const roleLines = (record.options || [])
                    .map(option => `${option.display} → <@&${option.roleId}>`)
                    .join('\n') || 'No roles recorded.';

                const value = `${guild.channels.cache.get(record.channelId) ? `<#${record.channelId}>` : 'Channel missing'} • [Jump to message](${url})\n${roleLines}`;

                embed.addFields({
                    name: `Panel ${index + 1}`,
                    value: value.length > 1024 ? `${value.slice(0, 1019)}...` : value
                });
            }

            if (records.length > limitedRecords.length) {
                embed.setFooter({ text: `Showing ${limitedRecords.length} of ${records.length} panels.` });
            }

            await interaction.editReply({ embeds: [embed] });
            return;
        }

        if (subcommand === 'setmods') {
            const shouldClear = interaction.options.getBoolean('clear') || false;
            const roleIds = [];
            for (let index = 1; index <= 5; index++) {
                const role = interaction.options.getRole(`role${index}`);
                if (role && !roleIds.includes(role.id)) {
                    roleIds.push(role.id);
                }
            }

            if (!shouldClear && roleIds.length === 0) {
                await interaction.editReply('Please provide at least one role or enable the clear option, sir.');
                return;
            }

            try {
                const updated = await database.setGuildModeratorRoles(guild.id, shouldClear ? [] : roleIds, guild.ownerId);
                const summary = updated?.moderatorRoleIds?.length
                    ? updated.moderatorRoleIds.map(roleId => `<@&${roleId}>`).join(', ')
                    : 'Only the server owner may configure reaction roles.';

                await interaction.editReply(shouldClear
                    ? 'Moderator roles cleared, sir. Only the owner retains access.'
                    : `Moderator roles updated, sir: ${summary}`);
            } catch (error) {
                console.error('Failed to update moderator roles:', error);
                await interaction.editReply('I could not adjust the moderator roles, sir.');
            }
            return;
        }

        await interaction.editReply('I do not recognize that subcommand, sir.');
    }

    async handleReactionAdd(reaction, user) {
        if (!database.isConnected || !reaction || !user || user.bot) {
            return;
        }

        try {
            if (reaction.partial) {
                try {
                    await reaction.fetch();
                } catch (error) {
                    console.warn('Failed to fetch partial reaction (add):', error);
                }
            }

            if (reaction.message?.partial) {
                try {
                    await reaction.message.fetch();
                } catch (error) {
                    console.warn('Failed to fetch partial message for reaction add:', error);
                }
            }

            const context = await this.resolveReactionRoleContext(reaction, user);
            if (!context) {
                return;
            }

            if (context.member.roles.cache.has(context.role.id)) {
                return;
            }

            await context.member.roles.add(context.role, 'Reaction role assignment');
        } catch (error) {
            console.error('Failed to handle reaction role assignment:', error);
        }
    }

    async handleReactionRemove(reaction, user) {
        if (!database.isConnected || !reaction || !user || user.bot) {
            return;
        }

        try {
            if (reaction.partial) {
                try {
                    await reaction.fetch();
                } catch (error) {
                    console.warn('Failed to fetch partial reaction (remove):', error);
                }
            }

            if (reaction.message?.partial) {
                try {
                    await reaction.message.fetch();
                } catch (error) {
                    console.warn('Failed to fetch partial message for reaction remove:', error);
                }
            }

            const context = await this.resolveReactionRoleContext(reaction, user);
            if (!context) {
                return;
            }

            if (!context.member.roles.cache.has(context.role.id)) {
                return;
            }

            await context.member.roles.remove(context.role, 'Reaction role removal');
        } catch (error) {
            console.error('Failed to handle reaction role removal:', error);
        }
    }

    async handleTrackedMessageDelete(message) {
        if (!database.isConnected || !message?.id) {
            return;
        }

        try {
            const record = await database.getReactionRole(message.id);
            if (!record) {
                return;
            }

            await database.deleteReactionRole(message.id);
        } catch (error) {
            console.error('Failed to clean up deleted reaction role message:', error);
        }
    }

    async handleSlashCommandClip(interaction) {
        try {
            await interaction.deferReply({ ephemeral: false });
            
            // Get the message ID from the slash command
            const messageId = interaction.options.getString("message_id");
            
            if (!messageId) {
                await interaction.editReply("Please provide a message ID, sir.");
                return true;
            }

			// Fetch the message by ID (search across accessible channels)
			let targetMessage = await this.findMessageAcrossChannels(interaction, messageId);
			if (!targetMessage) {
				await interaction.editReply("Could not find that message, sir. I searched this channel and others I can access.");
				return true;
			}

			// Debug logging for timestamps
			console.log('Slash command timestamp debug:', {
				slashCommandTime: interaction.createdAt.toLocaleTimeString(),
				targetMessageTime: targetMessage.createdAt.toLocaleTimeString(),
				targetMessageTimestamp: targetMessage.createdTimestamp,
				interactionTimestamp: interaction.createdTimestamp
			});
            
            // All content types are now supported
            // No need to check for images or emojis anymore
            
            // Get server-specific avatar (guild avatar) or fallback to global avatar
            // Discord allows users to set unique avatars per server - this gets the server-specific one
            // If no server avatar is set, falls back to the user's global avatar
            // Using Discord's proper avatar URL structure: https://cdn.discordapp.com/avatars/{user_id}/{avatar_hash}.png
            const avatarUrl = targetMessage.member?.avatarURL({ 
                extension: 'png', 
                size: 128,
                forceStatic: false // Allow animated avatars
            }) || targetMessage.author.displayAvatarURL({ 
                extension: 'png', 
                size: 128,
                forceStatic: false // Allow animated avatars
            });
            
            // Get user's role color
            let roleColor = '#ff6b6b'; // Default red
            try {
                if (interaction.guild && targetMessage.member) {
                    roleColor = this.getUserRoleColor(targetMessage.member);
                }
            } catch (error) {
                console.warn('Failed to get role color for slash command:', error);
            }
            
            // Get display name (sanitized for rendering)
            const displayName = this.getSafeDisplayName(targetMessage.member, targetMessage.author);
            
            const imageBuffer = await this.createClipImage(
                targetMessage.content,
                displayName,
                avatarUrl,
                targetMessage.author.bot,
                roleColor,
                interaction.guild,
                interaction.client,
                targetMessage, // Pass the entire message object
                targetMessage.author,
                targetMessage.attachments
            );
            
            // Create attachment
            const attachment = new AttachmentBuilder(imageBuffer, { name: 'clipped.png' });
            
            // Send the image with "clipped, sir." message
            await interaction.editReply({ 
                content: 'clipped, sir.', 
                files: [attachment] 
            });
            
            return true; // Indicate we handled the command
        } catch (error) {
            console.error('Error handling slash clip command:', error);
            try {
                await interaction.editReply("Failed to clip message, sir. Technical difficulties.");
            } catch (editError) {
                console.error("Failed to send error reply:", editError);
            }
            return true;
        }
    }

    async handleRankCommand(interaction) {
        const guild = interaction.guild;

        if (!guild) {
            await interaction.editReply('This command must be used inside a server, sir.');
            return;
        }

        const levelingAvailable = await this.isFeatureActive('leveling', guild);
        if (!levelingAvailable) {
            await interaction.editReply('Leveling is disabled for this server, sir.');
            return;
        }

        const targetUser = interaction.options.getUser('user') || interaction.user;
        let member = null;

        try {
            member = await guild.members.fetch(targetUser.id);
        } catch (error) {
            console.warn('Failed to fetch member for rank command:', error);
        }

        if (!member) {
            await interaction.editReply('I could not locate that member, sir.');
            return;
        }

        const rankData = await this.leveling.getUserRank(guild.id, member.id);
        if (!rankData) {
            await interaction.editReply(`${member.displayName || member.user.username} has not accumulated any XP yet, sir.`);
            return;
        }

        let buffer = null;
        try {
            buffer = await this.leveling.renderRankCard({
                member,
                document: rankData.document,
                rank: rankData.rank,
                progress: rankData.progress
            });
        } catch (error) {
            console.error('Failed to render rank card:', error);
        }

        if (buffer) {
            await interaction.editReply({ files: [{ attachment: buffer, name: 'rank.png' }] });
            return;
        }

        const embed = new EmbedBuilder()
            .setTitle(`${member.displayName || member.user.username}`)
            .setColor(0x5865f2)
            .setThumbnail(member.displayAvatarURL({ extension: 'png', size: 256 }))
            .addFields(
                { name: 'Rank', value: `#${rankData.rank}`, inline: true },
                { name: 'Level', value: `${rankData.progress.level}`, inline: true },
                { name: 'Total XP', value: `${rankData.document.xp.toLocaleString()}`, inline: true }
            );

        const xpIntoLevel = Math.floor(rankData.progress.xpIntoLevel);
        const xpForNext = Math.floor(rankData.progress.xpForNext);
        const progressPercent = (Math.max(0, Math.min(1, rankData.progress.progress)) * 100).toFixed(1);
        embed.setDescription(`Progress to next level: **${progressPercent}%**
${xpIntoLevel.toLocaleString()} / ${xpForNext.toLocaleString()} XP`);

        await interaction.editReply({ embeds: [embed] });
    }

    async handleLeaderboardCommand(interaction) {
        const guild = interaction.guild;

        if (!guild) {
            await interaction.editReply('This command must be used inside a server, sir.');
            return;
        }

        const levelingAvailable = await this.isFeatureActive('leveling', guild);
        if (!levelingAvailable) {
            await interaction.editReply('Leveling is disabled for this server, sir.');
            return;
        }

        const page = interaction.options.getInteger('page') || 1;
        const leaderboard = await this.leveling.getLeaderboard(guild.id, { page, pageSize: 10 });

        if (!leaderboard.entries.length) {
            await interaction.editReply('No XP has been recorded yet, sir. Start chatting to climb the ranks.');
            return;
        }

        const totalPages = Math.max(1, Math.ceil(leaderboard.total / leaderboard.pageSize));
        const embed = new EmbedBuilder()
            .setTitle(`${guild.name} Leaderboard`)
            .setColor(0x5865f2)
            .setFooter({ text: `Page ${leaderboard.page} of ${totalPages}` });

        const lines = [];
        for (let index = 0; index < leaderboard.entries.length; index += 1) {
            const userRecord = leaderboard.entries[index];
            const position = (leaderboard.page - 1) * leaderboard.pageSize + index + 1;
            const member = guild.members.cache.get(userRecord.userId);
            const displayName = member?.displayName || userRecord.userId;
            const progress = this.leveling.calculateLevelProgress(userRecord.xp);

            lines.push(`**#${position}** ${member ? `<@${userRecord.userId}>` : displayName} — Level ${progress.level} • ${userRecord.xp.toLocaleString()} XP`);
        }

        embed.setDescription(lines.join('\n'));

        await interaction.editReply({ embeds: [embed] });
    }

    async handleLevelRoleCommand(interaction) {
        const guild = interaction.guild;

        if (!guild) {
            await interaction.editReply('This command must be used inside a server, sir.');
            return;
        }

        const isModerator = await this.isGuildModerator(interaction.member);
        if (!isModerator) {
            await interaction.editReply('Only moderators may configure level roles, sir.');
            return;
        }

        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'add') {
            const level = interaction.options.getInteger('level');
            const role = interaction.options.getRole('role');

            if (!Number.isInteger(level) || level <= 0) {
                await interaction.editReply('Levels must be positive integers, sir.');
                return;
            }

            if (!role) {
                await interaction.editReply('Please provide a valid role, sir.');
                return;
            }

            const botMember = guild.members.me || await guild.members.fetchMe();
            if (!botMember?.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
                await interaction.editReply('I require the Manage Roles permission to do that, sir.');
                return;
            }

            if (botMember.roles.highest.comparePositionTo(role) <= 0) {
                await interaction.editReply('My highest role must sit above that reward role, sir.');
                return;
            }

            try {
                await database.upsertLevelRole(guild.id, level, role.id);
                this.leveling.invalidateLevelRoleCache(guild.id);
            } catch (error) {
                console.error('Failed to upsert level role:', error);
                await interaction.editReply('I could not store that level reward, sir.');
                return;
            }

            await interaction.editReply(`Level ${level} will now grant ${role}, sir.`);
            return;
        }

        if (subcommand === 'remove') {
            const level = interaction.options.getInteger('level');
            if (!Number.isInteger(level) || level <= 0) {
                await interaction.editReply('Levels must be positive integers, sir.');
                return;
            }

            await database.removeLevelRole(guild.id, level);
            this.leveling.invalidateLevelRoleCache(guild.id);

            await interaction.editReply(`Level ${level} reward removed, sir.`);
            return;
        }

        if (subcommand === 'list') {
            const rewards = await database.getLevelRoles(guild.id);

            if (!rewards.length) {
                await interaction.editReply('No level rewards configured yet, sir.');
                return;
            }

            const lines = rewards.map((reward) => {
                const roleMention = guild.roles.cache.get(reward.roleId) ? `<@&${reward.roleId}>` : `Role ${reward.roleId}`;
                return `Level ${reward.level}: ${roleMention}`;
            });

            const embed = new EmbedBuilder()
                .setTitle('Level Rewards')
                .setColor(0x5865f2)
                .setDescription(lines.join('\n'));

            await interaction.editReply({ embeds: [embed] });
            return;
        }

        await interaction.editReply('I did not recognise that subcommand, sir.');
    }

    async fetchAttachmentBuffer(attachment) {
        if (!attachment?.url) {
            throw new Error('Attachment missing URL');
        }

        const res = await fetch(attachment.url);
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
        }

        const arrayBuffer = await res.arrayBuffer();
        return Buffer.from(arrayBuffer);
    }

    async handleCaptionCommand(interaction) {
        const guild = interaction.guild;
        if (guild && !(await this.isFeatureActive('memeTools', guild))) {
            await interaction.editReply('Meme systems are disabled for this server, sir.');
            return;
        }

        const text = interaction.options.getString('text', true).trim();
        const attachment = interaction.options.getAttachment('image', true);

        if (!text.length) {
            await interaction.editReply('Please provide a caption, sir.');
            return;
        }

        if (text.length > 200) {
            await interaction.editReply('Caption must be 200 characters or fewer, sir.');
            return;
        }

        const contentType = (attachment.contentType || '').toLowerCase();
        if (!contentType.startsWith('image/')) {
            await interaction.editReply('That file does not appear to be an image, sir.');
            return;
        }

        try {
            const buffer = await this.fetchAttachmentBuffer(attachment);
            const rendered = await memeCanvas.createCaptionImage(buffer, text);
            const file = new AttachmentBuilder(rendered, { name: 'caption.png' });
            await interaction.editReply({ files: [file] });
        } catch (error) {
            console.error('Caption command failed:', error);
            await interaction.editReply('Caption generator misfired, sir. Try another image.');
        }
    }

    async handleMemeCommand(interaction) {
        const guild = interaction.guild;
        if (guild && !(await this.isFeatureActive('memeTools', guild))) {
            await interaction.editReply('Meme systems are disabled for this server, sir.');
            return;
        }

        const subcommand = interaction.options.getSubcommand();
        if (subcommand !== 'impact') {
            await interaction.editReply('I have not memorised that meme pattern yet, sir.');
            return;
        }

        const attachment = interaction.options.getAttachment('image', true);
        const top = (interaction.options.getString('top') || '').trim();
        const bottom = (interaction.options.getString('bottom') || '').trim();

        if (top.length > 120 || bottom.length > 120) {
            await interaction.editReply('Each text block must be 120 characters or fewer, sir.');
            return;
        }

        const contentType = (attachment.contentType || '').toLowerCase();
        if (!contentType.startsWith('image/')) {
            await interaction.editReply('That file does not appear to be an image, sir.');
            return;
        }

        try {
            const buffer = await this.fetchAttachmentBuffer(attachment);
            const rendered = await memeCanvas.createImpactMemeImage(buffer, top, bottom);
            const file = new AttachmentBuilder(rendered, { name: 'meme.png' });
            await interaction.editReply({ files: [file] });
        } catch (error) {
            console.error('Impact meme command failed:', error);
            await interaction.editReply('Impact meme generators overheated, sir. Try again shortly.');
        }
    }

    async handleEconomyConfigCommand(interaction) {
        const guild = interaction.guild;
        if (!guild) {
            await interaction.editReply('Economy configuration is only available inside servers, sir.');
            return;
        }

        const member = interaction.member;
        const isOwner = guild.ownerId === interaction.user.id;
        if (!isOwner && !member?.permissions?.has(PermissionsBitField.Flags.ManageGuild)) {
            await interaction.editReply('Only administrators may rewire the StarkTokens network, sir.');
            return;
        }

        const action = interaction.options.getSubcommand();
        const channelOption = interaction.options.getChannel('channel');
        const targetChannel = channelOption || interaction.channel;

        if (!targetChannel) {
            await interaction.editReply('I could not determine which channel to configure, sir.');
            return;
        }

        if (targetChannel.guild?.id !== guild.id) {
            await interaction.editReply('Please pick a channel from this server, sir.');
            return;
        }

        if (typeof targetChannel.isTextBased === 'function' && !targetChannel.isTextBased()) {
            await interaction.editReply('Please select a text-capable channel, sir.');
            return;
        }

        try {
            if (action === 'enable') {
                await database.updateGuildFeatures(guild.id, { economy: true });
                this.invalidateGuildConfig(guild.id);
                const channels = await database.setEconomyChannel(guild.id, targetChannel.id, true);
                this.invalidateEconomyConfig(guild.id);
                await interaction.editReply(
                    `StarkTokens enabled in ${targetChannel}, sir. Active channels: ${channels.map((id) => `<#${id}>`).join(', ')}`
                );
                return;
            }

            if (action === 'disable') {
                const channels = await database.setEconomyChannel(guild.id, targetChannel.id, false);
                this.invalidateEconomyConfig(guild.id);
                if (!channels.length) {
                    await database.updateGuildFeatures(guild.id, { economy: false });
                    this.invalidateGuildConfig(guild.id);
                }

                await interaction.editReply(
                    channels.length
                        ? `StarkTokens disabled in ${targetChannel}, sir. Remaining: ${channels.map((id) => `<#${id}>`).join(', ')}`
                        : `StarkTokens disabled in ${targetChannel}. No other channels remain authorised, sir.`
                );
                return;
            }

            if (action === 'status') {
                const config = await database.getEconomySettings(guild.id);
                if (!config.channelIds.length) {
                    await interaction.editReply('No channels currently authorise StarkTokens interactions, sir.');
                    return;
                }

                await interaction.editReply(`StarkTokens active in: ${config.channelIds.map((id) => `<#${id}>`).join(', ')}`);
                return;
            }

            await interaction.editReply('I am unsure how to process that configuration request, sir.');
        } catch (error) {
            console.error('Economy config command failed:', error);
            await interaction.editReply('I could not update the StarkTokens configuration, sir.');
        }
    }

    createBossState(guildId, channelId) {
        const bossNames = [
            'Ultron Drone Sigma',
            'Gamma-Class Sentry',
            'Runaway Hulkbuster',
            'Arc Reactor Wraith'
        ];
        const name = this.pickRandom(bossNames) || 'Training Hive';
        const maxHp = this.randomInRange(1400, 2400);

        return {
            id: `${guildId}:${channelId}:${Date.now()}`,
            guildId,
            channelId,
            name,
            maxHp,
            hp: maxHp,
            participants: new Map(),
            supporters: new Map(),
            spawnedAt: new Date(),
            messageId: null
        };
    }

    renderBossEmbed(boss, guild) {
        const percent = Math.max(0, Math.round((boss.hp / boss.maxHp) * 100));
        const barSegments = Math.max(1, Math.round(percent / 10));
        const bar = '█'.repeat(barSegments).padEnd(10, '░');

        const embed = new EmbedBuilder()
            .setTitle(`⚙️ ${boss.name}`)
            .setColor(percent > 60 ? 0xf97316 : percent > 30 ? 0xfacc15 : 0xef4444)
            .setDescription(`Integrity: **${boss.hp.toLocaleString()} / ${boss.maxHp.toLocaleString()} HP** (${percent}%)\n${bar}`)
            .setFooter({ text: 'Defeat the training drone to earn StarkTokens.' })
            .setTimestamp(boss.spawnedAt);

        const topDamage = [...boss.participants.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([userId, damage], index) => `#${index + 1} <@${userId}> — ${damage.toLocaleString()} dmg`);

        if (topDamage.length) {
            embed.addFields({ name: 'Top Operatives', value: topDamage.join('\n'), inline: false });
        }

        const topSupport = [...boss.supporters.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 2)
            .map(([userId, heal]) => `<@${userId}> +${heal.toLocaleString()} integrity`);

        if (topSupport.length) {
            embed.addFields({ name: 'Support Crew', value: topSupport.join('\n'), inline: false });
        }

        return embed;
    }

    async handleEconomyBossCommand(interaction) {
        const guild = interaction.guild;
        if (!guild) {
            await interaction.editReply('Boss simulations are only available inside servers, sir.');
            return;
        }

        if (!(await this.isFeatureActive('economy', guild))) {
            await interaction.editReply('The StarkTokens economy is disabled for this server, sir.');
            return;
        }

        const enabled = await this.isEconomyChannelEnabled(guild, interaction.channelId);
        if (!enabled) {
            await interaction.editReply('Please enable StarkTokens in this channel before starting a boss simulation, sir.');
            return;
        }

        const subcommand = interaction.options.getSubcommand();
        const key = `${guild.id}:${interaction.channelId}`;
        const existing = this.activeBosses.get(key);

        if (subcommand === 'spawn') {
            const member = interaction.member;
            const isOwner = guild.ownerId === interaction.user.id;
            if (!isOwner && !member?.permissions?.has(PermissionsBitField.Flags.ManageGuild)) {
                await interaction.editReply('Only administrators may initiate training scenarios, sir.');
                return;
            }

            if (existing) {
                await interaction.editReply('A training boss is already active in this channel, sir.');
                return;
            }

            const boss = this.createBossState(guild.id, interaction.channelId);
            const embed = this.renderBossEmbed(boss, guild);
            const message = await interaction.editReply({ embeds: [embed], components: this.buildBossButtons() });
            boss.messageId = message.id;
            this.activeBosses.set(key, boss);
            return;
        }

        if (subcommand === 'status') {
            if (!existing) {
                await interaction.editReply('No training boss is active in this channel, sir.');
                return;
            }

            const embed = this.renderBossEmbed(existing, guild);
            await interaction.editReply({ embeds: [embed] });
            return;
        }

        await interaction.editReply('I am unsure how to process that boss command, sir.');
    }

    async finishBossFight(guild, boss, channel) {
        const key = `${guild.id}:${boss.channelId}`;
        this.activeBosses.delete(key);

        const participants = [...boss.participants.entries()];
        const supporters = [...boss.supporters.entries()];
        const totalDamage = participants.reduce((sum, [, dmg]) => sum + dmg, 0);

        const payouts = [];
        for (const [userId, damage] of participants) {
            const share = totalDamage > 0 ? Math.max(150, Math.round((damage / totalDamage) * 600)) : 150;
            payouts.push({ userId, amount: share, reason: `Boss ${boss.name} defeat reward` });
        }

        for (const [userId, heal] of supporters) {
            const existing = payouts.find((entry) => entry.userId === userId);
            const bonus = Math.max(50, Math.round(heal / 3));
            if (existing) {
                existing.amount += bonus;
            } else {
                payouts.push({ userId, amount: bonus, reason: `Support bonus against ${boss.name}` });
            }
        }

        const rewardLines = [];
        for (const payout of payouts) {
            try {
                await this.economy.adjustEconomyBalance(guild.id, payout.userId, payout.amount, {
                    type: 'boss_reward',
                    reason: payout.reason
                });
                rewardLines.push(`<@${payout.userId}> — ${payout.amount.toLocaleString()} tokens`);
            } catch (error) {
                console.error('Failed to pay boss reward:', error);
            }
        }

        if (channel) {
            const summary = rewardLines.length
                ? rewardLines.join('\n')
                : 'No operators registered enough damage for a payout.';
            await channel.send({
                content: `✅ **${boss.name} neutralised.** StarkTokens distributed:
${summary}`
            }).catch(() => {});
        }
    }

    async handleEconomyButton(interaction, action) {
        const guild = interaction.guild;

        if (guild && !(await this.isFeatureActive('economy', guild))) {
            await interaction.reply({ content: 'The StarkTokens economy is disabled for this server, sir.', ephemeral: true });
            return;
        }

        if (guild) {
            const enabled = await this.isEconomyChannelEnabled(guild, interaction.channelId);
            if (!enabled) {
                await interaction.reply({ content: 'Economy is not enabled in this channel, sir.', ephemeral: true });
                return;
            }
        }

        const scopeId = guild ? guild.id : `dm:${interaction.user.id}`;

        try {
            if (action === 'daily') {
                const { reward, streak } = await this.economy.claimDaily(scopeId, interaction.user.id);
                await interaction.reply({
                    content: `Daily ration secured: **${reward.toLocaleString()}** tokens (streak ${streak}).`,
                    ephemeral: true
                });
                return;
            }

            if (action === 'work') {
                const { reward } = await this.economy.doWork(scopeId, interaction.user.id);
                await interaction.reply({
                    content: `Shift complete. Earned **${reward.toLocaleString()}** StarkTokens.`,
                    ephemeral: true
                });
                return;
            }

            if (action === 'crate') {
                const { reward, message } = await this.economy.openCrate(scopeId, interaction.user.id);
                await interaction.reply({
                    content: `${message} Loot worth **${reward.toLocaleString()}** tokens recovered.`,
                    ephemeral: true
                });
                return;
            }

            if (action === 'leaderboard') {
                if (!guild) {
                    await interaction.reply({ content: 'Leaderboards require a server context, sir.', ephemeral: true });
                    return;
                }
                const top = await this.economy.getLeaderboard(guild.id, 5);
                if (!top.length) {
                    await interaction.reply({ content: 'No StarkToken activity recorded yet, sir.', ephemeral: true });
                    return;
                }
                const lines = top.map((entry, index) => {
                    const mention = guild.members.cache.get(entry.userId)
                        ? `<@${entry.userId}>`
                        : `User ${entry.userId}`;
                    return `#${index + 1} ${mention} — ${entry.balance.toLocaleString()} tokens`;
                });
                await interaction.reply({ content: lines.join('\n'), ephemeral: true });
                return;
            }

            if (action === 'shop') {
                await interaction.reply({ content: 'Use `/shop list` to browse the catalog, sir.', ephemeral: true });
                return;
            }

            await interaction.reply({ content: 'I do not recognise that control, sir.', ephemeral: true });
        } catch (error) {
            console.error('Economy button failed:', error);
            if (error.code === this.economy.ERROR_CODES.COOLDOWN) {
                await interaction.reply({ content: error.message, ephemeral: true });
            } else if (error.code === this.economy.ERROR_CODES.INSUFFICIENT_FUNDS) {
                await interaction.reply({ content: error.message || 'Balance too low, sir.', ephemeral: true });
            } else {
                await interaction.reply({ content: 'That control malfunctioned, sir.', ephemeral: true });
            }
        }
    }

    async handleBossButton(interaction, action) {
        const guild = interaction.guild;
        if (!guild) {
            await interaction.reply({ content: 'Boss simulations are only available inside servers, sir.', ephemeral: true });
            return;
        }

        const key = `${guild.id}:${interaction.channelId}`;
        const boss = this.activeBosses.get(key);
        if (!boss) {
            await interaction.reply({ content: 'No training boss is active right now, sir.', ephemeral: true });
            return;
        }

        if (action === 'attack') {
            const damage = this.randomInRange(80, 160);
            boss.hp = Math.max(0, boss.hp - damage);
            boss.participants.set(interaction.user.id, (boss.participants.get(interaction.user.id) || 0) + damage);

            await interaction.reply({ content: `You dealt **${damage}** damage, sir!`, ephemeral: true });

            const embed = this.renderBossEmbed(boss, guild);
            const components = boss.hp > 0 ? this.buildBossButtons() : [];
            await interaction.message.edit({ embeds: [embed], components }).catch(() => {});

            if (boss.hp <= 0) {
                await this.finishBossFight(guild, boss, interaction.channel);
            }
            return;
        }

        if (action === 'boost') {
            const heal = this.randomInRange(40, 90);
            boss.hp = Math.min(boss.maxHp, boss.hp + heal);
            boss.supporters.set(interaction.user.id, (boss.supporters.get(interaction.user.id) || 0) + heal);

            try {
                await this.economy.adjustEconomyBalance(guild.id, interaction.user.id, 35, {
                    type: 'boss_support',
                    reason: 'Supported the training boss strike'
                });
            } catch (error) {
                console.warn('Failed to grant support bonus:', error);
            }

            await interaction.reply({ content: `Integrity restored by ${heal} HP. +35 StarkTokens credited.`, ephemeral: true });

            const embed = this.renderBossEmbed(boss, guild);
            await interaction.message.edit({ embeds: [embed], components: this.buildBossButtons() }).catch(() => {});
            return;
        }

        await interaction.reply({ content: 'I do not recognise that control, sir.', ephemeral: true });
    }

    async handleComponentInteraction(interaction) {
        if (!interaction.isButton()) {
            return;
        }

        const [domain, action] = interaction.customId.split(':');

        if (domain === 'econ') {
            await this.handleEconomyButton(interaction, action);
            return;
        }

        if (domain === 'boss') {
            await this.handleBossButton(interaction, action);
            return;
        }

        await interaction.reply({ content: 'Unknown control, sir.', ephemeral: true });
    }

    async handleEightBallCommand(interaction) {
        const question = interaction.options.getString('question', true);
        const responses = [
            'Absolutely, sir.',
            'My sensors say no.',
            'Prospects hazy — rerun diagnostics.',
            'Proceed with extreme style.',
            'I would not bet Stark stock on it.',
            'All systems green.',
            'Ask again after a caffeine refill.',
            'Outcome classified — sorry, sir.'
        ];
        const answer = this.pickRandom(responses) || 'Systems offline, try later.';
        await interaction.editReply(`🎱 ${answer}`);
    }

    async handleVibeCheckCommand(interaction) {
        const target = interaction.options.getUser('user') || interaction.user;
        const score = this.randomInRange(0, 100);
        const verdicts = [
            'Radiant energy detected.',
            'Stable but watch the sarcasm levels.',
            'Chaotic neutral vibes.',
            'Vibe anomaly detected — recommend snacks.',
            'Off the charts. Prepare confetti.'
        ];
        const verdict = this.pickRandom(verdicts) || 'Unable to parse vibes.';
        const embed = new EmbedBuilder()
            .setTitle('Vibe Diagnostic')
            .setDescription(`<@${target.id}> registers at **${score}%** vibe integrity. ${verdict}`)
            .setColor(score > 70 ? 0x22c55e : score > 40 ? 0xfacc15 : 0xef4444);
        await interaction.editReply({ embeds: [embed] });
    }

    async handleBonkCommand(interaction) {
        const target = interaction.options.getUser('target');
        const implementsOfBonk = [
            'vibranium mallet',
            'foam hammer',
            'Stark-brand pool noodle',
            'holographic newspaper',
            'Mjölnir (training mode)'
        ];
        const tool = this.pickRandom(implementsOfBonk) || 'nanotech boop-stick';
        await interaction.editReply(`🔨 Bonk delivered to <@${target.id}> with the ${tool}. Order restored, sir.`);
    }

    async handleEconomyCommand(interaction) {
        const guild = interaction.guild;
        const subcommandGroup = interaction.options.getSubcommandGroup(false);
        const subcommand = interaction.options.getSubcommand();
        const isDm = !guild;

        if (subcommandGroup === 'config') {
            await this.handleEconomyConfigCommand(interaction);
            return;
        }

        if (guild && !(await this.isFeatureActive('economy', guild))) {
            await interaction.editReply('The StarkTokens economy is disabled for this server, sir. Ask an administrator to run `/econ config enable` in a channel.');
            return;
        }

        if (subcommandGroup === 'boss') {
            await this.handleEconomyBossCommand(interaction);
            return;
        }

        if (guild) {
            const enabled = await this.isEconomyChannelEnabled(guild, interaction.channelId);
            if (!enabled) {
                await interaction.editReply('Economy is not enabled in this channel, sir. Ask an administrator to run `/econ config enable` here.');
                return;
            }
        }

        const targetUser = interaction.options.getUser('user') || interaction.user;
        const components = this.buildEconomyButtons({
            includeLeader: Boolean(guild),
            includeShop: Boolean(guild)
        });
        const scopeId = guild ? guild.id : `dm:${interaction.user.id}`;

        try {
            switch (subcommand) {
                case 'info': {
                    const embed = new EmbedBuilder()
                        .setTitle('StarkTokens Activation Guide')
                        .setColor(0xf59e0b)
                        .setDescription(
                            guild
                                ? 'Economy commands are available in channels where an admin runs `/econ config enable`. Use `/econ config status` to review authorised channels.'
                                : 'In direct messages you already have access to StarkTokens. In servers, ask an administrator to run `/econ config enable` in the desired channel.'
                        )
                        .addFields(
                            { name: 'Daily Rewards', value: '`/econ daily` • claim once every 24h', inline: true },
                            { name: 'Work Contracts', value: '`/econ work` • available hourly', inline: true },
                            { name: 'Supply Crates', value: '`/econ crate` • open every 2h', inline: true }
                        )
                        .setFooter({ text: 'Buttons below provide quick access to the most common actions.' });

                    await interaction.editReply({ embeds: [embed], components });
                    break;
                }
                case 'balance': {
                    const profile = await this.economy.getBalance(scopeId, targetUser.id);
                    const embed = new EmbedBuilder()
                        .setTitle(`${targetUser.username}'s Stark wallet`)
                        .setColor(0xf59e0b)
                        .addFields(
                            { name: 'Balance', value: `${(profile.balance || 0).toLocaleString()} tokens`, inline: true },
                            { name: 'Daily streak', value: `${profile.streak || 0} day${profile.streak === 1 ? '' : 's'}`, inline: true }
                        )
                        .setFooter({ text: 'Earn tokens with /econ daily, /econ work, and Stark-approved wagers.' });

                    if (profile.lastDailyAt) {
                        embed.addFields({
                            name: 'Last daily',
                            value: `<t:${Math.floor(new Date(profile.lastDailyAt).getTime() / 1000)}:R>`,
                            inline: true
                        });
                    }

                    await interaction.editReply({ embeds: [embed], components });
                    break;
                }
                case 'daily': {
                    const { reward, streak, profile } = await this.economy.claimDaily(scopeId, interaction.user.id);
                    await interaction.editReply({
                        content: `Daily rations delivered: **${reward.toLocaleString()}** StarkTokens. ` +
                            `Current streak: ${streak} day${streak === 1 ? '' : 's'}. ` +
                            `Balance: ${profile.balance.toLocaleString()} tokens.`,
                        components
                    });
                    break;
                }
                case 'work': {
                    const { reward, profile } = await this.economy.doWork(scopeId, interaction.user.id);
                    await interaction.editReply({
                        content: `Shift complete. Credited **${reward.toLocaleString()}** StarkTokens. ` +
                            `Balance: ${profile.balance.toLocaleString()} tokens.`,
                        components
                    });
                    break;
                }
                case 'coinflip': {
                    const amount = interaction.options.getInteger('amount', true);
                    const side = interaction.options.getString('side', true);
                    const result = await this.economy.coinflip(scopeId, interaction.user.id, amount, side);
                    const summary = result.didWin
                        ? `Victory! Coin landed **${result.outcome}**. ${amount.toLocaleString()} tokens added.`
                        : `Coin landed **${result.outcome}**. Wager lost (${amount.toLocaleString()} tokens).`;
                    await interaction.editReply({
                        content: `${summary} Balance: ${result.profile.balance.toLocaleString()} StarkTokens.`,
                        components
                    });
                    break;
                }
                case 'crate': {
                    const { reward, message, profile } = await this.economy.openCrate(scopeId, interaction.user.id);
                    await interaction.editReply({
                        content: `${message} Loot contained **${reward.toLocaleString()}** StarkTokens. ` +
                            `Balance: ${profile.balance.toLocaleString()} tokens.`,
                        components
                    });
                    break;
                }
                case 'leaderboard': {
                    if (!guild) {
                        await interaction.editReply('Leaderboards require a server context, sir.');
                        return;
                    }

                    const top = await this.economy.getLeaderboard(guild.id, 10);
                    if (!top.length) {
                        await interaction.editReply({ content: 'No StarkToken activity recorded yet, sir.', components });
                        return;
                    }

                    const lines = top.map((entry, index) => {
                        const mention = guild.members.cache.get(entry.userId)
                            ? `<@${entry.userId}>`
                            : `User ${entry.userId}`;
                        return `**#${index + 1}** ${mention} — ${entry.balance.toLocaleString()} tokens`;
                    });

                    const embed = new EmbedBuilder()
                        .setTitle(`${guild.name} — StarkTokens leaderboard`)
                        .setColor(0xf59e0b)
                        .setDescription(lines.join('\n'));

                    await interaction.editReply({ embeds: [embed], components });
                    break;
                }
                default: {
                    await interaction.editReply({ content: 'I am unsure how to process that economy request, sir.', components });
                }
            }
        } catch (error) {
            console.error('Economy command failed:', error);
            if (error.code === this.economy.ERROR_CODES.COOLDOWN) {
                await interaction.editReply({ content: error.message, components });
            } else if (error.code === this.economy.ERROR_CODES.INSUFFICIENT_FUNDS) {
                await interaction.editReply({ content: error.message || 'Balance too low, sir.', components });
            } else {
                await interaction.editReply({ content: 'Economy systems encountered an unexpected fault, sir.', components });
            }
        }
    }

    async handleShopCommand(interaction) {
        const guild = interaction.guild;
        if (!guild) {
            await interaction.editReply('The Stark shop is available within servers only, sir.');
            return;
        }

        if (!(await this.isFeatureActive('economy', guild))) {
            await interaction.editReply('The Stark shop is disabled for this server, sir.');
            return;
        }

        const subcommand = interaction.options.getSubcommand();

        try {
            if (subcommand === 'add') {
                const member = interaction.member;
                if (!member?.permissions?.has(PermissionsBitField.Flags.ManageGuild)) {
                    await interaction.editReply('Only facility managers may add shop inventory, sir.');
                    return;
                }

                const sku = interaction.options.getString('sku', true).trim();
                const price = interaction.options.getInteger('price', true);
                const name = interaction.options.getString('name', true).trim();
                const description = (interaction.options.getString('description') || '').trim() || null;
                const role = interaction.options.getRole('role');

                if (price <= 0) {
                    await interaction.editReply('Prices must be greater than zero StarkTokens, sir.');
                    return;
                }

                let roleId = null;
                if (role) {
                    const me = guild.members.me || await guild.members.fetchMe();
                    if (!me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
                        await interaction.editReply('I require Manage Roles to distribute that reward, sir.');
                        return;
                    }
                    if (me.roles.highest.comparePositionTo(role) <= 0) {
                        await interaction.editReply('My highest role must sit above that reward role, sir.');
                        return;
                    }
                    roleId = role.id;
                }

                await this.economy.addShopItem(guild.id, sku, {
                    name,
                    price,
                    description,
                    roleId
                });

                await interaction.editReply(
                    `Catalog updated. SKU **${sku}** priced at ${price.toLocaleString()} tokens${roleId ? ` (grants <@&${roleId}>)` : ''}.`
                );
                return;
            }

            if (subcommand === 'remove') {
                const member = interaction.member;
                if (!member?.permissions?.has(PermissionsBitField.Flags.ManageGuild)) {
                    await interaction.editReply('Only facility managers may remove shop inventory, sir.');
                    return;
                }

                const sku = interaction.options.getString('sku', true).trim();
                const removed = await this.economy.removeShopItem(guild.id, sku);
                if (!removed) {
                    await interaction.editReply('No catalog entry found for that SKU, sir.');
                    return;
                }

                await interaction.editReply(`SKU **${sku}** removed from the catalog.`);
                return;
            }

            if (subcommand === 'list') {
                const items = await this.economy.listShopItems(guild.id);
                if (!items.length) {
                    await interaction.editReply('The Stark shop is currently empty, sir.');
                    return;
                }

                const embed = new EmbedBuilder()
                    .setTitle(`${guild.name} — Stark shop`)
                    .setColor(0xf59e0b);

                items.slice(0, 25).forEach((item) => {
                    const lines = [
                        `Price: ${item.price.toLocaleString()} tokens`,
                        item.description ? item.description : null,
                        item.roleId ? `Reward: <@&${item.roleId}>` : null
                    ].filter(Boolean);

                    embed.addFields({
                        name: `${item.sku} — ${item.name}`,
                        value: lines.join('\n') || 'No details provided.'
                    });
                });

                await interaction.editReply({ embeds: [embed] });
                return;
            }

            if (subcommand === 'buy') {
                const sku = interaction.options.getString('sku', true).trim();
                const { item, profile } = await this.economy.buyItem({
                    guildId: guild.id,
                    userId: interaction.user.id,
                    sku
                });

                let roleApplied = false;
                let roleStatus = null;
                if (item.roleId) {
                    const rewardRole = guild.roles.cache.get(item.roleId);
                    if (rewardRole) {
                        try {
                            const me = guild.members.me || await guild.members.fetchMe();
                            if (!me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
                                throw new Error('Missing Manage Roles permission.');
                            }
                            if (me.roles.highest.comparePositionTo(rewardRole) <= 0) {
                                throw new Error('Role hierarchy prevents assignment.');
                            }
                            const member = await guild.members.fetch(interaction.user.id);
                            if (!member.roles.cache.has(rewardRole.id)) {
                                await member.roles.add(rewardRole, `Purchased ${item.sku}`);
                                roleApplied = true;
                            }
                        } catch (error) {
                            console.warn('Failed to apply shop role:', error);
                            roleStatus = 'Unable to assign the role automatically — please check my permissions.';
                        }
                    } else {
                        roleStatus = 'The configured reward role no longer exists, sir.';
                    }
                }

                const lines = [
                    `Transaction approved. **${item.name}** acquired for ${item.price.toLocaleString()} tokens.`,
                    `Balance: ${profile.balance.toLocaleString()} tokens.`
                ];

                if (item.roleId) {
                    if (roleApplied) {
                        lines.push(`Role <@&${item.roleId}> assigned.`);
                    } else if (roleStatus) {
                        lines.push(roleStatus);
                    }
                }

                await interaction.editReply(lines.join(' '));
                return;
            }

            await interaction.editReply('I am unsure how to operate that shop subcommand, sir.');
        } catch (error) {
            console.error('Shop command failed:', error);
            if (error.code === this.economy.ERROR_CODES.INSUFFICIENT_FUNDS) {
                await interaction.editReply(error.message || 'Balance insufficient for that purchase, sir.');
            } else if (error.code === this.economy.ERROR_CODES.UNKNOWN_ITEM) {
                await interaction.editReply('That SKU is not in the catalog, sir.');
            } else {
                await interaction.editReply('Shop systems encountered an unexpected fault, sir.');
            }
        }
    }

    async handleSlashCommand(interaction) {
        const commandName = interaction.commandName;
        const userId = interaction.user.id;
        const guild = interaction.guild || null;
        const guildId = guild?.id || null;
        const cooldownScope = `slash:${commandName}`;
        const startedAt = Date.now();

        let telemetryStatus = 'ok';
        let telemetryError = null;
        let telemetryMetadata = {};
        let telemetrySubcommand = null;
        let shouldSetCooldown = false;

        const finalizeTelemetry = () => {
            const metadata = telemetryMetadata && Object.keys(telemetryMetadata).length > 0
                ? telemetryMetadata
                : undefined;

            recordCommandRun({
                command: commandName,
                subcommand: telemetrySubcommand,
                userId,
                guildId,
                latencyMs: Date.now() - startedAt,
                status: telemetryStatus,
                error: telemetryError,
                metadata,
                context: 'slash'
            });
        };

        try {
            if (!isCommandEnabled(commandName)) {
                telemetryStatus = 'error';
                telemetryMetadata.reason = 'feature-disabled-global';
                try {
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: 'That module is disabled in this deployment, sir.', ephemeral: true });
                    }
                } catch (error) {
                    console.warn('Failed to send disabled command notice:', error);
                }
                return;
            }

            const featureAllowed = await this.isCommandFeatureEnabled(commandName, guild);
            if (!featureAllowed) {
                telemetryStatus = 'error';
                telemetryMetadata.reason = 'feature-disabled-guild';
                try {
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: 'That module is disabled for this server, sir.', ephemeral: true });
                    } else if (interaction.deferred && !interaction.replied) {
                        await interaction.editReply('That module is disabled for this server, sir.');
                    }
                } catch (error) {
                    console.warn('Failed to send guild-disabled command notice:', error);
                }
                return;
            }

            if (this.isOnCooldown(userId, cooldownScope)) {
                telemetryStatus = 'error';
                telemetryMetadata.reason = 'rate_limited';
                return;
            }

            telemetrySubcommand = this.extractInteractionRoute(interaction);

            if (commandName === 'clip') {
                shouldSetCooldown = true;
                const handled = await this.handleSlashCommandClip(interaction);
                telemetryMetadata.handled = Boolean(handled);
                return;
            }

            const musicCommand = musicCommandMap.get(commandName);
            if (musicCommand) {
                shouldSetCooldown = true;
                try {
                    await musicCommand.execute(interaction);
                } catch (error) {
                    telemetryStatus = 'error';
                    telemetryError = error;
                    console.error(`Error executing /${commandName}:`, error);
                    try {
                        if (!interaction.deferred && !interaction.replied) {
                            await interaction.reply('⚠️ Unable to process that request right now, sir.');
                        } else if (!interaction.replied) {
                            await interaction.editReply('⚠️ Unable to process that request right now, sir.');
                        } else {
                            await interaction.followUp('⚠️ Unable to process that request right now, sir.');
                        }
                    } catch (responseError) {
                        console.error('Failed to send music command error response:', responseError);
                    }
                }
                return;
            }

            const shouldBeEphemeral = SLASH_EPHEMERAL_COMMANDS.has(commandName);
            const canUseEphemeral = Boolean(guild);
            const deferEphemeral = shouldBeEphemeral && canUseEphemeral;

            try {
                await interaction.deferReply({ ephemeral: deferEphemeral });
            } catch (error) {
                if (error.code === 10062) {
                    telemetryStatus = 'error';
                    telemetryMetadata.reason = 'unknown-interaction';
                    console.warn('Ignored unknown interaction during deferReply.');
                    return;
                }
                telemetryStatus = 'error';
                telemetryError = error;
                console.error('Failed to defer reply:', error);
                return;
            }

            shouldSetCooldown = true;

            let response;

            if (commandName === 'ticket') {
                await this.handleTicketCommand(interaction);
                return;
            }

            if (commandName === 'kb') {
                await this.handleKnowledgeBaseCommand(interaction);
                return;
            }

            if (commandName === 'ask') {
                await this.handleAskCommand(interaction);
                return;
            }

            if (commandName === 'macro') {
                await this.handleMacroCommand(interaction);
                return;
            }

            if (commandName === 'reactionrole') {
                await this.handleReactionRoleCommand(interaction);
                return;
            }

            if (commandName === 'automod') {
                await this.handleAutoModCommand(interaction);
                return;
            }

            if (commandName === 'serverstats') {
                await this.handleServerStatsCommand(interaction);
                return;
            }

            if (commandName === 'memberlog') {
                await this.handleMemberLogCommand(interaction);
                return;
            }

            if (commandName === 'news') {
                await this.handleNewsCommand(interaction);
                return;
            }

            switch (commandName) {
                case 'eightball': {
                    telemetryMetadata.category = 'fun';
                    await this.handleEightBallCommand(interaction);
                    return;
                }
                case 'vibecheck': {
                    telemetryMetadata.category = 'fun';
                    await this.handleVibeCheckCommand(interaction);
                    return;
                }
                case 'bonk': {
                    telemetryMetadata.category = 'fun';
                    await this.handleBonkCommand(interaction);
                    return;
                }
                case 'caption': {
                    telemetryMetadata.category = 'memes';
                    await this.handleCaptionCommand(interaction);
                    return;
                }
                case 'meme': {
                    telemetryMetadata.category = 'memes';
                    await this.handleMemeCommand(interaction);
                    return;
                }
                case 'econ': {
                    telemetryMetadata.category = 'economy';
                    await this.handleEconomyCommand(interaction);
                    return;
                }
                case 'shop': {
                    telemetryMetadata.category = 'economy';
                    await this.handleShopCommand(interaction);
                    return;
                }
                case 'jarvis': {
                    let prompt = interaction.options.getString('prompt');

                    if (prompt.length > config.ai.maxSlashInputLength) {
                        const responses = [
                            "Rather verbose, sir. A concise version, perhaps?",
                            "Too many words, sir. Brevity, please.",
                            "TL;DR, sir.",
                            "Really, sir?",
                            "Saving your creativity for later, sir.",
                            `${config.ai.maxSlashInputLength} characters is the limit, sir.`,
                            "Stop yapping, sir.",
                            "Quite the novella, sir. Abridged edition?",
                            "Brevity is the soul of wit, sir.",
                        ];

                        await interaction.editReply(responses[Math.floor(Math.random() * responses.length)]);
                        telemetryStatus = 'error';
                        telemetryMetadata.reason = 'prompt-too-long';
                        return;
                    }

                    if (prompt.length > config.ai.maxInputLength) {
                        prompt = `${prompt.substring(0, config.ai.maxInputLength)}...`;
                    }

                    response = await this.jarvis.generateResponse(interaction, prompt, true);
                    break;
                }
                case 'roll': {
                    const sides = interaction.options.getInteger('sides') || 6;
                    response = await this.jarvis.handleUtilityCommand(
                        `roll ${sides}`,
                        interaction.user.username,
                        userId,
                        true,
                        interaction,
                        guildId
                    );
                    break;
                }
                case 'time': {
                    response = await this.jarvis.handleUtilityCommand(
                        'time',
                        interaction.user.username,
                        userId,
                        true,
                        interaction,
                        guildId
                    );
                    break;
                }
                case 'reset': {
                    response = await this.jarvis.handleUtilityCommand(
                        'reset',
                        interaction.user.username,
                        userId,
                        true,
                        interaction,
                        guildId
                    );
                    break;
                }
                case 'help': {
                    response = await this.jarvis.handleUtilityCommand(
                        'help',
                        interaction.user.username,
                        userId,
                        true,
                        interaction,
                        guildId
                    );
                    break;
                }
                case 'profile': {
                    response = await this.jarvis.handleUtilityCommand(
                        'profile',
                        interaction.user.username,
                        userId,
                        true,
                        interaction,
                        guildId
                    );
                    break;
                }
                case 'history': {
                    response = await this.jarvis.handleUtilityCommand(
                        'history',
                        interaction.user.username,
                        userId,
                        true,
                        interaction,
                        guildId
                    );
                    break;
                }
                case 'recap': {
                    response = await this.jarvis.handleUtilityCommand(
                        'recap',
                        interaction.user.username,
                        userId,
                        true,
                        interaction,
                        guildId
                    );
                    break;
                }
                case 'digest': {
                    response = await this.jarvis.handleUtilityCommand(
                        'digest',
                        interaction.user.username,
                        userId,
                        true,
                        interaction,
                        guildId
                    );
                    break;
                }
                case 'rank': {
                    telemetryMetadata.category = 'leveling';
                    await this.handleRankCommand(interaction);
                    return;
                }
                case 'leaderboard': {
                    telemetryMetadata.category = 'leveling';
                    await this.handleLeaderboardCommand(interaction);
                    return;
                }
                case 'levelrole': {
                    telemetryMetadata.category = 'leveling';
                    await this.handleLevelRoleCommand(interaction);
                    return;
                }
                case 'encode': {
                    response = await this.jarvis.handleUtilityCommand(
                        'encode',
                        interaction.user.username,
                        userId,
                        true,
                        interaction,
                        guildId
                    );
                    break;
                }
                case 'decode': {
                    response = await this.jarvis.handleUtilityCommand(
                        'decode',
                        interaction.user.username,
                        userId,
                        true,
                        interaction,
                        guildId
                    );
                    break;
                }
                default: {
                    response = await this.jarvis.handleUtilityCommand(
                        commandName,
                        interaction.user.username,
                        userId,
                        true,
                        interaction,
                        guildId
                    );
                }
            }

            if (response === undefined || response === null) {
                await interaction.editReply("Response circuits tangled, sir. Try again?");
                telemetryMetadata.reason = 'empty-response';
            } else if (typeof response === 'string') {
                const trimmed = response.trim();
                await interaction.editReply(trimmed.length ? trimmed : "Response circuits tangled, sir. Try again?");
            } else {
                await interaction.editReply(response);
            }
        } catch (error) {
            telemetryStatus = 'error';
            telemetryError = error;
            console.error('Error processing interaction:', error);
            try {
                await interaction.editReply("Technical difficulties, sir. One moment, please.");
            } catch (editError) {
                if (editError.code === 10062) {
                    telemetryMetadata.reason = 'unknown-interaction';
                    console.warn('Ignored unknown interaction during error reply.');
                } else {
                    console.error('Failed to send error reply:', editError);
                }
            }
            shouldSetCooldown = true;
        } finally {
            if (shouldSetCooldown) {
                this.setCooldown(userId, cooldownScope);
            }
            finalizeTelemetry();
        }
    }
}

module.exports = new DiscordHandlers();

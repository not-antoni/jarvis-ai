
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

    async handleSlashCommand(interaction) {
        if (!isCommandEnabled(interaction.commandName)) {
            try {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: 'That module is disabled in this deployment, sir.', ephemeral: true });
                }
            } catch (error) {
                console.warn('Failed to send disabled command notice:', error);
            }
            return;
        }

        const userId = interaction.user.id;

        if (this.isOnCooldown(userId)) {
            return;
        }

        // Handle clip command first (special case)
        if (interaction.commandName === "clip") {
            this.setCooldown(userId);
            return await this.handleSlashCommandClip(interaction);
        }

        const ephemeralCommands = new Set(["help", "profile", "history", "recap", "digest", "macro", "reactionrole", "automod", "serverstats", "memberlog", "ticket", "kb", "config"]);
        const shouldBeEphemeral = ephemeralCommands.has(interaction.commandName);

        try {
            await interaction.deferReply({ ephemeral: shouldBeEphemeral });
        } catch (error) {
            if (error.code === 10062) {
                console.warn("Ignored unknown interaction during deferReply.");
                return;
            }
            console.error("Failed to defer reply:", error);
            return;
        }

        try {
            let response;

            if (interaction.commandName === "jarvis") {
                let prompt = interaction.options.getString("prompt");

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
                    this.setCooldown(userId);
                    return;
                }

                if (prompt.length > config.ai.maxInputLength) {
                    prompt = prompt.substring(0, config.ai.maxInputLength) + "...";
                }

                response = await this.jarvis.generateResponse(interaction, prompt, true);
            } else if (interaction.commandName === "roll") {
                const sides = interaction.options.getInteger("sides") || 6;
                response = await this.jarvis.handleUtilityCommand(
                    `roll ${sides}`,
                    interaction.user.username,
                    interaction.user.id,
                    true,
                    interaction,
                    interaction.guild?.id || null
                );
            } else if (interaction.commandName === "time") {
                response = await this.jarvis.handleUtilityCommand(
                    "time",
                    interaction.user.username,
                    interaction.user.id,
                    true,
                    interaction,
                    interaction.guild?.id || null
                );
            } else if (interaction.commandName === "reset") {
                response = await this.jarvis.handleUtilityCommand(
                    "reset",
                    interaction.user.username,
                    interaction.user.id,
                    true,
                    interaction,
                    interaction.guild?.id || null
                );
            } else if (interaction.commandName === "help") {
                response = await this.jarvis.handleUtilityCommand(
                    "help",
                    interaction.user.username,
                    interaction.user.id,
                    true,
                    interaction,
                    interaction.guild?.id || null
                );
            } else if (interaction.commandName === "profile") {
                response = await this.jarvis.handleUtilityCommand(
                    "profile",
                    interaction.user.username,
                    interaction.user.id,
                    true,
                    interaction,
                    interaction.guild?.id || null
                );
            } else if (interaction.commandName === "history") {
                response = await this.jarvis.handleUtilityCommand(
                    "history",
                    interaction.user.username,
                    interaction.user.id,
                    true,
                    interaction,
                    interaction.guild?.id || null
                );
            } else if (interaction.commandName === "recap") {
                response = await this.jarvis.handleUtilityCommand(
                    "recap",
                    interaction.user.username,
                    interaction.user.id,
                    true,
                    interaction,
                    interaction.guild?.id || null
                );
            } else if (interaction.commandName === "digest") {
                response = await this.jarvis.handleUtilityCommand(
                    "digest",
                    interaction.user.username,
                    interaction.user.id,
                    true,
                    interaction,
                    interaction.guild?.id || null
                );
            } else if (interaction.commandName === "ticket") {
                await this.handleTicketCommand(interaction);
                this.setCooldown(userId);
                return;
            } else if (interaction.commandName === "kb") {
                await this.handleKnowledgeBaseCommand(interaction);
                this.setCooldown(userId);
                return;
            } else if (interaction.commandName === "ask") {
                await this.handleAskCommand(interaction);
                this.setCooldown(userId);
                return;
            } else if (interaction.commandName === "macro") {
                await this.handleMacroCommand(interaction);
                this.setCooldown(userId);
                return;
            } else if (interaction.commandName === "reactionrole") {
                await this.handleReactionRoleCommand(interaction);
                this.setCooldown(userId);
                return;
            } else if (interaction.commandName === "automod") {
                await this.handleAutoModCommand(interaction);
                this.setCooldown(userId);
                return;
            } else if (interaction.commandName === "serverstats") {
                await this.handleServerStatsCommand(interaction);
                this.setCooldown(userId);
                return;
            } else if (interaction.commandName === "memberlog") {
                await this.handleMemberLogCommand(interaction);
                this.setCooldown(userId);
                return;
            } else if (interaction.commandName === "config") {
                await this.handleConfigCommand(interaction);
                this.setCooldown(userId);
                return;
            } else if (interaction.commandName === "news") {
                await this.handleNewsCommand(interaction);
                this.setCooldown(userId);
                return;
            } else if (interaction.commandName === "encode") {
                response = await this.jarvis.handleUtilityCommand(
                    "encode",
                    interaction.user.username,
                    interaction.user.id,
                    true,
                    interaction,
                    interaction.guild?.id || null
                );
            } else if (interaction.commandName === "decode") {
                response = await this.jarvis.handleUtilityCommand(
                    "decode",
                    interaction.user.username,
                    interaction.user.id,
                    true,
                    interaction,
                    interaction.guild?.id || null
                );
            } else {
                response = await this.jarvis.handleUtilityCommand(
                    interaction.commandName,
                    interaction.user.username,
                    interaction.user.id,
                    true,
                    interaction,
                    interaction.guild?.id || null
                );
            }

            if (!response) {
                await interaction.editReply("Response circuits tangled, sir. Try again?");
            } else if (typeof response === "string") {
                const trimmed = response.trim();
                await interaction.editReply(trimmed.length ? trimmed : "Response circuits tangled, sir. Try again?");
            } else {
                await interaction.editReply(response);
            }

            this.setCooldown(userId);
        } catch (error) {
            console.error("Error processing interaction:", error);
            try {
                await interaction.editReply("Technical difficulties, sir. One moment, please.");
            } catch (editError) {
                if (editError.code === 10062) {
                    console.warn("Ignored unknown interaction during error reply.");
                    return;
                }
                console.error("Failed to send error reply:", editError);
            }
            this.setCooldown(userId);
        }
    }
}

module.exports = new DiscordHandlers();

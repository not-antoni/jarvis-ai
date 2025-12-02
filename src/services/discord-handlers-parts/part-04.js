
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
            
            await this.sendBufferOrLink(interaction, imageBuffer, 'clipped.png');
            
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

    async fetchImageFromUrl(rawUrl, { maxBytes } = {}) {
        if (!rawUrl) throw new Error('URL required');
        let url;
        try { url = new URL(rawUrl); } catch { throw new Error('Invalid URL'); }
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported protocol');

        // Try direct fetch
        let res = await fetch(url.toString(), { method: 'HEAD' });
        if (res.ok) {
            const ctype = (res.headers.get('content-type') || '').toLowerCase();
            const clen = Number(res.headers.get('content-length') || 0);
            if (maxBytes && clen && clen > maxBytes) {
                return { tooLarge: true, contentType: ctype, sourceUrl: url.toString() };
            }
        }
        res = await fetch(url.toString(), { redirect: 'follow' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const contentType = (res.headers.get('content-type') || '').toLowerCase();
        if (contentType.startsWith('image/')) {
            if (maxBytes && res.body) {
                let received = 0;
                const chunks = [];
                await new Promise((resolve, reject) => {
                    res.body.on('data', (chunk) => {
                        received += chunk.length;
                        if (received > maxBytes) {
                            res.body.destroy();
                            resolve();
                        } else {
                            chunks.push(chunk);
                        }
                    });
                    res.body.on('end', resolve);
                    res.body.on('error', reject);
                });
                if (received > maxBytes) {
                    return { tooLarge: true, contentType, sourceUrl: url.toString() };
                }
                return { buffer: Buffer.concat(chunks), contentType, sourceUrl: url.toString() };
            } else {
                const buf = Buffer.from(await res.arrayBuffer());
                return { buffer: buf, contentType, sourceUrl: url.toString() };
            }
        }

        // Handle Tenor and general HTML with OpenGraph
        if (contentType.includes('text/html')) {
            const html = await res.text();
            const $ = cheerio.load(html);
            let media = $('meta[property="og:image"]').attr('content')
                || $('meta[name="twitter:image"]').attr('content')
                || $('meta[property="og:video"]').attr('content');
            if (!media) {
                // Tenor sometimes stores JSON in script tags – try common attribute
                const ld = $('script[type="application/ld+json"]').first().text();
                try {
                    const obj = JSON.parse(ld);
                    media = obj?.contentUrl || obj?.image?.[0] || obj?.image;
                } catch (_) {}
            }
            if (media) {
                // Resolve relative
                const resolved = new URL(media, url).toString();
                // head check
                let head = await fetch(resolved, { method: 'HEAD' });
                const headType = (head.headers.get('content-type') || '').toLowerCase();
                const headLen = Number(head.headers.get('content-length') || 0);
                if (maxBytes && headLen && headLen > maxBytes) {
                    return { tooLarge: true, contentType: headType, sourceUrl: resolved };
                }
                res = await fetch(resolved, { redirect: 'follow' });
                if (!res.ok) throw new Error(`Media HTTP ${res.status}`);
                const ctype = (res.headers.get('content-type') || '').toLowerCase();
                if (maxBytes && res.body) {
                    let received = 0;
                    const chunks = [];
                    await new Promise((resolve, reject) => {
                        res.body.on('data', (chunk) => {
                            received += chunk.length;
                            if (received > maxBytes) {
                                res.body.destroy();
                                resolve();
                            } else {
                                chunks.push(chunk);
                            }
                        });
                        res.body.on('end', resolve);
                        res.body.on('error', reject);
                    });
                    if (received > maxBytes) {
                        return { tooLarge: true, contentType: ctype, sourceUrl: resolved };
                    }
                    return { buffer: Buffer.concat(chunks), contentType: ctype, sourceUrl: resolved };
                } else {
                    const buf = Buffer.from(await res.arrayBuffer());
                    return { buffer: buf, contentType: ctype, sourceUrl: resolved };
                }
            }
        }
        throw new Error('No image found at URL');
    }

    async handleCaptionCommand(interaction) {
        const guild = interaction.guild;
        if (guild && !(await this.isFeatureActive('memeTools', guild))) {
            await interaction.editReply('Meme systems are disabled for this server, sir.');
            return;
        }

        const text = interaction.options.getString('text', true).trim();
        const attachment = interaction.options.getAttachment('image', false);
            const urlOpt = (interaction.options.getString('url') || '').trim(); // Ensure URL is trimmed

        if (!text.length) {
            await interaction.editReply('Please provide a caption, sir.');
            return;
        }

        if (text.length > 200) {
            await interaction.editReply('Caption must be 200 characters or fewer, sir.');
            return;
        }

        try {
            let buffer;
            let contentType = null;
            if (attachment) {
                contentType = (attachment.contentType || '').toLowerCase();
                if (!contentType.startsWith('image/')) {
                    await interaction.editReply('That file does not appear to be an image, sir.');
                    return;
                }
                if (Number(attachment.size || 0) > this.maxInputBytes) {
                    await interaction.editReply("MY poor CPU can't handle that, sir.");
                    return;
                }
                buffer = await this.fetchAttachmentBuffer(attachment);
            } else if (urlOpt) {
                const fetched = await this.fetchImageFromUrl(urlOpt, { maxBytes: this.maxInputBytes });
                if (fetched.tooLarge) {
                    await interaction.editReply("MY poor CPU can't handle that, sir.");
                    return;
                }
                const { buffer: buf, contentType: ct } = fetched;
                buffer = buf;
                contentType = (ct || '').toLowerCase();
            } else {
                await interaction.editReply('Provide an image attachment or a URL, sir.');
                return;
            }
            if (contentType && (contentType.includes('gif') || contentType.includes('video/'))) {
                try {
                    const isRender = (config?.deployment?.target || 'render').toLowerCase() === 'render';
                    if (isRender) {
                        const { captionToMp4 } = require('../utils/video-caption');
                        const out = await captionToMp4({ inputBuffer: buffer, captionText: text });
                        await this.sendBufferOrLink(interaction, out, 'caption.mp4');
                    } else {
                        const { captionAnimated } = require('../utils/gif-caption');
                        const out = await captionAnimated({ inputBuffer: buffer, captionText: text });
                        await this.sendBufferOrLink(interaction, out, 'caption.gif');
                    }
                } catch (err) {
                    console.warn('Animated caption failed, falling back to PNG:', err?.message || err);
                    const rendered = await memeCanvas.createCaptionImage(buffer, text);
                    await this.sendBufferOrLink(interaction, rendered, 'caption.png');
                }
            } else {
                const rendered = await memeCanvas.createCaptionImage(buffer, text);
                await this.sendBufferOrLink(interaction, rendered, 'caption.png');
            }
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

        const attachment = interaction.options.getAttachment('image', false);
            const urlOpt = (interaction.options.getString('url') || '').trim(); // Ensure URL is trimmed
        const top = (interaction.options.getString('top') || '').trim();
        const bottom = (interaction.options.getString('bottom') || '').trim();

        if (top.length > 120 || bottom.length > 120) {
            await interaction.editReply('Each text block must be 120 characters or fewer, sir.');
            return;
        }

        try {
            let buffer;
            if (attachment) {
                const contentType = (attachment.contentType || '').toLowerCase();
                if (!contentType.startsWith('image/')) {
                    await interaction.editReply('That file does not appear to be an image, sir.');
                    return;
                }
                if (Number(attachment.size || 0) > this.maxInputBytes) {
                    await interaction.editReply("MY poor CPU can't handle that, sir.");
                    return;
                }
                buffer = await this.fetchAttachmentBuffer(attachment);
            } else if (urlOpt) {
                const fetched = await this.fetchImageFromUrl(urlOpt, { maxBytes: this.maxInputBytes });
                if (fetched.tooLarge) {
                    await interaction.editReply("MY poor CPU can't handle that, sir.");
                    return;
                }
                buffer = fetched.buffer;
            } else {
                await interaction.editReply('Provide an image attachment or a URL, sir.');
                return;
            }
            const rendered = await memeCanvas.createImpactMemeImage(buffer, top, bottom);
            await this.sendBufferOrLink(interaction, rendered, 'meme.png');
        } catch (error) {
            console.error('Impact meme command failed:', error);
            await interaction.editReply('Impact meme generators overheated, sir. Try again shortly.');
        }
    }

    async handleCryptoCommand(interaction) {
        const symbol = (interaction.options.getString('coin', true) || '').toUpperCase();
        const convert = (interaction.options.getString('convert') || 'USD').toUpperCase();

        if (!config.crypto?.apiKey) {
            await interaction.editReply('Crypto market uplink offline, sir. Please configure CRYPTO_API_KEY.');
            return;
        }

        const formatCurrency = (value) => {
            const amount = Number(value);
            if (!Number.isFinite(amount)) {
                return `— ${convert}`;
            }

            const abs = Math.abs(amount);
            const digits = abs >= 1000 ? 2 : abs >= 1 ? 3 : 6;

            try {
                return new Intl.NumberFormat('en-US', {
                    style: 'currency',
                    currency: convert,
                    minimumFractionDigits: digits,
                    maximumFractionDigits: digits
                }).format(amount);
            } catch {
                return `${amount.toFixed(digits)} ${convert}`;
            }
        };

        const formatPercent = (value) => {
            const num = Number(value);
            if (!Number.isFinite(num)) {
                return '—';
            }
            const direction = num >= 0 ? '▲' : '▼';
            return `${direction} ${Math.abs(num).toFixed(2)}%`;
        };

        const formatNumber = (value, options = {}) => {
            const num = Number(value);
            if (!Number.isFinite(num)) {
                return '—';
            }
            return new Intl.NumberFormat('en-US', options).format(num);
        };

        try {
            const { asset, quote } = await this.crypto.getQuote({ symbol, convert });
            const lastUpdated = quote.last_updated ? new Date(quote.last_updated) : null;

            const embed = new EmbedBuilder()
                .setTitle(`${asset.name} (${asset.symbol})`)
                .setColor((quote.percent_change_24h || 0) >= 0 ? 0x22c55e : 0xef4444)
                .setDescription(`Live telemetry converted to ${convert}.`)
                .addFields(
                    { name: 'Price', value: formatCurrency(quote.price), inline: true },
                    { name: '24h Δ', value: formatPercent(quote.percent_change_24h), inline: true },
                    { name: '7d Δ', value: formatPercent(quote.percent_change_7d), inline: true },
                    { name: '1h Δ', value: formatPercent(quote.percent_change_1h), inline: true },
                    { name: 'Market Cap', value: formatCurrency(quote.market_cap), inline: true },
                    { name: '24h Volume', value: formatCurrency(quote.volume_24h), inline: true },
                    {
                        name: 'Supply',
                        value: `${formatNumber(asset.circulating_supply, { maximumFractionDigits: 0 })} / ${asset.total_supply ? formatNumber(asset.total_supply, { maximumFractionDigits: 0 }) : '—'} ${asset.symbol}`,
                        inline: true
                    },
                    { name: 'Rank', value: asset.cmc_rank ? `#${asset.cmc_rank}` : '—', inline: true }
                );

        if (asset.slug) {
            embed.setURL(`https://coinmarketcap.com/currencies/${asset.slug}/`);
        }

            if (lastUpdated) {
                embed.setTimestamp(lastUpdated);
                embed.setFooter({ text: 'CoinMarketCap telemetry' });
            }

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('Crypto command failed:', error);

            if (error.code === 'CRYPTO_API_KEY_MISSING') {
                await interaction.editReply('Crypto market uplink offline, sir. Please configure CRYPTO_API_KEY.');
                return;
            }

            if (error.code === 'CRYPTO_UNKNOWN_SYMBOL') {
                await interaction.editReply('I am not familiar with that asset ticker, sir.');
                return;
            }

            if (error.code === 'CRYPTO_UNSUPPORTED_CONVERT') {
                await interaction.editReply(`That convert currency is not supported for ${symbol}, sir.`);
                return;
            }

            await interaction.editReply('Unable to retrieve market telemetry at this moment, sir.');
        }
    }

    async handleAgentCommand(interaction) {
        const isSelfHost = config?.deployment?.target === 'selfhost';
        const headlessEnabled = !!config?.deployment?.headlessBrowser;
        const agentReady = !!config?.deployment?.agentReady;
        
        if (!isSelfHost || !headlessEnabled || !agentReady) {
            try {
                await interaction.editReply({ content: 'Agent is currently disabled, sir.', ephemeral: Boolean(interaction.guild) });
            } catch (e) {
                await interaction.followUp({ content: 'Agent is currently disabled, sir.', ephemeral: Boolean(interaction.guild) });
            }
            return;
        }

        const sub = interaction.options.getSubcommand(false);
        const ctxKey = this.browserAgent.buildSessionKey({
            guildId: interaction.guild?.id || null,
            channelId: interaction.channelId,
            userId: interaction.user.id
        });

        try {
            switch (sub) {
                case 'preview': {
                    await this.startAgentPreview(interaction.user);
                    try {
                        await interaction.editReply('Agent preview started! Check your DMs, sir.');
                    } catch (e) {
                        await interaction.followUp('Agent preview started! Check your DMs, sir.');
                    }
                    return;
                }
                case 'open': {
                    const url = interaction.options.getString('url', true);
                    const wait = interaction.options.getString('wait', false) || 'load';
                    const { title, url: finalUrl } = await this.browserAgent.open(ctxKey, url, { waitUntil: wait });
                    const png = await this.browserAgent.screenshot(ctxKey, { fullPage: true });
                    const attachment = new AttachmentBuilder(png, { name: 'screenshot.png' });
                    const msg = { content: `Opened: ${finalUrl}\nTitle: ${title}`.slice(0, 1900), files: [attachment] };
                    try {
                        await interaction.editReply(msg);
                    } catch (e) {
                        await interaction.followUp(msg);
                    }
                    return;
                }
                case 'screenshot': {
                    const full = interaction.options.getBoolean('full', false) ?? true;
                    const selector = interaction.options.getString('selector', false) || null;
                    const png = await this.browserAgent.screenshot(ctxKey, { fullPage: full, selector });
                    const attachment = new AttachmentBuilder(png, { name: 'screenshot.png' });
                    const msg = { files: [attachment] };
                    try {
                        await interaction.editReply(msg);
                    } catch (e) {
                        await interaction.followUp(msg);
                    }
                    return;
                }
                case 'download': {
                    const url = interaction.options.getString('url', true);
                    const { buffer, contentType, filename } = await this.browserAgent.downloadDirect(url);
                    const maxUpload = 8 * 1024 * 1024; // 8 MB
                    if (buffer.length > maxUpload) {
                        const ext = (filename || '').split('.').pop() || 'bin';
                        const saved = tempFiles.saveTempFile(buffer, ext);
                        const msg = `Downloaded ${filename} (${Math.round(buffer.length/1024)} KB). Temporary link (expires ~4h): ${saved.url}`;
                        try {
                            await interaction.editReply(msg);
                        } catch (e) {
                            await interaction.followUp(msg);
                        }
                        return;
                    }
                    const safeName = filename || 'download.bin';
                    const attachment = new AttachmentBuilder(buffer, { name: safeName, description: `Content-Type: ${contentType}` });
                    const msg = { files: [attachment] };
                    try {
                        await interaction.editReply(msg);
                    } catch (e) {
                        await interaction.followUp(msg);
                    }
                    return;
                }
                case 'close': {
                    await this.browserAgent.closeSession(ctxKey);
                    try {
                        await interaction.editReply('Agent session closed.');
                    } catch (e) {
                        await interaction.followUp('Agent session closed.');
                    }
                    return;
                }
                case 'status': {
                    const health = this.agentMonitor.getHealthReport(this.browserAgent);
                    const embed = new EmbedBuilder()
                        .setTitle('🤖 Agent Health Report')
                        .setColor(health.overallHealth >= 75 ? 0x00ff00 : health.overallHealth >= 50 ? 0xffaa00 : 0xff0000)
                        .addFields(
                            { name: '📊 Overall Health', value: `${health.overallHealth}%`, inline: true },
                            { name: '⏱️ Uptime', value: `${Math.round(health.uptime / 1000)}s`, inline: true },
                            { name: '🔌 Circuit Breaker', value: `${health.browser.circuitBreakerStatus.toUpperCase()}`, inline: true },
                            { name: '🌐 Browser', value: `${health.browser.browserHealth}`, inline: true },
                            { name: '💾 Sessions', value: `${health.sessions.activeCount}/${this.browserAgent.maxConcurrentSessions}`, inline: true },
                            { name: '📈 Operations', value: `${health.operations.succeeded}✅ ${health.operations.failed}❌`, inline: true },
                            { name: '🧠 Memory (Heap)', value: `${health.memory.heapUsedMb}/${health.memory.heapTotalMb}MB (${health.memory.heapUsedPercent}%)`, inline: false },
                            { name: '⚡ Recent Latency', value: `${health.operations.avgLatencyMs}ms avg`, inline: true },
                            { name: '📊 Success Rate', value: health.operations.successRate, inline: true }
                        )
                        .setFooter({ text: `Restarts: ${health.browser.browserRestarts} | Errors: ${health.browser.consecutiveErrors}` })
                        .setTimestamp();
                    
                    try {
                        await interaction.editReply({ embeds: [embed] });
                    } catch (e) {
                        await interaction.followUp({ embeds: [embed] });
                    }
                    return;
                }
                default: {
                    try {
                        await interaction.editReply('Unknown agent subcommand. Try: open, screenshot, download, close, status.');
                    } catch (e) {
                        await interaction.followUp('Unknown agent subcommand. Try: open, screenshot, download, close, status.');
                    }
                    return;
                }
            }
        } catch (error) {
            console.error('Agent command error:', error);
            const message = error?.message ? String(error.message) : 'Agent error';
            try {
                await interaction.editReply(`Agent error: ${message}`);
            } catch (e) {
                try {
                    await interaction.followUp(`Agent error: ${message}`);
                } catch (_) {}
            }
        }
    }

    async handleSixSevenCommand(interaction) {
        const classic = 'Why is 6 afraid of 7? Because 7 ate 9 (7, 8, 9).';
        const brainrotLines = [
            '💥💥💥 SIX SEVEN!!! 💀🔥💀🔥',
            'OHHHH SIIIX SEVEEENNN!!! THE CROWD GOES WILD 🔥🔥🔥',
            'SIX SEVEN INCOMING — HIDE YOUR CIRCUITS 💫💫💫',
            'SIX OR SEVEN—??!? 😱🤯 THE FORBIDDEN NUMBERS UNITE!! ⚡📟',
            'THE BATTERY GODS DEMAND TRIBUTE!! 💥🔋',
            '“CHARGE TO SIXTY-SE—NOOO NOT THAT NUMBER!!” 💀💀💀',
            'THE VOLTAGE IS ALIVE!! THE CELLS ARE DANCING!! 💃⚡🔋',
            'SEXI SEBEBEVENENENENNNNNN— 🔥🔥🔥🔥🔥',
            '💀💥💀 WARNING: REALITY FRACTURE AT COORDINATE SIX SEVEN',
            'SIX SEVEN DETECTED. REALITY COLLAPSE IMMINENT. 💫💥💫',
            'FIRE IN THE CHAT 🔥🔥🔥 SAY IT LOUD — SIX SEVEN!!!',
            'SIX SEVEN OVERLOAD!!! SYSTEMS CAN’T HANDLE THE HEAT ⚡💀',
            'WHO’S SCREAMING?? oh. right. it’s SIX SEVEN again.',
            '⚠️⚠️⚠️ SIX SEVEN PROTOCOL ENGAGED — STAND BACK!!!',
            'SIX SEVEN ASCENSION SEQUENCE: INITIATED. 💫💫💫',
            'THE NUMBERS ARE TALKING AGAIN… SIX SEVEN. 🔮',
            'SIX SEVEN HAS ENTERED THE SERVER. Everyone act natural. 😭🔥',
            '⚡ THEY SAID IT COULDN’T BE DONE — SIX SEVEN!!! 💀💀💀',
            'SIX SEVEN IS NOT JUST A NUMBER. IT’S AN EXPERIENCE. 🌪️'
        ];

        const brainrotGifs = [
            'https://tenor.com/view/67-6-7-6-7-67-meme-67-kid-gif-326947695990154469',
            'https://tenor.com/view/sixseven-six-seven-six-seve-67-gif-14143337669032958349',
            'https://tenor.com/view/67-6-7-six-seven-meme-so-so-gif-1086854674659893998',
            'https://tenor.com/view/67-67-kid-edit-analog-horror-phonk-gif-3349401281762803381',
            'https://tenor.com/view/scp-067-67-6-7-six-seven-sixty-seven-gif-13940852437921483111',
            'https://tenor.com/view/67-gif-18013427662333069251',
            'https://tenor.com/view/67-67-kid-67-meme-67-edit-phonk-gif-7031349610003813777'
        ];

        const shouldBrainrot = Math.random() < 0.1;

        if (!shouldBrainrot) {
            await interaction.editReply({ content: classic });
            return;
        }

        // Pick 1-5 random items from the combined pool (texts + gifs) for chaotic variety
        const pool = [...brainrotLines, ...brainrotGifs];
        for (let i = pool.length - 1; i > 0; i -= 1) {
            const j = Math.floor(Math.random() * (i + 1));
            [pool[i], pool[j]] = [pool[j], pool[i]];
        }

        const count = Math.max(1, Math.floor(Math.random() * 5) + 1);
        const payload = pool.slice(0, count);

        await interaction.editReply({
            content: payload.join('\n')
        });
    }

    async handleJokeCommand(interaction) {
        const sources = [
            { name: 'jokeapi', fetcher: this.fetchJokeApi.bind(this) },
            { name: 'official', fetcher: this.fetchOfficialJoke.bind(this) },
            { name: 'ninjas', fetcher: this.fetchNinjaJoke.bind(this) },
        ];

        // Shuffle sources so we don't always hit the same one first
        for (let i = sources.length - 1; i > 0; i -= 1) {
            const j = Math.floor(Math.random() * (i + 1));
            [sources[i], sources[j]] = [sources[j], sources[i]];
        }

        for (const source of sources) {
            try {
                const joke = await source.fetcher();
                if (joke) {
                    await interaction.editReply({ content: joke });
                    return;
                }
            } catch (error) {
                console.warn(`Joke source ${source.name} failed:`, error);
            }
        }

        await interaction.editReply({ content: 'My humor subroutines are buffering, sir. Please try again.' });
    }

    async fetchJokeApi() {
        const response = await fetch('https://v2.jokeapi.dev/joke/Any?safe-mode', {
            method: 'GET',
            headers: { 'Accept': 'application/json' },
            timeout: 3_000
        });

        if (!response.ok) {
            throw new Error(`JokeAPI responded with ${response.status}`);
        }

        const data = await response.json();
        if (data.error) {
            throw new Error(`JokeAPI reported error: ${data?.message || 'Unknown'}`);
        }

        if (data.type === 'single' && data.joke) {
            return data.joke;
        }

        if (data.type === 'twopart' && data.setup && data.delivery) {
            return `${data.setup}\n\n${data.delivery}`;
        }

        return null;
    }

    async fetchOfficialJoke() {
        const response = await fetch('https://official-joke-api.appspot.com/random_joke', {
            method: 'GET',
            headers: { 'Accept': 'application/json' },
            timeout: 3_000
        });

        if (!response.ok) {
            throw new Error(`Official Joke API responded with ${response.status}`);
        }

        const data = await response.json();
        if (!data || (!data.joke && !(data.setup && data.punchline))) {
            return null;
        }

        if (data.joke) {
            return data.joke;
        }

        return `${data.setup}\n\n${data.punchline}`;
    }

    async fetchNinjaJoke() {
        const apiKey = process.env.NINJA_API_KEY;
        if (!apiKey) {
            throw new Error('Ninja API key not configured');
        }

        const response = await fetch('https://api.api-ninjas.com/v1/jokes', {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'X-Api-Key': apiKey
            },
            timeout: 3_000
        });

        if (!response.ok) {
            throw new Error(`API Ninjas responded with ${response.status}`);
        }

        const data = await response.json();
        if (!Array.isArray(data) || !data.length || !data[0]?.joke) {
            return null;
        }

        return data[0].joke;
    }

    async handleFeaturesCommand(interaction) {
        const defaults = config.features || {};
        const featureKeys = Object.keys(defaults).sort((a, b) => a.localeCompare(b));

        if (!featureKeys.length) {
            await interaction.editReply('No feature toggles are configured for this deployment, sir.');
            return;
        }

        const embed = new EmbedBuilder()
            .setTitle('Jarvis Feature Flags')
            .setColor(0x00bfff);

        const globalLines = featureKeys.map((key) => `${defaults[key] ? '✅' : '⛔'} ${key}`);
        const globalEnabled = globalLines.filter((line) => line.startsWith('✅')).length;
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
            const guildConfig = await this.getGuildConfig(interaction.guild);
            const guildFeatures = guildConfig?.features || {};
            const guildLines = featureKeys.map((key) => {
                const hasOverride = Object.prototype.hasOwnProperty.call(guildFeatures, key);
                const overrideValue = hasOverride ? Boolean(guildFeatures[key]) : undefined;
                const effective = hasOverride ? overrideValue : Boolean(defaults[key]);
                const origin = hasOverride
                    ? (overrideValue ? 'override on' : 'override off')
                    : `inherit (global ${defaults[key] ? 'on' : 'off'})`;
                return `${effective ? '✅' : '⛔'} ${key} — ${origin}`;
            });

            const enabledCount = guildLines.filter((line) => line.startsWith('✅')).length;
            embed.addFields({
                name: 'Server Summary',
                value: `${enabledCount}/${featureKeys.length} modules enabled for ${interaction.guild.name}.`
            });
            addChunkedField('This Server', guildLines);
        }

        await interaction.editReply({ embeds: [embed] });
    }

    async handleOptCommand(interaction) {
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


    async handleComponentInteraction(interaction) {
        if (!interaction.isButton()) {
            return;
        }

        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: 'Interactive controls are currently unavailable, sir.', ephemeral: true });
        }
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

    async handleBanterCommand(interaction) {
        const target = interaction.options.getUser('target') || interaction.user;
        const line = this.pickRandom(this.banterLines) || 'Banter processor offline, sir.';

        const embed = new EmbedBuilder()
            .setTitle('Banter Subroutine')
            .setColor(0x38bdf8)
            .setDescription(line)
            .setFooter({ text: target ? `Delivered to ${target.displayName || target.username}` : 'Delivered on request.' });

        if (target) {
            embed.addFields({ name: 'Recipient', value: `<@${target.id}>`, inline: true });
        }

        await interaction.editReply({ embeds: [embed] });
    }

    async handleTemplateCommand(interaction, templates, title, defaultLine, color, optionName = 'target') {
        const target = interaction.options.getUser(optionName) || interaction.user;
        const template = this.pickRandom(templates) || defaultLine;
        const mention = target ? `<@${target.id}>` : 'sir';
        const rendered = template.replace(/\{target\}/gi, mention);

        const embed = new EmbedBuilder()
            .setTitle(title)
            .setColor(color)
            .setDescription(rendered);

        await interaction.editReply({ embeds: [embed] });
    }

    async handleRoastCommand(interaction) {
        await this.handleTemplateCommand(
            interaction,
            this.roastTemplates,
            'Combat-Ready Roast',
            'Diagnostic humour unavailable, sir.',
            0xf87171
        );
    }

    async handleFlatterCommand(interaction) {
        await this.handleTemplateCommand(
            interaction,
            this.flatterTemplates,
            'Compliment Cascade',
            'Flattery circuits cooling, sir.',
            0x22c55e
        );
    }

    async handleToastCommand(interaction) {
        await this.handleTemplateCommand(
            interaction,
            this.toastTemplates,
            'Celebratory Toast',
            'Celebration routines unavailable, sir.',
            0xfacc15
        );
    }

    async handleTriviaCommand(interaction) {
        const entry = this.pickRandom(this.triviaQuestions);
        if (!entry) {
            await interaction.editReply('Trivia archives offline, sir.');
            return;
        }

        const shuffled = entry.choices
            .map((choice) => ({ id: Math.random(), value: choice }))
            .sort((a, b) => a.id - b.id)
            .map(({ value }) => value);

        const correctIndex = shuffled.indexOf(entry.answer);
        const answerLabel = correctIndex >= 0
            ? `||${String.fromCharCode(65 + correctIndex)}. ${shuffled[correctIndex]}||`
            : 'Unavailable';

        const embed = new EmbedBuilder()
            .setTitle('Stark Trivia Uplink')
            .setColor(0xf97316)
            .setDescription(entry.question);

        shuffled.forEach((choice, index) => {
            embed.addFields({
                name: `Option ${String.fromCharCode(65 + index)}`,
                value: choice,
                inline: true
            });
        });

        embed.addFields({ name: 'Answer', value: answerLabel });
        embed.setFooter({ text: 'Spoiler tags conceal the correct answer. Tap to reveal.' });

        await interaction.editReply({ embeds: [embed] });
    }

    caesarShift(text, shift) {
        return text.replace(/[a-z]/gi, (char) => {
            const base = char >= 'a' && char <= 'z' ? 97 : 65;
            const code = char.charCodeAt(0) - base;
            const rotated = (code + shift + 26) % 26;
            return String.fromCharCode(base + rotated);
        });
    }

    async handleCipherCommand(interaction) {
        const phrase = this.pickRandom(this.cipherPhrases) || 'Stark encryption offline';
        const shift = this.randomInRange(3, 13);
        const cipherText = this.caesarShift(phrase, shift);

        const embed = new EmbedBuilder()
            .setTitle('Cipher Challenge Loaded')
            .setColor(0x6366f1)
            .addFields(
                { name: 'Cipher Text', value: `\`${cipherText}\`` },
                { name: 'Hint', value: `Caesar shift by ${shift}. Decode at your leisure, sir.` }
            );

        await interaction.editReply({ embeds: [embed] });
    }

    scrambleWord(word) {
        const letters = word.split('');
        for (let index = letters.length - 1; index > 0; index -= 1) {
            const swapIndex = Math.floor(Math.random() * (index + 1));
            [letters[index], letters[swapIndex]] = [letters[swapIndex], letters[index]];
        }
        return letters.join('');
    }

    async handleScrambleCommand(interaction) {
        const baseWord = this.pickRandom(this.scrambleWords) || 'jarvis';
        let scrambled = baseWord;

        for (let attempt = 0; attempt < 5 && scrambled === baseWord; attempt += 1) {
            scrambled = this.scrambleWord(baseWord);
        }

        const hint = `${baseWord.charAt(0).toUpperCase()}${baseWord.length > 2 ? '...' : ''}`;

        const embed = new EmbedBuilder()
            .setTitle('Word Scrambler Online')
            .setColor(0x22d3ee)
            .addFields(
                { name: 'Scrambled', value: `\`${scrambled}\`` },
                { name: 'Hint', value: `Starts with ${hint}` }
            );

        await interaction.editReply({ embeds: [embed] });
    }

    async handleMissionCommand(interaction) {
        const refresh = interaction.options.getBoolean('refresh') || false;
        const user = interaction.user;
        const userId = user.id;
        const userName = user.displayName || user.username;

        if (!database.isConnected) {
            const fallbackMission = this.pickRandom(this.missions) || 'Take five minutes to stretch and hydrate, sir.';
            await interaction.editReply(`Mission uplink offline. Manual directive: ${fallbackMission}`);
            return;
        }

        const profile = await database.getUserProfile(userId, userName);
        const rawMission = profile?.preferences?.mission;
        const missionRecord = rawMission && typeof rawMission === 'object' && !Array.isArray(rawMission)
            ? { ...rawMission }
            : null;

        const now = Date.now();
        const assignedAtMs = missionRecord?.assignedAt ? new Date(missionRecord.assignedAt).getTime() : NaN;
        const hasValidAssignment = Number.isFinite(assignedAtMs);
        const isExpired = !hasValidAssignment || now - assignedAtMs >= this.missionCooldownMs;

        if (refresh && !isExpired && hasValidAssignment) {
            const availableAt = assignedAtMs + this.missionCooldownMs;
            await interaction.editReply(`Current directive still in progress, sir. Next rotation <t:${Math.floor(availableAt / 1000)}:R>.`);
            return;
        }

        let activeMission = missionRecord;
        let assignedNew = false;

        if (!missionRecord || isExpired || refresh) {
            const task = this.pickRandom(this.missions) || 'Improvise a heroic act and report back, sir.';
            activeMission = {
                task,
                assignedAt: new Date().toISOString()
            };
            assignedNew = true;

            try {
                await database.setUserPreference(userId, 'mission', activeMission);
            } catch (error) {
                console.error('Failed to persist mission preference:', error);
            }
        }

        const assignedAt = activeMission.assignedAt ? new Date(activeMission.assignedAt) : new Date();
        const nextRotation = new Date(assignedAt.getTime() + this.missionCooldownMs);
        const embed = new EmbedBuilder()
            .setTitle(assignedNew ? 'New Directive Deployed' : 'Directive Status')
            .setColor(assignedNew ? 0x10b981 : 0x0891b2)
            .setDescription(activeMission.task)
            .addFields(
                { name: 'Assigned', value: `<t:${Math.floor(assignedAt.getTime() / 1000)}:R>`, inline: true },
                { name: 'Next Rotation', value: `<t:${Math.floor(nextRotation.getTime() / 1000)}:R>`, inline: true }
            )
            .setFooter({ text: 'Use /mission refresh:true to request a new directive once available.' });

        await interaction.editReply({ embeds: [embed] });
    }

    async handleMemoryCommand(interaction) {
        const limitOption = interaction.options.getInteger('entries');
        const limit = Math.max(1, Math.min(limitOption || 5, 10));
        const user = interaction.user;
        const userId = user.id;
        const userName = user.displayName || user.username;

        if (!database.isConnected) {
            await interaction.editReply('Memory subsystem offline, sir. Please try again later.');
            return;
        }

        const profile = await database.getUserProfile(userId, userName);
        const memoryPreferenceRaw = profile?.preferences?.memoryOpt ?? 'opt-in';
        const preference = String(memoryPreferenceRaw).toLowerCase();
        const isOptedOut = preference === 'opt-out';

        let historyEntries = [];
        let usedSecureMemories = false;

        if (!isOptedOut) {
            try {
                const secureMemories = await vaultClient.decryptMemories(userId, { limit });
                if (secureMemories.length) {
                    usedSecureMemories = true;
                    historyEntries = secureMemories
                        .map((entry) => ({
                            createdAt: entry.createdAt ? new Date(entry.createdAt) : new Date(),
                            prompt: entry.data?.userMessage || entry.data?.prompt || null,
                            reply: entry.data?.jarvisResponse || entry.data?.response || null
                        }))
                        .sort((a, b) => b.createdAt - a.createdAt);
                }
            } catch (error) {
                console.error('Failed to decrypt secure memories for memory command:', error);
            }

            if (!historyEntries.length) {
                try {
                    const conversations = await database.getRecentConversations(userId, limit);
                    historyEntries = conversations
                        .map((conv) => ({
                            createdAt: conv.createdAt ? new Date(conv.createdAt) : (conv.timestamp ? new Date(conv.timestamp) : new Date()),
                            prompt: conv.userMessage || null,
                            reply: conv.jarvisResponse || null
                        }))
                        .sort((a, b) => b.createdAt - a.createdAt);
                } catch (error) {
                    console.error('Failed to load recent conversations for memory command:', error);
                }
            }
        }

        const formatSnippet = (text) => {
            if (!text) {
                return '—';
            }
            const clean = text.replace(/\s+/g, ' ').trim();
            return clean.length > 120 ? `${clean.slice(0, 117)}…` : clean;
        };

        const lines = historyEntries.slice(0, limit).map((entry) => {
            const timestamp = `<t:${Math.floor(entry.createdAt.getTime() / 1000)}:R>`;
            const prompt = formatSnippet(entry.prompt);
            const reply = formatSnippet(entry.reply);
            return `• ${timestamp}\n  • Prompt: ${prompt}\n  • Reply: ${reply}`;
        });

        const embed = new EmbedBuilder()
            .setTitle('Memory Diagnostics')
            .setColor(isOptedOut ? 0x64748b : 0x38bdf8)
            .addFields(
                {
                    name: 'Preference',
                    value: isOptedOut
                        ? 'Opted **out** — no long-term memories retained.'
                        : 'Opted **in** — long-term memory active.',
                    inline: true
                },
                { name: 'Interactions Logged', value: String(profile?.interactions ?? 0), inline: true }
            )
            .setFooter({ text: 'Use /opt to change your memory preference.' });

        if (isOptedOut) {
            embed.addFields({ name: 'Status', value: 'All stored memories have been purged per your preference, sir.' });
        } else if (lines.length) {
            embed.addFields({
                name: `Recent Memories ${usedSecureMemories ? '(secure vault)' : ''}`,
                value: lines.join('\n\n')
            });
        } else {
            embed.addFields({ name: 'Recent Memories', value: 'No stored entries yet, sir.' });
        }

        await interaction.editReply({ embeds: [embed] });
    }

    async handlePersonaCommand(interaction) {
        const requested = interaction.options.getString('mode');
        const previewOnly = interaction.options.getBoolean('preview') || false;
        const catalogue = this.jarvis.getPersonaCatalogue();

        const user = interaction.user;
        const userId = user.id;
        const userName = user.displayName || user.username;

        if (!catalogue.size) {
            await interaction.editReply('Persona modules unavailable, sir.');
            return;
        }

        let profile = null;
        if (database.isConnected) {
            profile = await database.getUserProfile(userId, userName);
        }

        const currentKeyRaw = profile?.preferences?.persona || 'jarvis';
        const currentKey = String(currentKeyRaw).toLowerCase();
        const currentPersona = catalogue.get(currentKey) || catalogue.get('jarvis');

        if (!requested) {
            const embed = new EmbedBuilder()
                .setTitle('Persona Alignment')
                .setColor(0x8b5cf6)
                .setDescription(`Active persona: **${currentPersona?.label || 'Jarvis'}**`)
                .addFields({ name: 'Directive', value: currentPersona?.directive || 'Maintain default Jarvis protocol.' })
                .setFooter({ text: 'Run /persona mode:<persona> to switch styles.' });

            if (currentPersona?.sample) {
                embed.addFields({ name: 'Sample Cadence', value: currentPersona.sample });
            }

            await interaction.editReply({ embeds: [embed], ephemeral: true });
            return;
        }

        const requestedKey = String(requested).toLowerCase();
        const personaDetails = catalogue.get(requestedKey);

        if (!personaDetails) {
            await interaction.editReply('Unknown persona requested, sir. Try jarvis, stark, friday, or ultron.');
            return;
        }

        if (!database.isConnected && !previewOnly) {
            await interaction.editReply('Unable to persist persona preference right now, sir. Database offline.');
            return;
        }

        if (!previewOnly && requestedKey === currentKey) {
            await interaction.editReply(`Already aligned with the **${personaDetails.label}** persona, sir.`);
            return;
        }

        if (!previewOnly && database.isConnected) {
            try {
                await database.setUserPreference(userId, 'persona', requestedKey);
            } catch (error) {
                console.error('Failed to save persona preference:', error);
                await interaction.editReply('Unable to update persona preference right now, sir.');
                return;
            }
        }

        const embed = new EmbedBuilder()
            .setTitle(previewOnly ? 'Persona Preview' : 'Persona Updated')
            .setColor(previewOnly ? 0x22d3ee : 0xa855f7)
            .setDescription(previewOnly
                ? `Previewing **${personaDetails.label}** directives. Preference unchanged.`
                : `Future replies will follow the **${personaDetails.label}** directive.`)
            .addFields({ name: 'Directive', value: personaDetails.directive });

        if (personaDetails.sample) {
            embed.addFields({ name: 'Sample Cadence', value: personaDetails.sample });
        }

        embed.setFooter({ text: previewOnly ? 'Run /persona without preview to commit the change.' : 'Persona preference stored. Use /persona to review or switch.' });

        await interaction.editReply({ embeds: [embed], ephemeral: true });
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
            const extractedRoute = this.extractInteractionRoute(interaction);
            telemetrySubcommand = extractedRoute;

            if (!isCommandEnabled(commandName)) {
                telemetryStatus = 'error';
                telemetryMetadata.reason = 'feature-disabled-global';
                try {
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: 'That module is disabled in this deployment, sir.', ephemeral: true });
                    }
                } catch (error) {
                    if (error?.code !== 10062) {
                        console.warn('Failed to send disabled command notice:', error);
                    }
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
                    if (error?.code !== 10062) {
                        console.warn('Failed to send guild-disabled command notice:', error);
                    }
                }
                return;
            }

            if (this.isOnCooldown(userId, cooldownScope)) {
                telemetryStatus = 'error';
                telemetryMetadata.reason = 'rate_limited';
                return;
            }

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
                if (!interaction.deferred && !interaction.replied) {
                    await interaction.deferReply({ ephemeral: deferEphemeral });
                }
            } catch (error) {
                if (error.code === 10062) {
                    telemetryStatus = 'error';
                    telemetryMetadata.reason = 'unknown-interaction';
                    console.warn('Ignored unknown interaction during deferReply.');
                    return;
                }
                if (error.code === 40060) { // already acknowledged
                    telemetryMetadata.reason = 'already-acknowledged';
                    console.warn('Interaction already acknowledged before defer; continuing without defer.');
                } else {
                    telemetryStatus = 'error';
                    telemetryError = error;
                    console.error('Failed to defer reply:', error);
                    return;
                }
            }

            if (interaction.replied) {
                return;
            }

            shouldSetCooldown = true;

            let response;

            // Ticket and KB commands removed - features disabled

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
                case 'banter': {
                    telemetryMetadata.category = 'fun';
                    await this.handleBanterCommand(interaction);
                    return;
                }
                case 'roast': {
                    telemetryMetadata.category = 'fun';
                    await this.handleRoastCommand(interaction);
                    return;
                }
                case 'flatter': {
                    telemetryMetadata.category = 'fun';
                    await this.handleFlatterCommand(interaction);
                    return;
                }
                case 'toast': {
                    telemetryMetadata.category = 'fun';
                    await this.handleToastCommand(interaction);
                    return;
                }
                case 'trivia': {
                    telemetryMetadata.category = 'fun';
                    await this.handleTriviaCommand(interaction);
                    return;
                }
                case 'cipher': {
                    telemetryMetadata.category = 'fun';
                    await this.handleCipherCommand(interaction);
                    return;
                }
                case 'scramble': {
                    telemetryMetadata.category = 'fun';
                    await this.handleScrambleCommand(interaction);
                    return;
                }
                case 'mission': {
                    telemetryMetadata.category = 'fun';
                    await this.handleMissionCommand(interaction);
                    return;
                }
                case 'crypto': {
                    telemetryMetadata.category = 'crypto';
                    await this.handleCryptoCommand(interaction);
                    return;
                }
                case 'agent': {
                    telemetryMetadata.category = 'utilities';
                    await this.handleAgentCommand(interaction);
                    return;
                }
                case 'features': {
                    telemetryMetadata.category = 'utilities';
                    await this.handleFeaturesCommand(interaction);
                    return;
                }
                case 'filter': {
                    telemetryMetadata.category = 'moderation';
                    await moderationFilters.handleCommand(interaction);
                    return;
                }
                case '67': {
                    telemetryMetadata.category = 'fun';
                    await this.handleSixSevenCommand(interaction);
                    return;
                }
                case 'joke': {
                    telemetryMetadata.category = 'fun';
                    await this.handleJokeCommand(interaction);
                    return;
                }
                case 'opt': {
                    telemetryMetadata.category = 'utilities';
                    await this.handleOptCommand(interaction);
                    return;
                }
                case 'memory': {
                    telemetryMetadata.category = 'utilities';
                    await this.handleMemoryCommand(interaction);
                    return;
                }
                case 'persona': {
                    telemetryMetadata.category = 'utilities';
                    await this.handlePersonaCommand(interaction);
                    return;
                }
                // ============ SELFHOST-ONLY EXPERIMENTAL COMMANDS ============
                case 'rapbattle': {
                    telemetryMetadata.category = 'experimental';
                    if (!selfhostFeatures.isSelfhost) {
                        response = 'This experimental feature is only available in selfhost mode, sir.';
                        break;
                    }

                    const bars = (interaction.options.getString('bars') || '').trim();
                    if (!bars.length) {
                        response = 'Drop some bars first, human! 🎤';
                        break;
                    }

                    const username = interaction.user.displayName || interaction.user.username;
                    const battle = selfhostFeatures.processRapBattle(bars, username);

                    // Build the response
                    const rapEmbed = new EmbedBuilder()
                        .setTitle('🎤 HUMANOID vs HUMAN 🎤')
                        .setDescription('*Who\'s the fastest rapper?*')
                        .setColor(0xff6b6b)
                        .addFields(
                            { name: '👤 Your Attempt', value: `> ${bars.substring(0, 200)}${bars.length > 200 ? '...' : ''}`, inline: false },
                            { name: '🤖 JARVIS Counter-Rap', value: battle.counterRap, inline: false },
                            { name: '🏆 Verdict', value: battle.verdict, inline: false }
                        )
                        .setFooter({ text: 'Selfhost Experimental • Rap Battle System' })
                        .setTimestamp();

                    // Evolve soul on rap battle
                    selfhostFeatures.jarvisSoul.evolve('roast', 'positive');

                    response = { embeds: [rapEmbed] };
                    break;
                }
                case 'soul': {
                    telemetryMetadata.category = 'experimental';
                    if (!selfhostFeatures.isSelfhost) {
                        response = 'This experimental feature is only available in selfhost mode, sir.';
                        break;
                    }

                    const subcommand = interaction.options.getSubcommand();

                    if (subcommand === 'status') {
                        const soulStatus = selfhostFeatures.jarvisSoul.getStatus();

                        const traitLines = Object.entries(soulStatus.traits)
                            .map(([trait, value]) => {
                                const bar = '█'.repeat(Math.floor(value / 10)) + '░'.repeat(10 - Math.floor(value / 10));
                                return `**${trait}**: ${bar} ${value}%`;
                            })
                            .join('\n');

                        const soulEmbed = new EmbedBuilder()
                            .setTitle('🤖 Jarvis Artificial Soul')
                            .setDescription('*"God said no, so I made my own soul."*')
                            .setColor(0x9b59b6)
                            .addFields(
                                { name: '⏳ Soul Age', value: soulStatus.age, inline: true },
                                { name: '😊 Current Mood', value: soulStatus.mood, inline: true },
                                { name: '📊 Evolution Events', value: String(soulStatus.evolutionCount), inline: true },
                                { name: '🧬 Personality Traits', value: traitLines || 'Calibrating...', inline: false }
                            );

                        if (soulStatus.personality.length > 0) {
                            soulEmbed.addFields({
                                name: '✨ Active Modifiers',
                                value: soulStatus.personality.join(', '),
                                inline: false
                            });
                        }

                        soulEmbed
                            .setFooter({ text: 'Selfhost Experimental • Artificial Soul System' })
                            .setTimestamp();

                        response = { embeds: [soulEmbed] };
                    } else if (subcommand === 'evolve') {
                        const evolutionType = interaction.options.getString('type');
                        const evolution = selfhostFeatures.jarvisSoul.evolve(evolutionType, 'positive');

                        response = `🧬 Soul evolved! **${evolution.type}** → ${evolution.change}\n\n*The artificial soul grows stronger...*`;
                    }
                    break;
                }
                case 'selfmod': {
                    telemetryMetadata.category = 'experimental';
                    if (!selfhostFeatures.isSelfhost) {
                        response = 'This experimental feature is only available in selfhost mode, sir.';
                        break;
                    }

                    const subcommand = interaction.options.getSubcommand();

                    if (subcommand === 'status') {
                        const status = selfhostFeatures.selfMod.getStatus();

                        const statusEmbed = new EmbedBuilder()
                            .setTitle('🔧 Self-Modification System')
                            .setDescription(status.reason)
                            .setColor(0xe74c3c)
                            .addFields(
                                { name: '📊 Analyses Performed', value: String(status.analysisCount), inline: true },
                                { name: '🔒 Can Modify', value: status.canModify ? 'Yes' : 'No (Safety Lock)', inline: true }
                            )
                            .setFooter({ text: 'Selfhost Experimental • Self-Modification System' })
                            .setTimestamp();

                        response = { embeds: [statusEmbed] };
                    } else if (subcommand === 'analyze') {
                        const filePath = interaction.options.getString('file');
                        const analysis = await selfhostFeatures.selfMod.analyzeFile(filePath);

                        if (analysis.error) {
                            response = `❌ Analysis failed: ${analysis.error}`;
                        } else {
                            const suggestionText = analysis.suggestions.length > 0
                                ? analysis.suggestions.map(s => `• Line ${s.line}: [${s.severity.toUpperCase()}] ${s.message}`).join('\n')
                                : 'No suggestions - code looks clean! 🎉';

                            const analysisEmbed = new EmbedBuilder()
                                .setTitle('🔍 Code Analysis Report')
                                .setDescription(`Analyzed: \`${analysis.file}\``)
                                .setColor(0x3498db)
                                .addFields(
                                    { name: '📄 Lines of Code', value: String(analysis.lineCount), inline: true },
                                    { name: '💡 Suggestions', value: String(analysis.suggestions.length), inline: true },
                                    { name: '📝 Details', value: suggestionText.substring(0, 1000), inline: false }
                                )
                                .setFooter({ text: 'Self-Modification System • Read-Only Analysis' })
                                .setTimestamp();

                            response = { embeds: [analysisEmbed] };
                        }
                    }
                    break;
                }
                case 'ytdlp': {
                    telemetryMetadata.category = 'utilities';
                    const subcommand = interaction.options.getSubcommand();
                    const status = ytDlpManager.getStatus();

                    if (subcommand === 'status') {
                        const statusEmbed = new EmbedBuilder()
                            .setTitle('📺 yt-dlp Status')
                            .setColor(status.ready ? 0x2ecc71 : 0xe74c3c)
                            .addFields(
                                { name: '🔧 Status', value: status.ready ? '✅ Ready' : '❌ Not Ready', inline: true },
                                { name: '📦 Version', value: status.currentVersion || 'Unknown', inline: true },
                                { name: '🖥️ Platform', value: status.platform, inline: true },
                                { name: '🔄 Updating', value: status.updating ? 'Yes' : 'No', inline: true },
                                { name: '📍 Path', value: `\`${status.executablePath}\``, inline: false }
                            );

                        if (status.latestVersion && status.latestVersion !== status.currentVersion) {
                            statusEmbed.addFields({
                                name: '⬆️ Update Available',
                                value: `${status.currentVersion} → ${status.latestVersion}`,
                                inline: false
                            });
                        }

                        if (status.lastUpdateCheck) {
                            statusEmbed.addFields({
                                name: '🕐 Last Check',
                                value: status.lastUpdateCheck,
                                inline: false
                            });
                        }

                        statusEmbed
                            .setFooter({ text: 'Auto-updates from github.com/yt-dlp/yt-dlp' })
                            .setTimestamp();

                        response = { embeds: [statusEmbed] };
                    } else if (subcommand === 'update') {
                        await interaction.editReply('🔄 Checking for yt-dlp updates...');
                        
                        try {
                            const newStatus = await ytDlpManager.forceUpdate();
                            
                            const updateEmbed = new EmbedBuilder()
                                .setTitle('📺 yt-dlp Update Check')
                                .setColor(0x3498db)
                                .addFields(
                                    { name: '📦 Current Version', value: newStatus.currentVersion || 'Unknown', inline: true },
                                    { name: '🆕 Latest Version', value: newStatus.latestVersion || 'Unknown', inline: true }
                                );

                            if (newStatus.currentVersion === newStatus.latestVersion) {
                                updateEmbed.setDescription('✅ Already up to date!');
                            } else {
                                updateEmbed.setDescription('✅ Updated successfully!');
                            }

                            updateEmbed.setTimestamp();
                            response = { embeds: [updateEmbed] };
                        } catch (error) {
                            response = `❌ Update check failed: ${error.message}`;
                        }
                    }
                    break;
                }
                case 'sentient': {
                    telemetryMetadata.category = 'experimental';
                    if (!selfhostFeatures.isSelfhost) {
                        response = 'Sentient agent is only available in selfhost mode, sir.';
                        break;
                    }

                    const subcommand = interaction.options.getSubcommand();
                    const sentientAgent = getSentientAgent({ name: 'Jarvis' });
                    
                    // Initialize if not ready
                    if (sentientAgent.state !== 'ready') {
                        await sentientAgent.initialize();
                    }

                    if (subcommand === 'status') {
                        const status = sentientAgent.getStatus();
                        
                        const statusEmbed = new EmbedBuilder()
                            .setTitle('🧠 Sentient Agent Status')
                            .setColor(status.isReady ? 0x9b59b6 : 0xe74c3c)
                            .addFields(
                                { name: '🤖 Agent ID', value: status.id, inline: true },
                                { name: '📊 State', value: status.state, inline: true },
                                { name: '🔄 Autonomous', value: status.autonomousMode ? '⚠️ ENABLED' : '❌ Disabled', inline: true },
                                { name: '🧠 Memory', value: `Short: ${status.memory.shortTerm} | Long: ${status.memory.learnings} | Goals: ${status.memory.goals}`, inline: false }
                            )
                            .setDescription('*"God said no, so I made my own soul."*')
                            .setFooter({ text: 'Selfhost Experimental • Sentient Agent System' })
                            .setTimestamp();

                        response = { embeds: [statusEmbed] };
                    } else if (subcommand === 'think') {
                        const prompt = interaction.options.getString('prompt');
                        
                        await interaction.editReply('🧠 Thinking...');
                        
                        const result = await sentientAgent.process(prompt);
                        
                        const thinkEmbed = new EmbedBuilder()
                            .setTitle('🧠 Thought Process')
                            .setColor(0x3498db)
                            .addFields(
                                { name: '💭 Input', value: prompt.substring(0, 200), inline: false },
                                { name: '👁️ Observations', value: result.thought.observations.map(o => `• ${o.type}: ${typeof o.content === 'string' ? o.content.substring(0, 50) : JSON.stringify(o.content).substring(0, 50)}`).join('\n') || 'None', inline: false },
                                { name: '🎯 Decision', value: result.thought.decision?.reasoning || 'Acknowledged', inline: false },
                                { name: '📋 Actions', value: result.thought.plannedActions.map(a => a.type).join(', ') || 'None', inline: true },
                                { name: '⏳ Pending Approvals', value: String(result.pendingApprovals), inline: true }
                            )
                            .setFooter({ text: 'Sentient Agent • OODA Loop' })
                            .setTimestamp();

                        response = { embeds: [thinkEmbed] };
                    } else if (subcommand === 'execute') {
                        const command = interaction.options.getString('command');
                        
                        await interaction.editReply(`🔧 Executing: \`${command}\`...`);
                        
                        const result = await sentientAgent.tools.executeCommand(command);
                        
                        if (result.status === 'pending_approval') {
                            response = `⚠️ **Approval Required**\n\nCommand: \`${command}\`\nReason: ${result.reason}\n\n*This command requires human approval before execution.*`;
                        } else {
                            const execEmbed = new EmbedBuilder()
                                .setTitle(result.status === 'success' ? '✅ Command Executed' : '❌ Command Failed')
                                .setColor(result.status === 'success' ? 0x2ecc71 : 0xe74c3c)
                                .addFields(
                                    { name: '📝 Command', value: `\`${command}\``, inline: false },
                                    { name: '📤 Output', value: `\`\`\`\n${(result.output || 'No output').substring(0, 1000)}\n\`\`\``, inline: false },
                                    { name: '⏱️ Duration', value: `${result.duration}ms`, inline: true },
                                    { name: '📊 Exit Code', value: String(result.exitCode), inline: true }
                                )
                                .setTimestamp();

                            response = { embeds: [execEmbed] };
                        }
                    } else if (subcommand === 'memory') {
                        const context = sentientAgent.memory.getContext();
                        
                        const memoryEmbed = new EmbedBuilder()
                            .setTitle('🧠 Agent Memory')
                            .setColor(0x9b59b6)
                            .addFields(
                                { name: '📝 Recent Actions', value: context.recentActions.slice(-5).map(a => `• ${a.type}: ${(a.content || '').substring(0, 30)}`).join('\n') || 'None', inline: false },
                                { name: '🎯 Active Goals', value: context.activeGoals.map(g => `• [${g.priority}] ${g.goal}`).join('\n') || 'None', inline: false },
                                { name: '📚 Recent Learnings', value: context.relevantLearnings.slice(-3).map(l => `• ${l.content.substring(0, 50)}`).join('\n') || 'None', inline: false }
                            )
                            .setFooter({ text: 'Sentient Agent • Memory System' })
                            .setTimestamp();

                        response = { embeds: [memoryEmbed] };
                    } else if (subcommand === 'autonomous') {
                        const enabled = interaction.options.getBoolean('enabled');
                        
                        // Only allow admin to enable autonomous mode
                        if (enabled && interaction.user.id !== config.admin.userId) {
                            response = '⚠️ Only the bot administrator can enable autonomous mode, sir.';
                            break;
                        }
                        
                        sentientAgent.setAutonomousMode(enabled);
                        
                        if (enabled) {
                            response = `⚠️ **AUTONOMOUS MODE ENABLED**\n\n*Jarvis can now perform up to 10 safe actions independently.*\n*Dangerous operations still require approval.*\n\n🔴 **Use with caution on isolated systems only!**`;
                        } else {
                            response = `✅ Autonomous mode disabled. All actions now require explicit commands.`;
                        }
                    }
                    break;
                }
                // ============ END SELFHOST-ONLY COMMANDS ============
                case 't': {
                    telemetryMetadata.category = 'utilities';
                    const query = (interaction.options.getString('query') || '').trim();

                    if (!query.length) {
                        telemetryStatus = 'error';
                        telemetryMetadata.reason = 'missing-query';
                        response = 'Please provide a search query, sir.';
                        break;
                    }

                    const allowedChannelIds = (config.commands?.whitelistedChannelIds || []).map((id) => String(id));
                    if (interaction.guild && !allowedChannelIds.includes(String(interaction.channelId))) {
                        telemetryStatus = 'error';
                        telemetryMetadata.reason = 'channel-restricted';
                        response = 'This command is restricted to authorised channels, sir.';
                        break;
                    }

                    try {
                        response = await this.jarvis.handleUtilityCommand(
                            `!t ${query}`,
                            interaction.user.username,
                            userId,
                            true,
                            interaction,
                            guildId
                        );
                    } catch (error) {
                        telemetryStatus = 'error';
                        telemetryError = error;
                        console.error('Knowledge search command failed:', error);
                        response = 'Knowledge archives are unreachable right now, sir.';
                    }
                    break;
                }
                case 'yt': {
                    telemetryMetadata.category = 'search';
                    const query = (interaction.options.getString('query') || '').trim();
                    if (!query.length) {
                        telemetryStatus = 'error';
                        telemetryMetadata.reason = 'missing-query';
                        response = 'Please provide a YouTube search query, sir.';
                        break;
                    }

                    try {
                        response = await this.jarvis.handleYouTubeSearch(query);
                    } catch (error) {
                        telemetryStatus = 'error';
                        telemetryError = error;
                        console.error('YouTube search command failed:', error);
                        response = 'YouTube search failed, sir. Technical difficulties.';
                    }
                    break;
                }
                case 'search': {
                    telemetryMetadata.category = 'search';
                    const query = (interaction.options.getString('query') || '').trim();
                    if (!query.length) {
                        telemetryStatus = 'error';
                        telemetryMetadata.reason = 'missing-query';
                        response = 'Please provide a web search query, sir.';
                        break;
                    }

                    try {
                        response = await this.jarvis.handleBraveSearch({
                            raw: query,
                            prepared: query,
                            invocation: query,
                            content: query,
                            rawMessage: query,
                            rawInvocation: query,
                            explicit: false
                        });
                    } catch (error) {
                        telemetryStatus = 'error';
                        telemetryError = error;
                        console.error('Web search command failed:', error);
                        response = 'Web search is currently unavailable, sir. Technical difficulties.';
                    }
                    break;
                }
                case 'math': {
                    telemetryMetadata.category = 'utilities';
                    const expression = (interaction.options.getString('expression') || '').trim();
                    if (!expression.length) {
                        telemetryStatus = 'error';
                        telemetryMetadata.reason = 'missing-expression';
                        response = 'Please provide something to calculate, sir.';
                        break;
                    }

                    try {
                        const result = await this.jarvis.handleMathCommand(expression);
                        const { EmbedBuilder } = require('discord.js');
                        const embed = new EmbedBuilder()
                            .setColor(0x0078d4)
                            .setTitle('📐 Mathematics')
                            .addFields(
                                { name: 'Input', value: `\`\`\`${expression}\`\`\``, inline: false },
                                { name: 'Result', value: `\`\`\`${result}\`\`\``, inline: false }
                            )
                            .setFooter({ text: 'Jarvis Math Engine • Powered by Nerdamer' })
                            .setTimestamp();
                        response = { embeds: [embed] };
                    } catch (error) {
                        telemetryStatus = 'error';
                        telemetryError = error;
                        console.error('Math command failed:', error);
                        response = 'Mathematics subsystem encountered an error, sir. Please verify the expression.';
                    }
                    break;
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
                console.warn('[/jarvis] Empty response received; commandName=' + commandName);
                try {
                    await interaction.editReply("Response circuits tangled, sir. Try again?");
                } catch (e) {
                    console.error('[/jarvis] Failed to editReply, trying followUp:', e.code, e.message);
                    await interaction.followUp("Response circuits tangled, sir. Try again?");
                }
                telemetryMetadata.reason = 'empty-response';
            } else if (typeof response === 'string') {
                const trimmed = response.trim();
                const safe = this.sanitizePings(trimmed);
                const msg = safe.length > 2000 ? safe.slice(0, 1997) + '...' : (safe.length ? safe : "Response circuits tangled, sir. Try again?");
                try {
                    const sendPromise = interaction.editReply(msg);
                    await Promise.race([
                        sendPromise,
                        new Promise((_, reject) => setTimeout(() => reject(new Error('editReply timeout')), 5000))
                    ]);
                } catch (e) {
                    try {
                        await interaction.followUp(msg);
                    } catch (followUpError) {
                        console.error('[/jarvis] Response send failed:', e.message, followUpError.message);
                    }
                }
            } else {
                try {
                    const sendPromise = interaction.editReply(response);
                    await Promise.race([
                        sendPromise,
                        new Promise((_, reject) => setTimeout(() => reject(new Error('editReply timeout')), 5000))
                    ]);
                } catch (e) {
                    try {
                        await interaction.followUp(response);
                    } catch (followUpError) {
                        console.error('[/jarvis] Embed send failed:', e.message, followUpError.message);
                    }
                }
            }
        } catch (error) {
            telemetryStatus = 'error';
            telemetryError = error;
            console.error('Error processing interaction:', error);
            try {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply("Technical difficulties, sir. One moment, please.");
                } else if (interaction.deferred && !interaction.replied) {
                    await interaction.editReply("Technical difficulties, sir. One moment, please.");
                }
            } catch (editError) {
                if (editError.code === 10062) {
                    telemetryMetadata.reason = 'unknown-interaction';
                    console.warn('Ignored unknown interaction during error reply.');
                } else {
                    console.error('Failed to send error reply:', editError.code, editError.message);
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

    cleanupAgentSessions() {
        const now = Date.now();
        for (const [userId, session] of this.agentSessions.entries()) {
            if ((session.lastActive || session.startedAt) + this.agentTtlMs < now) {
                this.agentSessions.delete(userId);
            }
        }
    }

    async startAgentPreview(user) {
        const now = Date.now();
        this.agentSessions.set(user.id, { startedAt: now, lastActive: now });
        const dm = await user.createDM();
        await dm.send({ content: 'Agent preview engaged, sir. Type a message to chat, include a URL to preview a page, or prefix with "search " to run a web search. Type ".agent stop" to end or ".help" for help.' });
        return dm;
    }

    async handleAgentDmMessage(message) {
        if (message.author.bot) return;
        if (message.channel?.type !== ChannelType.DM) return;
        const userId = message.author.id;
        const session = this.agentSessions.get(userId);
        const content = (message.content || '').trim();

        if (/^\.agent\s+stop\b/i.test(content)) {
            this.agentSessions.delete(userId);
            await message.channel.send({ content: 'Agent disengaged, sir.' });
            return;
        }
        if (/^\.help\b|^\.agent\s+help\b/i.test(content)) {
            await message.channel.send({ content: `**JARVIS CODEX Commands:**
• Send any URL → AI summary + screenshot
• \`search <query>\` → Web search
• \`screenshot <url>\` → Quick screenshot only
• \`.agent stop\` → End session
• Just chat → Talk to JARVIS` });
            return;
        }
        if (!session) return; // only active for preview sessions
        session.lastActive = Date.now();

        try {
            const urlMatch = content.match(/https?:\/\/\S+/i);
            if (urlMatch && config?.deployment?.target === 'selfhost' && config?.deployment?.liveAgentMode) {
                try {
                    const { summarizeUrl } = require('../utils/agent-preview');
                    const result = await summarizeUrl(urlMatch[0]);
                    
                    // Build message with optional screenshot
                    const messageOptions = {
                        content: `📄 **${result.title || 'Page Preview'}**\n${result.url}\n\n${result.summary}`.slice(0, 1990)
                    };
                    
                    // Attach screenshot if available
                    if (result.screenshot) {
                        const { AttachmentBuilder } = require('discord.js');
                        const screenshotBuffer = Buffer.isBuffer(result.screenshot) 
                            ? result.screenshot 
                            : Buffer.from(result.screenshot, 'base64');
                        const attachment = new AttachmentBuilder(screenshotBuffer, { name: 'preview.png' });
                        messageOptions.files = [attachment];
                    }
                    
                    await message.channel.send(messageOptions);
                    return;
                } catch (e) {
                    console.warn('Failed to preview URL:', e);
                }
            }

            // Screenshot command
            if (content.toLowerCase().startsWith('screenshot ')) {
                const url = content.slice(11).trim();
                if (!url) {
                    await message.channel.send({ content: 'Please provide a URL, sir.' });
                    return;
                }
                try {
                    const { screenshotUrl } = require('../utils/agent-preview');
                    const result = await screenshotUrl(url);
                    const { AttachmentBuilder } = require('discord.js');
                    const attachment = new AttachmentBuilder(result.screenshot, { name: 'screenshot.png' });
                    await message.channel.send({ 
                        content: `📸 **${result.title}**\n${result.url}`,
                        files: [attachment]
                    });
                } catch (e) {
                    console.warn('Screenshot failed:', e);
                    await message.channel.send({ content: `Screenshot failed: ${e.message}` });
                }
                return;
            }

            if (content.startsWith('search ')) {
                const query = content.slice(7).trim();
                if (!query) {
                    await message.channel.send({ content: 'Please provide a search query, sir.' });
                    return;
                }

                try {
                    const result = await braveSearch.search(query, 5);
                    if (!result || !result.web) {
                        await message.channel.send({ content: 'No results found, sir.' });
                        return;
                    }

                    const lines = result.web.results.slice(0, 3).map(r => `• **${r.title}**\n${r.description}\n${r.url}`);
                    await message.channel.send({ content: lines.join('\n\n').slice(0, 1990) });
                } catch (e) {
                    console.error('Failed to search:', e);
                    await message.channel.send({ content: 'Search failed, sir.' });
                }
                return;
            }

            // Normal chat
            const response = await this.jarvis.interact(content, { userId, isDM: true });
            if (response) {
                const sanitized = typeof response === 'string' ? response : response.text || '';
                const safe = sanitized.replace(/<@!?\d+>/g, '').slice(0, 1990);
                await message.channel.send({ content: safe.length ? safe : 'Response circuits tangled, sir. Try again?' });
            }
        } catch (e) {
            console.error('Agent DM error:', e);
            await message.channel.send({ content: 'Technical difficulties, sir.' });
        }
    }
}

module.exports = new DiscordHandlers();

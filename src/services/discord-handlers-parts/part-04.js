
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

        if (subcommand === 'edit') {
            const messageInput = interaction.options.getString('message');
            const idMatch = messageInput?.match(/(\d{17,20})$/);
            const messageId = idMatch ? idMatch[1] : messageInput;
            const newPairsInput = interaction.options.getString('add_pairs');
            const removePairsInput = interaction.options.getString('remove_pairs');
            const newTitle = interaction.options.getString('title');
            const newDescription = interaction.options.getString('description');

            if (!messageId) {
                await interaction.editReply('Please provide a valid message ID or link, sir.');
                return;
            }

            // Check if at least one edit option is provided
            if (!newPairsInput && !removePairsInput && !newTitle && !newDescription) {
                await interaction.editReply('Please provide at least one thing to edit: add_pairs, remove_pairs, title, or description, sir.');
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

            // Fetch the original message
            let targetChannel, panelMessage;
            try {
                targetChannel = await guild.channels.fetch(record.channelId);
                if (!targetChannel?.isTextBased()) {
                    await interaction.editReply('The channel for that panel no longer exists or is inaccessible, sir.');
                    return;
                }
                panelMessage = await targetChannel.messages.fetch(record.messageId);
            } catch (error) {
                console.error('Failed to fetch reaction role message:', error);
                await interaction.editReply('I could not find that panel message, sir. It may have been deleted.');
                return;
            }

            const me = guild.members.me || await guild.members.fetchMe();
            if (!me) {
                await interaction.editReply('I could not verify my permissions in that server, sir.');
                return;
            }

            // Parse new pairs if provided
            let newOptions = [];
            if (newPairsInput) {
                try {
                    newOptions = await this.parseReactionRolePairs(newPairsInput, guild);
                } catch (error) {
                    await interaction.editReply(error.message || 'Those role mappings confused me, sir.');
                    return;
                }

                // Check for duplicate emojis with existing options
                const existingKeys = new Set(record.options.map(o => o.matchKey));
                const duplicates = newOptions.filter(o => existingKeys.has(o.matchKey));
                if (duplicates.length > 0) {
                    await interaction.editReply(`These emojis are already on the panel: ${duplicates.map(d => d.display).join(', ')}. Please use different emojis, sir.`);
                    return;
                }

                // Check total limit (20 reactions max)
                if (record.options.length + newOptions.length > 20) {
                    await interaction.editReply(`Adding ${newOptions.length} roles would exceed the 20-reaction limit (current: ${record.options.length}), sir.`);
                    return;
                }

                // Check role hierarchy
                const unusableRole = newOptions.find(option => {
                    const role = guild.roles.cache.get(option.roleId);
                    if (!role) return false;
                    return me.roles.highest.comparePositionTo(role) <= 0;
                });

                if (unusableRole) {
                    await interaction.editReply(`My highest role must be above ${guild.roles.cache.get(unusableRole.roleId)?.name || 'that role'}, sir.`);
                    return;
                }
            }

            // Process removals if provided
            let removedOptions = [];
            let usersAffected = 0;
            if (removePairsInput) {
                // Parse emojis to remove
                const emojisToRemove = removePairsInput.split(/[,\s]+/).map(e => e.trim()).filter(Boolean);
                const removeKeys = new Set();
                
                for (const emojiInput of emojisToRemove) {
                    const parsedEmoji = parseEmoji(emojiInput);
                    if (parsedEmoji) {
                        const key = parsedEmoji.id || parsedEmoji.name;
                        if (key) removeKeys.add(key);
                    }
                }
                
                if (removeKeys.size > 0) {
                    // Find options to remove
                    removedOptions = record.options.filter(o => removeKeys.has(o.matchKey));
                    
                    if (removedOptions.length === 0) {
                        await interaction.editReply('None of those emojis are currently on the panel, sir.');
                        return;
                    }
                    
                    // Remove roles from users who have them
                    for (const removedOption of removedOptions) {
                        try {
                            const role = guild.roles.cache.get(removedOption.roleId);
                            if (role && me.roles.highest.comparePositionTo(role) > 0) {
                                // Fetch reaction users and remove their roles
                                const reaction = panelMessage.reactions.cache.find(r => {
                                    const key = r.emoji.id || r.emoji.name;
                                    return key === removedOption.matchKey;
                                });
                                
                                if (reaction) {
                                    // Fetch all users who reacted
                                    const users = await reaction.users.fetch();
                                    for (const [userId, user] of users) {
                                        if (user.bot) continue;
                                        try {
                                            const member = await guild.members.fetch(userId);
                                            if (member && member.roles.cache.has(removedOption.roleId)) {
                                                await member.roles.remove(removedOption.roleId);
                                                usersAffected++;
                                            }
                                        } catch (memberError) {
                                            // User may have left the server
                                        }
                                    }
                                    
                                    // Remove the reaction from the message
                                    try {
                                        await reaction.remove();
                                    } catch (reactionError) {
                                        console.warn('Failed to remove reaction:', reactionError);
                                    }
                                }
                            }
                        } catch (roleError) {
                            console.error('Error removing role from users:', roleError);
                        }
                    }
                    
                    // Filter out removed options from record
                    record.options = record.options.filter(o => !removeKeys.has(o.matchKey));
                }
            }

            // Build updated record
            const updatedTitle = newTitle || record.title || 'Select your roles';
            const updatedDescription = newDescription || record.description || 'React with the options below to toggle roles, sir.';
            const updatedOptions = [...record.options, ...newOptions];

            // Build updated embed
            const optionLines = updatedOptions.map(option => `${option.display} — <@&${option.roleId}>`).join('\n');
            const embedDescription = updatedDescription ? `${updatedDescription}\n\n${optionLines}` : optionLines;

            const embed = new EmbedBuilder()
                .setTitle(updatedTitle)
                .setDescription(embedDescription)
                .setColor(0x5865f2)
                .setFooter({ text: 'React to add or remove roles.' });

            // Update the message
            try {
                await panelMessage.edit({ embeds: [embed] });
            } catch (error) {
                console.error('Failed to edit reaction role message:', error);
                await interaction.editReply('I could not edit that panel message, sir. Check my permissions.');
                return;
            }

            // Add new reactions if new pairs were added
            if (newOptions.length > 0) {
                try {
                    for (const option of newOptions) {
                        await panelMessage.react(option.rawEmoji);
                    }
                } catch (error) {
                    console.error('Failed to add new reactions:', error);
                    await interaction.editReply('The panel was updated but I could not add some of the new reactions, sir.');
                    // Continue to save the database update anyway
                }
            }

            // Update database
            try {
                await database.saveReactionRoleMessage({
                    ...record,
                    options: updatedOptions,
                    title: updatedTitle,
                    description: updatedDescription,
                    updatedBy: interaction.user.id
                });
            } catch (error) {
                console.error('Failed to update reaction role configuration:', error);
                await interaction.editReply('I updated the panel but could not save the configuration, sir.');
                return;
            }

            const changes = [];
            if (newTitle) changes.push('title');
            if (newDescription) changes.push('description');
            if (newOptions.length > 0) changes.push(`${newOptions.length} new role(s)`);
            if (removedOptions.length > 0) changes.push(`removed ${removedOptions.length} role(s)${usersAffected > 0 ? ` from ${usersAffected} user(s)` : ''}`);

            const messageUrl = panelMessage.url || `https://discord.com/channels/${guild.id}/${record.channelId}/${record.messageId}`;
            await interaction.editReply(`Panel updated (${changes.join(', ')}), sir. [Jump to message](${messageUrl})`);
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

    async handleModalSubmit(interaction) {
        if (!interaction?.isModalSubmit?.()) {
            return;
        }

        const customId = String(interaction.customId || '');
        if (!customId.startsWith('announcement:create:')) {
            return;
        }

        try {
            await interaction.deferReply({ ephemeral: true });
        } catch (error) {
            if (error?.code !== 40060) {
                console.warn('Failed to defer modal reply:', error);
                return;
            }
        }

        const token = customId.slice('announcement:create:'.length);
        const pending = this.pendingAnnouncementCreates.get(token);
        if (!pending) {
            await interaction.editReply('That announcement form expired, sir. Please run `/announcement create` again.');
            return;
        }

        if (pending.createdByUserId !== interaction.user.id) {
            await interaction.editReply('That announcement request is not yours to submit, sir.');
            return;
        }

        this.pendingAnnouncementCreates.delete(token);

        const announcementScheduler = require('./announcement-scheduler');
        const guildId = pending.guildId;
        const channelId = pending.channelId;

        const message = String(interaction.fields.getTextInputValue('message') || '').trim();
        if (!message) {
            await interaction.editReply('Message is required, sir.');
            return;
        }

        try {
            const enabledInGuild = await announcementScheduler.countEnabledForGuild(guildId);
            if (enabledInGuild >= 10) {
                await interaction.editReply('This server already has the maximum of 10 active announcements, sir.');
                return;
            }

            const enabledInChannel = await announcementScheduler.countEnabledForChannel(guildId, channelId);
            if (enabledInChannel >= 2) {
                await interaction.editReply('That channel already has the maximum of 2 active announcements, sir.');
                return;
            }

            const doc = await announcementScheduler.createAnnouncement({
                guildId,
                channelId,
                message,
                roleIds: Array.isArray(pending.roleIds) ? pending.roleIds : [],
                createdByUserId: pending.createdByUserId,
                delayAmount: pending.delayAmount,
                delayUnit: pending.delayUnit,
                repeatEvery: pending.repeatEvery,
                repeatUnit: pending.repeatUnit
            });

            const when = doc.nextRunAt ? `<t:${Math.floor(new Date(doc.nextRunAt).getTime() / 1000)}:F>` : 'Unknown';
            const repeating = doc.repeatEvery && doc.repeatUnit
                ? `Repeats every ${doc.repeatEvery} ${doc.repeatUnit}.`
                : 'One-time announcement.';

            await interaction.editReply(`✅ Announcement scheduled, sir.\n**ID:** \`${doc.id}\`\n**Channel:** <#${doc.channelId}>\n**Next:** ${when}\n${repeating}`);
        } catch (error) {
            console.error('[/announcement] Modal submit failed:', error);
            await interaction.editReply('Announcement scheduling failed internally, sir.');
        }
    }

    async handleAnnouncementCommand(interaction) {
        const announcementScheduler = require('./announcement-scheduler');
        const guildId = interaction.guildId;
        const userId = interaction.user.id;
        const subcommand = interaction.options.getSubcommand();

        if (!guildId) {
            if (!interaction.deferred && !interaction.replied) {
                await interaction.reply({ content: 'Announcements are only available in servers, sir.', ephemeral: true });
            } else {
                await interaction.editReply('Announcements are only available in servers, sir.');
            }
            return;
        }

        const guild = interaction.guild || await interaction.client.guilds.fetch(guildId).catch(() => null);
        const memberPermissions = interaction.memberPermissions || interaction.member?.permissions;
        const isOwner = Boolean(guild && guild.ownerId === userId);
        const hasBan = Boolean(memberPermissions?.has(PermissionsBitField.Flags.BanMembers));
        const hasTimeout = Boolean(memberPermissions?.has(PermissionsBitField.Flags.ModerateMembers));
        if (!isOwner && !(hasBan && hasTimeout)) {
            if (!interaction.deferred && !interaction.replied) {
                await interaction.reply({
                    content: 'Only the server owner or moderators with ban + timeout permissions may use announcements, sir.',
                    ephemeral: true
                });
            } else {
                await interaction.editReply('Only the server owner or moderators with ban + timeout permissions may use announcements, sir.');
            }
            return;
        }

        try {
            if (subcommand === 'create') {
                const channel = interaction.options.getChannel('channel');
                const delayAmount = interaction.options.getInteger('in');
                const delayUnit = interaction.options.getString('unit');
                const repeatEvery = interaction.options.getInteger('every');
                const repeatUnit = interaction.options.getString('every_unit');

                if (repeatEvery && !repeatUnit) {
                    if (!interaction.deferred && !interaction.replied) {
                        await interaction.reply({ content: 'If you set `every`, you must also set `every_unit`, sir.', ephemeral: true });
                    } else {
                        await interaction.editReply('If you set `every`, you must also set `every_unit`, sir.');
                    }
                    return;
                }

                if (!repeatEvery && repeatUnit) {
                    if (!interaction.deferred && !interaction.replied) {
                        await interaction.reply({ content: 'If you set `every_unit`, you must also set `every`, sir.', ephemeral: true });
                    } else {
                        await interaction.editReply('If you set `every_unit`, you must also set `every`, sir.');
                    }
                    return;
                }

                const roleIds = [
                    interaction.options.getRole('role1')?.id,
                    interaction.options.getRole('role2')?.id,
                    interaction.options.getRole('role3')?.id
                ].filter(Boolean);

                const token = `anncreate_${guildId}_${userId}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
                this.pendingAnnouncementCreates.set(token, {
                    guildId,
                    channelId: channel.id,
                    roleIds,
                    createdByUserId: userId,
                    delayAmount,
                    delayUnit,
                    repeatEvery,
                    repeatUnit,
                    createdAt: Date.now()
                });
                setTimeout(() => {
                    const pending = this.pendingAnnouncementCreates.get(token);
                    if (!pending) return;
                    if (Date.now() - Number(pending.createdAt || 0) > 10 * 60 * 1000) {
                        this.pendingAnnouncementCreates.delete(token);
                    }
                }, 10 * 60 * 1000);

                const modal = new ModalBuilder()
                    .setCustomId(`announcement:create:${token}`)
                    .setTitle('Create Announcement');
                const messageInput = new TextInputBuilder()
                    .setCustomId('message')
                    .setLabel('Announcement message')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)
                    .setMaxLength(2000);
                modal.addComponents(new ActionRowBuilder().addComponents(messageInput));

                try {
                    await interaction.showModal(modal);
                } catch (error) {
                    console.error('[/announcement] Failed to show modal:', error);
                    try {
                        if (!interaction.deferred && !interaction.replied) {
                            await interaction.reply({ content: 'I could not display the announcement form, sir. Please try again.', ephemeral: true });
                        } else {
                            await interaction.editReply('I could not display the announcement form, sir. Please try again.');
                        }
                    } catch (_) {}
                }
                return;
            }

            if (subcommand === 'list') {
                const jobs = await announcementScheduler.listAnnouncementsForGuild({ guildId });
                if (!jobs.length) {
                    await interaction.editReply('No scheduled announcements found, sir.');
                    return;
                }

                const lines = jobs.slice(0, 15).map((job, idx) => {
                    const next = job.nextRunAt ? `<t:${Math.floor(new Date(job.nextRunAt).getTime() / 1000)}:R>` : 'n/a';
                    const status = job.enabled ? '✅ enabled' : '⛔ disabled';
                    const repeat = job.repeatEvery && job.repeatUnit ? `every ${job.repeatEvery} ${job.repeatUnit}` : 'one-time';
                    const owner = job.createdByUserId ? ` by <@${job.createdByUserId}>` : '';
                    return `${idx + 1}. \`${job.id}\` ${status} in <#${job.channelId}> (${repeat}) next: ${next}${owner}`;
                });

                await interaction.editReply(`📋 **Server Announcements**\n\n${lines.join('\n')}`);
                return;
            }

            if (subcommand === 'disable' || subcommand === 'enable') {
                const id = interaction.options.getString('id');
                const enabled = subcommand === 'enable';
                const result = await announcementScheduler.setAnnouncementEnabledForGuild({ id, guildId, enabled });
                if (!result.ok) {
                    await interaction.editReply(result.error || 'Unable to update announcement, sir.');
                    return;
                }
                await interaction.editReply(enabled ? '✅ Announcement enabled, sir.' : '⛔ Announcement disabled, sir.');
                return;
            }

            if (subcommand === 'delete') {
                const id = interaction.options.getString('id');
                const result = await announcementScheduler.deleteAnnouncementForGuild({ id, guildId });
                if (!result.ok) {
                    await interaction.editReply(result.error || 'Unable to delete announcement, sir.');
                    return;
                }
                await interaction.editReply('🗑️ Announcement deleted, sir.');
                return;
            }

            if (subcommand === 'clear') {
                const confirm = interaction.options.getBoolean('confirm');
                if (!confirm) {
                    await interaction.editReply('Set `confirm:true` to delete all announcements for this server, sir.');
                    return;
                }

                const result = await announcementScheduler.clearAnnouncementsForGuild({ guildId });
                if (!result.ok) {
                    await interaction.editReply(result.error || 'Unable to clear announcements, sir.');
                    return;
                }

                const removedDb = Number(result.removedDb) || 0;
                const removedMem = Number(result.removedMem) || 0;
                await interaction.editReply(`🧹 Cleared announcements, sir. Removed ${removedMem} in-memory and ${removedDb} database entries.`);
                return;
            }

            await interaction.editReply('Unknown announcement action, sir.');
        } catch (error) {
            console.error('[/announcement] Error:', error);
            try {
                if (!interaction.deferred && !interaction.replied) {
                    await interaction.reply({ content: 'Announcement scheduling failed internally, sir.', ephemeral: true });
                } else {
                    await interaction.editReply('Announcement scheduling failed internally, sir.');
                }
            } catch (_) {}
        }
    }

    async handleMonitorCommand(interaction) {
        const monitorSubscriptions = require('./monitor-subscriptions');
        const monitorUtils = require('./monitor-utils');

        const guildId = interaction.guildId;
        const userId = interaction.user.id;

        if (!guildId) {
            if (!interaction.deferred && !interaction.replied) {
                await interaction.reply({
                    content: 'Monitoring is only available in servers, sir.',
                    ephemeral: true
                });
            } else {
                await interaction.editReply('Monitoring is only available in servers, sir.');
            }
            return;
        }

        const guild = interaction.guild || await interaction.client.guilds.fetch(guildId).catch(() => null);
        const memberPermissions = interaction.memberPermissions || interaction.member?.permissions;
        const isOwner = Boolean(guild && guild.ownerId === userId);
        const hasManageChannels = Boolean(memberPermissions?.has(PermissionsBitField.Flags.ManageChannels));
        if (!isOwner && !hasManageChannels) {
            const msg = "❌ You must be the Server Owner or have the 'Manage Channels' permission to use this command.";
            if (!interaction.deferred && !interaction.replied) {
                await interaction.reply({ content: msg, ephemeral: true });
            } else {
                await interaction.editReply(msg);
            }
            return;
        }

        const subcommand = interaction.options.getSubcommand();

        const resolveAlertChannel = () => {
            const provided = interaction.options.getChannel('channel');
            if (provided) return provided;
            return interaction.channel;
        };

        const ensureSendPermissions = async (channel) => {
            const guildRef = guild || await interaction.client.guilds.fetch(guildId).catch(() => null);
            const botMember = guildRef?.members?.me || await guildRef?.members?.fetchMe?.().catch(() => null);
            const perms = channel?.permissionsFor?.(botMember || guildRef?.client?.user);
            if (!perms?.has(PermissionsBitField.Flags.ViewChannel) || !perms?.has(PermissionsBitField.Flags.SendMessages)) {
                return { ok: false, error: 'I require permission to view and speak in that channel, sir.' };
            }

            if (typeof channel.isThread === 'function' && channel.isThread()) {
                if (!perms?.has(PermissionsBitField.Flags.SendMessagesInThreads)) {
                    return { ok: false, error: 'I require permission to speak in that thread, sir.' };
                }
            }

            return { ok: true };
        };

        const truncateFieldValue = (value, max = 1024) => {
            const str = value == null ? '' : String(value);
            if (str.length <= max) return str;
            return str.slice(0, Math.max(0, max - 1)).concat('…');
        };

        const cleanText = (text) => {
            const str = text == null ? '' : String(text);
            return str.replace(/\s+/g, ' ').trim();
        };

        const formatRelativeTime = (iso) => {
            if (!iso) return null;
            const ms = new Date(String(iso)).getTime();
            if (!Number.isFinite(ms)) return null;
            return `<t:${Math.floor(ms / 1000)}:R>`;
        };

        const formatNameList = (names, { maxItems = 18, maxLength = 700 } = {}) => {
            const list = Array.isArray(names) ? names.map(n => String(n)).filter(Boolean) : [];
            const kept = [];
            let len = 0;
            for (const name of list) {
                if (kept.length >= maxItems) break;
                const chunk = (kept.length ? ', ' : '') + name;
                if (len + chunk.length > maxLength) break;
                kept.push(name);
                len += chunk.length;
            }
            const remaining = list.length - kept.length;
            let joined = kept.join(', ');
            if (remaining > 0) {
                joined = joined ? `${joined} … (+${remaining} more)` : `(+${remaining} more)`;
            }
            return joined || '—';
        };

        try {
            if (subcommand === 'remove') {
                const sourceRaw = String(interaction.options.getString('source', true) || '').trim();
                const source = sourceRaw;

                const result = await monitorSubscriptions.remove_subscription({
                    guild_id: guildId,
                    source_id: source
                });
                const result2 = source.toLowerCase() !== source
                    ? await monitorSubscriptions.remove_subscription({
                          guild_id: guildId,
                          source_id: source.toLowerCase()
                      })
                    : { ok: true, removed: 0 };

                const removed = (Number(result?.removed) || 0) + (Number(result2?.removed) || 0);
                await interaction.editReply(
                    removed > 0
                        ? `🗑️ Removed ${removed} monitor(s), sir.`
                        : 'No monitors matched that source, sir.'
                );
                return;
            }

            if (subcommand === 'rss') {
                const url = String(interaction.options.getString('url', true) || '').trim();
                const channel = resolveAlertChannel();
                if (!channel) {
                    await interaction.editReply('Please provide an alert channel, sir.');
                    return;
                }

                const permsCheck = await ensureSendPermissions(channel);
                if (!permsCheck.ok) {
                    await interaction.editReply(permsCheck.error);
                    return;
                }

                const latest = await monitorUtils.fetchFeedLatest(url);
                const initial = latest?.id ? String(latest.id) : null;
                if (!initial) {
                    await interaction.editReply('I could not find a valid latest item for that feed, sir.');
                    return;
                }

                const doc = await monitorSubscriptions.add_subscription({
                    guild_id: guildId,
                    channel_id: channel.id,
                    monitor_type: 'rss',
                    source_id: url,
                    last_seen_data: initial
                });

                if (!doc) {
                    await interaction.editReply('I could not save that monitor right now, sir. Please try again shortly.');
                    return;
                }

                await interaction.editReply(
                    `✅ RSS monitor added, sir.\n**ID:** \`${doc.id}\`\n**Feed:** ${url}\n**Alerts:** <#${doc.channel_id}>`
                );
                return;
            }

            if (subcommand === 'website') {
                const url = String(interaction.options.getString('url', true) || '').trim();
                const channel = resolveAlertChannel();
                if (!channel) {
                    await interaction.editReply('Please provide an alert channel, sir.');
                    return;
                }

                const permsCheck = await ensureSendPermissions(channel);
                if (!permsCheck.ok) {
                    await interaction.editReply(permsCheck.error);
                    return;
                }

                const status = await monitorUtils.fetchWebsiteStatus(url);
                const initial = status?.status != null ? String(status.status) : null;
                if (!initial) {
                    await interaction.editReply('I could not retrieve an HTTP status for that URL, sir.');
                    return;
                }

                const doc = await monitorSubscriptions.add_subscription({
                    guild_id: guildId,
                    channel_id: channel.id,
                    monitor_type: 'website',
                    source_id: url,
                    last_seen_data: initial
                });

                if (!doc) {
                    await interaction.editReply('I could not save that monitor right now, sir. Please try again shortly.');
                    return;
                }

                await interaction.editReply(
                    `✅ Website monitor added, sir.\n**ID:** \`${doc.id}\`\n**URL:** ${url}\n**Initial:** ${initial}\n**Alerts:** <#${doc.channel_id}>`
                );
                return;
            }

            if (subcommand === 'youtube') {
                const channelId = String(interaction.options.getString('channel_id', true) || '').trim();
                const channel = interaction.options.getChannel('channel', true);

                const permsCheck = await ensureSendPermissions(channel);
                if (!permsCheck.ok) {
                    await interaction.editReply(permsCheck.error);
                    return;
                }

                const latest = await monitorUtils.fetchYoutubeLatest(channelId);
                const initial = latest?.id ? String(latest.id) : null;
                if (!initial) {
                    await interaction.editReply('I could not find a latest video for that channel ID, sir.');
                    return;
                }

                const doc = await monitorSubscriptions.add_subscription({
                    guild_id: guildId,
                    channel_id: channel.id,
                    monitor_type: 'youtube',
                    source_id: channelId,
                    last_seen_data: initial
                });

                if (!doc) {
                    await interaction.editReply('I could not save that monitor right now, sir. Please try again shortly.');
                    return;
                }

                await interaction.editReply(
                    `✅ YouTube monitor added, sir.\n**ID:** \`${doc.id}\`\n**Channel ID:** ${channelId}\n**Alerts:** <#${doc.channel_id}>`
                );
                return;
            }

            if (subcommand === 'twitch') {
                const username = String(interaction.options.getString('username', true) || '').trim();
                const normalized = username.toLowerCase();
                const channel = interaction.options.getChannel('channel', true);

                const permsCheck = await ensureSendPermissions(channel);
                if (!permsCheck.ok) {
                    await interaction.editReply(permsCheck.error);
                    return;
                }

                const current = await monitorUtils.fetchTwitchUserAndStream(normalized);
                if (!current?.user) {
                    await interaction.editReply('I could not find that Twitch user, sir.');
                    return;
                }

                const initial = current?.status ? String(current.status) : 'offline';

                const doc = await monitorSubscriptions.add_subscription({
                    guild_id: guildId,
                    channel_id: channel.id,
                    monitor_type: 'twitch',
                    source_id: normalized,
                    last_seen_data: initial
                });

                if (!doc) {
                    await interaction.editReply('I could not save that monitor right now, sir. Please try again shortly.');
                    return;
                }

                await interaction.editReply(
                    `✅ Twitch monitor added, sir.\n**ID:** \`${doc.id}\`\n**Username:** ${normalized}\n**Initial:** ${initial}\n**Alerts:** <#${doc.channel_id}>`
                );
                return;
            }

            if (subcommand === 'cloudflare') {
                const { EmbedBuilder } = require('discord.js');
                const channel = resolveAlertChannel();
                if (!channel) {
                    await interaction.editReply('Please provide an alert channel, sir.');
                    return;
                }

                const permsCheck = await ensureSendPermissions(channel);
                if (!permsCheck.ok) {
                    await interaction.editReply(permsCheck.error);
                    return;
                }

                const status = await monitorUtils.fetchCloudflareStatus();
                
                if (!status.success) {
                    await interaction.editReply(`❌ Failed to fetch Cloudflare status: ${status.error}`);
                    return;
                }

                const doc = await monitorSubscriptions.add_subscription({
                    guild_id: guildId,
                    channel_id: channel.id,
                    monitor_type: 'cloudflare',
                    source_id: 'cloudflare'
                });

                if (!doc) {
                    await interaction.editReply('I could not save that monitor right now, sir. Please try again shortly.');
                    return;
                }

                const embed = new EmbedBuilder()
                    .setTitle('☁️ Cloudflare Status')
                    .setColor(status.overall.status === 'none' ? 0x2ecc71 : status.overall.status === 'minor' ? 0xf1c40f : 0xe74c3c)
                    .setDescription(`${status.overall.emoji} **${status.overall.description}**`)
                    .setTimestamp()
                    .setFooter({ text: 'cloudflarestatus.com' });

                // Components summary
                const compSummary = [];
                const total = Number(status?.components?.total) || 0;
                const operational = Number(status?.components?.operational) || 0;
                if (total > 0) {
                    compSummary.push(`✅ **${operational}/${total}** operational`);
                } else {
                    compSummary.push('✅ All operational');
                }

                const degraded = Array.isArray(status?.components?.degraded) ? status.components.degraded : [];
                const partial = Array.isArray(status?.components?.partialOutage) ? status.components.partialOutage : [];
                const major = Array.isArray(status?.components?.majorOutage) ? status.components.majorOutage : [];
                if (degraded.length > 0) {
                    compSummary.push(`⚠️ Degraded (${degraded.length}): ${formatNameList(degraded)}`);
                }
                if (partial.length > 0) {
                    compSummary.push(`🟠 Partial (${partial.length}): ${formatNameList(partial)}`);
                }
                if (major.length > 0) {
                    compSummary.push(`🔴 Major (${major.length}): ${formatNameList(major)}`);
                }

                embed.addFields({
                    name: 'Components',
                    value: truncateFieldValue(compSummary.join('\n') || 'All operational'),
                    inline: false
                });

                // Active incidents
                const incidents = Array.isArray(status?.incidents) ? status.incidents : [];
                if (incidents.length > 0) {
                    const incidentList = incidents
                        .slice(0, 3)
                        .map(i => {
                            const impact =
                                i.impact === 'critical'
                                    ? '🚨'
                                    : i.impact === 'major'
                                      ? '🔴'
                                      : i.impact === 'minor'
                                        ? '⚠️'
                                        : '📋';
                            const details = i.shortlink ? ` | [Details](${i.shortlink})` : '';
                            const when = formatRelativeTime(i.updatedAt || i.createdAt);
                            const updates = Array.isArray(i.updates) ? i.updates : [];
                            const updateText = updates.length > 0 ? cleanText(updates[0].body) : '';
                            const updateSnippet = updateText ? `\n> ${updateText}` : '';
                            return `${impact} **${i.name}**\n> Status: ${i.status}${when ? ` (${when})` : ''}${details}${updateSnippet}`;
                        })
                        .join('\n\n');
                    embed.addFields({
                        name: '🚧 Incidents',
                        value: truncateFieldValue(incidentList || 'No incident details'),
                        inline: false
                    });
                } else {
                    embed.addFields({ name: '🚧 Incidents', value: 'No active incidents', inline: false });
                }

                await interaction.editReply({
                    content: `✅ Cloudflare monitor added, sir.\n**ID:** \`${doc.id}\`\n**Alerts:** <#${doc.channel_id}>`,
                    embeds: [embed]
                });
                return;
            }

            if (subcommand === 'statuspage') {
                const { EmbedBuilder } = require('discord.js');
                const rawUrl = String(interaction.options.getString('url', true) || '').trim();
                const url = rawUrl.replace(/\/$/, '');
                const channel = resolveAlertChannel();
                if (!channel) {
                    await interaction.editReply('Please provide an alert channel, sir.');
                    return;
                }

                const permsCheck = await ensureSendPermissions(channel);
                if (!permsCheck.ok) {
                    await interaction.editReply(permsCheck.error);
                    return;
                }

                const status = await monitorUtils.fetchStatusPageStatus(url);
                
                if (!status.success) {
                    await interaction.editReply(`❌ Failed to fetch status page: ${status.error}\n\nMake sure the URL is a Statuspage.io compatible page (e.g., https://status.example.com)`);
                    return;
                }

                const doc = await monitorSubscriptions.add_subscription({
                    guild_id: guildId,
                    channel_id: channel.id,
                    monitor_type: 'statuspage',
                    source_id: url
                });

                if (!doc) {
                    await interaction.editReply('I could not save that monitor right now, sir. Please try again shortly.');
                    return;
                }

                const embed = new EmbedBuilder()
                    .setTitle(`📊 ${status.pageName}`)
                    .setColor(status.overall.status === 'none' ? 0x2ecc71 : status.overall.status === 'minor' ? 0xf1c40f : 0xe74c3c)
                    .setDescription(`${status.overall.emoji} **${status.overall.description}**`)
                    .setURL(url)
                    .setTimestamp();

                const components = Array.isArray(status?.components) ? status.components : [];
                const totalComponents = components.length;
                const impactedComponents = components.filter(
                    c => c && c.status && String(c.status).toLowerCase() !== 'operational'
                );

                if (totalComponents > 0) {
                    if (impactedComponents.length === 0) {
                        embed.addFields({
                            name: 'Components',
                            value: truncateFieldValue(`✅ All operational (${totalComponents})`),
                            inline: false
                        });
                    } else {
                        const compLines = impactedComponents
                            .slice(0, 10)
                            .map(c => {
                                const statusLabel = c.status ? String(c.status).replace(/_/g, ' ') : 'unknown';
                                const emoji = c.emoji || monitorUtils.getStatusEmoji(c.status);
                                return `${emoji} ${c.name} (${statusLabel})`;
                            })
                            .join('\n');
                        const header = `⚠️ Impacted: **${impactedComponents.length}/${totalComponents}**\n`;
                        embed.addFields({
                            name: 'Components',
                            value: truncateFieldValue(header + compLines),
                            inline: false
                        });
                    }
                }

                const incidents = Array.isArray(status?.incidents) ? status.incidents : [];
                if (incidents.length > 0) {
                    const incList = incidents
                        .slice(0, 3)
                        .map(i => {
                            const impact =
                                i.impact === 'critical'
                                    ? '🚨'
                                    : i.impact === 'major'
                                      ? '🔴'
                                      : i.impact === 'minor'
                                        ? '⚠️'
                                        : '📋';
                            const details = i.shortlink ? ` | [Details](${i.shortlink})` : '';
                            const when = formatRelativeTime(i.updatedAt || i.createdAt);
                            const updates = Array.isArray(i.updates) ? i.updates : [];
                            const updateText = updates.length > 0 ? cleanText(updates[0].body) : '';
                            const updateSnippet = updateText ? `\n> ${updateText}` : '';
                            return `${impact} **${i.name}**\n> Status: ${i.status}${when ? ` (${when})` : ''}${details}${updateSnippet}`;
                        })
                        .join('\n\n');
                    embed.addFields({
                        name: '🚧 Incidents',
                        value: truncateFieldValue(incList || 'No incident details'),
                        inline: false
                    });
                } else {
                    embed.addFields({ name: '🚧 Incidents', value: 'No recent incidents', inline: false });
                }

                await interaction.editReply({
                    content: `✅ Status page monitor added, sir.\n**ID:** \`${doc.id}\`\n**URL:** ${url}\n**Alerts:** <#${doc.channel_id}>`,
                    embeds: [embed]
                });
                return;
            }

            if (subcommand === 'status') {
                const monitorScheduler = require('./monitor-scheduler');
                const schedulerStatus =
                    monitorScheduler && typeof monitorScheduler.getStatus === 'function'
                        ? monitorScheduler.getStatus()
                        : null;

                const subs = await monitorSubscriptions.get_subscriptions_for_guild(guildId);
                const counts = {};
                const list = Array.isArray(subs) ? subs : [];
                for (const sub of list) {
                    const t = sub && sub.monitor_type ? String(sub.monitor_type) : 'unknown';
                    counts[t] = (counts[t] || 0) + 1;
                }

                const tickMs = Number(schedulerStatus?.tickMs) || 0;
                const tickLabel = tickMs ? `${Math.round((tickMs / 60000) * 10) / 10}m` : 'n/a';
                const lastConnectAt = Number(schedulerStatus?.lastConnectAttemptAt) || 0;
                const lastConnect = lastConnectAt ? `<t:${Math.floor(lastConnectAt / 1000)}:R>` : 'never';

                const schedulerLines = [
                    `Started: ${schedulerStatus?.started ? '✅' : '⛔'}`,
                    `Running: ${schedulerStatus?.running ? '🟢' : '⚪'}`,
                    `Tick: ${tickLabel}`,
                    `DB connected: ${schedulerStatus?.dbConnected ? '✅' : '⛔'}`,
                    `Last DB connect attempt: ${lastConnect}`
                ];
                if (schedulerStatus?.warnedNotConnected) {
                    schedulerLines.push('⚠️ DB warning active');
                }

                const typeEmojis = {
                    rss: '📰',
                    website: '🌐',
                    youtube: '🎬',
                    twitch: '🎮',
                    cloudflare: '☁️',
                    statuspage: '📊'
                };
                const order = ['rss', 'website', 'youtube', 'twitch', 'cloudflare', 'statuspage'];
                const monitorLines = order.map(type => {
                    const emoji = typeEmojis[type] || '📋';
                    const n = Number(counts[type]) || 0;
                    return `${emoji} ${type}: **${n}**`;
                });
                const total = list.length;

                const { EmbedBuilder } = require('discord.js');
                const embed = new EmbedBuilder()
                    .setTitle('📡 Monitor Status')
                    .setColor(0x3498db)
                    .setTimestamp();

                embed.addFields(
                    { name: 'Scheduler', value: schedulerLines.join('\n').slice(0, 1024), inline: false },
                    {
                        name: `Monitors in this server (${total})`,
                        value: monitorLines.join('\n').slice(0, 1024),
                        inline: false
                    }
                );

                await interaction.editReply({ embeds: [embed] });
                return;
            }

            if (subcommand === 'list') {
                const subs = await monitorSubscriptions.get_subscriptions_for_guild(guildId);
                
                if (!subs || subs.length === 0) {
                    await interaction.editReply('No monitors configured for this server, sir.');
                    return;
                }

                const { EmbedBuilder } = require('discord.js');
                const embed = new EmbedBuilder()
                    .setTitle('📡 Active Monitors')
                    .setColor(0x3498db)
                    .setTimestamp();

                const typeEmojis = { rss: '📰', website: '🌐', youtube: '🎬', twitch: '🎮', cloudflare: '☁️', statuspage: '📊' };
                const monitorList = subs.slice(0, 15).map(s => {
                    const emoji = typeEmojis[s.monitor_type] || '📋';
                    const source = s.source_id.length > 40 ? s.source_id.substring(0, 37) + '...' : s.source_id;
                    return `${emoji} **${s.monitor_type}**: \`${source}\`\n> Channel: <#${s.channel_id}> | ID: \`${s.id}\``;
                }).join('\n\n');

                embed.setDescription(monitorList || 'No monitors found');
                if (subs.length > 15) {
                    embed.setFooter({ text: `Showing 15 of ${subs.length} monitors` });
                }

                await interaction.editReply({ embeds: [embed] });
                return;
            }

            await interaction.editReply('Unknown monitor action, sir.');
        } catch (error) {
            console.error('[/monitor] Error:', error);
            const msg = error?.isFriendly ? error.message : 'Monitoring command failed internally, sir.';
            try {
                if (!interaction.deferred && !interaction.replied) {
                    await interaction.reply({ content: msg, ephemeral: true });
                } else {
                    await interaction.editReply(msg);
                }
            } catch (_) {}
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

        // Ticket System
        if (interaction.customId.startsWith('ticket_')) {
            try {
                const ticketSystem = require('../ticket-system');
                await ticketSystem.handleInteraction(interaction);
            } catch (e) {
                console.error('Ticket System Error:', e);
                if (!interaction.replied) await interaction.reply({ content: '❌ Ticket system error.', ephemeral: true });
            }
            return;
        }

        // Help menu category buttons
        if (interaction.customId.startsWith('help_')) {
            const categoryKey = interaction.customId.replace('help_', '');
            const categories = {
                overview: {
                    emoji: '📋',
                    title: 'Command Overview',
                    description: 'Welcome to Jarvis Legacy Commands!\nSelect a category below to see commands.',
                    fields: [
                        { name: '💰 Economy', value: '`*j help economy`', inline: true },
                        { name: '🎰 Gambling', value: '`*j help gambling`', inline: true },
                        { name: '🎮 Fun', value: '`*j help fun`', inline: true },
                        { name: '🛡️ Moderation', value: '`*j help mod`', inline: true },
                        { name: '⚙️ Utility', value: '`*j help utility`', inline: true },
                        { name: '💎 Premium', value: '`*j help premium`', inline: true }
                    ]
                },
                economy: {
                    emoji: '💰',
                    title: 'Economy Commands',
                    description: 'Build your Stark Industries fortune!',
                    fields: [
                        { name: '💵 Basics', value: '`*j balance` - Check balance\n`*j daily` - Daily reward\n`*j work` - Earn money\n`*j beg` - Beg for coins', inline: false },
                        { name: '💳 Transactions', value: '`*j pay @user <amt>` - Send money\n`*j deposit <amt>` - Bank deposit\n`*j withdraw <amt>` - Bank withdraw\n`*j leaderboard` - Rich list', inline: false },
                        { name: '🛒 Shopping', value: '`*j shop` - View shop\n`*j buy <item>` - Buy item\n`*j inventory` - Your items', inline: false }
                    ]
                },
                gambling: {
                    emoji: '🎰',
                    title: 'Gambling Commands',
                    description: 'Test your luck at Stark Casino!',
                    fields: [
                        { name: '🎲 Games', value: '`*j coinflip <amt>` - Flip a coin\n`*j slots <amt>` - Slot machine\n`*j blackjack <amt>` - Play 21\n`*j roulette <amt> <bet>` - Roulette', inline: false },
                        { name: '🎯 More Games', value: '`*j dice <amt>` - Roll dice\n`*j crash <amt>` - Crash game\n`*j highlow <amt>` - Higher or lower', inline: false },
                        { name: '🏆 Multiplayer', value: '`*j heist start` - Start a heist\n`*j heist join` - Join heist\n`*j boss attack` - Attack boss', inline: false }
                    ]
                },
                fun: {
                    emoji: '🎮',
                    title: 'Fun Commands',
                    description: 'Entertainment and social commands!',
                    fields: [
                        { name: '🎱 Random', value: '`*j 8ball <q>` - Magic 8-ball\n`*j roll [dice]` - Roll dice\n`*j rate <thing>` - Rate something\n`*j dadjoke` - Dad joke', inline: false },
                        { name: '💕 Social', value: '`*j hug @user` - Hug someone\n`*j slap @user` - Slap someone\n`*j ship @u1 @u2` - Ship people\n`*j fight @user` - Fight!', inline: false },
                        { name: '📊 Meters', value: '`*j howgay @user` - Gay meter\n`*j howbased @user` - Based meter\n`*j vibecheck @user` - Vibe check\n`*j roast @user` - Roast someone', inline: false }
                    ]
                },
                mod: {
                    emoji: '🛡️',
                    title: 'Moderation Commands',
                    description: 'Server moderation tools (requires permissions)',
                    fields: [
                        { name: '🔨 Actions', value: '`*j kick @user [reason]` - Kick member\n`*j ban @user [time] [reason]` - Ban member\n`*j unban <id>` - Unban by ID', inline: false },
                        { name: '🔇 Timeout', value: '`*j mute @user <time>` - Timeout user\n`*j unmute @user` - Remove timeout', inline: false },
                        { name: '⚠️ Warnings', value: '`*j warn @user <reason>` - Warn user\n`*j warnings @user` - View warnings\n`*j clearwarnings @user` - Clear warns', inline: false },
                        { name: '🤖 AI Moderation', value: '`*j enable moderation` - Enable AI mod\n`*j moderation status` - View settings', inline: false }
                    ]
                },
                utility: {
                    emoji: '⚙️',
                    title: 'Utility Commands',
                    description: 'Helpful utility commands',
                    fields: [
                        { name: '🔧 Tools', value: '`*j ping` - Bot latency\n`*j remind in <time> <msg>` - Set reminder\n`*j profile` - View profile', inline: false }
                    ]
                },
                premium: {
                    emoji: '💎',
                    title: 'Premium Features',
                    description: 'Advanced economy features',
                    fields: [
                        { name: '💠 Arc Reactor', value: '`*j reactor` - Check reactor\n`*j buy arc_reactor` - Buy (10,000💵)\n*+15% earnings, -25% cooldowns*', inline: false },
                        { name: '💱 Starkbucks', value: '`*j sbx wallet` - SBX balance\n`*j sbx convert <amt>` - Convert\n`*j sbx store` - SBX shop', inline: false },
                        { name: '📊 Crypto', value: '`*j crypto prices` - View prices\n`*j crypto buy <coin> <amt>` - Buy\n`*j crypto portfolio` - Holdings', inline: false }
                    ]
                }
            };

            const category = categories[categoryKey] || categories.overview;
            
            const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
            
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
                    .setEmoji('📋')
                    .setStyle(categoryKey === 'overview' ? ButtonStyle.Primary : ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('help_economy')
                    .setLabel('Economy')
                    .setEmoji('💰')
                    .setStyle(categoryKey === 'economy' ? ButtonStyle.Primary : ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('help_gambling')
                    .setLabel('Gambling')
                    .setEmoji('🎰')
                    .setStyle(categoryKey === 'gambling' ? ButtonStyle.Primary : ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('help_fun')
                    .setLabel('Fun')
                    .setEmoji('🎮')
                    .setStyle(categoryKey === 'fun' ? ButtonStyle.Primary : ButtonStyle.Secondary)
            );

            const row2 = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('help_mod')
                    .setLabel('Moderation')
                    .setEmoji('🛡️')
                    .setStyle(categoryKey === 'mod' ? ButtonStyle.Primary : ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('help_utility')
                    .setLabel('Utility')
                    .setEmoji('⚙️')
                    .setStyle(categoryKey === 'utility' ? ButtonStyle.Primary : ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('help_premium')
                    .setLabel('Premium')
                    .setEmoji('💎')
                    .setStyle(categoryKey === 'premium' ? ButtonStyle.Primary : ButtonStyle.Secondary)
            );

            try {
                await interaction.update({ embeds: [embed], components: [row1, row2] });
            } catch {
                // Fallback if update fails
                await interaction.reply({ embeds: [embed], components: [row1, row2], ephemeral: true });
            }
            return;
        }

        // Error log status buttons
        try {
            const errorLogger = require('./error-logger');
            const handled = await errorLogger.handleStatusButton(interaction);
            if (handled) {
                return;
            }
        } catch (e) {
            // ignore
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
        try {
            const limitOption = interaction.options.getInteger('entries');
            const limit = Math.max(1, Math.min(limitOption || 5, 30));
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
                    // We want to show up to 20 long-term + 10 short-term (30 total)
                    const secureMemories = await vaultClient.decryptMemories(userId, { limit: 60 });
                    if (secureMemories.length) {
                        usedSecureMemories = true;

                        const normalize = (entry) => {
                            const payload = entry?.data || entry?.value || entry?.payload || null;
                            return {
                                createdAt: entry.createdAt ? new Date(entry.createdAt) : new Date(),
                                prompt: payload?.userMessage || payload?.prompt || null,
                                reply: payload?.jarvisResponse || payload?.response || null,
                                isShortTerm: !!entry.isShortTerm
                            };
                        };

                        const normalized = secureMemories
                            .map(normalize)
                            .filter((e) => e.prompt || e.reply)
                            .sort((a, b) => b.createdAt - a.createdAt);

                        const longTerm = normalized.filter((e) => !e.isShortTerm).slice(0, 20);
                        const shortTerm = normalized.filter((e) => e.isShortTerm).slice(0, 10);
                        historyEntries = [...longTerm, ...shortTerm].slice(0, limit);
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
                                reply: conv.jarvisResponse || null,
                                isShortTerm: false
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
                const tag = usedSecureMemories ? (entry.isShortTerm ? ' (short-term)' : ' (long-term)') : '';
                return `• ${timestamp}${tag}\n  • Prompt: ${prompt}\n  • Reply: ${reply}`;
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
                // Discord embed field value limit is 1024 chars
                let memoryValue = lines.join('\n\n');
                if (memoryValue.length > 1020) {
                    // Truncate and show fewer entries
                    const truncatedLines = [];
                    let totalLength = 0;
                    for (const line of lines) {
                        if (totalLength + line.length + 2 > 1000) break;
                        truncatedLines.push(line);
                        totalLength += line.length + 2;
                    }
                    memoryValue = truncatedLines.length ? truncatedLines.join('\n\n') + '\n\n*...more entries truncated*' : 'Memory entries too long to display.';
                }
                embed.addFields({
                    name: `Recent Memories ${usedSecureMemories ? '(secure vault)' : ''}`,
                    value: memoryValue || 'No entries to display.'
                });
            } else {
                embed.addFields({ name: 'Recent Memories', value: 'No stored entries yet, sir.' });
            }

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('handleMemoryCommand failed:', error);
            try {
                await interaction.editReply('Memory diagnostics failed internally, sir. Please try again shortly.');
            } catch {}
        }
    }

    async handlePersonaCommand(interaction) {
        await interaction.editReply('Persona switching has been disabled. Jarvis primary protocol is now fixed, sir.');
        return;
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


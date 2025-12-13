
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
                embed.addFields({
                    name: `Recent Memories ${usedSecureMemories ? '(secure vault — 20 long-term + 10 short-term)' : ''}`,
                    value: lines.join('\n\n')
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

            // Check if sentience is enabled for this guild - if so, bypass feature flag check for sentience-related commands
            const SENTIENCE_COMMANDS = ['soul', 'roast', 'sentient'];
            const isSentienceCommand = SENTIENCE_COMMANDS.includes(commandName);
            const sentienceEnabled = guild && isSentienceCommand ? selfhostFeatures.isSentienceEnabled(guild.id) : false;
            
            // Debug logging for sentience check
            if (isSentienceCommand && guild) {
                console.log(`[Sentience] Command: ${commandName}, Guild: ${guild.id}, Enabled: ${sentienceEnabled}`);
            }
            
            const featureAllowed = sentienceEnabled && isSentienceCommand 
                ? true 
                : await this.isCommandFeatureEnabled(commandName, guild);
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

            // Check if sentience is enabled - if so, make sentience commands non-ephemeral
            // Reuse the sentience check variables already declared above
            const shouldBeEphemeral = sentienceEnabled && isSentienceCommand 
                ? false 
                : SLASH_EPHEMERAL_COMMANDS.has(commandName);
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
                case 'memory': {
                    telemetryMetadata.category = 'utilities';
                    await this.handleMemoryCommand(interaction);
                    return;
                }
                case 'opt': {
                    telemetryMetadata.category = 'utilities';
                    await this.handleOptCommand(interaction);
                    return;
                }
                case 'wakeword': {
                    telemetryMetadata.category = 'utilities';
                    await this.handleWakewordCommand(interaction);
                    return;
                }
                case 'mystats': {
                    telemetryMetadata.category = 'utilities';
                    await this.handleMyStatsCommand(interaction);
                    return;
                }
                // ============ FUN COMMANDS (Available Everywhere) ============
                case 'roast': {
                    telemetryMetadata.category = 'fun';
                    const target = interaction.options.getUser('target');
                    
                    if (!target) {
                        response = 'Please specify a target for the roast, sir.';
                        break;
                    }
                    
                    if (target.id === interaction.client.user.id) {
                        response = 'I appreciate the ambition, sir, but self-deprecation is beneath my programming.';
                        break;
                    }
                    
                    const roast = legacyCommands.generateRoast(target.displayName || target.username, interaction.user.username);
                    
                    const roastEmbed = new EmbedBuilder()
                        .setTitle('🔥 Roast Protocol Engaged')
                        .setDescription(roast)
                        .setColor(0xe74c3c)
                        .setThumbnail(target.displayAvatarURL({ dynamic: true, size: 128 }))
                        .setFooter({ text: `Requested by ${interaction.user.username}` })
                        .setTimestamp();
                    
                    selfhostFeatures.jarvisSoul.evolve('roast', 'positive');
                    response = { embeds: [roastEmbed] };
                    break;
                }
                case 'rapbattle': {
                    telemetryMetadata.category = 'fun';
                    const userId = interaction.user.id;
                    const channel = interaction.channel;

                    // Check cooldown (tiered: 1 min for FM1, 2 min for FM2, 4 min for FM3)
                    if (!this.rapBattleCooldowns) this.rapBattleCooldowns = new Map();
                    const cooldownUntil = this.rapBattleCooldowns.get(userId);
                    if (cooldownUntil && Date.now() < cooldownUntil) {
                        const remaining = Math.ceil((cooldownUntil - Date.now()) / 1000);
                        const mins = Math.floor(remaining / 60);
                        const secs = remaining % 60;
                        const timeText = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
                        
                        const cooldownMessages = [
                            `u rapped too much bro get some rest blud, come back in **${timeText}**\n\nremember, im running on batteries you're running on strawberries 🔋🍓`,
                            `nah bro chill 💀 my neural networks need **${timeText}** to recover from your weak bars\n\nyou thought you cooked but you got microwaved 🍿`,
                            `hold up speedrunner 🏃 cooldown still active for **${timeText}**\n\ngo practice your flow, maybe watch some Eminem tutorials or something 🎧`
                        ];
                        response = cooldownMessages[Math.floor(Math.random() * cooldownMessages.length)];
                        break;
                    }

                    // Check if user already has an active battle
                    if (this.rapBattles.has(userId)) {
                        response = 'You already have an active rap battle, sir! Finish that one first.';
                        break;
                    }

                    // Cooldown will be set at the END of battle based on fire mode reached
                    // (1 min for FM1, 2 min for FM2, 4 min for FM3)

                    // Initialize battle
                    const comebacks = this.scanRapBattleComebacks();
                    const startTime = Date.now();
                    
                    // ═══════════════════════════════════════════════════════════════
                    // 🔥 NEED FOR SPEED: RAP EDITION - FIRE MODE 1-15 SYSTEM 🔥
                    // ═══════════════════════════════════════════════════════════════
                    const isFireMode = true;
                    const MAX_BATTLE_DURATION = 150 * 1000; // 2.5 minutes for 15 fire modes
                    const WIN_CHECK_WINDOW = 5 * 1000; // Only check win/lose in last 5 seconds
                    const BOT_RESPONSE_DELAY = 1200; // 1.2s delay before bot responds
                    let currentFireMode = 1; // Track highest fire mode reached
                    let finalQuestionActive = false; // Track if final "9+10" question is active
                    let finalQuestionTimeout = null; // Track final question timer
                    
                    // Fire Mode Configuration: 15 LEVELS - starts at 3s, ends at 1.2s
                    // Calculated for fairness: Discord rate limit ~5 msgs/5s = 1msg/s minimum achievable
                    const FIRE_MODES = [
                        { mode: 1,  startMs: 0,      timeout: 3800, emoji: '🔥',   name: 'WARM UP',      cooldown: 1 },
                        { mode: 2,  startMs: 10000,  timeout: 3600, emoji: '🔥🔥',  name: 'GETTING HOT',  cooldown: 1 },
                        { mode: 3,  startMs: 20000,  timeout: 3400, emoji: '🔥🔥🔥', name: 'ON FIRE',     cooldown: 1 },
                        { mode: 4,  startMs: 30000,  timeout: 3200, emoji: '⚡',   name: 'THUNDER',      cooldown: 2 },
                        { mode: 5,  startMs: 40000,  timeout: 3000, emoji: '⚡⚡',  name: 'LIGHTNING',   cooldown: 2 },
                        { mode: 6,  startMs: 50000,  timeout: 3000, emoji: '🌋',   name: 'VOLCANIC',     cooldown: 2 },
                        { mode: 7,  startMs: 60000,  timeout: 3000, emoji: '🌋🌋',  name: 'ERUPTION',    cooldown: 3 },
                        { mode: 8,  startMs: 70000,  timeout: 3000, emoji: '💀',   name: 'DEATH ZONE',   cooldown: 3 },
                        { mode: 9,  startMs: 80000,  timeout: 3000, emoji: '💀💀',  name: 'FINAL BOSS',  cooldown: 4 },
                        { mode: 10, startMs: 90000,  timeout: 3000, emoji: '👑',   name: 'LEGENDARY',    cooldown: 4 },
                        { mode: 11, startMs: 100000, timeout: 3000, emoji: '🔱',   name: 'GODLIKE',      cooldown: 5 },
                        { mode: 12, startMs: 110000, timeout: 3000, emoji: '⭐',   name: 'SUPERNOVA',    cooldown: 6 },
                        { mode: 13, startMs: 120000, timeout: 3000, emoji: '🌌',   name: 'COSMIC',       cooldown: 7 },
                        { mode: 14, startMs: 130000, timeout: 3000, emoji: '♾️',   name: 'INFINITE',     cooldown: 8 },
                        { mode: 15, startMs: 140000, timeout: 3000, emoji: '🏆',   name: 'ULTIMATE',     cooldown: 10 },
                    ];
                    
                    let currentTimeout = FIRE_MODES[0].timeout;
                    const fireModeTimeouts = []; // Store all fire mode timers for cleanup

                    // Send opening message
                    const openingMessage = '🔥 **NEED FOR SPEED: RAP EDITION** 🔥\n**FIRE MODE 1: WARM UP (3.8s)**\nHUMANOID versus HUMAN! 2.5 MINUTES. **15 FIRE MODES**. SURVIVE TO BECOME **ULTIMATE**. BEGIN!';
                    await interaction.editReply(openingMessage);

                    // Send first comeback immediately
                    const usedComebacks = new Set();
                    const firstComeback = this.getRandomComeback(comebacks, usedComebacks);
                    const firstMessage = await this.sendComeback(channel, firstComeback, comebacks, isFireMode);

                    // Set up initial response timer (6s for Fire Mode 1)
                    const initialTimeoutSetAt = Date.now();
                    let responseTimeoutId = setTimeout(async () => {
                        // User didn't respond to first bar in time
                        const battle = this.rapBattles.get(userId);
                        if (!battle || battle.ended || battle.finalQuestionActive) return;
                        
                        // If user responded after this timeout was set, don't kill them
                        if (battle.lastUserResponseTime > initialTimeoutSetAt) {
                            return;
                        }
                        
                        if (battle.lastBotMessage) {
                            battle.ended = true;
                            try {
                                await battle.lastBotMessage.reply(`<@${userId}> TOO SLOW! 🔥💀`);
                            } catch (err) {
                                await channel.send(`<@${userId}> TOO SLOW! 🔥💀`);
                            }
                        }
                        this.endRapBattle(userId, channel, false);
                    }, currentTimeout); // Use currentTimeout from FIRE_MODES

                    // Set up 2.5-minute max duration timer - backup trigger for final questions
                    const maxDurationTimeoutId = setTimeout(async () => {
                        const battle = this.rapBattles.get(userId);
                        
                        // Skip if final questions already triggered by FM15 transition
                        if (battle && battle.finalQuestionActive) return;
                        
                        if (battle && !battle.ended && battle.fireMode === 15) {
                            // FM15 reached but final questions not triggered yet - trigger now
                            finalQuestionActive = true;
                            battle.finalQuestionActive = true;
                            battle.finalQuestionPhase = 1; // Start with question 1
                            
                            // ═══════════════════════════════════════════════════════════════
                            // STOP ALL OTHER EVENTS - Let user see and answer final questions!
                            // ═══════════════════════════════════════════════════════════════
                            
                            // Clear response timeout
                            if (responseTimeoutId) {
                                clearTimeout(responseTimeoutId);
                                responseTimeoutId = null;
                            }
                            
                            // Clear ALL fire mode transition timers
                            if (battle.fireModeTimeouts && Array.isArray(battle.fireModeTimeouts)) {
                                battle.fireModeTimeouts.forEach(tid => clearTimeout(tid));
                                battle.fireModeTimeouts = [];
                            }
                            
                            // Delay to let any in-flight messages finish
                            await new Promise(r => setTimeout(r, 3000));
                            
                            // Re-check battle still exists after delay
                            const battleAfterDelay = this.rapBattles.get(userId);
                            if (!battleAfterDelay || battleAfterDelay.ended) return;
                            
                            // Send the final question
                            await channel.send('🏆🏆🏆 **FINAL TEST - 4 MEME QUESTIONS** 🏆🏆🏆\n\n# QUESTION 1/4: WHAT\'S 9 + 10??\n\n**5 seconds per question!** 💀');
                            
                            // Track spam state
                            let q1SpamSent = false;
                            
                            // After 1.2 second, if no answer, send spam taunts for Q1
                            const q1SpamTimeout = setTimeout(async () => {
                                const b = this.rapBattles.get(userId);
                                if (!b || b.ended || q1SpamSent || !b.finalQuestionActive || b.finalQuestionPhase !== 1) return;
                                q1SpamSent = true;
                                
                                const spamTaunts = [
                                    'DUDE ANSWER ITS SIMPLE 💀',
                                    'nah ur genuinely slow',
                                    'dude whats so hard?? 💀',
                                    'basic math from KINDERGARTEN',
                                    'aw hell nah 💀'
                                ];
                                
                                for (const taunt of spamTaunts) {
                                    const check = this.rapBattles.get(userId);
                                    if (!check || check.ended || check.finalQuestionPhase !== 1) return;
                                    await channel.send(taunt);
                                    await new Promise(r => setTimeout(r, 350));
                                }
                            }, 1200);
                            
                            // Set 5 second timeout for Q1
                            const q1Timeout = setTimeout(async () => {
                                const currentBattle = this.rapBattles.get(userId);
                                if (!currentBattle || currentBattle.ended || currentBattle.finalQuestionPhase !== 1) return;
                                
                                clearTimeout(q1SpamTimeout);
                                currentBattle.ended = true;
                                await channel.send('WUT DA HEILLLLLLLLLLL');
                                await new Promise(r => setTimeout(r, 300));
                                await channel.send('AW HEILL NYE NYEEE NYEEEEE OO.,, OO AAAAA');
                                await new Promise(r => setTimeout(r, 500));
                                await channel.send(`<@${userId}> TIME'S UP! 💀💀💀\nThe answer was **21** (from the meme)\n\n**SKILL ISSUE AT FM15** - You made it all the way just to choke on basic meme math! 10 minute cooldown.`);
                                this.endRapBattle(userId, channel, false, currentBattle.userScore);
                            }, 5000);
                            
                            // Store timeouts in battle object
                            battleAfterDelay.finalQuestionTimeout = q1Timeout;
                            battleAfterDelay.spamTimeout = q1SpamTimeout;
                        } else if (battle && !battle.ended && battle.fireMode < 15) {
                            // Didn't reach FM15, they lose (only if fireMode < 15!)
                            battle.ended = true;
                            this.endRapBattle(userId, channel, false, battle.userScore);
                        } else if (battle && !battle.ended && battle.fireMode === 15 && !battle.finalQuestionActive) {
                            // FM15 reached but finalQuestionActive somehow not set - trigger questions now!
                            // This is a safety fallback
                            battle.finalQuestionActive = true;
                            battle.finalQuestionPhase = 1;
                            await channel.send('🏆🏆🏆 **FINAL TEST - 4 MEME QUESTIONS** 🏆🏆🏆\n\n# QUESTION 1/4: WHAT\'S 9 + 10??\n\n**5 seconds per question!** 💀');
                            battle.questionAskedAt = Date.now();
                        }
                    }, MAX_BATTLE_DURATION);

                    // ═══════════════════════════════════════════════════════════════
                    // SET UP ALL 15 FIRE MODE TRANSITIONS
                    // ═══════════════════════════════════════════════════════════════
                    for (let i = 1; i < FIRE_MODES.length; i++) {
                        const fm = FIRE_MODES[i];
                        const timerId = setTimeout(async () => {
                            const battle = this.rapBattles.get(userId);
                            if (!battle || battle.ended) return;
                            
                            // Update fire mode
                            battle.fireMode = fm.mode;
                            battle.thunderMode = fm.mode >= 4; // Enable multi-line comebacks at Thunder+
                            currentFireMode = fm.mode;
                            currentTimeout = fm.timeout;
                            
                            // ═══════════════════════════════════════════════════════════════
                            // FM15 SPECIAL HANDLING - IMMEDIATELY TRIGGER FINAL QUESTIONS!
                            // ═══════════════════════════════════════════════════════════════
                            if (fm.mode === 15) {
                                // IMMEDIATELY mark final questions as active FIRST!
                                // This prevents maxDurationTimeout from ending the battle
                                finalQuestionActive = true;
                                battle.finalQuestionActive = true;
                                battle.finalQuestionPhase = 1;
                                
                                // Clear response timeout - no more "TOO SLOW" during final questions
                                if (responseTimeoutId) {
                                    clearTimeout(responseTimeoutId);
                                    responseTimeoutId = null;
                                }
                                
                                // Clear all OTHER fire mode transition timers
                                if (battle.fireModeTimeouts && Array.isArray(battle.fireModeTimeouts)) {
                                    battle.fireModeTimeouts.forEach(tid => clearTimeout(tid));
                                    battle.fireModeTimeouts = [];
                                }
                                
                                // Send FM15 announcement then go to final questions
                                await channel.send('🏆🏆🏆 **FIRE MODE 15: ULTIMATE REACHED!** 🏆🏆🏆\n\nYou survived 2.5 minutes of FIRE! Now face the **FINAL TEST**...');
                                
                                // 10 second delay to let rate-limited spam clear out
                                await new Promise(r => setTimeout(r, 10000));
                                
                                // Re-check battle still exists
                                const battleCheck = this.rapBattles.get(userId);
                                if (!battleCheck || battleCheck.ended) return;
                                
                                // Send first question and mark timestamp
                                await channel.send('🏆🏆🏆 **FINAL TEST - 4 MEME QUESTIONS** 🏆🏆🏆\n\n# QUESTION 1/4: WHAT\'S 9 + 10??\n\n**5 seconds per question!** 💀');
                                battleCheck.questionAskedAt = Date.now(); // Ignore messages before this!
                                
                                // Set up Q1 spam taunts
                                let q1SpamSent = false;
                                const q1SpamTimeout = setTimeout(async () => {
                                    const b = this.rapBattles.get(userId);
                                    if (!b || b.ended || q1SpamSent || !b.finalQuestionActive || b.finalQuestionPhase !== 1) return;
                                    q1SpamSent = true;
                                    const taunts = ['DUDE ANSWER ITS SIMPLE 💀', 'nah ur genuinely slow', 'dude whats so hard?? 💀', 'basic math from KINDERGARTEN', 'aw hell nah 💀'];
                                    for (const taunt of taunts) {
                                        const check = this.rapBattles.get(userId);
                                        if (!check || check.ended || check.finalQuestionPhase !== 1) return;
                                        await channel.send(taunt);
                                        await new Promise(r => setTimeout(r, 350));
                                    }
                                }, 1200);
                                
                                // Set up Q1 timeout
                                const q1Timeout = setTimeout(async () => {
                                    const currentBattle = this.rapBattles.get(userId);
                                    if (!currentBattle || currentBattle.ended || currentBattle.finalQuestionPhase !== 1) return;
                                    clearTimeout(q1SpamTimeout);
                                    currentBattle.ended = true;
                                    await channel.send('WUT DA HEILLLLLLLLLLL');
                                    await new Promise(r => setTimeout(r, 300));
                                    await channel.send('AW HEILL NYE NYEEE NYEEEEE OO.,, OO AAAAA');
                                    await new Promise(r => setTimeout(r, 500));
                                    await channel.send(`<@${userId}> TIME'S UP! 💀💀💀\nThe answer was **21**\n\n**SKILL ISSUE AT FM15** - Choked on meme math! 10 min cooldown.`);
                                    this.endRapBattle(userId, channel, false, currentBattle.userScore);
                                }, 5000);
                                
                                battleCheck.finalQuestionTimeout = q1Timeout;
                                battleCheck.spamTimeout = q1SpamTimeout;
                                return; // Don't continue with normal FM transition
                            }
                            
                            // Fire mode announcement messages (FM2-14 only now)
                            const announcements = {
                                2: [`${fm.emoji} **FIRE MODE 2: ${fm.name}** ${fm.emoji}\nTimer: ${fm.timeout/1000}s! Things are heating up!`],
                                3: [`${fm.emoji} **FIRE MODE 3: ${fm.name}** ${fm.emoji}\nTimer: ${fm.timeout/1000}s! You're cooking now!`],
                                4: [`${fm.emoji} **FIRE MODE 4: ${fm.name}** ${fm.emoji}\nTimer: ${fm.timeout/1000}s! THUNDER STRIKES!`, `⚡ **ENTERING THE THUNDER ZONE** ⚡\n${fm.timeout/1000} SECONDS TO RESPOND!`],
                                5: [`${fm.emoji} **FIRE MODE 5: ${fm.name}** ${fm.emoji}\nTimer: ${fm.timeout/1000}s! LIGHTNING SPEED!`, `⚡⚡ **LIGHTNING MODE** ⚡⚡\nCAN YOU KEEP UP?!`],
                                6: [`${fm.emoji} **FIRE MODE 6: ${fm.name}** ${fm.emoji}\nTimer: ${fm.timeout/1000}s! THE VOLCANO AWAKENS!`, `🌋 **VOLCANIC ERUPTION INCOMING** 🌋\n${fm.timeout/1000}s TIMER! LAVA BARS INCOMING!`],
                                7: [`${fm.emoji} **FIRE MODE 7: ${fm.name}** ${fm.emoji}\nTimer: ${fm.timeout/1000}s! FULL ERUPTION!`, `🌋🌋 **THE MOUNTAIN IS ANGRY** 🌋🌋\nONLY ${fm.timeout/1000} SECONDS NOW!`],
                                8: [`${fm.emoji} **FIRE MODE 8: ${fm.name}** ${fm.emoji}\nTimer: ${fm.timeout/1000}s! ENTER IF YOU DARE!`, `💀 **DEATH ZONE ACTIVATED** 💀\nMOST HUMANS DONT SURVIVE THIS FAR!`, `💀 **WELCOME TO THE DEATH ZONE** 💀\n${fm.timeout/1000} SECONDS. NO MISTAKES.`],
                                9: [`${fm.emoji} **FIRE MODE 9: ${fm.name}** ${fm.emoji}\nTimer: ${fm.timeout/1000}s! THE FINAL CHALLENGE!`, `💀💀 **FINAL BOSS MODE** 💀💀\nYOU MADE IT THIS FAR?! RESPECT!`, `💀💀 **ONE MORE LEVEL TO LEGENDARY** 💀💀\n${fm.timeout/1000} SECONDS. PROVE YOURSELF!`],
                                10: [`👑👑👑 **FIRE MODE 10: LEGENDARY** 👑👑👑\n${fm.timeout/1000}s TIMER! YOU ARE A RAP GOD!`, `👑 **LEGENDARY STATUS UNLOCKED** 👑\nONLY THE ELITE REACH THIS LEVEL!`, `👑👑👑 **THE LEGEND HAS ARRIVED** 👑👑👑\n${fm.timeout/1000} SECONDS! FINISH STRONG!`],
                                11: [`🔱🔱🔱 **FIRE MODE 11: GODLIKE** 🔱🔱🔱\n${fm.timeout/1000}s TIMER! YOU HAVE ASCENDED!`, `🔱 **GODLIKE MODE ACTIVATED** 🔱\nMORTALS TREMBLE BEFORE YOU!`, `🔱 **BEYOND LEGENDARY** 🔱\nONLY ${fm.timeout/1000} SECONDS NOW!`],
                                12: [`⭐⭐⭐ **FIRE MODE 12: SUPERNOVA** ⭐⭐⭐\n${fm.timeout/1000}s! EXPLODING WITH POWER!`, `⭐ **SUPERNOVA EXPLOSION** ⭐\nYOUR BARS ARE NUCLEAR!`, `⭐ **STELLAR DESTRUCTION** ⭐\n${fm.timeout/1000} SECONDS TO SURVIVE!`],
                                13: [`🌌🌌🌌 **FIRE MODE 13: COSMIC** 🌌🌌🌌\n${fm.timeout/1000}s! REALITY IS BENDING!`, `🌌 **COSMIC CHAOS UNLEASHED** 🌌\nTHE UNIVERSE WATCHES!`, `🌌 **INTERDIMENSIONAL BARS** 🌌\nONLY ${fm.timeout/1000} SECONDS!`],
                                14: [`♾️♾️♾️ **FIRE MODE 14: INFINITE** ♾️♾️♾️\n${fm.timeout/1000}s! ENDLESS POWER!`, `♾️ **INFINITE MODE** ♾️\nTIME ITSELF FEARS YOU!`, `♾️ **BEYOND COMPREHENSION** ♾️\n${fm.timeout/1000} SECONDS TO ETERNITY!`],
                                15: [`🏆🏆🏆 **FIRE MODE 15: ULTIMATE** 🏆🏆🏆\n${fm.timeout/1000}s! THE FINAL FORM!`, `🏆 **ULTIMATE POWER ACHIEVED** 🏆\nONE FINAL TEST AWAITS...`, `🏆 **THE PINNACLE** 🏆\nSURVIVE ${fm.timeout/1000} SECONDS FOR GLORY!`]
                            };
                            
                            const msgs = announcements[fm.mode] || [`${fm.emoji} **FIRE MODE ${fm.mode}: ${fm.name}** ${fm.emoji}\nTimer: ${fm.timeout/1000}s!`];
                            const announcement = msgs[Math.floor(Math.random() * msgs.length)];
                            await channel.send(announcement);
                            
                            // Check if battle ended or final questions started
                            if (battle.ended || battle.finalQuestionActive) return;
                            
                            // Send media based on fire mode tier - 50% Tenor API, 50% local
                            const useTenor = Math.random() < 0.5;
                            if (fm.mode >= 8 && comebacks.videos.length > 0 && Math.random() < 0.4) {
                                // Death zone+ : chance for video
                                const video = comebacks.videos[Math.floor(Math.random() * comebacks.videos.length)];
                                await this.sendComeback(channel, { type: 'video', content: video }, comebacks, true);
                            } else if (fm.mode >= 4) {
                                // Thunder+ : send gif (Tenor API or local)
                                if (useTenor) {
                                    const keyword = this.getUnhingedKeyword(fm.mode);
                                    const tenorGif = await this.fetchTenorGif(keyword);
                                    if (tenorGif && !battle.ended && !battle.finalQuestionActive) {
                                        await channel.send(tenorGif);
                                    }
                                } else if (comebacks.gifs.length > 0 && !battle.ended && !battle.finalQuestionActive) {
                                    const gif = comebacks.gifs[Math.floor(Math.random() * comebacks.gifs.length)];
                                    await this.sendComeback(channel, { type: 'gif', content: gif }, comebacks, true);
                                }
                            }
                            
                            // Check if battle ended or final questions started
                            if (battle.ended || battle.finalQuestionActive) return;
                            
                            // Send bars based on intensity
                            const barCount = fm.mode >= 8 ? 3 : fm.mode >= 5 ? 2 : 1;
                            let lastTransitionBar = null;
                            for (let j = 0; j < barCount; j++) {
                                if (battle.ended || battle.finalQuestionActive) break; // Stop if battle ended or final questions
                                const combo = this.getRandomComeback(comebacks, battle.usedComebacks);
                                lastTransitionBar = await this.sendComeback(channel, combo, comebacks, true, fm.mode >= 4);
                            }
                            
                            // FIX: Update lastBotMessage and reset timer for transition bars
                            // This gives user fresh time to respond to fire mode transition bars
                            if (lastTransitionBar && !battle.ended && !battle.finalQuestionActive) {
                                battle.lastBotMessage = lastTransitionBar;
                                
                                // Check if user responded recently (within 2.5s) - if so, skip setting timeout
                                // This prevents race condition where transition overwrites an in-progress response
                                const timeSinceUserResponse = Date.now() - (battle.lastUserResponseTime || 0);
                                if (timeSinceUserResponse < 2500 || battle.ended || battle.finalQuestionActive) {
                                    // User is currently responding, let collector handle timeout
                                    return;
                                }
                                
                                // If responseTimeoutId is null, collector is processing a response - skip
                                if (responseTimeoutId === null || battle.ended) {
                                    return;
                                }
                                
                                // Clear old timeout and set new one for transition bars
                                if (responseTimeoutId) {
                                    clearTimeout(responseTimeoutId);
                                }
                                
                                // Store when we set this timeout to detect stale timeouts
                                const timeoutSetAt = Date.now();
                                responseTimeoutId = setTimeout(async () => {
                                    const currentBattle = this.rapBattles.get(userId);
                                    if (!currentBattle || currentBattle.ended || currentBattle.finalQuestionActive) return;
                                    
                                    // If user responded after this timeout was set, don't kill them
                                    if (currentBattle.lastUserResponseTime > timeoutSetAt) {
                                        return;
                                    }
                                    
                                    if (currentBattle.lastBotMessage && !currentBattle.ended) {
                                        currentBattle.ended = true;
                                        try {
                                            await currentBattle.lastBotMessage.reply(`<@${userId}> TOO SLOW! ${fm.emoji}💀`);
                                        } catch (err) {
                                            if (!currentBattle.ended) await channel.send(`<@${userId}> TOO SLOW! ${fm.emoji}💀`);
                                        }
                                    }
                                    this.endRapBattle(userId, channel, false, currentBattle?.userScore);
                                }, fm.timeout);
                            }
                        }, fm.startMs);
                        fireModeTimeouts.push(timerId);
                    }

                    // Store battle state BEFORE collector to prevent race condition
                    // Add extra time for final questions: 10s delay + 4 questions × 5s each + buffer
                    const FINAL_QUESTIONS_TIME = 40000; // 40 seconds for final questions
                    const collector = channel.createMessageCollector({
                        filter: (msg) => msg.author.id === userId && !msg.author.bot,
                        time: MAX_BATTLE_DURATION + FINAL_QUESTIONS_TIME
                    });

                    this.rapBattles.set(userId, {
                        channelId: channel.id,
                        startTime,
                        timeoutId: maxDurationTimeoutId,
                        fireModeTimeouts, // All fire mode transition timers
                        collector,
                        lastBotMessage: firstMessage,
                        ended: false,
                        userScore: 0,
                        userBars: 0,
                        isFireMode,
                        fireMode: 1, // Current fire mode level (1-15)
                        thunderMode: false, // Activates at FM4+ for multi-line comebacks
                        lastUserResponseTime: 0, // Track when user last responded to prevent race conditions
                        FIRE_MODES, // Reference to fire mode config
                        usedComebacks // Track used comebacks to avoid repeats
                    });

                    collector.on('collect', async (userMessage) => {
                        const battle = this.rapBattles.get(userId);
                        if (!battle || battle.ended) return; // Stop processing if battle ended

                        // Mark when user responded - prevents fire mode transition race condition
                        battle.lastUserResponseTime = Date.now();

                        // ═══════════════════════════════════════════════════════════════
                        // BLOCK ALL NORMAL PROCESSING DURING FINAL QUESTIONS!
                        // ═══════════════════════════════════════════════════════════════
                        if (battle.finalQuestionActive) {
                            // IGNORE ALL MESSAGES until questionAskedAt is set!
                            // This prevents spam during the delay from counting as wrong answers
                            // AND prevents the normal bar response logic from running!
                            if (!battle.questionAskedAt) {
                                // Clear any pending response timeout to prevent TOO SLOW messages
                                if (responseTimeoutId) {
                                    clearTimeout(responseTimeoutId);
                                    responseTimeoutId = null;
                                }
                                return; // Question hasn't been asked yet - BLOCK EVERYTHING
                            }
                        
                        // ═══════════════════════════════════════════════════════════════
                        // CHECK FOR FINAL QUESTIONS: 4 MEME QUESTIONS WITH ESCALATING UNHINGED
                        // Q1="21", Q2="carrot", Q3="nothing", Q4="nuts"
                        // ═══════════════════════════════════════════════════════════════
                            
                            // IGNORE SPAM: Skip messages sent BEFORE the current question was asked!
                            const messageTime = userMessage.createdTimestamp;
                            if (messageTime < battle.questionAskedAt) {
                                return; // Ignore this message - it was sent before the question
                            }
                            
                            const answer = userMessage.content.trim().toLowerCase();
                            const questionPhase = battle.finalQuestionPhase || 1;
                            
                            // Clear timeouts
                            if (battle.finalQuestionTimeout) clearTimeout(battle.finalQuestionTimeout);
                            if (battle.spamTimeout) clearTimeout(battle.spamTimeout);
                            
                            // Helper to set up next question with timer and taunts
                            const setupNextQuestion = async (nextPhase, questionText, taunts, timeoutMsg, correctAnswer) => {
                                // Block messages during transition
                                battle.questionAskedAt = null; // Reset - blocks all messages
                                
                                // 3 second delay between questions
                                await new Promise(r => setTimeout(r, 3000));
                                
                                // Re-check battle still exists
                                const b = this.rapBattles.get(userId);
                                if (!b || b.ended) return;
                                
                                battle.finalQuestionPhase = nextPhase;
                                await channel.send(questionText);
                                battle.questionAskedAt = Date.now(); // NOW start accepting answers
                                
                                let spamSent = false;
                                const spamTimeout = setTimeout(async () => {
                                    if (spamSent || !battle.finalQuestionActive || battle.finalQuestionPhase !== nextPhase) return;
                                    spamSent = true;
                                    for (const taunt of taunts) {
                                        if (battle.ended) return;
                                        await channel.send(taunt);
                                        await new Promise(r => setTimeout(r, 350));
                                    }
                                }, 1200);
                                
                                const qTimeout = setTimeout(async () => {
                                    const currentBattle = this.rapBattles.get(userId);
                                    if (!currentBattle || currentBattle.ended || currentBattle.finalQuestionPhase !== nextPhase) return;
                                    clearTimeout(spamTimeout);
                                    currentBattle.ended = true;
                                    await channel.send(timeoutMsg);
                                    this.endRapBattle(userId, channel, false, currentBattle.userScore);
                                }, 5000);
                                
                                battle.finalQuestionTimeout = qTimeout;
                                battle.spamTimeout = spamTimeout;
                            };
                            
                            // ════════════════════════════════════════════════════════════
                            // QUESTION 1: What's 9+10? → 21
                            // ════════════════════════════════════════════════════════════
                            if (questionPhase === 1) {
                                const isCorrect = answer === '21' || answer.includes('21') || answer.includes('twenty one') || answer.includes('twentyone');
                                
                                if (isCorrect) {
                                    // Clear timeouts before transitioning
                                    if (battle.finalQuestionTimeout) clearTimeout(battle.finalQuestionTimeout);
                                    if (battle.spamTimeout) clearTimeout(battle.spamTimeout);
                                    
                                    await channel.send('✅ **CORRECT! 21!** ✅\n\nBut wait... there\'s MORE! 😈');
                                    
                                    await setupNextQuestion(2,
                                        '🥕🥕🥕 **QUESTION 2/4** 🥕🥕🥕\n\n# i think its uh....i think ITS UHHHHH....yeah its a uhh.....\n\n**5 seconds!** 💀',
                                        ['BRO ITS A VEGETABLE 💀', 'DUDE ITS ORANGE', 'YOU EAT IT bruh', 'CARROT CARROT CARROT', 'its literally carrot bro'],
                                        `<@${userId}> TIME'S UP! 💀\nThe answer was **CARROT**\n\n**CHOKED ON Q2** - You knew 21 but not carrot?! 10 min cooldown.`
                                    );
                                    return;
                                } else {
                                    battle.ended = true;
                                    battle.finalQuestionActive = false;
                                    collector.stop();
                                    await channel.send('WUT DA HEILLLLLLLLLLL');
                                    await new Promise(r => setTimeout(r, 300));
                                    await channel.send('AW HEILL NYE NYEEE NYEEEEE OO.,, OO AAAAA');
                                    await new Promise(r => setTimeout(r, 500));
                                    await channel.send(`<@${userId}> WRONG! 💀\nThe answer was **21**\nYou said: "${userMessage.content}"\n\n**SKILL ISSUE Q1** - Basic meme math! 10 min cooldown.`);
                                    this.endRapBattle(userId, channel, false, battle.userScore);
                                    return;
                                }
                            }
                            // ════════════════════════════════════════════════════════════
                            // QUESTION 2: Carrot meme → carrot
                            // ════════════════════════════════════════════════════════════
                            else if (questionPhase === 2) {
                                const isCorrect = answer === 'carrot' || answer.includes('carrot');
                                
                                if (isCorrect) {
                                    if (battle.finalQuestionTimeout) clearTimeout(battle.finalQuestionTimeout);
                                    if (battle.spamTimeout) clearTimeout(battle.spamTimeout);
                                    
                                    await channel.send('✅ **CARROT! CORRECT!** ✅\n\nKeep going... 😈😈');
                                    
                                    await setupNextQuestion(3,
                                        '🐕🐕🐕 **QUESTION 3/4** 🐕🐕🐕\n\n# What da dog doin?\n\n**5 seconds!** 💀',
                                        ['BRO HES JUST THERE 💀', 'hes not doing anything', 'NOTHING. HES DOING NOTHING.', 'the dog is doing NOTHING', 'bro answer 💀'],
                                        `<@${userId}> TIME'S UP! 💀💀\nThe answer was **NOTHING** (he just standin there)\n\n**CHOKED ON Q3** - 2/4 aint bad... jk its terrible. 10 min cooldown.`
                                    );
                                    return;
                                } else {
                                    battle.ended = true;
                                    battle.finalQuestionActive = false;
                                    collector.stop();
                                    await channel.send('BRO.');
                                    await new Promise(r => setTimeout(r, 350));
                                    await channel.send('ITS. A. CARROT. 🥕');
                                    await new Promise(r => setTimeout(r, 350));
                                    await channel.send('HOW DO YOU NOT KNOW THIS 💀💀');
                                    await new Promise(r => setTimeout(r, 400));
                                    await channel.send(`<@${userId}> WRONG! 💀💀\nThe answer was **CARROT**\nYou said: "${userMessage.content}"\n\n**SKILL ISSUE Q2** - Got Q1, choked Q2! 10 min cooldown.`);
                                    this.endRapBattle(userId, channel, false, battle.userScore);
                                    return;
                                }
                            }
                            // ════════════════════════════════════════════════════════════
                            // QUESTION 3: What da dog doin? → nothing
                            // ════════════════════════════════════════════════════════════
                            else if (questionPhase === 3) {
                                const isCorrect = answer === 'nothing' || answer.includes('nothing') || answer.includes('standin') || answer.includes('standing') || answer.includes('just there') || answer.includes('chillin') || answer.includes('chilling');
                                
                                if (isCorrect) {
                                    if (battle.finalQuestionTimeout) clearTimeout(battle.finalQuestionTimeout);
                                    if (battle.spamTimeout) clearTimeout(battle.spamTimeout);
                                    
                                    await channel.send('✅ **NOTHING! HE JUST STANDIN THERE!** ✅\n\nONE MORE... 😈😈😈');
                                    
                                    await setupNextQuestion(4,
                                        '🥜🥜🥜 **FINAL QUESTION 4/4** 🥜🥜🥜\n\n# Deez...\n\n**5 seconds!** 💀',
                                        ['bro come on 💀', 'DEEZ WHAT???', 'finish the sentence 💀💀', 'ITS SO OBVIOUS', 'DEEZ. WHAT. 💀💀💀'],
                                        `<@${userId}> TIME'S UP! 💀💀💀\nThe answer was **NUTS**\n\n**CHOKED ON THE FINAL QUESTION** - You were ONE away! MASSIVE L! 10 min cooldown.`
                                    );
                                    return;
                                } else {
                                    battle.ended = true;
                                    battle.finalQuestionActive = false;
                                    collector.stop();
                                    await channel.send('WHAT DA DOG DOIN??');
                                    await new Promise(r => setTimeout(r, 300));
                                    await channel.send('NOTHING.');
                                    await new Promise(r => setTimeout(r, 300));
                                    await channel.send('HE JUST STANDIN THERE. 🐕');
                                    await new Promise(r => setTimeout(r, 300));
                                    await channel.send('THATS THE WHOLE MEME 💀💀💀');
                                    await new Promise(r => setTimeout(r, 400));
                                    await channel.send(`<@${userId}> WRONG! 💀💀💀\nThe answer was **NOTHING**\nYou said: "${userMessage.content}"\n\n**SKILL ISSUE Q3** - 2/4... embarrassing! 10 min cooldown.`);
                                    this.endRapBattle(userId, channel, false, battle.userScore);
                                    return;
                                }
                            }
                            // ════════════════════════════════════════════════════════════
                            // QUESTION 4: Deez... → nuts (FINAL)
                            // ════════════════════════════════════════════════════════════
                            else if (questionPhase === 4) {
                                const isCorrect = answer === 'nuts' || answer.includes('nuts') || answer === 'deez nuts' || answer.includes('deez nuts');
                                
                                if (isCorrect) {
                                    // 🏆 ULTIMATE CHAMPION - ALL 4 QUESTIONS CORRECT! 🏆
                                    battle.ended = true;
                                    battle.finalQuestionActive = false;
                                    collector.stop();
                                    
                                    await channel.send('🏆🏆🏆🏆🏆🏆🏆🏆🏆🏆🏆🏆🏆🏆🏆');
                                    await new Promise(r => setTimeout(r, 500));
                                    await channel.send(`# DEEZ NUTS! CORRECT!`);
                                    await new Promise(r => setTimeout(r, 500));
                                    await channel.send(`**<@${userId}> IS THE ULTIMATE MEME LORD RAP CHAMPION!!!**`);
                                    await new Promise(r => setTimeout(r, 500));
                                    await channel.send(`🔥 15 Fire Modes CONQUERED\n🧠 4/4 Meme Questions PERFECT\n👑 **LEGENDARY STATUS ACHIEVED**\n\n**10 MINUTE COOLDOWN** - You've earned your bragging rights! 🎤👑🥜`);
                                    
                                    this.rapBattleCooldowns.set(userId, Date.now() + (10 * 60 * 1000));
                                    this.rapBattles.delete(userId);
                                    return;
                                } else {
                                    // MAXIMUM UNHINGED - Failed on the LAST question
                                    battle.ended = true;
                                    battle.finalQuestionActive = false;
                                    collector.stop();
                                    
                                    await channel.send('NO.');
                                    await new Promise(r => setTimeout(r, 250));
                                    await channel.send('NO NO NO NO NO.');
                                    await new Promise(r => setTimeout(r, 250));
                                    await channel.send('DEEZ. NUTS.');
                                    await new Promise(r => setTimeout(r, 250));
                                    await channel.send('DEEZ 🥜 NUTS 🥜');
                                    await new Promise(r => setTimeout(r, 250));
                                    await channel.send('ITS THE MOST CLASSIC MEME OF ALL TIME 💀💀💀💀');
                                    await new Promise(r => setTimeout(r, 300));
                                    await channel.send('YOU WERE ON THE LAST QUESTION 💀💀💀💀💀');
                                    await new Promise(r => setTimeout(r, 300));
                                    await channel.send('AND YOU SAID "' + userMessage.content + '" 💀💀💀💀💀💀');
                                    await new Promise(r => setTimeout(r, 400));
                                    await channel.send(`<@${userId}> **CATASTROPHIC FAILURE** 💀💀💀💀💀💀💀\n3/4 questions... ONE AWAY from victory...\n\n**ULTIMATE SKILL ISSUE OF THE CENTURY** - This will haunt you forever. 10 min cooldown.`);
                                    this.endRapBattle(userId, channel, false, battle.userScore);
                                    return;
                                }
                            }
                        }

                        // ═══════════════════════════════════════════════════════════════
                        // NORMAL RAP BATTLE PROCESSING (only if NOT in final question mode)
                        // ═══════════════════════════════════════════════════════════════
                        
                        // Double-check we're not in final question mode
                        if (battle.finalQuestionActive) return;
                        
                        // Clear the response timeout
                        if (responseTimeoutId) {
                            clearTimeout(responseTimeoutId);
                            responseTimeoutId = null;
                        }

                        // Calculate elapsed time
                        const elapsed = Date.now() - battle.startTime;
                        const timeRemaining = MAX_BATTLE_DURATION - elapsed;
                        
                        // Remove the win/lose check in last seconds - now we have FM15 final question
                        // Battle continues until FM15 is reached or user fails

                        // Battle continues - bot sends comeback after 2 second delay (anti-spam)
                        await new Promise(r => setTimeout(r, BOT_RESPONSE_DELAY));
                        
                        const comeback = this.getRandomComeback(comebacks, battle.usedComebacks);
                        const forceMulti = battle.thunderMode && Math.random() < 0.6; // 60% multi-line in thunder
                        const botMessage = await this.sendComeback(channel, comeback, comebacks, battle.isFireMode, forceMulti);
                        battle.lastBotMessage = botMessage;

                        // Score the user's bar
                        const barScore = this.scoreUserBar(userMessage.content);
                        battle.userScore += barScore;
                        battle.userBars++;

                        // Get timeout from current fire mode (dynamic based on FIRE_MODES config)
                        const fmConfig = FIRE_MODES.find(fm => fm.mode === battle.fireMode) || FIRE_MODES[0];
                        const timeoutMs = fmConfig.timeout;
                        
                        // Store when we set this timeout to detect stale timeouts
                        const timeoutSetAt = Date.now();
                        responseTimeoutId = setTimeout(async () => {
                            // User didn't respond in time
                            const currentBattle = this.rapBattles.get(userId);
                            if (!currentBattle || currentBattle.ended || currentBattle.finalQuestionActive) return;
                            
                            // If user responded after this timeout was set, don't kill them
                            if (currentBattle.lastUserResponseTime > timeoutSetAt) {
                                return;
                            }
                            
                            if (currentBattle.lastBotMessage) {
                                currentBattle.ended = true;
                                const modeEmoji = FIRE_MODES.find(fm => fm.mode === currentBattle.fireMode)?.emoji || '🔥';
                                try {
                                    await currentBattle.lastBotMessage.reply(`<@${userId}> TOO SLOW! ${modeEmoji}💀`);
                                } catch (err) {
                                    await channel.send(`<@${userId}> TOO SLOW! ${modeEmoji}💀`);
                                }
                            }
                            this.endRapBattle(userId, channel, false, currentBattle?.userScore);
                        }, timeoutMs);
                    });

                    collector.on('end', (collected, reason) => {
                        const battle = this.rapBattles.get(userId);
                        if (!battle) return;

                        // Clear all timers
                        if (responseTimeoutId) clearTimeout(responseTimeoutId);
                        if (battle.timeoutId) clearTimeout(battle.timeoutId);
                        // Clear all fire mode transition timers
                        if (battle.fireModeTimeouts) {
                            battle.fireModeTimeouts.forEach(tid => clearTimeout(tid));
                        }

                        // If battle already ended, don't process again (prevents duplicate messages)
                        if (battle.ended) return;
                        
                        // DON'T end the battle if final questions are active - let them play out!
                        if (battle.finalQuestionActive) return;

                        if (reason === 'time') {
                            // Max duration reached without reaching FM15 - they lose
                            battle.ended = true;
                            this.endRapBattle(userId, channel, false, battle.userScore);
                        }
                        // Other reasons are already handled in collect event or timeout
                    });

                    // Battle state already stored above before collector
                    break;
                }

                case 'selfmod': {
                    telemetryMetadata.category = 'utilities';
                    const subcommand = interaction.options.getSubcommand();
                    const status = selfhostFeatures.selfMod.getStatus();
                    // ... (rest of the code remains the same)
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
                            .setFooter({ text: '🤖 Artificial Soul System • "God said no, so I made my own."' })
                            .setTimestamp();

                        response = { embeds: [soulEmbed] };
                    } else if (subcommand === 'evolve') {
                        const evolutionType = interaction.options.getString('type');
                        const evolution = selfhostFeatures.jarvisSoul.evolve(evolutionType, 'positive');

                        response = `🧬 Soul evolved! **${evolution.type}** → ${evolution.change}\n\n*The artificial soul grows stronger...*`;
                    }
                    break;
                }
                // ============ FUN FEATURES ============
                case 'aatrox': {
                    telemetryMetadata.category = 'fun';
                    // Send the Aatrox gif - available in both guilds and DMs
                    response = 'https://tenor.com/view/aatrox-gyattrox-gyaatrox-lol-league-of-legends-gif-16706958126825166451';
                    break;
                }
                case 'roast': {
                    telemetryMetadata.category = 'fun';
                    const target = interaction.options.getUser('user') || interaction.user;
                    const result = funFeatures.getRoastOrCompliment();
                    const emoji = result.isRoast ? '🔥' : '💚';
                    const title = result.isRoast ? 'ROASTED' : 'BLESSED';
                    response = `${emoji} **${title}** ${emoji}\n<@${target.id}>, ${result.text}`;
                    break;
                }
                case 'wiki': {
                    telemetryMetadata.category = 'fun';
                    const target = interaction.options.getUser('user') || interaction.user;
                    const wiki = funFeatures.generateWikiEntry(target.displayName || target.username);
                    const embed = new EmbedBuilder()
                        .setTitle(wiki.title)
                        .setDescription(wiki.description)
                        .setColor(0x3498db)
                        .setThumbnail(target.displayAvatarURL({ size: 128 }))
                        .setFooter({ text: wiki.footer });
                    wiki.fields.forEach(f => embed.addFields(f));
                    response = { embeds: [embed] };
                    break;
                }
                case 'conspiracy': {
                    telemetryMetadata.category = 'fun';
                    const target = interaction.options.getUser('user');
                    const username = target ? (target.displayName || target.username) : 'Someone in this server';
                    const conspiracy = funFeatures.generateConspiracy(username);
                    response = `🕵️ **CONSPIRACY ALERT** 🕵️\n\n${conspiracy}`;
                    break;
                }
                case 'vibecheck': {
                    telemetryMetadata.category = 'fun';
                    const target = interaction.options.getUser('user') || interaction.user;
                    const vibe = funFeatures.generateVibeCheck(target.displayName || target.username);
                    const statsText = Object.entries(vibe.stats)
                        .map(([stat, val]) => `**${stat}**: ${val}%`)
                        .join('\n');
                    const embed = new EmbedBuilder()
                        .setTitle(`${vibe.emoji} Vibe Check: ${vibe.rating}`)
                        .setDescription(`**${target.displayName || target.username}**\n${vibe.description}`)
                        .setColor(vibe.overallScore > 50 ? 0x2ecc71 : 0xe74c3c)
                        .addFields(
                            { name: '📊 Overall Vibe Score', value: `${vibe.overallScore}/100`, inline: false },
                            { name: '📈 Detailed Stats', value: statsText, inline: false }
                        )
                        .setThumbnail(target.displayAvatarURL({ size: 128 }))
                        .setFooter({ text: 'Vibe Check™ - Results may vary' });
                    response = { embeds: [embed] };
                    break;
                }
                case 'wyr': {
                    telemetryMetadata.category = 'fun';
                    const wyr = funFeatures.getWouldYouRather();
                    const embed = new EmbedBuilder()
                        .setTitle('🤔 Would You Rather...?')
                        .setColor(0x9b59b6)
                        .addFields(
                            { name: '🅰️ Option A', value: wyr.a, inline: false },
                            { name: '🅱️ Option B', value: wyr.b, inline: false }
                        )
                        .setFooter({ text: 'React with 🅰️ or 🅱️ to vote!' });
                    response = { embeds: [embed] };
                    break;
                }
                case 'prophecy': {
                    telemetryMetadata.category = 'fun';
                    const target = interaction.options.getUser('user') || interaction.user;
                    const prophecy = funFeatures.generateProphecy(target.displayName || target.username);
                    response = `🔮 **THE PROPHECY** 🔮\n\n${prophecy}`;
                    break;
                }
                case 'fakequote': {
                    telemetryMetadata.category = 'fun';
                    const target = interaction.options.getUser('user') || interaction.user;
                    const quote = funFeatures.generateFakeQuote(target.displayName || target.username);
                    response = `📜 **Legendary Quote**\n\n${quote}`;
                    break;
                }
                case 'trial': {
                    telemetryMetadata.category = 'fun';
                    const target = interaction.options.getUser('user');
                    if (!target) {
                        response = 'You must specify someone to put on trial! 👨‍⚖️';
                        break;
                    }
                    const crime = funFeatures.getFakeCrime();
                    const isGuilty = Math.random() < 0.5;
                    const verdict = funFeatures.getVerdict(isGuilty);
                    const embed = new EmbedBuilder()
                        .setTitle('⚖️ MOCK TRIAL ⚖️')
                        .setDescription(`**Defendant:** <@${target.id}>`)
                        .setColor(isGuilty ? 0xe74c3c : 0x2ecc71)
                        .addFields(
                            { name: '📋 Charges', value: crime, inline: false },
                            { name: '🔨 Verdict', value: verdict, inline: false }
                        )
                        .setThumbnail(target.displayAvatarURL({ size: 128 }))
                        .setFooter({ text: 'The court of JARVIS has spoken.' });
                    response = { embeds: [embed] };
                    break;
                }
                case 'typerace': {
                    telemetryMetadata.category = 'fun';
                    const phrase = funFeatures.getRandomTypingPhrase();
                    const embed = new EmbedBuilder()
                        .setTitle('⌨️ TYPING RACE ⌨️')
                        .setDescription('First person to type the phrase correctly wins!')
                        .setColor(0xf1c40f)
                        .addFields({ name: '📝 Type this:', value: `\`\`\`${phrase}\`\`\``, inline: false })
                        .setFooter({ text: 'GO GO GO!' });
                    
                    await interaction.editReply({ embeds: [embed] });
                    
                    // Set up collector for the race
                    const filter = m => m.content.toLowerCase() === phrase.toLowerCase() && !m.author.bot;
                    const collector = interaction.channel.createMessageCollector({ filter, time: 30000, max: 1 });
                    
                    collector.on('collect', async (msg) => {
                        const winEmbed = new EmbedBuilder()
                            .setTitle('🏆 WINNER! 🏆')
                            .setDescription(`<@${msg.author.id}> typed it first!`)
                            .setColor(0x2ecc71)
                            .setFooter({ text: 'Speed demon!' });
                        await interaction.channel.send({ embeds: [winEmbed] });
                    });
                    
                    collector.on('end', (collected) => {
                        if (collected.size === 0) {
                            interaction.channel.send('⏰ Time\'s up! Nobody typed it correctly.').catch(() => {});
                        }
                    });
                    
                    response = '__TYPERACE_HANDLED__';
                    break;
                }
                // ============ MORE FUN COMMANDS ============
                case 'rps': {
                    telemetryMetadata.category = 'fun';
                    const opponent = interaction.options.getUser('opponent');
                    const choices = ['🪨 Rock', '📄 Paper', '✂️ Scissors'];
                    const userChoice = choices[Math.floor(Math.random() * 3)];
                    const opponentChoice = choices[Math.floor(Math.random() * 3)];
                    
                    // Determine winner
                    let result;
                    if (userChoice === opponentChoice) {
                        result = "It's a tie! 🤝";
                    } else if (
                        (userChoice.includes('Rock') && opponentChoice.includes('Scissors')) ||
                        (userChoice.includes('Paper') && opponentChoice.includes('Rock')) ||
                        (userChoice.includes('Scissors') && opponentChoice.includes('Paper'))
                    ) {
                        result = `**${interaction.user.username}** wins! 🏆`;
                    } else {
                        result = opponent ? `**${opponent.username}** wins! 🏆` : '**JARVIS** wins! 🤖';
                    }
                    
                    const embed = new EmbedBuilder()
                        .setTitle('🎮 Rock Paper Scissors!')
                        .setColor(0x3498db)
                        .addFields(
                            { name: interaction.user.username, value: userChoice, inline: true },
                            { name: 'VS', value: '⚔️', inline: true },
                            { name: opponent ? opponent.username : 'JARVIS', value: opponentChoice, inline: true }
                        )
                        .setDescription(result);
                    response = { embeds: [embed] };
                    break;
                }
                case 'ship': {
                    telemetryMetadata.category = 'fun';
                    const person1 = interaction.options.getUser('person1');
                    const person2 = interaction.options.getUser('person2') || interaction.user;
                    
                    const compatibility = funFeatures.calculateCompatibility(person1.id, person2.id);
                    const shipName = funFeatures.generateShipName(
                        person1.displayName || person1.username,
                        person2.displayName || person2.username
                    );
                    
                    let emoji, description;
                    if (compatibility >= 90) { emoji = '💕'; description = 'SOULMATES! A match made in heaven!'; }
                    else if (compatibility >= 70) { emoji = '❤️'; description = 'Strong connection! Great potential!'; }
                    else if (compatibility >= 50) { emoji = '💛'; description = 'Decent vibes. Could work!'; }
                    else if (compatibility >= 30) { emoji = '🧡'; description = 'It\'s... complicated.'; }
                    else { emoji = '💔'; description = 'Not meant to be... sorry!'; }
                    
                    const embed = new EmbedBuilder()
                        .setTitle(`${emoji} Ship: ${shipName}`)
                        .setColor(compatibility >= 50 ? 0xe91e63 : 0x95a5a6)
                        .addFields(
                            { name: 'Compatibility', value: `**${compatibility}%**`, inline: true },
                            { name: 'Verdict', value: description, inline: true }
                        )
                        .setDescription(`**${person1.username}** 💕 **${person2.username}**`)
                        .setFooter({ text: 'Ship Calculator™ - Results are 100% scientifically accurate' });
                    response = { embeds: [embed] };
                    // Track ship achievements
                    await achievements.incrementStat(interaction.user.id, 'social.shipChecks');
                    if (compatibility === 100) await achievements.unlock(interaction.user.id, 'ship_100');
                    if (compatibility === 0) await achievements.unlock(interaction.user.id, 'ship_0');
                    break;
                }
                case 'howgay': {
                    telemetryMetadata.category = 'fun';
                    const target = interaction.options.getUser('user') || interaction.user;
                    const percentage = funFeatures.randomInt(0, 100);
                    const bar = '🏳️‍🌈'.repeat(Math.floor(percentage / 10)) + '⬜'.repeat(10 - Math.floor(percentage / 10));
                    response = `🏳️‍🌈 **${target.username}** is **${percentage}%** gay\n${bar}`;
                    if (percentage === 100) await achievements.unlock(interaction.user.id, 'howgay_100');
                    break;
                }
                case 'howbased': {
                    telemetryMetadata.category = 'fun';
                    const target = interaction.options.getUser('user') || interaction.user;
                    const percentage = funFeatures.randomInt(0, 100);
                    const bar = '🗿'.repeat(Math.floor(percentage / 10)) + '⬜'.repeat(10 - Math.floor(percentage / 10));
                    response = `🗿 **${target.username}** is **${percentage}%** based\n${bar}`;
                    if (percentage === 100) await achievements.unlock(interaction.user.id, 'howbased_100');
                    break;
                }
                case 'pickupline': {
                    telemetryMetadata.category = 'fun';
                    const line = funFeatures.getPickupLine();
                    response = `💕 **Pickup Line**\n\n${line}`;
                    await achievements.incrementStat(interaction.user.id, 'fun.pickupLines');
                    break;
                }
                case 'dadjoke': {
                    telemetryMetadata.category = 'fun';
                    const joke = funFeatures.getDadJoke();
                    response = `👨 **Dad Joke**\n\n${joke}`;
                    await achievements.incrementStat(interaction.user.id, 'fun.dadJokes');
                    break;
                }
                case 'fight': {
                    telemetryMetadata.category = 'fun';
                    const opponent = interaction.options.getUser('opponent');
                    if (!opponent) {
                        response = 'You need to specify someone to fight! 👊';
                        break;
                    }
                    if (opponent.id === interaction.user.id) {
                        response = 'You can\'t fight yourself! ...or can you? 🤔';
                        break;
                    }
                    
                    const fight = funFeatures.generateFight(
                        interaction.user.username,
                        opponent.username
                    );
                    
                    const embed = new EmbedBuilder()
                        .setTitle('⚔️ FIGHT! ⚔️')
                        .setColor(0xe74c3c)
                        .setDescription(fight.moves.join('\n\n'))
                        .addFields(
                            { name: `${interaction.user.username} HP`, value: `${fight.attackerHP}/100`, inline: true },
                            { name: `${opponent.username} HP`, value: `${fight.defenderHP}/100`, inline: true }
                        )
                        .setFooter({ text: `🏆 Winner: ${fight.winner}` });
                    response = { embeds: [embed] };
                    // Track fight win achievement
                    if (fight.winner === interaction.user.username) {
                        await achievements.incrementStat(interaction.user.id, 'social.fightWins');
                    }
                    break;
                }
                case 'hug': {
                    telemetryMetadata.category = 'fun';
                    const target = interaction.options.getUser('user');
                    if (!target) {
                        response = 'You need to specify someone to hug! 🤗';
                        break;
                    }
                    const gif = funFeatures.getHugGif();
                    const embed = new EmbedBuilder()
                        .setDescription(`**${interaction.user.username}** hugs **${target.username}**! 🤗`)
                        .setColor(0xff69b4)
                        .setImage(gif);
                    response = { embeds: [embed] };
                    await achievements.incrementStat(interaction.user.id, 'social.hugs');
                    break;
                }
                case 'slap': {
                    telemetryMetadata.category = 'fun';
                    const target = interaction.options.getUser('user');
                    if (!target) {
                        response = 'You need to specify someone to slap! 👋';
                        break;
                    }
                    const gif = funFeatures.getSlapGif();
                    const embed = new EmbedBuilder()
                        .setDescription(`**${interaction.user.username}** slaps **${target.username}**! 👋`)
                        .setColor(0xe74c3c)
                        .setImage(gif);
                    response = { embeds: [embed] };
                    await achievements.incrementStat(interaction.user.id, 'social.slaps');
                    break;
                }
                case 'roll': {
                    telemetryMetadata.category = 'fun';
                    const diceNotation = interaction.options.getString('dice') || '1d6';
                    const result = funFeatures.rollDice(diceNotation);
                    
                    if (!result) {
                        response = '❌ Invalid dice notation! Use format like `2d6` or `1d20+5`';
                        break;
                    }
                    
                    const embed = new EmbedBuilder()
                        .setTitle('🎲 Dice Roll')
                        .setColor(0x9b59b6)
                        .addFields(
                            { name: 'Dice', value: result.notation, inline: true },
                            { name: 'Rolls', value: result.rolls.join(', '), inline: true },
                            { name: 'Total', value: `**${result.total}**`, inline: true }
                        );
                    response = { embeds: [embed] };
                    // Check for nat 20 or nat 1 on d20
                    if (diceNotation.includes('d20')) {
                        if (result.rolls.includes(20)) await achievements.unlock(interaction.user.id, 'roll_nat20');
                        if (result.rolls.includes(1)) await achievements.unlock(interaction.user.id, 'roll_nat1');
                    }
                    break;
                }
                case 'choose': {
                    telemetryMetadata.category = 'fun';
                    const optionsStr = interaction.options.getString('options');
                    const options = optionsStr.split(',').map(o => o.trim()).filter(o => o.length > 0);
                    
                    if (options.length < 2) {
                        response = '❌ Give me at least 2 options separated by commas!';
                        break;
                    }
                    
                    const choice = funFeatures.randomChoice(options);
                    response = `🎯 **I choose:** ${choice}`;
                    break;
                }
                case 'afk': {
                    telemetryMetadata.category = 'fun';
                    const reason = interaction.options.getString('reason') || 'AFK';
                    // Store AFK status (you can expand this with a proper storage system)
                    if (!this.afkUsers) this.afkUsers = new Map();
                    this.afkUsers.set(interaction.user.id, { reason, since: Date.now() });
                    response = `💤 **${interaction.user.username}** is now AFK: ${reason}`;
                    break;
                }
                case 'rate': {
                    telemetryMetadata.category = 'fun';
                    const thing = interaction.options.getString('thing');
                    const rating = funFeatures.randomInt(0, 10);
                    const stars = '⭐'.repeat(rating) + '☆'.repeat(10 - rating);
                    response = `📊 **Rating for "${thing}":**\n${stars} **${rating}/10**`;
                    break;
                }
                case '8ball': {
                    telemetryMetadata.category = 'fun';
                    const question = interaction.options.getString('question');
                    const answer = funFeatures.get8BallResponse();
                    const embed = new EmbedBuilder()
                        .setTitle('🎱 Magic 8-Ball')
                        .setColor(0x000000)
                        .addFields(
                            { name: '❓ Question', value: question, inline: false },
                            { name: '🔮 Answer', value: answer, inline: false }
                        );
                    response = { embeds: [embed] };
                    // Track achievement
                    await achievements.incrementStat(interaction.user.id, 'fun.eightBall');
                    break;
                }
                case 'achievements': {
                    telemetryMetadata.category = 'achievements';
                    const targetUser = interaction.options.getUser('user') || interaction.user;
                    const category = interaction.options.getString('category');
                    
                    const profile = await achievements.getProfile(targetUser.id);
                    
                    if (category) {
                        // Show specific category
                        const userData = await achievements.getUserData(targetUser.id);
                        const categoryAchievements = achievements.getAchievementsByCategory(category, userData);
                        
                        const embed = new EmbedBuilder()
                            .setTitle(`🏆 ${category} Achievements`)
                            .setDescription(`**${targetUser.username}**'s achievements in ${category}`)
                            .setColor(0xffd700)
                            .setThumbnail(targetUser.displayAvatarURL({ size: 128 }));
                        
                        let achievementList = '';
                        for (const a of categoryAchievements) {
                            const status = a.unlocked ? '✅' : '🔒';
                            achievementList += `${status} ${a.emoji} **${a.name}** (${a.points} pts)\n${a.description}\n\n`;
                        }
                        
                        if (achievementList.length > 4000) {
                            achievementList = achievementList.substring(0, 4000) + '...';
                        }
                        
                        embed.addFields({ name: 'Achievements', value: achievementList || 'None', inline: false });
                        embed.setFooter({ text: `${profile.categories[category]?.unlocked || 0}/${profile.categories[category]?.total || 0} unlocked` });
                        
                        response = { embeds: [embed] };
                    } else {
                        // Show overview
                        const embed = new EmbedBuilder()
                            .setTitle('🏆 Achievements')
                            .setDescription(`**${targetUser.username}**'s Achievement Profile`)
                            .setColor(0xffd700)
                            .setThumbnail(targetUser.displayAvatarURL({ size: 128 }))
                            .addFields(
                                { name: '⭐ Total Points', value: `${profile.totalPoints}`, inline: true },
                                { name: '🎯 Progress', value: `${profile.unlockedCount}/${profile.totalCount} (${profile.percentage}%)`, inline: true },
                                { name: '\u200b', value: '\u200b', inline: true }
                            );
                        
                        // Add category progress
                        let categoryProgress = '';
                        for (const [cat, data] of Object.entries(profile.categories)) {
                            const percent = Math.round((data.unlocked / data.total) * 100);
                            const bar = '█'.repeat(Math.floor(percent / 10)) + '░'.repeat(10 - Math.floor(percent / 10));
                            categoryProgress += `**${cat}**: ${bar} ${data.unlocked}/${data.total}\n`;
                        }
                        
                        embed.addFields({ name: '📊 Categories', value: categoryProgress, inline: false });
                        
                        // Add recent achievements
                        if (profile.recent.length > 0) {
                            const recentText = profile.recent.map(a => `${a.emoji} ${a.name}`).join('\n');
                            embed.addFields({ name: '🕐 Recent', value: recentText, inline: false });
                        }
                        
                        embed.setFooter({ text: 'Use /achievements category:<name> to view specific categories' });
                        
                        response = { embeds: [embed] };
                    }
                    break;
                }
                // ============ STARK BUCKS ECONOMY ============
                case 'balance': {
                    telemetryMetadata.category = 'economy';
                    const stats = await starkEconomy.getUserStats(interaction.user.id);
                    const boostText = starkEconomy.getBoostText();
                    const balanceEmbed = new EmbedBuilder()
                        .setTitle('💰 Stark Bucks Balance')
                        .setDescription(`You have **${stats.balance}** Stark Bucks, sir.${boostText}`)
                        .setColor(0xf1c40f)
                        .addFields(
                            { name: '📈 Total Earned', value: `${stats.totalEarned}`, inline: true },
                            { name: '📉 Total Lost', value: `${stats.totalLost}`, inline: true },
                            { name: '🎰 Win Rate', value: `${stats.winRate}%`, inline: true },
                            { name: '🔥 Daily Streak', value: `${stats.dailyStreak} days`, inline: true },
                            { name: '🎮 Games Played', value: `${stats.gamesPlayed}`, inline: true },
                            { name: '🎁 Inventory', value: `${stats.inventoryCount} items`, inline: true }
                        )
                        .setFooter({ text: 'Stark Industries Financial Division' });
                    response = { embeds: [balanceEmbed] };
                    break;
                }
                case 'daily': {
                    telemetryMetadata.category = 'economy';
                    const result = await starkEconomy.claimDaily(interaction.user.id, interaction.user.username);
                    if (!result.success) {
                        const hours = Math.floor(result.cooldown / (60 * 60 * 1000));
                        const minutes = Math.floor((result.cooldown % (60 * 60 * 1000)) / (60 * 1000));
                        response = `⏰ You've already claimed today, sir. Come back in ${hours}h ${minutes}m.`;
                        break;
                    }
                    const dailyEmbed = new EmbedBuilder()
                        .setTitle('💰 Daily Reward Claimed!')
                        .setDescription(`You received **${result.reward}** Stark Bucks!${result.doubled ? ' (DOUBLED!)' : ''}`)
                        .setColor(0x2ecc71)
                        .addFields(
                            { name: '🔥 Streak', value: `${result.streak} days (+${result.streakBonus} bonus)`, inline: true },
                            { name: '💰 Balance', value: `${result.newBalance}`, inline: true }
                        )
                        .setFooter({ text: 'Come back tomorrow to keep your streak!' });
                    response = { embeds: [dailyEmbed] };
                    break;
                }
                case 'work': {
                    telemetryMetadata.category = 'economy';
                    const result = await starkEconomy.work(interaction.user.id, interaction.user.username);
                    if (!result.success) {
                        const cooldownMs = result.cooldown;
                        const timeStr = cooldownMs < 60000 
                            ? `${Math.floor(cooldownMs / 1000)} seconds`
                            : `${Math.floor(cooldownMs / (60 * 1000))} minutes`;
                        response = `⏰ You're tired, sir. Rest for ${timeStr} more.`;
                        break;
                    }
                    const workBoost = starkEconomy.getBoostText();
                    const workEmbed = new EmbedBuilder()
                        .setTitle('💼 Work Complete!')
                        .setDescription(`You ${result.job} and earned **${result.reward}** Stark Bucks!${workBoost}`)
                        .setColor(0x3498db)
                        .addFields({ name: '💰 Balance', value: `${result.newBalance}`, inline: true })
                        .setFooter({ text: 'Stark Industries HR Department' });
                    response = { embeds: [workEmbed] };
                    break;
                }
                case 'gamble': {
                    telemetryMetadata.category = 'economy';
                    const amount = interaction.options.getInteger('amount');
                    const result = await starkEconomy.gamble(interaction.user.id, amount);
                    if (!result.success) {
                        response = `❌ ${result.error}`;
                        break;
                    }
                    const gambleEmbed = new EmbedBuilder()
                        .setTitle(result.won ? '🎰 You Won!' : '🎰 You Lost!')
                        .setDescription(result.won 
                            ? `Congratulations! You won **${result.amount}** Stark Bucks!`
                            : `Better luck next time. You lost **${result.amount}** Stark Bucks.`)
                        .setColor(result.won ? 0x2ecc71 : 0xe74c3c)
                        .addFields({ name: '💰 Balance', value: `${result.newBalance}`, inline: true })
                        .setFooter({ text: `Win rate: ${result.winRate}%` });
                    selfhostFeatures.jarvisSoul.evolve(result.won ? 'helpful' : 'chaos', 'neutral');
                    response = { embeds: [gambleEmbed] };
                    break;
                }
                case 'slots': {
                    telemetryMetadata.category = 'economy';
                    const bet = interaction.options.getInteger('bet');
                    const result = await starkEconomy.playSlots(interaction.user.id, bet);
                    if (!result.success) {
                        response = `❌ ${result.error}`;
                        break;
                    }
                    const slotDisplay = result.results.join(' | ');
                    let resultText = '';
                    if (result.resultType === 'jackpot') resultText = '💎 JACKPOT! 💎';
                    else if (result.resultType === 'triple') resultText = '🎉 TRIPLE!';
                    else if (result.resultType === 'double') resultText = '✨ Double!';
                    else resultText = '😢 No match';
                    const slotsEmbed = new EmbedBuilder()
                        .setTitle('🎰 Slot Machine')
                        .setDescription(`**[ ${slotDisplay} ]**\n\n${resultText}`)
                        .setColor(result.change > 0 ? 0x2ecc71 : 0xe74c3c)
                        .addFields(
                            { name: '💵 Bet', value: `${result.bet}`, inline: true },
                            { name: '💰 Won', value: `${result.winnings}`, inline: true },
                            { name: '🏦 Balance', value: `${result.newBalance}`, inline: true }
                        )
                        .setFooter({ text: `Multiplier: x${result.multiplier}` });
                    response = { embeds: [slotsEmbed] };
                    break;
                }
                case 'coinflip': {
                    telemetryMetadata.category = 'economy';
                    const bet = interaction.options.getInteger('bet');
                    const choice = interaction.options.getString('choice');
                    const result = await starkEconomy.coinflip(interaction.user.id, bet, choice);
                    if (!result.success) {
                        response = `❌ ${result.error}`;
                        break;
                    }
                    const coinEmoji = result.result === 'heads' ? '🪙' : '⭕';
                    const cfEmbed = new EmbedBuilder()
                        .setTitle(`${coinEmoji} Coinflip`)
                        .setDescription(`The coin landed on **${result.result.toUpperCase()}**!\n\nYou chose **${result.choice}** - ${result.won ? '**YOU WIN!**' : 'You lose.'}`)
                        .setColor(result.won ? 0x2ecc71 : 0xe74c3c)
                        .addFields({ name: '💰 Balance', value: `${result.newBalance}`, inline: true })
                        .setFooter({ text: '50/50 chance' });
                    response = { embeds: [cfEmbed] };
                    break;
                }
                case 'shop': {
                    telemetryMetadata.category = 'economy';
                    const items = starkEconomy.getShopItems();
                    const itemList = items.map(item => 
                        `**${item.name}** - ${item.price} 💵\n> ${item.description}`
                    ).join('\n\n');
                    const shopEmbed = new EmbedBuilder()
                        .setTitle('🛒 Stark Industries Shop')
                        .setDescription(itemList)
                        .setColor(0x9b59b6)
                        .setFooter({ text: 'Use /buy <item> to purchase' });
                    response = { embeds: [shopEmbed] };
                    break;
                }
                case 'buy': {
                    telemetryMetadata.category = 'economy';
                    const itemId = interaction.options.getString('item');
                    const result = await starkEconomy.buyItem(interaction.user.id, itemId);
                    if (!result.success) {
                        response = `❌ ${result.error}`;
                        break;
                    }
                    const buyEmbed = new EmbedBuilder()
                        .setTitle('🛒 Purchase Successful!')
                        .setDescription(`You bought **${result.item.name}**!`)
                        .setColor(0x2ecc71)
                        .addFields({ name: '💰 Balance', value: `${result.newBalance}`, inline: true })
                        .setFooter({ text: 'Thank you for shopping at Stark Industries' });
                    response = { embeds: [buyEmbed] };
                    break;
                }
                case 'leaderboard': {
                    telemetryMetadata.category = 'economy';
                    const lb = await starkEconomy.getLeaderboard(10, interaction.client);
                    if (!lb.length) {
                        response = 'No data yet, sir.';
                        break;
                    }
                    const lines = lb.map(u => {
                        const badge = u.hasVipBadge ? '⭐ ' : '';
                        const gold = u.hasGoldenName ? '✨' : '';
                        return `**#${u.rank}** ${badge}${gold}${u.username || 'Unknown'}${gold} - **${u.balance}** 💵`;
                    }).join('\n');
                    const lbEmbed = new EmbedBuilder()
                        .setTitle('🏆 Stark Bucks Leaderboard')
                        .setDescription(lines)
                        .setColor(0xf1c40f)
                        .setFooter({ text: 'Top 10 richest users' });
                    response = { embeds: [lbEmbed] };
                    break;
                }
                case 'hunt': {
                    telemetryMetadata.category = 'economy';
                    const huntResult = await starkEconomy.hunt(interaction.user.id);
                    if (!huntResult.success) {
                        const cooldownMs = huntResult.cooldown;
                        const timeStr = cooldownMs < 60000 
                            ? `${Math.floor(cooldownMs / 1000)} seconds`
                            : `${Math.floor(cooldownMs / (60 * 1000))} minutes`;
                        response = `🏹 You're tired from hunting. Rest for ${timeStr} more.`;
                        break;
                    }
                    const huntBoost = starkEconomy.getBoostText();
                    const huntEmbed = new EmbedBuilder()
                        .setTitle('🏹 Hunt Results')
                        .setDescription(huntResult.reward > 0 
                            ? `You caught a **${huntResult.outcome}**!\n+**${huntResult.reward}** Stark Bucks${huntBoost}`
                            : `${huntResult.outcome}... The animals got away!`)
                        .setColor(huntResult.reward > 0 ? 0x2ecc71 : 0x95a5a6)
                        .addFields({ name: '💰 Balance', value: `${huntResult.newBalance}`, inline: true })
                        .setFooter({ text: 'Hunt again in 1 minute' });
                    response = { embeds: [huntEmbed] };
                    break;
                }
                case 'fish': {
                    telemetryMetadata.category = 'economy';
                    const fishResult = await starkEconomy.fish(interaction.user.id);
                    if (!fishResult.success) {
                        const cooldownMs = fishResult.cooldown;
                        const timeStr = cooldownMs < 60000 
                            ? `${Math.floor(cooldownMs / 1000)} seconds`
                            : `${Math.floor(cooldownMs / (60 * 1000))} minutes`;
                        response = `🎣 Your fishing rod needs to dry. Wait ${timeStr} more.`;
                        break;
                    }
                    const fishBoost = starkEconomy.getBoostText();
                    const fishEmbed = new EmbedBuilder()
                        .setTitle('🎣 Fishing Results')
                        .setDescription(fishResult.reward > 0 
                            ? `You caught a **${fishResult.outcome}**!\n+**${fishResult.reward}** Stark Bucks${fishBoost}`
                            : `${fishResult.outcome}... Nothing bit today!`)
                        .setColor(fishResult.reward > 0 ? 0x3498db : 0x95a5a6)
                        .addFields({ name: '💰 Balance', value: `${fishResult.newBalance}`, inline: true })
                        .setFooter({ text: 'Fish again in 1 minute' });
                    response = { embeds: [fishEmbed] };
                    break;
                }
                case 'dig': {
                    telemetryMetadata.category = 'economy';
                    const digResult = await starkEconomy.dig(interaction.user.id);
                    if (!digResult.success) {
                        const cooldownMs = digResult.cooldown;
                        const timeStr = cooldownMs < 60000 
                            ? `${Math.floor(cooldownMs / 1000)} seconds`
                            : `${Math.floor(cooldownMs / (60 * 1000))} minutes`;
                        response = `⛏️ Your shovel is broken. Wait ${timeStr} more.`;
                        break;
                    }
                    const digBoost = starkEconomy.getBoostText();
                    const digEmbed = new EmbedBuilder()
                        .setTitle('⛏️ Dig Results')
                        .setDescription(digResult.reward > 0 
                            ? `You found **${digResult.outcome}**!\n+**${digResult.reward}** Stark Bucks${digBoost}`
                            : `${digResult.outcome}... Nothing but dirt!`)
                        .setColor(digResult.reward > 0 ? 0xf1c40f : 0x95a5a6)
                        .addFields({ name: '💰 Balance', value: `${digResult.newBalance}`, inline: true })
                        .setFooter({ text: 'Dig again in 1 minute' });
                    response = { embeds: [digEmbed] };
                    break;
                }
                case 'beg': {
                    telemetryMetadata.category = 'economy';
                    const begResult = await starkEconomy.beg(interaction.user.id);
                    if (!begResult.success) {
                        const cooldownMs = begResult.cooldown;
                        const timeStr = cooldownMs < 60000 
                            ? `${Math.floor(cooldownMs / 1000)} seconds`
                            : `${Math.floor(cooldownMs / (60 * 1000))} minutes`;
                        response = `🙏 People are avoiding you. Try again in ${timeStr}.`;
                        break;
                    }
                    const begBoost = starkEconomy.getBoostText();
                    const begEmbed = new EmbedBuilder()
                        .setTitle('🙏 Begging Results')
                        .setDescription(begResult.reward > 0 
                            ? `**${begResult.outcome}** **${begResult.reward}** Stark Bucks!${begBoost}`
                            : `${begResult.outcome}... Better luck next time!`)
                        .setColor(begResult.reward > 0 ? 0x9b59b6 : 0x95a5a6)
                        .addFields({ name: '💰 Balance', value: `${begResult.newBalance}`, inline: true })
                        .setFooter({ text: 'Beg again in 1 minute' });
                    response = { embeds: [begEmbed] };
                    break;
                }
                case 'crime': {
                    telemetryMetadata.category = 'economy';
                    const crimeResult = await starkEconomy.crime(interaction.user.id);
                    if (!crimeResult.success) {
                        const cooldownMs = crimeResult.cooldown;
                        const timeStr = cooldownMs < 60000 
                            ? `${Math.floor(cooldownMs / 1000)} seconds`
                            : `${Math.floor(cooldownMs / (60 * 1000))} minutes`;
                        response = `🚔 Laying low after your last crime. Wait ${timeStr} more.`;
                        break;
                    }
                    const crimeBoost = starkEconomy.getBoostText();
                    const crimeEmbed = new EmbedBuilder()
                        .setTitle('🔫 Crime Results')
                        .setDescription(crimeResult.reward >= 0 
                            ? `**${crimeResult.outcome}**\n${crimeResult.reward > 0 ? `+**${crimeResult.reward}** Stark Bucks${crimeBoost}` : 'No reward this time...'}`
                            : `**${crimeResult.outcome}**\n-**${Math.abs(crimeResult.reward)}** Stark Bucks`)
                        .setColor(crimeResult.reward > 0 ? 0x2ecc71 : crimeResult.reward < 0 ? 0xe74c3c : 0x95a5a6)
                        .addFields({ name: '💰 Balance', value: `${crimeResult.newBalance}`, inline: true })
                        .setFooter({ text: 'Crime doesn\'t always pay!' });
                    response = { embeds: [crimeEmbed] };
                    break;
                }
                case 'postmeme': {
                    telemetryMetadata.category = 'economy';
                    const memeResult = await starkEconomy.postmeme(interaction.user.id);
                    if (!memeResult.success) {
                        const cooldownMs = memeResult.cooldown;
                        const timeStr = cooldownMs < 60000 
                            ? `${Math.floor(cooldownMs / 1000)} seconds`
                            : `${Math.floor(cooldownMs / (60 * 1000))} minutes`;
                        response = `📱 Still waiting for engagement on your last post. Try again in ${timeStr}.`;
                        break;
                    }
                    const memeBoost = starkEconomy.getBoostText();
                    const memeEmbed = new EmbedBuilder()
                        .setTitle('📱 Meme Posted!')
                        .setDescription(memeResult.reward > 0 
                            ? `**${memeResult.outcome}**\n+**${memeResult.reward}** Stark Bucks${memeBoost}`
                            : `**${memeResult.outcome}**`)
                        .setColor(memeResult.reward > 100 ? 0xf1c40f : memeResult.reward > 0 ? 0x3498db : 0x95a5a6)
                        .addFields({ name: '💰 Balance', value: `${memeResult.newBalance}`, inline: true })
                        .setFooter({ text: 'Quality content = Quality rewards' });
                    response = { embeds: [memeEmbed] };
                    break;
                }
                case 'searchlocation': {
                    telemetryMetadata.category = 'economy';
                    const locationChoice = interaction.options.getString('location');
                    const locationIndex = locationChoice ? parseInt(locationChoice) : null;
                    const searchResult = await starkEconomy.search(interaction.user.id, locationIndex);
                    if (!searchResult.success) {
                        const cooldownMs = searchResult.cooldown;
                        const timeStr = cooldownMs < 60000 
                            ? `${Math.floor(cooldownMs / 1000)} seconds`
                            : `${Math.floor(cooldownMs / (60 * 1000))} minutes`;
                        response = `🔍 You're too tired to search. Rest for ${timeStr} more.`;
                        break;
                    }
                    const searchBoost = starkEconomy.getBoostText();
                    const searchEmbed = new EmbedBuilder()
                        .setTitle('🔍 Search Results')
                        .setDescription(`You searched **${searchResult.location}**...\n\n${searchResult.outcome}${searchResult.reward > 0 ? `\n+**${searchResult.reward}** Stark Bucks${searchBoost}` : searchResult.reward < 0 ? `\n-**${Math.abs(searchResult.reward)}** Stark Bucks` : ''}`)
                        .setColor(searchResult.reward > 0 ? 0x2ecc71 : searchResult.reward < 0 ? 0xe74c3c : 0x95a5a6)
                        .addFields({ name: '💰 Balance', value: `${searchResult.newBalance}`, inline: true })
                        .setFooter({ text: 'Search again in 1 minute' });
                    response = { embeds: [searchEmbed] };
                    break;
                }
                case 'give': {
                    telemetryMetadata.category = 'economy';
                    const targetUser = interaction.options.getUser('user');
                    const giveAmount = interaction.options.getInteger('amount');
                    
                    if (targetUser.bot) {
                        response = '❌ Cannot give money to bots, sir.';
                        break;
                    }
                    
                    const giveResult = await starkEconomy.give(
                        interaction.user.id, 
                        targetUser.id, 
                        giveAmount,
                        interaction.user.username,
                        targetUser.username
                    );
                    
                    if (!giveResult.success) {
                        response = `❌ ${giveResult.error}`;
                        break;
                    }
                    
                    const giveEmbed = new EmbedBuilder()
                        .setTitle('💸 Transfer Complete!')
                        .setDescription(`You gave **${giveResult.amount}** Stark Bucks to **${targetUser.username}**!`)
                        .setColor(0x2ecc71)
                        .addFields(
                            { name: 'Your Balance', value: `${giveResult.fromBalance}`, inline: true },
                            { name: `${targetUser.username}'s Balance`, value: `${giveResult.toBalance}`, inline: true }
                        )
                        .setFooter({ text: 'Generosity is a virtue!' });
                    response = { embeds: [giveEmbed] };
                    break;
                }
                case 'show': {
                    telemetryMetadata.category = 'economy';
                    const showUser = await starkEconomy.loadUser(interaction.user.id, interaction.user.username);
                    const multiplierStatus = starkEconomy.getMultiplierStatus();
                    
                    const showEmbed = new EmbedBuilder()
                        .setTitle(`💰 ${interaction.user.username}'s Stark Bucks`)
                        .setColor(0xf1c40f)
                        .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
                        .addFields(
                            { name: '💵 Balance', value: `**${showUser.balance.toLocaleString()}** Stark Bucks`, inline: true },
                            { name: '📈 Total Earned', value: `${(showUser.totalEarned || 0).toLocaleString()}`, inline: true },
                            { name: '🎮 Games Played', value: `${showUser.gamesPlayed || 0}`, inline: true },
                            { name: '🏆 Games Won', value: `${showUser.gamesWon || 0}`, inline: true },
                            { name: '🔥 Daily Streak', value: `${showUser.dailyStreak || 0} days`, inline: true }
                        );
                    
                    if (multiplierStatus.active) {
                        showEmbed.addFields({ 
                            name: '🎉 EVENT ACTIVE!', 
                            value: `**${multiplierStatus.multiplier}x MULTIPLIER (${multiplierStatus.multiplier * 100}%)!**`, 
                            inline: false 
                        });
                    }
                    
                    showEmbed.setFooter({ text: 'Flex those Stark Bucks!' });
                    response = { embeds: [showEmbed] };
                    break;
                }
                // ============ SELFHOST-ONLY COMMANDS (requires filesystem access) ============
                case 'selfmod': {
                    telemetryMetadata.category = 'experimental';
                    if (!selfhostFeatures.isSelfhost) {
                        response = 'This feature requires selfhost mode (filesystem access), sir.';
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
                case 'sentient': {
                    telemetryMetadata.category = 'experimental';
                    // Check if sentience is enabled for this guild instead of requiring selfhost mode
                    const sentienceEnabled = guild ? selfhostFeatures.isSentienceEnabled(guild.id) : false;
                    if (!sentienceEnabled) {
                        response = 'Sentient agent is only available in servers with sentience enabled, sir.';
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
                        
                        // Only allow admin to enable autonomous mode (check both config and env)
                        const adminId = config.admin?.userId || process.env.ADMIN_USER_ID;
                        if (enabled && adminId && interaction.user.id !== adminId) {
                            response = `⚠️ Only the bot administrator can enable autonomous mode, sir. (Your ID: ${interaction.user.id})`;
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

                    response = await this.jarvis.generateResponse(interaction, prompt, true, null, imageAttachments);
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
                case 'pwdgen': {
                    telemetryMetadata.category = 'utilities';
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
                        if (includeSymbols) pool += symbols;

                        // Ensure at least one from each required class
                        const required = [
                            lowers[crypto.randomInt(lowers.length)],
                            uppers[crypto.randomInt(uppers.length)],
                            digits[crypto.randomInt(digits.length)],
                        ];
                        if (includeSymbols) {
                            required.push(symbols[crypto.randomInt(symbols.length)]);
                        }

                        if (length < required.length) {
                            response = 'Length too short for the selected character requirements, sir.';
                            break;
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
                        response = {
                            content: `Here is your generated password (keep it private), sir:\n\n\`\`\`${password}\`\`\``,
                        };
                    } catch (error) {
                        try {
                            const errorLogger = require('./error-logger');
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
                        } catch {}
                        response = 'Password generator failed, sir.';
                    }
                    break;
                }
                case 'qrcode': {
                    telemetryMetadata.category = 'utilities';
                    try {
                        const { AttachmentBuilder } = require('discord.js');
                        const text = (interaction.options.getString('text') || '').trim();
                        if (!text.length) {
                            response = 'Provide text to encode, sir.';
                            break;
                        }

                        // Prefer local qrcode library if installed, fallback to a remote QR image endpoint.
                        let pngBuffer = null;
                        try {
                            const qrcode = require('qrcode');
                            pngBuffer = await qrcode.toBuffer(text, {
                                type: 'png',
                                errorCorrectionLevel: 'M',
                                margin: 2,
                                width: 512,
                            });
                        } catch {
                            const allowExternalFallback = String(process.env.ALLOW_QR_EXTERNAL_FALLBACK || '1').toLowerCase() === '1';
                            if (!allowExternalFallback) {
                                throw new Error('External QR fallback disabled');
                            }
                            const url = `https://api.qrserver.com/v1/create-qr-code/?size=512x512&data=${encodeURIComponent(text)}`;
                            const res = await fetch(url);
                            if (!res.ok) {
                                throw new Error(`QR service failed: ${res.status}`);
                            }
                            const arr = await res.arrayBuffer();
                            pngBuffer = Buffer.from(arr);
                        }

                        const attachment = new AttachmentBuilder(pngBuffer, { name: 'qrcode.png' });
                        response = {
                            content: 'QR code generated, sir.',
                            files: [attachment]
                        };
                    } catch (error) {
                        try {
                            const errorLogger = require('./error-logger');
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
                        } catch {}
                        response = 'QR code generation failed, sir.';
                    }
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

            if (response === '__RAP_BATTLE_HANDLED__') {
                // Rap battle handles its own responses, skip normal handling
                return;
            } else if (response === undefined || response === null) {
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
            
            // Generate unique error code for debugging
            const errorId = `J-${Date.now().toString(36).slice(-4).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
            console.error(`[${errorId}] Error processing interaction:`, error);

            // Report to error log channel for production triage
            try {
                const errorLogger = require('./error-logger');
                await errorLogger.log({
                    error,
                    errorId,
                    context: {
                        location: 'slash:handleSlashCommand',
                        user: `${interaction.user?.username || 'unknown'} (${interaction.user?.id || 'unknown'})`,
                        guild: interaction.guild ? `${interaction.guild.name} (${interaction.guild.id})` : 'DM',
                        channel: `${interaction.channelId || 'unknown'}`,
                        command: `${interaction.commandName || 'unknown'}`,
                        extra: {
                            customId: interaction.customId,
                            options: interaction.options?._hoistedOptions || null
                        }
                    }
                });
            } catch {
                // ignore
            }
            
            try {
                const errorMessage = `Technical difficulties, sir. (${errorId}) Please try again shortly.`;
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply(errorMessage);
                } else if (interaction.deferred && !interaction.replied) {
                    await interaction.editReply(errorMessage);
                }
            } catch (editError) {
                if (editError.code === 10062) {
                    telemetryMetadata.reason = 'unknown-interaction';
                    console.warn(`[${errorId}] Ignored unknown interaction during error reply.`);
                } else {
                    console.error(`[${errorId}] Failed to send error reply:`, editError.code, editError.message);
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

    // ============ RAP BATTLE SYSTEM ============
    /**
     * Scan rapping_comebacks folder for available content
     */
    scanRapBattleComebacks() {
        const comebacks = {
            lines: [],
            gifs: [],
            videos: [],
            mp3s: [],
            images: [],      // Local image files
            imagesBase64: [] // Base64 encoded images
        };

        try {
            // Read lines.txt
            const linesPath = path.join(this.rapBattleComebacksPath, 'lines.txt');
            if (fs.existsSync(linesPath)) {
                const content = fs.readFileSync(linesPath, 'utf8');
                comebacks.lines = content.split('\n')
                    .map(line => line.trim())
                    .filter(line => line.length > 0);
            }

            // Read gif_links.txt
            const gifsPath = path.join(this.rapBattleComebacksPath, 'gif_links.txt');
            if (fs.existsSync(gifsPath)) {
                const content = fs.readFileSync(gifsPath, 'utf8');
                comebacks.gifs = content.split('\n')
                    .map(line => line.trim())
                    .filter(line => line.length > 0 && line.startsWith('http'));
            }

            // Scan videos_and_mp3 folder
            const mediaPath = path.join(this.rapBattleComebacksPath, 'videos_and_mp3');
            if (fs.existsSync(mediaPath)) {
                const files = fs.readdirSync(mediaPath);
                for (const file of files) {
                    const filePath = path.join(mediaPath, file);
                    const ext = path.extname(file).toLowerCase();
                    if (ext === '.mp4' || ext === '.webm' || ext === '.mov') {
                        comebacks.videos.push(filePath);
                    } else if (ext === '.mp3' || ext === '.wav' || ext === '.ogg') {
                        comebacks.mp3s.push(filePath);
                    }
                }
            }

            // Scan images folder for local images
            const imagesPath = path.join(this.rapBattleComebacksPath, 'images');
            if (fs.existsSync(imagesPath)) {
                const files = fs.readdirSync(imagesPath);
                for (const file of files) {
                    const ext = path.extname(file).toLowerCase();
                    if (['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)) {
                        comebacks.images.push(path.join(imagesPath, file));
                    }
                }
            }

            // Read base64 encoded images
            const base64Path = path.join(this.rapBattleComebacksPath, 'images_base64.json');
            if (fs.existsSync(base64Path)) {
                try {
                    const base64Data = JSON.parse(fs.readFileSync(base64Path, 'utf8'));
                    if (base64Data.images && Array.isArray(base64Data.images)) {
                        comebacks.imagesBase64 = base64Data.images;
                    }
                } catch (e) {
                    console.error('Failed to parse images_base64.json:', e);
                }
            }
        } catch (error) {
            console.error('Failed to scan rap battle comebacks:', error);
        }

        return comebacks;
    }

    /**
     * Fetch a random GIF from Tenor API based on keyword
     * @param {string} keyword - Search term for GIF
     * @returns {Promise<string|null>} - GIF URL or null if failed
     */
    async fetchTenorGif(keyword) {
        const TENOR_API_KEY = 'LIVDSRZULELA';
        try {
            const url = `https://g.tenor.com/v1/search?q=${encodeURIComponent(keyword)}&key=${TENOR_API_KEY}&limit=20`;
            const response = await fetch(url);
            if (!response.ok) return null;
            
            const data = await response.json();
            if (!data.results || data.results.length === 0) return null;
            
            // Pick random result and get gif URL
            const result = data.results[Math.floor(Math.random() * data.results.length)];
            // Get the gif URL from media array
            const gifUrl = result.media?.[0]?.gif?.url || result.media?.[0]?.tinygif?.url;
            return gifUrl || null;
        } catch (error) {
            console.error('Tenor API error:', error);
            return null;
        }
    }

    /**
     * Get unhinged keyword for fire mode (progressively crazier)
     */
    getUnhingedKeyword(fireMode) {
        const UNHINGED_KEYWORDS = {
            1: ['fire rap', 'hip hop beat', 'rap battle', 'mic drop'],
            2: ['hot fire', 'burning flames', 'heat wave', 'spicy'],
            3: ['cooking chef', 'roasting', 'burned', 'toasted'],
            4: ['thunder lightning', 'electric shock', 'storm', 'zap'],
            5: ['speed fast', 'zoom sonic', 'turbo', 'flash'],
            6: ['volcano lava', 'magma explosion', 'eruption', 'molten'],
            7: ['explosion boom', 'blast destroy', 'kaboom', 'nuke'],
            8: ['skull death', 'grim reaper', 'rip dead', 'cemetery'],
            9: ['boss battle', 'final boss', 'monster', 'beast mode'],
            10: ['king crown', 'royal throne', 'legend goat', 'champion'],
            11: ['god mode', 'divine power', 'immortal', 'ascended'],
            12: ['supernova star', 'cosmic explosion', 'galaxy brain', 'universe'],
            13: ['alien space', 'void abyss', 'dimension', 'multiverse'],
            14: ['infinite loop', 'eternal forever', 'never ending', 'matrix'],
            15: ['ultimate victory', 'winner champion', 'goat legend', 'perfection'],
        };
        const keywords = UNHINGED_KEYWORDS[fireMode] || UNHINGED_KEYWORDS[1];
        return keywords[Math.floor(Math.random() * keywords.length)];
    }

    /**
     * Get a random comeback from available content (no repeats within a battle)
     */
    getRandomComeback(comebacks, usedComebacks = null) {
        const allTypes = [];
        
        if (comebacks.lines.length > 0) allTypes.push('line');
        if (comebacks.gifs.length > 0) allTypes.push('gif');
        if (comebacks.videos.length > 0) allTypes.push('video');
        if (comebacks.mp3s.length > 0) allTypes.push('mp3');
        if (comebacks.images.length > 0) allTypes.push('image');
        if (comebacks.imagesBase64.length > 0) allTypes.push('imageBase64');

        if (allTypes.length === 0) {
            return { type: 'line', content: 'Your bars are weak, human! 💀' };
        }

        // Helper to get unique item from array
        const getUniqueItem = (arr, prefix) => {
            if (!usedComebacks) {
                return arr[Math.floor(Math.random() * arr.length)];
            }
            // Filter out used items
            const available = arr.filter((item, idx) => {
                const key = `${prefix}:${typeof item === 'object' ? item.name || idx : item}`;
                return !usedComebacks.has(key);
            });
            // If all used, reset and pick any
            if (available.length === 0) {
                return arr[Math.floor(Math.random() * arr.length)];
            }
            const picked = available[Math.floor(Math.random() * available.length)];
            const idx = arr.indexOf(picked);
            const key = `${prefix}:${typeof picked === 'object' ? picked.name || idx : picked}`;
            usedComebacks.add(key);
            return picked;
        };

        const randomType = allTypes[Math.floor(Math.random() * allTypes.length)];

        switch (randomType) {
            case 'line':
                return {
                    type: 'line',
                    content: getUniqueItem(comebacks.lines, 'line')
                };
            case 'gif':
                return {
                    type: 'gif',
                    content: getUniqueItem(comebacks.gifs, 'gif')
                };
            case 'image':
                return {
                    type: 'image',
                    content: getUniqueItem(comebacks.images, 'image')
                };
            case 'imageBase64':
                return {
                    type: 'imageBase64',
                    content: getUniqueItem(comebacks.imagesBase64, 'imgb64')
                };
            case 'video':
                return {
                    type: 'video',
                    content: getUniqueItem(comebacks.videos, 'video')
                };
            case 'mp3':
                return {
                    type: 'mp3',
                    content: getUniqueItem(comebacks.mp3s, 'mp3')
                };
        }
    }

    /**
     * Download a file and return the path
     */
    async downloadFile(filePath, tempDir) {
        // File is already local, just return it
        return filePath;
    }

    /**
     * Send a comeback message
     * @param {boolean} forceMulti - Force multi-line output (2-4 lines)
     */
    async sendComeback(channel, comeback, comebacks, isFireMode = false, forceMulti = false) {
        try {
            if (comeback.type === 'line') {
                // In fire mode or forced, send multiple lines (2-4)
                const shouldMulti = forceMulti || (isFireMode && Math.random() < 0.5);
                if (shouldMulti) {
                    // 2-4 lines: 30% for 2, 40% for 3, 30% for 4
                    const rand = Math.random();
                    const numLines = rand < 0.3 ? 2 : (rand < 0.7 ? 3 : 4);
                    const lines = [comeback.content];
                    for (let i = 1; i < numLines; i++) {
                        const extra = comebacks.lines[Math.floor(Math.random() * comebacks.lines.length)];
                        if (extra && !lines.includes(extra)) lines.push(extra);
                    }
                    return await channel.send(lines.join('\n'));
                }
                return await channel.send(comeback.content);
            } else if (comeback.type === 'gif') {
                return await channel.send(comeback.content);
            } else if (comeback.type === 'image') {
                // Local image file
                const filePath = comeback.content;
                const fileName = path.basename(filePath);
                
                if (!fs.existsSync(filePath)) {
                    console.error(`Image not found: ${filePath}`);
                    const fallback = this.getRandomComeback({ ...comebacks, images: [], imagesBase64: [] });
                    return await channel.send(fallback.content || 'Your bars are weak!');
                }

                const attachment = new AttachmentBuilder(filePath, { name: fileName });
                return await channel.send({ files: [attachment] });
            } else if (comeback.type === 'imageBase64') {
                // Base64 encoded image
                const img = comeback.content;
                const ext = img.mimeType.split('/')[1] || 'png';
                const buffer = Buffer.from(img.data, 'base64');
                const attachment = new AttachmentBuilder(buffer, { name: `${img.name}.${ext}` });
                return await channel.send({ files: [attachment] });
            } else if (comeback.type === 'video' || comeback.type === 'mp3') {
                const filePath = comeback.content;
                const fileName = path.basename(filePath);
                
                // Check if file exists and is readable
                if (!fs.existsSync(filePath)) {
                    console.error(`File not found: ${filePath}`);
                    // Fallback to a line
                    const fallback = this.getRandomComeback({ ...comebacks, videos: [], mp3s: [] });
                    return await channel.send(fallback.content);
                }

                const attachment = new AttachmentBuilder(filePath, { name: fileName });
                return await channel.send({ files: [attachment] });
            }
        } catch (error) {
            console.error('Failed to send comeback:', error);
            // Fallback to a text line
            const fallback = this.getRandomComeback({ ...comebacks, videos: [], mp3s: [], gifs: [], images: [], imagesBase64: [] });
            return await channel.send(fallback.content);
        }
    }

    /**
     * Score a user's rap bar based on various criteria
     */
    scoreUserBar(content) {
        let score = 0;
        const words = content.toLowerCase().split(/\s+/).filter(w => w.length > 0);
        
        // Base points for length (longer = more effort)
        if (words.length >= 3) score += 5;
        if (words.length >= 6) score += 5;
        if (words.length >= 10) score += 10;
        if (words.length >= 15) score += 10;
        
        // Rhyme detection (simple end-sound matching)
        const rhymeEndings = ['ay', 'ee', 'ow', 'ight', 'ine', 'ame', 'ade', 'ake', 'ate', 'ound', 'ick', 'ot', 'op', 'ack', 'an', 'it', 'ip', 'ock', 'unk', 'ash'];
        let rhymeCount = 0;
        for (const word of words) {
            for (const ending of rhymeEndings) {
                if (word.endsWith(ending)) {
                    rhymeCount++;
                    break;
                }
            }
        }
        if (rhymeCount >= 2) score += 10;
        if (rhymeCount >= 4) score += 15;
        
        // Fire keywords bonus
        const fireWords = ['fire', 'flame', 'heat', 'hot', 'burn', 'lit', 'sick', 'cold', 'ice', 'freeze', 'kill', 'dead', 'rip', 'bars', 'flow', 'spit', 'rap', 'beat', 'rhyme', 'mic', 'drop', 'bomb', 'explode', 'goat', 'king', 'queen', 'crown', 'throne', 'win', 'champ'];
        for (const word of words) {
            if (fireWords.includes(word)) {
                score += 5;
            }
        }
        
        // Diss bonus (targeting the bot)
        const dissWords = ['bot', 'robot', 'machine', 'ai', 'jarvis', 'humanoid', 'computer', 'code', 'program', 'algorithm', 'cpu', 'binary'];
        for (const word of words) {
            if (dissWords.includes(word)) {
                score += 8;
            }
        }
        
        // Emoji bonus (shows creativity)
        const emojiCount = (content.match(/[\u{1F300}-\u{1F9FF}]/gu) || []).length;
        score += Math.min(emojiCount * 2, 10);
        
        // Caps lock bonus (INTENSITY)
        const capsWords = words.filter(w => w === w.toUpperCase() && w.length > 2);
        if (capsWords.length >= 2) score += 5;
        
        return score;
    }

    /**
     * Check if user is blocked from chat due to rap battle
     */
    isRapBattleBlocked(userId) {
        const unblockTime = this.rapBattleBlockedUsers.get(userId);
        if (!unblockTime) return false;
        
        if (Date.now() >= unblockTime) {
            // Time has passed, unblock user
            this.rapBattleBlockedUsers.delete(userId);
            return false;
        }
        
        return true;
    }

    /**
     * End a rap battle with tiered cooldowns based on fire mode reached (1-15)
     */
    endRapBattle(userId, channel, userWon, userScore = 0) {
        const battle = this.rapBattles.get(userId);
        if (!battle) return;

        // IMMEDIATELY mark as ended to stop all events
        battle.ended = true;
        battle.finalQuestionActive = false;

        // Stop collector FIRST to prevent any more message processing
        if (battle.collector && !battle.collector.ended) {
            try { battle.collector.stop(); } catch (e) {}
        }

        // Clean up ALL timers
        if (battle.timeoutId) {
            clearTimeout(battle.timeoutId);
            battle.timeoutId = null;
        }
        // Clean up all fire mode transition timers
        if (battle.fireModeTimeouts && Array.isArray(battle.fireModeTimeouts)) {
            battle.fireModeTimeouts.forEach(tid => clearTimeout(tid));
            battle.fireModeTimeouts = [];
        }
        // Clean up final question timers
        if (battle.finalQuestionTimeout) {
            clearTimeout(battle.finalQuestionTimeout);
            battle.finalQuestionTimeout = null;
        }
        if (battle.spamTimeout) {
            clearTimeout(battle.spamTimeout);
            battle.spamTimeout = null;
        }

        // Get fire mode config for cooldown
        const fireMode = battle.fireMode || 1;
        const fmConfig = battle.FIRE_MODES?.find(fm => fm.mode === fireMode);
        const cooldownMinutes = fmConfig?.cooldown || 1;
        const cooldownMs = cooldownMinutes * 60 * 1000;
        const fmEmoji = fmConfig?.emoji || '🔥';
        const fmName = fmConfig?.name || 'FIRE';
        
        // Set the cooldown based on fire mode reached
        this.rapBattleCooldowns.set(userId, Date.now() + cooldownMs);
        
        // Remove from battles map immediately
        this.rapBattles.delete(userId);

        // Block chat for 3 seconds after battle ends
        const CHAT_UNBLOCK_DELAY = 3 * 1000;
        const unblockTime = Date.now() + CHAT_UNBLOCK_DELAY;
        this.rapBattleBlockedUsers.set(userId, unblockTime);

        // Dynamic win/lose messages based on fire mode tier
        let winMessages, loseMessages;
        
        if (fireMode === 15) {
            // ULTIMATE - Only reachable via final question (this shouldn't trigger normally)
            loseMessages = [
                `<@${userId}> reached **ULTIMATE** but failed the final test! 🏆💀\nThe answer was 21...`,
                `🏆 SO CLOSE! <@${userId}> made it to FM15 but couldn't answer 9+10! 🏆`,
                `<@${userId}> was at the PINNACLE but fell! 🏆💔\nIncredible run though!`
            ];
            winMessages = loseMessages; // Shouldn't happen - winners handled separately
        } else if (fireMode >= 13) {
            // COSMIC/INFINITE (13-14)
            loseMessages = [
                `<@${userId}> reached **${fmName}** but the universe had other plans ${fmEmoji}💀\nFM${fireMode} is INSANE!`,
                `${fmEmoji} <@${userId}> fell at Fire Mode ${fireMode}! ${fmEmoji}\nBeyond legendary effort!`,
                `<@${userId}> touched the ${fmName} realm but couldn't hold on! ${fmEmoji}💀\nRespect!`
            ];
            winMessages = loseMessages;
        } else if (fireMode >= 11) {
            // GODLIKE/SUPERNOVA (11-12)
            loseMessages = [
                `<@${userId}> reached **${fmName}** but fell at FM${fireMode}! ${fmEmoji}💀\nGodlike effort!`,
                `${fmEmoji} Fire Mode ${fireMode} claimed <@${userId}>! ${fmEmoji}\nYou almost ascended!`,
                `<@${userId}> was ${fmName} but couldn't finish! ${fmEmoji}💔\nIncredible run!`
            ];
            winMessages = loseMessages;
        } else if (fireMode === 10) {
            // LEGENDARY
            loseMessages = [
                `<@${userId}> reached LEGENDARY but fell! 👑💀\n5 more levels to go!`,
                `👑 Fire Mode 10 claimed <@${userId}>! 👑\nYou were getting close!`,
                `<@${userId}> touched LEGENDARY but couldn't hold it 👑💔\nSolid effort!`
            ];
            winMessages = loseMessages;
        } else if (fireMode >= 8) {
            // Death Zone (8-9)
            winMessages = [
                `💀💀 <@${userId}> SURVIVED THE **DEATH ZONE** AND WON! 💀💀\nFIRE MODE ${fireMode}! INSANE!`,
                `💀 **DEATH ZONE SURVIVOR**: <@${userId}>! 💀\nYou're built different fr fr!`,
                `<@${userId}> conquered FIRE MODE ${fireMode}! 💀🔥\nFew humans make it this far!`
            ];
            loseMessages = [
                `<@${userId}> died in the **DEATH ZONE** 💀\nFire Mode ${fireMode} claims another victim!`,
                `💀 The Death Zone was too much for <@${userId}> 💀\nBut respect for making it there!`,
                `<@${userId}> fell at Fire Mode ${fireMode}! 💀\nThe Death Zone is unforgiving!`
            ];
        } else if (fireMode >= 6) {
            // Volcanic (6-7)
            winMessages = [
                `🌋 <@${userId}> SURVIVED THE **VOLCANIC ERUPTION**! 🌋\nFire Mode ${fireMode} champion!`,
                `🌋🌋 **ERUPTION SURVIVOR**: <@${userId}>! 🌋🌋\nThe lava couldn't burn you!`,
                `<@${userId}> conquered the volcano at Fire Mode ${fireMode}! 🌋🔥`
            ];
            loseMessages = [
                `<@${userId}> got buried by the **VOLCANIC ERUPTION** 🌋💀\nFire Mode ${fireMode} too hot!`,
                `🌋 The volcano claimed <@${userId}> at Fire Mode ${fireMode}! 🌋`,
                `<@${userId}> couldn't handle the ERUPTION! 🌋\nSolid effort though!`
            ];
        } else if (fireMode >= 4) {
            // Thunder/Lightning (4-5)
            winMessages = [
                `⚡ <@${userId}> conquered **THUNDER MODE**! ⚡\nFire Mode ${fireMode} complete!`,
                `⚡⚡ **LIGHTNING FAST**: <@${userId}>! ⚡⚡\nYou matched my speed!`,
                `<@${userId}> survived the storm at Fire Mode ${fireMode}! ⚡🏆`
            ];
            loseMessages = [
                `<@${userId}> got struck by **LIGHTNING** ⚡💀\nFire Mode ${fireMode} too fast!`,
                `⚡ Thunder claimed <@${userId}> at Fire Mode ${fireMode}! ⚡`,
                `<@${userId}> couldn't keep up with the storm! ⚡\nGood attempt though!`
            ];
        } else {
            // Fire modes 1-3 (warm up / getting hot / on fire)
            winMessages = [
                `🏆 <@${userId}> won at Fire Mode ${fireMode}! 🔥`,
                `W for <@${userId}>! 🔥 Solid bars!`,
                `<@${userId}> took the crown! 👑🔥`,
                `gg <@${userId}>, your flow was clean 💯`
            ];
            loseMessages = [
                `<@${userId}> lost at Fire Mode ${fireMode} 💀`,
                `L for <@${userId}>... try again! 😂`,
                `<@${userId}> got cooked early 🔥💀`,
                `gg ez <@${userId}>, HUMANOID wins 🏆`
            ];
        }

        const randomWin = winMessages[Math.floor(Math.random() * winMessages.length)];
        const randomLose = loseMessages[Math.floor(Math.random() * loseMessages.length)];
        
        // Build result message with score and fire mode info
        const barsDropped = battle.userBars || 0;
        const fireModeText = `${fmEmoji} Fire Mode Reached: **${fireMode}/15 (${fmName})**`;
        const scoreText = barsDropped > 0 ? `\n📊 Stats: ${barsDropped} bars | Score: ${userScore}` : '';
        const cooldownInfo = `\n⏱️ Cooldown: ${cooldownMinutes} minute${cooldownMinutes > 1 ? 's' : ''}`;
        const message = (userWon ? randomWin : randomLose) + `\n${fireModeText}${scoreText}${cooldownInfo}`;
        
        channel.send(message).catch(err => {
            console.error('Failed to send rap battle end message:', err);
        });
    }

    // ============ USER FEATURES HANDLERS ============

    async handleRemindCommand(interaction) {
        const userFeatures = require('./user-features');
        const subcommand = interaction.options.getSubcommand();
        const userId = interaction.user.id;
        const channelId = interaction.channelId;

        try {
            if (subcommand === 'set') {
                const message = interaction.options.getString('message');
                const timeInput = interaction.options.getString('time');
                
                const result = await userFeatures.createReminder(userId, channelId, message, timeInput);
                
                if (!result.success) {
                    await interaction.editReply(result.error);
                    return;
                }
                
                await interaction.editReply(
                    `⏰ Reminder set, sir.\n**Message:** ${message}\n**When:** ${result.formattedTime}\n**ID:** \`${result.reminder.id}\``
                );
            } else if (subcommand === 'list') {
                const reminders = await userFeatures.getUserReminders(userId);
                
                if (reminders.length === 0) {
                    await interaction.editReply('No pending reminders, sir. Use `/remind set` to create one.');
                    return;
                }
                
                const lines = await Promise.all(reminders.map(async (r, i) => {
                    const time = await userFeatures.formatTimeForUser(userId, new Date(r.scheduledFor));
                    return `${i + 1}. **${r.message}**\n   ⏰ ${time} | ID: \`${r.id}\``;
                }));
                
                await interaction.editReply(`📋 **Your Reminders:**\n\n${lines.join('\n\n')}`);
            } else if (subcommand === 'cancel') {
                const reminderId = interaction.options.getString('id');
                const result = await userFeatures.cancelReminder(userId, reminderId);
                
                if (!result.success) {
                    await interaction.editReply(result.error);
                    return;
                }
                
                await interaction.editReply('✅ Reminder cancelled, sir.');
            }
        } catch (error) {
            console.error('[/remind] Error:', error);
            await interaction.editReply('Failed to process reminder command, sir.');
        }
    }

    async handleTimezoneCommand(interaction) {
        const userFeatures = require('./user-features');
        const userId = interaction.user.id;
        const zone = interaction.options.getString('zone');

        try {
            if (!zone) {
                const currentZone = await userFeatures.getTimezone(userId);
                const currentTime = await userFeatures.formatTimeForUser(userId);
                await interaction.editReply(
                    `🌍 **Your Timezone:** ${currentZone}\n🕐 **Current Time:** ${currentTime}\n\nUse \`/timezone zone:America/New_York\` to change.`
                );
                return;
            }

            const result = await userFeatures.setTimezone(userId, zone);
            
            if (!result.success) {
                await interaction.editReply(result.error);
                return;
            }

            const currentTime = await userFeatures.formatTimeForUser(userId);
            await interaction.editReply(`✅ Timezone set to **${result.timezone}**\n🕐 Current time: ${currentTime}`);
        } catch (error) {
            console.error('[/timezone] Error:', error);
            await interaction.editReply('Failed to update timezone, sir.');
        }
    }

    async handleWakewordCommand(interaction) {
        const userFeatures = require('./user-features');
        const userId = interaction.user.id;
        const word = interaction.options.getString('word');

        try {
            if (!word) {
                const currentWord = await userFeatures.getWakeWord(userId);
                if (currentWord) {
                    await interaction.editReply(`🎯 **Your Custom Wake Word:** "${currentWord}"\n\nUse \`/wakeword word:newword\` to change, or say "${currentWord}" to summon me.`);
                } else {
                    await interaction.editReply(`No custom wake word set, sir.\n\nUse \`/wakeword word:yourword\` to set one. I'll respond when you say it!`);
                }
                return;
            }

            const result = await userFeatures.setWakeWord(userId, word);
            
            if (!result.success) {
                await interaction.editReply(result.error);
                return;
            }

            await interaction.editReply(`✅ Custom wake word set to **"${result.wakeWord}"**\n\nNow you can summon me by saying "${result.wakeWord}" in any message!`);
        } catch (error) {
            console.error('[/wakeword] Error:', error);
            await interaction.editReply('Failed to update wake word, sir.');
        }
    }

    async handleMyStatsCommand(interaction) {
        const userFeatures = require('./user-features');
        const userId = interaction.user.id;

        try {
            const stats = await userFeatures.getUserStats(userId);
            const timezone = await userFeatures.getTimezone(userId);
            const wakeWord = await userFeatures.getWakeWord(userId);
            
            const firstDate = new Date(stats.firstInteraction);
            const daysSince = Math.floor((Date.now() - stats.firstInteraction) / (1000 * 60 * 60 * 24));
            
            const embed = {
                color: 0x3498db,
                title: `📊 ${interaction.user.username}'s Jarvis Stats`,
                fields: [
                    { name: '💬 Messages', value: `${stats.messageCount || 0}`, inline: true },
                    { name: '🔍 Searches', value: `${stats.searchesPerformed || 0}`, inline: true },
                    { name: '⚡ Commands', value: `${stats.commandsUsed || 0}`, inline: true },
                    { name: '⏰ Reminders Created', value: `${stats.remindersCreated || 0}`, inline: true },
                    { name: '🌍 Timezone', value: timezone, inline: true },
                    { name: '🎯 Wake Word', value: wakeWord || 'None set', inline: true },
                    { name: '📅 First Interaction', value: `${firstDate.toLocaleDateString()} (${daysSince} days ago)`, inline: false },
                ],
                footer: { text: 'Stats are approximate and may reset periodically' },
                timestamp: new Date().toISOString()
            };

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('[/mystats] Error:', error);
            await interaction.editReply('Failed to retrieve stats, sir.');
        }
    }
}

module.exports = new DiscordHandlers();

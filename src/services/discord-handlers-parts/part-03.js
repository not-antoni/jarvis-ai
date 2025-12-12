
            // Web search support via keyword trigger ("jarvis search ...")
            // Uses existing Brave integration for stability.
            const activeInvocation = braveInvocation.triggered ? braveInvocation : rawBraveInvocation;
            const querySource = activeInvocation?.query || '';
            const invocationContext = activeInvocation?.invocation || null;
            const rawSegmentCandidate = activeInvocation?.rawQuery || activeInvocation?.invocation || rawContent;
            const explicitDetected = Boolean(activeInvocation?.explicit);

            if (explicitDetected) {
                await message.reply({
                    content: braveSearch.getExplicitQueryMessage
                        ? braveSearch.getExplicitQueryMessage()
                        : 'I must decline that request, sir. My safety filters forbid it.'
                });
                this.setCooldown(message.author.id, messageScope);
                return;
            }

            const preparedQuery = typeof braveSearch.prepareQueryForApi === 'function'
                ? braveSearch.prepareQueryForApi(querySource)
                : (querySource || '').trim();

            if (preparedQuery) {
                try {
                    const rawSegmentForCheck = (typeof rawSegmentCandidate === 'string' && rawSegmentCandidate.length > 0)
                        ? rawSegmentCandidate
                        : ((typeof invocationContext === 'string' && invocationContext.length > 0)
                            ? invocationContext
                            : preparedQuery);

                    if (braveSearch.isExplicitQuery && (
                        braveSearch.isExplicitQuery(preparedQuery, { rawSegment: rawSegmentForCheck }) ||
                        (rawSegmentForCheck && braveSearch.isExplicitQuery(rawSegmentForCheck, { rawSegment: rawSegmentForCheck }))
                    )) {
                        await message.reply({
                            content: braveSearch.getExplicitQueryMessage
                                ? braveSearch.getExplicitQueryMessage()
                                : 'I must decline that request, sir. My safety filters forbid it.'
                        });
                        this.setCooldown(message.author.id, messageScope);
                        return;
                    }

                    await message.channel.sendTyping();
                    const response = await this.jarvis.handleBraveSearch({
                        raw: rawSegmentForCheck,
                        prepared: preparedQuery,
                        invocation: invocationContext,
                        content: cleanContent,
                        rawMessage: rawContent,
                        rawInvocation: rawBraveInvocation.invocation,
                        explicit: explicitDetected
                    });
                    await message.reply(response);
                    this.setCooldown(message.author.id, messageScope);
                    return;
                } catch (error) {
                    console.error("Brave search error:", error);
                    await message.reply("Web search failed, sir. Technical difficulties.");
                    this.setCooldown(message.author.id, messageScope);
                    return;
                }
            } else {
                await message.reply("Please provide a web search query after 'jarvis search', sir.");
                this.setCooldown(message.author.id, messageScope);
                return;
            }
        }

        if (!cleanContent) {
            cleanContent = "jarvis";
        } else {
            const wakeWordPattern = new RegExp(`^(${config.wakeWords.join('|')})[,.!?]*$`, 'i');
            if (wakeWordPattern.test(cleanContent)) {
                cleanContent = "jarvis";
            }
        }

        // Parse Discord mentions to show display names instead of raw IDs
        // Handles user mentions <@123> and <@!123>, role mentions <@&123>, channel mentions <#123>
        if (message.mentions) {
            // Prefer guild member display names (nicknames), fall back to globalName/username
            const memberMap = message.mentions.members;
            if (memberMap && memberMap.size > 0) {
                for (const [userId, member] of memberMap) {
                    const displayName = member?.displayName || member?.user?.globalName || member?.user?.username || 'user';
                    cleanContent = cleanContent.replace(new RegExp(`<@!?${userId}>`, 'g'), `@${displayName}`);
                }
            } else {
                for (const [userId, user] of message.mentions.users) {
                    const displayName = user?.globalName || user?.username || 'user';
                    cleanContent = cleanContent.replace(new RegExp(`<@!?${userId}>`, 'g'), `@${displayName}`);
                }
            }
            // Replace role mentions with @rolename
            for (const [roleId, role] of message.mentions.roles) {
                cleanContent = cleanContent.replace(new RegExp(`<@&${roleId}>`, 'g'), `@${role.name}`);
            }
            // Replace channel mentions with #channelname
            for (const [channelId, channel] of message.mentions.channels) {
                cleanContent = cleanContent.replace(new RegExp(`<#${channelId}>`, 'g'), `#${channel.name}`);
            }
        }

        try {
            await message.channel.sendTyping();
        } catch (err) {
            console.warn("Failed to send typing (permissions?):", err);
        }

        if (cleanContent.length > config.ai.maxInputLength) {
            const responses = [
                "Rather verbose, sir. A concise version, perhaps?",
                "Too many words, sir. Brevity, please.",
                "TL;DR, sir.",
                "Really, sir?",
                "Saving your creativity for later, sir.",
                `${config.ai.maxInputLength} characters is the limit, sir.`,
                "Stop yapping, sir.",
                "Quite the novella, sir. Abridged edition?",
                "Brevity is the soul of wit, sir.",
            ];

            try {
                await message.reply(responses[Math.floor(Math.random() * responses.length)]);
            } catch (err) {
                console.error("Failed to reply (permissions?):", err);
            }
            this.setCooldown(message.author.id, messageScope);
            return;
        }

        if (cleanContent.length > config.ai.maxInputLength) {
            cleanContent = cleanContent.substring(0, config.ai.maxInputLength) + "...";
        }

        try {
            const utilityResponse = await this.jarvis.handleUtilityCommand(
                cleanContent,
                message.author.username,
                message.author.id,
                false,
                null,
                message.guild?.id || null
            );

            if (utilityResponse) {
                if (typeof utilityResponse === "string" && utilityResponse.trim()) {
                    await message.reply(utilityResponse);
                } else {
                    await message.reply("Utility functions misbehaving, sir. Try another?");
                }
                return;
            }

            // Extract image attachments for vision processing
            let imageAttachments = message.attachments
                ? Array.from(message.attachments.values())
                    .filter(att => {
                        const contentType = att.contentType || '';
                        const ext = (att.name || '').split('.').pop()?.toLowerCase();
                        const imageExts = ['jpg', 'jpeg', 'png', 'webp', 'gif'];
                        return contentType.startsWith('image/') || imageExts.includes(ext);
                    })
                    .map(att => ({ url: att.url, contentType: att.contentType }))
                : [];

            // Also check for images AND text in replied message
            let repliedContext = '';
            if (message.reference?.messageId) {
                try {
                    const repliedMessage = await message.channel.messages.fetch(message.reference.messageId);
                    
                    // Extract text from replied message for context (limit to leave room for user's message)
                    if (repliedMessage?.content && repliedMessage.content.trim()) {
                        // Reserve space for user's message, cap replied context
                        const maxReplyContext = Math.min(300, Math.max(100, config.ai.maxInputLength - cleanContent.length - 50));
                        const trimmedReply = repliedMessage.content.substring(0, maxReplyContext);
                        repliedContext = `[Replied to ${repliedMessage.author?.username || 'user'}: "${trimmedReply}${repliedMessage.content.length > maxReplyContext ? '...' : ''}"]\n`;
                    }
                    
                    // Extract images from replied message (only if current message has no images)
                    if (imageAttachments.length === 0) {
                        if (repliedMessage?.attachments?.size > 0) {
                            const repliedImages = Array.from(repliedMessage.attachments.values())
                                .filter(att => {
                                    const contentType = att.contentType || '';
                                    const ext = (att.name || '').split('.').pop()?.toLowerCase();
                                    const imageExts = ['jpg', 'jpeg', 'png', 'webp', 'gif'];
                                    return contentType.startsWith('image/') || imageExts.includes(ext);
                                })
                                .map(att => ({ url: att.url, contentType: att.contentType, fromReply: true }));
                            imageAttachments = [...imageAttachments, ...repliedImages];
                        }
                        // Also check embeds for images (e.g., Discord CDN previews, Tenor GIFs)
                        if (repliedMessage?.embeds?.length > 0) {
                            for (const embed of repliedMessage.embeds) {
                                if (embed.image?.url) {
                                    imageAttachments.push({ url: embed.image.url, contentType: 'image/unknown', fromReply: true });
                                }
                                if (embed.thumbnail?.url && !imageAttachments.some(a => a.url === embed.thumbnail.url)) {
                                    imageAttachments.push({ url: embed.thumbnail.url, contentType: 'image/unknown', fromReply: true });
                                }
                            }
                        }
                    }
                } catch (err) {
                    console.warn('[Vision] Failed to fetch replied message:', err.message);
                }
            }

            // Combine replied context with user's message, respecting max length
            let fullContent = repliedContext ? repliedContext + cleanContent : cleanContent;
            if (fullContent.length > config.ai.maxInputLength) {
                // Prioritize user's message, trim replied context if needed
                const availableForReply = config.ai.maxInputLength - cleanContent.length - 20;
                if (availableForReply > 50 && repliedContext) {
                    repliedContext = repliedContext.substring(0, availableForReply) + '..."]\n';
                    fullContent = repliedContext + cleanContent;
                } else {
                    fullContent = cleanContent.substring(0, config.ai.maxInputLength);
                }
            }

            if (process.env.JARVIS_DEBUG_AI_INPUT === '1') {
                console.log('[Jarvis AI Input]', {
                    userId: message.author?.id,
                    hasReply: Boolean(message.reference?.messageId),
                    replyContextChars: repliedContext ? repliedContext.length : 0,
                    userPromptChars: typeof cleanContent === 'string' ? cleanContent.length : 0,
                    fullPromptChars: typeof fullContent === 'string' ? fullContent.length : 0,
                    images: Array.isArray(imageAttachments) ? imageAttachments.length : 0,
                    fromReplyImages: Array.isArray(imageAttachments)
                        ? imageAttachments.filter(i => i && i.fromReply).length
                        : 0
                });
            }

            const response = await this.jarvis.generateResponse(message, fullContent, false, contextualMemory, imageAttachments);

            if (typeof response === "string" && response.trim()) {
                await message.reply(response);
            } else {
                await message.reply("Response circuits tangled, sir. Clarify your request?");
            }
        } catch (error) {
            console.error("Error processing message:", error);
            try {
                await message.reply("Technical difficulties, sir. One moment, please.");
            } catch (err) {
                console.error("Failed to send error reply:", err);
            }
        }
    }

    async handleServerStatsCommand(interaction) {
        if (!interaction.guild) {
            await interaction.editReply('This command is only available within a server, sir.');
            return;
        }

        if (!database.isConnected) {
            await interaction.editReply('My database uplink is offline, sir. Server stats are unavailable at the moment.');
            return;
        }

        const guild = interaction.guild;
        const member = interaction.member;
        const subcommand = interaction.options.getSubcommand();
                const guildConfig = await this.getGuildConfig(guild);

        const isModerator = await this.isGuildModerator(member, guildConfig);
        if (!isModerator) {
            await interaction.editReply('Only the server owner or configured moderators may do that, sir.');
            return;
        }

        try {
            if (subcommand === 'status') {
                const config = await database.getServerStatsConfig(guild.id);
                if (!config) {
                    await interaction.editReply('Server statistics channels are not configured, sir.');
                    return;
                }

                const stats = await this.collectGuildMemberStats(guild);
                const category = await this.resolveGuildChannel(guild, config.categoryId);
                const totalChannel = await this.resolveGuildChannel(guild, config.totalChannelId);
                const userChannel = await this.resolveGuildChannel(guild, config.userChannelId);
                const botChannel = await this.resolveGuildChannel(guild, config.botChannelId);
                const channelCountChannel = await this.resolveGuildChannel(guild, config.channelCountChannelId);
                const roleCountChannel = await this.resolveGuildChannel(guild, config.roleCountChannelId);

                const lines = [
                    `Category: ${category ? `<#${category.id}>` : 'Missing'}`,
                    `Member channel: ${totalChannel ? `<#${totalChannel.id}>` : 'Missing'}`,
                    `User channel: ${userChannel ? `<#${userChannel.id}>` : 'Missing'}`,
                    `Bot channel: ${botChannel ? `<#${botChannel.id}>` : 'Missing'}`,
                    `Channel count channel: ${channelCountChannel ? `<#${channelCountChannel.id}>` : 'Missing'}`,
                    `Role count channel: ${roleCountChannel ? `<#${roleCountChannel.id}>` : 'Missing'}`,
                    `Current totals — Members: ${this.formatServerStatsValue(stats.total)}, Users: ${this.formatServerStatsValue(stats.userCount)}, Bots: ${this.formatServerStatsValue(stats.botCount)}, Channels: ${this.formatServerStatsValue(stats.channelCount)}, Roles: ${this.formatServerStatsValue(stats.roleCount)}`
                ];

                await interaction.editReply(`Server statistics are active, sir.\n${lines.join('\n')}`);
                return;
            }

            if (subcommand === 'enable') {
                const existing = await database.getServerStatsConfig(guild.id);
                await this.updateServerStats(guild, existing);
                await interaction.editReply('Server statistics channels are ready, sir. I will refresh them every 10 minutes.');
                return;
            }

            if (subcommand === 'refresh') {
                const existing = await database.getServerStatsConfig(guild.id);
                if (!existing) {
                    await interaction.editReply('Server statistics are not configured yet, sir.');
                    return;
                }

                await this.updateServerStats(guild, existing);
                await interaction.editReply('Server statistics channels refreshed, sir.');
                return;
            }

            if (subcommand === 'report') {
                const publish = interaction.options.getBoolean('public') || false;
                const stats = await this.collectGuildMemberStats(guild);

                const summaryLines = [
                    `**${guild.name || 'Server'} Snapshot**`,
                    `• Members: ${this.formatServerStatsValue(stats.total)}`,
                    `• Humans: ${this.formatServerStatsValue(stats.userCount)}`,
                    `• Bots: ${this.formatServerStatsValue(stats.botCount)}`,
                    `• Channels: ${this.formatServerStatsValue(stats.channelCount)}`,
                    `• Roles: ${this.formatServerStatsValue(stats.roleCount)}`
                ];

                let chartBuffer = null;
                try {
                    chartBuffer = this.renderServerStatsChart(stats, guild.name || 'Server Snapshot');
                } catch (error) {
                    console.warn('Failed to render server stats chart:', error);
                }

                if (publish) {
                    await interaction.editReply('Compiling your report, sir...');
                    if (chartBuffer) {
                        const attachment = new AttachmentBuilder(chartBuffer, { name: 'server-report.png' });
                        await interaction.channel.send({ content: summaryLines.join('\n'), files: [attachment] });
                    } else {
                        await interaction.channel.send(summaryLines.join('\n'));
                    }
                    await interaction.editReply('Report posted to the channel, sir.');
                } else {
                    if (chartBuffer) {
                        const attachment = new AttachmentBuilder(chartBuffer, { name: 'server-report.png' });
                        await interaction.editReply({ content: summaryLines.join('\n'), files: [attachment] });
                    } else {
                        await interaction.editReply(summaryLines.join('\n'));
                    }
                }
                return;
            }

            if (subcommand === 'disable') {
                const existing = await database.getServerStatsConfig(guild.id);
                if (!existing) {
                    await interaction.editReply('Server statistics channels were not configured, sir.');
                    return;
                }

                await this.disableServerStats(guild, existing);
                await interaction.editReply('Server statistics channels have been removed, sir.');
                return;
            }

            await interaction.editReply('I am not certain how to handle that server stats request, sir.');
        } catch (error) {
            console.error('Failed to handle server stats command:', error);
            if (error.isFriendly || error.code === 50013) {
                await interaction.editReply(error.message || 'I could not adjust the server statistics, sir.');
            } else {
                await interaction.editReply('I could not adjust the server statistics, sir.');
            }
        }
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

    async handleAutoModCommand(interaction) {
        if (!interaction.guild) {
            await interaction.editReply('This command is only available within a server, sir.');
            return;
        }

        if (!database.isConnected) {
            await interaction.editReply('My database uplink is offline, sir. Auto moderation is unavailable at the moment.');
            return;
        }

        const guild = interaction.guild;
        const member = interaction.member;
        const subcommand = interaction.options.getSubcommand();
        const subcommandGroup = interaction.options.getSubcommandGroup(false);
        const guildConfig = await this.getGuildConfig(guild);

        const isModerator = await this.isGuildModerator(member, guildConfig);
        if (!isModerator) {
            await interaction.editReply('Only the server owner or configured moderators may do that, sir.');
            return;
        }

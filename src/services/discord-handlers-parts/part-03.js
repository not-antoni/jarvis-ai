
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
                    ,
                    allowedMentions: { parse: [] }
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
                            ,
                            allowedMentions: { parse: [] }
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
                    const safe = this.sanitizePings(typeof response === 'string' ? response : String(response || ''));
                    await message.reply({ content: safe, allowedMentions: { parse: [] } });
                    this.setCooldown(message.author.id, messageScope);
                    return;
                } catch (error) {
                    console.error("Brave search error:", error);
                    await message.reply({ content: "Web search failed, sir. Technical difficulties.", allowedMentions: { parse: [] } });
                    this.setCooldown(message.author.id, messageScope);
                    return;
                }
            } else {
                await message.reply({ content: "Please provide a web search query after 'jarvis search', sir.", allowedMentions: { parse: [] } });
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
                    cleanContent = cleanContent.replace(new RegExp(`<@!?${userId}>`, 'g'), `${displayName}`);
                }
            } else {
                for (const [userId, user] of message.mentions.users) {
                    const displayName = user?.globalName || user?.username || 'user';
                    cleanContent = cleanContent.replace(new RegExp(`<@!?${userId}>`, 'g'), `${displayName}`);
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
                    const safe = this.sanitizePings(utilityResponse);
                    await message.reply({ content: safe, allowedMentions: { parse: [] } });
                } else {
                    await message.reply({ content: "Utility functions misbehaving, sir. Try another?", allowedMentions: { parse: [] } });
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
                    let repliedDisplayName = repliedMessage.author?.username || 'user';
                    if (message.guild && repliedMessage.author?.id) {
                        const repliedMember =
                            repliedMessage.member ||
                            (await message.guild.members.fetch(repliedMessage.author.id).catch(() => null));
                        repliedDisplayName =
                            repliedMember?.displayName ||
                            repliedMessage.author?.globalName ||
                            repliedMessage.author?.username ||
                            'user';
                    } else {
                        repliedDisplayName =
                            repliedMessage.author?.globalName || repliedMessage.author?.username || 'user';
                    }
                    
                    // Extract text from replied message for context (limit to leave room for user's message)
                    const repliedText = (repliedMessage?.cleanContent || repliedMessage?.content || '').trim();
                    if (repliedText) {
                        // Reserve space for user's message, cap replied context
                        const maxReplyContext = Math.min(300, Math.max(100, config.ai.maxInputLength - cleanContent.length - 50));
                        const trimmedReply = repliedText.substring(0, maxReplyContext);
                        repliedContext = `[Replied to ${repliedDisplayName}: "${trimmedReply}${repliedText.length > maxReplyContext ? '...' : ''}"]\n`;
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

            // If still no images, check the previous message in the channel (for GIFs/images sent right before the ping)
            if (imageAttachments.length === 0 && message.channel) {
                try {
                    const previousMessages = await message.channel.messages.fetch({ limit: 2, before: message.id });
                    const prevMsg = previousMessages.first();
                    if (prevMsg && prevMsg.author?.id === message.author?.id) {
                        // Only check if same author sent the previous message (within last few seconds context)
                        const timeDiff = message.createdTimestamp - prevMsg.createdTimestamp;
                        if (timeDiff < 30000) { // Within 30 seconds
                            if (prevMsg.attachments?.size > 0) {
                                const prevImages = Array.from(prevMsg.attachments.values())
                                    .filter(att => {
                                        const contentType = att.contentType || '';
                                        const ext = (att.name || '').split('.').pop()?.toLowerCase();
                                        const imageExts = ['jpg', 'jpeg', 'png', 'webp', 'gif'];
                                        return contentType.startsWith('image/') || imageExts.includes(ext);
                                    })
                                    .map(att => ({ url: att.url, contentType: att.contentType, fromPrevious: true }));
                                imageAttachments = [...imageAttachments, ...prevImages];
                                if (prevImages.length > 0) {
                                    console.log(`[Vision] Found ${prevImages.length} image(s) in previous message`);
                                }
                            }
                            // Also check embeds in previous message
                            if (prevMsg.embeds?.length > 0) {
                                for (const embed of prevMsg.embeds) {
                                    if (embed.image?.url) {
                                        imageAttachments.push({ url: embed.image.url, contentType: 'image/unknown', fromPrevious: true });
                                    }
                                    if (embed.thumbnail?.url && !imageAttachments.some(a => a.url === embed.thumbnail.url)) {
                                        imageAttachments.push({ url: embed.thumbnail.url, contentType: 'image/unknown', fromPrevious: true });
                                    }
                                }
                            }
                        }
                    }
                } catch (err) {
                    console.warn('[Vision] Failed to fetch previous message:', err.message);
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

            // Parse optional emoji reaction tag from AI response
            let reactEmoji = null;
            let cleanResponse = response;
            if (typeof response === 'string') {
                const reactMatch = response.match(/\[REACT:(.+?)\]\s*$/);
                if (reactMatch) {
                    reactEmoji = reactMatch[1].trim();
                    cleanResponse = response.replace(/\s*\[REACT:.+?\]\s*$/, '').trim();
                }
            }

            if (typeof cleanResponse === "string" && cleanResponse.trim()) {
                const safe = this.sanitizePings(cleanResponse);
                const chunks = splitMessage(safe);
                for (let i = 0; i < chunks.length; i++) {
                    if (i === 0) {
                        await message.reply({ content: chunks[i], allowedMentions: { parse: [] } });
                    } else {
                        await message.channel.send({ content: chunks[i], allowedMentions: { parse: [] } });
                    }
                }
            } else {
                await message.reply({ content: "Response circuits tangled, sir. Clarify your request?", allowedMentions: { parse: [] } });
            }

            // Apply emoji reaction if the AI suggested one
            if (reactEmoji) {
                try {
                    await message.react(reactEmoji);
                } catch (_) {
                    // Custom emoji format: <:name:id> or <a:name:id> — extract the ID
                    const customMatch = reactEmoji.match(/<a?:\w+:(\d+)>/);
                    if (customMatch) {
                        try { await message.react(customMatch[1]); } catch (_e) { /* emoji unavailable */ }
                    }
                }
            }
        } catch (error) {
            // Generate unique error code for debugging
            const errorId = `J-${Date.now().toString(36).slice(-4).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
            console.error(`[${errorId}] Error processing message:`, error);
            try {
                await message.reply({ content: `Technical difficulties, sir. (${errorId}) Please try again shortly.`, allowedMentions: { parse: [] } });
            } catch (err) {
                console.error(`[${errorId}] Failed to send error reply:`, err);
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

                // Add activity insights if available
                try {
                    const activityTracker = require('./GUILDS_FEATURES/activity-tracker');
                    const activity = activityTracker.getActivitySummary(guild.id);
                    if (activity && activity.totalMessages > 0) {
                        summaryLines.push('', '**Activity (since last restart)**');
                        summaryLines.push(`• Messages tracked: ${activity.totalMessages}`);
                        summaryLines.push(`• Active users: ${activity.uniqueUsers}`);
                        summaryLines.push(`• Msgs/min: ${activity.messagesPerMinute}`);
                        if (activity.peakHour !== undefined) {
                            summaryLines.push(`• Peak hour: ${activity.peakHour}:00`);
                        }
                        if (activity.topChannels.length > 0) {
                            const topChans = activity.topChannels.slice(0, 3).map(c => `<#${c.channelId}> (${c.count})`).join(', ');
                            summaryLines.push(`• Top channels: ${topChans}`);
                        }
                    }
                } catch (_e) { /* activity tracker not available */ }

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

    async handleAutoModCommand(interaction) {
        return await automodSlash.handleAutoModCommand(this, interaction);
    }

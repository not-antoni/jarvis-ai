            }

            console.error('Failed to handle member log command:', error);
            await replyWithError('I could not complete that member log request, sir.');
        }
    }

    async fetchNewsFromTheNewsApi(topic, limit = 5) {
        if (!NEWS_API_KEY) return [];

        const searchParam = encodeURIComponent(topic);
        const url = `https://api.thenewsapi.com/v1/news/top?api_token=${NEWS_API_KEY}&language=en&limit=${limit}&search=${searchParam}`;

        const response = await fetch(url, {
            headers: { 'Accept': 'application/json' }
        });

        if (!response.ok) {
            throw new Error(`TheNewsAPI request failed: ${response.status}`);
        }

        const data = await response.json();
        const articles = Array.isArray(data?.data) ? data.data : [];

        return articles.map((article) => ({
            title: article.title || 'Untitled story',
            description: article.description || '',
            url: article.url || null,
            source: article.source || article.source_url || 'TheNewsAPI',
            published: article.published_at ? new Date(article.published_at) : null,
            image: article.image_url || null
        }));
    }

    async handleTicketCommand(interaction) {
        const guild = interaction.guild;

        if (!guild) {
            await interaction.editReply('Ticket operations must be run inside a server, sir.');
            return;
        }

        if (!database.isConnected) {
            await interaction.editReply('Database uplink offline, sir. Ticketing is unavailable.');
            return;
        }

        const subcommand = interaction.options.getSubcommand();
        const me = guild.members.me || await guild.members.fetchMe().catch(() => null);

        if (!me || !me.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
            await interaction.editReply('I require the "Manage Channels" permission to manage tickets, sir.');
            return;
        }

        if (subcommand === 'open') {
            const reasonInput = interaction.options.getString('reason') || 'No reason provided.';
            const reason = reasonInput.length > 500 ? `${reasonInput.slice(0, 497)}…` : reasonInput;

            const existing = await database.getOpenTicket(guild.id, interaction.user.id);
            if (existing) {
                await interaction.editReply(`You already have an open ticket, sir: <#${existing.channelId}>.`);
                return;
            }

            const category = await this.ensureTicketCategory(guild);
            if (!category) {
                await interaction.editReply('I could not prepare the ticket workspace due to missing permissions, sir.');
                return;
            }

            const staffRoleIds = this.getTicketStaffRoleIds(guild);
            const ticketNumber = await database.reserveCounter(`ticket:${guild.id}`);
            const channelName = `ticket-${String(ticketNumber).padStart(4, '0')}`;

            const overwrites = [
                { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                {
                    id: interaction.user.id,
                    allow: [
                        PermissionsBitField.Flags.ViewChannel,
                        PermissionsBitField.Flags.SendMessages,
                        PermissionsBitField.Flags.ReadMessageHistory,
                        PermissionsBitField.Flags.AttachFiles
                    ]
                },
                {
                    id: me.id,
                    allow: [
                        PermissionsBitField.Flags.ViewChannel,
                        PermissionsBitField.Flags.SendMessages,
                        PermissionsBitField.Flags.ManageChannels,
                        PermissionsBitField.Flags.ReadMessageHistory,
                        PermissionsBitField.Flags.AttachFiles
                    ]
                }
            ];

            for (const roleId of staffRoleIds) {
                overwrites.push({
                    id: roleId,
                    allow: [
                        PermissionsBitField.Flags.ViewChannel,
                        PermissionsBitField.Flags.SendMessages,
                        PermissionsBitField.Flags.ReadMessageHistory,
                        PermissionsBitField.Flags.AttachFiles
                    ]
                });
            }

            let channel;
            try {
                channel = await guild.channels.create({
                    name: channelName,
                    type: ChannelType.GuildText,
                    parent: category.id,
                    reason: `Support ticket for ${interaction.user.tag}`,
                    permissionOverwrites: overwrites
                });
            } catch (error) {
                console.error('Failed to create ticket channel:', error);
                await interaction.editReply('Ticket bay doors jammed, sir. I could not create a private channel.');
                return;
            }

            try {
                const ticketRecord = await database.createTicket({
                    guildId: guild.id,
                    openerId: interaction.user.id,
                    channelId: channel.id,
                    ticketNumber,
                    reason,
                    staffRoleIds
                });

                const staffMentions = staffRoleIds.length
                    ? staffRoleIds.map((id) => `<@&${id}>`).join(' ')
                    : null;

                const headerLines = [
                    `Hello <@${interaction.user.id}>, I have opened ticket #${String(ticketRecord.ticketNumber).padStart(4, '0')} for you.`,
                    'Please describe the issue in detail so the staff can assist.'
                ];
                if (staffMentions) {
                    headerLines.push(`Staff notified: ${staffMentions}`);
                }

                await channel.send({
                    content: headerLines.join('\n'),
                    embeds: [
                        new EmbedBuilder()
                            .setTitle('Ticket opened')
                            .setDescription(reason)
                            .setColor(0x5865f2)
                            .setFooter({ text: 'Use /ticket close when finished.' })
                    ]
                });

                await interaction.editReply(`Ticket #${String(ticketRecord.ticketNumber).padStart(4, '0')} ready, sir: ${channel}.`);
            } catch (error) {
                console.error('Failed to persist ticket record:', error);
                try {
                    await channel.delete('Rolling back failed ticket creation');
                } catch (deleteError) {
                    console.warn('Failed to delete ticket channel during rollback:', deleteError);
                }
                await interaction.editReply('I could not store that ticket in the database, sir.');
            }

            return;
        }

        const member = interaction.member;
        const channel = interaction.channel;
        let ticket = null;

        if (subcommand === 'close' || subcommand === 'export') {
            const ticketIdInput = interaction.options.getString('ticket_id');
            if (ticketIdInput) {
                try {
                    ticket = await database.getTicketById(ticketIdInput.trim());
                } catch (error) {
                    console.warn('Invalid ticket_id supplied for /ticket command:', error);
                    await interaction.editReply('That ticket identifier is not valid, sir.');
                    return;
                }
            }

            if (!ticket && subcommand === 'export') {
                const ticketNumber = interaction.options.getInteger('ticket_number');
                if (ticketNumber && Number.isInteger(ticketNumber) && ticketNumber > 0) {
                    ticket = await database.getTicketByNumber(guild.id, ticketNumber);
                }
            }

            if (!ticket && channel) {
                ticket = await database.getTicketByChannel(channel.id);
            }

            if (!ticket) {
                await interaction.editReply('I could not locate a ticket record for this request, sir.');
                return;
            }
        }

        const isStaffMember = () => {
            if (!member) {
                return false;
            }

            if (ticket && member.id === ticket.openerId) {
                return true;
            }

            if (member.permissions?.has(PermissionsBitField.Flags.ManageGuild) ||
                member.permissions?.has(PermissionsBitField.Flags.ManageChannels) ||
                member.permissions?.has(PermissionsBitField.Flags.Administrator)) {
                return true;
            }

            if (ticket?.staffRoleIds?.some((id) => member.roles?.cache?.has(id))) {
                return true;
            }

            return false;
        };

        if (subcommand === 'close') {
            if (!isStaffMember()) {
                await interaction.editReply('Only the opener or server staff may close this ticket, sir.');
                return;
            }

            if (ticket.status === 'closed') {
                await interaction.editReply('This ticket was already closed, sir.');
                return;
            }

            const transcriptMessages = channel ? await this.collectTicketTranscript(channel) : [];
            const summary = `Ticket #${String(ticket.ticketNumber).padStart(4, '0')} closed by ${interaction.user.tag}.`;

            try {
                await database.saveTicketTranscript(ticket._id, {
                    messages: transcriptMessages,
                    messageCount: transcriptMessages.length,
                    summary
                });
                await database.closeTicket(ticket._id, { closedBy: interaction.user.id });
            } catch (error) {
                console.error('Failed to archive ticket transcript:', error);
                await interaction.editReply('I could not archive this ticket, sir. Try again shortly.');
                return;
            }

            if (channel) {
                try {
                    if (ticket.openerId) {
                        await channel.permissionOverwrites.edit(ticket.openerId, { SendMessages: false }).catch(() => null);
                    }
                    await channel.permissionOverwrites.edit(interaction.user.id, { SendMessages: false }).catch(() => null);
                    await channel.send({
                        embeds: [
                            new EmbedBuilder()
                                .setTitle('Ticket closed')
                                .setDescription(`Closed by ${interaction.user.tag}. Transcript archived.`)
                                .setColor(0xffa200)
                                .setTimestamp(new Date())
                        ]
                    });
                } catch (error) {
                    console.warn('Failed to lock ticket channel:', error);
                }

                if (channel.deletable) {
                    const deleteDelayMs = 5000;
                    setTimeout(() => {
                        channel.delete('Ticket closed and archived.')
                            .catch((error) => console.warn('Failed to delete ticket channel after closing:', error));
                    }, deleteDelayMs);
                }
            }

            try {
                const opener = await interaction.client.users.fetch(ticket.openerId);
                if (opener) {
                    await opener.send([
                        `Your ticket #${String(ticket.ticketNumber).padStart(4, '0')} has been closed by ${interaction.user.tag}.`,
                        `Reason: ${ticket.reason || 'No reason provided.'}`,
                        `Messages captured: ${transcriptMessages.length}`
                    ].join('\n'));
                }
            } catch (error) {
                console.warn('Failed to DM ticket summary to opener:', error);
            }

            await interaction.editReply('Ticket closed and archived, sir.');
            return;
        }

        if (subcommand === 'export') {
            if (!isStaffMember()) {
                await interaction.editReply('Only staff members may export ticket transcripts, sir.');
                return;
            }

            let transcript = await database.getTicketTranscript(ticket._id);

            if (!transcript) {
                let ticketChannel = null;
                if (ticket.channelId) {
                    try {
                        ticketChannel = await guild.channels.fetch(ticket.channelId);
                    } catch (error) {
                        console.warn('Unable to fetch ticket channel for export:', error);
                    }
                }

                const messages = ticketChannel ? await this.collectTicketTranscript(ticketChannel) : [];
                transcript = {
                    messages,
                    messageCount: messages.length,
                    summary: `Transcript exported for ticket #${String(ticket.ticketNumber).padStart(4, '0')}`
                };

                try {
                    await database.saveTicketTranscript(ticket._id, transcript);
                } catch (error) {
                    console.warn('Failed to persist freshly generated transcript:', error);
                }
            }

            const header = [
                `Ticket: ${String(ticket.ticketNumber).padStart(4, '0')}`,
                `Opened by: ${ticket.openerId}`,
                `Reason: ${ticket.reason || 'No reason provided.'}`,
                `Status: ${ticket.status}`,
                `Messages archived: ${transcript?.messageCount || 0}`,
                '---'
            ];

            const lines = [...header];
            if (transcript?.messages?.length) {
                for (const message of transcript.messages) {
                    const attachments = (message.attachments || [])
                        .map((att) => ` [attachment: ${att.name} ${att.url}]`)
                        .join('');
                    lines.push(`[${message.createdAt}] ${message.authorTag}: ${message.content || ''}${attachments}`.trim());
                }
            } else {
                lines.push('No transcript data available.');
            }

            const buffer = Buffer.from(lines.join('\n'), 'utf8');
            const attachment = new AttachmentBuilder(buffer, {
                name: `ticket-${String(ticket.ticketNumber).padStart(4, '0')}.txt`
            });

            const replyContent = [`Transcript for ticket #${String(ticket.ticketNumber).padStart(4, '0')}, sir.`];
            if (!ticket.channelId) {
                replyContent.push('This ticket channel no longer exists; transcript retrieved from archives.');
            }

            await interaction.editReply({
                content: replyContent.join(' '),
                files: [attachment]
            });
            return;
        }

        await interaction.editReply('I am not certain how to handle that ticket request, sir.');
    }

    async handleKnowledgeBaseCommand(interaction) {
        const guild = interaction.guild;

        if (!guild) {
            await interaction.editReply('Knowledge base controls only work inside a server, sir.');
            return;
        }

        if (!database.isConnected) {
            await interaction.editReply('Database uplink offline, sir. Knowledge base unavailable.');
            return;
        }

        if (!embeddingSystem.isAvailable) {
            await interaction.editReply('Embedding service unavailable, sir. Configure OPENAI or LOCAL_EMBEDDING_URL.');
            return;
        }

        const member = interaction.member;
        const hasAuthority = member?.permissions?.has(PermissionsBitField.Flags.ManageGuild) ||
            member?.permissions?.has(PermissionsBitField.Flags.Administrator);

        if (!hasAuthority) {
            await interaction.editReply('Only administrators may adjust the knowledge base, sir.');
            return;
        }

        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'add') {
            const title = interaction.options.getString('title', true);
            const textContent = interaction.options.getString('content');
            const attachment = interaction.options.getAttachment('file');

            const contentPieces = [];
            if (textContent && textContent.trim()) {
                contentPieces.push(textContent.trim());
            }

            if (attachment) {
                if (attachment.size && attachment.size > 5 * 1024 * 1024) {
                    await interaction.editReply('That file is larger than 5MB, sir. Please provide a smaller document.');
                    return;
                }

                try {
                    const response = await fetch(attachment.url);
                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}`);
                    }

                    const arrayBuffer = await response.arrayBuffer();
                    const buffer = Buffer.from(arrayBuffer);

                    let extracted = '';
                    const isPdf = (attachment.contentType && attachment.contentType.includes('pdf')) || attachment.name.endsWith('.pdf');

                    if (isPdf) {
                        const parsed = await pdfParse(buffer);
                        extracted = parsed.text || '';
                    } else {
                        extracted = buffer.toString('utf8');
                    }

                    if (extracted.trim()) {
                        contentPieces.push(extracted.trim());
                    }
                } catch (error) {
                    console.error('Failed to ingest knowledge base attachment:', error);
                    await interaction.editReply('I could not read that file, sir. Ensure it is a UTF-8 text, markdown, or PDF document.');
                    return;
                }
            }

            const combined = contentPieces.join('\n\n').trim();
            if (!combined) {
                await interaction.editReply('I need either the content field or an attachment to store, sir.');
                return;
            }

            try {
                const entry = await embeddingSystem.ingestGuildDocument({
                    guildId: guild.id,
                    userId: interaction.user.id,
                    title,
                    text: combined,
                    source: attachment ? 'upload' : 'manual'
                });

                await interaction.editReply(`Filed under ID \`${entry._id}\`, sir. Knowledge base updated.`);
            } catch (error) {
                console.error('Failed to store knowledge base entry:', error);
                await interaction.editReply('Knowledge base ingestion failed, sir.');
            }
            return;
        }

        if (subcommand === 'search') {
            const query = interaction.options.getString('query', true);
            const limit = interaction.options.getInteger('limit') || 5;

            try {
                const { message } = await embeddingSystem.formatSearchResults(guild.id, query, { limit });
                await interaction.editReply(message);
            } catch (error) {
                console.error('Knowledge search failed:', error);
                await interaction.editReply('The knowledge scanners malfunctioned, sir.');
            }
            return;
        }

        if (subcommand === 'list') {
            const limitOption = interaction.options.getInteger('limit') || 5;
            const limit = Math.max(1, Math.min(limitOption, 10));

            try {
                const entries = await database.getRecentKnowledgeEntries(guild.id, limit);
                if (!entries.length) {
                    await interaction.editReply('No entries in the knowledge base yet, sir.');
                    return;
                }

                const lines = entries.map((entry, index) => {
                    const timestamp = entry.createdAt
                        ? `<t:${Math.floor(new Date(entry.createdAt).getTime() / 1000)}:R>`
                        : 'unknown';
                    return `**${index + 1}. ${entry.title || 'Untitled'}**\n• ID: \`${entry._id}\`\n• Saved ${timestamp}`;
                });

                const embed = new EmbedBuilder()
                    .setTitle(`Latest ${entries.length} knowledge base entr${entries.length === 1 ? 'y' : 'ies'}`)
                    .setColor(0x60a5fa)
                    .setDescription(lines.join('\n\n'));

                await interaction.editReply({ embeds: [embed] });
            } catch (error) {
                console.error('Failed to list knowledge entries:', error);
                await interaction.editReply('Unable to list knowledge base entries at the moment, sir.');
            }
            return;
        }

        if (subcommand === 'delete') {
            const entryId = interaction.options.getString('entry_id', true);

            try {
                const removed = await database.deleteKnowledgeEntry(guild.id, entryId.trim());
                if (removed) {
                    await interaction.editReply('Entry removed from the knowledge archive, sir.');
                } else {
                    await interaction.editReply('I could not locate that entry, sir.');
                }
            } catch (error) {
                console.error('Failed to delete knowledge entry:', error);
                await interaction.editReply('Knowledge base deletion failed, sir.');
            }
            return;
        }

        await interaction.editReply('I am not certain how to handle that knowledge base request, sir.');
    }

    async handleAskCommand(interaction) {
        const guild = interaction.guild;

        if (!guild) {
            await interaction.editReply('This command only works within a server, sir.');
            return;
        }

        if (!database.isConnected) {
            await interaction.editReply('Database uplink offline, sir. I cannot consult the archives.');
            return;
        }

        if (!embeddingSystem.isAvailable) {
            await interaction.editReply('OPENAI is not configured, sir. I cannot search the knowledge base.');
            return;
        }

        const query = interaction.options.getString('query', true);

        try {
            const { answer, sources } = await embeddingSystem.answerGuildQuestion({
                guildId: guild.id,
                userId: interaction.user.id,
                query
            });

            const lines = [answer];
            if (sources.length) {
                lines.push('\nSources:', ...sources.map((source) => `${source.label} (ID: ${source.id})`));
            }

            await interaction.editReply(lines.join('\n'));
        } catch (error) {
            console.error('Knowledge answer generation failed:', error);
            await interaction.editReply('My knowledge synthesis failed, sir. Please try again later.');
        }
    }

    async handleNewsCommand(interaction) {
        const topic = interaction.options.getString('topic') || 'technology';
        const fresh = interaction.options.getBoolean('fresh') || false;
        const normalizedTopic = topic.toLowerCase();

        let articles = [];
        let fromCache = false;

        if (!fresh && database.isConnected) {
            try {
                const cached = await database.getNewsDigest(normalizedTopic);
                if (cached?.articles?.length) {
                    articles = cached.articles.map((article) => ({
                        ...article,
                        published: article.published ? new Date(article.published) : null
                    }));
                    fromCache = true;
                    if (cached.metadata?.cachedAt) {
                        const cachedDate = new Date(cached.metadata.cachedAt);
                        if (!Number.isNaN(cachedDate.getTime()) && Date.now() - cachedDate.getTime() > 90 * 60 * 1000) {
                            fromCache = false;
                        }
                    }
                }
            } catch (error) {
                console.warn('Failed to read cached news digest:', error);
            }
        }

        if (!articles.length) {
            try {
                if (NEWS_API_KEY) {
                    articles = await this.fetchNewsFromTheNewsApi(normalizedTopic, 5);
                }

                if (!articles.length && braveSearch.apiKey) {
                    articles = await braveSearch.fetchNews(normalizedTopic, { count: 5 });
                }

                if (database.isConnected) {
                    const serialisable = articles.map((article) => ({
                        ...article,
                        published: article.published ? article.published.toISOString() : null
                    }));
                    await database.saveNewsDigest(normalizedTopic, serialisable, { cachedAt: new Date().toISOString() });
                }
            } catch (error) {
                console.error('News fetch failed:', error);
                await interaction.editReply('Unable to fetch headlines at the moment, sir.');
                return;
            }
        }

        if (!articles.length) {
            await interaction.editReply('No headlines available right now, sir.');
            return;
        }

        const embed = new EmbedBuilder()
            .setTitle(`Top headlines: ${topic}`)
            .setColor(0x00b5ad)
            .setTimestamp(new Date());

        const lines = articles.slice(0, 5).map((article, index) => {
            const title = article.title || 'Untitled story';
            const url = article.url || '';
            const source = article.source || 'Unknown source';
            const published = article.published ? Math.floor(new Date(article.published).getTime() / 1000) : null;
            const desc = article.description ? article.description.trim() : '';

            const headline = url ? `**${index + 1}. [${title}](${url})**` : `**${index + 1}. ${title}**`;
            const metaParts = [source];
            if (published) {
                metaParts.push(`<t:${published}:R>`);
            }

            const metaLine = metaParts.length ? `_${metaParts.join(' • ')}_` : '';
            const body = desc ? `${desc.slice(0, 180)}${desc.length > 180 ? '…' : ''}` : '';

            return [headline, body, metaLine].filter(Boolean).join('\n');
        });

        embed.setDescription(lines.join('\n\n'));

        const firstImage = articles.find((a) => a.image)?.image;
        if (firstImage) {
            embed.setImage(firstImage);
        }

        if (fromCache && database.isConnected) {
            embed.setFooter({ text: 'Cached digest • add fresh:true to refresh' });
        } else if (NEWS_API_KEY) {
            embed.setFooter({ text: 'Powered by TheNewsAPI.com' });
        }

        await interaction.editReply({ embeds: [embed] });
    }

    async handleMacroCommand(interaction) {
        const guild = interaction.guild;

        if (!guild) {
            await interaction.editReply('Macros are only available within a server, sir.');
            return;
        }

        if (!database.isConnected) {
            await interaction.editReply('Knowledge archives offline, sir. Please try later.');
            return;
        }

        const subcommand = interaction.options.getSubcommand();
        const guildId = guild.id;

        if (subcommand === 'list') {
            const tagInput = interaction.options.getString('tag');
            const tag = tagInput ? tagInput.trim().toLowerCase() : null;
            let entries = [];

            try {
                if (tag) {
                    entries = await database.getKnowledgeEntriesByTag(guildId, tag, 10);
                } else {
                    entries = await database.getKnowledgeEntriesForGuild(guildId);
                }
            } catch (error) {
                console.error('Failed to list macros:', error);
                await interaction.editReply('Macro index unavailable, sir.');
                return;
            }

            if (!entries.length) {
                await interaction.editReply(tag ? `No macros found with tag "${tag}", sir.` : 'No macros recorded yet, sir. Add some via /kb add.');
                return;
            }

            const lines = entries.slice(0, 10).map((entry, index) => {
                const tags = Array.isArray(entry.tags) && entry.tags.length ? ` — tags: ${entry.tags.join(', ')}` : '';
                return `${index + 1}. **${entry.title || 'Untitled'}** (ID: ${entry._id})${tags}`;
            });

            const tagLabel = tag ? ` for tag "${tag}"` : '';
            await interaction.editReply([`Available macros${tagLabel}, sir:`, ...lines].join('\n'));
            return;
        }

        if (subcommand === 'send') {
            const entryIdInput = interaction.options.getString('entry_id');
            const tagInput = interaction.options.getString('tag');

            if (!entryIdInput && !tagInput) {
                await interaction.editReply('Please provide either an entry ID or a tag to resolve, sir.');
                return;
            }

            let entry = null;
            try {
                if (entryIdInput) {
                    entry = await database.getKnowledgeEntryById(guildId, entryIdInput.trim());
                } else if (tagInput) {
                    const candidates = await database.getKnowledgeEntriesByTag(guildId, tagInput.trim().toLowerCase(), 1);
                    entry = candidates[0] || null;
                }
            } catch (error) {
                console.error('Failed to resolve macro entry:', error);
            }

            if (!entry) {
                await interaction.editReply('I could not locate that macro entry, sir.');
                return;
            }

            const channelOption = interaction.options.getChannel('channel');
            const targetChannel = channelOption || interaction.channel;

            if (!targetChannel || !targetChannel.isTextBased?.()) {
                await interaction.editReply('Please choose a text channel for macro delivery, sir.');
                return;
            }

            const embed = new EmbedBuilder()
                .setTitle(entry.title || 'Knowledge Macro')
                .setDescription((entry.text || '').length ? entry.text.slice(0, 4000) : '(no content)')
                .setColor(0xF4A261)
                .setFooter({ text: `Macro ID: ${entry._id}` })
                .setTimestamp(entry.updatedAt || entry.createdAt || new Date());

            if (Array.isArray(entry.tags) && entry.tags.length) {
                embed.addFields({ name: 'Tags', value: entry.tags.join(', ').slice(0, 1024) });
            }

            try {
                await targetChannel.send({ embeds: [embed] });
                await interaction.editReply(targetChannel.id === interaction.channelId
                    ? 'Macro dispatched, sir.'
                    : `Macro dispatched to ${targetChannel}, sir.`);
            } catch (error) {
                console.error('Failed to send macro:', error);
                await interaction.editReply('I could not deliver that macro, sir.');
            }
            return;
        }

        await interaction.editReply('I do not recognize that macro request, sir.');
    }

    async refreshAllServerStats(client) {
        if (!client || !database.isConnected) {
            return;
        }

        let configs = [];
        try {
            configs = await database.getAllServerStatsConfigs();
        } catch (error) {
            console.error('Failed to load server stats configurations:', error);
            return;
        }

        for (const config of configs) {
            if (!config?.guildId) {
                continue;
            }

            let guild = client.guilds.cache.get(config.guildId) || null;
            if (!guild) {
                try {
                    guild = await client.guilds.fetch(config.guildId);
                } catch (error) {
                    if (error.code !== 50001 && error.code !== 10004) {
                        console.warn(`Failed to fetch guild ${config.guildId} for server stats update:`, error);
                    }
                    continue;
                }
            }

            try {
                await this.updateServerStats(guild, config);
            } catch (error) {
                if (error.isFriendly || error.code === 50013) {
                    console.warn(`Skipping server stats update for guild ${config.guildId}: ${error.message || 'missing permissions'}`);
                } else if (error.code === 50001) {
                    console.warn(`Missing access to update server stats for guild ${config.guildId}.`);
                } else {
                    console.error(`Failed to update server stats for guild ${config.guildId}:`, error);
                }
            }
        }
    }

    async resolveRoleFromInput(roleInput, guild) {
        if (!roleInput || !guild) {
            return null;
        }

        const trimmed = roleInput.trim();
        let roleId = null;

        const mentionMatch = trimmed.match(/^<@&(\d{5,})>$/);
        if (mentionMatch) {
            roleId = mentionMatch[1];
        }

        if (!roleId && /^\d{5,}$/.test(trimmed)) {
            roleId = trimmed;
        }

        let role = null;
        if (roleId) {
            role = guild.roles.cache.get(roleId) || null;
            if (!role) {
                try {
                    role = await guild.roles.fetch(roleId);
                } catch (error) {
                    role = null;
                }
            }
        }

        if (!role) {
            const normalized = trimmed.toLowerCase();
            role = guild.roles.cache.find(r => r.name.toLowerCase() === normalized) || null;
        }

        return role || null;
    }

    async parseReactionRolePairs(input, guild) {
        if (!input || typeof input !== 'string') {
            throw new Error('Please provide emoji and role pairs separated by commas, sir.');
        }

        const segments = input
            .split(/[\n,]+/)
            .map(segment => segment.trim())
            .filter(Boolean);

        if (segments.length === 0) {
            throw new Error('Please provide at least one emoji and role pair, sir.');
        }

        if (segments.length > 20) {
            throw new Error('Discord allows a maximum of 20 reactions per message, sir.');
        }

        const results = [];
        const seenKeys = new Set();
        const emojiPattern = /\p{Extended_Pictographic}/u;

        for (const segment of segments) {
            const separatorIndex = segment.search(/\s/);
            if (separatorIndex === -1) {
                throw new Error('Each pair must include an emoji and a role separated by a space, sir.');
            }

            const emojiInput = segment.substring(0, separatorIndex).trim();
            const roleInput = segment.substring(separatorIndex).trim();

            if (!emojiInput || !roleInput) {
                throw new Error('Each pair must include both an emoji and a role, sir.');
            }

            const parsedEmoji = parseEmoji(emojiInput);
            if (!parsedEmoji) {
                throw new Error(`I could not understand the emoji "${emojiInput}", sir.`);
            }

            if (!parsedEmoji.id && !emojiPattern.test(emojiInput)) {
                throw new Error(`"${emojiInput}" is not a usable emoji, sir. Please use a Unicode emoji or a custom server emoji.`);
            }

            const matchKey = parsedEmoji.id || parsedEmoji.name;
            if (!matchKey) {
                throw new Error(`I could not determine how to track the emoji "${emojiInput}", sir.`);
            }

            if (seenKeys.has(matchKey)) {
                throw new Error('Each emoji may only be used once per panel, sir.');
            }

            const role = await this.resolveRoleFromInput(roleInput, guild);
            if (!role) {
                throw new Error(`I could not find the role "${roleInput}", sir.`);
            }

            seenKeys.add(matchKey);

            const emojiDisplay = parsedEmoji.id
                ? `<${parsedEmoji.animated ? 'a' : ''}:${parsedEmoji.name}:${parsedEmoji.id}>`
                : emojiInput;

            results.push({
                matchKey,
                rawEmoji: emojiDisplay,
                display: emojiDisplay,
                roleId: role.id,
                roleName: role.name
            });
        }

        return results;
    }

    async resolveReactionRoleContext(reaction, user) {
        if (!database.isConnected || !reaction || !user || user.bot) {
            return null;
        }

        const messageId = reaction.message?.id || reaction.messageId;
        if (!messageId) {
            return null;
        }

        const record = await database.getReactionRole(messageId);
        if (!record) {
            return null;
        }

        if (reaction.message?.guildId && record.guildId && reaction.message.guildId !== record.guildId) {
            return null;
        }

        const key = this.getReactionEmojiKey(reaction.emoji);
        if (!key) {
            return null;
        }

        const option = (record.options || []).find(entry => entry.matchKey === key);
        if (!option) {
            return null;
        }

        const guildId = record.guildId || reaction.message?.guildId;
        if (!guildId) {
            return null;
        }

        const guild = reaction.message?.guild
            || reaction.client.guilds.cache.get(guildId)
            || await reaction.client.guilds.fetch(guildId).catch(() => null);
        if (!guild) {
            return null;
        }

        const member = await guild.members.fetch(user.id).catch(() => null);
        if (!member) {
            return null;
        }

        const role = guild.roles.cache.get(option.roleId) || await guild.roles.fetch(option.roleId).catch(() => null);
        if (!role) {
            return null;
        }

        const me = guild.members.me || await guild.members.fetchMe().catch(() => null);
        if (!me?.permissions?.has(PermissionsBitField.Flags.ManageRoles)) {
            return null;
        }

        if (me.roles.highest.comparePositionTo(role) <= 0) {
            return null;
        }

        return {
            record,
            option,
            guild,
            member,
            role,
            me
        };
    }

    getUserRoleColor(member) {
        try {
            if (!member || !member.roles) {
                return '#ff6b6b'; // Default red
            }

            // Get the highest role with a color (excluding @everyone)
            const coloredRoles = member.roles.cache
                .filter(role => role.color !== 0 && role.name !== '@everyone')
                .sort((a, b) => b.position - a.position);

            if (coloredRoles.size > 0) {
                const topRole = coloredRoles.first();
                return `#${topRole.color.toString(16).padStart(6, '0')}`;
            }

            return '#ff6b6b'; // Default red if no colored roles
        } catch (error) {
            console.warn('Failed to get role color:', error);
            return '#ff6b6b'; // Default red on error
        }
    }

	// Produce a display name that renders reliably on canvas
	getSafeDisplayName(member, author) {
		try {
			const rawName = (member && member.displayName) ? member.displayName : (author && author.username ? author.username : 'User');
			// Normalize to canonical form
			let name = rawName.normalize('NFKC');
			// Remove control and zero-width characters
			name = name.replace(/[\p{C}\p{Cf}]/gu, '');
			// Allow letters, numbers, spaces, and a small set of safe punctuation; drop the rest
			name = name.replace(/[^\p{L}\p{N}\p{M} _\-'.]/gu, '');
			// Collapse whitespace
			name = name.replace(/\s+/g, ' ').trim();
			// Fallback if empty after sanitization
			if (!name) name = (author && author.username) ? author.username : 'User';
			return name;
		} catch (_) {
			return (author && author.username) ? author.username : 'User';
		}
	}

	async fetchEmojiImage(url) {
		if (!url || typeof url !== 'string') return null;
		const cached = this.emojiAssetCache.get(url);
		if (cached) {
			return cached;
		}
		const pending = loadImage(url)
			.then((image) => {
				this.emojiAssetCache.set(url, image);
				return image;
			})
			.catch((error) => {
				this.emojiAssetCache.delete(url);
				throw error;
			});
		this.emojiAssetCache.set(url, pending);
		return pending;
	}

    // Parse Discord custom emojis using Discord API
    // This function extracts custom emojis from message text and gets their proper URLs
    // Uses guild emoji cache for accurate emoji data, falls back to CDN URLs
    async parseCustomEmojis(text, guild = null) {
        const emojiRegex = /<a?:(\w+):(\d+)>/g;
        const emojis = [];
        let match;
        
        while ((match = emojiRegex.exec(text)) !== null) {
            const isAnimated = match[0].startsWith('<a:');
            const name = match[1];
            const id = match[2];
            
            // Always use Discord's CDN URL for emojis
            // Discord API format: https://cdn.discordapp.com/emojis/{emoji_id}.png
            // For animated emojis: https://cdn.discordapp.com/emojis/{emoji_id}.gif
            let emojiUrl = `https://cdn.discordapp.com/emojis/${id}.${isAnimated ? 'gif' : 'png'}`;
            let emojiObject = null;
            
            // Try to get emoji from guild for additional info
            if (guild) {
                try {
                    emojiObject = guild.emojis.cache.get(id);
                    if (emojiObject) {
                        // Use the emoji's URL if available, otherwise use CDN URL
                        emojiUrl = emojiObject.url || emojiUrl;
                    } else {
                        // Try to fetch emoji from Discord API if not in cache
                        // Discord API endpoint: GET /guilds/{guild_id}/emojis/{emoji_id}
                        try {
                            const fetchedEmoji = await guild.emojis.fetch(id);
                            if (fetchedEmoji) {
                                emojiObject = fetchedEmoji;
                                emojiUrl = fetchedEmoji.url || emojiUrl;
                            }
                        } catch (fetchError) {
                            // Handle Discord API errors gracefully
                            if (fetchError.code === 10014) {
                                console.warn(`Emoji ${id} not found in guild ${guild.id}`);
                            } else if (fetchError.code === 50013) {
                                console.warn(`Missing permissions to fetch emoji ${id} from guild ${guild.id}`);
                            } else {
                                console.warn('Failed to fetch emoji from Discord API:', fetchError);
                            }
                        }
                    }
                } catch (error) {
                    console.warn('Failed to fetch emoji from guild:', error);
                }
            }
            
            emojiUrl = ensureDiscordEmojiSize(emojiUrl, DEFAULT_CUSTOM_EMOJI_SIZE);
            
            emojis.push({
                full: match[0],
                name: name,
                id: id,
                url: emojiUrl,
                isAnimated: isAnimated,
                emojiObject: emojiObject,
                start: match.index,
                end: match.index + match[0].length
            });
        }
        
        return emojis;
    }

    // Parse Unicode emojis as well
    parseUnicodeEmojis(text) {
        // Enhanced Unicode emoji regex - covers more emoji ranges including newer ones
        const unicodeEmojiRegex = /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F900}-\u{1F9FF}]|[\u{1FA70}-\u{1FAFF}]|[\u{1F018}-\u{1F0FF}]|[\u{1F200}-\u{1F2FF}]|[\u{1F700}-\u{1F77F}]|[\u{1F780}-\u{1F7FF}]|[\u{1F800}-\u{1F8FF}]|[\u{1F000}-\u{1F02F}]|[\u{1F030}-\u{1F09F}]|[\u{1F0A0}-\u{1F0FF}]|[\u{1F100}-\u{1F1FF}]|[\u{1F200}-\u{1F2FF}]|[\u{1F300}-\u{1F5FF}]|[\u{1F600}-\u{1F64F}]|[\u{1F650}-\u{1F67F}]|[\u{1F680}-\u{1F6FF}]|[\u{1F700}-\u{1F77F}]|[\u{1F780}-\u{1F7FF}]|[\u{1F800}-\u{1F8FF}]|[\u{1F900}-\u{1F9FF}]|[\u{1FA00}-\u{1FA6F}]|[\u{1FA70}-\u{1FAFF}]|[\u{1FB00}-\u{1FBFF}]|[\u{1FC00}-\u{1FCFF}]|[\u{1FD00}-\u{1FDFF}]|[\u{1FE00}-\u{1FEFF}]|[\u{1FF00}-\u{1FFFF}]/gu;
        const emojis = [];
        let match;
        
        while ((match = unicodeEmojiRegex.exec(text)) !== null) {
            const asset = buildUnicodeEmojiAsset(match[0]);
            emojis.push({
                full: match[0],
                name: match[0],
                id: null,
                url: asset ? asset.svg : null,
                fallbackUrl: asset ? asset.png : null,
                isAnimated: false,
                emojiObject: null,
                start: match.index,
                end: match.index + match[0].length,
                isUnicode: true
            });
        }
        
        return emojis;
    }

	// Parse user mentions like <@123> or <@!123> and resolve to @DisplayName
	async parseMentions(text, guild = null, client = null) {
		const mentionRegex = /<@!?([0-9]{5,})>/g;
		const mentions = [];
		let match;
		while ((match = mentionRegex.exec(text)) !== null) {
			const userId = match[1];
			let display = `@unknown`;
			try {
				let user = null;
				let member = null;
				if (guild) {
					member = guild.members.cache.get(userId) || null;
					if (!member) {
						try { member = await guild.members.fetch(userId); } catch (_) {}
					}
					user = member ? member.user : null;
				}
				if (!user && client) {
					user = client.users.cache.get(userId) || null;
					if (!user) {
						try { user = await client.users.fetch(userId); } catch (_) {}
					}
				}
				display = `@${this.getSafeDisplayName(member, user || { username: userId })}`;
			} catch (_) {}
			mentions.push({
				full: match[0],
				userId: userId,
				display: display,
				start: match.index,
				end: match.index + match[0].length
			});
		}
		return mentions;
	}

    // Parse Discord markdown formatting
    parseDiscordFormatting(text) {
        const formatting = [];
        
        // Bold: **text**
        const boldRegex = /\*\*(.*?)\*\*/g;
        let match;
        while ((match = boldRegex.exec(text)) !== null) {
            formatting.push({
                type: 'bold',
                content: match[1],
                start: match.index,
                end: match.index + match[0].length,
                full: match[0]
            });
        }
        
        // Italic: *text* or _text_
        const italicRegex = /(?<!\*)\*(?!\*)([^*]+)\*(?!\*)|(?<!_)_(?!_)([^_]+)_(?!_)/g;
        while ((match = italicRegex.exec(text)) !== null) {
            formatting.push({
                type: 'italic',
                content: match[1] || match[2],
                start: match.index,
                end: match.index + match[0].length,
                full: match[0]
            });
        }
        
        // Strikethrough: ~~text~~
        const strikeRegex = /~~(.*?)~~/g;
        while ((match = strikeRegex.exec(text)) !== null) {
            formatting.push({
                type: 'strikethrough',
                content: match[1],
                start: match.index,
                end: match.index + match[0].length,
                full: match[0]
            });
        }
        
        // Underline: __text__
        const underlineRegex = /__(.*?)__/g;
        while ((match = underlineRegex.exec(text)) !== null) {
            formatting.push({
                type: 'underline',
                content: match[1],
                start: match.index,
                end: match.index + match[0].length,
                full: match[0]
            });
        }
        
        // Code: `text`
        const codeRegex = /`([^`]+)`/g;
        while ((match = codeRegex.exec(text)) !== null) {
            formatting.push({
                type: 'code',
                content: match[1],
                start: match.index,
                end: match.index + match[0].length,
                full: match[0]
            });
        }
        
        // Sort by start position
        formatting.sort((a, b) => a.start - b.start);
        
        return formatting;
    }

    // Format timestamp to actual readable time
    // Uses Discord.js Message.createdAt (Date object) for proper timezone handling
    formatTimestamp(timestamp, userTimezone = 'UTC') {
        try {
            // Handle both Date objects and timestamp numbers
            const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
            
            // Format as 12-hour time with AM/PM
            // Use system timezone to match Discord client behavior
            const options = {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true
                // No timeZone specified - uses system timezone (matches Discord client)
            };
            
            return date.toLocaleTimeString('en-US', options);
        } catch (error) {
            console.warn('Failed to format timestamp:', error);
            return '6:39 PM'; // Fallback
        }
    }

    // Get Discord's native timestamp format for user's local timezone
    // This matches exactly what Discord shows in the client
    getDiscordTimestamp(message) {
        try {
            // Convert to Unix timestamp (seconds, not milliseconds)
            const unixTimestamp = Math.floor(message.createdTimestamp / 1000);
            
            // Discord timestamp format: <t:timestamp:format>
            // 't' = short time (e.g., "2:30 PM")
            return `<t:${unixTimestamp}:t>`;
        } catch (error) {
            console.warn('Failed to get Discord timestamp:', error);
            return '6:39 PM'; // Fallback
        }
    }

    // Draw the verified badge SVG checkmark
    drawVerifiedBadge(ctx, x, y, size = 16) {
        try {
            // Save context state
            ctx.save();
            
            // Set white fill for the checkmark
            ctx.fillStyle = '#ffffff';
            
            // Create the checkmark path (simplified SVG path)
            ctx.beginPath();
            // Move to start of checkmark
            ctx.moveTo(x + size * 0.3, y + size * 0.5);
            // Line to middle point
            ctx.lineTo(x + size * 0.45, y + size * 0.65);
            // Line to end point
            ctx.lineTo(x + size * 0.7, y + size * 0.35);
            
            // Draw with rounded line caps for cleaner look
            ctx.lineWidth = 2;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.strokeStyle = '#ffffff';
            ctx.stroke();
            
            ctx.restore();
        } catch (error) {
            console.warn('Failed to draw verified badge:', error);
        }
    }

    // Parse Discord timestamp to get the actual formatted time
    // This extracts the time from Discord's timestamp format
    parseDiscordTimestamp(message) {
        try {
            // Get the Discord timestamp format
            const discordTimestamp = this.getDiscordTimestamp(message);
            
            // For Canvas rendering, we need the actual time string
            // Use the message's createdAt Date object with proper formatting
            const date = message.createdAt;
            const options = {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true
            };
            
            return date.toLocaleTimeString('en-US', options);
        } catch (error) {
            console.warn('Failed to parse Discord timestamp:', error);
            return '6:39 PM'; // Fallback
        }
    }

    // Truncate text if too long
    truncateText(text, maxLength) {
        if (text.length <= maxLength) return text;
        return text.substring(0, maxLength - 3) + '...';
    }

    // Check if bot is verified using Discord API
    isBotVerified(user) {
        try {
            // Check if user has the VerifiedBot flag using public_flags
            // Discord API uses public_flags bitfield for verification status
            return user.publicFlags && user.publicFlags.has(UserFlags.VerifiedBot);
        } catch (error) {
            console.warn('Failed to check bot verification status:', error);
            return false;
        }
    }

    // Get the official Discord verification badge URL
    getVerificationBadgeUrl() {
        // Discord's official verification badge URL from their CDN
        // This is the actual badge icon used by Discord for verified bots
        return 'https://cdn.discordapp.com/badge-icons/6f1c2f904b1f5b7f3f2746965d3992f0.png';
    }

    // Extract image URLs from text including Tenor GIFs
    extractImageUrls(text) {
        // Standard image URLs
        const imageUrlRegex = /(https?:\/\/[^\s]+\.(?:jpg|jpeg|png|gif|webp|bmp|svg)(?:\?[^\s]*)?)/gi;
        const imageMatches = text.match(imageUrlRegex) || [];
        
        // Tenor GIF URLs - extract the actual GIF URL
        const tenorRegex = /(https?:\/\/tenor\.com\/[^\s]+)/gi;
        const tenorMatches = text.match(tenorRegex) || [];
        
        // Convert Tenor URLs to actual GIF URLs
        const tenorGifUrls = tenorMatches.map(tenorUrl => {
            try {
                // Extract GIF ID from different Tenor URL formats
                let gifId = null;
                
                // Format 1: https://tenor.com/view/gif-name-gifId
                const viewMatch = tenorUrl.match(/\/view\/[^-]+-(\d+)/);
                if (viewMatch) {
                    gifId = viewMatch[1];
                }
                
                // Format 2: https://tenor.com/view/gifId
                if (!gifId) {
                    const directMatch = tenorUrl.match(/\/view\/(\d+)/);
                    if (directMatch) {
                        gifId = directMatch[1];
                    }
                }
                
                // Format 3: https://tenor.com/view/gif-name-gifId-other
                if (!gifId) {
                    const complexMatch = tenorUrl.match(/-(\d+)(?:-|$)/);
                    if (complexMatch) {
                        gifId = complexMatch[1];
                    }
                }
                
                if (gifId) {
                    // Return the actual GIF URL from Tenor's CDN
                    return `https://media.tenor.com/${gifId}.gif`;
                }
                
                console.warn('Could not extract GIF ID from Tenor URL:', tenorUrl);
                return tenorUrl; // Fallback to original URL
            } catch (error) {
                console.warn('Failed to convert Tenor URL:', error);
                return tenorUrl;
            }
        });
        
        return [...imageMatches, ...tenorGifUrls];
    }

    calculateTextHeight(text, maxWidth, customEmojis = [], mentions = []) {
        const tempCanvas = createCanvas(1, 1);
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.font = '15px Arial';

        const segments = this.splitTextWithEmojisAndMentions(text, customEmojis, mentions);
        const lineHeight = 22;
        const emojiSize = 18;
        const emojiSpacing = typeof this.clipEmojiSpacing === 'number' ? this.clipEmojiSpacing : 3;
        const emojiAdvance = emojiSize + emojiSpacing;

        let lineCount = 1;
        let currentLineWidth = 0;

        const advanceLine = () => {
            lineCount++;
            currentLineWidth = 0;
        };

        const handleWhitespaceToken = token => {
            if (!token) return;
            const width = tempCtx.measureText(token).width;
            if (currentLineWidth + width > maxWidth && currentLineWidth > 0) {
                advanceLine();
            }
            currentLineWidth += width;
        };

        const handleTextToken = token => {
            if (!token) return;
            const width = tempCtx.measureText(token).width;
            if (currentLineWidth + width > maxWidth && currentLineWidth > 0) {
                advanceLine();
            }
            currentLineWidth += width;
        };

        for (const segment of segments) {
            if (segment.type === 'emoji') {
                const hasImageAsset = Boolean(segment.url);
                if (hasImageAsset) {
                    if (currentLineWidth + emojiAdvance > maxWidth && currentLineWidth > 0) {
                        advanceLine();
                    }
                    currentLineWidth += emojiAdvance;
                } else if (segment.isUnicode) {
                    const emojiText = segment.name;
                    tempCtx.font = '18px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Android Emoji", "EmojiSymbols", "EmojiOne Mozilla", "Twemoji Mozilla", "Segoe UI Symbol", sans-serif';
                    const width = tempCtx.measureText(emojiText).width;
                    tempCtx.font = '15px Arial';
                    if (currentLineWidth + width > maxWidth && currentLineWidth > 0) {
                        advanceLine();
                    }
                    currentLineWidth += width;
                } else {
                    if (currentLineWidth + emojiAdvance > maxWidth && currentLineWidth > 0) {
                        advanceLine();
                    }
                    currentLineWidth += emojiAdvance;
                }
            } else if (segment.type === 'mention') {
                const mentionTokens = segment.text.split(/(\n|\s+)/);
                for (const token of mentionTokens) {
                    if (!token) continue;
                    if (token === '\n') {
                        advanceLine();
                        continue;
                    }
                    if (/^\s+$/.test(token)) {
                        handleWhitespaceToken(token);
                        continue;
                    }
                    handleTextToken(token);
                }
            } else {
                const textTokens = segment.text.split(/(\n|\s+)/);
                for (const token of textTokens) {
                    if (!token) continue;
                    if (token === '\n') {
                        advanceLine();
                        continue;
                    }
                    if (/^\s+$/.test(token)) {
                        handleWhitespaceToken(token);
                        continue;
                    }
                    handleTextToken(token);
                }
            }
        }

        const baseHeight = 44;
        return baseHeight + (lineCount * lineHeight);
    }

    hasImagesOrEmojis(message) {
        // Allow all content now - images and emojis are supported
        return false;
    }

	async handleClipCommand(message, client) {
        // Check if message starts with "jarvis clip"
        const content = message.content.trim().toLowerCase();
        if (!content.startsWith('jarvis clip')) {
            return false;
        }

        // If not a reply, do nothing (no response)
        if (!message.reference || !message.reference.messageId) {
            return true; // Return true to indicate we handled it (by doing nothing)
        }

        try {
            // Fetch the replied message
            const repliedMessage = await message.channel.messages.fetch(message.reference.messageId);
            
            // Debug logging for timestamps
            console.log('Timestamp debug:', {
                clipCommandTime: message.createdAt.toLocaleTimeString(),
                repliedMessageTime: repliedMessage.createdAt.toLocaleTimeString(),
                repliedMessageTimestamp: repliedMessage.createdTimestamp,
                messageTimestamp: message.createdTimestamp,
                // Check if we're getting the right message
                repliedMessageId: repliedMessage.id,
                repliedMessageContent: repliedMessage.content.substring(0, 50) + '...',
                // Check message age
                messageAge: Date.now() - repliedMessage.createdTimestamp
            });
            
            // Check if message contains images or emojis - if so, don't respond
            if (this.hasImagesOrEmojis(repliedMessage)) {
                return true; // Handled silently - don't clip messages with images/emojis
            }
            
            // Get server-specific avatar (guild avatar) or fallback to global avatar
            // Discord allows users to set unique avatars per server - this gets the server-specific one
            // If no server avatar is set, falls back to the user's global avatar
            // Using Discord's proper avatar URL structure: https://cdn.discordapp.com/avatars/{user_id}/{avatar_hash}.png
            const avatarUrl = repliedMessage.member?.avatarURL({ 
                extension: 'png', 
                size: 128,
                forceStatic: false // Allow animated avatars
            }) || repliedMessage.author.displayAvatarURL({ 
                extension: 'png', 
                size: 128,
                forceStatic: false // Allow animated avatars
            });
            
            // Get user's role color
            let roleColor = '#ff6b6b'; // Default red
            try {
                if (message.guild && repliedMessage.member) {
                    roleColor = this.getUserRoleColor(repliedMessage.member);
                }
            } catch (error) {
                console.warn('Failed to get role color for text command:', error);
            }
            
            // Get display name (sanitized for rendering)
            const displayName = this.getSafeDisplayName(repliedMessage.member, repliedMessage.author);
            
			const imageBuffer = await this.createClipImage(
                repliedMessage.content, 
                displayName, 
                avatarUrl,
                repliedMessage.author.bot,
                roleColor,
                message.guild,
                client,
				repliedMessage, // Pass the entire message object
				repliedMessage.author,
				repliedMessage.attachments,
				repliedMessage.embeds
            );
            
            // Create attachment
            const attachment = new AttachmentBuilder(imageBuffer, { name: 'clipped.png' });
            
            // Send the image with "clipped, sir." message
            await message.reply({ 
                content: 'clipped, sir.', 
                files: [attachment] 
            });
            
            // Clean up - the image buffer is automatically garbage collected
            // No need to manually delete since we're working with buffers in memory
            
            return true; // Indicate we handled the command
        } catch (error) {
            console.error('Error handling clip command:', error);
            // Don't send any error message, just fail silently
            return true;
        }
    }

	// Find a message by ID across accessible channels in the same guild
	async findMessageAcrossChannels(interaction, messageId) {
		// Try current channel first
		try {
			if (interaction.channel && interaction.channel.messages) {
				const msg = await interaction.channel.messages.fetch(messageId);
				if (msg) return msg;
			}
		} catch (_) {}

		// If not in a guild, we cannot search other channels
		if (!interaction.guild) return null;

		// Iterate over text-based channels where the bot can view and read history
		const channels = interaction.guild.channels.cache;
		for (const [, channel] of channels) {
			try {
				// Skip non text-based channels
				if (!channel || typeof channel.isTextBased !== 'function' || !channel.isTextBased()) continue;

				// Permission checks to avoid errors/rate limits
				const perms = channel.permissionsFor(interaction.client.user.id);
				if (!perms) continue;
				if (!perms.has(PermissionsBitField.Flags.ViewChannel)) continue;
				if (!perms.has(PermissionsBitField.Flags.ReadMessageHistory)) continue;

				// Attempt to fetch by ID in this channel
				const msg = await channel.messages.fetch(messageId);
				if (msg) return msg;
			} catch (err) {
				// Ignore not found/permission/rate-limit errors and continue
				continue;
			}
		}

		return null;
	}

	// Load a static image for GIF sources by extracting the first frame with Sharp
	async loadStaticImage(url) {
		try {
			// Node 18 has global fetch
			const res = await fetch(url);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const buffer = await res.arrayBuffer();
			const input = Buffer.from(buffer);
			// Extract first frame to PNG buffer
			const pngBuffer = await sharp(input).ensureAlpha().extractFrame(0).png().toBuffer();
			return await loadImage(pngBuffer);
		} catch (error) {
			console.warn('Failed to load static GIF frame, falling back to direct load:', error);
			return await loadImage(url);
		}
	}

	// Resolve Tenor share pages to a static image URL via oEmbed (thumbnail)
	async resolveTenorStatic(url) {
		try {
			// 1) Try oEmbed (handles most Tenor URL forms)
			const oembedUrl = `https://tenor.com/oembed?url=${encodeURIComponent(url)}`;
			const res = await fetch(oembedUrl, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0' } });
			if (!res.ok) throw new Error(`Tenor oEmbed HTTP ${res.status}`);
			const data = await res.json();
			// oEmbed typically provides thumbnail_url
			if (data && data.thumbnail_url) return data.thumbnail_url;
			// Fallbacks some responses might include url
			if (data && data.url) return data.url;
		} catch (error) {
			console.warn('Failed to resolve Tenor static image via oEmbed:', error);
		}

		// 2) Fallback: fetch HTML and parse meta tags (works across Tenor share/short URLs)
		try {
			const pageRes = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0' } });
			if (!pageRes.ok) throw new Error(`Tenor page HTTP ${pageRes.status}`);
			const html = await pageRes.text();
			// Prefer og:image, fall back to twitter:image
			let metaMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
			if (!metaMatch) metaMatch = html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i);
			if (metaMatch && metaMatch[1]) return metaMatch[1];
		} catch (err) {
			console.warn('Failed to parse Tenor page for image:', err);
		}
		return null;
	}

    sanitizeMessageText(text) {
        if (!text) return '';

        let sanitized = text
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n')
            .replace(/[\u2028\u2029]/g, '\n');

        // Strip zero-width and control characters that can disturb layout
        sanitized = sanitized.replace(/[\u200B-\u200D\u2060\uFEFF]/g, '');

        // Remove Discord markdown markers while keeping inner text
        sanitized = sanitized.replace(/```[^\n]*\n([\s\S]*?)```/g, '$1');
        sanitized = sanitized.replace(/```/g, '');
        sanitized = sanitized.replace(/\*\*(.*?)\*\*/g, '$1');
        sanitized = sanitized.replace(/(?<!\*)\*(?!\*)([^*]+)\*(?!\*)/g, '$1');
        sanitized = sanitized.replace(/(?<!_)_(?!_)([^_]+)_(?!_)/g, '$1');
        sanitized = sanitized.replace(/~~(.*?)~~/g, '$1');
        sanitized = sanitized.replace(/__(.*?)__/g, '$1');
        sanitized = sanitized.replace(/`([^`]+)`/g, '$1');

        // Normalise repeated spaces and tabs without touching line breaks
        sanitized = sanitized.replace(/[^\S\r\n]+/g, ' ');
        sanitized = sanitized.replace(/\n[ \t]+/g, '\n');
        sanitized = sanitized.replace(/[ \t]+\n/g, '\n');

        return sanitized.trimEnd();
    }

    async createClipImage(text, username, avatarUrl, isBot = false, roleColor = '#ff6b6b', guild = null, client = null, message = null, user = null, attachments = null, embeds = null) {
    // Check bot verification status using Discord API
    const isVerified = user ? this.isBotVerified(user) : false;
    
    // Check for image attachments and embed previews (Discord link embeds like Tenor/Discord CDN)
    const hasImages = attachments && attachments.size > 0;
    const imageUrls = this.extractImageUrls(text);
    const embedImageUrls = (embeds || []).flatMap(e => {
        const urls = [];
        if (e && e.image && e.image.url) urls.push(e.image.url);
        if (e && e.thumbnail && e.thumbnail.url) urls.push(e.thumbnail.url);
        return urls;
    });
    // Also detect if the message ends with a direct .gif URL (with optional query params)
    let trailingGifUrl = null;
    try {
        const trailing = text.trim().match(/(https?:\/\/\S+?\.gif(?:\?\S*)?)$/i);
        if (trailing && trailing[1]) trailingGifUrl = trailing[1];
    } catch (_) {}
    const allImageUrls = [...imageUrls, ...embedImageUrls, ...(trailingGifUrl ? [trailingGifUrl] : [])];

    // Remove raw image/GIF links from text rendering (we draw them separately)
    let cleanedText = text;
    try {
        for (const url of allImageUrls) {
            const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            cleanedText = cleanedText.replace(new RegExp(escaped, 'g'), '').trim();
        }
        // Also remove Tenor share links that might not have been converted
        cleanedText = cleanedText.replace(/https?:\/\/tenor\.com\/\S+/gi, '').trim();
        // Collapse spaces and tabs without disturbing intentional newlines
        cleanedText = cleanedText.replace(/[^\S\r\n]+/g, ' ');
        cleanedText = cleanedText.replace(/\n[ \t]+/g, '\n');
        cleanedText = cleanedText.replace(/[ \t]+\n/g, '\n');
        cleanedText = cleanedText.trimEnd();
    } catch (_) {}

    const sanitizedText = this.sanitizeMessageText(cleanedText);

    // Parse custom emojis and formatting using Discord API
    const customEmojis = await this.parseCustomEmojis(sanitizedText, guild);
    const unicodeEmojis = this.parseUnicodeEmojis(sanitizedText);
    const allEmojis = [...customEmojis, ...unicodeEmojis].sort((a, b) => a.start - b.start);

    const mentions = await this.parseMentions(sanitizedText, guild, client);

    // Debug logging for emoji parsing
    if (allEmojis.length > 0) {
        console.log('Found emojis:', allEmojis.map(e => ({ name: e.name, url: e.url, isUnicode: e.isUnicode })));
    }

    // Calculate dynamic canvas dimensions based on content
    const width = 800; // Increased width for better layout and positioning
    const minHeight = 120; // Minimum height for basic content

    // Calculate text height with emojis and formatting
    const textHeight = this.calculateTextHeight(sanitizedText, width - 180, allEmojis, mentions); // Account for margins and avatar space

    // Measure required image height BEFORE creating main canvas to avoid clipping
    let actualImageHeight = 0;
    if (hasImages || allImageUrls.length > 0) {
        const tempCanvas = createCanvas(width, 1);
        const tempCtx = tempCanvas.getContext('2d');
        const imageEndY = await this.drawImages(tempCtx, attachments, allImageUrls, 0, 0, width - 180);
        actualImageHeight = imageEndY + 20; // padding
    }

    // Calculate total height including measured image height
    const totalHeight = Math.ceil(Math.max(minHeight, textHeight + actualImageHeight + 40));

    const canvas = createCanvas(width, totalHeight);
    const ctx = canvas.getContext('2d');

    // Maximize rendering quality to avoid jagged edges in the final clip
    ctx.patternQuality = 'best';
    ctx.quality = 'best';
    ctx.antialias = 'subpixel';
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

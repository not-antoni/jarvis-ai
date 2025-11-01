    ctx.textDrawingMode = 'path';

    // Pure black background
    ctx.fillStyle = '#1a1a1e';
    ctx.fillRect(0, 0, width, totalHeight);

    // Calculate centered positioning with more space for avatar and text
    const avatarSize = 48;
    const contentWidth = width - 80; // More margin
    const contentHeight = totalHeight - 20;
    const avatarX = 50; // Moved further to the right
    const avatarY = 20; // Top-aligned padding instead of vertical centering

    const avatarBackgroundColor = '#1a1a1e';

    // Draw avatar (circular)
    if (avatarUrl) {
        try {
            ctx.save();
            ctx.beginPath();
            ctx.arc(avatarX + avatarSize/2, avatarY + avatarSize/2, avatarSize/2, 0, Math.PI * 2);
            ctx.clip();

            ctx.fillStyle = avatarBackgroundColor;
            ctx.fillRect(avatarX, avatarY, avatarSize, avatarSize);

            const avatarImg = await loadImage(avatarUrl);
            ctx.drawImage(avatarImg, avatarX, avatarY, avatarSize, avatarSize);

            ctx.restore();
        } catch (error) {
            console.warn('Failed to load avatar, using fallback:', error);
            ctx.save();
            ctx.beginPath();
            ctx.arc(avatarX + avatarSize/2, avatarY + avatarSize/2, avatarSize/2, 0, Math.PI * 2);
            ctx.fillStyle = avatarBackgroundColor;
            ctx.fill();

            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 12px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(username.charAt(0).toUpperCase(), avatarX + avatarSize/2, avatarY + avatarSize/2);
            ctx.restore();
        }
    } else {
        ctx.save();
        ctx.beginPath();
        ctx.arc(avatarX + avatarSize/2, avatarY + avatarSize/2, avatarSize/2, 0, Math.PI * 2);
        ctx.fillStyle = avatarBackgroundColor;
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 12px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(username.charAt(0).toUpperCase(), avatarX + avatarSize/2, avatarY + avatarSize/2);
        ctx.restore();
    }

    // Calculate text positioning - moved further right
    const textStartX = avatarX + avatarSize + 20; // Increased spacing
        const textStartY = avatarY + 3;
    const maxTextWidth = contentWidth - (avatarSize + 20) - 30; // More margin

    // Truncate username if too long to prevent timestamp overlap
    const truncatedUsername = this.truncateText(username, 20);

        // Draw username in role color
    ctx.fillStyle = roleColor;
        ctx.font = 'bold 16px Arial';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
    ctx.fillText(truncatedUsername, textStartX, textStartY);

    let currentX = textStartX + ctx.measureText(truncatedUsername).width + 4;

        // Draw app tag if it's a bot
        if (isBot) {
            const appTagWidth = 38;
            const appTagHeight = 18;
            
            // Draw verification badge if verified (to the left of APP tag)
            if (isVerified) {
                const badgeSize = 18;
                const badgeX = currentX;
                this.drawVerifiedBadge(ctx, badgeX, textStartY, badgeSize);
                currentX += badgeSize + 4;
            }
            
            // App tag background (Discord blue color)
            ctx.fillStyle = 'rgb(88, 101, 242)'; // Discord APP badge color
            ctx.fillRect(currentX, textStartY, appTagWidth, appTagHeight);
            
            // App tag text
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 11px Arial';
            ctx.fillText('APP', currentX + 3, textStartY + 3);
            
            currentX += appTagWidth + 4;
        }

    // Draw timestamp with dynamic formatting
    const timestamp = message ? this.parseDiscordTimestamp(message) : '6:39 PM';
    ctx.font = '13px Arial';
    const timestampWidth = ctx.measureText(timestamp).width;
    
    // Ensure timestamp doesn't overlap with username/bot tag
    const availableWidth = width - currentX - 20;
    if (timestampWidth <= availableWidth) {
        ctx.fillStyle = '#72767d';
        ctx.fillText(timestamp, currentX, textStartY + 1);
    } else {
        // If not enough space, put timestamp on next line
        ctx.fillStyle = '#72767d';
        ctx.fillText(timestamp, textStartX, textStartY + 18);
    }

    // Draw message content with formatting support
    // Position the message content immediately below the username. The username
    // occupies approximately 16px of vertical space, so we add a 4px gap to
    // separate the text from the header. This keeps spacing consistent with the
    // small margin before image attachments rendered later.
    ctx.font = '15px Arial';
    const messageStartY = textStartY + 20;
    await this.drawFormattedText(ctx, sanitizedText, textStartX, messageStartY, maxTextWidth, allEmojis, mentions);

    // Draw images if present (main canvas has enough height already)
    if (hasImages || allImageUrls.length > 0) {
        // Compute the starting Y position for images. We subtract the base 40px
        // reserved in calculateTextHeight (for username/timestamp) from the
        // measured textHeight to get only the height of the rendered lines. Then
        // add a small 2px gap so images sit flush beneath the message text.
        const effectiveTextHeight = Math.max(0, textHeight - 44);
        const imageY = messageStartY + effectiveTextHeight + 2;
        await this.drawImages(ctx, attachments, allImageUrls, textStartX, imageY, maxTextWidth);
    }

    // Convert canvas to buffer
    const buffer = canvas.toBuffer('image/png');

    // Use sharp to optimize the image without cropping (prevent mid-image truncation)
    const processedBuffer = await sharp(buffer)
        .resize({
            width: 800,
            fit: 'inside',
            withoutEnlargement: true,
            kernel: sharp.kernel.lanczos3
        })
        .png({
            compressionLevel: 6,
            adaptiveFiltering: true,
            quality: 100,
            effort: 6,
            palette: false
        })
        .toBuffer();

    return processedBuffer;
    }

    // Draw text with Discord formatting and emojis
    async drawFormattedText(ctx, text, startX, startY, maxWidth, customEmojis, mentions = []) {
        ctx.fillStyle = '#ffffff';
        ctx.font = '15px Arial';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';

        let currentY = startY;
        const lineHeight = 22;
        const emojiSize = 18;
        const emojiSpacing = typeof this.clipEmojiSpacing === 'number' ? this.clipEmojiSpacing : 3;
        const emojiAdvance = emojiSize + emojiSpacing;

        const segments = this.splitTextWithEmojisAndMentions(text, customEmojis, mentions);

        let currentLineWidth = 0;

        const advanceLine = () => {
            currentY += lineHeight;
            currentLineWidth = 0;
        };

        const handleWhitespaceToken = token => {
            if (!token) return;
            const width = ctx.measureText(token).width;
            if (currentLineWidth + width > maxWidth && currentLineWidth > 0) {
                advanceLine();
            }
            currentLineWidth += width;
        };

        const handleTextToken = (token, color = '#ffffff') => {
            if (!token) return;
            const width = ctx.measureText(token).width;
            if (currentLineWidth + width > maxWidth && currentLineWidth > 0) {
                advanceLine();
            }
            const previousFill = ctx.fillStyle;
            ctx.fillStyle = color;
            ctx.fillText(token, startX + currentLineWidth, currentY);
            ctx.fillStyle = previousFill;
            currentLineWidth += width;
        };

        for (const segment of segments) {
            if (segment.type === 'emoji') {
                const hasImageAsset = Boolean(segment.url);
                let rendered = false;

                if (hasImageAsset) {
                    if (currentLineWidth + emojiSize > maxWidth && currentLineWidth > 0) {
                        advanceLine();
                    }

                    const drawX = startX + currentLineWidth;
                    try {
                        const emojiImg = await this.fetchEmojiImage(segment.url);
                        ctx.drawImage(emojiImg, drawX, currentY, emojiSize, emojiSize);
                        rendered = true;
                    } catch (primaryError) {
                        console.warn('Failed to load primary emoji asset:', { name: segment.name, url: segment.url, error: primaryError.message });
                        if (segment.fallbackUrl) {
                            try {
                                const fallbackImg = await this.fetchEmojiImage(segment.fallbackUrl);
                                ctx.drawImage(fallbackImg, drawX, currentY, emojiSize, emojiSize);
                                rendered = true;
                            } catch (fallbackError) {
                                console.warn('Fallback emoji asset also failed:', { name: segment.name, url: segment.fallbackUrl, error: fallbackError.message });
                            }
                        } else if (segment.id) {
                            const alternativeUrl = ensureDiscordEmojiSize(`https://cdn.discordapp.com/emojis/${segment.id}.png`, DEFAULT_CUSTOM_EMOJI_SIZE);
                            if (alternativeUrl !== segment.url) {
                                try {
                                    const fallbackImg = await this.fetchEmojiImage(alternativeUrl);
                                    ctx.drawImage(fallbackImg, drawX, currentY, emojiSize, emojiSize);
                                    rendered = true;
                                } catch (altError) {
                                    console.warn('Alternative emoji URL also failed:', { name: segment.name, url: alternativeUrl, error: altError.message });
                                }
                            }
                        }
                    }

                    if (rendered) {
                        currentLineWidth += emojiAdvance;
                        continue;
                    }
                }

                if (segment.isUnicode) {
                    const emojiText = segment.name;

                    ctx.font = '18px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Android Emoji", "EmojiSymbols", "EmojiOne Mozilla", "Twemoji Mozilla", "Segoe UI Symbol", sans-serif';
                    const textWidth = ctx.measureText(emojiText).width;
                    if (currentLineWidth + textWidth > maxWidth && currentLineWidth > 0) {
                        advanceLine();
                    }
                    ctx.fillText(emojiText, startX + currentLineWidth, currentY);
                    currentLineWidth += textWidth;

                    ctx.font = '15px Arial';
                } else {
                    try {
                        console.log('Loading emoji:', { name: segment.name, url: segment.url });
                        const emojiImg = await loadImage(segment.url);
                        const emojiWidth = emojiSize;
                        const emojiHeight = emojiSize;

                        if (currentLineWidth + emojiAdvance > maxWidth && currentLineWidth > 0) {
                            advanceLine();
                        }

                        ctx.drawImage(emojiImg, startX + currentLineWidth, currentY, emojiWidth, emojiHeight);
                        currentLineWidth += emojiAdvance;
                        console.log('Successfully rendered emoji:', segment.name);
                    } catch (error) {
                        console.warn('Failed to load emoji:', { name: segment.name, url: segment.url, error: error.message });

                        try {
                            const alternativeUrl = `https://cdn.discordapp.com/emojis/${segment.id}.png`;
                            if (alternativeUrl !== segment.url) {
                                console.log('Trying alternative emoji URL:', alternativeUrl);
                                const emojiImg = await loadImage(alternativeUrl);
                                const emojiWidth = emojiSize;
                                const emojiHeight = emojiSize;

                                if (currentLineWidth + emojiAdvance > maxWidth && currentLineWidth > 0) {
                                    advanceLine();
                                }

                                ctx.drawImage(emojiImg, startX + currentLineWidth, currentY, emojiWidth, emojiHeight);
                                currentLineWidth += emojiAdvance;
                                console.log('Successfully rendered emoji with alternative URL:', segment.name);
                            } else {
                                throw new Error('Alternative URL same as original');
                            }
                        } catch (altError) {
                            console.warn('Alternative emoji URL also failed:', altError.message);
                            const fallbackText = `:${segment.name}:`;
                            handleTextToken(fallbackText);
                        }
                    }
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
                    handleTextToken(token, '#8899ff');
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
    }

    // Split text into segments with emojis and mentions
    splitTextWithEmojisAndMentions(text, allEmojis, mentions) {
        const segments = [];
        let lastIndex = 0;
        
        // Sort emojis by position
        const sortedEmojis = allEmojis.sort((a, b) => a.start - b.start);
        const sortedMentions = (mentions || []).sort((a, b) => a.start - b.start);

        // Merge streams by position
        let i = 0, j = 0;
        const items = [];
        while (i < sortedEmojis.length || j < sortedMentions.length) {
            const nextEmoji = i < sortedEmojis.length ? sortedEmojis[i] : null;
            const nextMention = j < sortedMentions.length ? sortedMentions[j] : null;
            const takeEmoji = nextEmoji && (!nextMention || nextEmoji.start <= nextMention.start);
            if (takeEmoji) { items.push({ kind: 'emoji', item: nextEmoji }); i++; }
            else { items.push({ kind: 'mention', item: nextMention }); j++; }
        }

        for (const entry of items) {
            const posStart = entry.item.start;
            const posEnd = entry.item.end;
            if (posStart > lastIndex) {
                const textSegment = text.substring(lastIndex, posStart);
                if (textSegment) segments.push({ type: 'text', text: textSegment });
            }
            if (entry.kind === 'emoji') {
                const emoji = entry.item;
                segments.push({
                    type: 'emoji',
                    name: emoji.name,
                    url: emoji.url,
                    fallbackUrl: emoji.fallbackUrl,
                    full: emoji.full,
                    id: emoji.id,
                    isUnicode: emoji.isUnicode
                });
            } else {
                const mention = entry.item;
                segments.push({ type: 'mention', text: mention.display });
            }
            lastIndex = posEnd;
        }
        
        // Add remaining text
        if (lastIndex < text.length) {
            const remainingText = text.substring(lastIndex);
            if (remainingText) {
                segments.push({ type: 'text', text: remainingText });
            }
        }
        
        return segments;
    }

    // Draw a single line with formatting applied
    drawFormattedLine(ctx, line, x, y, formatting) {
        // Remove formatting markers and apply styles
        let processedLine = line.trim();
        
        // Apply bold formatting
        processedLine = processedLine.replace(/\*\*(.*?)\*\*/g, '$1');
        
        // Apply italic formatting
        processedLine = processedLine.replace(/(?<!\*)\*(?!\*)([^*]+)\*(?!\*)/g, '$1');
        processedLine = processedLine.replace(/(?<!_)_(?!_)([^_]+)_(?!_)/g, '$1');
        
        // Apply strikethrough formatting
        processedLine = processedLine.replace(/~~(.*?)~~/g, '$1');
        
        // Apply underline formatting
        processedLine = processedLine.replace(/__(.*?)__/g, '$1');
        
        // Apply code formatting
        processedLine = processedLine.replace(/`([^`]+)`/g, '$1');
        
        // Draw the processed text
        ctx.fillStyle = '#ffffff';
        ctx.font = '15px Arial';
        ctx.fillText(processedLine, x, y);
    }

    // Draw images from attachments and URLs
    async drawImages(ctx, attachments, imageUrls, startX, startY, maxWidth) {
        let currentY = startY;
        const maxImageWidth = Math.min(maxWidth, 400);
        const maxImageHeight = 300; // Increased max height

        // Draw attachment images
        if (attachments && attachments.size > 0) {
            for (const attachment of attachments.values()) {
                if (attachment.contentType && attachment.contentType.startsWith('image/')) {
                    try {
                        const isGif = attachment.contentType.includes('gif') || /\.gif(\?|$)/i.test(attachment.url);
                        const img = isGif ? await this.loadStaticImage(attachment.url) : await loadImage(attachment.url);
                        const aspectRatio = img.width / img.height;
                        
                        // Calculate dimensions maintaining aspect ratio
                        let drawWidth = maxImageWidth;
                        let drawHeight = drawWidth / aspectRatio;
                        
                        // If height exceeds max, scale down
                        if (drawHeight > maxImageHeight) {
                            drawHeight = maxImageHeight;
                            drawWidth = drawHeight * aspectRatio;
                        }

                        ctx.drawImage(img, startX, currentY, drawWidth, drawHeight);
                        currentY += drawHeight + 10;
                    } catch (error) {
                        console.warn('Failed to load attachment image:', error);
                    }
                }
            }
        }

        // Draw URL images (including Tenor GIFs)
        for (const imageUrl of imageUrls) {
            try {
                let sourceUrl = imageUrl;
                // Always try to resolve Tenor links to a static image (covers all Tenor URL forms)
                if (/tenor\.com\//i.test(sourceUrl)) {
                    const staticUrl = await this.resolveTenorStatic(sourceUrl);
                    if (staticUrl) sourceUrl = staticUrl;
                }
                // Handle Discord CDN GIFs and any URL ending in .gif (with params)
                const isGifUrl = /\.gif(\?|$)/i.test(sourceUrl) || /media\.discordapp\.net\//i.test(sourceUrl);
                const img = isGifUrl ? await this.loadStaticImage(sourceUrl) : await loadImage(sourceUrl);
                const aspectRatio = img.width / img.height;
                
                // Calculate dimensions maintaining aspect ratio
                let drawWidth = maxImageWidth;
                let drawHeight = drawWidth / aspectRatio;
                
                // If height exceeds max, scale down
                if (drawHeight > maxImageHeight) {
                    drawHeight = maxImageHeight;
                    drawWidth = drawHeight * aspectRatio;
                }

                ctx.drawImage(img, startX, currentY, drawWidth, drawHeight);
                currentY += drawHeight + 10;
            } catch (error) {
                console.warn('Failed to load URL image:', error);
            }
        }

        return currentY;
    }


    async getContextualMemory(message, client) {
        try {
            const messages = await message.channel.messages.fetch({ limit: 20 });
            const sortedMessages = messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

            const referencedMessageId = message.reference?.messageId;
            let conversationStart = -1;
            let referencedMessage = null;

            for (let i = 0; i < sortedMessages.size; i++) {
                const msg = Array.from(sortedMessages.values())[i];
                if (msg.id === referencedMessageId) {
                    conversationStart = i;
                    referencedMessage = msg;
                    break;
                }
            }

            if (conversationStart === -1) {
                return null;
            }

            const contextualMessages = [];
            const threadMessages = Array.from(sortedMessages.values()).slice(conversationStart);

            if (referencedMessage.author.id === client.user.id) {
                contextualMessages.push({
                    role: "assistant",
                    content: referencedMessage.content,
                    timestamp: referencedMessage.createdTimestamp
                });
            } else {
                contextualMessages.push({
                    role: "user",
                    content: referencedMessage.content,
                    username: referencedMessage.author.username,
                    timestamp: referencedMessage.createdTimestamp,
                    isReferencedMessage: true
                });
            }

            for (const msg of threadMessages) {
                if (msg.id === referencedMessageId) continue;

                if (msg.author.bot && msg.author.id === client.user.id) {
                    contextualMessages.push({
                        role: "assistant",
                        content: msg.content,
                        timestamp: msg.createdTimestamp
                    });
                } else if (!msg.author.bot) {
                    contextualMessages.push({
                        role: "user",
                        content: msg.content,
                        username: msg.author.username,
                        timestamp: msg.createdTimestamp
                    });
                }
            }

            const recentContext = contextualMessages.slice(-10);

            return {
                type: "contextual",
                messages: recentContext,
                threadStart: referencedMessageId,
                isReplyToUser: referencedMessage.author.id !== client.user.id
            };

        } catch (error) {
            console.warn("Failed to build contextual memory:", error);
            return null;
        }
    }

    async enforceImmediateBraveGuard(message) {
        if (!message || typeof message.content !== 'string' || !message.content.length) {
            return false;
        }

        if (typeof braveSearch.extractSearchInvocation !== 'function' || typeof braveSearch.isExplicitQuery !== 'function') {
            return false;
        }

        const rawContent = message.content;

        try {
            const invocation = braveSearch.extractSearchInvocation(rawContent);

            if (!invocation || invocation.triggered !== true) {
                return false;
            }

            const segments = [];

            if (typeof invocation.query === 'string' && invocation.query.length > 0) {
                segments.push({ text: invocation.query, raw: typeof invocation.rawQuery === 'string' && invocation.rawQuery.length > 0 ? invocation.rawQuery : invocation.query });
            }

            if (typeof invocation.rawQuery === 'string' && invocation.rawQuery.length > 0) {
                segments.push({ text: invocation.rawQuery, raw: invocation.rawQuery });
            }

            if (typeof invocation.invocation === 'string' && invocation.invocation.length > 0) {
                segments.push({ text: invocation.invocation, raw: invocation.invocation });
            }

            segments.push({ text: rawContent, raw: rawContent });

            const isExplicit = invocation.explicit === true || segments.some(({ text, raw }) => {
                try {
                    return braveSearch.isExplicitQuery(text, { rawSegment: raw });
                } catch (error) {
                    console.error('Failed explicit check during Brave guard:', error);
                    return false;
                }
            });

            if (!isExplicit) {
                return false;
            }

            const blockMessage = braveSearch.getExplicitQueryMessage
                ? braveSearch.getExplicitQueryMessage()
                : 'I must decline that request, sir. My safety filters forbid it.';

            try {
                await message.reply({ content: blockMessage });
            } catch (error) {
                console.error('Failed to send Brave explicit guard reply:', error);
            }

            return true;
        } catch (error) {
            console.error('Failed to run Brave pre-flight guard:', error);
            return false;
        }
    }

    async handleMessage(message, client) {
        const allowedBotIds = ['984734399310467112', '1391010888915484672'];
        if (message.author.id === client.user.id) return;
        if (message.author.bot && !allowedBotIds.includes(message.author.id)) return;

        if (message.channel?.type === ChannelType.DM) {
            return;
        }

        const userId = message.author.id;

        const braveGuardedEarly = await this.enforceImmediateBraveGuard(message);
        if (braveGuardedEarly) {
            this.setCooldown(userId);
            return;
        }

        // 🚫 Ignore mass mentions completely
        if (message.mentions.everyone) {
            return; // NEW: do not respond to @everyone / @here
        }

        const isMentioned = message.mentions.has(client.user);
        const containsJarvis = config.wakeWords.some(trigger =>
            message.content.toLowerCase().includes(trigger)
        );
        const isReplyToJarvis = message.reference && message.reference.messageId;
        const isBot = message.author.bot;
        const isTCommand = message.content.toLowerCase().trim().startsWith("!t ");

        if (isMentioned || containsJarvis || isReplyToJarvis || isTCommand) {
            if (this.isOnCooldown(userId)) {
                return;
            }

            this.setCooldown(userId);
        }

        if (await this.handleAdminCommands(message)) return;
        if (await this.handleUtilityCommands(message)) return;

        await this.handleJarvisInteraction(message, client);
    }

    async handleAdminCommands(message) {
        const content = message.content.trim().toLowerCase();

        if (content === "!cleardbsecret") {
            if (message.author.id !== config.admin.userId) {
                return false;
            }

            try {
                await message.channel.sendTyping();
                const { conv, prof } = await this.jarvis.clearDatabase();
                await message.reply(`Database cleared, sir. Deleted ${conv} conversations and ${prof} profiles.`);
            } catch (error) {
                console.error("Clear DB error:", error);
                await message.reply("Unable to clear database, sir. Technical issue.");
            }
            return true;
        }

        return false;
    }

    async handleUtilityCommands(message) {
        const content = message.content.trim().toLowerCase();
        const rawContent = message.content.trim();

        if (content === "!reset") {
            try {
                await message.channel.sendTyping();
                const { conv, prof } = await this.jarvis.resetUserData(message.author.id);
                await message.reply(`Memories wiped, sir. Deleted ${conv} conversations and ${prof} profile${prof === 1 ? '' : 's'}.`);
            } catch (error) {
                console.error("Reset error:", error);
                await message.reply("Unable to reset memories, sir. Technical issue.");
            }
            return true;
        }

        if (content === "!help") {
            try {
                await message.channel.sendTyping();
                const response = await this.jarvis.handleUtilityCommand(
                    "help",
                    message.author.username,
                    message.author.id,
                    false,
                    null,
                    message.guild?.id || null
                );
                if (typeof response === "string") {
                    await message.reply(response);
                } else if (response) {
                    await message.reply(response);
                } else {
                    await message.reply("Unable to display help right now, sir.");
                }
            } catch (error) {
                console.error("Help command error:", error);
                await message.reply("Unable to display help right now, sir.");
            }
            return true;
        }

        if (content === "!invite") {
            try {
                await message.channel.sendTyping();
                const response = await this.jarvis.handleUtilityCommand(
                    "invite",
                    message.author.username,
                    message.author.id,
                    false,
                    null,
                    message.guild?.id || null
                );
                if (typeof response === "string") {
                    await message.reply(response);
                } else if (response) {
                    await message.reply(response);
                } else {
                    await message.reply("Support invite unavailable right now, sir.");
                }
            } catch (error) {
                console.error("Invite command error:", error);
                await message.reply("Support invite unavailable right now, sir.");
            }
            return true;
        }

        if (content.startsWith("!profile")) {
            try {
                await message.channel.sendTyping();
                const response = await this.jarvis.handleUtilityCommand(
                    rawContent.substring(1),
                    message.author.username,
                    message.author.id,
                    false,
                    null,
                    message.guild?.id || null
                );
                await message.reply(response || "Profile command processed, sir.");
            } catch (error) {
                console.error("Profile command error:", error);
                await message.reply("Unable to access profile systems, sir.");
            }
            return true;
        }

        if (content.startsWith("!history")) {
            try {
                await message.channel.sendTyping();
                const response = await this.jarvis.handleUtilityCommand(
                    rawContent.substring(1),
                    message.author.username,
                    message.author.id,
                    false,
                    null,
                    message.guild?.id || null
                );
                await message.reply(response || "No history available yet, sir.");
            } catch (error) {
                console.error("History command error:", error);
                await message.reply("Unable to retrieve history, sir.");
            }
            return true;
        }

        if (content.startsWith("!recap")) {
            try {
                await message.channel.sendTyping();
                const response = await this.jarvis.handleUtilityCommand(
                    rawContent.substring(1),
                    message.author.username,
                    message.author.id,
                    false,
                    null,
                    message.guild?.id || null
                );
                await message.reply(response || "Nothing to report just yet, sir.");
            } catch (error) {
                console.error("Recap command error:", error);
                await message.reply("Unable to compile a recap, sir.");
            }
            return true;
        }

        if (content.startsWith("!encode")) {
            try {
                await message.channel.sendTyping();
                const response = await this.jarvis.handleUtilityCommand(
                    rawContent.substring(1),
                    message.author.username,
                    message.author.id,
                    false,
                    null,
                    message.guild?.id || null
                );
                await message.reply(response || "Encoding complete, sir.");
            } catch (error) {
                console.error("Encode command error:", error);
                await message.reply("Unable to encode that right now, sir.");
            }
            return true;
        }

        if (content.startsWith("!decode")) {
            try {
                await message.channel.sendTyping();
                const response = await this.jarvis.handleUtilityCommand(
                    rawContent.substring(1),
                    message.author.username,
                    message.author.id,
                    false,
                    null,
                    message.guild?.id || null
                );
                await message.reply(response || "Decoding complete, sir.");
            } catch (error) {
                console.error("Decode command error:", error);
                await message.reply("Unable to decode that right now, sir.");
            }
            return true;
        }

        if (content.startsWith("!t ")) {
            const whitelistedChannelIds = config.commands.whitelistedChannelIds;
            if (!whitelistedChannelIds.includes(message.channel.id)) {
                return true;
            }

            console.log(`!t command detected: ${message.content}`);
            try {
                await message.channel.sendTyping();
                const response = await this.jarvis.handleUtilityCommand(
                    message.content.trim(),
                    message.author.username,
                    message.author.id,
                    false,
                    null,
                    message.guild?.id || null
                );

                console.log(`!t command response: ${response}`);
                if (response) {
                    await message.reply(response);
                } else {
                    await message.reply("Search system unavailable, sir. Technical difficulties.");
                }
            } catch (error) {
                console.error("!t command error:", error);
                await message.reply("Search failed, sir. Technical difficulties.");
            }
            return true;
        }

        return false;
    }

    async handleJarvisInteraction(message, client) {
        const isMentioned = message.mentions.has(client.user);
        const isDM = message.channel.type === ChannelType.DM;
        const containsJarvis = config.wakeWords.some(trigger =>
            message.content.toLowerCase().includes(trigger)
        );
        const isBot = message.author.bot;

        if (isBot) {
            console.log(`Bot interaction detected from ${message.author.username} (${message.author.id}): ${message.content.substring(0, 50)}...`);
        }

        let isReplyToJarvis = false;
        let isReplyToUser = false;
        let contextualMemory = null;

        const rawContent = typeof message.content === 'string' ? message.content : '';

        if (message.reference && message.reference.messageId) {
            try {
                const referencedMessage = await message.channel.messages.fetch(message.reference.messageId);
                if (referencedMessage.author.id === client.user.id) {
                    isReplyToJarvis = true;
                    contextualMemory = await this.getContextualMemory(message, client);
                } else if (!referencedMessage.author.bot) {
                    isReplyToUser = true;
                    if (isMentioned || containsJarvis) {
                        contextualMemory = await this.getContextualMemory(message, client);
                    }
                }
            } catch (error) {
                console.warn("Failed to fetch referenced message:", error);
            }
        }

        if (isBot) {
            if (!isMentioned && !containsJarvis) return;
        } else {
            if (!isDM && !isMentioned && !containsJarvis && !isReplyToJarvis && !(isReplyToUser && (isMentioned || containsJarvis))) {
                return;
            }
        }

        const defaultBraveInvocation = { triggered: false, query: null, rawQuery: null, invocation: null, explicit: false };
        let rawBraveInvocation = defaultBraveInvocation;

        if (rawContent && typeof braveSearch.extractSearchInvocation === 'function') {
            try {
                const extracted = braveSearch.extractSearchInvocation(rawContent);
                if (extracted && typeof extracted === 'object') {
                    rawBraveInvocation = {
                        ...defaultBraveInvocation,
                        ...extracted
                    };
                }
            } catch (error) {
                console.error('Failed to parse raw Brave invocation:', error);
                rawBraveInvocation = defaultBraveInvocation;
            }
        }

        if (rawBraveInvocation.triggered && rawBraveInvocation.explicit) {
            try {
                await message.reply({
                    content: braveSearch.getExplicitQueryMessage
                        ? braveSearch.getExplicitQueryMessage()
                        : 'I must decline that request, sir. My safety filters forbid it.'
                });
            } catch (error) {
                console.error('Failed to reply to explicit Brave request:', error);
            }
            this.setCooldown(message.author.id);
            return;
        }

        // 🚫 Clean mentions + @everyone/@here
        let cleanContent = message.content
            .replace(/<@!?\d+>/g, "")  // user mentions
            .replace(/@everyone/g, "") // NEW
            .replace(/@here/g, "")     // NEW
            .trim();

        // Check for clip command first (overrides AI response)
        if (await this.handleClipCommand(message, client)) {
            this.setCooldown(message.author.id);
            return; // Exit early, no AI response
        }

        const ytCommandPattern = /^jarvis\s+yt\s+(.+)$/i;
        const mathTriggerPattern = /\bjarvis\s+math\b/i;
        const hasMathTrigger = mathTriggerPattern.test(cleanContent);
        const ytMatch = cleanContent.match(ytCommandPattern);
        let braveInvocation = defaultBraveInvocation;

        if (typeof braveSearch.extractSearchInvocation === 'function') {
            try {
                const extracted = braveSearch.extractSearchInvocation(cleanContent);
                if (extracted && typeof extracted === 'object') {
                    braveInvocation = {
                        ...defaultBraveInvocation,
                        ...extracted
                    };
                }
            } catch (error) {
                console.error('Failed to parse cleaned Brave invocation:', error);
                braveInvocation = defaultBraveInvocation;
            }
        }

        if (hasMathTrigger) {
            const triggerIndex = cleanContent.toLowerCase().indexOf('jarvis math');
            const rawMathInput = triggerIndex >= 0
                ? cleanContent.substring(triggerIndex + 'jarvis math'.length)
                : '';
            const mathInput = rawMathInput.replace(/^[\s,:-]+/, '').trim();

            if (!mathInput.length) {
                await message.reply("Awaiting calculations, sir. Try `jarvis math solve 2x + 5 = 13`.");
                this.setCooldown(message.author.id);
                return;
            }

            try {
                await message.channel.sendTyping();
            } catch (error) {
                console.warn('Failed to send typing for math command:', error);
            }

            try {
                const response = await this.jarvis.handleMathCommand(mathInput);
                await message.reply(response || "Mathematics subsystem returned no output, sir.");
            } catch (error) {
                console.error("Math command error:", error);
                await message.reply("Mathematics subsystem encountered an error, sir. Please verify the expression.");
            }

            this.setCooldown(message.author.id);
            return;
        }

        if (ytMatch) {
            const searchQuery = ytMatch[1].trim();
            if (searchQuery) {
                try {
                    await message.channel.sendTyping();
                    const response = await this.jarvis.handleYouTubeSearch(searchQuery);
                    await message.reply(response);
                    this.setCooldown(message.author.id);
                    return;
                } catch (error) {
                    console.error("YouTube search error:", error);
                    await message.reply("YouTube search failed, sir. Technical difficulties.");
                    this.setCooldown(message.author.id);
                    return;
                }
            }
        }

        if (braveInvocation.triggered || rawBraveInvocation.triggered) {
            const invocationContext =
                (typeof braveInvocation.invocation === 'string' && braveInvocation.invocation.length > 0)
                    ? braveInvocation.invocation
                    : (typeof rawBraveInvocation.invocation === 'string' && rawBraveInvocation.invocation.length > 0)
                        ? rawBraveInvocation.invocation
                        : cleanContent;

            const rawSegmentCandidate =
                (typeof braveInvocation.rawQuery === 'string' && braveInvocation.rawQuery.length > 0)
                    ? braveInvocation.rawQuery
                    : (typeof rawBraveInvocation.rawQuery === 'string' && rawBraveInvocation.rawQuery.length > 0)
                        ? rawBraveInvocation.rawQuery
                        : invocationContext;

            const explicitFromInvocation = (!braveInvocation.explicit && braveSearch.isExplicitQuery)
                ? braveSearch.isExplicitQuery(invocationContext, { rawSegment: invocationContext })
                : false;

            const explicitDetected = (
                braveInvocation.explicit === true
                || rawBraveInvocation.explicit === true
                || explicitFromInvocation === true
            );

            if (explicitDetected) {
                await message.reply({
                    content: braveSearch.getExplicitQueryMessage
                        ? braveSearch.getExplicitQueryMessage()
                        : 'I must decline that request, sir. My safety filters forbid it.'
                });
                this.setCooldown(message.author.id);
                return;
            }

            const querySource =
                (typeof braveInvocation.query === 'string' && braveInvocation.query.length > 0)
                    ? braveInvocation.query
                    : (typeof rawBraveInvocation.query === 'string' && rawBraveInvocation.query.length > 0)
                        ? rawBraveInvocation.query
                        : rawSegmentCandidate;

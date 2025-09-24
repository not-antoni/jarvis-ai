/**
 * Discord event handlers and command processing
 */

const { ChannelType, AttachmentBuilder } = require('discord.js');
const JarvisAI = require('./jarvis-core');
const config = require('./config');
const { createCanvas, loadImage, registerFont } = require('canvas');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

class DiscordHandlers {
    constructor() {
        this.jarvis = new JarvisAI();
        this.userCooldowns = new Map();
    }

    // Clean up old cooldowns to prevent memory leaks
    cleanupCooldowns() {
        const now = Date.now();
        const maxAge = 24 * 60 * 60 * 1000; // 24 hours

        for (const [userId, timestamp] of this.userCooldowns.entries()) {
            if (now - timestamp > maxAge) {
                this.userCooldowns.delete(userId);
            }
        }
    }

    isOnCooldown(userId) {
        const now = Date.now();
        const lastMessageTime = this.userCooldowns.get(userId) || 0;
        return now - lastMessageTime < config.ai.cooldownMs;
    }

    setCooldown(userId) {
        this.userCooldowns.set(userId, Date.now());
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

    // Parse Discord custom emojis
    parseCustomEmojis(text) {
        const emojiRegex = /<a?:(\w+):(\d+)>/g;
        const emojis = [];
        let match;
        
        while ((match = emojiRegex.exec(text)) !== null) {
            const isAnimated = match[0].startsWith('<a:');
            const name = match[1];
            const id = match[2];
            const url = `https://cdn.discordapp.com/emojis/${id}.${isAnimated ? 'gif' : 'png'}`;
            
            emojis.push({
                full: match[0],
                name: name,
                id: id,
                url: url,
                isAnimated: isAnimated,
                start: match.index,
                end: match.index + match[0].length
            });
        }
        
        return emojis;
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

    // Format timestamp based on user timezone
    formatTimestamp(timestamp, userTimezone = 'UTC') {
        try {
            const date = new Date(timestamp);
            
            // For now, use local time formatting
            // In a real implementation, you'd use a timezone library like moment-timezone
            const options = {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true
            };
            
            return date.toLocaleTimeString('en-US', options);
        } catch (error) {
            console.warn('Failed to format timestamp:', error);
            return '6:39 PM'; // Fallback
        }
    }

    // Truncate text if too long
    truncateText(text, maxLength) {
        if (text.length <= maxLength) return text;
        return text.substring(0, maxLength - 3) + '...';
    }

    // Extract image URLs from text
    extractImageUrls(text) {
        const imageUrlRegex = /(https?:\/\/[^\s]+\.(?:jpg|jpeg|png|gif|webp|bmp|svg)(?:\?[^\s]*)?)/gi;
        const matches = text.match(imageUrlRegex);
        return matches || [];
    }

    calculateTextHeight(text, maxWidth) {
        // Create a temporary canvas to measure text
        const tempCanvas = createCanvas(1, 1);
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.font = '14px Arial';
        
        const words = text.split(' ');
        let currentLine = words[0];
        let lines = 1;

        for (let i = 1; i < words.length; i++) {
            const word = words[i];
            const width = tempCtx.measureText(currentLine + ' ' + word).width;
            if (width < maxWidth) {
                currentLine += ' ' + word;
            } else {
                lines++;
                currentLine = word;
            }
        }
        
        const baseHeight = 40; // Username + timestamp + spacing
        const lineHeight = 20;
        return baseHeight + (lines * lineHeight);
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
            
            // Check if message contains images or emojis - if so, don't respond
            if (this.hasImagesOrEmojis(repliedMessage)) {
                return true; // Handled silently - don't clip messages with images/emojis
            }
            
            // Create image from the replied message content with user info
            const avatarUrl = repliedMessage.author.displayAvatarURL({ extension: 'png', size: 128 });
            
            // Get user's role color
            let roleColor = '#ff6b6b'; // Default red
            try {
                if (message.guild && repliedMessage.member) {
                    roleColor = this.getUserRoleColor(repliedMessage.member);
                }
            } catch (error) {
                console.warn('Failed to get role color for text command:', error);
            }
            
            // Get display name (server nickname or username)
            const displayName = repliedMessage.member?.displayName || repliedMessage.author.username;
            
            const imageBuffer = await this.createClipImage(
                repliedMessage.content, 
                displayName, 
                avatarUrl,
                repliedMessage.author.bot,
                roleColor,
                message.guild,
                client,
                repliedMessage.createdTimestamp,
                repliedMessage.author.verified || false,
                repliedMessage.attachments
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

    async createClipImage(text, username, avatarUrl, isBot = false, roleColor = '#ff6b6b', guild = null, client = null, messageTimestamp = null, isVerified = false, attachments = null) {
    // Parse custom emojis and formatting
    const customEmojis = this.parseCustomEmojis(text);
    const formatting = this.parseDiscordFormatting(text);
    
    // Check for image attachments
    const hasImages = attachments && attachments.size > 0;
    const imageUrls = this.extractImageUrls(text);
    
    // Calculate dynamic canvas dimensions based on content
    const width = 600; // Increased width for better layout
    const minHeight = 120; // Minimum height for basic content
    
    // Calculate text height with emojis and formatting
    const textHeight = this.calculateTextHeight(text, width - 120); // Account for margins and avatar space
    
    // Calculate total height including emojis and images
    const emojiHeight = customEmojis.length > 0 ? 20 : 0;
    const imageHeight = (hasImages || imageUrls.length > 0) ? 200 : 0; // Space for images
    const totalHeight = Math.max(minHeight, textHeight + emojiHeight + imageHeight + 40); // Extra padding
    
    const canvas = createCanvas(width, totalHeight);
    const ctx = canvas.getContext('2d');

    // Pure black background
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, totalHeight);

    // Calculate centered positioning
    const avatarSize = 40;
    const contentWidth = width - 40;
    const contentHeight = totalHeight - 20;
    const avatarX = 20;
    const avatarY = (totalHeight - avatarSize) / 2;

    // Draw avatar (circular)
    if (avatarUrl) {
        try {
            ctx.save();
            ctx.beginPath();
            ctx.arc(avatarX + avatarSize/2, avatarY + avatarSize/2, avatarSize/2, 0, Math.PI * 2);
            ctx.clip();
            
            ctx.fillStyle = '#5865f2';
            ctx.fillRect(avatarX, avatarY, avatarSize, avatarSize);
            
            const avatarImg = await loadImage(avatarUrl);
            ctx.drawImage(avatarImg, avatarX, avatarY, avatarSize, avatarSize);
            
            ctx.restore();
        } catch (error) {
            console.warn('Failed to load avatar, using fallback:', error);
            ctx.save();
            ctx.beginPath();
            ctx.arc(avatarX + avatarSize/2, avatarY + avatarSize/2, avatarSize/2, 0, Math.PI * 2);
            ctx.fillStyle = '#5865f2';
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
        ctx.fillStyle = '#5865f2';
        ctx.fill();
        
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 12px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(username.charAt(0).toUpperCase(), avatarX + avatarSize/2, avatarY + avatarSize/2);
        ctx.restore();
    }

    // Calculate text positioning
    const textStartX = avatarX + avatarSize + 12;
    const textStartY = avatarY + 2;
    const maxTextWidth = contentWidth - (avatarSize + 12) - 20;

    // Truncate username if too long to prevent timestamp overlap
    const truncatedUsername = this.truncateText(username, 20);
    
    // Draw username in role color
    ctx.fillStyle = roleColor;
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(truncatedUsername, textStartX, textStartY);

    let currentX = textStartX + ctx.measureText(truncatedUsername).width + 4;

    // Draw bot tag if it's a bot
    if (isBot) {
        const botTagWidth = 35;
        const botTagHeight = 16;
        
        // Bot tag background
        ctx.fillStyle = '#5865f2';
        ctx.fillRect(currentX, textStartY, botTagWidth, botTagHeight);
        
        // Bot tag text
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 10px Arial';
        ctx.fillText('BOT', currentX + 2, textStartY + 2);
        
        currentX += botTagWidth + 4;
        
        // Draw verification checkmark if verified
        if (isVerified) {
            ctx.fillStyle = '#00d26a';
            ctx.font = 'bold 12px Arial';
            ctx.fillText('✓', currentX, textStartY);
            currentX += 12;
        }
    }

    // Draw timestamp with dynamic formatting
    const timestamp = messageTimestamp ? this.formatTimestamp(messageTimestamp) : '6:39 PM';
    const timestampWidth = ctx.measureText(timestamp).width;
    
    // Ensure timestamp doesn't overlap with username/bot tag
    const availableWidth = width - currentX - 20;
    if (timestampWidth <= availableWidth) {
        ctx.fillStyle = '#72767d';
        ctx.font = '12px Arial';
        ctx.fillText(timestamp, currentX, textStartY);
    } else {
        // If not enough space, put timestamp on next line
        ctx.fillStyle = '#72767d';
        ctx.font = '12px Arial';
        ctx.fillText(timestamp, textStartX, textStartY + 16);
    }

    // Draw message content with formatting support
    const messageStartY = textStartY + 18;
    await this.drawFormattedText(ctx, text, textStartX, messageStartY, maxTextWidth, customEmojis, formatting);

    // Draw images if present
    let imageY = messageStartY + textHeight + 10;
    if (hasImages || imageUrls.length > 0) {
        imageY = await this.drawImages(ctx, attachments, imageUrls, textStartX, imageY, maxTextWidth);
    }

    // Convert canvas to buffer
    const buffer = canvas.toBuffer('image/png');
    
    // Use sharp to optimize the image
    const finalHeight = Math.min(totalHeight, 600);
    const processedBuffer = await sharp(buffer)
        .resize(500, finalHeight)
        .png({ quality: 90 })
        .toBuffer();

    return processedBuffer;
    }

    // Draw text with Discord formatting and emojis
    async drawFormattedText(ctx, text, startX, startY, maxWidth, customEmojis, formatting) {
        ctx.fillStyle = '#ffffff';
        ctx.font = '14px Arial';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';

        // Process text with formatting and emojis
        let processedText = text;
        let currentY = startY;
        let currentX = startX;
        const lineHeight = 20;

        // Replace custom emojis with placeholders for now
        customEmojis.forEach(emoji => {
            processedText = processedText.replace(emoji.full, `:${emoji.name}:`);
        });

        // Simple word wrap with basic formatting
        const words = processedText.split(' ');
        let currentLine = '';
        let currentLineWidth = 0;

        for (let i = 0; i < words.length; i++) {
            const word = words[i];
            const wordWidth = ctx.measureText(word + ' ').width;
            
            if (currentLineWidth + wordWidth > maxWidth && currentLine !== '') {
                // Draw current line
                this.drawFormattedLine(ctx, currentLine, currentX, currentY, formatting);
                currentY += lineHeight;
                currentLine = word + ' ';
                currentLineWidth = ctx.measureText(word + ' ').width;
            } else {
                currentLine += word + ' ';
                currentLineWidth += wordWidth;
            }
        }

        // Draw the last line
        if (currentLine.trim()) {
            this.drawFormattedLine(ctx, currentLine, currentX, currentY, formatting);
        }
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
        ctx.font = '14px Arial';
        ctx.fillText(processedLine, x, y);
    }

    // Draw images from attachments and URLs
    async drawImages(ctx, attachments, imageUrls, startX, startY, maxWidth) {
        let currentY = startY;
        const imageHeight = 150;
        const maxImageWidth = Math.min(maxWidth, 400);

        // Draw attachment images
        if (attachments && attachments.size > 0) {
            for (const attachment of attachments.values()) {
                if (attachment.contentType && attachment.contentType.startsWith('image/')) {
                    try {
                        const img = await loadImage(attachment.url);
                        const aspectRatio = img.width / img.height;
                        const drawWidth = Math.min(maxImageWidth, aspectRatio * imageHeight);
                        const drawHeight = drawWidth / aspectRatio;

                        ctx.drawImage(img, startX, currentY, drawWidth, drawHeight);
                        currentY += drawHeight + 10;
                    } catch (error) {
                        console.warn('Failed to load attachment image:', error);
                    }
                }
            }
        }

        // Draw URL images
        for (const imageUrl of imageUrls) {
            try {
                const img = await loadImage(imageUrl);
                const aspectRatio = img.width / img.height;
                const drawWidth = Math.min(maxImageWidth, aspectRatio * imageHeight);
                const drawHeight = drawWidth / aspectRatio;

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

    async handleMessage(message, client) {
        const allowedBotIds = ['984734399310467112', '1391010888915484672'];
        if (message.author.id === client.user.id) return;
        if (message.author.bot && !allowedBotIds.includes(message.author.id)) return;

        const userId = message.author.id;

        // 🚫 Ignore mass mentions completely
        if (message.mentions.everyone) {
            return; // NEW: do not respond to @everyone / @here
        }

        const isMentioned = message.mentions.has(client.user);
        const isDM = message.channel.type === ChannelType.DM;
        const containsJarvis = config.wakeWords.some(trigger =>
            message.content.toLowerCase().includes(trigger)
        );
        const isReplyToJarvis = message.reference && message.reference.messageId;
        const isBot = message.author.bot;
        const isTCommand = message.content.toLowerCase().trim().startsWith("!t ");

        if (isDM || isMentioned || containsJarvis || isReplyToJarvis || isTCommand) {
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
                    message.author.id
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
        const ytMatch = cleanContent.match(ytCommandPattern);

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

        if (!cleanContent) {
            cleanContent = "jarvis";
        } else {
            const wakeWordPattern = new RegExp(`^(${config.wakeWords.join('|')})[,.!?]*$`, 'i');
            if (wakeWordPattern.test(cleanContent)) {
                cleanContent = "jarvis";
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
            this.setCooldown(message.author.id);
            return;
        }

        if (cleanContent.length > config.ai.maxInputLength) {
            cleanContent = cleanContent.substring(0, config.ai.maxInputLength) + "...";
        }

        try {
            const utilityResponse = await this.jarvis.handleUtilityCommand(
                cleanContent,
                message.author.username,
                message.author.id
            );

            if (utilityResponse) {
                if (typeof utilityResponse === "string" && utilityResponse.trim()) {
                    await message.reply(utilityResponse);
                } else {
                    await message.reply("Utility functions misbehaving, sir. Try another?");
                }
                return;
            }

            const response = await this.jarvis.generateResponse(message, cleanContent, false, contextualMemory);

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

    async handleSlashCommandClip(interaction) {
        try {
            await interaction.deferReply({ ephemeral: false });
            
            // Get the message ID from the slash command
            const messageId = interaction.options.getString("message_id");
            
            if (!messageId) {
                await interaction.editReply("Please provide a message ID, sir.");
                return true;
            }

            // Fetch the message by ID
            let targetMessage;
            try {
                targetMessage = await interaction.channel.messages.fetch(messageId);
            } catch (fetchError) {
                await interaction.editReply("Could not find that message, sir. Make sure the message ID is correct and the message is in this channel.");
                return true;
            }
            
            // All content types are now supported
            // No need to check for images or emojis anymore
            
            // Create image from the message content with user info
            const avatarUrl = targetMessage.author.displayAvatarURL({ extension: 'png', size: 128 });
            
            // Get user's role color
            let roleColor = '#ff6b6b'; // Default red
            try {
                if (interaction.guild && targetMessage.member) {
                    roleColor = this.getUserRoleColor(targetMessage.member);
                }
            } catch (error) {
                console.warn('Failed to get role color for slash command:', error);
            }
            
            // Get display name (server nickname or username)
            const displayName = targetMessage.member?.displayName || targetMessage.author.username;
            
            const imageBuffer = await this.createClipImage(
                targetMessage.content, 
                displayName, 
                avatarUrl,
                targetMessage.author.bot,
                roleColor,
                interaction.guild,
                interaction.client,
                targetMessage.createdTimestamp,
                targetMessage.author.verified || false,
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
        const userId = interaction.user.id;

        if (this.isOnCooldown(userId)) {
            return;
        }

        // Handle clip command first (special case)
        if (interaction.commandName === "clip") {
            this.setCooldown(userId);
            return await this.handleSlashCommandClip(interaction);
        }

        try {
            await interaction.deferReply({ ephemeral: false });
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
                    interaction
                );
            } else if (interaction.commandName === "time") {
                response = await this.jarvis.handleUtilityCommand(
                    "time",
                    interaction.user.username,
                    interaction.user.id,
                    true,
                    interaction
                );
            } else if (interaction.commandName === "reset") {
                response = await this.jarvis.handleUtilityCommand(
                    "reset",
                    interaction.user.username,
                    interaction.user.id,
                    true,
                    interaction
                );
            } else {
                response = await this.jarvis.handleUtilityCommand(
                    interaction.commandName,
                    interaction.user.username,
                    interaction.user.id,
                    true,
                    interaction
                );
            }

            if (typeof response === "string" && response.trim()) {
                await interaction.editReply(response);
            } else {
                await interaction.editReply("Response circuits tangled, sir. Try again?");
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

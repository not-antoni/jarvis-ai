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

    calculateTextHeight(text, maxWidth) {
        // Create a temporary canvas to measure text
        const tempCanvas = createCanvas(1, 1);
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.font = '14px Arial';
        
        // Function to detect Discord emojis
        const detectEmojis = (text) => {
            const emojiRegex = /<a?:(\w+):(\d+)>/g;
            const emojis = [];
            let match;
            
            while ((match = emojiRegex.exec(text)) !== null) {
                emojis.push({
                    full: match[0],
                    name: match[1],
                    id: match[2],
                    animated: match[0].startsWith('<a:'),
                    start: match.index,
                    end: match.index + match[0].length
                });
            }
            
            return emojis;
        };

        const emojis = detectEmojis(text);
        const emojiSize = 18;
        const lineHeight = 20;
        const baseHeight = 40; // Username + timestamp + spacing
        
        if (emojis.length === 0) {
            // No emojis, calculate normal word wrap
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
            
            return baseHeight + (lines * lineHeight);
        }

        // Calculate height with emojis
        let currentX = 0;
        let currentY = 0;
        let lastIndex = 0;
        
        for (const emoji of emojis) {
            // Text before emoji
            if (emoji.start > lastIndex) {
                const textBefore = text.substring(lastIndex, emoji.start);
                const textWidth = tempCtx.measureText(textBefore).width;
                
                if (currentX + textWidth > maxWidth) {
                    currentX = 0;
                    currentY += lineHeight;
                }
                
                currentX += textWidth;
            }
            
            // Emoji
            if (currentX + emojiSize > maxWidth) {
                currentX = 0;
                currentY += lineHeight;
            }
            
            currentX += emojiSize;
            lastIndex = emoji.end;
        }
        
        // Remaining text
        if (lastIndex < text.length) {
            const remainingText = text.substring(lastIndex);
            const textWidth = tempCtx.measureText(remainingText).width;
            
            if (currentX + textWidth > maxWidth) {
                currentY += lineHeight;
            }
        }
        
        return baseHeight + currentY + lineHeight;
    }

    async calculateImageHeight(attachments, maxWidth) {
        if (!attachments || attachments.length === 0) {
            return 0;
        }

        let totalHeight = 0;
        const maxImages = Math.min(attachments.length, 3);
        
        for (let i = 0; i < maxImages; i++) {
            const attachment = attachments[i];
            
            if (attachment.contentType && attachment.contentType.startsWith('image/')) {
                try {
                    const img = await loadImage(attachment.url);
                    
                    // Calculate scaled dimensions
                    let imgWidth = img.width;
                    let imgHeight = img.height;
                    
                    // Scale down if too large
                    if (imgWidth > maxWidth) {
                        const scale = maxWidth / imgWidth;
                        imgWidth = maxWidth;
                        imgHeight = imgHeight * scale;
                    }
                    
                    totalHeight += imgHeight + 10; // 10px spacing between images
                    
                } catch (error) {
                    // If image fails to load, add placeholder height
                    totalHeight += 60; // Fixed height for placeholder
                }
            }
        }
        
        return totalHeight;
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
            
            const imageBuffer = await this.createClipImage(
                repliedMessage.content, 
                repliedMessage.author.username, 
                avatarUrl,
                repliedMessage.author.bot,
                roleColor,
                repliedMessage.attachments,
                message.guild,
                client
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

    async createClipImage(text, username, avatarUrl, isBot = false, roleColor = '#ff6b6b', attachments = [], guild = null, client = null) {
        // Calculate dynamic canvas dimensions based on content
        const width = 400;
        const minHeight = 120; // Minimum height for basic content
        
        // Calculate text height
        const textHeight = this.calculateTextHeight(text, width - 80); // Account for margins and avatar space
        
        // Calculate image height
        const imageHeight = await this.calculateImageHeight(attachments, width - 40);
        
        // Calculate total height
        const totalHeight = Math.max(minHeight, textHeight + imageHeight + 20); // 20px padding
        
        const canvas = createCanvas(width, totalHeight);
        const ctx = canvas.getContext('2d');

        // Pure black background
        ctx.fillStyle = '#000000'; // Pure black
        ctx.fillRect(0, 0, width, totalHeight);

        // Calculate centered positioning
        const avatarSize = 32; // Smaller avatar
        const contentWidth = width - 40; // 20px margin on each side
        const contentHeight = totalHeight - 20; // 10px margin top/bottom
        const avatarX = 20;
        const avatarY = (totalHeight - avatarSize) / 2; // Center vertically

        // Draw avatar (circular)
        if (avatarUrl) {
            try {
                // Create circular clipping path for avatar
                ctx.save();
                ctx.beginPath();
                ctx.arc(avatarX + avatarSize/2, avatarY + avatarSize/2, avatarSize/2, 0, Math.PI * 2);
                ctx.clip();
                
                // Draw avatar background (fallback)
                ctx.fillStyle = '#5865f2'; // Discord blue
                ctx.fillRect(avatarX, avatarY, avatarSize, avatarSize);
                
                // Try to load and draw the actual avatar
                const avatarImg = await loadImage(avatarUrl);
                ctx.drawImage(avatarImg, avatarX, avatarY, avatarSize, avatarSize);
                
                ctx.restore();
            } catch (error) {
                console.warn('Failed to load avatar, using fallback:', error);
                // Fallback: draw a simple circle with user initial
                ctx.save();
                ctx.beginPath();
                ctx.arc(avatarX + avatarSize/2, avatarY + avatarSize/2, avatarSize/2, 0, Math.PI * 2);
                ctx.fillStyle = '#5865f2';
                ctx.fill();
                
                // Draw user initial
                ctx.fillStyle = '#ffffff';
                ctx.font = 'bold 12px Arial';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(username.charAt(0).toUpperCase(), avatarX + avatarSize/2, avatarY + avatarSize/2);
                ctx.restore();
            }
        } else {
            // No avatar URL, draw fallback
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

        // Calculate text positioning (centered)
        const textStartX = avatarX + avatarSize + 8;
        const textStartY = avatarY + 2;
        const maxTextWidth = contentWidth - (avatarSize + 8) - 20;

        // Draw username in role color
        ctx.fillStyle = roleColor; // Use role color
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(username, textStartX, textStartY);

        // Draw bot tag if it's a bot
        if (isBot) {
            const usernameWidth = ctx.measureText(username).width;
            const botTagX = textStartX + usernameWidth + 4;
            
            // Bot tag background
            ctx.fillStyle = '#5865f2';
            ctx.fillRect(botTagX, textStartY, 35, 16);
            
            // Bot tag text
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 10px Arial';
            ctx.fillText('BOT', botTagX + 2, textStartY + 2);
        }

        // Draw timestamp
        const timestampX = textStartX + (isBot ? 45 : 0) + ctx.measureText(username).width + 8;
        ctx.fillStyle = '#72767d';
        ctx.font = '12px Arial';
        ctx.fillText('6:39 PM', timestampX, textStartY);

    // Draw message content with emoji support
    ctx.fillStyle = '#ffffff';
    ctx.font = '14px Arial'; // Regular weight, not bold
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    // Function to detect Discord emojis
    const detectEmojis = (text) => {
        const emojiRegex = /<a?:(\w+):(\d+)>/g;
        const emojis = [];
        let match;
        
        while ((match = emojiRegex.exec(text)) !== null) {
            emojis.push({
                full: match[0],
                name: match[1],
                id: match[2],
                animated: match[0].startsWith('<a:'),
                start: match.index,
                end: match.index + match[0].length
            });
        }
        
        return emojis;
    };

    // Function to render text with emojis
    const renderTextWithEmojis = async (text, startX, startY, maxWidth) => {
        const emojis = detectEmojis(text);
        const emojiSize = 18; // Slightly larger for better visibility
        const lineHeight = 20; // Increased line height for emojis
        
        if (emojis.length === 0) {
            // No emojis, render normally with word wrap
            const wrapText = (text, maxWidth) => {
                const words = text.split(' ');
                const lines = [];
                let currentLine = words[0];

                for (let i = 1; i < words.length; i++) {
                    const word = words[i];
                    const width = ctx.measureText(currentLine + ' ' + word).width;
                    if (width < maxWidth) {
                        currentLine += ' ' + word;
                    } else {
                        lines.push(currentLine);
                        currentLine = word;
                    }
                }
                lines.push(currentLine);
                return lines;
            };

            const lines = wrapText(text, maxWidth);
            lines.forEach((line, index) => {
                ctx.fillText(line, startX, startY + index * lineHeight);
            });
            return;
        }

        // Split text into parts and render each part
        let lastIndex = 0;
        let currentX = startX;
        let currentY = startY;
        
        for (const emoji of emojis) {
            // Render text before emoji
            if (emoji.start > lastIndex) {
                const textBefore = text.substring(lastIndex, emoji.start);
                const textWidth = ctx.measureText(textBefore).width;
                
                // Check if text fits on current line
                if (currentX + textWidth > startX + maxWidth) {
                    currentX = startX;
                    currentY += lineHeight;
                }
                
                ctx.fillText(textBefore, currentX, currentY);
                currentX += textWidth;
            }
            
            // Render emoji
            try {
                let emojiUrl;
                
                // Try to get emoji from Discord client cache first
                if (client && guild) {
                    const discordEmoji = client.emojis.cache.get(emoji.id);
                    if (discordEmoji) {
                        emojiUrl = discordEmoji.url;
                    } else {
                        // Fallback to CDN URL construction
                        emojiUrl = `https://cdn.discordapp.com/emojis/${emoji.id}.${emoji.animated ? 'gif' : 'png'}`;
                    }
                } else {
                    // No client/guild info, use CDN URL
                    emojiUrl = `https://cdn.discordapp.com/emojis/${emoji.id}.${emoji.animated ? 'gif' : 'png'}`;
                }
                
                const emojiImg = await loadImage(emojiUrl);
                
                // Check if emoji fits on current line
                if (currentX + emojiSize > startX + maxWidth) {
                    currentX = startX;
                    currentY += lineHeight;
                }
                
                ctx.drawImage(emojiImg, currentX, currentY - 1, emojiSize, emojiSize);
                currentX += emojiSize;
                
            } catch (error) {
                console.warn(`Failed to load emoji ${emoji.name}:`, error);
                // Fallback: render emoji name with better styling
                const fallbackText = `:${emoji.name}:`;
                const textWidth = ctx.measureText(fallbackText).width;
                
                // Check if fallback text fits on current line
                if (currentX + textWidth > startX + maxWidth) {
                    currentX = startX;
                    currentY += lineHeight;
                }
                
                // Style the fallback text to look more like an emoji placeholder
                ctx.fillStyle = '#5865f2'; // Discord blue background
                ctx.fillRect(currentX, currentY - 2, textWidth + 4, 16);
                ctx.fillStyle = '#ffffff'; // White text
                ctx.fillText(fallbackText, currentX + 2, currentY);
                currentX += textWidth + 4;
            }
            
            lastIndex = emoji.end;
        }
        
        // Render remaining text
        if (lastIndex < text.length) {
            const remainingText = text.substring(lastIndex);
            const textWidth = ctx.measureText(remainingText).width;
            
            // Check if remaining text fits on current line
            if (currentX + textWidth > startX + maxWidth) {
                currentX = startX;
                currentY += lineHeight;
            }
            
            ctx.fillText(remainingText, currentX, currentY);
        }
    };

    // Render message with emoji support
    const messageStartY = textStartY + 18; // Below username line
    await renderTextWithEmojis(text, textStartX, messageStartY, maxTextWidth);

        // Draw images if present
        if (attachments && attachments.length > 0) {
            const imageStartY = textHeight + 10; // Start below the text content
            const maxImageWidth = width - 40; // 20px margin on each side
            const maxImageHeight = imageHeight; // Use calculated image height
            let currentImageY = imageStartY;
            
            for (let i = 0; i < Math.min(attachments.length, 3); i++) { // Max 3 images
                const attachment = attachments[i];
                
                // Check if it's an image
                if (attachment.contentType && attachment.contentType.startsWith('image/')) {
                    try {
                        const img = await loadImage(attachment.url);
                        
                        // Calculate image dimensions (maintain aspect ratio)
                        let imgWidth = img.width;
                        let imgHeight = img.height;
                        
                        // Scale down if too large
                        if (imgWidth > maxImageWidth) {
                            const scale = maxImageWidth / imgWidth;
                            imgWidth = maxImageWidth;
                            imgHeight = imgHeight * scale;
                        }
                        
                        if (imgHeight > maxImageHeight) {
                            const scale = maxImageHeight / imgHeight;
                            imgHeight = maxImageHeight;
                            imgWidth = imgWidth * scale;
                        }
                        
                        // Center the image horizontally
                        const imgX = (width - imgWidth) / 2;
                        
                        // Draw image
                        ctx.drawImage(img, imgX, currentImageY, imgWidth, imgHeight);
                        
                        // Move to next image position
                        currentImageY += imgHeight + 10; // 10px spacing between images
                        
                    } catch (error) {
                        console.warn(`Failed to load image ${i + 1}:`, error);
                        // Draw placeholder for failed images
                        ctx.fillStyle = '#333333';
                        ctx.fillRect(20, currentImageY, maxImageWidth, 50);
                        
                        ctx.fillStyle = '#666666';
                        ctx.font = '12px Arial';
                        ctx.textAlign = 'center';
                        ctx.fillText('Failed to load image', width / 2, currentImageY + 30);
                        
                        // Move to next image position even for failed images
                        currentImageY += 60; // Fixed height for placeholder
                    }
                }
            }
        }

        // Convert canvas to buffer
        const buffer = canvas.toBuffer('image/png');
        
        // Use sharp to slightly reduce quality/resolution for funny effect
        const finalHeight = Math.min(totalHeight, 500); // Cap height at 500px
        const processedBuffer = await sharp(buffer)
            .resize(320, finalHeight) // Adjust final size based on content
            .png({ quality: 85 }) // Slightly lower quality
            .toBuffer();

        return processedBuffer;
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
            
            const imageBuffer = await this.createClipImage(
                targetMessage.content, 
                targetMessage.author.username, 
                avatarUrl,
                targetMessage.author.bot,
                roleColor,
                targetMessage.attachments,
                interaction.guild,
                interaction.client
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

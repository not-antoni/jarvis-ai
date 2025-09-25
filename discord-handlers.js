/**
 * Discord event handlers and command processing
 */

const { ChannelType, AttachmentBuilder, UserFlags } = require('discord.js');
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
        // Unicode emoji regex - covers most emoji ranges
        const unicodeEmojiRegex = /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu;
        const emojis = [];
        let match;
        
        while ((match = unicodeEmojiRegex.exec(text)) !== null) {
            emojis.push({
                full: match[0],
                name: match[0],
                id: null,
                url: null, // Unicode emojis don't have URLs
                isAnimated: false,
                emojiObject: null,
                start: match.index,
                end: match.index + match[0].length,
                isUnicode: true
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

    calculateTextHeight(text, maxWidth, dpiScale = 1) {
        // Create a temporary canvas to measure text
        const tempCanvas = createCanvas(1, 1);
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.font = `24px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`;
        
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
        
        const baseHeight = 90; // Username + timestamp + spacing
        const lineHeight = 36; // Line height
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
                repliedMessage, // Pass the entire message object
                repliedMessage.author,
                repliedMessage.attachments
            );
            
            // Create attachment with WebP format for better quality
            const attachment = new AttachmentBuilder(imageBuffer, { name: 'clipped.webp' });
            
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

    async createClipImage(text, username, avatarUrl, isBot = false, roleColor = '#ff6b6b', guild = null, client = null, message = null, user = null, attachments = null) {
    // Parse custom emojis and formatting using Discord API
    const customEmojis = await this.parseCustomEmojis(text, guild);
    const unicodeEmojis = this.parseUnicodeEmojis(text);
    const allEmojis = [...customEmojis, ...unicodeEmojis].sort((a, b) => a.start - b.start);
    const formatting = this.parseDiscordFormatting(text);
    
    // Debug logging for emoji parsing
    if (allEmojis.length > 0) {
        console.log('Found emojis:', allEmojis.map(e => ({ name: e.name, url: e.url, isUnicode: e.isUnicode })));
    }
    
    // Check bot verification status using Discord API
    const isVerified = user ? this.isBotVerified(user) : false;
    
    // Check for image attachments
    const hasImages = attachments && attachments.size > 0;
    const imageUrls = this.extractImageUrls(text);
    
    // Calculate dynamic canvas dimensions - use native high resolution without double scaling
    const baseWidth = 1600; // High resolution base width
    const width = baseWidth; // No DPI scaling to avoid quality loss
    const minHeight = 200; // Minimum height
    
    // Calculate text height with emojis and formatting
    const textHeight = this.calculateTextHeight(text, width - 220, 1); // Account for margins and avatar space

    // Pre-measure images to compute exact final canvas height before creating it
    let preMeasuredImageHeight = 0;
    if (hasImages || imageUrls.length > 0) {
        const tempCanvas = createCanvas(10, 10);
        const tempCtx = tempCanvas.getContext('2d');
        const imageEndY = await this.drawImages(tempCtx, attachments, imageUrls, 0, 0, width - 220, 1);
        preMeasuredImageHeight = imageEndY + 30; // include padding under images
    }

    // Compute final canvas height and create canvas once
    const totalHeight = Math.ceil(Math.max(minHeight, textHeight + preMeasuredImageHeight + 80));
    const canvas = createCanvas(width, totalHeight);
    const ctx = canvas.getContext('2d');
    
    // Enable high-quality rendering
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.textRenderingOptimization = 'optimizeQuality';
    ctx.antialias = 'default';

    // Pure black background
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, totalHeight);

    // Calculate centered positioning with more space for avatar and text
    const avatarSize = 80; // Larger avatar for better quality
    const contentWidth = width - 160; // More margin
    const contentHeight = totalHeight - 40;
    const avatarX = 80; // Moved further to the right
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

    // Calculate text positioning - moved further right
    const textStartX = avatarX + avatarSize + 40; // Increased spacing
    const textStartY = avatarY + 6;
    const maxTextWidth = contentWidth - (avatarSize + 40) - 60; // More margin

    // Truncate username if too long to prevent timestamp overlap
    const truncatedUsername = this.truncateText(username, 20);

    // Draw username in role color with high-quality font
    ctx.fillStyle = roleColor;
    ctx.font = `bold 28px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(truncatedUsername, textStartX, textStartY);

    let currentX = textStartX + ctx.measureText(truncatedUsername).width + 4;

        // Draw app tag if it's a bot
        if (isBot) {
            const appTagWidth = 60;
            const appTagHeight = 28;
            
            // App tag background (purple/blue-violet color)
            ctx.fillStyle = '#8B5CF6'; // Purple color for APP badge
            ctx.fillRect(currentX, textStartY, appTagWidth, appTagHeight);
            
            // App tag text with high-quality font
            ctx.fillStyle = '#ffffff';
            ctx.font = `bold 18px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`;
            ctx.fillText('APP', currentX + 8, textStartY + 6);
            
            currentX += appTagWidth + 8;
            
            // Draw verification badge if verified
            if (isVerified) {
                try {
                    const badgeUrl = this.getVerificationBadgeUrl();
                    const badgeImg = await loadImage(badgeUrl);
                    const badgeSize = 28;
                    ctx.drawImage(badgeImg, currentX, textStartY, badgeSize, badgeSize);
                    currentX += badgeSize + 8;
                } catch (error) {
                    console.warn('Failed to load verification badge, using fallback:', error);
                    // Fallback to text checkmark
                    ctx.fillStyle = '#00d26a';
                    ctx.font = `bold 18px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`;
                    ctx.fillText('✓', currentX, textStartY);
                    currentX += 22;
                }
            }
        }

    // Draw timestamp with dynamic formatting
    const timestamp = message ? this.parseDiscordTimestamp(message) : '6:39 PM';
    const timestampWidth = ctx.measureText(timestamp).width;
    
    // Ensure timestamp doesn't overlap with username/bot tag
    const availableWidth = width - currentX - 40;
    if (timestampWidth <= availableWidth) {
        ctx.fillStyle = '#72767d';
        ctx.font = `20px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`;
        ctx.fillText(timestamp, currentX, textStartY);
    } else {
        // If not enough space, put timestamp on next line
        ctx.fillStyle = '#72767d';
        ctx.font = `20px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`;
        ctx.fillText(timestamp, textStartX, textStartY + 30);
    }

    // Draw message content with formatting support
    const messageStartY = textStartY + 42;
    await this.drawFormattedText(ctx, text, textStartX, messageStartY, maxTextWidth, allEmojis, formatting, 1);

    // Draw images once on the final canvas (no resize later)
    let imageY = messageStartY + textHeight + 20;
    if (hasImages || imageUrls.length > 0) {
        await this.drawImages(ctx, attachments, imageUrls, textStartX, imageY, maxTextWidth, 1);
    }

    // Convert canvas to buffer with optimized processing
    const buffer = canvas.toBuffer('image/png');
    
    // Use sharp to optimize the image with subtle enhancement
    const finalHeight = Math.ceil(Math.min(totalHeight, 1600)); // No unnecessary scaling
    const processedBuffer = await sharp(buffer)
        .resize(baseWidth, finalHeight, {
            kernel: sharp.kernel.lanczos3, // High-quality scaling algorithm
            withoutEnlargement: false
        })
        .sharpen({ sigma: 0.3, m1: 0.5, m2: 1.5, x1: 2, y2: 10 }) // Subtle sharpening
        .webp({ 
            quality: 98, // Higher quality than PNG
            effort: 6, // Maximum compression effort for best quality
            smartSubsample: true, // Smart color subsampling
            reductionEffort: 6 // Maximum reduction effort
        })
        .toBuffer();

    return processedBuffer;
    }

    // Draw text with Discord formatting and emojis (high-quality rendering)
    async drawFormattedText(ctx, text, startX, startY, maxWidth, customEmojis, formatting, dpiScale = 1) {
    ctx.fillStyle = '#ffffff';
    ctx.font = `24px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

        let currentY = startY;
        let currentX = startX;
        const lineHeight = 36; // Line height
        const emojiSize = 32; // Larger emojis for better quality

        // Remove Discord formatting markers for cleaner display
        let processedText = text
            .replace(/\*\*(.*?)\*\*/g, '$1') // Bold
            .replace(/(?<!\*)\*(?!\*)([^*]+)\*(?!\*)/g, '$1') // Italic *
            .replace(/(?<!_)_(?!_)([^_]+)_(?!_)/g, '$1') // Italic _
            .replace(/~~(.*?)~~/g, '$1') // Strikethrough
            .replace(/__(.*?)__/g, '$1') // Underline
            .replace(/`([^`]+)`/g, '$1'); // Code

        // Split text into segments (text and emojis)
        const segments = this.splitTextWithEmojis(processedText, customEmojis);
        
        let currentLineWidth = 0;
        let currentLineHeight = lineHeight;

        for (const segment of segments) {
            if (segment.type === 'emoji') {
                if (segment.isUnicode) {
                    // Draw Unicode emoji as text
                    const emojiText = segment.name;
                    const textWidth = ctx.measureText(emojiText).width;
                    
                    if (currentLineWidth + textWidth > maxWidth && currentLineWidth > 0) {
                        currentY += currentLineHeight;
                        currentLineWidth = 0;
                    }
                    
                    ctx.fillText(emojiText, currentX + currentLineWidth, currentY);
                    currentLineWidth += textWidth;
            } else {
                    // Draw custom emoji image
                    try {
                        console.log('Loading emoji:', { name: segment.name, url: segment.url });
                        const emojiImg = await loadImage(segment.url);
                        const emojiWidth = emojiSize;
                        const emojiHeight = emojiSize;
                        
                        // Check if emoji fits on current line
                        if (currentLineWidth + emojiWidth > maxWidth && currentLineWidth > 0) {
                            currentY += currentLineHeight;
                            currentLineWidth = 0;
                        }
                        
                        ctx.drawImage(emojiImg, currentX + currentLineWidth, currentY, emojiWidth, emojiHeight);
                        currentLineWidth += emojiWidth + 2; // Small spacing after emoji
                        console.log('Successfully rendered emoji:', segment.name);
                    } catch (error) {
                        console.warn('Failed to load emoji:', { name: segment.name, url: segment.url, error: error.message });
                        
                        // Try alternative CDN URL if first attempt failed
                        try {
                            const alternativeUrl = `https://cdn.discordapp.com/emojis/${segment.id}.png`;
                            if (alternativeUrl !== segment.url) {
                                console.log('Trying alternative emoji URL:', alternativeUrl);
                                const emojiImg = await loadImage(alternativeUrl);
                                const emojiWidth = emojiSize;
                                const emojiHeight = emojiSize;
                                
                                if (currentLineWidth + emojiWidth > maxWidth && currentLineWidth > 0) {
                                    currentY += currentLineHeight;
                                    currentLineWidth = 0;
                                }
                                
                                ctx.drawImage(emojiImg, currentX + currentLineWidth, currentY, emojiWidth, emojiHeight);
                                currentLineWidth += emojiWidth + 2;
                                console.log('Successfully rendered emoji with alternative URL:', segment.name);
                            } else {
                                throw new Error('Alternative URL same as original');
                            }
                        } catch (altError) {
                            console.warn('Alternative emoji URL also failed:', altError.message);
                            // Fallback to text representation
                            const emojiText = `:${segment.name}:`;
                            const textWidth = ctx.measureText(emojiText).width;
                            
                            if (currentLineWidth + textWidth > maxWidth && currentLineWidth > 0) {
                                currentY += currentLineHeight;
                                currentLineWidth = 0;
                            }
                            
                            ctx.fillText(emojiText, currentX + currentLineWidth, currentY);
                            currentLineWidth += textWidth;
                        }
                    }
                }
            } else {
                // Draw text segment
                const words = segment.text.split(' ');
                
                for (const word of words) {
                    const wordWidth = ctx.measureText(word + ' ').width;
                    
                    if (currentLineWidth + wordWidth > maxWidth && currentLineWidth > 0) {
                        currentY += currentLineHeight;
                        currentLineWidth = 0;
                    }
                    
                    ctx.fillText(word + ' ', currentX + currentLineWidth, currentY);
                    currentLineWidth += wordWidth;
                }
            }
        }
    }

    // Split text into segments with emojis
    splitTextWithEmojis(text, allEmojis) {
        const segments = [];
        let lastIndex = 0;
        
        // Sort emojis by position
        const sortedEmojis = allEmojis.sort((a, b) => a.start - b.start);
        
        for (const emoji of sortedEmojis) {
            // Add text before emoji
            if (emoji.start > lastIndex) {
                const textSegment = text.substring(lastIndex, emoji.start);
                if (textSegment) {
                    segments.push({ type: 'text', text: textSegment });
                }
            }
            
            // Add emoji
            segments.push({
                type: 'emoji',
                name: emoji.name,
                url: emoji.url,
                full: emoji.full,
                isUnicode: emoji.isUnicode
            });
            
            lastIndex = emoji.end;
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
        ctx.font = '14px Arial';
        ctx.fillText(processedLine, x, y);
    }

    // Draw images from attachments and URLs
    async drawImages(ctx, attachments, imageUrls, startX, startY, maxWidth, dpiScale = 1) {
        let currentY = startY;
        const maxImageWidth = Math.min(maxWidth, 800); // Larger images for better quality
        const maxImageHeight = 600; // Increased max height

        // Draw attachment images with optimized processing
        if (attachments && attachments.size > 0) {
            for (const attachment of attachments.values()) {
                if (attachment.contentType && attachment.contentType.startsWith('image/')) {
                    try {
                        // Load image directly without preprocessing to avoid quality loss
                        const img = await loadImage(attachment.url);
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
                        currentY += drawHeight + 20; // More spacing
                    } catch (error) {
                        console.warn('Failed to load attachment image:', error);
                    }
                }
            }
        }

        // Draw URL images (including Tenor GIFs) with optimized processing
        for (const imageUrl of imageUrls) {
            try {
                // Load image directly without preprocessing to avoid quality loss
                const img = await loadImage(imageUrl);
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
                currentY += drawHeight + 20; // More spacing
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
                
                // Debug logging for timestamps
                console.log('Slash command timestamp debug:', {
                    slashCommandTime: interaction.createdAt.toLocaleTimeString(),
                    targetMessageTime: targetMessage.createdAt.toLocaleTimeString(),
                    targetMessageTimestamp: targetMessage.createdTimestamp,
                    interactionTimestamp: interaction.createdTimestamp
                });
            } catch (fetchError) {
                await interaction.editReply("Could not find that message, sir. Make sure the message ID is correct and the message is in this channel.");
                return true;
            }
            
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
                targetMessage, // Pass the entire message object
                targetMessage.author,
                targetMessage.attachments
            );
            
            // Create attachment with WebP format for better quality
            const attachment = new AttachmentBuilder(imageBuffer, { name: 'clipped.webp' });
            
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

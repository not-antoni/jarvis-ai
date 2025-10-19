/**
 * Discord event handlers and command processing
 */

const { ChannelType, AttachmentBuilder, UserFlags, PermissionsBitField } = require('discord.js');
const JarvisAI = require('./jarvis-core');
const config = require('./config');
const braveSearch = require('./brave-search');
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
        // Enhanced Unicode emoji regex - covers more emoji ranges including newer ones
        const unicodeEmojiRegex = /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F900}-\u{1F9FF}]|[\u{1FA70}-\u{1FAFF}]|[\u{1F018}-\u{1F0FF}]|[\u{1F200}-\u{1F2FF}]|[\u{1F700}-\u{1F77F}]|[\u{1F780}-\u{1F7FF}]|[\u{1F800}-\u{1F8FF}]|[\u{1F000}-\u{1F02F}]|[\u{1F030}-\u{1F09F}]|[\u{1F0A0}-\u{1F0FF}]|[\u{1F100}-\u{1F1FF}]|[\u{1F200}-\u{1F2FF}]|[\u{1F300}-\u{1F5FF}]|[\u{1F600}-\u{1F64F}]|[\u{1F650}-\u{1F67F}]|[\u{1F680}-\u{1F6FF}]|[\u{1F700}-\u{1F77F}]|[\u{1F780}-\u{1F7FF}]|[\u{1F800}-\u{1F8FF}]|[\u{1F900}-\u{1F9FF}]|[\u{1FA00}-\u{1FA6F}]|[\u{1FA70}-\u{1FAFF}]|[\u{1FB00}-\u{1FBFF}]|[\u{1FC00}-\u{1FCFF}]|[\u{1FD00}-\u{1FDFF}]|[\u{1FE00}-\u{1FEFF}]|[\u{1FF00}-\u{1FFFF}]/gu;
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

    calculateTextHeight(text, maxWidth) {
        // Create a temporary canvas to measure text widths
        const tempCanvas = createCanvas(1, 1);
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.font = '14px Arial';

        // Remove fenced code blocks with optional language spec and keep only the
        // inner code content. Then remove any stray triple backticks. This
        // ensures code blocks do not interfere with height calculations.
        let processedText = text;
        processedText = processedText.replace(/```[^\n]*\n([\s\S]*?)```/g, '$1');
        processedText = processedText.replace(/```/g, '');

        // Split the processed text into tokens, preserving newlines and whitespace
        // as separate tokens. This allows us to handle wrapping at both spaces
        // and explicit newline boundaries. The regex captures newline characters
        // and runs of whitespace (spaces or tabs) as individual tokens.
        const tokens = processedText.split(/(\n|\s+)/);
        let lineCount = 0;
        let currentLineWidth = 0;

        for (const token of tokens) {
            if (token === '\n') {
                // Explicit newline: end the current line and start a new one
                lineCount++;
                currentLineWidth = 0;
                continue;
            }
            // Check if token is only whitespace (space or multiple spaces)
            if (/^\s+$/.test(token)) {
                // Process each space individually to wrap correctly
                for (const char of token) {
                    const charWidth = tempCtx.measureText(char).width;
                    if (currentLineWidth + charWidth > maxWidth && currentLineWidth > 0) {
                        lineCount++;
                        currentLineWidth = 0;
                    }
                    currentLineWidth += charWidth;
                }
                continue;
            }
            // Non-whitespace token: measure its width
            const tokenWidth = tempCtx.measureText(token).width;
            if (tokenWidth > maxWidth) {
                // Break long tokens (like URLs or unspaced code) into characters
                for (const char of token) {
                    const charWidth = tempCtx.measureText(char).width;
                    if (currentLineWidth + charWidth > maxWidth && currentLineWidth > 0) {
                        lineCount++;
                        currentLineWidth = 0;
                    }
                    currentLineWidth += charWidth;
                }
            } else {
                if (currentLineWidth + tokenWidth > maxWidth && currentLineWidth > 0) {
                    lineCount++;
                    currentLineWidth = 0;
                }
                currentLineWidth += tokenWidth;
            }
        }
        // Count the final line if any content was measured or if there were no tokens
        lineCount++;
        const baseHeight = 40; // Reserve space for username, timestamp, and gap
        const lineHeight = 20;
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

	async createClipImage(text, username, avatarUrl, isBot = false, roleColor = '#ff6b6b', guild = null, client = null, message = null, user = null, attachments = null, embeds = null) {
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
        // Collapse excess whitespace
        cleanedText = cleanedText.replace(/\s{2,}/g, ' ').trim();
    } catch (_) {}

    // Calculate dynamic canvas dimensions based on content
    const width = 800; // Increased width for better layout and positioning
    const minHeight = 120; // Minimum height for basic content

    // Calculate text height with emojis and formatting
    const textHeight = this.calculateTextHeight(cleanedText, width - 180); // Account for margins and avatar space

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
    ctx.textDrawingMode = 'path';

    // Pure black background
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, totalHeight);

    // Calculate centered positioning with more space for avatar and text
    const avatarSize = 40;
    const contentWidth = width - 80; // More margin
    const contentHeight = totalHeight - 20;
    const avatarX = 50; // Moved further to the right
    const avatarY = 20; // Top-aligned padding instead of vertical centering

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
    const textStartX = avatarX + avatarSize + 20; // Increased spacing
        const textStartY = avatarY + 2;
    const maxTextWidth = contentWidth - (avatarSize + 20) - 30; // More margin

    // Truncate username if too long to prevent timestamp overlap
    const truncatedUsername = this.truncateText(username, 20);

        // Draw username in role color
    ctx.fillStyle = roleColor;
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
    ctx.fillText(truncatedUsername, textStartX, textStartY);

    let currentX = textStartX + ctx.measureText(truncatedUsername).width + 4;

        // Draw app tag if it's a bot
        if (isBot) {
            const appTagWidth = 35;
            const appTagHeight = 16;
            
            // Draw verification badge if verified (to the left of APP tag)
            if (isVerified) {
                const badgeSize = 16;
                const badgeX = currentX;
                this.drawVerifiedBadge(ctx, badgeX, textStartY, badgeSize);
                currentX += badgeSize + 4;
            }
            
            // App tag background (Discord blue color)
            ctx.fillStyle = 'rgb(88, 101, 242)'; // Discord APP badge color
            ctx.fillRect(currentX, textStartY, appTagWidth, appTagHeight);
            
            // App tag text
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 10px Arial';
            ctx.fillText('APP', currentX + 2, textStartY + 2);
            
            currentX += appTagWidth + 4;
        }

    // Draw timestamp with dynamic formatting
    const timestamp = message ? this.parseDiscordTimestamp(message) : '6:39 PM';
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
    // Position the message content immediately below the username. The username
    // occupies approximately 14px of vertical space, so we add a 2px gap to
    // separate the text from the header. This mirrors the 2px gap between text
    // and images later on, keeping spacing consistent.
    const messageStartY = textStartY + 16;
    const mentions = await this.parseMentions(cleanedText, guild, client);
    await this.drawFormattedText(ctx, cleanedText, textStartX, messageStartY, maxTextWidth, allEmojis, formatting, mentions);

    // Draw images if present (main canvas has enough height already)
    if (hasImages || allImageUrls.length > 0) {
        // Compute the starting Y position for images. We subtract the base 40px
        // reserved in calculateTextHeight (for username/timestamp) from the
        // measured textHeight to get only the height of the rendered lines. Then
        // add a small 2px gap so images sit flush beneath the message text.
        const effectiveTextHeight = Math.max(0, textHeight - 40);
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
    async drawFormattedText(ctx, text, startX, startY, maxWidth, customEmojis, formatting, mentions = []) {
    ctx.fillStyle = '#ffffff';
        ctx.font = '14px Arial';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

        let currentY = startY;
        let currentX = startX;
        const lineHeight = 20;
        const emojiSize = 16;

        // Remove Discord formatting markers for cleaner display
        // We also strip fenced code blocks (triple backticks) so that the code
        // content is displayed without the surrounding fences or language spec.
        let processedText = text
            // Bold
            .replace(/\*\*(.*?)\*\*/g, '$1')
            // Italic using asterisks
            .replace(/(?<!\*)\*(?!\*)([^*]+)\*(?!\*)/g, '$1')
            // Italic using underscores
            .replace(/(?<!_)_(?!_)([^_]+)_(?!_)/g, '$1')
            // Strikethrough
            .replace(/~~(.*?)~~/g, '$1')
            // Underline
            .replace(/__(.*?)__/g, '$1')
            // Inline code (single backticks)
            .replace(/`([^`]+)`/g, '$1')
            // Fenced code blocks with optional language spec: remove the fences and
            // language line but keep the inner code. This pattern matches
            // ```lang\ncode\n```
            .replace(/```[^\n]*\n([\s\S]*?)```/g, '$1')
            // If any stray triple backticks remain, remove them
            .replace(/```/g, '');

        // Split text into segments (text, emojis, mentions)
        const segments = this.splitTextWithEmojisAndMentions(processedText, customEmojis, mentions);
        
        let currentLineWidth = 0;
        let currentLineHeight = lineHeight;

        for (const segment of segments) {
            if (segment.type === 'emoji') {
                if (segment.isUnicode) {
                    // Draw Unicode emoji as text with emoji-compatible font
                    const emojiText = segment.name;
                    
                    // Use a font that supports emojis better
                    ctx.font = '16px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Android Emoji", "EmojiSymbols", "EmojiOne Mozilla", "Twemoji Mozilla", "Segoe UI Symbol", sans-serif';
                    const textWidth = ctx.measureText(emojiText).width;
                    
                    if (currentLineWidth + textWidth > maxWidth && currentLineWidth > 0) {
                        currentY += currentLineHeight;
                        currentLineWidth = 0;
                    }
                    
                    ctx.fillText(emojiText, currentX + currentLineWidth, currentY);
                    currentLineWidth += textWidth;
                    
                    // Reset font back to normal text
                    ctx.font = '14px Arial';
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
            } else if (segment.type === 'mention') {
                // Render mentions in blue
                const mentionText = segment.text + ' ';
                const textWidth = ctx.measureText(mentionText).width;
                if (currentLineWidth + textWidth > maxWidth && currentLineWidth > 0) {
                    currentY += currentLineHeight;
                    currentLineWidth = 0;
                }
                const prevFill = ctx.fillStyle;
                ctx.fillStyle = '#8899ff';
                ctx.fillText(mentionText, currentX + currentLineWidth, currentY);
                ctx.fillStyle = prevFill;
                currentLineWidth += textWidth;
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
                segments.push({ type: 'emoji', name: emoji.name, url: emoji.url, full: emoji.full, isUnicode: emoji.isUnicode });
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
        ctx.font = '14px Arial';
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
                    message.author.id
                );
                await message.reply(response);
            } catch (error) {
                console.error("Help command error:", error);
                await message.reply("Unable to display help right now, sir.");
            }
            return true;
        }

        if (content.startsWith("!profile")) {
            try {
                await message.channel.sendTyping();
                const response = await this.jarvis.handleUtilityCommand(
                    rawContent.substring(1),
                    message.author.username,
                    message.author.id
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
                    message.author.id
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
                    message.author.id
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
                    message.author.id
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
                    message.author.id
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
                        this.setCooldown(message.author.id);
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
                    this.setCooldown(message.author.id);
                    return;
                } catch (error) {
                    console.error("Brave search error:", error);
                    await message.reply("Web search failed, sir. Technical difficulties.");
                    this.setCooldown(message.author.id);
                    return;
                }
            } else {
                await message.reply("Please provide a web search query after 'jarvis search', sir.");
                this.setCooldown(message.author.id);
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

        const ephemeralCommands = new Set(["help", "profile", "history", "recap"]);
        const shouldBeEphemeral = ephemeralCommands.has(interaction.commandName);

        try {
            await interaction.deferReply({ ephemeral: shouldBeEphemeral });
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
            } else if (interaction.commandName === "help") {
                response = await this.jarvis.handleUtilityCommand(
                    "help",
                    interaction.user.username,
                    interaction.user.id,
                    true,
                    interaction
                );
            } else if (interaction.commandName === "profile") {
                response = await this.jarvis.handleUtilityCommand(
                    "profile",
                    interaction.user.username,
                    interaction.user.id,
                    true,
                    interaction
                );
            } else if (interaction.commandName === "history") {
                response = await this.jarvis.handleUtilityCommand(
                    "history",
                    interaction.user.username,
                    interaction.user.id,
                    true,
                    interaction
                );
            } else if (interaction.commandName === "recap") {
                response = await this.jarvis.handleUtilityCommand(
                    "recap",
                    interaction.user.username,
                    interaction.user.id,
                    true,
                    interaction
                );
            } else if (interaction.commandName === "encode") {
                response = await this.jarvis.handleUtilityCommand(
                    "encode",
                    interaction.user.username,
                    interaction.user.id,
                    true,
                    interaction
                );
            } else if (interaction.commandName === "decode") {
                response = await this.jarvis.handleUtilityCommand(
                    "decode",
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

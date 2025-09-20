/**
 * Discord event handlers and command processing
 */

const { ChannelType } = require('discord.js');
const JarvisAI = require('./jarvis-core');
const config = require('./config');

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

    async getContextualMemory(message, client) {
        try {
            // Get recent messages in the channel to build context
            const messages = await message.channel.messages.fetch({ limit: 20 });
            const sortedMessages = messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
            
            // Find the conversation thread starting from the referenced message
            const referencedMessageId = message.reference.messageId;
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
                return null; // Couldn't find the referenced message
            }
            
            // Build contextual conversation from the thread
            const contextualMessages = [];
            const threadMessages = Array.from(sortedMessages.values()).slice(conversationStart);
            
            // If the referenced message is from Jarvis, include it in context
            if (referencedMessage.author.id === client.user.id) {
                contextualMessages.push({
                    role: "assistant",
                    content: referencedMessage.content,
                    timestamp: referencedMessage.createdTimestamp
                });
            } else {
                // If replying to a user message, include that user's message as context
                contextualMessages.push({
                    role: "user",
                    content: referencedMessage.content,
                    username: referencedMessage.author.username,
                    timestamp: referencedMessage.createdTimestamp,
                    isReferencedMessage: true
                });
            }
            
            // Add subsequent messages in the thread
            for (const msg of threadMessages) {
                if (msg.id === referencedMessageId) continue; // Skip the referenced message (already added)
                
                if (msg.author.bot && msg.author.id === client.user.id) {
                    // This is a Jarvis message
                    contextualMessages.push({
                        role: "assistant",
                        content: msg.content,
                        timestamp: msg.createdTimestamp
                    });
                } else if (!msg.author.bot) {
                    // This is a user message
                    contextualMessages.push({
                        role: "user",
                        content: msg.content,
                        username: msg.author.username,
                        timestamp: msg.createdTimestamp
                    });
                }
            }
            
            // Limit to last 10 messages to avoid token limits
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
        if (message.author.id === client.user.id || message.author.bot) return;

        const userId = message.author.id;
        
        if (this.isOnCooldown(userId)) {
            return;
        }

        // Handle admin commands
        if (await this.handleAdminCommands(message)) {
            this.setCooldown(userId);
            return;
        }

        // Handle utility commands
        if (await this.handleUtilityCommands(message)) {
            this.setCooldown(userId);
            return;
        }

        // Handle regular Jarvis interactions
        await this.handleJarvisInteraction(message, client);
    }

    async handleAdminCommands(message) {
        const content = message.content.trim().toLowerCase();
        
        if (content === "!cleardbsecret") {
            if (message.author.id !== config.admin.userId) {
                return false; // Ignore if not admin
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
            // Check if whitelisted channel is set and if current channel matches
            const whitelistedChannelId = config.commands.whitelistedChannelId;
            if (whitelistedChannelId === '0' || message.channel.id !== whitelistedChannelId) {
                return true; // Don't respond - command won't work
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
        
        // Check if this is a reply to any message (Jarvis or user)
        let isReplyToJarvis = false;
        let isReplyToUser = false;
        let contextualMemory = null;
        
        if (message.reference && message.reference.messageId) {
            try {
                const referencedMessage = await message.channel.messages.fetch(message.reference.messageId);
                if (referencedMessage.author.id === client.user.id) {
                    isReplyToJarvis = true;
                    // Get contextual memory from the conversation thread
                    contextualMemory = await this.getContextualMemory(message, client);
                } else if (!referencedMessage.author.bot) {
                    // This is a reply to a user message
                    isReplyToUser = true;
                    // Check if the reply mentions Jarvis or contains wake words
                    if (isMentioned || containsJarvis) {
                        // Get contextual memory from the conversation thread
                        contextualMemory = await this.getContextualMemory(message, client);
                    }
                }
            } catch (error) {
                console.warn("Failed to fetch referenced message:", error);
            }
        }

        // Respond if: DM, mentioned, contains wake word, replying to Jarvis, or replying to user with mention/wake word
        if (!isDM && !isMentioned && !containsJarvis && !isReplyToJarvis && !(isReplyToUser && (isMentioned || containsJarvis))) {
            return;
        }

        let cleanContent = message.content
            .replace(/<@!?\d+>/g, "") // strip mentions only
            .trim();

        // If content is empty, treat as a greeting
        if (!cleanContent) {
            cleanContent = "jarvis";
        } else {
            // Check if content is ONLY a wake word followed by punctuation (no actual content)
            const wakeWordPattern = new RegExp(`^(${config.wakeWords.join('|')})[,.!?]*$`, 'i');
            if (wakeWordPattern.test(cleanContent)) {
                cleanContent = "jarvis";
            }
            // If it has a wake word + comma + space + actual content, keep it as is
        }

        try {
            await message.channel.sendTyping();
        } catch (err) {
            console.warn("Failed to send typing (permissions?):", err);
        }

        // Check input length
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

        // Truncate if too long
        if (cleanContent.length > config.ai.maxInputLength) {
            cleanContent = cleanContent.substring(0, config.ai.maxInputLength) + "...";
        }

        try {
            // Check for utility commands first
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
                this.setCooldown(message.author.id);
                return;
            }

            // Generate AI response with contextual memory if replying to Jarvis
            const response = await this.jarvis.generateResponse(message, cleanContent, false, contextualMemory);
            
            if (typeof response === "string" && response.trim()) {
                await message.reply(response);
            } else {
                await message.reply("Response circuits tangled, sir. Clarify your request?");
            }
            
            this.setCooldown(message.author.id);
        } catch (error) {
            console.error("Error processing message:", error);
            try {
                await message.reply("Technical difficulties, sir. One moment, please.");
            } catch (err) {
                console.error("Failed to send error reply:", err);
            }
            this.setCooldown(message.author.id);
        }
    }

    async handleSlashCommand(interaction) {
        const userId = interaction.user.id;
        
        if (this.isOnCooldown(userId)) {
            return;
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

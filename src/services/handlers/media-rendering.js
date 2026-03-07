'use strict';

const { AttachmentBuilder } = require('discord.js');

async function handleClipCommand(handler, message, client) {
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
        repliedMessageContent: `${repliedMessage.content.substring(0, 50)  }...`,
        // Check message age
        messageAge: Date.now() - repliedMessage.createdTimestamp
    });
    
    // Check if message contains images or emojis - if so, don't respond
    if (handler.hasImagesOrEmojis(repliedMessage)) {
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
            roleColor = handler.getUserRoleColor(repliedMessage.member);
        }
    } catch (error) {
        console.warn('Failed to get role color for text command:', error);
    }
    
    // Get display name (sanitized for rendering)
    const displayName = handler.getSafeDisplayName(repliedMessage.member, repliedMessage.author);
    
    const imageBuffer = await handler.createClipImage(
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

module.exports = {
    handleClipCommand
};

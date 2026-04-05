'use strict';

const { AttachmentBuilder } = require('discord.js');

async function handleClipCommand(handler, message, client) {
    const content = message.content.trim().toLowerCase();
    if (!content.startsWith('jarvis clip')) {
        return false;
    }

    if (!message.reference || !message.reference.messageId) {
        return true;
    }

    try {
        const repliedMessage = await message.channel.messages.fetch(message.reference.messageId);

        const avatarUrl = repliedMessage.member?.avatarURL({
            extension: 'png',
            size: 128,
            forceStatic: false
        }) || repliedMessage.author.displayAvatarURL({
            extension: 'png',
            size: 128,
            forceStatic: false
        });

        let roleColor = '#f2f3f5';
        try {
            if (message.guild && repliedMessage.member) {
                roleColor = handler.getUserRoleColor(repliedMessage.member);
            }
        } catch (error) {
            console.warn('Failed to get role color for text command:', error);
        }

        const displayName = handler.getSafeDisplayName(repliedMessage.member, repliedMessage.author);

        const imageBuffer = await handler.createClipImage(
            repliedMessage.content,
            displayName,
            avatarUrl,
            repliedMessage.author.bot,
            roleColor,
            message.guild,
            client,
            repliedMessage,
            repliedMessage.author,
            repliedMessage.attachments,
            repliedMessage.embeds
        );

        const attachment = new AttachmentBuilder(imageBuffer, { name: 'clipped.png' });
        await message.reply({
            content: 'clipped, sir.',
            files: [attachment]
        });

        return true;
    } catch (error) {
        console.error('Error handling clip command:', error);
        return true;
    }
}

module.exports = {
    handleClipCommand
};

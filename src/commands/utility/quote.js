const { ContextMenuCommandBuilder, ApplicationCommandType, AttachmentBuilder, ApplicationIntegrationType, InteractionContextType } = require('discord.js');
const { generateQuoteImage } = require('../../utils/quote-generator');
const { renderEmbedsToBuffer } = require('../../services/handlers/clip-rendering');
const { resolveDiscordRichText } = require('../../utils/discord-rich-text');

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function resolveMentions(text, interaction, message = null) {
    return resolveDiscordRichText(text, {
        guild: interaction.guild,
        client: interaction.client,
        mentions: message?.mentions,
        style: true
    });
}

const quoteContext = {
    data: new ContextMenuCommandBuilder()
        .setName('Make it a Quote')
        .setType(ApplicationCommandType.Message)
        .setIntegrationTypes([
            ApplicationIntegrationType.GuildInstall,
            ApplicationIntegrationType.UserInstall
        ])
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    async execute(interaction) {
        const message = interaction.targetMessage;
        if (!message) {
            await interaction.editReply('❌ Could not fetch message.');
            return;
        }

        // Use raw content to preserve custom emoji format <:name:id>
        // cleanContent strips the emoji ID, breaking server emoji rendering
        const { content } = message;
        const { author } = message;

        let attachmentUrl = null;
        const urlsToStrip = [];

        // 1. Check Attachments
        const attachment = message.attachments.find(a => a.contentType && a.contentType.startsWith('image/'));
        if (attachment) {
            attachmentUrl = attachment.url;
            urlsToStrip.push(attachment.url);
        }

        // 2. Check Embeds
        if (!attachmentUrl && message.embeds.length > 0) {
            const embed = message.embeds[0];
            if (embed.thumbnail && embed.thumbnail.url) {
                attachmentUrl = embed.thumbnail.url;
            } else if (embed.image && embed.image.url) {
                attachmentUrl = embed.image.url;
            }
            // Track the embed URL (Page URL) to strip it too
            if (attachmentUrl && embed.url) {
                urlsToStrip.push(embed.url);
            }
        }

        let text = await resolveMentions(content || '', interaction, message);

        // Remove attachment URL from text if present
        if (attachmentUrl) {
            for (const url of urlsToStrip) {
                text = text.replace(url, '');
            }
            if (/^https?:\/\/[^\s]+$/.test(text.trim())) {
                text = '';
            }
            try {
                const match = attachmentUrl.match(/\/(\d+)\/([^/?]+)/);
                if (match) {
                    const id = match[1];
                    const filename = match[2];
                    const fuzzyRegex = new RegExp(`https?:\\/\\/[^\\s]*${id}\\/${escapeRegExp(filename)}[^\\s]*`, 'g');
                    text = text.replace(fuzzyRegex, '');
                }
            } catch (e) {
                console.warn('Fuzzy strip failed', e);
            }
            text = text.trim();
        }

        // Render embeds as a visual image block (if no attachment image already)
        let embedImageBuffer = null;
        if (!attachmentUrl && message.embeds.length > 0) {
            try {
                embedImageBuffer = await renderEmbedsToBuffer(message.embeds);
            } catch (e) {
                console.warn('Embed rendering for quote failed:', e.message);
            }
        }

        // Only extract embed text as fallback if we couldn't render the embed as an image
        if (!text.trim() && !embedImageBuffer && message.embeds.length > 0) {
            const parts = [];
            for (const embed of message.embeds) {
                if (embed.author?.name) {parts.push(embed.author.name);}
                if (embed.title) {parts.push(embed.title);}
                if (embed.description) {parts.push(embed.description);}
                if (embed.fields?.length) {
                    for (const field of embed.fields) {
                        if (field.name) {parts.push(field.name);}
                        if (field.value) {parts.push(field.value);}
                    }
                }
                if (embed.footer?.text) {parts.push(embed.footer.text);}
            }
            text = parts.join('\n');
        }

        if (!text && !attachmentUrl && !embedImageBuffer) {
            await interaction.editReply('❌ Message has no content or image to quote.');
            return;
        }

        try {
            const avatarUrl = author.displayAvatarURL({ extension: 'png', size: 256 });
            const buffer = await generateQuoteImage(
                text,
                author.displayName || author.username,
                avatarUrl,
                message.createdAt,
                attachmentUrl,
                author.username,
                embedImageBuffer
            );

            const attachmentFile = new AttachmentBuilder(buffer, { name: 'quote.gif' });
            await interaction.editReply({ files: [attachmentFile] });

        } catch (error) {
            console.error('Quote generation failed:', error);
            await interaction.editReply('❌ Failed to generate quote image.');
        }
    }
};

module.exports = [quoteContext];

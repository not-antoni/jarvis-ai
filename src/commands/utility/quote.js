const { SlashCommandBuilder, ContextMenuCommandBuilder, ApplicationCommandType, AttachmentBuilder, ApplicationIntegrationType, InteractionContextType } = require('discord.js');
const { generateQuoteImage } = require('../../utils/quote-generator');

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function resolveMentions(text, interaction) {
    if (!text) return text;

    // Resolve User Mentions <@ID> or <@!ID>
    const userRegex = /<@!?(\d+)>/g;
    const matches = [...text.matchAll(userRegex)];

    for (const match of matches) {
        const full = match[0];
        const id = match[1];
        try {
            let name = null;
            if (interaction.guild) {
                try {
                    const member = await interaction.guild.members.fetch(id);
                    name = member.displayName;
                } catch {
                    // Member not in guild?
                }
            }
            if (!name) {
                const user = await interaction.client.users.fetch(id);
                name = user.displayName || user.username;
            }
            // Replace all instances of this mention string
            text = text.split(full).join(`@${name}`);
        } catch (e) {
            // Ignore fetch failures
        }
    }
    return text;
}

const quoteSlash = {
    data: new SlashCommandBuilder()
        .setName('quote')
        .setDescription('Generate a fake quote image')
        .setIntegrationTypes([
            ApplicationIntegrationType.GuildInstall,
            ApplicationIntegrationType.UserInstall
        ])
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ])
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to quote (defaults to you)')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('text')
                .setDescription('The text to quote')
                .setRequired(false))
        .addAttachmentOption(option =>
            option.setName('image')
                .setDescription('Attach an image or gif')
                .setRequired(false)),
    async execute(interaction) {
        let targetUser = interaction.options.getUser('user') || interaction.user;
        let rawText = interaction.options.getString('text');

        let text = await resolveMentions(rawText, interaction);

        const attachment = interaction.options.getAttachment('image');

        let attachmentUrl = attachment ? attachment.url : null;

        if (!text && !attachmentUrl) {
            await interaction.editReply('⚠️ Please provide text or an image to quote, sir.');
            return;
        }

        try {
            const avatarUrl = targetUser.displayAvatarURL({ extension: 'png', size: 256 });
            const buffer = await generateQuoteImage(
                text || '',
                targetUser.displayName || targetUser.username,
                avatarUrl,
                new Date(),
                attachmentUrl
            );

            const attachmentFile = new AttachmentBuilder(buffer, { name: 'quote.gif' });
            await interaction.editReply({ files: [attachmentFile] });

        } catch (error) {
            console.error('Quote generation failed:', error);
            await interaction.editReply('❌ Failed to generate quote image.');
        }
    }
};

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

        // Use cleanContent to resolve mentions automatically
        const content = message.cleanContent || message.content;
        const author = message.author;

        let attachmentUrl = null;
        let urlsToStrip = [];

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

        let text = content || '';

        // Remove attachment URL from text if present (Fuzzy match for cdn/media mismatch)
        if (attachmentUrl) {
            // Strip exact matches (CDN link, Page link)
            for (const url of urlsToStrip) {
                text = text.replace(url, '');
            }

            // If the text is JUST a URL (any URL) and we have an image, it's likely the source. Clean it.
            if (/^https?:\/\/[^\s]+$/.test(text.trim())) {
                text = '';
            }

            // Fuzzy remove for Discord CDN
            try {
                const match = attachmentUrl.match(/\/(\d+)\/([^/?]+)/);
                if (match) {
                    const id = match[1];
                    const filename = match[2];
                    const fuzzyRegex = new RegExp(`https?:\\/\\/[^\\s]*${id}\\/${escapeRegExp(filename)}[^\\s]*`, 'g');
                    text = text.replace(fuzzyRegex, '');
                }
            } catch (e) {
                console.warn("Fuzzy strip failed", e);
            }

            text = text.trim();
        }

        if (!text && !attachmentUrl) {
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
                attachmentUrl
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

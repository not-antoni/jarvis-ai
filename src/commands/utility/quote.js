const { SlashCommandBuilder, ContextMenuCommandBuilder, ApplicationCommandType, AttachmentBuilder } = require('discord.js');
const { generateQuoteImage } = require('../../utils/quote-generator');

const quoteSlash = {
    data: new SlashCommandBuilder()
        .setName('quote')
        .setDescription('Generate a fake quote image')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to quote (defaults to you)')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('text')
                .setDescription('The text to quote')
                .setRequired(false)),
    async execute(interaction) {


        let targetUser = interaction.options.getUser('user') || interaction.user;
        let text = interaction.options.getString('text');

        // If no text provided, try to fetch last message? No, that's complex.
        // Just require text if not replying.
        // But user might want to quote themselves.

        if (!text) {
            await interaction.editReply('⚠️ Please provide the text to quote, sir.');
            return;
        }

        try {
            const avatarUrl = targetUser.displayAvatarURL({ extension: 'png', size: 256 });
            const buffer = await generateQuoteImage(
                text,
                targetUser.displayName || targetUser.username,
                avatarUrl,
                new Date()
            );

            const attachment = new AttachmentBuilder(buffer, { name: 'quote.jpg' });
            await interaction.editReply({ files: [attachment] });

        } catch (error) {
            console.error('Quote generation failed:', error);
            await interaction.editReply('❌ Failed to generate quote image.');
        }
    }
};

const quoteContext = {
    data: new ContextMenuCommandBuilder()
        .setName('Make it a Quote')
        .setType(ApplicationCommandType.Message),
    async execute(interaction) {


        const message = interaction.targetMessage;
        if (!message) {
            await interaction.editReply('❌ Could not fetch message.');
            return;
        }

        const content = message.content;
        const author = message.author;

        if (!content && message.attachments.size === 0) {
            await interaction.editReply('❌ Message has no content to quote.');
            return;
        }

        // prioritized text, fallback to "Sent an image" if only attachment
        const text = content || (message.attachments.size > 0 ? '[Sent an image]' : '[Empty message]');

        try {
            const avatarUrl = author.displayAvatarURL({ extension: 'png', size: 256 });
            const buffer = await generateQuoteImage(
                text,
                author.displayName || author.username,
                avatarUrl,
                message.createdAt
            );

            const attachment = new AttachmentBuilder(buffer, { name: 'quote.jpg' });
            await interaction.editReply({ files: [attachment] });

        } catch (error) {
            console.error('Quote generation failed:', error);
            await interaction.editReply('❌ Failed to generate quote image.');
        }
    }
};

module.exports = [quoteSlash, quoteContext];

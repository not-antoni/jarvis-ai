const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    PermissionFlagsBits,
    AttachmentBuilder
} = require('discord.js');

class TicketSystem {
    constructor() {
        this.ticketCategoryId = null; // Could vary per server, but for now we might create one
    }

    /**
     * Setup the ticket panel in a channel
     */
    async setup(channel) {
        const embed = new EmbedBuilder()
            .setTitle('📩 Support Tickets')
            .setDescription('Need help? Click the button below to open a private ticket with the staff.')
            .setColor('#0099ff')
            .setFooter({ text: 'Jarvis Support System' });

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('ticket_create')
                    .setLabel('Open Ticket')
                    .setEmoji('📩')
                    .setStyle(ButtonStyle.Primary)
            );

        await channel.send({ embeds: [embed], components: [row] });
    }

    /**
     * Handle interactions (buttons)
     */
    async handleInteraction(interaction) {
        if (!interaction.isButton()) return;

        const { customId, guild, user, channel } = interaction;

        if (customId === 'ticket_create') {
            await this.createTicket(interaction);
        } else if (customId === 'ticket_close') {
            await this.closeTicket(interaction);
        } else if (customId === 'ticket_transcript') {
            // Optional: manually request transcript
        }
    }

    async createTicket(interaction) {
        const { guild, user } = interaction;

        // Check if user already has a ticket? (Simplified: No check for now)

        await interaction.reply({ content: '⏳ Creating your ticket...', ephemeral: true });

        try {
            // Find or Create 'Tickets' category
            let category = guild.channels.cache.find(c => c.name === 'Tickets' && c.type === ChannelType.GuildCategory);
            if (!category) {
                category = await guild.channels.create({
                    name: 'Tickets',
                    type: ChannelType.GuildCategory
                });
            }

            const ticketChannel = await guild.channels.create({
                name: `ticket-${user.username}`,
                type: ChannelType.GuildText,
                parent: category.id,
                permissionOverwrites: [
                    {
                        id: guild.id,
                        deny: [PermissionFlagsBits.ViewChannel],
                    },
                    {
                        id: user.id,
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles],
                    },
                    {
                        // Allow bot
                        id: interaction.client.user.id,
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels],
                    }
                ]
            });

            const embed = new EmbedBuilder()
                .setTitle(`Ticket: ${user.username}`)
                .setDescription(`Hello ${user}! Support will be with you shortly.\nClick 🔒 to close this ticket.`)
                .setColor('#00ff00');

            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('ticket_close')
                        .setLabel('Close Ticket')
                        .setEmoji('🔒')
                        .setStyle(ButtonStyle.Danger)
                );

            await ticketChannel.send({ content: `${user}`, embeds: [embed], components: [row] });

            await interaction.editReply({ content: `✅ Ticket created: ${ticketChannel}`, ephemeral: true });

        } catch (error) {
            console.error('Ticket Creation Error:', error);
            await interaction.editReply({ content: '❌ Failed to create ticket.', ephemeral: true });
        }
    }

    async closeTicket(interaction) {
        const { channel } = interaction;

        await interaction.reply({ content: '🔒 Closing ticket in 5 seconds...', ephemeral: false });

        // Save Transcript (Simplified: just messages)
        // ... (Transcript logic would go here, maybe too complex for MVP, skipping text file generation for now)

        setTimeout(async () => {
            try {
                await channel.delete();
            } catch (error) {
                // Channel might handle been deleted manually
            }
        }, 5000);
    }
}

module.exports = new TicketSystem();

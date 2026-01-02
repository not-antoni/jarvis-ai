const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const ticketSystem = require('../../services/ticket-system');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ticket')
        .setDescription('Manage ticket system')
        .addSubcommand(sub =>
            sub.setName('setup')
                .setDescription('Setup the ticket panel in this channel'))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    async execute(interaction) {
        if (interaction.options.getSubcommand() === 'setup') {
            await interaction.reply({ content: 'Setting up ticket panel...', ephemeral: true });
            await ticketSystem.setup(interaction.channel);
            await interaction.followUp({ content: '✅ Panel created.', ephemeral: true });
        }
    }
};

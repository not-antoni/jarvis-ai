const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const giveawayService = require('../../services/giveaways');
const ms = require('ms');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('giveaway')
        .setDescription('Manage giveaways')
        .addSubcommand(subcommand =>
            subcommand
                .setName('start')
                .setDescription('Start a new giveaway')
                .addStringOption(option =>
                    option.setName('duration')
                        .setDescription('Duration (e.g. 1m, 1h, 1d)')
                        .setRequired(true))
                .addIntegerOption(option =>
                    option.setName('winners')
                        .setDescription('Number of winners')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('prize')
                        .setDescription('Prize to win')
                        .setRequired(true))
                .addChannelOption(option =>
                    option.setName('channel')
                        .setDescription('Channel to post the giveaway in (default: current)')))
        .addSubcommand(subcommand =>
            subcommand
                .setName('end')
                .setDescription('End a giveaway')
                .addStringOption(option =>
                    option.setName('message_id')
                        .setDescription('Message ID of the giveaway')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('reroll')
                .setDescription('Reroll a giveaway')
                .addStringOption(option =>
                    option.setName('message_id')
                        .setDescription('Message ID of the giveaway')
                        .setRequired(true)))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageEvents), // Approx suitable permission
    async execute(interaction) {
        const manager = giveawayService.getManager();
        if (!manager) {
            return interaction.reply({ content: '❌ Giveaway system not initialized.', ephemeral: true });
        }

        const sub = interaction.options.getSubcommand();

        if (sub === 'start') {
            const duration = interaction.options.getString('duration');
            const winnerCount = interaction.options.getInteger('winners');
            const prize = interaction.options.getString('prize');
            const channel = interaction.options.getChannel('channel') || interaction.channel;

            const durationMs = ms(duration);
            if (!durationMs) {
                return interaction.reply({ content: '❌ Invalid duration format. Try `1h`, `30m`, `1d`.', ephemeral: true });
            }

            await interaction.reply({ content: `🎉 Starting giveaway in ${channel}...`, ephemeral: true });

            manager.start(channel, {
                duration: durationMs,
                winnerCount,
                prize,
                messages: {
                    giveaway: '🎉 **GIVEAWAY** 🎉',
                    giveawayEnded: '🎉 **GIVEAWAY ENDED** 🎉',
                    drawing: 'Drawing: {timestamp}',
                    dropMessage: 'Be the first to react with 🎉 !',
                    inviteToParticipate: 'React with 🎉 to participate!',
                    winMessage: 'Congratulations, {winners}! You won **{prize}**!',
                    embedFooter: '{this.winnerCount} winner(s)',
                    noWinner: 'Giveaway cancelled, no valid participations.',
                    hostedBy: 'Hosted by: {this.hostedBy}',
                    winners: 'Winner(s):',
                    endedAt: 'Ended at'
                }
            });

        } else if (sub === 'end') {
            const messageId = interaction.options.getString('message_id');
            try {
                await manager.end(messageId);
                await interaction.reply({ content: 'Success! Giveaway ended.', ephemeral: true });
            } catch (err) {
                await interaction.reply({ content: `❌ An error occurred: ${err}`, ephemeral: true });
            }
        } else if (sub === 'reroll') {
            const messageId = interaction.options.getString('message_id');
            try {
                await manager.reroll(messageId);
                await interaction.reply({ content: 'Success! Giveaway rerolled.', ephemeral: true });
            } catch (err) {
                await interaction.reply({ content: `❌ An error occurred: ${err}`, ephemeral: true });
            }
        }
    }
};

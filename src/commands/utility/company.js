const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('company')
        .setDescription('Manage your companies in the Stark Economy')
        .addSubcommand(sub =>
            sub.setName('buy')
                .setDescription('Purchase a new company')
                .addStringOption(opt =>
                    opt.setName('type')
                        .setDescription('Type of company to buy')
                        .setRequired(true)
                        .addChoices(
                            { name: '🍔 Fast Food Place (Basic)', value: 'fastfood' },
                            { name: '☕ Coffee Shop (Basic)', value: 'coffeeshop' },
                            { name: '🍕 Pizzeria (Basic)', value: 'pizzeria' },
                            { name: '💻 Tech Startup (Small)', value: 'techstartup' },
                            { name: '👗 Boutique Store (Small)', value: 'boutique' },
                            { name: '💪 Fitness Gym (Small)', value: 'gym' },
                            { name: '🏭 Manufacturing Factory (Large)', value: 'factory' },
                            { name: '🏨 Hotel Chain (Large)', value: 'hotel' },
                            { name: '🛒 Shopping Mall (Large)', value: 'shoppingmall' },
                            { name: '📺 Media Empire (Mega)', value: 'mediaempire' },
                            { name: '🚀 Space Corporation (Mega)', value: 'spacecorp' },
                            { name: '🎰 Casino Resort (Mega)', value: 'casino' }
                        ))
                .addStringOption(opt =>
                    opt.setName('id')
                        .setDescription('4-digit ID for your company (0000-9999)')
                        .setRequired(true)
                        .setMinLength(4)
                        .setMaxLength(4)))
        .addSubcommand(sub =>
            sub.setName('list')
                .setDescription('View all your companies'))
        .addSubcommand(sub =>
            sub.setName('types')
                .setDescription('View all available company types'))
        .addSubcommand(sub =>
            sub.setName('lookup')
                .setDescription('Lookup companies by username')
                .addStringOption(opt =>
                    opt.setName('username')
                        .setDescription('Username to search for')
                        .setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('lookupcomp')
                .setDescription('View detailed stats of a company')
                .addStringOption(opt =>
                    opt.setName('id')
                        .setDescription('Full company ID (e.g., username_type_1234)')
                        .setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('rush')
                .setDescription('Rush next profit (30min earlier, +risk)')
                .addStringOption(opt =>
                    opt.setName('id')
                        .setDescription('Company ID')
                        .setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('slow')
                .setDescription('Skip next profit payment (-risk)')
                .addStringOption(opt =>
                    opt.setName('id')
                        .setDescription('Company ID')
                        .setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('clean')
                .setDescription('Clean company reputation (-5% risk)')
                .addStringOption(opt =>
                    opt.setName('id')
                        .setDescription('Company ID')
                        .setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('togglesabotage')
                .setDescription('Enable/disable sabotage mode')
                .addStringOption(opt =>
                    opt.setName('id')
                        .setDescription('Company ID')
                        .setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('spreaddirt')
                .setDescription('Spread dirt on a company (+5% risk)')
                .addStringOption(opt =>
                    opt.setName('id')
                        .setDescription('Target company ID')
                        .setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('resetprofit')
                .setDescription('Reset profit % (only when under 5%)')
                .addStringOption(opt =>
                    opt.setName('id')
                        .setDescription('Company ID')
                        .setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('edit')
                .setDescription('Edit your company details')
                .addStringOption(opt =>
                    opt.setName('id')
                        .setDescription('Company ID')
                        .setRequired(true))
                .addStringOption(opt =>
                    opt.setName('description')
                        .setDescription('New description for the company')
                        .setRequired(false))
                .addStringOption(opt =>
                    opt.setName('name')
                        .setDescription('New display name (custom companies only)')
                        .setRequired(false))
                .addAttachmentOption(opt =>
                    opt.setName('image')
                        .setDescription('New company image')
                        .setRequired(false)))
        .addSubcommand(sub =>
            sub.setName('delete')
                .setDescription('Delete one of your companies')
                .addStringOption(opt =>
                    opt.setName('id')
                        .setDescription('Company ID to delete')
                        .setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('create')
                .setDescription('Create a custom Ultra-tier company')
                .addStringOption(opt =>
                    opt.setName('name')
                        .setDescription('Custom company name (3-30 characters)')
                        .setRequired(true))
                .addStringOption(opt =>
                    opt.setName('id')
                        .setDescription('4-digit ID for your company (0000-9999)')
                        .setRequired(true)
                        .setMinLength(4)
                        .setMaxLength(4))),

    async execute(interaction) {
        // Handler is in part-05.js
        // This file just registers the command
    }
};

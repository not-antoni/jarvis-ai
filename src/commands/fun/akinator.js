const { SlashCommandBuilder } = require('discord.js');
const akinator = require('discord.js-akinator');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('akinator')
        .setDescription('Play a game of Akinator!')
        .addStringOption(option =>
            option.setName('language')
                .setDescription('The language to play in (default: en)')
                .setRequired(false)
                .addChoices(
                    { name: 'English', value: 'en' },
                    { name: 'Spanish', value: 'es' },
                    { name: 'French', value: 'fr' },
                    { name: 'German', value: 'de' },
                    { name: 'Italian', value: 'it' },
                    { name: 'Portuguese', value: 'pt' },
                    { name: 'Russian', value: 'ru' },
                    { name: 'Japanese', value: 'jp' }
                ))
        .addBooleanOption(option =>
            option.setName('child_mode')
                .setDescription('Enable child mode (SFW)? (default: true)')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('game_type')
                .setDescription('What kind of game? (default: character)')
                .setRequired(false)
                .addChoices(
                    { name: 'Character', value: 'character' },
                    { name: 'Animal', value: 'animal' },
                    { name: 'Object', value: 'object' }
                )),
    async execute(interaction) {
        // Defer reply not needed as the library handles it or we call it
        // The library usually needs the interaction object.

        const language = interaction.options.getString('language') || 'en';
        const childMode = interaction.options.getBoolean('child_mode') ?? true;
        const gameType = interaction.options.getString('game_type') || 'character';

        try {
            await akinator(interaction, {
                language: language,
                childMode: childMode,
                gameType: gameType,
                useButtons: true,
                embedColor: '#FF0000'
            });
        } catch (error) {
            console.error('Akinator Error:', error);
            // If the library explicitly fails before replying
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: '❌ An error occurred while starting Akinator.', ephemeral: true });
            }
        }
    }
};

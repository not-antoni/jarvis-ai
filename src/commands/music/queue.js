const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const distube = require('../../services/distube');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('queue')
        .setDescription('Show current music queue'),
    async execute(interaction) {
        if (!interaction.guild) return;
        const queue = distube.get().getQueue(interaction.guild);

        if (!queue) {
            await interaction.reply({ content: '⚠️ Queue is empty, sir.', ephemeral: true });
            return;
        }

        const q = queue.songs
            .map((song, i) => {
                // For uploaded files, use the probed duration from metadata
                const duration = (song.source === 'direct_link' && song.metadata?.formattedDuration)
                    ? song.metadata.formattedDuration
                    : song.formattedDuration;
                return `${i === 0 ? 'Playing:' : `${i}.`} ${song.name} - \`${duration}\``;
            })
            .join('\n');

        const embed = new EmbedBuilder()
            .setTitle('Current Queue')
            .setDescription(q.substring(0, 4000)) // Limit length
            .setColor('#0099ff');

        await interaction.reply({ embeds: [embed] });
    }
};

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { musicManager } = require('../../core/musicManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('queue')
        .setDescription('Show current music queue'),
    async execute(interaction) {
        if (!interaction.guild) {return;}

        const manager = musicManager.get();
        const view = manager.getQueueView(interaction.guildId);

        if (!view || (!view.current && view.queue.length === 0 && !view.pendingVideoId)) {
            await interaction.reply({ content: '⚠️ Queue is empty, sir.', flags: 64 });
            return;
        }

        const lines = [];
        if (view.current) {
            const duration = view.current.duration ? ` - \`${view.current.duration}\`` : '';
            lines.push(`Playing: ${view.current.title}${duration}`);
        } else if (view.pendingVideoId) {
            lines.push('Playing: *(loading track...)*');
        }

        if (view.queue.length > 0) {
            for (let i = 0; i < view.queue.length; i++) {
                const track = view.queue[i];
                const duration = track.duration ? ` - \`${track.duration}\`` : '';
                lines.push(`${i + 1}. ${track.title}${duration}`);
            }
        }

        lines.push('');
        lines.push(`Loop: **${view.loopMode}**`);

        const embed = new EmbedBuilder()
            .setTitle('Current Queue')
            .setDescription(lines.join('\n').substring(0, 4000))
            .setColor('#0099ff');

        await interaction.reply({ embeds: [embed], flags: 64 });
    }
};

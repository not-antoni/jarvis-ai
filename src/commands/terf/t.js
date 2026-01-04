const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const terfWiki = require('../../services/terf-wiki');

// Guild lock - only respond in this server
const ALLOWED_GUILD = '858444090374881301';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('t')
        .setDescription('Ask the TERF Wiki')
        .addStringOption(option =>
            option.setName('question')
                .setDescription('Your question about TERF')
                .setRequired(true)
        )
        .setDMPermission(false)
        .setContexts([InteractionContextType.Guild]),

    async execute(interaction) {
        // Guild lock check
        if (!interaction.guildId || interaction.guildId !== ALLOWED_GUILD) {
            return; // Silently ignore in other guilds
        }

        const question = interaction.options.getString('question');

        await interaction.deferReply();

        try {
            console.log(`[Terf] Query from ${interaction.user.tag}: "${question}"`);
            const result = await terfWiki.query(question);

            if (!result.success) {
                await interaction.editReply(`❌ ${result.error}`);
                return;
            }

            // Format response
            let response = `**Answer:**\n${result.answer}`;

            if (result.sources && result.sources.length > 0) {
                const sourceLinks = result.sources
                    .slice(0, 3)
                    .map(s => `• [${s.title}](${s.url})`)
                    .join('\n');
                response += `\n\n**Sources:**\n${sourceLinks}`;
            }

            // Discord limit is 2000 chars
            if (response.length > 1900) {
                response = response.slice(0, 1900) + '...';
            }

            await interaction.editReply(response);

        } catch (e) {
            console.error('[Terf] Error:', e);
            await interaction.editReply('❌ Failed to query the wiki. Please try again.');
        }
    }
};

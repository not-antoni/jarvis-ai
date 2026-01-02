const { SlashCommandBuilder, EmbedBuilder, Colors } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('anime-search')
        .setDescription('Identify an anime from a screenshot')
        .addAttachmentOption(option =>
            option.setName('image')
                .setDescription('Screenshot of the anime scene')
                .setRequired(true)),
    async execute(interaction) {
        const image = interaction.options.getAttachment('image');

        if (!image.contentType || !image.contentType.startsWith('image/')) {
            return interaction.reply({ content: '❌ Please upload a valid image.', ephemeral: true });
        }

        await interaction.deferReply();

        try {
            const imageUrl = encodeURIComponent(image.url);
            const response = await fetch(`https://api.trace.moe/search?anilistInfo&url=${imageUrl}`);

            if (!response.ok) {
                throw new Error(`API Error: ${response.statusText}`);
            }

            const data = await response.json();

            if (data.error) {
                return interaction.editReply(`❌ Error: ${data.error}`);
            }

            if (!data.result || data.result.length === 0) {
                return interaction.editReply('❌ No matches found.');
            }

            // Top result
            const result = data.result[0];
            const similarity = (result.similarity * 100).toFixed(1);

            if (result.similarity < 0.85) {
                await interaction.followUp({ content: `⚠️ Similarity is low (${similarity}%). Result might be incorrect.`, ephemeral: true });
            }

            const anime = result.anilist;
            const title = anime.title.english || anime.title.romaji || 'Unknown Title';
            const episode = result.episode ? `Episode ${result.episode}` : 'Movie/OVA';

            // Format timestamp
            const formatTime = (seconds) => {
                const h = Math.floor(seconds / 3600);
                const m = Math.floor((seconds % 3600) / 60);
                const s = Math.floor(seconds % 60);
                return `${h > 0 ? h + ':' : ''}${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
            };
            const timestamp = formatTime(result.from);

            const embed = new EmbedBuilder()
                .setTitle(title)
                .setURL(`https://anilist.co/anime/${anime.id}`)
                .setDescription(`**${episode}** at **${timestamp}**`)
                .addFields(
                    { name: 'Similarity', value: `${similarity}%`, inline: true },
                    { name: 'Native Title', value: anime.title.native || 'N/A', inline: true },
                    { name: 'Is Adult?', value: anime.isAdult ? 'Yes 🔞' : 'No', inline: true }
                )
                .setImage(result.image)
                .setColor(result.similarity > 0.9 ? Colors.Green : Colors.Yellow)
                .setFooter({ text: 'Powered by trace.moe' });

            // Video preview?
            // trace.moe provides a video preview URL
            if (result.video) {
                // Discord doesn't embed videos in rich embeds well, but we can link it
                // Or just send the video file link as content
                await interaction.editReply({
                    content: `Found it! Here is the scene preview: ${result.video}`,
                    embeds: [embed]
                });
            } else {
                await interaction.editReply({ embeds: [embed] });
            }

        } catch (error) {
            console.error('Anime search error:', error);
            await interaction.editReply('❌ Failed to search anime. The API might be busy or the image format is unsupported.');
        }
    }
};

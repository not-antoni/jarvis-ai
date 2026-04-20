'use strict';

const { EmbedBuilder } = require('discord.js');
const brave = require('../brave-search');

async function handleSearchCommand(interaction) {
    const query = interaction.options.getString('query', true);
    if (!brave.isConfigured()) {
        await interaction.editReply({
            content: 'Web search is not configured on this deployment, sir. Set `BRAVE_SEARCH_API_KEY`.'
        });
        return;
    }
    const result = await brave.search(query, { count: 5 });
    if (!result.ok) {
        await interaction.editReply({
            content: `Search failed, sir. ${result.reason || 'Unknown error.'}`
        });
        return;
    }
    if (!result.results.length) {
        await interaction.editReply({ content: `No results for **${query}**, sir.` });
        return;
    }
    const description = result.results
        .map((r, i) => {
            const source = r.source ? ` · \`${r.source}\`` : '';
            const age = r.age ? ` · ${r.age}` : '';
            const desc = (r.description || '').replace(/\s+/g, ' ').trim().slice(0, 280);
            return `**${i + 1}. [${r.title}](${r.url})**${source}${age}\n${desc}`;
        })
        .join('\n\n')
        .slice(0, 4000);
    const embed = new EmbedBuilder()
        .setTitle(`Web search: ${query}`.slice(0, 256))
        .setURL(`https://search.brave.com/search?q=${encodeURIComponent(query)}`)
        .setColor(0xf34b13)
        .setDescription(description)
        .setFooter({ text: result.cached ? 'Cached result' : 'Live from Brave Search' });
    await interaction.editReply({ embeds: [embed] });
}

module.exports = { handleSearchCommand };

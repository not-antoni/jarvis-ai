'use strict';

const { EmbedBuilder } = require('discord.js');
const brave = require('../brave-search');

function escapeMarkdown(text) {
    return String(text || '')
        .replace(/\\/g, '\\\\')
        .replace(/\*/g, '\\*')
        .replace(/_/g, '\\_')
        .replace(/`/g, '\\`')
        .replace(/~/g, '\\~')
        .replace(/\|/g, '\\|')
        .replace(/>/g, '\\>');
}

function compactText(text, max = 280) {
    return String(text || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, max);
}

function formatResultLine(result, index) {
    const title = escapeMarkdown(result.title || result.url || 'Untitled result');
    const url = result.url || result.pageUrl || result.mediaUrl || '';
    const source = result.source ? ` · \`${escapeMarkdown(result.source)}\`` : '';
    const age = result.age ? ` · ${escapeMarkdown(result.age)}` : '';
    const desc = compactText(result.description, 220);

    return `**${index + 1}. [${title}](${url})**${source}${age}\n${escapeMarkdown(desc) || '_No snippet provided._'}`;
}

function pickPreviewUrl(results) {
    for (const result of results || []) {
        if (result?.mediaUrl) {return result.mediaUrl;}
        if (result?.thumbnail) {return result.thumbnail;}
        if (result?.url) {return result.url;}
    }
    return null;
}

async function handleSearchCommand(interaction) {
    const query = interaction.options.getString('query', true);

    if (!brave.isConfigured()) {
        await interaction.editReply({
            content: 'Web search is not configured on this deployment, sir. Set `BRAVE_SEARCH_API_KEY`.'
        });
        return;
    }

    const outcome = await brave.searchByIntent(query, { count: 8 });
    if (!outcome.ok) {
        await interaction.editReply({
            content: `Search failed, sir. ${outcome.reason || 'Unknown error.'}`
        });
        return;
    }

    if (!outcome.results.length) {
        await interaction.editReply({ content: `No results for **${escapeMarkdown(query)}**, sir.` });
        return;
    }

    const queryLabel = outcome.rewrittenQuery && outcome.rewrittenQuery !== outcome.query
        ? `${query} → ${outcome.rewrittenQuery}`
        : query;

    const description = outcome.results
        .slice(0, 6)
        .map((r, i) => formatResultLine(r, i))
        .join('\n\n')
        .slice(0, 4000);

    const titlePrefix = outcome.mode === 'image' ? 'Media search' : 'Web search';
    const embed = new EmbedBuilder()
        .setTitle(`${titlePrefix}: ${compactText(queryLabel, 90)}`.slice(0, 256))
        .setURL(`https://search.brave.com/search?q=${encodeURIComponent(outcome.rewrittenQuery || query)}`)
        .setColor(0xf34b13)
        .setDescription(description)
        .setFooter({
            text: [
                outcome.cached ? 'Cached result' : `Live from Brave ${outcome.mode === 'image' ? 'Image Search' : 'Search'}`,
                typeof outcome.totalResults === 'number' ? `${outcome.totalResults} total results` : null,
                outcome.mode === 'image' ? 'Use these links directly for GIFs/images' : null
            ].filter(Boolean).join(' · ')
        });

    const preview = pickPreviewUrl(outcome.results);
    if (preview && outcome.mode === 'image') {
        embed.setImage(preview);
    }

    await interaction.editReply({ embeds: [embed] });
}

module.exports = { handleSearchCommand };

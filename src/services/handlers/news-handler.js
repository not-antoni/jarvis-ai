'use strict';

const { EmbedBuilder } = require('discord.js');
const database = require('../database');

const NEWS_API_KEY = process.env.NEWS_API_KEY || null;

async function fetchNewsFromTheNewsApi(topic, limit = 5) {
    if (!NEWS_API_KEY) {return [];}
    const searchParam = encodeURIComponent(topic);
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const publishedAfter = weekAgo.toISOString().split('T')[0]; // YYYY-MM-DD
    const url = `https://api.thenewsapi.com/v1/news/all?api_token=${NEWS_API_KEY}&language=en&limit=${limit}&search=${searchParam}&published_after=${publishedAfter}&sort=published_at`;
    const response = await fetch(url, {
        headers: { 'Accept': 'application/json' }
    });
    if (!response.ok) {
        throw new Error(`TheNewsAPI request failed: ${response.status}`);
    }
    const data = await response.json();
    const articles = Array.isArray(data?.data) ? data.data : [];
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    return articles
        .filter(article => {
            if (!article.published_at) {return true;}
            return new Date(article.published_at).getTime() > thirtyDaysAgo;
        })
        .map((article) => ({
            title: article.title || 'Untitled story',
            description: article.description || '',
            url: article.url || null,
            source: article.source || article.source_url || 'TheNewsAPI',
            published: article.published_at ? new Date(article.published_at) : null,
            image: article.image_url || null
        }));
}

async function handleNewsCommand(interaction) {
    const topic = interaction.options.getString('topic') || 'technology';
    const fresh = interaction.options.getBoolean('fresh') || false;
    const normalizedTopic = topic.toLowerCase();
    let articles = [];
    let fromCache = false;
    if (!fresh && database.isConnected) {
        try {
            const cached = await database.getNewsDigest(normalizedTopic);
            if (cached?.articles?.length) {
                articles = cached.articles.map((article) => ({
                    ...article,
                    published: article.published ? new Date(article.published) : null
                }));
                fromCache = true;
                if (cached.metadata?.cachedAt) {
                    const cachedDate = new Date(cached.metadata.cachedAt);
                    if (!Number.isNaN(cachedDate.getTime()) && Date.now() - cachedDate.getTime() > 90 * 60 * 1000) {
                        fromCache = false;
                    }
                }
            }
        } catch (error) {
            console.warn('Failed to read cached news digest:', error);
        }
    }
    if (!articles.length) {
        try {
            if (NEWS_API_KEY) {
                articles = await fetchNewsFromTheNewsApi(normalizedTopic, 5);
            }
            if (database.isConnected) {
                const serialisable = articles.map((article) => ({
                    ...article,
                    published: article.published ? article.published.toISOString() : null
                }));
                await database.saveNewsDigest(normalizedTopic, serialisable, { cachedAt: new Date().toISOString() });
            }
        } catch (error) {
            console.error('News fetch failed:', error);
            await interaction.editReply('Unable to fetch headlines at the moment, sir.');
            return;
        }
    }
    if (!articles.length) {
        await interaction.editReply('No headlines available right now, sir.');
        return;
    }
    const embed = new EmbedBuilder()
        .setTitle(`Top headlines: ${topic}`)
        .setColor(0x00b5ad)
        .setTimestamp(new Date());
    const lines = articles.slice(0, 5).map((article, index) => {
        const title = article.title || 'Untitled story';
        const url = article.url || '';
        const source = article.source || 'Unknown source';
        const published = article.published ? Math.floor(new Date(article.published).getTime() / 1000) : null;
        const desc = article.description ? article.description.trim() : '';
        const headline = url ? `**${index + 1}. [${title}](${url})**` : `**${index + 1}. ${title}**`;
        const metaParts = [source];
        if (published) {
            metaParts.push(`<t:${published}:R>`);
        }
        const metaLine = metaParts.length ? `_${metaParts.join(' • ')}_` : '';
        const body = desc ? `${desc.slice(0, 180)}${desc.length > 180 ? '…' : ''}` : '';
        return [headline, body, metaLine].filter(Boolean).join('\n');
    });
    embed.setDescription(lines.join('\n\n'));
    const firstImage = articles.find((a) => a.image)?.image;
    if (firstImage) {
        embed.setImage(firstImage);
    }
    if (fromCache && database.isConnected) {
        embed.setFooter({ text: 'Cached digest • add fresh:true to refresh' });
    } else if (NEWS_API_KEY) {
        embed.setFooter({ text: 'Powered by TheNewsAPI.com' });
    }
    await interaction.editReply({ embeds: [embed] });
}

module.exports = { fetchNewsFromTheNewsApi, handleNewsCommand };

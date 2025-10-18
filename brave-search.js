/**
 * Brave Search API integration for web search
 */

const fetch = require('node-fetch');

class BraveSearch {
    constructor() {
        this.apiKey = process.env.BRAVE_API_KEY;
        this.endpoint = 'https://api.search.brave.com/res/v1/web/search';

        if (!this.apiKey) {
            console.warn('Brave Search API key not found. Brave web search will be disabled.');
        }
    }

    truncate(text, maxLength) {
        if (!text) return '';
        return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
    }

    normaliseResult(result) {
        const displayUrl = result?.meta_url?.displayUrl || (() => {
            try {
                return new URL(result.url).hostname;
            } catch (err) {
                return result.url;
            }
        })();

        return {
            title: result.title || result.url,
            url: result.url,
            description: result.description || '',
            displayUrl,
            thumbnail: result?.thumbnail?.src || null,
            profileName: result?.profile?.name || null,
            age: result?.page_age || null,
            language: result.language || null
        };
    }

    buildPrimaryDescription(result) {
        const snippetParts = [];

        if (result.description) {
            snippetParts.push(this.truncate(result.description, 350));
        }

        const metaBits = [];
        if (result.displayUrl) metaBits.push(result.displayUrl);
        if (result.profileName) metaBits.push(result.profileName);
        if (result.age) metaBits.push(result.age);
        if (metaBits.length > 0) {
            snippetParts.push(metaBits.join(' • '));
        }

        return snippetParts.join('\n');
    }

    async searchWeb(query) {
        if (!this.apiKey) {
            throw new Error('Brave Search API not configured. Please set BRAVE_API_KEY environment variable.');
        }

        const url = new URL(this.endpoint);
        url.searchParams.set('q', query);
        url.searchParams.set('count', '5');
        url.searchParams.set('safesearch', 'strict');

        const response = await fetch(url.toString(), {
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'JarvisDiscordBot/1.0',
                'X-Subscription-Token': this.apiKey
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Brave Search request failed: ${response.status} ${errorText}`);
        }

        const data = await response.json();
        const results = Array.isArray(data?.web?.results) ? data.web.results : [];

        return results
            .filter((result) => result && typeof result.url === 'string')
            .slice(0, 5)
            .map((result) => this.normaliseResult(result));
    }

    formatSearchResponse(query, results) {
        if (!results || results.length === 0) {
            return {
                content: `No web results found for "${query}", sir. Perhaps refine the query?`
            };
        }

        const [topResult, ...secondaryResults] = results;

        const embed = {
            color: 0xF97316,
            title: topResult.title,
            url: topResult.url,
            description: this.buildPrimaryDescription(topResult) || topResult.url,
            author: {
                name: `Results for "${this.truncate(query, 70)}"`
            },
            fields: secondaryResults.slice(0, 2).map((result, index) => ({
                name: `${index + 2}. ${result.title}`,
                value: this.truncate([
                    result.description,
                    result.displayUrl || result.url
                ].filter(Boolean).join('\n') || result.url, 1024)
            })),
            footer: {
                text: 'Powered by Brave Search'
            },
            timestamp: new Date().toISOString()
        };

        if (topResult.thumbnail) {
            embed.thumbnail = { url: topResult.thumbnail };
        }

        const buttons = results.slice(0, Math.min(results.length, 5)).map((result, index) => ({
            type: 2,
            style: 5, // Link button
            label: `${index + 1}. ${this.truncate(result.title, 70)}`,
            url: result.url
        }));

        return {
            embeds: [embed],
            components: buttons.length
                ? [{ type: 1, components: buttons }]
                : []
        };
    }
}

module.exports = new BraveSearch();

/**
 * Brave Search API integration for web search
 */

const fetch = require('node-fetch');

const EXPLICIT_PATTERNS = [
    /\bporn(?:hub)?\b/i,
    /\bpornography\b/i,
    /\bxvideos?\b/i,
    /\bxnxx\b/i,
    /\bnsfw\b/i,
    /\bxxx\b/i,
    /\bnude\b/i,
    /\bnaked\b/i,
    /\bhentai\b/i,
    /\bmilf\b/i,
    /\bcumshot\b/i,
    /(?:^|\W)cum(?!\s+laude)\b/i,
    /\bblowjob\b/i,
    /\bhandjob\b/i,
    /\bjerk\s*off\b/i,
    /\bstrip(?:per|tease|club)\b/i,
    /\bescort\s+(?:service|services|agency|agencies|site|sites|girl|girls|boy|boys|ads?)\b/i,
    /\bpussy\b/i,
    /\bcock\b/i,
    /\bboobs?\b/i,
    /\btits?\b/i,
    /\bclit\b/i,
    /\berotic\b/i,
    /\bsex\s*tape\b/i,
    /\badult\s*(?:site|video|movie|content)\b/i,
    /\bonlyfans\b/i,
    /\bcam(?:girl|boy|sex|show)\b/i,
    /\bdeepthroat\b/i,
    /\bfetish\b/i,
    /\bbdsm\b/i,
    /\borgasm\b/i,
    /\bincest\b/i,
    /\bpegging\b/i,
    /\bbukkake\b/i,
    /\bgangbang\b/i,
    /\bgloryhole\b/i,
    /\bsquirting\b/i,
    /\banal\b/i,
    /\bfuck\b/i,
    /\bsex\.com\b/i,
    /\bdick\s+(?:pic|pics|photo|photos|video|videos|porn|movie|movies|size)\b/i,
    /\bbig\s+dick\b/i
];

const EXPLICIT_TLDS = ['.xxx', '.porn', '.adult', '.sex', '.sexy'];

const BANNED_DOMAINS = [
    'pornhub.com',
    'xvideos.com',
    'xnxx.com',
    'redtube.com',
    'youporn.com',
    'brazzers.com',
    'onlyfans.com',
    'fansly.com',
    'sex.com',
    'adultfriendfinder.com',
    'stripchat.com',
    'chaturbate.com',
    'cam4.com',
    'camwhores.tv',
    'spankbang.com'
];

const EXPLICIT_QUERY_MESSAGE = 'I must decline that request, sir. My safety filters forbid it.';
const EXPLICIT_RESULTS_MESSAGE = 'I located only explicit results, sir, so I withheld them.';

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

    containsExplicitLanguage(text) {
        if (!text) {
            return false;
        }

        return EXPLICIT_PATTERNS.some((pattern) => pattern.test(text));
    }

    getHostname(url) {
        try {
            const { hostname } = new URL(url);
            return hostname;
        } catch (err) {
            return '';
        }
    }

    isExplicitDomain(hostname) {
        if (!hostname) return false;

        const normalizedHost = hostname.toLowerCase();
        const strippedHost = normalizedHost.startsWith('www.') ? normalizedHost.slice(4) : normalizedHost;

        if (BANNED_DOMAINS.some((domain) => strippedHost === domain || strippedHost.endsWith(`.${domain}`))) {
            return true;
        }

        if (EXPLICIT_TLDS.some((tld) => strippedHost.endsWith(tld))) {
            return true;
        }

        return false;
    }

    isExplicitQuery(query) {
        if (!query) return false;

        const lowered = query.toLowerCase();

        if (this.containsExplicitLanguage(lowered)) {
            return true;
        }

        return BANNED_DOMAINS.some((domain) => lowered.includes(domain));
    }

    resultIsExplicit(result) {
        if (!result || typeof result !== 'object') {
            return true;
        }

        if (result.is_family_friendly === false || result.family_friendly === false || result.familyFriendly === false) {
            return true;
        }

        if (result.block && typeof result.block.reason === 'string' && /adult|explicit/i.test(result.block.reason)) {
            return true;
        }

        const url = result.url || '';
        const title = result.title || '';
        const description = result.description || '';
        const displayUrl = result?.meta_url?.displayUrl || '';
        const profileName = result?.profile?.name || '';

        if (this.containsExplicitLanguage([title, description, displayUrl, url, profileName].join(' '))) {
            return true;
        }

        if (this.isExplicitDomain(this.getHostname(url))) {
            return true;
        }

        return false;
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

        if (this.isExplicitQuery(query)) {
            const error = new Error(EXPLICIT_QUERY_MESSAGE);
            error.isSafeSearchBlock = true;
            throw error;
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

        let filteredOut = 0;

        const safeResults = results
            .filter((result) => {
                const hasUrl = result && typeof result.url === 'string';
                if (!hasUrl) return false;

                const explicit = this.resultIsExplicit(result);
                if (explicit) filteredOut += 1;

                return !explicit;
            })
            .slice(0, 5)
            .map((result) => this.normaliseResult(result));

        if (safeResults.length === 0 && filteredOut > 0) {
            const error = new Error(EXPLICIT_RESULTS_MESSAGE);
            error.isSafeSearchBlock = true;
            throw error;
        }

        return safeResults;
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

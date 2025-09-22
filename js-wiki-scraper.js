/**
 * Pure JavaScript Wiki Scraper
 * Fallback for when Python is not available on Render
 */

const https = require('https');
const { URL } = require('url');

class JSWikiScraper {
    constructor() {
        this.baseUrl = 'https://trotywiki.miraheze.org';
        this.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36';
    }

    /**
     * Make HTTP request
     * @param {string} url - URL to fetch
     * @returns {Promise<string>} - HTML content
     */
    async fetchPage(url) {
        return new Promise((resolve, reject) => {
            const options = {
                headers: {
                    'User-Agent': this.userAgent
                }
            };

            https.get(url, options, (res) => {
                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', () => {
                    resolve(data);
                });
            }).on('error', (err) => {
                reject(err);
            });
        });
    }

    /**
     * Search the wiki
     * @param {string} query - Search query
     * @returns {Promise<Array>} - Array of page titles
     */
    async searchWiki(query) {
        try {
            const searchUrl = `${this.baseUrl}/w/index.php?search=${encodeURIComponent(query)}&title=Special%3ASearch`;
            const html = await this.fetchPage(searchUrl);
            
            // Parse search results
            const results = [];
            const linkRegex = /<a href="\/wiki\/([^"]+)" title="[^"]+" data-serp-pos="[0-9]+">/g;
            let match;
            
            while ((match = linkRegex.exec(html)) !== null) {
                const pageTitle = match[1];
                if (pageTitle && !pageTitle.includes(':')) { // Skip special pages
                    results.push(pageTitle);
                }
            }
            
            return results.slice(0, 10); // Limit to 10 results
        } catch (error) {
            console.error('Search error:', error);
            return [];
        }
    }

    /**
     * Get page content
     * @param {string} pageTitle - Page title
     * @returns {Promise<Object>} - Page data
     */
    async getPageContent(pageTitle) {
        try {
            const pageUrl = `${this.baseUrl}/wiki/${encodeURIComponent(pageTitle)}?action=edit`;
            const html = await this.fetchPage(pageUrl);
            
            // Extract content from edit form
            const startMarker = 'name="wpTextbox1">';
            const endMarker = '</textarea>';
            
            const startIndex = html.indexOf(startMarker);
            if (startIndex === -1) return null;
            
            const endIndex = html.indexOf(endMarker, startIndex);
            if (endIndex === -1) return null;
            
            const content = html.substring(startIndex + startMarker.length, endIndex);
            
            return {
                title: pageTitle.replace(/_/g, ' '),
                content: this.cleanWikiContent(content)
            };
        } catch (error) {
            console.error('Page fetch error:', error);
            return null;
        }
    }

    /**
     * Clean wiki content
     * @param {string} content - Raw wiki content
     * @returns {string} - Cleaned content
     */
    cleanWikiContent(content) {
        return content
            .replace(/\[\[File:[^\]]+\]\]/g, '') // Remove file links
            .replace(/\{\{[^}]+\}\}/g, '') // Remove templates
            .replace(/\[\[([^|]+)\|([^|]+)\]\]/g, '$2') // Replace piped links
            .replace(/\[\[([^|]+)\]\]/g, '$1') // Replace simple links
            .replace(/\[http[^\s]+\s([^\]]+)\]/g, '$1') // Replace external links
            .replace(/\[http[^\]]+\]/g, '') // Remove external links without text
            .replace(/'{2,5}/g, '') // Remove bold/italic markup
            .replace(/<[^>]+>/g, '') // Remove HTML tags
            .replace(/\s+/g, ' ') // Normalize whitespace
            .trim();
    }

    /**
     * Search and scrape wiki pages
     * @param {string} query - Search query
     * @returns {Promise<Array>} - Array of page data
     */
    async searchAndScrape(query) {
        try {
            console.log(`JS Wiki Scraper: Searching for "${query}"`);
            
            // Search for pages
            const pageTitles = await this.searchWiki(query);
            if (pageTitles.length === 0) {
                // If no search results, try to find pages with similar terms
                const similarPages = await this.findSimilarPages(query);
                if (similarPages.length === 0) {
                    return [];
                }
                pageTitles.push(...similarPages);
            }
            
            console.log(`JS Wiki Scraper: Found ${pageTitles.length} pages`);
            
            // Scrape each page
            const pages = [];
            for (const title of pageTitles.slice(0, 8)) { // Increased limit to 8 pages
                try {
                    const pageData = await this.getPageContent(title);
                    if (pageData && pageData.content && pageData.content.trim()) {
                        pages.push(pageData);
                    }
                } catch (error) {
                    console.error(`Error scraping page ${title}:`, error);
                    continue;
                }
            }
            
            return pages;
        } catch (error) {
            console.error('JS Wiki Scraper error:', error);
            return [];
        }
    }

    /**
     * Find similar pages when search returns no results
     * @param {string} query - Search query
     * @returns {Promise<Array>} - Array of similar page titles
     */
    async findSimilarPages(query) {
        try {
            // Common wiki pages that might match
            const commonPages = [
                'D.E.M', 'The_D.E.M', 'S.T.F.R', 'The_S.T.F.R', 'C.R.R',
                'Battery_Array', 'Hadron_Collider', 'OpenCore', 'Music_and_credits',
                'S.T.F.R_Stabilization', 'Troty_Energy_Research_Facility_Wiki'
            ];
            
            const queryLower = query.toLowerCase();
            const similarPages = [];
            
            for (const page of commonPages) {
                const pageLower = page.toLowerCase();
                
                // Check for various matching patterns
                if (pageLower.includes(queryLower) || 
                    queryLower.includes(pageLower.replace(/[^a-z]/g, '')) ||
                    this.calculateSimilarity(queryLower, pageLower) > 0.3) {
                    similarPages.push(page);
                }
            }
            
            return similarPages.slice(0, 5);
        } catch (error) {
            console.error('Error finding similar pages:', error);
            return [];
        }
    }

    /**
     * Calculate string similarity
     * @param {string} str1 - First string
     * @param {string} str2 - Second string
     * @returns {number} - Similarity score (0-1)
     */
    calculateSimilarity(str1, str2) {
        const longer = str1.length > str2.length ? str1 : str2;
        const shorter = str1.length > str2.length ? str2 : str1;
        
        if (longer.length === 0) return 1.0;
        
        const editDistance = this.levenshteinDistance(longer, shorter);
        return (longer.length - editDistance) / longer.length;
    }

    /**
     * Calculate Levenshtein distance
     * @param {string} str1 - First string
     * @param {string} str2 - Second string
     * @returns {number} - Edit distance
     */
    levenshteinDistance(str1, str2) {
        const matrix = [];
        
        for (let i = 0; i <= str2.length; i++) {
            matrix[i] = [i];
        }
        
        for (let j = 0; j <= str1.length; j++) {
            matrix[0][j] = j;
        }
        
        for (let i = 1; i <= str2.length; i++) {
            for (let j = 1; j <= str1.length; j++) {
                if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1,
                        matrix[i][j - 1] + 1,
                        matrix[i - 1][j] + 1
                    );
                }
            }
        }
        
        return matrix[str2.length][str1.length];
    }
}

module.exports = new JSWikiScraper();

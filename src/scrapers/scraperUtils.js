/**
 * Scraping Utilities - Helper functions for data processing, parsing, and formatting
 */

const fs = require('fs').promises;
const path = require('path');

class ScraperUtils {
    /**
     * Clean HTML text
     */
    static cleanText(text) {
        if (!text) return '';

        return text
            .replace(/\s+/g, ' ') // Replace multiple spaces
            .replace(/[\r\n\t]/g, ' ') // Remove control characters
            .trim();
    }

    /**
     * Extract domain from URL
     */
    static getDomain(url) {
        try {
            const urlObj = new URL(url);
            return urlObj.hostname;
        } catch {
            return null;
        }
    }

    /**
     * Resolve relative URLs to absolute
     */
    static resolveURL(url, baseURL) {
        try {
            return new URL(url, baseURL).href;
        } catch {
            return url;
        }
    }

    /**
     * Extract domain and path
     */
    static parseURL(url) {
        try {
            const urlObj = new URL(url);
            return {
                protocol: urlObj.protocol,
                hostname: urlObj.hostname,
                pathname: urlObj.pathname,
                search: urlObj.search,
                hash: urlObj.hash,
                href: url
            };
        } catch {
            return null;
        }
    }

    /**
     * Check if URL is valid
     */
    static isValidURL(url) {
        try {
            new URL(url);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Remove URL parameters
     */
    static removeURLParams(url, params = []) {
        try {
            const urlObj = new URL(url);
            params.forEach(param => urlObj.searchParams.delete(param));
            return urlObj.href;
        } catch {
            return url;
        }
    }

    /**
     * Extract text between HTML tags
     */
    static extractBetweenTags(html, openTag, closeTag) {
        const regex = new RegExp(`${openTag}(.*?)${closeTag}`, 'is');
        const match = html.match(regex);
        return match ? match[1] : null;
    }

    /**
     * Parse HTML table to array of objects
     */
    static parseHTMLTable(html) {
        const rows = [];
        const tableRegex = /<table[^>]*>(.*?)<\/table>/is;
        const tableMatch = html.match(tableRegex);

        if (!tableMatch) return [];

        const tableContent = tableMatch[1];
        const headerRegex = /<th[^>]*>(.*?)<\/th>/gi;
        const rowRegex = /<tr[^>]*>(.*?)<\/tr>/gi;
        const cellRegex = /<td[^>]*>(.*?)<\/td>/gi;

        // Extract headers
        const headers = [];
        let headerMatch;
        while ((headerMatch = headerRegex.exec(tableContent)) !== null) {
            headers.push(this.cleanText(headerMatch[1]));
        }

        // Extract rows
        let rowMatch;
        while ((rowMatch = rowRegex.exec(tableContent)) !== null) {
            const cells = [];
            let cellMatch;
            const row = rowMatch[1];

            while ((cellMatch = cellRegex.exec(row)) !== null) {
                cells.push(this.cleanText(cellMatch[1]));
            }

            if (cells.length > 0) {
                const obj = {};
                headers.forEach((header, i) => {
                    obj[header] = cells[i] || '';
                });
                rows.push(obj);
            }
        }

        return rows;
    }

    /**
     * Convert text to slug
     */
    static toSlug(text) {
        return text
            .toLowerCase()
            .trim()
            .replace(/[^\w\s-]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-');
    }

    /**
     * Truncate text
     */
    static truncate(text, maxLength = 100, suffix = '...') {
        if (!text) return '';
        if (text.length <= maxLength) return text;
        return text.substring(0, maxLength - suffix.length) + suffix;
    }

    /**
     * Extract email addresses
     */
    static extractEmails(text) {
        const emailRegex = /[\w.-]+@[\w.-]+\.\w+/g;
        return text.match(emailRegex) || [];
    }

    /**
     * Extract phone numbers
     */
    static extractPhoneNumbers(text) {
        const phoneRegex = /[\+]?[(]?[0-9]{3}[)]?[-\s\.]?[0-9]{3}[-\s\.]?[0-9]{4,6}/g;
        return text.match(phoneRegex) || [];
    }

    /**
     * Extract URLs from text
     */
    static extractURLs(text) {
        const urlRegex = /(https?|ftp):\/\/[^\s/$.?#].[^\s]*/gi;
        return text.match(urlRegex) || [];
    }

    /**
     * Calculate text statistics
     */
    static getTextStats(text) {
        const cleanedText = this.cleanText(text);
        const words = cleanedText.split(/\s+/).filter(w => w.length > 0);
        const sentences = cleanedText.split(/[.!?]+/).filter(s => s.length > 0);
        const paragraphs = text.split(/\n\n+/).filter(p => p.length > 0);
        const characters = cleanedText.length;
        const avgWordLength = words.length > 0 ? (characters / words.length).toFixed(2) : 0;

        return {
            characters,
            words: words.length,
            sentences: sentences.length,
            paragraphs: paragraphs.length,
            avgWordLength: parseFloat(avgWordLength),
            estimatedReadTime: Math.ceil(words.length / 200) // 200 wpm
        };
    }

    /**
     * Deduplicate array
     */
    static deduplicate(arr) {
        return [...new Set(arr)];
    }

    /**
     * Sort array of objects by property
     */
    static sortByProperty(arr, property, ascending = true) {
        return arr.sort((a, b) => {
            const aVal = a[property];
            const bVal = b[property];

            if (aVal < bVal) return ascending ? -1 : 1;
            if (aVal > bVal) return ascending ? 1 : -1;
            return 0;
        });
    }

    /**
     * Group array by property
     */
    static groupByProperty(arr, property) {
        return arr.reduce((groups, item) => {
            const key = item[property];
            if (!groups[key]) groups[key] = [];
            groups[key].push(item);
            return groups;
        }, {});
    }

    /**
     * Save data to JSON file
     */
    static async saveJSON(filepath, data) {
        try {
            const dir = path.dirname(filepath);
            await fs.mkdir(dir, { recursive: true });
            await fs.writeFile(filepath, JSON.stringify(data, null, 2));
            console.log(`[ScraperUtils] Saved JSON: ${filepath}`);
            return true;
        } catch (error) {
            console.error(`[ScraperUtils] Failed to save JSON:`, error.message);
            return false;
        }
    }

    /**
     * Load data from JSON file
     */
    static async loadJSON(filepath) {
        try {
            const data = await fs.readFile(filepath, 'utf-8');
            return JSON.parse(data);
        } catch (error) {
            console.error(`[ScraperUtils] Failed to load JSON:`, error.message);
            return null;
        }
    }

    /**
     * Save data to CSV
     */
    static async saveCSV(filepath, data, headers = null) {
        try {
            if (!Array.isArray(data) || data.length === 0) {
                throw new Error('Data must be a non-empty array');
            }

            // Get headers from first object if not provided
            const csvHeaders = headers || Object.keys(data[0]);

            // Create CSV content
            const csv = [
                csvHeaders.join(','),
                ...data.map(row =>
                    csvHeaders.map(header => {
                        const value = row[header];
                        // Escape values with commas or quotes
                        if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
                            return `"${value.replace(/"/g, '""')}"`;
                        }
                        return value;
                    }).join(',')
                )
            ].join('\n');

            const dir = path.dirname(filepath);
            await fs.mkdir(dir, { recursive: true });
            await fs.writeFile(filepath, csv);
            console.log(`[ScraperUtils] Saved CSV: ${filepath}`);
            return true;
        } catch (error) {
            console.error(`[ScraperUtils] Failed to save CSV:`, error.message);
            return false;
        }
    }

    /**
     * Load data from CSV
     */
    static async loadCSV(filepath) {
        try {
            const content = await fs.readFile(filepath, 'utf-8');
            const lines = content.trim().split('\n');

            if (lines.length < 1) return [];

            const headers = lines[0].split(',').map(h => h.trim());
            const data = [];

            for (let i = 1; i < lines.length; i++) {
                const values = this.parseCSVLine(lines[i]);
                const obj = {};

                headers.forEach((header, index) => {
                    obj[header] = values[index] || '';
                });

                data.push(obj);
            }

            return data;
        } catch (error) {
            console.error(`[ScraperUtils] Failed to load CSV:`, error.message);
            return [];
        }
    }

    /**
     * Parse CSV line (handles quoted values)
     */
    static parseCSVLine(line) {
        const result = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];

            if (char === '"') {
                if (inQuotes && line[i + 1] === '"') {
                    current += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (char === ',' && !inQuotes) {
                result.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }

        result.push(current.trim());
        return result;
    }

    /**
     * Convert data to Markdown table
     */
    static toMarkdownTable(data, headers = null) {
        if (!Array.isArray(data) || data.length === 0) return '';

        const cols = headers || Object.keys(data[0]);
        const separator = cols.map(() => '---').join(' | ');
        const headerRow = cols.join(' | ');

        const rows = data.map(row =>
            cols.map(col => row[col] || '').join(' | ')
        );

        return [headerRow, separator, ...rows].join('\n');
    }

    /**
     * Rate limit function calls
     */
    static async rateLimit(fn, interval = 1000) {
        let lastCall = 0;

        return async (...args) => {
            const now = Date.now();
            const timeSinceLastCall = now - lastCall;

            if (timeSinceLastCall < interval) {
                await new Promise(resolve =>
                    setTimeout(resolve, interval - timeSinceLastCall)
                );
            }

            lastCall = Date.now();
            return fn(...args);
        };
    }
}

module.exports = ScraperUtils;

/**
 * Enhanced Wiki Search Handler with OpenAI Embeddings
 * Provides intelligent query matching and semantic search
 */

const OpenAI = require('openai');

class WikiSearchHandler {
    constructor() {
        this.hasOpenAI = !!process.env.OPENAI;
        if (this.hasOpenAI) {
            this.openai = new OpenAI({
                apiKey: process.env.OPENAI
            });
        }
        this.embeddingModel = 'text-embedding-3-large';
        this.maxResults = 5;
    }

    /**
     * Generate embeddings for text using OpenAI
     * @param {string} text - Text to embed
     * @returns {Promise<number[]>} - Embedding vector
     */
    async generateEmbedding(text) {
        try {
            const response = await this.openai.embeddings.create({
                model: this.embeddingModel,
                input: text,
                encoding_format: "float"
            });
            return response.data[0].embedding;
        } catch (error) {
            console.error('Error generating embedding:', error);
            throw new Error('Failed to generate embedding');
        }
    }

    /**
     * Calculate cosine similarity between two vectors
     * @param {number[]} a - First vector
     * @param {number[]} b - Second vector
     * @returns {number} - Similarity score (0-1)
     */
    cosineSimilarity(a, b) {
        if (a.length !== b.length) return 0;
        
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;
        
        for (let i = 0; i < a.length; i++) {
            dotProduct += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }
        
        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }

    /**
     * Find the best matching pages using semantic similarity
     * @param {string} query - User's search query
     * @param {Array} pages - Array of scraped pages
     * @returns {Promise<Array>} - Sorted pages by relevance
     */
    async findBestMatches(query, pages) {
        // If OpenAI is not available, use text matching
        if (!this.hasOpenAI) {
            console.log('OpenAI not available, using text matching fallback');
            return this.fallbackTextMatching(query, pages);
        }

        try {
            // Generate embedding for the user query
            const queryEmbedding = await this.generateEmbedding(query);
            
            // Calculate similarity for each page
            const pageScores = await Promise.all(pages.map(async (page) => {
                // Create a combined text for embedding (title + content preview)
                const pageText = `${page.title} ${page.content.substring(0, 500)}`;
                const pageEmbedding = await this.generateEmbedding(pageText);
                const similarity = this.cosineSimilarity(queryEmbedding, pageEmbedding);
                
                return {
                    ...page,
                    similarity,
                    relevanceScore: similarity
                };
            }));

            // Sort by relevance score (highest first)
            return pageScores
                .sort((a, b) => b.relevanceScore - a.relevanceScore)
                .slice(0, this.maxResults);

        } catch (error) {
            console.error('Error in semantic matching:', error);
            // Fallback to simple text matching
            return this.fallbackTextMatching(query, pages);
        }
    }

    /**
     * Fallback text matching when embeddings fail
     * @param {string} query - User's search query
     * @param {Array} pages - Array of scraped pages
     * @returns {Array} - Sorted pages by text relevance
     */
    fallbackTextMatching(query, pages) {
        const queryLower = query.toLowerCase();
        
        return pages
            .map(page => {
                const titleLower = page.title.toLowerCase();
                const contentLower = page.content.toLowerCase();
                
                let score = 0;
                
                // Exact title match gets highest score
                if (titleLower === queryLower) score += 100;
                
                // Title contains query
                if (titleLower.includes(queryLower)) score += 50;
                
                // Content contains query
                if (contentLower.includes(queryLower)) score += 25;
                
                // Partial word matches
                const queryWords = queryLower.split(/\s+/);
                const titleWords = titleLower.split(/\s+/);
                const contentWords = contentLower.split(/\s+/);
                
                queryWords.forEach(qWord => {
                    titleWords.forEach(tWord => {
                        if (tWord.includes(qWord) || qWord.includes(tWord)) score += 10;
                    });
                    contentWords.forEach(cWord => {
                        if (cWord.includes(qWord) || qWord.includes(cWord)) score += 5;
                    });
                });
                
                return {
                    ...page,
                    relevanceScore: score
                };
            })
            .sort((a, b) => b.relevanceScore - a.relevanceScore)
            .slice(0, this.maxResults);
    }

    /**
     * Process search results with intelligent matching
     * @param {string} query - User's search query
     * @param {Array} rawPages - Raw scraped pages
     * @returns {Promise<Object>} - Processed search results
     */
    async processSearchResults(query, rawPages) {
        if (!rawPages || rawPages.length === 0) {
            return {
                success: false,
                message: `No results found for "${query}", sir. The wiki may not contain that information.`,
                suggestions: []
            };
        }

        try {
            // Use semantic matching to find the best results
            const bestMatches = await this.findBestMatches(query, rawPages);
            
            // Filter out very low relevance results
            const relevantResults = bestMatches.filter(page => page.relevanceScore > 0.1);
            
            if (relevantResults.length === 0) {
                // If no relevant results, suggest similar terms
                const suggestions = this.generateSuggestions(query, rawPages);
                return {
                    success: false,
                    message: `No relevant results found for "${query}", sir.`,
                    suggestions: suggestions.slice(0, 3)
                };
            }

            return {
                success: true,
                results: relevantResults,
                query: query,
                totalFound: relevantResults.length,
                originalCount: rawPages.length
            };

        } catch (error) {
            console.error('Error processing search results:', error);
            return {
                success: false,
                message: `Search processing failed, sir. Technical difficulties.`,
                suggestions: []
            };
        }
    }

    /**
     * Generate suggestions based on available page titles
     * @param {string} query - User's search query
     * @param {Array} pages - Available pages
     * @returns {Array} - Array of suggested terms
     */
    generateSuggestions(query, pages) {
        const queryLower = query.toLowerCase();
        const suggestions = new Set();
        
        pages.forEach(page => {
            const title = page.title;
            const titleLower = title.toLowerCase();
            
            // Find common words or acronyms
            const words = titleLower.split(/\s+/);
            words.forEach(word => {
                if (word.length > 2 && !word.includes(queryLower)) {
                    suggestions.add(word);
                }
            });
            
            // Check for acronyms (uppercase words)
            const acronyms = title.match(/\b[A-Z]{2,}\b/g);
            if (acronyms) {
                acronyms.forEach(acronym => {
                    if (!acronym.toLowerCase().includes(queryLower)) {
                        suggestions.add(acronym);
                    }
                });
            }
        });
        
        return Array.from(suggestions).slice(0, 5);
    }

    /**
     * Format search results for Discord response
     * @param {Object} searchData - Processed search data
     * @returns {string} - Formatted response
     */
    formatResponse(searchData) {
        if (!searchData.success) {
            let response = searchData.message;
            if (searchData.suggestions && searchData.suggestions.length > 0) {
                response += `\n\n**Did you mean:** ${searchData.suggestions.join(', ')}?`;
            }
            return response;
        }

        let response = `**Wiki Search Results for "${searchData.query}":**\n\n`;
        
        searchData.results.forEach((page, index) => {
            const title = page.title || 'Untitled';
            const content = page.content || 'No content available';
            
            // Truncate content if too long
            const maxContentLength = 600;
            const truncatedContent = content.length > maxContentLength 
                ? content.substring(0, maxContentLength) + '...' 
                : content;
            
            // Add relevance indicator
            const relevance = page.relevanceScore > 0.8 ? '🎯' : 
                             page.relevanceScore > 0.5 ? '✅' : '📄';
            
            response += `${relevance} **${title}**\n${truncatedContent}\n\n`;
        });
        
        if (searchData.originalCount > searchData.totalFound) {
            response += `*Showing ${searchData.totalFound} of ${searchData.originalCount} results*`;
        }
        
        return response;
    }
}

module.exports = new WikiSearchHandler();

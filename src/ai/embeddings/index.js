/**
 * Text Embedding System for Jarvis
 * Uses OpenAI embeddings to search through JSONL data
 */

const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');
const aiManager = require('../providers');

class EmbeddingSystem {
    constructor() {
        if (!process.env.OPENAI) {
            console.error('OPENAI environment variable not set. Embedding system will not work.');
            this.isLoaded = false;
            return;
        }
        
        this.openai = new OpenAI({
            apiKey: process.env.OPENAI,
        });
        this.embeddings = [];
        this.data = [];
        this.isLoaded = false;
        this.loadData();
    }

    async loadData() {
        try {
            const dataPath = path.join(__dirname, '../../data/knowledge/data.jsonl');
            const fileContent = fs.readFileSync(dataPath, 'utf8');
            const lines = fileContent.trim().split('\n');
            
            this.data = lines.map(line => JSON.parse(line));
            console.log(`Loaded ${this.data.length} entries from data.jsonl`);
            
            // Generate embeddings for all text entries
            await this.generateEmbeddings();
            this.isLoaded = true;
        } catch (error) {
            console.error('Error loading data.jsonl:', error);
            this.isLoaded = false;
        }
    }

    async generateEmbeddings() {
        try {
            console.log('Generating embeddings for all entries...');
            
            // Process in batches to avoid rate limits
            const batchSize = 10;
            for (let i = 0; i < this.data.length; i += batchSize) {
                const batch = this.data.slice(i, i + batchSize);
                const texts = batch.map(item => item.content);
                
                const response = await this.openai.embeddings.create({
                    model: "text-embedding-3-large", // More powerful embedding model
                    input: texts,
                });
                
                // Store embeddings with their corresponding data
                batch.forEach((item, index) => {
                    this.embeddings.push({
                        embedding: response.data[index].embedding,
                        text: item.content,
                        metadata: { title: item.title },
                        index: i + index
                    });
                });
                
                // Small delay to avoid rate limits
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            
            console.log(`Generated ${this.embeddings.length} embeddings`);
        } catch (error) {
            console.error('Error generating embeddings:', error);
        }
    }

    // Calculate cosine similarity between two vectors
    cosineSimilarity(a, b) {
        const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
        const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
        const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
        return dotProduct / (magnitudeA * magnitudeB);
    }

    async search(query, topK = 3) {
        if (!this.isLoaded) {
            return { error: 'Embedding system not loaded - check OPENAI environment variable' };
        }

        try {
            // Generate embedding for the query
            const response = await this.openai.embeddings.create({
                model: "text-embedding-3-large",
                input: query,
            });

            const queryEmbedding = response.data[0].embedding;

            // Calculate similarities
            const similarities = this.embeddings.map(item => ({
                ...item,
                similarity: this.cosineSimilarity(queryEmbedding, item.embedding)
            }));

            // Sort by similarity and return top K results
            const results = similarities
                .sort((a, b) => b.similarity - a.similarity)
                .slice(0, topK)
                .filter(item => item.similarity > 0.1); // Filter out very low similarities

            return {
                query,
                results: results.map(item => ({
                    text: item.text,
                    metadata: item.metadata,
                    similarity: item.similarity
                }))
            };
        } catch (error) {
            console.error('Error searching embeddings:', error);
            return { error: 'Search failed' };
        }
    }

    async searchAndFormat(query, topK = 1) {
        console.log(`Embedding search for: "${query}"`);
        const searchResult = await this.search(query, topK);
        
        if (searchResult.error) {
            console.log(`Embedding search error: ${searchResult.error}`);
            return searchResult.error;
        }

        if (searchResult.results.length === 0) {
            console.log(`No results found for: "${query}"`);
            return `No relevant information found for "${query}"`;
        }

        // Get only the best result (highest relevance)
        const bestResult = searchResult.results[0];
        console.log(`Found best result for: "${query}" - ${(bestResult.similarity * 100).toFixed(1)}% relevance`);
        
        // Format the raw result for summarization
        let rawContent = `**Best Match: ${bestResult.metadata.title}** (relevance: ${(bestResult.similarity * 100).toFixed(1)}%)\n\n`;
        
        // Use full text for summarization (no truncation yet)
        rawContent += bestResult.text;

        // Now summarize the content using random AI provider
        try {
            console.log(`Summarizing content for query: "${query}"`);
            const summarizedResponse = await aiManager.generateResponse(
                "You are a technical documentation summarizer. Summarize the following content concisely while preserving all important technical details, specifications, and key information. Keep it clear and informative.",
                `Query: "${query}"\n\nContent to summarize:\n\n${rawContent}`,
                300 // Limit output tokens for concise summary
            );
            
            if (summarizedResponse && summarizedResponse.content) {
                console.log(`Successfully summarized content for: "${query}"`);
                return summarizedResponse.content.trim();
            } else {
                console.log(`Summarization failed for: "${query}", returning truncated original`);
                // Fallback to truncated original if summarization fails
                const maxTextLength = 1500;
                const truncatedText = bestResult.text.length > maxTextLength 
                    ? bestResult.text.substring(0, maxTextLength) + "..."
                    : bestResult.text;
                return `**Best Match: ${bestResult.metadata.title}** (relevance: ${(bestResult.similarity * 100).toFixed(1)}%)\n\n${truncatedText}`;
            }
        } catch (error) {
            console.error(`Summarization error for query "${query}":`, error);
            // Fallback to truncated original if summarization fails
            const maxTextLength = 1500;
            const truncatedText = bestResult.text.length > maxTextLength 
                ? bestResult.text.substring(0, maxTextLength) + "..."
                : bestResult.text;
            return `**Best Match: ${bestResult.metadata.title}** (relevance: ${(bestResult.similarity * 100).toFixed(1)}%)\n\n${truncatedText}`;
        }
    }
}

module.exports = new EmbeddingSystem();

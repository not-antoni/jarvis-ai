const OpenAI = require('openai');
const fetch = require('node-fetch');
const crypto = require('crypto');

const database = require('./database');
const aiManager = require('./ai-providers');

class EmbeddingSystem {
    constructor() {
        this.client = null;
        this.localEndpoint = process.env.LOCAL_EMBEDDING_URL || null;
        this.openAiKey = process.env.OPENAI || null;
        this.isAvailable = Boolean(this.openAiKey || this.localEndpoint);
        this.embeddingCache = new Map();
    }

    ensureClient() {
        if (!this.openAiKey) {
            throw new Error('OPENAI environment variable not set. Embedding operations are unavailable.');
        }

        if (!this.client) {
            this.client = new OpenAI({ apiKey: this.openAiKey });
        }

        return this.client;
    }

    normalizeVector(vector) {
        const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
        if (!magnitude || !Number.isFinite(magnitude)) {
            return vector.map(() => 0);
        }

        return vector.map((value) => value / magnitude);
    }

    dotProduct(a, b) {
        const length = Math.min(a.length, b.length);
        let total = 0;

        for (let index = 0; index < length; index += 1) {
            total += a[index] * b[index];
        }

        return total;
    }

    async embedWithLocal(text) {
        if (!this.localEndpoint) {
            throw new Error('Local embedding endpoint not configured.');
        }

        const response = await fetch(this.localEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text })
        });

        if (!response.ok) {
            const errorText = await response.text().catch(() => response.statusText);
            throw new Error(`Local embedding request failed: ${response.status} ${errorText}`);
        }

        const payload = await response.json();
        const vector = Array.isArray(payload?.embedding)
            ? payload.embedding.map((value) => Number(value)).filter((value) => Number.isFinite(value))
            : null;

        if (!vector || vector.length === 0) {
            throw new Error('Local embedding service returned an invalid vector.');
        }

        return vector;
    }

    async embedText(text) {
        if (!text || !text.trim()) {
            throw new Error('Cannot embed empty text');
        }

        if (!this.isAvailable) {
            throw new Error('No embedding provider configured. Set OPENAI or LOCAL_EMBEDDING_URL.');
        }

        const cacheKey = crypto.createHash('sha256').update(text).digest('hex');
        if (this.embeddingCache.has(cacheKey)) {
            return this.embeddingCache.get(cacheKey);
        }

        let vector = null;

        if (this.localEndpoint) {
            try {
                vector = await this.embedWithLocal(text);
            } catch (error) {
                console.warn('Local embedding service failed, considering OpenAI fallback:', error.message);
                if (!this.openAiKey) {
                    throw error;
                }
            }
        }

        if (!vector) {
            const client = this.ensureClient();
            const response = await client.embeddings.create({
                model: 'text-embedding-3-large',
                input: text
            });

            vector = response.data?.[0]?.embedding || [];
        }

        const normalized = this.normalizeVector(vector);
        this.embeddingCache.set(cacheKey, normalized);

        return normalized;
    }

    async generateSummary(title, text) {
        const trimmed = text.length > 6000 ? text.slice(0, 6000) : text;
        const systemPrompt = [
            'You are Jarvis, summarizing documents for a server knowledge base.',
            'Provide a concise summary (max 120 words) highlighting key points and actions.',
            'Avoid filler phrases and mention if important details seem missing.'
        ].join(' ');

        const userPrompt = [`Title: ${title || 'Untitled'}`, '', trimmed].join('\n');

        try {
            const response = await aiManager.generateResponse(systemPrompt, userPrompt, 200);
            return response?.content?.trim() || null;
        } catch (error) {
            console.warn('Failed to generate knowledge summary:', error.message);
            return null;
        }
    }

    async ingestGuildDocument({ guildId, userId, title, text, tags = [], source = 'manual' }) {
        if (!database.isConnected) {
            throw new Error('Database not connected');
        }

        if (!text || !text.trim()) {
            throw new Error('Cannot ingest empty content');
        }

        const embedding = await this.embedText(text);
        const normalizedTags = Array.isArray(tags)
            ? Array.from(new Set(tags.map((tag) => String(tag).trim()).filter(Boolean)))
            : [];

        let summary = null;
        if (text.length > 280) {
            summary = await this.generateSummary(title, text);
        }

        const entry = await database.saveKnowledgeEntry({
            guildId,
            userId,
            title: title || 'Untitled document',
            text,
            tags: normalizedTags,
            source,
            summary,
            summaryGeneratedAt: summary ? new Date() : null,
            embedding
        });

        return entry;
    }

    async searchGuildKnowledge(guildId, query, { limit = 5, threshold = 0.15 } = {}) {
        if (!database.isConnected) {
            throw new Error('Database not connected');
        }

        const entries = await database.getKnowledgeEntriesForGuild(guildId);
        if (!entries.length) {
            return [];
        }

        const queryEmbedding = await this.embedText(query);

        const scored = entries
            .map((entry) => ({
                entry,
                score: this.dotProduct(queryEmbedding, entry.embedding || [])
            }))
            .filter((item) => Number.isFinite(item.score) && item.score >= threshold)
            .sort((a, b) => b.score - a.score);

        return scored.slice(0, limit);
    }

    async formatSearchResults(guildId, query, options = {}) {
        const results = await this.searchGuildKnowledge(guildId, query, options);

        if (!results.length) {
            return { message: `No knowledge base entries matched "${query}".`, results: [] };
        }

        const lines = results.map(({ entry, score }, index) => {
            const snippetSource = entry.summary && entry.summary.trim().length >= 20
                ? entry.summary
                : entry.text;
            const preview = snippetSource.length > 240 ? `${snippetSource.slice(0, 237)}…` : snippetSource;
            const createdAt = entry.createdAt ? `<t:${Math.floor(new Date(entry.createdAt).getTime() / 1000)}:R>` : 'unknown';
            return `**${index + 1}. ${entry.title || 'Untitled'}** — ${(score * 100).toFixed(1)}% similarity\nID: ${entry._id}\nSaved ${createdAt}\n${preview}`;
        });

        return {
            message: [`Top knowledge base matches for "${query}":`, ...lines].join('\n\n'),
            results
        };
    }

    async searchAndFormat(query, topK = 3, guildId = null) {
        if (!guildId) {
            throw new Error('Guild context required for knowledge search');
        }

        const { message } = await this.formatSearchResults(guildId, query, { limit: topK });
        return message;
    }

    async answerGuildQuestion({ guildId, userId, query, limit = 3 }) {
        const { results } = await this.formatSearchResults(guildId, query, { limit });

        if (!results.length) {
            return {
                answer: `I do not have any saved knowledge for "${query}" yet, but you can add some via /kb add.`,
                sources: []
            };
        }

        const contextBlocks = results.map(({ entry, score }, index) => {
            return [
                `Source ${index + 1}: ${entry.title || 'Untitled'} (ID: ${entry._id}, similarity ${(score * 100).toFixed(1)}%)`,
                entry.text
            ].join('\n');
        });

        const systemPrompt = 'You are Jarvis, an assistant that answers questions using provided server knowledge. Respond concisely, cite sources using [Sx] markers matching the provided source order, and mention when information is missing.';
        const userPrompt = [`Question: ${query}`, '', ...contextBlocks].join('\n');

        try {
            const response = await aiManager.generateResponse(systemPrompt, userPrompt, 450);

            const answer = response?.content?.trim() || 'I encountered an issue while generating an answer, sir.';
            const sources = results.map(({ entry }, index) => ({
                label: `[S${index + 1}] ${entry.title || 'Untitled'}`,
                id: entry._id
            }));

            return { answer, sources };
        } catch (error) {
            console.error('Failed to generate knowledge-based answer:', error);
            return {
                answer: 'I could not generate an answer from the knowledge base at this time, sir.',
                sources: []
            };
        }
    }
}

module.exports = new EmbeddingSystem();

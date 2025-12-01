/**
 * FreeAIProvider - Easy setup for free AI API providers
 * Supports OpenRouter, Groq, and Google AI Studio - all have free tiers
 */

const OpenAI = require('openai');

/**
 * Free tier AI models available
 */
const FREE_MODELS = {
    // OpenRouter free models
    openrouter: {
        'nvidia/nemotron-nano-9b-v2:free': {
            name: 'Nemotron Nano 9B',
            provider: 'nvidia',
            contextWindow: 32768,
            description: 'Fast, free model from NVIDIA'
        },
        'meta-llama/llama-3.2-1b-instruct:free': {
            name: 'Llama 3.2 1B',
            provider: 'meta',
            contextWindow: 131072,
            description: 'Small but capable Llama model'
        },
        'meta-llama/llama-3.2-3b-instruct:free': {
            name: 'Llama 3.2 3B',
            provider: 'meta',
            contextWindow: 131072,
            description: 'Balanced Llama model'
        },
        'google/gemma-2-9b-it:free': {
            name: 'Gemma 2 9B',
            provider: 'google',
            contextWindow: 8192,
            description: 'Google Gemma open model'
        },
        'mistralai/mistral-7b-instruct:free': {
            name: 'Mistral 7B',
            provider: 'mistral',
            contextWindow: 32768,
            description: 'Popular Mistral model'
        }
    },
    // Groq free tier (rate limited but very fast)
    groq: {
        'llama-3.3-70b-versatile': {
            name: 'Llama 3.3 70B',
            provider: 'meta',
            contextWindow: 128000,
            description: 'Best free model - very capable'
        },
        'llama-3.1-8b-instant': {
            name: 'Llama 3.1 8B',
            provider: 'meta',
            contextWindow: 128000,
            description: 'Fast and efficient'
        },
        'mixtral-8x7b-32768': {
            name: 'Mixtral 8x7B',
            provider: 'mistral',
            contextWindow: 32768,
            description: 'MoE model, good for coding'
        },
        'gemma2-9b-it': {
            name: 'Gemma 2 9B',
            provider: 'google',
            contextWindow: 8192,
            description: 'Google Gemma on Groq'
        }
    }
};

/**
 * Simple AI provider wrapper for free APIs
 */
class FreeAIProvider {
    constructor(config = {}) {
        this.config = {
            provider: config.provider || 'auto', // 'openrouter', 'groq', 'auto'
            model: config.model || null,
            temperature: config.temperature ?? 0.7,
            maxTokens: config.maxTokens || 2048,
            ...config
        };

        this.clients = new Map();
        this.currentProvider = null;
        this.currentModel = null;
        this.metrics = {
            calls: 0,
            successes: 0,
            failures: 0,
            totalTokens: 0
        };

        this._setupProviders();
    }

    /**
     * Setup available providers based on environment variables
     */
    _setupProviders() {
        // Check OpenRouter (support multiple keys like OPENROUTER_API_KEY, OPENROUTER_API_KEY2, etc)
        const openRouterKeys = Object.keys(process.env)
            .filter(k => k.startsWith('OPENROUTER_API_KEY'))
            .map(k => process.env[k])
            .filter(Boolean);
        
        if (openRouterKeys.length > 0) {
            // Use first key, store all for rotation
            this._openRouterKeys = openRouterKeys;
            this._openRouterKeyIndex = 0;
            this.clients.set('openrouter', new OpenAI({
                apiKey: openRouterKeys[0],
                baseURL: 'https://openrouter.ai/api/v1',
                defaultHeaders: {
                    'HTTP-Referer': process.env.APP_URL || 'https://jarvis-ai.local',
                    'X-Title': 'Jarvis AI Agent'
                }
            }));
            console.log(`[FreeAIProvider] Found ${openRouterKeys.length} OpenRouter key(s)`);
        }

        // Check Groq (support multiple keys)
        const groqKeys = Object.keys(process.env)
            .filter(k => k.startsWith('GROQ_API_KEY'))
            .map(k => process.env[k])
            .filter(Boolean);
        
        if (groqKeys.length > 0) {
            this._groqKeys = groqKeys;
            this._groqKeyIndex = 0;
            this.clients.set('groq', new OpenAI({
                apiKey: groqKeys[0],
                baseURL: 'https://api.groq.com/openai/v1'
            }));
            console.log(`[FreeAIProvider] Found ${groqKeys.length} Groq key(s)`);
        }
        
        // Check Google AI
        const googleKey = process.env.GOOGLE_AI_API_KEY || process.env.GOOGLE_AI_API_KEY2;
        if (googleKey) {
            // Note: Google AI uses different SDK, storing key for now
            this._googleKey = googleKey;
            console.log(`[FreeAIProvider] Google AI key found`);
        }

        // Select provider
        if (this.config.provider === 'auto') {
            // Prefer Groq (faster), fallback to OpenRouter
            if (this.clients.has('groq')) {
                this.currentProvider = 'groq';
                this.currentModel = this.config.model || 'llama-3.3-70b-versatile';
            } else if (this.clients.has('openrouter')) {
                this.currentProvider = 'openrouter';
                this.currentModel = this.config.model || 'nvidia/nemotron-nano-9b-v2:free';
            }
        } else {
            this.currentProvider = this.config.provider;
            this.currentModel = this.config.model || this._getDefaultModel(this.config.provider);
        }

        if (this.currentProvider) {
            console.log(`[FreeAIProvider] Using ${this.currentProvider} with model ${this.currentModel}`);
        }
    }

    /**
     * Get default model for provider
     */
    _getDefaultModel(provider) {
        const defaults = {
            openrouter: 'nvidia/nemotron-nano-9b-v2:free',
            groq: 'llama-3.3-70b-versatile'
        };
        return defaults[provider] || 'llama-3.3-70b-versatile';
    }

    /**
     * Check if provider is available
     */
    isAvailable() {
        return this.clients.size > 0 && this.currentProvider !== null;
    }

    /**
     * Get available providers
     */
    getAvailableProviders() {
        return Array.from(this.clients.keys());
    }

    /**
     * Switch provider
     */
    setProvider(provider, model = null) {
        if (!this.clients.has(provider)) {
            throw new Error(`Provider ${provider} not configured. Set ${provider.toUpperCase()}_API_KEY environment variable.`);
        }
        this.currentProvider = provider;
        this.currentModel = model || this._getDefaultModel(provider);
    }

    /**
     * Generate response - compatible with AIProviderManager interface
     */
    async generateResponse(systemPrompt, userPrompt, maxTokens = null) {
        if (!this.isAvailable()) {
            throw new Error(
                'No AI provider available. Set one of these environment variables:\n' +
                '  - OPENROUTER_API_KEY (get free at https://openrouter.ai)\n' +
                '  - GROQ_API_KEY (get free at https://console.groq.com)'
            );
        }

        // Ensure prompts are strings (required by some providers like Groq)
        systemPrompt = systemPrompt != null ? String(systemPrompt) : '';
        userPrompt = userPrompt != null ? String(userPrompt) : '';

        this.metrics.calls++;
        const startTime = Date.now();

        try {
            const client = this.clients.get(this.currentProvider);
            
            const response = await client.chat.completions.create({
                model: this.currentModel,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                max_tokens: maxTokens || this.config.maxTokens,
                temperature: this.config.temperature
            });

            const content = response.choices?.[0]?.message?.content;
            
            if (!content) {
                throw new Error('Empty response from AI provider');
            }

            this.metrics.successes++;
            this.metrics.totalTokens += response.usage?.total_tokens || 0;

            return {
                content: content.trim(),
                provider: `${this.currentProvider}/${this.currentModel}`,
                usage: response.usage,
                latency: Date.now() - startTime
            };

        } catch (error) {
            this.metrics.failures++;
            
            // Try fallback provider if available
            if (this.clients.size > 1) {
                const fallback = this._getFallbackProvider();
                if (fallback) {
                    console.warn(`[FreeAIProvider] ${this.currentProvider} failed, trying ${fallback}...`);
                    const prevProvider = this.currentProvider;
                    this.currentProvider = fallback;
                    this.currentModel = this._getDefaultModel(fallback);
                    
                    try {
                        const result = await this.generateResponse(systemPrompt, userPrompt, maxTokens);
                        return result;
                    } finally {
                        // Restore original provider
                        this.currentProvider = prevProvider;
                    }
                }
            }

            throw error;
        }
    }

    /**
     * Get fallback provider
     */
    _getFallbackProvider() {
        for (const provider of this.clients.keys()) {
            if (provider !== this.currentProvider) {
                return provider;
            }
        }
        return null;
    }

    /**
     * Get provider statistics
     */
    getStats() {
        return {
            currentProvider: this.currentProvider,
            currentModel: this.currentModel,
            availableProviders: this.getAvailableProviders(),
            metrics: { ...this.metrics },
            successRate: this.metrics.calls > 0 
                ? ((this.metrics.successes / this.metrics.calls) * 100).toFixed(1) + '%'
                : 'N/A'
        };
    }

    /**
     * List all free models
     */
    static listFreeModels() {
        return FREE_MODELS;
    }

    /**
     * Get setup instructions
     */
    static getSetupInstructions() {
        return `
╔══════════════════════════════════════════════════════════════╗
║           FREE AI PROVIDER SETUP INSTRUCTIONS               ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  Option 1: OpenRouter (Recommended for variety)              ║
║  ─────────────────────────────────────────────               ║
║  1. Go to https://openrouter.ai                              ║
║  2. Sign up (free, no credit card)                           ║
║  3. Get your API key from dashboard                          ║
║  4. Set: OPENROUTER_API_KEY=sk-or-...                        ║
║                                                              ║
║  Free models: Nemotron, Llama 3.2, Gemma 2, Mistral          ║
║                                                              ║
║  Option 2: Groq (Recommended for speed)                      ║
║  ──────────────────────────────────────                      ║
║  1. Go to https://console.groq.com                           ║
║  2. Sign up (free, no credit card)                           ║
║  3. Get your API key                                         ║
║  4. Set: GROQ_API_KEY=gsk_...                                ║
║                                                              ║
║  Free models: Llama 3.3 70B (best!), Mixtral, Gemma 2        ║
║  Note: Rate limited but VERY fast                            ║
║                                                              ║
║  Option 3: Google AI Studio                                  ║
║  ─────────────────────────────                               ║
║  1. Go to https://aistudio.google.com                        ║
║  2. Get API key                                              ║
║  3. Set: GOOGLE_AI_API_KEY=...                               ║
║                                                              ║
║  Free: Gemini 2.0 Flash (very capable)                       ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`;
    }
}

/**
 * Quick setup helper
 */
async function setupFreeAI(options = {}) {
    const provider = new FreeAIProvider(options);
    
    if (!provider.isAvailable()) {
        console.log(FreeAIProvider.getSetupInstructions());
        return null;
    }

    return provider;
}

module.exports = {
    FreeAIProvider,
    setupFreeAI,
    FREE_MODELS
};


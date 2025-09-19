/**
 * AI Provider Manager with smart switching and fallback logic
 */

const OpenAI = require("openai");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { createOpenAI } = require("@ai-sdk/openai");
const cohere = require("cohere-ai");
const config = require('./config');

class AIProviderManager {
    constructor() {
        this.providers = [];
        this.providerErrors = new Map();
        this.metrics = new Map();
        this.disabledProviders = new Map();
        this.useRandomSelection = true; // Default to random selection
        this.openRouterGlobalFailure = false; // Track if OpenRouter is globally failing
        this.openRouterFailureCount = 0; // Count consecutive OpenRouter failures
        this.setupProviders();
    }

    setupProviders() {
        // OpenRouter providers
        const openRouterKeys = [
            process.env.OPENROUTER_API_KEY,
            process.env.OPENROUTER_API_KEY2,
            process.env.OPENROUTER_API_KEY3,
            process.env.OPENROUTER_API_KEY4,
            process.env.OPENROUTER_API_KEY5,
            process.env.OPENROUTER_API_KEY6,
            process.env.OPENROUTER_API_KEY7,
            process.env.OPENROUTER_API_KEY8,
            process.env.OPENROUTER_API_KEY9,
            process.env.OPENROUTER_API_KEY10,
            process.env.OPENROUTER_API_KEY11,
        ].filter(Boolean);
        
        openRouterKeys.forEach((key, index) => {
            this.providers.push({
                name: `OpenRouter${index + 1}`,
                client: new OpenAI({
                    apiKey: key,
                    baseURL: "https://openrouter.ai/api/v1",
                }),
                model: "openrouter/sonoma-sky-alpha",
                type: "openai-chat",
            });
        });

        // Groq providers
        const groqKeys = [
            process.env.GROQ_API_KEY,
            process.env.GROQ_API_KEY2,
            process.env.GROQ_API_KEY3,
        ].filter(Boolean);
        
        groqKeys.forEach((key, index) => {
            this.providers.push({
                name: `Groq${index + 1}`,
                client: new OpenAI({
                    apiKey: key,
                    baseURL: "https://api.groq.com/openai/v1",
                }),
                model: "qwen/qwen3-32b",
                type: "openai-chat",
            });
        });

        // Google AI providers
        const googleKeys = [
            process.env.GOOGLE_AI_API_KEY,
            process.env.GOOGLE_AI_API_KEY2,
        ].filter(Boolean);
        
        googleKeys.forEach((key, index) => {
            this.providers.push({
                name: `GoogleAI${index + 1}`,
                client: new GoogleGenerativeAI(key),
                model: "models/gemma-3-12b-it",
                type: "google",
            });
        });

        // Mixtral providers
        const mixtralKeys = [
            process.env.MIXTRAL_API_KEY,
            process.env.MIXTRAL_API_KEY2,
        ].filter(Boolean);
        
        mixtralKeys.forEach((key, index) => {
            this.providers.push({
                name: `Mixtral${index + 1}`,
                client: new OpenAI({
                    apiKey: key,
                    baseURL: "https://api.mistral.ai/v1",
                }),
                model: "open-mixtral-8x22b",
                type: "openai-chat",
            });
        });

        // HuggingFace providers
        const hfKeys = [
            process.env.HF_TOKEN,
            process.env.HF_TOKEN2,
        ].filter(Boolean);
        
        hfKeys.forEach((key, index) => {
            this.providers.push({
                name: `HuggingFace${index + 1}`,
                client: new OpenAI({
                    apiKey: key,
                    baseURL: "https://router.huggingface.co/v1",
                }),
                model: "meta-llama/Meta-Llama-3.1-8B-Instruct",
                type: "openai-chat",
            });
        });

        // Vercel AI SDK OpenAI provider
        if (process.env.OPENAI_API_KEY) {
            this.providers.push({
                name: "VercelOpenAI",
                client: new OpenAI({
                    apiKey: process.env.OPENAI_API_KEY,
                }),
                model: "gpt-4o-mini",
                type: "openai-chat",
            });
        }


        // GPT-5 Nano provider
        if (process.env.OPENAI) {
            this.providers.push({
                name: "GPT5Nano",
                client: new OpenAI({
                    apiKey: process.env.OPENAI,
                }),
                model: "gpt-5-nano",
                type: "gpt5-nano",
            });
        }

        // Cohere providers
        const cohereKeys = [
            process.env.COHERE_API_KEY,
            process.env.COHERE_API_KEY2,
        ].filter(Boolean);
        
        cohereKeys.forEach((key, index) => {
            this.providers.push({
                name: `Cohere${index + 1}`,
                client: cohere,
                apiKey: key,
                model: "c4ai-aya-expanse-32b",
                type: "cohere",
            });
        });

        console.log(`Initialized ${this.providers.length} AI providers`);
        console.log(`Provider selection mode: ${this.useRandomSelection ? 'Random' : 'Ranked'}`);
    }

    _rankedProviders() {
        const now = Date.now();
        return [...this.providers]
            .filter((p) => {
                const disabledUntil = this.disabledProviders.get(p.name);
                const isDisabled = disabledUntil && disabledUntil > now;
                
                // Skip OpenRouter providers if there's a global failure
                if (p.name.startsWith('OpenRouter') && this.openRouterGlobalFailure) {
                    return false;
                }
                
                return !isDisabled;
            })
            .sort((a, b) => {
                const ma = this.metrics.get(a.name) || {
                    successes: 0,
                    failures: 0,
                    avgLatencyMs: 1500,
                };
                const mb = this.metrics.get(b.name) || {
                    successes: 0,
                    failures: 0,
                    avgLatencyMs: 1500,
                };
                
                const score = (m) => {
                    const trials = m.successes + m.failures || 1;
                    const successRate = m.successes / trials;
                    const latencyScore = 1 / Math.max(m.avgLatencyMs, 1);
                    return successRate * 0.7 + latencyScore * 0.3;
                };
                
                return score(mb) - score(ma);
            });
    }

    _getRandomProvider() {
        const now = Date.now();
        const availableProviders = this.providers.filter((p) => {
            const disabledUntil = this.disabledProviders.get(p.name);
            const isDisabled = disabledUntil && disabledUntil > now;
            
            // Skip OpenRouter providers if there's a global failure
            if (p.name.startsWith('OpenRouter') && this.openRouterGlobalFailure) {
                return false;
            }
            
            return !isDisabled;
        });
        
        if (availableProviders.length === 0) {
            return null;
        }
        
        // Select a random provider from available ones
        const randomIndex = Math.floor(Math.random() * availableProviders.length);
        return availableProviders[randomIndex];
    }

    async _retryOpenRouterRequest(provider, systemPrompt, userPrompt, maxTokens, retryCount = 0) {
        const maxRetries = 1; // Reduced from 2 to 1 for faster fallback
        
        try {
            const baseParams = {
                model: provider.model,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userPrompt },
                ],
                max_tokens: maxTokens,
                temperature: config.ai.temperature,
            };

            const response = await provider.client.chat.completions.create(baseParams);
            
            // Validate response
            if (!response || !response.choices || !Array.isArray(response.choices) || response.choices.length === 0) {
                throw new Error(`Invalid response structure from ${provider.name}`);
            }
            
            const choice = response.choices[0];
            if (!choice || !choice.message || typeof choice.message.content !== 'string') {
                throw new Error(`Invalid choice structure from ${provider.name}`);
            }
            
            if (!choice.message.content.trim()) {
                throw new Error(`Empty response content from ${provider.name}`);
            }
            
            return response;
            
        } catch (error) {
            if (retryCount < maxRetries && error.message.includes('Empty response content')) {
                console.log(`OpenRouter retry ${retryCount + 1}/${maxRetries} for ${provider.name} - ${error.message}`);
                // Add a small delay before retry
                await new Promise(resolve => setTimeout(resolve, 200)); // Reduced delay
                return this._retryOpenRouterRequest(provider, systemPrompt, userPrompt, maxTokens, retryCount + 1);
            }
            console.log(`OpenRouter ${provider.name} failed after ${retryCount + 1} attempts: ${error.message}`);
            throw error;
        }
    }

    _recordMetric(name, ok, latencyMs) {
        const m = this.metrics.get(name) || {
            successes: 0,
            failures: 0,
            avgLatencyMs: 1500,
        };
        
        if (ok) m.successes += 1;
        else m.failures += 1;
        
        m.avgLatencyMs = m.avgLatencyMs * 0.7 + latencyMs * 0.3;
        this.metrics.set(name, m);
    }

    async generateResponse(systemPrompt, userPrompt, maxTokens = config.ai.maxTokens) {
        if (this.providers.length === 0) {
            throw new Error("No AI providers available");
        }
        
        let candidates;
        
        if (this.useRandomSelection) {
            // Try random provider first, then fall back to ranked providers
            const randomProvider = this._getRandomProvider();
            const rankedProviders = this._rankedProviders();
            
            // Create candidates list: random provider first, then ranked providers (excluding the random one)
            candidates = randomProvider ? 
                [randomProvider, ...rankedProviders.filter(p => p.name !== randomProvider.name)] : 
                rankedProviders;
        } else {
            // Use only ranked providers (original behavior)
            candidates = this._rankedProviders();
        }
        
        let lastError = null;
        let backoff = 1000;

        for (const provider of candidates) {
            const started = Date.now();
            const selectionType = this.useRandomSelection && candidates[0] === provider ? 'RANDOM' : 'FALLBACK';
            console.log(`Attempting AI request with ${provider.name} (${provider.model}) [${selectionType}]`);
            
            try {
                let response;
                
                if (provider.type === "google") {
                    const model = provider.client.getGenerativeModel({
                        model: provider.model,
                    });
                    const result = await model.generateContent({
                        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
                        generationConfig: {
                            reasoning_effort: "none"
                        }
                    });
                    const text = result.response?.text?.();
                    
                    if (!text || typeof text !== "string") {
                        throw new Error(`Invalid or empty response from ${provider.name}`);
                    }
                    
                    response = {
                        choices: [{ message: { content: text } }],
                    };
                } else if (provider.type === "gpt5-nano") {
                    // GPT-5 Nano with low reasoning and fixed temperature of 1
                    response = await provider.client.chat.completions.create({
                        model: provider.model,
                        messages: [
                            { role: "system", content: systemPrompt },
                            { role: "user", content: userPrompt }
                        ],
                        max_completion_tokens: maxTokens,
                        temperature: 1, // Fixed temperature - GPT-5 nano doesn't support below 1
                        reasoning_effort: "low",
                    });
                    
                    if (!response.choices?.[0]?.message?.content) {
                        throw new Error(`Invalid response format from ${provider.name}`);
                    }
                } else if (provider.type === "cohere") {
                    // Cohere API call
                    const cohereClient = provider.client.ClientV2(provider.apiKey);
                    const cohereResponse = await cohereClient.chat({
                        model: provider.model,
                        messages: [
                            { role: "user", content: `${systemPrompt}\n\n${userPrompt}` }
                        ],
                        max_tokens: maxTokens,
                        temperature: config.ai.temperature,
                    });
                    
                    if (!cohereResponse.text) {
                        throw new Error(`Invalid response format from ${provider.name}`);
                    }
                    
                    response = {
                        choices: [{ message: { content: cohereResponse.text } }],
                    };
                } else {
                    // Use retry logic for OpenRouter providers
                    if (provider.name.startsWith('OpenRouter')) {
                        response = await this._retryOpenRouterRequest(provider, systemPrompt, userPrompt, maxTokens);
                    } else {
                        // Prepare base parameters for other providers
                        const baseParams = {
                            model: provider.model,
                            messages: [
                                { role: "system", content: systemPrompt },
                                { role: "user", content: userPrompt },
                            ],
                            max_tokens: maxTokens,
                            temperature: config.ai.temperature,
                        };

                        // Add reasoning_effort for Groq providers
                        if (provider.name.startsWith('Groq')) {
                            baseParams.reasoning_effort = "none";
                        }

                        response = await provider.client.chat.completions.create(baseParams);
                        
                        // More robust response validation
                        if (!response || !response.choices || !Array.isArray(response.choices) || response.choices.length === 0) {
                            console.error(`Debug - ${provider.name} invalid response structure:`, JSON.stringify(response, null, 2));
                            throw new Error(`Invalid response format from ${provider.name} - no choices array`);
                        }
                        
                        const choice = response.choices[0];
                        if (!choice || !choice.message || typeof choice.message.content !== 'string') {
                            console.error(`Debug - ${provider.name} invalid choice structure:`, JSON.stringify(choice, null, 2));
                            throw new Error(`Invalid response format from ${provider.name} - no message content`);
                        }
                        
                        // Check if content is empty or just whitespace
                        if (!choice.message.content.trim()) {
                            console.error(`Debug - ${provider.name} empty content:`, JSON.stringify(choice, null, 2));
                            throw new Error(`Empty response content from ${provider.name}`);
                        }
                    }
                }
                
                this.providerErrors.delete(provider.name);
                const latency = Date.now() - started;
                this._recordMetric(provider.name, true, latency);
                
                // Reset OpenRouter failure counter on success
                if (provider.name.startsWith('OpenRouter')) {
                    this.openRouterFailureCount = 0;
                }
                
                console.log(`Success with ${provider.name} (${provider.model}) in ${latency}ms`);
                
                return {
                    content: response.choices[0].message.content.trim(),
                    provider: provider.name,
                };
            } catch (error) {
                const latency = Date.now() - started;
                this._recordMetric(provider.name, false, latency);
                this.providerErrors.set(provider.name, {
                    error: error.message,
                    timestamp: Date.now(),
                    status: error.status,
                });
                
                console.error(`Failed with ${provider.name} (${provider.model}) after ${latency}ms: ${error.message} ${error.status ? `(Status: ${error.status})` : ''}`);
                lastError = error;

                if (error.message.includes("free-models-per-day")) {
                    this.disabledProviders.set(
                        provider.name,
                        Date.now() + 5 * 60 * 60 * 1000,
                    );
                    console.log(`${provider.name} disabled for 5 hours`);
                } else if (error.message.includes("Empty response content") && provider.name.startsWith('OpenRouter')) {
                    // Track OpenRouter failures
                    this.openRouterFailureCount++;
                    
                    // If 3+ OpenRouter providers fail with empty responses, disable all OpenRouter
                    if (this.openRouterFailureCount >= 3) {
                        this.openRouterGlobalFailure = true;
                        console.log(`OpenRouter global failure detected - disabling all OpenRouter providers for 5 minutes`);
                        // Reset the counter and set a timer to re-enable
                        this.openRouterFailureCount = 0;
                        setTimeout(() => {
                            this.openRouterGlobalFailure = false;
                            console.log(`OpenRouter global failure cleared - re-enabling OpenRouter providers`);
                        }, 5 * 60 * 1000); // 5 minutes
                    }
                    
                    // Temporarily disable this specific OpenRouter provider
                    this.disabledProviders.set(
                        provider.name,
                        Date.now() + 2 * 60 * 1000, // 2 minutes
                    );
                    console.log(`${provider.name} temporarily disabled for 2 minutes due to empty responses`);
                } else if (error.status === 429) {
                    console.log(`Rate limited by ${provider.name}, waiting ${backoff}ms`);
                    await new Promise((r) => setTimeout(r, backoff));
                    backoff *= 2;
                }
            }
        }
        
        throw new Error(`All AI providers failed: ${lastError?.message || "Unknown error"}`);
    }

    getProviderStatus() {
        return this.providers.map((p) => ({
            name: p.name,
            model: p.model,
            hasError: this.providerErrors.has(p.name),
            lastError: this.providerErrors.get(p.name) || null,
            metrics: this.metrics.get(p.name) || {
                successes: 0,
                failures: 0,
                avgLatencyMs: null,
            },
        }));
    }

    getRedactedProviderStatus() {
        return this.providers.map((p) => ({
            name: this._redactProviderName(p.name),
            model: this._redactModelName(p.model),
            hasError: this.providerErrors.has(p.name),
            lastError: this.providerErrors.get(p.name) ? '[REDACTED]' : null,
            metrics: this.metrics.get(p.name) || {
                successes: 0,
                failures: 0,
                avgLatencyMs: null,
            },
        }));
    }

    _redactProviderName(name) {
        // Redact provider names but keep functionality visible
        const redactionMap = {
            'OpenRouter1': '[REDACTED]',
            'OpenRouter2': '[REDACTED]',
            'OpenRouter3': '[REDACTED]',
            'OpenRouter4': '[REDACTED]',
            'OpenRouter5': '[REDACTED]',
            'OpenRouter6': '[REDACTED]',
            'OpenRouter7': '[REDACTED]',
            'OpenRouter8': '[REDACTED]',
            'OpenRouter9': '[REDACTED]',
            'OpenRouter10': '[REDACTED]',
            'OpenRouter11': '[REDACTED]',
            'Groq1': '[REDACTED]',
            'Groq2': '[REDACTED]',
            'Groq3': '[REDACTED]',
            'GoogleAI1': '[REDACTED]',
            'GoogleAI2': '[REDACTED]',
            'Mixtral1': '[REDACTED]',
            'Mixtral2': '[REDACTED]',
            'HuggingFace1': '[REDACTED]',
            'HuggingFace2': '[REDACTED]',
            'VercelOpenAI': '[REDACTED]',
            'GPT5Nano': '[REDACTED]',
            'Cohere1': '[REDACTED]',
            'Cohere2': '[REDACTED]'
        };
        return redactionMap[name] || '[REDACTED]';
    }

    _redactModelName(model) {
        // Redact model names but keep functionality visible
        return '[REDACTED]';
    }

    // Control provider selection mode
    setRandomSelection(enabled) {
        this.useRandomSelection = enabled;
        console.log(`Provider selection mode changed to: ${enabled ? 'Random' : 'Ranked'}`);
    }

    getSelectionMode() {
        return this.useRandomSelection ? 'random' : 'ranked';
    }

    // Clean up old metrics to prevent memory leaks
    cleanupOldMetrics() {
        const now = Date.now();
        const maxAge = 24 * 60 * 60 * 1000; // 24 hours
        
        for (const [name, error] of this.providerErrors.entries()) {
            if (now - error.timestamp > maxAge) {
                this.providerErrors.delete(name);
            }
        }
        
        // Clean up disabled providers
        for (const [name, disabledUntil] of this.disabledProviders.entries()) {
            if (disabledUntil <= now) {
                this.disabledProviders.delete(name);
            }
        }
    }
}

module.exports = new AIProviderManager();

/**
 * AI Provider Manager with smart switching and fallback logic
 */

const OpenAI = require("openai");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { createOpenAI } = require("@ai-sdk/openai");
const config = require('./config');

class AIProviderManager {
    constructor() {
        this.providers = [];
        this.providerErrors = new Map();
        this.metrics = new Map();
        this.disabledProviders = new Map();
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
        ].filter(Boolean);
        
        openRouterKeys.forEach((key, index) => {
            this.providers.push({
                name: `OpenRouter${index + 1}`,
                client: new OpenAI({
                    apiKey: key,
                    baseURL: "https://openrouter.ai/api/v1",
                }),
                model: "deepseek/deepseek-chat-v3.1:free",
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
                model: "llama-3.1-8b-instant",
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
                model: "gemini-1.5-flash",
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
            const vercelOpenAI = createOpenAI({
                apiKey: process.env.OPENAI_API_KEY,
            });
            this.providers.push({
                name: "VercelOpenAI",
                client: vercelOpenAI,
                model: "gpt-4o-mini",
                type: "openai-chat",
            });
        }

        // Puter providers
        const puterTokens = [
            process.env.PUTER_TOKEN,
            process.env.PUTER_TOKEN2,
        ].filter(Boolean);
        
        puterTokens.forEach((token, index) => {
            this.providers.push({
                name: `Puter${index + 1}`,
                client: {
                    token: token,
                    baseURL: "https://api.puter.com",
                },
                model: "gpt-4.1-nano", // Default model based on Puter docs
                type: "puter",
            });
        });

        console.log(`Initialized ${this.providers.length} AI providers`);
    }

    _rankedProviders() {
        const now = Date.now();
        return [...this.providers]
            .filter((p) => {
                const disabledUntil = this.disabledProviders.get(p.name);
                return !disabledUntil || disabledUntil <= now;
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
        
        const candidates = this._rankedProviders();
        let lastError = null;
        let backoff = 1000;

        for (const provider of candidates) {
            const started = Date.now();
            console.log(`Attempting AI request with ${provider.name} (${provider.model})`);
            
            try {
                let response;
                
                if (provider.type === "google") {
                    const model = provider.client.getGenerativeModel({
                        model: provider.model,
                    });
                    const result = await model.generateContent(userPrompt);
                    const text = result.response?.text?.();
                    
                    if (!text || typeof text !== "string") {
                        throw new Error(`Invalid or empty response from ${provider.name}`);
                    }
                    
                    response = {
                        choices: [{ message: { content: text } }],
                    };
                } else if (provider.type === "puter") {
                    // Make HTTP request to Puter API using the correct drivers/call endpoint
                    const fetch = require('node-fetch');
                    const apiUrl = `${provider.client.baseURL}/drivers/call`;
                    
                    const requestBody = {
                        interface: "puter-chat-completion",
                        driver: "openai-completion",
                        test_mode: false,
                        method: "complete",
                        args: {
                            messages: [
                                { role: "system", content: systemPrompt },
                                { role: "user", content: userPrompt }
                            ],
                            model: provider.model,
                            temperature: config.ai.temperature,
                            max_tokens: maxTokens
                        }
                    };
                    
                    const apiResponse = await fetch(apiUrl, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json;charset=UTF-8',
                            'Authorization': `Bearer ${provider.client.token}`,
                            'Origin': 'https://ai-23-wafrt.puter.site',
                            'Referer': 'https://ai-23-wafrt.puter.site/',
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
                        },
                        body: JSON.stringify(requestBody)
                    });
                    
                    if (!apiResponse.ok) {
                        throw new Error(`Puter API error: ${apiResponse.status} ${apiResponse.statusText}`);
                    }
                    
                    const apiData = await apiResponse.json();
                    
                    if (!apiData.success || !apiData.result || !apiData.result.message || !apiData.result.message.content) {
                        throw new Error(`Invalid response format from ${provider.name}: ${JSON.stringify(apiData)}`);
                    }
                    
                    response = {
                        choices: [{ message: { content: apiData.result.message.content } }],
                    };
                } else {
                    response = await provider.client.chat.completions.create({
                        model: provider.model,
                        messages: [
                            { role: "system", content: systemPrompt },
                            { role: "user", content: userPrompt },
                        ],
                        max_tokens: maxTokens,
                        temperature: config.ai.temperature,
                    });
                    
                    if (!response.choices?.[0]?.message?.content) {
                        throw new Error(`Invalid response format from ${provider.name}`);
                    }
                }
                
                this.providerErrors.delete(provider.name);
                const latency = Date.now() - started;
                this._recordMetric(provider.name, true, latency);
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
            'Puter1': '[REDACTED]',
            'Puter2': '[REDACTED]'
        };
        return redactionMap[name] || '[REDACTED]';
    }

    _redactModelName(model) {
        // Redact model names but keep functionality visible
        return '[REDACTED]';
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

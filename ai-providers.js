const fs = require('fs');
const path = require('path');
const OpenAI = require("openai");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { createOpenAI } = require("@ai-sdk/openai");
const config = require('./config');
const fsp = fs.promises;

const PROVIDER_STATE_PATH = path.join(__dirname, 'provider-state.json');
const COST_PRIORITY = {
    free: 0,
    freemium: 1,
    paid: 2
};

function resolveCostPriority(provider) {
    const tier = provider.costTier || 'paid';
    if (Object.prototype.hasOwnProperty.call(COST_PRIORITY, tier)) {
        return COST_PRIORITY[tier];
    }
    return COST_PRIORITY.paid;
}

class AIProviderManager {
    constructor() {
        this.providers = [];
        this.providerErrors = new Map();
        this.metrics = new Map();
        this.disabledProviders = new Map();
        this.useRandomSelection = true; // Default to random selection
        this.openRouterGlobalFailure = false; // Track if OpenRouter is globally failing
        this.openRouterFailureCount = 0; // Count consecutive OpenRouter failures
        this.selectedProviderType = config.ai.provider || "auto"; // Get provider selection from config
        this.stateSaveTimer = null;
        this.stateSaveDebounceMs = 1500;
        this.stateDirty = false;
        this.setupProviders();
        this.loadState();
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
            process.env.OPENROUTER_API_KEY12,
            process.env.OPENROUTER_API_KEY13,
            process.env.OPENROUTER_API_KEY14,
            process.env.OPENROUTER_API_KEY15,
            process.env.OPENROUTER_API_KEY16,
            process.env.OPENROUTER_API_KEY17,
        ].filter(Boolean);
        
        openRouterKeys.forEach((key, index) => {
            this.providers.push({
                name: `OpenRouter${index + 1}`,
                client: new OpenAI({
                    apiKey: key,
                    baseURL: "https://openrouter.ai/api/v1",
                }),
                model: "meta-llama/llama-3.3-70b-instruct:free",
                type: "openai-chat",
                family: "openrouter",
                costTier: "free",
            });
        });

        // Groq providers
        const groqKeys = [
            process.env.GROQ_API_KEY,
            process.env.GROQ_API_KEY2,
            process.env.GROQ_API_KEY3,
            process.env.GROQ_API_KEY4,
            process.env.GROQ_API_KEY5,
            process.env.GROQ_API_KEY6,
			process.env.GROQ_API_KEY7,
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
                family: "groq",
                costTier: "free",
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
                model: "gemini-2.5-flash",
                type: "google",
                family: "google",
                costTier: "free",
            });
        });

        

// DeepSeek via Vercel AI Gateway (OpenAI-compatible)
const deepseekGatewayKeys = [
    process.env.AI_GATEWAY_API_KEY,
    process.env.AI_GATEWAY_API_KEY2,
].filter(Boolean);

deepseekGatewayKeys.forEach((key, index) => {
    this.providers.push({
        name: `deepseek-gateway-${index + 1}`,
        client: new OpenAI({
            apiKey: key,
            baseURL: "https://ai-gateway.vercel.sh/v1/ai",
        }),
        // Vercel Gateway uses provider/model format
        model: "deepseek/deepseek-v3.2-exp",
        type: "deepseek",
        family: "deepseek",
        costTier: "paid",
    });
});

// GPT-5 Nano provider
        if (process.env.OPENAI) {
            this.providers.push({
                name: "GPT5Nano",
                client: new OpenAI({
                    apiKey: process.env.OPENAI,
                }),
                model: "gpt-5-nano",
                type: "gpt5-nano",
                family: "openai",
                costTier: "paid",
            });
        }

        this.providers.sort((a, b) => resolveCostPriority(a) - resolveCostPriority(b));

        console.log(`Initialized ${this.providers.length} AI providers`);
        console.log(`Provider selection mode: ${this.useRandomSelection ? 'Random' : 'Ranked'}`);
        console.log(`Selected provider type: ${this.selectedProviderType}`);
    }

    loadState() {
        try {
            if (!fs.existsSync(PROVIDER_STATE_PATH)) {
                return;
            }

            const raw = fs.readFileSync(PROVIDER_STATE_PATH, 'utf8');
            if (!raw.trim()) {
                return;
            }

            const data = JSON.parse(raw);

            if (data.metrics && typeof data.metrics === 'object') {
                for (const [name, metric] of Object.entries(data.metrics)) {
                    if (this.providers.find((provider) => provider.name === name) && metric) {
                        this.metrics.set(name, {
                            successes: Number(metric.successes) || 0,
                            failures: Number(metric.failures) || 0,
                            avgLatencyMs: Number(metric.avgLatencyMs) || 0,
                        });
                    }
                }
            }

            if (data.disabledProviders && typeof data.disabledProviders === 'object') {
                const now = Date.now();
                for (const [name, disabledUntil] of Object.entries(data.disabledProviders)) {
                    const parsed = Number(disabledUntil);
                    if (Number.isFinite(parsed) && parsed > now && this.providers.find((provider) => provider.name === name)) {
                        this.disabledProviders.set(name, parsed);
                    }
                }
            }

            if (data.providerErrors && typeof data.providerErrors === 'object') {
                for (const [name, errorInfo] of Object.entries(data.providerErrors)) {
                    if (errorInfo && typeof errorInfo === 'object' && this.providers.find((provider) => provider.name === name)) {
                        this.providerErrors.set(name, errorInfo);
                    }
                }
            }

            if (typeof data.openRouterGlobalFailure === 'boolean') {
                this.openRouterGlobalFailure = data.openRouterGlobalFailure;
            }

            if (typeof data.openRouterFailureCount === 'number') {
                this.openRouterFailureCount = data.openRouterFailureCount;
            }

            console.log('Restored AI provider cache from disk');
        } catch (error) {
            console.warn('Failed to restore AI provider cache:', error);
        }
    }

    async saveState() {
        try {
            const payload = {
                metrics: Object.fromEntries(this.metrics),
                disabledProviders: Object.fromEntries(this.disabledProviders),
                providerErrors: Object.fromEntries(this.providerErrors),
                openRouterGlobalFailure: this.openRouterGlobalFailure,
                openRouterFailureCount: this.openRouterFailureCount,
                savedAt: new Date().toISOString(),
            };

            await fsp.writeFile(PROVIDER_STATE_PATH, JSON.stringify(payload, null, 2), 'utf8');
        } catch (error) {
            console.warn('Failed to persist AI provider cache:', error);
        }
    }

    scheduleStateSave() {
        this.stateDirty = true;
        if (this.stateSaveTimer) {
            return;
        }

        this.stateSaveTimer = setTimeout(async () => {
            this.stateSaveTimer = null;
            if (!this.stateDirty) {
                return;
            }

            this.stateDirty = false;
            await this.saveState();
        }, this.stateSaveDebounceMs);
    }

    _filterProvidersByType(providers) {
        if (this.selectedProviderType === "auto") {
            return providers; // Return all providers for auto mode
        }

        return providers.filter(provider => {
            const providerName = provider.name.toLowerCase();
            
            switch (this.selectedProviderType.toLowerCase()) {
                case "openai":
                    return providerName === "gpt5nano";
                case "groq":
                    return providerName.startsWith("groq");
                case "openrouter":
                    return providerName.startsWith("openrouter");
                case "deepseek":
                    return providerName && providerName.toLowerCase().startsWith("deepseek");

                case "google":
                    return providerName.startsWith("googleai");
                default:
                    console.warn(`Unknown provider type: ${this.selectedProviderType}, falling back to auto mode`);
                    return true;
            }
        });
    }

    _rankedProviders() {
        const now = Date.now();
        const filteredProviders = this._filterProvidersByType(this.providers);
        
        return filteredProviders
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

                const priorityDelta = resolveCostPriority(a) - resolveCostPriority(b);
                if (priorityDelta !== 0) {
                    return priorityDelta;
                }

                return score(mb) - score(ma);
            });
    }

    _getRandomProvider() {
        const now = Date.now();
        const filteredProviders = this._filterProvidersByType(this.providers);
        
        const availableProviders = filteredProviders.filter((p) => {
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

        const minPriority = Math.min(...availableProviders.map((provider) => resolveCostPriority(provider)));
        const preferredProviders = availableProviders.filter((provider) => resolveCostPriority(provider) === minPriority);
        const pool = preferredProviders.length ? preferredProviders : availableProviders;
        
        // Select a random provider from available ones
        const randomIndex = Math.floor(Math.random() * pool.length);
        return pool[randomIndex];
    }

    _recordMetric(name, ok, latencyMs) {
        const m = this.metrics.get(name) || {
            successes: 0,
            failures: 0,
            avgLatencyMs: 1500,
        };
        
        if (ok) m.successes += 1;
        else m.failures += 1;
        
        if (!Number.isFinite(m.avgLatencyMs) || m.avgLatencyMs <= 0) {
            m.avgLatencyMs = latencyMs;
        } else {
            m.avgLatencyMs = m.avgLatencyMs * 0.7 + latencyMs * 0.3;
        }

        this.metrics.set(name, m);
        this.scheduleStateSave();
    }

    async generateResponse(systemPrompt, userPrompt, maxTokens = config.ai.maxTokens) {
        if (this.providers.length === 0) {
            throw new Error("No AI providers available");
        }
        
        let candidates;
        
        if (this.useRandomSelection) {
            const randomProvider = this._getRandomProvider();
            const rankedProviders = this._rankedProviders();
            candidates = randomProvider ? 
                [randomProvider, ...rankedProviders.filter(p => p.name !== randomProvider.name)] : 
                rankedProviders;
        } else {
            candidates = this._rankedProviders();
        }
        
        let lastError = null;
        let backoff = 1000;

        for (const provider of candidates) {
            const started = Date.now();
            const selectionType = this.useRandomSelection && candidates[0] === provider ? 'RANDOM' : 'FALLBACK';
            const providerTypeInfo = this.selectedProviderType === "auto" ? "[AUTO]" : `[${this.selectedProviderType.toUpperCase()}]`;
            console.log(`Attempting AI request with ${provider.name} (${provider.model}) [${selectionType}] ${providerTypeInfo}`);
            
            try {
                let response;
                
                if (provider.type === "google") {
                    const model = provider.client.getGenerativeModel({
                        model: provider.model,
                        generationConfig: {
                            temperature: config.ai.temperature,
                        ...(provider.family === "groq" ? { reasoning_effort: "none" } : {}), // 👈 disables reasoning for Groq
                            maxOutputTokens: maxTokens,
                        }
                    });
                    
                    const result = await model.generateContent({
                        contents: [
                            { role: "user", parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }
                        ],
                        generationConfig: {
                            temperature: config.ai.temperature,
                        ...(provider.family === "groq" ? { reasoning_effort: "none" } : {}), // 👈 disables reasoning for Groq
                            maxOutputTokens: maxTokens
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
                    response = await provider.client.chat.completions.create({
                        model: provider.model,
                        messages: [
                            { role: "system", content: systemPrompt },
                            { role: "user", content: userPrompt }
                        ],
                        max_completion_tokens: maxTokens,
                        temperature: 1,
                        reasoning_effort: "low",
                    });
                    
                    if (!response.choices?.[0]?.message?.content) {
                        throw new Error(`Invalid response format from ${provider.name}`);
                    }
                } else {
                    const baseParams = {
                        model: provider.model,
                        messages: [
                            { role: "system", content: systemPrompt },
                            { role: "user", content: userPrompt },
                        ],
                        max_tokens: maxTokens,
                        temperature: config.ai.temperature,
                        ...(provider.family === "groq" ? { reasoning_effort: "none" } : {}), // 👈 disables reasoning for Groq
                    };

                    response = await provider.client.chat.completions.create(baseParams);
                    
                    if (!response || !response.choices || !Array.isArray(response.choices) || response.choices.length === 0) {
                        console.error(`Debug - ${provider.name} invalid response structure:`, JSON.stringify(response, null, 2));
                        throw new Error(`Invalid response format from ${provider.name} - no choices array`);
                    }
                    
                    const choice = response.choices[0];
                    if (!choice || !choice.message || typeof choice.message.content !== 'string') {
                        console.error(`Debug - ${provider.name} invalid choice structure:`, JSON.stringify(choice, null, 2));
                        throw new Error(`Invalid response format from ${provider.name} - no message content`);
                    }
                    
                    if (!choice.message.content.trim()) {
                        console.error(`Debug - ${provider.name} empty content:`, JSON.stringify(choice, null, 2));
                        throw new Error(`Empty response content from ${provider.name}`);
                    }
                }
                
                const cleared = this.providerErrors.delete(provider.name);
                const latency = Date.now() - started;
                this._recordMetric(provider.name, true, latency);
                if (cleared) {
                    this.scheduleStateSave();
                }
                
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
                this.scheduleStateSave();
                
                console.error(`Failed with ${provider.name} (${provider.model}) after ${latency}ms: ${error.message} ${error.status ? `(Status: ${error.status})` : ''}`);
                lastError = error;

                // Disable logic
                const isEmptyResponse = error.message.includes("empty");
                const disableDuration = isEmptyResponse ? 6 * 60 * 60 * 1000 : 12 * 60 * 60 * 1000;
                const hours = disableDuration / (60 * 60 * 1000);
                this.disabledProviders.set(provider.name, Date.now() + disableDuration);
                this.scheduleStateSave();
                console.log(`${provider.name} disabled for ${hours} hours due to ${isEmptyResponse ? 'empty response' : 'error'}`);

                // Handle OpenRouter empty response counting
                if (isEmptyResponse && provider.name.startsWith('OpenRouter')) {
                    this.openRouterFailureCount++;
                    
                    if (this.openRouterFailureCount >= 2) {
                        this.openRouterGlobalFailure = true;
                        console.log(`OpenRouter global failure detected - disabling all OpenRouter providers for ${hours} hours`);
                        this.openRouterFailureCount = 0;
                        this.scheduleStateSave();
                        setTimeout(() => {
                            this.openRouterGlobalFailure = false;
                            console.log(`OpenRouter global failure cleared - re-enabling OpenRouter providers`);
                            this.scheduleStateSave();
                        }, disableDuration);
                    }
                }
            }
        }
        
        throw new Error(`All AI providers failed: ${lastError?.message || "Unknown error"}`);
    }

    getProviderStatus() {
        const now = Date.now();

        return this.providers.map((p) => {
            const metrics = this.metrics.get(p.name) || {
                successes: 0,
                failures: 0,
                avgLatencyMs: null,
            };
            const total = metrics.successes + metrics.failures;
            const disabledUntil = this.disabledProviders.get(p.name) || null;

            return {
                name: p.name,
                model: p.model,
                type: p.type,
                family: p.family || null,
                costTier: p.costTier || 'unknown',
                priority: resolveCostPriority(p),
                hasError: this.providerErrors.has(p.name),
                lastError: this.providerErrors.get(p.name) || null,
                disabledUntil,
                isDisabled: disabledUntil ? disabledUntil > now : false,
                metrics: {
                    successes: metrics.successes,
                    failures: metrics.failures,
                    totalRequests: total,
                    successRate: total ? metrics.successes / total : null,
                    avgLatencyMs: metrics.avgLatencyMs,
                },
            };
        }).sort((a, b) => {
            if (a.priority !== b.priority) {
                return a.priority - b.priority;
            }

            const rateA = a.metrics.successRate ?? -1;
            const rateB = b.metrics.successRate ?? -1;
            if (rateA !== rateB) {
                return rateB - rateA;
            }

            return (a.metrics.avgLatencyMs ?? Number.POSITIVE_INFINITY) - (b.metrics.avgLatencyMs ?? Number.POSITIVE_INFINITY);
        });
    }

    getRedactedProviderStatus() {
        return this.getProviderStatus().map((p) => ({
            ...p,
            name: this._redactProviderName(p.name),
            model: this._redactModelName(p.model),
            lastError: p.hasError ? '[REDACTED]' : null,
        }));
    }

    getProviderAnalytics() {
        return this.getProviderStatus().map((provider) => {
            const uptimePercentage = provider.metrics.successRate != null
                ? (provider.metrics.successRate * 100)
                : null;

            return {
                name: provider.name,
                model: provider.model,
                type: provider.type,
                family: provider.family,
                costTier: provider.costTier,
                priority: provider.priority,
                metrics: {
                    successes: provider.metrics.successes,
                    failures: provider.metrics.failures,
                    total: provider.metrics.totalRequests,
                    successRate: uptimePercentage,
                    avgLatencyMs: provider.metrics.avgLatencyMs,
                },
                disabledUntil: provider.disabledUntil,
                isDisabled: provider.isDisabled,
                hasError: provider.hasError,
                lastError: provider.lastError,
            };
        });
    }

    _redactProviderName(name) {
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
            'OpenRouter12': '[REDACTED]',
            'OpenRouter13': '[REDACTED]',
            'OpenRouter14': '[REDACTED]',
            'OpenRouter15': '[REDACTED]',
            'OpenRouter16': '[REDACTED]',
            'OpenRouter17': '[REDACTED]',
            'Groq1': '[REDACTED]',
            'Groq2': '[REDACTED]',
            'Groq3': '[REDACTED]',
            'Groq4': '[REDACTED]',
            'Groq5': '[REDACTED]',
            'Groq6': '[REDACTED]',
			'Groq7': '[REDACTED]',
            'GoogleAI1': '[REDACTED]',
            'GoogleAI2': '[REDACTED]',
            'GPT5Nano': '[REDACTED]',
            'deepseek-gateway-1': '[REDACTED]',
            'deepseek-gateway-2': '[REDACTED]'
        };
        return redactionMap[name] || '[REDACTED]';
    }

    _redactModelName(model) {
        return '[REDACTED]';
    }

    setRandomSelection(enabled) {
        this.useRandomSelection = enabled;
        console.log(`Provider selection mode changed to: ${enabled ? 'Random' : 'Ranked'}`);
    }

    getSelectionMode() {
        return this.useRandomSelection ? 'random' : 'ranked';
    }

    setProviderType(providerType) {
        const validTypes = ["auto", "openai", "groq", "openrouter", "google", "deepseek"];
        if (!validTypes.includes(providerType.toLowerCase())) {
            throw new Error(`Invalid provider type. Valid options: ${validTypes.join(", ")}`);
        }
        
        this.selectedProviderType = providerType.toLowerCase();
        console.log(`Provider type changed to: ${this.selectedProviderType}`);
    }

    getProviderType() {
        return this.selectedProviderType;
    }

    getAvailableProviderTypes() {
        const types = new Set();
        this.providers.forEach(provider => {
            const name = provider.name.toLowerCase();
            if (name === "gpt5nano") {
                types.add("openai");
            } else if (name.startsWith("groq")) {
                types.add("groq");
            } else if (name.startsWith("openrouter")) {
                types.add("openrouter");
            } else if (name.startsWith("googleai")) {
                types.add("google");
            }
            else if (name.toLowerCase().startsWith("deepseek")) {
                types.add("deepseek");
            }
        });
        
        const availableTypes = Array.from(types).sort();
        availableTypes.unshift("auto");
        return availableTypes;
    }

    cleanupOldMetrics() {
        const now = Date.now();
        const maxAge = 24 * 60 * 60 * 1000;
        
        for (const [name, error] of this.providerErrors.entries()) {
            if (now - error.timestamp > maxAge) {
                this.providerErrors.delete(name);
            }
        }
        
        for (const [name, disabledUntil] of this.disabledProviders.entries()) {
            if (disabledUntil <= now) {
                this.disabledProviders.delete(name);
            }
        }
    }
}

module.exports = new AIProviderManager();

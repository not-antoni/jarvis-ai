'use strict';
const execution = require('./ai-providers-execution');
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const config = require('../../config');
const { parseBooleanEnv } = require('../utils/parse-bool-env');
const { getAIFetch } = require('./ai-proxy');
const aiFetch = getAIFetch();
const fsp = fs.promises;
const PROVIDER_STATE_PATH = path.join(__dirname, '..', '..', 'data', 'provider-state.json');
const COST_PRIORITY = { free: 0, freemium: 1, paid: 2 };
const GOOGLE_STABLE_MODELS = [
    'gemini-2.5-pro',
    'gemini-2.0-flash',
    'gemma-4-31b-it'
];
const GOOGLE_PREVIEW_MODELS = [
    'gemini-3.1-pro-preview',
    'gemini-3.1-flash-lite-preview',
    'gemini-3-pro-preview'
];
const POISON_QUARANTINE_THRESHOLD = 2;
const POISON_QUARANTINE_WINDOW_MS = 10 * 60 * 1000;
const POISON_QUARANTINE_DURATION_MS = 30 * 60 * 1000;
const DEFAULT_PROVIDER_LATENCY_MS = 1500;
const AUTO_SCORE_LATENCY_CEILING_MS = 15 * 1000;
const AUTO_HEALTH_MIN_TRIALS = 6;
const AUTO_HEALTH_DEGRADED_TRIALS = 10;
const AUTO_HEALTH_DEGRADED_LATENCY_MS = 12 * 1000;
const AUTO_FAMILY_PRIORITY = {
    mistral: 0,
    google: 1,
    deepseek: 2,
    cerebras: 3,
    groq: 4,
    sambanova: 5,
    nvidia: 6,
    openrouter: 7,
    openai: 8,
    ollama: 9,
    bedrock: 10
};
function discoverEnvKeys(prefix) {
    const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return Object.keys(process.env)
        .filter(key => new RegExp(`^${escaped}\\d*$`).test(key))
        .sort((a, b) => parseInt(a.replace(prefix, '') || '1', 10) - parseInt(b.replace(prefix, '') || '1', 10))
        .map(key => process.env[key])
        .filter(Boolean);
}
// Determine storage mode: MongoDB for Render, file for selfhost
const IS_SELFHOST = String(process.env.SELFHOST_MODE || '').toLowerCase() === 'true';
const PROVIDER_STATE_COLLECTION = 'provider_state';
// MongoDB helper for provider state (lazy loaded)
let _database = null;
async function getDatabase() {
    if (!_database) {
        try {
            _database = require('./database');
            if (!_database.isConnected) {
                await _database.connect();
            }
        } catch (e) {
            console.warn('Could not load database for provider state:', e.message);
            return null;
        }
    }
    return _database;
}
function resolveCostPriority(provider) {
    const tier = provider.costTier || 'paid';
    if (Object.prototype.hasOwnProperty.call(COST_PRIORITY, tier)) {
        return COST_PRIORITY[tier];
    }
    return COST_PRIORITY.paid;
}
function resolveAutoFamilyPriority(provider) {
    const family = String(provider?.family || '').toLowerCase();
    if (Object.prototype.hasOwnProperty.call(AUTO_FAMILY_PRIORITY, family)) {
        return AUTO_FAMILY_PRIORITY[family];
    }
    return Number.MAX_SAFE_INTEGER;
}
function getProviderMetricSnapshot(metric) {
    const successes = Number(metric?.successes) || 0;
    const failures = Number(metric?.failures) || 0;
    const total = successes + failures;
    const avgLatencyMs =
        Number.isFinite(Number(metric?.avgLatencyMs)) && Number(metric?.avgLatencyMs) > 0
            ? Number(metric.avgLatencyMs)
            : DEFAULT_PROVIDER_LATENCY_MS;
    return {
        successes,
        failures,
        total,
        avgLatencyMs,
        successRate: total > 0 ? successes / total : 0
    };
}
function computeProviderRankScore(metric) {
    const experienceScore = Math.min(metric.total, 20) / 20;
    const latencyScore = Math.max(
        0,
        1 - Math.min(metric.avgLatencyMs, AUTO_SCORE_LATENCY_CEILING_MS) / AUTO_SCORE_LATENCY_CEILING_MS
    );
    return metric.successRate * 0.45 + latencyScore * 0.45 + experienceScore * 0.10;
}
function resolveAutoHealthBucket(metric) {
    if (metric.total === 0) {
        return 1;
    }
    if (metric.successes === 0 && metric.failures >= AUTO_HEALTH_MIN_TRIALS) {
        return 3;
    }
    if (metric.total >= AUTO_HEALTH_DEGRADED_TRIALS && metric.successRate < 0.10) {
        return 3;
    }
    if (
        metric.total >= AUTO_HEALTH_DEGRADED_TRIALS &&
        metric.successRate < 0.50 &&
        metric.avgLatencyMs >= AUTO_HEALTH_DEGRADED_LATENCY_MS
    ) {
        return 2;
    }
    return 0;
}
class AIProviderManager {
    constructor() {
        this.providers = [];
        this.providerErrors = new Map();
        this.metrics = new Map();
        this.disabledProviders = new Map();
        this.disabledProviderMeta = new Map();
        this.roundRobinIndex = 0;
        this.selectedProviderType = config.ai?.provider || 'auto'; // 'auto' | 'openai' | 'groq' | 'openrouter' | 'google' | 'deepseek'
        // OpenRouter rolling outage guardrails
        this.openRouterGlobalFailure = false;
        this.openRouterFailureCount = 0;
        // Per-provider failure tracking for exponential backoff
        this.providerFailureCounts = new Map();
        this.providerPoisonCounts = new Map();
        // Persistence (5s debounce to reduce I/O)
        this.stateSaveTimer = null;
        this.stateSaveDebounceMs = 5000;
        this.stateDirty = false;
        // Token tracking
        this.totalTokensIn = 0;
        this.totalTokensOut = 0;
        this.totalRequests = 0;
        this.successfulRequests = 0;
        this.failedRequests = 0;
        // Dynamic load tracking
        this.activeRequests = 0;
        this.activeRequestsPeak = 0;
        this.loadConfig = {
            maxConcurrent: Number(process.env.AI_MAX_CONCURRENT) || 20,
            softCap: Number(process.env.AI_SOFT_CAP) || 10,
            rejectThreshold: Number(process.env.AI_REJECT_THRESHOLD) || 30
        };
        this.setupProviders();
        this.loadState();
    }
    setupProviders() {
        // ---------- OpenRouter providers ----------
        // Auto-discover all OPENROUTER_API_KEY, OPENROUTER_API_KEY2, etc.
        const openRouterKeys = discoverEnvKeys('OPENROUTER_API_KEY');
        const openRouterModels = [
            'google/gemma-4-31b-it:free'
        ];
        openRouterKeys.forEach((key, keyIndex) => {
            openRouterModels.forEach((model) => {
                const shortName = model.split('/').pop().replace(':free', '');
                this.providers.push({
                    name: `OpenRouter${keyIndex + 1}-${shortName}`,
                    client: new OpenAI({
                        apiKey: key,
                        baseURL: 'https://openrouter.ai/api/v1',
                        fetch: aiFetch,
                        timeout: 25_000,
                        defaultHeaders: {
                            'HTTP-Referer': process.env.APP_URL || process.env.PUBLIC_BASE_URL || 'https://localhost',
                            'X-Title': process.env.APP_NAME || 'Jarvis AI'
                        }
                    }),
                    model,
                    type: 'openai-chat',
                    family: 'openrouter',
                    costTier: 'free',
                    credentialGroup: `openrouter:${keyIndex + 1}`
                });
            });
        });
        // ---------- Groq providers (OpenAI-compatible) ----------
        // Auto-discover all GROQ_API_KEY, GROQ_API_KEY2, etc.
        const groqKeys = discoverEnvKeys('GROQ_API_KEY');
        // Each Groq key gets multiple model providers — rate limits are per-model
        const groqModels = [
            'llama-3.3-70b-versatile'
        ];
        groqKeys.forEach((key, keyIndex) => {
            groqModels.forEach((model) => {
                const shortName = model.includes('/') ? model.split('/').pop() : model;
                this.providers.push({
                    name: `Groq${keyIndex + 1}-${shortName}`,
                    client: new OpenAI({
                        apiKey: key,
                        baseURL: 'https://api.groq.com/openai/v1',
                        fetch: aiFetch,
                        timeout: 25_000
                    }),
                    model,
                    type: 'openai-chat',
                    family: 'groq',
                    costTier: 'free',
                    credentialGroup: `groq:${keyIndex + 1}`
                });
            });
        });
        // ---------- Cerebras providers (OpenAI-compatible) ----------
        // Auto-discover all CEREBRAS_API_KEY, CEREBRAS_API_KEY2, etc.
        const cerebrasKeys = discoverEnvKeys('CEREBRAS_API_KEY');
        const cerebrasModels = [
            'qwen-3-235b-a22b-instruct-2507',
        ];
        cerebrasKeys.forEach((key, keyIndex) => {
            cerebrasModels.forEach((model) => {
                const shortName = model.includes('/') ? model.split('/').pop() : model;
                this.providers.push({
                    name: `Cerebras${keyIndex + 1}-${shortName}`,
                    client: new OpenAI({
                        apiKey: key,
                        baseURL: 'https://api.cerebras.ai/v1',
                        fetch: aiFetch,
                        timeout: 25_000
                    }),
                    model,
                    type: 'openai-chat',
                    family: 'cerebras',
                    costTier: 'free',
                    credentialGroup: `cerebras:${keyIndex + 1}`
                });
            });
        });
        // ---------- Mistral providers (OpenAI-compatible) ----------
        // Auto-discover all MISTRAL_API_KEY, MISTRAL_API_KEY2, etc.
        const mistralKeys = discoverEnvKeys('MISTRAL_API_KEY');
        const mistralModels = [
            'mistral-medium-latest',
        ];
        mistralKeys.forEach((key, keyIndex) => {
            mistralModels.forEach((model) => {
                this.providers.push({
                    name: `Mistral${keyIndex + 1}-${model}`,
                    client: new OpenAI({
                        apiKey: key,
                        baseURL: 'https://api.mistral.ai/v1',
                        fetch: aiFetch,
                        timeout: 25_000
                    }),
                    model,
                    type: 'openai-chat',
                    family: 'mistral',
                    costTier: 'paid',
                    credentialGroup: `mistral:${keyIndex + 1}`
                });
            });
        });
        // ---------- SambaNova providers (OpenAI-compatible) ----------
        // Auto-discover all SAMBANOVA_API_KEY, SAMBANOVA_API_KEY2, etc.
        const sambanovaKeys = discoverEnvKeys('SAMBANOVA_API_KEY');
        const sambanovaModels = [
            'Meta-Llama-3.3-70B-Instruct',
        ];
        sambanovaKeys.forEach((key, keyIndex) => {
            sambanovaModels.forEach((model) => {
                const shortName = model.includes('/') ? model.split('/').pop() : model;
                this.providers.push({
                    name: `SambaNova${keyIndex + 1}-${shortName}`,
                    client: new OpenAI({
                        apiKey: key,
                        baseURL: 'https://api.sambanova.ai/v1',
                        fetch: aiFetch,
                        timeout: 25_000
                    }),
                    model,
                    type: 'openai-chat',
                    family: 'sambanova',
                    costTier: 'free',
                    credentialGroup: `sambanova:${keyIndex + 1}`
                });
            });
        });
        // ---------- Google AI (native SDK) ----------
        // Auto-discover all GOOGLE_AI_API_KEY, GOOGLE_AI_API_KEY2, etc.
        const googleKeys = discoverEnvKeys('GOOGLE_AI_API_KEY');
        // Each Google key gets multiple models — rate limits are per-model
        const googleModels = parseBooleanEnv(process.env.GOOGLE_AI_ENABLE_PREVIEW_MODELS, false)
            ? [...GOOGLE_STABLE_MODELS, ...GOOGLE_PREVIEW_MODELS]
            : GOOGLE_STABLE_MODELS;
        googleKeys.forEach((key, keyIndex) => {
            googleModels.forEach((model) => {
                this.providers.push({
                    name: `GoogleAI${keyIndex + 1}-${model}`,
                    client: new GoogleGenerativeAI(key),
                    model,
                    type: 'google',
                    family: 'google',
                    costTier: 'free',
                    credentialGroup: `google:${keyIndex + 1}`
                });
            });
        });
        // ---------- DeepSeek via Vercel AI Gateway (OpenAI-compatible) ----------
        // Auto-discover all AI_GATEWAY_API_KEY, AI_GATEWAY_API_KEY2, etc.
        const deepseekGatewayKeys = discoverEnvKeys('AI_GATEWAY_API_KEY');
        deepseekGatewayKeys.forEach((key, index) => {
            this.providers.push({
                name: `deepseek-gateway-${index + 1}`,
                client: new OpenAI({
                    apiKey: key,
                    baseURL: 'https://ai-gateway.vercel.sh/v1',
                    fetch: aiFetch,
                    timeout: 25_000,
                    defaultHeaders: {
                        'HTTP-Referer': process.env.APP_URL || process.env.PUBLIC_BASE_URL || 'https://localhost',
                        'X-Title': process.env.APP_NAME || 'Jarvis AI'
                    }
                }),
                // Vercel AI Gateway model id (verified available)
                model: 'deepseek/deepseek-v3.2',
                type: 'openai-chat',
                family: 'deepseek',
                costTier: 'paid',
                credentialGroup: `deepseek:${index + 1}`
            });
        });
        // ---------- NVIDIA NIM (OpenAI-compatible) ----------
        // Auto-discover all NVIDIA_API_KEY, NVIDIA_API_KEY2, etc.
        const nvidiaKeys = discoverEnvKeys('NVIDIA_API_KEY');
        const nvidiaModels = [
            'google/gemma-4-31b-it',
            'deepseek-ai/deepseek-v3.2'
        ];
        const nvidiaModelOverride = process.env.NVIDIA_MODEL;
        const resolvedNvidiaModels = nvidiaModelOverride ? [nvidiaModelOverride] : nvidiaModels;
        nvidiaKeys.forEach((key, keyIndex) => {
            resolvedNvidiaModels.forEach((model) => {
                const shortName = model.includes('/') ? model.split('/').pop() : model;
                this.providers.push({
                    name: `NVIDIA${keyIndex + 1}-${shortName}`,
                    client: new OpenAI({
                        apiKey: key,
                        baseURL: 'https://integrate.api.nvidia.com/v1',
                        fetch: aiFetch,
                        timeout: 25_000
                    }),
                    model,
                    type: 'openai-chat',
                    family: 'nvidia',
                    costTier: 'freemium',
                    credentialGroup: `nvidia:${keyIndex + 1}`
                });
            });
        });
        // ---------- AWS Bedrock providers (direct InvokeModel API) ----------
        const bedrockKeys = discoverEnvKeys('BEDROCK_API_KEY');
        const bedrockRegion = process.env.BEDROCK_REGION || 'us-east-1';
        const bedrockModels = ['deepseek.v3.2'];
        bedrockKeys.forEach((key, keyIndex) => {
            bedrockModels.forEach((model) => {
                const shortName = model.includes('/') ? model.split('/').pop() : model;
                this.providers.push({
                    name: `Bedrock${keyIndex + 1}-${shortName}`,
                    apiKey: key,
                    baseURL: `https://bedrock-runtime.${bedrockRegion}.amazonaws.com`,
                    model,
                    type: 'bedrock',
                    family: 'bedrock',
                    costTier: 'paid',
                    credentialGroup: `bedrock:${keyIndex + 1}`
                });
            });
        });
        // ---------- OpenAI lightweight (replace GPT-5 Nano → GPT-4o-mini) ----------
        const openAiKey = process.env.OPENAI || process.env.OPENAI_API_KEY;
        if (openAiKey) {
            const key = openAiKey;
            this.providers.push({
                // Keep the same name so your existing filters & health pages remain happy
                name: 'GPT5Nano',
                client: new OpenAI({ apiKey: key, fetch: aiFetch, timeout: 25_000 }), // https://api.openai.com/v1
                model: 'gpt-4o-mini', // ← actual model
                type: 'openai-chat', // generic OpenAI-compatible flow
                family: 'openai',
                costTier: 'paid',
                credentialGroup: 'openai:1'
            });
        }
        // ---------- Ollama providers ----------
        // Single provider per key: qwen3-vl handles both text chat and image requests.
        const ollamaKeys = discoverEnvKeys('OLLAMA_API_KEY');
        const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || 'https://ollama.com/api';

        ollamaKeys.forEach((key, index) => {
            this.providers.push({
                name: `Ollama${index + 1}`,
                apiKey: key,
                baseURL: ollamaBaseUrl,
                model: 'qwen3-vl:235b-instruct-cloud',
                type: 'ollama',
                family: 'ollama',
                costTier: 'free',
                credentialGroup: `ollama:${index + 1}`,
                supportsImages: true,
                visionOnly: false
            });
        });

        // ---------- Cloudflare Workers AI (via deployed worker) ----------
        // Uses AI_PROXY_TOKEN for authentication (same as other proxies)
        // llama-3.1-8b removed — model too weak. Swap in a stronger CF model here if needed.
        const cfWorkerUrl = process.env.CLOUDFLARE_WORKER_URL;
        const cfWorkerToken = process.env.AI_PROXY_TOKEN;
        if (cfWorkerUrl && cfWorkerToken) {
            console.log('Cloudflare Workers AI proxy configured (no model registered)');
        }
        console.log(`Initialized ${this.providers.length} AI providers (${this.selectedProviderType})`);
    }
    loadState() {
        // For Render, load async from MongoDB after startup
        if (!IS_SELFHOST) {
            this._loadStateFromMongo().catch(e =>
                console.warn('Failed to load provider state from MongoDB:', e.message)
            );
            return;
        }
        // Selfhost: load from file
        try {
            if (!fs.existsSync(PROVIDER_STATE_PATH)) {return;}
            const raw = fs.readFileSync(PROVIDER_STATE_PATH, 'utf8');
            if (!raw.trim()) {return;}
            this._applyStateData(JSON.parse(raw));
            console.log('Restored AI provider cache from disk');
        } catch (error) {
            console.warn('Failed to restore AI provider cache:', error);
        }
    }
    async _loadStateFromMongo() {
        const db = await getDatabase();
        if (!db || !db.db) {return;}
        try {
            const doc = await db.db
                .collection(PROVIDER_STATE_COLLECTION)
                .findOne({ _id: 'provider_state' });
            if (doc) {
                this._applyStateData(doc);
                console.log('Restored AI provider cache from MongoDB');
            }
        } catch (e) {
            console.warn('MongoDB provider state load failed:', e.message);
        }
    }
    _applyStateData(data) {
        if (!data) {return;}
        if (data.metrics && typeof data.metrics === 'object') {
            for (const [name, metric] of Object.entries(data.metrics)) {
                if (this.providers.find(p => p.name === name) && metric) {
                    this.metrics.set(name, {
                        successes: Number(metric.successes) || 0,
                        failures: Number(metric.failures) || 0,
                        avgLatencyMs: Number(metric.avgLatencyMs) || 0
                    });
                }
            }
        }
        if (data.disabledProviders && typeof data.disabledProviders === 'object') {
            const now = Date.now();
            for (const [name, disabledUntil] of Object.entries(data.disabledProviders)) {
                const parsed = Number(disabledUntil);
                if (
                    Number.isFinite(parsed) &&
                    parsed > now &&
                    this.providers.find(p => p.name === name)
                ) {
                    this.disabledProviders.set(name, parsed);
                }
            }
        }
        if (data.disabledProviderMeta && typeof data.disabledProviderMeta === 'object') {
            const now = Date.now();
            for (const [name, meta] of Object.entries(data.disabledProviderMeta)) {
                const disabledUntil = Number(meta?.disabledUntil || this.disabledProviders.get(name));
                if (
                    meta &&
                    typeof meta === 'object' &&
                    Number.isFinite(disabledUntil) &&
                    disabledUntil > now &&
                    this.providers.find(p => p.name === name)
                ) {
                    this.disabledProviderMeta.set(name, {
                        ...meta,
                        disabledUntil
                    });
                }
            }
        }
        if (data.providerErrors && typeof data.providerErrors === 'object') {
            for (const [name, errorInfo] of Object.entries(data.providerErrors)) {
                if (
                    errorInfo &&
                    typeof errorInfo === 'object' &&
                    this.providers.find(p => p.name === name)
                ) {
                    this.providerErrors.set(name, errorInfo);
                }
            }
        }
        if (data.openRouterGlobalFailure === true) {
            // This flag only makes sense within the current process because the clear canary
            // is scheduled in-memory. Restoring it across restarts can permanently exclude
            // every OpenRouter lane until manual intervention.
            console.warn('Ignoring persisted OpenRouter global failure from a previous run');
            this.openRouterGlobalFailure = false;
            this.openRouterFailureCount = 0;
            this.scheduleStateSave();
        }
        // Restore numeric metrics
        for (const key of ['totalTokensIn', 'totalTokensOut', 'totalRequests', 'successfulRequests', 'failedRequests']) {
            if (typeof data[key] === 'number') { this[key] = data[key]; }
        }
    }
    // Get stats for dashboard
    getStats() {
        return {
            totalTokensIn: this.totalTokensIn,
            totalTokensOut: this.totalTokensOut,
            totalTokens: this.totalTokensIn + this.totalTokensOut,
            totalRequests: this.totalRequests,
            successfulRequests: this.successfulRequests,
            failedRequests: this.failedRequests,
            successRate:
                this.totalRequests > 0
                    ? ((this.successfulRequests / this.totalRequests) * 100).toFixed(1)
                    : 100,
            providers: this.providers.length,
            activeProviders: this.providers.filter(p => !this.disabledProviders.has(p.name)).length
        };
    }
    async saveState() {
        const payload = {
            metrics: Object.fromEntries(this.metrics),
            disabledProviders: Object.fromEntries(this.disabledProviders),
            disabledProviderMeta: Object.fromEntries(this.disabledProviderMeta),
            providerErrors: Object.fromEntries(this.providerErrors),
            openRouterGlobalFailure: this.openRouterGlobalFailure,
            openRouterFailureCount: this.openRouterFailureCount,
            totalTokensIn: this.totalTokensIn,
            totalTokensOut: this.totalTokensOut,
            totalRequests: this.totalRequests,
            successfulRequests: this.successfulRequests,
            failedRequests: this.failedRequests,
            savedAt: new Date().toISOString()
        };
        // Render: save to MongoDB
        if (!IS_SELFHOST) {
            try {
                const db = await getDatabase();
                if (db && db.db) {
                    await db.db
                        .collection(PROVIDER_STATE_COLLECTION)
                        .updateOne({ _id: 'provider_state' }, { $set: payload }, { upsert: true });
                }
            } catch (error) {
                console.warn('Failed to persist AI provider cache to MongoDB:', error.message);
            }
            return;
        }
        // Selfhost: save to file
        try {
            // Ensure data directory exists
            const dataDir = path.dirname(PROVIDER_STATE_PATH);
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
            }
            await fsp.writeFile(PROVIDER_STATE_PATH, JSON.stringify(payload, null, 2), 'utf8');
        } catch (error) {
            console.warn('Failed to persist AI provider cache:', error);
        }
    }
    scheduleStateSave() {
        this.stateDirty = true;
        if (this.stateSaveTimer) {return;}
        this.stateSaveTimer = setTimeout(async() => {
            this.stateSaveTimer = null;
            if (!this.stateDirty) {return;}
            this.stateDirty = false;
            await this.saveState();
        }, this.stateSaveDebounceMs);
    }
    setProviderCooldown(name, disabledUntil, metadata = {}) {
        const until = Number(disabledUntil);
        if (!Number.isFinite(until) || until <= Date.now()) {
            this.clearProviderCooldown(name);
            return;
        }
        this.disabledProviders.set(name, until);
        const provider = this.providers.find(candidate => candidate.name === name);
        const previous = this.disabledProviderMeta.get(name) || {};
        this.disabledProviderMeta.set(name, {
            disabledUntil: until,
            reason: metadata.reason ?? previous.reason ?? null,
            source: metadata.source ?? previous.source ?? null,
            credentialGroup:
                metadata.credentialGroup ??
                previous.credentialGroup ??
                provider?.credentialGroup ??
                null,
            details: metadata.details ?? previous.details ?? null,
            updatedAt: Date.now()
        });
    }
    clearProviderCooldown(name) {
        this.disabledProviders.delete(name);
        this.disabledProviderMeta.delete(name);
    }
    getDisabledProviderMeta(name) {
        const disabledUntil = this.disabledProviders.get(name);
        if (!disabledUntil) {
            return null;
        }
        const provider = this.providers.find(candidate => candidate.name === name);
        const meta = this.disabledProviderMeta.get(name) || {};
        return {
            disabledUntil,
            reason: meta.reason || null,
            source: meta.source || null,
            credentialGroup: meta.credentialGroup || provider?.credentialGroup || null,
            details: meta.details || null,
            updatedAt: meta.updatedAt || null
        };
    }
    recordPoisonedOutput(providerName, output, options = {}) {
        if (!providerName) {
            return { count: 0, benched: false };
        }
        const now = Date.now();
        const previous = this.providerPoisonCounts.get(providerName);
        const count =
            previous && now - previous.lastAt <= POISON_QUARANTINE_WINDOW_MS
                ? previous.count + 1
                : 1;
        this.providerPoisonCounts.set(providerName, { count, lastAt: now });
        this.providerErrors.set(providerName, {
            error: `Poisoned output detected from ${providerName}`,
            timestamp: now,
            status: 'poison',
            source: 'garbage-detection',
            count,
            hash: options.hash || null,
            sample: options.sample || null
        });
        this.scheduleStateSave();

        const provider = this.providers.find(candidate => candidate.name === providerName);
        if (provider && count >= POISON_QUARANTINE_THRESHOLD) {
            execution.benchProvider(
                this,
                provider,
                POISON_QUARANTINE_DURATION_MS,
                `poisoned output x${count}`,
                {
                    source: 'garbage-detection',
                    details: {
                        hash: options.hash || null,
                        sample: options.sample || null,
                        count
                    }
                }
            );
            this.providerPoisonCounts.delete(providerName);
            return {
                count,
                benched: true,
                durationMs: POISON_QUARANTINE_DURATION_MS
            };
        }
        return { count, benched: false };
    }
    _filterProvidersByType(providers, options = {}) {
        // By default, exclude moderationOnly providers from casual chat.
        // Set options.allowModerationOnly = true to include them (if any are configured).
        const allowModerationOnly = options.allowModerationOnly === true;
        const providerType = String(
            options.providerType || this.selectedProviderType || 'auto'
        ).toLowerCase();
        let filtered = providers;
        // Filter out moderationOnly providers unless explicitly allowed
        if (!allowModerationOnly) {
            filtered = filtered.filter(p => !p.moderationOnly);
        }
        // Exclude vision-only providers from regular text chat rotation.
        // generateResponseWithImages() targets supportsImages directly so it still finds them.
        if (!options.allowVisionOnly) {
            filtered = filtered.filter(p => !p.visionOnly);
        }
        if (providerType === 'auto') {return filtered;}
        return filtered.filter(provider => {
            const providerName = provider.name.toLowerCase();
            switch (providerType) {
                case 'openai':
                    return providerName === 'gpt5nano'; // preserved for compatibility with your UI
                case 'groq':
                    return providerName.startsWith('groq');
                case 'openrouter':
                    return providerName.startsWith('openrouter');
                case 'deepseek':
                    return providerName.startsWith('deepseek');
                case 'nvidia':
                    return providerName.startsWith('nvidia');
                case 'google':
                    return providerName.startsWith('googleai');
                case 'cerebras':
                    return providerName.startsWith('cerebras');
                case 'sambanova':
                    return providerName.startsWith('sambanova');
                case 'mistral':
                    return providerName.startsWith('mistral');
                case 'ollama':
                    return providerName.startsWith('ollama');
                default:
                    console.warn(
                        `Unknown provider type: ${providerType}, falling back to auto mode`
                    );
                    return true;
            }
        });
    }
    _availableProviders(options = {}) {
        const now = Date.now();
        const filterActive = providerOptions => this._filterProvidersByType(this.providers, providerOptions).filter(p => {
            const disabledUntil = this.disabledProviders.get(p.name);
            if (disabledUntil && disabledUntil > now) {return false;}
            if (p.name.startsWith('OpenRouter') && this.openRouterGlobalFailure) {return false;}
            return true;
        });
        const selectedProviders = filterActive(options);
        if (selectedProviders.length > 0 || this.selectedProviderType === 'auto') {
            return selectedProviders;
        }
        const failOpenProviders = filterActive({ ...options, providerType: 'auto' });
        if (failOpenProviders.length > 0) {
            console.warn(
                `No active providers available for forced type "${this.selectedProviderType}", failing open to auto mode`
            );
        }
        return failOpenProviders;
    }
    _rankedProviders(options = {}) {
        return this._availableProviders(options)
            .sort((a, b) => {
                const ma = getProviderMetricSnapshot(this.metrics.get(a.name));
                const mb = getProviderMetricSnapshot(this.metrics.get(b.name));
                // Health first — keep dead providers at the bottom
                if (this.selectedProviderType === 'auto') {
                    const healthDelta = resolveAutoHealthBucket(ma) - resolveAutoHealthBucket(mb);
                    if (healthDelta !== 0) {return healthDelta;}
                }
                // Family priority (encodes operator preference order)
                if (this.selectedProviderType === 'auto') {
                    const familyDelta = resolveAutoFamilyPriority(a) - resolveAutoFamilyPriority(b);
                    if (familyDelta !== 0) {return familyDelta;}
                }
                // Performance score (success rate + latency)
                const scoreDelta = computeProviderRankScore(mb) - computeProviderRankScore(ma);
                if (Math.abs(scoreDelta) > 0.0001) {
                    return scoreDelta;
                }
                return a.name.localeCompare(b.name);
            });
    }
    _getRoundRobinProvider(options = {}) {
        const availableProviders = this._availableProviders(options);
        if (availableProviders.length === 0) {return null;}

        // Prefer the best family priority but rotate across all providers
        let pool = availableProviders;
        if (this.selectedProviderType === 'auto' && pool.length > 0) {
            const bestFamilyPriority = Math.min(...pool.map(resolveAutoFamilyPriority));
            const preferredFamily = pool.filter(
                provider => resolveAutoFamilyPriority(provider) === bestFamilyPriority
            );
            if (preferredFamily.length > 0) {
                pool = preferredFamily;
            }
        }

        // Round-robin through pool
        this.roundRobinIndex = (this.roundRobinIndex + 1) % pool.length;
        return pool[this.roundRobinIndex];
    }
    _recordMetric(name, ok, latencyMs) {
        const m = this.metrics.get(name) || { successes: 0, failures: 0, avgLatencyMs: 1500 };
        if (ok) {m.successes += 1;}
        else {m.failures += 1;}
        if (!Number.isFinite(m.avgLatencyMs) || m.avgLatencyMs <= 0) {
            m.avgLatencyMs = latencyMs;
        } else {
            m.avgLatencyMs = m.avgLatencyMs * 0.7 + latencyMs * 0.3;
        }
        this.metrics.set(name, m);
        this.scheduleStateSave();
    }
    _isRetryable(error) {
        const status = error?.status || error?.response?.status;
        const message = String(error?.message || '').toLowerCase();
        if (error?.transient) {return true;}
        if (status && [408, 409, 429, 500, 502, 503, 504].includes(status)) {return true;}
        if (
            message.includes('empty') ||
            message.includes('timeout') ||
            message.includes('overloaded')
        )
        {return true;}
        return false;
    }
    async _sleep(ms) {
        return new Promise(res => setTimeout(res, ms));
    }
    async _retry(fn, { retries = 0, baseDelay = 0, jitter = false, providerName = '' } = {}) {
        const attempts = Math.max(0, Number(retries) || 0) + 1;
        const delayBase = Math.max(0, Number(baseDelay) || 0);
        const useJitter = Boolean(jitter);
        let lastError = null;
        for (let attempt = 0; attempt < attempts; attempt += 1) {
            try {
                return await fn(attempt);
            } catch (err) {
                lastError = err;
                const canRetry = attempt < attempts - 1 && this._isRetryable(err);
                if (!canRetry) {
                    throw err;
                }
                let waitMs = delayBase ? delayBase * Math.pow(2, attempt) : 0;
                if (useJitter && waitMs > 0) {
                    waitMs = Math.round(waitMs * (0.5 + Math.random()));
                }
                if (waitMs > 0) {
                    console.warn(
                        `[AIProviderManager] Retry ${attempt + 1}/${attempts - 1} for ${providerName || 'provider'} in ${waitMs}ms: ${err?.message || err}`
                    );
                    await this._sleep(waitMs);
                }
            }
        }
        throw lastError;
    }
    /**
     * Get current load factor (0.0 = idle, 1.0 = at soft cap, >1.0 = overloaded)
     */
    getLoadFactor() {
        return this.activeRequests / Math.max(1, this.loadConfig.softCap);
    }
    /**
     * Get load-adjusted max tokens. Reduces output under high load to keep things responsive.
     */
    getLoadAdjustedTokens(requestedTokens) {
        const load = this.getLoadFactor();
        if (load <= 1.0) {return requestedTokens;}
        // Linearly reduce tokens from 100% at softCap to 50% at maxConcurrent
        const reduction = Math.min(0.5, (load - 1.0) * 0.25);
        return Math.max(512, Math.floor(requestedTokens * (1 - reduction)));
    }
    /**
     * Get load stats for diagnostics/monitoring
     */
    getLoadStats() {
        return {
            activeRequests: this.activeRequests,
            peakRequests: this.activeRequestsPeak,
            loadFactor: Math.round(this.getLoadFactor() * 100) / 100,
            softCap: this.loadConfig.softCap,
            maxConcurrent: this.loadConfig.maxConcurrent,
            rejectThreshold: this.loadConfig.rejectThreshold
        };
    }
    async generateResponse(systemPrompt, userPrompt, maxTokens = config.ai?.maxTokens || 4096, userId = null) {
        // Ensure prompts are strings (required by some providers like Groq)
        systemPrompt = systemPrompt != null ? String(systemPrompt) : '';
        userPrompt = userPrompt != null ? String(userPrompt) : '';
        // Load management: reject if over hard limit
        if (this.activeRequests >= this.loadConfig.rejectThreshold) {
            throw new Error('System under heavy load — please try again in a moment, sir.');
        }
        // Track active requests
        this.activeRequests++;
        if (this.activeRequests > this.activeRequestsPeak) {
            this.activeRequestsPeak = this.activeRequests;
        }
        // Adjust tokens based on current load
        maxTokens = this.getLoadAdjustedTokens(maxTokens);
        try {
            return await this._executeGeneration(systemPrompt, userPrompt, maxTokens, userId);
        } finally {
            this.activeRequests = Math.max(0, this.activeRequests - 1);
        }
    }
    async _executeGeneration(systemPrompt, userPrompt, maxTokens, userId = null) {
        return execution.executeGeneration(this, systemPrompt, userPrompt, maxTokens, userId);
    }
    async generateResponseWithImages(systemPrompt, userPrompt, images, maxTokens, options = {}, userId = null) {
        return execution.generateResponseWithImages(this, systemPrompt, userPrompt, images, maxTokens, { ...options, userId });
    }
    getProviderStatus() {
        const now = Date.now();
        return this.providers
            .map(p => {
                const metrics = this.metrics.get(p.name) || {
                    successes: 0,
                    failures: 0,
                    avgLatencyMs: null
                };
                const total = metrics.successes + metrics.failures;
                const disabledUntil = this.disabledProviders.get(p.name) || null;
                const disabledMeta = this.getDisabledProviderMeta(p.name);
                return {
                    name: p.name,
                    model: p.model,
                    type: p.type,
                    family: p.family || null,
                    credentialGroup: p.credentialGroup || null,
                    costTier: p.costTier || 'unknown',
                    priority: resolveCostPriority(p),
                    hasError: this.providerErrors.has(p.name),
                    lastError: this.providerErrors.get(p.name) || null,
                    disabledUntil,
                    isDisabled: disabledUntil ? disabledUntil > now : false,
                    disabledReason: disabledMeta?.reason || null,
                    disabledSource: disabledMeta?.source || null,
                    metrics: {
                        successes: metrics.successes,
                        failures: metrics.failures,
                        totalRequests: total,
                        successRate: total ? metrics.successes / total : null,
                        avgLatencyMs: metrics.avgLatencyMs
                    }
                };
            })
            .sort((a, b) => {
                if (a.priority !== b.priority) {return a.priority - b.priority;}
                const rateA = a.metrics.successRate ?? -1;
                const rateB = b.metrics.successRate ?? -1;
                if (rateA !== rateB) {return rateB - rateA;}
                return (
                    (a.metrics.avgLatencyMs ?? Number.POSITIVE_INFINITY) -
                    (b.metrics.avgLatencyMs ?? Number.POSITIVE_INFINITY)
                );
            });
    }
    getRedactedProviderStatus() {
        return this.getProviderStatus().map(p => ({
            ...p,
            name: '[REDACTED]',
            model: '[REDACTED]',
            credentialGroup: p.credentialGroup ? '[REDACTED]' : null,
            lastError: p.hasError ? '[REDACTED]' : null
        }));
    }
    getProviderAnalytics() {
        return this.getProviderStatus().map(p => ({
            ...p,
            metrics: {
                ...p.metrics,
                total: p.metrics.totalRequests,
                successRate: p.metrics.successRate != null ? p.metrics.successRate * 100 : null
            }
        }));
    }
    setProviderType(providerType) {
        const validTypes = ['auto', 'openai', 'groq', 'cerebras', 'sambanova', 'mistral', 'openrouter', 'google', 'deepseek', 'nvidia', 'ollama'];
        if (!validTypes.includes(String(providerType).toLowerCase())) {
            throw new Error(`Invalid provider type. Valid options: ${validTypes.join(', ')}`);
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
            if (name === 'gpt5nano') {types.add('openai');}
            else if (name.startsWith('groq')) {types.add('groq');}
            else if (name.startsWith('openrouter')) {types.add('openrouter');}
            else if (name.startsWith('googleai')) {types.add('google');}
            else if (name.startsWith('deepseek')) {types.add('deepseek');}
            else if (name.startsWith('cerebras')) {types.add('cerebras');}
            else if (name.startsWith('sambanova')) {types.add('sambanova');}
            else if (name.startsWith('mistral')) {types.add('mistral');}
            else if (name.startsWith('nvidia')) {types.add('nvidia');}
            else if (name.startsWith('ollama')) {types.add('ollama');}
        });
        const available = Array.from(types).sort();
        available.unshift('auto');
        return available;
    }
    cleanupOldMetrics() {
        const now = Date.now();
        const maxAge = 24 * 60 * 60 * 1000;
        for (const [name, error] of this.providerErrors.entries()) {
            if (now - (error?.timestamp || 0) > maxAge) {this.providerErrors.delete(name);}
        }
        for (const [name, disabledUntil] of this.disabledProviders.entries()) {
            if (disabledUntil <= now) {this.clearProviderCooldown(name);}
        }
        // LRU handles session stickiness expiry automatically
    }
    /**
     * Force reinitialize all providers - useful for recovery from corrupted state
     */
    forceReinitialize() {
        console.log('Force reinitializing AI providers...');
        this.providers = [];
        this.providerErrors.clear();
        this.metrics.clear();
        this.disabledProviders.clear();
        this.disabledProviderMeta.clear();
        this.openRouterGlobalFailure = false;
        this.openRouterFailureCount = 0;
        this.providerPoisonCounts.clear();
        this.setupProviders();
        console.log(`Reinitialized ${this.providers.length} AI providers`);
        return this.providers.length;
    }
    /**
     * Get a health summary for monitoring
     */
    getHealthSummary() {
        const now = Date.now();
        const activeProviders = this.providers.filter(p => {
            const disabledUntil = this.disabledProviders.get(p.name);
            return !disabledUntil || disabledUntil <= now;
        });
        return {
            total: this.providers.length,
            active: activeProviders.length,
            disabled: this.providers.length - activeProviders.length,
            hasProviders: this.providers.length > 0,
            openRouterGlobalFailure: this.openRouterGlobalFailure
        };
    }
}
module.exports = new AIProviderManager();

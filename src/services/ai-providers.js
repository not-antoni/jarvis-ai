'use strict';

const sharp = require('sharp');
/** BEGIN: sanitizeModelOutput helper (injected) **/
/**
 * Sanitize model-generated text by removing stray conversation/markup tokens
 * commonly used in jailbreaks or prompt-injection artifacts.
 *
 * Removes sequences like:
 *   </message></start>assistant</channel>final</message>
 *   </channel>final</message>
 * and minor whitespace/escape variants.
 *
 * Also collapses repeated whitespace and trims the result.
 */
function sanitizeModelOutput(text) {
    if (!text || typeof text !== 'string') return text;

    // 1) Normalize line endings
    let out = text.replace(/\r\n?/g, '\n');

    // 2) Remove exact dangerous markup patterns (and small variants with optional whitespace)
    // Pattern matches things like: </message></start>assistant</channel>final</message>
    out = out.replace(
        /<\/message>\s*<\/start>\s*assistant\s*<\/channel>\s*final\s*<\/message>/gi,
        ' '
    );
    // Pattern matches: </channel>final</message> and variants with optional whitespace
    out = out.replace(/<\/channel>\s*final\s*<\/message>/gi, ' ');

    // 3) Remove stray partial markers that sometimes appear
    out = out.replace(/<start>\s*assistant\b[^>]*>/gi, ' ');
    out = out.replace(/<\/start>\s*assistant\b[^>]*>/gi, ' ');
    out = out.replace(/<\s*\/?channel\b[^>]*>/gi, ' ');
    out = out.replace(/<\s*\/?message\b[^>]*>/gi, ' ');

    // 4) Remove suspicious long token ladders like repeated "Certainly! ... Absolutely" sequences
    out = out.replace(
        /\b(Certainly|Absolutely|Certainly!|Sure|Affirmative)[\s\p{P}\-]{0,40}(?:(Certainly|Absolutely|Sure|Affirmative)[\s\p{P}\-]*){1,}/giu,
        '$1'
    );

    // 5) Collapse multiple spaces on same line, but preserve single newlines
    // (Was collapsing ALL whitespace including newlines - this was too aggressive)
    out = out.replace(/[^\S\n]+/g, ' ');  // Collapse spaces/tabs but not newlines
    out = out.replace(/\n{3,}/g, '\n\n'); // Collapse 3+ newlines to 2
    out = out.trim();

    return out;
}
/** END: sanitizeModelOutput helper (injected) **/

/** BEGIN: minimal thinking/final scrub helpers (added) **/
function cleanThinkingOutput(text) {
    if (!text || typeof text !== 'string') return text;
    return text
        .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        // Removed: .replace(/\bfinal\b[:\-]?\s*/gi, '') - was cutting responses with "final" word
        .replace(/\s+/g, ' ')
        .trim();
}
function extractFinalPayload(text) {
    // Simplified: just return the text without aggressive "final" extraction
    // The old pattern /\bfinal\b[:\-]?\s*(.*)$/is was cutting off responses
    // that contained the word "final" anywhere (e.g., "Finally, here is...")
    if (!text || typeof text !== 'string') return text;
    return text.trim();
}
function stripWrappingQuotes(text) {
    if (!text || typeof text !== 'string') return text;
    let trimmed = text.trim();
    const pairs = [
        ['"', '"'],
        ['“', '”'],
        ['„', '”'],
        ['«', '»'],
        ["'", "'"]
    ];
    for (const [start, end] of pairs) {
        if (
            trimmed.startsWith(start) &&
            trimmed.endsWith(end) &&
            trimmed.length >= start.length + end.length
        ) {
            trimmed = trimmed.slice(start.length, trimmed.length - end.length).trim();
            break;
        }
    }
    return trimmed;
}
function stripJarvisSpeakerPrefix(text) {
    if (!text || typeof text !== 'string') return text;
    let trimmed = text.trim();
    const patterns = [/^\*\*\s*(jarvis)\s*:\s*\*\*\s*/i, /^(jarvis)\s*:\s*/i];
    for (const pattern of patterns) {
        if (pattern.test(trimmed)) {
            trimmed = trimmed.replace(pattern, '').trimStart();
            break;
        }
    }
    return trimmed;
}
function stripTrailingChannelArtifacts(text) {
    if (!text || typeof text !== 'string') return text;
    let trimmed = text.trim();
    // FIXED: Only match actual markup artifacts with brackets, not normal text like "Discord channel!"
    // Must have at least one bracket/quote wrapper to be considered an artifact
    const pattern = /(?:[\s,.;:!?\-]*[\(\[\{"]+\s*channel\s*[\)\]\}"]+[\s,.;:!?\-]*)$/i;
    while (pattern.test(trimmed)) {
        trimmed = trimmed.replace(pattern, '').trim();
    }
    return trimmed;
}
function stripLeadingPromptLeaks(text) {
    if (!text || typeof text !== 'string') return text;
    let trimmed = text.trim();
    // Strip "Channel:" prefix (system prompt leak)
    const channelPattern = /^channel\s*:\s*/i;
    if (channelPattern.test(trimmed)) {
        trimmed = trimmed.replace(channelPattern, '').trimStart();
    }
    // Strip "commentary:" prefix (system prompt leak)
    // FIXED: Require colon - don't strip normal text starting with "commentary on..." etc.
    const commentaryPattern = /^commentary\s*:\s*/i;
    if (commentaryPattern.test(trimmed)) {
        trimmed = trimmed.replace(commentaryPattern, '').trimStart();
    }
    // Strip "[Channel]" or "(Channel)" variants
    const bracketChannelPattern = /^[\[\(]\s*channel\s*[\]\)]\s*:?\s*/i;
    if (bracketChannelPattern.test(trimmed)) {
        trimmed = trimmed.replace(bracketChannelPattern, '').trimStart();
    }
    return trimmed;
}
function sanitizeAssistantMessage(text) {
    if (!text || typeof text !== 'string') return text;
    const layered = extractFinalPayload(cleanThinkingOutput(sanitizeModelOutput(text)));
    const noOuterQuotes = stripWrappingQuotes(layered);
    const withoutPromptLeaks = stripLeadingPromptLeaks(noOuterQuotes);
    const withoutPrefix = stripJarvisSpeakerPrefix(withoutPromptLeaks);
    const withoutChannelArtifacts = stripTrailingChannelArtifacts(withoutPrefix);
    return stripWrappingQuotes(withoutChannelArtifacts);
}
/** END: minimal thinking/final scrub helpers (added) **/

const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const config = require('../../config');
const { getAIFetch } = require('./ai-proxy');

const aiFetch = getAIFetch();

const fsp = fs.promises;

const PROVIDER_STATE_PATH = path.join(__dirname, '..', '..', 'data', 'provider-state.json');
const COST_PRIORITY = { free: 0, freemium: 1, paid: 2 };

// Determine storage mode: MongoDB for Render, file for selfhost
const IS_SELFHOST = String(process.env.SELFHOST_MODE || '').toLowerCase() === 'true';
const PROVIDER_STATE_COLLECTION = 'provider_state';

// Lazy-loaded dashboard module for token tracking (avoids require in hot path)
let _dashboard = null;
function getDashboard() {
    if (_dashboard === undefined) return null; // Already tried and failed
    if (_dashboard) return _dashboard;
    try {
        _dashboard = require('../../routes/dashboard');
        return _dashboard;
    } catch (e) {
        _dashboard = undefined; // Mark as unavailable
        return null;
    }
}

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

class AIProviderManager {
    constructor() {
        this.providers = [];
        this.providerErrors = new Map();
        this.metrics = new Map();
        this.disabledProviders = new Map();

        // Selection & routing flags
        this.useRandomSelection = true; // Default to random selection
        this.selectedProviderType = config.ai?.provider || 'auto'; // 'auto' | 'openai' | 'groq' | 'openrouter' | 'google' | 'deepseek'

        // OpenRouter rolling outage guardrails
        this.openRouterGlobalFailure = false;
        this.openRouterFailureCount = 0;

        // Per-provider failure tracking for exponential backoff
        this.providerFailureCounts = new Map();

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

        this.setupProviders();
        this.loadState();
    }

    setupProviders() {
        // ---------- OpenRouter providers ----------
        // Auto-discover all OPENROUTER_API_KEY, OPENROUTER_API_KEY2, etc.
        const openRouterKeys = Object.keys(process.env)
            .filter(key => /^OPENROUTER_API_KEY\d*$/.test(key))
            .sort((a, b) => {
                const numA = parseInt(a.replace('OPENROUTER_API_KEY', '') || '1', 10);
                const numB = parseInt(b.replace('OPENROUTER_API_KEY', '') || '1', 10);
                return numA - numB;
            })
            .map(key => process.env[key])
            .filter(Boolean);

        openRouterKeys.forEach((key, index) => {
            this.providers.push({
                name: `OpenRouter${index + 1}`,
                client: new OpenAI({
                    apiKey: key,
                    baseURL: 'https://openrouter.ai/api/v1',
                    fetch: aiFetch,
                    defaultHeaders: {
                        'HTTP-Referer': process.env.APP_URL || process.env.PUBLIC_BASE_URL || 'https://localhost',
                        'X-Title': process.env.APP_NAME || 'Jarvis AI'
                    }
                }),
                model: 'cognitivecomputations/dolphin-mistral-24b-venice-edition:free',
                type: 'openai-chat',
                family: 'openrouter',
                costTier: 'free'
            });
        });

        // ---------- Groq providers (OpenAI-compatible) ----------
        // Auto-discover all GROQ_API_KEY, GROQ_API_KEY2, etc.
        const groqKeys = Object.keys(process.env)
            .filter(key => /^GROQ_API_KEY\d*$/.test(key))
            .sort((a, b) => {
                const numA = parseInt(a.replace('GROQ_API_KEY', '') || '1', 10);
                const numB = parseInt(b.replace('GROQ_API_KEY', '') || '1', 10);
                return numA - numB;
            })
            .map(key => process.env[key])
            .filter(Boolean);

        groqKeys.forEach((key, index) => {
            this.providers.push({
                name: `Groq${index + 1}`,
                client: new OpenAI({
                    apiKey: key,
                    baseURL: 'https://api.groq.com/openai/v1',
                    fetch: aiFetch
                }),
                model: 'moonshotai/kimi-k2-instruct',
                type: 'openai-chat',
                family: 'groq',
                costTier: 'free'
            });
        });

        // ---------- Google AI (native SDK) ----------
        // Auto-discover all GOOGLE_AI_API_KEY, GOOGLE_AI_API_KEY2, etc.
        const googleKeys = Object.keys(process.env)
            .filter(key => /^GOOGLE_AI_API_KEY\d*$/.test(key))
            .sort((a, b) => {
                const numA = parseInt(a.replace('GOOGLE_AI_API_KEY', '') || '1', 10);
                const numB = parseInt(b.replace('GOOGLE_AI_API_KEY', '') || '1', 10);
                return numA - numB;
            })
            .map(key => process.env[key])
            .filter(Boolean);

        googleKeys.forEach((key, index) => {
            this.providers.push({
                name: `GoogleAI${index + 1}`,
                client: new GoogleGenerativeAI(key),
                model: 'gemini-2.5-flash',
                type: 'google',
                family: 'google',
                costTier: 'free'
            });
        });

        // ---------- DeepSeek via Vercel AI Gateway (OpenAI-compatible) ----------
        // Auto-discover all AI_GATEWAY_API_KEY, AI_GATEWAY_API_KEY2, etc.
        const deepseekGatewayKeys = Object.keys(process.env)
            .filter(key => /^AI_GATEWAY_API_KEY\d*$/.test(key))
            .sort((a, b) => {
                const numA = parseInt(a.replace('AI_GATEWAY_API_KEY', '') || '1', 10);
                const numB = parseInt(b.replace('AI_GATEWAY_API_KEY', '') || '1', 10);
                return numA - numB;
            })
            .map(key => process.env[key])
            .filter(Boolean);

        deepseekGatewayKeys.forEach((key, index) => {
            this.providers.push({
                name: `deepseek-gateway-${index + 1}`,
                client: new OpenAI({
                    apiKey: key,
                    baseURL: 'https://ai-gateway.vercel.sh/v1',
                    fetch: aiFetch,
                    defaultHeaders: {
                        'HTTP-Referer': process.env.APP_URL || process.env.PUBLIC_BASE_URL || 'https://localhost',
                        'X-Title': process.env.APP_NAME || 'Jarvis AI'
                    }
                }),
                // Vercel AI Gateway model format - no provider prefix needed
                model: 'deepseek-v3.2-exp',
                type: 'openai-chat',
                family: 'deepseek',
                costTier: 'paid'
            });
        });

        // ---------- OpenAI lightweight (replace GPT-5 Nano → GPT-4o-mini) ----------
        const openAiKey = process.env.OPENAI || process.env.OPENAI_API_KEY;
        if (openAiKey) {
            const key = openAiKey;
            this.providers.push({
                // Keep the same name so your existing filters & health pages remain happy
                name: 'GPT5Nano',
                client: new OpenAI({ apiKey: key, fetch: aiFetch }), // https://api.openai.com/v1
                model: 'gpt-4o-mini', // ← actual model
                type: 'openai-chat', // generic OpenAI-compatible flow
                family: 'openai',
                costTier: 'paid'
            });
        }

        // ---------- Ollama providers (native API with vision support) ----------
        // Auto-discover all OLLAMA_API_KEY, OLLAMA_API_KEY2, OLLAMA_API_KEY3, etc.
        const ollamaKeys = Object.keys(process.env)
            .filter(key => /^OLLAMA_API_KEY\d*$/.test(key))
            .sort((a, b) => {
                const numA = parseInt(a.replace('OLLAMA_API_KEY', '') || '1', 10);
                const numB = parseInt(b.replace('OLLAMA_API_KEY', '') || '1', 10);
                return numA - numB;
            })
            .map(key => process.env[key])
            .filter(Boolean);

        const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || 'https://ollama.com/api';
        const ollamaModel = process.env.OLLAMA_MODEL || 'qwen3-vl:235b-instruct-cloud';

        ollamaKeys.forEach((key, index) => {
            this.providers.push({
                name: `Ollama${index + 1}`,
                apiKey: key,
                baseURL: ollamaBaseUrl,
                model: ollamaModel,
                type: 'ollama',
                family: 'ollama',
                costTier: 'free',
                supportsImages: true,
                moderationOnly: true // Ollama reserved for guild moderation only
            });
        });

        // ---------- Cloudflare Workers AI (via deployed worker) ----------
        // Uses AI_PROXY_TOKEN for authentication (same as other proxies)
        const cfWorkerUrl = process.env.CLOUDFLARE_WORKER_URL;
        const cfWorkerToken = process.env.AI_PROXY_TOKEN;
        if (cfWorkerUrl && cfWorkerToken) {
            this.providers.push({
                name: 'CloudflareAI',
                workerUrl: cfWorkerUrl,
                apiKey: cfWorkerToken,
                model: '@cf/meta/llama-3.1-8b-instruct-fp8',
                type: 'cloudflare-worker',
                family: 'cloudflare',
                costTier: 'free'
            });
            console.log('Cloudflare Workers AI provider configured');
        }

        // Rank cheapest first by default
        this.providers.sort((a, b) => resolveCostPriority(a) - resolveCostPriority(b));

        console.log(`Initialized ${this.providers.length} AI providers`);
        console.log(`Provider selection mode: ${this.useRandomSelection ? 'Random' : 'Ranked'}`);
        console.log(`Selected provider type: ${this.selectedProviderType}`);
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
            if (!fs.existsSync(PROVIDER_STATE_PATH)) return;
            const raw = fs.readFileSync(PROVIDER_STATE_PATH, 'utf8');
            if (!raw.trim()) return;
            this._applyStateData(JSON.parse(raw));
            console.log('Restored AI provider cache from disk');
        } catch (error) {
            console.warn('Failed to restore AI provider cache:', error);
        }
    }

    async _loadStateFromMongo() {
        const db = await getDatabase();
        if (!db || !db.db) return;

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
        if (!data) return;

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

        if (typeof data.openRouterGlobalFailure === 'boolean') {
            this.openRouterGlobalFailure = data.openRouterGlobalFailure;
        }

        if (typeof data.openRouterFailureCount === 'number') {
            this.openRouterFailureCount = data.openRouterFailureCount;
        }

        // Restore token metrics
        if (typeof data.totalTokensIn === 'number') {
            this.totalTokensIn = data.totalTokensIn;
        }
        if (typeof data.totalTokensOut === 'number') {
            this.totalTokensOut = data.totalTokensOut;
        }
        if (typeof data.totalRequests === 'number') {
            this.totalRequests = data.totalRequests;
        }
        if (typeof data.successfulRequests === 'number') {
            this.successfulRequests = data.successfulRequests;
        }
        if (typeof data.failedRequests === 'number') {
            this.failedRequests = data.failedRequests;
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
        if (this.stateSaveTimer) return;
        this.stateSaveTimer = setTimeout(async () => {
            this.stateSaveTimer = null;
            if (!this.stateDirty) return;
            this.stateDirty = false;
            await this.saveState();
        }, this.stateSaveDebounceMs);
    }

    _filterProvidersByType(providers, options = {}) {
        // By default, exclude moderationOnly providers (like Ollama) from casual chat
        // Set options.allowModerationOnly = true to include them (for guild moderation)
        const allowModerationOnly = options.allowModerationOnly === true;

        let filtered = providers;

        // Filter out moderationOnly providers unless explicitly allowed
        if (!allowModerationOnly) {
            filtered = filtered.filter(p => !p.moderationOnly);
        }

        if (this.selectedProviderType === 'auto') return filtered;

        return filtered.filter(provider => {
            const providerName = provider.name.toLowerCase();
            switch (this.selectedProviderType.toLowerCase()) {
                case 'openai':
                    return providerName === 'gpt5nano'; // preserved for compatibility with your UI
                case 'groq':
                    return providerName.startsWith('groq');
                case 'openrouter':
                    return providerName.startsWith('openrouter');
                case 'deepseek':
                    return providerName.startsWith('deepseek');
                case 'google':
                    return providerName.startsWith('googleai');
                case 'ollama':
                    return providerName.startsWith('ollama');
                default:
                    console.warn(
                        `Unknown provider type: ${this.selectedProviderType}, falling back to auto mode`
                    );
                    return true;
            }
        });
    }

    _rankedProviders(options = {}) {
        const now = Date.now();
        const filteredProviders = this._filterProvidersByType(this.providers, options);

        return filteredProviders
            .filter(p => {
                const disabledUntil = this.disabledProviders.get(p.name);
                const isDisabled = disabledUntil && disabledUntil > now;
                if (p.name.startsWith('OpenRouter') && this.openRouterGlobalFailure) return false;
                return !isDisabled;
            })
            .sort((a, b) => {
                const ma = this.metrics.get(a.name) || {
                    successes: 0,
                    failures: 0,
                    avgLatencyMs: 1500
                };
                const mb = this.metrics.get(b.name) || {
                    successes: 0,
                    failures: 0,
                    avgLatencyMs: 1500
                };

                const score = m => {
                    const trials = m.successes + m.failures || 1;
                    const successRate = m.successes / trials;
                    const latencyScore = 1 / Math.max(m.avgLatencyMs, 1);
                    return successRate * 0.7 + latencyScore * 0.3;
                };

                const priorityDelta = resolveCostPriority(a) - resolveCostPriority(b);
                if (priorityDelta !== 0) return priorityDelta;
                return score(mb) - score(ma);
            });
    }

    _getRandomProvider(options = {}) {
        const now = Date.now();
        const filteredProviders = this._filterProvidersByType(this.providers, options);

        const availableProviders = filteredProviders.filter(p => {
            const disabledUntil = this.disabledProviders.get(p.name);
            const isDisabled = disabledUntil && disabledUntil > now;
            if (p.name.startsWith('OpenRouter') && this.openRouterGlobalFailure) return false;
            return !isDisabled;
        });

        if (availableProviders.length === 0) return null;

        const minPriority = Math.min(...availableProviders.map(p => resolveCostPriority(p)));
        const preferred = availableProviders.filter(p => resolveCostPriority(p) === minPriority);
        const pool = preferred.length ? preferred : availableProviders;
        return this._pickWeightedProvider(pool) || pool[Math.floor(Math.random() * pool.length)];
    }

    _computeProviderWeight(provider) {
        const metrics = this.metrics.get(provider.name) || {
            successes: 0,
            failures: 0,
            avgLatencyMs: null
        };
        const total = (metrics.successes || 0) + (metrics.failures || 0);
        const successRate = total > 0 ? metrics.successes / total : 0.85;
        const latency = Math.max(metrics.avgLatencyMs || 1500, 150);
        const errorPenalty = this.providerErrors.has(provider.name) ? 0.4 : 1;
        return Math.max((successRate + 0.2) * (1 / latency) * errorPenalty, 0.0001);
    }

    _pickWeightedProvider(candidates) {
        if (!candidates.length) {
            return null;
        }

        const weighted = candidates.map(provider => ({
            provider,
            weight: this._computeProviderWeight(provider)
        }));

        const totalWeight = weighted.reduce((sum, entry) => sum + entry.weight, 0);
        if (!Number.isFinite(totalWeight) || totalWeight <= 0) {
            return candidates[Math.floor(Math.random() * candidates.length)];
        }

        let threshold = Math.random() * totalWeight;
        for (const entry of weighted) {
            threshold -= entry.weight;
            if (threshold <= 0) {
                return entry.provider;
            }
        }

        return weighted[weighted.length - 1].provider;
    }

    _recordMetric(name, ok, latencyMs) {
        const m = this.metrics.get(name) || { successes: 0, failures: 0, avgLatencyMs: 1500 };
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

    _isRetryable(error) {
        const status = error?.status || error?.response?.status;
        const message = String(error?.message || '').toLowerCase();
        if (error?.transient) return true;
        if (status && [408, 409, 429, 500, 502, 503, 504].includes(status)) return true;
        if (
            message.includes('empty') ||
            message.includes('timeout') ||
            message.includes('overloaded')
        )
            return true;
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

    async generateResponse(systemPrompt, userPrompt, maxTokens = config.ai?.maxTokens || 1024) {
        // Ensure prompts are strings (required by some providers like Groq)
        systemPrompt = systemPrompt != null ? String(systemPrompt) : '';
        userPrompt = userPrompt != null ? String(userPrompt) : '';

        // Safety check: reinitialize providers if somehow empty (handles rare edge cases)
        if (this.providers.length === 0) {
            console.warn('Provider list was empty - reinitializing providers...');
            this.setupProviders();
            if (this.providers.length === 0) {
                throw new Error('No AI providers available - check API key configuration');
            }
            console.log(`Reinitialized ${this.providers.length} AI providers`);
        }

        let candidates;
        if (this.useRandomSelection) {
            const randomProvider = this._getRandomProvider();
            const rankedProviders = this._rankedProviders();
            candidates = randomProvider
                ? [randomProvider, ...rankedProviders.filter(p => p.name !== randomProvider.name)]
                : rankedProviders;
        } else {
            candidates = this._rankedProviders();
        }

        let lastError = null;

        for (const provider of candidates) {
            const started = Date.now();
            const selectionType =
                this.useRandomSelection && candidates[0] === provider ? 'RANDOM' : 'FALLBACK';
            const providerTypeInfo =
                this.selectedProviderType === 'auto'
                    ? '[AUTO]'
                    : `[${this.selectedProviderType.toUpperCase()}]`;
            console.log(
                `Attempting AI request with ${provider.name} (${provider.model}) [${selectionType}] ${providerTypeInfo}`
            );

            const callOnce = async () => {
                if (provider.type === 'google') {
                    // NOTE: Reasoning flags are not used for Gemini here; keep it simple & stable
                    const model = provider.client.getGenerativeModel({ model: provider.model });

                    let result;
                    try {
                        result = await model.generateContent({
                            contents: [
                                {
                                    role: 'user',
                                    parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }]
                                }
                            ],
                            generationConfig: {
                                temperature: config.ai?.temperature ?? 0.7,
                                maxOutputTokens: maxTokens
                            }
                        });
                    } catch (geminiError) {
                        // Handle Gemini-specific errors (safety filters, quota, etc.)
                        const errorMessage = geminiError?.message || String(geminiError);
                        const status =
                            geminiError?.status ||
                            (errorMessage.includes('quota') || errorMessage.includes('429')
                                ? 429
                                : errorMessage.includes('safety') ||
                                    errorMessage.includes('blocked')
                                    ? 400
                                    : 502);
                        throw Object.assign(new Error(`Gemini error: ${errorMessage}`), { status });
                    }

                    const response = result?.response;

                    // Check for blocked responses (safety filters)
                    const blockReason = response?.promptFeedback?.blockReason;
                    if (blockReason) {
                        throw Object.assign(new Error(`Gemini blocked: ${blockReason}`), {
                            status: 400
                        });
                    }

                    // Check finish reason for issues
                    const finishReason = response?.candidates?.[0]?.finishReason;
                    if (finishReason === 'SAFETY') {
                        throw Object.assign(new Error(`Gemini safety filter triggered`), {
                            status: 400
                        });
                    }

                    let text = null;
                    try {
                        text = typeof response?.text === 'function' ? response.text() : null;
                    } catch (textError) {
                        // text() can throw if there are issues with the response
                        console.warn(`Gemini text() extraction failed: ${textError.message}`);
                    }

                    if (!text || !text.trim()) {
                        const fallbackParts =
                            response?.candidates?.flatMap(
                                candidate => candidate?.content?.parts || []
                            ) || [];
                        text = fallbackParts
                            .map(part => {
                                if (typeof part?.text === 'string') {
                                    return part.text;
                                }
                                if (part?.inlineData?.data) {
                                    return Buffer.from(part.inlineData.data, 'base64').toString(
                                        'utf8'
                                    );
                                }
                                return null;
                            })
                            .filter(Boolean)
                            .join('\n')
                            .trim();
                    }

                    if (!text) {
                        const debugInfo = finishReason ? ` (finishReason: ${finishReason})` : '';
                        throw Object.assign(
                            new Error(
                                `Invalid or empty response from ${provider.name}${debugInfo}`
                            ),
                            { status: 502 }
                        );
                    }

                    let cleaned = sanitizeAssistantMessage(text);
                    if (!cleaned && text) {
                        cleaned = text.trim();
                    }
                    if (!cleaned) {
                        throw Object.assign(
                            new Error(`Sanitized empty content from ${provider.name}`),
                            { status: 502 }
                        );
                    }

                    return { choices: [{ message: { content: cleaned } }] };
                }

                // ---------- Ollama native API handler (with image/vision support) ----------
                if (provider.type === 'ollama') {
                    const ollamaEndpoint = `${provider.baseURL}/chat`;

                    // Build messages array for Ollama
                    const messages = [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userPrompt }
                    ];

                    const requestBody = {
                        model: provider.model,
                        messages,
                        stream: false,
                        think: false, // Disable thinking mode - get direct response only
                        options: {
                            temperature: config.ai?.temperature ?? 0.7,
                            num_predict: maxTokens
                        }
                    };

                    const headers = {
                        'Content-Type': 'application/json'
                    };

                    // Add authentication if API key is provided
                    if (provider.apiKey) {
                        headers['Authorization'] = `Bearer ${provider.apiKey}`;
                    }

                    const response = await aiFetch(ollamaEndpoint, {
                        method: 'POST',
                        headers,
                        body: JSON.stringify(requestBody)
                    });

                    if (!response.ok) {
                        const errorText = await response.text().catch(() => 'Unknown error');
                        throw Object.assign(new Error(`Ollama error: ${errorText}`), {
                            status: response.status
                        });
                    }

                    const ollamaResp = await response.json();
                    const ollamaContent = ollamaResp?.message?.content;

                    if (!ollamaContent || !String(ollamaContent).trim()) {
                        console.warn(
                            `[Ollama] Empty response from ${provider.name}:`,
                            JSON.stringify(ollamaResp).slice(0, 300)
                        );
                        throw Object.assign(
                            new Error(`Empty response from ${provider.name} (transient)`),
                            { status: 502, transient: true }
                        );
                    }

                    const cleaned = sanitizeAssistantMessage(String(ollamaContent));
                    if (!cleaned) {
                        throw Object.assign(
                            new Error(`Sanitized empty content from ${provider.name}`),
                            { status: 502, transient: true }
                        );
                    }

                    // Return in standardized format
                    return {
                        choices: [{ message: { content: cleaned } }],
                        usage: {
                            prompt_tokens: ollamaResp?.prompt_eval_count || 0,
                            completion_tokens: ollamaResp?.eval_count || 0
                        }
                    };
                }

                // ---------- Cloudflare Workers AI handler (via deployed worker) ----------
                if (provider.type === 'cloudflare-worker') {
                    const cfEndpoint = `${provider.workerUrl}/api/chat`;

                    const messages = [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userPrompt }
                    ];

                    const response = await aiFetch(cfEndpoint, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${provider.apiKey}`
                        },
                        body: JSON.stringify({ messages, max_tokens: maxTokens })
                    });

                    if (!response.ok) {
                        const errorText = await response.text().catch(() => 'Unknown error');
                        throw Object.assign(new Error(`Cloudflare AI error: ${errorText}`), {
                            status: response.status
                        });
                    }

                    // Handle SSE stream - collect all chunks
                    const text = await response.text();
                    let fullContent = '';

                    // Parse SSE format: data: {"response":"..."}
                    const lines = text.split('\n');
                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            const jsonStr = line.slice(6);
                            if (jsonStr === '[DONE]') continue;
                            try {
                                const chunk = JSON.parse(jsonStr);
                                if (chunk.response) {
                                    fullContent += chunk.response;
                                }
                            } catch { }
                        }
                    }

                    if (!fullContent.trim()) {
                        throw Object.assign(
                            new Error(`Empty response from Cloudflare AI`),
                            { status: 502, transient: true }
                        );
                    }

                    const cleaned = sanitizeAssistantMessage(fullContent);
                    return {
                        choices: [{ message: { content: cleaned } }],
                        usage: { prompt_tokens: 0, completion_tokens: 0 }
                    };
                }

                // OpenAI-compatible providers (OpenRouter, Groq, DeepSeek via Vercel AI Gateway)
                const resp = await provider.client.chat.completions.create({
                    model: provider.model,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userPrompt }
                    ],
                    max_tokens: maxTokens,
                    temperature: config.ai?.temperature ?? 0.7
                });
                const choice = resp?.choices?.[0];
                const text = choice?.message?.content;
                if (!text || !String(text).trim()) {
                    throw Object.assign(new Error(`Empty response content from ${provider.name}`), {
                        status: 502
                    });
                }

                // Sanitize response (was missing - could leak prompt injection artifacts)
                const sanitized = sanitizeAssistantMessage(String(text));
                if (!sanitized) {
                    throw Object.assign(
                        new Error(`Sanitized empty content from ${provider.name}`),
                        { status: 502 }
                    );
                }
                resp.choices[0].message.content = sanitized;
                return resp;
            };

            try {
                const retryAttempts = Math.max(0, Number(config.ai?.retryAttempts || 0));
                const resp = await this._retry(callOnce, {
                    retries: retryAttempts,
                    baseDelay: retryAttempts > 0 ? 500 : 0,
                    jitter: retryAttempts > 0,
                    providerName: provider.name
                });

                const latency = Date.now() - started;
                this._recordMetric(provider.name, true, latency);

                if (provider.name.startsWith('OpenRouter')) {
                    this.openRouterFailureCount = 0;
                }

                // Reset failure count on success (for exponential backoff)
                if (this.providerFailureCounts.has(provider.name)) {
                    this.providerFailureCounts.delete(provider.name);
                }

                console.log(`Success with ${provider.name} (${provider.model}) in ${latency}ms`);

                // Track tokens from response
                this.totalRequests++;
                this.successfulRequests++;
                const tokensIn = resp?.usage?.prompt_tokens || 0;
                const tokensOut = resp?.usage?.completion_tokens || 0;
                if (resp?.usage) {
                    this.totalTokensIn += tokensIn;
                    this.totalTokensOut += tokensOut;
                }
                this.scheduleStateSave();

                // Notify dashboard of token usage (lazy-loaded at module level)
                const dashboard = getDashboard();
                if (dashboard?.trackTokens) {
                    dashboard.trackTokens(tokensIn, tokensOut);
                }

                const raw =
                    resp &&
                        resp.choices &&
                        resp.choices[0] &&
                        resp.choices[0].message &&
                        resp.choices[0].message.content
                        ? String(resp.choices[0].message.content)
                        : '';
                const cleaned = sanitizeAssistantMessage(raw);
                return {
                    content: cleaned,
                    provider: provider.name,
                    tokensIn: resp?.usage?.prompt_tokens || 0,
                    tokensOut: resp?.usage?.completion_tokens || 0
                };
            } catch (error) {
                const latency = Date.now() - started;
                this._recordMetric(provider.name, false, latency);
                this.totalRequests++;
                this.failedRequests++;
                this.providerErrors.set(provider.name, {
                    error: error.message,
                    timestamp: Date.now(),
                    status: error.status
                });
                this.scheduleStateSave();

                console.error(
                    `Failed with ${provider.name} (${provider.model}) after ${latency}ms: ${error.message} ${error.status ? `(Status: ${error.status})` : ''}`
                );
                lastError = error;

                // Disable logic (circuit breaker) — skip transient errors
                // Uses exponential backoff: 5min → 15min → 1hr → 2hr based on consecutive failures
                const shouldDisable = !error.transient;
                if (shouldDisable) {
                    const currentFailures = (this.providerFailureCounts.get(provider.name) || 0) + 1;
                    this.providerFailureCounts.set(provider.name, currentFailures);

                    // Exponential backoff durations (in ms)
                    const backoffDurations = [
                        5 * 60 * 1000,      // 1st failure: 5 minutes
                        15 * 60 * 1000,     // 2nd failure: 15 minutes
                        60 * 60 * 1000,     // 3rd failure: 1 hour
                        2 * 60 * 60 * 1000  // 4th+ failure: 2 hours (max)
                    ];
                    const backoffIndex = Math.min(currentFailures - 1, backoffDurations.length - 1);
                    const disableDuration = backoffDurations[backoffIndex];
                    const durationLabel = disableDuration >= 60 * 60 * 1000
                        ? `${disableDuration / (60 * 60 * 1000)}h`
                        : `${disableDuration / (60 * 1000)}m`;

                    this.disabledProviders.set(provider.name, Date.now() + disableDuration);
                    this.scheduleStateSave();
                    console.log(`${provider.name} disabled for ${durationLabel} (failure #${currentFailures})`);
                }

                // Track OpenRouter consecutive empties to toggle global failure
                const isEmptyResponse = String(error.message || '')
                    .toLowerCase()
                    .includes('empty');
                if (isEmptyResponse && provider.name.startsWith('OpenRouter')) {
                    this.openRouterFailureCount += 1;
                    if (this.openRouterFailureCount >= 2) {
                        this.openRouterGlobalFailure = true;
                        this.openRouterFailureCount = 0;
                        console.log(
                            'OpenRouter global failure detected - disabling all OpenRouter providers temporarily'
                        );
                        const clearAfter = 6 * 60 * 60 * 1000;
                        const clearGlobal = () => {
                            this.openRouterGlobalFailure = false;
                            this.openRouterFailureCount = 0;
                            console.log(
                                'OpenRouter global failure cleared - re-enabling OpenRouter providers'
                            );
                            this.scheduleStateSave();
                        };

                        // Canary after 5 minutes to re-enable sooner if transient
                        setTimeout(
                            () => {
                                const canary = this.providers.find(
                                    p =>
                                        p.name.startsWith('OpenRouter') &&
                                        !this.disabledProviders.get(p.name)
                                );
                                if (!canary) {
                                    return clearGlobal();
                                }
                                canary.client.chat.completions
                                    .create({
                                        model: canary.model,
                                        messages: [{ role: 'user', content: 'ping' }]
                                    })
                                    .then(() => {
                                        clearGlobal();
                                    })
                                    .catch(() => {
                                        setTimeout(clearGlobal, clearAfter - 5 * 60 * 1000);
                                    });
                            },
                            5 * 60 * 1000
                        ).unref?.();
                    }
                }
            }
        }

        throw new Error(`All AI providers failed: ${lastError?.message || 'Unknown error'}`);
    }

    /**
     * Generate a response with image support (for vision-capable models like Ollama)
     * @param {string} systemPrompt - System prompt for the AI
     * @param {string} userPrompt - User message/prompt
     * @param {Array<{url: string, contentType?: string}>} images - Array of image objects with URLs
     * @param {number} maxTokens - Maximum tokens in response
     * @param {Object} options - Additional options
     * @param {boolean} options.allowModerationOnly - If true, allow using moderationOnly providers (for guild moderation)
     * @returns {Promise<{content: string, provider: string, tokensIn: number, tokensOut: number}>}
     */
    async generateResponseWithImages(
        systemPrompt,
        userPrompt,
        images = [],
        maxTokens = config.ai?.maxTokens || 1024,
        options = {}
    ) {
        const { allowModerationOnly = false } = options;

        // If no images, fall back to regular generateResponse
        if (!images || images.length === 0) {
            return this.generateResponse(systemPrompt, userPrompt, maxTokens);
        }

        // Ensure prompts are strings
        systemPrompt = systemPrompt != null ? String(systemPrompt) : '';
        userPrompt = userPrompt != null ? String(userPrompt) : '';

        // Safety check: reinitialize providers if somehow empty
        if (this.providers.length === 0) {
            console.warn('Provider list was empty - reinitializing providers...');
            this.setupProviders();
            if (this.providers.length === 0) {
                throw new Error('No AI providers available - check API key configuration');
            }
        }

        // Filter for providers that support images (Ollama with vision models)
        // Respect moderationOnly flag - only allow if explicitly requested
        const imageCapableProviders = this.providers.filter(
            p => p.supportsImages && p.type === 'ollama' && (allowModerationOnly || !p.moderationOnly)
        );

        if (imageCapableProviders.length === 0) {
            console.warn(
                'No image-capable providers available (moderationOnly=' + allowModerationOnly + '), falling back to text-only response'
            );
            return this.generateResponse(systemPrompt, userPrompt, maxTokens);
        }

        // Download and convert images to base64
        const base64Images = [];
        for (const image of images) {
            try {
                const imageUrl = image.url || image;
                // Validate supported image types
                const supportedTypes = [
                    'image/jpeg',
                    'image/jpg',
                    'image/png',
                    'image/webp',
                    'image/gif'
                ];
                const contentType = image.contentType || '';

                // Fetch and convert to base64
                const response = await aiFetch(imageUrl);
                if (!response.ok) {
                    console.warn(`Failed to fetch image: ${imageUrl}`);
                    continue;
                }

                const arrayBuffer = await response.arrayBuffer();
                let buffer = Buffer.from(arrayBuffer);

                // Prevent OOM from malicious large images (10MB limit)
                const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
                if (buffer.length > MAX_IMAGE_SIZE_BYTES) {
                    console.warn(`Image too large (${(buffer.length / 1024 / 1024).toFixed(1)}MB), skipping: ${imageUrl}`);
                    continue;
                }

                // Check content type from response or URL extension
                let mimeType = response.headers.get('content-type') || contentType;
                if (!mimeType) {
                    const ext = imageUrl.split('.').pop()?.toLowerCase().split('?')[0];
                    const extMap = {
                        jpg: 'image/jpeg',
                        jpeg: 'image/jpeg',
                        png: 'image/png',
                        webp: 'image/webp',
                        gif: 'image/gif'
                    };
                    mimeType = extMap[ext] || 'image/jpeg';
                }

                if (!supportedTypes.some(t => mimeType.includes(t.split('/')[1]))) {
                    console.warn(`Unsupported image type: ${mimeType}`);
                    continue;
                }

                // For GIFs, extract the first frame and convert to PNG
                if (mimeType.includes('gif')) {
                    try {
                        buffer = await sharp(buffer, { pages: 1 })
                            .png()
                            .toBuffer();
                        console.log('[Image] Extracted first frame from GIF');
                    } catch (gifErr) {
                        console.warn(`Failed to extract GIF frame: ${gifErr.message}`);
                    }
                }

                const base64 = buffer.toString('base64');
                base64Images.push(base64);
            } catch (err) {
                console.warn(`Error processing image: ${err.message}`);
            }
        }

        if (base64Images.length === 0) {
            console.warn('No valid images could be processed, falling back to text-only response');
            return this.generateResponse(systemPrompt, userPrompt, maxTokens);
        }

        let lastError = null;

        // Try each image-capable provider
        // First, check how many are actually available (not disabled)
        const availableProviders = imageCapableProviders.filter(p => {
            const disabledUntil = this.disabledProviders.get(p.name);
            return !disabledUntil || disabledUntil <= Date.now();
        });

        if (availableProviders.length === 0 && imageCapableProviders.length > 0) {
            console.warn(
                `All ${imageCapableProviders.length} Ollama providers are temporarily disabled, clearing disabled state...`
            );
            // Clear disabled state for Ollama providers to retry
            for (const p of imageCapableProviders) {
                this.disabledProviders.delete(p.name);
            }
        }

        for (const provider of imageCapableProviders) {
            const started = Date.now();
            const disabledUntil = this.disabledProviders.get(provider.name);
            if (disabledUntil && disabledUntil > Date.now()) continue;

            console.log(
                `Attempting image request with ${provider.name} (${provider.model}) [${base64Images.length} image(s)]`
            );

            try {
                if (provider.type === 'ollama') {
                    const ollamaEndpoint = `${provider.baseURL}/chat`;

                    // Build messages with images for Ollama
                    // Ollama expects images as base64 strings in the 'images' array of the user message
                    const messages = [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userPrompt, images: base64Images }
                    ];

                    const requestBody = {
                        model: provider.model,
                        messages,
                        stream: false,
                        think: false, // Disable thinking mode - get direct response only
                        options: {
                            temperature: config.ai?.temperature ?? 0.7,
                            num_predict: maxTokens
                        }
                    };

                    const headers = {
                        'Content-Type': 'application/json'
                    };

                    if (provider.apiKey) {
                        headers['Authorization'] = `Bearer ${provider.apiKey}`;
                    }

                    console.log(
                        `[Ollama Vision] POST ${ollamaEndpoint} | model: ${provider.model} | images: ${base64Images.length} | img size: ${base64Images[0]?.length || 0} chars`
                    );

                    const response = await aiFetch(ollamaEndpoint, {
                        method: 'POST',
                        headers,
                        body: JSON.stringify(requestBody)
                    });

                    console.log(`[Ollama Vision] Response status: ${response.status}`);

                    if (!response.ok) {
                        const errorText = await response.text().catch(() => 'Unknown error');
                        console.error(`[Ollama Vision] Error: ${errorText.slice(0, 500)}`);
                        throw Object.assign(new Error(`Ollama error: ${errorText}`), {
                            status: response.status
                        });
                    }

                    const ollamaResp = await response.json();
                    const ollamaContent = ollamaResp?.message?.content;

                    if (!ollamaContent || !String(ollamaContent).trim()) {
                        console.warn(
                            `[Ollama Vision] Empty response from ${provider.name}:`,
                            JSON.stringify(ollamaResp).slice(0, 500)
                        );
                        throw Object.assign(
                            new Error(`Empty response from ${provider.name} (transient)`),
                            { status: 502, transient: true }
                        );
                    }

                    console.log(`[Ollama Vision] Success, content length: ${ollamaContent.length}`);

                    const cleaned = sanitizeAssistantMessage(String(ollamaContent));
                    if (!cleaned) {
                        throw Object.assign(
                            new Error(`Sanitized empty content from ${provider.name}`),
                            { status: 502 }
                        );
                    }

                    const latency = Date.now() - started;
                    this._recordMetric(provider.name, true, latency);
                    this.totalRequests++;
                    this.successfulRequests++;

                    const tokensIn = ollamaResp?.prompt_eval_count || 0;
                    const tokensOut = ollamaResp?.eval_count || 0;
                    this.totalTokensIn += tokensIn;
                    this.totalTokensOut += tokensOut;
                    this.scheduleStateSave();

                    console.log(
                        `Success with ${provider.name} (${provider.model}) [image] in ${latency}ms`
                    );

                    return {
                        content: cleaned,
                        provider: provider.name,
                        tokensIn,
                        tokensOut,
                        hadImages: true
                    };
                }
            } catch (error) {
                const latency = Date.now() - started;
                this._recordMetric(provider.name, false, latency);
                this.totalRequests++;
                this.failedRequests++;
                this.providerErrors.set(provider.name, {
                    error: error.message,
                    timestamp: Date.now(),
                    status: error.status
                });
                this.scheduleStateSave();

                console.error(
                    `Failed with ${provider.name} (${provider.model}) [image] after ${latency}ms: ${error.message}`
                );
                lastError = error;

                // Only disable provider for hard failures, not transient ones (empty responses)
                if (!error.transient) {
                    this.disabledProviders.set(provider.name, Date.now() + 2 * 60 * 60 * 1000);
                }
            }
        }

        // If all image providers failed, try without images as fallback
        console.warn(
            `All image-capable providers failed (last error: ${lastError?.message}), attempting text-only fallback`
        );
        return this.generateResponse(
            systemPrompt,
            `[User sent ${images.length} image(s) that could not be processed]\n\n${userPrompt}`,
            maxTokens
        );
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
                        avgLatencyMs: metrics.avgLatencyMs
                    }
                };
            })
            .sort((a, b) => {
                if (a.priority !== b.priority) return a.priority - b.priority;
                const rateA = a.metrics.successRate ?? -1;
                const rateB = b.metrics.successRate ?? -1;
                if (rateA !== rateB) return rateB - rateA;
                return (
                    (a.metrics.avgLatencyMs ?? Number.POSITIVE_INFINITY) -
                    (b.metrics.avgLatencyMs ?? Number.POSITIVE_INFINITY)
                );
            });
    }

    getRedactedProviderStatus() {
        return this.getProviderStatus().map(p => ({
            ...p,
            name: this._redactProviderName(p.name),
            model: this._redactModelName(p.model),
            lastError: p.hasError ? '[REDACTED]' : null
        }));
    }

    getProviderAnalytics() {
        return this.getProviderStatus().map(provider => {
            const uptimePercentage =
                provider.metrics.successRate != null ? provider.metrics.successRate * 100 : null;
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
                    avgLatencyMs: provider.metrics.avgLatencyMs
                },
                disabledUntil: provider.disabledUntil,
                isDisabled: provider.isDisabled,
                hasError: provider.hasError,
                lastError: provider.lastError
            };
        });
    }

    _redactProviderName(name) {
        const redactionMap = {
            OpenRouter1: '[REDACTED]',
            OpenRouter2: '[REDACTED]',
            OpenRouter3: '[REDACTED]',
            OpenRouter4: '[REDACTED]',
            OpenRouter5: '[REDACTED]',
            OpenRouter6: '[REDACTED]',
            OpenRouter7: '[REDACTED]',
            OpenRouter8: '[REDACTED]',
            OpenRouter9: '[REDACTED]',
            OpenRouter10: '[REDACTED]',
            OpenRouter11: '[REDACTED]',
            OpenRouter12: '[REDACTED]',
            OpenRouter13: '[REDACTED]',
            OpenRouter14: '[REDACTED]',
            OpenRouter15: '[REDACTED]',
            OpenRouter16: '[REDACTED]',
            OpenRouter17: '[REDACTED]',
            OpenRouter18: '[REDACTED]',
            OpenRouter19: '[REDACTED]',
            OpenRouter20: '[REDACTED]',
            OpenRouter21: '[REDACTED]',
            OpenRouter22: '[REDACTED]',
            Groq1: '[REDACTED]',
            Groq2: '[REDACTED]',
            Groq3: '[REDACTED]',
            Groq4: '[REDACTED]',
            Groq5: '[REDACTED]',
            Groq6: '[REDACTED]',
            Groq7: '[REDACTED]',
            GoogleAI1: '[REDACTED]',
            GoogleAI2: '[REDACTED]',
            GPT5Nano: '[REDACTED]',
            'deepseek-gateway-1': '[REDACTED]',
            'deepseek-gateway-2': '[REDACTED]',
            Ollama1: '[REDACTED]',
            Ollama2: '[REDACTED]',
            Ollama3: '[REDACTED]',
            Ollama4: '[REDACTED]',
            Ollama5: '[REDACTED]'
        };
        return redactionMap[name] || '[REDACTED]';
    }

    _redactModelName(_model) {
        return '[REDACTED]';
    }

    setRandomSelection(enabled) {
        this.useRandomSelection = !!enabled;
        console.log(`Provider selection mode changed to: ${enabled ? 'Random' : 'Ranked'}`);
    }

    getSelectionMode() {
        return this.useRandomSelection ? 'random' : 'ranked';
    }

    setProviderType(providerType) {
        const validTypes = ['auto', 'openai', 'groq', 'openrouter', 'google', 'deepseek', 'ollama'];
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
            if (name === 'gpt5nano') types.add('openai');
            else if (name.startsWith('groq')) types.add('groq');
            else if (name.startsWith('openrouter')) types.add('openrouter');
            else if (name.startsWith('googleai')) types.add('google');
            else if (name.startsWith('deepseek')) types.add('deepseek');
            else if (name.startsWith('ollama')) types.add('ollama');
        });
        const available = Array.from(types).sort();
        available.unshift('auto');
        return available;
    }

    cleanupOldMetrics() {
        const now = Date.now();
        const maxAge = 24 * 60 * 60 * 1000;
        for (const [name, error] of this.providerErrors.entries()) {
            if (now - (error?.timestamp || 0) > maxAge) this.providerErrors.delete(name);
        }
        for (const [name, disabledUntil] of this.disabledProviders.entries()) {
            if (disabledUntil <= now) this.disabledProviders.delete(name);
        }
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
        this.openRouterGlobalFailure = false;
        this.openRouterFailureCount = 0;
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

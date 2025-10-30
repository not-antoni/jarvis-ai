'use strict';
/**
 * AI Provider Manager (Slim & Robust)
 * -----------------------------------
 * Providers kept:
 *   - OpenAI: gpt-5-nano (official endpoint)
 *   - Vercel AI Gateway: deepseek/deepseek-v3.2-exp (OpenAI-compatible)
 *
 * Features:
 *   - Random-first selection with ranked fallback (cost + success/latency score)
 *   - Circuit breaker (2h) for non-Nano providers; Nano is never disabled
 *   - Zero retries by design (surface errors fast, per user's preference)
 *   - Output sanitation + tolerant JSON/structured parsing for Nano
 *   - State persistence for metrics/errors/disabledProviders
 *
 * Env:
 *   - OPENAI_API_KEY (or OPENAI)         => for GPT-5 Nano
 *   - AI_GATEWAY_API_KEY (and ...KEY2)   => for Vercel DeepSeek
 *   - APP_URL / APP_NAME (optional analytics headers for gateway)

 */

const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');
const config = require('./config');

/** BEGIN: sanitizeModelOutput helper (injected) **/
function sanitizeModelOutput(text) {
  if (!text || typeof text !== 'string') return text;
  let out = text.replace(/\r\n?/g, '\n');
  out = out.replace(/<\/message>\s*<\/start>\s*assistant\s*<\/channel>\s*final\s*<\/message>/gi, ' ');
  out = out.replace(/<\/channel>\s*final\s*<\/message>/gi, ' ');
  out = out.replace(/<start>\s*assistant\b[^>]*>/gi, ' ');
  out = out.replace(/<\/start>\s*assistant\b[^>]*>/gi, ' ');
  out = out.replace(/<\s*\/?channel\b[^>]*>/gi, ' ');
  out = out.replace(/<\s*\/?message\b[^>]*>/gi, ' ');
  out = out.replace(/\b(Certainly|Absolutely|Certainly!|Sure|Affirmative)[\s\p{P}\-]{0,40}(?:(Certainly|Absolutely|Sure|Affirmative)[\s\p{P}\-]*){1,}/giu, '$1');
  out = out.replace(/\s+/g, ' ').trim();
  return out;
}
/** END: sanitizeModelOutput helper (injected) **/

const fsp = fs.promises;
const PROVIDER_STATE_PATH = path.join(__dirname, 'provider-state.json');
const COST_PRIORITY = { free: 0, freemium: 1, paid: 2 };

function resolveCostPriority(p) {
  const tier = p.costTier || 'paid';
  return Object.prototype.hasOwnProperty.call(COST_PRIORITY, tier)
    ? COST_PRIORITY[tier]
    : COST_PRIORITY.paid;
}

class AIProviderManager {
  constructor() {
    this.providers = [];
    this.providerErrors = new Map();
    this.metrics = new Map();
    this.disabledProviders = new Map();

    // Selection & routing flags
    this.useRandomSelection = true; // random-first, then ranked fallback
    this.selectedProviderType = (config.ai?.provider || 'auto'); // 'auto' | 'openai' | 'deepseek'

    // Persistence
    this.stateSaveTimer = null;
    this.stateSaveDebounceMs = 1500;
    this.stateDirty = false;

    this.setupProviders();
    this.loadState();
  }

  setupProviders() {
    // ---------- DeepSeek via Vercel AI Gateway (OpenAI-compatible) ----------
    const deepseekKeys = [
      process.env.AI_GATEWAY_API_KEY,
      process.env.AI_GATEWAY_API_KEY2,
    ].filter(Boolean);

    deepseekKeys.forEach((key, i) => {
      this.providers.push({
        name: `deepseek-gateway-${i + 1}`,
        client: new OpenAI({
          apiKey: key,
          baseURL: 'https://ai-gateway.vercel.sh/v1',
          defaultHeaders: {
            'HTTP-Referer': process.env.APP_URL || 'https://localhost',
            'X-Title': process.env.APP_NAME || 'Jarvis AI',
          },
        }),
        model: 'deepseek/deepseek-v3.2-exp',
        type: 'deepseek',    // OpenAI-compatible
        family: 'deepseek',
        costTier: 'paid',
      });
    });

    // ---------- GPT-5 Nano (OpenAI official) ----------
    if (process.env.OPENAI || process.env.OPENAI) {
      const key = process.env.OPENAI_API_KEY || process.env.OPENAI;
      this.providers.push({
        name: 'GPT5Nano',
        client: new OpenAI({ apiKey: key }), // https://api.openai.com/v1
        model: 'gpt-5-nano',
        type: 'gpt5-nano',
        family: 'openai',
        costTier: 'paid',
      });
    }

    // Prefer cheaper first (if any become freemium), then dynamic score
    this.providers.sort((a, b) => resolveCostPriority(a) - resolveCostPriority(b));

    console.log(`Initialized ${this.providers.length} AI providers (DeepSeek + GPT-5 Nano only)`);
    console.log(`Selection mode: ${this.useRandomSelection ? 'Random-first' : 'Ranked'}`);
    console.log(`Provider filter: ${this.selectedProviderType}`);
  }

  // -------------------- Persistence --------------------
  loadState() {
    try {
      if (!fs.existsSync(PROVIDER_STATE_PATH)) return;
      const raw = fs.readFileSync(PROVIDER_STATE_PATH, 'utf8');
      if (!raw.trim()) return;
      const data = JSON.parse(raw);

      if (data.metrics && typeof data.metrics === 'object') {
        for (const [name, metric] of Object.entries(data.metrics)) {
          if (this.providers.find((p) => p.name === name) && metric) {
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
          if (Number.isFinite(parsed) && parsed > now && this.providers.find((p) => p.name === name)) {
            this.disabledProviders.set(name, parsed);
          }
        }
      }

      if (data.providerErrors && typeof data.providerErrors === 'object') {
        for (const [name, err] of Object.entries(data.providerErrors)) {
          if (err && typeof err === 'object' && this.providers.find((p) => p.name === name)) {
            this.providerErrors.set(name, err);
          }
        }
      }

      console.log('Restored provider cache from disk');
    } catch (error) {
      console.warn('Failed to restore provider cache:', error);
    }
  }

  async saveState() {
    try {
      const payload = {
        metrics: Object.fromEntries(this.metrics),
        disabledProviders: Object.fromEntries(this.disabledProviders),
        providerErrors: Object.fromEntries(this.providerErrors),
        savedAt: new Date().toISOString(),
      };
      await fsp.writeFile(PROVIDER_STATE_PATH, JSON.stringify(payload, null, 2), 'utf8');
    } catch (error) {
      console.warn('Failed to persist provider cache:', error);
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

  // -------------------- Selection --------------------
  _filterProvidersByType(providers) {
    const t = String(this.selectedProviderType || 'auto').toLowerCase();
    if (t === 'auto') return providers;
    return providers.filter((p) => {
      const n = p.name.toLowerCase();
      switch (t) {
        case 'openai': return n === 'gpt5nano';
        case 'deepseek': return n.startsWith('deepseek-gateway-');
        default:
          console.warn(`Unknown provider type: ${t}, falling back to auto`);
          return true;
      }
    });
  }

  _rankedProviders() {
    const now = Date.now();
    const filtered = this._filterProvidersByType(this.providers);
    return filtered
      .filter((p) => {
        const until = this.disabledProviders.get(p.name);
        return !(until && until > now);
      })
      .sort((a, b) => {
        const ma = this.metrics.get(a.name) || { successes: 0, failures: 0, avgLatencyMs: 1500 };
        const mb = this.metrics.get(b.name) || { successes: 0, failures: 0, avgLatencyMs: 1500 };
        const score = (m) => {
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

  _getRandomProvider() {
    const now = Date.now();
    const filtered = this._filterProvidersByType(this.providers);
    const available = filtered.filter((p) => {
      const until = this.disabledProviders.get(p.name);
      return !(until && until > now);
    });
    if (!available.length) return null;
    const minPriority = Math.min(...available.map(resolveCostPriority));
    const preferred = available.filter((p) => resolveCostPriority(p) === minPriority);
    const pool = preferred.length ? preferred : available;
    const idx = Math.floor(Math.random() * pool.length);
    return pool[idx];
  }

  _recordMetric(name, ok, latencyMs) {
    const m = this.metrics.get(name) || { successes: 0, failures: 0, avgLatencyMs: 1500 };
    if (ok) m.successes += 1; else m.failures += 1;
    if (!Number.isFinite(m.avgLatencyMs) || m.avgLatencyMs <= 0) m.avgLatencyMs = latencyMs;
    else m.avgLatencyMs = m.avgLatencyMs * 0.7 + latencyMs * 0.3;
    this.metrics.set(name, m);
    this.scheduleStateSave();
  }

  // -------------------- Invoke --------------------
  _isRetryable(err) {
    const status = err?.status || err?.response?.status;
    const message = String(err?.message || '').toLowerCase();
    if (status && [408, 409, 429, 500, 502, 503, 504].includes(status)) return true;
    if (message.includes('empty') || message.includes('timeout') || message.includes('overloaded')) return true;
    return false;
  }

  async _retry(fn, { retries = 0 } = {}) {
    // Intentionally single-shot (retries=0) per user's preference.
    return fn(0);
  }

  async generateResponse(systemPrompt, userPrompt, maxTokens = (config.ai?.maxTokens || 1024)) {
    if (this.providers.length === 0) {
      throw new Error('No AI providers available');
    }

    let candidates;
    if (this.useRandomSelection) {
      const r = this._getRandomProvider();
      const ranked = this._rankedProviders();
      candidates = r ? [r, ...ranked.filter((p) => p.name !== r.name)] : ranked;
    } else {
      candidates = this._rankedProviders();
    }

    let lastError = null;

    for (const provider of candidates) {
      const started = Date.now();
      const selectionType = (this.useRandomSelection && candidates[0] === provider) ? 'RANDOM' : 'FALLBACK';
      const providerTypeInfo = this.selectedProviderType === 'auto' ? '[AUTO]' : `[${this.selectedProviderType.toUpperCase()}]`;
      console.log(`Attempting AI request with ${provider.name} (${provider.model}) [${selectionType}] ${providerTypeInfo}`);

      const callOnce = async () => {
        if (provider.type === 'gpt5-nano') {
          // GPT-5 Nano: tolerant to non-standard JSON-ish outputs
          const resp = await provider.client.chat.completions.create({
            model: provider.model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            max_tokens: maxTokens,
            temperature: (config.ai?.temperature ?? 0.7),
          });

          let content = resp?.choices?.[0]?.message?.content;
          if (!content || !String(content).trim()) {
            throw Object.assign(new Error(`Empty response content from ${provider.name}`), { status: 502 });
          }

          // Try strict JSON parse
          try {
            const parsed = JSON.parse(content);
            if (typeof parsed === 'object' && parsed !== null) {
              if (parsed.response) content = parsed.response;
              else if (parsed.answer) content = parsed.answer;
              else if (parsed.output) content = parsed.output;
              else if (parsed.content) content = parsed.content;
              else content = JSON.stringify(parsed);
            }
          } catch {
            // Heuristic field extraction
            const hit =
              content.match(/"content"\s*:\s*"([^"]+)"/i) ||
              content.match(/"answer"\s*:\s*"([^"]+)"/i) ||
              content.match(/"response"\s*:\s*"([^"]+)"/i) ||
              content.match(/"output"\s*:\s*"([^"]+)"/i);
            if (hit) content = hit[1];
          }

          // Strip surrounding quotes/brackets/braces
          content = String(content).replace(/^["'{\[\s]+|["'\]\}\s]+$/g, '').trim();
          if (!content) throw Object.assign(new Error(`Sanitized empty content from ${provider.name}`), { status: 502 });

          resp.choices[0].message.content = content;
          return resp;
        }

        // DeepSeek via Vercel Gateway (OpenAI-compatible)
        const resp = await provider.client.chat.completions.create({
          model: provider.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          max_tokens: maxTokens,
          temperature: (config.ai?.temperature ?? 0.7),
        });
        const choice = resp?.choices?.[0];
        const text = choice?.message?.content;
        if (!text || !String(text).trim()) {
          throw Object.assign(new Error(`Empty response content from ${provider.name}`), { status: 502 });
        }
        return resp;
      };

      try {
        const resp = await this._retry(callOnce, { retries: 0 });
        const latency = Date.now() - started;
        this._recordMetric(provider.name, true, latency);
        console.log(`Success with ${provider.name} (${provider.model}) in ${latency}ms`);
        const raw = String(resp?.choices?.[0]?.message?.content || '');
        const cleaned = sanitizeModelOutput(raw);
        return { content: cleaned, provider: provider.name };
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

        // Circuit-breaker: disable for 2h unless it's Nano (keep Nano always available)
        const shouldDisable = provider.type !== 'gpt5-nano';
        if (shouldDisable) {
          const disableMs = 2 * 60 * 60 * 1000;
          this.disabledProviders.set(provider.name, Date.now() + disableMs);
          this.scheduleStateSave();
          console.log(`${provider.name} disabled for 2 hours due to error`);
        }
      }
    }

    throw new Error(`All AI providers failed: ${lastError?.message || 'Unknown error'}`);
  }

  // -------------------- Admin / Telemetry --------------------
  getProviderStatus() {
    const now = Date.now();
    return this.providers
      .map((p) => {
        const m = this.metrics.get(p.name) || { successes: 0, failures: 0, avgLatencyMs: null };
        const total = m.successes + m.failures;
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
            successes: m.successes,
            failures: m.failures,
            totalRequests: total,
            successRate: total ? m.successes / total : null,
            avgLatencyMs: m.avgLatencyMs,
          },
        };
      })
      .sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        const rateA = a.metrics.successRate ?? -1;
        const rateB = b.metrics.successRate ?? -1;
        if (rateA !== rateB) return rateB - rateA;
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
    return this.getProviderStatus().map((p) => ({
      name: p.name,
      model: p.model,
      type: p.type,
      family: p.family,
      costTier: p.costTier,
      priority: p.priority,
      metrics: {
        successes: p.metrics.successes,
        failures: p.metrics.failures,
        total: p.metrics.totalRequests,
        successRate: p.metrics.successRate != null ? p.metrics.successRate * 100 : null,
        avgLatencyMs: p.metrics.avgLatencyMs,
      },
      disabledUntil: p.disabledUntil,
      isDisabled: p.isDisabled,
      hasError: p.hasError,
      lastError: p.lastError,
    }));
  }

  _redactProviderName(name) {
    const map = {
      'GPT5Nano': '[REDACTED]',
      'deepseek-gateway-1': '[REDACTED]',
      'deepseek-gateway-2': '[REDACTED]',
    };
    return map[name] || '[REDACTED]';
  }

  _redactModelName(_m) {
    return '[REDACTED]';
  }

  setRandomSelection(enabled) {
    this.useRandomSelection = !!enabled;
    console.log(`Selection mode: ${enabled ? 'Random-first' : 'Ranked'}`);
  }

  getSelectionMode() {
    return this.useRandomSelection ? 'random' : 'ranked';
  }

  setProviderType(providerType) {
    const valid = ['auto', 'openai', 'deepseek'];
    const t = String(providerType || '').toLowerCase();
    if (!valid.includes(t)) {
      throw new Error(`Invalid provider type. Valid options: ${valid.join(', ')}`);
    }
    this.selectedProviderType = t;
    console.log(`Provider type changed to: ${this.selectedProviderType}`);
  }

  getProviderType() {
    return this.selectedProviderType;
  }

  getAvailableProviderTypes() {
    const types = new Set();
    this.providers.forEach((p) => {
      const n = p.name.toLowerCase();
      if (n === 'gpt5nano') types.add('openai');
      else if (n.startsWith('deepseek-gateway-')) types.add('deepseek');
    });
    const arr = Array.from(types).sort();
    arr.unshift('auto');
    return arr;
  }

  cleanupOldMetrics() {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000;
    for (const [name, err] of this.providerErrors.entries()) {
      if (now - (err?.timestamp || 0) > maxAge) this.providerErrors.delete(name);
    }
    for (const [name, until] of this.disabledProviders.entries()) {
      if (until <= now) this.disabledProviders.delete(name);
    }
  }
}

module.exports = new AIProviderManager();

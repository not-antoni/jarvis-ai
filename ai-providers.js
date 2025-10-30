'use strict';
/**
 * AI Provider Manager (DeepSeek + GPT-5 Nano) — Fixed
 * ---------------------------------------------------
 * Providers:
 *   - OpenAI GPT-5 Nano (official)   -> uses max_completion_tokens
 *   - Vercel AI Gateway DeepSeek     -> disables reasoning/thinking when supported
 *
 * Guarantees:
 *   • Only process.env.OPENAI is used for OpenAI API key
 *   • Random-first selection + ranked fallback
 *   • Circuit-breaker for DeepSeek (2h). GPT-5 Nano is never disabled.
 *   • Zero retries (fail-fast as requested)
 *   • Output sanitation + tolerant JSON-ish parsing for Nano
 *   • Persistent metrics/errors/disabledProviders
 *   • getProviderAnalytics() exported (for diagnostics/health endpoint)
 */

const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');
const config = require('./config');

/* ---------- Sanitize helper ---------- */
function sanitizeModelOutput(text) {
  if (!text || typeof text !== 'string') return text;
  let out = text.replace(/\r\n?/g, '\n');
  out = out.replace(/<\/message>\s*<\/start>\s*assistant\s*<\/channel>\s*final\s*<\/message>/gi, ' ');
  out = out.replace(/<\/channel>\s*final\s*<\/message>/gi, ' ');
  out = out.replace(/<start>\s*assistant\b[^>]*>/gi, ' ');
  out = out.replace(/<\/start>\s*assistant\b[^>]*>/gi, ' ');
  out = out.replace(/<\s*\/?channel\b[^>]*>/gi, ' ');
  out = out.replace(/<\s*\/?message\b[^>]*>/gi, ' ');
  out = out.replace(/\b(Certainly|Absolutely|Sure|Affirmative)[\s\p{P}\-]{0,40}(?:(Certainly|Absolutely|Sure|Affirmative)[\s\p{P}\-]*){1,}/giu, '$1');
  out = out.replace(/\s+/g, ' ').trim();
  return out;
}

const fsp = fs.promises;
const PROVIDER_STATE_PATH = path.join(__dirname, 'provider-state.json');
const COST_PRIORITY = { free: 0, freemium: 1, paid: 2 };

function resolveCostPriority(p) {
  const tier = p.costTier || 'paid';
  return Object.prototype.hasOwnProperty.call(COST_PRIORITY, tier)
    ? COST_PRIORITY[tier]
    : COST_PRIORITY.paid;
}

/* ---------- Manager Class ---------- */
class AIProviderManager {
  constructor() {
    this.providers = [];
    this.providerErrors = new Map();
    this.metrics = new Map();
    this.disabledProviders = new Map();
    this.useRandomSelection = true;
    this.selectedProviderType = (config.ai?.provider || 'auto');
    this.stateSaveDebounceMs = 1500;
    this.stateSaveTimer = null;
    this.stateDirty = false;

    this.setupProviders();
    this.loadState();
  }

  setupProviders() {
    // --- DeepSeek via Vercel AI Gateway (OpenAI-compatible) ---
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
        type: 'deepseek',
        family: 'deepseek',
        costTier: 'paid',
      });
    });

    // --- GPT-5 Nano (OpenAI official) ---
    if (process.env.OPENAI) {
      const key = process.env.OPENAI;
      this.providers.push({
        name: 'GPT5Nano',
        client: new OpenAI({ apiKey: key }), // https://api.openai.com/v1
        model: 'gpt-5-nano',
        type: 'gpt5-nano',
        family: 'openai',
        costTier: 'paid',
      });
    }

    this.providers.sort((a, b) => resolveCostPriority(a) - resolveCostPriority(b));
    console.log(`Initialized ${this.providers.length} providers (DeepSeek + GPT-5 Nano).`);
  }

  /* ---------- Persistence ---------- */
  loadState() {
    try {
      if (!fs.existsSync(PROVIDER_STATE_PATH)) return;
      const raw = fs.readFileSync(PROVIDER_STATE_PATH, 'utf8');
      if (!raw.trim()) return;
      const data = JSON.parse(raw);

      for (const [name, m] of Object.entries(data.metrics || {})) {
        if (this.providers.find(p => p.name === name)) {
          this.metrics.set(name, {
            successes: Number(m.successes) || 0,
            failures: Number(m.failures) || 0,
            avgLatencyMs: Number(m.avgLatencyMs) || 0,
          });
        }
      }
      const now = Date.now();
      for (const [name, until] of Object.entries(data.disabledProviders || {})) {
        const parsed = Number(until);
        if (Number.isFinite(parsed) && parsed > now && this.providers.find(p => p.name === name)) {
          this.disabledProviders.set(name, parsed);
        }
      }
      for (const [name, err] of Object.entries(data.providerErrors || {})) {
        if (this.providers.find(p => p.name === name) && err && typeof err === 'object') {
          this.providerErrors.set(name, err);
        }
      }
      console.log('Restored provider cache.');
    } catch (e) { console.warn('Failed to restore cache:', e); }
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
    } catch (e) { console.warn('Failed to save cache:', e); }
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

  /* ---------- Selection ---------- */
  _filterProvidersByType(providers) {
    const t = String(this.selectedProviderType || 'auto').toLowerCase();
    if (t === 'auto') return providers;
    return providers.filter(p =>
      (t === 'openai' && p.name === 'GPT5Nano') ||
      (t === 'deepseek' && p.name.startsWith('deepseek'))
    );
  }

  _rankedProviders() {
    const now = Date.now();
    const f = this._filterProvidersByType(this.providers);
    return f.filter(p => !(this.disabledProviders.get(p.name) > now))
      .sort((a, b) => {
        const ma = this.metrics.get(a.name) || { successes: 0, failures: 0, avgLatencyMs: 1500 };
        const mb = this.metrics.get(b.name) || { successes: 0, failures: 0, avgLatencyMs: 1500 };
        const score = m => {
          const t = m.successes + m.failures || 1;
          const s = m.successes / t;
          const l = 1 / Math.max(m.avgLatencyMs, 1);
          return s * 0.7 + l * 0.3;
        };
        const pri = resolveCostPriority(a) - resolveCostPriority(b);
        if (pri) return pri;
        return score(mb) - score(ma);
      });
  }

  _getRandomProvider() {
    const now = Date.now();
    const f = this._filterProvidersByType(this.providers);
    const avail = f.filter(p => !(this.disabledProviders.get(p.name) > now));
    if (!avail.length) return null;
    const minPri = Math.min(...avail.map(resolveCostPriority));
    const pool = avail.filter(p => resolveCostPriority(p) === minPri);
    return pool[Math.floor(Math.random() * pool.length)];
  }

  _recordMetric(name, ok, latency) {
    const m = this.metrics.get(name) || { successes: 0, failures: 0, avgLatencyMs: 1500 };
    if (ok) m.successes++; else m.failures++;
    if (!Number.isFinite(m.avgLatencyMs) || m.avgLatencyMs <= 0) m.avgLatencyMs = latency;
    else m.avgLatencyMs = m.avgLatencyMs * 0.7 + latency * 0.3;
    this.metrics.set(name, m);
    this.scheduleStateSave();
  }

  /* ---------- Core Call ---------- */
  async generateResponse(systemPrompt, userPrompt, maxTokens = (config.ai?.maxTokens || 1024)) {
    if (!this.providers.length) throw new Error('No AI providers available.');
    const random = this._getRandomProvider();
    const ranked = this._rankedProviders();
    const candidates = random ? [random, ...ranked.filter(p => p.name !== random.name)] : ranked;
    let lastErr = null;

    for (const provider of candidates) {
      const started = Date.now();
      console.log(`→ Using ${provider.name} (${provider.model})`);

      const callOnce = async () => {
        if (provider.type === 'gpt5-nano') {
          const resp = await provider.client.chat.completions.create({
            model: provider.model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            max_completion_tokens: maxTokens,  // <-- required by GPT-5 Nano
            temperature: config.ai?.temperature ?? 0.7,
          });

          let content = resp?.choices?.[0]?.message?.content;
          if (!content?.trim())
            throw Object.assign(new Error(`Empty response from ${provider.name}`), { status: 502 });

          try {
            const parsed = JSON.parse(content);
            if (typeof parsed === 'object' && parsed !== null) {
              content = parsed.response || parsed.answer || parsed.output || parsed.content || JSON.stringify(parsed);
            }
          } catch {
            const hit = content.match(/"content"\s*:\s*"([^"]+)"/i) ||
                        content.match(/"answer"\s*:\s*"([^"]+)"/i) ||
                        content.match(/"response"\s*:\s*"([^"]+)"/i) ||
                        content.match(/"output"\s*:\s*"([^"]+)"/i);
            if (hit) content = hit[1];
          }

          content = String(content).replace(/^["'{\[\s]+|["'\]\}\s]+$/g, '').trim();
          if (!content)
            throw Object.assign(new Error(`Sanitized empty content from ${provider.name}`), { status: 502 });

          resp.choices[0].message.content = content;
          return resp;
        }

        // DeepSeek (Vercel AI Gateway)
        const resp = await provider.client.chat.completions.create({
          model: provider.model,
          // These fields are ignored if unsupported; when supported, they disable reasoning outputs
          reasoning: { budget_tokens: 0 },
          thinking: false,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          max_tokens: maxTokens,
          temperature: config.ai?.temperature ?? 0.7,
        });
        const txt = resp?.choices?.[0]?.message?.content;
        if (!txt?.trim())
          throw Object.assign(new Error(`Empty response from ${provider.name}`), { status: 502 });
        return resp;
      };

      try {
        const r = await callOnce();
        const latency = Date.now() - started;
        this._recordMetric(provider.name, true, latency);
        console.log(`✓ Success ${provider.name} in ${latency} ms`);
        const raw = String(r?.choices?.[0]?.message?.content || '');
        const cleaned = sanitizeModelOutput(raw);
        return { content: cleaned, provider: provider.name };
      } catch (err) {
        const latency = Date.now() - started;
        this._recordMetric(provider.name, false, latency);
        this.providerErrors.set(provider.name, { error: err.message, timestamp: Date.now(), status: err.status });
        this.scheduleStateSave();
        console.error(`✗ Failed ${provider.name} (${provider.model}) ${err.message}`);
        lastErr = err;
        if (provider.type !== 'gpt5-nano') {
          this.disabledProviders.set(provider.name, Date.now() + 2 * 60 * 60 * 1000);
          this.scheduleStateSave();
        }
      }
    }

    throw new Error(`All providers failed: ${lastErr?.message || 'Unknown'}`);
  }

  /* ---------- Admin / Telemetry ---------- */
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
    return this.getProviderStatus().map((p) => {
      const uptimePercentage = p.metrics.successRate != null ? (p.metrics.successRate * 100) : null;
      return {
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
          successRate: uptimePercentage,
          avgLatencyMs: p.metrics.avgLatencyMs,
        },
        disabledUntil: p.disabledUntil,
        isDisabled: p.isDisabled,
        hasError: p.hasError,
        lastError: p.lastError,
      };
    });
  }

  _redactProviderName(name) {
    const map = {
      'GPT5Nano': '[REDACTED]',
      'deepseek-gateway-1': '[REDACTED]',
      'deepseek-gateway-2': '[REDACTED]',
    };
    return map[name] || '[REDACTED]';
  }

  _redactModelName(_m) { return '[REDACTED]'; }

  setRandomSelection(enabled) {
    this.useRandomSelection = !!enabled;
    console.log(`Selection mode: ${enabled ? 'Random-first' : 'Ranked'}`);
  }
  getSelectionMode() { return this.useRandomSelection ? 'random' : 'ranked'; }

  setProviderType(providerType) {
    const valid = ['auto', 'openai', 'deepseek'];
    const t = String(providerType || '').toLowerCase();
    if (!valid.includes(t)) {
      throw new Error(`Invalid provider type. Valid options: ${valid.join(', ')}`);
    }
    this.selectedProviderType = t;
    console.log(`Provider type changed to: ${this.selectedProviderType}`);
  }
  getProviderType() { return this.selectedProviderType; }

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

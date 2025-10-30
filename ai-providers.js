'use strict';
/**
 * AI Provider Manager (DeepSeek + GPT-5 Nano)
 * --------------------------------------------
 * Providers:
 *   - OpenAI GPT-5 Nano (official)
 *   - Vercel AI Gateway DeepSeek (OpenAI-compatible)
 *
 * Key features:
 *   • Random-first fallback
 *   • Circuit-breaker on DeepSeek (Nano always available)
 *   • Zero retries (fail-fast)
 *   • Output sanitation + tolerant JSON parsing
 *   • Persistent metrics/errors/disable states
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
    // --- DeepSeek via Vercel AI Gateway ---
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
        client: new OpenAI({ apiKey: key }),
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
        if (this.providers.find(p => p.name === name))
          this.metrics.set(name, m);
      }
      const now = Date.now();
      for (const [name, until] of Object.entries(data.disabledProviders || {})) {
        if (until > now && this.providers.find(p => p.name === name))
          this.disabledProviders.set(name, until);
      }
      for (const [name, err] of Object.entries(data.providerErrors || {})) {
        if (this.providers.find(p => p.name === name))
          this.providerErrors.set(name, err);
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
    m.avgLatencyMs = !m.avgLatencyMs ? latency : m.avgLatencyMs * 0.7 + latency * 0.3;
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
            max_completion_tokens: maxTokens,
            temperature: config.ai?.temperature ?? 0.7,
          });

          let content = resp?.choices?.[0]?.message?.content;
          if (!content?.trim())
            throw Object.assign(new Error(`Empty response from ${provider.name}`), { status: 502 });

          try {
            const parsed = JSON.parse(content);
            if (typeof parsed === 'object') {
              content = parsed.response || parsed.answer || parsed.output || parsed.content || JSON.stringify(parsed);
            }
          } catch {
            const hit = content.match(/"content"\s*:\s*"([^"]+)"/i) ||
                        content.match(/"answer"\s*:\s*"([^"]+)"/i) ||
                        content.match(/"response"\s*:\s*"([^"]+)"/i);
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
          reasoning: { budget_tokens: 0 }, // disable reasoning
          thinking: false,                 // disable “thinking” outputs if supported
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
}

module.exports = new AIProviderManager();

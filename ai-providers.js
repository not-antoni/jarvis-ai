'use strict';
/**
 * AI Provider Manager (DeepSeek + GPT-5 Nano) — v5
 * ------------------------------------------------
 * Fixes:
 *  - Permanently disables reasoning for GPT-5 Nano (effort:none)
 *  - Keeps DeepSeek reasoning disabled via budget_tokens:0
 *  - Maintains full debug logging, thinking-stripping, and diagnostics support
 */

const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');
const config = require('./config');

/* ---------- Helpers ---------- */
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

function cleanThinkingOutput(text) {
  if (!text || typeof text !== 'string') return text;
  return text
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/\bfinal\b[:\-]?\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractFinalPayload(text) {
  if (!text || typeof text !== 'string') return text;
  const m = text.match(/\bfinal\b[:\-]?\s*(.*)$/is);
  if (m && m[1]) return m[1].trim();
  return text.trim();
}

function dbgDump(label, obj, max = 8000) {
  try {
    const json = JSON.stringify(obj, null, 2);
    const out = json.length > max ? json.slice(0, max) + '...<truncated>' : json;
    console.error(`\n===== DEBUG ${label} =====\n${out}\n===== END DEBUG =====\n`);
  } catch (e) {
    console.error(`\n===== DEBUG ${label} (stringify failed) =====\n${String(obj)}\n===== END DEBUG =====\n`);
  }
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
    // --- DeepSeek via Vercel Gateway ---
    const deepseekKeys = [process.env.AI_GATEWAY_API_KEY, process.env.AI_GATEWAY_API_KEY2].filter(Boolean);
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

  loadState() {
    try {
      if (!fs.existsSync(PROVIDER_STATE_PATH)) return;
      const data = JSON.parse(fs.readFileSync(PROVIDER_STATE_PATH, 'utf8') || '{}');
      Object.entries(data.metrics || {}).forEach(([name, m]) => this.metrics.set(name, m));
      Object.entries(data.disabledProviders || {}).forEach(([name, until]) => {
        if (until > Date.now()) this.disabledProviders.set(name, until);
      });
      Object.entries(data.providerErrors || {}).forEach(([name, err]) => this.providerErrors.set(name, err));
    } catch (e) {
      console.warn('Failed to restore provider state:', e);
    }
  }

  async saveState() {
    try {
      const payload = {
        metrics: Object.fromEntries(this.metrics),
        disabledProviders: Object.fromEntries(this.disabledProviders),
        providerErrors: Object.fromEntries(this.providerErrors),
      };
      await fsp.writeFile(PROVIDER_STATE_PATH, JSON.stringify(payload, null, 2), 'utf8');
    } catch (e) {
      console.warn('Failed to save provider state:', e);
    }
  }

  scheduleStateSave() {
    this.stateDirty = true;
    if (this.stateSaveTimer) return;
    this.stateSaveTimer = setTimeout(() => {
      this.stateSaveTimer = null;
      if (!this.stateDirty) return;
      this.stateDirty = false;
      this.saveState();
    }, this.stateSaveDebounceMs);
  }

  _getRandomProvider() {
    const now = Date.now();
    const avail = this.providers.filter(p => !(this.disabledProviders.get(p.name) > now));
    if (!avail.length) return null;
    return avail[Math.floor(Math.random() * avail.length)];
  }

  _recordMetric(name, ok, latency) {
    const m = this.metrics.get(name) || { successes: 0, failures: 0, avgLatencyMs: 1500 };
    if (ok) m.successes++; else m.failures++;
    m.avgLatencyMs = !m.avgLatencyMs ? latency : m.avgLatencyMs * 0.7 + latency * 0.3;
    this.metrics.set(name, m);
    this.scheduleStateSave();
  }

  async generateResponse(systemPrompt, userPrompt, maxTokens = (config.ai?.maxTokens || 1024)) {
    if (!this.providers.length) throw new Error('No AI providers available.');
    const random = this._getRandomProvider();
    const candidates = random ? [random, ...this.providers.filter(p => p.name !== random.name)] : this.providers;
    let lastErr = null;

    for (const provider of candidates) {
      const started = Date.now();
      console.log(`→ Using ${provider.name} (${provider.model})`);

      const callOnce = async (attempt = 0) => {
        if (provider.type === 'gpt5-nano') {
          const resp = await provider.client.chat.completions.create({
            model: provider.model,
            reasoning: { effort: 'none' }, // disable reasoning entirely
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            max_completion_tokens: maxTokens,
            temperature: config.ai?.temperature ?? 0.7,
          });

          let content = resp?.choices?.[0]?.message?.content;
          if (!content?.trim()) {
            dbgDump('GPT-5 Nano Raw Response (empty content)', resp);
            if (attempt === 0) {
              console.warn(`⚠️ Empty GPT-5 Nano response — retrying once...`);
              return await callOnce(1);
            }
            throw Object.assign(new Error(`Empty response from ${provider.name}`), { status: 502 });
          }

          content = extractFinalPayload(cleanThinkingOutput(sanitizeModelOutput(String(content))));
          if (!content) {
            dbgDump('GPT-5 Nano Sanitized Empty', { original: resp?.choices?.[0]?.message?.content });
            throw Object.assign(new Error(`Sanitized empty content from ${provider.name}`), { status: 502 });
          }

          resp.choices[0].message.content = content;
          return resp;
        }

        const resp = await provider.client.chat.completions.create({
          model: provider.model,
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
        if (!txt?.trim()) {
          dbgDump('DeepSeek Raw Response (empty content)', resp);
          throw Object.assign(new Error(`Empty response from ${provider.name}`), { status: 502 });
        }
        return resp;
      };

      try {
        const r = await callOnce();
        const latency = Date.now() - started;
        this._recordMetric(provider.name, true, latency);
        console.log(`✓ Success ${provider.name} in ${latency} ms`);
        const raw = String(r?.choices?.[0]?.message?.content || '');
        const cleaned = extractFinalPayload(cleanThinkingOutput(sanitizeModelOutput(raw)));
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
    throw new Error(`All providers failed: ${lastErr?.message || 'Unknown error'}`);
  }

  getProviderAnalytics() {
    const now = Date.now();
    return this.providers.map(p => {
      const m = this.metrics.get(p.name) || { successes: 0, failures: 0, avgLatencyMs: 0 };
      const total = m.successes + m.failures;
      return {
        name: p.name,
        model: p.model,
        type: p.type,
        successRate: total ? (m.successes / total) * 100 : null,
        avgLatencyMs: m.avgLatencyMs,
        isDisabled: this.disabledProviders.get(p.name) > now,
        lastError: this.providerErrors.get(p.name) || null
      };
    });
  }

  getRedactedProviderStatus() {
    return this.getProviderAnalytics().map(p => ({
      ...p,
      name: '[REDACTED]',
      model: '[REDACTED]',
      lastError: p.lastError ? '[REDACTED]' : null
    }));
  }
}

module.exports = new AIProviderManager();

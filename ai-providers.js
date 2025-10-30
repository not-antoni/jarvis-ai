'use strict';
/**
 * AI Provider Manager (DeepSeek + GPT-4o-mini)
 * --------------------------------------------
 * - OpenAI: gpt-4o-mini (no reasoning/thinking params)
 * - DeepSeek (Vercel): reasoning budget set to 0 (hint, ignored if unsupported)
 * - Robust diagnostics: getProviderStatus(), getProviderAnalytics(), getRedactedProviderStatus()
 * - Safe successRate computation (never undefined)
 */

const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');
const config = require('./config');

/* ---------- Helpers ---------- */
function sanitizeModelOutput(text) {
  if (!text || typeof text !== 'string') return text;
  let out = text.replace(/\r\n?/g, '\n');
  // scrub stray protocol tags
  out = out.replace(/<\/message>\s*<\/start>\s*assistant\s*<\/channel>\s*final\s*<\/message>/gi, ' ');
  out = out.replace(/<\/channel>\s*final\s*<\/message>/gi, ' ');
  out = out.replace(/<start>\s*assistant\b[^>]*>/gi, ' ');
  out = out.replace(/<\/start>\s*assistant\b[^>]*>/gi, ' ');
  out = out.replace(/<\s*\/?channel\b[^>]*>/gi, ' ');
  out = out.replace(/<\s*\/?message\b[^>]*>/gi, ' ');
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
    this.metrics = new Map(); // name -> { successes, failures, avgLatencyMs }
    this.disabledProviders = new Map(); // name -> timestamp
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

    // --- OpenAI: GPT-4o-mini ---
    if (process.env.OPENAI) {
      const key = process.env.OPENAI; // per your env naming
      this.providers.push({
        name: 'GPT4oMini',
        client: new OpenAI({ apiKey: key }), // https://api.openai.com/v1
        model: 'gpt-4o-mini',
        type: 'gpt4o-mini',
        family: 'openai',
        costTier: 'paid',
      });
    }

    // Sort by cost tier (cheapest first)
    this.providers.sort((a, b) => resolveCostPriority(a) - resolveCostPriority(b));
    console.log(`Initialized ${this.providers.length} providers (DeepSeek + GPT-4o-mini).`);
  }

  /* ---------- Persistence ---------- */
  loadState() {
    try {
      if (!fs.existsSync(PROVIDER_STATE_PATH)) return;
      const data = JSON.parse(fs.readFileSync(PROVIDER_STATE_PATH, 'utf8') || '{}');

      const mIn = data.metrics || {};
      for (const [name, m] of Object.entries(mIn)) {
        this.metrics.set(name, {
          successes: Number(m.successes) || 0,
          failures: Number(m.failures) || 0,
          avgLatencyMs: Number(m.avgLatencyMs) || 0,
        });
      }
      const dIn = data.disabledProviders || {};
      const now = Date.now();
      for (const [name, until] of Object.entries(dIn)) {
        const ts = Number(until);
        if (Number.isFinite(ts) && ts > now) this.disabledProviders.set(name, ts);
      }
      const eIn = data.providerErrors || {};
      for (const [name, err] of Object.entries(eIn)) {
        if (err && typeof err === 'object') this.providerErrors.set(name, err);
      }
      console.log('Restored provider cache.');
    } catch (e) {
      console.warn('Failed to restore provider cache:', e);
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
    } catch (e) {
      console.warn('Failed to save cache:', e);
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

  /* ---------- Selection & Metrics ---------- */
  _availableProviders() {
    const now = Date.now();
    return this.providers.filter(p => !(this.disabledProviders.get(p.name) > now));
  }

  _recordMetric(name, ok, latency) {
    const m = this.metrics.get(name) || { successes: 0, failures: 0, avgLatencyMs: 0 };
    if (ok) m.successes++; else m.failures++;
    if (!Number.isFinite(m.avgLatencyMs) || m.avgLatencyMs <= 0) m.avgLatencyMs = latency;
    else m.avgLatencyMs = m.avgLatencyMs * 0.7 + latency * 0.3;
    this.metrics.set(name, m);
    this.scheduleStateSave();
  }

  /* ---------- Core Call ---------- */
  async generateResponse(systemPrompt, userPrompt, maxTokens = (config.ai?.maxTokens || 1024)) {
    const candidates = this._availableProviders();
    if (!candidates.length) throw new Error('No AI providers available.');

    let lastErr = null;

    for (const provider of candidates) {
      const started = Date.now();
      console.log(`→ Using ${provider.name} (${provider.model})`);

      const callOnce = async (attempt = 0) => {
        if (provider.type === 'gpt4o-mini') {
          const resp = await provider.client.chat.completions.create({
            model: provider.model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            max_completion_tokens: maxTokens,
            temperature: config.ai?.temperature ?? 0.7,
          });

          let content = resp?.choices?.[0]?.message?.content || '';
          if (!content.trim()) {
            dbgDump('GPT-4o-mini Raw Response (empty)', resp);
            if (attempt === 0) {
              console.warn(`⚠️ Empty GPT-4o-mini response — retrying once...`);
              return await callOnce(1);
            }
            throw new Error(`Empty GPT-4o-mini output`);
          }

          content = extractFinalPayload(cleanThinkingOutput(sanitizeModelOutput(content)));
          if (!content.trim()) {
            dbgDump('GPT-4o-mini Sanitized Empty', { original: resp?.choices?.[0]?.message?.content });
            throw new Error('Sanitized empty GPT-4o-mini content');
          }
          resp.choices[0].message.content = content;
          return resp;
        }

        // DeepSeek via Vercel Gateway
        const resp = await provider.client.chat.completions.create({
          model: provider.model,
          reasoning: { budget_tokens: 0 }, // hint; ignored if unsupported
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          max_tokens: maxTokens,
          temperature: config.ai?.temperature ?? 0.7,
        });

        const txt = resp?.choices?.[0]?.message?.content;
        if (!txt?.trim()) {
          dbgDump('DeepSeek Raw Response (empty)', resp);
          throw new Error(`Empty response from ${provider.name}`);
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
        this.providerErrors.set(provider.name, { error: err.message, timestamp: Date.now() });
        console.error(`✗ Failed ${provider.name} (${provider.model}) ${err.message}`);

        // Circuit-breaker for non-OpenAI to avoid flapping
        if (provider.family !== 'openai') {
          this.disabledProviders.set(provider.name, Date.now() + 2 * 60 * 60 * 1000);
        }
        this.scheduleStateSave();
        lastErr = err;
      }
    }

    throw new Error(`All providers failed: ${lastErr?.message || 'Unknown error'}`);
  }

  /* ---------- Diagnostics ---------- */
  _statusRow(p) {
    const m = this.metrics.get(p.name) || { successes: 0, failures: 0, avgLatencyMs: 0 };
    const total = (m.successes ?? 0) + (m.failures ?? 0);
    const successRate = total > 0 ? (m.successes / total) * 100 : 0;
    const disabledUntil = this.disabledProviders.get(p.name) || null;
    const isDisabled = disabledUntil ? disabledUntil > Date.now() : false;

    return {
      name: p.name,
      model: p.model,
      type: p.type,
      family: p.family || null,
      costTier: p.costTier || 'paid',
      metrics: {
        successes: m.successes,
        failures: m.failures,
        totalRequests: total,
        successRate,                 // <-- always defined number
        avgLatencyMs: m.avgLatencyMs,
      },
      disabledUntil,
      isDisabled,
      lastError: this.providerErrors.get(p.name) || null,
    };
  }

  getProviderStatus() {
    // Full, non-redacted status used by internal dashboards
    return this.providers.map(p => this._statusRow(p));
  }

  getProviderAnalytics() {
    // Lightweight analytics summary (older callers may use this)
    return this.providers.map(p => {
      const row = this._statusRow(p);
      return {
        name: row.name,
        model: row.model,
        type: row.type,
        successRate: row.metrics.successRate,
        avgLatencyMs: row.metrics.avgLatencyMs,
        isDisabled: row.isDisabled,
        lastError: row.lastError,
      };
    });
  }

  getRedactedProviderStatus() {
    // Safe for public status pages
    return this.providers.map(p => {
      const row = this._statusRow(p);
      return {
        ...row,
        name: '[REDACTED]',
        model: '[REDACTED]',
        lastError: row.lastError ? '[REDACTED]' : null,
      };
    });
  }
}

module.exports = new AIProviderManager();

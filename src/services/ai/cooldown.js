'use strict';

const config = require('../../../config');

/**
 * How long to bench a credential group after a daily-quota exhaustion
 * (Google 429 with "Limit: 0" / "billing details"). The old value of 30m
 * caused ~48 probe/day once a key ran out — each probe is itself a 429 and
 * can keep pushing the exhaustion forward. Two hours strikes a balance
 * between "give up for the day" and "retry occasionally in case the user
 * upgraded their plan". Override with PERMANENT_QUOTA_BENCH_MS.
 */
const PERMANENT_QUOTA_BENCH_MS = Math.max(
    5 * 60 * 1000,
    Number(process.env.PERMANENT_QUOTA_BENCH_MS) || 2 * 60 * 60 * 1000
);

function getProviderAttemptTimeoutMs(provider) {
    if (provider?.attemptTimeoutMs && Number.isFinite(provider.attemptTimeoutMs)) {
        return Math.max(250, provider.attemptTimeoutMs);
    }
    // Aggressive per-provider caps so one laggy provider can't burn the whole
    // failover budget. With a 60s budget this guarantees at least 6 attempts
    // even when Google goes silent.
    if (provider?.type === 'google') {
        const model = String(provider.model || '').toLowerCase();
        if (/gemma-4|gemini-(?:2\.5|3(?:\.|-)pro)/i.test(model)) {return 9_000;}
        if (/gemini-(?:3\.1-flash-lite-preview|2\.0-flash)/i.test(model)) {return 7_000;}
        return 8_000;
    }
    const family = String(provider?.family || '').toLowerCase();
    if (family === 'cerebras' || family === 'sambanova') {return 9_000;}
    return 7_000;
}

function getRequestBudgetMs(manager) {
    if (Number.isFinite(Number(manager?.requestBudgetMs)) && Number(manager.requestBudgetMs) > 0) {
        return Math.max(250, Number(manager.requestBudgetMs));
    }
    if (Number.isFinite(Number(config.ai?.requestBudgetMs)) && Number(config.ai.requestBudgetMs) > 0) {
        return Math.max(250, Number(config.ai.requestBudgetMs));
    }
    return 60_000;
}

// Minimum number of distinct providers that must be attempted before the
// failover loop allows a budget-exhaustion exit. Prevents a single slow
// provider (typically Google when its keys are throttled) from killing the
// whole failover rotation. Override with AI_MIN_FAILOVER_ATTEMPTS.
function getMinFailoverAttempts() {
    const raw = Number(process.env.AI_MIN_FAILOVER_ATTEMPTS);
    if (Number.isFinite(raw) && raw > 0) {return Math.min(20, Math.max(1, Math.floor(raw)));}
    return 3;
}

function formatDurationLabel(durationMs) {
    if (!Number.isFinite(durationMs) || durationMs <= 0) {return '0ms';}
    if (durationMs % (60 * 60 * 1000) === 0) {return `${durationMs / (60 * 60 * 1000)}h`;}
    if (durationMs % (60 * 1000) === 0) {return `${durationMs / (60 * 1000)}m`;}
    if (durationMs >= 1000) {return `${Math.round(durationMs / 1000)}s`;}
    return `${durationMs}ms`;
}

function benchProvider(manager, provider, durationMs, reason, options = {}) {
    const cooldownMs = Math.max(0, Number(durationMs) || 0);
    if (cooldownMs <= 0) {return;}
    const includeCredentialGroup = options.includeCredentialGroup === true;
    const source = options.source || 'provider-execution';
    const targets = includeCredentialGroup && provider?.credentialGroup
        ? manager.providers.filter(candidate => candidate.credentialGroup === provider.credentialGroup)
        : [provider];
    const until = Date.now() + cooldownMs;
    for (const target of targets) {
        if (typeof manager.setProviderCooldown === 'function') {
            manager.setProviderCooldown(target.name, until, {
                reason,
                source,
                credentialGroup: target.credentialGroup || null,
                details: options.details || null
            });
        } else {
            manager.disabledProviders.set(target.name, until);
        }
    }
    manager.scheduleStateSave();
    const scope = includeCredentialGroup && provider?.credentialGroup
        ? `${provider.name} (${provider.credentialGroup})`
        : provider.name;
    // ISO time (UTC, seconds precision) keeps logs grep-friendly and makes the
    // unbench moment obvious without dragging in timezone helpers.
    const etaIso = new Date(until).toISOString().replace(/\.\d{3}Z$/, 'Z');
    console.log(`${scope} benched ${formatDurationLabel(cooldownMs)} (${reason}, until ${etaIso})`);
}

function resolveCooldownPolicy(provider, error) {
    const status = error?.status || error?.response?.status;
    if (error?.providerFault === false) {return null;}
    if (error?.thinkingRequired) {
        return {
            durationMs: 60 * 60 * 1000,
            reason: 'thinking mode requirement mismatch'
        };
    }
    if (status === 429) {
        if (error?.permanentQuota) {
            return {
                durationMs: PERMANENT_QUOTA_BENCH_MS,
                includeCredentialGroup: true,
                reason: 'quota unavailable for credential (daily limit reached)'
            };
        }
        const retryDelayMs = Number(error?.retryDelayMs);
        return {
            durationMs:
                Number.isFinite(retryDelayMs) && retryDelayMs > 0
                    ? Math.min(Math.max(retryDelayMs + 5000, 30 * 1000), 5 * 60 * 1000)
                    : 45 * 1000,
            reason: 'rate limit'
        };
    }
    if (status === 503) {
        return { durationMs: 2 * 60 * 1000, reason: 'over capacity' };
    }
    if (status === 408) {
        return {
            durationMs: provider?.type === 'google' ? 2 * 60 * 1000 : 60 * 1000,
            reason: 'timeout'
        };
    }
    return null;
}

module.exports = {
    getProviderAttemptTimeoutMs,
    getRequestBudgetMs,
    getMinFailoverAttempts,
    formatDurationLabel,
    benchProvider,
    resolveCooldownPolicy
};

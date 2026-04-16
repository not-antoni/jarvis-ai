'use strict';

const config = require('../../../config');

function getProviderAttemptTimeoutMs(provider) {
    if (provider?.attemptTimeoutMs && Number.isFinite(provider.attemptTimeoutMs)) {
        return Math.max(250, provider.attemptTimeoutMs);
    }
    if (provider?.type === 'google') {
        const model = String(provider.model || '').toLowerCase();
        if (/gemma-4|gemini-(?:2\.5|3(?:\.|-)pro)/i.test(model)) {return 14_000;}
        if (/gemini-(?:3\.1-flash-lite-preview|2\.0-flash)/i.test(model)) {return 10_000;}
        return 12_000;
    }
    const family = String(provider?.family || '').toLowerCase();
    if (family === 'cerebras' || family === 'sambanova') {return 12_000;}
    return 8_000;
}

function getRequestBudgetMs(manager) {
    if (Number.isFinite(Number(manager?.requestBudgetMs)) && Number(manager.requestBudgetMs) > 0) {
        return Math.max(250, Number(manager.requestBudgetMs));
    }
    if (Number.isFinite(Number(config.ai?.requestBudgetMs)) && Number(config.ai.requestBudgetMs) > 0) {
        return Math.max(250, Number(config.ai.requestBudgetMs));
    }
    return 18_000;
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
    console.log(`${scope} benched ${formatDurationLabel(cooldownMs)} (${reason})`);
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
                durationMs: 30 * 60 * 1000,
                includeCredentialGroup: true,
                reason: 'quota unavailable for credential'
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
    formatDurationLabel,
    benchProvider,
    resolveCooldownPolicy
};

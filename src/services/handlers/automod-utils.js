'use strict';

const {
    AutoModerationActionType,
    AutoModerationRuleEventType,
    AutoModerationRuleTriggerType,
    DiscordAPIError
} = require('discord.js');

function normalizeKeyword(keyword) {
    if (typeof keyword !== 'string') {
        return null;
    }

    let normalized = keyword.trim();
    if (!normalized) {
        return null;
    }

    if (normalized.length > 60) {
        normalized = normalized.slice(0, 60);
    }

    return normalized.toLowerCase();
}

function parseKeywordInput(input) {
    if (!input || typeof input !== 'string') {
        return [];
    }

    return input
        .split(/[\n,]+/)
        .map(segment => normalizeKeyword(segment))
        .filter(Boolean);
}

function mergeKeywords(current = [], additions = []) {
    const unique = new Set();

    const register = keyword => {
        const normalized = normalizeKeyword(keyword);
        if (normalized) {
            unique.add(normalized);
        }
    };

    current.forEach(register);
    additions.forEach(register);

    return Array.from(unique);
}

function createDefaultAutoModRecord(handler, guildId = null) {
    return {
        guildId: guildId || null,
        keywords: [],
        enabled: false,
        customMessage: handler.defaultAutoModMessage,
        ruleId: null,
        ruleIds: [],
        extraFilters: []
    };
}

function extractAutoModKeywordIssues(error) {
    const issues = new Set();

    const addIssue = value => {
        if (!value) {
            return;
        }

        if (typeof value === 'string') {
            issues.add(value);
            return;
        }

        if (typeof value === 'object') {
            if (typeof value.message === 'string') {
                issues.add(value.message);
            } else if (typeof value.keyword === 'string') {
                issues.add(value.keyword);
            }
        }
    };

    const traverse = node => {
        if (!node) {
            return;
        }

        if (Array.isArray(node)) {
            node.forEach(item => traverse(item));
            return;
        }

        if (typeof node === 'object') {
            if (Array.isArray(node._errors)) {
                node._errors.forEach(addIssue);
            }

            for (const key of Object.keys(node)) {
                if (key === '_errors') {
                    continue;
                }

                traverse(node[key]);
            }
            return;
        }

        addIssue(node);
    };

    if (error?.rawError) {
        const direct = error.rawError.trigger_metadata?.keyword_filter;
        if (Array.isArray(direct)) {
            direct.forEach(addIssue);
        }

        traverse(error.rawError.errors?.trigger_metadata?.keyword_filter);
    }

    return Array.from(issues).filter(Boolean);
}

function getAutoModErrorMessage(handler, error, fallback = 'I could not update the auto moderation rule, sir.') {
    if (!error) {
        return fallback;
    }

    if (error.isFriendly && typeof error.message === 'string') {
        return error.message;
    }

    if (error instanceof DiscordAPIError) {
        if (error.code === 50013 || error.status === 403) {
            return 'Discord denied me the permission to adjust auto moderation, sir. Please ensure I have the "Manage Server" permission.';
        }

        if (error.code === 50035) {
            const issues = extractAutoModKeywordIssues(error);
            if (issues.length) {
                const preview = issues.slice(0, 3).join('; ');
                const suffix = issues.length > 3 ? ' …' : '';
                return `Discord rejected the blacklist update: ${preview}${suffix}. Please adjust those entries and try again, sir.`;
            }

            return 'Discord rejected one of the blacklist entries, sir. Please ensure each entry is under 60 characters and avoids restricted symbols.';
        }

        if (error.code === 30037 || error.code === 30035 || error.code === 30013) {
            return 'This server already has the maximum number of auto moderation rules, sir. Please remove another rule or reuse the Jarvis rule.';
        }

        if (error.code === 20022 || error.status === 429) {
            return 'Discord rate limited the auto moderation update, sir. Please wait a few seconds and try again.';
        }
    }

    if (error.code === 50001) {
        return 'Discord denied me access to the auto moderation rule, sir. Please ensure I can manage AutoMod settings.';
    }

    return fallback;
}

function handleAutoModApiError(handler, error, fallback = 'I could not update the auto moderation rule, sir.') {
    if (!error) {
        throw handler.createFriendlyError(fallback);
    }

    if (error.isFriendly) {
        throw error;
    }

    const friendlyError = handler.createFriendlyError(getAutoModErrorMessage(handler, error, fallback));
    friendlyError.cause = error;
    throw friendlyError;
}

async function prepareAutoModState(handler, guild, record) {
    if (!guild) {
        throw handler.createFriendlyError('I could not access that server, sir.');
    }

    const prepared = record ? { ...record } : createDefaultAutoModRecord(handler, guild.id);
    prepared.guildId = guild.id;

    let mutated = false;

    if (!Array.isArray(prepared.keywords)) {
        prepared.keywords = [];
        mutated = true;
    }

    const mergedKeywords = mergeKeywords([], prepared.keywords);
    if (mergedKeywords.length !== prepared.keywords.length) {
        prepared.keywords = mergedKeywords;
        mutated = true;
    }

    const normalizedMessage = typeof prepared.customMessage === 'string' && prepared.customMessage.trim()
        ? prepared.customMessage.trim().slice(0, 150)
        : handler.defaultAutoModMessage;
    if (prepared.customMessage !== normalizedMessage) {
        prepared.customMessage = normalizedMessage;
        mutated = true;
    }

    const normalizedEnabled = Boolean(prepared.enabled);
    if (prepared.enabled !== normalizedEnabled) {
        prepared.enabled = normalizedEnabled;
        mutated = true;
    }

    let ruleIds = Array.isArray(prepared.ruleIds) ? prepared.ruleIds.slice() : [];

    if (!ruleIds.length && prepared.ruleId) {
        ruleIds = [prepared.ruleId];
    }

    const sanitizedRuleIds = [];
    for (const id of ruleIds) {
        if (!id) {
            continue;
        }

        if (typeof id === 'string') {
            if (id.trim()) {
                sanitizedRuleIds.push(id.trim());
            }
        } else {
            sanitizedRuleIds.push(String(id));
            mutated = true;
        }
    }

    if (prepared.ruleId) {
        const legacyId = String(prepared.ruleId);
        if (legacyId && !sanitizedRuleIds.includes(legacyId)) {
            sanitizedRuleIds.push(legacyId);
        }
        prepared.ruleId = null;
        mutated = true;
    }

    if (prepared.ruleIds?.length !== sanitizedRuleIds.length ||
        prepared.ruleIds?.some((value, index) => value !== sanitizedRuleIds[index])) {
        prepared.ruleIds = sanitizedRuleIds;
        mutated = true;
    }

    const rules = [];
    const missingRuleIds = [];

    if (!Array.isArray(prepared.extraFilters)) {
        prepared.extraFilters = [];
        mutated = true;
    }

    const normalizedExtraFilters = [];
    for (const entry of prepared.extraFilters) {
        if (!entry || typeof entry !== 'object') {
            mutated = true;
            continue;
        }

        const keywords = mergeKeywords([], Array.isArray(entry.keywords) ? entry.keywords : []);
        if (!keywords.length) {
            mutated = true;
            continue;
        }

        const customMessage = typeof entry.customMessage === 'string' && entry.customMessage.trim()
            ? entry.customMessage.trim().slice(0, 150)
            : normalizedMessage;
        const name = typeof entry.name === 'string' && entry.name.trim()
            ? entry.name.trim().slice(0, 100)
            : `${handler.autoModRuleName} Filter`;

        let ruleId = typeof entry.ruleId === 'string' && entry.ruleId.trim()
            ? entry.ruleId.trim()
            : null;
        let enabled = Boolean(entry.enabled);

        if (ruleId) {
            const rule = await fetchAutoModRule(guild, ruleId);
            if (rule) {
                enabled = Boolean(rule.enabled);
            } else {
                missingRuleIds.push(ruleId);
                ruleId = null;
                enabled = false;
                mutated = true;
            }
        }

        normalizedExtraFilters.push({
            ruleId,
            keywords,
            customMessage,
            enabled,
            name
        });

        if (!entry.ruleId || entry.ruleId !== ruleId ||
            !Array.isArray(entry.keywords) || entry.keywords.length !== keywords.length ||
            entry.customMessage !== customMessage || entry.enabled !== enabled || entry.name !== name) {
            mutated = true;
        }
    }

    if (normalizedExtraFilters.length !== prepared.extraFilters.length) {
        mutated = true;
    }

    prepared.extraFilters = normalizedExtraFilters;

    for (const ruleId of prepared.ruleIds) {
        const rule = await fetchAutoModRule(guild, ruleId);
        if (rule) {
            rules.push(rule);
        } else {
            missingRuleIds.push(ruleId);
        }
    }

    if (missingRuleIds.length) {
        const missingSet = new Set(missingRuleIds);
        const retained = prepared.ruleIds.filter(id => !missingSet.has(id));
        if (retained.length !== prepared.ruleIds.length) {
            prepared.ruleIds = retained;
            mutated = true;
        }

        if (!retained.length && prepared.enabled) {
            prepared.enabled = false;
            mutated = true;
        }
    }

    if (rules.length) {
        const allEnabled = rules.every(rule => Boolean(rule.enabled));
        if (prepared.enabled !== allEnabled) {
            prepared.enabled = allEnabled;
            mutated = true;
        }
    }

    return { record: prepared, rules, mutated, missingRuleIds };
}

async function fetchAutoModRule(guild, ruleId) {
    if (!guild || !ruleId) {
        return null;
    }

    try {
        return await guild.autoModerationRules.fetch(ruleId);
    } catch (error) {
        if (error.code === 10066 || error.code === 50001) {
            return null;
        }

        console.warn('Failed to fetch auto moderation rule:', error);
        return null;
    }
}

async function upsertAutoModRule(handler, guild, keywords, customMessage = null, ruleId = null, enabled = true, ruleName = null) {
    if (!guild) {
        throw handler.createFriendlyError('I could not access that server, sir.');
    }

    const sanitized = mergeKeywords([], keywords);
    if (sanitized.length === 0) {
        throw handler.createFriendlyError('Please provide at least one valid keyword, sir.');
    }

    if (sanitized.length > handler.maxAutoModKeywordsPerRule) {
        throw handler.createFriendlyError(`Each auto moderation rule can track up to ${handler.maxAutoModKeywordsPerRule} entries, sir.`);
    }

    const payload = {
        name: ruleName || handler.autoModRuleName,
        eventType: AutoModerationRuleEventType.MessageSend,
        triggerType: AutoModerationRuleTriggerType.Keyword,
        triggerMetadata: {
            keywordFilter: sanitized
        },
        actions: [
            {
                type: AutoModerationActionType.BlockMessage,
                metadata: customMessage
                    ? { customMessage: customMessage.slice(0, 150) }
                    : {}
            }
        ],
        enabled,
        exemptRoles: [],
        exemptChannels: []
    };

    let rule = null;

    if (ruleId) {
        const existingRule = await fetchAutoModRule(guild, ruleId);

        if (existingRule) {
            try {
                rule = await existingRule.edit(payload);
            } catch (error) {
                if (error?.code === 10066 || error?.code === 50001) {
                    console.warn(`Stored auto moderation rule ${ruleId} no longer exists. Recreating.`);
                } else {
                    handleAutoModApiError(handler, error, 'I could not update the auto moderation rule, sir.');
                }
            }
        }
    }

    if (!rule) {
        try {
            rule = await guild.autoModerationRules.create(payload);
        } catch (error) {
            handleAutoModApiError(handler, error, 'I could not create the auto moderation rule, sir.');
        }
    }

    if (!rule) {
        throw handler.createFriendlyError('Discord did not return an auto moderation rule, sir.');
    }

    return { rule, keywords: sanitized };
}

async function syncAutoModRules(handler, guild, keywords, customMessage = null, existingRuleIds = [], enabled = true) {
    if (!guild) {
        throw handler.createFriendlyError('I could not access that server, sir.');
    }

    const sanitized = mergeKeywords([], keywords);
    if (!sanitized.length) {
        throw handler.createFriendlyError('Please provide at least one valid keyword, sir.');
    }

    const chunks = [];
    for (let index = 0; index < sanitized.length; index += handler.maxAutoModKeywordsPerRule) {
        chunks.push(sanitized.slice(index, index + handler.maxAutoModKeywordsPerRule));
    }

    const resolvedRules = [];
    const resolvedRuleIds = [];
    const normalizedExisting = Array.isArray(existingRuleIds)
        ? existingRuleIds.filter(id => typeof id === 'string' && id.trim()).map(id => id.trim())
        : [];

    for (let index = 0; index < chunks.length; index += 1) {
        const chunkKeywords = chunks[index];
        const ruleName = chunks.length > 1
            ? `${handler.autoModRuleName} #${index + 1}`
            : handler.autoModRuleName;
        const targetRuleId = normalizedExisting[index] || null;

        const { rule } = await upsertAutoModRule(
            handler,
            guild,
            chunkKeywords,
            customMessage,
            targetRuleId,
            enabled,
            ruleName
        );

        resolvedRules.push(rule);
        resolvedRuleIds.push(rule.id);
    }

    if (normalizedExisting.length > chunks.length) {
        const extras = normalizedExisting.slice(chunks.length);
        for (const extraId of extras) {
            await disableAutoModRule(guild, extraId);
        }
    }

    return { rules: resolvedRules, keywords: sanitized, ruleIds: resolvedRuleIds };
}

function generateAutoModFilterName(handler, existingFilters = []) {
    const baseName = `${handler.autoModRuleName} Filter`;
    if (!Array.isArray(existingFilters) || !existingFilters.length) {
        return baseName;
    }

    const usedNumbers = new Set();
    for (const filter of existingFilters) {
        const match = typeof filter?.name === 'string' ? filter.name.match(/#(\d+)$/) : null;
        if (match) {
            usedNumbers.add(Number(match[1]));
        }
    }

    let counter = existingFilters.length + 1;
    for (let candidate = 1; candidate <= existingFilters.length + 5; candidate += 1) {
        if (!usedNumbers.has(candidate)) {
            counter = candidate;
            break;
        }
    }

    return `${baseName} #${counter}`;
}

async function upsertExtraAutoModFilter(handler, guild, filter, defaultMessage, enabled = true) {
    if (!guild || !filter) {
        throw handler.createFriendlyError('I could not adjust that auto moderation filter, sir.');
    }

    const keywords = mergeKeywords([], Array.isArray(filter.keywords) ? filter.keywords : []);
    if (!keywords.length) {
        throw handler.createFriendlyError('Please provide at least one valid keyword, sir.');
    }

    const customMessage = typeof filter.customMessage === 'string' && filter.customMessage.trim()
        ? filter.customMessage.trim().slice(0, 150)
        : (typeof defaultMessage === 'string' && defaultMessage.trim()
            ? defaultMessage.trim().slice(0, 150)
            : handler.defaultAutoModMessage);

    const name = typeof filter.name === 'string' && filter.name.trim()
        ? filter.name.trim().slice(0, 100)
        : `${handler.autoModRuleName} Filter`;

    try {
        const { rule, keywords: sanitized } = await upsertAutoModRule(
            handler,
            guild,
            keywords,
            customMessage,
            filter.ruleId,
            enabled,
            name
        );

        filter.ruleId = rule.id;
        filter.keywords = sanitized;
        filter.customMessage = customMessage;
        filter.enabled = Boolean(rule.enabled);
        filter.name = rule.name || name;
        return filter;
    } catch (error) {
        console.error('Failed to synchronize additional auto moderation filter:', error?.cause || error);
        throw error;
    }
}

async function enableExtraAutoModFilters(handler, guild, record) {
    if (!guild || !record || !Array.isArray(record.extraFilters) || !record.extraFilters.length) {
        return;
    }

    for (const filter of record.extraFilters) {
        try {
            filter.enabled = true;
            await upsertExtraAutoModFilter(
                handler,
                guild,
                filter,
                record.customMessage || handler.defaultAutoModMessage,
                true
            );
        } catch (error) {
            handleAutoModApiError(handler, error, 'I could not enable one of the additional auto moderation filters, sir.');
        }
    }
}

async function disableExtraAutoModFilters(handler, guild, record) {
    if (!guild || !record || !Array.isArray(record.extraFilters) || !record.extraFilters.length) {
        return;
    }

    for (const filter of record.extraFilters) {
        if (!filter.ruleId) {
            filter.enabled = false;
            continue;
        }

        try {
            const disabled = await disableAutoModRule(guild, filter.ruleId);
            filter.enabled = false;
            if (!disabled) {
                filter.ruleId = null;
            }
        } catch (error) {
            handleAutoModApiError(handler, error, 'I could not disable one of the additional auto moderation filters, sir.');
        }
    }
}

async function resyncEnabledExtraAutoModFilters(handler, guild, record) {
    if (!guild || !record || !Array.isArray(record.extraFilters) || !record.extraFilters.length) {
        return;
    }

    for (const filter of record.extraFilters) {
        if (!filter.enabled) {
            continue;
        }

        try {
            await upsertExtraAutoModFilter(
                handler,
                guild,
                filter,
                record.customMessage || handler.defaultAutoModMessage,
                true
            );
        } catch (error) {
            handleAutoModApiError(handler, error, 'I could not update one of the additional auto moderation filters, sir.');
        }
    }
}

async function disableAutoModRule(guild, ruleId) {
    if (!guild || !ruleId) {
        return false;
    }

    if (Array.isArray(ruleId)) {
        let disabledAny = false;
        for (const id of ruleId) {
            const disabled = await disableAutoModRule(guild, id);
            if (disabled) {
                disabledAny = true;
            }
        }
        return disabledAny;
    }

    try {
        const rule = await guild.autoModerationRules.fetch(ruleId);
        if (!rule) {
            return false;
        }

        await rule.edit({ enabled: false });
        return true;
    } catch (error) {
        if (error.code === 10066 || error.code === 50001) {
            return false;
        }

        throw error;
    }
}

module.exports = {
    normalizeKeyword,
    parseKeywordInput,
    mergeKeywords,
    createDefaultAutoModRecord,
    extractAutoModKeywordIssues,
    getAutoModErrorMessage,
    handleAutoModApiError,
    prepareAutoModState,
    fetchAutoModRule,
    upsertAutoModRule,
    syncAutoModRules,
    generateAutoModFilterName,
    upsertExtraAutoModFilter,
    enableExtraAutoModFilters,
    disableExtraAutoModFilters,
    resyncEnabledExtraAutoModFilters,
    disableAutoModRule
};

'use strict';

function parseNumericStatus(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {return value;}
    if (typeof value === 'string' && /^\d{3}$/.test(value.trim())) {
        return Number(value.trim());
    }
    return null;
}

function extractStatusFromMessage(message) {
    const text = String(message || '');
    const match = text.match(/\b([45]\d{2})\b/);
    return match ? Number(match[1]) : null;
}

function parseDurationMs(value) {
    const raw = String(value || '').trim();
    const match = raw.match(/^([0-9]+(?:\.[0-9]+)?)(ms|s|m)$/i);
    if (!match) {return null;}
    const amount = Number(match[1]);
    const unit = match[2].toLowerCase();
    if (!Number.isFinite(amount) || amount < 0) {return null;}
    if (unit === 'ms') {return Math.round(amount);}
    if (unit === 's') {return Math.round(amount * 1000);}
    return Math.round(amount * 60 * 1000);
}

function parseRetryDelayMs(message) {
    const text = String(message || '');
    const structured = text.match(/"retryDelay"\s*:\s*"([^"]+)"/i);
    if (structured) {return parseDurationMs(structured[1]);}
    const inline = text.match(/retry(?: in)?\s+([0-9]+(?:\.[0-9]+)?)\s*(ms|s|m)\b/i);
    if (inline) {return parseDurationMs(`${inline[1]}${inline[2]}`);}
    return null;
}

function inferProviderFault(status, message) {
    const lower = String(message || '').toLowerCase();
    if (
        /invalid api key|unauthorized|forbidden|model .* not found|billing details|quota exceeded|rate limit|timed out|timeout|overloaded|service unavailable|empty response|sanitized empty/i.test(
            lower
        )
    ) {return true;}
    if ([400, 413, 422].includes(status)) {return false;}
    if ([401, 403, 404, 408, 409, 423, 425, 429, 500, 502, 503, 504, 524].includes(status)) {return true;}
    return true;
}

function normalizeOpenAICompatibleError(error, providerName = 'provider') {
    const message = error?.message || String(error) || `OpenAI-compatible error from ${providerName}`;
    const inferredStatus =
        parseNumericStatus(error?.status) ||
        parseNumericStatus(error?.response?.status) ||
        parseNumericStatus(error?.cause?.status) ||
        parseNumericStatus(error?.code) ||
        parseNumericStatus(error?.body?.error?.code) ||
        extractStatusFromMessage(message);
    const lower = message.toLowerCase();
    const transient =
        Boolean(error?.transient) ||
        (inferredStatus ? [408, 409, 423, 425, 429, 500, 502, 503, 504, 524].includes(inferredStatus) : false) ||
        /provider returned error|temporar|timeout|timed out|overloaded|rate limit|try again/i.test(lower);
    const retryDelayMs = error?.retryDelayMs || parseRetryDelayMs(message);
    const providerFault =
        typeof error?.providerFault === 'boolean'
            ? error.providerFault
            : inferProviderFault(inferredStatus, message);

    return Object.assign(new Error(message), error, {
        status: inferredStatus || error?.status || error?.response?.status,
        code: error?.code || inferredStatus || error?.response?.status,
        transient,
        retryDelayMs,
        providerFault
    });
}

function normalizeGoogleError(error, providerName = 'provider') {
    const rawMessage = error?.message || String(error) || `Google AI error from ${providerName}`;
    const lower = rawMessage.toLowerCase();
    const thinkingRequired =
        /budget 0 is invalid|thinking mode|required thinking|only works in thinking mode/i.test(lower);
    const status =
        parseNumericStatus(error?.status) ||
        parseNumericStatus(error?.response?.status) ||
        parseNumericStatus(error?.cause?.status) ||
        extractStatusFromMessage(rawMessage) ||
        (/quota exceeded|too many requests|rate limit|429/i.test(lower)
            ? 429
            : /timed out|timeout|deadline exceeded|408/i.test(lower)
                ? 408
                : /unavailable|overloaded|service unavailable|503/i.test(lower)
                    ? 503
                    : thinkingRequired || /blocked|safety|400/i.test(lower)
                        ? 400
                        : 502);
    const quotaExhausted = /quota exceeded|exceeded your current quota|rate limit|too many requests/i.test(lower);
    const permanentQuota = quotaExhausted && /limit:\s*0\b|billing details/i.test(lower);
    const promptBlocked = /blocked|safety filter|blockreason|blocked due to/i.test(lower);
    const transient =
        Boolean(error?.transient) ||
        (!thinkingRequired &&
            [408, 409, 423, 425, 429, 500, 502, 503, 504, 524].includes(status)) ||
        (!thinkingRequired && /temporar|timed out|timeout|overloaded|try again/i.test(lower));
    const providerFault =
        typeof error?.providerFault === 'boolean'
            ? error.providerFault
            : thinkingRequired ||
                quotaExhausted ||
                [401, 403, 404, 408, 429, 500, 502, 503, 504].includes(status) ||
                (!promptBlocked && inferProviderFault(status, rawMessage));

    return Object.assign(new Error(`Gemini error: ${rawMessage}`), error, {
        status,
        code: error?.code || status,
        transient,
        retryDelayMs: error?.retryDelayMs || parseRetryDelayMs(rawMessage),
        quotaExhausted,
        permanentQuota,
        thinkingRequired,
        promptBlocked,
        providerFault
    });
}

module.exports = {
    parseNumericStatus,
    extractStatusFromMessage,
    parseDurationMs,
    parseRetryDelayMs,
    inferProviderFault,
    normalizeOpenAICompatibleError,
    normalizeGoogleError
};

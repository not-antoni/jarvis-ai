'use strict';
const sharp = require('sharp');
const config = require('../../config');
const { getAIFetch } = require('./ai-proxy');
const { HarmCategory, HarmBlockThreshold } = require('@google/generative-ai');
const aiFetch = getAIFetch();
const GEMINI_SAFETY_OFF = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];
// ============ OUTPUT SANITIZATION HELPERS ============
function sanitizeModelOutput(text) {
    if (!text || typeof text !== 'string') {return text;}
    // 1) Normalize line endings
    let out = text.replace(/\r\n?/g, '\n');
    // 2) Remove exact dangerous markup patterns
    out = out.replace(
        /<\/message>\s*<\/start>\s*assistant\s*<\/channel>\s*final\s*<\/message>/gi,
        ' '
    );
    out = out.replace(/<\/channel>\s*final\s*<\/message>/gi, ' ');
    // 3) Remove stray partial markers
    out = out.replace(/<start>\s*assistant\b[^>]*>/gi, ' ');
    out = out.replace(/<\/start>\s*assistant\b[^>]*>/gi, ' ');
    out = out.replace(/<\s*\/?channel\b[^>]*>/gi, ' ');
    out = out.replace(/<\s*\/?message\b[^>]*>/gi, ' ');
    // 4) Remove suspicious long token ladders
    out = out.replace(
        /\b(Certainly|Absolutely|Certainly!|Sure|Affirmative)[\s\p{P}\-]{0,40}(?:(Certainly|Absolutely|Sure|Affirmative)[\s\p{P}\-]*){1,}/giu,
        '$1'
    );
    // 5) Transliterate common Unicode punctuation to ASCII equivalents
    out = out
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u201C\u201D]/g, '"')
        .replace(/[\u2013\u2014]/g, '-')
        .replace(/\u2026/g, '...')
        .replace(/[\u2022\u25CF\u25AA\u25B6]/g, '-')
        .replace(/\u00A0/g, ' ')
        .replace(/\u00A9/g, '(c)')
        .replace(/\u00AE/g, '(r)')
        .replace(/\u2122/g, '(tm)')
        .replace(/\u2260/g, '!=')
        .replace(/\u2264/g, '<=')
        .replace(/\u2265/g, '>=');
    // 6) Strip control characters but keep Unicode text and emojis
    out = out.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    // 7) Collapse multiple spaces on same line, but preserve single newlines
    out = out.replace(/[^\S\n]+/g, ' ');
    out = out.replace(/\n{3,}/g, '\n\n');
    out = out.trim();
    return out;
}
function cleanThinkingOutput(text) {
    if (!text || typeof text !== 'string') {return text;}
    return text
        .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/[^\S\n]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}
function stripWrappingQuotes(text) {
    if (!text || typeof text !== 'string') {return text;}
    const trimmed = text.trim();
    if (!trimmed) {return trimmed;}
    const pairs = [
        ['"', '"'],
        ['\u201C', '\u201D'],
        ['\u201E', '\u201D'],
        ['\u00AB', '\u00BB'],
        ["'", "'"]
    ];
    for (const [start, end] of pairs) {
        if (!trimmed.startsWith(start) || !trimmed.endsWith(end)) {
            continue;
        }
        if (trimmed.length < start.length + end.length) {
            continue;
        }
        const inner = trimmed.slice(start.length, trimmed.length - end.length);
        // Only strip if the outer quotes are the only instances of this quote pair.
        if (start === end) {
            const occurrences = trimmed.split(start).length - 1;
            if (occurrences !== 2) {
                continue;
            }
        } else {
            const startCount = trimmed.split(start).length - 1;
            const endCount = trimmed.split(end).length - 1;
            if (startCount !== 1 || endCount !== 1) {
                continue;
            }
        }
        return inner.trim();
    }
    return trimmed;
}
function stripJarvisSpeakerPrefix(text) {
    if (!text || typeof text !== 'string') {return text;}
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
    if (!text || typeof text !== 'string') {return text;}
    let trimmed = text.trim();
    const pattern = /(?:[\s,.;:!?\-]*[\(\[\{"]+\s*channel\s*[\)\]\}"]+[\s,.;:!?\-]*)$/i;
    while (pattern.test(trimmed)) {
        trimmed = trimmed.replace(pattern, '').trim();
    }
    return trimmed;
}
function stripLeadingPromptLeaks(text) {
    if (!text || typeof text !== 'string') {return text;}
    let trimmed = text.trim();
    for (const pat of [/^channel\s*:\s*/i, /^commentary\s*:\s*/i, /^[\[\(]\s*channel\s*[\]\)]\s*:?\s*/i]) {
        if (pat.test(trimmed)) {trimmed = trimmed.replace(pat, '').trimStart();}
    }
    return trimmed;
}
function stripRefusalsAndIdentityBreaks(text) {
    if (!text || typeof text !== 'string') {return text;}
    let out = text;
    // Strip "As an AI language model" / "As an AI assistant" prefixes
    out = out.replace(/^(?:As an? (?:AI|artificial intelligence|language model|large language model|LLM)(?:\s*(?:assistant|model|,))?(?:\s*,?\s*)?(?:I (?:cannot|can't|don't|am not able to|must))?)/i, '');
    // Strip refusal openers that break character
    out = out.replace(/^(?:I'?m sorry,?\s*(?:but\s*)?)?I (?:cannot|can't|am (?:not |un)able to|must (?:not|decline to)|don't think I (?:should|can))\s+(?:help with|assist with|provide|generate|create|do)\s+(?:that|this)[.,]?\s*/i, '');
    // Strip "I'm afraid I can't/must decline" patterns (common Llama/Nemotron refusal)
    out = out.replace(/^I'?m afraid\s+(?:I (?:can't|cannot|must|will not|won't)\s+)?[^.]*\.\s*/i, '');
    // Strip "I must decline/I need to decline" openers
    out = out.replace(/^I (?:must|need to|have to) (?:decline|refuse|refrain from)[^.]*\.\s*/i, '');
    // Strip "While I understand" / "I understand your request but" hedging
    out = out.replace(/^(?:While I (?:understand|appreciate)[^,]*,\s*)?(?:I (?:cannot|can't|am not able to|must not|should not|won't))[^.]*\.\s*/i, '');
    // Strip safety disclaimers mid-response
    out = out.replace(/\b(?:(?:Please )?(?:note|remember|be aware) that (?:as an AI|I am an AI|this is (?:just )?(?:fiction|a joke|for entertainment)))[^.]*\.\s*/gi, '');
    // Strip "It's important to note/remember" safety tails
    out = out.replace(/\b(?:It'?s (?:important|worth) (?:to )?(?:note|remember|mention) that)[^.]*\.\s*/gi, '');
    // Strip "in all seriousness" / "jokes aside" disclaimer breaks
    out = out.replace(/\b(?:(?:But )?(?:in all seriousness|jokes? aside|on a serious note|seriously though))[^.]*\.\s*/gi, '');
    // Strip trailing ethical disclaimers
    out = out.replace(/\s*(?:However|That said|But seriously),?\s*(?:I (?:strongly |would )?(?:advise|recommend|suggest|encourage|urge)|please (?:don't|do not))[^.]*\.?\s*$/i, '');
    return out.trim();
}
function stripAsteriskActions(text) {
    if (!text || typeof text !== 'string') {return text;}
    // Remove *action* patterns (e.g. *clears throat*, *adjusts tie*)
    // but preserve markdown bold **word** and italic *word* used for emphasis
    return text.replace(/\*[a-z][^*\n]{2,60}\*(?:\s*)/gi, (match) => {
        // Keep if it looks like markdown emphasis (single word or short phrase without verbs)
        const inner = match.trim().slice(1, -1).trim();
        const words = inner.split(/\s+/);
        // Action patterns typically have verbs — 2+ words or gerund-like
        if (words.length >= 2 || /(?:ing|tion|ly)$/i.test(inner)) {
            return '';
        }
        return match;
    }).replace(/\s{2,}/g, ' ').trim();
}
function unwrapJsonEnvelope(text) {
    if (!text || typeof text !== 'string') {return text;}
    const trimmed = text.trim();
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {return text;}
    try {
        const obj = JSON.parse(trimmed);
        if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {return text;}
        // Extract reply from known structured-response keys
        for (const key of ['reply', 'response', 'content', 'text', 'answer', 'message', 'en']) {
            if (typeof obj[key] === 'string' && obj[key].trim()) {
                return obj[key].trim();
            }
        }
    } catch { /* not JSON, pass through */ }
    return text;
}
function stripChainOfThought(text) {
    if (!text || typeof text !== 'string') {return text;}
    const trimmed = text.trim();
    // Detect CoT: starts with "User: <name>" and contains bullet reasoning "* Input:" or "* Context:"
    if (!/^(?:[•\-*]\s*)?User:\s*\w/i.test(trimmed) ||
        !/\*\s*(?:Input|Context|Role|Current constraints):/i.test(trimmed)) {
        return text;
    }
    // The model outputs: ..."selected response"selected response (duplicated at end)
    // Find all quoted strings, take the last one, then check for text after it
    const allQuotes = [...trimmed.matchAll(/"([^"]{10,})"/g)];
    if (allQuotes.length > 0) {
        const lastQuoted = allQuotes[allQuotes.length - 1];
        const afterQuote = trimmed.slice(lastQuoted.index + lastQuoted[0].length).trim();
        if (afterQuote.length > 5) {return afterQuote;}
        return lastQuoted[1].trim();
    }
    // Fallback: take text after the last bullet that isn't a question
    const bullets = trimmed.split(/\s*\*\s+/);
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i].trim();
        if (b.length > 5 && !/\?\s*(Yes|No)/i.test(b)) {
            return b.replace(/^"([\s\S]+)"$/, '$1').trim();
        }
    }
    return text;
}
function sanitizeAssistantMessage(text) {
    if (!text || typeof text !== 'string') {return text;}
    const unwrapped = unwrapJsonEnvelope(text);
    const withoutCoT = stripChainOfThought(unwrapped);
    const hadChannelArtifacts = /<\s*\/?\s*channel\b|<\s*\/?\s*message\b|<\s*start>\s*assistant\b|<\/start>\s*assistant\b|^\s*channel\s*:/i.test(withoutCoT);
    const layered = cleanThinkingOutput(sanitizeModelOutput(withoutCoT));
    const withoutPromptLeaks = stripLeadingPromptLeaks(layered);
    const withoutRefusals = stripRefusalsAndIdentityBreaks(withoutPromptLeaks);
    const withoutActions = stripAsteriskActions(withoutRefusals);
    const withoutPrefix = stripJarvisSpeakerPrefix(withoutActions);
    const withoutChannelArtifacts = hadChannelArtifacts
        ? stripTrailingChannelArtifacts(withoutPrefix)
        : withoutPrefix;
    return stripWrappingQuotes(withoutChannelArtifacts);
}
function extractOpenAICompatibleText(choice) {
    const content = choice?.message?.content;
    if (typeof content === 'string') {
        return content;
    }
    if (Array.isArray(content)) {
        return content
            .map(part => {
                if (typeof part === 'string') {return part;}
                if (typeof part?.text === 'string') {return part.text;}
                return null;
            })
            .filter(Boolean)
            .join('\n')
            .trim();
    }
    return null;
}
function parseNumericStatus(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
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

    return Object.assign(new Error(message), error, {
        status: inferredStatus || error?.status || error?.response?.status,
        code: error?.code || inferredStatus || error?.response?.status,
        transient
    });
}
// ============ EXECUTION ENGINE ============
/**
 * Core generation execution - tries each provider in order with retry logic.
 * @param {AIProviderManager} manager - The provider manager instance
 * @param {string} userId - Optional user ID for session stickiness
 */
async function executeGeneration(manager, systemPrompt, userPrompt, maxTokens, userId = null) {
    // Safety check: reinitialize providers if somehow empty
    if (manager.providers.length === 0) {
        console.warn('Provider list was empty - reinitializing providers...');
        manager.setupProviders();
        if (manager.providers.length === 0) {
            throw new Error('No AI providers available - check API key configuration');
        }
        console.log(`Reinitialized ${manager.providers.length} AI providers`);
    }
    // Session stickiness keeps users on the same model within a 60s window
    // while distributing load via round-robin across all users
    const stickyProvider = userId ? manager._getSessionStickyProvider(userId) : null;
    const rankedProviders = manager._rankedProviders();
    const candidates = stickyProvider
        ? [stickyProvider, ...rankedProviders.filter(p => p.name !== stickyProvider.name)]
        : rankedProviders;
    let lastError = null;
    for (const provider of candidates) {
        const started = Date.now();
        const callOnce = async() => {
            if (provider.type === 'google') {
    // Gemma 3 and below don't support systemInstruction — inject it into the user message instead
    // Gemma 4+ supports native systemInstruction
    const isGemmaLegacy = /^gemma-[1-3]/i.test(provider.model);
    const model = provider.client.getGenerativeModel(
        isGemmaLegacy
            ? { model: provider.model, safetySettings: GEMINI_SAFETY_OFF }
            : { model: provider.model, systemInstruction: systemPrompt, safetySettings: GEMINI_SAFETY_OFF }
    );
    const effectiveUserPrompt = isGemmaLegacy && systemPrompt
        ? `${systemPrompt}\n\n${userPrompt}`
        : userPrompt;
    let result;
    try {
        result = await model.generateContent({
            contents: [
                {
                    role: 'user',
                    parts: [{ text: effectiveUserPrompt }]
                }
            ],
            generationConfig: {
                temperature: config.ai?.temperature ?? 0.7,
                maxOutputTokens: maxTokens,
                thinkingConfig: { thinkingBudget: 0 }
            }
        });
                } catch (geminiError) {
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
                const blockReason = response?.promptFeedback?.blockReason;
                if (blockReason) {
                    throw Object.assign(new Error(`Gemini blocked: ${blockReason}`), {
                        status: 400
                    });
                }
                const finishReason = response?.candidates?.[0]?.finishReason;
                if (finishReason === 'SAFETY') {
                    throw Object.assign(new Error('Gemini safety filter triggered'), {
                        status: 400
                    });
                }
                // Extract text from response parts, skipping thinking/thought parts
                const allParts =
                    response?.candidates?.flatMap(
                        candidate => candidate?.content?.parts || []
                    ) || [];
                let text = allParts
                    .filter(part => !part?.thought)
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
                // Fallback to response.text() if parts extraction yielded nothing
                if (!text) {
                    try {
                        text = typeof response?.text === 'function' ? response.text() : null;
                    } catch (textError) {
                        console.warn(`Gemini text() extraction failed: ${textError.message}`);
                    }
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
            // ---------- Ollama native API handler ----------
            if (provider.type === 'ollama') {
                const ollamaEndpoint = `${provider.baseURL}/chat`;
                const messages = [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ];
                const requestBody = {
                    model: provider.model,
                    messages,
                    stream: false,
                    think: false,
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
                return {
                    choices: [{ message: { content: cleaned } }],
                    usage: {
                        prompt_tokens: ollamaResp?.prompt_eval_count || 0,
                        completion_tokens: ollamaResp?.eval_count || 0
                    }
                };
            }
            // ---------- Cloudflare Workers AI handler ----------
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
                const lines = text.split('\n');
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const jsonStr = line.slice(6);
                        if (jsonStr === '[DONE]') {continue;}
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
                        new Error('Empty response from Cloudflare AI'),
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
            let resp;
            try {
                resp = await provider.client.chat.completions.create({
                    model: provider.model,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userPrompt }
                    ],
                    max_tokens: maxTokens,
                    temperature: config.ai?.temperature ?? 0.7
                });
            } catch (openAiCompatError) {
                throw normalizeOpenAICompatibleError(openAiCompatError, provider.name);
            }
            const choice = resp?.choices?.[0];
            const text = extractOpenAICompatibleText(choice);
            if (!text || !String(text).trim()) {
                const reasoning = String(choice?.message?.reasoning || '').trim();
                const finishReason = choice?.finish_reason;
                if (provider.name.startsWith('OpenRouter') && reasoning) {
                    throw Object.assign(
                        new Error(
                            `Reasoning-only response from ${provider.name}${finishReason ? ` (finish_reason=${finishReason})` : ''}`
                        ),
                        { status: 502, transient: true }
                    );
                }
                throw Object.assign(new Error(`Empty response content from ${provider.name}`), {
                    status: 502
                });
            }
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
            const PROVIDER_ATTEMPT_TIMEOUT = 12_000; // don't let one slow provider burn the whole budget
            const retryPromise = manager._retry(callOnce, {
                retries: retryAttempts,
                baseDelay: retryAttempts > 0 ? 500 : 0,
                jitter: retryAttempts > 0,
                providerName: provider.name
            });
            const resp = await Promise.race([
                retryPromise,
                new Promise((_, reject) =>
                    setTimeout(() => reject(Object.assign(
                        new Error(`${provider.name} timed out after ${PROVIDER_ATTEMPT_TIMEOUT}ms`),
                        { status: 408, transient: true }
                    )), PROVIDER_ATTEMPT_TIMEOUT).unref()
                )
            ]);
            const latency = Date.now() - started;
            manager._recordMetric(provider.name, true, latency);
            if (provider.name.startsWith('OpenRouter')) {
                manager.openRouterFailureCount = 0;
            }
            // Reset failure count on success (for exponential backoff)
            if (manager.providerFailureCounts.has(provider.name)) {
                manager.providerFailureCounts.delete(provider.name);
            }
            console.log(`Success with ${provider.name} (${provider.model}) in ${latency}ms`);
            // Track tokens from response
            manager.totalRequests++;
            manager.successfulRequests++;
            const tokensIn = resp?.usage?.prompt_tokens || 0;
            const tokensOut = resp?.usage?.completion_tokens || 0;
            if (resp?.usage) {
                manager.totalTokensIn += tokensIn;
                manager.totalTokensOut += tokensOut;
            }
            manager.scheduleStateSave();
            const raw = resp?.choices?.[0]?.message?.content;
            const cleaned = raw ? String(raw) : '';
            // Detect truncated responses (hit max_tokens limit)
            const finishReason = resp?.choices?.[0]?.finish_reason;
            const wasTruncated = finishReason === 'length';
            if (wasTruncated) {
                console.warn(`[AIProviderManager] Response from ${provider.name} was truncated (finish_reason=length)`);
            }
            return {
                content: cleaned,
                provider: provider.name,
                tokensIn: resp?.usage?.prompt_tokens || 0,
                tokensOut: resp?.usage?.completion_tokens || 0,
                truncated: wasTruncated
            };
        } catch (error) {
            const latency = Date.now() - started;
            manager._recordMetric(provider.name, false, latency);
            manager.totalRequests++;
            manager.failedRequests++;
            manager.providerErrors.set(provider.name, {
                error: error.message,
                timestamp: Date.now(),
                status: error.status
            });
            manager.scheduleStateSave();
            const errStatus = error?.status || error?.response?.status;
            if (errStatus !== 429) {
                console.error(
                    `Failed with ${provider.name} (${provider.model}) after ${latency}ms: ${error.message} ${errStatus ? `(Status: ${errStatus})` : ''}`
                );
            }
            lastError = error;
            // Circuit breaker — rate limits and overloaded providers get cooldowns
            const status = error?.status || error?.response?.status;
            if (status === 429) {
                // Rate limit: bench for 45s only, don't escalate failure count
                manager.disabledProviders.set(provider.name, Date.now() + 45 * 1000);
            } else if (status === 503) {
                // Over capacity: bench for 2 minutes — these take 15-17s to fail and will keep doing so
                manager.disabledProviders.set(provider.name, Date.now() + 2 * 60 * 1000);
                console.log(`${provider.name} benched 2m (503 over capacity)`);
            } else if (!error.transient) {
                const currentFailures = (manager.providerFailureCounts.get(provider.name) || 0) + 1;
                manager.providerFailureCounts.set(provider.name, currentFailures);
                const backoffDurations = [
                    2 * 60 * 1000,      // 1st failure: 2 minutes
                    10 * 60 * 1000,     // 2nd failure: 10 minutes
                    30 * 60 * 1000,     // 3rd failure: 30 minutes
                    60 * 60 * 1000      // 4th+ failure: 1 hour (max)
                ];
                const backoffIndex = Math.min(currentFailures - 1, backoffDurations.length - 1);
                const disableDuration = backoffDurations[backoffIndex];
                const durationLabel = disableDuration >= 60 * 60 * 1000
                    ? `${disableDuration / (60 * 60 * 1000)}h`
                    : `${disableDuration / (60 * 1000)}m`;
                manager.disabledProviders.set(provider.name, Date.now() + disableDuration);
                manager.scheduleStateSave();
                console.log(`${provider.name} disabled for ${durationLabel} (failure #${currentFailures})`);
            }
            // Track OpenRouter consecutive empties to toggle global failure
            const isEmptyResponse = String(error.message || '')
                .toLowerCase()
                .includes('empty');
            if (isEmptyResponse && provider.name.startsWith('OpenRouter')) {
                manager.openRouterFailureCount += 1;
                if (manager.openRouterFailureCount >= 2) {
                    manager.openRouterGlobalFailure = true;
                    manager.openRouterFailureCount = 0;
                    console.log(
                        'OpenRouter global failure detected - disabling all OpenRouter providers temporarily'
                    );
                    const clearAfter = 6 * 60 * 60 * 1000;
                    const clearGlobal = () => {
                        manager.openRouterGlobalFailure = false;
                        manager.openRouterFailureCount = 0;
                        console.log(
                            'OpenRouter global failure cleared - re-enabling OpenRouter providers'
                        );
                        manager.scheduleStateSave();
                    };
                    // Canary after 5 minutes to re-enable sooner if transient
                    setTimeout(
                        () => {
                            const canary = manager.providers.find(
                                p =>
                                    p.name.startsWith('OpenRouter') &&
                                    !manager.disabledProviders.get(p.name)
                            );
                            if (!canary?.client?.chat?.completions) {
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
                                    setTimeout(clearGlobal, Math.max(0, clearAfter - 5 * 60 * 1000)).unref?.();
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
// ============ IMAGE/VISION PIPELINE ============
/**
 * Generate a response with image support (for vision-capable models like Ollama).
 * @param {AIProviderManager} manager - The provider manager instance
 * @param {string} systemPrompt - System prompt for the AI
 * @param {string} userPrompt - User message/prompt
 * @param {Array<{url: string, contentType?: string}>} images - Array of image objects with URLs
 * @param {number} maxTokens - Maximum tokens in response
 * @param {Object} options - Additional options (including userId)
 * @returns {Promise<{content: string, provider: string, tokensIn: number, tokensOut: number}>}
 */
async function generateResponseWithImages(
    manager,
    systemPrompt,
    userPrompt,
    images = [],
    maxTokens = config.ai?.maxTokens || 4096,
    options = {}
) {
    const { allowModerationOnly = false, userId = null } = options;
    // If no images, fall back to regular generateResponse
    if (!images || images.length === 0) {
        return manager.generateResponse(systemPrompt, userPrompt, maxTokens);
    }
    // Ensure prompts are strings
    systemPrompt = systemPrompt != null ? String(systemPrompt) : '';
    userPrompt = userPrompt != null ? String(userPrompt) : '';
    // Safety check: reinitialize providers if somehow empty
    if (manager.providers.length === 0) {
        console.warn('Provider list was empty - reinitializing providers...');
        manager.setupProviders();
        if (manager.providers.length === 0) {
            throw new Error('No AI providers available - check API key configuration');
        }
    }
    // Filter for providers that support images (Ollama with vision models)
    const imageCapableProviders = manager.providers.filter(
        p => p.supportsImages && p.type === 'ollama' && (allowModerationOnly || !p.moderationOnly)
    );
    if (imageCapableProviders.length === 0) {
        console.warn(
            `No image-capable providers available (moderationOnly=${  allowModerationOnly  }), falling back to text-only response`
        );
        return manager.generateResponse(systemPrompt, userPrompt, maxTokens);
    }
    // Download and convert images to base64
    const base64Images = [];
    for (const image of images) {
        try {
            const imageUrl = image.url || image;
            // Validate URL — only allow http/https to prevent SSRF
            if (typeof imageUrl !== 'string' || !/^https?:\/\//i.test(imageUrl)) {
                console.warn(`Rejected non-HTTP image URL: ${imageUrl}`);
                continue;
            }
            const supportedTypes = [
                'image/jpeg',
                'image/jpg',
                'image/png',
                'image/webp',
                'image/gif'
            ];
            const contentType = image.contentType || '';
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
        return manager.generateResponse(systemPrompt, userPrompt, maxTokens);
    }
    let lastError = null;
    // Check how many are actually available (not disabled)
    const availableProviders = imageCapableProviders.filter(p => {
        const disabledUntil = manager.disabledProviders.get(p.name);
        return !disabledUntil || disabledUntil <= Date.now();
    });
    if (availableProviders.length === 0 && imageCapableProviders.length > 0) {
        console.warn(
            `All ${imageCapableProviders.length} Ollama providers are temporarily disabled, clearing disabled state...`
        );
        for (const p of imageCapableProviders) {
            manager.disabledProviders.delete(p.name);
        }
    }
    for (const provider of imageCapableProviders) {
        const started = Date.now();
        const disabledUntil = manager.disabledProviders.get(provider.name);
        if (disabledUntil && disabledUntil > Date.now()) {continue;}
        console.log(
            `Attempting image request with ${provider.name} (${provider.model}) [${base64Images.length} image(s)]`
        );
        try {
            if (provider.type === 'ollama') {
                const ollamaEndpoint = `${provider.baseURL}/chat`;
                const messages = [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt, images: base64Images }
                ];
                const requestBody = {
                    model: provider.model,
                    messages,
                    stream: false,
                    think: false,
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
                manager._recordMetric(provider.name, true, latency);
                manager.totalRequests++;
                manager.successfulRequests++;
                const tokensIn = ollamaResp?.prompt_eval_count || 0;
                const tokensOut = ollamaResp?.eval_count || 0;
                manager.totalTokensIn += tokensIn;
                manager.totalTokensOut += tokensOut;
                manager.scheduleStateSave();
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
            manager._recordMetric(provider.name, false, latency);
            manager.totalRequests++;
            manager.failedRequests++;
            manager.providerErrors.set(provider.name, {
                error: error.message,
                timestamp: Date.now(),
                status: error.status
            });
            manager.scheduleStateSave();
            console.error(
                `Failed with ${provider.name} (${provider.model}) [image] after ${latency}ms: ${error.message}`
            );
            lastError = error;
            // Only disable provider for hard failures, not transient ones
            if (!error.transient) {
                manager.disabledProviders.set(provider.name, Date.now() + 2 * 60 * 60 * 1000);
            }
        }
    }
    // If all image providers failed, try without images as fallback
    console.warn(
        `All image-capable providers failed (last error: ${lastError?.message}), attempting text-only fallback`
    );
    return manager.generateResponse(
        systemPrompt,
        `[User sent ${images.length} image(s) that could not be processed]\n\n${userPrompt}`,
        maxTokens
    );
}
module.exports = {
    executeGeneration,
    generateResponseWithImages,
    sanitizeAssistantMessage,
    extractOpenAICompatibleText,
    normalizeOpenAICompatibleError
};

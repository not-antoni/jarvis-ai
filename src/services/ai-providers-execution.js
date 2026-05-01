'use strict';
const sharp = require('sharp');
const config = require('../../config');
const { getAIFetch } = require('./ai-proxy');
const { HarmCategory, HarmBlockThreshold } = require('@google/generative-ai');
const aiFetch = getAIFetch();

const {
    sanitizeAssistantMessage,
    extractOpenAICompatibleText
} = require('./ai/sanitize');
const {
    normalizeOpenAICompatibleError,
    normalizeGoogleError
} = require('./ai/error-normalize');
const {
    getProviderAttemptTimeoutMs,
    getRequestBudgetMs,
    getMinFailoverAttempts,
    benchProvider,
    resolveCooldownPolicy
} = require('./ai/cooldown');
const { resolveSystemPrompt } = require('./ai/system-prompt');

const GEMINI_SAFETY_OFF =[
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE }
];

// ============ EXECUTION ENGINE ============
/**
 * Core generation execution - tries each provider in order with retry logic.
 */
async function executeGeneration(manager, systemPrompt, userPrompt, maxTokens, userId = null) {
    if (manager.providers.length === 0) {
        console.warn('Provider list was empty - reinitializing providers...');
        manager.setupProviders();
        if (manager.providers.length === 0) {
            throw new Error('No AI providers available - check API configuration');
        }
        console.log(`Reinitialized ${manager.providers.length} AI providers`);
    }
    const attemptedProviders = new Set();
    // Families whose entire pool has refused this prompt for content-policy
    // reasons. Same prompt → same family → same refusal, so once Gemini1
    // returns "blocked", we skip Gemini2..N and move to other vendors. Stops
    // a single refusal from burning the failover budget across 10+ keys.
    const blockedFamilies = new Set();
    const requestStartedAt = Date.now();

    const requestBudgetMs = getRequestBudgetMs(manager);
    const minAttempts = getMinFailoverAttempts();

    let lastError = null;
    while (true) {
        const elapsedMs = Date.now() - requestStartedAt;
        const remainingBudgetMs = requestBudgetMs - elapsedMs;
        // Hard ceiling: never exceed 2x the configured budget - even when
        // honouring the min-attempts guarantee - so a wedged provider can't
        // hold the request open forever (#318).
        const overBudgetCeilingMs = requestBudgetMs * 2;
        const hasMinAttempts = attemptedProviders.size >= minAttempts;
        const overHardCeiling = elapsedMs >= overBudgetCeilingMs;
        if (remainingBudgetMs < 250 && (hasMinAttempts || overHardCeiling)) {
            lastError = Object.assign(
                new Error(`AI failover budget exhausted after ${requestBudgetMs}ms`),
                { status: 408, transient: true, providerFault: false }
            );
            console.warn(
                `[AIProviderManager] Failover budget exhausted after ${elapsedMs}ms with ${attemptedProviders.size} attempted provider(s)`
            );
            break;
        }
        const rankedProviders = manager._rankedProviders();
        const orderedCandidates = rankedProviders.filter(candidate =>
            !attemptedProviders.has(candidate.name) &&
            !blockedFamilies.has(String(candidate.family || '').toLowerCase())
        );
        const provider = orderedCandidates[0];
        if (!provider) {break;}
        attemptedProviders.add(provider.name);
        const started = Date.now();
        const callOnce = async() => {
            const effectiveSystemPrompt = resolveSystemPrompt(systemPrompt, provider);
            if (provider.type === 'google') {
                // Fixed to apply to ALL gemma models, so it doesn't try using SystemInstructions for gemma-4 which causes failures
                const isGemmaLegacy = /^gemma-/i.test(provider.model);
                const model = provider.client.getGenerativeModel(
                    isGemmaLegacy
                        ? { model: provider.model, safetySettings: GEMINI_SAFETY_OFF }
                        : {
                            model: provider.model,
                            systemInstruction: effectiveSystemPrompt,
                            safetySettings: GEMINI_SAFETY_OFF
                        }
                );
                const effectiveUserPrompt = isGemmaLegacy && effectiveSystemPrompt
                    ? `${effectiveSystemPrompt}\n\n${userPrompt}`
                    : userPrompt;
                let result;
                try {
                    result = await model.generateContent({
                        contents: [{ role: 'user', parts: [{ text: effectiveUserPrompt }] }],
                        generationConfig: {
                            temperature: config.ai?.temperature ?? 0.7,
                            maxOutputTokens: maxTokens
                        }
                    });
                } catch (geminiError) {
                    throw normalizeGoogleError(geminiError, provider.name);
                }
                const response = result?.response;
                const blockReason = response?.promptFeedback?.blockReason;
                if (blockReason) {
                    throw Object.assign(new Error(`Gemini blocked: ${blockReason}`), {
                        status: 400, providerFault: false
                    });
                }
                const finishReason = response?.candidates?.[0]?.finishReason;
                if (finishReason === 'SAFETY') {
                    throw Object.assign(new Error('Gemini safety filter triggered'), {
                        status: 400, providerFault: false
                    });
                }
                const allParts =
                    response?.candidates?.flatMap(candidate => candidate?.content?.parts || []) ||[];
                let text = allParts
                    .filter(part => !part?.thought)
                    .map(part => {
                        if (typeof part?.text === 'string') {return part.text;}
                        if (part?.inlineData?.data) {
                            return Buffer.from(part.inlineData.data, 'base64').toString('utf8');
                        }
                        return null;
                    })
                    .filter(Boolean)
                    .join('\n')
                    .trim();
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
                        new Error(`Invalid or empty response from ${provider.name}${debugInfo}`),
                        { status: 502 }
                    );
                }
                let cleaned = sanitizeAssistantMessage(text);
                if (!cleaned && text) {cleaned = text.trim();}
                if (!cleaned) {
                    throw Object.assign(
                        new Error(`Sanitized empty content from ${provider.name}`),
                        { status: 502 }
                    );
                }
                return { choices:[{ message: { content: cleaned } }] };
            }
            // ---------- Ollama native API handler ----------
            if (provider.type === 'ollama') {
                const ollamaEndpoint = `${provider.baseURL}/chat`;
                const messages =[
                    { role: 'system', content: effectiveSystemPrompt },
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
                const headers = { 'Content-Type': 'application/json' };
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
            // ---------- AWS Bedrock InvokeModel handler ----------
            if (provider.type === 'bedrock') {
                const bedrockEndpoint = `${provider.baseURL}/model/${provider.model}/invoke`;
                const response = await aiFetch(bedrockEndpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                        'Authorization': `Bearer ${provider.apiKey}`
                    },
                    body: JSON.stringify({
                        messages:[
                            { role: 'system', content: effectiveSystemPrompt },
                            { role: 'user', content: userPrompt }
                        ],
                        max_tokens: maxTokens,
                        temperature: config.ai?.temperature ?? 0.7
                    })
                });
                if (!response.ok) {
                    const errorText = await response.text().catch(() => 'Unknown error');
                    throw Object.assign(new Error(`Bedrock error: ${errorText}`), {
                        status: response.status
                    });
                }
                const bedrockResp = await response.json();
                const choice = bedrockResp?.choices?.[0];
                const text = extractOpenAICompatibleText(choice);
                if (!text || !String(text).trim()) {
                    throw Object.assign(
                        new Error(`Empty response from ${provider.name}`),
                        { status: 502, transient: true }
                    );
                }
                const cleaned = sanitizeAssistantMessage(String(text));
                if (!cleaned) {
                    throw Object.assign(
                        new Error(`Sanitized empty content from ${provider.name}`),
                        { status: 502 }
                    );
                }
                return {
                    choices: [{ message: { content: cleaned } }],
                    usage: {
                        prompt_tokens: bedrockResp?.usage?.prompt_tokens || 0,
                        completion_tokens: bedrockResp?.usage?.completion_tokens || 0
                    }
                };
            }
            // ---------- Cloudflare Workers AI handler ----------
            if (provider.type === 'cloudflare-worker') {
                const cfEndpoint = `${provider.workerUrl}/api/chat`;
                const messages =[
                    { role: 'system', content: effectiveSystemPrompt },
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
                const text = await response.text();
                let fullContent = '';
                const lines = text.split('\n');
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const jsonStr = line.slice(6);
                        if (jsonStr === '[DONE]') {continue;}
                        try {
                            const chunk = JSON.parse(jsonStr);
                            if (chunk.response) {fullContent += chunk.response;}
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
                    messages:[
                        { role: 'system', content: effectiveSystemPrompt },
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

            // Use the per-family timeout from cooldown.js (8-9s typical) so a
            // single laggy provider can never burn the whole failover budget.
            // We still bound it by remainingBudgetMs to avoid over-spending.
            const providerTimeoutMs = getProviderAttemptTimeoutMs(provider);
            const minRemainingForAttempt = Math.max(remainingBudgetMs, 2_000);
            const PROVIDER_ATTEMPT_TIMEOUT = Math.max(
                250,
                Math.min(providerTimeoutMs, minRemainingForAttempt)
            );
            
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
            if (manager.providerFailureCounts.has(provider.name)) {
                manager.providerFailureCounts.delete(provider.name);
            }
            console.log(`Success with ${provider.name} (${provider.model}) in ${latency}ms`);
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
            // Content-policy blocks (prompt-side, providerFault:false) aren't
            // provider failures - they're Google's fixed input filter or
            // similar. Log at warn level with a clearer prefix so operators
            // don't mistake them for outages.
            const isPromptBlocked = error?.providerFault === false &&
                (error?.promptBlocked || /blocked|safety|prohibited_content/i.test(String(error?.message || '')));
            if (errStatus !== 429) {
                if (isPromptBlocked) {
                    console.warn(
                        `[ContentBlocked] ${provider.name} (${provider.model}) refused prompt after ${latency}ms: ${error.message}`
                    );
                } else {
                    console.error(
                        `Failed with ${provider.name} (${provider.model}) after ${latency}ms: ${error.message} ${errStatus ? `(Status: ${errStatus})` : ''}`
                    );
                }
            }
            // Skip the rest of this family for THIS request (#262 robustness):
            // a content-policy refusal is deterministic for the same prompt, so
            // we won't waste rotations on every other Gemini key.
            if (isPromptBlocked) {
                const family = String(provider.family || '').toLowerCase();
                if (family) {
                    blockedFamilies.add(family);
                    console.warn(
                        `[ContentBlocked] Skipping remaining "${family}" providers for this request after refusal from ${provider.name}`
                    );
                }
            }
            lastError = error;
            const cooldownPolicy = resolveCooldownPolicy(provider, error);
            if (cooldownPolicy) {
                benchProvider(
                    manager,
                    provider,
                    cooldownPolicy.durationMs,
                    cooldownPolicy.reason,
                    {
                        includeCredentialGroup: cooldownPolicy.includeCredentialGroup,
                        source: 'provider-execution'
                    }
                );
            } else if (!error.transient && error?.providerFault !== false) {
                const currentFailures = (manager.providerFailureCounts.get(provider.name) || 0) + 1;
                manager.providerFailureCounts.set(provider.name, currentFailures);
                const backoffDurations =[
                    2 * 60 * 1000,
                    10 * 60 * 1000,
                    30 * 60 * 1000,
                    60 * 60 * 1000
                ];
                const backoffIndex = Math.min(currentFailures - 1, backoffDurations.length - 1);
                const disableDuration = backoffDurations[backoffIndex];
                benchProvider(
                    manager,
                    provider,
                    disableDuration,
                    `failure #${currentFailures}`,
                    { source: 'provider-execution' }
                );
            }
            const isEmptyResponse = String(error.message || '').toLowerCase().includes('empty');
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
                                .then(() => { clearGlobal(); })
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
async function generateResponseWithImages(
    manager,
    systemPrompt,
    userPrompt,
    images =[],
    maxTokens = config.ai?.maxTokens || 4096,
    options = {}
) {
    const { allowModerationOnly = false, userId = null } = options;
    if (!images || images.length === 0) {
        return manager.generateResponse(systemPrompt, userPrompt, maxTokens);
    }
    systemPrompt = systemPrompt != null ? String(systemPrompt) : '';
    userPrompt = userPrompt != null ? String(userPrompt) : '';
    if (manager.providers.length === 0) {
        console.warn('Provider list was empty - reinitializing providers...');
        manager.setupProviders();
        if (manager.providers.length === 0) {
            throw new Error('No AI providers available - check API configuration');
        }
    }
    const imageCapableProviders = manager.providers.filter(
        p => p.supportsImages && p.type === 'ollama' && (allowModerationOnly || !p.moderationOnly)
    );
    if (imageCapableProviders.length === 0) {
        console.warn(
            `No image-capable providers available (moderationOnly=${  allowModerationOnly  }), falling back to text-only response`
        );
        return manager.generateResponse(systemPrompt, userPrompt, maxTokens);
    }
    const base64Images =[];
    for (const image of images) {
        try {
            const imageUrl = image.url || image;
            if (typeof imageUrl !== 'string' || !/^https?:\/\//i.test(imageUrl)) {
                console.warn(`Rejected non-HTTP image URL: ${imageUrl}`);
                continue;
            }
            const supportedTypes =['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
            const contentType = image.contentType || '';
            const response = await aiFetch(imageUrl);
            if (!response.ok) {
                console.warn(`Failed to fetch image: ${imageUrl}`);
                continue;
            }
            const arrayBuffer = await response.arrayBuffer();
            let buffer = Buffer.from(arrayBuffer);
            const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
            if (buffer.length > MAX_IMAGE_SIZE_BYTES) {
                console.warn(`Image too large (${(buffer.length / 1024 / 1024).toFixed(1)}MB), skipping: ${imageUrl}`);
                continue;
            }
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
            if (mimeType.includes('gif')) {
                try {
                    buffer = await sharp(buffer, { pages: 1 }).png().toBuffer();
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
    const availableProviders = imageCapableProviders.filter(p => {
        const disabledUntil = manager.disabledProviders.get(p.name);
        return !disabledUntil || disabledUntil <= Date.now();
    });
    if (availableProviders.length === 0 && imageCapableProviders.length > 0) {
        console.warn(
            `All ${imageCapableProviders.length} Ollama providers are temporarily disabled, clearing disabled state...`
        );
        for (const p of imageCapableProviders) {
            if (typeof manager.clearProviderCooldown === 'function') {
                manager.clearProviderCooldown(p.name);
            } else {
                manager.disabledProviders.delete(p.name);
            }
        }
    }
    for (const provider of imageCapableProviders) {
        const started = Date.now();
        const disabledUntil = manager.disabledProviders.get(provider.name);
        if (disabledUntil && disabledUntil > Date.now()) {continue;}
        console.log(
            `Attempting image request with ${provider.name} (${provider.model})[${base64Images.length} image(s)]`
        );
        try {
            if (provider.type === 'ollama') {
                const ollamaEndpoint = `${provider.baseURL}/chat`;
                const visionSystemPrompt = resolveSystemPrompt(systemPrompt, provider);
                const messages =[
                    { role: 'system', content: visionSystemPrompt },
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
                const headers = { 'Content-Type': 'application/json' };
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
            if (!error.transient) {
                if (typeof manager.setProviderCooldown === 'function') {
                    manager.setProviderCooldown(
                        provider.name,
                        Date.now() + 2 * 60 * 60 * 1000,
                        {
                            reason: 'image pipeline failure',
                            source: 'image-provider',
                            credentialGroup: provider.credentialGroup || null
                        }
                    );
                } else {
                    manager.disabledProviders.set(provider.name, Date.now() + 2 * 60 * 60 * 1000);
                }
            }
        }
    }
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
    benchProvider,
    executeGeneration,
    generateResponseWithImages,
    sanitizeAssistantMessage,
    extractOpenAICompatibleText,
    normalizeOpenAICompatibleError,
    normalizeGoogleError
};

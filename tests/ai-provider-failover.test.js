'use strict';

require('dotenv').config();

const test = require('node:test');
const assert = require('node:assert/strict');

const aiManagerSingleton = require('../src/services/ai-providers');
const execution = require('../src/services/ai-providers-execution');

function withManager(setup) {
    const manager = Object.create(Object.getPrototypeOf(aiManagerSingleton));
    Object.assign(manager, {
        providers: [],
        providerErrors: new Map(),
        metrics: new Map(),
        disabledProviders: new Map(),
        disabledProviderMeta: new Map(),
        roundRobinIndex: 0,
        sessionStickiness: new Map(),
        sessionStickinessMs: 60 * 1000,
        selectedProviderType: 'auto',
        openRouterGlobalFailure: false,
        openRouterFailureCount: 0,
        providerFailureCounts: new Map(),
        providerPoisonCounts: new Map(),
        stateSaveTimer: null,
        stateSaveDebounceMs: 5000,
        stateDirty: false,
        totalTokensIn: 0,
        totalTokensOut: 0,
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        activeRequests: 0,
        activeRequestsPeak: 0,
        loadConfig: {
            maxConcurrent: 20,
            softCap: 10,
            rejectThreshold: 30
        },
        saveState: async() => {},
        scheduleStateSave: () => {}
    });

    setup(manager);
    return manager;
}

test('same request benches a quota-exhausted Google credential group and fails open to auto', async() => {
    let googleCalls = 0;
    let groqCalls = 0;
    const manager = withManager((instance) => {
        instance.selectedProviderType = 'google';
        instance.providers = [
            {
                name: 'GoogleAI1-gemini-2.0-flash',
                family: 'google',
                type: 'google',
                model: 'gemini-2.0-flash',
                costTier: 'free',
                credentialGroup: 'google:1',
                client: {
                    getGenerativeModel() {
                        return {
                            async generateContent() {
                                googleCalls += 1;
                                throw new Error(
                                    '429 Too Many Requests. Quota exceeded. limit: 0. Please retry in 21s.'
                                );
                            }
                        };
                    }
                }
            },
            {
                name: 'GoogleAI1-gemma-4-31b-it',
                family: 'google',
                type: 'google',
                model: 'gemma-4-31b-it',
                costTier: 'free',
                credentialGroup: 'google:1',
                client: {
                    getGenerativeModel() {
                        return {
                            async generateContent() {
                                googleCalls += 1;
                                throw new Error('secondary google model should not be tried');
                            }
                        };
                    }
                }
            },
            {
                name: 'Groq1-llama-3.3-70b-versatile',
                family: 'groq',
                type: 'openai-chat',
                model: 'llama-3.3-70b-versatile',
                costTier: 'free',
                credentialGroup: 'groq:1',
                client: {
                    chat: {
                        completions: {
                            async create() {
                                groqCalls += 1;
                                return {
                                    choices: [
                                        {
                                            message: { content: 'Recovered through Groq.' },
                                            finish_reason: 'stop'
                                        }
                                    ],
                                    usage: {
                                        prompt_tokens: 11,
                                        completion_tokens: 7
                                    }
                                };
                            }
                        }
                    }
                }
            }
        ];
    });

    const response = await execution.executeGeneration(
        manager,
        'Stay concise.',
        'Test fallback.',
        1024
    );

    assert.equal(response.provider, 'Groq1-llama-3.3-70b-versatile');
    assert.equal(response.content, 'Recovered through Groq.');
    assert.equal(googleCalls, 1);
    assert.equal(groqCalls, 1);

    const flashCooldown = manager.getDisabledProviderMeta('GoogleAI1-gemini-2.0-flash');
    const gemmaCooldown = manager.getDisabledProviderMeta('GoogleAI1-gemma-4-31b-it');

    assert.equal(Boolean(flashCooldown?.disabledUntil > Date.now()), true);
    assert.equal(Boolean(gemmaCooldown?.disabledUntil > Date.now()), true);
    assert.equal(flashCooldown?.reason, 'quota unavailable for credential (daily limit reached)');
    assert.equal(flashCooldown?.source, 'provider-execution');
    assert.equal(flashCooldown?.credentialGroup, 'google:1');
    assert.equal(gemmaCooldown?.reason, 'quota unavailable for credential (daily limit reached)');
    assert.equal(gemmaCooldown?.source, 'provider-execution');

    const providerStatus = manager.getProviderStatus();
    const flashStatus = providerStatus.find(
        provider => provider.name === 'GoogleAI1-gemini-2.0-flash'
    );
    const gemmaStatus = providerStatus.find(
        provider => provider.name === 'GoogleAI1-gemma-4-31b-it'
    );

    assert.equal(flashStatus?.isDisabled, true);
    assert.equal(flashStatus?.disabledReason, 'quota unavailable for credential (daily limit reached)');
    assert.equal(flashStatus?.disabledSource, 'provider-execution');
    assert.equal(flashStatus?.credentialGroup, 'google:1');
    assert.equal(gemmaStatus?.isDisabled, true);
});

test('executeGeneration fails open to auto when the forced family is already disabled', async() => {
    let groqCalls = 0;
    const manager = withManager((instance) => {
        instance.selectedProviderType = 'google';
        instance.providers = [
            {
                name: 'GoogleAI1-gemini-2.0-flash',
                family: 'google',
                type: 'google',
                model: 'gemini-2.0-flash',
                costTier: 'free',
                credentialGroup: 'google:1',
                client: {
                    getGenerativeModel() {
                        return {
                            async generateContent() {
                                throw new Error('disabled provider should not run');
                            }
                        };
                    }
                }
            },
            {
                name: 'Groq1-llama-3.3-70b-versatile',
                family: 'groq',
                type: 'openai-chat',
                model: 'llama-3.3-70b-versatile',
                costTier: 'free',
                credentialGroup: 'groq:1',
                client: {
                    chat: {
                        completions: {
                            async create() {
                                groqCalls += 1;
                                return {
                                    choices: [
                                        {
                                            message: { content: 'Forced family failed open.' },
                                            finish_reason: 'stop'
                                        }
                                    ],
                                    usage: {
                                        prompt_tokens: 9,
                                        completion_tokens: 6
                                    }
                                };
                            }
                        }
                    }
                }
            }
        ];
        instance.setProviderCooldown(
            'GoogleAI1-gemini-2.0-flash',
            Date.now() + 60_000,
            {
                reason: 'manual test cooldown',
                source: 'test-suite',
                credentialGroup: 'google:1'
            }
        );
    });

    const response = await execution.executeGeneration(
        manager,
        'Stay concise.',
        'Test forced-family fail-open.',
        1024
    );

    assert.equal(response.provider, 'Groq1-llama-3.3-70b-versatile');
    assert.equal(response.content, 'Forced family failed open.');
    assert.equal(groqCalls, 1);
});

test('executeGeneration stops once the total failover budget is exhausted', async() => {
    let slowCalls = 0;
    let backupCalls = 0;
    const manager = withManager((instance) => {
        instance.requestBudgetMs = 950;
        instance.providers = [
            {
                name: 'Cerebras1-qwen-3-235b-a22b-instruct-2507',
                family: 'cerebras',
                type: 'openai-chat',
                model: 'qwen-3-235b-a22b-instruct-2507',
                costTier: 'free',
                credentialGroup: 'cerebras:1',
                attemptTimeoutMs: 400,
                client: {
                    chat: {
                        completions: {
                            async create() {
                                slowCalls += 1;
                                return new Promise(resolve => {
                                    setTimeout(() => resolve({
                                        choices: [
                                            {
                                                message: { content: 'Too late.' },
                                                finish_reason: 'stop'
                                            }
                                        ],
                                        usage: {
                                            prompt_tokens: 10,
                                            completion_tokens: 4
                                        }
                                    }), 1000);
                                });
                            }
                        }
                    }
                }
            },
            {
                name: 'Cerebras2-qwen-3-235b-a22b-instruct-2507',
                family: 'cerebras',
                type: 'openai-chat',
                model: 'qwen-3-235b-a22b-instruct-2507',
                costTier: 'free',
                credentialGroup: 'cerebras:2',
                attemptTimeoutMs: 400,
                client: {
                    chat: {
                        completions: {
                            async create() {
                                slowCalls += 1;
                                return new Promise(resolve => {
                                    setTimeout(() => resolve({
                                        choices: [
                                            {
                                                message: { content: 'Too late.' },
                                                finish_reason: 'stop'
                                            }
                                        ],
                                        usage: {
                                            prompt_tokens: 10,
                                            completion_tokens: 4
                                        }
                                    }), 1000);
                                });
                            }
                        }
                    }
                }
            },
            {
                name: 'Cerebras3-qwen-3-235b-a22b-instruct-2507',
                family: 'cerebras',
                type: 'openai-chat',
                model: 'qwen-3-235b-a22b-instruct-2507',
                costTier: 'free',
                credentialGroup: 'cerebras:3',
                client: {
                    chat: {
                        completions: {
                            async create() {
                                backupCalls += 1;
                                return {
                                    choices: [
                                        {
                                            message: { content: 'Should not be reached.' },
                                            finish_reason: 'stop'
                                        }
                                    ],
                                    usage: {
                                        prompt_tokens: 10,
                                        completion_tokens: 4
                                    }
                                };
                            }
                        }
                    }
                }
            }
        ];
    });

    const started = Date.now();

    await assert.rejects(
        execution.executeGeneration(
            manager,
            'Stay concise.',
            'Budget exhaustion test.',
            1024
        ),
        /failover budget exhausted/i
    );

    const elapsed = Date.now() - started;

    assert.equal(slowCalls, 2);
    assert.equal(backupCalls, 0);
    assert.equal(elapsed < 1500, true);
});

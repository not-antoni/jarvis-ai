'use strict';

require('dotenv').config();

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    extractOpenAICompatibleText,
    normalizeGoogleError,
    normalizeOpenAICompatibleError
} = require('../src/services/ai-providers-execution');

test('normalizeOpenAICompatibleError infers 429 status from provider-style error message', () => {
    const error = new Error('429 Provider returned error');
    const normalized = normalizeOpenAICompatibleError(error, 'OpenRouter1-nemotron');

    assert.equal(normalized.status, 429);
    assert.equal(normalized.code, 429);
    assert.equal(normalized.transient, true);
});

test('normalizeOpenAICompatibleError preserves explicit non-retryable status', () => {
    const error = Object.assign(new Error('OpenRouter rejected the request'), { status: 400 });
    const normalized = normalizeOpenAICompatibleError(error, 'OpenRouter1-nemotron');

    assert.equal(normalized.status, 400);
    assert.equal(normalized.transient, false);
});

test('extractOpenAICompatibleText joins structured content parts', () => {
    const text = extractOpenAICompatibleText({
        message: {
            content: [
                { type: 'output_text', text: 'first line' },
                { type: 'output_text', text: 'second line' }
            ]
        }
    });

    assert.equal(text, 'first line\nsecond line');
});

test('normalizeOpenAICompatibleError extracts retry delay metadata', () => {
    const error = new Error('429 Too Many Requests. Please retry in 21.2s.');
    const normalized = normalizeOpenAICompatibleError(error, 'OpenRouter1-gemma');

    assert.equal(normalized.status, 429);
    assert.equal(normalized.retryDelayMs, 21200);
    assert.equal(normalized.providerFault, true);
});

test('normalizeGoogleError marks thinking-mode mismatch as provider fault, not transient', () => {
    const error = new Error('Budget 0 is invalid. This model only works in thinking mode.');
    const normalized = normalizeGoogleError(error, 'GoogleAI1-gemini-3-pro-preview');

    assert.equal(normalized.status, 400);
    assert.equal(normalized.thinkingRequired, true);
    assert.equal(normalized.transient, false);
    assert.equal(normalized.providerFault, true);
});

test('normalizeGoogleError detects permanent quota exhaustion and retry delay', () => {
    const error = new Error('429 Too Many Requests. Quota exceeded. limit: 0. Please retry in 21s.');
    const normalized = normalizeGoogleError(error, 'GoogleAI1-gemini-2.0-flash');

    assert.equal(normalized.status, 429);
    assert.equal(normalized.quotaExhausted, true);
    assert.equal(normalized.permanentQuota, true);
    assert.equal(normalized.retryDelayMs, 21000);
});

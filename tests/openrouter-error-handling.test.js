'use strict';

require('dotenv').config();

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    extractOpenAICompatibleText,
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

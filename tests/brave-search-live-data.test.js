'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { detectSearchPlan, detectSearchIntent } = require('../src/services/brave-search');

// #259 follow-up: live financial / market data must trigger search so the
// model never hallucinates a price (the "800 BC gold price" bug).

test('detectSearchPlan — price/score/value queries trigger search via the general current-intent regex', () => {
    // We intentionally do NOT hardcode topic-specific keyword lists (gold,
    // silver, btc, …); the heuristic should trip on the *kind* of word
    // ("price", "rate", "score", "latest") so it generalises to any topic.
    for (const prompt of [
        'tell me gold price',
        'whats the silver price right now',
        'bitcoin price',
        'oil price today',
        'what is the inflation rate',
        'latest f1 results',
        'who has the highest score in the league',
        'cheapest flight to tokyo'
    ]) {
        const plan = detectSearchPlan(prompt);
        assert.ok(plan, `expected a search plan for "${prompt}"`);
        assert.equal(plan.currentIntent, true, `currentIntent should be true for "${prompt}"`);
    }
});

test('detectSearchPlan — generic chit-chat without live-data words stays null', () => {
    assert.equal(detectSearchPlan('how are you doing'), null);
    assert.equal(detectSearchPlan('tell me a joke'), null);
});

test('detectSearchIntent — surfaces a usable query for price prompts', () => {
    const intent = detectSearchIntent('tell me gold price');
    assert.ok(intent && /gold/i.test(intent), `expected gold-related intent, got ${intent}`);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { loopDetection } = require('../src/core/loop-detection');

test('no loop with fewer than 3 turns', () => {
    loopDetection.clearAll();
    loopDetection.recordTurn('u1', 'c1', 'hello');
    loopDetection.recordTurn('u1', 'c1', 'world');
    const result = loopDetection.checkForLoop('u1', 'c1');
    assert.equal(result.isLoop, false);
});

test('detects exact content repetition', () => {
    loopDetection.clearAll();
    for (let i = 0; i < 5; i++) {
        loopDetection.recordTurn('u2', 'c2', 'same message over and over');
    }
    const result = loopDetection.checkForLoop('u2', 'c2');
    assert.equal(result.isLoop, true);
    assert.equal(result.type, 'repetitive_content');
});

test('detects alternating pattern', () => {
    loopDetection.clearAll();
    // Use exactly 6 turns (3 cycles of A-B) which hits alternating threshold
    // but only 3 repetitions of each, below the repetitive_content threshold of 4
    const msgs = ['alpha one two three', 'beta four five six'];
    for (let i = 0; i < 6; i++) {
        loopDetection.recordTurn('u3', 'c3', msgs[i % 2]);
    }
    const result = loopDetection.checkForLoop('u3', 'c3');
    assert.equal(result.isLoop, true);
    assert.equal(result.type, 'alternating_pattern');
});

test('no false positive for varied conversation', () => {
    loopDetection.clearAll();
    const messages = [
        'Hey Jarvis, what is the weather?',
        'Can you tell me a joke?',
        'What time is it?',
        'Who won the game last night?',
        'Thanks for your help!'
    ];
    for (const msg of messages) {
        loopDetection.recordTurn('u4', 'c4', msg);
    }
    const result = loopDetection.checkForLoop('u4', 'c4');
    assert.equal(result.isLoop, false);
});

test('clearHistory removes user history', () => {
    loopDetection.clearAll();
    loopDetection.recordTurn('u5', 'c5', 'test');
    loopDetection.clearHistory('u5', 'c5');
    const result = loopDetection.checkForLoop('u5', 'c5');
    assert.equal(result.isLoop, false);
});

test('getRecoveryPrompt returns a string for each loop type', () => {
    const types = ['repetitive_content', 'alternating_pattern', 'semantic_loop', 'tool_call_loop'];
    for (const type of types) {
        const prompt = loopDetection.getRecoveryPrompt(type);
        assert.equal(typeof prompt, 'string');
        assert.ok(prompt.length > 0);
    }
});

test('getStats returns expected shape', () => {
    const stats = loopDetection.getStats();
    assert.equal(typeof stats.enabled, 'boolean');
    assert.equal(typeof stats.activeConversations, 'number');
    assert.equal(typeof stats.cachedResults, 'number');
});

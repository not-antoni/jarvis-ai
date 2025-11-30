/**
 * Tests for request ID utility
 */

const { test } = require('node:test');
const assert = require('node:assert');
const {
    generateRequestId,
    getRequestId,
    runWithRequestId
} = require('../../src/utils/request-id');

test('generateRequestId: Generates unique IDs', () => {
    const id1 = generateRequestId();
    const id2 = generateRequestId();
    
    assert.ok(id1.length > 0);
    assert.ok(id2.length > 0);
    assert.notStrictEqual(id1, id2);
});

test('generateRequestId: Valid format', () => {
    const id = generateRequestId();
    // Should be hex string (32 chars for 16 bytes)
    assert.ok(/^[0-9a-f]{32}$/.test(id));
});

test('runWithRequestId: Sets request ID in context', () => {
    const testId = 'test-request-123';
    let capturedId = null;
    
    runWithRequestId(testId, () => {
        capturedId = getRequestId();
    });
    
    assert.strictEqual(capturedId, testId);
});

test('runWithRequestId: Returns function result', () => {
    const result = runWithRequestId('test', () => {
        return 'test-result';
    });
    
    assert.strictEqual(result, 'test-result');
});


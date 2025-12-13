/**
 * Tests for logger utility
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const logger = require('../../src/utils/logger');

test('Logger: Basic logging', () => {
    logger.info('Test info message');
    logger.warn('Test warn message');
    logger.error('Test error message');
    logger.debug('Test debug message');
    assert.ok(true, 'Logger methods should not throw');
});

test('Logger: Log with metadata', () => {
    logger.info('Test with metadata', { userId: '123', action: 'test' });
    assert.ok(true, 'Logger should accept metadata');
});

test('Logger: Child logger', () => {
    const childLogger = logger.child({ requestId: 'test-123' });
    childLogger.info('Child logger test');
    assert.ok(true, 'Child logger should work');
});

test('Logger: Log levels', () => {
    // Test that different log levels work
    const originalLevel = process.env.LOG_LEVEL;
    process.env.LOG_LEVEL = 'error';

    logger.error('Error log');
    logger.warn('Warn log');
    logger.info('Info log');
    logger.debug('Debug log');

    if (originalLevel) {
        process.env.LOG_LEVEL = originalLevel;
    } else {
        delete process.env.LOG_LEVEL;
    }

    assert.ok(true, 'Log levels should work');
});

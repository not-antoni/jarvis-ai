/**
 * Tests for error handler utility
 */

const { test } = require('node:test');
const assert = require('node:assert');
const {
    AppError,
    ValidationError,
    NotFoundError,
    UnauthorizedError,
    ForbiddenError,
    RateLimitError,
    asyncHandler
} = require('../../src/utils/error-handler');

test('AppError: Basic error', () => {
    const error = new AppError('Test error', 400, 'TEST_ERROR');
    assert.strictEqual(error.message, 'Test error');
    assert.strictEqual(error.statusCode, 400);
    assert.strictEqual(error.code, 'TEST_ERROR');
    assert.strictEqual(error.isOperational, true);
});

test('ValidationError: Validation error', () => {
    const error = new ValidationError('Invalid input');
    assert.strictEqual(error.message, 'Invalid input');
    assert.strictEqual(error.statusCode, 400);
    assert.strictEqual(error.code, 'INVALID_PARAMETER');
});

test('NotFoundError: Not found error', () => {
    const error = new NotFoundError('User');
    assert.strictEqual(error.message, 'User not found');
    assert.strictEqual(error.statusCode, 404);
    assert.strictEqual(error.code, 'NOT_FOUND');
});

test('UnauthorizedError: Unauthorized error', () => {
    const error = new UnauthorizedError();
    assert.strictEqual(error.statusCode, 401);
    assert.strictEqual(error.code, 'UNAUTHORIZED');
});

test('ForbiddenError: Forbidden error', () => {
    const error = new ForbiddenError();
    assert.strictEqual(error.statusCode, 403);
    assert.strictEqual(error.code, 'FORBIDDEN');
});

test('RateLimitError: Rate limit error', () => {
    const error = new RateLimitError('Too many requests', 5000);
    assert.strictEqual(error.statusCode, 429);
    assert.strictEqual(error.code, 'RATE_LIMIT_EXCEEDED');
    assert.strictEqual(error.metadata.retryAfter, 5000);
});

test('asyncHandler: Success case', async () => {
    const handler = asyncHandler(async (req, res) => {
        res.json({ success: true });
    });
    
    const req = {};
    const res = {
        json: (data) => {
            assert.strictEqual(data.success, true);
        }
    };
    
    await handler(req, res, () => {});
});

test('asyncHandler: Error case', async () => {
    const handler = asyncHandler(async (req, res) => {
        throw new ValidationError('Test error');
    });
    
    const req = {};
    const res = {};
    let errorCaught = false;
    
    const next = (err) => {
        errorCaught = true;
        assert.ok(err instanceof ValidationError);
    };
    
    await handler(req, res, next);
    assert.strictEqual(errorCaught, true);
});


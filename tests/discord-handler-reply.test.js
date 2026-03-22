'use strict';

require('dotenv').config();

const test = require('node:test');
const assert = require('node:assert/strict');

const handler = require('../src/services/discord-handlers-impl');

test('replyToMessage falls back to channel.send when Discord rejects message_reference', async() => {
    let sentPayload = null;
    const message = {
        async reply() {
            const error = new Error('Invalid Form Body');
            error.code = 50035;
            error.rawError = {
                errors: {
                    message_reference: {
                        _errors: [{ code: 'BASE_TYPE_REQUIRED', message: 'Invalid message reference' }]
                    }
                }
            };
            throw error;
        },
        channel: {
            async send(payload) {
                sentPayload = payload;
                return payload;
            }
        }
    };

    const payload = { content: 'hello sir' };
    const result = await handler.replyToMessage(message, payload);

    assert.deepEqual(result, {
        content: 'hello sir',
        allowedMentions: { parse: [] }
    });
    assert.deepEqual(sentPayload, {
        content: 'hello sir',
        allowedMentions: { parse: [] }
    });
});

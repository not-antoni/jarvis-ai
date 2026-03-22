'use strict';

require('dotenv').config();

const test = require('node:test');
const assert = require('node:assert/strict');

const { isDjAdmin } = require('../src/utils/dj-system');

test('isDjAdmin does not throw when member.guild is unavailable', () => {
    const member = {
        id: 'user-1',
        guild: undefined,
        permissions: {
            has() {
                return false;
            }
        }
    };

    assert.equal(isDjAdmin(member, {}), false);
});

test('isDjAdmin falls back to guildConfig ownerId when guild is unavailable', () => {
    const member = {
        id: 'user-1',
        guild: undefined,
        permissions: {
            has() {
                return false;
            }
        }
    };

    assert.equal(isDjAdmin(member, { ownerId: 'user-1' }), true);
});

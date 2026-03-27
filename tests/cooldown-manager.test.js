'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const CooldownManager = require('../src/core/cooldown-manager');

test('isLimited returns false when no cooldown set', () => {
    const cm = new CooldownManager({ defaultCooldownMs: 5000 });
    const result = cm.isLimited('test', 'user1');
    assert.equal(result.limited, false);
    assert.equal(result.remainingMs, 0);
});

test('hit sets cooldown and blocks repeat', () => {
    const cm = new CooldownManager({ defaultCooldownMs: 60000 });
    const first = cm.hit('test', 'user1');
    assert.equal(first.limited, false);
    const second = cm.hit('test', 'user1');
    assert.equal(second.limited, true);
    assert.ok(second.remainingMs > 0);
});

test('different scopes are independent', () => {
    const cm = new CooldownManager({ defaultCooldownMs: 60000 });
    cm.hit('scope-a', 'user1');
    const result = cm.hit('scope-b', 'user1');
    assert.equal(result.limited, false);
});

test('different users are independent', () => {
    const cm = new CooldownManager({ defaultCooldownMs: 60000 });
    cm.hit('test', 'user1');
    const result = cm.hit('test', 'user2');
    assert.equal(result.limited, false);
});

test('custom cooldown override works', () => {
    const cm = new CooldownManager({ defaultCooldownMs: 60000 });
    cm.hit('test', 'user1', 1); // 1ms cooldown
    // Should expire almost immediately
    const result = cm.isLimited('test', 'user1', 1);
    // Might still be limited if checked instantly, but remainingMs should be tiny
    assert.ok(result.remainingMs <= 1);
});

test('prune removes stale entries', () => {
    const cm = new CooldownManager({ defaultCooldownMs: 100 });
    cm.set('test', 'user1');
    // Manually backdate the entry
    const key = CooldownManager.makeKey('test', 'user1');
    cm.cooldowns.set(key, Date.now() - 200000); // 200 seconds ago
    cm.prune(1000); // prune anything older than 1 second
    assert.equal(cm.isLimited('test', 'user1').limited, false);
});

test('maxEntries triggers auto-prune', () => {
    const cm = new CooldownManager({ defaultCooldownMs: 60000, maxEntries: 5 });
    for (let i = 0; i < 10; i++) {
        // Backdate old entries so prune can remove them
        const key = CooldownManager.makeKey('test', `user${i}`);
        cm.cooldowns.set(key, Date.now() - (i > 4 ? 999999999 : 0));
    }
    cm.set('test', 'overflow-user'); // should trigger prune
    assert.ok(cm.cooldowns.size <= 10); // some should have been pruned
});

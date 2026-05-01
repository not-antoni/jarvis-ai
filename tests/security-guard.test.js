'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

function loadGuardWithEnv(env) {
    // Reload the module with a fresh env so we exercise different configs.
    const path = require.resolve('../src/server/security-guard');
    delete require.cache[path];
    const previous = {};
    for (const key of Object.keys(env)) {
        previous[key] = process.env[key];
        if (env[key] === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = env[key];
        }
    }
    const mod = require('../src/server/security-guard');
    return {
        guard: mod.createSecurityGuard(),
        restore() {
            for (const key of Object.keys(previous)) {
                if (previous[key] === undefined) {
                    delete process.env[key];
                } else {
                    process.env[key] = previous[key];
                }
            }
        }
    };
}

function makeReq({ path = '/portal/api/me', headers = {}, ip = '203.0.113.45' } = {}) {
    return { path, headers, ip, socket: { remoteAddress: ip } };
}

function makeRes() {
    return {
        statusCode: null,
        ended: false,
        body: null,
        status(code) { this.statusCode = code; return this; },
        end(body) { this.ended = true; this.body = body || null; return this; }
    };
}

// ─── #265 ASN block ──────────────────────────────────────────────────────

test('ASN block - rejects requests from blocked AS numbers', () => {
    const { guard, restore } = loadGuardWithEnv({ BLOCKED_ASNS: '14061,16276' });
    let nextCalled = false;
    const res = makeRes();
    guard(makeReq({ headers: { 'cf-asn': '14061' } }), res, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
    restore();
});

test('ASN block - passes through allowed ASNs', () => {
    const { guard, restore } = loadGuardWithEnv({ BLOCKED_ASNS: '14061' });
    let nextCalled = false;
    const res = makeRes();
    guard(makeReq({ headers: { 'cf-asn': '13335' } }), res, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
    restore();
});

// ─── #266 IP whitelist ───────────────────────────────────────────────────

test('IP whitelist (soft mode) - public routes bypass the gate', () => {
    const { guard, restore } = loadGuardWithEnv({
        IP_WHITELIST: '10.0.0.0/8',
        IP_WHITELIST_MODE: 'soft'
    });
    let nextCalled = false;
    const res = makeRes();
    guard(
        makeReq({ path: '/', ip: '203.0.113.45', headers: { 'cf-connecting-ip': '203.0.113.45' } }),
        res,
        () => { nextCalled = true; }
    );
    assert.equal(nextCalled, true);
    restore();
});

test('IP whitelist (soft mode) - protected routes block non-whitelisted IPs', () => {
    const { guard, restore } = loadGuardWithEnv({
        IP_WHITELIST: '10.0.0.0/8',
        IP_WHITELIST_MODE: 'soft'
    });
    let nextCalled = false;
    const res = makeRes();
    guard(
        makeReq({ path: '/portal/api/me', headers: { 'cf-connecting-ip': '203.0.113.45' } }),
        res,
        () => { nextCalled = true; }
    );
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
    restore();
});

test('IP whitelist (soft mode) - protected routes allow whitelisted IPs', () => {
    const { guard, restore } = loadGuardWithEnv({
        IP_WHITELIST: '10.0.0.0/8',
        IP_WHITELIST_MODE: 'soft'
    });
    let nextCalled = false;
    const res = makeRes();
    guard(
        makeReq({ path: '/portal/api/me', headers: { 'cf-connecting-ip': '10.1.2.3' } }),
        res,
        () => { nextCalled = true; }
    );
    assert.equal(nextCalled, true);
    restore();
});

test('IP whitelist (strict mode) - public routes also enforced', () => {
    const { guard, restore } = loadGuardWithEnv({
        IP_WHITELIST: '10.0.0.0/8',
        IP_WHITELIST_MODE: 'strict'
    });
    let nextCalled = false;
    const res = makeRes();
    guard(
        makeReq({ path: '/', headers: { 'cf-connecting-ip': '203.0.113.45' } }),
        res,
        () => { nextCalled = true; }
    );
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
    restore();
});

test('Country block - rejects countries in blocklist', () => {
    const { guard, restore } = loadGuardWithEnv({ BLOCKED_COUNTRIES: 'ru,kp' });
    let nextCalled = false;
    const res = makeRes();
    guard(makeReq({ headers: { 'cf-ipcountry': 'RU' } }), res, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
    restore();
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { __testing } = require('../src/services/cloudflare-domain');

test.afterEach(() => {
    __testing.resetDnsRefreshState();
});

test('classifies IPv4, IPv6, and host targets correctly', () => {
    assert.equal(__testing.detectDnsRecordType('203.0.113.10'), 'A');
    assert.equal(__testing.detectDnsRecordType('2001:db8::10'), 'AAAA');
    assert.equal(__testing.detectDnsRecordType('[2001:db8::10]:3000'), 'AAAA');
    assert.equal(__testing.detectDnsRecordType('jarvis.example.com'), 'CNAME');
    assert.equal(__testing.extractHostname('http://[2001:db8::10]:3000'), '2001:db8::10');
    assert.equal(__testing.extractHostname('jarvis.example.com:3000'), 'jarvis.example.com');
});

test('refreshDnsRecords updates A and AAAA independently', async() => {
    const calls = [];
    const logger = {
        log() {},
        warn() {}
    };
    const responses = {
        A: '198.51.100.10',
        AAAA: '2001:db8::10'
    };

    async function runRefresh() {
        await __testing.refreshDnsRecords({
            config: {
                domain: 'example.com',
                zoneId: 'zone_123'
            },
            authHeaders: {
                Authorization: 'Bearer test-token'
            },
            logger,
            resolvePublicIp: async(recordType) => responses[recordType] || null,
            upsertDnsRecord: async(name, type, content, options) => {
                calls.push({
                    name,
                    type,
                    content,
                    proxied: options.proxied
                });
            }
        });
    }

    await runRefresh();

    assert.deepEqual(calls, [
        { name: 'example.com', type: 'A', content: '198.51.100.10', proxied: true },
        { name: 'www.example.com', type: 'A', content: '198.51.100.10', proxied: true },
        { name: 'example.com', type: 'AAAA', content: '2001:db8::10', proxied: true },
        { name: 'www.example.com', type: 'AAAA', content: '2001:db8::10', proxied: true }
    ]);

    calls.length = 0;
    await runRefresh();
    assert.equal(calls.length, 0);

    responses.AAAA = '2001:db8::11';
    await runRefresh();

    assert.deepEqual(calls, [
        { name: 'example.com', type: 'AAAA', content: '2001:db8::11', proxied: true },
        { name: 'www.example.com', type: 'AAAA', content: '2001:db8::11', proxied: true }
    ]);
});

process.env.DISCORD_TOKEN = process.env.DISCORD_TOKEN || 'test-token';
process.env.MONGO_URI_MAIN = process.env.MONGO_URI_MAIN || 'mongodb://localhost:27017/jarvis-ai';
process.env.MONGO_URI_VAULT = process.env.MONGO_URI_VAULT || 'mongodb://localhost:27017/jarvis-vault';
process.env.MASTER_KEY_BASE64 =
    process.env.MASTER_KEY_BASE64 || Buffer.alloc(32, 1).toString('base64');
process.env.VAULT_CACHE_TTL_MS = process.env.VAULT_CACHE_TTL_MS || '120000';

const test = require('node:test');
const assert = require('node:assert/strict');

const vaultClient = require('../src/services/vault-client');
const {
    __dangerouslySetCollectionsForTests,
    __resetCachesForTests
} = vaultClient;
const { createVaultTestCollections } = require('./helpers/inMemoryVaultCollections');

test.after(() => {
    __dangerouslySetCollectionsForTests(null);
    __resetCachesForTests();
});

test('encrypt, store, decrypt flow maintains fidelity and cache reset', async () => {
    __resetCachesForTests();
    __dangerouslySetCollectionsForTests(createVaultTestCollections());

    const userId = 'user-flow';
    await vaultClient.registerUserKey(userId);

    const firstPayload = {
        userName: 'Tony',
        userMessage: 'Hello Jarvis',
        jarvisResponse: 'At your service, sir.',
        timestamp: new Date().toISOString()
    };

    await vaultClient.encryptMemory(userId, firstPayload);

    const firstDecrypt = await vaultClient.decryptMemories(userId, { limit: 5 });
    assert.equal(firstDecrypt.length, 1);
    assert.equal(firstDecrypt[0].data.userMessage, firstPayload.userMessage);
    assert.equal(firstDecrypt[0].data.jarvisResponse, firstPayload.jarvisResponse);

    const secondPayload = {
        ...firstPayload,
        userMessage: 'Status update',
        jarvisResponse: 'All systems nominal.',
        timestamp: new Date().toISOString()
    };

    await vaultClient.encryptMemory(userId, secondPayload);

    const secondDecrypt = await vaultClient.decryptMemories(userId, { limit: 5 });
    assert.equal(secondDecrypt.length, 2);
    assert.equal(secondDecrypt[0].data.userMessage, secondPayload.userMessage);
    assert.equal(secondDecrypt[0].data.jarvisResponse, secondPayload.jarvisResponse);

    await vaultClient.purgeUserMemories(userId);
    const afterPurge = await vaultClient.decryptMemories(userId, { limit: 5 });
    assert.equal(afterPurge.length, 0);
});

test('decrypt under concurrent load stays below one second', async () => {
    __resetCachesForTests();
    __dangerouslySetCollectionsForTests(createVaultTestCollections());

    const userId = 'user-load';
    await vaultClient.registerUserKey(userId);

    for (let i = 0; i < 12; i += 1) {
        await vaultClient.encryptMemory(userId, {
            userName: 'Tony',
            userMessage: `Message ${i}`,
            jarvisResponse: `Response ${i}`,
            timestamp: new Date().toISOString()
        });
    }

    const start = process.hrtime.bigint();
    await Promise.all(
        Array.from({ length: 100 }, () =>
            vaultClient.decryptMemories(userId, { limit: 12 })
        )
    );
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;

    assert.ok(
        durationMs < 1000,
        `Decrypt operations took ${durationMs.toFixed(2)}ms; expected < 1000ms`
    );
});

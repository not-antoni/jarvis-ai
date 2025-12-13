const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DISCORD_TOKEN = process.env.DISCORD_TOKEN || 'test-token';
process.env.MONGO_URI_MAIN = process.env.MONGO_URI_MAIN || 'mongodb://localhost:27017/test';
process.env.MONGO_URI_VAULT = process.env.MONGO_URI_VAULT || 'mongodb://localhost:27017/test_vault';
process.env.MASTER_KEY_BASE64 =
    process.env.MASTER_KEY_BASE64 || Buffer.alloc(32).toString('base64');

const databaseSingleton = require('../src/services/database');
const DatabaseManager = databaseSingleton.constructor;
const config = require('../config');
const vaultClient = require('../src/services/vault-client');

function createManager() {
    const manager = new DatabaseManager();
    manager.isConnected = true;
    return manager;
}

test('updateGuildFeatures updates individual flags without clobbering other fields', async () => {
    const manager = createManager();

    const existingDoc = {
        _id: 'doc-1',
        guildId: 'guild-1',
        ownerId: 'owner',
        features: { memeTools: true, funUtilities: false },
        moderatorRoleIds: ['123'],
        moderatorUserIds: [],
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        updatedAt: new Date('2024-01-02T00:00:00.000Z')
    };

    const updateCalls = [];

    const mockCollection = {
        findOne: async filter => {
            assert.deepEqual(filter, { guildId: 'guild-1' });
            return existingDoc;
        },
        updateOne: async (filter, update) => {
            updateCalls.push({ filter, update });
        }
    };

    manager.db = {
        collection: () => mockCollection
    };

    let returnedConfig = null;
    manager.getGuildConfig = async () => {
        returnedConfig = { guildId: 'guild-1' };
        return returnedConfig;
    };

    await manager.updateGuildFeatures('guild-1', { funUtilities: true, memeTools: false });

    assert.equal(updateCalls.length, 1);
    const { filter, update } = updateCalls[0];
    assert.deepEqual(filter, { guildId: 'guild-1' });
    assert.ok(update.$set);
    assert.equal(update.$set['features.funUtilities'], true);
    assert.equal(update.$set['features.memeTools'], false);
    assert.ok(update.$set.updatedAt instanceof Date);
    assert.strictEqual(update.$set.features, undefined);
    assert.strictEqual(returnedConfig.guildId, 'guild-1');
});

test('updateGuildFeatures inserts new guild config with defaults', async () => {
    const manager = createManager();
    const inserted = [];

    const mockCollection = {
        findOne: async () => null,
        insertOne: async doc => {
            inserted.push(doc);
            return { insertedId: 'doc-new' };
        }
    };

    manager.db = { collection: () => mockCollection };

    let returnedConfig = null;
    manager.getGuildConfig = async () => {
        returnedConfig = { guildId: 'guild-new' };
        return returnedConfig;
    };

    await manager.updateGuildFeatures('guild-new', { funUtilities: true });

    assert.equal(inserted.length, 1);
    const doc = inserted[0];
    assert.equal(doc.guildId, 'guild-new');
    assert.ok(doc.createdAt instanceof Date);
    assert.ok(doc.updatedAt instanceof Date);

    const defaults = manager.getDefaultFeatureFlags();
    for (const [key, value] of Object.entries(defaults)) {
        assert.equal(typeof doc.features[key], 'boolean');
        assert.equal(doc.features[key], Boolean(value));
    }

    assert.strictEqual(returnedConfig.guildId, 'guild-new');
});

test('clearUserMemories deletes conversations and vault records', async () => {
    const manager = createManager();
    const conversationsCollectionName = config.database.collections.conversations;

    let deleteManyCalled = false;
    manager.db = {
        collection: name => {
            assert.equal(name, conversationsCollectionName);
            return {
                deleteMany: async filter => {
                    deleteManyCalled = true;
                    assert.deepEqual(filter, { userId: 'user-42' });
                }
            };
        }
    };

    const originalPurge = vaultClient.purgeUserMemories;
    let purgeCalled = false;
    vaultClient.purgeUserMemories = async userId => {
        purgeCalled = true;
        assert.equal(userId, 'user-42');
    };

    try {
        await manager.clearUserMemories('user-42');
        assert.ok(deleteManyCalled, 'expected conversations.deleteMany to be called');
        assert.ok(purgeCalled, 'expected vaultClient.purgeUserMemories to be called');
    } finally {
        vaultClient.purgeUserMemories = originalPurge;
    }
});

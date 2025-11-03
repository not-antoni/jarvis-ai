const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DISCORD_TOKEN = process.env.DISCORD_TOKEN || 'test-token';
process.env.MONGO_URI_MAIN = process.env.MONGO_URI_MAIN || 'mongodb://localhost:27017/test';
process.env.MONGO_URI_VAULT = process.env.MONGO_URI_VAULT || 'mongodb://localhost:27017/test_vault';
process.env.MASTER_KEY_BASE64 = process.env.MASTER_KEY_BASE64 || Buffer.alloc(32).toString('base64');

const databaseSingleton = require('../database');
const DatabaseManager = databaseSingleton.constructor;

function createManager() {
    const manager = new DatabaseManager();
    manager.isConnected = true;
    return manager;
}

test('updateGuildFeatures merges defaults and normalises economy config', async () => {
    const manager = createManager();

    const existingDoc = {
        _id: 'doc-1',
        guildId: 'guild-1',
        ownerId: 'owner',
        features: { memeTools: true, funUtilities: false, economy: false },
        moderatorRoleIds: ['123'],
        moderatorUserIds: [],
        economyConfig: { channelIds: ['111', 222, '111'] },
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        updatedAt: new Date('2024-01-02T00:00:00.000Z')
    };

    const replaceCalls = [];

    const mockCollection = {
        findOne: async (filter) => {
            assert.deepEqual(filter, { guildId: 'guild-1' });
            return existingDoc;
        },
        replaceOne: async (filter, doc, options) => {
            replaceCalls.push({ filter, doc, options });
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

    await manager.updateGuildFeatures('guild-1', { economy: true, memeTools: false });

    assert.equal(replaceCalls.length, 1);
    const { filter, doc, options } = replaceCalls[0];

    assert.deepEqual(filter, { guildId: 'guild-1' });
    assert.equal(options.upsert, true);
    assert.equal(doc.guildId, 'guild-1');
    assert.ok(doc.updatedAt instanceof Date);
    assert.equal(doc.createdAt.toISOString(), existingDoc.createdAt.toISOString());

    assert.equal(doc.features.economy, true);
    assert.equal(doc.features.memeTools, false);
    assert.equal(doc.features.funUtilities, false);

    assert.deepEqual(doc.economyConfig.channelIds, ['111', '222']);
    assert.deepEqual(doc.moderatorRoleIds, existingDoc.moderatorRoleIds);
    assert.strictEqual(returnedConfig.guildId, 'guild-1');
});

test('incrementXpUser inserts new profile and applies xp delta', async () => {
    const manager = createManager();

    const insertedDocs = [];

    const mockCollection = {
        findOne: async () => null,
        insertOne: async (doc) => {
            insertedDocs.push({ ...doc });
            return { insertedId: 'xp-doc-1' };
        },
        findOneAndUpdate: async () => {
            throw new Error('findOneAndUpdate should not be called when inserting');
        },
        updateOne: async () => {
            throw new Error('updateOne should not be called when inserting');
        }
    };

    manager.db = { collection: () => mockCollection };

    const lastMessage = new Date('2024-02-01T00:00:00.000Z');
    const result = await manager.incrementXpUser('guild', 'user', { xpDelta: 25, lastMessageAt: lastMessage });

    assert.equal(insertedDocs.length, 1);
    const inserted = insertedDocs[0];
    assert.equal(inserted.guildId, 'guild');
    assert.equal(inserted.userId, 'user');
    assert.equal(inserted.xp, 25);
    assert.equal(inserted.lastMsgAt.toISOString(), lastMessage.toISOString());
    assert.ok(inserted.updatedAt instanceof Date);
    assert.equal(result._id, 'xp-doc-1');
    assert.equal(result.xp, 25);
});

test('incrementXpUser updates existing profile and clamps negative totals', async () => {
    const manager = createManager();

    const existingDoc = {
        _id: 'xp-doc-2',
        guildId: 'guild',
        userId: 'user',
        xp: 5,
        lastMsgAt: null,
        joinedVoiceAt: null,
        level: 0
    };

    let updateArgs = null;
    let clampArgs = null;

    const updatedDoc = {
        ...existingDoc,
        xp: -3,
        updatedAt: new Date('2024-03-01T00:00:00.000Z')
    };

    const mockCollection = {
        findOne: async () => existingDoc,
        findOneAndUpdate: async (filter, update) => {
            updateArgs = { filter, update };
            return { value: updatedDoc };
        },
        updateOne: async (filter, update) => {
            clampArgs = { filter, update };
            return { acknowledged: true };
        },
        insertOne: async () => {
            throw new Error('insertOne should not be called for existing doc');
        }
    };

    manager.db = { collection: () => mockCollection };

    const result = await manager.incrementXpUser('guild', 'user', { xpDelta: -10 });

    assert.ok(updateArgs);
    assert.deepEqual(updateArgs.filter, { guildId: 'guild', userId: 'user' });
    assert.ok(updateArgs.update.$set.updatedAt instanceof Date);
    assert.deepEqual(updateArgs.update.$inc, { xp: -10 });

    assert.ok(clampArgs);
    assert.deepEqual(clampArgs.filter, { _id: updatedDoc._id });
    assert.deepEqual(clampArgs.update, { $set: { xp: 0 } });
    assert.equal(result.xp, 0);
});

test('incrementXpUser handles duplicate insert race by retrying update', async () => {
    const manager = createManager();

    const updatedDoc = {
        _id: 'xp-doc-3',
        guildId: 'guild',
        userId: 'user',
        xp: 10,
        updatedAt: new Date('2024-03-02T00:00:00.000Z')
    };

    let updateCallCount = 0;

    const mockCollection = {
        findOne: async () => null,
        insertOne: async () => {
            const error = new Error('duplicate key');
            error.code = 11000;
            throw error;
        },
        findOneAndUpdate: async (filter, update) => {
            updateCallCount += 1;
            assert.deepEqual(filter, { guildId: 'guild', userId: 'user' });
            assert.deepEqual(update.$inc, { xp: 10 });
            return { value: updatedDoc };
        },
        updateOne: async () => ({ acknowledged: true })
    };

    manager.db = { collection: () => mockCollection };

    const result = await manager.incrementXpUser('guild', 'user', { xpDelta: 10 });
    assert.equal(updateCallCount, 1);
    assert.equal(result.xp, 10);
});

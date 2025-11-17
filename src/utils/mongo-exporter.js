const fs = require('fs');
const path = require('path');
const database = require('../../database');
const config = require('../../config');

async function ensureConnected() {
    if (!database.isConnected) {
        await database.connect();
    }
    return database.db;
}

function safeCreateDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

async function exportAllCollections({
    outDir = path.join(__dirname, '..', '..', 'data', 'mongo-exports'),
    collections = [],
    filenamePrefix = 'mongo-export'
} = {}) {
    const db = await ensureConnected();
    const targetCollections = collections.length
        ? collections
        : Object.values(config.database.collections || {});

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    safeCreateDir(outDir);
    const exportFile = path.join(outDir, `${filenamePrefix}-${timestamp}.json`);

    const payload = {};

    for (const collName of targetCollections) {
        if (!collName) continue;
        const coll = db.collection(collName);
        const docs = await coll.find({}).toArray();
        payload[collName] = docs;
    }

    fs.writeFileSync(exportFile, JSON.stringify(payload, null, 2));
    return exportFile;
}

module.exports = {
    exportAllCollections
};

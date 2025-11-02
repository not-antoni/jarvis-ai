#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const config = require('../config');
const database = require('../database');

const dumpRoot = path.resolve(__dirname, '..', 'backups', 'nightly');

function ensureDirectory(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function formatTimestamp(date = new Date()) {
    const year = String(date.getUTCFullYear());
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const hours = String(date.getUTCHours()).padStart(2, '0');
    const minutes = String(date.getUTCMinutes()).padStart(2, '0');
    return `${year}${month}${day}_${hours}${minutes}`;
}

function serializeDocument(document) {
    const serialized = { ...document };
    if (serialized._id && typeof serialized._id === 'object' && serialized._id.toString) {
        serialized._id = serialized._id.toString();
    }
    return serialized;
}

async function dumpCollection(db, collectionName, outputDir, timestamp) {
    const collection = db.collection(collectionName);
    const filePath = path.join(outputDir, `${collectionName}-${timestamp}.jsonl`);
    const stream = fs.createWriteStream(filePath, { flags: 'w' });

    let count = 0;

    try {
        const cursor = collection.find({}, { noCursorTimeout: true });
        for await (const document of cursor) {
            stream.write(`${JSON.stringify(serializeDocument(document))}\n`);
            count += 1;
        }
    } finally {
        stream.end();
    }

    console.log(`Dumped ${count} document${count === 1 ? '' : 's'} from ${collectionName}`);
}

async function runDump() {
    await database.connect();
    const db = database.db;
    ensureDirectory(dumpRoot);

    const timestamp = formatTimestamp();
    const runDir = path.join(dumpRoot, timestamp);
    ensureDirectory(runDir);

    const collectionNames = Object.values(config.database.collections);

    for (const name of collectionNames) {
        try {
            await dumpCollection(db, name, runDir, timestamp);
        } catch (error) {
            console.error(`Failed to dump collection ${name}:`, error);
        }
    }

    console.log(`Nightly dump completed at ${runDir}`);
    await database.disconnect();
}

runDump().catch(async (error) => {
    console.error('Nightly dump failed:', error);
    try {
        await database.disconnect();
    } catch (disconnectError) {
        console.error('Failed to disconnect after dump error:', disconnectError);
    }
    process.exit(1);
});


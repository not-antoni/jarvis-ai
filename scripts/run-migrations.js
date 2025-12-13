#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const config = require('../config');
const database = require('../database');

const migrationsDir = path.resolve(__dirname, '..', 'migrations');
const migrationCollectionName = config.database.collections.migrations;

async function loadMigrationFiles() {
    if (!fs.existsSync(migrationsDir)) {
        return [];
    }

    return fs
        .readdirSync(migrationsDir)
        .filter(file => file.endsWith('.js'))
        .sort();
}

async function run() {
    await database.connect();
    const db = database.db;
    const migrationsCollection = db.collection(migrationCollectionName);

    const applied = await migrationsCollection.find({}, { projection: { id: 1 } }).toArray();

    const appliedSet = new Set(applied.map(doc => doc.id));
    const files = await loadMigrationFiles();

    if (!files.length) {
        console.log('No migration files found.');
        return;
    }

    let appliedCount = 0;

    for (const file of files) {
        const migrationPath = path.join(migrationsDir, file);
        // Clear require cache to allow reruns during development
        delete require.cache[migrationPath];

        const migration = require(migrationPath);
        const migrationId = migration.id || path.basename(file, '.js');
        const description = migration.description || '';

        if (appliedSet.has(migrationId)) {
            console.log(`Skipping ${migrationId} (already applied)`);
            continue;
        }

        if (typeof migration.up !== 'function') {
            throw new Error(`Migration ${migrationId} is missing an up() handler.`);
        }

        const logger = (...messages) => {
            console.log(`[${migrationId}]`, ...messages);
        };

        console.log(`Applying ${migrationId}${description ? ` — ${description}` : ''}`);

        await migration.up({ db, database, config, logger });
        await migrationsCollection.insertOne({
            id: migrationId,
            file,
            description: description || null,
            appliedAt: new Date()
        });

        appliedSet.add(migrationId);
        appliedCount += 1;
    }

    if (appliedCount === 0) {
        console.log('Database already up to date.');
    } else {
        console.log(`Applied ${appliedCount} migration${appliedCount === 1 ? '' : 's'}.`);
    }
}

(async () => {
    try {
        await run();
        await database.disconnect();
        process.exit(0);
    } catch (error) {
        console.error('Migration runner failed:', error);
        try {
            await database.disconnect();
        } catch (disconnectError) {
            console.error('Failed to disconnect from database after error:', disconnectError);
        }
        process.exit(1);
    }
})();

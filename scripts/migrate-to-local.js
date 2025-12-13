#!/usr/bin/env node
/**
 * MongoDB Migration Script - Clone Render cluster to local
 *
 * Usage:
 *   node scripts/migrate-to-local.js                    # Export from Render MongoDB to JSON
 *   node scripts/migrate-to-local.js --to-local-mongo   # Export + import to local MongoDB
 *   node scripts/migrate-to-local.js --import           # Import from JSON exports to local-db
 *   node scripts/migrate-to-local.js --check            # Check migration status
 *   node scripts/migrate-to-local.js --clone            # Full clone: Render → Local MongoDB
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
const localdb = require('../src/localdb');
const config = require('../config');

const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    cyan: '\x1b[36m',
    dim: '\x1b[2m',
    bright: '\x1b[1m'
};

const log = {
    info: msg => console.log(`${colors.cyan}ℹ${colors.reset} ${msg}`),
    success: msg => console.log(`${colors.green}✓${colors.reset} ${msg}`),
    warn: msg => console.log(`${colors.yellow}!${colors.reset} ${msg}`),
    error: msg => console.log(`${colors.red}✗${colors.reset} ${msg}`),
    step: msg => console.log(`${colors.dim}→${colors.reset} ${msg}`),
    header: msg => console.log(`\n${colors.bright}${colors.cyan}━━━ ${msg} ━━━${colors.reset}\n`)
};

// Collections to migrate
const COLLECTIONS = Object.values(config.database.collections);

// Local MongoDB default URI
const LOCAL_MONGO_URI = process.env.LOCAL_MONGO_URI || 'mongodb://localhost:27017';
const LOCAL_DB_NAME = process.env.LOCAL_MONGO_DB_NAME || 'jarvis_local';
const LOCAL_VAULT_DB_NAME =
    process.env.LOCAL_MONGO_VAULT_DB_NAME ||
    process.env.LOCAL_MONGO_DB_VAULT_NAME ||
    process.env.MONGO_DB_VAULT_NAME ||
    'jarvis_vault';
const BACKUPS_DIR = path.join(localdb.DATA_DIR, 'backups');

/**
 * Create a backup of current local data before any destructive operation
 * Returns the backup path or null if nothing to backup
 */
function backupLocalData() {
    const localDir = localdb.LOCAL_DIR;

    if (!fs.existsSync(localDir)) {
        return null; // Nothing to backup
    }

    const files = fs.readdirSync(localDir).filter(f => f.endsWith('.json'));
    if (files.length === 0) {
        return null;
    }

    // Count total docs to see if backup is worth it
    let totalDocs = 0;
    for (const file of files) {
        try {
            const docs = JSON.parse(fs.readFileSync(path.join(localDir, file), 'utf8'));
            totalDocs += docs.length || 0;
        } catch (e) {
            /* ignore */
        }
    }

    if (totalDocs === 0) {
        return null;
    }

    // Create backup
    fs.mkdirSync(BACKUPS_DIR, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = path.join(BACKUPS_DIR, `backup-${timestamp}`);
    fs.mkdirSync(backupDir, { recursive: true });

    for (const file of files) {
        const src = path.join(localDir, file);
        const dest = path.join(backupDir, file);
        fs.copyFileSync(src, dest);
    }

    // Write backup metadata
    const meta = {
        createdAt: new Date().toISOString(),
        totalDocs,
        collections: files.map(f => f.replace('.json', '')),
        reason: 'pre-sync backup'
    };
    fs.writeFileSync(path.join(backupDir, '_meta.json'), JSON.stringify(meta, null, 2));

    log.success(`Backed up ${totalDocs} documents to: ${path.basename(backupDir)}`);
    return backupDir;
}

/**
 * List available backups
 */
function listBackups() {
    if (!fs.existsSync(BACKUPS_DIR)) return [];

    return fs
        .readdirSync(BACKUPS_DIR)
        .filter(d => d.startsWith('backup-'))
        .map(d => {
            const metaPath = path.join(BACKUPS_DIR, d, '_meta.json');
            let meta = {};
            try {
                meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
            } catch (e) {
                /* ignore */
            }
            return { name: d, path: path.join(BACKUPS_DIR, d), ...meta };
        })
        .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

/**
 * Restore from a backup
 */
function restoreFromBackup(backupPath) {
    if (!fs.existsSync(backupPath)) {
        log.error(`Backup not found: ${backupPath}`);
        return false;
    }

    const files = fs.readdirSync(backupPath).filter(f => f.endsWith('.json') && f !== '_meta.json');
    if (files.length === 0) {
        log.error('Backup is empty');
        return false;
    }

    fs.mkdirSync(localdb.LOCAL_DIR, { recursive: true });

    for (const file of files) {
        const src = path.join(backupPath, file);
        const dest = path.join(localdb.LOCAL_DIR, file);
        fs.copyFileSync(src, dest);
    }

    log.success(`Restored ${files.length} collections from backup`);
    return true;
}

/**
 * Clean old backups, keep last N
 */
function cleanOldBackups(keepCount = 5) {
    const backups = listBackups();
    if (backups.length <= keepCount) return;

    const toDelete = backups.slice(keepCount);
    for (const backup of toDelete) {
        try {
            fs.rmSync(backup.path, { recursive: true, force: true });
            log.step(`Cleaned old backup: ${backup.name}`);
        } catch (e) {
            /* ignore */
        }
    }
}

/**
 * Deep serialize a document (handle ObjectIds, Dates, etc)
 */
function serializeDoc(doc) {
    if (!doc || typeof doc !== 'object') return doc;

    if (Array.isArray(doc)) {
        return doc.map(serializeDoc);
    }

    const result = {};
    for (const [key, value] of Object.entries(doc)) {
        if (value === null || value === undefined) {
            result[key] = value;
        } else if (
            value._bsontype === 'ObjectId' ||
            (typeof value.toString === 'function' && key === '_id')
        ) {
            result[key] = value.toString();
        } else if (value instanceof Date) {
            result[key] = { $date: value.toISOString() };
        } else if (typeof value === 'object') {
            result[key] = serializeDoc(value);
        } else {
            result[key] = value;
        }
    }
    return result;
}

/**
 * Deserialize a document (restore ObjectIds, Dates)
 */
function deserializeDoc(doc) {
    if (!doc || typeof doc !== 'object') return doc;

    if (Array.isArray(doc)) {
        return doc.map(deserializeDoc);
    }

    const { ObjectId } = require('mongodb');
    const result = {};

    for (const [key, value] of Object.entries(doc)) {
        if (value === null || value === undefined) {
            result[key] = value;
        } else if (key === '_id' && typeof value === 'string' && value.length === 24) {
            try {
                result[key] = new ObjectId(value);
            } catch {
                result[key] = value;
            }
        } else if (value && typeof value === 'object' && value.$date) {
            result[key] = new Date(value.$date);
        } else if (typeof value === 'object') {
            result[key] = deserializeDoc(value);
        } else {
            result[key] = value;
        }
    }
    return result;
}

/**
 * Export from Render MongoDB to JSON files
 */
async function exportFromMongo() {
    const mongoUri = process.env.MONGO_URI_MAIN;

    if (!mongoUri) {
        log.error('MONGO_URI_MAIN not set. Cannot export from MongoDB.');
        log.info('Set your Render MongoDB URI in .env file first.');
        return null;
    }

    log.header('Exporting from Render MongoDB');
    log.info(`Connecting to remote cluster...`);

    const client = new MongoClient(mongoUri, {
        serverSelectionTimeoutMS: 15000
    });

    try {
        await client.connect();
        const dbName = process.env.MONGO_DB_MAIN_NAME || 'jarvis_ai';
        const db = client.db(dbName);

        log.success(`Connected to: ${dbName}`);

        // Create export directory
        const exportDir = localdb.EXPORTS_DIR;
        fs.mkdirSync(exportDir, { recursive: true });

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const exportFile = path.join(exportDir, `render-export-${timestamp}.json`);
        const exportData = {};

        let totalDocs = 0;

        for (const collName of COLLECTIONS) {
            log.step(`Exporting ${collName}...`);
            try {
                const docs = await db.collection(collName).find({}).toArray();
                const serialized = docs.map(serializeDoc);
                exportData[collName] = serialized;
                totalDocs += docs.length;
                log.success(`  ${collName}: ${docs.length} documents`);
            } catch (err) {
                log.warn(`  ${collName}: ${err.message}`);
                exportData[collName] = [];
            }
        }

        // Also export vault if available
        if (process.env.MONGO_URI_VAULT) {
            log.step('Exporting vault collections...');
            try {
                const vaultClient = new MongoClient(process.env.MONGO_URI_VAULT, {
                    serverSelectionTimeoutMS: 10000
                });
                await vaultClient.connect();
                const vaultDbName = process.env.MONGO_DB_VAULT_NAME || 'jarvis_vault';
                const vaultDb = vaultClient.db(vaultDbName);

                for (const collName of Object.values(config.database.vaultCollections || {})) {
                    try {
                        const docs = await vaultDb.collection(collName).find({}).toArray();
                        const serialized = docs.map(serializeDoc);
                        exportData[`vault_${collName}`] = serialized;
                        totalDocs += docs.length;
                        log.success(`  vault/${collName}: ${docs.length} documents`);
                    } catch (err) {
                        log.warn(`  vault/${collName}: ${err.message}`);
                    }
                }
                await vaultClient.close();
            } catch (err) {
                log.warn(`Vault export skipped: ${err.message}`);
            }
        }

        // Write export file
        fs.writeFileSync(exportFile, JSON.stringify(exportData, null, 2));
        log.success(`\nExported ${totalDocs} total documents to:`);
        log.info(`  ${exportFile}`);

        return { exportFile, exportData, totalDocs };
    } catch (error) {
        log.error(`MongoDB connection failed: ${error.message}`);
        return null;
    } finally {
        await client.close();
    }
}

/**
 * Import JSON export to local MongoDB
 */
async function importToLocalMongo(exportData) {
    log.header('Importing to Local MongoDB');
    log.info(`Connecting to ${LOCAL_MONGO_URI}...`);

    const client = new MongoClient(LOCAL_MONGO_URI, {
        serverSelectionTimeoutMS: 5000
    });

    try {
        await client.connect();
        const db = client.db(LOCAL_DB_NAME);
        const vaultDb = client.db(LOCAL_VAULT_DB_NAME);

        log.success(`Connected to local database: ${LOCAL_DB_NAME}`);

        let totalImported = 0;

        for (const [collName, docs] of Object.entries(exportData)) {
            if (!docs || docs.length === 0) continue;

            const isVaultCollection = collName.startsWith('vault_');
            const targetDb = isVaultCollection ? vaultDb : db;
            const targetName = isVaultCollection ? collName.slice('vault_'.length) : collName;

            log.step(`Importing ${isVaultCollection ? `vault/${targetName}` : targetName}...`);

            try {
                // Drop existing collection to do clean import
                try {
                    await targetDb.collection(targetName).drop();
                } catch (e) {
                    // Collection might not exist, that's fine
                }

                // Deserialize and insert
                const deserialized = docs.map(deserializeDoc);

                if (deserialized.length > 0) {
                    await targetDb
                        .collection(targetName)
                        .insertMany(deserialized, { ordered: false });
                }

                totalImported += docs.length;
                log.success(
                    `  ${isVaultCollection ? `vault/${targetName}` : targetName}: ${docs.length} documents`
                );
            } catch (err) {
                log.error(
                    `  ${isVaultCollection ? `vault/${targetName}` : targetName}: ${err.message}`
                );
            }
        }

        log.success(`\nImported ${totalImported} documents to local MongoDB`);
        log.info(`Database: ${LOCAL_DB_NAME}`);

        return true;
    } catch (error) {
        log.error(`Local MongoDB connection failed: ${error.message}`);
        log.info('\nMake sure MongoDB is running locally:');
        log.step('Windows: net start MongoDB');
        log.step('Mac/Linux: brew services start mongodb-community');
        log.step('Docker: docker run -d -p 27017:27017 mongo');
        return false;
    } finally {
        await client.close();
    }
}

/**
 * Sync export to JSON local-db (file-based)
 * ALWAYS backs up existing data first to prevent data loss
 */
async function syncToLocalJsonDb(exportData, skipBackup = false) {
    log.header('Syncing to Local JSON Database');

    // ALWAYS backup before overwriting (unless explicitly skipped for first-time setup)
    if (!skipBackup) {
        const backupPath = backupLocalData();
        if (backupPath) {
            log.info(`Safety backup created - your data is safe!`);
        }
        // Clean old backups (keep last 5)
        cleanOldBackups(5);
    }

    let totalSynced = 0;

    const vaultUserKeys = exportData.vault_vaultUserKeys || exportData.vaultUserKeys || [];
    const vaultMemories = exportData.vault_vaultMemories || exportData.vaultMemories || [];

    for (const [collName, docs] of Object.entries(exportData)) {
        if (!docs || docs.length === 0) continue;
        if (collName.startsWith('vault_')) continue; // Vault handled separately

        log.step(`Writing ${collName}...`);
        localdb.writeCollection(collName, docs);
        totalSynced += docs.length;
        log.success(`  ${collName}: ${docs.length} documents`);
    }

    if (vaultUserKeys.length || vaultMemories.length) {
        try {
            const local = localdb.loadLocalDb();
            if (!local.vault) local.vault = {};

            if (vaultUserKeys.length) {
                local.vault.userKeys = vaultUserKeys.map(deserializeDoc);
            }
            if (vaultMemories.length) {
                local.vault.memories = vaultMemories.map(deserializeDoc);
            }

            localdb.saveLocalDb(local);
            log.success(`  vault: ${vaultUserKeys.length + vaultMemories.length} documents`);
        } catch (e) {
            log.warn(`  vault: ${e.message}`);
        }
    }

    log.success(`\nSynced ${totalSynced} documents to local JSON database`);
    log.info(`Location: ${localdb.LOCAL_DIR}`);

    return true;
}

async function importFromExports() {
    log.info('Importing from latest export...');

    const result = localdb.syncFromLatestExport();

    if (!result) {
        log.error('No exports found in ' + localdb.EXPORTS_DIR);
        log.info('Run this script without --import first to export from MongoDB');
        return false;
    }

    log.success(`Imported from: ${result.latest}`);
    log.success(`Collections: ${result.collections.join(', ')}`);
    return true;
}

/**
 * Load export from JSON file
 */
function loadExportFile(filepath) {
    if (!fs.existsSync(filepath)) {
        log.error(`Export file not found: ${filepath}`);
        return null;
    }

    try {
        const data = JSON.parse(fs.readFileSync(filepath, 'utf8'));
        return data;
    } catch (err) {
        log.error(`Failed to parse export: ${err.message}`);
        return null;
    }
}

async function checkMigrationStatus() {
    log.header('Migration Status Check');

    // Check Render MongoDB connection
    const mongoUri = process.env.MONGO_URI_MAIN;
    log.info(`Render MongoDB: ${mongoUri ? 'CONFIGURED' : 'NOT SET'}`);

    if (mongoUri) {
        try {
            const client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 5000 });
            await client.connect();
            await client.db().command({ ping: 1 });
            log.success('  → Connection: OK');
            await client.close();
        } catch (e) {
            log.error(`  → Connection: ${e.message}`);
        }
    }

    // Check local MongoDB connection
    log.info(`\nLocal MongoDB: ${LOCAL_MONGO_URI}`);
    try {
        const client = new MongoClient(LOCAL_MONGO_URI, { serverSelectionTimeoutMS: 3000 });
        await client.connect();
        await client.db().command({ ping: 1 });
        log.success('  → Connection: OK');

        // Check if local DB has data
        const db = client.db(LOCAL_DB_NAME);
        const collections = await db.listCollections().toArray();
        if (collections.length > 0) {
            log.info(`  → Database '${LOCAL_DB_NAME}' has ${collections.length} collections`);
            for (const coll of collections.slice(0, 5)) {
                const count = await db.collection(coll.name).countDocuments();
                log.step(`    ${coll.name}: ${count} docs`);
            }
            if (collections.length > 5) {
                log.step(`    ... and ${collections.length - 5} more`);
            }
        }
        await client.close();
    } catch (e) {
        log.warn('  → Connection: Not running (this is fine for JSON-only mode)');
    }

    // Check exports
    const exports = localdb.listExports();
    log.info(`\nJSON Export files: ${exports.length}`);
    if (exports.length > 0) {
        const latest = exports[0];
        log.step(`Latest: ${path.basename(latest)}`);

        // Show what's in the latest export
        const data = loadExportFile(latest);
        if (data) {
            const totalDocs = Object.values(data).reduce((sum, arr) => sum + (arr?.length || 0), 0);
            log.step(
                `Contains: ${totalDocs} documents across ${Object.keys(data).length} collections`
            );
        }
    }

    // Check local-db (JSON files)
    log.info('\nLocal JSON database:');
    const localDir = localdb.LOCAL_DIR;
    if (fs.existsSync(localDir)) {
        const files = fs.readdirSync(localDir).filter(f => f.endsWith('.json'));
        if (files.length > 0) {
            let totalLocal = 0;
            for (const file of files) {
                const collName = file.replace('.json', '');
                const docs = localdb.readCollection(collName);
                totalLocal += docs.length;
                log.step(`  ${collName}: ${docs.length} docs`);
            }
            log.success(`  Total: ${totalLocal} documents`);
        } else {
            log.warn('  No collections found');
        }
    } else {
        log.warn('  Directory not created yet');
    }

    // Check backups
    const backups = listBackups();
    log.info(`\nSafety backups: ${backups.length}`);
    if (backups.length > 0) {
        for (const backup of backups.slice(0, 3)) {
            log.step(`  ${backup.name} (${backup.totalDocs || '?'} docs)`);
        }
        if (backups.length > 3) {
            log.step(`  ... and ${backups.length - 3} more`);
        }
    }

    // Check environment
    log.info('\nEnvironment settings:');
    log.step(`LOCAL_DB_MODE: ${process.env.LOCAL_DB_MODE || 'not set'}`);
    log.step(`SELFHOST_MODE: ${process.env.SELFHOST_MODE || 'not set'}`);
    log.step(`DEPLOY_TARGET: ${process.env.DEPLOY_TARGET || 'render (default)'}`);
    log.step(`LOCAL_MONGO_URI: ${process.env.LOCAL_MONGO_URI || LOCAL_MONGO_URI + ' (default)'}`);

    log.header('Recommendations');

    if (!mongoUri) {
        log.warn('Set MONGO_URI_MAIN to export data from your Render database');
    } else if (exports.length === 0) {
        log.info('Run: node scripts/migrate-to-local.js');
        log.info('This will export MongoDB data for local use');
    } else {
        log.success('You have exports ready!');
        log.info('Options:');
        log.step('Use JSON-only mode: set LOCAL_DB_MODE=1');
        log.step('Use local MongoDB: run with --clone or --to-local-mongo');
    }

    if (backups.length > 0) {
        log.info('\nIf you need to restore from backup:');
        log.step('node scripts/migrate-to-local.js --restore');
    }
}

function printHelp() {
    console.log(`
${colors.bright}Usage:${colors.reset}
  node scripts/migrate-to-local.js [options]

${colors.bright}Options:${colors.reset}
  ${colors.cyan}(no args)${colors.reset}        Export Render MongoDB to JSON + sync to local JSON DB
  ${colors.cyan}--clone${colors.reset}          Full clone: Render → JSON → Local MongoDB  
  ${colors.cyan}--to-local-mongo${colors.reset} Import latest JSON export to local MongoDB
  ${colors.cyan}--import${colors.reset}         Import latest export to local JSON database
  ${colors.cyan}--check${colors.reset}          Check migration status
  ${colors.cyan}--restore${colors.reset}        Restore local DB from a backup (interactive)
  ${colors.cyan}--backups${colors.reset}        List all available backups
  ${colors.cyan}--help${colors.reset}           Show this help

${colors.bright}Safety Features:${colors.reset}
  • ${colors.green}Auto-backup${colors.reset}: Before ANY sync, your local data is backed up
  • ${colors.green}5 backups kept${colors.reset}: Old backups auto-cleaned to save space
  • ${colors.green}Restore anytime${colors.reset}: If you accidentally overwrite, just restore

${colors.bright}Environment Variables:${colors.reset}
  MONGO_URI_MAIN      Your Render MongoDB connection string
  LOCAL_MONGO_URI     Local MongoDB URI (default: mongodb://localhost:27017)
  LOCAL_MONGO_DB_NAME Local database name (default: jarvis_local)
  LOCAL_DB_MODE       Set to 1 to use local JSON database

${colors.bright}Examples:${colors.reset}
  # Export from Render and save locally (backs up first!)
  node scripts/migrate-to-local.js

  # Full clone to local MongoDB
  node scripts/migrate-to-local.js --clone

  # Oops! Restore from backup
  node scripts/migrate-to-local.js --restore

  # Check what's been migrated
  node scripts/migrate-to-local.js --check
`);
}

// Main
async function main() {
    const args = process.argv.slice(2);

    console.log(`
${colors.cyan}╔══════════════════════════════════════════════════════╗
║       Jarvis AI - MongoDB Migration Tool             ║
║   Clone Render cluster to local for self-hosting     ║
╚══════════════════════════════════════════════════════╝${colors.reset}
`);

    if (args.includes('--help') || args.includes('-h')) {
        printHelp();
        return;
    }

    if (args.includes('--check')) {
        await checkMigrationStatus();
        return;
    }

    if (args.includes('--backups')) {
        const backups = listBackups();
        if (backups.length === 0) {
            log.warn('No backups found');
        } else {
            log.header('Available Backups');
            for (let i = 0; i < backups.length; i++) {
                const b = backups[i];
                console.log(`  ${colors.cyan}[${i + 1}]${colors.reset} ${b.name}`);
                log.step(`    Created: ${b.createdAt || 'unknown'}`);
                log.step(`    Documents: ${b.totalDocs || 'unknown'}`);
                log.step(`    Collections: ${b.collections?.join(', ') || 'unknown'}`);
            }
        }
        return;
    }

    if (args.includes('--restore')) {
        const backups = listBackups();
        if (backups.length === 0) {
            log.error('No backups found to restore from');
            process.exit(1);
        }

        log.header('Available Backups');
        for (let i = 0; i < backups.length; i++) {
            const b = backups[i];
            console.log(
                `  ${colors.cyan}[${i + 1}]${colors.reset} ${b.name} - ${b.totalDocs || '?'} docs`
            );
        }

        // Use latest by default in non-interactive mode
        const latestBackup = backups[0];
        log.info(`\nRestoring from latest backup: ${latestBackup.name}`);

        // Backup current state first (before restore)
        backupLocalData();

        const success = restoreFromBackup(latestBackup.path);
        if (success) {
            log.header('Restore Complete!');
            log.success(`Restored from: ${latestBackup.name}`);
        }
        return;
    }

    if (args.includes('--import')) {
        await importFromExports();
        return;
    }

    if (args.includes('--clone')) {
        // Full clone: Render → JSON → Local MongoDB
        log.info('Starting full clone: Render → Local MongoDB\n');

        const result = await exportFromMongo();
        if (!result) {
            log.error('Export failed, aborting clone');
            process.exit(1);
        }

        // Also sync to JSON db as backup
        await syncToLocalJsonDb(result.exportData);

        // Import to local MongoDB
        const imported = await importToLocalMongo(result.exportData);
        if (!imported) {
            log.warn('\nLocal MongoDB import failed, but JSON export is available');
            log.info('You can run in LOCAL_DB_MODE=1 to use JSON database');
        } else {
            log.header('Clone Complete!');
            log.success('Your Render data is now in local MongoDB');
            log.info('\nTo use local MongoDB, update your .env:');
            log.step(`MONGO_URI_MAIN=${LOCAL_MONGO_URI}`);
            log.step(`MONGO_DB_MAIN_NAME=${LOCAL_DB_NAME}`);
            log.step(`MONGO_URI_VAULT=${LOCAL_MONGO_URI}`);
            log.step(`MONGO_DB_VAULT_NAME=${LOCAL_VAULT_DB_NAME}`);
            log.step('SELFHOST_MODE=1');
        }
        return;
    }

    if (args.includes('--to-local-mongo')) {
        // Import from existing export to local MongoDB
        const exports = localdb.listExports();
        if (exports.length === 0) {
            log.error('No export files found. Run without --to-local-mongo first.');
            process.exit(1);
        }

        const latest = exports[0];
        log.info(`Loading: ${path.basename(latest)}`);
        const data = loadExportFile(latest);

        if (!data) {
            process.exit(1);
        }

        await importToLocalMongo(data);
        return;
    }

    // Default: Export from Render + sync to JSON
    const result = await exportFromMongo();
    if (result) {
        await syncToLocalJsonDb(result.exportData);

        log.header('Export Complete!');
        log.info('Next steps:');
        log.step('To use JSON local-db: set LOCAL_DB_MODE=1 in .env');
        log.step('To use local MongoDB: run with --clone');
    }
}

main().catch(console.error);

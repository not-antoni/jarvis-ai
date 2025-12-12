/**
 * Data Sync Service - Robust Database Handler
 * 
 * Features:
 * - MongoDB ↔ Local file migration
 * - Automatic fallback when MongoDB unavailable
 * - Data export/import for backups
 * - Connection failure recovery
 * - Keeps both storages in sync when possible
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../../data');
const SYNC_STATE_FILE = path.join(DATA_DIR, 'sync-state.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Track sync state
let syncState = {
    lastMongoSync: null,
    lastLocalSync: null,
    pendingChanges: [],
    mongoAvailable: false
};

// Load sync state
try {
    if (fs.existsSync(SYNC_STATE_FILE)) {
        syncState = { ...syncState, ...JSON.parse(fs.readFileSync(SYNC_STATE_FILE, 'utf8')) };
    }
} catch (e) {
    console.warn('[DataSync] Failed to load sync state:', e.message);
}

/**
 * Save sync state to disk
 */
function saveSyncState() {
    try {
        fs.writeFileSync(SYNC_STATE_FILE, JSON.stringify(syncState, null, 2));
    } catch (e) {
        console.error('[DataSync] Failed to save sync state:', e.message);
    }
}

/**
 * Get local file path for a collection
 */
function getLocalPath(collectionName) {
    return path.join(DATA_DIR, `${collectionName}.json`);
}

/**
 * Read from local storage
 */
function readLocal(collectionName) {
    try {
        const filePath = getLocalPath(collectionName);
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
    } catch (e) {
        console.error(`[DataSync] Failed to read local ${collectionName}:`, e.message);
    }
    return null;
}

/**
 * Write to local storage
 */
function writeLocal(collectionName, data) {
    try {
        const filePath = getLocalPath(collectionName);
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        syncState.lastLocalSync = new Date().toISOString();
        saveSyncState();
        return true;
    } catch (e) {
        console.error(`[DataSync] Failed to write local ${collectionName}:`, e.message);
        return false;
    }
}

/**
 * Check if MongoDB is available
 */
async function checkMongoConnection() {
    try {
        const database = require('./database');
        if (database?.isConnected) {
            syncState.mongoAvailable = true;
            return true;
        }
    } catch (e) {
        // MongoDB not available
    }
    syncState.mongoAvailable = false;
    return false;
}

/**
 * Read from MongoDB
 */
async function readMongo(collectionName) {
    try {
        const database = require('./database');
        if (!database?.isConnected) return null;
        
        const collection = database.getCollection(collectionName);
        if (!collection) return null;
        
        const docs = await collection.find({}).toArray();
        return docs;
    } catch (e) {
        console.error(`[DataSync] Failed to read MongoDB ${collectionName}:`, e.message);
        return null;
    }
}

/**
 * Write to MongoDB
 */
async function writeMongo(collectionName, data) {
    try {
        const database = require('./database');
        if (!database?.isConnected) return false;
        
        const collection = database.getCollection(collectionName);
        if (!collection) return false;
        
        // For array of documents
        if (Array.isArray(data)) {
            // Clear and reinsert
            await collection.deleteMany({});
            if (data.length > 0) {
                await collection.insertMany(data);
            }
        } else {
            // For single document with _id
            await collection.replaceOne(
                { _id: data._id || 'default' },
                data,
                { upsert: true }
            );
        }
        
        syncState.lastMongoSync = new Date().toISOString();
        saveSyncState();
        return true;
    } catch (e) {
        console.error(`[DataSync] Failed to write MongoDB ${collectionName}:`, e.message);
        return false;
    }
}

/**
 * Sync data from MongoDB to local storage
 * Call this when switching to selfhost mode
 */
async function syncMongoToLocal(collectionName) {
    console.log(`[DataSync] Syncing ${collectionName} from MongoDB to local...`);
    
    const mongoData = await readMongo(collectionName);
    if (mongoData === null) {
        console.log(`[DataSync] No MongoDB data found for ${collectionName}`);
        return false;
    }
    
    const success = writeLocal(collectionName, mongoData);
    if (success) {
        console.log(`[DataSync] Successfully synced ${collectionName} to local storage`);
    }
    return success;
}

/**
 * Sync data from local storage to MongoDB
 * Call this when switching back to production
 */
async function syncLocalToMongo(collectionName) {
    console.log(`[DataSync] Syncing ${collectionName} from local to MongoDB...`);
    
    const localData = readLocal(collectionName);
    if (localData === null) {
        console.log(`[DataSync] No local data found for ${collectionName}`);
        return false;
    }
    
    const success = await writeMongo(collectionName, localData);
    if (success) {
        console.log(`[DataSync] Successfully synced ${collectionName} to MongoDB`);
    }
    return success;
}

/**
 * Smart read - tries MongoDB first, falls back to local
 * Also syncs data if one source is newer
 */
async function smartRead(collectionName, preferLocal = false) {
    const mongoAvailable = await checkMongoConnection();
    
    if (preferLocal || !mongoAvailable) {
        // Read from local
        const localData = readLocal(collectionName);
        
        // If we have local data and MongoDB becomes available, sync to MongoDB
        if (localData && mongoAvailable) {
            // Check if local is newer
            const mongoData = await readMongo(collectionName);
            if (!mongoData || mongoData.length === 0) {
                // MongoDB empty, sync local to it
                await writeMongo(collectionName, localData);
            }
        }
        
        return localData;
    }
    
    // Read from MongoDB
    const mongoData = await readMongo(collectionName);
    
    // Also write to local as backup
    if (mongoData) {
        writeLocal(collectionName, mongoData);
    } else {
        // MongoDB empty, check local
        const localData = readLocal(collectionName);
        if (localData) {
            return localData;
        }
    }
    
    return mongoData;
}

/**
 * Smart write - writes to both if possible
 */
async function smartWrite(collectionName, data) {
    const mongoAvailable = await checkMongoConnection();
    
    // Always write to local as backup
    const localSuccess = writeLocal(collectionName, data);
    
    if (mongoAvailable) {
        const mongoSuccess = await writeMongo(collectionName, data);
        return mongoSuccess && localSuccess;
    }
    
    // Queue for later sync if MongoDB unavailable
    if (!mongoAvailable && localSuccess) {
        syncState.pendingChanges.push({
            collection: collectionName,
            timestamp: new Date().toISOString()
        });
        saveSyncState();
    }
    
    return localSuccess;
}

/**
 * Sync all pending changes to MongoDB when connection restored
 */
async function syncPendingChanges() {
    if (syncState.pendingChanges.length === 0) return;
    
    const mongoAvailable = await checkMongoConnection();
    if (!mongoAvailable) return;
    
    console.log(`[DataSync] Syncing ${syncState.pendingChanges.length} pending changes to MongoDB...`);
    
    const collections = [...new Set(syncState.pendingChanges.map(c => c.collection))];
    
    for (const collectionName of collections) {
        await syncLocalToMongo(collectionName);
    }
    
    syncState.pendingChanges = [];
    saveSyncState();
    
    console.log('[DataSync] All pending changes synced');
}

/**
 * Full database export to local files
 */
async function exportAllToLocal() {
    const collections = [
        'guildModeration',
        'moderatorAuth',
        'guildSettings',
        'userProfiles',
        'economy'
    ];
    
    console.log('[DataSync] Exporting all MongoDB data to local...');
    
    let success = 0;
    for (const collection of collections) {
        if (await syncMongoToLocal(collection)) {
            success++;
        }
    }
    
    console.log(`[DataSync] Exported ${success}/${collections.length} collections`);
    return success;
}

/**
 * Full database import from local files
 */
async function importAllFromLocal() {
    const collections = [
        'guildModeration',
        'moderatorAuth',
        'guildSettings',
        'userProfiles',
        'economy'
    ];
    
    console.log('[DataSync] Importing all local data to MongoDB...');
    
    let success = 0;
    for (const collection of collections) {
        if (await syncLocalToMongo(collection)) {
            success++;
        }
    }
    
    console.log(`[DataSync] Imported ${success}/${collections.length} collections`);
    return success;
}

/**
 * Get sync status for dashboard
 */
function getSyncStatus() {
    return {
        mongoAvailable: syncState.mongoAvailable,
        lastMongoSync: syncState.lastMongoSync,
        lastLocalSync: syncState.lastLocalSync,
        pendingChanges: syncState.pendingChanges.length,
        dataDir: DATA_DIR
    };
}

// Check MongoDB connection periodically and sync pending changes
setInterval(async () => {
    const wasAvailable = syncState.mongoAvailable;
    const isAvailable = await checkMongoConnection();
    
    // MongoDB just became available
    if (!wasAvailable && isAvailable) {
        console.log('[DataSync] MongoDB connection restored, syncing pending changes...');
        await syncPendingChanges();
    }
}, 60000); // Check every minute

module.exports = {
    readLocal,
    writeLocal,
    readMongo,
    writeMongo,
    syncMongoToLocal,
    syncLocalToMongo,
    smartRead,
    smartWrite,
    syncPendingChanges,
    exportAllToLocal,
    importAllFromLocal,
    getSyncStatus,
    checkMongoConnection,
    DATA_DIR
};

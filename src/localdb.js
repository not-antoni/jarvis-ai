const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const VAULT_DIR = path.join(DATA_DIR, 'vault');
const LOCAL_DB_FILE = path.join(DATA_DIR, 'local-db.json');
const LOCAL_DIR = path.join(DATA_DIR, 'collections');  // Per-collection JSON files
const EXPORTS_DIR = path.join(DATA_DIR, 'mongo-exports'); // MongoDB exports

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function loadLocalDb() {
    try {
        if (fs.existsSync(LOCAL_DB_FILE)) {
            const content = fs.readFileSync(LOCAL_DB_FILE, 'utf8');
            return JSON.parse(content);
        }
    } catch (error) {
        console.warn('Failed to load local DB:', error.message);
    }
    return { vault: { userKeys: [], memories: [] } };
}

function saveLocalDb(data) {
    try {
        ensureDir(DATA_DIR);
        fs.writeFileSync(LOCAL_DB_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
        console.warn('Failed to save local DB:', error.message);
    }
}

// Collection-based operations for migration
function readCollection(collName) {
    try {
        const filePath = path.join(LOCAL_DIR, `${collName}.json`);
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
    } catch (error) {
        console.warn(`Failed to read collection ${collName}:`, error.message);
    }
    return [];
}

function writeCollection(collName, docs) {
    try {
        ensureDir(LOCAL_DIR);
        const filePath = path.join(LOCAL_DIR, `${collName}.json`);
        fs.writeFileSync(filePath, JSON.stringify(docs, null, 2));
        return true;
    } catch (error) {
        console.warn(`Failed to write collection ${collName}:`, error.message);
        return false;
    }
}

function listExports() {
    try {
        if (!fs.existsSync(EXPORTS_DIR)) {
            return [];
        }
        return fs.readdirSync(EXPORTS_DIR)
            .filter(f => f.endsWith('.json'))
            .map(f => path.join(EXPORTS_DIR, f))
            .sort((a, b) => {
                // Sort by modification time, newest first
                const statA = fs.statSync(a);
                const statB = fs.statSync(b);
                return statB.mtime - statA.mtime;
            });
    } catch (error) {
        console.warn('Failed to list exports:', error.message);
        return [];
    }
}

function syncFromLatestExport() {
    try {
        const exportsDir = path.join(DATA_DIR, 'mongo-exports');
        if (!fs.existsSync(exportsDir)) {
            return null;
        }

        const files = fs.readdirSync(exportsDir)
            .filter(f => f.endsWith('.json'))
            .sort()
            .reverse();

        if (!files.length) {
            return null;
        }

        const latestFile = files[0];
        const exportPath = path.join(exportsDir, latestFile);
        const content = JSON.parse(fs.readFileSync(exportPath, 'utf8'));

        const normalizeExtendedJson = (value) => {
            if (value === null || value === undefined) return value;
            if (Array.isArray(value)) return value.map(normalizeExtendedJson);
            if (typeof value !== 'object') return value;

            if (Object.prototype.hasOwnProperty.call(value, '$date')) {
                return String(value.$date);
            }

            const out = {};
            for (const [k, v] of Object.entries(value)) {
                out[k] = normalizeExtendedJson(v);
            }
            return out;
        };

        const vaultUserKeysRaw = content.vaultUserKeys || content.vault_vaultUserKeys || [];
        const vaultMemoriesRaw = content.vaultMemories || content.vault_vaultMemories || [];

        const localDb = {
            vault: {
                userKeys: normalizeExtendedJson(vaultUserKeysRaw),
                memories: normalizeExtendedJson(vaultMemoriesRaw)
            },
            moderation: {
                filters: normalizeExtendedJson(content.moderationFilters || [])
            }
        };

        saveLocalDb(localDb);

        return {
            latest: latestFile,
            collections: Object.keys(content).filter(k => content[k]?.length > 0)
        };
    } catch (error) {
        console.warn('Failed to sync from export:', error.message);
        return null;
    }
}

// Vault operations for LOCAL_DB_MODE
const vaultOps = {
    async getUserKey(userId) {
        const db = loadLocalDb();
        return db.vault?.userKeys?.find(k => k.userId === userId) || null;
    },

    async saveUserKey(userId, keyData) {
        const db = loadLocalDb();
        if (!db.vault) db.vault = {};
        if (!db.vault.userKeys) db.vault.userKeys = [];

        const idx = db.vault.userKeys.findIndex(k => k.userId === userId);
        if (idx >= 0) {
            db.vault.userKeys[idx] = { userId, ...keyData, updatedAt: new Date().toISOString() };
        } else {
            db.vault.userKeys.push({ userId, ...keyData, createdAt: new Date().toISOString() });
        }

        saveLocalDb(db);
    },

    async getMemories(userId, limit = 100) {
        const db = loadLocalDb();
        return (db.vault?.memories || [])
            .filter(m => m.userId === userId)
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
            .slice(0, limit);
    },

    async saveMemory(userId, memoryData) {
        const db = loadLocalDb();
        if (!db.vault) db.vault = {};
        if (!db.vault.memories) db.vault.memories = [];

        db.vault.memories.push({
            userId,
            ...memoryData,
            createdAt: new Date().toISOString()
        });

        // Keep only last 500 memories per user
        const userMemories = db.vault.memories.filter(m => m.userId === userId);
        if (userMemories.length > 500) {
            const toDelete = userMemories.length - 500;
            db.vault.memories = db.vault.memories.filter(m => {
                if (m.userId === userId) {
                    const idx = userMemories.indexOf(m);
                    if (idx < toDelete) {
                        return false;
                    }
                }
                return true;
            });
        }

        saveLocalDb(db);
    },

    async clearMemories(userId) {
        const db = loadLocalDb();
        if (db.vault?.memories) {
            db.vault.memories = db.vault.memories.filter(m => m.userId !== userId);
        }
        saveLocalDb(db);
    }
};

module.exports = {
    // Paths
    DATA_DIR,
    LOCAL_DIR,
    EXPORTS_DIR,
    
    // Core functions
    loadLocalDb,
    saveLocalDb,
    syncFromLatestExport,
    
    // Collection-based operations
    readCollection,
    writeCollection,
    listExports,
    
    // Vault ops
    vaultOps
};

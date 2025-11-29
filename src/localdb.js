const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const VAULT_DIR = path.join(DATA_DIR, 'vault');
const LOCAL_DB_FILE = path.join(DATA_DIR, 'local-db.json');

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

        const localDb = {
            vault: {
                userKeys: content.vaultUserKeys || [],
                memories: content.vaultMemories || []
            },
            moderation: {
                filters: content.moderationFilters || []
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
    loadLocalDb,
    saveLocalDb,
    syncFromLatestExport,
    vaultOps
};

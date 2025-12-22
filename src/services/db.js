const { MongoClient } = require('mongodb');
const config = require('../../config');

const IS_RENDER = Boolean(process.env.RENDER || process.env.RENDER_SERVICE_ID || process.env.RENDER_EXTERNAL_URL);
const IS_SELFHOST = !IS_RENDER && (
    process.env.DEPLOY_TARGET === 'selfhost' ||
    process.env.SELFHOST_MODE === 'true'
);

// Connection monitoring for selfhost
let connectionMonitorInterval = null;
let lastConnectionCheck = 0;
const CONNECTION_CHECK_INTERVAL = 30 * 1000; // 30 seconds
const RECONNECT_DELAY = 5 * 1000; // 5 seconds
const LOCAL_DB_MODE =
    !IS_RENDER &&
    String(process.env.LOCAL_DB_MODE || process.env.ALLOW_START_WITHOUT_DB || '').toLowerCase() === '1';

const {
    database: {
        mainUri,
        vaultUri,
        names: { main: mainDbName, vault: vaultDbName }
    }
} = config;

if (!mainUri || !vaultUri) {
    if (!LOCAL_DB_MODE) {
        if (!mainUri) throw new Error('MONGO_URI_MAIN is not configured');
        if (!vaultUri) throw new Error('MONGO_URI_VAULT is not configured');
    }
}

// MongoDB connection options optimized for selfhost reliability
const mongoOptions = {
    maxPoolSize: IS_SELFHOST ? 10 : 25,  // Lower pool for selfhost (less resources)
    minPoolSize: IS_SELFHOST ? 1 : 2,
    serverSelectionTimeoutMS: IS_SELFHOST ? 10000 : 5000,  // Longer timeout for local MongoDB
    socketTimeoutMS: 45000,
    retryWrites: true,
    retryReads: true,
    // Auto-reconnect settings
    connectTimeoutMS: 10000,
    heartbeatFrequencyMS: IS_SELFHOST ? 10000 : 30000,  // More frequent heartbeats for selfhost
    maxIdleTimeMS: IS_SELFHOST ? 60000 : 120000  // Keep connections alive longer
};

const mainClient =
    !LOCAL_DB_MODE && mainUri
        ? new MongoClient(mainUri, mongoOptions)
        : null;

const vaultClient =
    !LOCAL_DB_MODE && vaultUri
        ? new MongoClient(vaultUri, { ...mongoOptions, maxPoolSize: IS_SELFHOST ? 5 : 20 })
        : null;

let mainDb = null;
let vaultDb = null;

let mainConnectPromise = null;
let vaultConnectPromise = null;

async function connectMain() {
    if (LOCAL_DB_MODE) {
        return null;
    }
    if (mainDb) {
        // Verify connection is still alive for selfhost
        if (IS_SELFHOST) {
            try {
                await mainClient.db('admin').command({ ping: 1 });
            } catch (pingErr) {
                console.warn('[DB] Main connection lost, reconnecting...');
                mainDb = null;
                mainConnectPromise = null;
            }
        }
        if (mainDb) return mainDb;
    }

    if (!mainConnectPromise) {
        mainConnectPromise = mainClient
            .connect()
            .then(client => {
                mainDb = client.db(mainDbName);
                console.log('[DB] Main database connected:', mainDbName);
                
                // Setup connection monitoring for selfhost
                if (IS_SELFHOST) {
                    setupConnectionMonitoring();
                }
                
                return mainDb;
            })
            .catch(error => {
                mainConnectPromise = null;
                console.error('[DB] Main connection failed:', error.message);
                throw error;
            });
    }

    return mainConnectPromise;
}

async function connectVault() {
    if (LOCAL_DB_MODE) {
        return null;
    }
    if (vaultDb) {
        return vaultDb;
    }

    if (!vaultConnectPromise) {
        vaultConnectPromise = vaultClient
            .connect()
            .then(client => {
                vaultDb = client.db(vaultDbName);
                return vaultDb;
            })
            .catch(error => {
                vaultConnectPromise = null;
                throw error;
            });
    }

    return vaultConnectPromise;
}

async function initializeDatabaseClients() {
    if (LOCAL_DB_MODE) {
        return { jarvisDB: null, vaultDB: null };
    }
    await Promise.all([connectMain(), connectVault()]);
    return { jarvisDB: mainDb, vaultDB: vaultDb };
}

function getJarvisDb() {
    if (LOCAL_DB_MODE) return null;
    if (!mainDb) {
        throw new Error(
            'Main database not connected. Call connectMain or initializeDatabaseClients first.'
        );
    }
    return mainDb;
}

function getVaultDb() {
    if (LOCAL_DB_MODE) return null;
    if (!vaultDb) {
        throw new Error(
            'Vault database not connected. Call connectVault or initializeDatabaseClients first.'
        );
    }
    return vaultDb;
}

async function closeMain() {
    if (mainClient) {
        await mainClient.close();
        mainDb = null;
        mainConnectPromise = null;
    }
}

async function closeVault() {
    if (vaultClient) {
        await vaultClient.close();
        vaultDb = null;
        vaultConnectPromise = null;
    }
}

/**
 * Setup connection monitoring for selfhost mode
 * Periodically checks connection and attempts reconnect if needed
 */
function setupConnectionMonitoring() {
    if (connectionMonitorInterval) {
        return; // Already running
    }
    
    console.log('[DB] Starting connection monitor for selfhost mode');
    
    connectionMonitorInterval = setInterval(async () => {
        const now = Date.now();
        if (now - lastConnectionCheck < CONNECTION_CHECK_INTERVAL) {
            return;
        }
        lastConnectionCheck = now;
        
        // Check main connection
        if (mainClient && mainDb) {
            try {
                await mainClient.db('admin').command({ ping: 1 });
            } catch (err) {
                console.warn('[DB] Main connection check failed, attempting reconnect...');
                mainDb = null;
                mainConnectPromise = null;
                
                setTimeout(async () => {
                    try {
                        await connectMain();
                        console.log('[DB] Main database reconnected successfully');
                    } catch (reconnectErr) {
                        console.error('[DB] Main reconnect failed:', reconnectErr.message);
                    }
                }, RECONNECT_DELAY);
            }
        }
        
        // Check vault connection
        if (vaultClient && vaultDb) {
            try {
                await vaultClient.db('admin').command({ ping: 1 });
            } catch (err) {
                console.warn('[DB] Vault connection check failed, attempting reconnect...');
                vaultDb = null;
                vaultConnectPromise = null;
                
                setTimeout(async () => {
                    try {
                        await connectVault();
                        console.log('[DB] Vault database reconnected successfully');
                    } catch (reconnectErr) {
                        console.error('[DB] Vault reconnect failed:', reconnectErr.message);
                    }
                }, RECONNECT_DELAY);
            }
        }
    }, CONNECTION_CHECK_INTERVAL);
    
    // Don't prevent process exit
    connectionMonitorInterval.unref();
}

/**
 * Stop connection monitoring
 */
function stopConnectionMonitoring() {
    if (connectionMonitorInterval) {
        clearInterval(connectionMonitorInterval);
        connectionMonitorInterval = null;
    }
}

/**
 * Check if database is connected and healthy
 */
async function isConnected() {
    if (LOCAL_DB_MODE) return false;
    if (!mainClient || !mainDb) return false;
    
    try {
        await mainClient.db('admin').command({ ping: 1 });
        return true;
    } catch {
        return false;
    }
}

module.exports = {
    mainClient,
    vaultClient,
    connectMain,
    connectVault,
    initializeDatabaseClients,
    getJarvisDb,
    getVaultDb,
    closeMain,
    closeVault,
    setupConnectionMonitoring,
    stopConnectionMonitoring,
    isConnected,
    IS_SELFHOST
};

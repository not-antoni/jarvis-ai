const { MongoClient } = require('mongodb');
const config = require('../../config');

const IS_RENDER = Boolean(process.env.RENDER || process.env.RENDER_SERVICE_ID || process.env.RENDER_EXTERNAL_URL);
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

const mainClient =
    !LOCAL_DB_MODE && mainUri
        ? new MongoClient(mainUri, {
              maxPoolSize: 25,
              minPoolSize: 2,
              serverSelectionTimeoutMS: 5000,
              socketTimeoutMS: 45000,
              retryWrites: true,
              retryReads: true
          })
        : null;

const vaultClient =
    !LOCAL_DB_MODE && vaultUri
        ? new MongoClient(vaultUri, {
              maxPoolSize: 20,
              minPoolSize: 1,
              serverSelectionTimeoutMS: 5000,
              socketTimeoutMS: 45000,
              retryWrites: true,
              retryReads: true
          })
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
        return mainDb;
    }

    if (!mainConnectPromise) {
        mainConnectPromise = mainClient
            .connect()
            .then(client => {
                mainDb = client.db(mainDbName);
                return mainDb;
            })
            .catch(error => {
                mainConnectPromise = null;
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

module.exports = {
    mainClient,
    vaultClient,
    connectMain,
    connectVault,
    initializeDatabaseClients,
    getJarvisDb,
    getVaultDb,
    closeMain,
    closeVault
};

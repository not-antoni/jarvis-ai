const config = require('../../config');
const aiManager = require('./ai-providers');
const database = require('./database');
const { parseBooleanEnv } = require('../utils/parse-bool-env');

const localDbMode =
    parseBooleanEnv(process.env.LOCAL_DB_MODE, false) || parseBooleanEnv(process.env.ALLOW_START_WITHOUT_DB, false);

const REQUIRED_ENV_VARS = localDbMode
    ? ['DISCORD_TOKEN', 'MASTER_KEY_BASE64']
    : ['DISCORD_TOKEN', 'MONGO_URI_MAIN', 'MONGO_URI_VAULT', 'MASTER_KEY_BASE64'];
const OPTIONAL_ENV_VARS = [
    'OPENROUTER_API_KEY',
    'GROQ_API_KEY',
    'GOOGLE_AI_API_KEY',
    'GOOGLE_AI_ENABLE_PREVIEW_MODELS',
    'CEREBRAS_API_KEY',
    'SAMBANOVA_API_KEY',
    'MISTRAL_API_KEY',
    'NVIDIA_API_KEY',
    'AI_GATEWAY_API_KEY',
    'OLLAMA_API_KEY',
    'OPENAI_API_KEY',
    'OPENAI',
    'UV_THREADPOOL_SIZE',
    'VAULT_CACHE_TTL_MS'
];

function evaluateEnvironment() {
    const required = [];
    const optional = [];
    let hasAllRequired = true;
    let optionalConfigured = 0;

    for (const name of REQUIRED_ENV_VARS) {
        const present = Boolean(process.env[name]);
        required.push({ name, present });
        if (!present) {
            hasAllRequired = false;
        }
    }

    for (const name of OPTIONAL_ENV_VARS) {
        const present = Boolean(process.env[name]);
        optional.push({ name, present });
        if (present) {
            optionalConfigured += 1;
        }
    }

    return {
        required,
        optional,
        hasAllRequired,
        optionalConfigured,
        optionalTotal: OPTIONAL_ENV_VARS.length
    };
}

async function gatherHealthSnapshot(options = {}) {
    const {
        pingDatabase = false,
        attemptReconnect = false,
        keepDatabaseConnected = false,
        includeProviders = true,
        redactProviders = false
    } = options;

    const env = evaluateEnvironment();
    const snapshot = {
        env,
        providers: [],
        database: {
            connected: database.isConnected,
            ping: 'skipped',
            error: null,
            attemptedReconnect: false,
            reconnected: false
        },
        system: {
            uptimeSeconds: process.uptime(),
            memory: process.memoryUsage(),
            timestamp: new Date().toISOString(),
            nodeVersion: process.version
        }
    };

    if (includeProviders) {
        snapshot.providers = redactProviders
            ? aiManager.getRedactedProviderStatus()
            : aiManager.getProviderAnalytics();
    }

    // Include load management stats
    if (typeof aiManager.getLoadStats === 'function') {
        snapshot.load = aiManager.getLoadStats();
    }

    let temporaryConnection = false;

    if (pingDatabase) {
        if (!database.isConnected && attemptReconnect) {
            snapshot.database.attemptedReconnect = true;
            try {
                await database.connect();
                snapshot.database.connected = database.isConnected;
                snapshot.database.reconnected = database.isConnected;
                temporaryConnection = database.isConnected;
            } catch (error) {
                snapshot.database.error = error.message;
                snapshot.database.connected = database.isConnected;
            }
        }

        if (database.isConnected) {
            try {
                if (database.db?.command) {
                    await database.db.command({ ping: 1 });
                } else if (database.client?.db) {
                    await database.client.db(config.database.names.main).command({ ping: 1 });
                }
                snapshot.database.ping = 'ok';
            } catch (error) {
                snapshot.database.ping = 'failed';
                snapshot.database.error = error.message;
            }
        } else if (!snapshot.database.error) {
            snapshot.database.ping = 'skipped';
        }
    }

    if (temporaryConnection && !keepDatabaseConnected) {
        try {
            await database.disconnect();
            snapshot.database.connected = database.isConnected;
        } catch (error) {
            snapshot.database.error = snapshot.database.error || error.message;
        }
    }

    return snapshot;
}

module.exports = {
    REQUIRED_ENV_VARS,
    OPTIONAL_ENV_VARS,
    evaluateEnvironment,
    gatherHealthSnapshot
};

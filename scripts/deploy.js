/**
 * Deployment verification script
 * Run this to check if everything is ready for Render deployment
 */

const { MongoClient } = require('mongodb');

function parseBooleanEnv(key, fallback = false) {
    const value = process.env[key];
    if (value == null) {
        return Boolean(fallback);
    }

    const normalized = String(value).trim().toLowerCase();
    if (!normalized) {
        return Boolean(fallback);
    }

    if (['1', 'true', 'yes', 'on', 'enabled'].includes(normalized)) {
        return true;
    }
    if (['0', 'false', 'no', 'off', 'disabled'].includes(normalized)) {
        return false;
    }

    return Boolean(fallback);
}

const localDbMode =
    parseBooleanEnv('LOCAL_DB_MODE', false) || parseBooleanEnv('ALLOW_START_WITHOUT_DB', false);

const REQUIRED_ENV_VARS = localDbMode
    ? ['DISCORD_TOKEN', 'MASTER_KEY_BASE64']
    : ['DISCORD_TOKEN', 'MONGO_URI_MAIN', 'MONGO_URI_VAULT', 'MASTER_KEY_BASE64'];

const OPTIONAL_ENV_VARS = [
    'OPENROUTER_API_KEY',
    'GROQ_API_KEY',
    'GOOGLE_AI_API_KEY',
    'OPENAI_API_KEY',
    'OPENAI',
    'LOCAL_EMBEDDING_URL',
    'AI_PROXY_ENABLED',
    'AI_PROXY_URLS',
    'AI_PROXY_TOKEN',
    'AI_PROXY_STRATEGY',
    'AI_PROXY_ALLOWED_HOSTS',
    'AI_PROXY_DEBUG',
    'AI_PROXY_FALLBACK_DIRECT',
    'AI_PROXY_WORKERS_COUNT',
    'AI_PROXY_WORKER_PREFIX',
    'AI_PROXY_SET_WORKER_TOKEN',
    'AI_PROXY_SAVE_TO_DB',
    'CLOUDFLARE_ACCOUNT_ID',
    'CLOUDFLARE_WORKERS_SUBDOMAIN',
    'CLOUDFLARE_API_TOKEN',
    'CLOUDFLARE_EMAIL',
    'CLOUDFLARE_GLOBAL_API_KEY',
    'BRAVE_API_KEY',
    'YOUTUBE_API_KEY',
    'HEALTH_TOKEN',
    'PASSWORD'
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

function countConfiguredProviders() {
    const openRouterKeys = Object.keys(process.env)
        .filter(k => k.startsWith('OPENROUTER_API_KEY'))
        .map(k => process.env[k])
        .filter(Boolean);
    const groqKeys = Object.keys(process.env)
        .filter(k => k.startsWith('GROQ_API_KEY'))
        .map(k => process.env[k])
        .filter(Boolean);
    const googleKeys = Object.keys(process.env)
        .filter(k => k.startsWith('GOOGLE_AI_API_KEY'))
        .map(k => process.env[k])
        .filter(Boolean);

    const openAiKey = process.env.OPENAI || process.env.OPENAI_API_KEY;

    return {
        totalFamilies: [
            openRouterKeys.length ? 'openrouter' : null,
            groqKeys.length ? 'groq' : null,
            googleKeys.length ? 'google' : null,
            openAiKey ? 'openai' : null
        ].filter(Boolean).length,
        openRouterKeys: openRouterKeys.length,
        groqKeys: groqKeys.length,
        googleKeys: googleKeys.length,
        openAiConfigured: Boolean(openAiKey)
    };
}

async function pingMongo(uri, dbName) {
    const client = new MongoClient(uri, {
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000
    });

    try {
        await client.connect();
        await client.db(dbName).command({ ping: 1 });
        return { ok: true };
    } catch (error) {
        return { ok: false, error: error?.message || String(error) };
    } finally {
        try {
            await client.close();
        } catch {
            // ignore
        }
    }
}

async function verifyDeployment() {
    console.log('🔍 Verifying Jarvis deployment readiness...\n');

    const env = evaluateEnvironment();
    const providers = countConfiguredProviders();

    console.log('✅ Environment Variables:');
    env.required.forEach(({ name, present }) => {
        console.log(
            `  ${present ? '✅' : '❌'} ${name}: ${present ? 'Set' : 'Missing (REQUIRED)'}`
        );
    });

    env.optional.forEach(({ name, present }) => {
        console.log(
            `  ${present ? '✅' : '⚠️ '} ${name}: ${present ? 'Set' : 'Not set (optional)'}`
        );
    });

    console.log(`\n📊 AI Providers: ${providers.totalFamilies} configured`);
    console.log(`📊 Optional APIs: ${env.optionalConfigured}/${env.optionalTotal} configured`);

    if (!env.hasAllRequired) {
        console.log('\n❌ Deployment will fail - missing required environment variables');
        return false;
    }

    if (!providers.totalFamilies) {
        console.log(
            '\n⚠️  Warning: No AI providers configured - bot will have limited functionality'
        );
    }

    console.log('\n🔗 Testing database connection...');
    if (localDbMode) {
        console.log('⚠️  Database ping skipped (LOCAL_DB_MODE)');
    } else {
        const mainUri = process.env.MONGO_URI_MAIN;
        const vaultUri = process.env.MONGO_URI_VAULT;
        const mainDbName = process.env.MONGO_DB_MAIN_NAME || 'jarvis_ai';
        const vaultDbName = process.env.MONGO_DB_VAULT_NAME || 'jarvis_vault';

        const [mainPing, vaultPing] = await Promise.all([
            pingMongo(mainUri, mainDbName),
            pingMongo(vaultUri, vaultDbName)
        ]);

        if (mainPing.ok && vaultPing.ok) {
            console.log('✅ Database connection successful');
        } else {
            const message = mainPing.error || vaultPing.error || 'Unknown database ping failure';
            console.log(`❌ Database connection failed: ${message}`);
            return false;
        }
    }

    console.log('\n✅ Deployment verification complete!');
    console.log('🚀 Your bot is ready for Render deployment');
    return true;
}

// Run verification if this file is executed directly
if (require.main === module) {
    verifyDeployment()
        .then(success => process.exit(success ? 0 : 1))
        .catch(error => {
            console.error('Verification failed:', error);
            process.exit(1);
        });
}

module.exports = verifyDeployment;

/**
 * Configuration management for Jarvis Discord Bot
 */

const path = require('path');
const validateConfig = require('./config/validate');

function parseBooleanEnv(envValue, fallback = false) {
    if (envValue == null) {
        return Boolean(fallback);
    }

    const normalized = String(envValue).trim().toLowerCase();
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

const enableMessageContentIntent = parseBooleanEnv(process.env.DISCORD_ENABLE_MESSAGE_CONTENT, true);
const enablePresenceIntent = parseBooleanEnv(process.env.DISCORD_ENABLE_PRESENCE_INTENT, false);
const deploymentTarget = (process.env.DEPLOY_TARGET || 'render').trim().toLowerCase();
const headlessBrowserEnabled = parseBooleanEnv(process.env.HEADLESS_BROWSER_ENABLED, false);
const liveAgentModeEnabled = parseBooleanEnv(process.env.LIVE_AGENT_MODE, false);
const agentAllowlist = (process.env.AGENT_ALLOWLIST_DOMAINS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const agentDenylist = (process.env.AGENT_DENYLIST_DOMAINS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const agentPreferredProviders = (process.env.AGENT_PREFERRED_PROVIDERS || '').split(',').map((s) => s.trim()).filter(Boolean);

const baseIntents = [
    'Guilds',
    'GuildMessages',
    'GuildVoiceStates',
    'GuildMembers',
    'DirectMessages',
    'GuildMessageReactions'
];

if (enableMessageContentIntent) {
    baseIntents.push('MessageContent');
}

if (enablePresenceIntent) {
    baseIntents.push('GuildPresences');
}

const rawConfig = {
    // Discord Bot Configuration
    discord: {
        token: process.env.DISCORD_TOKEN,
        intents: baseIntents,
        messageContent: {
            enabled: enableMessageContentIntent
        },
        presenceIntent: {
            enabled: enablePresenceIntent
        }
    },

    // Database Configuration
    database: {
        mainUri: process.env.MONGO_URI_MAIN,
        vaultUri: process.env.MONGO_URI_VAULT,
        names: {
            main: process.env.MONGO_DB_MAIN_NAME || 'jarvis_ai',
            vault: process.env.MONGO_DB_VAULT_NAME || 'jarvis_vault'
        },
        collections: {
            conversations: 'conversations',
            userProfiles: 'userProfiles',
            guildConfigs: 'guildConfigs',
            reactionRoles: 'reactionRoles',
            autoModeration: 'autoModerationRules',
            moderationFilters: 'moderationFilters',
            serverStats: 'serverStats',
            memberLogs: 'memberLogs',
            tickets: 'tickets',
            ticketTranscripts: 'ticketTranscripts',
            knowledgeBase: 'knowledgeBaseEntries',
            counters: 'counters',
            newsCache: 'newsCache',
            migrations: 'migrations',
            statusMessages: 'statusMessages',
            commandMetrics: 'commandMetrics'
        },
        vaultCollections: {
            userKeys: process.env.VAULT_USER_KEYS_COLLECTION || 'vaultUserKeys',
            memories: process.env.VAULT_MEMORIES_COLLECTION || 'vaultMemories'
        }
    },
    security: {
        masterKeyBase64: process.env.MASTER_KEY_BASE64,
        vaultCacheTtlMs: process.env.VAULT_CACHE_TTL_MS ? Number(process.env.VAULT_CACHE_TTL_MS) : undefined
    },

    // Deployment target controls infra-specific toggles.
    deployment: {
        target: deploymentTarget, // 'render' (default) or 'selfhost'
        headlessBrowser: headlessBrowserEnabled, // enable when running a local headless browser instead of external APIs
        autoExportMongo: parseBooleanEnv(process.env.SELFHOST_AUTO_EXPORT_MONGO, false),
        exportPath: process.env.SELFHOST_EXPORT_PATH || path.join(__dirname, 'data', 'mongo-exports'),
        exportCollections: (process.env.SELFHOST_EXPORT_COLLECTIONS || '').split(',').map((s) => s.trim()).filter(Boolean),
        liveAgentMode: liveAgentModeEnabled,
        agentAllowlist,
        agentDenylist,
        agentPreferredProviders
    },

    // AI Provider Configuration
    ai: {
        cooldownMs: 3000,
        maxTokens: 500,
        maxInputLength: 250,
        maxSlashInputLength: 250,
        temperature: 1,
        retryAttempts: 0,
        fallbackChance: 0.12,
        // Provider selection: "auto" for random selection, or specific provider type
        // Options: "auto", "openai", "groq", "openrouter", "google", "mixtral", "cohere"
        provider: process.env.AI_PROVIDER || "auto",
    },

    // Server Configuration
    server: {
        port: process.env.PORT || 3000,
        uptimeInterval: 300000, // 5 minutes
        healthToken: process.env.HEALTH_TOKEN || null
    },

    // Wake Words
    wakeWords: ['jarvis', 'okay garmin', 'ok garmin', 'garmin'],

    // Admin Configuration
    admin: {
        userId: process.env.ADMIN_USER_ID || '809010595545874432'
    },

    // Command Restrictions
    commands: {
        // Multiple channel IDs where !t command is allowed
        whitelistedChannelIds: ['1403664986089324609', '984738858950344714', '1419618537525346324']
    },

    // YouTube API Configuration
    youtube: {
        apiKey: process.env.YOUTUBE_API_KEY
    },

    // Brave Search API Configuration
    brave: {
        apiKey: process.env.BRAVE_API_KEY
    },

    // Crypto Market Data
    crypto: {
        apiKey: process.env.CRYPTO_API_KEY || null
    },

    // Feature Toggles (can be overridden via FEATURE_* environment variables)
    features: {
        coreChat: true,
        utilities: true,
        providers: true,
        reset: true,
        invite: true,
        clipping: true,
        reactionRoles: true,
        automod: true,
        serverStats: true,
        memberLog: true,
        tickets: true,
        knowledgeBase: true,
        knowledgeAsk: true,
        digests: true,
        newsBriefings: true,
        macroReplies: true,
        music: true,
        memeTools: true,
        funUtilities: true,
        crypto: true,
        moderationFilters: true
    }
};

const config = validateConfig(rawConfig);

module.exports = config;

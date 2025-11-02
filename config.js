/**
 * Configuration management for Jarvis Discord Bot
 */

const validateConfig = require('./config/validate');

const rawConfig = {
    // Discord Bot Configuration
    discord: {
        token: process.env.DISCORD_TOKEN,
        intents: [
            'Guilds',
            'GuildMessages',
            'MessageContent',
            'GuildVoiceStates',
            'GuildMembers',
            'DirectMessages',
            'GuildMessageReactions',
            'GuildPresences'
        ]
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
            serverStats: 'serverStats',
            memberLogs: 'memberLogs',
            tickets: 'tickets',
            ticketTranscripts: 'ticketTranscripts',
            knowledgeBase: 'knowledgeBaseEntries',
            counters: 'counters',
            newsCache: 'newsCache',
            migrations: 'migrations',
            xpUsers: 'xp_users',
            xpRewards: 'xp_rewards',
            economyUsers: 'econ_users',
            economyShop: 'econ_shop',
            economyTransactions: 'econ_tx'
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

    // AI Provider Configuration
    ai: {
        cooldownMs: 5000,
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
        uptimeInterval: 300000 // 5 minutes
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
        leveling: true,
        levelingVoice: false,
        memeTools: true,
        economy: true,
        funUtilities: true
    }
};

const config = validateConfig(rawConfig);

module.exports = config;

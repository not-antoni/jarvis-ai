/**
 * Configuration management for Jarvis Discord Bot
 */

const config = {
    // Discord Bot Configuration
    discord: {
        token: process.env.DISCORD_TOKEN,
        intents: [
            'Guilds',
            'GuildMessages', 
            'MessageContent',
            'GuildMembers',
            'DirectMessages',
            'GuildMessageReactions',
            'GuildPresences'
        ]
    },

    // Database Configuration
    database: {
        uri: `mongodb+srv://aiusr:${process.env.MONGO_PW}@cluster0ai.tmsdg3r.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0ai`,
        name: 'jarvis_ai',
        collections: {
            conversations: 'conversations',
            userProfiles: 'userProfiles',
            guildConfigs: 'guildConfigs',
            reactionRoles: 'reactionRoles',
            autoModeration: 'autoModerationRules',
            serverStats: 'serverStats',
            memberLogs: 'memberLogs'
        }
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
        provider: process.env.AI_PROVIDER || "auto"
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
        whitelistedChannelIds: ['1403664986089324609',          '984738858950344714',
'1419618537525346324']
    },

    // YouTube API Configuration
    youtube: {
        apiKey: process.env.YOUTUBE_API_KEY
    },

    // Brave Search API Configuration
    brave: {
        apiKey: process.env.BRAVE_API_KEY
    }
};

// Validation
const requiredEnvVars = ['DISCORD_TOKEN', 'MONGO_PW', 'OPENAI'];
const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
    console.warn(`Missing required environment variables: ${missingVars.join(', ')}`);
}

module.exports = config;

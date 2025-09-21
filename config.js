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
            userProfiles: 'userProfiles'
        }
    },

    // AI Provider Configuration
    ai: {
        cooldownMs: 10000, // 5 seconds
        maxTokens: 500,
        maxInputLength: 250,
        maxSlashInputLength: 250,
        temperature: 0.6,
        retryAttempts: 0,
        fallbackChance: 0.12,
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
        whitelistedChannelIds: [
            process.env.WHITELISTED_CHANNEL_ID || '1403664986089324609',
            '984738858950344714'
        ]
    }
};

// Validation
const requiredEnvVars = ['DISCORD_TOKEN', 'MONGO_PW', 'OPENAI'];
const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
    console.error(`Missing required environment variables: ${missingVars.join(', ')}`);
    process.exit(1);
}

module.exports = config;
/**
 * Configuration management for Jarvis Discord Bot
 */

const { cleanEnv, str, num, bool } = require('./utils/envalid-lite');

const env = cleanEnv(
    process.env,
    {
        DISCORD_TOKEN: str({ desc: 'Discord bot token' }),
        MONGO_PW: str({ desc: 'MongoDB password for the aiusr account' }),
        OPENAI: str({ default: '', desc: 'OpenAI API key used for embeddings and failover' }),
        AI_PROVIDER: str({ default: 'auto', choices: ['auto', 'openai', 'groq', 'openrouter', 'google', 'mixtral', 'cohere'] }),
        PORT: num({ default: 3000 }),
        ADMIN_USER_ID: str({ default: '809010595545874432' }),
        YOUTUBE_API_KEY: str({ default: '' }),
        BRAVE_API_KEY: str({ default: '' }),
        FEATURE_FLAGS_VERBOSE_LOGGING: bool({ default: false })
    },
    {
        strict: false
    }
);

const mongoPassword = encodeURIComponent(env.MONGO_PW);

const config = {
    discord: {
        token: env.DISCORD_TOKEN,
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
    database: {
        uri: `mongodb+srv://aiusr:${mongoPassword}@cluster0ai.tmsdg3r.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0ai`,
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
    ai: {
        cooldownMs: 8000,
        maxTokens: 500,
        maxInputLength: 250,
        maxSlashInputLength: 250,
        temperature: 1,
        retryAttempts: 0,
        fallbackChance: 0.12,
        provider: env.AI_PROVIDER
    },
    server: {
        port: env.PORT,
        uptimeInterval: 300000
    },
    wakeWords: ['jarvis', 'okay garmin', 'ok garmin', 'garmin'],
    admin: {
        userId: env.ADMIN_USER_ID
    },
    commands: {
        whitelistedChannelIds: ['1403664986089324609', '984738858950344714', '1419618537525346324']
    },
    youtube: {
        apiKey: env.YOUTUBE_API_KEY || undefined
    },
    brave: {
        apiKey: env.BRAVE_API_KEY || undefined
    },
    featureFlags: Object.fromEntries(
        Object.entries(process.env)
            .filter(([key]) => key.startsWith('FEATURE_'))
            .map(([key, value]) => [
                key.replace('FEATURE_', '').toLowerCase(),
                value === '1' || value?.toLowerCase() === 'true'
            ])
    )
};

module.exports = config;

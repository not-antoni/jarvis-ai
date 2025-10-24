const { z } = require('zod');

const requiredEnvVars = ['DISCORD_TOKEN', 'MONGO_PW', 'OPENAI'];

const envSchema = z.object({
    DISCORD_TOKEN: z.string().min(1, 'DISCORD_TOKEN is required'),
    MONGO_PW: z.string().min(1, 'MONGO_PW is required'),
    OPENAI: z.string().min(1, 'OPENAI is required'),
    YOUTUBE_API_KEY: z.string().optional(),
    BRAVE_API_KEY: z.string().optional(),
}).passthrough();

function coerceAndDeduplicateChannelIds(ids) {
    if (!Array.isArray(ids)) {
        return [];
    }

    const normalized = ids
        .map((value) => {
            if (value == null) return null;
            return String(value).trim();
        })
        .filter((value) => Boolean(value));

    return Array.from(new Set(normalized));
}

function validateConfig(rawConfig) {
    const envResult = envSchema.safeParse(process.env);

    if (!envResult.success) {
        const formatted = envResult.error.errors
            .map((issue) => issue.message)
            .join(', ');
        throw new Error(`Environment validation failed: ${formatted}`);
    }

    const env = envResult.data;

    for (const key of requiredEnvVars) {
        if (!env[key]) {
            throw new Error(`Missing required environment variable: ${key}`);
        }
    }

    ['YOUTUBE_API_KEY', 'BRAVE_API_KEY'].forEach((optionalKey) => {
        if (!env[optionalKey]) {
            console.warn(`Warning: ${optionalKey} is not set. Related features may be disabled.`);
        }
    });

    const commands = rawConfig.commands || {};

    return {
        ...rawConfig,
        discord: {
            ...rawConfig.discord,
            token: env.DISCORD_TOKEN,
        },
        youtube: {
            ...rawConfig.youtube,
            apiKey: env.YOUTUBE_API_KEY,
        },
        brave: {
            ...rawConfig.brave,
            apiKey: env.BRAVE_API_KEY,
        },
        commands: {
            ...commands,
            whitelistedChannelIds: coerceAndDeduplicateChannelIds(commands.whitelistedChannelIds),
        },
    };
}

module.exports = validateConfig;

const { z } = require('zod');

const requiredEnvVars = ['DISCORD_TOKEN', 'MONGO_URI_MAIN', 'MONGO_URI_VAULT', 'MASTER_KEY_BASE64'];

const envSchema = z.object({
    DISCORD_TOKEN: z.string().min(1, 'DISCORD_TOKEN is required'),
    MONGO_URI_MAIN: z.string()
        .min(1, 'MONGO_URI_MAIN is required')
        .refine((value) => /^mongodb(\+srv)?:\/\//i.test(value), 'MONGO_URI_MAIN must be a MongoDB connection string'),
    MONGO_URI_VAULT: z.string()
        .min(1, 'MONGO_URI_VAULT is required')
        .refine((value) => /^mongodb(\+srv)?:\/\//i.test(value), 'MONGO_URI_VAULT must be a MongoDB connection string'),
    MASTER_KEY_BASE64: z.string()
        .min(1, 'MASTER_KEY_BASE64 is required')
        .refine((value) => {
            try {
                return Buffer.from(value, 'base64').length === 32;
            } catch {
                return false;
            }
        }, 'MASTER_KEY_BASE64 must decode to exactly 32 bytes'),
    OPENAI: z.string().optional(),
    LOCAL_EMBEDDING_URL: z.string().optional(),
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

function parseBooleanEnv(key, fallback) {
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

function normalizeFeatureFlags(features = {}) {
    const normalized = {};

    for (const [key, defaultValue] of Object.entries(features)) {
        const envKey = `FEATURE_${key.replace(/([A-Z])/g, '_$1').toUpperCase()}`;
        normalized[key] = parseBooleanEnv(envKey, defaultValue);
    }

    return normalized;
}

function normalizeVaultCacheTtlMs(value) {
    const fallback = 2 * 60 * 1000;
    const ms = Number.isFinite(value) ? value : Number(value);

    if (!Number.isFinite(ms) || ms <= 0) {
        return fallback;
    }

    const min = 60 * 1000;
    const max = 5 * 60 * 1000;
    return Math.min(Math.max(ms, min), max);
}

function sanitizeIdentifier(value, fallback) {
    if (value == null) {
        return fallback;
    }

    const trimmed = String(value).trim();
    if (!trimmed) {
        return fallback;
    }

    return trimmed;
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

    if (!env.OPENAI && !env.LOCAL_EMBEDDING_URL) {
        console.warn('Warning: Neither OPENAI nor LOCAL_EMBEDDING_URL is configured. Embedding features will be unavailable.');
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
        database: {
            ...rawConfig.database,
            mainUri: env.MONGO_URI_MAIN,
            vaultUri: env.MONGO_URI_VAULT,
            names: {
                main: sanitizeIdentifier(rawConfig.database?.names?.main, 'jarvis_ai'),
                vault: sanitizeIdentifier(rawConfig.database?.names?.vault, 'jarvis_vault')
            },
            vaultCollections: {
                userKeys: sanitizeIdentifier(rawConfig.database?.vaultCollections?.userKeys, 'vaultUserKeys'),
                memories: sanitizeIdentifier(rawConfig.database?.vaultCollections?.memories, 'vaultMemories')
            }
        },
        security: {
            ...rawConfig.security,
            masterKeyBase64: env.MASTER_KEY_BASE64,
            vaultCacheTtlMs: normalizeVaultCacheTtlMs(rawConfig.security?.vaultCacheTtlMs)
        },
        commands: {
            ...commands,
            whitelistedChannelIds: coerceAndDeduplicateChannelIds(commands.whitelistedChannelIds),
        },
        features: normalizeFeatureFlags(rawConfig.features || {})
    };
}

module.exports = validateConfig;

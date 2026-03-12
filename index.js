/**
 * Jarvis Discord Bot - Main Entry Point
 * Refactored for better organization and maintainability
 */

/* eslint-disable no-console */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
    Client,
    GatewayIntentBits,
    Partials,
    Events
} = require('discord.js');
const cron = require('node-cron');
const tempFiles = require('./src/utils/temp-files');

// Import our modules
const appContext = require('./src/core/app-context');
const config = require('./config');
const database = require('./src/services/database');
const LOCAL_DB_MODE = String(process.env.LOCAL_DB_MODE || '').toLowerCase() === '1';
let initializeDatabaseClients = null;
try {
    if (!LOCAL_DB_MODE) {
        ({ initializeDatabaseClients } = require('./src/services/db'));
    }
} catch (e) {
    // Will proceed without DB when local mode
}
const aiManager = require('./src/services/ai-providers');
const discordHandlers = require('./src/services/discord-handlers-impl');
const webhookRouter = require('./routes/webhook');
const { exportAllCollections } = require('./src/utils/mongo-exporter');
const ytDlpManager = require('./src/services/yt-dlp-manager');
const errorLogger = require('./src/services/error-logger');
const serverLogger = require('./src/services/server-logger');
const { printSelfhostStatus } = require('./scripts/selfhost-check');
const { printRenderStatus } = require('./scripts/render-check');
const { safeReadJson, writeJsonAtomic } = require('./src/server/health-helpers');
const { createExpressApp, mount404Handler } = require('./src/server/express-setup');
const {
    refreshPresenceMessages, updateBotPresence
} = require('./src/server/presence-manager');

// Run deployment environment check early
const selfhostResult = printSelfhostStatus();
if (!selfhostResult.isSelfhost) {
    printRenderStatus();
}

const configuredThreadpoolSize = Number(process.env.UV_THREADPOOL_SIZE || 0);
if (configuredThreadpoolSize) {
    console.log(`UV threadpool size configured to ${configuredThreadpoolSize}`);
} else {
    console.warn('UV_THREADPOOL_SIZE not set; Node default threadpool (4) is active.');
}

const DATA_DIR = path.join(__dirname, 'data');
const COMMAND_SYNC_STATE_PATH = path.join(DATA_DIR, 'command-sync-state.json');
const isSelfHost = config?.deployment?.target === 'selfhost';


// Load command sync state - local file for selfhost, MongoDB for Render
let commandSyncState = safeReadJson(COMMAND_SYNC_STATE_PATH, null);
let _commandSyncFromMongo = false; // Track if we loaded from MongoDB

// On Render (not selfhost), we'll load from MongoDB after DB connects
async function loadCommandSyncStateFromMongo() {
    if (isSelfHost) {return;} // Selfhost uses local file
    if (!database?.isConnected) {return;}

    try {
        const mongoState = await database.getCommandSyncState();
        if (mongoState) {
            commandSyncState = mongoState;
            _commandSyncFromMongo = true;
            console.log('[CommandSync] Loaded state from MongoDB (Render mode)');
        }
    } catch (error) {
        console.warn('[CommandSync] Failed to load from MongoDB:', error.message);
    }
}

if (initializeDatabaseClients) {
    initializeDatabaseClients()
        .then(() => console.log('MongoDB clients initialized for main and vault databases.'))
        .catch(error => console.error('Failed to initialize MongoDB clients at startup:', error));
}

async function maybeExportMongoOnStartup() {
    if (!isSelfHost) {return;}

    try {
        const outDir = config.deployment.exportPath;
        const collections =
            Array.isArray(config.deployment.exportCollections) &&
                config.deployment.exportCollections.length
                ? config.deployment.exportCollections
                : [];
        const file = await exportAllCollections({
            outDir,
            collections,
            filenamePrefix: 'startup-export'
        });
        console.log(`Self-host: exported Mongo snapshot to ${file}`);

        // Cleanup old exports - keep only the 10 most recent
        try {
            const MAX_EXPORTS = 10;
            const files = fs.readdirSync(outDir)
                .filter(f => f.startsWith('startup-export') && f.endsWith('.json'))
                .map(f => ({ name: f, time: fs.statSync(path.join(outDir, f)).mtime.getTime() }))
                .sort((a, b) => b.time - a.time);

            if (files.length > MAX_EXPORTS) {
                const toDelete = files.slice(MAX_EXPORTS);
                for (const f of toDelete) {
                    fs.unlinkSync(path.join(outDir, f.name));
                }
                console.log(`Cleaned up ${toDelete.length} old Mongo exports (kept ${MAX_EXPORTS} most recent)`);
            }
        } catch (cleanupError) {
            console.warn('Failed to cleanup old exports:', cleanupError.message);
        }

        try {
            const { syncFromLatestExport } = require('./src/localdb');
            const result = syncFromLatestExport();
            if (result) {
                console.log(
                    `Local-DB synced from export ${result.latest} into data/local-db (${result.collections.length} collections).`
                );
            }
        } catch (e) {
            console.warn('Local-DB sync from export failed:', e);
        }
    } catch (error) {
        console.error('Self-host Mongo export failed:', error);
    }
}


// ------------------------ Discord Client Setup ------------------------
const client = new Client({
    intents: config.discord.intents.map(intent => GatewayIntentBits[intent]),
    allowedMentions: {
        parse: ['users'],
        repliedUser: false
    },
    partials: [
        Partials.Message,
        Partials.Channel,
        Partials.Reaction,
        Partials.User,
        Partials.GuildMember
    ]
});
const PRESENCE_ROTATION_INTERVAL_MS = 20 * 60 * 1000; // 20 minutes

// ------------------------ Slash Command Registration ------------------------
const { buildCommandData } = require('./src/commands/slash-definitions');


function ensureCommandSyncState() {
    if (!commandSyncState || typeof commandSyncState !== 'object') {
        commandSyncState = {};
    }
    if (!commandSyncState.guildClears || typeof commandSyncState.guildClears !== 'object') {
        commandSyncState.guildClears = {};
    }
    return commandSyncState;
}

function persistCommandSyncState() {
    // Always try local file (works on selfhost, may fail on Render but that's OK)
    try {
        writeJsonAtomic(COMMAND_SYNC_STATE_PATH, commandSyncState);
    } catch (error) {
        if (isSelfHost) {
            console.warn('Failed to persist command sync state to file:', error);
        }
    }

    // On Render, also persist to MongoDB (primary source of truth)
    if (!isSelfHost && database?.isConnected) {
        database.saveCommandSyncState(commandSyncState).catch(error => {
            console.warn('Failed to persist command sync state to MongoDB:', error.message);
        });
    }
}

const serverStatsRefreshJob = cron.schedule(
    '*/10 * * * *',
    async() => {
        try {
            await discordHandlers.refreshAllServerStats(client);
        } catch (error) {
            console.error('Failed to refresh server stats:', error);
        }
    },
    { scheduled: false }
);

// Periodic cleanup of expired temp files (every 30 minutes)
const tempSweepJob = cron.schedule(
    '*/30 * * * *',
    async() => {
        try {
            tempFiles.sweepExpired();
        } catch (error) {
            console.warn('Temp file sweep failed:', error);
        }
    },
    { scheduled: false }
);

// Uptime health snapshots (every 5 minutes)
const uptimeSnapshotJob = cron.schedule(
    '*/5 * * * *',
    async() => {
        try {
            const uptimeTracker = require('./src/services/uptime-tracker');
            await uptimeTracker.recordSnapshot();
        } catch (error) {
            console.error('Failed to record uptime snapshot:', error);
        }
    },
    { scheduled: false }
);

async function registerSlashCommands() {
    const commandData = buildCommandData();
    const commandHash = crypto
        .createHash('sha256')
        .update(JSON.stringify(commandData))
        .digest('hex');
    const state = ensureCommandSyncState();
    let registeredNames = commandData.map(cmd => cmd.name);

    if (state.globalHash !== commandHash) {
        if (!client.application?.id) {
            await client.application?.fetch();
        }

        const registered = await client.application.commands.set(commandData);
        registeredNames = Array.from(registered.values(), cmd => cmd.name);

        console.log(
            `Successfully registered ${registered.size ?? commandData.length} global slash commands: ${registeredNames.join(', ')}`
        );

        state.globalHash = commandHash;
        state.lastRegisteredAt = new Date().toISOString();
        state.guildClears = {};
        persistCommandSyncState();
    } else {
        console.log('Slash command definitions unchanged; skipping global command re-sync.');
    }

    const guilds = Array.from(client.guilds.cache.values());
    if (!guilds.length) {
        return registeredNames;
    }

    let clearedCount = 0;
    for (const guild of guilds) {
        try {
            if (state.guildClears[guild.id] === commandHash) {
                continue;
            }
            await guild.commands.set([]);
            console.log(
                `Cleared guild-specific commands for ${guild.name ?? 'Unknown'} (${guild.id})`
            );
            state.guildClears[guild.id] = commandHash;
            clearedCount += 1;
        } catch (error) {
            console.warn(`Failed to clear guild-specific commands for ${guild.id}:`, error);
        }
    }

    if (clearedCount > 0) {
        state.lastGuildClearAt = new Date().toISOString();
        persistCommandSyncState();
    } else {
        console.log('Guild-specific commands already cleared for current command version.');
    }

    return registeredNames;
}

// ------------------------ Express Server ------------------------
const {
    app, dashboardRouter
} = createExpressApp({ webhookRouter, database });

// ------------------------ Event Handlers ------------------------
client.once(Events.ClientReady, async() => {
    console.log(`Jarvis++ online. Logged in as ${client.user.tag}`);

    // Store client in shared context for economy DMs, routes, etc.
    appContext.setClient(client);
    appContext.setHandlers(discordHandlers);
    // Keep globals as aliases during migration
    global.discordClient = client;
    global.discordHandlers = discordHandlers;

    try {
        const moderatorAuth = require('./src/services/moderator-auth');
        if (moderatorAuth?.setDiscordClient) {
            moderatorAuth.setDiscordClient(client);
        }
    } catch (e) {
        console.warn('[ModeratorAuth] Failed to attach Discord client:', e.message);
    }

    // Attach Discord client for error logging + queued flush
    try {
        errorLogger.setClient(client);
    } catch (e) {
        console.warn('[ErrorLogger] Failed to attach client:', e.message);
    }

    // Initialize musicManager with client
    try {
        const { musicManager } = require('./src/core/musicManager');
        musicManager.init(client);
        try {
            const voicePkg = require('@discordjs/voice/package.json');
            console.log(`[Voice] DAVE-capable voice stack enabled (@discordjs/voice ${voicePkg.version}, Node ${process.version}).`);
        } catch (_e) {
            console.log(`[Voice] DAVE-capable voice stack enabled (Node ${process.version}).`);
        }
    } catch (e) {
        console.warn('[MusicManager] Failed to initialize:', e.message);
    }

    const userFeatures = (() => {
        try {
            const service = require('./src/services/user-features');
            service.setDiscordClient(client);
            return service;
        } catch (e) {
            console.warn('[UserFeatures] Failed to attach Discord client:', e.message);
            return null;
        }
    })();

    // Initialize dashboard with Discord client for real-time stats
    dashboardRouter.setDiscordClient(client);
    dashboardRouter.addLog('success', 'Discord', `Bot online: ${client.user.tag}`);
    dashboardRouter.addLog('info', 'System', `Serving ${client.guilds.cache.size} guilds`);

    // Initialize yt-dlp for YouTube fallback (auto-updates from GitHub)
    try {
        const ytDlpReady = await ytDlpManager.initialize();
        if (ytDlpReady) {
            const status = ytDlpManager.getStatus();
            dashboardRouter.addLog('success', 'yt-dlp', `Ready: ${status.currentVersion}`);
            console.log(`[yt-dlp] Initialized successfully: ${status.currentVersion}`);
        } else {
            dashboardRouter.addLog('warning', 'yt-dlp', 'Failed to initialize');
        }
    } catch (error) {
        console.error('[yt-dlp] Initialization error:', error.message);
        dashboardRouter.addLog('error', 'yt-dlp', error.message);
    }

    let databaseConnected = database.isConnected;

    if (!databaseConnected) {
        try {
            await database.connect();
            databaseConnected = true;
        } catch (error) {
            console.error('Failed to connect to MongoDB on startup:', error);
        }
    }

    if (userFeatures) {
        try {
            userFeatures.init(database, client);
        } catch (e) {
            console.warn('[UserFeatures] Failed to initialize:', e.message);
        }
    }

    if (databaseConnected) {
        await maybeExportMongoOnStartup();
        await refreshPresenceMessages(database);
        // Load command sync state from MongoDB on Render (before registering commands)
        await loadCommandSyncStateFromMongo();
    }

    updateBotPresence(client);
    setInterval(() => updateBotPresence(client), PRESENCE_ROTATION_INTERVAL_MS);

    try {
        console.log('[Startup] Registering slash commands...');
        await registerSlashCommands();
        console.log('[Startup] Slash commands registered!');
    } catch (error) {
        console.error('Failed to register slash commands on startup:', error);
    }

    if (databaseConnected) {
        serverStatsRefreshJob.start();
        uptimeSnapshotJob.start();
        try {
            await discordHandlers.refreshAllServerStats(client);
        } catch (error) {
            console.error('Failed to refresh server stats on startup:', error);
        }
        try {
            const uptimeTracker = require('./src/services/uptime-tracker');
            await uptimeTracker.ensureIndexes();
            await uptimeTracker.recordSnapshot();
        } catch (e) {
            console.warn('[UptimeTracker] Init failed:', e.message);
        }
    } else {
        console.warn(
            'Skipping server stats initialization because the database connection was not established.'
        );
    }

    try {
        tempSweepJob.start();
    } catch (e) {
        console.warn('Failed to start temp sweep job:', e);
    }

    // Start Daily Meme Scheduler
    try {
        const memeSender = require('./src/services/meme-sender');
        memeSender.start(client);
    } catch (e) {
        console.warn('Failed to start meme sender:', e);
    }

    // Initialize Giveaways
    try {
        const giveawayService = require('./src/services/giveaways');
        giveawayService.init(client);
        console.log('[Giveaways] Manager initialized 🎁');
    } catch (e) {
        console.warn('Failed to start giveaway manager:', e);
    }

    console.log('Provider status on startup:', aiManager.getProviderStatus());
});


const { wireEventHandlers } = require('./src/server/event-wiring');
wireEventHandlers({
    client, discordHandlers, dashboardRouter, serverLogger,
    errorLogger, aiManager, database, cron,
    serverStatsRefreshJob, tempSweepJob, uptimeSnapshotJob
});

// Mount 404 error handler (must be last)
mount404Handler(app);

// ------------------------ Boot ------------------------
async function startBot() {
    try {
        // Start uptime server
        const bindHost = config.server.host || '0.0.0.0';
        app.listen(config.server.port, bindHost, () => {
            console.log(`Uptime server listening on ${bindHost}:${config.server.port}`);
        });

        // Warm up MongoDB before we touch Discord (optional in local dev)
        try {
            await database.connect();
        } catch (err) {
            const allowNoDb =
                String(process.env.ALLOW_START_WITHOUT_DB || '').toLowerCase() === '1';
            if (allowNoDb) {
                console.warn(
                    'Database connection failed; continuing without DB for local testing.'
                );
            } else {
                throw err;
            }
        }

        await refreshPresenceMessages(database, true);

        // Auto-configure domain (Nginx + Cloudflare)
        try {
            const cloudflareDomain = require('./src/services/cloudflare-domain');
            const cfConfig = cloudflareDomain.getConfig();

            const cloudflareOnly =
            String(process.env.CLOUDFLARE_ONLY || '').toLowerCase() !== 'false';
            if (config?.deployment?.target === 'selfhost' && cloudflareOnly) {
                try {
                    cloudflareDomain.ensureCloudflareIpsConfig?.();
                    cloudflareDomain.ensureCloudflareIpsTimer?.(process.cwd());
                    cloudflareDomain.ensureNginxEnsureTimer?.(process.cwd());
                } catch (error) {
                    console.warn('[Cloudflare] Auto-install timer skipped:', error?.message || error);
                }
            }

            // Auto-setup Nginx reverse proxy (selfhost only)
            if (cfConfig.domain && cfConfig.deployTarget !== 'render') {
                const nginxResult = await cloudflareDomain.autoSetupNginx(cfConfig.domain, true, false);
                if (nginxResult.success) {
                    if (nginxResult.cached) {
                        console.log(`[Nginx] Verified configuration for ${cfConfig.domain}`);
                    } else {
                        console.log(`[Nginx] ✅ Configured: ${cfConfig.domain} → localhost:3000`);
                    }
                } else if (nginxResult.manual) {
                    console.log('[Nginx] ⚠️ Manual setup required (no sudo access)');
                } else if (nginxResult.error) {
                    console.log(`[Nginx] ⚠️ ${nginxResult.error}`);
                }
            }

            // Auto-configure Cloudflare DNS (optional - don't warn if credentials missing/invalid)
            if (cfConfig.zoneId || cfConfig.domain) {
                try {
                    const result = await cloudflareDomain.autoConfigure();
                    if (result.success) {
                        if (result.cached) {
                            console.log(`[Cloudflare] Already configured: ${result.domain} → ${result.target}`);
                        } else {
                            console.log(`[Cloudflare] ✅ Domain configured: ${result.domain} → ${result.target}`);
                        }
                    }
                    // Silently skip auth errors - credentials may not be configured
                } catch (cfAutoErr) {
                    // Only log in debug mode - don't spam console for missing credentials
                    if (process.env.CLOUDFLARE_DEBUG === 'true') {
                        console.log(`[Cloudflare] Auto-config skipped: ${cfAutoErr.message}`);
                    }
                }
            }
        } catch (cfErr) {
            console.log(`[Domain] Auto-config skipped: ${cfErr.message}`);
        }

        // Start Discord bot unless disabled for local testing
        const disableDiscord = String(process.env.DISABLE_DISCORD || '').toLowerCase() === '1';
        if (!disableDiscord) {
            await client.login(config.discord.token);
            console.log(`✅ Logged in as ${client.user.tag}`);
        } else {
            console.log('Discord login disabled (DISABLE_DISCORD=1). Running HTTP only.');
        }
    } catch (error) {
        console.error('Failed to start bot:', error);
        process.exit(1);
    }
}

// Start the bot
startBot();

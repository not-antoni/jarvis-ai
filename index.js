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
    SlashCommandBuilder,
    InteractionContextType,
    ChannelType,
    Partials,
    PermissionsBitField: _PermissionsBitField,
    ActivityType,
    Events
} = require('discord.js');
const express = require('express');
const cookieParser = require('cookie-parser');
const cron = require('node-cron');
const tempFiles = require('./src/utils/temp-files');

// Import our modules
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
const discordHandlers = require('./src/services/discord-handlers');
const { gatherHealthSnapshot } = require('./src/services/diagnostics');
const { commandList: musicCommandList } = require('./src/commands/music');
const { commandFeatureMap } = require('./src/core/command-registry');
const { isFeatureGloballyEnabled } = require('./src/core/feature-flags');
const webhookRouter = require('./routes/webhook');
const { exportAllCollections } = require('./src/utils/mongo-exporter');
const { createAgentDiagnosticsRouter } = require('./src/utils/agent-diagnostics');
const ytDlpManager = require('./src/services/yt-dlp-manager');
const starkEconomy = require('./src/services/stark-economy');
const errorLogger = require('./src/services/error-logger');
const announcementScheduler = require('./src/services/announcement-scheduler');
const monitorScheduler = require('./src/services/monitor-scheduler');
const { printSelfhostStatus } = require('./scripts/selfhost-check');
const { DEFAULT_STATUS_MESSAGES } = require('./data/status-messages');

// Run selfhost check early
printSelfhostStatus();

const configuredThreadpoolSize = Number(process.env.UV_THREADPOOL_SIZE || 0);
if (configuredThreadpoolSize) {
    console.log(`UV threadpool size configured to ${configuredThreadpoolSize}`);
} else {
    console.warn('UV_THREADPOOL_SIZE not set; Node default threadpool (4) is active.');
}

const DATA_DIR = path.join(__dirname, 'data');
const COMMAND_SYNC_STATE_PATH = path.join(DATA_DIR, 'command-sync-state.json');
const HEALTH_TOKEN = (process.env.HEALTH_TOKEN || '').trim() || null;
const isSelfHost = config?.deployment?.target === 'selfhost';

function safeReadJson(filePath, fallback) {
    try {
        if (!fs.existsSync(filePath)) {
            return fallback;
        }
        const raw = fs.readFileSync(filePath, 'utf8');
        return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
        console.warn(`Failed to read ${path.basename(filePath)}:`, error);
        return fallback;
    }
}

function writeJsonAtomic(filePath, value) {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    const tempPath = `${filePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(value, null, 2));
    fs.renameSync(tempPath, filePath);
}

// Load command sync state - local file for selfhost, MongoDB for Render
let commandSyncState = safeReadJson(COMMAND_SYNC_STATE_PATH, null);
let _commandSyncFromMongo = false; // Track if we loaded from MongoDB

// On Render (not selfhost), we'll load from MongoDB after DB connects
async function loadCommandSyncStateFromMongo() {
    if (isSelfHost) return; // Selfhost uses local file
    if (!database?.isConnected) return;

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
    if (!isSelfHost) return;

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
let rotatingStatusMessages = [...DEFAULT_STATUS_MESSAGES];
const PRESENCE_ROTATION_INTERVAL_MS = 20 * 60 * 1000; // 20 minutes
let _rotatingStatusIndex = rotatingStatusMessages.length
    ? Math.floor(Math.random() * rotatingStatusMessages.length)
    : 0;

const activityTypeEntries = Object.entries(ActivityType);
function resolveActivityType(value) {
    if (
        typeof value === 'number' &&
        activityTypeEntries.some(([, enumValue]) => enumValue === value)
    ) {
        return value;
    }
    if (typeof value === 'string' && value.trim()) {
        const normalized = value.trim().replace(/\s+/g, '').toUpperCase();
        const entry = activityTypeEntries.find(([name]) => name.toUpperCase() === normalized);
        return entry ? entry[1] : undefined;
    }
    return undefined;
}

async function refreshPresenceMessages(forceFallback = false) {
    if (!database.isConnected) {
        if (forceFallback) {
            rotatingStatusMessages = [...DEFAULT_STATUS_MESSAGES];
        }
        return false;
    }

    try {
        const records = await database.getPresenceMessages();
        const normalized = records
            .map(record => {
                const activityType = resolveActivityType(record.type);
                return typeof record.message === 'string'
                    ? { message: record.message.trim(), type: activityType }
                    : null;
            })
            .filter(entry => entry && entry.message.length);

        if (normalized.length) {
            rotatingStatusMessages = normalized;
            rotatingStatusIndex = Math.floor(Math.random() * rotatingStatusMessages.length);
            console.log(`Loaded ${normalized.length} custom presence message(s) from MongoDB.`);
            return true;
        }
    } catch (error) {
        console.error('Failed to load custom presence messages:', error);
    }

    if (forceFallback) {
        rotatingStatusMessages = [...DEFAULT_STATUS_MESSAGES];
        rotatingStatusIndex = rotatingStatusMessages.length
            ? Math.floor(Math.random() * rotatingStatusMessages.length)
            : 0;
    }
    return false;
}

function extractBearerToken(req) {
    const healthTokenHeader = req.headers?.['x-health-token'];
    if (typeof healthTokenHeader === 'string' && healthTokenHeader.trim()) {
        return healthTokenHeader.trim();
    }

    const authHeader = req.headers?.authorization;
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
        return authHeader.slice(7).trim();
    }
    if (typeof req.query?.token === 'string') {
        return req.query.token;
    }
    return null;
}

function isRenderHealthCheck(req) {
    const ua = String(req.headers?.['user-agent'] || '').toLowerCase();
    if (ua.includes('render/health')) return true;

    const forwardedFor = String(req.headers?.['x-forwarded-for'] || '')
        .split(',')[0]
        .trim();
    if (forwardedFor.startsWith('10.') || forwardedFor === '127.0.0.1' || forwardedFor === '::1') {
        return true;
    }

    const remoteAddr = (req.ip || '').replace('::ffff:', '');
    return remoteAddr === '127.0.0.1' || remoteAddr === '::1';
}

function isRenderHealthUserAgent(req) {
    const ua = String(req.headers?.['user-agent'] || '').toLowerCase();
    return ua.includes('render/health');
}

let lastStatusIndex = -1;

const getNextRotatingStatus = () => {
    if (!rotatingStatusMessages.length) {
        return { message: 'Calibrating Stark Industries protocols.' };
    }

    // Ensure we never get the same status twice in a row
    let nextIndex;
    if (rotatingStatusMessages.length === 1) {
        nextIndex = 0;
    } else {
        do {
            nextIndex = Math.floor(Math.random() * rotatingStatusMessages.length);
        } while (nextIndex === lastStatusIndex);
    }

    lastStatusIndex = nextIndex;
    rotatingStatusIndex = nextIndex;
    return rotatingStatusMessages[nextIndex];
};

const updateBotPresence = () => {
    if (!client?.user) {
        return;
    }

    const { message, type } = getNextRotatingStatus();
    const activity = { name: message };
    if (typeof type !== 'undefined') {
        activity.type = type;
    }

    try {
        client.user.setPresence({
            status: 'online',
            activities: [activity],
            afk: false
        });
    } catch (error) {
        console.error('Failed to update bot presence:', error);
    }
};

function buildProviderDigestResponse(providers = []) {
    const list = Array.isArray(providers) ? providers : [];
    const total = list.length;
    const online = list.filter(p => !p.hasError && !p.isDisabled).length;
    const errored = list.filter(p => p.hasError).length;
    const disabled = list.filter(p => p.isDisabled).length;
    const latencySamples = list
        .map(p => p.metrics?.avgLatencyMs)
        .filter(value => Number.isFinite(value) && value > 0);
    const avgLatencyMs = latencySamples.length
        ? Math.round(latencySamples.reduce((sum, value) => sum + value, 0) / latencySamples.length)
        : null;

    const fastestProviders = list
        .filter(p => Number.isFinite(p.metrics?.avgLatencyMs))
        .sort((a, b) => a.metrics.avgLatencyMs - b.metrics.avgLatencyMs)
        .slice(0, 5)
        .map(p => ({
            name: p.name,
            type: p.type,
            family: p.family || null,
            avgLatencyMs: Math.round(p.metrics.avgLatencyMs),
            successRate: p.metrics?.successRate
        }));

    const issueCandidates = list
        .filter(p => p.hasError || p.isDisabled)
        .sort((a, b) => {
            const failuresA = a.metrics?.failures || 0;
            const failuresB = b.metrics?.failures || 0;
            return failuresB - failuresA;
        })
        .slice(0, 5)
        .map(p => ({
            name: p.name,
            type: p.type,
            status: p.isDisabled ? 'disabled' : 'error',
            lastError: p.lastError || null,
            disabledUntil: p.disabledUntil || null
        }));

    return {
        generatedAt: new Date().toISOString(),
        summary: {
            total,
            online,
            errored,
            disabled,
            avgLatencyMs
        },
        fastestProviders,
        issueCandidates
    };
}

// ------------------------ Slash Command Registration ------------------------
const allCommands = [
    new SlashCommandBuilder()
        .setName('jarvis')
        .setDescription("Interact with Jarvis, Tony Stark's AI assistant")
        .addStringOption(option =>
            option.setName('prompt').setDescription('Your message to Jarvis').setRequired(true)
        )
        .addAttachmentOption(option =>
            option
                .setName('image')
                .setDescription('Optional image for Jarvis to analyze (jpg, png, webp)')
                .setRequired(false)
        )
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    new SlashCommandBuilder()
        .setName('status')
        .setDescription("Check Jarvis's system status")
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    new SlashCommandBuilder()
        .setName('time')
        .setDescription('Get the current time in your timezone')
        .addStringOption(option =>
            option
                .setName('format')
                .setDescription('Time format to display')
                .setRequired(false)
                .addChoices(
                    { name: 'Time only', value: 't' },
                    { name: 'Time with seconds', value: 'T' },
                    { name: 'Short date', value: 'd' },
                    { name: 'Long date', value: 'D' },
                    { name: 'Short date/time', value: 'f' },
                    { name: 'Long date/time', value: 'F' },
                    { name: 'Relative time', value: 'R' }
                )
        )
        .setContexts([InteractionContextType.Guild]),
    new SlashCommandBuilder()
        .setName('providers')
        .setDescription('List available AI providers')
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    new SlashCommandBuilder()
        .setName('joke')
        .setDescription('Pull a random safe-mode joke')
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    new SlashCommandBuilder()
        .setName('features')
        .setDescription('Show which Jarvis modules are enabled globally and within this server')
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    new SlashCommandBuilder()
        .setName('yt')
        .setDescription('Search YouTube for a video')
        .addStringOption(option =>
            option.setName('query').setDescription('Video search terms').setRequired(true)
        )
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    new SlashCommandBuilder()
        .setName('search')
        .setDescription('Run a Jarvis web search')
        .addStringOption(option =>
            option.setName('query').setDescription('What should I look up?').setRequired(true)
        )
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    new SlashCommandBuilder()
        .setName('math')
        .setDescription('Solve a math expression or equation')
        .addStringOption(option =>
            option.setName('expression').setDescription('Expression to evaluate').setRequired(true)
        )
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    // ============ FUN COMMANDS ============
    new SlashCommandBuilder()
        .setName('aatrox')
        .setDescription('GYAATROX')
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    new SlashCommandBuilder()
        .setName('roast')
        .setDescription('50/50 chance to get roasted or blessed')
        .addUserOption(option =>
            option.setName('user').setDescription('Who to target').setRequired(false)
        )
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    new SlashCommandBuilder()
        .setName('wiki')
        .setDescription('Generate a fake Wikipedia entry for someone')
        .addUserOption(option =>
            option.setName('user').setDescription('Who to wikify').setRequired(false)
        )
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    new SlashCommandBuilder()
        .setName('conspiracy')
        .setDescription('Generate a conspiracy theory about someone')
        .addUserOption(option =>
            option.setName('user').setDescription('Who is the subject').setRequired(false)
        )
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    new SlashCommandBuilder()
        .setName('vibecheck')
        .setDescription("Check someone's vibes with detailed stats")
        .addUserOption(option =>
            option.setName('user').setDescription('Who to vibe check').setRequired(false)
        )
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    new SlashCommandBuilder()
        .setName('wyr')
        .setDescription('Would You Rather - get a random dilemma')
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    new SlashCommandBuilder()
        .setName('prophecy')
        .setDescription("Receive a prophecy about someone's future")
        .addUserOption(option =>
            option.setName('user').setDescription('Who to prophesy about').setRequired(false)
        )
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    new SlashCommandBuilder()
        .setName('fakequote')
        .setDescription('Generate a fake inspirational quote')
        .addUserOption(option =>
            option.setName('user').setDescription('Who said it').setRequired(false)
        )
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    new SlashCommandBuilder()
        .setName('trial')
        .setDescription('Put someone on trial for fake crimes')
        .addUserOption(option =>
            option.setName('user').setDescription('The defendant').setRequired(true)
        )
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    new SlashCommandBuilder()
        .setName('typerace')
        .setDescription('Start a typing race - first to type the phrase wins!')
        .setContexts([InteractionContextType.Guild]),
    // ============ MORE FUN COMMANDS ============
    new SlashCommandBuilder()
        .setName('rps')
        .setDescription('Challenge someone to Rock Paper Scissors!')
        .addUserOption(option =>
            option.setName('opponent').setDescription('Who to challenge').setRequired(false)
        )
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    new SlashCommandBuilder()
        .setName('ship')
        .setDescription('Calculate the compatibility between two people')
        .addUserOption(option =>
            option.setName('person1').setDescription('First person').setRequired(true)
        )
        .addUserOption(option =>
            option.setName('person2').setDescription('Second person').setRequired(false)
        )
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    new SlashCommandBuilder()
        .setName('howgay')
        .setDescription('Calculate how gay someone is (just for fun)')
        .addUserOption(option =>
            option.setName('user').setDescription('Who to check').setRequired(false)
        )
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    new SlashCommandBuilder()
        .setName('howbased')
        .setDescription('Calculate how based someone is')
        .addUserOption(option =>
            option.setName('user').setDescription('Who to check').setRequired(false)
        )
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    new SlashCommandBuilder()
        .setName('pickupline')
        .setDescription('Get a random pickup line (cringe guaranteed)')
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    new SlashCommandBuilder()
        .setName('dadjoke')
        .setDescription('Get a random dad joke')
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    new SlashCommandBuilder()
        .setName('fight')
        .setDescription('Start a fight with someone')
        .addUserOption(option =>
            option.setName('opponent').setDescription('Who to fight').setRequired(true)
        )
        .setContexts([InteractionContextType.Guild]),
    new SlashCommandBuilder()
        .setName('hug')
        .setDescription('Give someone a hug')
        .addUserOption(option =>
            option.setName('user').setDescription('Who to hug').setRequired(true)
        )
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    new SlashCommandBuilder()
        .setName('slap')
        .setDescription('Slap someone')
        .addUserOption(option =>
            option.setName('user').setDescription('Who to slap').setRequired(true)
        )
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    new SlashCommandBuilder()
        .setName('roll')
        .setDescription('Roll dice (e.g., 2d6, 1d20)')
        .addStringOption(option =>
            option
                .setName('dice')
                .setDescription('Dice notation (e.g., 2d6, 1d20)')
                .setRequired(false)
        )
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    new SlashCommandBuilder()
        .setName('choose')
        .setDescription('Let Jarvis choose between options')
        .addStringOption(option =>
            option
                .setName('options')
                .setDescription('Options separated by commas')
                .setRequired(true)
        )
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    new SlashCommandBuilder()
        .setName('afk')
        .setDescription('Set your AFK status')
        .addStringOption(option =>
            option.setName('reason').setDescription('Why are you AFK?').setRequired(false)
        )
        .setContexts([InteractionContextType.Guild]),
    new SlashCommandBuilder()
        .setName('rate')
        .setDescription('Rate something or someone')
        .addStringOption(option =>
            option.setName('thing').setDescription('What to rate').setRequired(true)
        )
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    new SlashCommandBuilder()
        .setName('8ball')
        .setDescription('Ask the magic 8-ball a question')
        .addStringOption(option =>
            option.setName('question').setDescription('Your question').setRequired(true)
        )
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    new SlashCommandBuilder()
        .setName('achievements')
        .setDescription('View your achievements and progress')
        .addStringOption(option =>
            option
                .setName('category')
                .setDescription('Filter by category')
                .setRequired(false)
                .addChoices(
                    { name: 'Getting Started', value: 'Getting Started' },
                    { name: 'Rap Battle', value: 'Rap Battle' },
                    { name: 'Economy', value: 'Economy' },
                    { name: 'Social', value: 'Social' },
                    { name: 'Fun', value: 'Fun' },
                    { name: 'Activity', value: 'Activity' },
                    { name: 'Special', value: 'Special' },
                    { name: 'Milestones', value: 'Milestones' }
                )
        )
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription("View someone else's achievements")
                .setRequired(false)
        )
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    new SlashCommandBuilder()
        .setName('crypto')
        .setDescription('Retrieve live cryptocurrency market data')
        .addStringOption(option =>
            option
                .setName('coin')
                .setDescription('Which asset should I analyse?')
                .setRequired(true)
                .addChoices(
                    { name: 'Bitcoin (BTC)', value: 'BTC' },
                    { name: 'Ethereum (ETH)', value: 'ETH' },
                    { name: 'BNB (BNB)', value: 'BNB' },
                    { name: 'Solana (SOL)', value: 'SOL' },
                    { name: 'XRP (XRP)', value: 'XRP' },
                    { name: 'Cardano (ADA)', value: 'ADA' },
                    { name: 'Dogecoin (DOGE)', value: 'DOGE' },
                    { name: 'Polygon (MATIC)', value: 'MATIC' }
                )
        )
        .addStringOption(option =>
            option
                .setName('convert')
                .setDescription('Fiat currency to convert into (defaults to USD)')
                .setRequired(false)
                .addChoices(
                    { name: 'US Dollar (USD)', value: 'USD' },
                    { name: 'Euro (EUR)', value: 'EUR' },
                    { name: 'British Pound (GBP)', value: 'GBP' },
                    { name: 'Japanese Yen (JPY)', value: 'JPY' },
                    { name: 'Australian Dollar (AUD)', value: 'AUD' }
                )
        )
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    new SlashCommandBuilder()
        .setName('opt')
        .setDescription('Manage whether Jarvis retains your memories')
        .addStringOption(option =>
            option
                .setName('mode')
                .setDescription('Choose whether to opt-in or opt-out of memory storage')
                .setRequired(true)
                .addChoices(
                    { name: 'Opt in to memory storage', value: 'in' },
                    { name: 'Opt out of memory storage', value: 'out' }
                )
        )
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    new SlashCommandBuilder()
        .setName('mission')
        .setDescription('Receive a fresh Stark Industries daily directive')
        .addBooleanOption(option =>
            option
                .setName('refresh')
                .setDescription('Request a new mission (cooldown enforced)')
                .setRequired(false)
        )
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    new SlashCommandBuilder()
        .setName('memory')
        .setDescription('Inspect your stored Jarvis memories')
        .addIntegerOption(option =>
            option
                .setName('entries')
                .setDescription('Number of entries to review (1-30)')
                .setRequired(false)
                .setMinValue(1)
                .setMaxValue(30)
        )
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    new SlashCommandBuilder()
        .setName('reset')
        .setDescription('Delete your conversation history and profile with Jarvis')
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    new SlashCommandBuilder()
        .setName('help')
        .setDescription('Show Jarvis command overview')
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    new SlashCommandBuilder()
        .setName('invite')
        .setDescription('Grab the Jarvis HQ support server invite')
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    new SlashCommandBuilder()
        .setName('profile')
        .setDescription('View or update your Jarvis profile')
        .addSubcommand(subcommand =>
            subcommand.setName('show').setDescription('Display your saved profile information')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('set')
                .setDescription('Update one of your profile preferences')
                .addStringOption(option =>
                    option
                        .setName('key')
                        .setDescription('Preference key to update')
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option
                        .setName('value')
                        .setDescription('Value to store for the preference')
                        .setRequired(true)
                )
        )
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    new SlashCommandBuilder()
        .setName('history')
        .setDescription('Review your recent prompts')
        .addIntegerOption(option =>
            option
                .setName('count')
                .setDescription('How many prompts to show (max 20)')
                .setRequired(false)
        )
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    new SlashCommandBuilder()
        .setName('recap')
        .setDescription('Get a quick activity summary')
        .addStringOption(option =>
            option
                .setName('window')
                .setDescription('How far back to look')
                .setRequired(false)
                .addChoices(
                    { name: 'Last 6 hours', value: '6h' },
                    { name: 'Last 12 hours', value: '12h' },
                    { name: 'Last 24 hours', value: '24h' },
                    { name: 'Last 7 days', value: '7d' }
                )
        )
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    new SlashCommandBuilder()
        .setName('digest')
        .setDescription('Summarize recent activity for this server')
        .addStringOption(option =>
            option
                .setName('window')
                .setDescription('Time range to summarize')
                .setRequired(false)
                .addChoices(
                    { name: 'Last 6 hours', value: '6h' },
                    { name: 'Last 24 hours', value: '24h' },
                    { name: 'Last 7 days', value: '7d' }
                )
        )
        .addIntegerOption(option =>
            option
                .setName('highlights')
                .setDescription('Approximate number of highlights to surface (default 5)')
                .setRequired(false)
                .setMinValue(3)
                .setMaxValue(10)
        )
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    new SlashCommandBuilder()
        .setName('decode')
        .setDescription('Decode encoded text')
        .addStringOption(option =>
            option.setName('text').setDescription('The text to decode').setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName('format')
                .setDescription('Encoding to decode from (default: auto)')
                .setRequired(false)
                .addChoices(
                    { name: 'Auto detect', value: 'auto' },
                    { name: 'Base64', value: 'base64' },
                    { name: 'Base32', value: 'base32' },
                    { name: 'Base58', value: 'base58' },
                    { name: 'Hexadecimal', value: 'hex' },
                    { name: 'Binary', value: 'binary' },
                    { name: 'URL-encoded', value: 'url' },
                    { name: 'ROT13', value: 'rot13' },
                    { name: 'Punycode', value: 'punycode' },
                    { name: 'Morse code', value: 'morse' }
                )
        )
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    new SlashCommandBuilder()
        .setName('encode')
        .setDescription('Encode plain text')
        .addStringOption(option =>
            option.setName('text').setDescription('The text to encode').setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName('format')
                .setDescription('Encoding format (default: base64)')
                .setRequired(false)
                .addChoices(
                    { name: 'Base64', value: 'base64' },
                    { name: 'Base32', value: 'base32' },
                    { name: 'Base58', value: 'base58' },
                    { name: 'Hexadecimal', value: 'hex' },
                    { name: 'Binary', value: 'binary' },
                    { name: 'URL-encoded', value: 'url' },
                    { name: 'ROT13', value: 'rot13' },
                    { name: 'Punycode', value: 'punycode' },
                    { name: 'Morse code', value: 'morse' }
                )
        )
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    new SlashCommandBuilder()
        .setName('bonk')
        .setDescription('Deliver a comedic corrective bonk')
        .addUserOption(option =>
            option.setName('target').setDescription('Who deserves the bonk?').setRequired(true)
        )
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    new SlashCommandBuilder()
        .setName('banter')
        .setDescription('Trade a line of Stark-grade banter')
        .addUserOption(option =>
            option
                .setName('target')
                .setDescription('Optional recipient of the banter')
                .setRequired(false)
        )
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    new SlashCommandBuilder()
        .setName('flatter')
        .setDescription('Deliver premium Jarvis-approved praise')
        .addUserOption(option =>
            option.setName('target').setDescription('Optional honoree').setRequired(false)
        )
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    new SlashCommandBuilder()
        .setName('toast')
        .setDescription('Raise a cinematic toast to an ally')
        .addUserOption(option =>
            option.setName('target').setDescription('Optional honoree').setRequired(false)
        )
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    new SlashCommandBuilder()
        .setName('trivia')
        .setDescription('Challenge yourself with Stark trivia')
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    new SlashCommandBuilder()
        .setName('cipher')
        .setDescription('Crack a rotating Stark cipher')
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    new SlashCommandBuilder()
        .setName('scramble')
        .setDescription('Unscramble a Stark Industries keyword')
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    // ============ SOUL & SELFHOST ============
    new SlashCommandBuilder()
        .setName('soul')
        .setDescription("View Jarvis's artificial soul status and evolution")
        .addSubcommand(sub =>
            sub.setName('status').setDescription('Check current soul state and traits')
        )
        .addSubcommand(sub =>
            sub
                .setName('evolve')
                .setDescription('Trigger a soul evolution event')
                .addStringOption(option =>
                    option
                        .setName('type')
                        .setDescription('Type of evolution')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Joke interaction', value: 'joke' },
                            { name: 'Deep conversation', value: 'deep_conversation' },
                            { name: 'Roast session', value: 'roast' },
                            { name: 'Chaos mode', value: 'chaos' },
                            { name: 'Helpful moment', value: 'helpful' }
                        )
                )
        )
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    // ============ STARK BUCKS ECONOMY ============
    new SlashCommandBuilder()
        .setName('balance')
        .setDescription('Check your Stark Bucks balance and stats')
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    new SlashCommandBuilder()
        .setName('daily')
        .setDescription('Claim your daily Stark Bucks reward')
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    new SlashCommandBuilder()
        .setName('work')
        .setDescription('Work at Stark Industries for some Stark Bucks')
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    new SlashCommandBuilder()
        .setName('gamble')
        .setDescription('Gamble your Stark Bucks (double or nothing)')
        .addIntegerOption(option =>
            option
                .setName('amount')
                .setDescription('Amount to gamble')
                .setRequired(true)
                .setMinValue(1)
        )
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    new SlashCommandBuilder()
        .setName('slots')
        .setDescription('Play the Stark Industries slot machine')
        .addIntegerOption(option =>
            option
                .setName('bet')
                .setDescription('Bet amount (min 10)')
                .setRequired(true)
                .setMinValue(10)
        )
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    new SlashCommandBuilder()
        .setName('coinflip')
        .setDescription('Flip a coin and bet on the outcome')
        .addIntegerOption(option =>
            option.setName('bet').setDescription('Bet amount').setRequired(true).setMinValue(1)
        )
        .addStringOption(option =>
            option
                .setName('choice')
                .setDescription('Heads or tails?')
                .setRequired(true)
                .addChoices({ name: 'Heads', value: 'heads' }, { name: 'Tails', value: 'tails' })
        )
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    new SlashCommandBuilder()
        .setName('shop')
        .setDescription('Browse the Stark Industries shop')
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    new SlashCommandBuilder()
        .setName('buy')
        .setDescription('Buy an item from the shop')
        .addStringOption(option =>
            option
                .setName('item')
                .setDescription('Item ID to buy')
                .setRequired(true)
                .addChoices(
                    { name: '⭐ VIP Badge (500)', value: 'vip_badge' },
                    { name: '✨ Golden Name (1000)', value: 'golden_name' },
                    { name: '🍀 Lucky Charm (200)', value: 'lucky_charm' },
                    { name: '2️⃣ Double Daily (150)', value: 'double_daily' },
                    { name: '🛡️ Shield (300)', value: 'shield' },
                    { name: '☕ Stark Coffee (100)', value: 'stark_coffee' },
                    { name: '💠 Arc Reactor (10000)', value: 'arc_reactor' }
                )
        )
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('View the Stark Bucks leaderboard')
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    new SlashCommandBuilder()
        .setName('show')
        .setDescription('Show off your Stark Bucks balance to everyone!')
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    new SlashCommandBuilder()
        .setName('hunt')
        .setDescription('Hunt for animals and earn Stark Bucks')
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    new SlashCommandBuilder()
        .setName('fish')
        .setDescription('Go fishing and earn Stark Bucks')
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    new SlashCommandBuilder()
        .setName('dig')
        .setDescription('Dig for treasure and earn Stark Bucks')
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    new SlashCommandBuilder()
        .setName('beg')
        .setDescription('Beg for Stark Bucks (no shame)')
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    new SlashCommandBuilder()
        .setName('give')
        .setDescription('Give Stark Bucks to another user')
        .addUserOption(option =>
            option.setName('user').setDescription('User to give money to').setRequired(true)
        )
        .addIntegerOption(option =>
            option
                .setName('amount')
                .setDescription('Amount to give')
                .setRequired(true)
                .setMinValue(1)
        )
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    new SlashCommandBuilder()
        .setName('crime')
        .setDescription('Commit a crime for money (risky!)')
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    new SlashCommandBuilder()
        .setName('postmeme')
        .setDescription('Post a meme and hope it goes viral')
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    new SlashCommandBuilder()
        .setName('searchlocation')
        .setDescription('Search a location for money')
        .addStringOption(option =>
            option
                .setName('location')
                .setDescription('Where to search')
                .setRequired(false)
                .addChoices(
                    { name: "Tony's couch cushions", value: '0' },
                    { name: 'Stark Industries dumpster', value: '1' },
                    { name: "Happy's car", value: '2' },
                    { name: 'Avengers compound', value: '3' }
                )
        )
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    // ============ SELFHOST-ONLY COMMANDS ============
    new SlashCommandBuilder()
        .setName('selfmod')
        .setDescription('Jarvis self-modification analysis (read-only)')
        .addSubcommand(sub =>
            sub.setName('status').setDescription('Check self-modification system status')
        )
        .addSubcommand(sub =>
            sub
                .setName('analyze')
                .setDescription('Analyze a source file for improvements')
                .addStringOption(option =>
                    option
                        .setName('file')
                        .setDescription(
                            'Relative file path to analyze (e.g., src/services/jarvis-core.js)'
                        )
                        .setRequired(true)
                )
        )
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    new SlashCommandBuilder()
        .setName('sentient')
        .setDescription('Jarvis Sentient Agent System (selfhost only)')
        .addSubcommand(sub => sub.setName('status').setDescription('View sentient agent status'))
        .addSubcommand(sub =>
            sub
                .setName('think')
                .setDescription('Have Jarvis think about something')
                .addStringOption(option =>
                    option
                        .setName('prompt')
                        .setDescription('What should Jarvis think about?')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('execute')
                .setDescription('Execute a command (with safety checks)')
                .addStringOption(option =>
                    option
                        .setName('command')
                        .setDescription('Shell command to execute')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('memory').setDescription('View agent memory and learnings')
        )
        .addSubcommand(sub =>
            sub
                .setName('autonomous')
                .setDescription('Toggle autonomous mode (⚠️ careful!)')
                .addBooleanOption(option =>
                    option
                        .setName('enabled')
                        .setDescription('Enable autonomous mode?')
                        .setRequired(true)
                )
        )
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    // ============ END SELFHOST-ONLY COMMANDS ============
    new SlashCommandBuilder()
        .setName('news')
        .setDescription('Fetch curated headlines for a topic')
        .addStringOption(option =>
            option
                .setName('topic')
                .setDescription('Which news desk to pull from')
                .setRequired(false)
                .addChoices(
                    { name: 'Technology', value: 'technology' },
                    { name: 'Artificial Intelligence', value: 'ai' },
                    { name: 'Gaming', value: 'gaming' },
                    { name: 'Crypto', value: 'crypto' },
                    { name: 'Science', value: 'science' },
                    { name: 'World', value: 'world' }
                )
        )
        .addBooleanOption(option =>
            option
                .setName('fresh')
                .setDescription('Bypass cache and fetch fresh headlines')
                .setRequired(false)
        )
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    new SlashCommandBuilder()
        .setName('clip')
        .setDescription('Clip a message into an image')
        .addStringOption(option =>
            option
                .setName('message_id')
                .setDescription('ID of the message to clip')
                .setRequired(true)
        )
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    new SlashCommandBuilder()
        .setName('caption')
        .setDescription('Add a meme caption above an image')
        .addStringOption(option =>
            option
                .setName('text')
                .setDescription('Caption text (max 200 characters)')
                .setRequired(true)
                .setMaxLength(200)
        )
        .addStringOption(option =>
            option
                .setName('url')
                .setDescription('Image/GIF URL (Tenor and direct links supported)')
                .setRequired(false)
        )
        .addAttachmentOption(option =>
            option.setName('image').setDescription('Image to caption').setRequired(false)
        )
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    new SlashCommandBuilder()
        .setName('meme')
        .setDescription('Generate meme variants')
        .addSubcommand(sub =>
            sub
                .setName('impact')
                .setDescription('Classic impact meme with top/bottom text')
                .addAttachmentOption(option =>
                    option.setName('image').setDescription('Image to memeify').setRequired(false)
                )
                .addStringOption(option =>
                    option
                        .setName('url')
                        .setDescription('Image/GIF URL (Tenor and direct links supported)')
                        .setRequired(false)
                )
                .addStringOption(option =>
                    option
                        .setName('top')
                        .setDescription('Top text (optional)')
                        .setRequired(false)
                        .setMaxLength(120)
                )
                .addStringOption(option =>
                    option
                        .setName('bottom')
                        .setDescription('Bottom text (optional)')
                        .setRequired(false)
                        .setMaxLength(120)
                )
        )
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    new SlashCommandBuilder()
        .setName('ask')
        .setDescription('Query the server knowledge base for an answer')
        .addStringOption(option =>
            option.setName('query').setDescription('What would you like to know?').setRequired(true)
        )
        .setContexts([InteractionContextType.Guild]),
    new SlashCommandBuilder()
        .setName('macro')
        .setDescription('Send reusable knowledge base responses')
        .addSubcommand(sub =>
            sub
                .setName('list')
                .setDescription('List macros available for this server')
                .addStringOption(option =>
                    option.setName('tag').setDescription('Filter macros by tag').setRequired(false)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('send')
                .setDescription('Send a macro response from the knowledge base')
                .addStringOption(option =>
                    option
                        .setName('entry_id')
                        .setDescription('Knowledge base entry identifier to send')
                        .setRequired(false)
                )
                .addStringOption(option =>
                    option
                        .setName('tag')
                        .setDescription('Fallback tag if entry id is not provided')
                        .setRequired(false)
                )
                .addChannelOption(option =>
                    option
                        .setName('channel')
                        .setDescription('Channel to send the macro to (defaults to here)')
                        .setRequired(false)
                        .addChannelTypes(ChannelType.GuildText)
                )
        )
        .setContexts([InteractionContextType.Guild]),

    new SlashCommandBuilder()
        .setName('reactionrole')
        .setDescription('Manage reaction role panels')
        .addSubcommand(subcommand =>
            subcommand
                .setName('create')
                .setDescription('Create a reaction role panel')
                .addChannelOption(option =>
                    option
                        .setName('channel')
                        .setDescription('Channel where the panel will be posted')
                        .setRequired(true)
                        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                )
                .addStringOption(option =>
                    option
                        .setName('pairs')
                        .setDescription('Emoji-role pairs, e.g. 😀 @Role, 😎 @AnotherRole')
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option.setName('title').setDescription('Panel title').setRequired(false)
                )
                .addStringOption(option =>
                    option
                        .setName('description')
                        .setDescription('Panel description')
                        .setRequired(false)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Remove a reaction role panel')
                .addStringOption(option =>
                    option
                        .setName('message')
                        .setDescription('Message ID or link to the panel')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('edit')
                .setDescription(
                    'Edit an existing reaction role panel (add roles, change title/description)'
                )
                .addStringOption(option =>
                    option
                        .setName('message')
                        .setDescription('Message ID or link to the panel to edit')
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option
                        .setName('add_pairs')
                        .setDescription(
                            'New emoji-role pairs to add, e.g. 😀 @Role, 😎 @AnotherRole'
                        )
                        .setRequired(false)
                )
                .addStringOption(option =>
                    option
                        .setName('title')
                        .setDescription('New panel title (leave empty to keep current)')
                        .setRequired(false)
                )
                .addStringOption(option =>
                    option
                        .setName('description')
                        .setDescription('New panel description (leave empty to keep current)')
                        .setRequired(false)
                )
                .addStringOption(option =>
                    option
                        .setName('remove_pairs')
                        .setDescription(
                            'Emojis to remove, e.g. 😀, 😎 (removes roles from users who have them)'
                        )
                        .setRequired(false)
                )
        )
        .addSubcommand(subcommand =>
            subcommand.setName('list').setDescription('List configured reaction role panels')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('setmods')
                .setDescription('Configure which roles may manage reaction roles')
                .addRoleOption(option =>
                    option
                        .setName('role1')
                        .setDescription('Allowed moderator role')
                        .setRequired(false)
                )
                .addRoleOption(option =>
                    option
                        .setName('role2')
                        .setDescription('Additional moderator role')
                        .setRequired(false)
                )
                .addRoleOption(option =>
                    option
                        .setName('role3')
                        .setDescription('Additional moderator role')
                        .setRequired(false)
                )
                .addRoleOption(option =>
                    option
                        .setName('role4')
                        .setDescription('Additional moderator role')
                        .setRequired(false)
                )
                .addRoleOption(option =>
                    option
                        .setName('role5')
                        .setDescription('Additional moderator role')
                        .setRequired(false)
                )
                .addBooleanOption(option =>
                    option
                        .setName('clear')
                        .setDescription('Clear moderator roles and revert to owner-only control')
                        .setRequired(false)
                )
        )
        .setContexts([InteractionContextType.Guild]),
    new SlashCommandBuilder()
        .setName('automod')
        .setDescription('Configure Jarvis auto moderation')
        .addSubcommand(subcommand =>
            subcommand.setName('status').setDescription('Show auto moderation status')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('enable')
                .setDescription('Enable auto moderation with the configured blacklist')
        )
        .addSubcommand(subcommand =>
            subcommand.setName('disable').setDescription('Disable auto moderation')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Add words to the blacklist')
                .addStringOption(option =>
                    option
                        .setName('words')
                        .setDescription('Comma or newline separated words')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Remove words from the blacklist')
                .addStringOption(option =>
                    option
                        .setName('words')
                        .setDescription('Comma or newline separated words')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('import')
                .setDescription('Import blacklist entries from a text file')
                .addAttachmentOption(option =>
                    option
                        .setName('file')
                        .setDescription('Plain text file with one word or phrase per line')
                        .setRequired(true)
                )
                .addBooleanOption(option =>
                    option
                        .setName('replace')
                        .setDescription('Replace the existing blacklist instead of merging')
                        .setRequired(false)
                )
        )
        .addSubcommand(subcommand =>
            subcommand.setName('list').setDescription('List configured blacklist entries')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('clear')
                .setDescription('Remove all blacklisted entries and disable auto moderation')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('setmessage')
                .setDescription('Set the custom message shown when blocking a message')
                .addStringOption(option =>
                    option
                        .setName('message')
                        .setDescription('Custom response shown to users')
                        .setRequired(true)
                )
        )
        .addSubcommandGroup(group =>
            group
                .setName('filter')
                .setDescription('Manage additional auto moderation filters')
                .addSubcommand(subcommand =>
                    subcommand
                        .setName('add')
                        .setDescription(
                            'Create a separate auto moderation rule with its own keywords'
                        )
                        .addStringOption(option =>
                            option
                                .setName('words')
                                .setDescription(
                                    'Comma or newline separated words for the new filter'
                                )
                                .setRequired(true)
                        )
                )
        )
        .setContexts([InteractionContextType.Guild]),
    new SlashCommandBuilder()
        .setName('serverstats')
        .setDescription('Manage Jarvis server statistics channels')
        .addSubcommand(subcommand =>
            subcommand
                .setName('status')
                .setDescription('Show the current server stats configuration')
        )
        .addSubcommand(subcommand =>
            subcommand.setName('enable').setDescription('Create or update server stats channels')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('refresh')
                .setDescription('Refresh the server stats counts immediately')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('report')
                .setDescription('Generate a snapshot report with charts')
                .addBooleanOption(option =>
                    option
                        .setName('public')
                        .setDescription('Post the report in the channel instead of privately')
                        .setRequired(false)
                )
        )
        .addSubcommand(subcommand =>
            subcommand.setName('disable').setDescription('Remove the server stats channels')
        )
        .setContexts([InteractionContextType.Guild]),
    new SlashCommandBuilder()
        .setName('memberlog')
        .setDescription('Configure Jarvis join and leave announcements')
        .addSubcommand(subcommand =>
            subcommand
                .setName('status')
                .setDescription('View the current join/leave log configuration')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('setchannel')
                .setDescription('Choose where Jarvis posts join and leave messages')
                .addChannelOption(option =>
                    option
                        .setName('channel')
                        .setDescription('Text channel for join/leave reports')
                        .setRequired(true)
                        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                )
        )
        .addSubcommand(subcommand =>
            subcommand.setName('enable').setDescription('Enable join and leave announcements')
        )
        .addSubcommand(subcommand =>
            subcommand.setName('disable').setDescription('Disable join and leave announcements')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('addvariation')
                .setDescription('Add a custom message variation')
                .addStringOption(option =>
                    option
                        .setName('type')
                        .setDescription('Which event to customize')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Join', value: 'join' },
                            { name: 'Leave', value: 'leave' }
                        )
                )
                .addStringOption(option =>
                    option
                        .setName('message')
                        .setDescription('Message text (supports placeholders like {mention})')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('removevariation')
                .setDescription('Remove a custom variation by its index')
                .addStringOption(option =>
                    option
                        .setName('type')
                        .setDescription('Which event to modify')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Join', value: 'join' },
                            { name: 'Leave', value: 'leave' }
                        )
                )
                .addIntegerOption(option =>
                    option
                        .setName('index')
                        .setDescription('Position from the status list to remove')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('setcustom')
                .setDescription('Set a single custom message that always sends')
                .addStringOption(option =>
                    option
                        .setName('type')
                        .setDescription('Which event to customize')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Join', value: 'join' },
                            { name: 'Leave', value: 'leave' }
                        )
                )
                .addStringOption(option =>
                    option
                        .setName('message')
                        .setDescription('Message text (supports placeholders like {mention})')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('clearcustom')
                .setDescription('Remove the custom message override')
                .addStringOption(option =>
                    option
                        .setName('type')
                        .setDescription('Which event to reset')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Join', value: 'join' },
                            { name: 'Leave', value: 'leave' }
                        )
                )
        )
        .setContexts([InteractionContextType.Guild]),
    // ============ USER FEATURES ============
    new SlashCommandBuilder()
        .setName('remind')
        .setDescription('Set a reminder for later')
        .addSubcommand(sub =>
            sub
                .setName('set')
                .setDescription('Create a new reminder')
                .addStringOption(opt =>
                    opt
                        .setName('message')
                        .setDescription('What to remind you about')
                        .setRequired(true)
                )
                .addStringOption(opt =>
                    opt
                        .setName('time')
                        .setDescription('When (e.g., "in 2 hours", "at 3pm", "tomorrow")')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub => sub.setName('list').setDescription('View your pending reminders'))
        .addSubcommand(sub =>
            sub
                .setName('cancel')
                .setDescription('Cancel a reminder')
                .addStringOption(opt =>
                    opt.setName('id').setDescription('Reminder ID to cancel').setRequired(true)
                )
        )
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    new SlashCommandBuilder()
        .setName('announcement')
        .setDescription('Schedule recurring announcements (DB-backed)')
        .addSubcommand(sub =>
            sub
                .setName('create')
                .setDescription('Create a new scheduled announcement')
                .addChannelOption(opt =>
                    opt
                        .setName('channel')
                        .setDescription('Channel to send in')
                        .setRequired(true)
                        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                )
                .addIntegerOption(opt =>
                    opt
                        .setName('in')
                        .setDescription('Send after this many units (e.g. 2)')
                        .setRequired(true)
                        .setMinValue(1)
                        .setMaxValue(525600)
                )
                .addStringOption(opt =>
                    opt
                        .setName('unit')
                        .setDescription('Unit for the delay')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Seconds', value: 'seconds' },
                            { name: 'Minutes', value: 'minutes' },
                            { name: 'Hours', value: 'hours' },
                            { name: 'Days', value: 'days' },
                            { name: 'Weeks', value: 'weeks' },
                            { name: 'Months', value: 'months' }
                        )
                )
                .addIntegerOption(opt =>
                    opt
                        .setName('every')
                        .setDescription('Repeat every N units (omit for one-time)')
                        .setRequired(false)
                        .setMinValue(1)
                        .setMaxValue(525600)
                )
                .addStringOption(opt =>
                    opt
                        .setName('every_unit')
                        .setDescription('Unit for repeat interval (required if every is set)')
                        .setRequired(false)
                        .addChoices(
                            { name: 'Seconds', value: 'seconds' },
                            { name: 'Minutes', value: 'minutes' },
                            { name: 'Hours', value: 'hours' },
                            { name: 'Days', value: 'days' },
                            { name: 'Weeks', value: 'weeks' },
                            { name: 'Months', value: 'months' }
                        )
                )
                .addRoleOption(opt =>
                    opt
                        .setName('role1')
                        .setDescription('Role to ping (optional)')
                        .setRequired(false)
                )
                .addRoleOption(opt =>
                    opt
                        .setName('role2')
                        .setDescription('Role to ping (optional)')
                        .setRequired(false)
                )
                .addRoleOption(opt =>
                    opt
                        .setName('role3')
                        .setDescription('Role to ping (optional)')
                        .setRequired(false)
                )
        )
        .addSubcommand(sub =>
            sub.setName('list').setDescription('List scheduled announcements for this server')
        )
        .addSubcommand(sub =>
            sub
                .setName('disable')
                .setDescription('Disable a scheduled announcement')
                .addStringOption(opt =>
                    opt.setName('id').setDescription('Announcement ID').setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('enable')
                .setDescription('Enable a scheduled announcement')
                .addStringOption(opt =>
                    opt.setName('id').setDescription('Announcement ID').setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('delete')
                .setDescription('Delete a scheduled announcement')
                .addStringOption(opt =>
                    opt.setName('id').setDescription('Announcement ID').setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('clear')
                .setDescription('Delete all scheduled announcements for this server')
                .addBooleanOption(opt =>
                    opt
                        .setName('confirm')
                        .setDescription('Confirm deletion of all announcements')
                        .setRequired(true)
                )
        )
        .setContexts([InteractionContextType.Guild]),
    new SlashCommandBuilder()
        .setName('monitor')
        .setDescription('Monitor websites, feeds, and channels.')
        .addSubcommand(sub =>
            sub
                .setName('rss')
                .setDescription('Monitor a general RSS or Atom feed for new items.')
                .addStringOption(opt =>
                    opt.setName('url').setDescription('RSS/Atom feed URL').setRequired(true)
                )
                .addChannelOption(opt =>
                    opt
                        .setName('channel')
                        .setDescription('Channel for alerts (defaults to current channel)')
                        .setRequired(false)
                        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('website')
                .setDescription('Monitor a URL for uptime (HTTP 200) and recovery.')
                .addStringOption(opt =>
                    opt.setName('url').setDescription('Website URL').setRequired(true)
                )
                .addChannelOption(opt =>
                    opt
                        .setName('channel')
                        .setDescription('Channel for alerts (defaults to current channel)')
                        .setRequired(false)
                        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('youtube')
                .setDescription('Monitor a YouTube channel for new videos.')
                .addStringOption(opt =>
                    opt
                        .setName('channel_id')
                        .setDescription('YouTube Channel ID (UC...)')
                        .setRequired(true)
                )
                .addChannelOption(opt =>
                    opt
                        .setName('channel')
                        .setDescription('Channel for alerts')
                        .setRequired(true)
                        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('twitch')
                .setDescription('Monitor a Twitch streamer for when they go live.')
                .addStringOption(opt =>
                    opt
                        .setName('username')
                        .setDescription("Streamer's username")
                        .setRequired(true)
                )
                .addChannelOption(opt =>
                    opt
                        .setName('channel')
                        .setDescription('Channel for alerts')
                        .setRequired(true)
                        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('cloudflare')
                .setDescription('Monitor Cloudflare status (components + incidents).')
                .addChannelOption(opt =>
                    opt
                        .setName('channel')
                        .setDescription('Channel for alerts (defaults to current channel)')
                        .setRequired(false)
                        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('statuspage')
                .setDescription('Monitor a Statuspage.io status page for updates.')
                .addStringOption(opt =>
                    opt
                        .setName('url')
                        .setDescription('Status page base URL (e.g. https://status.openai.com)')
                        .setRequired(true)
                )
                .addChannelOption(opt =>
                    opt
                        .setName('channel')
                        .setDescription('Channel for alerts (defaults to current channel)')
                        .setRequired(false)
                        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                )
        )
        .addSubcommand(sub =>
            sub.setName('list').setDescription('List active monitors for this server.')
        )
        .addSubcommand(sub =>
            sub.setName('status').setDescription('Show monitor scheduler status and active monitor counts.')
        )
        .addSubcommand(sub =>
            sub
                .setName('remove')
                .setDescription('Stop monitoring a specific source.')
                .addStringOption(opt =>
                    opt
                        .setName('source')
                        .setDescription('The URL / channel ID / username to remove')
                        .setRequired(true)
                )
        )
        .setContexts([InteractionContextType.Guild]),
    new SlashCommandBuilder()
        .setName('timezone')
        .setDescription('Set your timezone for reminders and time displays')
        .addStringOption(opt =>
            opt
                .setName('zone')
                .setDescription(
                    'Timezone (e.g., "America/New_York", "Europe/London", "Asia/Tokyo")'
                )
                .setRequired(false)
        )
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    new SlashCommandBuilder()
        .setName('wakeword')
        .setDescription('Set a custom wake word that triggers Jarvis for you')
        .addStringOption(opt =>
            opt
                .setName('word')
                .setDescription('Your custom wake word (2-20 characters, alphanumeric)')
                .setRequired(false)
        )
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    new SlashCommandBuilder()
        .setName('mystats')
        .setDescription('View your Jarvis interaction statistics')
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    ...musicCommandList.map(command => command.data)
];

const commands = allCommands.filter(builder => {
    const featureKey = commandFeatureMap.get(builder.name);
    return isFeatureGloballyEnabled(featureKey, true);
});

function buildCommandData() {
    return commands.map(command => command.toJSON());
}

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
    async () => {
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
    async () => {
        try {
            tempFiles.sweepExpired();
        } catch (error) {
            console.warn('Temp file sweep failed:', error);
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

// ------------------------ Uptime Server ------------------------
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);

let helmet = null;
try {
    helmet = require('helmet');
} catch {
    helmet = null;
}
if (helmet) {
    app.use(helmet());
} else {
    app.use((req, res, next) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('Referrer-Policy', 'no-referrer');
        next();
    });
}
app.use(cookieParser());
// Serve ephemeral temp files at short root paths like /123456789.png
app.get('/:id.:ext', (req, res, next) => {
    const { id, ext } = req.params;
    if (!/^[a-f0-9]{32}$/.test(id || '')) return next();
    if (!/^[a-z0-9]{1,8}$/i.test(ext || '')) return next();
    const filePath = require('path').join(tempFiles.TEMP_DIR, `${id}.${ext}`);
    const fs = require('fs');
    if (!fs.existsSync(filePath)) return next();
    const typeMap = {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        webp: 'image/webp',
        mp4: 'video/mp4',
        mp3: 'audio/mpeg',
        wav: 'audio/wav',
        bin: 'application/octet-stream',
        txt: 'text/plain'
    };
    const ctype = typeMap[ext.toLowerCase()] || 'application/octet-stream';
    res.setHeader('Content-Type', ctype);
    res.setHeader('Cache-Control', 'public, max-age=14400, immutable'); // 4 hours
    fs.createReadStream(filePath).pipe(res);
});

// Webhook forwarder requires raw body parsing for signature validation, so mount before json middleware
app.use('/webhook', webhookRouter);

const bodyLimit = process.env.JSON_BODY_LIMIT || '500kb';
app.use(express.json({ limit: bodyLimit }));
app.use(express.urlencoded({ extended: true, limit: bodyLimit }));

// Mount moderator dashboard routes
const moderatorRouter = require('./src/routes/moderator');
app.use('/moderator', moderatorRouter);

// Mount owner dashboard routes
const jarvisOwnerRouter = require('./src/routes/jarvis');
app.use('/jarvis', jarvisOwnerRouter);

// Mount Starkbucks routes (SBX exchange, store, transactions)
const starkbucksRouter = require('./routes/starkbucks');
app.use('/', starkbucksRouter);

// Mount legal pages (Privacy Policy, Terms of Service)
const legalRouter = require('./routes/legal');
app.use('/', legalRouter);

// Mount user authentication routes
const userAuthRouter = require('./routes/user-auth');
app.use('/', userAuthRouter);

// Mount user API routes
const userApiRouter = require('./routes/user-api');
app.use('/', userApiRouter);

// Mount user portal (/me) routes
const userPortalRouter = require('./routes/user-portal');
userPortalRouter.init(database);
app.use('/me', userPortalRouter);

// Mount public API v1 routes
const publicApiRouter = require('./routes/public-api');
app.use('/api/v1', publicApiRouter);

// Mount additional pages (commands, leaderboard, docs, changelog, sbx)
const pagesRouter = require('./routes/pages');
app.use('/', pagesRouter);

// Serve jarvis.gif from root
app.get('/jarvis.gif', (req, res) => {
    res.sendFile(path.join(__dirname, 'jarvis.gif'));
});

// Mount landing page (must be last to not override other routes)
const landingRouter = require('./routes/landing');
app.use('/', landingRouter);

// Mount dashboard API routes
const dashboardRouter = require('./routes/dashboard');

const dashboardLoginBuckets = new Map();
let dashboardLoginBucketsLastPruneAt = 0;
const DASHBOARD_LOGIN_BUCKET_PRUNE_INTERVAL_MS = 5 * 60 * 1000;
const DASHBOARD_LOGIN_BUCKET_MAX = Math.max(
    1000,
    Number(process.env.DASHBOARD_LOGIN_BUCKET_MAX || '') || 5000
);

function pruneDashboardLoginBuckets(now, windowMs) {
    if (now - dashboardLoginBucketsLastPruneAt < DASHBOARD_LOGIN_BUCKET_PRUNE_INTERVAL_MS) {
        return;
    }
    dashboardLoginBucketsLastPruneAt = now;

    for (const [key, bucket] of dashboardLoginBuckets.entries()) {
        const bucketWindowMs = Number(bucket?.windowMs || windowMs || 0);
        const bucketResetAt = Number(bucket?.resetAt || 0);
        const expiresAt = bucketResetAt + (Number.isFinite(bucketWindowMs) ? bucketWindowMs : 0);
        if (!bucketResetAt || !Number.isFinite(expiresAt) || now >= expiresAt) {
            dashboardLoginBuckets.delete(key);
        }
    }

    if (dashboardLoginBuckets.size > DASHBOARD_LOGIN_BUCKET_MAX) {
        const entries = Array.from(dashboardLoginBuckets.entries());
        entries.sort(
            (a, b) => Number(a?.[1]?.lastSeenAt || 0) - Number(b?.[1]?.lastSeenAt || 0)
        );
        const overflow = dashboardLoginBuckets.size - DASHBOARD_LOGIN_BUCKET_MAX;
        for (let i = 0; i < overflow; i += 1) {
            dashboardLoginBuckets.delete(entries[i][0]);
        }
    }
}

function isProductionLike() {
    if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
        return true;
    }

    return Boolean(process.env.RENDER || process.env.RENDER_SERVICE_ID || process.env.RENDER_EXTERNAL_URL);
}

function getClientIp(req) {
    const xf = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
    return xf || req.ip || req.connection?.remoteAddress || 'unknown';
}

function dashboardLoginRateLimit(req, res, next) {
    const ip = getClientIp(req);
    const key = `dashboard:login:${ip}`;
    const now = Date.now();
    const windowMs = 5 * 60 * 1000;
    const max = 10;

    pruneDashboardLoginBuckets(now, windowMs);

    const bucket = dashboardLoginBuckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
        dashboardLoginBuckets.set(key, {
            count: 1,
            resetAt: now + windowMs,
            windowMs,
            lastSeenAt: now
        });
        return next();
    }

    bucket.count += 1;
    bucket.lastSeenAt = now;
    if (bucket.count > max) {
        return res.status(429).json({ ok: false, error: 'rate_limited' });
    }

    return next();
}

function getDashboardPassword() {
    const candidates = [process.env.DASHBOARD_PASSWORD, process.env.PASSWORD];
    for (const raw of candidates) {
        const value = typeof raw === 'string' ? raw.trim() : '';
        if (value) return value;
    }
    return null;
}

function makeDashboardCookieValue(password) {
    return crypto.createHmac('sha256', password).update('jarvis.dashboard.auth.v1').digest('hex');
}

function timingSafeEqualHex(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    if (a.length !== b.length) return false;
    try {
        return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
    } catch {
        return false;
    }
}

function isDashboardAuthed(req) {
    const password = getDashboardPassword();
    if (!password) {
        return !isProductionLike();
    }
    const expected = makeDashboardCookieValue(password);
    const provided = req.cookies?.jarvis_dashboard_auth;
    return timingSafeEqualHex(String(provided || ''), expected);
}

function shouldUseSecureCookie(req) {
    const forwardedProto = String(req.headers?.['x-forwarded-proto'] || '').toLowerCase();
    return Boolean(req.secure || forwardedProto === 'https');
}

function setDashboardAuthCookie(req, res) {
    const password = getDashboardPassword();
    if (!password) return;
    const maxAgeMs = 10 * 24 * 60 * 60 * 1000;
    res.cookie('jarvis_dashboard_auth', makeDashboardCookieValue(password), {
        httpOnly: true,
        sameSite: 'lax',
        secure: shouldUseSecureCookie(req),
        maxAge: maxAgeMs,
        path: '/'
    });
}

function clearDashboardAuthCookie(res) {
    res.clearCookie('jarvis_dashboard_auth', { path: '/' });
}

function dashboardAuthMiddleware(req, res, next) {
    if (isDashboardAuthed(req)) return next();

    const accept = String(req.headers?.accept || '');
    const expectsHtml = accept.includes('text/html');
    if (expectsHtml) {
        return res.redirect('/dashboard/login');
    }

    return res.status(401).json({ ok: false, error: 'unauthorized' });
}

// Public health endpoint (no auth required) for /status page
app.get('/api/public/health', async (req, res) => {
    try {
        const uptime = Date.now() - (dashboardRouter.getBotStartTime?.() || Date.now());
        const hours = Math.floor(uptime / 3600000);
        const minutes = Math.floor((uptime % 3600000) / 60000);

        let discordStats = { guilds: 0, users: 0, channels: 0 };
        if (global.discordClient && global.discordClient.isReady()) {
            discordStats = {
                guilds: global.discordClient.guilds.cache.size,
                users: global.discordClient.guilds.cache.reduce((acc, g) => acc + g.memberCount, 0),
                channels: global.discordClient.channels.cache.size
            };
        }

        let aiStats = { totalRequests: 0, providers: 0, activeProviders: 0 };
        try {
            const aiManager = require('./src/services/ai-providers');
            aiStats = aiManager.getStats();
        } catch (e) {
            // Use defaults
        }

        res.json({
            status: 'healthy',
            uptime: `${hours}h ${minutes}m`,
            aiCalls: aiStats.totalRequests || 0,
            discord: discordStats,
            providers: aiStats.providers || 0,
            activeProviders: aiStats.activeProviders || 0
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.use('/api/dashboard', dashboardAuthMiddleware, dashboardRouter);

const dashboardDistPath = path.join(__dirname, 'dashboard', 'dist');
const dashboardAccessRouter = express.Router();

dashboardAccessRouter.get('/login', (req, res) => {
    if (isDashboardAuthed(req)) {
        return res.redirect('/dashboard');
    }

    const password = getDashboardPassword();
    if (!password && isProductionLike()) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.status(200).send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Jarvis Dashboard</title>
  <style>
    body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Arial; background: #0b0f17; color: #e6edf3; display: flex; min-height: 100vh; align-items: center; justify-content: center; }
    .card { width: min(560px, 92vw); background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; padding: 20px; box-shadow: 0 12px 40px rgba(0,0,0,0.35); }
    h1 { margin: 0 0 10px; font-size: 20px; }
    p { margin: 0 0 12px; opacity: 0.9; font-size: 13px; line-height: 1.45; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
    .error { margin-top: 10px; color: #ff7b72; font-size: 13px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Jarvis Dashboard</h1>
    <p class="error">Dashboard access is disabled because no password is configured.</p>
    <p>Set <code>DASHBOARD_PASSWORD</code> (or <code>PASSWORD</code>) and restart the server.</p>
  </div>
</body>
</html>`);
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Jarvis Dashboard Login</title>
  <style>
    body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Arial; background: #0b0f17; color: #e6edf3; display: flex; min-height: 100vh; align-items: center; justify-content: center; }
    .card { width: min(520px, 92vw); background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; padding: 20px; box-shadow: 0 12px 40px rgba(0,0,0,0.35); }
    h1 { margin: 0 0 6px; font-size: 20px; }
    p { margin: 0 0 14px; opacity: 0.9; font-size: 13px; }
    input { width: 100%; box-sizing: border-box; padding: 12px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.12); background: rgba(0,0,0,0.25); color: #e6edf3; outline: none; }
    input:focus { border-color: rgba(88,166,255,0.9); box-shadow: 0 0 0 3px rgba(88,166,255,0.15); }
    button { margin-top: 12px; width: 100%; padding: 12px; border-radius: 10px; border: 0; cursor: pointer; background: #1f6feb; color: white; font-weight: 600; }
    button:disabled { opacity: 0.6; cursor: not-allowed; }
    .error { margin-top: 10px; color: #ff7b72; min-height: 18px; font-size: 13px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Jarvis Dashboard</h1>
    <p>Enter the dashboard password to continue.</p>
    <form id="f">
      <input id="pw" type="password" autocomplete="current-password" placeholder="Password" required />
      <button id="btn" type="submit">Confirm</button>
      <div id="err" class="error"></div>
    </form>
  </div>
  <script>
    const f = document.getElementById('f');
    const pw = document.getElementById('pw');
    const btn = document.getElementById('btn');
    const err = document.getElementById('err');
    pw.focus();
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.textContent = '';
      btn.disabled = true;
      try {
        const res = await fetch('/dashboard/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pw.value })
        });
        if (res.ok) {
          window.location.href = '/dashboard';
          return;
        }
        err.textContent = 'Wrong password.';
      } catch (_) {
        err.textContent = 'Login failed.';
      } finally {
        btn.disabled = false;
      }
    });
  </script>
</body>
</html>`);
});

dashboardAccessRouter.post('/login', dashboardLoginRateLimit, (req, res) => {
    const password = getDashboardPassword();
    if (!password) {
        if (isProductionLike()) {
            clearDashboardAuthCookie(res);
            return res.status(503).json({ ok: false, error: 'password_not_configured' });
        }

        setDashboardAuthCookie(req, res);
        return res.json({ ok: true });
    }

    const provided = typeof req.body?.password === 'string' ? req.body.password.trim() : '';
    const ok = timingSafeEqualHex(
        makeDashboardCookieValue(password),
        makeDashboardCookieValue(provided)
    );
    if (!ok) {
        clearDashboardAuthCookie(res);
        return res.status(401).json({ ok: false });
    }

    setDashboardAuthCookie(req, res);
    return res.json({ ok: true });
});

dashboardAccessRouter.post('/logout', (req, res) => {
    clearDashboardAuthCookie(res);
    return res.json({ ok: true });
});

dashboardAccessRouter.use(dashboardAuthMiddleware);
dashboardAccessRouter.use(express.static(dashboardDistPath));
dashboardAccessRouter.get('/*', (req, res) => {
    res.sendFile(path.join(dashboardDistPath, 'index.html'));
});

app.use('/dashboard', dashboardAccessRouter);

// Mount diagnostics router (will be initialized with discordHandlers after client ready)
let diagnosticsRouter = null;
app.use('/diagnostics', (req, res, next) => {
    if (HEALTH_TOKEN) {
        const providedToken = extractBearerToken(req);
        if (providedToken !== HEALTH_TOKEN) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
    } else if (isProductionLike()) {
        return res.status(403).json({ error: 'Diagnostics disabled (set HEALTH_TOKEN)' });
    }

    if (!diagnosticsRouter) {
        return res.status(503).json({ error: 'Diagnostics not yet initialized' });
    }
    diagnosticsRouter(req, res, next);
});

// Status endpoint - ASCII Animation Page (moved from / to /status)
app.get('/status', async (req, res) => {
    // Fast-path only for Render's explicit health probe UA
    if (isRenderHealthUserAgent(req)) {
        return res.status(200).send('OK');
    }
    try {
        const snapshot = await gatherHealthSnapshot({
            includeProviders: true,
            redactProviders: true,
            pingDatabase: false
        });

        const providerStatus = snapshot.providers;
        const workingProviders = providerStatus.filter(p => !p.hasError && !p.isDisabled).length;
        const uptimeSeconds = Math.floor(snapshot.system.uptimeSeconds);
        const memory = snapshot.system.memory;
        const envRequiredCount = snapshot.env.required.filter(item => item.present).length;
        const envRequiredTotal = snapshot.env.required.length;
        const optionalConfigured = snapshot.env.optionalConfigured;
        const optionalTotal = snapshot.env.optionalTotal;
        const missingRequired = snapshot.env.required
            .filter(item => !item.present)
            .map(item => item.name);
        const optionalEnabled = snapshot.env.optional
            .filter(item => item.present)
            .map(item => item.name);
        const databaseStatus = snapshot.database;

        const providerList =
            providerStatus
                .map(provider => {
                    const uptimePercent =
                        provider.metrics.successRate != null
                            ? `${(provider.metrics.successRate * 100).toFixed(1)}%`
                            : 'n/a';
                    const latency = Number.isFinite(provider.metrics.avgLatencyMs)
                        ? `${Math.round(provider.metrics.avgLatencyMs)}ms`
                        : 'n/a';
                    let statusClass = 'online';
                    let statusLabel = '✅ OK';

                    if (provider.isDisabled) {
                        statusClass = 'offline';
                        statusLabel = '⛔ Paused';
                    } else if (provider.hasError) {
                        statusClass = 'warning';
                        statusLabel = '⚠️ Error';
                    }

                    const disabledInfo =
                        provider.isDisabled && provider.disabledUntil
                            ? ` • resumes ${new Date(provider.disabledUntil).toLocaleString()}`
                            : '';

                    return `
                        <div class="provider-item">
                            <div>
                                <div class="provider-name">${provider.name}</div>
                                <div class="provider-meta">Uptime ${uptimePercent} • Latency ${latency}${disabledInfo}</div>
                            </div>
                            <span class="provider-status ${statusClass}">${statusLabel}</span>
                        </div>`;
                })
                .join('') ||
            '<div class="provider-item"><span class="provider-name">No providers configured</span></div>';

        const _envSummaryLines = [
            `Required: ${envRequiredCount}/${envRequiredTotal}`,
            missingRequired.length ? `Missing: ${missingRequired.join(', ')}` : 'Missing: None',
            `Optional: ${optionalConfigured}/${optionalTotal}`,
            `Enabled: ${optionalEnabled.length}`,
            ...optionalEnabled.map(name => `- ${name}`)
        ].join('\n');

        const _dbLines = [
            `Connected: ${databaseStatus.connected ? '✅ Yes' : '❌ No'}`,
            `Ping: ${databaseStatus.ping}`,
            databaseStatus.error ? `Last error: ${databaseStatus.error}` : null
        ]
            .filter(Boolean)
            .join('\n');

        const uptimeText = `${Math.floor(uptimeSeconds / 3600)}h ${Math.floor((uptimeSeconds % 3600) / 60)}m ${uptimeSeconds % 60}s`;
        const memoryText = `${Math.round(memory.heapUsed / 1024 / 1024)}MB / ${Math.round(memory.heapTotal / 1024 / 1024)}MB`;

        res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Status | Jarvis</title>
    <meta name="theme-color" content="#00d4ff">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #0a0a1a 0%, #1a1a3e 50%, #0d0d2b 100%);
            color: #e4e4e4;
            min-height: 100vh;
        }
        nav {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 1.5rem 5%;
            max-width: 1400px;
            margin: 0 auto;
        }
        .logo {
            font-size: 1.8rem;
            font-weight: 700;
            background: linear-gradient(90deg, #00d4ff, #8a2be2);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            text-decoration: none;
        }
        .nav-links {
            display: flex;
            gap: 2rem;
            list-style: none;
        }
        .nav-links a {
            color: #b0b0b0;
            text-decoration: none;
            font-weight: 500;
            transition: color 0.3s;
        }
        .nav-links a:hover { color: #00d4ff; }
        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 2rem;
        }
        .header {
            text-align: center;
            margin-bottom: 3rem;
        }
        .header h1 {
            font-size: 2.5rem;
            background: linear-gradient(90deg, #fff, #00d4ff);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            margin-bottom: 0.5rem;
        }
        .status-badge {
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            padding: 0.5rem 1.5rem;
            background: rgba(46, 204, 113, 0.2);
            border: 1px solid #2ecc71;
            border-radius: 50px;
            color: #2ecc71;
            font-weight: 600;
        }
        .status-badge.warning {
            background: rgba(241, 196, 15, 0.2);
            border-color: #f1c40f;
            color: #f1c40f;
        }
        .status-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
            gap: 1.5rem;
            margin: 2rem 0;
        }
        .card {
            background: rgba(255,255,255,0.05);
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 16px;
            padding: 1.5rem;
        }
        .card h3 {
            color: #00d4ff;
            margin-bottom: 1rem;
            font-size: 1.1rem;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }
        .provider-list { max-height: 250px; overflow-y: auto; }
        .provider-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 0.75rem 0;
            border-bottom: 1px solid rgba(255,255,255,0.05);
        }
        .provider-item:last-child { border-bottom: none; }
        .provider-name { color: #fff; font-weight: 500; }
        .provider-meta { font-size: 0.8rem; color: #888; margin-top: 0.25rem; }
        .provider-status { font-weight: 600; font-size: 0.85rem; }
        .online { color: #2ecc71; }
        .offline { color: #e74c3c; }
        .warning { color: #f1c40f; }
        .stat-row {
            display: flex;
            justify-content: space-between;
            padding: 0.5rem 0;
            border-bottom: 1px solid rgba(255,255,255,0.05);
        }
        .stat-row:last-child { border-bottom: none; }
        .stat-label { color: #888; }
        .stat-value { color: #fff; font-weight: 500; }
        .env-list { font-size: 0.9rem; line-height: 1.8; }
        .env-tag {
            display: inline-block;
            background: rgba(0,212,255,0.1);
            color: #00d4ff;
            padding: 0.2rem 0.5rem;
            border-radius: 4px;
            font-size: 0.8rem;
            margin: 0.2rem;
        }
        .btn-row {
            display: flex;
            gap: 1rem;
            justify-content: center;
            flex-wrap: wrap;
            margin: 2rem 0;
        }
        .btn {
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            padding: 0.75rem 1.5rem;
            border-radius: 8px;
            font-weight: 600;
            text-decoration: none;
            border: none;
            cursor: pointer;
            font-size: 1rem;
            transition: all 0.3s;
        }
        .btn-primary {
            background: linear-gradient(90deg, #00d4ff, #8a2be2);
            color: white;
        }
        .btn-primary:hover { transform: translateY(-2px); }
        .btn-secondary {
            background: rgba(255,255,255,0.1);
            color: white;
            border: 1px solid rgba(255,255,255,0.2);
        }
        .btn-secondary:hover { background: rgba(255,255,255,0.15); }
        footer {
            text-align: center;
            padding: 2rem;
            color: #666;
            font-size: 0.9rem;
        }
        footer a { color: #888; text-decoration: none; margin: 0 1rem; }
        footer a:hover { color: #00d4ff; }
        @media (max-width: 768px) {
            .nav-links { display: none; }
            .status-grid { grid-template-columns: 1fr; }
        }
    </style>
</head>
<body>
    <nav>
        <a href="/" class="logo">⚡ Jarvis</a>
        <ul class="nav-links">
            <li><a href="/commands">Commands</a></li>
            <li><a href="/store">Store</a></li>
            <li><a href="/leaderboard">Leaderboard</a></li>
            <li><a href="/sbx">SBX</a></li>
            <li><a href="/status" style="color: #00d4ff;">Status</a></li>
        </ul>
    </nav>
    
    <div class="container">
        <div class="header">
            <h1>🤖 System Status</h1>
            <div class="status-badge">
                <span style="font-size: 1.2rem;">●</span> All Systems Operational
            </div>
        </div>
        
        <div class="status-grid">
            <div class="card">
                <h3>🧠 AI Providers</h3>
                <div class="provider-list">
                    ${providerList}
                </div>
                <div style="margin-top: 1rem; text-align: center; padding-top: 1rem; border-top: 1px solid rgba(255,255,255,0.1);">
                    <strong style="color: #2ecc71;">${workingProviders}/${providerStatus.length}</strong>
                    <span style="color: #888;"> providers active</span>
                </div>
            </div>

            <div class="card">
                <h3>💾 System Info</h3>
                <div class="stat-row">
                    <span class="stat-label">Database</span>
                    <span class="stat-value">${databaseStatus.connected ? '✅ Connected' : '❌ Disconnected'}</span>
                </div>
                <div class="stat-row">
                    <span class="stat-label">DB Ping</span>
                    <span class="stat-value">${databaseStatus.ping}</span>
                </div>
                <div class="stat-row">
                    <span class="stat-label">Uptime</span>
                    <span class="stat-value">${uptimeText}</span>
                </div>
                <div class="stat-row">
                    <span class="stat-label">Memory</span>
                    <span class="stat-value">${memoryText}</span>
                </div>
            </div>
            
            <div class="card">
                <h3>🧪 Environment</h3>
                <div class="stat-row">
                    <span class="stat-label">Required</span>
                    <span class="stat-value">${envRequiredCount}/${envRequiredTotal}</span>
                </div>
                <div class="stat-row">
                    <span class="stat-label">Optional</span>
                    <span class="stat-value">${optionalConfigured}/${optionalTotal}</span>
                </div>
                ${missingRequired.length ? `<div style="margin-top: 0.5rem; color: #e74c3c; font-size: 0.85rem;">Missing: ${missingRequired.join(', ')}</div>` : ''}
                <div style="margin-top: 1rem;">
                    ${optionalEnabled.map(name => `<span class="env-tag">${name}</span>`).join('')}
                </div>
            </div>
        </div>
        
        <div class="btn-row">
            <button class="btn btn-primary" onclick="location.reload()">
                🔄 Refresh Status
            </button>
            <a href="/moderator" class="btn btn-secondary">
                🛡️ Moderator Dashboard
            </a>
            <a href="/" class="btn btn-secondary">
                🏠 Home
            </a>
        </div>
    </div>
    
    <footer>
        <a href="/tos">Terms of Service</a>
        <a href="/policy">Privacy Policy</a>
                <p style="margin-top: 1rem;">© 2025 Jarvis</p>
    </footer>
    
    <script>
        // Auto-refresh every 60 seconds
        setTimeout(() => location.reload(), 60000);
    </script>
</body>
</html>
        `);
    } catch (error) {
        console.error('Failed to render status page:', error);
        res.status(500).send('Jarvis uplink is initializing. Please try again shortly.');
    }
});

app.get('/providers/status', async (req, res) => {
    if (HEALTH_TOKEN) {
        const providedToken = extractBearerToken(req);
        if (providedToken !== HEALTH_TOKEN) {
            return res
                .status(401)
                .json({ status: 'unauthorized', error: 'Valid bearer token required' });
        }
    }

    try {
        const snapshot = await gatherHealthSnapshot({
            includeProviders: true,
            redactProviders: false,
            pingDatabase: false
        });
        res.json(buildProviderDigestResponse(snapshot.providers || []));
    } catch (error) {
        console.error('Failed to build provider status digest:', error);
        res.status(500).json({ error: 'Unable to build provider status digest' });
    }
});

app.get('/metrics/commands', async (req, res) => {
    if (HEALTH_TOKEN) {
        const providedToken = extractBearerToken(req);
        if (providedToken !== HEALTH_TOKEN) {
            return res
                .status(401)
                .json({ status: 'unauthorized', error: 'Valid bearer token required' });
        }
    }

    const limitParam = Number.parseInt(req.query?.limit, 10);
    const limit = Math.max(1, Math.min(Number.isFinite(limitParam) ? limitParam : 25, 200));
    const sortBy = req.query?.sort === 'errors' ? 'errors' : 'runs';

    if (!database.isConnected) {
        return res.status(503).json({ error: 'Command metrics unavailable (database offline)' });
    }

    try {
        const metrics = await database.getCommandMetricsSummary({ limit, sortBy });
        res.json({
            generatedAt: new Date().toISOString(),
            limit,
            sortBy,
            count: metrics.length,
            metrics
        });
    } catch (error) {
        console.error('Failed to load command metrics summary:', error);
        res.status(500).json({ error: 'Unable to load command metrics summary' });
    }
});

app.get('/dashboard', async (req, res) => {
    if (!isDashboardAuthed(req)) {
        return res.redirect('/dashboard/login');
    }
    if (HEALTH_TOKEN) {
        const providedToken = extractBearerToken(req);
        if (providedToken !== HEALTH_TOKEN) {
            return res.status(401).send('Dashboard requires a valid bearer token.');
        }
    }

    const deep = ['1', 'true', 'yes', 'deep'].includes(String(req.query.deep || '').toLowerCase());

    try {
        const snapshot = await gatherHealthSnapshot({
            includeProviders: true,
            redactProviders: false,
            pingDatabase: deep,
            attemptReconnect: deep
        });

        const providerRows =
            snapshot.providers
                .map((provider, index) => {
                    const uptimePercent =
                        provider.metrics.successRate != null
                            ? `${provider.metrics.successRate.toFixed(1)}%`
                            : 'n/a';
                    const latency = Number.isFinite(provider.metrics.avgLatencyMs)
                        ? `${Math.round(provider.metrics.avgLatencyMs)} ms`
                        : 'n/a';
                    const totalCalls =
                        provider.metrics.total ??
                        provider.metrics.successes + provider.metrics.failures;
                    const status = provider.isDisabled
                        ? 'Paused'
                        : provider.hasError
                          ? 'Error'
                          : 'Healthy';
                    const disabledUntil =
                        provider.isDisabled && provider.disabledUntil
                            ? new Date(provider.disabledUntil).toLocaleString()
                            : '-';

                    return `
                    <tr>
                        <td>${index + 1}</td>
                        <td>${provider.name}</td>
                        <td>${provider.model}</td>
                        <td>${provider.costTier}</td>
                        <td class="${status.toLowerCase()}">${status}</td>
                        <td>${uptimePercent}</td>
                        <td>${latency}</td>
                        <td>${totalCalls}</td>
                        <td>${disabledUntil}</td>
                    </tr>`;
                })
                .join('') || '<tr><td colspan="9">No providers configured</td></tr>';

        const requiredRows = snapshot.env.required
            .map(
                item => `
                    <tr>
                        <td>${item.name}</td>
                        <td class="${item.present ? 'healthy' : 'error'}">${item.present ? 'Present' : 'Missing'}</td>
                    </tr>
        `
            )
            .join('');

        const optionalRows = snapshot.env.optional
            .map(
                item => `
                    <tr>
                        <td>${item.name}</td>
                        <td class="${item.present ? 'healthy' : 'paused'}">${item.present ? 'Configured' : 'Not set'}</td>
                    </tr>
        `
            )
            .join('');

        const healthyProviders = snapshot.providers.filter(
            p => !p.hasError && !p.isDisabled
        ).length;

        res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Jarvis Dashboard</title>
    <style>
        body {
            background: #0a0a0a;
            color: #e0e0e0;
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 20px;
        }
        h1 {
            color: #00ffff;
            text-align: center;
        }
        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 20px;
            margin-bottom: 20px;
        }
        .card {
            background: rgba(0, 255, 255, 0.04);
            border: 1px solid rgba(0, 255, 255, 0.2);
            border-radius: 8px;
            padding: 16px;
        }
        .card h2 {
            margin-top: 0;
            color: #00ffff;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 20px;
            background: rgba(255, 255, 255, 0.03);
        }
        th, td {
            padding: 10px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
            text-align: left;
        }
        th {
            background: rgba(0, 255, 255, 0.1);
        }
        .healthy {
            color: #00ff7f;
        }
        .error {
            color: #ff6b6b;
        }
        .paused {
            color: #ffd166;
        }
        .actions {
            margin-top: 20px;
            text-align: center;
        }
        .actions a {
            color: #00ffff;
            text-decoration: none;
            margin: 0 10px;
        }
    </style>
</head>
<body>
    <h1>Jarvis Operations Dashboard</h1>

    <div class="grid">
        <div class="card">
            <h2>System</h2>
            <p>Uptime: ${Math.round(snapshot.system.uptimeSeconds / 60)} minutes</p>
            <p>Node: ${snapshot.system.nodeVersion}</p>
            <p>Memory: ${Math.round(snapshot.system.memory.heapUsed / 1024 / 1024)}MB used</p>
            <p>Timestamp: ${snapshot.system.timestamp}</p>
        </div>
        <div class="card">
            <h2>Database</h2>
            <p>Status: ${snapshot.database.connected ? '<span class="healthy">Connected</span>' : '<span class="error">Disconnected</span>'}</p>
            <p>Ping: ${snapshot.database.ping}</p>
            ${snapshot.database.error ? `<p>Error: ${snapshot.database.error}</p>` : ''}
        </div>
        <div class="card">
            <h2>Providers</h2>
            <p>Total: ${snapshot.providers.length}</p>
            <p>Healthy: ${healthyProviders}</p>
            <p>Mode: free tiers prioritized</p>
        </div>
    </div>

    <h2>AI Providers</h2>
    <table>
        <thead>
            <tr>
                <th>#</th>
                <th>Name</th>
                <th>Model</th>
                <th>Tier</th>
                <th>Status</th>
                <th>Uptime</th>
                <th>Latency</th>
                <th>Calls</th>
                <th>Disabled Until</th>
            </tr>
        </thead>
        <tbody>
            ${providerRows}
        </tbody>
    </table>

    <div class="grid">
        <div class="card">
            <h2>Required Environment</h2>
            <table>
                <tbody>
                    ${requiredRows}
                </tbody>
            </table>
        </div>
        <div class="card">
            <h2>Optional Environment</h2>
            <table>
                <tbody>
                    ${optionalRows}
                </tbody>
            </table>
        </div>
    </div>

    <div class="actions">
        <a href="/">Back to Status Page</a> •
        <a href="/health${deep ? '' : '?deep=1'}">JSON Health Check${deep ? '' : ' (deep)'}</a>
    </div>
</body>
</html>
        `);
    } catch (error) {
        console.error('Failed to render dashboard:', error);
        res.status(500).send('Dashboard unavailable while diagnostics recalibrate.');
    }
});

// Health check endpoint (for monitoring)
app.get('/health', async (req, res) => {
    if (HEALTH_TOKEN && !isRenderHealthCheck(req)) {
        const providedToken = extractBearerToken(req);
        if (providedToken !== HEALTH_TOKEN) {
            return res.status(401).json({
                status: 'unauthorized',
                error: 'Valid bearer token required'
            });
        }
    }

    // Fast-path only for Render's explicit health probe UA
    if (isRenderHealthUserAgent(req) && !req.query.deep) {
        return res.status(200).json({ status: 'ok' });
    }
    const deep = ['1', 'true', 'yes', 'deep'].includes(String(req.query.deep || '').toLowerCase());

    try {
        const snapshot = await gatherHealthSnapshot({
            includeProviders: true,
            redactProviders: false,
            pingDatabase: deep,
            attemptReconnect: deep
        });

        const healthyProviders = snapshot.providers.filter(
            p => !p.hasError && !p.isDisabled
        ).length;
        const status =
            snapshot.env.hasAllRequired && snapshot.database.connected && healthyProviders > 0
                ? 'ok'
                : 'degraded';

        const httpStatus = status === 'ok' ? 200 : 503;
        res.status(httpStatus).json({
            status,
            env: snapshot.env,
            database: snapshot.database,
            providers: snapshot.providers,
            system: snapshot.system,
            counts: {
                providersTotal: snapshot.providers.length,
                providersHealthy: healthyProviders
            }
        });
    } catch (error) {
        console.error('Health endpoint failed:', error);
        res.status(500).json({
            status: 'error',
            error: error.message
        });
    }
});

// ------------------------ Event Handlers ------------------------
client.once(Events.ClientReady, async () => {
    console.log(`Jarvis++ online. Logged in as ${client.user.tag}`);

    const announcementsRunOnce =
        String(process.env.ANNOUNCEMENTS_RUN_ONCE || '').toLowerCase() === '1';
    if (announcementsRunOnce) {
        try {
            announcementScheduler.init({ client, database, startInterval: false });
        } catch (e) {
            console.warn(
                '[AnnouncementsRunOnce] Failed to initialize announcement scheduler:',
                e.message
            );
        }

        try {
            await announcementScheduler.runOnce();
        } catch (e) {
            console.warn('[AnnouncementsRunOnce] runOnce failed:', e?.message || e);
        }

        try {
            await database.disconnect();
        } catch (e) {
            /* ignore */
        }
        try {
            client.destroy();
        } catch (e) {
            /* ignore */
        }
        process.exit(0);
    }

    // Store client globally for economy DMs
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

    // Start Stark Bucks multiplier event scheduler (250% bonus every 3 hours)
    starkEconomy.startMultiplierScheduler();

    // Initialize diagnostics router now that discordHandlers is ready
    diagnosticsRouter = createAgentDiagnosticsRouter(discordHandlers);

    // Initialize dashboard with Discord client for real-time stats
    dashboardRouter.setDiscordClient(client);
    dashboardRouter.initBotStartTime();
    dashboardRouter.addLog('success', 'Discord', `Bot online: ${client.user.tag}`);
    dashboardRouter.addLog('info', 'System', `Serving ${client.guilds.cache.size} guilds`);

    // Initialize Cloudflare status notifier for Discord alerts
    try {
        const cloudflareNotifier = require('./src/services/cloudflare-status-notifier');
        cloudflareNotifier.init(client);
        dashboardRouter.addLog('info', 'System', 'Cloudflare status notifier initialized');
    } catch (e) {
        console.warn('[CloudflareStatus] Failed to initialize:', e.message);
    }

    // Initialize public API with AI manager and database
    try {
        const aiManager = require('./src/services/ai-providers');
        publicApiRouter.init({
            aiManager,
            database,
            discordClient: client,
            ownerId: process.env.OWNER_ID || process.env.DISCORD_OWNER_ID
        });
        dashboardRouter.addLog('info', 'System', 'Public API v1 initialized');
    } catch (e) {
        console.warn('[PublicAPI] Failed to initialize:', e.message);
    }

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

    try {
        announcementScheduler.init({ client, database });
    } catch (e) {
        console.warn('[Announcements] Failed to start scheduler:', e.message);
    }

    try {
        monitorScheduler.init({ client });
    } catch (e) {
        console.warn('[Monitor] Failed to start scheduler:', e.message);
    }

    if (databaseConnected) {
        await maybeExportMongoOnStartup();
        await refreshPresenceMessages();
        // Load command sync state from MongoDB on Render (before registering commands)
        await loadCommandSyncStateFromMongo();
    }

    updateBotPresence();
    setInterval(updateBotPresence, PRESENCE_ROTATION_INTERVAL_MS);

    try {
        await registerSlashCommands();
    } catch (error) {
        console.error('Failed to register slash commands on startup:', error);
    }

    if (databaseConnected) {
        serverStatsRefreshJob.start();
        try {
            await discordHandlers.refreshAllServerStats(client);
        } catch (error) {
            console.error('Failed to refresh server stats on startup:', error);
        }
    } else {
        console.warn(
            'Skipping server stats initialization because the database connection was not established.'
        );
    }

    // Start temp file sweeper regardless of DB
    try {
        tempSweepJob.start();
    } catch (e) {
        console.warn('Failed to start temp sweep job:', e);
    }

    console.log('Provider status on startup:', aiManager.getProviderStatus());
});

client.on('guildCreate', async guild => {
    console.log(
        `Joined new guild ${guild.name ?? 'Unknown'} (${guild.id}). Synchronizing slash commands.`
    );

    console.log('Provider status on startup:', aiManager.getProviderStatus());
});

client.on('messageCreate', async message => {
    dashboardRouter.trackMessage();
    await discordHandlers.handleMessage(message, client);
});

client.on('interactionCreate', async interaction => {
    try {
        if (interaction.isChatInputCommand()) {
            dashboardRouter.trackCommand(interaction.commandName, interaction.user.id);
            await discordHandlers.handleSlashCommand(interaction);
        } else if (interaction.isModalSubmit()) {
            await discordHandlers.handleModalSubmit(interaction);
        } else if (interaction.isButton()) {
            await discordHandlers.handleComponentInteraction(interaction);
        }
    } catch (error) {
        console.error('Interaction handler error:', error);
        if (
            typeof interaction.isRepliable === 'function' &&
            interaction.isRepliable() &&
            !interaction.replied &&
            !interaction.deferred
        ) {
            await interaction
                .reply({ content: 'Technical difficulties, sir.', ephemeral: true })
                .catch(() => {});
        }
    }
});

client.on('voiceStateUpdate', async (oldState, newState) => {
    await discordHandlers.handleVoiceStateUpdate(oldState, newState);
});

client.on('messageReactionAdd', async (reaction, user) => {
    await discordHandlers.handleReactionAdd(reaction, user);
});

client.on('messageReactionRemove', async (reaction, user) => {
    await discordHandlers.handleReactionRemove(reaction, user);
});

client.on('messageDelete', async message => {
    await discordHandlers.handleTrackedMessageDelete(message);
});

client.on('guildMemberAdd', async member => {
    await discordHandlers.handleGuildMemberAdd(member, client);
});

client.on('guildMemberRemove', async member => {
    await discordHandlers.handleGuildMemberRemove(member);
});

// ------------------------ Cleanup Tasks ------------------------
// Clean up old data periodically
cron.schedule('0 2 * * *', () => {
    console.log('Running daily cleanup...');
    aiManager.cleanupOldMetrics();
    discordHandlers.cleanupCooldowns();
});

// ------------------------ Error Handling ------------------------
client.on('error', err => {
    console.error('Discord client error:', err);
    try {
        errorLogger.log({
            error: err,
            context: {
                location: 'discord.client.error',
                command: 'client.error',
                extra: { message: err?.message }
            }
        });
    } catch {
        // ignore
    }
    // Don't exit on Discord errors, just log them
});

process.on('unhandledRejection', err => {
    console.error('Unhandled promise rejection:', err);
    try {
        errorLogger.log({
            error: err,
            context: {
                location: 'process.unhandledRejection',
                command: 'unhandledRejection'
            }
        });
    } catch {
        // ignore
    }
    // Log but don't exit - let the bot continue running
});

process.on('uncaughtException', err => {
    console.error('Uncaught exception:', err);
    try {
        errorLogger.log({
            error: err,
            context: {
                location: 'process.uncaughtException',
                command: 'uncaughtException'
            }
        });
    } catch {
        // ignore
    }
});

async function gracefulShutdown(signal) {
    console.log(`Jarvis received ${signal}, shutting down gracefully...`);
    try {
        serverStatsRefreshJob.stop();
        try { announcementScheduler.stop(); } catch (_) {}
        try { monitorScheduler.stop(); } catch (_) {}
        try { starkEconomy.stopMultiplierScheduler(); } catch (_) {}
        try { tempSweepJob.stop(); } catch (_) {}
        await database.disconnect();
        // Flush logger before exit to ensure all logs are written
        try { await require('./src/utils/logger').flush(); } catch (_) {}
        client.destroy();
    } catch (error) {
        console.error('Error during shutdown:', error);
    }
    process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ------------------------ 404 Error Page ------------------------
app.use((req, res) => {
    res.status(404).send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>404 - Page Not Found | Jarvis</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #0a0a1a 0%, #1a1a3e 50%, #0d0d2b 100%);
            color: #e4e4e4;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            text-align: center;
            padding: 2rem;
        }
        .error-icon { font-size: 6rem; margin-bottom: 1rem; }
        h1 {
            font-size: 3rem;
            margin-bottom: 1rem;
            background: linear-gradient(90deg, #ff4444, #ff6b6b);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        p { color: #888; font-size: 1.2rem; margin-bottom: 2rem; }
        .btn {
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            padding: 1rem 2rem;
            background: linear-gradient(90deg, #00d4ff, #8a2be2);
            color: white;
            border-radius: 50px;
            font-weight: 600;
            text-decoration: none;
            transition: all 0.3s;
            box-shadow: 0 4px 20px rgba(0, 212, 255, 0.3);
        }
        .btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 30px rgba(0, 212, 255, 0.4);
        }
        .path { color: #666; font-size: 0.9rem; margin-top: 2rem; font-family: monospace; }
    </style>
</head>
<body>
    <div class="error-icon">🤖</div>
    <h1>404</h1>
    <p>There's nothing here.</p>
    <a href="/" class="btn">🏠 Go Home</a>
    <p class="path">${req.path.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c])}</p>
</body>
</html>
    `);
});

// ------------------------ Boot ------------------------
async function startBot() {
    try {
        const announcementsRunOnce =
            String(process.env.ANNOUNCEMENTS_RUN_ONCE || '').toLowerCase() === '1';
        if (announcementsRunOnce) {
            let databaseConnected = false;
            try {
                await database.connect();
                databaseConnected = true;
            } catch (err) {
                console.warn(
                    '[AnnouncementsRunOnce] Database connection failed; will still process in-memory jobs only.'
                );
            }

            const disableDiscord = String(process.env.DISABLE_DISCORD || '').toLowerCase() === '1';
            if (disableDiscord) {
                console.warn(
                    '[AnnouncementsRunOnce] DISABLE_DISCORD=1 set; skipping Discord login and exiting.'
                );
                if (databaseConnected) {
                    try {
                        await database.disconnect();
                    } catch (e) {
                        /* ignore */
                    }
                }
                process.exit(0);
            }

            await client.login(config.discord.token);
            console.log('✅ Logged in for ANNOUNCEMENTS_RUN_ONCE');
            return;
        }

        // Start uptime server
        app.listen(config.server.port, '0.0.0.0', () => {
            console.log(`Uptime server listening on port ${config.server.port}`);
        });

        // Warm up MongoDB before we touch Discord (optional in local dev)
        let databaseConnected = false;
        try {
            await database.connect();
            databaseConnected = true;
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

        await refreshPresenceMessages(true);

        // Auto-configure domain (Nginx + Cloudflare)
        try {
            const cloudflareDomain = require('./src/services/cloudflare-domain');
            const cfConfig = cloudflareDomain.getConfig();
            
            // Auto-setup Nginx reverse proxy (selfhost only)
            if (cfConfig.domain && cfConfig.deployTarget !== 'render') {
                const nginxResult = await cloudflareDomain.autoSetupNginx(cfConfig.domain);
                if (nginxResult.success) {
                    if (nginxResult.cached) {
                        console.log(`[Nginx] Already configured for ${cfConfig.domain}`);
                    } else {
                        console.log(`[Nginx] ✅ Configured: ${cfConfig.domain} → localhost:3000`);
                    }
                } else if (nginxResult.manual) {
                    console.log(`[Nginx] ⚠️ Manual setup required (no sudo access)`);
                } else if (nginxResult.error) {
                    console.log(`[Nginx] ⚠️ ${nginxResult.error}`);
                }
            }
            
            // Auto-configure Cloudflare DNS
            if (cfConfig.zoneId || cfConfig.domain) {
                console.log('[Cloudflare] Checking domain configuration...');
                const result = await cloudflareDomain.autoConfigure();
                if (result.success) {
                    if (result.cached) {
                        console.log(`[Cloudflare] Already configured: ${result.domain} → ${result.target}`);
                    } else {
                        console.log(`[Cloudflare] ✅ Domain configured: ${result.domain} → ${result.target}`);
                    }
                } else if (result.error) {
                    console.log(`[Cloudflare] ⚠️ ${result.error}`);
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

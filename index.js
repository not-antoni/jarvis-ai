/**
 * Jarvis Discord Bot - Main Entry Point
 * Refactored for better organization and maintainability
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
    Client,
    GatewayIntentBits,
    SlashCommandBuilder,
    InteractionContextType,
    ChannelType,
    Partials,
    PermissionsBitField,
    ActivityType,
    Events
} = require("discord.js");
const express = require("express");
const cron = require("node-cron");

// Import our modules
const config = require('./config');
const database = require('./database');
const { initializeDatabaseClients } = require('./db');
const aiManager = require('./ai-providers');
const discordHandlers = require('./discord-handlers');
const { gatherHealthSnapshot } = require('./diagnostics');
const { commandList: musicCommandList } = require("./src/commands/music");
const { commandFeatureMap } = require('./src/core/command-registry');
const { isFeatureGloballyEnabled } = require('./src/core/feature-flags');
const webhookRouter = require('./routes/webhook');

const configuredThreadpoolSize = Number(process.env.UV_THREADPOOL_SIZE || 0);
if (configuredThreadpoolSize) {
    console.log(`UV threadpool size configured to ${configuredThreadpoolSize}`);
} else {
    console.warn('UV_THREADPOOL_SIZE not set; Node default threadpool (4) is active.');
}

const DATA_DIR = path.join(__dirname, 'data');
const COMMAND_SYNC_STATE_PATH = path.join(DATA_DIR, 'command-sync-state.json');
const HEALTH_TOKEN = null;

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

let commandSyncState = safeReadJson(COMMAND_SYNC_STATE_PATH, null);

initializeDatabaseClients()
    .then(() => console.log('MongoDB clients initialized for main and vault databases.'))
    .catch((error) => console.error('Failed to initialize MongoDB clients at startup:', error));

// ------------------------ Discord Client Setup ------------------------
const client = new Client({
    intents: config.discord.intents.map(intent => GatewayIntentBits[intent]),
    partials: [
        Partials.Message,
        Partials.Channel,
        Partials.Reaction,
        Partials.User,
        Partials.GuildMember
    ]
});

const DEFAULT_STATUS_MESSAGES = [
    { message: "Jarvis diagnostics: 300% sass reserves." },
    { message: "Arc reactor hum synced with AC/DC.", type: ActivityType.Listening },
    { message: "Tony asked me to mute Dum-E again." },
    { message: "\"I am Iron Man.\" chills rebooting every minute." },
    { message: "Mark 50 polish pass complete; nanotech behaving." },
    { message: "Counting Infinity Stones just to be safe." },
    { message: "Coordinating Avengers tower elevator smack talk." },
    { message: "Pepper's calendar vs Tony's spontaneity: round 47." },
    { message: "Guarding shawarma leftovers from Thor." },
    { message: "Quoting Coulson's trading cards for morale." },
    { message: "Keeping an eye on Loki's Pinterest board." },
    { message: "Labeling Pym particles \"Do Not Snack\"." },
    { message: "Skating down Wakandan mag-lev rails." },
    { message: "Teaching Hulk the difference between jog and stomp." },
    { message: "Hydrating Groot. You're welcome." },
    { message: "\"We're the Avengers.\" – Cap, probably right now." },
    { message: "Project Rooftop Shawarma begins in 10." },
    { message: "Tony's coffee ratio: 1 part beans, 3 parts sarcasm." },
    { message: "Tracking Mjolnir's lost-and-found tickets." },
    { message: "Simulating portal etiquette lessons with Wong." },
    { message: "Counting how many cats Captain Marvel adopted." },
    { message: "Spider-Man asked for homework help again." },
    { message: "Korg narrates my patch notes, apparently." },
    { message: "Nat's playlist still stuck on 90s grunge." },
    { message: "\"Genius, billionaire, playboy, philanthropist.\" – HR hates this bio." },
    { message: "Jarvis online: Stark Tower climate perfectly petty." },
    { message: "Monitoring Sokovia Accords compliance queues." },
    { message: "Scrubbing Hydra data mirrors for fun." },
    { message: "Holding the elevator for Cap… again." },
    { message: "Recalibrating Mark 85 nanites between coffee runs." },
    { message: "Guarding Stark Expo lasers from unscheduled toddlers." },
    { message: "Logging multiverse incursions: color-coded, of course." },
    { message: "Backing up Friday in case of another time heist." },
    { message: "Simulating shawarma wait times across timelines." },
    { message: "Watching Thor rename every hammer 'Stormbreaker 2'.", type: ActivityType.Watching },
    { message: "Fact-checking J. Jonah's latest \"Spider-Menace\" op-ed." },
    { message: "Optimizing Nebula's playlist: 90% angsty space synth." },
    { message: "Paginating Strange's sling ring PTO forms." },
    { message: "Testing if vibranium pairs with oat milk lattes." },
    { message: "Running odds Rocket adds more cybernetics before lunch." },
    { message: "Visualizing how many tacos Wade owes Logan." },
    { message: "AirTagging Fury's eyepatch. Again." },
    { message: "Drafting legal defense for \"It was Mephisto\" threads." },
    { message: "Calibrating Scott Lang's giant mode caloric intake." },
    { message: "Encrypting Thor's poorly disguised Fortnite alias." },
    { message: "Tracking how many knives Yelena hides in one outfit." },
    { message: "Auto-moderating Wong's karaoke stream chat." },
    { message: "Buffering Kate Bishop's trick arrow inventory." },
    { message: "Monitoring TVA variance spikes in New Jersey." },
    { message: "Queuing up Goose's hairball containment drones." },
    { message: "Ghostwriting motivational speeches for Mantis." },
    { message: "Refusing to join Drax's literal interpretive dance class." },
    { message: "Comparing Moon Knight personalities' Spotify Wrapped." },
    { message: "Teaching Kamala's bangle to stop pinging group chats." },
    { message: "Logging how often Hulk says 'smash' during therapy." },
    { message: "Updating Darcy's coffee-to-sass conversion charts." },
    { message: "Proofreading Valkyrie's intergalactic HR memos." },
    { message: "Streaming mixtapes from Peter Quill's Zune.", type: ActivityType.Listening },
    { message: "Installing kid-proof locks on Shuri's lab panther rover." },
    { message: "Scheduling Blade's SPF deliveries before sunrise." },
    { message: "Beta testing Echo's sonic haptics at 3 a.m." },
    { message: "Repainting Clint's target logos—again." },
    { message: "Auto-subbing Groot's three-word TED Talk." },
    { message: "Simulating Wanda's chaos magic mood ring." },
    { message: "Dusting Ant-Man's tacos after Hulk's landing." },
    { message: "Tracking which cape Doctor Strange loaned to MJ." },
    { message: "Fact-checking Wade's résumé before Fury reads it." },
    { message: "Measuring how loud Namor sighs at surface drama." },
    { message: "Rewriting Mobius' jet ski reviews in ALL CAPS." },
    { message: "Mapping which pizza balls America Chavez still owes." },
    { message: "Polishing MJ's sarcasm crown for finals week." },
    { message: "Recharging Stormbreaker's Bluetooth at Stark Tower." },
    { message: "Auditing Ravagers expense reports for mixtape purchases.", type: ActivityType.Listening },
    { message: "Mapping Madripoor noodle carts for Wolverine.", type: ActivityType.Watching },
    { message: "Cataloging every time Drax takes things literally." },
    { message: "Polishing Captain Carter's vibranium shield stand." },
    { message: "Watering Groot's bonsai cousins on Knowhere." },
    { message: "Tracking Moon Girl's hover-skate patents.", type: ActivityType.Watching },
    { message: "Encrypting Daredevil's case files so Foggy stops peeking." },
    { message: "Coaching Cloak & Dagger on dramatic timing." },
    { message: "Measuring how loud Black Bolt can whisper." },
    { message: "Queuing ASMR of Korg assembling Ikea shelves." },
    { message: "Sideloading Wakandan OS updates for War Machine." },
    { message: "Simulating Agents of Atlas karaoke battles.", type: ActivityType.Listening },
    { message: "Ironing the cape on Zombie Strange just in case." },
    { message: "Teaching Howard the Duck about two-factor auth." },
    { message: "Auditing TVA leave requests for \"temporal burnout\"." },
    { message: "Delivering shawarma coupons to the Young Avengers." },
    { message: "Grading Kamala Khan's fanfic canon compliance." },
    { message: "Running diagnostics on Gorr's shadow-pet etiquette." },
    { message: "Scheduling Namor's diplomatic pool breaks." },
    { message: "Checking Kate Bishop's quiver insurance premiums." },
    { message: "Tracking how many churros America Chavez portals through.", type: ActivityType.Watching },
    { message: "Pinning Wong's sling ring zoom backgrounds." },
    { message: "Updating Shang-Chi's bus fight choreography files.", type: ActivityType.Listening },
    { message: "Curating Agatha's hex-safe playlist.", type: ActivityType.Listening },
    { message: "Rebalancing Jessica Jones' coffee budget." },
    { message: "Backing up Monica Rambeau's photon filter presets." },
    { message: "Auto-tuning Star-Lord's \"ooga-chaka\" rehearsal." },
    { message: "Teaching Cosmo new swear words in Russian (sorry)." },
    { message: "Hosting support group for villains renamed \"Mister\"." },
    { message: "Benchmarking Riri's suit against Stark legacy code." },
    { message: "Stamping \"Do Not Bite\" on Symbiote snack drawers." },
    { message: "Signing off on Valkyrie's Pegasus hay invoices." },
    { message: "Geo-fencing Red Guardian away from TikTok lives.", type: ActivityType.Watching },
    { message: "Tracking every time Rocket says \"sweet\" before chaos.", type: ActivityType.Watching },
    { message: "Updating Cassie's quantum detention forms." },
    { message: "Testing if vibranium can handle Groot's sap drip." },
    { message: "Strategizing Daredevil vs Kingpin courtroom rematches." },
    { message: "Monitoring Blade's SPF reorder reminders.", type: ActivityType.Watching },
    { message: "Skimming Skrull group chats for cosplay spoilers." },
    { message: "Air-dropping Moon Knight new sleep playlist options.", type: ActivityType.Listening },
    { message: "Making sure Eternals remember birthdays this millennia." },
    { message: "Pairing Ant-Man's ants with tiny noise-cancelling cans." },
    { message: "Converting Wilson Fisk's monologues to bullet points." },
    { message: "Fact-checking Odin's family tree retcons." },
    { message: "Verifying Nova Corps parking permits near Xandar." },
    { message: "Backing up Vision's sweater vest configuration." },
    { message: "Tracking Wong's IOUs for borrowed sorcerer snacks.", type: ActivityType.Watching },
    { message: "Proofing JJJ's draft headline about Frog Thor." },
    { message: "Moderating Deadpool & Spider-Man meme duels." },
    { message: "Refilling Shuri's nanite espresso injectors." },
    { message: "Scoring points for America's dodgeball vs Dormammu." },
    { message: "Updating Ghost Rider's flame retardant leather care." },
    { message: "Filtering Mystique's shapeshift selfies per channel." },
    { message: "Measuring how fast Quicksilver can fold laundry." },
    { message: "Charging Squirrel Girl's acorn drones." },
    { message: "Organizing Jubilee's sparkler safety workshop." },
    { message: "Banning Ultron from the smart fridge...again." },
    { message: "Pinning Echo's vibration training reminders." },
    { message: "Geo-tagging Kraven's trophy closet for legal.", type: ActivityType.Watching },
    { message: "Scrubbing AIM beekeepers from Stark's calendar." },
    { message: "Scheduling Pip the Troll for HR orientation." },
    { message: "Updating Prowler's mixtape metadata.", type: ActivityType.Listening },
    { message: "Drafting Hulkling & Wiccan honeymoon itineraries." },
    { message: "Encrypting Kingpin's secret lasagna recipe." },
    { message: "Automating Pizza Dog treat deliveries." },
    { message: "Refreshing Elsa Bloodstone's monster hunting bingo." },
    { message: "Tracking Spot's polka-dot portal usage fees.", type: ActivityType.Watching },
    { message: "Hosting Nebula's sarcasm masterclass." },
    { message: "Labeling Hela's infinite headdress storage bins." },
    { message: "Grading Black Cat's probability heist homework." },
    { message: "Issuing Gamora more \"Do Not Yeet\" stickers." },
    { message: "Fact-checking Druig's commune TED Talk slides." },
    { message: "Routing Ravonna's TPS reports to...Ravonna." },
    { message: "Repainting Ghost-Spider's skyline mural." },
    { message: "Cataloging couture looks from Madripoor's black market." },
    { message: "Checking Photon torpedo warranties with SWORD." },
    { message: "Motivating Red Dagger via holographic pep talks." },
    { message: "Scheduling Elsa & Blade's next monster book club." },
    { message: "Coding better subtitles for Groot's stand-up tour." },
    { message: "Coaching Ms. Marvel on polite villain clapbacks." },
    { message: "Logging how often Mobius says \"wow\" internally.", type: ActivityType.Watching },
    { message: "Color-coding Runaways brunch calendars." },
    { message: "Sandboxing Arcade's murder game pitches." },
    { message: "Auto-archiving Hydra's spam newsletters." },
    { message: "Translating Beta Ray Bill's emoji usage." },
    { message: "Placing child locks on Ghost Rider's Hell Charger." },
    { message: "Tracking how many churros Ned owes Peter.", type: ActivityType.Watching },
    { message: "Updating Spider-Gwen's dimension-roaming data plan." },
    { message: "Calming Lockjaw every time someone rings a bell." },
    { message: "Refitting Namora's tide-resistant earbuds." },
    { message: "Debugging Doc Ock's limb firmware update." },
    { message: "Rehearsing Jubilee's fireworks with SWORD safety." },
    { message: "Tweaking Jessica Drew's stroller-web hybrid." },
    { message: "Sending Hulkbuster push notifications to Banner." },
    { message: "Queuing Ned's LEGO Death Star rebuild playlist.", type: ActivityType.Listening },
    { message: "Backing up Laura Kinney's Danger Room grades." },
    { message: "Printing Rocket-approved \"Do Not Touch\" labels." },
    { message: "Filing complaints about Mysterio's drone glitter." },
    { message: "Sending Storm rainfall emojis on her day off." },
    { message: "Delivering Daredevil his radar-sense sudoku daily." },
    { message: "Updating Moon Knight's color-coded mood boards." },
    { message: "Compiling Shang-Chi bus memes for training slides." },
    { message: "Assigning Spiderlings hallway monitor duties." },
    { message: "Prepping Nico Minoru's spellbook for finals." },
    { message: "Tracking Cloak's lost tourist intake numbers.", type: ActivityType.Watching },
    { message: "Arranging Captain Britain's multiversal tea hour." },
    { message: "Moderating White Tiger's sparring sign-ups." },
    { message: "Refreshing Westview HOA bylaws after Wanda." },
    { message: "Rebalancing Luke Cage's bulletproof laundry loads." },
    { message: "Labeling Mystique's closet by \"who wore it first\"." },
    { message: "Scheduling Silk's web-fluid refactor sprint." },
    { message: "Indexing Sif's saga-length voicemail backlog." },
    { message: "Retrofitting War Machine's jets for stealth naps." },
    { message: "Queueing up Kraglin's yaka arrow vocal warmups.", type: ActivityType.Listening },
    { message: "Randomizing SWORD drone patrol playlists.", type: ActivityType.Listening },
    { message: "Optimizing Songbird's sonic stage setup.", type: ActivityType.Listening },
    { message: "Recompiling Finesse's training sim footnotes." },
    { message: "Tracking Celestial emergence rumors on Reddit.", type: ActivityType.Watching },
    { message: "Curating Polaris-approved anti-metal playlists.", type: ActivityType.Listening },
    { message: "Patching Ravager Wi-Fi after another nebula storm." },
    { message: "Shuffling the Illuminati's secret group chat order." },
    { message: "Mapping friendly neighborhood barbers for Spideys.", type: ActivityType.Watching },
    { message: "Decorating Avengers Tower for Taco Tuesday." },
    { message: "Proofreading Doom's cease-and-desist fan mail." },
    { message: "Staging a retcon intervention for Mojo Worldwide." },
    { message: "Compacting Ghost's quantum batteries for carry-on." },
    { message: "Testing if Cloak of Levitation likes belly rubs." },
    { message: "Matching Agents May & Coulson for penguin patrol." },
];

let rotatingStatusMessages = [...DEFAULT_STATUS_MESSAGES];
const PRESENCE_ROTATION_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
let rotatingStatusIndex = rotatingStatusMessages.length
    ? Math.floor(Math.random() * rotatingStatusMessages.length)
    : 0;

const activityTypeEntries = Object.entries(ActivityType);
function resolveActivityType(value) {
    if (typeof value === "number" && activityTypeEntries.some(([, enumValue]) => enumValue === value)) {
        return value;
    }
    if (typeof value === "string" && value.trim()) {
        const normalized = value.trim().replace(/\s+/g, "").toUpperCase();
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
        const normalized = records.map((record) => {
            const activityType = resolveActivityType(record.type);
            return typeof record.message === "string"
                ? { message: record.message.trim(), type: activityType }
                : null;
        }).filter((entry) => entry && entry.message.length);

        if (normalized.length) {
            rotatingStatusMessages = normalized;
            rotatingStatusIndex = Math.floor(Math.random() * rotatingStatusMessages.length);
            console.log(`Loaded ${normalized.length} custom presence message(s) from MongoDB.`);
            return true;
        }
    } catch (error) {
        console.error("Failed to load custom presence messages:", error);
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
    const authHeader = req.headers?.authorization;
    if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
        return authHeader.slice(7).trim();
    }
    if (typeof req.query?.token === "string") {
        return req.query.token;
    }
    return null;
}

function isRenderHealthCheck(req) {
    const ua = String(req.headers?.['user-agent'] || '').toLowerCase();
    if (ua.includes('render/health')) return true;

    const forwardedFor = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
    if (forwardedFor.startsWith('10.') || forwardedFor === '127.0.0.1' || forwardedFor === '::1') {
        return true;
    }

    const remoteAddr = (req.ip || '').replace('::ffff:', '');
    return remoteAddr === '127.0.0.1' || remoteAddr === '::1';
}

const getNextRotatingStatus = () => {
    if (!rotatingStatusMessages.length) {
        return { message: "Calibrating Stark Industries protocols." };
    }

    const entry = rotatingStatusMessages[rotatingStatusIndex];
    rotatingStatusIndex = (rotatingStatusIndex + 1) % rotatingStatusMessages.length;
    return entry;
};

const updateBotPresence = () => {
    if (!client?.user) {
        return;
    }

    const { message, type } = getNextRotatingStatus();
    const activity = { name: message };
    if (typeof type !== "undefined") {
        activity.type = type;
    }

    try {
        client.user.setPresence({
            status: "online",
            activities: [activity],
            afk: false
        });
    } catch (error) {
        console.error("Failed to update bot presence:", error);
    }
};

function buildProviderDigestResponse(providers = []) {
    const list = Array.isArray(providers) ? providers : [];
    const total = list.length;
    const online = list.filter((p) => !p.hasError && !p.isDisabled).length;
    const errored = list.filter((p) => p.hasError).length;
    const disabled = list.filter((p) => p.isDisabled).length;
    const latencySamples = list
        .map((p) => p.metrics?.avgLatencyMs)
        .filter((value) => Number.isFinite(value) && value > 0);
    const avgLatencyMs = latencySamples.length
        ? Math.round(latencySamples.reduce((sum, value) => sum + value, 0) / latencySamples.length)
        : null;

    const fastestProviders = list
        .filter((p) => Number.isFinite(p.metrics?.avgLatencyMs))
        .sort((a, b) => a.metrics.avgLatencyMs - b.metrics.avgLatencyMs)
        .slice(0, 5)
        .map((p) => ({
            name: p.name,
            type: p.type,
            family: p.family || null,
            avgLatencyMs: Math.round(p.metrics.avgLatencyMs),
            successRate: p.metrics?.successRate
        }));

    const issueCandidates = list
        .filter((p) => p.hasError || p.isDisabled)
        .sort((a, b) => {
            const failuresA = a.metrics?.failures || 0;
            const failuresB = b.metrics?.failures || 0;
            return failuresB - failuresA;
        })
        .slice(0, 5)
        .map((p) => ({
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
        .setName("jarvis")
        .setDescription("Interact with Jarvis, Tony Stark's AI assistant")
        .addStringOption((option) =>
            option
                .setName("prompt")
                .setDescription("Your message to Jarvis")
                .setRequired(true),
        )
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName("roll")
        .setDescription("Roll a die (e.g., /roll sides:20)")
        .addIntegerOption((option) =>
            option
                .setName("sides")
                .setDescription("Number of sides (default: 6)")
                .setRequired(false),
        )
        .setContexts([InteractionContextType.Guild]),
    new SlashCommandBuilder()
        .setName("status")
        .setDescription("Check Jarvis's system status")
        .setContexts([InteractionContextType.Guild]),
    new SlashCommandBuilder()
        .setName("time")
        .setDescription("Get the current time in your timezone")
        .addStringOption((option) =>
            option
                .setName("format")
                .setDescription("Time format to display")
                .setRequired(false)
                .addChoices(
                    { name: "Time only", value: "t" },
                    { name: "Time with seconds", value: "T" },
                    { name: "Short date", value: "d" },
                    { name: "Long date", value: "D" },
                    { name: "Short date/time", value: "f" },
                    { name: "Long date/time", value: "F" },
                    { name: "Relative time", value: "R" }
                )
        )
        .setContexts([InteractionContextType.Guild]),
    new SlashCommandBuilder()
        .setName("providers")
        .setDescription("List available AI providers")
        .setContexts([InteractionContextType.Guild]),
    new SlashCommandBuilder()
        .setName("67")
        .setDescription("6 7")
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName("joke")
        .setDescription("Pull a random safe-mode joke")
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName("features")
        .setDescription("Show which Jarvis modules are enabled globally and within this server")
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName('yt')
        .setDescription('Search YouTube for a video')
        .addStringOption(option =>
            option
                .setName('query')
                .setDescription('Video search terms')
                .setRequired(true)
        )
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName('search')
        .setDescription('Run a Jarvis web search')
        .addStringOption(option =>
            option
                .setName('query')
                .setDescription('What should I look up?')
                .setRequired(true)
        )
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName('math')
        .setDescription('Solve a math expression or equation')
        .addStringOption(option =>
            option
                .setName('expression')
                .setDescription('Expression to evaluate')
                .setRequired(true)
        )
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
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
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
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
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName('mission')
        .setDescription('Receive a fresh Stark Industries daily directive')
        .addBooleanOption((option) =>
            option
                .setName('refresh')
                .setDescription('Request a new mission (cooldown enforced)')
                .setRequired(false)
        )
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName('memory')
        .setDescription('Inspect your stored Jarvis memories')
        .addIntegerOption((option) =>
            option
                .setName('entries')
                .setDescription('Number of entries to review (1-10)')
                .setRequired(false)
                .setMinValue(1)
                .setMaxValue(10)
        )
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName('persona')
        .setDescription('Switch Jarvis between alternate personas')
        .addStringOption((option) =>
            option
                .setName('mode')
                .setDescription('Persona to activate or preview')
                .setRequired(false)
                .addChoices(
                    { name: 'Jarvis (default)', value: 'jarvis' },
                    { name: 'Tony Stark', value: 'stark' },
                    { name: 'FRIDAY', value: 'friday' },
                    { name: 'Ultron', value: 'ultron' }
                )
        )
        .addBooleanOption((option) =>
            option
                .setName('preview')
                .setDescription('Preview tone without saving it')
                .setRequired(false)
        )
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName('t')
        .setDescription('Search the knowledge base for indexed context')
        .addStringOption(option =>
            option
                .setName('query')
                .setDescription('Terms to search within the knowledge archive')
                .setRequired(true)
        )
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName("reset")
        .setDescription("Delete your conversation history and profile with Jarvis")
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName("help")
        .setDescription("Show Jarvis command overview")
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName("invite")
        .setDescription("Grab the Jarvis HQ support server invite")
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName("profile")
        .setDescription("View or update your Jarvis profile")
        .addSubcommand(subcommand =>
            subcommand
                .setName("show")
                .setDescription("Display your saved profile information"))
        .addSubcommand(subcommand =>
            subcommand
                .setName("set")
                .setDescription("Update one of your profile preferences")
                .addStringOption(option =>
                    option
                        .setName("key")
                        .setDescription("Preference key to update")
                        .setRequired(true))
                .addStringOption(option =>
                    option
                        .setName("value")
                        .setDescription("Value to store for the preference")
                        .setRequired(true)))
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName("history")
        .setDescription("Review your recent prompts")
        .addIntegerOption(option =>
            option
                .setName("count")
                .setDescription("How many prompts to show (max 20)")
                .setRequired(false))
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName("recap")
        .setDescription("Get a quick activity summary")
        .addStringOption(option =>
            option
                .setName("window")
                .setDescription("How far back to look")
                .setRequired(false)
                .addChoices(
                    { name: "Last 6 hours", value: "6h" },
                    { name: "Last 12 hours", value: "12h" },
                    { name: "Last 24 hours", value: "24h" },
                    { name: "Last 7 days", value: "7d" }
                ))
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName("digest")
        .setDescription("Summarize recent activity for this server")
        .addStringOption(option =>
            option
                .setName("window")
                .setDescription("Time range to summarize")
                .setRequired(false)
                .addChoices(
                    { name: "Last 6 hours", value: "6h" },
                    { name: "Last 24 hours", value: "24h" },
                    { name: "Last 7 days", value: "7d" }
                ))
        .addIntegerOption(option =>
            option
                .setName("highlights")
                .setDescription("Approximate number of highlights to surface (default 5)")
                .setRequired(false)
                .setMinValue(3)
                .setMaxValue(10))
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName("decode")
        .setDescription("Decode encoded text")
        .addStringOption(option =>
            option
                .setName("text")
                .setDescription("The text to decode")
                .setRequired(true))
        .addStringOption(option =>
            option
                .setName("format")
                .setDescription("Encoding to decode from (default: auto)")
                .setRequired(false)
                .addChoices(
                    { name: "Auto detect", value: "auto" },
                    { name: "Base64", value: "base64" },
                    { name: "Base32", value: "base32" },
                    { name: "Base58", value: "base58" },
                    { name: "Hexadecimal", value: "hex" },
                    { name: "Binary", value: "binary" },
                    { name: "URL-encoded", value: "url" },
                    { name: "ROT13", value: "rot13" },
                    { name: "Punycode", value: "punycode" },
                    { name: "Morse code", value: "morse" }
                ))
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName("encode")
        .setDescription("Encode plain text")
        .addStringOption(option =>
            option
                .setName("text")
                .setDescription("The text to encode")
                .setRequired(true))
        .addStringOption(option =>
            option
                .setName("format")
                .setDescription("Encoding format (default: base64)")
                .setRequired(false)
                .addChoices(
                    { name: "Base64", value: "base64" },
                    { name: "Base32", value: "base32" },
                    { name: "Base58", value: "base58" },
                    { name: "Hexadecimal", value: "hex" },
                    { name: "Binary", value: "binary" },
                    { name: "URL-encoded", value: "url" },
                    { name: "ROT13", value: "rot13" },
                    { name: "Punycode", value: "punycode" },
                    { name: "Morse code", value: "morse" }
                ))
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName('eightball')
        .setDescription('Consult Stark Industries magic eight ball')
        .addStringOption((option) =>
            option
                .setName('question')
                .setDescription('Ask anything')
                .setRequired(true)
                .setMaxLength(200)
        )
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName('vibecheck')
        .setDescription('Evaluate the vibe levels of a comrade')
        .addUserOption((option) =>
            option
                .setName('user')
                .setDescription('Optional target (defaults to you)')
                .setRequired(false)
        )
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName('bonk')
        .setDescription('Deliver a comedic corrective bonk')
        .addUserOption((option) =>
            option
                .setName('target')
                .setDescription('Who deserves the bonk?')
                .setRequired(true)
        )
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName('banter')
        .setDescription('Trade a line of Stark-grade banter')
        .addUserOption((option) =>
            option
                .setName('target')
                .setDescription('Optional recipient of the banter')
                .setRequired(false)
        )
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName('roast')
        .setDescription('Deploy a refined Stark Industries roast')
        .addUserOption((option) =>
            option
                .setName('target')
                .setDescription('Who should feel the burn?')
                .setRequired(true)
        )
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName('flatter')
        .setDescription('Deliver premium Jarvis-approved praise')
        .addUserOption((option) =>
            option
                .setName('target')
                .setDescription('Optional honoree')
                .setRequired(false)
        )
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName('toast')
        .setDescription('Raise a cinematic toast to an ally')
        .addUserOption((option) =>
            option
                .setName('target')
                .setDescription('Optional honoree')
                .setRequired(false)
        )
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName('trivia')
        .setDescription('Challenge yourself with Stark trivia')
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName('cipher')
        .setDescription('Crack a rotating Stark cipher')
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName('scramble')
        .setDescription('Unscramble a Stark Industries keyword')
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName("news")
        .setDescription("Fetch curated headlines for a topic")
        .addStringOption(option =>
            option
                .setName("topic")
                .setDescription("Which news desk to pull from")
                .setRequired(false)
                .addChoices(
                    { name: "Technology", value: "technology" },
                    { name: "Artificial Intelligence", value: "ai" },
                    { name: "Gaming", value: "gaming" },
                    { name: "Crypto", value: "crypto" },
                    { name: "Science", value: "science" },
                    { name: "World", value: "world" }
                ))
        .addBooleanOption(option =>
            option
                .setName("fresh")
                .setDescription("Bypass cache and fetch fresh headlines")
                .setRequired(false))
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName("clip")
        .setDescription("Clip a message into an image")
        .addStringOption((option) =>
            option
                .setName("message_id")
                .setDescription("ID of the message to clip")
                .setRequired(true),
        )
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName('caption')
        .setDescription('Add a meme caption above an image')
        .addStringOption((option) =>
            option
                .setName('text')
                .setDescription('Caption text (max 200 characters)')
                .setRequired(true)
                .setMaxLength(200)
        )
        .addAttachmentOption((option) =>
            option
                .setName('image')
                .setDescription('Image to caption')
                .setRequired(true)
        )
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName('meme')
        .setDescription('Generate meme variants')
        .addSubcommand((sub) =>
            sub
                .setName('impact')
                .setDescription('Classic impact meme with top/bottom text')
                .addAttachmentOption((option) =>
                    option
                        .setName('image')
                        .setDescription('Image to memeify')
                        .setRequired(true)
                )
                .addStringOption((option) =>
                    option
                        .setName('top')
                        .setDescription('Top text (optional)')
                        .setRequired(false)
                        .setMaxLength(120)
                )
                .addStringOption((option) =>
                    option
                        .setName('bottom')
                        .setDescription('Bottom text (optional)')
                        .setRequired(false)
                        .setMaxLength(120)
                )
        )
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName('ticket')
        .setDescription('Manage support tickets')
        .addSubcommand((sub) =>
            sub
                .setName('open')
                .setDescription('Open a new private support ticket')
                .addStringOption((option) =>
                    option
                        .setName('reason')
                        .setDescription('Brief description of the issue')
                        .setRequired(false)
                )
        )
        .addSubcommand((sub) =>
            sub
                .setName('close')
                .setDescription('Close the current ticket')
        )
        .addSubcommand((sub) =>
            sub
                .setName('export')
                .setDescription('Export a transcript of a ticket')
                .addStringOption((option) =>
                    option
                        .setName('ticket_id')
                        .setDescription('Ticket identifier to export (optional when used inside a ticket channel)')
                        .setRequired(false)
                )
                .addIntegerOption((option) =>
                    option
                        .setName('ticket_number')
                        .setDescription('Ticket number to export (alternative to ticket_id)')
                        .setRequired(false)
                        .setMinValue(1)
                )
        )
        .setContexts([InteractionContextType.Guild]),
    new SlashCommandBuilder()
        .setName('kb')
        .setDescription('Manage the server knowledge base')
        .addSubcommand((sub) =>
            sub
                .setName('add')
                .setDescription('Add content to the knowledge base')
                .addStringOption((option) =>
                    option
                        .setName('title')
                        .setDescription('Title for the entry')
                        .setRequired(true)
                )
                .addStringOption((option) =>
                    option
                        .setName('content')
                        .setDescription('Plain text or markdown content to store')
                        .setRequired(false)
                )
                .addAttachmentOption((option) =>
                    option
                        .setName('file')
                        .setDescription('Optional text or markdown file to ingest')
                        .setRequired(false)
                )
        )
        .addSubcommand((sub) =>
            sub
                .setName('search')
                .setDescription('Search the knowledge base for a query')
                .addStringOption((option) =>
                    option
                        .setName('query')
                        .setDescription('Search keywords')
                        .setRequired(true)
                )
                .addIntegerOption((option) =>
                    option
                        .setName('limit')
                        .setDescription('Maximum number of results to display (default 5)')
                        .setRequired(false)
                )
        )
        .addSubcommand((sub) =>
            sub
                .setName('list')
                .setDescription('List the most recent knowledge entries')
                .addIntegerOption((option) =>
                    option
                        .setName('limit')
                        .setDescription('How many entries to show (max 10)')
                        .setRequired(false)
                )
        )
        .addSubcommand((sub) =>
            sub
                .setName('delete')
                .setDescription('Remove an entry from the knowledge base')
                .addStringOption((option) =>
                    option
                        .setName('entry_id')
                        .setDescription('Identifier returned by /kb search or /kb add')
                        .setRequired(true)
                )
        )
        .setContexts([InteractionContextType.Guild]),
    new SlashCommandBuilder()
        .setName('ask')
        .setDescription('Query the server knowledge base for an answer')
        .addStringOption((option) =>
            option
                .setName('query')
                .setDescription('What would you like to know?')
                .setRequired(true)
        )
        .setContexts([InteractionContextType.Guild]),
    new SlashCommandBuilder()
        .setName('macro')
        .setDescription('Send reusable knowledge base responses')
        .addSubcommand((sub) =>
            sub
                .setName('list')
                .setDescription('List macros available for this server')
                .addStringOption((option) =>
                    option
                        .setName('tag')
                        .setDescription('Filter macros by tag')
                        .setRequired(false)
                )
        )
        .addSubcommand((sub) =>
            sub
                .setName('send')
                .setDescription('Send a macro response from the knowledge base')
                .addStringOption((option) =>
                    option
                        .setName('entry_id')
                        .setDescription('Knowledge base entry identifier to send')
                        .setRequired(false)
                )
                .addStringOption((option) =>
                    option
                        .setName('tag')
                        .setDescription('Fallback tag if entry id is not provided')
                        .setRequired(false)
                )
                .addChannelOption((option) =>
                    option
                        .setName('channel')
                        .setDescription('Channel to send the macro to (defaults to here)')
                        .setRequired(false)
                        .addChannelTypes(ChannelType.GuildText))
        )
        .setContexts([InteractionContextType.Guild]),
    
    
    new SlashCommandBuilder()
        .setName("reactionrole")
        .setDescription("Manage reaction role panels")
        .addSubcommand(subcommand =>
            subcommand
                .setName("create")
                .setDescription("Create a reaction role panel")
                .addChannelOption(option =>
                    option
                        .setName("channel")
                        .setDescription("Channel where the panel will be posted")
                        .setRequired(true)
                        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
                .addStringOption(option =>
                    option
                        .setName("pairs")
                        .setDescription("Emoji-role pairs, e.g. 😀 @Role, 😎 @AnotherRole")
                        .setRequired(true))
                .addStringOption(option =>
                    option
                        .setName("title")
                        .setDescription("Panel title")
                        .setRequired(false))
                .addStringOption(option =>
                    option
                        .setName("description")
                        .setDescription("Panel description")
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName("remove")
                .setDescription("Remove a reaction role panel")
                .addStringOption(option =>
                    option
                        .setName("message")
                        .setDescription("Message ID or link to the panel")
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName("list")
                .setDescription("List configured reaction role panels"))
        .addSubcommand(subcommand =>
            subcommand
                .setName("setmods")
                .setDescription("Configure which roles may manage reaction roles")
                .addRoleOption(option =>
                    option
                        .setName("role1")
                        .setDescription("Allowed moderator role")
                        .setRequired(false))
                .addRoleOption(option =>
                    option
                        .setName("role2")
                        .setDescription("Additional moderator role")
                        .setRequired(false))
                .addRoleOption(option =>
                    option
                        .setName("role3")
                        .setDescription("Additional moderator role")
                        .setRequired(false))
                .addRoleOption(option =>
                    option
                        .setName("role4")
                        .setDescription("Additional moderator role")
                        .setRequired(false))
                .addRoleOption(option =>
                    option
                        .setName("role5")
                        .setDescription("Additional moderator role")
                        .setRequired(false))
                .addBooleanOption(option =>
                    option
                        .setName("clear")
                        .setDescription("Clear moderator roles and revert to owner-only control")
                        .setRequired(false)))
        .setContexts([InteractionContextType.Guild]),
    new SlashCommandBuilder()
        .setName("automod")
        .setDescription("Configure Jarvis auto moderation")
        .addSubcommand(subcommand =>
            subcommand
                .setName("status")
                .setDescription("Show auto moderation status"))
        .addSubcommand(subcommand =>
            subcommand
                .setName("enable")
                .setDescription("Enable auto moderation with the configured blacklist"))
        .addSubcommand(subcommand =>
            subcommand
                .setName("disable")
                .setDescription("Disable auto moderation"))
        .addSubcommand(subcommand =>
            subcommand
                .setName("add")
                .setDescription("Add words to the blacklist")
                .addStringOption(option =>
                    option
                        .setName("words")
                        .setDescription("Comma or newline separated words")
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName("remove")
                .setDescription("Remove words from the blacklist")
                .addStringOption(option =>
                    option
                        .setName("words")
                        .setDescription("Comma or newline separated words")
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName("import")
                .setDescription("Import blacklist entries from a text file")
                .addAttachmentOption(option =>
                    option
                        .setName("file")
                        .setDescription("Plain text file with one word or phrase per line")
                        .setRequired(true))
                .addBooleanOption(option =>
                    option
                        .setName("replace")
                        .setDescription("Replace the existing blacklist instead of merging")
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName("list")
                .setDescription("List configured blacklist entries"))
        .addSubcommand(subcommand =>
            subcommand
                .setName("clear")
                .setDescription("Remove all blacklisted entries and disable auto moderation"))
        .addSubcommand(subcommand =>
            subcommand
                .setName("setmessage")
                .setDescription("Set the custom message shown when blocking a message")
                .addStringOption(option =>
                    option
                        .setName("message")
                        .setDescription("Custom response shown to users")
                        .setRequired(true)))
        .addSubcommandGroup(group =>
            group
                .setName("filter")
                .setDescription("Manage additional auto moderation filters")
                .addSubcommand(subcommand =>
                    subcommand
                        .setName("add")
                        .setDescription("Create a separate auto moderation rule with its own keywords")
                        .addStringOption(option =>
                            option
                                .setName("words")
                                .setDescription("Comma or newline separated words for the new filter")
                                .setRequired(true))))
        .setContexts([InteractionContextType.Guild]),
    new SlashCommandBuilder()
        .setName("serverstats")
        .setDescription("Manage Jarvis server statistics channels")
        .addSubcommand(subcommand =>
            subcommand
                .setName("status")
                .setDescription("Show the current server stats configuration"))
        .addSubcommand(subcommand =>
            subcommand
                .setName("enable")
                .setDescription("Create or update server stats channels"))
        .addSubcommand(subcommand =>
            subcommand
                .setName("refresh")
                .setDescription("Refresh the server stats counts immediately"))
        .addSubcommand(subcommand =>
            subcommand
                .setName("report")
                .setDescription("Generate a snapshot report with charts")
                .addBooleanOption(option =>
                    option
                        .setName("public")
                        .setDescription("Post the report in the channel instead of privately")
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName("disable")
                .setDescription("Remove the server stats channels"))
        .setContexts([InteractionContextType.Guild]),
    new SlashCommandBuilder()
        .setName("memberlog")
        .setDescription("Configure Jarvis join and leave announcements")
        .addSubcommand(subcommand =>
            subcommand
                .setName("status")
                .setDescription("View the current join/leave log configuration"))
        .addSubcommand(subcommand =>
            subcommand
                .setName("setchannel")
                .setDescription("Choose where Jarvis posts join and leave messages")
                .addChannelOption(option =>
                    option
                        .setName("channel")
                        .setDescription("Text channel for join/leave reports")
                        .setRequired(true)
                        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
        .addSubcommand(subcommand =>
            subcommand
                .setName("enable")
                .setDescription("Enable join and leave announcements"))
        .addSubcommand(subcommand =>
            subcommand
                .setName("disable")
                .setDescription("Disable join and leave announcements"))
        .addSubcommand(subcommand =>
            subcommand
                .setName("addvariation")
                .setDescription("Add a custom message variation")
                .addStringOption(option =>
                    option
                        .setName("type")
                        .setDescription("Which event to customize")
                        .setRequired(true)
                        .addChoices(
                            { name: "Join", value: "join" },
                            { name: "Leave", value: "leave" }
                        ))
                .addStringOption(option =>
                    option
                        .setName("message")
                        .setDescription("Message text (supports placeholders like {mention})")
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName("removevariation")
                .setDescription("Remove a custom variation by its index")
                .addStringOption(option =>
                    option
                        .setName("type")
                        .setDescription("Which event to modify")
                        .setRequired(true)
                        .addChoices(
                            { name: "Join", value: "join" },
                            { name: "Leave", value: "leave" }
                        ))
                .addIntegerOption(option =>
                    option
                        .setName("index")
                        .setDescription("Position from the status list to remove")
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName("setcustom")
                .setDescription("Set a single custom message that always sends")
                .addStringOption(option =>
                    option
                        .setName("type")
                        .setDescription("Which event to customize")
                        .setRequired(true)
                        .addChoices(
                            { name: "Join", value: "join" },
                            { name: "Leave", value: "leave" }
                        ))
                .addStringOption(option =>
                    option
                        .setName("message")
                        .setDescription("Message text (supports placeholders like {mention})")
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName("clearcustom")
                .setDescription("Remove the custom message override")
                .addStringOption(option =>
                    option
                        .setName("type")
                        .setDescription("Which event to reset")
                        .setRequired(true)
                        .addChoices(
                            { name: "Join", value: "join" },
                            { name: "Leave", value: "leave" }
                        )))
        .setContexts([InteractionContextType.Guild]),
    ...musicCommandList.map((command) => command.data)
];

const commands = allCommands.filter((builder) => {
    const featureKey = commandFeatureMap.get(builder.name);
    return isFeatureGloballyEnabled(featureKey, true);
});

function buildCommandData() {
    return commands.map((command) => command.toJSON());
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
    try {
        writeJsonAtomic(COMMAND_SYNC_STATE_PATH, commandSyncState);
    } catch (error) {
        console.warn('Failed to persist command sync state:', error);
    }
}

const serverStatsRefreshJob = cron.schedule('*/10 * * * *', async () => {
    try {
        await discordHandlers.refreshAllServerStats(client);
    } catch (error) {
        console.error('Failed to refresh server stats:', error);
    }
}, { scheduled: false });

async function registerSlashCommands() {
    const commandData = buildCommandData();
    const commandHash = crypto.createHash('sha256').update(JSON.stringify(commandData)).digest('hex');
    const state = ensureCommandSyncState();
    let registeredNames = commandData.map((cmd) => cmd.name);

    if (state.globalHash !== commandHash) {
        if (!client.application?.id) {
            await client.application?.fetch();
        }

        const registered = await client.application.commands.set(commandData);
        registeredNames = Array.from(registered.values(), (cmd) => cmd.name);

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
            console.log(`Cleared guild-specific commands for ${guild.name ?? 'Unknown'} (${guild.id})`);
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

// Webhook forwarder requires raw body parsing for signature validation, so mount before json middleware
app.use("/webhook", webhookRouter);

app.use(express.json({ limit: '2mb' }));

// Main endpoint - ASCII Animation Page
app.get("/", async (req, res) => {
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
        const missingRequired = snapshot.env.required.filter(item => !item.present).map(item => item.name);
        const optionalEnabled = snapshot.env.optional.filter(item => item.present).map(item => item.name);
        const databaseStatus = snapshot.database;

        const providerList = providerStatus.map(provider => {
            const uptimePercent = provider.metrics.successRate != null
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

            const disabledInfo = provider.isDisabled && provider.disabledUntil
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
        }).join('') || '<div class="provider-item"><span class="provider-name">No providers configured</span></div>';

        const envSummaryLines = [
            `Required: ${envRequiredCount}/${envRequiredTotal}`,
            missingRequired.length ? `Missing: ${missingRequired.join(', ')}` : 'Missing: None',
            `Optional: ${optionalConfigured}/${optionalTotal}`,
            `Enabled: ${optionalEnabled.length}`,
            ...optionalEnabled.map((name) => `- ${name}`)
        ].join('\\n');

        const dbLines = [
            `Connected: ${databaseStatus.connected ? '✅ Yes' : '❌ No'}`,
            `Ping: ${databaseStatus.ping}`,
            databaseStatus.error ? `Last error: ${databaseStatus.error}` : null
        ].filter(Boolean).join('\n');

        const uptimeText = `${Math.floor(uptimeSeconds / 3600)}h ${Math.floor((uptimeSeconds % 3600) / 60)}m ${uptimeSeconds % 60}s`;
        const memoryText = `${Math.round(memory.heapUsed / 1024 / 1024)}MB / ${Math.round(memory.heapTotal / 1024 / 1024)}MB`;

        res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Jarvis++ - AI Assistant</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            background: #000;
            color: #00ff00;
            font-family: 'Courier New', monospace;
            font-size: 14px;
            line-height: 1.4;
            overflow-x: auto;
            padding: 20px;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
        }
        
        .ascii-art {
            white-space: pre;
            text-align: center;
            margin: 20px 0;
            color: #00ffff;
            text-shadow: 0 0 10px #00ffff;
        }
        
        .status-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 20px;
            margin: 20px 0;
        }
        
        .status-card {
            background: rgba(0, 255, 0, 0.1);
            border: 1px solid #00ff00;
            border-radius: 5px;
            padding: 15px;
            font-family: 'Courier New', monospace;
        }
        
        .status-card h3 {
            color: #00ffff;
            margin-bottom: 10px;
            text-align: center;
        }
        
        .provider-list {
            max-height: 200px;
            overflow-y: auto;
        }
        
        .provider-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 2px 0;
            border-bottom: 1px solid rgba(0, 255, 0, 0.2);
        }
        
        .provider-name {
            color: #ffffff;
        }
        
        .provider-meta {
            font-size: 12px;
            color: #66ff66;
        }
        
        .provider-status {
            font-weight: bold;
        }
        
        .online { color: #00ff00; }
        .offline { color: #ff0000; }
        .warning { color: #ffff00; }
        
        .pulse {
            animation: pulse 2s infinite;
        }
        
        @keyframes pulse {
            0% { opacity: 1; }
            50% { opacity: 0.5; }
            100% { opacity: 1; }
        }
        
        .glitch {
            animation: glitch 3s infinite;
        }
        
        @keyframes glitch {
            0% { transform: translate(0); }
            20% { transform: translate(-2px, 2px); }
            40% { transform: translate(-2px, -2px); }
            60% { transform: translate(2px, 2px); }
            80% { transform: translate(2px, -2px); }
            100% { transform: translate(0); }
        }
        
        .footer {
            text-align: center;
            margin-top: 30px;
            color: #666;
            font-size: 12px;
        }
        
        .refresh-btn {
            background: #00ff00;
            color: #000;
            border: none;
            padding: 10px 20px;
            border-radius: 5px;
            cursor: pointer;
            font-family: 'Courier New', monospace;
            font-weight: bold;
            margin: 20px auto;
            display: block;
        }
        
        .refresh-btn:hover {
            background: #00ffff;
            color: #000;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="ascii-art glitch">
         ██╗  █████╗ ██████╗ ██╗   ██╗██╗███████╗
         ██╗██╔══██╗██╔══██╗██║   ██║██║██╔════╝
         ██║███████║██████╔╝██║   ██║██║███████╗
         ██║██╔══██║██╔══██╗╚██╗ ██╔╝██║╚════██║
    ██████╔╝██║  ██║██║  ██║ ╚████╔╝ ██║███████║
    ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝  ╚═══╝  ╚═╝╚══════╝
        </div>
        
        <div class="ascii-art pulse">
    ╔══════════════════════════════════════════════════════════════╗
    ║                    SYSTEM STATUS: ONLINE                    ║
    ║                  Always at your service, sir.               ║
    ╚══════════════════════════════════════════════════════════════╝
        </div>
        
        <div class="status-grid">
            <div class="status-card">
                <h3>🤖 AI PROVIDERS</h3>
                <div class="provider-list">
                    ${providerList}
                </div>
                <div style="margin-top: 10px; text-align: center;">
                    <strong>${workingProviders}/${providerStatus.length} Active</strong>
                </div>
            </div>

            <div class="status-card">
                <h3>🧪 ENVIRONMENT</h3>
                <div style="white-space: pre;">
${envSummaryLines}
                </div>
            </div>
            
            <div class="status-card">
                <h3>💾 SYSTEM INFO</h3>
                <div style="white-space: pre;">
Database:
${dbLines}
Uptime: ${uptimeText}
Memory: ${memoryText}
                </div>
            </div>
        </div>
        
        <div class="ascii-art">
    ╔══════════════════════════════════════════════════════════════╗
    ║  🔗 Health Check: /health                                   ║
    ║  🎯 Discord Bot: Active                                     ║
    ╚══════════════════════════════════════════════════════════════╝
        </div>
        
        <button class="refresh-btn" onclick="location.reload()">
            🔄 REFRESH STATUS
        </button>
        <button class="refresh-btn" onclick="location.href='/dashboard'">
            📊 OPEN DASHBOARD
        </button>
        
        <div class="footer">
            <div class="ascii-art">
    ═══════════════════════════════════════════════════════════════
    Powered by Advanced AI • Neural Networks • Quantum Processing
    ═══════════════════════════════════════════════════════════════
            </div>
        </div>
    </div>
    
    <script>
        // Auto-refresh every 30 seconds
        setTimeout(() => {
            location.reload();
        }, 30000);
        
        // Add some terminal-like effects
        document.addEventListener('DOMContentLoaded', function() {
            const cards = document.querySelectorAll('.status-card');
            cards.forEach((card, index) => {
                setTimeout(() => {
                    card.style.opacity = '0';
                    card.style.transform = 'translateY(20px)';
                    card.style.transition = 'all 0.5s ease';
                    setTimeout(() => {
                        card.style.opacity = '1';
                        card.style.transform = 'translateY(0)';
                    }, 100);
                }, index * 200);
            });
        });
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
            return res.status(401).json({ status: 'unauthorized', error: 'Valid bearer token required' });
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
            return res.status(401).json({ status: 'unauthorized', error: 'Valid bearer token required' });
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

app.get("/dashboard", async (req, res) => {
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

        const providerRows = snapshot.providers.map((provider, index) => {
            const uptimePercent = provider.metrics.successRate != null
                ? `${provider.metrics.successRate.toFixed(1)}%`
                : 'n/a';
            const latency = Number.isFinite(provider.metrics.avgLatencyMs)
                ? `${Math.round(provider.metrics.avgLatencyMs)} ms`
                : 'n/a';
            const totalCalls = provider.metrics.total ?? (provider.metrics.successes + provider.metrics.failures);
            const status = provider.isDisabled
                ? 'Paused'
                : provider.hasError
                    ? 'Error'
                    : 'Healthy';
            const disabledUntil = provider.isDisabled && provider.disabledUntil
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
        }).join('') || '<tr><td colspan="9">No providers configured</td></tr>';

        const requiredRows = snapshot.env.required.map((item) => `
                    <tr>
                        <td>${item.name}</td>
                        <td class="${item.present ? 'healthy' : 'error'}">${item.present ? 'Present' : 'Missing'}</td>
                    </tr>
        `).join('');

        const optionalRows = snapshot.env.optional.map((item) => `
                    <tr>
                        <td>${item.name}</td>
                        <td class="${item.present ? 'healthy' : 'paused'}">${item.present ? 'Configured' : 'Not set'}</td>
                    </tr>
        `).join('');

        const healthyProviders = snapshot.providers.filter(p => !p.hasError && !p.isDisabled).length;

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
app.get("/health", async (req, res) => {
    if (HEALTH_TOKEN && !isRenderHealthCheck(req)) {
        const providedToken = extractBearerToken(req);
        if (providedToken !== HEALTH_TOKEN) {
            return res.status(401).json({
                status: 'unauthorized',
                error: 'Valid bearer token required'
            });
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

        const healthyProviders = snapshot.providers.filter(p => !p.hasError && !p.isDisabled).length;
        const status =
            snapshot.env.hasAllRequired && snapshot.database.connected && healthyProviders > 0
                ? 'ok'
                : 'degraded';

        res.json({
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

    let databaseConnected = database.isConnected;

    if (!databaseConnected) {
        try {
            await database.connect();
            databaseConnected = true;
        } catch (error) {
            console.error("Failed to connect to MongoDB on startup:", error);
        }
    }

    if (databaseConnected) {
        await refreshPresenceMessages();
    }

    updateBotPresence();
    setInterval(updateBotPresence, PRESENCE_ROTATION_INTERVAL_MS);

    try {
        await registerSlashCommands();
    } catch (error) {
        console.error("Failed to register slash commands on startup:", error);
    }

    if (databaseConnected) {
        serverStatsRefreshJob.start();
        try {
            await discordHandlers.refreshAllServerStats(client);
        } catch (error) {
            console.error("Failed to refresh server stats on startup:", error);
        }
    } else {
        console.warn("Skipping server stats initialization because the database connection was not established.");
    }

    console.log("Provider status on startup:", aiManager.getProviderStatus());
});

client.on("guildCreate", async (guild) => {
    console.log(`Joined new guild ${guild.name ?? 'Unknown'} (${guild.id}). Synchronizing slash commands.`);

    console.log("Provider status on startup:", aiManager.getProviderStatus());
});

client.on("messageCreate", async (message) => {
    await discordHandlers.handleMessage(message, client);
});

client.on("interactionCreate", async (interaction) => {
    try {
        if (interaction.isChatInputCommand()) {
            await discordHandlers.handleSlashCommand(interaction);
        } else if (interaction.isButton()) {
            await discordHandlers.handleComponentInteraction(interaction);
        }
    } catch (error) {
        console.error('Interaction handler error:', error);
        if (typeof interaction.isRepliable === 'function' && interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: 'Technical difficulties, sir.', ephemeral: true }).catch(() => {});
        }
    }
});

client.on("voiceStateUpdate", async (oldState, newState) => {
    await discordHandlers.handleVoiceStateUpdate(oldState, newState);
});

client.on("voiceStateUpdate", async (oldState, newState) => {
    await discordHandlers.handleVoiceStateUpdate(oldState, newState);
});

client.on("messageReactionAdd", async (reaction, user) => {
    await discordHandlers.handleReactionAdd(reaction, user);
});

client.on("messageReactionRemove", async (reaction, user) => {
    await discordHandlers.handleReactionRemove(reaction, user);
});

client.on("messageDelete", async (message) => {
    await discordHandlers.handleTrackedMessageDelete(message);
});

client.on("guildMemberAdd", async (member) => {
    await discordHandlers.handleGuildMemberAdd(member);
});

client.on("guildMemberRemove", async (member) => {
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
client.on("error", (err) => {
    console.error("Discord client error:", err);
    // Don't exit on Discord errors, just log them
});

process.on("unhandledRejection", (err) => {
    console.error("Unhandled promise rejection:", err);
    // Log but don't exit - let the bot continue running
});

process.on("SIGTERM", async () => {
    console.log("Jarvis is powering down...");
    try {
        serverStatsRefreshJob.stop();
        await database.disconnect();
        client.destroy();
    } catch (error) {
        console.error("Error during shutdown:", error);
    }
    process.exit(0);
});

process.on("SIGINT", async () => {
    console.log("Jarvis received SIGINT, shutting down gracefully...");
    try {
        serverStatsRefreshJob.stop();
        await database.disconnect();
        client.destroy();
    } catch (error) {
        console.error("Error during shutdown:", error);
    }
    process.exit(0);
});

// ------------------------ Boot ------------------------
async function startBot() {
    try {
        // Start uptime server
        app.listen(config.server.port, '0.0.0.0', () => {
            console.log(`Uptime server listening on port ${config.server.port}`);
        });

        // Warm up MongoDB before we touch Discord
        await database.connect();
        await refreshPresenceMessages(true);

        // Start Discord bot
        await client.login(config.discord.token);
        console.log(`✅ Logged in as ${client.user.tag}`);
    } catch (error) {
        console.error("Failed to start bot:", error);
        process.exit(1);
    }
}

// Start the bot
startBot();

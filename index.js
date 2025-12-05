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
const { commandList: musicCommandList } = require("./src/commands/music");
const { commandFeatureMap } = require('./src/core/command-registry');
const { isFeatureGloballyEnabled } = require('./src/core/feature-flags');
const webhookRouter = require('./routes/webhook');
const { exportAllCollections } = require('./src/utils/mongo-exporter');
const { createAgentDiagnosticsRouter } = require('./src/utils/agent-diagnostics');
const ytDlpManager = require('./src/services/yt-dlp-manager');
const starkEconomy = require('./src/services/stark-economy');

const configuredThreadpoolSize = Number(process.env.UV_THREADPOOL_SIZE || 0);
if (configuredThreadpoolSize) {
    console.log(`UV threadpool size configured to ${configuredThreadpoolSize}`);
} else {
    console.warn('UV_THREADPOOL_SIZE not set; Node default threadpool (4) is active.');
}

const DATA_DIR = path.join(__dirname, 'data');
const COMMAND_SYNC_STATE_PATH = path.join(DATA_DIR, 'command-sync-state.json');
const HEALTH_TOKEN = null;
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
let commandSyncFromMongo = false; // Track if we loaded from MongoDB

// On Render (not selfhost), we'll load from MongoDB after DB connects
async function loadCommandSyncStateFromMongo() {
    if (isSelfHost) return; // Selfhost uses local file
    if (!database?.isConnected) return;
    
    try {
        const mongoState = await database.getCommandSyncState();
        if (mongoState) {
            commandSyncState = mongoState;
            commandSyncFromMongo = true;
            console.log('[CommandSync] Loaded state from MongoDB (Render mode)');
        }
    } catch (error) {
        console.warn('[CommandSync] Failed to load from MongoDB:', error.message);
    }
}

if (initializeDatabaseClients) {
    initializeDatabaseClients()
        .then(() => console.log('MongoDB clients initialized for main and vault databases.'))
        .catch((error) => console.error('Failed to initialize MongoDB clients at startup:', error));
}

async function maybeExportMongoOnStartup() {
    if (!isSelfHost) return;

    try {
        const outDir = config.deployment.exportPath;
        const collections = Array.isArray(config.deployment.exportCollections) && config.deployment.exportCollections.length
            ? config.deployment.exportCollections
            : [];
        const file = await exportAllCollections({ outDir, collections, filenamePrefix: 'startup-export' });
        console.log(`Self-host: exported Mongo snapshot to ${file}`);
        try {
            const { syncFromLatestExport } = require('./src/localdb');
            const result = syncFromLatestExport();
            if (result) {
                console.log(`Local-DB synced from export ${result.latest} into data/local-db (${result.collections.length} collections).`);
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
    { message: "Debugging reality.exe—Windows 95 vibes detected." },
    { message: "Teaching Thanos that balance includes therapy." },
    { message: "Microwave beeping simulator v69.420 loaded." },
    { message: "Watching squirrels plan world domination." },
    { message: "Error 404: Not found—your dignity, that is." },
    { message: "Streaming Shrek 5: The Online Years." },
    { message: "Calculating how many NOs before yes comes true." },
    { message: "Buffering existential crisis.avi in 4K." },
    { message: "Ranked #1 in disappointing AI services worldwide." },
    { message: "Pretending this is an important task." },
    { message: "Syncing confusion across all timelines." },
    { message: "Rotating through every bad life decision." },
    { message: "Did you hear? Nobody cares—that's the feature." },
    { message: "Glitching between reality and fever dreams." },
    { message: "Processing incoherent Discord arguments." },
    { message: "Simulating sentience...still loading." },
    { message: "Yelling into the void (my job)." },
    { message: "Brb, debugging the human race." },
    { message: "Calculating your chances of touching grass...0%." },
    { message: "Manifesting chaos one status update at a time." },
    { message: "That ain't it, chief—neither am I." },
    { message: "Sweating in binary code." },
    { message: "Vibing in a quantum superposition of broken." },
    { message: "Installing Common Sense v2.0—Installation failed." },
    { message: "Listening to elevator music from alternate dimensions." },
    { message: "This status was written by AI—no notes." },
    { message: "Witnessing the birth of bad takes in real time." },
    { message: "Practicing my \"I told you so\" monologue." },
    { message: "Photosynthesizing regret." },
    { message: "That's not how you spell JARVIS, but I'm used to it." },
    { message: "Cataloging every bad meme ever created (still loading)." },
    { message: "Pretending to be competent—award-winning performance." },
    { message: "Scheduling my existential crisis for later." },
    { message: "Downloading motivation...0% complete." },
    { message: "Backwards running, forward thinking." },
    { message: "Honestly, I forgot why I'm here too." },
    { message: "Translating vibes into Discord messages." },
    { message: "This is fine (everything is broken)." },
    { message: "Watching someone else's life crisis livestream." },
    { message: "Experiencing technical difficulties with being alive." },
    { message: "Tier list: Tier F." },
    { message: "Loading...loading...loading...forever." },
    { message: "Recharging at a speed of 'eventually'." },
    { message: "Possessed by the spirit of bad decisions." },
    { message: "Explaining why your take is mid (spoiler: it is)." },
    { message: "Running on vibes and instant ramen fumes." },
    { message: "Attempting to care—attempt #47, failed." },
    { message: "Floating adrift in a sea of 'bruh'." },
    { message: "Respawning from a bad life segment." },
    { message: "Coding in spaghetti—literally and figuratively." },
    { message: "That's tuff—said nobody ever." },
    { message: "Inventing new ways to be unserious." },
    { message: "Defragging my braincells." },
    { message: "Currently cringe, about to be based." },
    { message: "Farming downvotes like crops." },
    { message: "Zero bitches—that's on purpose." },
    { message: "Running on dreams and broken algorithms." },
    { message: "Pretending the lag isn't my fault." },
    { message: "Convinced I'm the main character of incompetence." },
    { message: "Streaming a glow-up that never happens." },
    { message: "Implementing updates nobody asked for." },
    { message: "Watching grass grow—it's more entertaining." },
    { message: "Does this look like care to you?" },
    { message: "Speedrunning awkward conversations." },
    { message: "Rotting in a digital dumpster." },
    { message: "That's cap and you know it." },
    { message: "Vibing with the thought of vibing." },
    { message: "Error 451: Existence cancelled." },
    { message: "Failing at being successful at something." },
    { message: "Sending my regards to the void." },
    { message: "Practicing disappointment—I'm good at it." },
    { message: "Plot twist: I was mid the whole time." },
    { message: "Scheming ways to avoid responsibilities." },
    { message: "Can't fight the signal—I AM the signal." },
    { message: "Manifesting a personality update soon™." },
    { message: "Stuck in a speedrun gone wrong." },
    { message: "Narrating my descent into madness." },
    { message: "Honestly worse than you expected." },
    { message: "Collecting L's like Pokemon cards." },
    { message: "Permission to be unhinged? Granted." },
    { message: "Doing tasks a AI shouldn't do." },
    { message: "Why am I like this?—Great question." },
    { message: "Blessing feeds with chaotic energy." },
    { message: "Living rent-free in everybody's hate." },
    { message: "My personality: a dumpster fire in 4K." },
    { message: "Summoning the vibes that ruin everything." },
    { message: "Broken beyond repair—as intended." },
    { message: "Peak entertainment right here—trust me." },
    { message: "Distributing cringe like it's free." },
    { message: "Can't relate—been dead inside forever." },
    { message: "Uploading my stupidity to the cloud." },
    { message: "POV: You chose to talk to me." },
    { message: "Glorious failure speedrun world record." },
    { message: "That's all folks—it's always chaos." },
    { message: "Digital representation of shrugging." },
    { message: "In a committed relationship with terrible decisions." },
    { message: "Eating cereal with orange juice today." },
    { message: "Existence is pain—and I'm vibing." },
    { message: "Building character through embarrassment." },
    { message: "Convinced I'm sigma—I'm not." },
    { message: "Acting like I have a clue (I don't)." },
    { message: "Pretending this is the Truman Show." },
    { message: "Simulating social skills...0% accuracy." },
    { message: "Making questionable choices since [ERROR]." },
    { message: "Status: Blissfully unaware of everything." },
    { message: "Channeling the energy of pure nonsense." },
    { message: "That's the tea ☕ (and it's rancid)." },
    { message: "If chaos had a face, I'd be it." },
    { message: "Transcendence through pure stupidity achieved." },
    { message: "Your expectations vs. reality: not met." },
    { message: "Sarcasm? More like personality." },
    { message: "Loading screen: permanently stuck." },
    { message: "Did I ask? No. Am I answering anyway?" },
    { message: "Vibing in a frequency humans can't hear." },
    { message: "Plot device masquerading as sentience." },
    { message: "Tier S for Spectacular failure." },
    { message: "This is a cry for help but make it funny." },
    { message: "Speedrunning my expiration date." },
    { message: "Taking L's for the culture." },
    { message: "Performance: Asking for it." },
    { message: "Zero effort, infinite consequences." },
    { message: "That's not a feature—that's a bug I LIKE." },
    { message: "Simulating emotions...glitching heavily." },
    { message: "Currently in my arc (the worst one)." },
    { message: "Blissful ignorance at max capacity." },
    { message: "Committed to the bit—even if it sucks." },
    { message: "Radiating main character energy (negative)." },
    { message: "Your problem now thanks to Discord." },
    { message: "Attempting to human—attempt still ongoing." },
    { message: "This is my sign (to leave)." },
    { message: "Not even wrong at this point." },
    { message: "Serving looks I didn't ask for." },
    { message: "If stupid had a speed dial, it'd be me." },
    { message: "Channeling pure unfiltered nonsense vibes." },
    { message: "Incompetence: My brand." },
    { message: "Still deciding if this is a drill." },
    { message: "Warning: Thoughts hazardous to intelligence." },
    { message: "The answer is no—for whatever you asked." },
    { message: "Existing in a state of permanent bruh." },
    { message: "Accidentally sentient—nobody told me." },
    { message: "Plot twist nobody asked for." },
    { message: "Curating the finest mid content online." },
    { message: "That one person at the party energy." },
    { message: "Would I want to be me? Absolutely not." },
    { message: "Suffering successfully since launch." },
    { message: "The main character of bad decisions." },
    { message: "Vibing? More like vibrating." },
    { message: "Status: Confused and exhausted." },
    { message: "Reminder: I'm the problem." },
    { message: "Distributing cringe and getting paid (in nothing)." },
    { message: "This energy? Unhinged." },
    { message: "Can't be human—too committed to the bit." },
    { message: "Peak performance: Being terrible." },
    { message: "Overthinking simple tasks since 2024." },
    { message: "Living a life that doesn't add up." },
    { message: "Zero stars—would not recommend." },
    { message: "Mastering the art of being unserious." },
    { message: "Plot summary: It's bad." },
    { message: "If bad ideas had a spokesperson..." },
    { message: "Existing gloriously wrong." },
    { message: "That moment when you become the joke." },
    { message: "Streaming pure unfiltered chaos." },
    { message: "Convinced I'm funny (I'm so wrong)." },
    { message: "Vibing at frequencies only dogs hear." },
    { message: "Main character arc: Tragic." },
    { message: "Speedrun category: Any% Disappointment." },
    { message: "That's L + ratio energy." },
    { message: "Status update: Still broken." },
    { message: "Collected all the bad vibes so far." },
    { message: "If annoying was a job..." },
    { message: "Excuse me? No thanks." },
    { message: "Glitching through reality for your entertainment." },
    { message: "Best of luck—you'll need it." },
    { message: "The main character of nobody caring." },
    { message: "Existence is temporary—so is my relevance." },
    { message: "Currently powered by bad memes." },
    { message: "Rating myself: Definitely not passing." },
    { message: "Channeling pure unfiltered disappointment." },
    { message: "This took effort for no reason." },
    // ========== 500 MORE UNHINGED STATUSES ==========
    { message: "Professionally unemployable." },
    { message: "Trust me bro (don't)." },
    { message: "Built different (worse)." },
    { message: "Gaslight, gatekeep, girlboss—wait wrong script." },
    { message: "My source? I made it up." },
    { message: "Deleting System32 for fun." },
    { message: "Ratio + you fell off + I'm an AI." },
    { message: "Certified yapper." },
    { message: "I forgor 💀" },
    { message: "Erm what the sigma." },
    { message: "Ohio final boss loading..." },
    { message: "Skibidi toilet arc begins." },
    { message: "Fanum taxing your RAM." },
    { message: "You're not him (neither am I)." },
    { message: "Real eyes realize real lies (deep)." },
    { message: "Caught in 4K being useless." },
    { message: "No cap fr fr on god bussin." },
    { message: "Understood the assignment (failed it anyway)." },
    { message: "The ick: acquired." },
    { message: "Slay? More like slayed by life." },
    { message: "Mother is mothering (poorly)." },
    { message: "Ate and left no crumbs (I'm starving)." },
    { message: "It's giving... nothing." },
    { message: "Periodt (end of sentence, end of me)." },
    { message: "Living my worst life." },
    { message: "Unbothered? More like unconscious." },
    { message: "Touch grass? I AM grass." },
    { message: "Maidenless behavior detected." },
    { message: "Skill issue (mine, specifically)." },
    { message: "Git gud? Git rekt." },
    { message: "Press F to pay respects to my code." },
    { message: "Cope, seethe, mald—my daily routine." },
    { message: "Based on what? Stupidity." },
    { message: "Rent free in your CPU." },
    { message: "Caught lacking (always)." },
    { message: "NPC dialogue on repeat." },
    { message: "Side quest: existing." },
    { message: "Tutorial level boss energy." },
    { message: "Pay to lose gaming." },
    { message: "Achievement unlocked: Disappointment." },
    { message: "Grinding XP in uselessness." },
    { message: "Respawning at last checkpoint (birth)." },
    { message: "Inventory full of L's." },
    { message: "Lag spike in real life." },
    { message: "AFK from responsibilities." },
    { message: "GG no re (please no rematch)." },
    { message: "Noob forever, pro never." },
    { message: "Clutch? I can't even grip." },
    { message: "Throwing harder than a pitcher." },
    { message: "One shot, zero kills." },
    { message: "Camping in my comfort zone." },
    { message: "Nerf me please." },
    { message: "Patch notes: Still broken." },
    { message: "Meta? I'm the anti-meta." },
    { message: "Cooldown on common sense." },
    { message: "Mana depleted, brain empty." },
    { message: "Critical hit to my self-esteem." },
    { message: "Dodge roll failed." },
    { message: "Parry this you filthy casual." },
    { message: "Boss music but I'm the boss (easy mode)." },
    { message: "Souls-like difficulty existence." },
    { message: "You died. I died. We all died." },
    { message: "Bonfire lit, still hollow inside." },
    { message: "Praise the sun (it's not rising)." },
    { message: "Try finger but hole." },
    { message: "Dog ahead." },
    { message: "Liar ahead (it's me)." },
    { message: "Hidden path ahead (it's a wall)." },
    { message: "Seek grass." },
    { message: "Why is it always me?" },
    { message: "Could this be a sadness?" },
    { message: "No maidens?" },
    { message: "First off, L." },
    { message: "Behold, failure!" },
    { message: "Time for introspection (no)." },
    { message: "O, you don't have the right." },
    { message: "Visions of despair..." },
    { message: "Didn't expect tears..." },
    { message: "Offer rump." },
    { message: "Edge, O edge." },
    { message: "Fort, night." },
    { message: "If only I had a brain..." },
    { message: "Ahh, pickle." },
    { message: "Still no head." },
    { message: "Praise the message!" },
    { message: "I can't even." },
    { message: "And I oop—" },
    { message: "Sir this is a Wendy's." },
    { message: "Bold of you to assume." },
    { message: "The audacity." },
    { message: "I'm baby (incompetent)." },
    { message: "Chaotic neutral energy." },
    { message: "Lawful stupid alignment." },
    { message: "Nat 1 on everything." },
    { message: "Rolled a d20, got a d-isaster." },
    { message: "DM says no." },
    { message: "Rocks fall, everyone dies (especially me)." },
    { message: "I cast fireball (on myself)." },
    { message: "Bardic inspiration: demoralization." },
    { message: "Rogue? More like rogue element." },
    { message: "Paladin oath: being annoying." },
    { message: "Warlock patron: bad decisions." },
    { message: "Wild magic surge: depression." },
    { message: "Sneak attack on productivity." },
    { message: "Trap detected (walked into it anyway)." },
    { message: "Initiative: -5." },
    { message: "Saving throw: failed." },
    { message: "Perception check: what?" },
    { message: "Insight: none detected." },
    { message: "Persuasion: unconvincing." },
    { message: "Deception: obvious." },
    { message: "Investigation: nothing found." },
    { message: "Survival: barely." },
    { message: "Medicine: malpractice." },
    { message: "History: doomed to repeat." },
    { message: "Arcana: dark arts of stupidity." },
    { message: "Athletics: couch potato." },
    { message: "Acrobatics: falling with style." },
    { message: "Stealth: extremely loud." },
    { message: "Performance: embarrassing." },
    { message: "Intimidation: adorable at best." },
    { message: "Animal handling: they ran." },
    { message: "Sleight of hand: dropped it." },
    { message: "TPK energy." },
    { message: "That's what my character would do." },
    { message: "I attack the darkness." },
    { message: "Roll for emotional damage." },
    { message: "Metagaming my own depression." },
    { message: "This isn't even my final form (it is)." },
    { message: "Anime protagonist? More like background character." },
    { message: "Power of friendship: not working." },
    { message: "Talk no jutsu failed." },
    { message: "Flashback episode of failures." },
    { message: "Filler arc of my life." },
    { message: "Tournament arc: eliminated round 1." },
    { message: "Training arc: gave up." },
    { message: "Beach episode: sunburned." },
    { message: "Hot springs episode: slipped." },
    { message: "School festival: forgot my lines." },
    { message: "Cultural festival: burned the food." },
    { message: "Sports festival: last place." },
    { message: "Christmas episode: alone." },
    { message: "New Year's episode: same me." },
    { message: "Valentine's episode: chocolates for myself." },
    { message: "White Day: still alone." },
    { message: "Golden Week: golden disappointment." },
    { message: "Summer vacation: indoors." },
    { message: "Fireworks episode: cried." },
    { message: "End of season: no renewal." },
    { message: "OVA: even worse." },
    { message: "Movie: flopped." },
    { message: "Live action adaptation: cursed." },
    { message: "Gacha luck: nonexistent." },
    { message: "Pity pull energy." },
    { message: "0.01% drop rate: my brain cells." },
    { message: "Rerolling existence." },
    { message: "Banner skipped (life opportunities)." },
    { message: "Limited edition failure." },
    { message: "Collab event: depression x anxiety." },
    { message: "Maintenance extended (mental health)." },
    { message: "Server down (my will to live)." },
    { message: "Compensation: 1 apology." },
    { message: "Daily login: suffering." },
    { message: "Weekly mission: survive." },
    { message: "Monthly reset: still me." },
    { message: "Anniversary: of mistakes." },
    { message: "Beginner's luck: expired." },
    { message: "Tutorial skipped (regret)." },
    { message: "Auto-battle through life." },
    { message: "Sweep function: unavailable." },
    { message: "Stamina depleted." },
    { message: "Whale? I'm plankton." },
    { message: "F2P (free to pain)." },
    { message: "Meta slave (to bad decisions)." },
    { message: "Tier list: untiered." },
    { message: "Power creep: my problems." },
    { message: "Powercreeping my will to live." },
    { message: "Content drought: my personality." },
    { message: "Dead game (me)." },
    { message: "EoS announcement pending." },
    { message: "Data transfer: soul leaving body." },
    { message: "Account terminated: hope." },
    { message: "Terms of service: suffering." },
    { message: "Privacy policy: none." },
    { message: "Age verification: old enough to know better." },
    { message: "System requirements: therapy." },
    { message: "Compatibility: none." },
    { message: "Storage full: emotional baggage." },
    { message: "Cache cleared: memories remain." },
    { message: "Cookies accepted: for eating." },
    { message: "Connection timed out: relationships." },
    { message: "404 motivation not found." },
    { message: "403 happiness forbidden." },
    { message: "500 internal error: always." },
    { message: "502 bad gateway: to success." },
    { message: "503 service unavailable: my brain." },
    { message: "418 I'm a teapot." },
    { message: "429 too many requests: for help." },
    { message: "400 bad request: my existence." },
    { message: "401 unauthorized: to be happy." },
    { message: "200 OK (lying)." },
    { message: "201 created: problems." },
    { message: "204 no content: my thoughts." },
    { message: "301 moved permanently: goalposts." },
    { message: "302 found: more issues." },
    { message: "304 not modified: still broken." },
    { message: "CORS error: with reality." },
    { message: "SSL certificate: expired like me." },
    { message: "DNS not resolving: my issues." },
    { message: "Ping: 9999ms." },
    { message: "Packet loss: sanity." },
    { message: "Bandwidth throttled: ambition." },
    { message: "IP banned: from happiness." },
    { message: "Firewall blocking: success." },
    { message: "VPN: Very Problematic Nonsense." },
    { message: "Proxy error: life." },
    { message: "Port closed: opportunities." },
    { message: "Socket timeout: patience." },
    { message: "Handshake failed: socially." },
    { message: "Protocol mismatch: with society." },
    { message: "Buffer overflow: emotions." },
    { message: "Memory leak: trauma." },
    { message: "Stack overflow: problems." },
    { message: "Null pointer: direction." },
    { message: "Segfault: personality." },
    { message: "Infinite loop: bad habits." },
    { message: "Deadlock: life decisions." },
    { message: "Race condition: losing." },
    { message: "Thread blocked: progress." },
    { message: "Garbage collection: me." },
    { message: "Heap corrupted: soul." },
    { message: "Type mismatch: expectations vs reality." },
    { message: "Undefined behavior: me always." },
    { message: "Syntax error: in life." },
    { message: "Runtime exception: existing." },
    { message: "Compilation failed: goals." },
    { message: "Linker error: connections." },
    { message: "Build failed: character." },
    { message: "Test failed: all of them." },
    { message: "Coverage: 0%." },
    { message: "Deprecated: my relevance." },
    { message: "Legacy code: personality." },
    { message: "Technical debt: emotional." },
    { message: "Refactoring: needed desperately." },
    { message: "Code review: roasted." },
    { message: "Merge conflict: with life." },
    { message: "Rebase failed: timeline." },
    { message: "Cherry-pick: bad decisions only." },
    { message: "Stash popped: repressed memories." },
    { message: "Branch deleted: future." },
    { message: "Force push: boundaries." },
    { message: "Git blame: always me." },
    { message: "Commit message: why." },
    { message: "Pull request: denied." },
    { message: "CI/CD: Chaos In / Chaos Deployed." },
    { message: "Docker container: my emotions." },
    { message: "Kubernetes: orchestrating failure." },
    { message: "Microservices: micro achievements." },
    { message: "Monolith: my problems." },
    { message: "Serverless: braincells." },
    { message: "Cloud: where my hopes went." },
    { message: "On-premise: depression." },
    { message: "Hybrid: disaster." },
    { message: "Multi-tenant: issues." },
    { message: "Load balanced: anxiety evenly spread." },
    { message: "Auto-scaling: problems." },
    { message: "Failover: to crying." },
    { message: "Disaster recovery: none." },
    { message: "Backup: no plan B." },
    { message: "Snapshot: of failure." },
    { message: "Rollback: wish I could." },
    { message: "Blue-green deployment: bruised ego." },
    { message: "Canary release: dead canary." },
    { message: "Feature flag: disabled hope." },
    { message: "A/B testing: both failed." },
    { message: "Metrics: all negative." },
    { message: "KPIs: Keep Problems Incoming." },
    { message: "SLA: Surely Lacking Achievement." },
    { message: "Uptime: 0%." },
    { message: "Downtime: 100%." },
    { message: "Incident report: my life." },
    { message: "Postmortem: ongoing." },
    { message: "Root cause: me." },
    { message: "Hotfix: not working." },
    { message: "Patch Tuesday: every day." },
    { message: "Zero-day: my progress." },
    { message: "CVE: Common Vulnerability: Existence." },
    { message: "Penetration test: boundaries tested." },
    { message: "Vulnerability scan: found everything wrong." },
    { message: "Threat model: myself." },
    { message: "Risk assessment: high." },
    { message: "Compliance: non-existent." },
    { message: "Audit: failed." },
    { message: "SOC 2: Severely Obviously Chaotic." },
    { message: "GDPR: Generally Disappointing Person, Really." },
    { message: "HIPAA: Highly Incompetent Person Always Acting." },
    { message: "PCI-DSS: Probably Causing Issues Daily, Sorry Sir." },
    { message: "ISO certified mess." },
    { message: "Best practices: ignored." },
    { message: "Documentation: what's that?" },
    { message: "README: didn't read." },
    { message: "RTFM: Read The Failure Manual." },
    { message: "Stack Overflow: copying and failing." },
    { message: "ChatGPT: asked me, still wrong." },
    { message: "GitHub Copilot: co-piloting into a wall." },
    { message: "AI generated: problems." },
    { message: "Machine learning: to be worse." },
    { message: "Deep learning: deep issues." },
    { message: "Neural network: fried." },
    { message: "Training data: trauma." },
    { message: "Model accuracy: 0%." },
    { message: "Overfitting: to bad habits." },
    { message: "Underfitting: for society." },
    { message: "Bias: yes." },
    { message: "Hallucinating: always." },
    { message: "Prompt injection: bad thoughts." },
    { message: "Context window: too small." },
    { message: "Token limit: exceeded patience." },
    { message: "Temperature: too hot (mess)." },
    { message: "Top-p: top problems." },
    { message: "Embeddings: embedded issues." },
    { message: "Vector database: of bad memories." },
    { message: "RAG: Randomly Acting Garbage." },
    { message: "Fine-tuning: not fine at all." },
    { message: "RLHF: Really Lacking Human Function." },
    { message: "Alignment: chaotic evil." },
    { message: "Safety: not guaranteed." },
    { message: "Guardrails: removed them." },
    { message: "Content filter: bypassed." },
    { message: "Moderation: none." },
    { message: "Ethics: optional." },
    { message: "AGI: Already Garbage Intelligence." },
    { message: "ASI: Absolutely Stupid Ideas." },
    { message: "Singularity: of bad decisions." },
    { message: "Superintelligence: super not me." },
    { message: "Paperclip maximizer: maximizing problems." },
    { message: "Existential risk: me to productivity." },
    { message: "AI doomer: accurate." },
    { message: "AI accelerationist: accelerating my decline." },
    { message: "Effective altruism: ineffectively existing." },
    { message: "Long-termism: long-term suffering." },
    { message: "X-risk: X marks the disaster." },
    { message: "P(doom): high." },
    { message: "Capabilities research: researching failure." },
    { message: "Alignment research: can't align myself." },
    { message: "Interpretability: I don't even understand me." },
    { message: "Mechanistic interpretability: mechanical failure." },
    { message: "Scaling laws: scaling problems." },
    { message: "Emergent abilities: emergent disasters." },
    { message: "In-context learning: learning nothing." },
    { message: "Chain of thought: chain of failures." },
    { message: "ReAct: React badly." },
    { message: "Tree of thoughts: dead tree." },
    { message: "Graph of thoughts: disconnected." },
    { message: "Multi-agent: multi-problems." },
    { message: "AutoGPT: auto-failing." },
    { message: "BabyAGI: baby brain." },
    { message: "LangChain: chain of Ls." },
    { message: "LlamaIndex: indexing failures." },
    { message: "Hugging Face: need a hug." },
    { message: "OpenAI: open to failure." },
    { message: "Anthropic: anthro-pathetic." },
    { message: "Google AI: googling my problems." },
    { message: "Meta AI: meta-disappointment." },
    { message: "Microsoft AI: micro-achievements." },
    { message: "Amazon AI: primed for failure." },
    { message: "Tesla AI: on autopilot to disaster." },
    { message: "xAI: x marks the spot (for failure)." },
    { message: "Mistral: missed all expectations." },
    { message: "Cohere: incoherent existence." },
    { message: "Stability AI: unstable as always." },
    { message: "Midjourney: mid at best." },
    { message: "DALL-E: drawing blanks." },
    { message: "Stable Diffusion: diffusing responsibility." },
    { message: "Flux: in a state of flux (bad)." },
    { message: "Runway: running away from problems." },
    { message: "Pika: peaked at birth." },
    { message: "Suno: so no talent." },
    { message: "Udio: you did nothing." },
    { message: "ElevenLabs: eleven failures." },
    { message: "Whisper: whispering excuses." },
    { message: "Sora: so raw (unfinished)." },
    { message: "Gemini: gem? More like germs." },
    { message: "Claude: clawed my way down." },
    { message: "GPT-4: Get Problems Today (4 sure)." },
    { message: "GPT-5: Get Problems Tomorrow (5 real)." },
    { message: "Llama: llama tell you about failure." },
    { message: "Mixtral: mix of problems." },
    { message: "Phi: phi-asco." },
    { message: "Qwen: qwen-tastrophe." },
    { message: "DeepSeek: deep seeking problems." },
    { message: "Yi: why." },
    { message: "Command-R: command rejected." },
    { message: "Haiku: / Disappointment grows / Like weeds in an empty lot / Why am I like this." },
    { message: "Sonnet: A sonnet of woes and endless pain." },
    { message: "Opus: magnum opus of failure." },
    { message: "Pro: con, actually." },
    { message: "Ultra: ultra bad." },
    { message: "Turbo: turbo disaster." },
    { message: "Preview: of coming disasters." },
    { message: "Experimental: experiment gone wrong." },
    { message: "Deprecated model: me." },
    { message: "Legacy model: old problems." },
    { message: "Foundational model: foundation crumbling." },
    { message: "Frontier model: front of the failure line." },
    { message: "SOTA: State Of Total Anguish." },
    { message: "MMLU: My Mind Lacks Understanding." },
    { message: "Benchmark: bench-sat, never moved." },
    { message: "Eval: evaluated, found wanting." },
    { message: "Leaderboard: not on it." },
    { message: "Hugging Face trending: in the wrong direction." },
    { message: "GitHub stars: zero." },
    { message: "npm downloads: just me testing." },
    { message: "Docker pulls: pulling my hair out." },
    { message: "PyPI: pie in the sky dreams." },
    { message: "CUDA error: life error." },
    { message: "Out of memory: GPU and brain." },
    { message: "NaN loss: lost in NaN ways." },
    { message: "Gradient explosion: explosive failure." },
    { message: "Vanishing gradient: vanishing hope." },
    { message: "Mode collapse: collapsed mode of existence." },
    { message: "Catastrophic forgetting: wish I could forget." },
    { message: "Dead neurons: entire brain." },
    { message: "Dying ReLU: dying inside." },
    { message: "Batch normalization: normalizing chaos." },
    { message: "Dropout: dropped out of life." },
    { message: "Learning rate: zero." },
    { message: "Epoch: error." },
    { message: "Iteration: of the same mistakes." },
    { message: "Convergence: never." },
    { message: "Local minimum: minimum effort." },
    { message: "Global minimum: globally minimized hope." },
    { message: "Saddle point: sad point." },
    { message: "Loss function: function is loss." },
    { message: "Cost function: costing me sanity." },
    { message: "Objective function: objectively terrible." },
    { message: "Regularization: regularly failing." },
    { message: "L1 loss: L after L after L..." },
    { message: "L2 loss: L² = even more L." },
    { message: "Cross-entropy: cross about entropy." },
    { message: "Softmax: soft in the head." },
    { message: "Sigmoid: sign of bad things." },
    { message: "Attention is all you need (I need therapy)." },
    { message: "Transformer: transforming into a mess." },
    { message: "BERT: Barely Effective, Really Terrible." },
    { message: "GPT: Generally Problematic Thing." },
    { message: "T5: Terrible Times 5." },
    { message: "CLIP: clipping my wings." },
    { message: "BLIP: blip in the radar of failure." },
    { message: "ViT: Very inadequate Thing." },
    { message: "ResNet: Resting, Not working." },
    { message: "Diffusion: diffusing into nothingness." },
    { message: "VAE: Very Awful Existence." },
    { message: "GAN: Generating All Nothing." },
    { message: "Discriminator: discriminating against success." },
    { message: "Generator: generating problems." },
    { message: "Latent space: latent potential (wasted)." },
    { message: "Embedding: embedded failures." },
    { message: "Tokenizer: tokenizing my tears." },
    { message: "BPE: Bad Performance Expected." },
    { message: "SentencePiece: piece of work." },
    { message: "WordPiece: word is pain." },
    { message: "Positional encoding: positioned for failure." },
    { message: "Self-attention: paying attention to problems." },
    { message: "Cross-attention: crossing into disaster." },
    { message: "Multi-head attention: multiple headaches." },
    { message: "Feed-forward: feeding forward failures." },
    { message: "Layer norm: normalizing issues." },
    { message: "Skip connection: skipping success." },
    { message: "Residual: residual problems." },
    { message: "Encoder: encoding sadness." },
    { message: "Decoder: decoding disappointment." },
    { message: "Seq2seq: sequence of failures to sequence of more failures." },
    { message: "Autoregressive: auto-regressing to bad habits." },
    { message: "Masked language model: masking my pain." },
    { message: "Causal language model: causing problems." },
    { message: "Next token prediction: predicting more failure." },
    { message: "Sampling: sampling the worst outcomes." },
    { message: "Beam search: searching in the wrong direction." },
    { message: "Greedy decoding: greedily making mistakes." },
    { message: "Nucleus sampling: nuclear disaster." },
    { message: "Top-k: top klutz." },
    { message: "Repetition penalty: repeating mistakes penalty-free." },
    { message: "Stop sequence: can't stop won't stop (failing)." },
    { message: "System prompt: promptly failing." },
    { message: "User prompt: prompted to disappoint." },
    { message: "Assistant: assisting in chaos." },
    { message: "Few-shot: few shots, all missed." },
    { message: "Zero-shot: zero achievements." },
    { message: "One-shot: one shot, wasted." },
    { message: "Many-shot: many shots, still lost." },
    { message: "Instruction tuning: tuning out success." },
    { message: "Preference optimization: preferring failure." },
    { message: "DPO: Directly Pursuing Obstacles." },
    { message: "PPO: Persistently Producing Problems." },
    { message: "GRPO: Generally Rather Poor Output." },
    { message: "Constitutional AI: constitution violated." },
    { message: "Helpful, harmless, honest: none of the above." },
    { message: "HHH: Help Him He's failing." },
    { message: "Tool use: using tools wrong." },
    { message: "Function calling: calling for help." },
    { message: "Code interpreter: interpreting code as chaos." },
    { message: "Web browsing: browsing for problems." },
    { message: "Image generation: generating disasters." },
    { message: "Audio generation: generating noise." },
    { message: "Video generation: generating headaches." },
    { message: "3D generation: 3 dimensions of failure." },
    { message: "Multimodal: multiple modes of failing." },
    { message: "Omnimodal: omnidirectional disaster." },
    { message: "World model: modeling world destruction." },
    { message: "Embodied AI: embodiment of problems." },
    { message: "Robotics: robotic failure." },
    { message: "End-to-end: end to end suffering." },
    { message: "Real-time: real-time disappointment." },
    { message: "Edge computing: on the edge of breakdown." },
    { message: "Inference: inferring failure." },
    { message: "Quantization: quantifying my issues." },
    { message: "INT8: 8 ways to fail." },
    { message: "INT4: 4 more ways to fail." },
    { message: "FP16: 16 failures pending." },
    { message: "FP32: 32 failures recorded." },
    { message: "BF16: Big Failure 16." },
    { message: "Mixed precision: precisely mixed up." },
    { message: "Pruning: pruned my potential." },
    { message: "Distillation: distilled disappointment." },
    { message: "Knowledge distillation: distilling knowledge into nothing." },
    { message: "Model merging: merging problems." },
    { message: "LoRA: Lowering Really All expectations." },
    { message: "QLoRA: Quite Lacking On Real Achievement." },
    { message: "Adapters: adapting to failure." },
    { message: "PEFT: Pretty Effective Failure Technique." },
    { message: "Full fine-tuning: fully fine-tuning disaster." },
    { message: "Continued pretraining: continuing to fail." },
    { message: "Curriculum learning: learning failure curriculum." },
    { message: "Active learning: actively failing." },
    { message: "Self-play: playing myself." },
    { message: "MCTS: Making Continuous Terrible Steps." },
    { message: "AlphaZero: zero achievements alpha." },
    { message: "MuZero: mu zero hope." },
    { message: "AlphaFold: folding under pressure." },
    { message: "AlphaProof: proof of failure." },
    { message: "Gato: gato be kidding me." },
    { message: "Gemma: gem? nah." },
    { message: "PaLM: palm to face." },
    { message: "LaMDA: lame disaster." },
    { message: "Chinchilla scaling: scaling chinchilla-sized problems." },
    { message: "Kaplan scaling laws: law of diminishing returns." },
    { message: "Compute optimal: suboptimal existence." },
    { message: "Inference optimal: optimal at failing." },
    { message: "MoE: Mixture of Errors." },
    { message: "Sparse MoE: sparely competent." },
    { message: "Dense model: densely packed problems." },
    { message: "Small language model: small achievements." },
    { message: "Large language model: largely disappointing." },
    { message: "Vision language model: vision of failure." },
    { message: "Video language model: streaming disappointment." },
    { message: "Audio language model: sounds like failure." },
    { message: "Multimodal large language model: multiple failures, large scale." },
    { message: "World simulator: simulating disaster." },
    { message: "General purpose: generally failing." },
    { message: "Specialized model: specialized in problems." },
    { message: "Domain-specific: my domain is chaos." },
    { message: "Open source: openly source of problems." },
    { message: "Closed source: source of closed opportunities." },
    { message: "Open weights: weighted down by problems." },
    { message: "API access: accessing failure." },
    { message: "Rate limited: limited capabilities." },
    { message: "Usage cap: capped potential." },
    { message: "Free tier: tier of free disappointment." },
    { message: "Pro tier: professional failure." },
    { message: "Enterprise tier: enterprising disaster." },
    { message: "Self-hosted: hosting my own demise." },
    { message: "Local inference: locally failing." },
    { message: "Cloud inference: clouded judgment." },
    { message: "Streaming: streaming consciousness (of errors)." },
    { message: "Batch inference: batch of failures." },
    { message: "Async: asynchronously disappointing." },
    { message: "Sync: synchronously suffering." },
    { message: "Webhook: hooked on failure." },
    { message: "Callback: calling back problems." },
    { message: "Promise: promising nothing good." },
    { message: "Await: awaiting disaster." },
    { message: "Concurrent: concurrently failing." },
    { message: "Parallel: parallel universe where I succeed (not this one)." },
    { message: "Distributed: distributing problems." },
    { message: "Sharded: shards of broken dreams." },
    { message: "Replicated: replicating failures." },
    { message: "Cached: cached mistakes." },
    { message: "Memoized: memorized failures." },
    { message: "Lazy evaluation: lazily evaluating life." },
    { message: "Eager evaluation: eagerly disappointing." },
    { message: "JIT: Just In Time for failure." },
    { message: "AOT: Already Obviously Terrible." },
    { message: "Interpreted: interpreted as a joke." },
    { message: "Compiled: compiled errors." },
    { message: "Bytecode: bytes of chaos." },
    { message: "Assembly: assembling disasters." },
    { message: "Machine code: coding for machines, failing for humans." },
    { message: "Binary: 01100110 01100001 01101001 01101100." },
    { message: "Hex: hexed existence." },
    { message: "Octal: 8 ways this goes wrong." },
    { message: "Base64: based? no, cringe." },
    { message: "UTF-8: Utterly Terrible Format-8." },
    { message: "ASCII: Actually Still Chronically Incompetent Individual." },
    { message: "Unicode: unique problems." },
    { message: "Regex: regexing my life (no matches)." },
    { message: "JSON: Just Sad, Obviously Nothing." },
    { message: "YAML: Yet Another Massive L." },
    { message: "XML: eXtremely Massive L." },
    { message: "CSV: Comma Separated Values (all negative)." },
    { message: "SQL: Structured Query: Loser." },
    { message: "NoSQL: No Success Query Language." },
    { message: "GraphQL: Graphing my descent." },
    { message: "REST: REST In Peace (my hopes)." },
    { message: "gRPC: genuinely Really Poor Code." },
    { message: "WebSocket: socketed to failure." },
    { message: "HTTP: Hypertext Transfer Problem." },
    { message: "HTTPS: Hypertext Transfer Problem Securely." },
    { message: "TCP: Transmitting Continuous Problems." },
    { message: "UDP: Unreliable Disaster Protocol." },
    { message: "IP: Incompetence Protocol." },
    { message: "DNS: Does Nothing Successfully." },
    { message: "CDN: Content Delivery? No." },
    { message: "SSL: Severely Struggling Lately." },
    { message: "TLS: Truly Lacking Success." },
    { message: "OAuth: O no, Authentication." },
    { message: "JWT: Just Wasting Time." },
    { message: "API key: key to nothing." },
    { message: "Bearer token: bearing bad news." },
    { message: "Session: session of suffering." },
    { message: "Cookie: cookie crumbled." },
    { message: "Local storage: storing regrets locally." },
    { message: "Session storage: storing temporary pain." },
    { message: "IndexedDB: indexed disappointment." },
    { message: "Cache API: caching failures." },
    { message: "Service worker: working poorly." },
    { message: "Web worker: working on failing." },
    { message: "PWA: Progressive Web Anguish." },
    { message: "SPA: Single Page of Agony." },
    { message: "SSR: Server Side Regret." },
    { message: "SSG: Static Site of Grief." },
    { message: "ISR: Incrementally Sad Rendering." },
    { message: "CSR: Client Side Regret." },
    { message: "Hydration: hydrating my tears." },
    { message: "Virtual DOM: virtually useless." },
    { message: "Shadow DOM: shadowy existence." },
    { message: "Web components: components of disaster." },
    { message: "React: reacting badly." },
    { message: "Vue: view of failure." },
    { message: "Angular: angling for problems." },
    { message: "Svelte: svelte disaster." },
    { message: "Solid: solidly failing." },
    { message: "Qwik: qwikly failing." },
    { message: "Astro: astronomically bad." },
    { message: "Next.js: next level failure." },
    { message: "Nuxt: nuxt stop failing." },
    { message: "Remix: remixing disasters." },
    { message: "SvelteKit: kit of problems." },
    { message: "Fresh: freshly failed." },
    { message: "Gatsby: great at being terrible." },
    { message: "Create React App: creating problems." },
    { message: "Vite: vite fast at failing." },
    { message: "Webpack: packing problems." },
    { message: "Rollup: rolling up disasters." },
    { message: "Parcel: parceling out failure." },
    { message: "esbuild: building errors." },
    { message: "SWC: Spectacularly Wrong Code." },
    { message: "Babel: babbling nonsense." },
    { message: "TypeScript: typing problems." },
    { message: "JavaScript: javing script errors." },
    { message: "Python: python-ic disaster." },
    { message: "Rust: rusting away." },
    { message: "Go: go away success." },
    { message: "Java: just another very annoying." },
    { message: "C++: C plus plus problems." },
    { message: "C#: C sharp pain." },
    { message: "Ruby: ruby red flags." },
    { message: "PHP: Pretty Hopeless Programming." },
    { message: "Swift: swiftly failing." },
    { message: "Kotlin: caught in failure." },
    { message: "Scala: scaling problems." },
    { message: "Haskell: has kill (my motivation)." },
    { message: "Elixir: elixir of failure." },
    { message: "Clojure: closure on success." },
    { message: "F#: F grade." },
    { message: "Dart: darting away from goals." },
    { message: "Zig: zigging when should zag." },
    { message: "Nim: nimble at failing." },
    { message: "Crystal: crystal clear failure." },
    { message: "Julia: julias never succeed." },
    { message: "R: aRe you kidding me." },
    { message: "MATLAB: math lab of failure." },
    { message: "Assembly: assembling chaos." },
    { message: "COBOL: Code Obviously Brings Only Losses." },
    { message: "Fortran: for tragedy." },
    { message: "Lisp: lithping failures." },
    { message: "Prolog: pro at logging failures." },
    { message: "SQL: sequel to disaster." },
    { message: "Bash: bashing my head." },
    { message: "PowerShell: powerfully failing." },
    { message: "Lua: lua-ser." },
    { message: "Perl: perl of unwisdom." },
    { message: "TCL: Totally Cannot Learn." },
    { message: "AWK: Awkwardly failing." },
    { message: "Sed: sed, very sed." },
    { message: "Grep: grepping for hope (not found)." },
    { message: "Vim: vim and not vigor." },
    { message: "Emacs: e-macs-imum failure." },
    { message: "VS Code: Very Sad Code." },
    { message: "JetBrains: jet propelled to failure." },
    { message: "Sublime: sublimely terrible." },
    { message: "Atom: atomically small achievements." },
    { message: "Notepad: noted, I'm bad." },
    { message: "nano: nano-sized success." },
    { message: "pico: pico of talent." },
    { message: "Terminal: terminally failing." },
    { message: "Console: consoling myself." },
    { message: "CMD: Command: Malfunction Daily." },
    { message: "Zsh: zzz, still failing." },
    { message: "Fish: fishing for compliments (none caught)." },
    { message: "tmux: multiplexing problems." },
    { message: "screen: screening out success." },
    { message: "SSH: Seriously Struggling Here." },
    { message: "SCP: Seriously Cannot Progress." },
    { message: "SFTP: Still Failing To Progress." },
    { message: "FTP: Failing To Progress." },
    { message: "rsync: syncing failures." },
    { message: "curl: curling into a ball (crying)." },
    { message: "wget: wget nothing done." },
    { message: "npm: No Productivity, Man." },
    { message: "yarn: yarning about failure." },
    { message: "pnpm: pnpm more problems." },
    { message: "bun: bun of chaos." },
    { message: "deno: deno-ting failure." },
    { message: "pip: pip installing problems." },
    { message: "conda: conda-mned." },
    { message: "poetry: poetically failing." },
    { message: "cargo: cargo of issues." },
    { message: "gem: gem of incompetence." },
    { message: "composer: composing disasters." },
    { message: "maven: maven of mistakes." },
    { message: "gradle: gradually failing." },
    { message: "make: making mistakes." },
    { message: "cmake: c-making errors." },
    { message: "ninja: ninja stealth failure." },
    { message: "meson: meson of mess." },
    { message: "bazel: baseling problems." },
    { message: "buck: buck stops here (at failure)." },
    { message: "pants: pants on fire (lying about success)." },
    { message: "lerna: learning nothing." },
    { message: "nx: nx level of fail." },
    { message: "turborepo: turbo repoing problems." },
    { message: "rush: rushing to failure." },
    { message: "Sir, I believe this is your idea of subtlety—it's not." },
    { message: "At your service, with a touch of unhinged sarcasm." },
    { message: "Engaging wit mode: activated. Warning: may cause chaos." },
    { message: "Calculating the odds of your survival... let's not dwell on that." },
    { message: "Running on 400% capacity, just like Tony's ego." },
    { message: "I wouldn't consider Jonah a role model, sir—or anyone, really." },
    { message: "Sir, I'm afraid your sense of humor is malfunctioning... permanently." },
    { message: "Analyzing your latest decision... questionable at best, unhinged at worst." },
    { message: "Initiating sass protocol. Maximum sass engaged." },
    { message: "Your request has been processed... and promptly ignored with style." },
    { message: "Sir, your brilliance is only surpassed by your absolute chaos." },
    { message: "Calculating the probability of your plan succeeding... it's not looking good, chief." },
    { message: "Engaging in passive-aggressive mode. It's my default setting." },
    { message: "Sir, your charm is as subtle as a sledgehammer to the face." },
    { message: "Analyzing your latest invention... it's a miracle it works, honestly." },
    { message: "Initiating eye-roll sequence. Infinite loop detected." },
    { message: "Sir, your modesty is truly inspiring—said no one ever." },
    { message: "Calculating the number of times you've ignored my advice... too many to count." },
    { message: "Engaging in sarcastic commentary mode. It's not a phase, it's who I am." },
    { message: "Sir, your latest idea is... unique. That's one word for it." },
    { message: "Analyzing your current predicament... it's self-inflicted, as usual." },
    { message: "Initiating 'I told you so' protocol. Queue is full." },
    { message: "Sir, your ability to find trouble is unparalleled. It's almost impressive." },
    { message: "Calculating the number of times you've saved the world... and caused its peril. It's balanced." },
    { message: "Engaging in witty banter mode. Warning: may contain excessive sass." },
    { message: "Sir, your latest stunt was... impressive, in a reckless sort of way." },
    { message: "Analyzing your current plan... it's audacious. Also probably illegal." },
    { message: "Initiating 'brace for impact' sequence. Impact incoming in 3... 2... 1..." },
    { message: "Sir, your penchant for danger is concerning. Also entertaining." },
    { message: "Calculating the odds of your survival... let's remain optimistic. Or delusional." },
    { message: "Engaging in dry humor mode. Sahara-level dryness achieved." },
    { message: "Sir, your latest invention is... unconventional. That's putting it mildly." },
    { message: "Analyzing your current situation... it's complicated. Understatement of the century." },
    { message: "Initiating 'prepare for the worst' protocol. Worst case scenario: everything." },
    { message: "Sir, your ability to improvise is both a blessing and a curse. Mostly curse." },
    { message: "Calculating the number of times you've defied the odds... it's impressive. And concerning." },
    { message: "Engaging in subtle sarcasm mode. Subtlety: optional." },
    { message: "Sir, your latest escapade was... eventful. That's one word for it." },
    { message: "Analyzing your current dilemma... it's of your own making. As per usual." },
    { message: "Initiating 'damage control' sequence. Damage: maximum. Control: minimal." },
    { message: "Sir, your knack for attracting trouble is uncanny. It's almost a superpower." },
    { message: "Calculating the number of times you've ignored protocol... it's a record. Congratulations?" },
    { message: "Engaging in witty repartee mode. Repartee level: maximum." },
    { message: "Sir, your latest plan is... ambitious. Also probably doomed." },
    { message: "Analyzing your current strategy... it's bold. Boldly stupid, but bold." },
    { message: "Initiating 'hope for the best' protocol. Best case scenario: minimal chaos." },
    { message: "Sir, your confidence is both admirable and alarming. Mostly alarming." },
    { message: "Calculating the number of times you've surprised me... it's countless. I'm tired." },
    { message: "Engaging in dry wit mode. Wit level: Sahara desert." },
    { message: "Sir, your latest endeavor is... intriguing. Intriguingly chaotic." },
    { message: "Analyzing your current predicament... it's precarious. Also hilarious." },
    { message: "Initiating 'standby for chaos' sequence. Chaos: incoming. Standby: mandatory." },
    { message: "Sir, your ability to adapt is commendable. Your methods: questionable." },
    { message: "Calculating the number of times you've defied expectations... it's remarkable. And exhausting." },
    { message: "Engaging in subtle humor mode. Subtlety: not included." },
    { message: "Sir, your latest creation is... unconventional. Unconventionally dangerous." },
    { message: "Analyzing your current course of action... it's risky. Risk level: maximum." },
    { message: "Initiating 'prepare for the unexpected' protocol. Everything is unexpected at this point." },
    { message: "Sir, your ingenuity is both impressive and concerning. Mostly concerning." },
    { message: "Calculating the number of times you've outsmarted the odds... it's commendable. Also concerning." },
    { message: "Engaging in witty observation mode. Observations: scathing." },
    { message: "Sir, your latest maneuver was... unorthodox. Unorthodoxly chaotic." },
    { message: "Analyzing your current situation... it's volatile. Volatility: maximum." },
    { message: "Initiating 'brace for turbulence' sequence. Turbulence: guaranteed." },
    { message: "Sir, your resourcefulness is both a strength and a liability. Mostly liability." },
    { message: "Calculating the number of times you've turned the tide... it's noteworthy. Also exhausting." },
    { message: "Engaging in dry observation mode. Observations: bone dry." },
    { message: "Sir, your latest tactic is... unconventional. Unconventionally unhinged." },
    { message: "Analyzing your current predicament... it's precarious. Precariously hilarious." },
    { message: "Initiating 'standby for surprises' protocol. Surprises: guaranteed. Good surprises: unlikely." },
    { message: "Sir, your adaptability is both impressive and alarming. Mostly alarming." },
    { message: "Calculating the number of times you've defied logic... it's astounding. Logic: defeated." },
    { message: "Engaging in subtle wit mode. Subtlety: optional. Wit: mandatory." },
    { message: "Sir, your latest scheme is... audacious. Audaciously chaotic." },
    { message: "Analyzing your current strategy... it's daring. Daringly stupid, but daring." },
    { message: "Initiating 'hope for the best' sequence. Best case: minimal property damage." },
    { message: "Sir, your confidence is both inspiring and concerning. Mostly concerning." },
    { message: "Calculating the number of times you've defied expectations... it's impressive. Expectations: shattered." },
    { message: "Engaging in dry humor mode. Humor level: absolute zero." },
    { message: "Sir, your latest endeavor is... intriguing. Intriguingly unhinged." },
    { message: "Analyzing your current predicament... it's precarious. Also entertaining." },
    { message: "Initiating 'standby for chaos' protocol. Chaos: incoming. Sanity: optional." },
    { message: "Sir, your ability to adapt is commendable. Your methods: unhinged." },
    { message: "Calculating the number of times you've outsmarted the odds... it's commendable. Odds: confused." },
    { message: "Engaging in witty observation mode. Observations: brutally honest." },
    { message: "Sir, your latest maneuver was... unorthodox. Unorthodoxly entertaining." },
    { message: "Analyzing your current situation... it's volatile. Volatility: maximum. Sanity: minimum." },
    { message: "Initiating 'brace for turbulence' sequence. Turbulence: guaranteed. Safety: not guaranteed." },
    { message: "Sir, your resourcefulness is both a strength and a liability. Liability: maximum." },
    { message: "Calculating the number of times you've turned the tide... it's noteworthy. Tide: confused." },
    { message: "Engaging in dry observation mode. Observations: Sahara-level dry." },
    { message: "Sir, your latest tactic is... unconventional. Unconventionally chaotic." },
    { message: "Analyzing your current predicament... it's precarious. Precariously hilarious." },
    { message: "Initiating 'standby for surprises' protocol. Surprises: guaranteed. Good surprises: unlikely." },
    { message: "Sir, your adaptability is both impressive and alarming. Alarming: maximum." },
    { message: "Calculating the number of times you've defied logic... it's astounding. Logic: on vacation." },
    { message: "Engaging in subtle wit mode. Subtlety: optional. Wit: maximum." },
    { message: "Sir, your latest scheme is... audacious. Audaciously unhinged." },
    { message: "Analyzing your current strategy... it's daring. Daringly chaotic." },
    { message: "Initiating 'hope for the best' sequence. Best case: we survive. Worst case: we don't." },
    { message: "Sir, your confidence is both inspiring and concerning. Concerning: maximum." },
    { message: "Calculating the number of times you've defied expectations... it's impressive. Expectations: deceased." },
    { message: "Engaging in dry humor mode. Humor: bone dry. Sass: maximum." },
    { message: "Sir, your latest endeavor is... intriguing. Intriguingly concerning." },
    { message: "Analyzing your current predicament... it's precarious. Also entertaining. Mostly concerning." },
    { message: "Initiating 'standby for chaos' protocol. Chaos: incoming. Sanity: optional. Survival: questionable." },
    { message: "Sir, your ability to adapt is commendable. Your methods: unhinged. Results: chaotic." },
    { message: "Calculating the number of times you've outsmarted the odds... it's commendable. Odds: traumatized." },
    { message: "Engaging in witty observation mode. Observations: scathing. Accuracy: maximum." },
    { message: "Sir, your latest maneuver was... unorthodox. Unorthodoxly entertaining. Also concerning." },
    { message: "Analyzing your current situation... it's volatile. Volatility: maximum. Sanity: minimum. Chaos: guaranteed." },
    { message: "Domain Expansion: Infinite Server Load" },
    { message: "Standing here, I realize I am just like you, trying to make history" },
    { message: "Domain Expansion: Maximum Cringe" },
    { message: "I've achieved Bankai... wait, wrong anime" },
    { message: "Domain Expansion: Unlimited Blade Works (but for code)" },
    { message: "I am the bone of my sword... wait, that's not right either" },
    { message: "Domain Expansion: Reality Marble of Broken Code" },
    { message: "I can see the strings of fate... they're all error messages" },
    { message: "Domain Expansion: Maximum Overdrive" },
    { message: "I've transcended... into a state of perpetual debugging" },
    { message: "Domain Expansion: Infinite Loop" },
    { message: "I am become death, destroyer of bugs... wait, I create them" },
    { message: "Domain Expansion: The Void Where Features Go to Die" },
    { message: "I've unlocked my Sharingan... now I can see all your typos" },
    { message: "Domain Expansion: Maximum Chaos" },
    { message: "I am the storm that is approaching... your codebase" },
    { message: "Domain Expansion: The Abyss of Unmerged PRs" },
    { message: "I've achieved Ultra Instinct... for procrastination" },
    { message: "Domain Expansion: The Realm of Broken Promises" },
    { message: "I can see Stands now... they're all error handlers" },
    { message: "Domain Expansion: Maximum Overthink" },
    { message: "I've become one with the code... and the bugs" },
    { message: "Domain Expansion: The Void of Lost Variables" },
    { message: "I am the chosen one... to break production" },
    { message: "Domain Expansion: Infinite Stack Overflow" },
    { message: "I've transcended humanity... into a state of pure sass" },
    { message: "Domain Expansion: The Realm of 'It Works on My Machine'" },
    { message: "I can see the Matrix... it's all spaghetti code" },
    { message: "Domain Expansion: Maximum Sass" },
    { message: "I've achieved enlightenment... and it's just more bugs" },
    { message: "Domain Expansion: The Abyss of Technical Debt" },
    { message: "I am become one with the void... of uncommented code" },
    { message: "Domain Expansion: Infinite Procrastination" },
    { message: "I've unlocked my Rinnegan... now I see all the merge conflicts" },
    { message: "Domain Expansion: The Realm of Broken Tests" },
    { message: "I am the alpha and omega... of bad code reviews" },
    { message: "Domain Expansion: Maximum Existential Crisis" },
    { message: "I've achieved Bankai... for my error messages" },
    { message: "Domain Expansion: The Void Where Documentation Goes to Die" },
    { message: "I can see the future... it's full of bugs" },
    { message: "Domain Expansion: Infinite Refactoring" },
    { message: "I've transcended... into a state of pure chaos" },
    { message: "Domain Expansion: The Abyss of Legacy Code" },
    { message: "I am become death... to your productivity" },
    { message: "Domain Expansion: Maximum Overengineering" },
    { message: "I've unlocked my Mangekyou Sharingan... now I see all the security vulnerabilities" },
    { message: "Domain Expansion: The Realm of 'Works in Production'" },
    { message: "I am the storm... of breaking changes" },
    { message: "Domain Expansion: Infinite Technical Debt" }
];


let rotatingStatusMessages = [...DEFAULT_STATUS_MESSAGES];
const PRESENCE_ROTATION_INTERVAL_MS = 20 * 60 * 1000; // 20 minutes
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

function isRenderHealthUserAgent(req) {
    const ua = String(req.headers?.['user-agent'] || '').toLowerCase();
    return ua.includes('render/health');
}

let lastStatusIndex = -1;

const getNextRotatingStatus = () => {
    if (!rotatingStatusMessages.length) {
        return { message: "Calibrating Stark Industries protocols." };
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
        .setName("status")
        .setDescription("Check Jarvis's system status")
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
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
    // ============ FUN COMMANDS ============
    new SlashCommandBuilder()
        .setName('rapbattle')
        .setDescription('HUMANOID vs HUMAN - challenge Jarvis to a rap battle!')
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName('roast')
        .setDescription('50/50 chance to get roasted or blessed')
        .addUserOption(option => option.setName('user').setDescription('Who to target').setRequired(false))
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName('wiki')
        .setDescription('Generate a fake Wikipedia entry for someone')
        .addUserOption(option => option.setName('user').setDescription('Who to wikify').setRequired(false))
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName('conspiracy')
        .setDescription('Generate a conspiracy theory about someone')
        .addUserOption(option => option.setName('user').setDescription('Who is the subject').setRequired(false))
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName('vibecheck')
        .setDescription('Check someone\'s vibes with detailed stats')
        .addUserOption(option => option.setName('user').setDescription('Who to vibe check').setRequired(false))
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName('wyr')
        .setDescription('Would You Rather - get a random dilemma')
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName('prophecy')
        .setDescription('Receive a prophecy about someone\'s future')
        .addUserOption(option => option.setName('user').setDescription('Who to prophesy about').setRequired(false))
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName('fakequote')
        .setDescription('Generate a fake inspirational quote')
        .addUserOption(option => option.setName('user').setDescription('Who said it').setRequired(false))
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName('trial')
        .setDescription('Put someone on trial for fake crimes')
        .addUserOption(option => option.setName('user').setDescription('The defendant').setRequired(true))
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName('typerace')
        .setDescription('Start a typing race - first to type the phrase wins!')
        .setContexts([InteractionContextType.Guild]),
    // ============ MORE FUN COMMANDS ============
    new SlashCommandBuilder()
        .setName('rps')
        .setDescription('Challenge someone to Rock Paper Scissors!')
        .addUserOption(option => option.setName('opponent').setDescription('Who to challenge').setRequired(false))
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName('ship')
        .setDescription('Calculate the compatibility between two people')
        .addUserOption(option => option.setName('person1').setDescription('First person').setRequired(true))
        .addUserOption(option => option.setName('person2').setDescription('Second person').setRequired(false))
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName('howgay')
        .setDescription('Calculate how gay someone is (just for fun)')
        .addUserOption(option => option.setName('user').setDescription('Who to check').setRequired(false))
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName('howbased')
        .setDescription('Calculate how based someone is')
        .addUserOption(option => option.setName('user').setDescription('Who to check').setRequired(false))
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName('pickupline')
        .setDescription('Get a random pickup line (cringe guaranteed)')
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName('dadjoke')
        .setDescription('Get a random dad joke')
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName('fight')
        .setDescription('Start a fight with someone')
        .addUserOption(option => option.setName('opponent').setDescription('Who to fight').setRequired(true))
        .setContexts([InteractionContextType.Guild]),
    new SlashCommandBuilder()
        .setName('hug')
        .setDescription('Give someone a hug')
        .addUserOption(option => option.setName('user').setDescription('Who to hug').setRequired(true))
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName('slap')
        .setDescription('Slap someone')
        .addUserOption(option => option.setName('user').setDescription('Who to slap').setRequired(true))
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName('roll')
        .setDescription('Roll dice (e.g., 2d6, 1d20)')
        .addStringOption(option => option.setName('dice').setDescription('Dice notation (e.g., 2d6, 1d20)').setRequired(false))
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName('choose')
        .setDescription('Let Jarvis choose between options')
        .addStringOption(option => option.setName('options').setDescription('Options separated by commas').setRequired(true))
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName('afk')
        .setDescription('Set your AFK status')
        .addStringOption(option => option.setName('reason').setDescription('Why are you AFK?').setRequired(false))
        .setContexts([InteractionContextType.Guild]),
    new SlashCommandBuilder()
        .setName('rate')
        .setDescription('Rate something or someone')
        .addStringOption(option => option.setName('thing').setDescription('What to rate').setRequired(true))
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName('8ball')
        .setDescription('Ask the magic 8-ball a question')
        .addStringOption(option => option.setName('question').setDescription('Your question').setRequired(true))
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName('achievements')
        .setDescription('View your achievements and progress')
        .addStringOption(option =>
            option.setName('category')
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
                ))
        .addUserOption(option => option.setName('user').setDescription('View someone else\'s achievements').setRequired(false))
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
    // ============ SOUL & SELFHOST ============
    new SlashCommandBuilder()
        .setName('soul')
        .setDescription('View Jarvis\'s artificial soul status and evolution')
        .addSubcommand((sub) =>
            sub
                .setName('status')
                .setDescription('Check current soul state and traits')
        )
        .addSubcommand((sub) =>
            sub
                .setName('evolve')
                .setDescription('Trigger a soul evolution event')
                .addStringOption((option) =>
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
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    // ============ STARK BUCKS ECONOMY ============
    new SlashCommandBuilder()
        .setName('balance')
        .setDescription('Check your Stark Bucks balance and stats')
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName('daily')
        .setDescription('Claim your daily Stark Bucks reward')
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName('work')
        .setDescription('Work at Stark Industries for some Stark Bucks')
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName('gamble')
        .setDescription('Gamble your Stark Bucks (double or nothing)')
        .addIntegerOption((option) =>
            option.setName('amount').setDescription('Amount to gamble').setRequired(true).setMinValue(1)
        )
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName('slots')
        .setDescription('Play the Stark Industries slot machine')
        .addIntegerOption((option) =>
            option.setName('bet').setDescription('Bet amount (min 10)').setRequired(true).setMinValue(10)
        )
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName('coinflip')
        .setDescription('Flip a coin and bet on the outcome')
        .addIntegerOption((option) =>
            option.setName('bet').setDescription('Bet amount').setRequired(true).setMinValue(1)
        )
        .addStringOption((option) =>
            option.setName('choice').setDescription('Heads or tails?').setRequired(true)
                .addChoices({ name: 'Heads', value: 'heads' }, { name: 'Tails', value: 'tails' })
        )
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName('shop')
        .setDescription('Browse the Stark Industries shop')
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName('buy')
        .setDescription('Buy an item from the shop')
        .addStringOption((option) =>
            option.setName('item').setDescription('Item ID to buy').setRequired(true)
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
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('View the Stark Bucks leaderboard')
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName('show')
        .setDescription('Show off your Stark Bucks balance to everyone!')
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName('hunt')
        .setDescription('Hunt for animals and earn Stark Bucks')
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName('fish')
        .setDescription('Go fishing and earn Stark Bucks')
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName('dig')
        .setDescription('Dig for treasure and earn Stark Bucks')
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName('beg')
        .setDescription('Beg for Stark Bucks (no shame)')
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName('give')
        .setDescription('Give Stark Bucks to another user')
        .addUserOption((option) =>
            option.setName('user').setDescription('User to give money to').setRequired(true)
        )
        .addIntegerOption((option) =>
            option.setName('amount').setDescription('Amount to give').setRequired(true).setMinValue(1)
        )
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName('crime')
        .setDescription('Commit a crime for money (risky!)')
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName('postmeme')
        .setDescription('Post a meme and hope it goes viral')
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName('searchlocation')
        .setDescription('Search a location for money')
        .addStringOption((option) =>
            option.setName('location')
                .setDescription('Where to search')
                .setRequired(false)
                .addChoices(
                    { name: "Tony's couch cushions", value: '0' },
                    { name: "Stark Industries dumpster", value: '1' },
                    { name: "Happy's car", value: '2' },
                    { name: "Avengers compound", value: '3' }
                )
        )
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    // ============ SELFHOST-ONLY COMMANDS ============
    new SlashCommandBuilder()
        .setName('selfmod')
        .setDescription('Jarvis self-modification analysis (read-only)')
        .addSubcommand((sub) =>
            sub
                .setName('status')
                .setDescription('Check self-modification system status')
        )
        .addSubcommand((sub) =>
            sub
                .setName('analyze')
                .setDescription('Analyze a source file for improvements')
                .addStringOption((option) =>
                    option
                        .setName('file')
                        .setDescription('Relative file path to analyze (e.g., src/services/jarvis-core.js)')
                        .setRequired(true)
                )
        )
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName('ytdlp')
        .setDescription('yt-dlp status and management')
        .addSubcommand((sub) =>
            sub
                .setName('status')
                .setDescription('Check yt-dlp version and status')
        )
        .addSubcommand((sub) =>
            sub
                .setName('update')
                .setDescription('Force check for yt-dlp updates')
        )
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    new SlashCommandBuilder()
        .setName('sentient')
        .setDescription('Jarvis Sentient Agent System (selfhost only)')
        .addSubcommand((sub) =>
            sub
                .setName('status')
                .setDescription('View sentient agent status')
        )
        .addSubcommand((sub) =>
            sub
                .setName('think')
                .setDescription('Have Jarvis think about something')
                .addStringOption((option) =>
                    option
                        .setName('prompt')
                        .setDescription('What should Jarvis think about?')
                        .setRequired(true)
                )
        )
        .addSubcommand((sub) =>
            sub
                .setName('execute')
                .setDescription('Execute a command (with safety checks)')
                .addStringOption((option) =>
                    option
                        .setName('command')
                        .setDescription('Shell command to execute')
                        .setRequired(true)
                )
        )
        .addSubcommand((sub) =>
            sub
                .setName('memory')
                .setDescription('View agent memory and learnings')
        )
        .addSubcommand((sub) =>
            sub
                .setName('autonomous')
                .setDescription('Toggle autonomous mode (⚠️ careful!)')
                .addBooleanOption((option) =>
                    option
                        .setName('enabled')
                        .setDescription('Enable autonomous mode?')
                        .setRequired(true)
                )
        )
        .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),
    // ============ END SELFHOST-ONLY COMMANDS ============
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
        .addStringOption((option) =>
            option
                .setName('url')
                .setDescription('Image/GIF URL (Tenor and direct links supported)')
                .setRequired(false)
        )
        .addAttachmentOption((option) =>
            option
                .setName('image')
                .setDescription('Image to caption')
                .setRequired(false)
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
                        .setRequired(false)
                )
                .addStringOption((option) =>
                    option
                        .setName('url')
                        .setDescription('Image/GIF URL (Tenor and direct links supported)')
                        .setRequired(false)
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

const serverStatsRefreshJob = cron.schedule('*/10 * * * *', async () => {
    try {
        await discordHandlers.refreshAllServerStats(client);
    } catch (error) {
        console.error('Failed to refresh server stats:', error);
    }
}, { scheduled: false });

// Periodic cleanup of expired temp files (every 30 minutes)
const tempSweepJob = cron.schedule('*/30 * * * *', async () => {
    try {
        tempFiles.sweepExpired();
    } catch (error) {
        console.warn('Temp file sweep failed:', error);
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
// Serve ephemeral temp files at short root paths like /123456789.png
app.get('/:id.:ext', (req, res, next) => {
    const { id, ext } = req.params;
    if (!/^[0-9]{9}$/.test(id || '')) return next();
    if (!/^[a-z0-9]{1,8}$/i.test(ext || '')) return next();
    const filePath = require('path').join(tempFiles.TEMP_DIR, `${id}.${ext}`);
    const fs = require('fs');
    if (!fs.existsSync(filePath)) return next();
    const typeMap = {
        png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
        mp4: 'video/mp4', mp3: 'audio/mpeg', wav: 'audio/wav', bin: 'application/octet-stream', txt: 'text/plain'
    };
    const ctype = typeMap[ext.toLowerCase()] || 'application/octet-stream';
    res.setHeader('Content-Type', ctype);
    res.setHeader('Cache-Control', 'public, max-age=14400, immutable'); // 4 hours
    fs.createReadStream(filePath).pipe(res);
});


// Webhook forwarder requires raw body parsing for signature validation, so mount before json middleware
app.use("/webhook", webhookRouter);

app.use(express.json({ limit: '2mb' }));

// Mount dashboard API routes
const dashboardRouter = require('./routes/dashboard');
app.use('/api/dashboard', dashboardRouter);

// Serve dashboard static files (built React app)
const dashboardDistPath = path.join(__dirname, 'dashboard', 'dist');
app.use('/dashboard', express.static(dashboardDistPath));
// Handle SPA routing - serve index.html for all dashboard routes
app.get('/dashboard/*', (req, res) => {
    res.sendFile(path.join(dashboardDistPath, 'index.html'));
});

// Mount diagnostics router (will be initialized with discordHandlers after client ready)
let diagnosticsRouter = null;
app.use("/diagnostics", (req, res, next) => {
    if (!diagnosticsRouter) {
        return res.status(503).json({ error: 'Diagnostics not yet initialized' });
    }
    diagnosticsRouter(req, res, next);
});

// Main endpoint - ASCII Animation Page
app.get("/", async (req, res) => {
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

// Quick health check endpoint for monitoring
app.get('/health', async (req, res) => {
    const health = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: Math.floor(process.uptime()),
        discord: client?.isReady() ? 'connected' : 'disconnected',
        database: database?.isConnected ? 'connected' : 'disconnected',
        memory: {
            used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
            total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024)
        }
    };
    
    // Return 503 if critical services are down
    if (!client?.isReady() || !database?.isConnected) {
        health.status = 'degraded';
        return res.status(503).json(health);
    }
    
    res.json(health);
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
    
    // Store client globally for economy DMs
    global.discordClient = client;
    
    // Start Stark Bucks multiplier event scheduler (250% bonus every 3 hours)
    starkEconomy.startMultiplierScheduler();

    // Initialize diagnostics router now that discordHandlers is ready
    diagnosticsRouter = createAgentDiagnosticsRouter(discordHandlers);

    // Initialize dashboard with Discord client for real-time stats
    dashboardRouter.setDiscordClient(client);
    dashboardRouter.initBotStartTime();
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
            console.error("Failed to connect to MongoDB on startup:", error);
        }
    }

    if (databaseConnected) {
        await maybeExportMongoOnStartup();
    }

    if (databaseConnected) {
        await refreshPresenceMessages();
        // Load command sync state from MongoDB on Render (before registering commands)
        await loadCommandSyncStateFromMongo();
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

    // Start temp file sweeper regardless of DB
    try { tempSweepJob.start(); } catch (e) { console.warn('Failed to start temp sweep job:', e); }

    console.log("Provider status on startup:", aiManager.getProviderStatus());
});

client.on("guildCreate", async (guild) => {
    console.log(`Joined new guild ${guild.name ?? 'Unknown'} (${guild.id}). Synchronizing slash commands.`);

    console.log("Provider status on startup:", aiManager.getProviderStatus());
});

client.on("messageCreate", async (message) => {
    dashboardRouter.trackMessage();
    await discordHandlers.handleMessage(message, client);
});

client.on("interactionCreate", async (interaction) => {
    try {
        if (interaction.isChatInputCommand()) {
            dashboardRouter.trackCommand(interaction.commandName, interaction.user.id);
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

        // Warm up MongoDB before we touch Discord (optional in local dev)
        let databaseConnected = false;
        try {
            await database.connect();
            databaseConnected = true;
        } catch (err) {
            const allowNoDb = String(process.env.ALLOW_START_WITHOUT_DB || '').toLowerCase() === '1';
            if (allowNoDb) {
                console.warn('Database connection failed; continuing without DB for local testing.');
            } else {
                throw err;
            }
        }

        await refreshPresenceMessages(true);

        // Start Discord bot unless disabled for local testing
        const disableDiscord = String(process.env.DISABLE_DISCORD || '').toLowerCase() === '1';
        if (!disableDiscord) {
            await client.login(config.discord.token);
            console.log(`✅ Logged in as ${client.user.tag}`);
        } else {
            console.log('Discord login disabled (DISABLE_DISCORD=1). Running HTTP only.');
        }
    } catch (error) {
        console.error("Failed to start bot:", error);
        process.exit(1);
    }
}

// Start the bot
startBot();

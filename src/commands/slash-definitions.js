'use strict';

const {
    SlashCommandBuilder,
    InteractionContextType,
    ApplicationIntegrationType,
    ChannelType,
    PermissionFlagsBits
} = require('discord.js');
const { commandList: musicCommandList } = require('./music');
const { commandFeatureMap } = require('../core/command-registry');
const { isFeatureGloballyEnabled } = require('../core/feature-flags');

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
        .setName('ping')
        .setDescription('Check bot latency and system vitals')
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
        .setName('features')
        .setDescription('Show or toggle Jarvis modules for this server')
        .addStringOption(opt =>
            opt
                .setName('toggle')
                .setDescription('Feature name to toggle on/off for this server (admin only)')
                .setRequired(false)
        )
        .addBooleanOption(opt =>
            opt
                .setName('enabled')
                .setDescription('Enable or disable the feature (used with toggle)')
                .setRequired(false)
        )
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
        .setName('typerace')
        .setDescription('Start a typing race - first to type the phrase wins!')
        .setContexts([InteractionContextType.Guild]),
    new SlashCommandBuilder()
        .setName('ship')
        .setDescription('Calculate compatibility between two people')
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
        .setName('pickupline')
        .setDescription('Get a random pickup line')
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
        .setName('clear')
        .setDescription('Clear your conversation history with Jarvis')
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
    // ============ STARK BUCKS ECONOMY (Consolidated) ============
    new SlashCommandBuilder()
        .setName('economy')
        .setDescription('Stark Bucks economy commands')
        .addSubcommand(sub => sub.setName('balance').setDescription('Check your Stark Bucks balance and stats'))
        .addSubcommand(sub => sub.setName('daily').setDescription('Claim your daily Stark Bucks reward'))
        .addSubcommand(sub => sub.setName('work').setDescription('Work at Stark Industries for Stark Bucks'))
        .addSubcommand(sub =>
            sub.setName('gamble')
                .setDescription('Gamble your Stark Bucks (double or nothing)')
                .addStringOption(opt => opt.setName('amount').setDescription('Amount to gamble (e.g. 100, 5K, 1M, all)').setRequired(true))
        )
        .addSubcommand(sub =>
            sub.setName('slots')
                .setDescription('Play the Stark Industries slot machine')
                .addStringOption(opt => opt.setName('bet').setDescription('Bet amount (e.g. 100, 5K, 1M, all)').setRequired(true))
        )
        .addSubcommand(sub =>
            sub.setName('coinflip')
                .setDescription('Flip a coin and bet on the outcome')
                .addStringOption(opt => opt.setName('bet').setDescription('Bet amount (e.g. 100, 5K, 1M, all)').setRequired(true))
                .addStringOption(opt => opt.setName('choice').setDescription('Heads or tails?').setRequired(true).addChoices({ name: 'Heads', value: 'heads' }, { name: 'Tails', value: 'tails' }))
        )
        .addSubcommand(sub => sub.setName('shop').setDescription('Browse the Stark Industries shop'))
        .addSubcommand(sub =>
            sub.setName('buy')
                .setDescription('Buy an item from the shop')
                .addStringOption(opt => opt.setName('item').setDescription('Item ID to buy').setRequired(true).addChoices(
                    { name: '⭐ VIP Badge (500)', value: 'vip_badge' },
                    { name: '✨ Golden Name (1000)', value: 'golden_name' },
                    { name: '🍀 Lucky Charm (200)', value: 'lucky_charm' },
                    { name: '2️⃣ Double Daily (150)', value: 'double_daily' },
                    { name: '🛡️ Shield (300)', value: 'shield' },
                    { name: '☕ Stark Coffee (100)', value: 'stark_coffee' },
                    { name: '💠 Arc Reactor (10000)', value: 'arc_reactor' },
                    { name: '🦾 Hulkbuster Armor (2000)', value: 'hulkbuster_armor' },
                    { name: '👓 E.D.I.T.H. Glasses (800)', value: 'edith_glasses' },
                    { name: '🤖 Iron Legion Droid (1200)', value: 'iron_legion_droid' },
                    { name: '💾 AI Assistant Chip (2500)', value: 'ai_assistant_chip' },
                    { name: '💼 Mark V Briefcase (5000)', value: 'mark_v_briefcase' }
                ))
        )
        .addSubcommand(sub => sub.setName('leaderboard').setDescription('View the Stark Bucks leaderboard'))
        .addSubcommand(sub => sub.setName('show').setDescription('Show off your Stark Bucks balance'))
        .addSubcommand(sub =>
            sub.setName('give')
                .setDescription('Give Stark Bucks to another user')
                .addUserOption(opt => opt.setName('user').setDescription('User to give money to').setRequired(true))
                .addIntegerOption(opt => opt.setName('amount').setDescription('Amount to give').setRequired(true).setMinValue(1))
        )
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    // ============ MINIGAMES (Consolidated) ============
    new SlashCommandBuilder()
        .setName('minigame')
        .setDescription('Stark Bucks minigames')
        .addSubcommand(sub => sub.setName('hunt').setDescription('Hunt for animals and earn Stark Bucks'))
        .addSubcommand(sub => sub.setName('fish').setDescription('Go fishing and earn Stark Bucks'))
        .addSubcommand(sub => sub.setName('dig').setDescription('Dig for treasure and earn Stark Bucks'))
        .addSubcommand(sub => sub.setName('beg').setDescription('Beg for Stark Bucks (no shame)'))
        .addSubcommand(sub => sub.setName('crime').setDescription('Commit a crime for money (risky!)'))
        .addSubcommand(sub => sub.setName('postmeme').setDescription('Post a meme and hope it goes viral'))
        .addSubcommand(sub =>
            sub.setName('search')
                .setDescription('Search a location for money')
                .addStringOption(opt => opt.setName('location').setDescription('Where to search').setRequired(false).addChoices(
                    { name: "Tony's couch cushions", value: '0' },
                    { name: 'Stark Industries dumpster', value: '1' },
                    { name: "Happy's car", value: '2' },
                    { name: 'Avengers compound', value: '3' }
                ))
        )
        .addSubcommand(sub =>
            sub.setName('blackjack')
                .setDescription('Play a simplified game of Blackjack')
                .addIntegerOption(opt => opt.setName('bet').setDescription('Amount to bet (min 10)').setRequired(true))
        )
        .addSubcommand(sub =>
            sub.setName('rob')
                .setDescription('Attempt to rob another user (risky!)')
                .addUserOption(opt => opt.setName('target').setDescription('The target to rob').setRequired(true))
        )
        .addSubcommand(sub =>
            sub.setName('lottery')
                .setDescription('Stark Lottery System')
                .addIntegerOption(opt => opt.setName('buy_tickets').setDescription('Number of tickets to buy (100 each)').setRequired(false))
        )
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    // ============ CRAFTING & ITEMS ============
    new SlashCommandBuilder()
        .setName('inventory')
        .setDescription('View your inventory of items and materials')
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    new SlashCommandBuilder()
        .setName('tinker')
        .setDescription('Stark Industries Tinker Lab: Crafting System')
        .addSubcommand(sub =>
            sub.setName('craft')
                .setDescription('Craft MCU items from materials')
                .addStringOption(opt => opt.setName('recipe').setDescription('Recipe ID to craft (use /tinker recipes to see IDs)').setRequired(true))
        )
        .addSubcommand(sub =>
            sub.setName('recipes')
                .setDescription('View available crafting recipes')
                .addStringOption(opt => opt.setName('rarity').setDescription('Filter by rarity').setRequired(false).addChoices(
                    { name: 'Common', value: 'common' },
                    { name: 'Uncommon', value: 'uncommon' },
                    { name: 'Rare', value: 'rare' },
                    { name: 'Epic', value: 'epic' },
                    { name: 'Legendary', value: 'legendary' }
                ))
        )
        .addSubcommand(sub => sub.setName('materials').setDescription('View your collected materials'))
        .addSubcommand(sub =>
            sub.setName('sell')
                .setDescription('Sell a crafted item')
                .addStringOption(opt => opt.setName('item').setDescription('Item name to sell (or part of name)').setRequired(true))
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
        .addSubcommand(sub =>
            sub
                .setName('agis')
                .setDescription('A.G.I.S. — Plan and decompose a goal into steps')
                .addStringOption(option =>
                    option
                        .setName('goal')
                        .setDescription('High-level goal for AGIS to plan')
                        .setRequired(false)
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
        .setName('gif')
        .setDescription('Convert an image or GIF into a GIF file')
        .addStringOption(option =>
            option
                .setName('url')
                .setDescription('Image/GIF URL (Tenor and direct links supported)')
                .setRequired(false)
        )
        .addAttachmentOption(option =>
            option.setName('image').setDescription('Image to convert').setRequired(false)
        )
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    new SlashCommandBuilder()
        .setName('avatar')
        .setDescription("Get a user's avatar")
        .addUserOption(option =>
            option.setName('user').setDescription('User to inspect').setRequired(false)
        )
        .addBooleanOption(option =>
            option
                .setName('server')
                .setDescription('Use server avatar (guild only)')
                .setRequired(false)
        )
        .setContexts([
            InteractionContextType.Guild,
            InteractionContextType.BotDM,
            InteractionContextType.PrivateChannel
        ]),
    new SlashCommandBuilder()
        .setName('banner')
        .setDescription("Get a user's banner")
        .addUserOption(option =>
            option.setName('user').setDescription('User to inspect').setRequired(false)
        )
        .addBooleanOption(option =>
            option
                .setName('server')
                .setDescription('Use server banner (guild only)')
                .setRequired(false)
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
        .setDescription('Set a custom wake word that triggers Jarvis for you or your server')
        .addStringOption(opt =>
            opt
                .setName('word')
                .setDescription('Your custom wake word (2-20 characters, alphanumeric)')
                .setRequired(false)
        )
        .addStringOption(opt =>
            opt
                .setName('scope')
                .setDescription('Apply to yourself or the whole server (server requires admin)')
                .setRequired(false)
                .addChoices(
                    { name: 'Personal (just you)', value: 'personal' },
                    { name: 'Server (everyone in this server)', value: 'server' }
                )
        )
        .addBooleanOption(opt =>
            opt
                .setName('clear')
                .setDescription('Remove your (or server) wake word')
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
    // ============ LEGACY FEATURES ============
    // SBX Crypto
    new SlashCommandBuilder()
        .setName('sbx')
        .setDescription('Starkbucks Crypto Exchange')
        .setContexts([InteractionContextType.Guild])
        .addSubcommand(s => s.setName('market').setDescription('View SBX market data'))
        .addSubcommand(s => s.setName('buy').setDescription('Buy SBX with Stark Bucks').addIntegerOption(o => o.setName('amount').setDescription('Amount of SBX to buy').setRequired(true)))
        .addSubcommand(s => s.setName('sell').setDescription('Sell SBX for Stark Bucks').addIntegerOption(o => o.setName('amount').setDescription('Amount of SBX to sell').setRequired(true)))
        .addSubcommand(s => s.setName('invest').setDescription('Invest SBX for passive income').addIntegerOption(o => o.setName('amount').setDescription('Amount to invest').setRequired(true)))
        .addSubcommand(s => s.setName('withdraw').setDescription('Withdraw invested SBX').addIntegerOption(o => o.setName('amount').setDescription('Amount to withdraw (or 0 for all)').setRequired(true))),

    // ============ MODERATION SLASH COMMANDS ============
    new SlashCommandBuilder()
        .setName('ban')
        .setDescription('Ban a member from the server')
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
        .setContexts([InteractionContextType.Guild])
        .addStringOption(o => o.setName('user').setDescription('User ID, @mention, or username to ban').setRequired(true))
        .addStringOption(o => o.setName('duration').setDescription('Ban duration (e.g. 10m, 1h, 7d, or leave empty for permanent)'))
        .addStringOption(o => o.setName('reason').setDescription('Reason for ban')),
    new SlashCommandBuilder()
        .setName('unban')
        .setDescription('Unban a user from the server')
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
        .setContexts([InteractionContextType.Guild])
        .addStringOption(o => o.setName('user').setDescription('User ID to unban').setRequired(true))
        .addStringOption(o => o.setName('reason').setDescription('Reason for unban')),
    new SlashCommandBuilder()
        .setName('kick')
        .setDescription('Kick a member from the server')
        .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
        .setContexts([InteractionContextType.Guild])
        .addStringOption(o => o.setName('user').setDescription('User ID, @mention, or username to kick').setRequired(true))
        .addStringOption(o => o.setName('reason').setDescription('Reason for kick')),
    new SlashCommandBuilder()
        .setName('mute')
        .setDescription('Timeout a member')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .setContexts([InteractionContextType.Guild])
        .addStringOption(o => o.setName('user').setDescription('User ID, @mention, or username to mute').setRequired(true))
        .addStringOption(o => o.setName('duration').setDescription('Mute duration (e.g. 30s, 10m, 1h, 1d)').setRequired(true))
        .addStringOption(o => o.setName('reason').setDescription('Reason for mute')),
    new SlashCommandBuilder()
        .setName('unmute')
        .setDescription('Remove a timeout from a member')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .setContexts([InteractionContextType.Guild])
        .addStringOption(o => o.setName('user').setDescription('User ID, @mention, or username to unmute').setRequired(true))
        .addStringOption(o => o.setName('reason').setDescription('Reason for unmute')),
    new SlashCommandBuilder()
        .setName('warn')
        .setDescription('Warn a member')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .setContexts([InteractionContextType.Guild])
        .addStringOption(o => o.setName('user').setDescription('User ID, @mention, or username to warn').setRequired(true))
        .addStringOption(o => o.setName('reason').setDescription('Reason for warning').setRequired(true)),
    new SlashCommandBuilder()
        .setName('purge')
        .setDescription('Bulk delete messages from a channel')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .setContexts([InteractionContextType.Guild])
        .addIntegerOption(o => o.setName('count').setDescription('Number of messages to delete (1-100)').setRequired(true).setMinValue(1).setMaxValue(100))
        .addUserOption(o => o.setName('user').setDescription('Only delete messages from this user')),
    new SlashCommandBuilder()
        .setName('slowmode')
        .setDescription('Set channel slowmode delay')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
        .setContexts([InteractionContextType.Guild])
        .addStringOption(o => o.setName('duration').setDescription('Slowmode duration (e.g., 5s, 1m, 0 to disable)').setRequired(true)),
    new SlashCommandBuilder()
        .setName('userinfo')
        .setDescription('Get detailed information about a user')
        .setContexts([InteractionContextType.Guild])
        .addUserOption(o => o.setName('user').setDescription('User to get info about')),
    new SlashCommandBuilder()
        .setName('serverinfo')
        .setDescription('Get detailed information about the server')
        .setContexts([InteractionContextType.Guild]),

    ...musicCommandList.map(command => command.data),
    ...require('./utility/quote').map(c => c.data)
];

const commands = allCommands.filter(builder => {
    const featureKey = commandFeatureMap.get(builder.name);
    return isFeatureGloballyEnabled(featureKey, true);
});

function buildCommandData() {
    const seen = new Set();
    const unique = [];
    for (const command of commands) {
        if (!seen.has(command.name)) {
            seen.add(command.name);
            unique.push(command);
        }
    }
    // Automatically inject integration_types if not present
    // This ensures commands appear on bot profile in Discord
    return unique.map(command => {
        const json = command.toJSON();
        // Default to GuildInstall + UserInstall if not specified
        if (!json.integration_types) {
            json.integration_types = [
                ApplicationIntegrationType.GuildInstall,
                ApplicationIntegrationType.UserInstall
            ];
        }
        // Default contexts if not specified (Guild only for safety)
        if (!json.contexts) {
            json.contexts = [InteractionContextType.Guild];
        }
        return json;
    });
}

module.exports = { allCommands, commands, buildCommandData };

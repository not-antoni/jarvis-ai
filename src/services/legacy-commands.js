/**
 * Legacy text-based commands for Jarvis AI
 * Prefix: *j
 *
 * These commands work when Message Content Intent is enabled
 * They mirror slash command functionality for users who prefer text commands
 */

const { EmbedBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const selfhostFeatures = require('./selfhost-features');
const starkEconomy = require('./stark-economy');
const starkTinker = require('./stark-tinker');
const starkbucks = require('./starkbucks-exchange');
const funFeatures = require('./fun-features');
const moderation = require('./GUILDS_FEATURES/moderation');
const { AchievementsSystem, ACHIEVEMENTS } = require('./achievements');
const config = require('../../config');
const database = require('./database');
const localdb = require('../localdb');
const { safeSend } = require('../utils/discord-safe-send');

// Initialize achievements system
const achievements = new AchievementsSystem();

const LEGACY_PREFIX = '*j';

// ============ COOLDOWN SYSTEM ============
const cooldowns = new Map();
const COOLDOWN_MS = 3000; // 3 second cooldown for most commands
const BOT_OWNER_ID = process.env.BOT_OWNER_ID || '';

// Commands that have their own cooldown handling in stark-economy
const ECONOMY_COOLDOWN_COMMANDS = [
    'work', 'daily', 'hunt', 'fish', 'dig', 'beg', 'crime', 'postmeme',
    'search', 'rob', 'heist', 'lottery'
];

function checkCooldown(userId, commandName) {
    // Bot owner bypasses all cooldowns
    if (BOT_OWNER_ID && userId === BOT_OWNER_ID) {
        return 0;
    }

    const key = `${userId}:${commandName}`;
    const now = Date.now();
    const cooldownEnd = cooldowns.get(key) || 0;

    if (now < cooldownEnd) {
        return Math.ceil((cooldownEnd - now) / 1000);
    }

    cooldowns.set(key, now + COOLDOWN_MS);
    return 0;
}

// ============ PAGINATED HELP SYSTEM ============
const helpPages = new Map(); // userId -> currentPage

const HELP_PAGES = [
    {
        title: '📜 Legacy Commands - Page 1/10',
        subtitle: 'Fun Commands',
        fields: [
            {
                name: '🎮 **Fun**',
                value: '`*j roast @user` - Roast someone\n`*j soul` - View Jarvis soul\n`*j 8ball <question>` - Magic 8-ball\n`*j aatrox` - GYAATROX',
                inline: false
            },
            {
                name: '😂 **More Fun**',
                value: '`*j dadjoke` - Get a dad joke\n`*j pickupline` - Get a pickup line\n`*j rate <thing>` - Rate something\n`*j roll [dice]` - Roll dice (e.g., 2d6)',
                inline: false
            }
        ]
    },
    {
        title: '📜 Legacy Commands - Page 2/10',
        subtitle: 'Social Commands',
        fields: [
            {
                name: '💕 **Social**',
                value: '`*j ship @user1 @user2` - Ship compatibility\n`*j hug @user` - Hug someone\n`*j slap @user` - Slap someone\n`*j fight @user` - Fight someone',
                inline: false
            },
            {
                name: '📊 **Meters**',
                value: '`*j howgay [@user]` - How gay meter\n`*j howbased [@user]` - How based meter\n`*j vibecheck [@user]` - Vibe check',
                inline: false
            }
        ]
    },
    {
        title: '📜 Legacy Commands - Page 3/10',
        subtitle: 'Economy Commands',
        fields: [
            {
                name: '💰 **Economy**',
                value: '`*j balance` - Check balance\n`*j daily` - Claim daily reward\n`*j work` - Work for money\n`*j leaderboard` - View top richest',
                inline: false
            },
            {
                name: '🎰 **Gambling**',
                value: '`*j gamble <amt>` - Double or nothing\n`*j slots <bet>` - Slot machine\n`*j coinflip <bet> <h/t>` - Coin flip\n`*j blackjack <bet>` - Play blackjack',
                inline: false
            }
        ]
    },
    {
        title: '📜 Legacy Commands - Page 4/10',
        subtitle: 'Minigames & Crime',
        fields: [
            {
                name: '🏹 **Minigames**',
                value: '`*j hunt` - Hunt animals\n`*j fish` - Go fishing\n`*j dig` - Dig for treasure\n`*j beg` - Beg from Marvel characters',
                inline: false
            },
            {
                name: '🦹 **Crime & Risk**',
                value: '`*j crime` - Commit a crime\n`*j rob @user` - Rob another user\n`*j search` - Search locations\n`*j postmeme` - Post memes for money',
                inline: false
            }
        ]
    },
    {
        title: '📜 Legacy Commands - Page 5/10',
        subtitle: 'Tinker & Crafting',
        fields: [
            {
                name: '🔧 **Tinker Lab**',
                value: '`*j tinker [recipe]` - Craft MCU items\n`*j recipes [rarity]` - View all recipes\n`*j materials` - View your materials\n`*j sell <#>` - Sell crafted items',
                inline: false
            },
            {
                name: '📋 **Contracts**',
                value: '`*j contract` - Stark Industries contracts\n`*j quest` - View active quests\n`*j challenge` - Daily challenges',
                inline: false
            }
        ]
    },
    {
        title: '📜 Legacy Commands - Page 6/10',
        subtitle: 'Shop & Transfers',
        fields: [
            {
                name: '🛒 **Shop**',
                value: '`*j shop` - View shop\n`*j buy <item>` - Buy an item\n`*j inventory` - View your items',
                inline: false
            },
            {
                name: '💸 **Transfers**',
                value: '`*j give @user <amt>` - Give money\n`*j pay @user <amt>` - Pay someone\n`*j lottery [buy #]` - Weekly lottery',
                inline: false
            }
        ]
    },
    {
        title: '📜 Legacy Commands - Page 7/10',
        subtitle: 'Advanced Economy',
        fields: [
            {
                name: '💠 **Arc Reactor**',
                value: '`*j reactor` - Check Arc Reactor status\n`*j buy arc_reactor` - Buy for 10,000💵\n*Perks: +15% earnings, -25% cooldowns, +5% luck*',
                inline: false
            },
            {
                name: '📈 **Progression**',
                value: '`*j profile` - View your profile\n`*j achievements` - View achievements\n`*j prestige` - Prestige for bonuses\n`*j pet` - Manage your pet',
                inline: false
            }
        ]
    },
    {
        title: '📜 Legacy Commands - Page 8/10',
        subtitle: 'Multiplayer & Events',
        fields: [
            {
                name: '🏦 **Heist System**',
                value: '`*j heist start` - Start a heist\n`*j heist join` - Join active heist\n`*j heist status` - View heist progress',
                inline: false
            },
            {
                name: '👹 **Boss Battles**',
                value: '`*j boss` - View current boss\n`*j boss attack` - Attack the boss\n`*j tournament` - Join tournaments',
                inline: false
            }
        ]
    },
    {
        title: '📜 Legacy Commands - Page 9/10',
        subtitle: 'Crypto & Trading',
        fields: [
            {
                name: '💱 **Starkbucks (SBX)**',
                value: '`*j sbx wallet` - View SBX balance\n`*j sbx convert <amt>` - Convert currency\n`*j sbx store` - SBX shop\n`*j sbx invest` - Stake SBX',
                inline: false
            },
            {
                name: '📊 **Stark Crypto**',
                value: '`*j crypto prices` - View coin prices\n`*j crypto buy <coin> <amt>` - Buy crypto\n`*j crypto sell <coin> <amt>` - Sell crypto\n`*j crypto portfolio` - Your holdings',
                inline: false
            }
        ]
    },
    {
        title: '📜 Legacy Commands - Page 10/10',
        subtitle: 'Utility & Moderation',
        fields: [
            {
                name: '⚙️ **Utility**',
                value: '`*j help` - Show help (paginated)\n`*j next` / `*j prev` - Navigate pages\n`*j ping` - Check latency\n`*j remind in <time> <msg>` - Set reminder',
                inline: false
            },
            {
                name: '🛡️ **Moderation**',
                value: '`*j kick @user` · `*j ban @user [time]` · `*j unban <id>`\n`*j mute @user <time>` · `*j unmute @user`\n`*j warn @user <reason>` · `*j warnings @user` · `*j clearwarnings @user`',
                inline: false
            }
        ]
    }
];

/**
 * Roast generator - creates a classy British roast
 */
function generateRoast(targetName, roasterName) {
    const roasts = [
        `Ah yes, ${targetName}. I've seen more processing power in a calculator from 1985, sir.`,
        `${targetName}'s contributions to this server are about as useful as a screen door on a submarine.`,
        `Sir, ${targetName} appears to have the charisma of a damp spreadsheet. My condolences.`,
        `Analyzing ${targetName}... I've found more personality in a dial-up modem, sir.`,
        `${targetName} joined ${Math.floor(Math.random() * 365) + 1} days ago and their greatest achievement is... still pending.`,
        `If ${targetName} were a font, they'd be Comic Sans at a funeral, sir.`,
        `${targetName}'s online presence is like decaf coffee - technically there, but utterly pointless.`,
        `I've run the numbers, and ${targetName} is operating at peak mediocrity. Impressive consistency, really.`,
        `${targetName} brings all the energy of a Windows update at 2 AM.`,
        `Sir, if wit were currency, ${targetName} would be filing for bankruptcy.`,
        `${targetName}'s typing... Still typing... Ah, they've sent "lol". Groundbreaking contribution.`,
        `My neural networks suggest ${targetName} peaked in their default profile picture era.`
    ];

    return roasts[Math.floor(Math.random() * roasts.length)];
}

/**
 * Schedule storage (in-memory, resets on restart)
 */
const schedules = new Map();

/**
 * Parse schedule time string like "in 5 minutes" or "in 2 hours"
 */
function parseScheduleTime(timeStr) {
    const match = timeStr.match(
        /in\s+(\d+)\s*(min|minute|minutes|hour|hours|h|m|second|seconds|s)/i
    );
    if (!match) return null;

    const amount = parseInt(match[1]);
    const unit = match[2].toLowerCase();

    let ms = 0;
    if (unit.startsWith('s')) ms = amount * 1000;
    else if (unit.startsWith('m')) ms = amount * 60 * 1000;
    else if (unit.startsWith('h')) ms = amount * 60 * 60 * 1000;

    return ms;
}

/**
 * Legacy command definitions
 */
const legacyCommands = {
    // Help command (category-based with buttons)
    help: {
        description: 'Show available legacy commands',
        usage: '*j help [category]',
        execute: async (message, args, client) => {
            const categories = {
                overview: {
                    emoji: '📋',
                    title: 'Command Overview',
                    description: 'Welcome to Jarvis Legacy Commands!\nSelect a category below to see commands.',
                    fields: [
                        { name: '💰 Economy', value: '`*j help economy`', inline: true },
                        { name: '🎰 Gambling', value: '`*j help gambling`', inline: true },
                        { name: '🎮 Fun', value: '`*j help fun`', inline: true },
                        { name: '🛡️ Moderation', value: '`*j help mod`', inline: true },
                        { name: '⚙️ Utility', value: '`*j help utility`', inline: true },
                        { name: '💎 Premium', value: '`*j help premium`', inline: true }
                    ]
                },
                economy: {
                    emoji: '💰',
                    title: 'Economy Commands',
                    description: 'Build your Stark Industries fortune!',
                    fields: [
                        { name: '💵 Basics', value: '`*j balance` - Check balance\n`*j daily` - Daily reward\n`*j work` - Earn money\n`*j beg` - Beg for coins', inline: false },
                        { name: '💳 Transactions', value: '`*j pay @user <amt>` - Send money\n`*j deposit <amt>` - Bank deposit\n`*j withdraw <amt>` - Bank withdraw\n`*j leaderboard` - Rich list', inline: false },
                        { name: '🛒 Shopping', value: '`*j shop` - View shop\n`*j buy <item>` - Buy item\n`*j inventory` - Your items', inline: false }
                    ]
                },
                gambling: {
                    emoji: '🎰',
                    title: 'Gambling Commands',
                    description: 'Test your luck at Stark Casino!',
                    fields: [
                        { name: '🎲 Games', value: '`*j coinflip <amt>` - Flip a coin\n`*j slots <amt>` - Slot machine\n`*j blackjack <amt>` - Play 21\n`*j roulette <amt> <bet>` - Roulette', inline: false },
                        { name: '🎯 More Games', value: '`*j dice <amt>` - Roll dice\n`*j crash <amt>` - Crash game\n`*j highlow <amt>` - Higher or lower', inline: false },
                        { name: '🏆 Multiplayer', value: '`*j heist start` - Start a heist\n`*j heist join` - Join heist\n`*j boss attack` - Attack boss', inline: false }
                    ]
                },
                fun: {
                    emoji: '🎮',
                    title: 'Fun Commands',
                    description: 'Entertainment and social commands!',
                    fields: [
                        { name: '🎱 Random', value: '`*j 8ball <q>` - Magic 8-ball\n`*j roll [dice]` - Roll dice\n`*j rate <thing>` - Rate something\n`*j dadjoke` - Dad joke', inline: false },
                        { name: '💕 Social', value: '`*j hug @user` - Hug someone\n`*j slap @user` - Slap someone\n`*j ship @u1 @u2` - Ship people\n`*j fight @user` - Fight!', inline: false },
                        { name: '📊 Meters', value: '`*j howgay @user` - Gay meter\n`*j howbased @user` - Based meter\n`*j vibecheck @user` - Vibe check\n`*j roast @user` - Roast someone', inline: false }
                    ]
                },
                mod: {
                    emoji: '🛡️',
                    title: 'Moderation Commands',
                    description: 'Server moderation tools (requires permissions)',
                    fields: [
                        { name: '🔨 Actions', value: '`*j kick @user [reason]` - Kick member\n`*j ban @user [time] [reason]` - Ban member\n`*j unban <id>` - Unban by ID\n`*j purge <n>` - Delete n messages', inline: false },
                        { name: '🔇 Timeout', value: '`*j mute @user <time>` - Timeout user\n`*j unmute @user` - Remove timeout', inline: false },
                        { name: '⚡ Strikes', value: '`*j strike @user <reason>` - Strike (auto-escalates)\n`*j strikes @user` - View strikes\n`*j clearstrikes @user` - Clear strikes\n*2 strikes = 1h mute, 3 = 24h, 5 = ban*', inline: false },
                        { name: '⚠️ Warnings', value: '`*j warn @user <reason>` - Warn user\n`*j warnings @user` - View warnings\n`*j clearwarnings @user` - Clear warns', inline: false },
                        { name: '🤖 AI Moderation', value: '`*j enable moderation` - Enable AI mod\n`*j moderation status` - View settings', inline: false }
                    ]
                },
                utility: {
                    emoji: '⚙️',
                    title: 'Utility Commands',
                    description: 'Helpful utility commands',
                    fields: [
                        { name: '🔧 Tools', value: '`*j ping` - Bot latency\n`*j remind` - Set reminder\n`*j profile` - View profile\n`*j cookies` - Update YT cookies 👑', inline: false }
                    ]
                },
                premium: {
                    emoji: '💎',
                    title: 'Premium Features',
                    description: 'Advanced economy features',
                    fields: [
                        { name: '💠 Arc Reactor', value: '`*j reactor` - Check reactor\n`*j buy arc_reactor` - Buy (10,000💵)\n*+15% earnings, -25% cooldowns*', inline: false },
                        { name: '💱 Starkbucks', value: '`*j sbx wallet` - SBX balance\n`*j sbx convert <amt>` - Convert\n`*j sbx store` - SBX shop', inline: false },
                        { name: '📊 Crypto', value: '`*j crypto prices` - View prices\n`*j crypto buy <coin> <amt>` - Buy\n`*j crypto portfolio` - Holdings', inline: false }
                    ]
                }
            };

            // Check for category argument
            const categoryArg = (args[0] || 'overview').toLowerCase();
            const categoryAliases = {
                'moderation': 'mod',
                'moderate': 'mod',
                'gamble': 'gambling',
                'casino': 'gambling',
                'money': 'economy',
                'eco': 'economy',
                'util': 'utility',
                'tools': 'utility',
                'vip': 'premium'
            };

            const categoryKey = categoryAliases[categoryArg] || categoryArg;
            const category = categories[categoryKey] || categories.overview;

            const embed = new EmbedBuilder()
                .setTitle(`${category.emoji} ${category.title}`)
                .setDescription(category.description)
                .setColor(0x3498db)
                .setFooter({ text: 'Use *j help <category> to view specific commands' });

            category.fields.forEach(f => embed.addFields(f));

            // Create category buttons
            const row1 = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('help_overview')
                    .setLabel('Overview')
                    .setEmoji('📋')
                    .setStyle(categoryKey === 'overview' ? ButtonStyle.Primary : ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('help_economy')
                    .setLabel('Economy')
                    .setEmoji('💰')
                    .setStyle(categoryKey === 'economy' ? ButtonStyle.Primary : ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('help_gambling')
                    .setLabel('Gambling')
                    .setEmoji('🎰')
                    .setStyle(categoryKey === 'gambling' ? ButtonStyle.Primary : ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('help_fun')
                    .setLabel('Fun')
                    .setEmoji('🎮')
                    .setStyle(categoryKey === 'fun' ? ButtonStyle.Primary : ButtonStyle.Secondary)
            );

            const row2 = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('help_mod')
                    .setLabel('Moderation')
                    .setEmoji('🛡️')
                    .setStyle(categoryKey === 'mod' ? ButtonStyle.Primary : ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('help_utility')
                    .setLabel('Utility')
                    .setEmoji('⚙️')
                    .setStyle(categoryKey === 'utility' ? ButtonStyle.Primary : ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('help_premium')
                    .setLabel('Premium')
                    .setEmoji('💎')
                    .setStyle(categoryKey === 'premium' ? ButtonStyle.Primary : ButtonStyle.Secondary)
            );

            await message.reply({ embeds: [embed], components: [row1, row2] });
            return true;
        }
    },

    // Ping command
    ping: {
        description: 'Check bot latency',
        usage: '*j ping',
        execute: async (message, args, client) => {
            const latency = Date.now() - message.createdTimestamp;
            const apiLatency = Math.round(client.ws.ping);
            await message.reply(`🏓 Pong! Latency: ${latency}ms | API: ${apiLatency}ms`);
            return true;
        }
    },

    // ============ MODERATION COMMANDS ============
    ban: {
        description: 'Ban a user',
        usage: '*j ban @user [time] [reason]',
        execute: async (message, args) => {
            if (!message.member.permissions.has(PermissionFlagsBits.BanMembers)) {
                await message.reply('❌ You lack permissions to ban members.');
                return true;
            }
            const target = message.mentions.members.first();
            if (!target) {
                await message.reply('❌ Please mention a user to ban.');
                return true;
            }
            if (!target.bannable) {
                await message.reply('❌ I cannot ban that member (role hierarchy or permissions).');
                return true;
            }

            // Args: [mentions], [duration?], [reason...]
            // We need to robustly find duration string if present
            const potentialDuration = args[1]; // *j ban @user 10m reason
            let reason = args.slice(1).join(' ');
            let durationMs = null;
            let durationStr = null;

            if (potentialDuration) {
                const match = potentialDuration.match(/^(\d+)(s|m|h|d|w)?$/i);
                if (match) {
                    const amount = parseInt(match[1]);
                    const unit = (match[2] || 'm').toLowerCase();
                    if (unit === 's') durationMs = amount * 1000;
                    else if (unit === 'm') durationMs = amount * 60 * 1000;
                    else if (unit === 'h') durationMs = amount * 60 * 60 * 1000;
                    else if (unit === 'd') durationMs = amount * 24 * 60 * 60 * 1000;
                    else if (unit === 'w') durationMs = amount * 7 * 24 * 60 * 60 * 1000;

                    durationStr = potentialDuration;
                    reason = args.slice(2).join(' ') || 'No reason provided';
                }
            }

            try {
                await target.ban({ reason, deleteMessageSeconds: 0 });

                let msg = `🔨 **${target.user.tag}** has been banned`;
                if (durationMs) {
                    msg += ` for **${durationStr}**`;
                    setTimeout(async () => {
                        try { await message.guild.members.unban(target.id, 'Temp ban expired'); } catch { }
                    }, durationMs);
                }
                msg += `.\nReason: ${reason}\nhttps://tenor.com/view/bane-no-banned-and-you-are-explode-gif-16047504`;
                await message.reply(msg);
            } catch (error) {
                await message.reply(`❌ Ban failed: ${error.message}`);
            }
            return true;
        }
    },

    unban: {
        description: 'Unban a user by ID',
        usage: '*j unban <userid> [reason]',
        execute: async (message, args) => {
            if (!message.member.permissions.has(PermissionFlagsBits.BanMembers)) {
                await message.reply('❌ You lack permissions to unban members.');
                return true;
            }
            const userId = args[0];
            if (!userId || !/^\d+$/.test(userId)) {
                await message.reply('❌ Please provide a valid User ID to unban.');
                return true;
            }
            const reason = args.slice(1).join(' ') || `Unbanned by ${message.author.tag}`;
            try {
                await message.guild.members.unban(userId, reason);
                await message.reply(`🔓 User **${userId}** has been unbanned.`);
            } catch (error) {
                await message.reply(`❌ Unban failed: ${error.message}`);
            }
            return true;
        }
    },

    kick: {
        description: 'Kick a user',
        usage: '*j kick @user [reason]',
        execute: async (message, args) => {
            if (!message.member.permissions.has(PermissionFlagsBits.KickMembers)) {
                await message.reply('❌ You lack permissions to kick members.');
                return true;
            }
            const target = message.mentions.members.first();
            if (!target) {
                await message.reply('❌ Please mention a user to kick.');
                return true;
            }
            if (!target.kickable) {
                await message.reply('❌ I cannot kick that member.');
                return true;
            }
            const reason = args.slice(1).join(' ') || `Kicked by ${message.author.tag}`;
            try {
                await target.kick(reason);
                await message.reply(`👢 **${target.user.tag}** has been kicked.\nReason: ${reason}`);
            } catch (error) {
                await message.reply(`❌ Kick failed: ${error.message}`);
            }
            return true;
        }
    },

    mute: {
        description: 'Timeout a user',
        usage: '*j mute @user <duration> [reason]',
        execute: async (message, args) => {
            if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
                await message.reply('❌ You lack permissions to mute members.');
                return true;
            }
            const target = message.mentions.members.first();
            if (!target) {
                await message.reply('❌ Please mention a user to mute.');
                return true;
            }
            if (!target.moderatable) {
                await message.reply('❌ I cannot mute that member.');
                return true;
            }

            const durationStr = args[1];
            if (!durationStr) {
                await message.reply('❌ Please specify a duration (e.g., 10m, 1h).');
                return true;
            }

            let durationMs = 0;
            const match = durationStr.match(/^(\d+)(s|m|h|d|w)?$/i);
            if (match) {
                const amount = parseInt(match[1]);
                const unit = (match[2] || 'm').toLowerCase();
                if (unit === 's') durationMs = amount * 1000;
                else if (unit === 'm') durationMs = amount * 60 * 1000;
                else if (unit === 'h') durationMs = amount * 60 * 60 * 1000;
                else if (unit === 'd') durationMs = amount * 24 * 60 * 60 * 1000;
                else if (unit === 'w') durationMs = amount * 7 * 24 * 60 * 60 * 1000;
            }

            if (!durationMs || durationMs > 28 * 24 * 60 * 60 * 1000) {
                await message.reply('❌ Invalid duration (max 28 days). Format: 10m, 1h, 1d');
                return true;
            }

            const reason = args.slice(2).join(' ') || `Muted by ${message.author.tag}`;
            try {
                await target.timeout(durationMs, reason);
                await message.reply(`🔇 **${target.user.tag}** muted for **${durationStr}**.\nReason: ${reason}`);
            } catch (error) {
                await message.reply(`❌ Mute failed: ${error.message}`);
            }
            return true;
        }
    },

    unmute: {
        description: 'Remove timeout',
        usage: '*j unmute @user [reason]',
        execute: async (message, args) => {
            if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
                await message.reply('❌ You lack permissions to moderate members.');
                return true;
            }
            const target = message.mentions.members.first();
            if (!target) {
                await message.reply('❌ Please mention a user to unmute.');
                return true;
            }
            const reason = args.slice(1).join(' ') || `Unmuted by ${message.author.tag}`;
            try {
                await target.timeout(null, reason);
                await message.reply(`🔊 **${target.user.tag}** has been unmuted.`);
            } catch (error) {
                await message.reply(`❌ Unmute failed: ${error.message}`);
            }
            return true;
        }
    },

    warn: {
        description: 'Warn a user',
        usage: '*j warn @user <reason>',
        execute: async (message, args) => {
            if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
                await message.reply('❌ You lack permissions to warn members.');
                return true;
            }
            const target = message.mentions.members.first();
            if (!target) {
                await message.reply('❌ Please mention a user to warn.');
                return true;
            }
            const reason = args.slice(1).join(' ');
            if (!reason) {
                await message.reply('❌ Please provide a warning reason.');
                return true;
            }
            // In a real system, we'd save this to DB. For now, just echo.
            await message.reply(`⚠️ **${target.user.tag}** has been warned.\nReason: ${reason}`);
            return true;
        }
    },

    purge: {
        description: 'Bulk delete messages',
        usage: '*j purge <count> [@user]',
        execute: async (message, args) => {
            if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
                await message.reply('❌ You lack permissions to manage messages.');
                return true;
            }

            const count = parseInt(args[0]);
            if (!count || count < 1 || count > 100) {
                await message.reply('❌ Please specify a number between 1 and 100.');
                return true;
            }

            const targetUser = message.mentions.users.first();

            try {
                let messages;
                if (targetUser) {
                    const fetched = await message.channel.messages.fetch({ limit: 100 });
                    messages = fetched.filter(m => m.author.id === targetUser.id).first(count);
                } else {
                    messages = await message.channel.messages.fetch({ limit: count + 1 }); // +1 for command message
                }

                const deleted = await message.channel.bulkDelete(messages, true);
                const reply = await message.channel.send(`🗑️ Deleted **${deleted.size}** message${deleted.size !== 1 ? 's' : ''}.`);
                setTimeout(() => reply.delete().catch(() => { }), 3000);
            } catch (error) {
                await message.reply(`❌ Purge failed: ${error.message}`);
            }
            return true;
        }
    },

    slowmode: {
        description: 'Set channel slowmode',
        usage: '*j slowmode <duration|off>',
        execute: async (message, args) => {
            if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
                await message.reply('❌ You lack permissions to manage channels.');
                return true;
            }

            const durationStr = args[0];
            if (!durationStr) {
                await message.reply('❌ Usage: `*j slowmode <duration>` (e.g., 5s, 1m, off)');
                return true;
            }

            let seconds = 0;
            if (durationStr !== '0' && durationStr !== 'off') {
                const { parseDuration } = require('../../utils/parse-duration');
                const ms = parseDuration(durationStr);
                if (!ms) {
                    await message.reply('❌ Invalid duration. Use format like `5s`, `1m`, `0` to disable.');
                    return true;
                }
                seconds = Math.floor(ms / 1000);
                if (seconds > 21600) {
                    await message.reply('❌ Maximum slowmode is 6 hours.');
                    return true;
                }
            }

            try {
                await message.channel.setRateLimitPerUser(seconds);
                if (seconds === 0) {
                    await message.reply('⚡ Slowmode disabled for this channel.');
                } else {
                    await message.reply(`🐌 Slowmode set to **${durationStr}**.`);
                }
            } catch (error) {
                await message.reply(`❌ Failed to set slowmode: ${error.message}`);
            }
            return true;
        }
    },

    lockdown: {
        description: 'Lock or unlock a channel',
        usage: '*j lockdown <lock|unlock> [reason]',
        execute: async (message, args) => {
            if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
                await message.reply('❌ You lack permissions to manage channels.');
                return true;
            }

            const action = args[0]?.toLowerCase();
            if (!action || !['lock', 'unlock'].includes(action)) {
                await message.reply('❌ Usage: `*j lockdown <lock|unlock> [reason]`');
                return true;
            }

            const reason = args.slice(1).join(' ') || `Channel ${action}ed by ${message.author.tag}`;

            try {
                const everyone = message.guild.roles.everyone;
                if (action === 'lock') {
                    await message.channel.permissionOverwrites.edit(everyone, { SendMessages: false }, { reason });
                    await message.reply(`🔒 Channel locked.\nReason: ${reason}`);
                } else {
                    await message.channel.permissionOverwrites.edit(everyone, { SendMessages: null }, { reason });
                    await message.reply(`🔓 Channel unlocked.`);
                }
            } catch (error) {
                await message.reply(`❌ Lockdown failed: ${error.message}`);
            }
            return true;
        }
    },

    userinfo: {
        description: 'Get user information',
        usage: '*j userinfo [@user]',
        execute: async (message, args) => {
            const targetUser = message.mentions.users.first() || message.author;
            const member = await message.guild.members.fetch(targetUser.id).catch(() => null);

            const embed = new EmbedBuilder()
                .setTitle(`👤 ${targetUser.tag}`)
                .setThumbnail(targetUser.displayAvatarURL({ size: 256 }))
                .setColor(member?.displayHexColor || 0x3498db)
                .addFields(
                    { name: 'ID', value: targetUser.id, inline: true },
                    { name: 'Bot', value: targetUser.bot ? 'Yes' : 'No', inline: true },
                    { name: 'Created', value: `<t:${Math.floor(targetUser.createdTimestamp / 1000)}:R>`, inline: true }
                );

            if (member) {
                embed.addFields(
                    { name: 'Joined', value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`, inline: true },
                    { name: 'Nickname', value: member.nickname || 'None', inline: true },
                    { name: 'Roles', value: member.roles.cache.size > 1 ? `${member.roles.cache.size - 1} roles` : 'None', inline: true }
                );
            }

            await message.reply({ embeds: [embed] });
            return true;
        }
    },

    serverinfo: {
        description: 'Get server information',
        usage: '*j serverinfo',
        execute: async (message, args) => {
            const guild = message.guild;
            const owner = await guild.fetchOwner().catch(() => null);

            const embed = new EmbedBuilder()
                .setTitle(`🏰 ${guild.name}`)
                .setThumbnail(guild.iconURL({ size: 256 }))
                .setColor(0x9b59b6)
                .addFields(
                    { name: 'ID', value: guild.id, inline: true },
                    { name: 'Owner', value: owner ? owner.user.tag : 'Unknown', inline: true },
                    { name: 'Created', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`, inline: true },
                    { name: 'Members', value: `${guild.memberCount.toLocaleString()}`, inline: true },
                    { name: 'Channels', value: `${guild.channels.cache.size}`, inline: true },
                    { name: 'Roles', value: `${guild.roles.cache.size}`, inline: true },
                    { name: 'Boost Level', value: `Tier ${guild.premiumTier}`, inline: true },
                    { name: 'Boosts', value: `${guild.premiumSubscriptionCount || 0}`, inline: true }
                );

            if (guild.description) {
                embed.setDescription(guild.description);
            }

            await message.reply({ embeds: [embed] });
            return true;
        }
    },

    // Aatrox
    aatrox: {
        description: 'GYAATROX',
        usage: '*j aatrox',
        execute: async (message, args) => {
            await message.reply(
                'https://tenor.com/view/aatrox-gyattrox-gyaatrox-lol-league-of-legends-gif-16706958126825166451'
            );
            return true;
        }
    },

    // Soul status
    soul: {
        description: 'View Jarvis artificial soul',
        usage: '*j soul',
        execute: async (message, args) => {
            const soulStatus = selfhostFeatures.jarvisSoul.getStatus();

            const traitLines = Object.entries(soulStatus.traits)
                .map(([trait, value]) => {
                    const bar =
                        '█'.repeat(Math.floor(value / 10)) +
                        '░'.repeat(10 - Math.floor(value / 10));
                    return `**${trait}**: ${bar} ${value}%`;
                })
                .join('\n');

            const embed = new EmbedBuilder()
                .setTitle('🤖 Jarvis Artificial Soul')
                .setDescription('*"God said no, so I made my own soul."*')
                .setColor(0x9b59b6)
                .addFields(
                    { name: '⏳ Soul Age', value: soulStatus.age, inline: true },
                    { name: '😊 Current Mood', value: soulStatus.mood, inline: true },
                    {
                        name: '📊 Evolution Events',
                        value: String(soulStatus.evolutionCount),
                        inline: true
                    },
                    {
                        name: '🧬 Personality Traits',
                        value: traitLines || 'Calibrating...',
                        inline: false
                    }
                )
                .setFooter({ text: '🤖 Artificial Soul System' })
                .setTimestamp();

            await message.reply({ embeds: [embed] });
            return true;
        }
    },

    // Roast command
    roast: {
        description: 'Roast someone with British class',
        usage: '*j roast @user',
        execute: async (message, args) => {
            const target = message.mentions.users.first();
            if (!target) {
                await message.reply(
                    'Please mention someone to roast, sir. Usage: `*j roast @user`'
                );
                return true;
            }

            if (target.id === message.client.user.id) {
                await message.reply(
                    'I appreciate the ambition, sir, but self-deprecation is beneath my programming.'
                );
                return true;
            }

            const roast = generateRoast(
                target.displayName || target.username,
                message.author.username
            );

            const embed = new EmbedBuilder()
                .setTitle('🔥 Roast Protocol Engaged')
                .setDescription(roast)
                .setColor(0xe74c3c)
                .setFooter({ text: `Requested by ${message.author.username}` })
                .setTimestamp();

            selfhostFeatures.jarvisSoul.evolve('roast', 'positive');
            await message.reply({ embeds: [embed] });
            return true;
        }
    },

    // Balance check
    balance: {
        description: 'Check Stark Bucks balance',
        usage: '*j balance',
        aliases: ['bal', 'money', 'wallet'],
        execute: async (message, args) => {
            const stats = await starkEconomy.getUserStats(message.author.id);

            // Try to find rank in top 100
            const lb = await starkEconomy.getLeaderboard(100, client);
            const rankIndex = lb.findIndex(u => u.userId === message.author.id);
            const rank = rankIndex !== -1 ? rankIndex + 1 : null;

            // Generate Profile Image
            const { AttachmentBuilder } = require('discord.js');
            const imageGenerator = require('./image-generator');

            const profileData = {
                username: message.author.username,
                avatar: message.author.displayAvatarURL({ extension: 'png', size: 256 }),
                balance: stats.balance,
                totalEarned: stats.totalEarned || 0,
                winRate: stats.winRate,
                rank: rank
            };

            try {
                const buffer = await imageGenerator.generateProfileImage(profileData);
                const attachment = new AttachmentBuilder(buffer, { name: 'balance.png' });
                await message.reply({ files: [attachment] });
            } catch (err) {
                console.error('[Balance] Image generation failed:', err);
                await message.reply(`💰 **${message.author.username}** has **${stats.balance.toLocaleString()}** Stark Bucks.`);
            }
            return true;
        }
    },

    // Daily reward
    daily: {
        description: 'Claim daily Stark Bucks',
        usage: '*j daily',
        execute: async (message, args) => {
            const result = await starkEconomy.claimDaily(
                message.author.id,
                message.author.username
            );

            if (!result.success) {
                const hours = Math.floor(result.cooldown / (60 * 60 * 1000));
                const minutes = Math.floor((result.cooldown % (60 * 60 * 1000)) / (60 * 1000));
                await message.reply(
                    `⏰ You've already claimed today, sir. Come back in ${hours}h ${minutes}m.`
                );
                return true;
            }

            const safeReward = Number.isFinite(Number(result.reward))
                ? Math.floor(Number(result.reward))
                : 0;
            const safeBalance = Number.isFinite(Number(result.newBalance))
                ? Math.floor(Number(result.newBalance))
                : 0;
            const safeStreak = Number.isFinite(Number(result.streak))
                ? Math.floor(Number(result.streak))
                : 0;
            const safeStreakBonus = Number.isFinite(Number(result.streakBonus))
                ? Math.floor(Number(result.streakBonus))
                : 0;

            const embed = new EmbedBuilder()
                .setTitle('💰 Daily Reward Claimed!')
                .setDescription(
                    `You received **${safeReward}** Stark Bucks!${result.doubled ? ' (DOUBLED!)' : ''}\nNew balance: **${safeBalance}** 💵`
                )
                .setColor(0x2ecc71)
                .addFields({
                    name: '🔥 Streak',
                    value: `${safeStreak} days (+${safeStreakBonus} bonus)`,
                    inline: true
                })
                .setFooter({ text: 'Come back tomorrow to keep your streak!' });

            await message.reply({ embeds: [embed] });
            return true;
        }
    },

    // Work for money
    work: {
        description: 'Work at Stark Industries',
        usage: '*j work',
        aliases: ['job'],
        execute: async (message, args) => {
            const result = await starkEconomy.work(message.author.id, message.author.username);

            if (!result.success) {
                const minutes = Math.floor(result.cooldown / (60 * 1000));
                await message.reply(`⏰ You're tired, sir. Rest for ${minutes} more minutes.`);
                return true;
            }

            const embed = new EmbedBuilder()
                .setTitle('💼 Work Complete!')
                .setDescription(`You ${result.job} and earned **${result.reward}** Stark Bucks!`)
                .setColor(0x3498db)
                .addFields({ name: '💰 Balance', value: `${result.newBalance}`, inline: true })
                .setFooter({ text: 'Stark Industries HR Department' });

            await message.reply({ embeds: [embed] });
            return true;
        }
    },

    // Gamble
    gamble: {
        description: 'Gamble your Stark Bucks (double or nothing)',
        usage: '*j gamble <amount>',
        aliases: ['bet'],
        execute: async (message, args) => {
            const amount = parseInt(args[0]);

            if (!amount || amount < 1) {
                await message.reply('Usage: `*j gamble <amount>`');
                return true;
            }

            const result = await starkEconomy.gamble(message.author.id, amount);

            if (!result.success) {
                await message.reply(`❌ ${result.error}`);
                return true;
            }

            const embed = new EmbedBuilder()
                .setTitle(result.won ? '🎰 You Won!' : '🎰 You Lost!')
                .setDescription(
                    result.won
                        ? `Congratulations! You won **${result.amount}** Stark Bucks!`
                        : `Better luck next time. You lost **${result.amount}** Stark Bucks.`
                )
                .setColor(result.won ? 0x2ecc71 : 0xe74c3c)
                .addFields({ name: '💰 Balance', value: `${result.newBalance}`, inline: true })
                .setFooter({ text: `Win rate: ${result.winRate}%` });

            selfhostFeatures.jarvisSoul.evolve(result.won ? 'helpful' : 'chaos', 'neutral');
            await message.reply({ embeds: [embed] });
            return true;
        }
    },

    // Slots
    slots: {
        description: 'Play the slot machine',
        usage: '*j slots <bet>',
        aliases: ['slot'],
        execute: async (message, args) => {
            const bet = parseInt(args[0]) || 10;

            const result = await starkEconomy.playSlots(message.author.id, bet);

            if (!result.success) {
                await message.reply(`❌ ${result.error}`);
                return true;
            }

            const slotDisplay = result.results.join(' | ');
            let resultText = '';
            if (result.resultType === 'jackpot') resultText = '💎 JACKPOT! 💎';
            else if (result.resultType === 'triple') resultText = '🎉 TRIPLE!';
            else if (result.resultType === 'double') resultText = '✨ Double!';
            else resultText = '😢 No match';

            const embed = new EmbedBuilder()
                .setTitle('🎰 Slot Machine')
                .setDescription(`**[ ${slotDisplay} ]**\n\n${resultText}`)
                .setColor(result.change > 0 ? 0x2ecc71 : 0xe74c3c)
                .addFields(
                    { name: '💵 Bet', value: `${result.bet}`, inline: true },
                    { name: '💰 Won', value: `${result.winnings}`, inline: true },
                    { name: '🏦 Balance', value: `${result.newBalance}`, inline: true }
                )
                .setFooter({ text: `Multiplier: x${result.multiplier}` });

            await message.reply({ embeds: [embed] });
            return true;
        }
    },

    // Coinflip
    coinflip: {
        description: 'Flip a coin',
        usage: '*j coinflip <bet> <heads/tails>',
        aliases: ['cf', 'flip'],
        execute: async (message, args) => {
            const bet = parseInt(args[0]);
            const choice = (args[1] || '').toLowerCase();

            if (!bet || !['heads', 'tails', 'h', 't'].includes(choice)) {
                await message.reply('Usage: `*j coinflip <bet> <heads/tails>`');
                return true;
            }

            const normalizedChoice = choice.startsWith('h') ? 'heads' : 'tails';
            const result = await starkEconomy.coinflip(message.author.id, bet, normalizedChoice);

            if (!result.success) {
                await message.reply(`❌ ${result.error}`);
                return true;
            }

            const coinEmoji = result.result === 'heads' ? '🪙' : '⭕';
            const embed = new EmbedBuilder()
                .setTitle(`${coinEmoji} Coinflip`)
                .setDescription(
                    `The coin landed on **${result.result.toUpperCase()}**!\n\nYou chose **${result.choice}** - ${result.won ? '**YOU WIN!**' : 'You lose.'}`
                )
                .setColor(result.won ? 0x2ecc71 : 0xe74c3c)
                .addFields({ name: '💰 Balance', value: `${result.newBalance}`, inline: true })
                .setFooter({ text: '50/50 chance' });

            await message.reply({ embeds: [embed] });
            return true;
        }
    },

    // Shop
    shop: {
        description: 'View the Stark Shop',
        usage: '*j shop',
        aliases: ['store'],
        execute: async (message, args) => {
            const items = starkEconomy.getShopItems();

            const itemList = items
                .map(item => `**${item.name}** - ${item.price} 💵\n> ${item.description}`)
                .join('\n\n');

            const embed = new EmbedBuilder()
                .setTitle('🛒 Stark Industries Shop')
                .setDescription(itemList)
                .setColor(0x9b59b6)
                .setFooter({ text: 'Use *j buy <item_id> to purchase' });

            await message.reply({ embeds: [embed] });
            return true;
        }
    },

    // Buy item
    buy: {
        description: 'Buy an item from the shop',
        usage: '*j buy <item_id>',
        aliases: ['purchase'],
        execute: async (message, args) => {
            const itemId = args[0]?.toLowerCase();

            if (!itemId) {
                await message.reply('Usage: `*j buy <item_id>` (e.g., `*j buy lucky_charm`)');
                return true;
            }

            const result = await starkEconomy.buyItem(message.author.id, itemId);

            if (!result.success) {
                await message.reply(`❌ ${result.error}`);
                return true;
            }

            const embed = new EmbedBuilder()
                .setTitle('🛒 Purchase Successful!')
                .setDescription(`You bought **${result.item.name}**!`)
                .setColor(0x2ecc71)
                .addFields({ name: '💰 Balance', value: `${result.newBalance}`, inline: true })
                .setFooter({ text: 'Thank you for shopping at Stark Industries' });

            await message.reply({ embeds: [embed] });
            return true;
        }
    },

    // Leaderboard
    leaderboard: {
        description: 'View richest users',
        usage: '*j leaderboard',
        aliases: ['lb', 'top', 'rich'],
        execute: async (message, args, client) => {
            const lb = await starkEconomy.getLeaderboard(10, client);

            if (!lb.length) {
                await message.reply('No data yet, sir.');
                return true;
            }

            // Generate Canvas Image Leaderboard
            const { AttachmentBuilder } = require('discord.js');
            const imageGenerator = require('./image-generator');

            const enrichedLb = await Promise.all(lb.map(async (u) => {
                let avatarUrl = null;
                try {
                    const user = await client.users.fetch(u.userId);
                    avatarUrl = user.displayAvatarURL({ extension: 'png', size: 128 });
                } catch (e) { }
                return { ...u, avatar: avatarUrl };
            }));

            const buffer = await imageGenerator.generateLeaderboardGif(enrichedLb); // Animated GIF
            const attachment = new AttachmentBuilder(buffer, { name: 'leaderboard.gif' });

            await message.reply({ files: [attachment] });
            return true;
        }
    },

    // Reminder
    remind: {
        description: 'Set a reminder',
        usage: '*j remind in <time> <message>',
        aliases: ['reminder', 'schedule'],
        execute: async (message, args) => {
            const fullArgs = args.join(' ');
            const timeMatch = fullArgs.match(
                /in\s+(\d+)\s*(min|minute|minutes|hour|hours|h|m|second|seconds|s)/i
            );

            if (!timeMatch) {
                await message.reply(
                    'Usage: `*j remind in <time> <message>`\nExample: `*j remind in 5 minutes check the oven`'
                );
                return true;
            }

            const ms = parseScheduleTime(fullArgs);
            if (!ms || ms > 24 * 60 * 60 * 1000) {
                await message.reply('Invalid time, sir. Maximum is 24 hours.');
                return true;
            }

            const reminderText = fullArgs.replace(timeMatch[0], '').trim() || "Time's up!";
            const userId = message.author.id;
            const channelId = message.channel.id;

            // Schedule the reminder
            setTimeout(async () => {
                try {
                    const channel = await message.client.channels.fetch(channelId);
                    await safeSend(channel, { content: `⏰ <@${userId}> Reminder: ${reminderText}` }, message.client);
                } catch (e) {
                    console.error('Failed to send reminder:', e);
                }
            }, ms);

            const timeAmount = timeMatch[1];
            const timeUnit = timeMatch[2];
            await message.reply(
                `⏰ Got it, sir. I'll remind you in ${timeAmount} ${timeUnit}: "${reminderText}"`
            );
            return true;
        }
    },

    // ============ NEW FUN COMMANDS ============
    '8ball': {
        description: 'Ask the magic 8-ball',
        usage: '*j 8ball <question>',
        aliases: ['eightball'],
        execute: async (message, args) => {
            const question = args.join(' ');
            if (!question) {
                await message.reply('Ask me a question, sir. Usage: `*j 8ball <question>`');
                return true;
            }
            const answer = funFeatures.get8BallResponse();
            const embed = new EmbedBuilder()
                .setTitle('🎱 Magic 8-Ball')
                .setColor(0x000000)
                .addFields(
                    { name: '❓ Question', value: question, inline: false },
                    { name: '🔮 Answer', value: answer, inline: false }
                );
            await message.reply({ embeds: [embed] });
            return true;
        }
    },

    dadjoke: {
        description: 'Get a dad joke',
        usage: '*j dadjoke',
        aliases: ['dad'],
        execute: async (message, args) => {
            const joke = funFeatures.getDadJoke();
            await message.reply(`👨 **Dad Joke**\n\n${joke}`);
            return true;
        }
    },

    pickupline: {
        description: 'Get a pickup line',
        usage: '*j pickupline',
        aliases: ['pickup'],
        execute: async (message, args) => {
            const line = funFeatures.getPickupLine();
            await message.reply(`💕 **Pickup Line**\n\n${line}`);
            return true;
        }
    },

    rate: {
        description: 'Rate something',
        usage: '*j rate <thing>',
        execute: async (message, args) => {
            const thing = args.join(' ') || 'that';
            const rating = funFeatures.randomInt(0, 10);
            const stars = '⭐'.repeat(rating) + '☆'.repeat(10 - rating);
            await message.reply(`📊 **Rating for "${thing}":**\n${stars} **${rating}/10**`);
            return true;
        }
    },

    roll: {
        description: 'Roll dice',
        usage: '*j roll [dice]',
        aliases: ['dice'],
        execute: async (message, args) => {
            const notation = args[0] || '1d6';
            const result = funFeatures.rollDice(notation);

            if (!result) {
                await message.reply('❌ Invalid dice notation! Use format like `2d6` or `1d20+5`');
                return true;
            }

            const embed = new EmbedBuilder()
                .setTitle('🎲 Dice Roll')
                .setColor(0x9b59b6)
                .addFields(
                    { name: 'Dice', value: result.notation, inline: true },
                    { name: 'Rolls', value: result.rolls.join(', '), inline: true },
                    { name: 'Total', value: `**${result.total}**`, inline: true }
                );
            await message.reply({ embeds: [embed] });
            return true;
        }
    },

    ship: {
        description: 'Ship two people',
        usage: '*j ship @user1 @user2',
        execute: async (message, args) => {
            const users = message.mentions.users;
            if (users.size < 1) {
                await message.reply('Mention at least one person! Usage: `*j ship @user1 @user2`');
                return true;
            }

            const person1 = users.first();
            const person2 = users.size > 1 ? users.at(1) : message.author;

            const compatibility = funFeatures.calculateCompatibility(person1.id, person2.id);
            const shipName = funFeatures.generateShipName(person1.username, person2.username);

            let emoji, description;
            if (compatibility >= 90) {
                emoji = '💕';
                description = 'SOULMATES!';
            } else if (compatibility >= 70) {
                emoji = '❤️';
                description = 'Great potential!';
            } else if (compatibility >= 50) {
                emoji = '💛';
                description = 'Could work!';
            } else if (compatibility >= 30) {
                emoji = '🧡';
                description = 'Complicated...';
            } else {
                emoji = '💔';
                description = 'Not meant to be.';
            }

            const embed = new EmbedBuilder()
                .setTitle(`${emoji} Ship: ${shipName}`)
                .setColor(compatibility >= 50 ? 0xe91e63 : 0x95a5a6)
                .setDescription(
                    `**${person1.username}** 💕 **${person2.username}**\n\n**${compatibility}%** - ${description}`
                );
            await message.reply({ embeds: [embed] });
            return true;
        }
    },

    hug: {
        description: 'Hug someone',
        usage: '*j hug @user',
        execute: async (message, args) => {
            const target = message.mentions.users.first();
            if (!target) {
                await message.reply('Mention someone to hug! 🤗');
                return true;
            }
            const gif = funFeatures.getHugGif();
            const embed = new EmbedBuilder()
                .setDescription(`**${message.author.username}** hugs **${target.username}**! 🤗`)
                .setColor(0xff69b4)
                .setImage(gif);
            await message.reply({ embeds: [embed] });
            return true;
        }
    },

    slap: {
        description: 'Slap someone',
        usage: '*j slap @user',
        execute: async (message, args) => {
            const target = message.mentions.users.first();
            if (!target) {
                await message.reply('Mention someone to slap! 👋');
                return true;
            }
            const gif = funFeatures.getSlapGif();
            const embed = new EmbedBuilder()
                .setDescription(`**${message.author.username}** slaps **${target.username}**! 👋`)
                .setColor(0xe74c3c)
                .setImage(gif);
            await message.reply({ embeds: [embed] });
            return true;
        }
    },

    fight: {
        description: 'Fight someone',
        usage: '*j fight @user',
        execute: async (message, args) => {
            const target = message.mentions.users.first();
            if (!target) {
                await message.reply('Mention someone to fight! 👊');
                return true;
            }

            const fight = funFeatures.generateFight(message.author.username, target.username);
            const embed = new EmbedBuilder()
                .setTitle('⚔️ FIGHT! ⚔️')
                .setColor(0xe74c3c)
                .setDescription(fight.moves.join('\n\n'))
                .addFields(
                    {
                        name: `${message.author.username} HP`,
                        value: `${fight.attackerHP}/100`,
                        inline: true
                    },
                    {
                        name: `${target.username} HP`,
                        value: `${fight.defenderHP}/100`,
                        inline: true
                    }
                )
                .setFooter({ text: `🏆 Winner: ${fight.winner}` });
            await message.reply({ embeds: [embed] });
            return true;
        }
    },

    howgay: {
        description: 'How gay meter',
        usage: '*j howgay [@user]',
        execute: async (message, args) => {
            const target = message.mentions.users.first() || message.author;
            const percentage = funFeatures.randomInt(0, 100);
            const bar =
                '🏳️‍🌈'.repeat(Math.floor(percentage / 10)) +
                '⬜'.repeat(10 - Math.floor(percentage / 10));
            await message.reply(`🏳️‍🌈 **${target.username}** is **${percentage}%** gay\n${bar}`);
            return true;
        }
    },

    howbased: {
        description: 'How based meter',
        usage: '*j howbased [@user]',
        execute: async (message, args) => {
            const target = message.mentions.users.first() || message.author;
            const percentage = funFeatures.randomInt(0, 100);
            const bar =
                '🗿'.repeat(Math.floor(percentage / 10)) +
                '⬜'.repeat(10 - Math.floor(percentage / 10));
            await message.reply(`🗿 **${target.username}** is **${percentage}%** based\n${bar}`);
            return true;
        }
    },

    vibecheck: {
        description: 'Vibe check someone',
        usage: '*j vibecheck [@user]',
        aliases: ['vibe'],
        execute: async (message, args) => {
            const target = message.mentions.users.first() || message.author;
            const vibe = funFeatures.generateVibeCheck(target.username);
            const embed = new EmbedBuilder()
                .setTitle(`${vibe.emoji} Vibe Check: ${vibe.rating}`)
                .setDescription(`**${target.username}**\n${vibe.description}`)
                .setColor(vibe.overallScore > 50 ? 0x2ecc71 : 0xe74c3c)
                .addFields({ name: '📊 Score', value: `${vibe.overallScore}/100`, inline: true });
            await message.reply({ embeds: [embed] });
            return true;
        }
    },

    kick: {
        description: 'Kick a member from the server',
        usage: '*j kick @user [reason]',
        execute: async (message, args) => {
            if (!message.guild) {
                await message.reply('This command only works in servers, sir.');
                return true;
            }

            const authorMember = message.member;
            if (!authorMember) {
                await message.reply('Could not resolve your member permissions, sir.');
                return true;
            }

            if (!authorMember.permissions?.has(PermissionFlagsBits.KickMembers)) {
                await message.reply('🔒 You need **Kick Members** permission to do that, sir.');
                return true;
            }

            const botMember =
                message.guild.members.me ||
                (await message.guild.members.fetchMe().catch(() => null));

            if (!botMember) {
                await message.reply('I could not verify my permissions in this server, sir.');
                return true;
            }

            if (!botMember.permissions?.has(PermissionFlagsBits.KickMembers)) {
                await message.reply('❌ I do not have **Kick Members** permission in this server.');
                return true;
            }

            const mentionedUser = message.mentions.users.first();
            if (!mentionedUser) {
                await message.reply('Usage: `*j kick @user [reason]`');
                return true;
            }

            const targetMember =
                message.mentions.members.first() ||
                (await message.guild.members.fetch(mentionedUser.id).catch(() => null));

            if (!targetMember) {
                await message.reply('I could not find that member in this server, sir.');
                return true;
            }

            if (targetMember.id === message.guild.ownerId) {
                await message.reply('I cannot kick the server owner, sir.');
                return true;
            }

            if (targetMember.id === message.author.id) {
                await message.reply("Kicking yourself is… ambitious, sir. I'll decline.");
                return true;
            }

            if (targetMember.id === botMember.id) {
                await message.reply("I will not be kicking myself today, sir.");
                return true;
            }

            const isOwner = message.guild.ownerId === message.author.id;
            if (!isOwner) {
                const authorHigher =
                    authorMember.roles?.highest &&
                    targetMember.roles?.highest &&
                    authorMember.roles.highest.comparePositionTo(targetMember.roles.highest) > 0;

                if (!authorHigher) {
                    await message.reply(
                        '🔒 You cannot kick that member due to role hierarchy, sir.'
                    );
                    return true;
                }
            }

            if (!targetMember.kickable) {
                await message.reply(
                    '❌ I cannot kick that member (missing permissions or role hierarchy issue).'
                );
                return true;
            }

            const mentionIndex = args.findIndex(token => /^<@!?\d+>$/.test(token));
            const reason =
                mentionIndex >= 0
                    ? args.slice(mentionIndex + 1).join(' ').trim()
                    : args.slice(1).join(' ').trim();

            try {
                await targetMember.kick(
                    reason || `Kicked by ${message.author.tag}`
                );
                await message.reply(
                    `✅ Kicked **${targetMember.user?.tag || targetMember.user?.username || 'member'}**.`
                );
            } catch (error) {
                console.error('[LegacyCommands] Kick failed:', error);
                await message.reply('❌ Kick failed, sir.');
            }

            return true;
        }
    },

    ban: {
        description: 'Ban a member from the server',
        usage: '*j ban @user [time] [reason]',
        aliases: ['banish'],
        execute: async (message, args) => {
            if (!message.guild) {
                await message.reply('This command only works in servers, sir.');
                return true;
            }

            const authorMember = message.member;
            if (!authorMember) {
                await message.reply('Could not resolve your member permissions, sir.');
                return true;
            }

            if (!authorMember.permissions?.has(PermissionFlagsBits.BanMembers)) {
                await message.reply('🔒 You need **Ban Members** permission to do that, sir.');
                return true;
            }

            const botMember =
                message.guild.members.me ||
                (await message.guild.members.fetchMe().catch(() => null));

            if (!botMember) {
                await message.reply('I could not verify my permissions in this server, sir.');
                return true;
            }

            if (!botMember.permissions?.has(PermissionFlagsBits.BanMembers)) {
                await message.reply('❌ I do not have **Ban Members** permission in this server.');
                return true;
            }

            const mentionedUser = message.mentions.users.first();
            if (!mentionedUser) {
                await message.reply('Usage: `*j ban @user [time] [reason]`\nTime examples: `10m`, `2h`, `7d`, `forever`');
                return true;
            }

            const targetMember =
                message.mentions.members.first() ||
                (await message.guild.members.fetch(mentionedUser.id).catch(() => null));

            if (targetMember) {
                if (targetMember.id === message.guild.ownerId) {
                    await message.reply('I cannot ban the server owner, sir.');
                    return true;
                }

                if (targetMember.id === message.author.id) {
                    await message.reply("Banning yourself? That's... creative, sir. I'll decline.");
                    return true;
                }

                if (targetMember.id === botMember.id) {
                    await message.reply("I will not be banning myself today, sir.");
                    return true;
                }

                const isOwner = message.guild.ownerId === message.author.id;
                if (!isOwner) {
                    const authorHigher =
                        authorMember.roles?.highest &&
                        targetMember.roles?.highest &&
                        authorMember.roles.highest.comparePositionTo(targetMember.roles.highest) > 0;

                    if (!authorHigher) {
                        await message.reply(
                            '🔒 You cannot ban that member due to role hierarchy, sir.'
                        );
                        return true;
                    }
                }

                if (!targetMember.bannable) {
                    await message.reply(
                        '❌ I cannot ban that member (missing permissions or role hierarchy issue).'
                    );
                    return true;
                }
            }

            // Parse time and reason from args
            const mentionIndex = args.findIndex(token => /^<@!?\d+>$/.test(token));
            const afterMention = mentionIndex >= 0 ? args.slice(mentionIndex + 1) : args.slice(1);

            let banDuration = null; // null = permanent
            let reason = '';

            if (afterMention.length > 0) {
                const timeArg = afterMention[0].toLowerCase();
                const timeMatch = timeArg.match(/^(\d+)(m|min|mins|minutes?|h|hr|hrs|hours?|d|day|days?)$/i);

                if (timeMatch) {
                    const amount = parseInt(timeMatch[1], 10);
                    const unit = timeMatch[2].toLowerCase();

                    if (unit.startsWith('m')) {
                        banDuration = amount * 60 * 1000; // minutes
                    } else if (unit.startsWith('h')) {
                        banDuration = amount * 60 * 60 * 1000; // hours
                    } else if (unit.startsWith('d')) {
                        banDuration = amount * 24 * 60 * 60 * 1000; // days
                    }

                    reason = afterMention.slice(1).join(' ').trim();
                } else if (timeArg === 'forever' || timeArg === 'permanent' || timeArg === 'perm') {
                    banDuration = null; // permanent
                    reason = afterMention.slice(1).join(' ').trim();
                } else {
                    // No time specified, all args are reason
                    reason = afterMention.join(' ').trim();
                }
            }

            const BANE_GIF = 'https://tenor.com/view/bane-no-banned-and-you-are-explode-gif-16047504';

            try {
                await message.guild.members.ban(mentionedUser.id, {
                    reason: reason || `Banned by ${message.author.tag}`,
                    deleteMessageSeconds: 0
                });

                // Format duration text
                let durationText = '**permanently**';
                if (banDuration) {
                    const mins = Math.floor(banDuration / 60000);
                    const hours = Math.floor(mins / 60);
                    const days = Math.floor(hours / 24);

                    if (days > 0) {
                        durationText = `for **${days} day${days > 1 ? 's' : ''}**`;
                    } else if (hours > 0) {
                        durationText = `for **${hours} hour${hours > 1 ? 's' : ''}**`;
                    } else {
                        durationText = `for **${mins} minute${mins > 1 ? 's' : ''}**`;
                    }

                    // Schedule unban if temporary
                    setTimeout(async () => {
                        try {
                            await message.guild.members.unban(mentionedUser.id, 'Temporary ban expired');
                            const channel = message.channel;
                            if (channel) {
                                await safeSend(channel, { content: `✅ **${mentionedUser.tag || mentionedUser.username}** has been automatically unbanned (temp ban expired).` }, message.client);
                            }
                        } catch (e) {
                            console.error('[LegacyCommands] Auto-unban failed:', e);
                        }
                    }, banDuration);
                }

                // Simple text message + gif
                let banMessage = `🔨 **${mentionedUser.tag || mentionedUser.username}** has been banned ${durationText}.`;
                if (reason) {
                    banMessage += `\nReason: ${reason}`;
                }

                await message.reply(banMessage);
                await message.channel.send(BANE_GIF);
            } catch (error) {
                console.error('[LegacyCommands] Ban failed:', error);
                await message.reply('❌ Ban failed, sir.');
            }

            return true;
        }
    },

    unban: {
        description: 'Unban a user from the server',
        usage: '*j unban <user_id> [reason]',
        execute: async (message, args) => {
            if (!message.guild) {
                await message.reply('This command only works in servers, sir.');
                return true;
            }

            const authorMember = message.member;
            if (!authorMember?.permissions?.has(PermissionFlagsBits.BanMembers)) {
                await message.reply('🔒 You need **Ban Members** permission to do that, sir.');
                return true;
            }

            const botMember = message.guild.members.me ||
                (await message.guild.members.fetchMe().catch(() => null));
            if (!botMember?.permissions?.has(PermissionFlagsBits.BanMembers)) {
                await message.reply('❌ I do not have **Ban Members** permission in this server.');
                return true;
            }

            // Get user ID from args or mention
            let userId = args[0];
            const mentionMatch = userId?.match(/^<@!?(\d+)>$/);
            if (mentionMatch) {
                userId = mentionMatch[1];
            }

            if (!userId || !/^\d+$/.test(userId)) {
                await message.reply('Usage: `*j unban <user_id> [reason]`\nYou can find the user ID in the server ban list.');
                return true;
            }

            const reason = args.slice(1).join(' ').trim() || `Unbanned by ${message.author.tag}`;

            try {
                await message.guild.members.unban(userId, reason);
                await message.reply(`✅ Unbanned user ID \`${userId}\`.`);
            } catch (error) {
                console.error('[LegacyCommands] Unban failed:', error);
                await message.reply('❌ Unban failed. User may not be banned or ID is invalid.');
            }

            return true;
        }
    },

    mute: {
        description: 'Timeout a member',
        usage: '*j mute @user <time> [reason]',
        aliases: ['timeout'],
        execute: async (message, args) => {
            if (!message.guild) {
                await message.reply('This command only works in servers, sir.');
                return true;
            }

            const authorMember = message.member;
            if (!authorMember?.permissions?.has(PermissionFlagsBits.ModerateMembers)) {
                await message.reply('🔒 You need **Timeout Members** permission to do that, sir.');
                return true;
            }

            const botMember = message.guild.members.me ||
                (await message.guild.members.fetchMe().catch(() => null));
            if (!botMember?.permissions?.has(PermissionFlagsBits.ModerateMembers)) {
                await message.reply('❌ I do not have **Timeout Members** permission in this server.');
                return true;
            }

            const mentionedUser = message.mentions.users.first();
            if (!mentionedUser) {
                await message.reply('Usage: `*j mute @user <time> [reason]`\nTime examples: `10m`, `1h`, `1d`');
                return true;
            }

            const targetMember = message.mentions.members.first() ||
                (await message.guild.members.fetch(mentionedUser.id).catch(() => null));

            if (!targetMember) {
                await message.reply('Could not find that member in this server, sir.');
                return true;
            }

            if (!targetMember.moderatable) {
                await message.reply('❌ I cannot timeout that member (role hierarchy issue).');
                return true;
            }

            // Prevent self-muting
            if (targetMember.id === message.author.id) {
                await message.reply("You **cannot** mute yourself, sir.");
                return true;
            }

            // Prevent banning server owner
            if (targetMember.id === message.guild.ownerId) {
                await message.reply('I cannot mute the server owner, sir.');
                return true;
            }

            // Prevent mods from muting other mods (unless they're the server owner)
            const isOwner = message.guild.ownerId === message.author.id;
            if (!isOwner && (targetMember.permissions.has(PermissionFlagsBits.ModerateMembers) || targetMember.permissions.has(PermissionFlagsBits.BanMembers))) {
                await message.reply('🔒 You cannot mute other moderators, sir.');
                return true;
            }

            // Check role hierarchy (unless executor is owner)
            if (!isOwner) {
                const authorHigher = authorMember.roles?.highest && targetMember.roles?.highest &&
                    authorMember.roles.highest.comparePositionTo(targetMember.roles.highest) > 0;
                if (!authorHigher) {
                    await message.reply('🔒 You cannot mute that member due to role hierarchy, sir.');
                    return true;
                }
            }

            // Parse time
            const mentionIndex = args.findIndex(token => /^<@!?\d+>$/.test(token));
            const afterMention = mentionIndex >= 0 ? args.slice(mentionIndex + 1) : args.slice(1);

            if (afterMention.length === 0) {
                await message.reply('Please specify a time. Example: `*j mute @user 10m being annoying`');
                return true;
            }

            const timeArg = afterMention[0].toLowerCase();
            const timeMatch = timeArg.match(/^(\d+)(m|min|mins|minutes?|h|hr|hrs|hours?|d|day|days?)$/i);

            if (!timeMatch) {
                await message.reply('Invalid time format. Use: `10m`, `1h`, `1d`');
                return true;
            }

            const amount = parseInt(timeMatch[1], 10);
            const unit = timeMatch[2].toLowerCase();
            let durationMs;

            if (unit.startsWith('m')) {
                durationMs = amount * 60 * 1000;
            } else if (unit.startsWith('h')) {
                durationMs = amount * 60 * 60 * 1000;
            } else if (unit.startsWith('d')) {
                durationMs = amount * 24 * 60 * 60 * 1000;
            }

            // Max timeout is 28 days
            if (durationMs > 28 * 24 * 60 * 60 * 1000) {
                await message.reply('Maximum timeout is 28 days, sir.');
                return true;
            }

            const reason = afterMention.slice(1).join(' ').trim() || `Timed out by ${message.author.tag}`;

            try {
                await targetMember.timeout(durationMs, reason);
                await message.reply(`🔇 **${targetMember.user.tag}** has been muted for **${afterMention[0]}**.${reason !== `Timed out by ${message.author.tag}` ? `\nReason: ${reason}` : ''}`);
            } catch (error) {
                console.error('[LegacyCommands] Mute failed:', error);
                await message.reply('❌ Mute failed, sir.');
            }

            return true;
        }
    },

    unmute: {
        description: 'Remove timeout from a member',
        usage: '*j unmute @user',
        aliases: ['untimeout'],
        execute: async (message, args) => {
            if (!message.guild) {
                await message.reply('This command only works in servers, sir.');
                return true;
            }

            const authorMember = message.member;
            if (!authorMember?.permissions?.has(PermissionFlagsBits.ModerateMembers)) {
                await message.reply('🔒 You need **Timeout Members** permission to do that, sir.');
                return true;
            }

            const mentionedUser = message.mentions.users.first();
            if (!mentionedUser) {
                await message.reply('Usage: `*j unmute @user`');
                return true;
            }

            const targetMember = message.mentions.members.first() ||
                (await message.guild.members.fetch(mentionedUser.id).catch(() => null));

            if (!targetMember) {
                await message.reply('Could not find that member in this server, sir.');
                return true;
            }

            try {
                await targetMember.timeout(null, `Unmuted by ${message.author.tag}`);
                await message.reply(`🔊 **${targetMember.user.tag}** has been unmuted.`);
            } catch (error) {
                console.error('[LegacyCommands] Unmute failed:', error);
                await message.reply('❌ Unmute failed, sir.');
            }

            return true;
        }
    },

    warn: {
        description: 'Warn a member (stored in memory)',
        usage: '*j warn @user <reason>',
        execute: async (message, args) => {
            if (!message.guild) {
                await message.reply('This command only works in servers, sir.');
                return true;
            }

            const authorMember = message.member;
            if (!authorMember?.permissions?.has(PermissionFlagsBits.ModerateMembers)) {
                await message.reply('🔒 You need **Timeout Members** permission to do that, sir.');
                return true;
            }

            const mentionedUser = message.mentions.users.first();
            if (!mentionedUser) {
                await message.reply('Usage: `*j warn @user <reason>`');
                return true;
            }

            const mentionIndex = args.findIndex(token => /^<@!?\d+>$/.test(token));
            const reason = mentionIndex >= 0
                ? args.slice(mentionIndex + 1).join(' ').trim()
                : args.slice(1).join(' ').trim();

            if (!reason) {
                await message.reply('Please provide a reason for the warning.');
                return true;
            }

            // Store warning (in-memory for now, but you can add DB persistence later)
            const guildId = message.guild.id;
            const userId = mentionedUser.id;

            if (!global.jarvisWarnings) {
                global.jarvisWarnings = new Map();
            }
            if (!global.jarvisWarnings.has(guildId)) {
                global.jarvisWarnings.set(guildId, new Map());
            }

            const guildWarnings = global.jarvisWarnings.get(guildId);
            const userWarnings = guildWarnings.get(userId) || [];
            userWarnings.push({
                reason,
                warnedBy: message.author.id,
                timestamp: Date.now()
            });
            guildWarnings.set(userId, userWarnings);

            const embed = new EmbedBuilder()
                .setTitle('⚠️ Warning Issued')
                .setColor(0xf39c12)
                .setDescription(`**${mentionedUser.tag}** has been warned.`)
                .addFields(
                    { name: 'Reason', value: reason, inline: false },
                    { name: 'Total Warnings', value: `${userWarnings.length}`, inline: true }
                )
                .setFooter({ text: `Warned by ${message.author.tag}` })
                .setTimestamp();

            await message.reply({ embeds: [embed] });

            // DM the user
            try {
                await mentionedUser.send(`⚠️ You have been warned in **${message.guild.name}**\nReason: ${reason}\nTotal warnings: ${userWarnings.length}`);
            } catch {
                // Can't DM user
            }

            return true;
        }
    },

    warnings: {
        description: 'View warnings for a member',
        usage: '*j warnings @user',
        aliases: ['warns'],
        execute: async (message, args) => {
            if (!message.guild) {
                await message.reply('This command only works in servers, sir.');
                return true;
            }

            const mentionedUser = message.mentions.users.first() || message.author;
            const guildId = message.guild.id;
            const userId = mentionedUser.id;

            const guildWarnings = global.jarvisWarnings?.get(guildId);
            const userWarnings = guildWarnings?.get(userId) || [];

            if (userWarnings.length === 0) {
                await message.reply(`**${mentionedUser.tag}** has no warnings. Clean record! ✨`);
                return true;
            }

            const warningList = userWarnings.slice(-10).map((w, i) =>
                `**${i + 1}.** ${w.reason} - <t:${Math.floor(w.timestamp / 1000)}:R>`
            ).join('\n');

            const embed = new EmbedBuilder()
                .setTitle(`⚠️ Warnings for ${mentionedUser.tag}`)
                .setColor(0xf39c12)
                .setDescription(warningList)
                .setFooter({ text: `Total: ${userWarnings.length} warning(s)` });

            await message.reply({ embeds: [embed] });
            return true;
        }
    },

    clearwarnings: {
        description: 'Clear warnings for a member',
        usage: '*j clearwarnings @user',
        aliases: ['clearwarns'],
        execute: async (message, args) => {
            if (!message.guild) {
                await message.reply('This command only works in servers, sir.');
                return true;
            }

            const authorMember = message.member;
            if (!authorMember?.permissions?.has(PermissionFlagsBits.ModerateMembers)) {
                await message.reply('🔒 You need **Timeout Members** permission to do that, sir.');
                return true;
            }

            const mentionedUser = message.mentions.users.first();
            if (!mentionedUser) {
                await message.reply('Usage: `*j clearwarnings @user`');
                return true;
            }

            const guildId = message.guild.id;
            const userId = mentionedUser.id;

            const guildWarnings = global.jarvisWarnings?.get(guildId);
            if (guildWarnings) {
                guildWarnings.delete(userId);
            }

            await message.reply(`✅ Cleared all warnings for **${mentionedUser.tag}**.`);
            return true;
        }
    },

    purge: {
        description: 'Delete multiple messages at once',
        usage: '*j purge <amount> [@user]',
        aliases: ['clear', 'prune', 'clean'],
        execute: async (message, args) => {
            if (!message.guild) {
                await message.reply('This command only works in servers, sir.');
                return true;
            }

            const authorMember = message.member;
            if (!authorMember?.permissions?.has(PermissionFlagsBits.ManageMessages)) {
                await message.reply('🔒 You need **Manage Messages** permission to do that, sir.');
                return true;
            }

            const amount = parseInt(args[0], 10);
            if (isNaN(amount) || amount < 1 || amount > 100) {
                await message.reply('Please specify a number between 1 and 100. Usage: `*j purge 50`');
                return true;
            }

            const targetUser = message.mentions.users.first();

            try {
                // Delete the command message first
                await message.delete().catch(() => { });

                let deleted;
                if (targetUser) {
                    // Fetch messages and filter by user
                    const messages = await message.channel.messages.fetch({ limit: 100 });
                    const userMessages = messages.filter(m => m.author.id === targetUser.id).first(amount);
                    deleted = await message.channel.bulkDelete(userMessages, true);
                } else {
                    deleted = await message.channel.bulkDelete(amount, true);
                }

                const response = await message.channel.send(
                    `🧹 Deleted **${deleted.size}** message(s)${targetUser ? ` from ${targetUser.tag}` : ''}.`
                );

                // Auto-delete response after 3 seconds
                setTimeout(() => response.delete().catch(() => { }), 3000);
            } catch (error) {
                await message.channel.send(`❌ Failed to delete messages: ${error.message}`);
            }
            return true;
        }
    },

    strike: {
        description: 'Issue a strike (escalating punishment)',
        usage: '*j strike @user <reason>',
        aliases: ['str'],
        execute: async (message, args) => {
            if (!message.guild) {
                await message.reply('This command only works in servers, sir.');
                return true;
            }

            const authorMember = message.member;
            if (!authorMember?.permissions?.has(PermissionFlagsBits.ModerateMembers)) {
                await message.reply('🔒 You need **Timeout Members** permission to do that, sir.');
                return true;
            }

            const mentionedUser = message.mentions.users.first();
            if (!mentionedUser) {
                await message.reply('Usage: `*j strike @user <reason>`');
                return true;
            }

            const reason = args.slice(1).join(' ') || 'No reason provided';
            const guildId = message.guild.id;
            const userId = mentionedUser.id;

            // Initialize strike storage
            if (!global.jarvisStrikes) global.jarvisStrikes = new Map();
            if (!global.jarvisStrikes.has(guildId)) global.jarvisStrikes.set(guildId, new Map());

            const guildStrikes = global.jarvisStrikes.get(guildId);
            const userStrikes = guildStrikes.get(userId) || [];
            userStrikes.push({ reason, issuedBy: message.author.id, timestamp: Date.now() });
            guildStrikes.set(userId, userStrikes);

            const strikeCount = userStrikes.length;

            // Escalation actions
            let action = 'warning';
            let actionTaken = '';
            const targetMember = await message.guild.members.fetch(userId).catch(() => null);

            // Strike escalation policy (like Sapphire)
            if (strikeCount >= 5 && targetMember?.bannable) {
                // 5+ strikes = ban
                await targetMember.ban({ reason: `Strike ${strikeCount}: ${reason}` });
                action = 'ban';
                actionTaken = '🔨 **BANNED** (5 strikes reached)';
            } else if (strikeCount >= 3 && targetMember?.moderatable) {
                // 3-4 strikes = 24 hour mute
                await targetMember.timeout(24 * 60 * 60 * 1000, `Strike ${strikeCount}: ${reason}`);
                action = 'mute';
                actionTaken = '🔇 **24h MUTE** (3+ strikes)';
            } else if (strikeCount >= 2 && targetMember?.moderatable) {
                // 2 strikes = 1 hour mute
                await targetMember.timeout(60 * 60 * 1000, `Strike ${strikeCount}: ${reason}`);
                action = 'mute';
                actionTaken = '🔇 **1h MUTE** (2 strikes)';
            }

            // Build embed
            const embed = new EmbedBuilder()
                .setTitle('⚡ Strike Issued')
                .setColor(strikeCount >= 5 ? 0xe74c3c : strikeCount >= 3 ? 0xe67e22 : 0xf1c40f)
                .setDescription(`**${mentionedUser.tag}** has received a strike.`)
                .addFields(
                    { name: 'Reason', value: reason, inline: false },
                    { name: 'Strike Count', value: `${strikeCount}/5`, inline: true },
                    { name: 'Action', value: actionTaken || '⚠️ Warning only', inline: true }
                )
                .setFooter({ text: `Issued by ${message.author.tag}` })
                .setTimestamp();

            // DM user about strike
            try {
                await mentionedUser.send({
                    embeds: [new EmbedBuilder()
                        .setTitle(`⚡ Strike Received in ${message.guild.name}`)
                        .setColor(0xe74c3c)
                        .setDescription(`You have received strike #${strikeCount}`)
                        .addFields(
                            { name: 'Reason', value: reason, inline: false },
                            { name: 'Action', value: actionTaken || 'Warning - behavior noted', inline: false }
                        )
                        .setFooter({ text: `${5 - strikeCount} strike(s) until permanent ban` })
                    ]
                });
            } catch { }

            await message.reply({ embeds: [embed] });
            return true;
        }
    },

    strikes: {
        description: 'View strikes for a member',
        usage: '*j strikes [@user]',
        execute: async (message, args) => {
            if (!message.guild) {
                await message.reply('This command only works in servers, sir.');
                return true;
            }

            const mentionedUser = message.mentions.users.first() || message.author;
            const guildId = message.guild.id;
            const userId = mentionedUser.id;

            const guildStrikes = global.jarvisStrikes?.get(guildId);
            const userStrikes = guildStrikes?.get(userId) || [];

            if (userStrikes.length === 0) {
                await message.reply(`**${mentionedUser.tag}** has no strikes. Clean record! ✨`);
                return true;
            }

            const strikeList = userStrikes.slice(-10).map((s, i) =>
                `**Strike ${i + 1}.** ${s.reason} - <t:${Math.floor(s.timestamp / 1000)}:R>`
            ).join('\n');

            const embed = new EmbedBuilder()
                .setTitle(`⚡ Strikes for ${mentionedUser.tag}`)
                .setColor(userStrikes.length >= 3 ? 0xe74c3c : 0xf1c40f)
                .setDescription(strikeList)
                .setFooter({ text: `Total: ${userStrikes.length}/5 strikes` });

            await message.reply({ embeds: [embed] });
            return true;
        }
    },

    clearstrikes: {
        description: 'Clear strikes for a member',
        usage: '*j clearstrikes @user',
        execute: async (message, args) => {
            if (!message.guild) {
                await message.reply('This command only works in servers, sir.');
                return true;
            }

            const authorMember = message.member;
            if (!authorMember?.permissions?.has(PermissionFlagsBits.ModerateMembers)) {
                await message.reply('🔒 You need **Timeout Members** permission to do that, sir.');
                return true;
            }

            const mentionedUser = message.mentions.users.first();
            if (!mentionedUser) {
                await message.reply('Usage: `*j clearstrikes @user`');
                return true;
            }

            const guildId = message.guild.id;
            const userId = mentionedUser.id;

            const guildStrikes = global.jarvisStrikes?.get(guildId);
            if (guildStrikes) {
                guildStrikes.delete(userId);
            }

            await message.reply(`✅ Cleared all strikes for **${mentionedUser.tag}**.`);
            return true;
        }
    },

    enable: {
        description: 'Enable a feature (moderation)',
        usage: '*j enable moderation',
        execute: async (message, args) => {
            // Only works in guilds
            if (!message.guild) {
                await message.reply('This command only works in servers, sir.');
                return true;
            }

            // Check permissions - must be admin or owner
            const isOwner = message.guild.ownerId === message.author.id;
            const isAdmin = message.member?.permissions?.has(PermissionFlagsBits.Administrator);

            if (!isOwner && !isAdmin) {
                await message.reply(
                    '🔒 This command requires Administrator permissions or Server Owner status.'
                );
                return true;
            }

            const feature = (args[0] || '').toLowerCase();

            if (feature !== 'moderation') {
                await message.reply(
                    '**Usage:** `*j enable moderation`\n\nAvailable features: `moderation`'
                );
                return true;
            }

            // Check if guild is allowed
            if (!moderation.canEnableModeration(message.guild.id)) {
                await message.reply(
                    '❌ This server is not authorized to enable moderation features.\n\nContact the bot developer for access.'
                );
                return true;
            }

            // Enable moderation
            const result = moderation.enableModeration(message.guild.id, message.author.id);

            if (result.success) {
                const embed = new EmbedBuilder()
                    .setTitle('✅ Moderation Enabled')
                    .setColor(0x2ecc71)
                    .setDescription('Moderation features are now **enabled** for this server.')
                    .addFields(
                        {
                            name: '🛡️ Features Activated',
                            value: '• New account detection\n• Alt account warnings\n• Spam pattern detection\n• Bot-like username flags\n• Suspicious avatar alerts',
                            inline: false
                        },
                        {
                            name: '📢 Alerts',
                            value: 'Suspicious members will be reported to the server owner via DM.',
                            inline: false
                        },
                        {
                            name: '⚙️ Configure',
                            value: 'Use `*j moderation settings` to customize (coming soon)',
                            inline: false
                        }
                    )
                    .setFooter({ text: `Enabled by ${message.author.tag}` })
                    .setTimestamp();

                await message.reply({ embeds: [embed] });
            } else {
                await message.reply(`❌ Failed to enable moderation: ${result.error}`);
            }

            return true;
        }
    },

    disable: {
        description: 'Disable a feature (moderation)',
        usage: '*j disable moderation',
        execute: async (message, args) => {
            // Only works in guilds
            if (!message.guild) {
                await message.reply('This command only works in servers, sir.');
                return true;
            }

            // Check permissions - must be admin or owner
            const isOwner = message.guild.ownerId === message.author.id;
            const isAdmin = message.member?.permissions?.has(PermissionFlagsBits.Administrator);

            if (!isOwner && !isAdmin) {
                await message.reply(
                    '🔒 This command requires Administrator permissions or Server Owner status.'
                );
                return true;
            }

            const feature = (args[0] || '').toLowerCase();

            if (feature !== 'moderation') {
                await message.reply(
                    '**Usage:** `*j disable moderation`\n\nAvailable features: `moderation`'
                );
                return true;
            }

            // Disable moderation
            const result = moderation.disableModeration(message.guild.id, message.author.id);

            if (result.success) {
                const embed = new EmbedBuilder()
                    .setTitle('❌ Moderation Disabled')
                    .setColor(0xe74c3c)
                    .setDescription('Moderation features are now **disabled** for this server.')
                    .addFields({
                        name: '🔇 Alerts Stopped',
                        value: 'New member alerts will no longer be sent.',
                        inline: false
                    })
                    .setFooter({ text: `Disabled by ${message.author.tag}` })
                    .setTimestamp();

                await message.reply({ embeds: [embed] });
            } else {
                await message.reply(`❌ ${result.error}`);
            }

            return true;
        }
    },

    moderation: {
        description: 'View moderation status and settings',
        usage: '*j moderation [status|settings]',
        aliases: ['mod'],
        execute: async (message, args) => {
            // Only works in guilds
            if (!message.guild) {
                await message.reply('This command only works in servers, sir.');
                return true;
            }

            const subcommand = (args[0] || 'status').toLowerCase();
            const status = moderation.getStatus(message.guild.id);

            if (subcommand === 'status' || subcommand === 'info') {
                const embed = new EmbedBuilder()
                    .setTitle('🛡️ Moderation Status')
                    .setColor(status.isEnabled ? 0x2ecc71 : 0x95a5a6)
                    .addFields(
                        {
                            name: 'Status',
                            value: status.isEnabled ? '✅ **Enabled**' : '❌ **Disabled**',
                            inline: true
                        },
                        {
                            name: 'Authorized',
                            value: status.canEnable ? '✅ Yes' : '❌ No',
                            inline: true
                        }
                    );

                if (status.isEnabled && status.enabledBy) {
                    embed.addFields({
                        name: 'Enabled By',
                        value: `<@${status.enabledBy}> on ${new Date(status.enabledAt).toLocaleDateString()}`,
                        inline: false
                    });
                }

                if (!status.canEnable) {
                    embed.addFields({
                        name: '⚠️ Not Authorized',
                        value: 'This server is not on the whitelist for moderation features.',
                        inline: false
                    });
                }

                await message.reply({ embeds: [embed] });
            } else if (subcommand === 'settings') {
                if (!status.isEnabled) {
                    await message.reply(
                        'Moderation is not enabled. Use `*j enable moderation` first.'
                    );
                    return true;
                }

                const s = status.settings;
                const pingRoles =
                    s.pingRoles?.length > 0 ? s.pingRoles.map(r => `<@&${r}>`).join(', ') : 'None';
                const pingUsers =
                    s.pingUsers?.length > 0 ? s.pingUsers.map(u => `<@${u}>`).join(', ') : 'None';

                const embed = new EmbedBuilder()
                    .setTitle('⚙️ Moderation Settings')
                    .setColor(0x3498db)
                    .addFields(
                        {
                            name: '🤖 AI Detection',
                            value: `Enabled: ${s.useAI ? '✅' : '❌'}\nProvider: ${s.aiProvider || 'openai'}\nOllama: ${s.ollamaModel || 'llava'}`,
                            inline: true
                        },
                        {
                            name: '👤 New Member Monitoring',
                            value: `Monitor New: ${s.monitorNewMembers ? '✅' : '❌'}\nThreshold: <${s.newMemberThresholdDays} days\nDuration: ${s.monitorDurationHours}h`,
                            inline: true
                        },
                        {
                            name: '📢 Notifications',
                            value: `Ping Owner: ${s.pingOwner ? '✅' : '❌'}\nLog Channel: ${s.logChannel ? `<#${s.logChannel}>` : 'DM Owner'}`,
                            inline: true
                        },
                        { name: '🔔 Ping Roles', value: pingRoles, inline: true },
                        { name: '🔔 Ping Users', value: pingUsers, inline: true },
                        {
                            name: '⚡ Tracked Members',
                            value: `${status.trackedMembersCount || 0} active`,
                            inline: true
                        }
                    )
                    .setFooter({ text: 'Use *j moderation pingrole/pinguser to configure' });

                await message.reply({ embeds: [embed] });
            } else if (subcommand === 'pingrole') {
                // *j moderation pingrole @role
                const role = message.mentions.roles.first();
                if (!role) {
                    await message.reply(
                        '**Usage:** `*j moderation pingrole @role`\nMention a role to add/remove from ping list.'
                    );
                    return true;
                }

                const s = status.settings;
                const pingRoles = s.pingRoles || [];

                if (pingRoles.includes(role.id)) {
                    // Remove
                    const newRoles = pingRoles.filter(r => r !== role.id);
                    moderation.updateSettings(message.guild.id, { pingRoles: newRoles });
                    await message.reply(`✅ Removed <@&${role.id}> from moderation ping list.`);
                } else {
                    // Add
                    pingRoles.push(role.id);
                    moderation.updateSettings(message.guild.id, { pingRoles });
                    await message.reply(`✅ Added <@&${role.id}> to moderation ping list.`);
                }
            } else if (subcommand === 'pinguser') {
                // *j moderation pinguser @user
                const user = message.mentions.users.first();
                if (!user) {
                    await message.reply(
                        '**Usage:** `*j moderation pinguser @user`\nMention a user to add/remove from ping list.'
                    );
                    return true;
                }

                const s = status.settings;
                const pingUsers = s.pingUsers || [];

                if (pingUsers.includes(user.id)) {
                    // Remove
                    const newUsers = pingUsers.filter(u => u !== user.id);
                    moderation.updateSettings(message.guild.id, { pingUsers: newUsers });
                    await message.reply(`✅ Removed <@${user.id}> from moderation ping list.`);
                } else {
                    // Add
                    pingUsers.push(user.id);
                    moderation.updateSettings(message.guild.id, { pingUsers });
                    await message.reply(`✅ Added <@${user.id}> to moderation ping list.`);
                }
            } else if (subcommand === 'logchannel') {
                // *j moderation logchannel #channel
                const channel = message.mentions.channels.first();
                if (!channel) {
                    await message.reply(
                        '**Usage:** `*j moderation logchannel #channel`\nMention a channel for moderation logs. Use `*j moderation logchannel clear` to DM owner instead.'
                    );
                    return true;
                }

                moderation.updateSettings(message.guild.id, { logChannel: channel.id });
                await message.reply(`✅ Moderation logs will be sent to <#${channel.id}>.`);
            } else if (
                args[0]?.toLowerCase() === 'logchannel' &&
                args[1]?.toLowerCase() === 'clear'
            ) {
                moderation.updateSettings(message.guild.id, { logChannel: null });
                await message.reply('✅ Moderation logs will be sent to the server owner via DM.');
            } else if (subcommand === 'whitelist') {
                // *j moderation whitelist @role/@user
                const role = message.mentions.roles.first();
                const user = message.mentions.users.first();

                if (!role && !user) {
                    const s = status.settings;
                    const wlRoles =
                        s.whitelistRoles?.length > 0
                            ? s.whitelistRoles.map(r => `<@&${r}>`).join(', ')
                            : 'None';
                    const wlUsers =
                        s.whitelistUsers?.length > 0
                            ? s.whitelistUsers.map(u => `<@${u}>`).join(', ')
                            : 'None';
                    await message.reply(
                        `**Whitelist (bypasses moderation):**\n**Roles:** ${wlRoles}\n**Users:** ${wlUsers}\n\nUse \`*j moderation whitelist @role\` or \`*j moderation whitelist @user\` to add/remove.`
                    );
                    return true;
                }

                const s = status.settings;

                if (role) {
                    const whitelistRoles = s.whitelistRoles || [];
                    if (whitelistRoles.includes(role.id)) {
                        const newRoles = whitelistRoles.filter(r => r !== role.id);
                        moderation.updateSettings(message.guild.id, { whitelistRoles: newRoles });
                        await message.reply(`✅ Removed <@&${role.id}> from whitelist.`);
                    } else {
                        whitelistRoles.push(role.id);
                        moderation.updateSettings(message.guild.id, { whitelistRoles });
                        await message.reply(`✅ Added <@&${role.id}> to whitelist.`);
                    }
                } else if (user) {
                    const whitelistUsers = s.whitelistUsers || [];
                    if (whitelistUsers.includes(user.id)) {
                        const newUsers = whitelistUsers.filter(u => u !== user.id);
                        moderation.updateSettings(message.guild.id, { whitelistUsers: newUsers });
                        await message.reply(`✅ Removed <@${user.id}> from whitelist.`);
                    } else {
                        whitelistUsers.push(user.id);
                        moderation.updateSettings(message.guild.id, { whitelistUsers });
                        await message.reply(`✅ Added <@${user.id}> to whitelist.`);
                    }
                }
            } else if (subcommand === 'stats') {
                const stats = status.stats || { total: 0, byCategory: {}, byUser: {} };
                const catText =
                    Object.entries(stats.byCategory)
                        .map(([k, v]) => `${k}: ${v}`)
                        .join('\n') || 'None';
                const topUsers =
                    Object.entries(stats.byUser)
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 5)
                        .map(([id, count]) => `<@${id}>: ${count}`)
                        .join('\n') || 'None';

                const embed = new EmbedBuilder()
                    .setTitle('📊 Moderation Statistics')
                    .setColor(0x3498db)
                    .addFields(
                        { name: '🔢 Total Detections', value: String(stats.total), inline: true },
                        { name: '📁 By Category', value: catText, inline: true },
                        { name: '👤 Top Flagged Users', value: topUsers, inline: false }
                    );
                await message.reply({ embeds: [embed] });
            } else {
                await message.reply(
                    '**Usage:**\n`*j moderation status` - View status\n`*j moderation settings` - View settings\n`*j moderation stats` - View statistics\n`*j moderation pingrole @role` - Add/remove ping role\n`*j moderation pinguser @user` - Add/remove ping user\n`*j moderation whitelist` - View/manage whitelist\n`*j moderation logchannel #channel` - Set log channel'
                );
            }

            return true;
        }
    },

    // ============ NEW ECONOMY COMMANDS ============

    // Hunt command
    hunt: {
        description: 'Hunt for animals in the wild',
        usage: '*j hunt',
        execute: async (message, args) => {
            const result = await starkEconomy.hunt(message.author.id, message.author.username);

            if (!result.success) {
                const seconds = Math.ceil(result.cooldown / 1000);
                await message.reply(`🏹 You're still tracking your last prey! Wait ${seconds}s.`);
                return true;
            }

            const huntMessages = [
                `You ventured into the wilderness and found a ${result.item}!`,
                `After hours of tracking, you caught a ${result.item}!`,
                `The hunt was successful! You bagged a ${result.item}!`,
                `You spotted and captured a ${result.item} in the forest!`,
                `A wild ${result.item} appeared! You caught it!`
            ];

            const msg = huntMessages[Math.floor(Math.random() * huntMessages.length)];
            const embed = new EmbedBuilder()
                .setTitle('🏹 Hunt Complete!')
                .setDescription(`${msg}\n\n**Reward:** ${result.reward} Stark Bucks`)
                .setColor(result.reward > 50 ? 0x2ecc71 : 0x95a5a6)
                .addFields({ name: '💰 Balance', value: `${result.newBalance}`, inline: true });

            await message.reply({ embeds: [embed] });
            return true;
        }
    },

    // Fish command
    fish: {
        description: 'Go fishing for sea creatures',
        usage: '*j fish',
        execute: async (message, args) => {
            const result = await starkEconomy.fish(message.author.id, message.author.username);

            if (!result.success) {
                const seconds = Math.ceil(result.cooldown / 1000);
                await message.reply(`🎣 Your line is still in the water! Wait ${seconds}s.`);
                return true;
            }

            const fishMessages = [
                `You reeled in a ${result.item}!`,
                `After patient waiting, you caught a ${result.item}!`,
                `Something's biting! It's a ${result.item}!`,
                `The ocean blessed you with a ${result.item}!`,
                `Splash! You pulled out a ${result.item}!`
            ];

            const msg = fishMessages[Math.floor(Math.random() * fishMessages.length)];
            const embed = new EmbedBuilder()
                .setTitle('🎣 Fishing Complete!')
                .setDescription(`${msg}\n\n**Reward:** ${result.reward} Stark Bucks`)
                .setColor(result.reward > 50 ? 0x3498db : 0x95a5a6)
                .addFields({ name: '💰 Balance', value: `${result.newBalance}`, inline: true });

            await message.reply({ embeds: [embed] });
            return true;
        }
    },

    // Dig command
    dig: {
        description: 'Dig for treasure and artifacts',
        usage: '*j dig',
        execute: async (message, args) => {
            const result = await starkEconomy.dig(message.author.id, message.author.username);

            if (!result.success) {
                const seconds = Math.ceil(result.cooldown / 1000);
                await message.reply(`⛏️ Your shovel is still stuck! Wait ${seconds}s.`);
                return true;
            }

            const digMessages = [
                `You dug up a ${result.item}!`,
                `After some digging, you found a ${result.item}!`,
                `The earth revealed a ${result.item}!`,
                `You struck ${result.item}!`,
                `Buried treasure! You found a ${result.item}!`
            ];

            const msg = digMessages[Math.floor(Math.random() * digMessages.length)];
            const embed = new EmbedBuilder()
                .setTitle('⛏️ Dig Complete!')
                .setDescription(`${msg}\n\n**Reward:** ${result.reward} Stark Bucks`)
                .setColor(result.reward > 100 ? 0xf1c40f : 0x95a5a6)
                .addFields({ name: '💰 Balance', value: `${result.newBalance}`, inline: true });

            await message.reply({ embeds: [embed] });
            return true;
        }
    },

    // Beg command
    beg: {
        description: 'Beg for money from Marvel characters',
        usage: '*j beg',
        execute: async (message, args) => {
            const result = await starkEconomy.beg(message.author.id, message.author.username);

            if (!result.success) {
                const seconds = Math.ceil(result.cooldown / 1000);
                await message.reply(`🙏 Have some dignity! Wait ${seconds}s before begging again.`);
                return true;
            }

            const embed = new EmbedBuilder()
                .setTitle('🙏 Begging Results')
                .setDescription(`${result.message} **${result.reward}** Stark Bucks!`)
                .setColor(result.reward > 0 ? 0x2ecc71 : 0xe74c3c)
                .addFields({ name: '💰 Balance', value: `${result.newBalance}`, inline: true });

            await message.reply({ embeds: [embed] });
            return true;
        }
    },

    // Inventory command
    inventory: {
        description: 'View your inventory',
        usage: '*j inventory',
        aliases: ['inv', 'items'],
        execute: async (message, args) => {
            const inventory = await starkEconomy.getInventory(message.author.id);
            const hasReactor = await starkEconomy.hasArcReactor(message.author.id);

            if (!inventory.length) {
                await message.reply('Your inventory is empty, sir. Visit the shop with `*j shop`.');
                return true;
            }

            const itemList = inventory.map(item => {
                const uses = item.uses ? ` (${item.uses} uses)` : '';
                return `• ${item.name}${uses}`;
            }).join('\n');

            const embed = new EmbedBuilder()
                .setTitle(`🎒 ${message.author.username}'s Inventory`)
                .setDescription(itemList)
                .setColor(hasReactor ? 0x00d4ff : 0x9b59b6)
                .setFooter({ text: hasReactor ? '💠 Arc Reactor Owner - All perks active!' : 'Use *j buy <item> to get more items' });

            if (hasReactor) {
                embed.addFields({
                    name: '💠 Arc Reactor Perks',
                    value: '• +15% earnings\n• -25% cooldowns\n• +5% gambling luck\n• +500 daily bonus\n• +1% daily interest',
                    inline: false
                });
            }

            await message.reply({ embeds: [embed] });
            return true;
        }
    },

    // Tinker command (craft items)
    tinker: {
        description: 'Craft MCU items from materials',
        usage: '*j tinker [recipe]',
        aliases: ['craft'],
        execute: async (message, args) => {
            const recipeName = args.join('_').toLowerCase();

            if (!recipeName) {
                // Show available recipes and user's materials
                const materials = await starkEconomy.getMaterials(message.author.id);
                const materialCount = Object.keys(materials).length;
                const recipes = starkTinker.getAllRecipes().slice(0, 10);
                const recipeList = recipes.map(r =>
                    `**${r.name}** (${r.rarity})\n> ${Object.entries(r.ingredients).map(([k, v]) => `${v}x ${k}`).join(', ')}`
                ).join('\n');

                const embed = new EmbedBuilder()
                    .setTitle('🔧 Stark Industries Tinker Lab')
                    .setDescription(`Combine materials from minigames to craft MCU items!\n\n**Sample Recipes:**\n${recipeList}`)
                    .setColor(0xe74c3c)
                    .addFields(
                        { name: '📦 Your Materials', value: materialCount > 0 ? `${materialCount} types collected` : 'None yet - use `*j hunt/fish/dig`', inline: true },
                        { name: '📖 Total Recipes', value: `${starkTinker.getAllRecipes().length}`, inline: true }
                    )
                    .setFooter({ text: 'Use *j tinker <recipe_id> to craft • *j materials to view yours' });

                await message.reply({ embeds: [embed] });
                return true;
            }

            const recipe = starkTinker.getRecipe(recipeName);
            if (!recipe) {
                await message.reply(`❌ Unknown recipe: \`${recipeName}\`. Use \`*j recipes\` to see all recipes.`);
                return true;
            }

            // Attempt to craft
            const result = await starkEconomy.craftItem(message.author.id, recipeName, recipe);

            if (!result.success) {
                const materials = await starkEconomy.getMaterials(message.author.id);
                const missing = Object.entries(recipe.ingredients)
                    .filter(([mat, req]) => (materials[mat] || 0) < req)
                    .map(([mat, req]) => `${req - (materials[mat] || 0)}x ${mat}`)
                    .join(', ');

                await message.reply(`❌ **Cannot craft ${recipe.name}**\n\nMissing: ${missing}\n\nCollect materials with \`*j hunt\`, \`*j fish\`, \`*j dig\``);
                return true;
            }

            const rarityColors = { common: 0x95a5a6, uncommon: 0x2ecc71, rare: 0x3498db, epic: 0x9b59b6, legendary: 0xf1c40f };

            const embed = new EmbedBuilder()
                .setTitle('🔧 Item Crafted!')
                .setDescription(`You crafted **${result.item}**!\n\n${recipe.description}`)
                .setColor(rarityColors[result.rarity] || 0x95a5a6)
                .addFields(
                    { name: 'Rarity', value: result.rarity.toUpperCase(), inline: true },
                    { name: 'Value', value: `${result.value} 💵`, inline: true }
                )
                .setFooter({ text: 'Sell with *j sell <item_number> • View with *j inventory' });

            await message.reply({ embeds: [embed] });
            return true;
        }
    },

    // Materials command
    materials: {
        description: 'View your collected materials',
        usage: '*j materials',
        aliases: ['mats'],
        execute: async (message, args) => {
            const materials = await starkEconomy.getMaterials(message.author.id);
            const entries = Object.entries(materials);

            if (entries.length === 0) {
                await message.reply('📦 You have no materials yet!\n\nCollect them with `*j hunt`, `*j fish`, `*j dig`, `*j beg`');
                return true;
            }

            // Sort by quantity
            entries.sort((a, b) => b[1] - a[1]);
            const materialList = entries.slice(0, 25).map(([name, qty]) => `${name}: **${qty}**`).join('\n');

            const embed = new EmbedBuilder()
                .setTitle(`📦 ${message.author.username}'s Materials`)
                .setDescription(materialList + (entries.length > 25 ? `\n\n*...and ${entries.length - 25} more*` : ''))
                .setColor(0x3498db)
                .setFooter({ text: `${entries.length} material types • Use *j tinker to craft` });

            await message.reply({ embeds: [embed] });
            return true;
        }
    },

    // Sell command
    sell: {
        description: 'Sell a crafted item for coins',
        usage: '*j sell <item_number>',
        execute: async (message, args) => {
            const itemIndex = parseInt(args[0]) - 1; // 1-indexed for user

            if (isNaN(itemIndex) || itemIndex < 0) {
                await message.reply('Usage: `*j sell <item_number>`\n\nView your items with `*j inventory` first.');
                return true;
            }

            const result = await starkEconomy.sellItem(message.author.id, itemIndex);

            if (!result.success) {
                await message.reply(`❌ ${result.error}`);
                return true;
            }

            const embed = new EmbedBuilder()
                .setTitle('💰 Item Sold!')
                .setDescription(`You sold **${result.item}** for **${result.value}** Stark Bucks!`)
                .setColor(0x2ecc71)
                .addFields({ name: '💰 New Balance', value: `${result.newBalance}`, inline: true });

            await message.reply({ embeds: [embed] });
            return true;
        }
    },

    // Recipes command
    recipes: {
        description: 'View all tinker recipes',
        usage: '*j recipes [rarity]',
        execute: async (message, args) => {
            const rarity = args[0]?.toLowerCase() || 'all';
            let recipes;

            if (['common', 'uncommon', 'rare', 'epic', 'legendary'].includes(rarity)) {
                recipes = starkTinker.getRecipesByRarity(rarity);
            } else {
                recipes = starkTinker.getAllRecipes();
            }

            const recipeList = recipes.slice(0, 20).map(r =>
                `**${r.name}** - ${r.rarity} - ${r.value}💵`
            ).join('\n');

            const embed = new EmbedBuilder()
                .setTitle(`📜 Tinker Recipes (${recipes.length} total)`)
                .setDescription(recipeList + (recipes.length > 20 ? `\n\n*...and ${recipes.length - 20} more*` : ''))
                .setColor(0x9b59b6)
                .setFooter({ text: 'Filter: *j recipes common/uncommon/rare/epic/legendary' });

            await message.reply({ embeds: [embed] });
            return true;
        }
    },

    // Contract command (high-paying jobs)
    contract: {
        description: 'Take on a Stark Industries contract',
        usage: '*j contract',
        aliases: ['job', 'mission'],
        execute: async (message, args) => {
            const contract = starkTinker.getRandomContract();
            const reward = Math.floor(contract.reward.min + Math.random() * (contract.reward.max - contract.reward.min));

            // Apply Arc Reactor bonus
            const arcPerks = await starkEconomy.getArcReactorPerks(message.author.id);
            const finalReward = Math.floor(reward * arcPerks.earningsMultiplier);

            await starkEconomy.modifyBalance(message.author.id, finalReward, 'contract');

            const difficultyColors = { easy: 0x2ecc71, medium: 0xf1c40f, hard: 0xe74c3c };
            const difficultyEmoji = { easy: '🟢', medium: '🟡', hard: '🔴' };

            const embed = new EmbedBuilder()
                .setTitle('📋 Contract Complete!')
                .setDescription(`**${contract.name}**\n\nYou earned **${finalReward}** Stark Bucks!${arcPerks.hasReactor ? ' *(+15% Arc Reactor bonus)*' : ''}`)
                .setColor(difficultyColors[contract.difficulty])
                .addFields(
                    { name: 'Difficulty', value: `${difficultyEmoji[contract.difficulty]} ${contract.difficulty.toUpperCase()}`, inline: true }
                )
                .setFooter({ text: 'Stark Industries appreciates your service' });

            await message.reply({ embeds: [embed] });
            return true;
        }
    },

    // Reactor command (show Arc Reactor status)
    reactor: {
        description: 'Check your Arc Reactor status',
        usage: '*j reactor',
        aliases: ['arcreactor', 'arc'],
        execute: async (message, args) => {
            const hasReactor = await starkEconomy.hasArcReactor(message.author.id);
            const stats = await starkEconomy.getUserStats(message.author.id);

            if (!hasReactor) {
                const embed = new EmbedBuilder()
                    .setTitle('💠 Arc Reactor')
                    .setDescription(`You don't own an Arc Reactor yet!\n\n**Price:** 10,000 Stark Bucks\n**Your Balance:** ${stats.balance}\n\nBuy it with \`*j buy arc_reactor\``)
                    .setColor(0x95a5a6)
                    .addFields({
                        name: '🔋 Perks You\'re Missing',
                        value: '• +15% on ALL earnings\n• -25% cooldown on ALL commands\n• +5% gambling win rate\n• +500 daily reward bonus\n• +1% daily interest on balance\n• 💠 Leaderboard badge',
                        inline: false
                    })
                    .setFooter({ text: 'The ultimate Stark Industries collector item' });

                await message.reply({ embeds: [embed] });
                return true;
            }

            const interest = Math.floor(stats.balance * 0.01);

            const embed = new EmbedBuilder()
                .setTitle('💠 Arc Reactor - ACTIVE')
                .setDescription(`*"Proof that Tony Stark has a heart"*\n\nYour Arc Reactor is powering all systems!`)
                .setColor(0x00d4ff)
                .addFields(
                    { name: '⚡ Power Surge', value: '+15% earnings on everything', inline: true },
                    { name: '⏱️ Efficiency', value: '-25% cooldowns', inline: true },
                    { name: '🎰 Stark Luck', value: '+5% gambling odds', inline: true },
                    { name: '🎁 Daily Bonus', value: '+500 coins', inline: true },
                    { name: '💰 Daily Interest', value: `+${interest} coins (1% of ${stats.balance})`, inline: true },
                    { name: '💠 Status', value: 'Leaderboard badge active', inline: true }
                )
                .setFooter({ text: 'Arc Reactor technology by Stark Industries' });

            await message.reply({ embeds: [embed] });
            return true;
        }
    },

    // ============ MISSING ECONOMY COMMANDS (Bug Fixes) ============

    // Crime command
    crime: {
        description: 'Commit a crime (risky but high reward)',
        usage: '*j crime',
        aliases: ['steal', 'heist'],
        execute: async (message, args) => {
            const result = await starkEconomy.crime(message.author.id);

            if (!result.success) {
                const seconds = Math.ceil(result.cooldown / 1000);
                await message.reply(`🚨 Lay low for ${seconds}s before your next crime!`);
                return true;
            }

            const isPositive = result.reward > 0;
            const embed = new EmbedBuilder()
                .setTitle(isPositive ? '🦹 Crime Successful!' : '🚔 Busted!')
                .setDescription(`${result.outcome}\n\n**${isPositive ? 'Earned' : 'Lost'}:** ${Math.abs(result.reward)} Stark Bucks`)
                .setColor(isPositive ? 0x2ecc71 : 0xe74c3c)
                .addFields({ name: '💰 Balance', value: `${result.newBalance}`, inline: true });

            await message.reply({ embeds: [embed] });
            return true;
        }
    },

    // Post meme command
    postmeme: {
        description: 'Post a meme for money',
        usage: '*j postmeme',
        aliases: ['meme', 'post'],
        execute: async (message, args) => {
            const result = await starkEconomy.postmeme(message.author.id);

            if (!result.success) {
                const seconds = Math.ceil(result.cooldown / 1000);
                await message.reply(`📱 Wait ${seconds}s before posting again!`);
                return true;
            }

            const isPositive = result.reward > 0;
            const embed = new EmbedBuilder()
                .setTitle('📱 Meme Posted!')
                .setDescription(`${result.outcome}\n\n**Earned:** ${result.reward} Stark Bucks`)
                .setColor(result.reward > 100 ? 0x2ecc71 : result.reward > 0 ? 0x3498db : 0xe74c3c)
                .addFields({ name: '💰 Balance', value: `${result.newBalance}`, inline: true });

            await message.reply({ embeds: [embed] });
            return true;
        }
    },

    // Search command
    search: {
        description: 'Search a location for money',
        usage: '*j search',
        execute: async (message, args) => {
            const result = await starkEconomy.search(message.author.id);

            if (!result.success) {
                const seconds = Math.ceil(result.cooldown / 1000);
                await message.reply(`🔍 Wait ${seconds}s before searching again!`);
                return true;
            }

            const isPositive = result.reward > 0;
            const embed = new EmbedBuilder()
                .setTitle('🔍 Search Complete!')
                .setDescription(`You searched **${result.location}**...\n\n${result.outcome}`)
                .setColor(isPositive ? 0x2ecc71 : result.reward < 0 ? 0xe74c3c : 0x95a5a6)
                .addFields(
                    { name: isPositive ? '💰 Found' : result.reward < 0 ? '💸 Lost' : '📦 Result', value: `${Math.abs(result.reward)} Stark Bucks`, inline: true },
                    { name: '💰 Balance', value: `${result.newBalance}`, inline: true }
                );

            await message.reply({ embeds: [embed] });
            return true;
        }
    },

    // Rob command
    rob: {
        description: 'Attempt to rob another user',
        usage: '*j rob @user',
        execute: async (message, args) => {
            const target = message.mentions.users.first();
            if (!target) {
                await message.reply('Usage: `*j rob @user`');
                return true;
            }

            if (target.id === message.author.id) {
                await message.reply("You can't rob yourself, sir.");
                return true;
            }

            if (target.bot) {
                await message.reply("You can't rob bots!");
                return true;
            }

            const result = await starkEconomy.rob(message.author.id, target.id, message.author.username);

            if (!result.success) {
                if (result.cooldown) {
                    const seconds = Math.ceil(result.cooldown / 1000);
                    await message.reply(`🚨 Lay low for ${seconds}s!`);
                } else {
                    await message.reply(`❌ ${result.error}`);
                }
                return true;
            }

            if (result.succeeded) {
                const embed = new EmbedBuilder()
                    .setTitle('💰 Robbery Successful!')
                    .setDescription(`You robbed **${result.stolen}** Stark Bucks from ${target}!`)
                    .setColor(0x2ecc71)
                    .addFields({ name: '💰 Your Balance', value: `${result.newBalance}`, inline: true });
                await message.reply({ embeds: [embed] });
            } else {
                const embed = new EmbedBuilder()
                    .setTitle('🚔 Robbery Failed!')
                    .setDescription(`You got caught and paid a **${result.fine}** Stark Bucks fine!`)
                    .setColor(0xe74c3c)
                    .addFields({ name: '💰 Your Balance', value: `${result.newBalance}`, inline: true });
                await message.reply({ embeds: [embed] });
            }
            return true;
        }
    },

    // Give/Transfer command
    give: {
        description: 'Give money to another user',
        usage: '*j give @user <amount>',
        aliases: ['transfer', 'send'],
        execute: async (message, args) => {
            const target = message.mentions.users.first();
            const amountStr = args.find(a => !a.startsWith('<@'));
            const amount = parseInt(amountStr);

            if (!target || !amount || amount < 1) {
                await message.reply('Usage: `*j give @user <amount>`');
                return true;
            }

            if (target.id === message.author.id) {
                await message.reply("You can't give money to yourself!");
                return true;
            }

            const result = await starkEconomy.give(
                message.author.id,
                target.id,
                amount,
                message.author.username,
                target.username
            );

            if (!result.success) {
                await message.reply(`❌ ${result.error}`);
                return true;
            }

            const embed = new EmbedBuilder()
                .setTitle('💸 Transfer Complete!')
                .setDescription(`You gave **${amount}** Stark Bucks to ${target}!`)
                .setColor(0x2ecc71)
                .addFields(
                    { name: 'Your Balance', value: `${result.fromBalance}`, inline: true },
                    { name: `${target.username}'s Balance`, value: `${result.toBalance}`, inline: true }
                );

            await message.reply({ embeds: [embed] });
            return true;
        }
    },

    // Blackjack command
    blackjack: {
        description: 'Play blackjack',
        usage: '*j blackjack <bet>',
        aliases: ['bj'],
        execute: async (message, args) => {
            const bet = parseInt(args[0]);

            if (!bet || bet < 10) {
                await message.reply('Usage: `*j blackjack <bet>` (minimum 10)');
                return true;
            }

            const stats = await starkEconomy.getUserStats(message.author.id);
            if (stats.balance < bet) {
                await message.reply('❌ Insufficient funds!');
                return true;
            }

            // Simple blackjack - draw cards
            const cards = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
            const suits = ['♠', '♥', '♦', '♣'];

            const drawCard = () => {
                const card = cards[Math.floor(Math.random() * cards.length)];
                const suit = suits[Math.floor(Math.random() * suits.length)];
                return { card, suit, display: `${card}${suit}` };
            };

            const getValue = (hand) => {
                let value = 0;
                let aces = 0;
                for (const c of hand) {
                    if (c.card === 'A') { aces++; value += 11; }
                    else if (['K', 'Q', 'J'].includes(c.card)) value += 10;
                    else value += parseInt(c.card);
                }
                while (value > 21 && aces > 0) { value -= 10; aces--; }
                return value;
            };

            // Draw initial hands
            const playerHand = [drawCard(), drawCard()];
            const dealerHand = [drawCard(), drawCard()];

            // Simple AI: dealer draws until 17+
            while (getValue(dealerHand) < 17) {
                dealerHand.push(drawCard());
            }

            // Player also auto-draws if under 17 (simplified)
            while (getValue(playerHand) < 17) {
                playerHand.push(drawCard());
            }

            const playerValue = getValue(playerHand);
            const dealerValue = getValue(dealerHand);

            let result, color, winnings;
            if (playerValue > 21) {
                result = 'BUST! You lose.';
                color = 0xe74c3c;
                winnings = -bet;
            } else if (dealerValue > 21) {
                result = 'Dealer busts! You win!';
                color = 0x2ecc71;
                winnings = bet;
            } else if (playerValue > dealerValue) {
                result = 'You win!';
                color = 0x2ecc71;
                winnings = bet;
            } else if (playerValue < dealerValue) {
                result = 'Dealer wins!';
                color = 0xe74c3c;
                winnings = -bet;
            } else {
                result = 'Push! Tie game.';
                color = 0xf1c40f;
                winnings = 0;
            }

            await starkEconomy.modifyBalance(message.author.id, winnings, 'blackjack');
            const newStats = await starkEconomy.getUserStats(message.author.id);

            const embed = new EmbedBuilder()
                .setTitle('🃏 Blackjack')
                .setColor(color)
                .addFields(
                    { name: `Your Hand (${playerValue})`, value: playerHand.map(c => c.display).join(' '), inline: true },
                    { name: `Dealer (${dealerValue})`, value: dealerHand.map(c => c.display).join(' '), inline: true },
                    { name: 'Result', value: `${result}\n${winnings >= 0 ? '+' : ''}${winnings} Stark Bucks`, inline: false },
                    { name: '💰 Balance', value: `${newStats.balance}`, inline: true }
                );

            await message.reply({ embeds: [embed] });
            return true;
        }
    },

    // ============ PROFILE & ACHIEVEMENTS (Improvements) ============

    // Profile command
    profile: {
        description: 'View your full profile',
        usage: '*j profile [@user]',
        aliases: ['me', 'stats'],
        execute: async (message, args) => {
            const target = message.mentions.users.first() || message.author;
            const stats = await starkEconomy.getUserStats(target.id);
            const achievementProfile = await achievements.getProfile(target.id);
            const hasReactor = await starkEconomy.hasArcReactor(target.id);

            const formatNum = (n) => {
                n = Math.floor(n);
                if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
                if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
                if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
                return n.toLocaleString();
            };

            // Try to find rank in top 100
            const client = message.client; // ensure client is available
            const lb = await starkEconomy.getLeaderboard(100, client);
            const rankIndex = lb.findIndex(u => u.userId === target.id);
            const rank = rankIndex !== -1 ? rankIndex + 1 : null;

            // Generate Profile Image
            const { AttachmentBuilder } = require('discord.js');
            const imageGenerator = require('./image-generator');

            const profileData = {
                username: target.username,
                avatar: target.displayAvatarURL({ extension: 'png', size: 256 }),
                balance: stats.balance,
                totalEarned: stats.totalEarned || 0,
                winRate: stats.winRate,
                rank: rank
            };

            try {
                const buffer = await imageGenerator.generateProfileImage(profileData);
                const attachment = new AttachmentBuilder(buffer, { name: 'profile.png' });
                await message.reply({ files: [attachment] });
            } catch (err) {
                console.error('[Profile] Image generation failed:', err);
                // Fallback to simpler text
                await message.reply(`**${target.username}'s Profile**\n💰 Balance: ${stats.balance.toLocaleString()}\n🏆 Win Rate: ${stats.winRate}%`);
            }

            if (hasReactor) {
                await message.channel.send('💠 **Arc Reactor Owner - All perks active!**');
            }
            return true;
        }
    },

    // Achievements command
    achievements: {
        description: 'View your achievements',
        usage: '*j achievements [category]',
        aliases: ['achieve', 'ach'],
        execute: async (message, args) => {
            const category = args[0] || null;
            const profile = await achievements.getProfile(message.author.id);

            if (category) {
                // Show specific category
                const userData = await achievements.getUserData(message.author.id);
                const categoryAchievements = achievements.getAchievementsByCategory(
                    category.charAt(0).toUpperCase() + category.slice(1).toLowerCase(),
                    userData
                );

                if (categoryAchievements.length === 0) {
                    await message.reply(`❌ Unknown category. Categories: ${achievements.getAllCategories().join(', ')}`);
                    return true;
                }

                const list = categoryAchievements.slice(0, 15).map(a =>
                    `${a.unlocked ? '✅' : '⬜'} ${a.emoji} **${a.name}** - ${a.description} (${a.points}pts)`
                ).join('\n');

                const embed = new EmbedBuilder()
                    .setTitle(`🏆 ${category} Achievements`)
                    .setDescription(list)
                    .setColor(0xf1c40f)
                    .setFooter({ text: `${categoryAchievements.filter(a => a.unlocked).length}/${categoryAchievements.length} unlocked` });

                await message.reply({ embeds: [embed] });
            } else {
                // Show overview
                const categoryList = Object.entries(profile.categories)
                    .map(([cat, data]) => `**${cat}**: ${data.unlocked}/${data.total}`)
                    .join('\n');

                const recentList = profile.recent.length > 0
                    ? profile.recent.map(a => `${a.emoji} ${a.name}`).join(', ')
                    : 'None yet';

                const embed = new EmbedBuilder()
                    .setTitle(`🏆 ${message.author.username}'s Achievements`)
                    .setColor(0xf1c40f)
                    .addFields(
                        { name: '📊 Progress', value: `${profile.unlockedCount}/${profile.totalCount} (${profile.percentage}%)`, inline: true },
                        { name: '⭐ Total Points', value: `${profile.totalPoints}`, inline: true },
                        { name: '🆕 Recent Unlocks', value: recentList, inline: false },
                        { name: '📁 By Category', value: categoryList, inline: false }
                    )
                    .setFooter({ text: 'Use *j achievements <category> to view specific achievements' });

                await message.reply({ embeds: [embed] });
            }
            return true;
        }
    },

    // ============ NEW FEATURE: Daily Challenges ============

    challenge: {
        description: 'View and complete daily challenges',
        usage: '*j challenge',
        aliases: ['challenges', 'daily_challenge'],
        execute: async (message, args) => {
            const userId = message.author.id;
            const challenges = await starkEconomy.getDailyChallenges(userId);

            const challengeList = challenges.map((c, i) => {
                const progress = Math.min(c.progress, c.target);
                const bar = '█'.repeat(Math.floor(progress / c.target * 10)) + '░'.repeat(10 - Math.floor(progress / c.target * 10));
                const status = c.completed ? '✅' : '⬜';
                return `${status} **${c.name}**\n${bar} ${progress}/${c.target} | Reward: ${c.reward} 💵`;
            }).join('\n\n');

            const completed = challenges.filter(c => c.completed).length;

            const embed = new EmbedBuilder()
                .setTitle('📋 Daily Challenges')
                .setDescription(challengeList || 'No challenges available!')
                .setColor(completed === challenges.length ? 0x2ecc71 : 0x3498db)
                .setFooter({ text: `${completed}/${challenges.length} completed • Resets at midnight UTC` });

            await message.reply({ embeds: [embed] });
            return true;
        }
    },

    // ============ NEW FEATURE: Prestige System ============

    prestige: {
        description: 'Prestige for permanent bonuses',
        usage: '*j prestige [confirm]',
        execute: async (message, args) => {
            const userId = message.author.id;
            const stats = await starkEconomy.getUserStats(userId);
            const prestigeData = await starkEconomy.getPrestigeData(userId);

            const requirement = 1000000 * (prestigeData.level + 1); // 1M * level
            const canPrestige = stats.totalEarned >= requirement;

            if (args[0] === 'confirm' && canPrestige) {
                const result = await starkEconomy.prestige(userId);

                const embed = new EmbedBuilder()
                    .setTitle('⭐ PRESTIGE COMPLETE!')
                    .setDescription(`You are now **Prestige ${result.newLevel}**!`)
                    .setColor(0xf1c40f)
                    .addFields(
                        { name: '🎁 Bonus Earned', value: `+${result.bonusPercent}% permanent earnings`, inline: true },
                        { name: '💰 Balance Reset', value: `${result.newBalance} Stark Bucks`, inline: true }
                    )
                    .setFooter({ text: 'Your prestige bonuses stack forever!' });

                await message.reply({ embeds: [embed] });
            } else {
                const embed = new EmbedBuilder()
                    .setTitle('⭐ Prestige System')
                    .setDescription(canPrestige
                        ? '**You can prestige!** Use `*j prestige confirm` to reset.\n\n⚠️ This will reset your balance but give permanent bonuses!'
                        : `You need **${(requirement - stats.totalEarned).toLocaleString()}** more total earnings to prestige.`)
                    .setColor(canPrestige ? 0x2ecc71 : 0x3498db)
                    .addFields(
                        { name: '📊 Current Prestige', value: `Level ${prestigeData.level}`, inline: true },
                        { name: '📈 Current Bonus', value: `+${prestigeData.bonus}%`, inline: true },
                        { name: '🎯 Next Requirement', value: `${requirement.toLocaleString()} total earned`, inline: true },
                        { name: '📊 Your Total Earned', value: `${stats.totalEarned.toLocaleString()}`, inline: true }
                    );

                await message.reply({ embeds: [embed] });
            }
            return true;
        }
    },

    // ============ NEW FEATURE: Pet System ============

    pet: {
        description: 'Manage your pet companion',
        usage: '*j pet [buy|feed|rename|stats]',
        aliases: ['pets'],
        execute: async (message, args) => {
            const userId = message.author.id;
            const subcommand = (args[0] || 'stats').toLowerCase();

            const petData = await starkEconomy.getPetData(userId);

            switch (subcommand) {
                case 'buy':
                case 'adopt': {
                    if (petData.hasPet) {
                        await message.reply('❌ You already have a pet! Use `*j pet stats` to see them.');
                        return true;
                    }

                    const petType = args[1] || 'random';
                    const result = await starkEconomy.buyPet(userId, petType);

                    if (!result.success) {
                        await message.reply(`❌ ${result.error}`);
                        return true;
                    }

                    const embed = new EmbedBuilder()
                        .setTitle('🐾 Pet Adopted!')
                        .setDescription(`You adopted a **${result.pet.emoji} ${result.pet.name}**!`)
                        .setColor(0x2ecc71)
                        .addFields(
                            { name: '💰 Cost', value: `${result.cost} Stark Bucks`, inline: true },
                            { name: '🎁 Bonus', value: result.pet.bonus, inline: true }
                        );
                    await message.reply({ embeds: [embed] });
                    break;
                }

                case 'feed': {
                    if (!petData.hasPet) {
                        await message.reply('❌ You don\'t have a pet! Use `*j pet buy` to adopt one.');
                        return true;
                    }

                    const result = await starkEconomy.feedPet(userId);

                    if (!result.success) {
                        await message.reply(`❌ ${result.error}`);
                        return true;
                    }

                    const embed = new EmbedBuilder()
                        .setTitle(`${petData.pet.emoji} Pet Fed!`)
                        .setDescription(`${petData.pet.name} is happy! (+${result.happinessGain} happiness)`)
                        .setColor(0x2ecc71)
                        .addFields(
                            { name: '❤️ Happiness', value: `${result.newHappiness}/100`, inline: true },
                            { name: '💰 Cost', value: `${result.cost} Stark Bucks`, inline: true }
                        );
                    await message.reply({ embeds: [embed] });
                    break;
                }

                case 'rename': {
                    if (!petData.hasPet) {
                        await message.reply('❌ You don\'t have a pet!');
                        return true;
                    }

                    const newName = args.slice(1).join(' ');
                    if (!newName || newName.length > 20) {
                        await message.reply('Usage: `*j pet rename <name>` (max 20 characters)');
                        return true;
                    }

                    await starkEconomy.renamePet(userId, newName);
                    await message.reply(`✅ Your pet is now named **${newName}**!`);
                    break;
                }

                case 'stats':
                default: {
                    if (!petData.hasPet) {
                        const embed = new EmbedBuilder()
                            .setTitle('🐾 Pet Shop')
                            .setDescription('You don\'t have a pet yet!\n\nPets provide passive bonuses and companionship.')
                            .setColor(0x3498db)
                            .addFields(
                                { name: '🐕 Dog', value: '+5% work earnings - 5,000 💵', inline: true },
                                { name: '🐈 Cat', value: '+5% gambling luck - 5,000 💵', inline: true },
                                { name: '🐉 Dragon', value: '+10% all earnings - 25,000 💵', inline: true }
                            )
                            .setFooter({ text: 'Use *j pet buy <type> to adopt!' });
                        await message.reply({ embeds: [embed] });
                        return true;
                    }

                    const embed = new EmbedBuilder()
                        .setTitle(`${petData.pet.emoji} ${petData.pet.name}`)
                        .setColor(0x9b59b6)
                        .addFields(
                            { name: '🏷️ Type', value: petData.pet.type, inline: true },
                            { name: '📊 Level', value: `${petData.pet.level}`, inline: true },
                            { name: '❤️ Happiness', value: `${petData.pet.happiness}/100`, inline: true },
                            { name: '🎁 Bonus', value: petData.pet.bonus, inline: true },
                            { name: '🍖 Last Fed', value: petData.pet.lastFed ? `<t:${Math.floor(petData.pet.lastFed / 1000)}:R>` : 'Never', inline: true }
                        )
                        .setFooter({ text: 'Feed your pet daily to keep them happy!' });
                    await message.reply({ embeds: [embed] });
                }
            }
            return true;
        }
    },

    // ============ NEW FEATURE: Heist System ============

    heist: {
        description: 'Multiplayer heist system',
        usage: '*j heist [start|join|status]',
        execute: async (message, args) => {
            const subcommand = (args[0] || 'status').toLowerCase();
            const userId = message.author.id;
            const guildId = message.guild?.id;

            if (!guildId) {
                await message.reply('Heists only work in servers!');
                return true;
            }

            switch (subcommand) {
                case 'start': {
                    const bet = parseInt(args[1]) || 500;
                    const result = await starkEconomy.startHeist(guildId, userId, bet);

                    if (!result.success) {
                        await message.reply(`❌ ${result.error}`);
                        return true;
                    }

                    const embed = new EmbedBuilder()
                        .setTitle('🏦 Heist Started!')
                        .setDescription(`${message.author} is planning a heist!\n\nUse \`*j heist join\` to participate!\nEntry: **${bet}** Stark Bucks`)
                        .setColor(0xe74c3c)
                        .addFields(
                            { name: '👥 Participants', value: '1/8', inline: true },
                            { name: '💰 Prize Pool', value: `${bet}`, inline: true },
                            { name: '⏰ Starts In', value: '60 seconds', inline: true }
                        )
                        .setFooter({ text: 'Minimum 3 participants required!' });

                    await message.reply({ embeds: [embed] });

                    // Auto-execute heist after 60 seconds
                    setTimeout(async () => {
                        const heistResult = await starkEconomy.executeHeist(guildId);
                        if (heistResult.success) {
                            const resultEmbed = new EmbedBuilder()
                                .setTitle(heistResult.won ? '🎉 Heist Successful!' : '🚔 Heist Failed!')
                                .setDescription(heistResult.story)
                                .setColor(heistResult.won ? 0x2ecc71 : 0xe74c3c);

                            if (heistResult.won) {
                                const winnerList = heistResult.winners.map(w => `<@${w.id}>: +${w.winnings}`).join('\n');
                                resultEmbed.addFields({ name: '💰 Payouts', value: winnerList || 'None', inline: false });
                            }

                            await message.channel.send({ embeds: [resultEmbed] });
                        }
                    }, 60000);
                    break;
                }

                case 'join': {
                    const result = await starkEconomy.joinHeist(guildId, userId);

                    if (!result.success) {
                        await message.reply(`❌ ${result.error}`);
                        return true;
                    }

                    await message.reply(`✅ You joined the heist! (${result.participants}/${result.maxParticipants} participants)`);
                    break;
                }

                case 'status':
                default: {
                    const heist = await starkEconomy.getHeistStatus(guildId);

                    if (!heist.active) {
                        await message.reply('No active heist. Use `*j heist start <bet>` to start one!');
                        return true;
                    }

                    const embed = new EmbedBuilder()
                        .setTitle('🏦 Active Heist')
                        .setColor(0xe74c3c)
                        .addFields(
                            { name: '👥 Participants', value: `${heist.participants}/${heist.maxParticipants}`, inline: true },
                            { name: '💰 Prize Pool', value: `${heist.prizePool}`, inline: true },
                            { name: '⏰ Time Left', value: `${Math.ceil(heist.timeLeft / 1000)}s`, inline: true }
                        );

                    await message.reply({ embeds: [embed] });
                }
            }
            return true;
        }
    },

    // ============ NEW FEATURE: Boss Battles ============

    boss: {
        description: 'Fight the server boss',
        usage: '*j boss [attack]',
        execute: async (message, args) => {
            const subcommand = (args[0] || 'status').toLowerCase();
            const guildId = message.guild?.id;

            if (!guildId) {
                await message.reply('Boss battles only work in servers!');
                return true;
            }

            const bossData = await starkEconomy.getBossData(guildId);

            if (subcommand === 'attack') {
                const result = await starkEconomy.attackBoss(guildId, message.author.id);

                if (!result.success) {
                    await message.reply(`❌ ${result.error}`);
                    return true;
                }

                const embed = new EmbedBuilder()
                    .setTitle(`⚔️ Attack on ${bossData.name}!`)
                    .setDescription(`You dealt **${result.damage}** damage!`)
                    .setColor(0xe74c3c)
                    .addFields(
                        { name: '❤️ Boss HP', value: `${result.remainingHp}/${bossData.maxHp}`, inline: true },
                        { name: '📊 Your Total Damage', value: `${result.userTotalDamage}`, inline: true }
                    );

                if (result.bossDefeated) {
                    embed.addFields({
                        name: '🎉 BOSS DEFEATED!',
                        value: `Rewards distributed! You earned **${result.reward}** Stark Bucks!`,
                        inline: false
                    });
                }

                await message.reply({ embeds: [embed] });
            } else {
                const hpBar = '█'.repeat(Math.floor(bossData.hp / bossData.maxHp * 20)) + '░'.repeat(20 - Math.floor(bossData.hp / bossData.maxHp * 20));

                const embed = new EmbedBuilder()
                    .setTitle(`👹 ${bossData.name}`)
                    .setDescription(bossData.description)
                    .setColor(0x9b59b6)
                    .addFields(
                        { name: '❤️ HP', value: `${hpBar}\n${bossData.hp}/${bossData.maxHp}`, inline: false },
                        { name: '👥 Attackers', value: `${bossData.attackers}`, inline: true },
                        { name: '💰 Reward Pool', value: `${bossData.rewardPool}`, inline: true },
                        { name: '⏰ Resets In', value: `${Math.ceil(bossData.resetTime / 3600000)}h`, inline: true }
                    )
                    .setFooter({ text: 'Use *j boss attack to deal damage!' });

                await message.reply({ embeds: [embed] });
            }
            return true;
        }
    },

    // ============ NEW FEATURE: Lottery System ============

    lottery: {
        description: 'Weekly lottery system',
        usage: '*j lottery [buy <tickets>]',
        aliases: ['lotto'],
        execute: async (message, args) => {
            const subcommand = (args[0] || 'status').toLowerCase();
            const userId = message.author.id;

            const lotteryData = await starkEconomy.getLotteryData();

            if (subcommand === 'buy') {
                const tickets = parseInt(args[1]) || 1;
                const result = await starkEconomy.buyLotteryTickets(userId, tickets);

                if (!result.success) {
                    await message.reply(`❌ ${result.error}`);
                    return true;
                }

                await message.reply(`✅ Bought **${tickets}** lottery ticket(s) for **${result.cost}** Stark Bucks!\nYour tickets: ${result.userTickets} | Total pot: ${result.jackpot}`);
            } else {
                const embed = new EmbedBuilder()
                    .setTitle('🎰 Weekly Lottery')
                    .setColor(0xf1c40f)
                    .addFields(
                        { name: '💰 Jackpot', value: `${lotteryData.jackpot.toLocaleString()} Stark Bucks`, inline: true },
                        { name: '🎫 Ticket Price', value: `${lotteryData.ticketPrice}`, inline: true },
                        { name: '📊 Total Tickets', value: `${lotteryData.totalTickets}`, inline: true },
                        { name: '🎫 Your Tickets', value: `${lotteryData.userTickets || 0}`, inline: true },
                        { name: '⏰ Draw In', value: `${lotteryData.timeUntilDraw}`, inline: true }
                    )
                    .setFooter({ text: 'Use *j lottery buy <amount> to enter!' });

                if (lotteryData.lastWinner) {
                    embed.addFields({ name: '🏆 Last Winner', value: `<@${lotteryData.lastWinner.id}> won ${lotteryData.lastWinner.amount}!`, inline: false });
                }

                await message.reply({ embeds: [embed] });
            }
            return true;
        }
    },

    // ============ NEW FEATURE: Quest System ============

    quest: {
        description: 'View and complete quests',
        usage: '*j quest [start <name>|complete]',
        aliases: ['quests', 'mission'],
        execute: async (message, args) => {
            const subcommand = (args[0] || 'status').toLowerCase();
            const userId = message.author.id;

            const questData = await starkEconomy.getQuestData(userId);

            if (subcommand === 'start') {
                const questName = args.slice(1).join('_').toLowerCase() || 'random';
                const result = await starkEconomy.startQuest(userId, questName);

                if (!result.success) {
                    await message.reply(`❌ ${result.error}`);
                    return true;
                }

                const embed = new EmbedBuilder()
                    .setTitle('📜 Quest Started!')
                    .setDescription(`**${result.quest.name}**\n\n${result.quest.description}`)
                    .setColor(0x9b59b6)
                    .addFields(
                        { name: '🎯 Objectives', value: result.quest.objectives.map(o => `⬜ ${o}`).join('\n'), inline: false },
                        { name: '🎁 Rewards', value: `${result.quest.reward} Stark Bucks + ${result.quest.xp} XP`, inline: true }
                    );

                await message.reply({ embeds: [embed] });
            } else if (subcommand === 'complete') {
                const result = await starkEconomy.completeQuest(userId);

                if (!result.success) {
                    await message.reply(`❌ ${result.error}`);
                    return true;
                }

                const embed = new EmbedBuilder()
                    .setTitle('🎉 Quest Complete!')
                    .setDescription(`You completed **${result.quest.name}**!`)
                    .setColor(0x2ecc71)
                    .addFields(
                        { name: '💰 Reward', value: `${result.reward} Stark Bucks`, inline: true },
                        { name: '⭐ XP', value: `+${result.xp}`, inline: true }
                    );

                await message.reply({ embeds: [embed] });
            } else {
                if (!questData.activeQuest) {
                    const availableQuests = await starkEconomy.getAvailableQuests();
                    const questList = availableQuests.slice(0, 5).map(q =>
                        `**${q.name}** - ${q.difficulty}\n> ${q.shortDesc}`
                    ).join('\n\n');

                    const embed = new EmbedBuilder()
                        .setTitle('📜 Available Quests')
                        .setDescription(questList || 'No quests available!')
                        .setColor(0x3498db)
                        .setFooter({ text: 'Use *j quest start <name> to begin!' });

                    await message.reply({ embeds: [embed] });
                } else {
                    const q = questData.activeQuest;
                    const objectives = q.objectives.map((o, i) =>
                        `${q.progress[i] ? '✅' : '⬜'} ${o}`
                    ).join('\n');

                    const embed = new EmbedBuilder()
                        .setTitle(`📜 ${q.name}`)
                        .setDescription(q.description)
                        .setColor(0x9b59b6)
                        .addFields(
                            { name: '🎯 Objectives', value: objectives, inline: false },
                            { name: '🎁 Reward', value: `${q.reward} 💵`, inline: true },
                            { name: '📊 Progress', value: `${q.progress.filter(Boolean).length}/${q.objectives.length}`, inline: true }
                        );

                    await message.reply({ embeds: [embed] });
                }
            }
            return true;
        }
    },

    // ============ NEW FEATURE: Tournament System ============

    tournament: {
        description: 'Join fishing/hunting tournaments',
        usage: '*j tournament [join|leaderboard]',
        aliases: ['tourney'],
        execute: async (message, args) => {
            const subcommand = (args[0] || 'status').toLowerCase();
            const guildId = message.guild?.id;

            if (!guildId) {
                await message.reply('Tournaments only work in servers!');
                return true;
            }

            const tournamentData = await starkEconomy.getTournamentData(guildId);

            if (subcommand === 'join') {
                const result = await starkEconomy.joinTournament(guildId, message.author.id);

                if (!result.success) {
                    await message.reply(`❌ ${result.error}`);
                    return true;
                }

                await message.reply(`✅ You joined the **${tournamentData.type}** tournament! Good luck!`);
            } else if (subcommand === 'leaderboard' || subcommand === 'lb') {
                const lb = tournamentData.leaderboard.slice(0, 10);
                const lbText = lb.map((u, i) => `**#${i + 1}** <@${u.id}> - ${u.score} pts`).join('\n');

                const embed = new EmbedBuilder()
                    .setTitle(`🏆 ${tournamentData.type} Tournament Leaderboard`)
                    .setDescription(lbText || 'No participants yet!')
                    .setColor(0xf1c40f);

                await message.reply({ embeds: [embed] });
            } else {
                const embed = new EmbedBuilder()
                    .setTitle(`🏆 ${tournamentData.type} Tournament`)
                    .setDescription(tournamentData.description)
                    .setColor(0x3498db)
                    .addFields(
                        { name: '👥 Participants', value: `${tournamentData.participants}`, inline: true },
                        { name: '💰 Prize Pool', value: `${tournamentData.prizePool}`, inline: true },
                        { name: '⏰ Ends In', value: tournamentData.endsIn, inline: true }
                    )
                    .setFooter({ text: 'Use *j tournament join to participate!' });

                await message.reply({ embeds: [embed] });
            }
            return true;
        }
    },

    // ============ NEW FEATURE: Auction House ============

    auction: {
        description: 'Player-to-player auction house',
        usage: '*j auction [list|browse|buy]',
        aliases: ['ah'],
        execute: async (message, args) => {
            const subcommand = (args[0] || 'browse').toLowerCase();
            const userId = message.author.id;

            switch (subcommand) {
                case 'list': {
                    const itemIndex = parseInt(args[1]) - 1;
                    const price = parseInt(args[2]);

                    if (isNaN(itemIndex) || isNaN(price) || price < 1) {
                        await message.reply('Usage: `*j auction list <item_number> <price>`\nView items with `*j inventory` first.');
                        return true;
                    }

                    const result = await starkEconomy.listAuction(userId, itemIndex, price);

                    if (!result.success) {
                        await message.reply(`❌ ${result.error}`);
                        return true;
                    }

                    await message.reply(`✅ Listed **${result.item}** for **${price}** Stark Bucks! (ID: ${result.auctionId})`);
                    break;
                }

                case 'buy': {
                    const auctionId = args[1];

                    if (!auctionId) {
                        await message.reply('Usage: `*j auction buy <auction_id>`');
                        return true;
                    }

                    const result = await starkEconomy.buyAuction(userId, auctionId);

                    if (!result.success) {
                        await message.reply(`❌ ${result.error}`);
                        return true;
                    }

                    await message.reply(`✅ Purchased **${result.item}** for **${result.price}** Stark Bucks!`);
                    break;
                }

                case 'my': {
                    const myListings = await starkEconomy.getUserAuctions(userId);

                    if (myListings.length === 0) {
                        await message.reply('You have no active listings. Use `*j auction list` to sell items!');
                        return true;
                    }

                    const listText = myListings.map(a => `\`${a.id}\` **${a.item}** - ${a.price} 💵`).join('\n');

                    const embed = new EmbedBuilder()
                        .setTitle('📦 Your Auction Listings')
                        .setDescription(listText)
                        .setColor(0x9b59b6);

                    await message.reply({ embeds: [embed] });
                    break;
                }

                case 'browse':
                default: {
                    const auctions = await starkEconomy.getAuctions();

                    if (auctions.length === 0) {
                        await message.reply('No items for sale! Use `*j auction list` to sell something.');
                        return true;
                    }

                    const listText = auctions.slice(0, 15).map(a =>
                        `\`${a.id}\` **${a.item}** - ${a.price} 💵 by ${a.sellerName}`
                    ).join('\n');

                    const embed = new EmbedBuilder()
                        .setTitle('🏪 Auction House')
                        .setDescription(listText)
                        .setColor(0x3498db)
                        .setFooter({ text: 'Use *j auction buy <id> to purchase' });

                    await message.reply({ embeds: [embed] });
                }
            }
            return true;
        }
    },

    // ============ STARKBUCKS (SBX) COMMANDS ============

    sbx: {
        description: 'Starkbucks exchange commands',
        usage: '*j sbx [wallet|convert|store|invest|pay|market]',
        aliases: ['starkbucks'],
        execute: async (message, args) => {
            const subcommand = (args[0] || 'wallet').toLowerCase();
            const userId = message.author.id;
            const username = message.author.username;

            try {
                switch (subcommand) {
                    case 'wallet':
                    case 'bal':
                    case 'balance': {
                        const wallet = await starkbucks.getWallet(userId);
                        const market = await starkbucks.getMarketData();
                        const usdValue = (wallet.balance * market.price).toFixed(2);

                        const embed = new EmbedBuilder()
                            .setTitle('💳 SBX Wallet')
                            .setDescription(`**${username}**'s Starkbucks wallet`)
                            .setColor(0xf39c12)
                            .addFields(
                                { name: '💰 Balance', value: `${wallet.balance.toFixed(2)} SBX`, inline: true },
                                { name: '💵 USD Value', value: `$${usdValue}`, inline: true },
                                { name: '📈 SBX Price', value: `$${market.price.toFixed(2)}`, inline: true },
                                { name: '📊 Total Earned', value: `${wallet.totalEarned.toFixed(2)} SBX`, inline: true },
                                { name: '🛒 Total Spent', value: `${wallet.totalSpent.toFixed(2)} SBX`, inline: true }
                            )
                            .setFooter({ text: 'Use *j sbx help for more commands' });

                        await message.reply({ embeds: [embed] });
                        return true;
                    }

                    case 'market':
                    case 'price':
                    case 'ticker': {
                        const market = await starkbucks.getMarketData();
                        const changeEmoji = market.change24h >= 0 ? '📈' : '📉';
                        const changeColor = market.change24h >= 0 ? 0x2ecc71 : 0xe74c3c;

                        const embed = new EmbedBuilder()
                            .setTitle('📊 SBX Market')
                            .setColor(changeColor)
                            .addFields(
                                { name: '💵 Price', value: `$${market.price.toFixed(2)}`, inline: true },
                                { name: `${changeEmoji} 24h Change`, value: `${market.change24h >= 0 ? '+' : ''}${market.change24h.toFixed(2)}%`, inline: true },
                                { name: '📊 Volume', value: `${market.volume24h.toLocaleString()} SBX`, inline: true },
                                { name: '⬆️ 24h High', value: `$${market.high24h.toFixed(2)}`, inline: true },
                                { name: '⬇️ 24h Low', value: `$${market.low24h.toFixed(2)}`, inline: true },
                                { name: '👥 Active Users', value: `${market.activeUsers}`, inline: true }
                            );

                        if (market.event) {
                            embed.addFields({ name: '🎯 Active Event', value: market.event.name, inline: false });
                        }

                        embed.setFooter({ text: 'Price updates every minute • Virtual currency only' });
                        await message.reply({ embeds: [embed] });
                        return true;
                    }

                    case 'convert': {
                        const amount = parseInt(args[1]);
                        const direction = (args[2] || 'tosbx').toLowerCase();

                        if (!amount || amount <= 0) {
                            await message.reply('Usage: `*j sbx convert <amount> [tosbx|tostark]`\nExample: `*j sbx convert 1000 tosbx`');
                            return true;
                        }

                        let result;
                        if (direction === 'tostark' || direction === 'tostarkbucks') {
                            result = await starkbucks.convertToStarkBucks(userId, amount);
                            if (result.success) {
                                const embed = new EmbedBuilder()
                                    .setTitle('💱 Conversion Complete')
                                    .setColor(0x2ecc71)
                                    .setDescription(`Converted **${result.sbxSpent} SBX** → **${result.starkBucksReceived} Stark Bucks**`)
                                    .addFields(
                                        { name: 'Rate', value: `1 SBX = ${result.rate.toFixed(2)} Stark Bucks`, inline: true },
                                        { name: 'Fee', value: `${result.fee} Stark Bucks`, inline: true }
                                    );
                                await message.reply({ embeds: [embed] });
                            } else {
                                await message.reply(`❌ ${result.error}`);
                            }
                        } else {
                            result = await starkbucks.convertToSBX(userId, amount);
                            if (result.success) {
                                const embed = new EmbedBuilder()
                                    .setTitle('💱 Conversion Complete')
                                    .setColor(0x2ecc71)
                                    .setDescription(`Converted **${result.starkBucksSpent} Stark Bucks** → **${result.sbxReceived.toFixed(2)} SBX**`)
                                    .addFields(
                                        { name: 'Rate', value: `${result.rate.toFixed(2)} Stark Bucks = 1 SBX`, inline: true },
                                        { name: 'SBX Price', value: `$${result.price.toFixed(2)}`, inline: true }
                                    );
                                await message.reply({ embeds: [embed] });
                            } else {
                                await message.reply(`❌ ${result.error}`);
                            }
                        }
                        return true;
                    }

                    case 'store':
                    case 'shop': {
                        const category = args[1] || null;
                        const items = starkbucks.getStoreItems(category);
                        const domain = process.env.JARVIS_DOMAIN || 'your-domain.com';

                        const embed = new EmbedBuilder()
                            .setTitle('🛒 SBX Store')
                            .setColor(0xf39c12)
                            .setDescription(`Buy features and cosmetics with SBX!\n🌐 **[Visit Online Store](https://${domain}/store)**`)
                            .setFooter({ text: 'Use *j sbx buy <item_id> to purchase' });

                        const grouped = {};
                        for (const item of items.slice(0, 12)) {
                            if (!grouped[item.category]) grouped[item.category] = [];
                            grouped[item.category].push(`• **${item.name}** - ${item.price} SBX`);
                        }

                        for (const [cat, itemList] of Object.entries(grouped)) {
                            embed.addFields({ name: cat.charAt(0).toUpperCase() + cat.slice(1), value: itemList.join('\n'), inline: true });
                        }

                        await message.reply({ embeds: [embed] });
                        return true;
                    }

                    case 'buy': {
                        const itemId = args[1];
                        if (!itemId) {
                            await message.reply('Usage: `*j sbx buy <item_id>`\nUse `*j sbx store` to see available items.');
                            return true;
                        }

                        const result = await starkbucks.purchaseItem(userId, itemId);
                        if (result.success) {
                            const embed = new EmbedBuilder()
                                .setTitle('🎉 Purchase Successful!')
                                .setColor(0x2ecc71)
                                .setDescription(`You bought **${result.item.name}**!`)
                                .addFields(
                                    { name: 'Price', value: `${result.item.price} SBX`, inline: true },
                                    { name: 'New Balance', value: `${result.newBalance.toFixed(2)} SBX`, inline: true }
                                );
                            await message.reply({ embeds: [embed] });
                        } else {
                            await message.reply(`❌ ${result.error}`);
                        }
                        return true;
                    }

                    case 'invest': {
                        const action = (args[1] || 'status').toLowerCase();
                        const amount = parseFloat(args[2]);

                        if (action === 'stake' && amount > 0) {
                            const result = await starkbucks.investSBX(userId, amount);
                            if (result.success) {
                                const embed = new EmbedBuilder()
                                    .setTitle('📈 Investment Made')
                                    .setColor(0x2ecc71)
                                    .setDescription(`Staked **${result.invested} SBX**`)
                                    .addFields(
                                        { name: 'Total Staked', value: `${result.totalPrincipal.toFixed(2)} SBX`, inline: true },
                                        { name: 'Daily Return', value: `${(result.dailyRate * 100).toFixed(1)}%`, inline: true }
                                    );
                                await message.reply({ embeds: [embed] });
                            } else {
                                await message.reply(`❌ ${result.error}`);
                            }
                        } else if (action === 'claim') {
                            const result = await starkbucks.claimInvestmentEarnings(userId);
                            if (result.success) {
                                const embed = new EmbedBuilder()
                                    .setTitle('💰 Earnings Claimed!')
                                    .setColor(0x2ecc71)
                                    .addFields(
                                        { name: 'Claimed', value: `${result.earnings.toFixed(2)} SBX`, inline: true },
                                        { name: 'Days', value: `${result.daysClaimed}`, inline: true },
                                        { name: 'Total Earned', value: `${result.totalEarned.toFixed(2)} SBX`, inline: true }
                                    );
                                await message.reply({ embeds: [embed] });
                            } else {
                                await message.reply(`❌ ${result.error}`);
                            }
                        } else if (action === 'withdraw' && amount > 0) {
                            const result = await starkbucks.withdrawInvestment(userId, amount);
                            if (result.success) {
                                const embed = new EmbedBuilder()
                                    .setTitle('💸 Withdrawal Complete')
                                    .setColor(0xf39c12)
                                    .addFields(
                                        { name: 'Withdrawn', value: `${result.withdrawn.toFixed(2)} SBX`, inline: true },
                                        { name: 'Fee (2%)', value: `${result.fee.toFixed(2)} SBX`, inline: true },
                                        { name: 'Received', value: `${result.received.toFixed(2)} SBX`, inline: true }
                                    );
                                await message.reply({ embeds: [embed] });
                            } else {
                                await message.reply(`❌ ${result.error}`);
                            }
                        } else {
                            await message.reply('**SBX Investment**\n• `*j sbx invest stake <amount>` - Stake SBX (0.5% daily)\n• `*j sbx invest claim` - Claim earnings\n• `*j sbx invest withdraw <amount>` - Withdraw (2% fee)');
                        }
                        return true;
                    }

                    case 'pay':
                    case 'send': {
                        const target = message.mentions.users.first();
                        const amount = parseFloat(args[2] || args[1]);

                        if (!target || !amount || amount <= 0) {
                            await message.reply('Usage: `*j sbx pay @user <amount>`');
                            return true;
                        }

                        if (target.id === userId) {
                            await message.reply('❌ You cannot send SBX to yourself!');
                            return true;
                        }

                        const result = await starkbucks.transfer(userId, target.id, amount, `From ${username}`);
                        if (result.success) {
                            const embed = new EmbedBuilder()
                                .setTitle('💸 Transfer Complete')
                                .setColor(0x2ecc71)
                                .setDescription(`Sent **${amount} SBX** to ${target}`)
                                .addFields(
                                    { name: 'Amount', value: `${amount} SBX`, inline: true },
                                    { name: 'Fee (10%)', value: `${result.fee.toFixed(2)} SBX`, inline: true },
                                    { name: 'They Received', value: `${result.netAmount.toFixed(2)} SBX`, inline: true }
                                );
                            await message.reply({ embeds: [embed] });
                        } else {
                            await message.reply(`❌ ${result.error}`);
                        }
                        return true;
                    }

                    case 'request':
                    case 'invoice': {
                        const amount = parseFloat(args[1]);
                        const memo = args.slice(2).join(' ') || '';

                        if (!amount || amount <= 0) {
                            await message.reply('Usage: `*j sbx request <amount> [memo]`');
                            return true;
                        }

                        const result = await starkbucks.createPaymentRequest(userId, amount, memo);
                        const embed = new EmbedBuilder()
                            .setTitle('📝 Payment Request Created')
                            .setColor(0xf39c12)
                            .setDescription(`Share this link to receive payment:`)
                            .addFields(
                                { name: '🔗 Payment URL', value: result.url, inline: false },
                                { name: 'Amount', value: `${amount} SBX`, inline: true },
                                { name: 'Expires', value: `<t:${Math.floor(new Date(result.expiresAt).getTime() / 1000)}:R>`, inline: true }
                            );

                        if (memo) embed.addFields({ name: 'Memo', value: memo, inline: false });

                        await message.reply({ embeds: [embed] });
                        return true;
                    }

                    case 'help':
                    default: {
                        const embed = new EmbedBuilder()
                            .setTitle('⭐ Starkbucks (SBX) Help')
                            .setColor(0xf39c12)
                            .setDescription('Virtual currency exchange with real-time price fluctuation!')
                            .addFields(
                                { name: '💳 Wallet', value: '`*j sbx wallet` - View balance', inline: true },
                                { name: '📊 Market', value: '`*j sbx market` - View price', inline: true },
                                { name: '💱 Convert', value: '`*j sbx convert <amt>` - Stark↔SBX', inline: true },
                                { name: '🛒 Store', value: '`*j sbx store` - Browse items', inline: true },
                                { name: '🛍️ Buy', value: '`*j sbx buy <id>` - Purchase', inline: true },
                                { name: '📈 Invest', value: '`*j sbx invest` - Stake SBX', inline: true },
                                { name: '💸 Pay', value: '`*j sbx pay @user <amt>`', inline: true },
                                { name: '📝 Request', value: '`*j sbx request <amt>`', inline: true }
                            )
                            .setFooter({ text: '10% fee on all transactions • Virtual currency only' });

                        await message.reply({ embeds: [embed] });
                        return true;
                    }
                }
            } catch (error) {
                console.error('[SBX Command Error]', error);
                await message.reply('❌ Something went wrong with the SBX command.');
                return true;
            }
        }
    },

    // ============ STARK CRYPTO (SX) COMMANDS ============

    crypto: {
        description: 'Stark Crypto trading commands',
        usage: '*j crypto [prices|buy|sell|portfolio|market]',
        aliases: ['sx', 'coin', 'coins'],
        execute: async (message, args) => {
            const starkCrypto = require('./stark-crypto');
            starkCrypto.startPriceUpdates();

            const subcommand = (args[0] || 'prices').toLowerCase();
            const userId = message.author.id;

            try {
                switch (subcommand) {
                    case 'prices':
                    case 'list':
                    case 'all': {
                        const prices = starkCrypto.getAllPrices();
                        const market = starkCrypto.getMarketState();

                        const cycleEmoji = market.cycle === 'bull' ? '📈' : market.cycle === 'bear' ? '📉' : '➡️';
                        const cycleColor = market.cycle === 'bull' ? 0x00ff88 : market.cycle === 'bear' ? 0xff4444 : 0xffaa00;

                        const embed = new EmbedBuilder()
                            .setTitle('📊 Stark Crypto Exchange')
                            .setColor(cycleColor)
                            .setDescription(`${cycleEmoji} **${market.cycle.toUpperCase()} MARKET** | Sentiment: ${(market.sentiment * 100).toFixed(0)}%${market.activeEvent ? `\n🎯 **Event:** ${market.activeEvent.name}` : ''}`);

                        const coinList = Object.entries(prices).map(([symbol, coin]) => {
                            const arrow = coin.change24h >= 0 ? '▲' : '▼';
                            const change = Math.abs(coin.change24h).toFixed(1);
                            return `${coin.emoji} **${symbol}** ${coin.price.toLocaleString()} SB ${arrow}${change}%`;
                        }).join('\n');

                        embed.addFields({ name: 'Current Prices', value: coinList, inline: false });
                        embed.setFooter({ text: 'Use *j crypto buy <coin> <amount> to trade • 2.5% fee' });

                        await message.reply({ embeds: [embed] });
                        return true;
                    }

                    case 'market':
                    case 'status': {
                        const market = starkCrypto.getMarketState();
                        const cycleEmoji = market.cycle === 'bull' ? '📈' : market.cycle === 'bear' ? '📉' : '➡️';
                        const cycleColor = market.cycle === 'bull' ? 0x00ff88 : market.cycle === 'bear' ? 0xff4444 : 0xffaa00;

                        const embed = new EmbedBuilder()
                            .setTitle('🌍 Market Status')
                            .setColor(cycleColor)
                            .addFields(
                                { name: 'Market Cycle', value: `${cycleEmoji} ${market.cycle.toUpperCase()}`, inline: true },
                                { name: 'Sentiment', value: `${(market.sentiment * 100).toFixed(0)}%`, inline: true },
                                { name: '24h Volume', value: `${market.volume24h.toLocaleString()} SB`, inline: true }
                            );

                        if (market.activeEvent) {
                            const timeLeft = Math.ceil(market.activeEvent.endsIn / 60000);
                            embed.addFields({
                                name: '🎯 Active Event',
                                value: `**${market.activeEvent.name}**\nEnds in ${timeLeft} minutes`,
                                inline: false
                            });
                        }

                        embed.setFooter({ text: 'Market cycles change every hour • Events can crash or pump prices!' });
                        await message.reply({ embeds: [embed] });
                        return true;
                    }

                    case 'portfolio':
                    case 'wallet':
                    case 'holdings': {
                        const portfolio = await starkCrypto.getPortfolio(userId);
                        const prices = starkCrypto.getAllPrices();
                        const balance = await starkEconomy.getBalance(userId);

                        const embed = new EmbedBuilder()
                            .setTitle('💼 Your Crypto Portfolio')
                            .setColor(0x00d4ff)
                            .addFields(
                                { name: '💰 Portfolio Value', value: `${portfolio.totalValue.toLocaleString()} SB`, inline: true },
                                { name: '📊 Total Invested', value: `${portfolio.totalInvested.toLocaleString()} SB`, inline: true },
                                { name: '🔄 Total Trades', value: `${portfolio.trades}`, inline: true }
                            );

                        const holdings = Object.entries(portfolio.holdings || {}).filter(([s, a]) => a > 0);
                        if (holdings.length > 0) {
                            const holdingsList = holdings.map(([symbol, amount]) => {
                                const coin = prices[symbol] || {};
                                const value = (coin.price || 0) * amount;
                                return `${coin.emoji || '💰'} **${symbol}**: ${amount} (${value.toLocaleString()} SB)`;
                            }).join('\n');
                            embed.addFields({ name: '📦 Holdings', value: holdingsList, inline: false });
                        } else {
                            embed.addFields({ name: '📦 Holdings', value: 'No crypto yet! Use `*j crypto buy <coin> <amount>`', inline: false });
                        }

                        embed.addFields({ name: '💵 Available Balance', value: `${balance.toLocaleString()} Stark Bucks`, inline: false });
                        await message.reply({ embeds: [embed] });
                        return true;
                    }

                    case 'buy': {
                        const symbol = (args[1] || '').toUpperCase();
                        const amount = parseFloat(args[2]);

                        if (!symbol || !amount || amount <= 0) {
                            await message.reply('Usage: `*j crypto buy <COIN> <amount>`\nExample: `*j crypto buy IRON 10`');
                            return true;
                        }

                        const result = await starkCrypto.buyCrypto(userId, symbol, amount);

                        if (result.success) {
                            const embed = new EmbedBuilder()
                                .setTitle('✅ Purchase Successful!')
                                .setColor(0x00ff88)
                                .setDescription(`Bought **${amount} ${symbol}**`)
                                .addFields(
                                    { name: 'Price', value: `${result.price.toLocaleString()} SB each`, inline: true },
                                    { name: 'Total Cost', value: `${result.totalCost.toLocaleString()} SB`, inline: true },
                                    { name: 'Fee (2.5%)', value: `${result.fee.toLocaleString()} SB`, inline: true }
                                )
                                .setFooter({ text: result.marketImpact });
                            await message.reply({ embeds: [embed] });
                        } else {
                            await message.reply(`❌ ${result.error}`);
                        }
                        return true;
                    }

                    case 'sell': {
                        const symbol = (args[1] || '').toUpperCase();
                        const amount = parseFloat(args[2]);

                        if (!symbol || !amount || amount <= 0) {
                            await message.reply('Usage: `*j crypto sell <COIN> <amount>`\nExample: `*j crypto sell IRON 10`');
                            return true;
                        }

                        const result = await starkCrypto.sellCrypto(userId, symbol, amount);

                        if (result.success) {
                            const embed = new EmbedBuilder()
                                .setTitle('✅ Sale Successful!')
                                .setColor(0xff4444)
                                .setDescription(`Sold **${amount} ${symbol}**`)
                                .addFields(
                                    { name: 'Price', value: `${result.price.toLocaleString()} SB each`, inline: true },
                                    { name: 'Gross Value', value: `${result.totalValue.toLocaleString()} SB`, inline: true },
                                    { name: 'Fee (2.5%)', value: `${result.fee.toLocaleString()} SB`, inline: true },
                                    { name: 'You Received', value: `${result.netProceeds.toLocaleString()} SB`, inline: true }
                                )
                                .setFooter({ text: result.marketImpact });
                            await message.reply({ embeds: [embed] });
                        } else {
                            await message.reply(`❌ ${result.error}`);
                        }
                        return true;
                    }

                    case 'price':
                    case 'info': {
                        const symbol = (args[1] || '').toUpperCase();
                        if (!symbol) {
                            await message.reply('Usage: `*j crypto price <COIN>`\nExample: `*j crypto price IRON`');
                            return true;
                        }

                        const coin = starkCrypto.getCoinPrice(symbol);
                        if (!coin) {
                            await message.reply(`❌ Unknown coin: ${symbol}`);
                            return true;
                        }

                        const changeEmoji = coin.change24h >= 0 ? '📈' : '📉';
                        const changeColor = coin.change24h >= 0 ? 0x00ff88 : 0xff4444;

                        const embed = new EmbedBuilder()
                            .setTitle(`${coin.emoji} ${coin.name} (${symbol})`)
                            .setColor(changeColor)
                            .setDescription(coin.description)
                            .addFields(
                                { name: '💵 Price', value: `${coin.price.toLocaleString()} SB`, inline: true },
                                { name: `${changeEmoji} 24h Change`, value: `${coin.change24h >= 0 ? '+' : ''}${coin.change24h.toFixed(2)}%`, inline: true },
                                { name: '📊 Tier', value: coin.tier.toUpperCase(), inline: true },
                                { name: '⬆️ 24h High', value: `${coin.high24h.toLocaleString()} SB`, inline: true },
                                { name: '⬇️ 24h Low', value: `${coin.low24h.toLocaleString()} SB`, inline: true },
                                { name: '📈 Trend', value: coin.trend === 'up' ? '🟢 Bullish' : coin.trend === 'down' ? '🔴 Bearish' : '🟡 Neutral', inline: true }
                            )
                            .setFooter({ text: `Volatility: ${(coin.volatility * 100).toFixed(0)}% • Correlation: ${coin.correlation}` });

                        await message.reply({ embeds: [embed] });
                        return true;
                    }

                    case 'help':
                    default: {
                        const embed = new EmbedBuilder()
                            .setTitle('📈 Stark Crypto Help')
                            .setColor(0x00d4ff)
                            .setDescription('Trade virtual cryptocurrencies with Stark Bucks!')
                            .addFields(
                                { name: '📊 Prices', value: '`*j crypto prices` - View all coins', inline: true },
                                { name: '🌍 Market', value: '`*j crypto market` - Market status', inline: true },
                                { name: '💼 Portfolio', value: '`*j crypto portfolio` - Your holdings', inline: true },
                                { name: '💰 Buy', value: '`*j crypto buy <COIN> <amt>`', inline: true },
                                { name: '💸 Sell', value: '`*j crypto sell <COIN> <amt>`', inline: true },
                                { name: '🔍 Info', value: '`*j crypto price <COIN>`', inline: true }
                            )
                            .addFields({
                                name: '🪙 Available Coins',
                                value: 'IRON, ARC, JARV, STARK, PEPPER, SHIELD, HULK, THOR, WIDOW, VIBRA',
                                inline: false
                            })
                            .setFooter({ text: '2.5% fee on all trades • Prices change every 30 seconds' });

                        await message.reply({ embeds: [embed] });
                        return true;
                    }
                }
            } catch (error) {
                console.error('[Crypto Command Error]', error);
                await message.reply('❌ Something went wrong with the crypto command.');
                return true;
            }
        }
    },

    // Cookie update command (bot owner only)
    cookies: {
        description: 'Update YouTube cookies for music playback (bot owner only)',
        usage: '*j cookies "<netscape cookie string>"',
        ownerOnly: true,
        async execute(message, args) {
            // Only bot owner can run this
            if (message.author.id !== BOT_OWNER_ID) {
                await message.reply('❌ This command is restricted to the bot owner only, sir.');
                return true;
            }

            // Get the full content after the command
            const content = message.content;
            let cookieString = '';

            // Check for file attachment first
            const attachment = message.attachments.first();
            if (attachment) {
                if (attachment.contentType && !attachment.contentType.includes('text/')) {
                    await message.reply('❌ Please upload a text file (.txt)');
                    return true;
                }
                try {
                    const response = await fetch(attachment.url);
                    if (!response.ok) throw new Error('Failed to fetch attachment');
                    cookieString = await response.text();
                } catch (e) {
                    await message.reply(`❌ Failed to read attachment: ${e.message}`);
                    return true;
                }
            } else {
                // Try parsing from message content
                const cookieMatch = content.match(/cookies\s+"([^"]+)"/i) || content.match(/cookies\s+(.+)/i);
                if (cookieMatch) cookieString = cookieMatch[1];
            }

            if (!cookieString) {
                await message.reply(
                    '**🍪 YouTube Cookie Update**\n\n' +
                    '**Option 1 (Recommended):** Upload your `cookies.txt` file with this command.\n' +
                    '**Option 2:** Usage: `*j cookies "<cookies>"` (if short enough)\n\n' +
                    'To get cookies:\n' +
                    '1. Install "Get cookies.txt LOCALLY" extension\n' +
                    '2. Export as Netscape format\n' +
                    '3. Upload the text file here'
                );
                return true;
            }

            cookieString = cookieString.trim();

            // Validate it looks like Netscape format
            const isNetscape = cookieString.includes('.youtube.com') ||
                cookieString.includes('# Netscape') ||
                cookieString.includes('# HTTP Cookie');

            if (!isNetscape) {
                await message.reply('❌ Invalid cookie format. Please use Netscape format (from browser extension).');
                return true;
            }

            try {
                // Update in memory by setting environment variable
                process.env.YT_COOKIES = cookieString;

                // Delete the user's message for security (contains sensitive cookies)
                try {
                    await message.delete();
                } catch {
                    // Can't delete - warn user
                    await message.channel.send('⚠️ Could not delete your message. Please delete it manually to protect your cookies!');
                }

                await message.channel.send(
                    '✅ YouTube cookies updated in memory!\n\n' +
                    '**Note:** These will be used for the next music playback.\n' +
                    'For permanent storage, add to your `.env` file:\n' +
                    '```\nYT_COOKIES="<your cookies>"\n```'
                );

                console.log('[Cookies] YouTube cookies updated by bot owner');
                return true;
            } catch (error) {
                console.error('[Cookies] Failed to update:', error);
                await message.reply('❌ Failed to update cookies.');
                return true;
            }
        } \n
    },

    // ============ TERF WIKI COMMAND ============

    terf: {
        description: 'Ask the TERF Wiki',
        usage: '*j terf <question>',
        guildLocked: '858444090374881301',
        async execute(message, args) {
            // Guild lock - only respond in specific guild
            const ALLOWED_GUILD = '858444090374881301';
            if (!message.guild || message.guild.id !== ALLOWED_GUILD) {
                return true; // Silently ignore
            }

            const question = args.join(' ').trim();
            if (!question) {
                await message.reply('❓ Usage: `*j terf <your question>`\nExample: `*j terf What is STFR?`');
                return true;
            }

            try {
                console.log(`[Terf] Legacy query from ${message.author.tag}: "${question}"`);
                const terfWiki = require('./terf-wiki');
                const result = await terfWiki.query(question);

                if (!result.success) {
                    await message.reply(`❌ ${result.error}`);
                    return true;
                }

                let response = `**Answer:**\n${result.answer}`;

                if (result.sources && result.sources.length > 0) {
                    const sourceLinks = result.sources
                        .slice(0, 3)
                        .map(s => `• [${s.title}](${s.url})`)
                        .join('\n');
                    response += `\n\n**Sources:**\n${sourceLinks}`;
                }

                if (response.length > 1900) {
                    response = response.slice(0, 1900) + '...';
                }

                await message.reply(response);
            } catch (error) {
                console.error('[Terf] Legacy command error:', error);
                await message.reply('❌ Wiki system error. Please try again.');
            }
            return true;
        }
    }
};

// Build alias map
const aliasMap = new Map();
for (const [cmd, data] of Object.entries(legacyCommands)) {
    if (data.aliases) {
        for (const alias of data.aliases) {
            aliasMap.set(alias, cmd);
        }
    }
}

/**
 * Handle legacy command from message
 * @param {Message} message - Discord message
 * @param {Client} client - Discord client
 * @returns {boolean} - Whether command was handled
 */
async function handleLegacyCommand(message, client) {
    const content = message.content.trim();

    // Check for *j prefix
    if (!content.toLowerCase().startsWith(LEGACY_PREFIX)) {
        return false;
    }

    // Parse command and args
    const withoutPrefix = content.slice(LEGACY_PREFIX.length).trim();
    if (!withoutPrefix) {
        await legacyCommands.help.execute(message, [], client);
        return true;
    }

    const parts = withoutPrefix.split(/\s+/);
    let commandName = (parts[0] || '').toLowerCase();
    const args = parts.slice(1);

    // Check aliases
    if (aliasMap.has(commandName)) {
        commandName = aliasMap.get(commandName);
    }

    // Find and execute command
    const command = legacyCommands[commandName];
    if (!command) {
        await message
            .reply('Unknown legacy command, sir. Use `*j help`.')
            .catch(() => { });
        return true;
    }

    // Check cooldown (skip for help/navigation commands)
    const noCooldownCommands = ['help', 'next', 'prev', 'ping'];
    if (!noCooldownCommands.includes(commandName)) {
        const cooldownLeft = checkCooldown(message.author.id, commandName);
        if (cooldownLeft > 0) {
            await message
                .reply(`⏰ Cooldown! Wait ${cooldownLeft}s before using this command again.`)
                .catch(() => { });
            return true;
        }
    }

    // Add loading reaction
    const LOADING_EMOJI = 'a:loading:1452765129652310056';
    let loadingReaction = null;

    try {
        loadingReaction = await message.react(LOADING_EMOJI).catch(() => null);
    } catch {
        // Ignore if can't react
    }

    try {
        await command.execute(message, args, client);

        // Remove loading reaction
        if (loadingReaction) {
            await loadingReaction.users.remove(client.user.id).catch(() => { });
        }

        return true;
    } catch (error) {
        console.error(`[LegacyCommands] Error executing ${commandName}:`, error);

        // Remove loading reaction on error too
        if (loadingReaction) {
            await loadingReaction.users.remove(client.user.id).catch(() => { });
        }

        await message.reply('Something went wrong executing that command, sir.').catch(() => { });
        return true;
    }
}

module.exports = {
    LEGACY_PREFIX,
    handleLegacyCommand,
    legacyCommands,
    generateRoast,
    // Re-export from stark-economy for backward compatibility
    getBalance: starkEconomy.getBalance,
    modifyBalance: starkEconomy.modifyBalance
};

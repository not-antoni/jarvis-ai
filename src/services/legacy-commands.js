/**
 * Legacy text-based commands for Jarvis AI
 * Prefix: *j
 *
 * These commands work when Message Content Intent is enabled
 * They mirror slash command functionality for users who prefer text commands
 */

const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const selfhostFeatures = require('./selfhost-features');
const starkEconomy = require('./stark-economy');
const starkTinker = require('./stark-tinker');
const funFeatures = require('./fun-features');
const moderation = require('./GUILDS_FEATURES/moderation');

const LEGACY_PREFIX = '*j';

// ============ COOLDOWN SYSTEM ============
const cooldowns = new Map();
const COOLDOWN_MS = 3000; // 3 second cooldown for most commands

function checkCooldown(userId, commandName) {
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
        title: '📜 Legacy Commands - Page 1/6',
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
        title: '📜 Legacy Commands - Page 2/6',
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
        title: '📜 Legacy Commands - Page 3/6',
        subtitle: 'Economy Commands',
        fields: [
            {
                name: '💰 **Economy**',
                value: '`*j balance` - Check balance\n`*j daily` - Claim daily reward\n`*j work` - Work for money\n`*j leaderboard` - View top richest',
                inline: false
            },
            {
                name: '🎰 **Gambling**',
                value: '`*j gamble <amt>` - Double or nothing\n`*j slots <bet>` - Slot machine\n`*j coinflip <bet> <h/t>` - Coin flip',
                inline: false
            }
        ]
    },
    {
        title: '📜 Legacy Commands - Page 4/6',
        subtitle: 'Minigames & Tinker',
        fields: [
            {
                name: '🏹 **Minigames**',
                value: '`*j hunt` - Hunt animals\n`*j fish` - Go fishing\n`*j dig` - Dig for treasure\n`*j beg` - Beg from Marvel characters',
                inline: false
            },
            {
                name: '🔧 **Tinker Lab**',
                value: '`*j tinker [recipe]` - Craft MCU items\n`*j recipes [rarity]` - View all recipes\n`*j contract` - Stark Industries contracts',
                inline: false
            }
        ]
    },
    {
        title: '📜 Legacy Commands - Page 5/6',
        subtitle: 'Shop & Arc Reactor',
        fields: [
            {
                name: '🛒 **Shop**',
                value: '`*j shop` - View shop\n`*j buy <item>` - Buy an item\n`*j inventory` - View your items',
                inline: false
            },
            {
                name: '💠 **Arc Reactor**',
                value: '`*j reactor` - Check Arc Reactor status\n`*j buy arc_reactor` - Buy for 10,000💵\n*Perks: +15% earnings, -25% cooldowns, +5% luck*',
                inline: false
            }
        ]
    },
    {
        title: '📜 Legacy Commands - Page 6/6',
        subtitle: 'Utility & Moderation',
        fields: [
            {
                name: '⚙️ **Utility**',
                value: '`*j help` - Show help (paginated)\n`*j next` / `*j prev` - Navigate pages\n`*j ping` - Check latency\n`*j remind in <time> <msg>` - Set reminder',
                inline: false
            },
            {
                name: '🛡️ **Moderation**',
                value: '`*j kick @user [reason]` - Kick a member\n`*j enable moderation` - Enable AI moderation\n`*j moderation status` - View mod settings',
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
    // Help command (paginated)
    help: {
        description: 'Show available legacy commands',
        usage: '*j help',
        execute: async (message, args) => {
            const pageNum = parseInt(args[0]) || 1;
            const pageIndex = Math.max(0, Math.min(pageNum - 1, HELP_PAGES.length - 1));
            helpPages.set(message.author.id, pageIndex);

            const page = HELP_PAGES[pageIndex];
            const embed = new EmbedBuilder()
                .setTitle(page.title)
                .setDescription(
                    `**${page.subtitle}**\nText commands for when you're feeling retro, sir.`
                )
                .setColor(0x3498db)
                .setFooter({
                    text: `Use *j next / *j prev to navigate • Page ${pageIndex + 1}/${HELP_PAGES.length}`
                });

            page.fields.forEach(f => embed.addFields(f));

            await message.reply({ embeds: [embed] });
            return true;
        }
    },

    // Next page
    next: {
        description: 'Next help page',
        usage: '*j next',
        execute: async (message, args) => {
            const current = helpPages.get(message.author.id) || 0;
            const next = Math.min(current + 1, HELP_PAGES.length - 1);
            helpPages.set(message.author.id, next);

            const page = HELP_PAGES[next];
            const embed = new EmbedBuilder()
                .setTitle(page.title)
                .setDescription(`**${page.subtitle}**`)
                .setColor(0x3498db)
                .setFooter({
                    text: `Use *j next / *j prev to navigate • Page ${next + 1}/${HELP_PAGES.length}`
                });

            page.fields.forEach(f => embed.addFields(f));
            await message.reply({ embeds: [embed] });
            return true;
        }
    },

    // Previous page
    prev: {
        description: 'Previous help page',
        usage: '*j prev',
        aliases: ['previous', 'back'],
        execute: async (message, args) => {
            const current = helpPages.get(message.author.id) || 0;
            const prev = Math.max(current - 1, 0);
            helpPages.set(message.author.id, prev);

            const page = HELP_PAGES[prev];
            const embed = new EmbedBuilder()
                .setTitle(page.title)
                .setDescription(`**${page.subtitle}**`)
                .setColor(0x3498db)
                .setFooter({
                    text: `Use *j next / *j prev to navigate • Page ${prev + 1}/${HELP_PAGES.length}`
                });

            page.fields.forEach(f => embed.addFields(f));
            await message.reply({ embeds: [embed] });
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
            const embed = new EmbedBuilder()
                .setTitle('💰 Stark Bucks Balance')
                .setDescription(`You have **${stats.balance}** Stark Bucks, sir.`)
                .setColor(0xf1c40f)
                .addFields(
                    { name: '📈 Total Earned', value: `${stats.totalEarned}`, inline: true },
                    { name: '📉 Total Lost', value: `${stats.totalLost}`, inline: true },
                    { name: '🎰 Win Rate', value: `${stats.winRate}%`, inline: true },
                    { name: '🔥 Daily Streak', value: `${stats.dailyStreak} days`, inline: true }
                )
                .setFooter({ text: 'Stark Industries Financial Division' });

            await message.reply({ embeds: [embed] });
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

            const lines = lb
                .map(u => {
                    const badge = u.hasVipBadge ? '⭐ ' : '';
                    const gold = u.hasGoldenName ? '✨' : '';
                    return `**#${u.rank}** ${badge}${gold}${u.username || 'Unknown'}${gold} - **${u.balance}** 💵`;
                })
                .join('\n');

            const embed = new EmbedBuilder()
                .setTitle('🏆 Stark Bucks Leaderboard')
                .setDescription(lines)
                .setColor(0xf1c40f)
                .setFooter({ text: 'Top 10 richest users' });

            await message.reply({ embeds: [embed] });
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
                    await channel.send(`⏰ <@${userId}> Reminder: ${reminderText}`);
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

    // ============ MODERATION COMMANDS (Admin/Owner Only) ============
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
                // Show available recipes
                const recipes = starkTinker.getAllRecipes().slice(0, 15);
                const recipeList = recipes.map(r => 
                    `**${r.name}** (${r.rarity}) - ${Object.entries(r.ingredients).map(([k, v]) => `${v}x ${k}`).join(', ')}`
                ).join('\n');
                
                const embed = new EmbedBuilder()
                    .setTitle('🔧 Stark Industries Tinker Lab')
                    .setDescription(`Combine materials from hunting, fishing, and digging to craft MCU items!\n\n**Sample Recipes:**\n${recipeList}\n\n*Use \`*j tinker <recipe_id>\` to craft*\n*Use \`*j recipes\` to see all ${starkTinker.getAllRecipes().length} recipes*`)
                    .setColor(0xe74c3c)
                    .setFooter({ text: 'Collect materials with *j hunt, *j fish, *j dig' });
                
                await message.reply({ embeds: [embed] });
                return true;
            }
            
            const recipe = starkTinker.getRecipe(recipeName);
            if (!recipe) {
                await message.reply(`❌ Unknown recipe: \`${recipeName}\`. Use \`*j tinker\` to see available recipes.`);
                return true;
            }
            
            // TODO: Check if user has materials and craft
            await message.reply(`🔧 **${recipe.name}**\n${recipe.description}\n\n**Ingredients:** ${Object.entries(recipe.ingredients).map(([k, v]) => `${v}x ${k}`).join(', ')}\n**Value:** ${recipe.value} Stark Bucks\n**Rarity:** ${recipe.rarity}\n\n*Crafting system coming soon!*`);
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
            .catch(() => {});
        return true;
    }

    // Check cooldown (skip for help/navigation commands)
    const noCooldownCommands = ['help', 'next', 'prev', 'ping'];
    if (!noCooldownCommands.includes(commandName)) {
        const cooldownLeft = checkCooldown(message.author.id, commandName);
        if (cooldownLeft > 0) {
            await message
                .reply(`⏰ Cooldown! Wait ${cooldownLeft}s before using this command again.`)
                .catch(() => {});
            return true;
        }
    }

    try {
        await command.execute(message, args, client);
        return true;
    } catch (error) {
        console.error(`[LegacyCommands] Error executing ${commandName}:`, error);
        await message.reply('Something went wrong executing that command, sir.').catch(() => {});
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

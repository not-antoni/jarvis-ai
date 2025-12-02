/**
 * Legacy text-based commands for Jarvis AI
 * Prefix: .j
 * 
 * These commands work when Message Content Intent is enabled
 * They mirror slash command functionality for users who prefer text commands
 */

const { EmbedBuilder } = require('discord.js');
const selfhostFeatures = require('./selfhost-features');
const starkEconomy = require('./stark-economy');

const LEGACY_PREFIX = '.j';

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
    const match = timeStr.match(/in\s+(\d+)\s*(min|minute|minutes|hour|hours|h|m|second|seconds|s)/i);
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
    // Help command
    help: {
        description: 'Show available legacy commands',
        usage: '.j help',
        execute: async (message, args) => {
            const embed = new EmbedBuilder()
                .setTitle('📜 Legacy Commands')
                .setDescription('Text commands for when you\'re feeling retro, sir.')
                .setColor(0x3498db)
                .addFields(
                    { name: '🎮 **Fun**', value: '`.j rapbattle` `.j roast @user` `.j soul`', inline: false },
                    { name: '💰 **Economy**', value: '`.j balance` `.j daily` `.j work`', inline: false },
                    { name: '🎰 **Gambling**', value: '`.j gamble <amt>` `.j slots <bet>` `.j coinflip <bet> <h/t>`', inline: false },
                    { name: '🛒 **Shop**', value: '`.j shop` `.j buy <item>` `.j leaderboard`', inline: false },
                    { name: '⚙️ **Utility**', value: '`.j help` `.j ping` `.j remind in <time> <msg>`', inline: false }
                )
                .setFooter({ text: 'Legacy commands require Message Content Intent' });
            
            await message.reply({ embeds: [embed] });
            return true;
        }
    },
    
    // Ping command
    ping: {
        description: 'Check bot latency',
        usage: '.j ping',
        execute: async (message, args, client) => {
            const latency = Date.now() - message.createdTimestamp;
            const apiLatency = Math.round(client.ws.ping);
            await message.reply(`🏓 Pong! Latency: ${latency}ms | API: ${apiLatency}ms`);
            return true;
        }
    },
    
    // Rap battle
    rapbattle: {
        description: 'Challenge Jarvis to a rap battle',
        usage: '.j rapbattle <your bars>',
        execute: async (message, args) => {
            const bars = args.join(' ').trim();
            if (!bars) {
                await message.reply('Drop some bars first, human! 🎤 Usage: `.j rapbattle <your rap>`');
                return true;
            }
            
            const username = message.author.displayName || message.author.username;
            const battle = selfhostFeatures.processRapBattle(bars, username);
            
            const embed = new EmbedBuilder()
                .setTitle('🎤 HUMANOID vs HUMAN 🎤')
                .setDescription('*Who\'s the fastest rapper?*')
                .setColor(0xff6b6b)
                .addFields(
                    { name: '👤 Your Attempt', value: `> ${bars.substring(0, 200)}${bars.length > 200 ? '...' : ''}`, inline: false },
                    { name: '🤖 JARVIS Counter-Rap', value: battle.counterRap, inline: false },
                    { name: '🏆 Verdict', value: battle.verdict, inline: false }
                )
                .setFooter({ text: '🎤 HUMANOID vs HUMAN • Rap Battle System' })
                .setTimestamp();
            
            selfhostFeatures.jarvisSoul.evolve('roast', 'positive');
            await message.reply({ embeds: [embed] });
            return true;
        }
    },
    
    // Soul status
    soul: {
        description: 'View Jarvis artificial soul',
        usage: '.j soul',
        execute: async (message, args) => {
            const soulStatus = selfhostFeatures.jarvisSoul.getStatus();
            
            const traitLines = Object.entries(soulStatus.traits)
                .map(([trait, value]) => {
                    const bar = '█'.repeat(Math.floor(value / 10)) + '░'.repeat(10 - Math.floor(value / 10));
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
                    { name: '📊 Evolution Events', value: String(soulStatus.evolutionCount), inline: true },
                    { name: '🧬 Personality Traits', value: traitLines || 'Calibrating...', inline: false }
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
        usage: '.j roast @user',
        execute: async (message, args) => {
            const target = message.mentions.users.first();
            if (!target) {
                await message.reply('Please mention someone to roast, sir. Usage: `.j roast @user`');
                return true;
            }
            
            if (target.id === message.client.user.id) {
                await message.reply('I appreciate the ambition, sir, but self-deprecation is beneath my programming.');
                return true;
            }
            
            const roast = generateRoast(target.displayName || target.username, message.author.username);
            
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
        usage: '.j balance',
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
        usage: '.j daily',
        execute: async (message, args) => {
            const result = await starkEconomy.claimDaily(message.author.id, message.author.username);
            
            if (!result.success) {
                const hours = Math.floor(result.cooldown / (60 * 60 * 1000));
                const minutes = Math.floor((result.cooldown % (60 * 60 * 1000)) / (60 * 1000));
                await message.reply(`⏰ You've already claimed today, sir. Come back in ${hours}h ${minutes}m.`);
                return true;
            }
            
            const embed = new EmbedBuilder()
                .setTitle('💰 Daily Reward Claimed!')
                .setDescription(`You received **${result.reward}** Stark Bucks!${result.doubled ? ' (DOUBLED!)' : ''}\nNew balance: **${result.newBalance}** 💵`)
                .setColor(0x2ecc71)
                .addFields(
                    { name: '🔥 Streak', value: `${result.streak} days (+${result.streakBonus} bonus)`, inline: true }
                )
                .setFooter({ text: 'Come back tomorrow to keep your streak!' });
            
            await message.reply({ embeds: [embed] });
            return true;
        }
    },
    
    // Work for money
    work: {
        description: 'Work at Stark Industries',
        usage: '.j work',
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
        usage: '.j gamble <amount>',
        aliases: ['bet'],
        execute: async (message, args) => {
            const amount = parseInt(args[0]);
            
            if (!amount || amount < 1) {
                await message.reply('Usage: `.j gamble <amount>`');
                return true;
            }
            
            const result = await starkEconomy.gamble(message.author.id, amount);
            
            if (!result.success) {
                await message.reply(`❌ ${result.error}`);
                return true;
            }
            
            const embed = new EmbedBuilder()
                .setTitle(result.won ? '🎰 You Won!' : '🎰 You Lost!')
                .setDescription(result.won 
                    ? `Congratulations! You won **${result.amount}** Stark Bucks!`
                    : `Better luck next time. You lost **${result.amount}** Stark Bucks.`)
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
        usage: '.j slots <bet>',
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
        usage: '.j coinflip <bet> <heads/tails>',
        aliases: ['cf', 'flip'],
        execute: async (message, args) => {
            const bet = parseInt(args[0]);
            const choice = (args[1] || '').toLowerCase();
            
            if (!bet || !['heads', 'tails', 'h', 't'].includes(choice)) {
                await message.reply('Usage: `.j coinflip <bet> <heads/tails>`');
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
                .setDescription(`The coin landed on **${result.result.toUpperCase()}**!\n\nYou chose **${result.choice}** - ${result.won ? '**YOU WIN!**' : 'You lose.'}`)
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
        usage: '.j shop',
        aliases: ['store'],
        execute: async (message, args) => {
            const items = starkEconomy.getShopItems();
            
            const itemList = items.map(item => 
                `**${item.name}** - ${item.price} 💵\n> ${item.description}`
            ).join('\n\n');
            
            const embed = new EmbedBuilder()
                .setTitle('🛒 Stark Industries Shop')
                .setDescription(itemList)
                .setColor(0x9b59b6)
                .setFooter({ text: 'Use .j buy <item_id> to purchase' });
            
            await message.reply({ embeds: [embed] });
            return true;
        }
    },
    
    // Buy item
    buy: {
        description: 'Buy an item from the shop',
        usage: '.j buy <item_id>',
        aliases: ['purchase'],
        execute: async (message, args) => {
            const itemId = args[0]?.toLowerCase();
            
            if (!itemId) {
                await message.reply('Usage: `.j buy <item_id>` (e.g., `.j buy lucky_charm`)');
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
        usage: '.j leaderboard',
        aliases: ['lb', 'top', 'rich'],
        execute: async (message, args) => {
            const lb = await starkEconomy.getLeaderboard(10);
            
            if (!lb.length) {
                await message.reply('No data yet, sir.');
                return true;
            }
            
            const lines = lb.map(u => {
                const badge = u.hasVipBadge ? '⭐ ' : '';
                const gold = u.hasGoldenName ? '✨' : '';
                return `**#${u.rank}** ${badge}${gold}${u.username || 'Unknown'}${gold} - **${u.balance}** 💵`;
            }).join('\n');
            
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
        usage: '.j remind in <time> <message>',
        aliases: ['reminder', 'schedule'],
        execute: async (message, args) => {
            const fullArgs = args.join(' ');
            const timeMatch = fullArgs.match(/in\s+(\d+)\s*(min|minute|minutes|hour|hours|h|m|second|seconds|s)/i);
            
            if (!timeMatch) {
                await message.reply('Usage: `.j remind in <time> <message>`\nExample: `.j remind in 5 minutes check the oven`');
                return true;
            }
            
            const ms = parseScheduleTime(fullArgs);
            if (!ms || ms > 24 * 60 * 60 * 1000) {
                await message.reply('Invalid time, sir. Maximum is 24 hours.');
                return true;
            }
            
            const reminderText = fullArgs.replace(timeMatch[0], '').trim() || 'Time\'s up!';
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
            await message.reply(`⏰ Got it, sir. I'll remind you in ${timeAmount} ${timeUnit}: "${reminderText}"`);
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
    
    // Check for .j prefix
    if (!content.toLowerCase().startsWith(LEGACY_PREFIX)) {
        return false;
    }
    
    // Parse command and args
    const withoutPrefix = content.slice(LEGACY_PREFIX.length).trim();
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
        // Unknown command - could show help or ignore
        return false;
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

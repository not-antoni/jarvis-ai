/**
 * Legacy text-based commands for Jarvis AI
 * Prefix: .j
 * 
 * These commands work when Message Content Intent is enabled
 * They mirror slash command functionality for users who prefer text commands
 */

const { EmbedBuilder } = require('discord.js');
const selfhostFeatures = require('./selfhost-features');
const database = require('./database');

const LEGACY_PREFIX = '.j';

// Stark Bucks economy (in-memory for now, can be moved to MongoDB)
const starkBucksCache = new Map();

/**
 * Get user's Stark Bucks balance
 */
async function getBalance(userId) {
    if (starkBucksCache.has(userId)) {
        return starkBucksCache.get(userId);
    }
    // Could load from database here
    const defaultBalance = 100; // New users start with 100 Stark Bucks
    starkBucksCache.set(userId, defaultBalance);
    return defaultBalance;
}

/**
 * Modify user's Stark Bucks balance
 */
async function modifyBalance(userId, amount) {
    const current = await getBalance(userId);
    const newBalance = Math.max(0, current + amount);
    starkBucksCache.set(userId, newBalance);
    return newBalance;
}

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
                    { name: '`.j help`', value: 'Show this help', inline: true },
                    { name: '`.j ping`', value: 'Check latency', inline: true },
                    { name: '`.j rapbattle <bars>`', value: 'Challenge me to a rap battle', inline: true },
                    { name: '`.j soul`', value: 'View my artificial soul', inline: true },
                    { name: '`.j roast @user`', value: 'Roast someone with class', inline: true },
                    { name: '`.j balance`', value: 'Check your Stark Bucks', inline: true },
                    { name: '`.j daily`', value: 'Claim daily Stark Bucks', inline: true },
                    { name: '`.j gamble <amount>`', value: 'Gamble your Stark Bucks', inline: true },
                    { name: '`.j remind <time> <msg>`', value: 'Set a reminder', inline: true }
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
            const balance = await getBalance(message.author.id);
            const embed = new EmbedBuilder()
                .setTitle('💰 Stark Bucks Balance')
                .setDescription(`You have **${balance}** Stark Bucks, sir.`)
                .setColor(0xf1c40f)
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
            const userId = message.author.id;
            const lastDailyKey = `daily_${userId}`;
            const lastDaily = starkBucksCache.get(lastDailyKey) || 0;
            const now = Date.now();
            const dayMs = 24 * 60 * 60 * 1000;
            
            if (now - lastDaily < dayMs) {
                const remaining = dayMs - (now - lastDaily);
                const hours = Math.floor(remaining / (60 * 60 * 1000));
                const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
                await message.reply(`⏰ You've already claimed today, sir. Come back in ${hours}h ${minutes}m.`);
                return true;
            }
            
            const reward = 50 + Math.floor(Math.random() * 50); // 50-100 Stark Bucks
            const newBalance = await modifyBalance(userId, reward);
            starkBucksCache.set(lastDailyKey, now);
            
            const embed = new EmbedBuilder()
                .setTitle('💰 Daily Reward Claimed!')
                .setDescription(`You received **${reward}** Stark Bucks!\nNew balance: **${newBalance}** 💵`)
                .setColor(0x2ecc71)
                .setFooter({ text: 'Come back tomorrow for more!' });
            
            await message.reply({ embeds: [embed] });
            return true;
        }
    },
    
    // Gamble
    gamble: {
        description: 'Gamble your Stark Bucks',
        usage: '.j gamble <amount>',
        aliases: ['bet'],
        execute: async (message, args) => {
            const userId = message.author.id;
            const amount = parseInt(args[0]);
            
            if (!amount || amount < 1) {
                await message.reply('Please specify an amount to gamble, sir. Usage: `.j gamble <amount>`');
                return true;
            }
            
            const balance = await getBalance(userId);
            if (amount > balance) {
                await message.reply(`Insufficient funds, sir. You only have **${balance}** Stark Bucks.`);
                return true;
            }
            
            // 45% chance to win (house edge)
            const won = Math.random() < 0.45;
            const winnings = won ? amount : -amount;
            const newBalance = await modifyBalance(userId, winnings);
            
            const embed = new EmbedBuilder()
                .setTitle(won ? '🎰 You Won!' : '🎰 You Lost!')
                .setDescription(won 
                    ? `Congratulations! You won **${amount}** Stark Bucks!\nNew balance: **${newBalance}** 💵`
                    : `Better luck next time, sir. You lost **${amount}** Stark Bucks.\nNew balance: **${newBalance}** 💵`)
                .setColor(won ? 0x2ecc71 : 0xe74c3c)
                .setFooter({ text: 'The house always... mostly wins.' });
            
            selfhostFeatures.jarvisSoul.evolve(won ? 'helpful' : 'chaos', 'neutral');
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
    getBalance,
    modifyBalance,
    generateRoast
};

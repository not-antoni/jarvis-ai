'use strict';

const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const starkEconomy = require('../stark-economy');
const selfhostFeatures = require('../selfhost-features');
const starkTinker = require('../stark-tinker');

const parseFormattedNumber = (str) => {
    if (!str) {return NaN;}
    str = String(str).trim().toUpperCase();
    if (str === 'ALL') {return NaN;}
    str = str.replace(/,/g, '').replace(/\s/g, '');
    const suffixes = { 'K': 1e3, 'M': 1e6, 'B': 1e9, 'T': 1e12, 'Q': 1e15 };
    const lastChar = str.slice(-1);
    if (suffixes[lastChar]) {
        const num = parseFloat(str.slice(0, -1));
        return isNaN(num) ? NaN : num * suffixes[lastChar];
    }
    return parseFloat(str);
};

const formatNum = (n) => {
    n = Math.floor(n);
    if (n >= 1e15) {return `${(n / 1e15).toFixed(2)  }Q`;}
    if (n >= 1e12) {return `${(n / 1e12).toFixed(2)  }T`;}
    if (n >= 1e9) {return `${(n / 1e9).toFixed(2)  }B`;}
    if (n >= 1e6) {return `${(n / 1e6).toFixed(2)  }M`;}
    if (n >= 1e3) {return `${(n / 1e3).toFixed(2)  }K`;}
    return n.toLocaleString('en-US');
};

// ============ SHARED HANDLERS (used by both /economy subcommands and standalone commands) ============

async function handleBalance(interaction) {
    const stats = await starkEconomy.getUserStats(interaction.user.id);
    const lb = await starkEconomy.getLeaderboard(100);
    const rankIndex = lb.findIndex(u => u.userId === interaction.user.id);
    const rank = rankIndex !== -1 ? rankIndex + 1 : null;
    const imageGenerator = require('../image-generator');
    const profileData = {
        username: interaction.user.username,
        avatar: interaction.user.displayAvatarURL({ extension: 'png', size: 256 }),
        balance: stats.balance,
        totalEarned: stats.totalEarned || 0,
        winRate: stats.winRate,
        rank: rank
    };
    try {
        const buffer = await imageGenerator.generateProfileImage(profileData);
        const attachment = new AttachmentBuilder(buffer, { name: 'balance.png' });
        return { files: [attachment] };
    } catch (err) {
        console.error('[Balance] Image generation failed:', err);
        return `**${interaction.user.username}**\n\u{1F4B0} Balance: **${stats.balance.toLocaleString()}** SB`;
    }
}

async function handleDaily(interaction) {
    const result = await starkEconomy.claimDaily(interaction.user.id, interaction.user.username);
    if (!result.success) {
        const hours = Math.floor(result.cooldown / (60 * 60 * 1000));
        const minutes = Math.floor((result.cooldown % (60 * 60 * 1000)) / (60 * 1000));
        return `\u23F0 You've already claimed today, sir. Come back in ${hours}h ${minutes}m.`;
    }
    const safeReward = Number.isFinite(Number(result.reward)) ? Math.floor(Number(result.reward)) : 0;
    const safeBalance = Number.isFinite(Number(result.newBalance)) ? Math.floor(Number(result.newBalance)) : 0;
    const safeStreak = Number.isFinite(Number(result.streak)) ? Math.floor(Number(result.streak)) : 0;
    const safeStreakBonus = Number.isFinite(Number(result.streakBonus)) ? Math.floor(Number(result.streakBonus)) : 0;
    const dailyEmbed = new EmbedBuilder()
        .setTitle('\u{1F4B0} Daily Reward Claimed!')
        .setDescription(`You received **${safeReward}** Stark Bucks!${result.doubled ? ' (DOUBLED!)' : ''}`)
        .setColor(0x2ecc71)
        .addFields(
            { name: '\u{1F525} Streak', value: `${safeStreak} days (+${safeStreakBonus} bonus)`, inline: true },
            { name: '\u{1F4B0} Balance', value: `${safeBalance}`, inline: true }
        )
        .setFooter({ text: 'Come back tomorrow to keep your streak!' });
    return { embeds: [dailyEmbed] };
}

async function handleWork(interaction) {
    const result = await starkEconomy.work(interaction.user.id, interaction.user.username);
    if (!result.success) {
        const cooldownMs = result.cooldown;
        const timeStr = cooldownMs < 60000
            ? `${Math.floor(cooldownMs / 1000)} seconds`
            : `${Math.floor(cooldownMs / (60 * 1000))} minutes`;
        return `\u23F0 You're tired, sir. Rest for ${timeStr} more.`;
    }
    const workBoost = starkEconomy.getBoostText();
    const workEmbed = new EmbedBuilder()
        .setTitle('\u{1F4BC} Work Complete!')
        .setDescription(`You ${result.job} and earned **${result.reward}** Stark Bucks!${workBoost}`)
        .setColor(0x3498db)
        .addFields({ name: '\u{1F4B0} Balance', value: `${result.newBalance}`, inline: true })
        .setFooter({ text: 'Stark Industries HR Department' });
    return { embeds: [workEmbed] };
}

async function handleGamble(interaction) {
    const amountInput = interaction.options.getString('amount');
    let amount = parseFormattedNumber(amountInput);
    if (amountInput?.toLowerCase() === 'all') {
        const bal = await starkEconomy.getBalance(interaction.user.id);
        amount = bal || 0;
    }
    if (isNaN(amount) || amount < 1) {
        return '\u274C Invalid amount. Use a number like 100, 5K, 1M, or "all"';
    }
    const result = await starkEconomy.gamble(interaction.user.id, Math.floor(amount));
    if (!result.success) {
        return `\u274C ${result.error}`;
    }
    const gambleEmbed = new EmbedBuilder()
        .setTitle(result.won ? '\u{1F3B0} You Won!' : '\u{1F3B0} You Lost!')
        .setDescription(result.won
            ? `Congratulations! You won **${formatNum(result.amount)}** Stark Bucks!`
            : `Better luck next time. You lost **${formatNum(result.amount)}** Stark Bucks.`)
        .setColor(result.won ? 0x2ecc71 : 0xe74c3c)
        .addFields({ name: '\u{1F4B0} Balance', value: `${formatNum(result.newBalance)}`, inline: true })
        .setFooter({ text: `Win rate: ${result.winRate}%` });
    selfhostFeatures.jarvisSoul.evolve(result.won ? 'helpful' : 'chaos', 'neutral');
    return { embeds: [gambleEmbed] };
}

async function handleSlots(interaction) {
    const betInput = interaction.options.getString('bet');
    let bet = parseFormattedNumber(betInput);
    if (betInput?.toLowerCase() === 'all') {
        const bal = await starkEconomy.getBalance(interaction.user.id);
        bet = bal || 0;
    }
    if (isNaN(bet) || bet < 10) {
        return '\u274C Invalid bet. Minimum 10. Use a number like 100, 5K, 1M, or "all"';
    }
    const result = await starkEconomy.playSlots(interaction.user.id, Math.floor(bet));
    if (!result.success) {
        return `\u274C ${result.error}`;
    }
    const slotDisplay = result.results.join(' | ');
    let resultText = '';
    if (result.resultType === 'jackpot') {resultText = '\u{1F48E} JACKPOT! \u{1F48E}';}
    else if (result.resultType === 'triple') {resultText = '\u{1F389} TRIPLE!';}
    else if (result.resultType === 'double') {resultText = '\u2728 Double!';}
    else {resultText = '\u{1F622} No match';}
    const slotsEmbed = new EmbedBuilder()
        .setTitle('\u{1F3B0} Slot Machine')
        .setDescription(`**[ ${slotDisplay} ]**\n\n${resultText}`)
        .setColor(result.change > 0 ? 0x2ecc71 : 0xe74c3c)
        .addFields(
            { name: '\u{1F4B5} Bet', value: `${formatNum(result.bet)}`, inline: true },
            { name: '\u{1F4B0} Won', value: `${formatNum(result.winnings)}`, inline: true },
            { name: '\u{1F3E6} Balance', value: `${formatNum(result.newBalance)}`, inline: true }
        )
        .setFooter({ text: `Multiplier: x${result.multiplier}` });
    return { embeds: [slotsEmbed] };
}

async function handleCoinflip(interaction) {
    const cfBetInput = interaction.options.getString('bet');
    let cfBet = parseFormattedNumber(cfBetInput);
    if (cfBetInput?.toLowerCase() === 'all') {
        const bal = await starkEconomy.getBalance(interaction.user.id);
        cfBet = bal || 0;
    }
    if (isNaN(cfBet) || cfBet < 1) {
        return '\u274C Invalid bet. Use a number like 100, 5K, 1M, or "all"';
    }
    const choice = interaction.options.getString('choice');
    const result = await starkEconomy.coinflip(interaction.user.id, Math.floor(cfBet), choice);
    if (!result.success) {
        return `\u274C ${result.error}`;
    }
    const coinEmoji = result.result === 'heads' ? '\u{1FA99}' : '\u2B55';
    const cfEmbed = new EmbedBuilder()
        .setTitle(`${coinEmoji} Coinflip`)
        .setDescription(`The coin landed on **${result.result.toUpperCase()}**!\n\nYou chose **${result.choice}** - ${result.won ? '**YOU WIN!**' : 'You lose.'}`)
        .setColor(result.won ? 0x2ecc71 : 0xe74c3c)
        .addFields({ name: '\u{1F4B0} Balance', value: `${formatNum(result.newBalance)}`, inline: true })
        .setFooter({ text: '50/50 chance' });
    return { embeds: [cfEmbed] };
}

async function handleShop(interaction) {
    const items = starkEconomy.getShopItems();
    const itemList = items.map(item =>
        `**${item.name}** - ${item.price} \u{1F4B5}\n> ${item.description}`
    ).join('\n\n');
    const shopEmbed = new EmbedBuilder()
        .setTitle('\u{1F6D2} Stark Industries Shop')
        .setDescription(itemList)
        .setColor(0x9b59b6)
        .setFooter({ text: 'Use /economy buy <item> to purchase' });
    return { embeds: [shopEmbed] };
}

async function handleBuy(interaction) {
    const itemId = interaction.options.getString('item');
    const result = await starkEconomy.buyItem(interaction.user.id, itemId);
    if (!result.success) {
        return `\u274C ${result.error}`;
    }
    const buyEmbed = new EmbedBuilder()
        .setTitle('\u{1F6D2} Purchase Successful!')
        .setDescription(`You bought **${result.item.name}**!`)
        .setColor(0x2ecc71)
        .addFields({ name: '\u{1F4B0} Balance', value: `${result.newBalance}`, inline: true })
        .setFooter({ text: 'Thank you for shopping at Stark Industries' });
    return { embeds: [buyEmbed] };
}

async function handleLeaderboard(interaction) {
    const lb = await starkEconomy.getLeaderboard(10, interaction.client);
    if (!lb.length) {
        return 'No data yet, sir.';
    }
    const imageGenerator = require('../image-generator');
    const enrichedLb = await Promise.all(lb.map(async(u) => {
        let avatarUrl = null;
        let username = u.username || 'Unknown';
        try {
            const user = await interaction.client.users.fetch(u.userId);
            avatarUrl = user.displayAvatarURL({ extension: 'png', size: 128 });
            username = user.username;
        } catch (e) {}
        return { ...u, avatar: avatarUrl, username };
    }));
    const buffer = await imageGenerator.generateLeaderboardImage(enrichedLb);
    const attachment = new AttachmentBuilder(buffer, { name: 'leaderboard.png' });
    return { files: [attachment] };
}

async function handleGive(interaction) {
    const targetUser = interaction.options.getUser('user');
    const giveAmount = interaction.options.getInteger('amount');
    if (targetUser.bot) {
        return '\u274C Cannot give money to bots, sir.';
    }
    const giveResult = await starkEconomy.give(
        interaction.user.id,
        targetUser.id,
        giveAmount,
        interaction.user.username,
        targetUser.username
    );
    if (!giveResult.success) {
        return `\u274C ${giveResult.error}`;
    }
    const giveEmbed = new EmbedBuilder()
        .setTitle('\u{1F4B8} Transfer Complete!')
        .setDescription(`You gave **${giveResult.amount}** Stark Bucks to **${targetUser.username}**!`)
        .setColor(0x2ecc71)
        .addFields(
            { name: 'Your Balance', value: `${giveResult.fromBalance}`, inline: true },
            { name: `${targetUser.username}'s Balance`, value: `${giveResult.toBalance}`, inline: true }
        )
        .setFooter({ text: 'Generosity is a virtue!' });
    return { embeds: [giveEmbed] };
}

async function handleBlackjack(interaction) {
    const bet = interaction.options.getInteger('bet');
    if (bet < 10) {
        return '\u274C Minimum bet is 10 Stark Bucks.';
    }
    const result = await starkEconomy.playBlackjack(interaction.user.id, bet);
    if (!result.success) {
        return `\u274C ${result.error}`;
    }
    const playerHandStr = result.playerHand.map(c => c.display).join(' ');
    const dealerHandStr = result.dealerHand.map(c => c.display).join(' ');
    const color = result.winnings > 0 ? 0x2ecc71 : (result.winnings < 0 ? 0xe74c3c : 0xf1c40f);
    const embed = new EmbedBuilder()
        .setTitle('\u{1F0CF} Blackjack')
        .setColor(color)
        .addFields(
            { name: `Your Hand (${result.playerValue})`, value: playerHandStr, inline: true },
            { name: `Dealer (${result.dealerValue})`, value: dealerHandStr, inline: true },
            { name: 'Result', value: `${result.result}\n${result.winnings >= 0 ? '+' : ''}${result.winnings} Stark Bucks`, inline: false },
            { name: '\u{1F4B0} Balance', value: `${result.newBalance}`, inline: true }
        );
    return { embeds: [embed] };
}

async function handleRob(interaction) {
    const target = interaction.options.getUser('user') || interaction.options.getUser('target');
    if (!target) {
        return '\u274C You must specify who to rob!';
    }
    if (target.id === interaction.user.id) {
        return '\u{1F914} You can\'t rob yourself!';
    }
    if (target.bot) {
        return '\u{1F916} You can\'t rob bots!';
    }
    const result = await starkEconomy.rob(interaction.user.id, target.id, interaction.user.username);
    if (result.cooldown) {
        const remaining = Math.ceil(result.cooldown / 1000);
        return `\u{1F46E} **POLICE ALERT!**\nYou are laying low. Try robbing again in ${remaining}s.`;
    }
    if (!result.success) {
        return `\u274C ${result.error || result.message}`;
    }
    const embed = new EmbedBuilder()
        .setTitle(result.caught ? '\u{1F9B9} Robbery Failed!' : (result.stolen > 0 ? '\u{1F4B0} Robbery Successful!' : '\u{1F9B9} Robbery'))
        .setColor(result.caught || result.stolen <= 0 ? 0xe74c3c : 0x2ecc71)
        .setDescription(result.message || (result.stolen > 0
            ? `You stole **${result.stolen}** Stark Bucks from ${target}!`
            : 'The robbery failed!'))
        .addFields({ name: '\u{1F4B0} Balance', value: `${result.newBalance}`, inline: true })
        .setFooter({ text: result.caught ? 'Busted!' : 'Crime doesn\'t always pay!' });
    return { embeds: [embed] };
}

async function handleLottery(interaction) {
    const buyTickets = interaction.options.getInteger('buy_tickets');
    if (buyTickets) {
        if (buyTickets < 1) {
            return '\u274C You must buy at least 1 ticket.';
        }
        const result = await starkEconomy.buyLotteryTickets(interaction.user.id, buyTickets);
        if (!result.success) {
            return `\u274C ${result.error}`;
        }
        return `\u{1F3AB}\uFE0F **Lottery:** Successfully purchased **${buyTickets}** tickets for **${result.cost}** Stark Bucks!\nYou now have ${result.totalTickets} tickets. Good luck!`;
    }
    const data = await starkEconomy.getLotteryData();
    const timeRemaining = Math.max(0, Math.ceil((data.drawTime - Date.now()) / 1000 / 60));
    const timeStr = timeRemaining > 60
        ? `${Math.floor(timeRemaining / 60)}h ${timeRemaining % 60}m`
        : `${timeRemaining}m`;
    const embed = new EmbedBuilder()
        .setTitle('\u{1F3B0} Stark Lottery')
        .setColor(0x9b59b6)
        .setDescription(`**Jackpot:** ${data.jackpot.toLocaleString()} Stark Bucks\n**Ticket Price:** ${data.ticketPrice} each`)
        .addFields(
            { name: 'Entries', value: `${data.totalTickets} tickets sold`, inline: true },
            { name: 'Draw In', value: timeStr, inline: true },
            { name: 'Last Winner', value: data.lastWinner ? `<@${data.lastWinner}>` : 'None', inline: false }
        )
        .setFooter({ text: 'Use /economy lottery buy_tickets:N to play' });
    return { embeds: [embed] };
}

// ============ ECONOMY SUBCOMMAND GROUP ============

async function handleEconomy(interaction) {
    const economySubcommand = interaction.options.getSubcommand();

    switch (economySubcommand) {
        case 'balance': return await handleBalance(interaction);
        case 'daily': return await handleDaily(interaction);
        case 'work': return await handleWork(interaction);
        case 'gamble': return await handleGamble(interaction);
        case 'slots': return await handleSlots(interaction);
        case 'coinflip': return await handleCoinflip(interaction);
        case 'shop': return await handleShop(interaction);
        case 'buy': return await handleBuy(interaction);
        case 'leaderboard': return await handleLeaderboard(interaction);
        case 'show': {
            // Economy show uses profile image (different from standalone show)
            const showUser = await starkEconomy.loadUser(interaction.user.id, interaction.user.username);
            const stats = await starkEconomy.getUserStats(interaction.user.id);
            const lb = await starkEconomy.getLeaderboard(100);
            const rankIndex = lb.findIndex(u => u.userId === interaction.user.id);
            const rank = rankIndex !== -1 ? rankIndex + 1 : null;
            const imageGenerator = require('../image-generator');
            const profileData = {
                username: interaction.user.username,
                avatar: interaction.user.displayAvatarURL({ extension: 'png', size: 256 }),
                balance: showUser.balance,
                totalEarned: showUser.totalEarned || 0,
                winRate: stats.winRate,
                rank: rank
            };
            try {
                const buffer = await imageGenerator.generateProfileImage(profileData);
                const attachment = new AttachmentBuilder(buffer, { name: 'profile.png' });
                return { files: [attachment] };
            } catch (err) {
                console.error('[Profile] Image generation failed:', err);
                return `**${interaction.user.username}**\n\u{1F4B0} Balance: **${showUser.balance.toLocaleString()}** SB`;
            }
        }
        case 'give': return await handleGive(interaction);
        case 'blackjack': return await handleBlackjack(interaction);
        case 'rob': return await handleRob(interaction);
        case 'lottery': return await handleLottery(interaction);
        default: return '\u274C Unknown economy subcommand.';
    }
}

// ============ STANDALONE SHOW (embed version with multiplier) ============

async function handleShow(interaction) {
    const showUser = await starkEconomy.loadUser(interaction.user.id, interaction.user.username);
    const multiplierStatus = starkEconomy.getMultiplierStatus();

    const showEmbed = new EmbedBuilder()
        .setTitle(`\u{1F4B0} ${interaction.user.username}'s Stark Bucks`)
        .setColor(0xf1c40f)
        .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
        .addFields(
            { name: '\u{1F4B5} Balance', value: `**${showUser.balance.toLocaleString()}** Stark Bucks`, inline: true },
            { name: '\u{1F4C8} Total Earned', value: `${(showUser.totalEarned || 0).toLocaleString()}`, inline: true },
            { name: '\u{1F3AE} Games Played', value: `${showUser.gamesPlayed || 0}`, inline: true },
            { name: '\u{1F3C6} Games Won', value: `${showUser.gamesWon || 0}`, inline: true },
            { name: '\u{1F525} Daily Streak', value: `${showUser.dailyStreak || 0} days`, inline: true }
        );

    if (multiplierStatus.active) {
        showEmbed.addFields({
            name: '\u{1F389} EVENT ACTIVE!',
            value: `**${multiplierStatus.multiplier}x MULTIPLIER (${multiplierStatus.multiplier * 100}%)!**`,
            inline: false
        });
    }

    showEmbed.setFooter({ text: 'Flex those Stark Bucks!' });
    return { embeds: [showEmbed] };
}

// ============ INVENTORY & TINKER ============

async function handleInventory(interaction) {
    const inventory = await starkEconomy.getInventory(interaction.user.id);
    const hasReactor = await starkEconomy.hasArcReactor(interaction.user.id);

    if (!inventory.length) {
        return 'Your inventory is empty, sir. Visit the shop with `/economy shop` or craft items with `/tinker craft`.';
    }

    const itemList = inventory.map(item => {
        const uses = item.uses ? ` (${item.uses} uses)` : '';
        return `\u2022 ${item.name}${uses}`;
    }).join('\n');

    const embed = new EmbedBuilder()
        .setTitle(`\u{1F392} ${interaction.user.username}'s Inventory`)
        .setDescription(itemList)
        .setColor(hasReactor ? 0x00d4ff : 0x9b59b6)
        .setFooter({ text: hasReactor ? '\u{1F4A0} Arc Reactor Owner - All perks active!' : 'Use /tinker craft to make items' });

    if (hasReactor) {
        embed.addFields({
            name: '\u{1F4A0} Arc Reactor Perks',
            value: '\u2022 +15% earnings\n\u2022 -25% cooldowns\n\u2022 +5% gambling luck\n\u2022 +500 daily bonus\n\u2022 +1% daily interest',
            inline: false
        });
    }

    return { embeds: [embed] };
}

async function handleTinker(interaction) {
    const tinkerSubcommand = interaction.options.getSubcommand();
    let response;

    switch (tinkerSubcommand) {
        case 'craft': {
            const recipeName = interaction.options.getString('recipe')?.toLowerCase();
            const recipe = starkTinker.getRecipe(recipeName);
            if (!recipe) {
                return `\u274C Unknown recipe: \`${recipeName}\`. Use \`/tinker recipes\` to see all recipes.`;
            }
            const result = await starkEconomy.craftItem(interaction.user.id, recipeName, recipe);
            if (!result.success) {
                const materials = await starkEconomy.getMaterials(interaction.user.id);
                const missing = Object.entries(recipe.ingredients)
                    .filter(([mat, req]) => (materials[mat] || 0) < req)
                    .map(([mat, req]) => `${req - (materials[mat] || 0)}x ${mat}`)
                    .join(', ');
                return `\u274C **Cannot craft ${recipe.name}**\n\nMissing: ${missing}\n\nCollect materials with \`/minigame hunt\`, \`/minigame fish\`, \`/minigame dig\``;
            }
            const rarityColors = { common: 0x95a5a6, uncommon: 0x2ecc71, rare: 0x3498db, epic: 0x9b59b6, legendary: 0xf1c40f };
            const embed = new EmbedBuilder()
                .setTitle('\u{1F527} Item Crafted!')
                .setDescription(`You crafted **${result.item}**!\n\n${recipe.description}`)
                .setColor(rarityColors[result.rarity] || 0x95a5a6)
                .addFields(
                    { name: 'Rarity', value: result.rarity.toUpperCase(), inline: true },
                    { name: 'Value', value: `${result.value} \u{1F4B5}`, inline: true }
                )
                .setFooter({ text: 'View with /inventory' });
            response = { embeds: [embed] };
            break;
        }
        case 'recipes': {
            const rarity = interaction.options.getString('rarity');
            let recipes = starkTinker.getAllRecipes();
            if (rarity) {recipes = recipes.filter(r => r.rarity === rarity);}
            if (recipes.length > 25) {recipes = recipes.slice(0, 25);}
            const recipeList = recipes.map(r =>
                `**${r.name}** (${r.rarity}) [ID: \`${r.id}\`]\n> ${Object.entries(r.ingredients).map(([k, v]) => `${v}x ${k}`).join(', ')}`
            ).join('\n');
            const embed = new EmbedBuilder()
                .setTitle(rarity ? `\u{1F527} ${rarity.charAt(0).toUpperCase() + rarity.slice(1)} Recipes` : '\u{1F527} Tinker Lab Recipes')
                .setDescription(recipeList || 'No recipes found.')
                .setColor(0xe74c3c)
                .setFooter({ text: 'Use /tinker craft <id> to craft' });
            response = { embeds: [embed] };
            break;
        }
        case 'materials': {
            const materials = await starkEconomy.getMaterials(interaction.user.id);
            const entries = Object.entries(materials);
            if (entries.length === 0) {
                return '\u{1F4E6} You have no materials yet!\n\nCollect them with `/minigame hunt`, `/minigame fish`, `/minigame dig`, `/minigame beg`';
            }
            entries.sort((a, b) => b[1] - a[1]);
            const materialList = entries.slice(0, 25).map(([name, qty]) => `${name}: **${qty}**`).join('\n');
            const embed = new EmbedBuilder()
                .setTitle(`\u{1F4E6} ${interaction.user.username}'s Materials`)
                .setDescription(materialList + (entries.length > 25 ? `\n\n*...and ${entries.length - 25} more*` : ''))
                .setColor(0x3498db)
                .setFooter({ text: `${entries.length} material types \u2022 Use /tinker craft` });
            response = { embeds: [embed] };
            break;
        }
        case 'sell': {
            const itemInput = interaction.options.getString('item')?.toLowerCase();
            const inventory = await starkEconomy.getInventory(interaction.user.id);
            const index = inventory.findIndex(i =>
                i.name.toLowerCase().includes(itemInput) ||
                (i.id && i.id.toLowerCase() === itemInput)
            );
            if (index === -1) {
                return `\u274C Could not find item "${itemInput}" in your inventory.`;
            }
            const result = await starkEconomy.sellItem(interaction.user.id, index);
            if (!result.success) {
                return `\u274C ${result.error}`;
            }
            const embed = new EmbedBuilder()
                .setTitle('\u{1F4B0} Item Sold')
                .setDescription(`You sold **${result.item}** for **${result.value}** Stark Bucks!`)
                .setColor(0x2ecc71)
                .addFields({ name: '\u{1F4B0} Balance', value: `${result.newBalance}`, inline: true });
            response = { embeds: [embed] };
            break;
        }
    }
    return response;
}

// ============ BOSS, SBX, QUESTS ============

async function handleBoss(interaction) {
    if (!interaction.guild) {
        return '\u274C Boss battles can only be done in a server, not DMs!';
    }
    const sub = interaction.options.getSubcommand();
    if (sub === 'status') {
        const boss = await starkEconomy.getBossData(interaction.guild.id);
        if (!boss.active) {return 'No active boss. Bosses spawn randomly!';}
        const hpPercent = Math.floor((boss.hp / boss.maxHp) * 100);
        const bar = '\u{1F7E5}'.repeat(Math.floor(hpPercent / 10)) + '\u2B1C'.repeat(10 - Math.floor(hpPercent / 10));
        return `\u{1F479} **${boss.name}** is attacking!\nHP: ${boss.hp}/${boss.maxHp} (${hpPercent}%)\n${bar}`;
    } else if (sub === 'attack') {
        const res = await starkEconomy.attackBoss(interaction.guild.id, interaction.user.id);
        if (!res.success) {return `\u274C ${res.error}`;}
        return `\u2694\uFE0F You dealt **${res.damage}** damage to **${res.bossName}**! Reward: ${res.reward} \u{1F4B5}`;
    }
}

async function handleSbx(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'market') {
        const data = await starkEconomy.getSBXMarketData();
        if (!data) {return '\u274C Market offline.';}
        const embed = new EmbedBuilder()
            .setTitle('\u{1F4C8} SBX Market')
            .setDescription(`Price: **${data.price}** Stark Bucks`)
            .setColor(0x3498db)
            .setFooter({ text: 'Invest in the future!' });
        return { embeds: [embed] };
    } else if (sub === 'buy') {
        const amount = interaction.options.getInteger('amount');
        const res = await starkEconomy.buySBX(interaction.user.id, amount);
        if (!res.success) {return `\u274C ${res.error}`;}
        return `\u2705 Bought **${amount} SBX** for **${res.cost}** Stark Bucks.`;
    } else if (sub === 'sell') {
        const amount = interaction.options.getInteger('amount');
        const res = await starkEconomy.sellSBX(interaction.user.id, amount);
        if (!res.success) {return `\u274C ${res.error}`;}
        return `\u2705 Sold **${amount} SBX** for **${res.earnings}** Stark Bucks.`;
    } else if (sub === 'invest') {
        const amount = interaction.options.getInteger('amount');
        const res = await starkEconomy.investSBX(interaction.user.id, amount);
        if (!res.success) {return `\u274C ${res.error}`;}
        return `\u{1F4BC} Invested **${amount} SBX**! Earning 0.5% daily.`;
    } else if (sub === 'withdraw') {
        const amount = interaction.options.getInteger('amount');
        const res = await starkEconomy.withdrawInvestment(interaction.user.id, amount);
        if (!res.success) {return `\u274C ${res.error}`;}
        return `\u{1F3E7} Withdrew **${res.withdrawn} SBX** from investment.`;
    }
}

async function handleQuests(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'list') {
        const quests = await starkEconomy.getAvailableQuests(interaction.user.id);
        if (!quests.length) {return 'No quests available.';}
        const list = quests.map(q => `**${q.name}** (${q.reward} \u{1F4B5}) [ID: ${q.id}]`).join('\n');
        return `\u{1F4DC} **Quests**\n${list}`;
    } else if (sub === 'start') {
        const id = interaction.options.getString('id');
        const res = await starkEconomy.startQuest(interaction.user.id, id);
        if (!res.success) {return `\u274C ${res.error}`;}
        return `\u2694\uFE0F Quest **${res.quest.name}** started! Good luck.`;
    }
}

// ============ MINIGAME SUBCOMMAND GROUP ============

async function handleMinigameAction(interaction, action, emoji, title, cooldownMsg, successMsg, failMsg) {
    const result = await starkEconomy[action](interaction.user.id);
    if (!result.success) {
        const cooldownMs = result.cooldown;
        const timeStr = cooldownMs < 60000
            ? `${Math.floor(cooldownMs / 1000)} seconds`
            : `${Math.floor(cooldownMs / (60 * 1000))} minutes`;
        return `${emoji} ${cooldownMsg.replace('{time}', timeStr)}`;
    }
    const boost = starkEconomy.getBoostText();
    const embed = new EmbedBuilder()
        .setTitle(`${emoji} ${title}`)
        .setDescription(result.reward > 0
            ? successMsg.replace('{outcome}', result.outcome).replace('{reward}', result.reward) + boost
            : failMsg.replace('{outcome}', result.outcome))
        .setColor(result.reward > 0 ? 0x2ecc71 : 0x95a5a6)
        .addFields({ name: '\u{1F4B0} Balance', value: `${result.newBalance}`, inline: true })
        .setFooter({ text: `${title} again in 1 minute` });
    return { embeds: [embed] };
}

async function handleHunt(interaction) {
    return handleMinigameAction(interaction, 'hunt', '\u{1F3F9}', 'Hunt Results',
        'You\'re tired from hunting. Rest for {time} more.',
        'You caught a **{outcome}**!\n+**{reward}** Stark Bucks',
        '{outcome}... The animals got away!');
}

async function handleFish(interaction) {
    return handleMinigameAction(interaction, 'fish', '\u{1F3A3}', 'Fishing Results',
        'Your fishing rod needs to dry. Wait {time} more.',
        'You caught a **{outcome}**!\n+**{reward}** Stark Bucks',
        '{outcome}... Nothing bit today!');
}

async function handleDig(interaction) {
    return handleMinigameAction(interaction, 'dig', '\u26CF\uFE0F', 'Dig Results',
        'Your shovel is broken. Wait {time} more.',
        'You found **{outcome}**!\n+**{reward}** Stark Bucks',
        '{outcome}... Nothing but dirt!');
}

async function handleBeg(interaction) {
    return handleMinigameAction(interaction, 'beg', '\u{1F64F}', 'Begging Results',
        'People are avoiding you. Try again in {time}.',
        '**{outcome}** **{reward}** Stark Bucks!',
        '{outcome}... Better luck next time!');
}

async function handleCrime(interaction) {
    const crimeResult = await starkEconomy.crime(interaction.user.id);
    if (!crimeResult.success) {
        const cooldownMs = crimeResult.cooldown;
        const timeStr = cooldownMs < 60000
            ? `${Math.floor(cooldownMs / 1000)} seconds`
            : `${Math.floor(cooldownMs / (60 * 1000))} minutes`;
        return `\u{1F694} Laying low after your last crime. Wait ${timeStr} more.`;
    }
    const crimeBoost = starkEconomy.getBoostText();
    const crimeEmbed = new EmbedBuilder()
        .setTitle('\u{1F52B} Crime Results')
        .setDescription(crimeResult.reward >= 0
            ? `**${crimeResult.outcome}**\n${crimeResult.reward > 0 ? `+**${crimeResult.reward}** Stark Bucks${crimeBoost}` : 'No reward this time...'}`
            : `**${crimeResult.outcome}**\n-**${Math.abs(crimeResult.reward)}** Stark Bucks`)
        .setColor(crimeResult.reward > 0 ? 0x2ecc71 : crimeResult.reward < 0 ? 0xe74c3c : 0x95a5a6)
        .addFields({ name: '\u{1F4B0} Balance', value: `${crimeResult.newBalance}`, inline: true })
        .setFooter({ text: 'Crime doesn\'t always pay!' });
    return { embeds: [crimeEmbed] };
}

async function handlePostmeme(interaction) {
    const memeResult = await starkEconomy.postmeme(interaction.user.id);
    if (!memeResult.success) {
        const cooldownMs = memeResult.cooldown;
        const timeStr = cooldownMs < 60000
            ? `${Math.floor(cooldownMs / 1000)} seconds`
            : `${Math.floor(cooldownMs / (60 * 1000))} minutes`;
        return `\u{1F4F1} Still waiting for engagement on your last post. Try again in ${timeStr}.`;
    }
    const memeBoost = starkEconomy.getBoostText();
    const memeEmbed = new EmbedBuilder()
        .setTitle('\u{1F4F1} Meme Posted!')
        .setDescription(memeResult.reward > 0
            ? `**${memeResult.outcome}**\n+**${memeResult.reward}** Stark Bucks${memeBoost}`
            : `**${memeResult.outcome}**`)
        .setColor(memeResult.reward > 100 ? 0xf1c40f : memeResult.reward > 0 ? 0x3498db : 0x95a5a6)
        .addFields({ name: '\u{1F4B0} Balance', value: `${memeResult.newBalance}`, inline: true })
        .setFooter({ text: 'Quality content = Quality rewards' });
    return { embeds: [memeEmbed] };
}

async function handleSearchlocation(interaction) {
    const locationChoice = interaction.options.getString('location');
    const locationIndex = locationChoice ? parseInt(locationChoice) : null;
    const searchResult = await starkEconomy.search(interaction.user.id, locationIndex);
    if (!searchResult.success) {
        const cooldownMs = searchResult.cooldown;
        const timeStr = cooldownMs < 60000
            ? `${Math.floor(cooldownMs / 1000)} seconds`
            : `${Math.floor(cooldownMs / (60 * 1000))} minutes`;
        return `\u{1F50D} You're too tired to search. Rest for ${timeStr} more.`;
    }
    const searchBoost = starkEconomy.getBoostText();
    const searchEmbed = new EmbedBuilder()
        .setTitle('\u{1F50D} Search Results')
        .setDescription(`You searched **${searchResult.location}**...\n\n${searchResult.outcome}${searchResult.reward > 0 ? `\n+**${searchResult.reward}** Stark Bucks${searchBoost}` : searchResult.reward < 0 ? `\n-**${Math.abs(searchResult.reward)}** Stark Bucks` : ''}`)
        .setColor(searchResult.reward > 0 ? 0x2ecc71 : searchResult.reward < 0 ? 0xe74c3c : 0x95a5a6)
        .addFields({ name: '\u{1F4B0} Balance', value: `${searchResult.newBalance}`, inline: true })
        .setFooter({ text: 'Search again in 1 minute' });
    return { embeds: [searchEmbed] };
}

async function handleMinigame(interaction) {
    const minigameSubcommand = interaction.options.getSubcommand();

    switch (minigameSubcommand) {
        case 'hunt': return await handleHunt(interaction);
        case 'fish': return await handleFish(interaction);
        case 'dig': return await handleDig(interaction);
        case 'beg': return await handleBeg(interaction);
        case 'crime': return await handleCrime(interaction);
        case 'postmeme': return await handlePostmeme(interaction);
        case 'search': return await handleSearchlocation(interaction);
        case 'rob': return await handleRob(interaction);
        default: return '\u274C Unknown minigame subcommand.';
    }
}

module.exports = {
    handleEconomy,
    handleBalance,
    handleDaily,
    handleWork,
    handleGamble,
    handleSlots,
    handleCoinflip,
    handleShop,
    handleBuy,
    handleLeaderboard,
    handleGive,
    handleBlackjack,
    handleRob,
    handleLottery,
    handleShow,
    handleInventory,
    handleTinker,
    handleBoss,
    handleSbx,
    handleQuests,
    handleMinigame,
    handleHunt,
    handleFish,
    handleDig,
    handleBeg,
    handleCrime,
    handlePostmeme,
    handleSearchlocation
};

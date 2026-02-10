/**
 * Economy Command Handlers
 * 
 * Handles all Stark Bucks economy-related slash commands.
 * Extracted from part-05.js for better maintainability.
 */

const { EmbedBuilder } = require('discord.js');

/**
 * Format numbers with K/M/B/T/Q suffixes
 */
function formatNum(n) {
    n = Math.floor(n);
    if (n >= 1e15) return (n / 1e15).toFixed(2) + 'Q';
    if (n >= 1e12) return (n / 1e12).toFixed(2) + 'T';
    if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K';
    return n.toLocaleString('en-US');
}

/**
 * Parse formatted numbers like "1M", "5K", "1B"
 */
function parseFormattedNumber(str) {
    if (!str) return NaN;
    str = String(str).trim().toUpperCase();
    if (str === 'ALL') return NaN;
    str = str.replace(/,/g, '').replace(/\s/g, '');
    const suffixes = { 'K': 1e3, 'M': 1e6, 'B': 1e9, 'T': 1e12, 'Q': 1e15 };
    const lastChar = str.slice(-1);
    if (suffixes[lastChar]) {
        const num = parseFloat(str.slice(0, -1));
        return isNaN(num) ? NaN : num * suffixes[lastChar];
    }
    return parseFloat(str);
}

// Lazy-load dependencies to avoid circular imports
let starkEconomy = null;
let starkTinker = null;

function getStarkEconomy() {
    if (!starkEconomy) starkEconomy = require('../services/stark-economy');
    return starkEconomy;
}

function getStarkTinker() {
    if (!starkTinker) starkTinker = require('../services/stark-tinkerer');
    return starkTinker;
}


/**
 * Handle /inventory command
 */
async function handleInventory(interaction) {
    const economy = getStarkEconomy();
    const inventory = await economy.getInventory(interaction.user.id);
    const hasReactor = await economy.hasArcReactor(interaction.user.id);

    if (!inventory.length) {
        return 'Your inventory is empty, sir. Visit the shop with `/economy shop` or craft items with `/tinker craft`.';
    }

    const itemList = inventory.map(item => {
        const uses = item.uses ? ` (${item.uses} uses)` : '';
        return `• ${item.name}${uses}`;
    }).join('\n');

    const embed = new EmbedBuilder()
        .setTitle(`🎒 ${interaction.user.username}'s Inventory`)
        .setDescription(itemList)
        .setColor(hasReactor ? 0x00d4ff : 0x9b59b6)
        .setFooter({ text: hasReactor ? '💠 Arc Reactor Owner - All perks active!' : 'Use /tinker craft to make items' });

    if (hasReactor) {
        embed.addFields({
            name: '💠 Arc Reactor Perks',
            value: '• +15% earnings\n• -25% cooldowns\n• +5% gambling luck\n• +500 daily bonus\n• +1% daily interest',
            inline: false
        });
    }

    return { embeds: [embed] };
}

/**
 * Handle /tinker command
 */
async function handleTinker(interaction) {
    const economy = getStarkEconomy();
    const tinker = getStarkTinker();
    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
        case 'craft': {
            const recipeName = interaction.options.getString('recipe').toLowerCase();
            const recipe = tinker.getRecipe(recipeName);
            if (!recipe) {
                return `❌ Unknown recipe: \`${recipeName}\`. Use \`/tinker recipes\` to see all recipes.`;
            }

            const result = await economy.craftItem(interaction.user.id, recipeName, recipe);
            if (!result.success) {
                const materials = await economy.getMaterials(interaction.user.id);
                const missing = Object.entries(recipe.ingredients)
                    .filter(([mat, req]) => (materials[mat] || 0) < req)
                    .map(([mat, req]) => `${req - (materials[mat] || 0)}x ${mat}`)
                    .join(', ');
                return `❌ **Cannot craft ${recipe.name}**\n\nMissing: ${missing}\n\nCollect materials with \`/minigame hunt\`, \`/minigame fish\`, \`/minigame dig\``;
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
                .setFooter({ text: 'View with /inventory' });
            return { embeds: [embed] };
        }

        case 'recipes': {
            const rarity = interaction.options.getString('rarity');
            let recipes = tinker.getAllRecipes();
            if (rarity) {
                recipes = recipes.filter(r => r.rarity === rarity);
            }
            if (recipes.length > 25) recipes = recipes.slice(0, 25);

            const recipeList = recipes.map(r =>
                `**${r.name}** (${r.rarity}) [ID: \`${r.id}\`]\n> ${Object.entries(r.ingredients).map(([k, v]) => `${v}x ${k}`).join(', ')}`
            ).join('\n');

            const embed = new EmbedBuilder()
                .setTitle(rarity ? `🔧 ${rarity.charAt(0).toUpperCase() + rarity.slice(1)} Recipes` : '🔧 Tinker Lab Recipes')
                .setDescription(recipeList || 'No recipes found.')
                .setColor(0xe74c3c)
                .setFooter({ text: 'Use /tinker craft <id> to craft' });
            return { embeds: [embed] };
        }

        case 'materials': {
            const materials = await economy.getMaterials(interaction.user.id);
            const entries = Object.entries(materials);
            if (entries.length === 0) {
                return '📦 You have no materials yet!\n\nCollect them with `/minigame hunt`, `/minigame fish`, `/minigame dig`, `/minigame beg`';
            }
            entries.sort((a, b) => b[1] - a[1]);
            const materialList = entries.slice(0, 25).map(([name, qty]) => `${name}: **${qty}**`).join('\n');

            const embed = new EmbedBuilder()
                .setTitle(`📦 ${interaction.user.username}'s Materials`)
                .setDescription(materialList + (entries.length > 25 ? `\n\n*...and ${entries.length - 25} more*` : ''))
                .setColor(0x3498db)
                .setFooter({ text: `${entries.length} material types • Use /tinker craft` });
            return { embeds: [embed] };
        }

        case 'sell': {
            const itemInput = interaction.options.getString('item').toLowerCase();
            const inventory = await economy.getInventory(interaction.user.id);

            const index = inventory.findIndex(i =>
                i.name.toLowerCase().includes(itemInput) ||
                (i.id && i.id.toLowerCase() === itemInput)
            );

            if (index === -1) {
                return `❌ Could not find item "${itemInput}" in your inventory.`;
            }

            const result = await economy.sellItem(interaction.user.id, index);
            if (!result.success) {
                return `❌ ${result.error}`;
            }

            const embed = new EmbedBuilder()
                .setTitle('💰 Item Sold')
                .setDescription(`You sold **${result.item}** for **${result.value}** Stark Bucks!`)
                .setColor(0x2ecc71)
                .addFields({ name: '💰 Balance', value: `${result.newBalance}`, inline: true });
            return { embeds: [embed] };
        }

        default:
            return '❌ Unknown tinker subcommand.';
    }
}

/**
 * Handle /boss command
 */
async function handleBoss(interaction) {
    const economy = getStarkEconomy();
    const sub = interaction.options.getSubcommand();

    switch (sub) {
        case 'status': {
            const boss = await economy.getBossData(interaction.guild.id);
            if (!boss.active) return 'No active boss. Bosses spawn randomly!';
            const hpPercent = Math.floor((boss.hp / boss.maxHp) * 100);
            const bar = '🟥'.repeat(Math.floor(hpPercent / 10)) + '⬜'.repeat(10 - Math.floor(hpPercent / 10));
            return `👹 **${boss.name}** is attacking!\nHP: ${boss.hp}/${boss.maxHp} (${hpPercent}%)\n${bar}`;
        }

        case 'attack': {
            const res = await economy.attackBoss(interaction.guild.id, interaction.user.id);
            if (!res.success) return `❌ ${res.error}`;
            return `⚔️ You dealt **${res.damage}** damage to **${res.bossName}**! Reward: ${res.reward} 💵`;
        }

        default:
            return '❌ Unknown boss subcommand.';
    }
}

/**
 * Handle /sbx command (crypto)
 */
async function handleSBX(interaction) {
    const economy = getStarkEconomy();
    const sub = interaction.options.getSubcommand();

    switch (sub) {
        case 'market': {
            const data = await economy.getSBXMarketData();
            if (!data) return '❌ Market offline.';
            const embed = new EmbedBuilder()
                .setTitle('📈 SBX Market')
                .setDescription(`Price: **${data.price}** Stark Bucks`)
                .setColor(0x3498db)
                .setFooter({ text: 'Invest in the future!' });
            return { embeds: [embed] };
        }

        case 'buy': {
            const amount = interaction.options.getInteger('amount');
            const res = await economy.buySBX(interaction.user.id, amount);
            if (!res.success) return `❌ ${res.error}`;
            return `✅ Bought **${amount} SBX** for **${res.cost}** Stark Bucks.`;
        }

        case 'sell': {
            const amount = interaction.options.getInteger('amount');
            const res = await economy.sellSBX(interaction.user.id, amount);
            if (!res.success) return `❌ ${res.error}`;
            return `✅ Sold **${amount} SBX** for **${res.earnings}** Stark Bucks.`;
        }

        case 'invest': {
            const amount = interaction.options.getInteger('amount');
            const res = await economy.investSBX(interaction.user.id, amount);
            if (!res.success) return `❌ ${res.error}`;
            return `💼 Invested **${amount} SBX**! Earning 0.5% daily.`;
        }

        case 'withdraw': {
            const amount = interaction.options.getInteger('amount');
            const res = await economy.withdrawInvestment(interaction.user.id, amount);
            if (!res.success) return `❌ ${res.error}`;
            return `🏧 Withdrew **${res.withdrawn} SBX** from investment.`;
        }

        default:
            return '❌ Unknown SBX subcommand.';
    }
}

/**
 * Handle /auction command
 */
async function handleAuction(interaction) {
    const economy = getStarkEconomy();
    const sub = interaction.options.getSubcommand();

    switch (sub) {
        case 'list': {
            const auctions = await economy.getAuctions();
            if (!auctions.length) return 'No active auctions.';
            const list = auctions.map(a => `**${a.item.name}** - Price: ${a.price} (ID: ${a.id})`).join('\n');
            return `🏛️ **Auction House**\n${list}`;
        }

        case 'buy': {
            const id = interaction.options.getString('id');
            const res = await economy.buyAuction(interaction.user.id, id);
            if (!res.success) return `❌ ${res.error}`;
            return `🔨 You bought **${res.item.name}** for ${res.price}!`;
        }

        case 'create': {
            const item = interaction.options.getString('item');
            const price = interaction.options.getInteger('price');
            const res = await economy.listAuction(interaction.user.id, item, price);
            if (!res.success) return `❌ ${res.error}`;
            return `📢 Auction created for **${res.item.name}** at ${price}! (ID: ${res.auctionId})`;
        }

        default:
            return '❌ Unknown auction subcommand.';
    }
}

/**
 * Handle /quests command
 */
async function handleQuests(interaction) {
    const economy = getStarkEconomy();
    const sub = interaction.options.getSubcommand();

    switch (sub) {
        case 'list': {
            const quests = await economy.getAvailableQuests(interaction.user.id);
            if (!quests.length) return 'No quests available.';
            const list = quests.map(q => `**${q.name}** (${q.reward} 💵) [ID: ${q.id}]`).join('\n');
            return `📜 **Quests**\n${list}`;
        }

        case 'start': {
            const id = interaction.options.getString('id');
            const res = await economy.startQuest(interaction.user.id, id);
            if (!res.success) return `❌ ${res.error}`;
            return `⚔️ Quest **${res.quest.name}** started! Good luck.`;
        }

        default:
            return '❌ Unknown quests subcommand.';
    }
}

// Export all handlers
module.exports = {
    // Helpers
    formatNum,
    parseFormattedNumber,

    // Command handlers
    handleInventory,
    handleTinker,
    handleBoss,
    handleSBX,
    handleAuction,
    handleQuests,

    // Command to handler mapping
    commandMap: {
        'inventory': handleInventory,
        'tinker': handleTinker,
        'boss': handleBoss,
        'sbx': handleSBX,
        'auction': handleAuction,
        'quests': handleQuests,
    }
};

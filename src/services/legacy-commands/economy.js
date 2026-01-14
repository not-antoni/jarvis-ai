/**
 * Legacy Economy Commands
 * Extracted from legacy-commands.js
 */

const { EmbedBuilder } = require('discord.js');
const starkEconomy = require('../stark-economy');
const starkTinker = require('../stark-tinker');
const { AchievementsSystem } = require('../achievements');
const achievements = new AchievementsSystem();
const starkbucks = require('../starkbucks-exchange');
const starkCrypto = require('../stark-crypto');

const economyCommands = {
    // ============ BASICS ============

    // Balance command
    balance: {
        description: 'Check Stark Bucks balance',
        usage: '*j balance',
        aliases: ['bal', 'money', 'wallet'],
        execute: async (message, args) => {
            const stats = await starkEconomy.getUserStats(message.author.id);
            const client = message.client;
            const lb = await starkEconomy.getLeaderboard(100, client);
            const rankIndex = lb.findIndex(u => u.userId === message.author.id);
            const rank = rankIndex !== -1 ? rankIndex + 1 : null;

            const { AttachmentBuilder } = require('discord.js');
            const imageGenerator = require('../image-generator');

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

    // Daily command
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

    // Work command
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

    // ============ MINIGAMES / ACTIONS ============

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

    // ============ INTERACTION ============

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

    // ============ INVENTORY / CRAFTING ============

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

    // ============ GAMBLING ============

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

    // ============ PROFILE / STATS ============

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

            // Try to find rank in top 100
            const client = message.client; // ensure client is available
            const lb = await starkEconomy.getLeaderboard(100, client);
            const rankIndex = lb.findIndex(u => u.userId === target.id);
            const rank = rankIndex !== -1 ? rankIndex + 1 : null;

            // Generate Profile Image
            const { AttachmentBuilder } = require('discord.js');
            const imageGenerator = require('../image-generator');

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

    // Challenge command
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

    // Prestige command
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

    // Pet command
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

    // Heist command
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

    // Boss command
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

    // Lottery command
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

    // Quest command
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
                        .setTitle('📜 Active Quest')
                        .setDescription(`**${q.name}**\n${q.description}`)
                        .setColor(0x9b59b6)
                        .addFields(
                            { name: '🎯 Objectives', value: objectives, inline: false },
                            { name: '🎁 Reward', value: `${q.reward} Stark Bucks`, inline: true }
                        )
                        .setFooter({ text: 'Use *j quest complete when finished!' });

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
    }
};

module.exports = { economyCommands };

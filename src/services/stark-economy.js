/**
 * Stark Bucks Economy System
 * A robust economy with persistence, shop, games, and leaderboards
 * 
 * Features:
 * - MongoDB persistence (auto-saves)
 * - Shop system with items
 * - Multiple games (gamble, slots, coinflip, blackjack)
 * - Daily rewards with streaks
 * - Leaderboards
 * - Auto-cleanup of old session data (keeps user balances)
 */

const database = require('./database');
const config = require('../../config');

// ============================================================================
// CONFIGURATION
// ============================================================================

const ECONOMY_CONFIG = {
    startingBalance: 100,
    dailyReward: 150,
    dailyStreakBonus: 25,
    maxDailyStreak: 30,
    workReward: { min: 30, max: 80 },
    workCooldown: 60 * 1000, // 1 minute
    dailyCooldown: 24 * 60 * 60 * 1000, // 24 hours
    robChance: 0.4,
    robCooldown: 60 * 1000, // 1 minute
    cleanupInterval: 60 * 60 * 1000, // 1 hour
    maxBalance: 1000000000, // 1 billion cap
    // Multiplier event settings
    multiplierInterval: 3 * 60 * 60 * 1000, // Every 3 hours
    multiplierDuration: 7 * 60 * 60 * 1000, // Lasts 7 hours
    multiplierBonus: 6 // 600% = 6x
};

// ============================================================================
// SHOP ITEMS
// ============================================================================

const SHOP_ITEMS = {
    // Cosmetic roles/badges
    vip_badge: {
        id: 'vip_badge',
        name: '⭐ VIP Badge',
        description: 'Show off your wealth with a VIP badge',
        price: 500,
        type: 'cosmetic',
        oneTime: true
    },
    golden_name: {
        id: 'golden_name',
        name: '✨ Golden Name',
        description: 'Your name shines gold in the leaderboard',
        price: 1000,
        type: 'cosmetic',
        oneTime: true
    },
    // Boosters
    lucky_charm: {
        id: 'lucky_charm',
        name: '🍀 Lucky Charm',
        description: '+5% gambling win rate for 1 hour',
        price: 200,
        type: 'booster',
        duration: 60 * 60 * 1000,
        effect: { gamblingBonus: 0.05 }
    },
    double_daily: {
        id: 'double_daily',
        name: '2️⃣ Double Daily',
        description: 'Double your next daily reward',
        price: 150,
        type: 'consumable',
        uses: 1
    },
    // Protection
    shield: {
        id: 'shield',
        name: '🛡️ Shield',
        description: 'Protect against robbery for 2 hours',
        price: 300,
        type: 'protection',
        duration: 2 * 60 * 60 * 1000
    },
    // Fun items
    stark_coffee: {
        id: 'stark_coffee',
        name: '☕ Stark Coffee',
        description: 'Reduce work cooldown by 50% for 1 hour',
        price: 100,
        type: 'booster',
        duration: 60 * 60 * 1000,
        effect: { workCooldownReduction: 0.5 }
    },
    arc_reactor: {
        id: 'arc_reactor',
        name: '💠 Mini Arc Reactor',
        description: 'Legendary collector item - proves you\'re a true Stark fan',
        price: 10000,
        type: 'legendary',
        oneTime: true
    }
};

// Slot machine symbols
const SLOT_SYMBOLS = ['💎', '7️⃣', '🍒', '🍋', '⭐', '🔔'];

// Hunt/Fish/Dig rewards
const MINIGAME_REWARDS = {
    hunt: {
        cooldown: 60 * 1000, // 1 minute
        outcomes: [
            { name: '🦌 Deer', reward: 80, chance: 0.3 },
            { name: '🐗 Boar', reward: 60, chance: 0.35 },
            { name: '🐰 Rabbit', reward: 30, chance: 0.25 },
            { name: '💨 Nothing', reward: 0, chance: 0.1 }
        ]
    },
    fish: {
        cooldown: 60 * 1000, // 1 minute
        outcomes: [
            { name: '🦈 Shark', reward: 100, chance: 0.1 },
            { name: '🐟 Fish', reward: 40, chance: 0.4 },
            { name: '🐠 Tropical Fish', reward: 60, chance: 0.2 },
            { name: '👢 Old Boot', reward: 5, chance: 0.2 },
            { name: '🌊 Nothing', reward: 0, chance: 0.1 }
        ]
    },
    dig: {
        cooldown: 60 * 1000, // 1 minute
        outcomes: [
            { name: '💎 Diamond', reward: 150, chance: 0.05 },
            { name: '🪙 Gold Coins', reward: 70, chance: 0.15 },
            { name: '⚙️ Scrap Metal', reward: 25, chance: 0.35 },
            { name: '🪨 Rocks', reward: 10, chance: 0.3 },
            { name: '🕳️ Empty Hole', reward: 0, chance: 0.15 }
        ]
    },
    beg: {
        cooldown: 60 * 1000, // 1 minute
        outcomes: [
            { name: 'Tony Stark gave you', reward: 100, chance: 0.05 },
            { name: 'Pepper Potts donated', reward: 50, chance: 0.15 },
            { name: 'Happy Hogan tipped you', reward: 30, chance: 0.25 },
            { name: 'A stranger gave you', reward: 15, chance: 0.35 },
            { name: 'Everyone ignored you', reward: 0, chance: 0.2 }
        ]
    },
    crime: {
        cooldown: 60 * 1000, // 1 minute
        outcomes: [
            { name: '🏦 Robbed a bank vault', reward: 500, chance: 0.05 },
            { name: '💎 Stole from a jewelry store', reward: 300, chance: 0.1 },
            { name: '🚗 Jacked a luxury car', reward: 200, chance: 0.15 },
            { name: '👜 Pickpocketed a tourist', reward: 100, chance: 0.2 },
            { name: '🚨 Got caught! Paid bail', reward: -150, chance: 0.25 },
            { name: '👮 Arrested! Lost everything', reward: -300, chance: 0.15 },
            { name: '💀 Got beat up by the victim', reward: -100, chance: 0.1 }
        ]
    },
    postmeme: {
        cooldown: 60 * 1000, // 1 minute
        outcomes: [
            { name: '🔥 Went viral! 1M likes', reward: 400, chance: 0.05 },
            { name: '😂 Front page of Reddit', reward: 200, chance: 0.1 },
            { name: '👍 Got some upvotes', reward: 80, chance: 0.25 },
            { name: '😐 Mid meme, mid reward', reward: 40, chance: 0.3 },
            { name: '👎 Cringe post, got roasted', reward: 10, chance: 0.2 },
            { name: '🚫 Banned from the subreddit', reward: 0, chance: 0.1 }
        ]
    },
    search: {
        cooldown: 60 * 1000, // 1 minute
        locations: [
            { name: "Tony's couch cushions", outcomes: [
                { result: 'Found some loose change!', reward: 50, chance: 0.4 },
                { result: 'Found old pizza... gross', reward: 0, chance: 0.6 }
            ]},
            { name: "the Stark Industries dumpster", outcomes: [
                { result: 'Found discarded prototype parts!', reward: 150, chance: 0.2 },
                { result: 'Just garbage... literally', reward: 5, chance: 0.5 },
                { result: 'Security caught you!', reward: -50, chance: 0.3 }
            ]},
            { name: "Happy's car", outcomes: [
                { result: 'Found his emergency stash!', reward: 100, chance: 0.3 },
                { result: 'Nothing but gym gear', reward: 0, chance: 0.4 },
                { result: 'Happy saw you! Awkward...', reward: -20, chance: 0.3 }
            ]},
            { name: "the Avengers compound", outcomes: [
                { result: 'Found Thor\'s forgotten gold!', reward: 300, chance: 0.1 },
                { result: 'Picked up some spare parts', reward: 80, chance: 0.3 },
                { result: 'Empty... everyone\'s on a mission', reward: 20, chance: 0.4 },
                { result: 'SHIELD detained you briefly', reward: -100, chance: 0.2 }
            ]}
        ]
    }
};

// ============================================================================
// IN-MEMORY CACHE (syncs with MongoDB)
// ============================================================================

const userCache = new Map(); // userId -> userData
const cooldowns = new Map(); // `${userId}:${action}` -> timestamp
let lastCleanup = Date.now();

// ============================================================================
// DATABASE OPERATIONS
// ============================================================================

async function getCollection() {
    await database.connect();
    return database.db.collection('starkEconomy');
}

/**
 * Load user from DB or create new
 */
async function loadUser(userId, username = 'Unknown') {
    // Check cache first
    if (userCache.has(userId)) {
        return userCache.get(userId);
    }

    try {
        const col = await getCollection();
        let user = await col.findOne({ userId: userId });

        if (!user) {
            // Create new user
            user = {
                userId: userId,
                username: username,
                balance: ECONOMY_CONFIG.startingBalance,
                totalEarned: ECONOMY_CONFIG.startingBalance,
                totalLost: 0,
                totalGambled: 0,
                gamesPlayed: 0,
                gamesWon: 0,
                dailyStreak: 0,
                lastDaily: 0,
                lastWork: 0,
                lastRob: 0,
                inventory: [],
                activeEffects: [],
                achievements: [],
                createdAt: new Date(),
                updatedAt: new Date()
            };
            await col.insertOne(user);
        }

        userCache.set(userId, user);
        return user;
    } catch (error) {
        console.error('[StarkEconomy] Failed to load user:', error);
        // Return default user object if DB fails
        return {
            userId: userId,
            username: username,
            balance: ECONOMY_CONFIG.startingBalance,
            totalEarned: 0,
            inventory: [],
            activeEffects: []
        };
    }
}

/**
 * Save user to DB
 */
async function saveUser(userId, userData) {
    userData.updatedAt = new Date();
    userCache.set(userId, userData);

    try {
        const col = await getCollection();
        await col.updateOne(
            { userId: userId },
            { $set: userData },
            { upsert: true }
        );
    } catch (error) {
        console.error('[StarkEconomy] Failed to save user:', error);
    }
}

// ============================================================================
// CORE FUNCTIONS
// ============================================================================

/**
 * Get user balance
 */
async function getBalance(userId, username) {
    const user = await loadUser(userId, username);
    return user.balance;
}

/**
 * Modify user balance
 */
async function modifyBalance(userId, amount, reason = 'unknown') {
    const user = await loadUser(userId);
    const oldBalance = user.balance;
    user.balance = Math.max(0, user.balance + amount);

    if (amount > 0) {
        user.totalEarned = (user.totalEarned || 0) + amount;
    } else {
        user.totalLost = (user.totalLost || 0) + Math.abs(amount);
    }

    await saveUser(userId, user);
    return { oldBalance, newBalance: user.balance, change: amount };
}

/**
 * Check and set cooldown
 */
function checkCooldown(userId, action, cooldownMs) {
    const key = `${userId}:${action}`;
    const lastAction = cooldowns.get(key) || 0;
    const now = Date.now();
    const remaining = cooldownMs - (now - lastAction);

    if (remaining > 0) {
        return { onCooldown: true, remaining };
    }

    cooldowns.set(key, now);
    return { onCooldown: false, remaining: 0 };
}

/**
 * Get active effects for user
 */
async function getActiveEffects(userId) {
    const user = await loadUser(userId);
    const now = Date.now();
    
    // Filter out expired effects
    user.activeEffects = (user.activeEffects || []).filter(effect => {
        return effect.expiresAt > now;
    });
    
    await saveUser(userId, user);
    return user.activeEffects;
}

/**
 * Apply item effect
 */
async function applyItemEffect(userId, item) {
    const user = await loadUser(userId);
    
    if (item.duration) {
        user.activeEffects = user.activeEffects || [];
        user.activeEffects.push({
            itemId: item.id,
            effect: item.effect,
            expiresAt: Date.now() + item.duration
        });
    }
    
    await saveUser(userId, user);
}

// ============================================================================
// GAME FUNCTIONS
// ============================================================================

/**
 * Daily reward with streak system
 */
async function claimDaily(userId, username) {
    const user = await loadUser(userId, username);
    const now = Date.now();
    const timeSinceLastDaily = now - (user.lastDaily || 0);

    if (timeSinceLastDaily < ECONOMY_CONFIG.dailyCooldown) {
        const remaining = ECONOMY_CONFIG.dailyCooldown - timeSinceLastDaily;
        return {
            success: false,
            message: 'Already claimed',
            cooldown: remaining
        };
    }

    // Check streak
    const wasYesterday = timeSinceLastDaily < (ECONOMY_CONFIG.dailyCooldown * 2);
    if (wasYesterday) {
        user.dailyStreak = Math.min((user.dailyStreak || 0) + 1, ECONOMY_CONFIG.maxStreak);
    } else {
        user.dailyStreak = 1; // Reset streak
    }

    // Calculate reward
    let reward = Math.floor(
        ECONOMY_CONFIG.dailyReward.min + 
        Math.random() * (ECONOMY_CONFIG.dailyReward.max - ECONOMY_CONFIG.dailyReward.min)
    );
    
    // Streak bonus
    const streakBonus = user.dailyStreak * ECONOMY_CONFIG.streakBonus;
    reward += streakBonus;

    // Check for double daily item
    const hasDoubleDaily = (user.inventory || []).find(i => i.id === 'double_daily' && i.uses > 0);
    if (hasDoubleDaily) {
        reward *= 2;
        hasDoubleDaily.uses -= 1;
        if (hasDoubleDaily.uses <= 0) {
            user.inventory = user.inventory.filter(i => i.id !== 'double_daily');
        }
    }

    user.balance += reward;
    user.totalEarned = (user.totalEarned || 0) + reward;
    user.lastDaily = now;

    await saveUser(userId, user);

    return {
        success: true,
        reward,
        streak: user.dailyStreak,
        streakBonus,
        doubled: !!hasDoubleDaily,
        newBalance: user.balance
    };
}

/**
 * Work for money
 */
async function work(userId, username) {
    const user = await loadUser(userId, username);
    
    // Check for work cooldown reduction
    const effects = await getActiveEffects(userId);
    let cooldownMultiplier = 1;
    effects.forEach(e => {
        if (e.effect?.workCooldownReduction) {
            cooldownMultiplier *= (1 - e.effect.workCooldownReduction);
        }
    });

    const cooldown = checkCooldown(userId, 'work', ECONOMY_CONFIG.workCooldown * cooldownMultiplier);
    if (cooldown.onCooldown) {
        return { success: false, cooldown: cooldown.remaining };
    }

    let reward = Math.floor(
        ECONOMY_CONFIG.workReward.min + 
        Math.random() * (ECONOMY_CONFIG.workReward.max - ECONOMY_CONFIG.workReward.min)
    );
    
    // Apply multiplier bonus if event active
    if (isMultiplierActive()) {
        reward = Math.floor(reward * ECONOMY_CONFIG.multiplierBonus);
    }

    const jobs = [
        `fixed a bug in the Mark ${Math.floor(Math.random() * 50 + 1)} suit`,
        `calibrated the arc reactor`,
        `organized Tony's workshop`,
        `debugged FRIDAY's code`,
        `polished the Iron Legion`,
        `updated the Stark satellite network`,
        `ran diagnostics on the Quinjet`,
        `cleaned Dum-E's mess`,
        `tested new repulsor tech`,
        `encrypted classified files`
    ];

    const job = jobs[Math.floor(Math.random() * jobs.length)];

    user.balance += reward;
    user.totalEarned = (user.totalEarned || 0) + reward;
    await saveUser(userId, user);

    return {
        success: true,
        reward,
        job,
        newBalance: user.balance
    };
}

/**
 * Gamble (double or nothing)
 */
async function gamble(userId, amount) {
    const user = await loadUser(userId);

    if (amount < 1) return { success: false, error: 'Minimum bet is 1 Stark Buck' };
    if (amount > user.balance) return { success: false, error: 'Insufficient funds' };

    // Check for lucky charm
    const effects = await getActiveEffects(userId);
    let winRate = ECONOMY_CONFIG.gamblingWinRate;
    effects.forEach(e => {
        if (e.effect?.gamblingBonus) {
            winRate += e.effect.gamblingBonus;
        }
    });

    const won = Math.random() < winRate;
    const change = won ? amount : -amount;

    user.balance += change;
    user.totalGambled = (user.totalGambled || 0) + amount;
    user.gamesPlayed = (user.gamesPlayed || 0) + 1;
    if (won) user.gamesWon = (user.gamesWon || 0) + 1;
    if (change > 0) user.totalEarned = (user.totalEarned || 0) + change;
    else user.totalLost = (user.totalLost || 0) + Math.abs(change);

    await saveUser(userId, user);

    return {
        success: true,
        won,
        amount,
        change,
        newBalance: user.balance,
        winRate: Math.round(winRate * 100)
    };
}

/**
 * Slot machine
 */
async function playSlots(userId, bet) {
    const user = await loadUser(userId);

    if (bet < 10) return { success: false, error: 'Minimum bet is 10 Stark Bucks' };
    if (bet > user.balance) return { success: false, error: 'Insufficient funds' };

    // Spin the slots
    const results = [
        SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)],
        SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)],
        SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)]
    ];

    // Calculate winnings
    let multiplier = 0;
    let resultType = 'loss';

    if (results[0] === results[1] && results[1] === results[2]) {
        if (results[0] === '💎') {
            multiplier = ECONOMY_CONFIG.slotsMultipliers.jackpot;
            resultType = 'jackpot';
        } else {
            multiplier = ECONOMY_CONFIG.slotsMultipliers.triple;
            resultType = 'triple';
        }
    } else if (results[0] === results[1] || results[1] === results[2] || results[0] === results[2]) {
        multiplier = ECONOMY_CONFIG.slotsMultipliers.double;
        resultType = 'double';
    }

    const winnings = bet * multiplier;
    const change = winnings - bet;

    user.balance += change;
    user.totalGambled = (user.totalGambled || 0) + bet;
    user.gamesPlayed = (user.gamesPlayed || 0) + 1;
    if (change > 0) {
        user.gamesWon = (user.gamesWon || 0) + 1;
        user.totalEarned = (user.totalEarned || 0) + change;
    } else {
        user.totalLost = (user.totalLost || 0) + Math.abs(change);
    }

    await saveUser(userId, user);

    return {
        success: true,
        results,
        resultType,
        multiplier,
        bet,
        winnings,
        change,
        newBalance: user.balance
    };
}

/**
 * Coinflip
 */
async function coinflip(userId, bet, choice) {
    const user = await loadUser(userId);

    if (bet < 1) return { success: false, error: 'Minimum bet is 1 Stark Buck' };
    if (bet > user.balance) return { success: false, error: 'Insufficient funds' };

    const result = Math.random() < 0.5 ? 'heads' : 'tails';
    const won = choice.toLowerCase() === result;
    const change = won ? bet : -bet;

    user.balance += change;
    user.totalGambled = (user.totalGambled || 0) + bet;
    user.gamesPlayed = (user.gamesPlayed || 0) + 1;
    if (won) user.gamesWon = (user.gamesWon || 0) + 1;
    if (change > 0) user.totalEarned = (user.totalEarned || 0) + change;
    else user.totalLost = (user.totalLost || 0) + Math.abs(change);

    await saveUser(userId, user);

    return {
        success: true,
        choice,
        result,
        won,
        change,
        newBalance: user.balance
    };
}

/**
 * Rob another user
 */
async function rob(userId, targetId, username) {
    if (userId === targetId) return { success: false, error: 'Cannot rob yourself' };

    const cooldown = checkCooldown(userId, 'rob', ECONOMY_CONFIG.robCooldown);
    if (cooldown.onCooldown) {
        return { success: false, error: 'On cooldown', cooldown: cooldown.remaining };
    }

    const user = await loadUser(userId, username);
    const target = await loadUser(targetId);

    // Check if target has shield
    const targetEffects = await getActiveEffects(targetId);
    const hasShield = targetEffects.some(e => e.itemId === 'shield');
    if (hasShield) {
        return { success: false, error: 'Target has a shield active!' };
    }

    if (target.balance < 50) {
        return { success: false, error: 'Target is too poor to rob' };
    }

    const succeeded = Math.random() < ECONOMY_CONFIG.robSuccessRate;

    if (succeeded) {
        const maxSteal = Math.floor(target.balance * ECONOMY_CONFIG.robMaxPercent);
        const stolen = Math.floor(Math.random() * maxSteal) + 1;

        user.balance += stolen;
        target.balance -= stolen;
        user.totalEarned = (user.totalEarned || 0) + stolen;
        target.totalLost = (target.totalLost || 0) + stolen;

        await saveUser(userId, user);
        await saveUser(targetId, target);

        return {
            success: true,
            succeeded: true,
            stolen,
            newBalance: user.balance
        };
    } else {
        // Failed - pay fine
        const fine = Math.floor(user.balance * 0.1);
        user.balance -= fine;
        user.totalLost = (user.totalLost || 0) + fine;
        await saveUser(userId, user);

        return {
            success: true,
            succeeded: false,
            fine,
            newBalance: user.balance
        };
    }
}

// ============================================================================
// SHOP FUNCTIONS
// ============================================================================

/**
 * Get shop items
 */
function getShopItems() {
    return Object.values(SHOP_ITEMS);
}

/**
 * Buy item from shop
 */
async function buyItem(userId, itemId) {
    const item = SHOP_ITEMS[itemId];
    if (!item) return { success: false, error: 'Item not found' };

    const user = await loadUser(userId);

    // Check if already owns one-time item
    if (item.oneTime) {
        const alreadyOwns = (user.inventory || []).some(i => i.id === itemId);
        if (alreadyOwns) {
            return { success: false, error: 'You already own this item' };
        }
    }

    if (user.balance < item.price) {
        return { success: false, error: 'Insufficient funds' };
    }

    user.balance -= item.price;
    user.inventory = user.inventory || [];
    user.inventory.push({
        id: item.id,
        name: item.name,
        purchasedAt: Date.now(),
        uses: item.uses || null
    });

    // Apply effect if applicable
    if (item.type === 'booster' || item.type === 'protection') {
        await applyItemEffect(userId, item);
    }

    await saveUser(userId, user);

    return {
        success: true,
        item,
        newBalance: user.balance
    };
}

/**
 * Get user inventory
 */
async function getInventory(userId) {
    const user = await loadUser(userId);
    return user.inventory || [];
}

// ============================================================================
// LEADERBOARD
// ============================================================================

/**
 * Get top users by balance
 * @param {number} limit - Number of users to return
 * @param {Object} client - Optional Discord client to fetch current usernames
 */
async function getLeaderboard(limit = 10, client = null) {
    try {
        const col = await getCollection();
        const users = await col
            .find({})
            .sort({ balance: -1 })
            .limit(limit)
            .toArray();

        // Fetch current usernames from Discord if client is provided
        const leaderboardEntries = await Promise.all(users.map(async (u, i) => {
            let username = u.username || 'Unknown';
            
            // Try to get current username from Discord
            if (client) {
                try {
                    // Check cache first
                    let discordUser = client.users.cache.get(u.userId);
                    if (!discordUser) {
                        // Fetch from API if not in cache
                        discordUser = await client.users.fetch(u.userId).catch(() => null);
                    }
                    if (discordUser) {
                        username = discordUser.globalName || discordUser.username || username;
                    }
                } catch (error) {
                    // If fetch fails, use stored username
                    console.warn(`[StarkEconomy] Failed to fetch username for user ${u.userId}:`, error.message);
                }
            }

            return {
                rank: i + 1,
                userId: u.userId,
                username: username,
                balance: u.balance,
                hasGoldenName: (u.inventory || []).some(item => item.id === 'golden_name'),
                hasVipBadge: (u.inventory || []).some(item => item.id === 'vip_badge')
            };
        }));

        return leaderboardEntries;
    } catch (error) {
        console.error('[StarkEconomy] Failed to get leaderboard:', error);
        return [];
    }
}

/**
 * Get user stats
 */
async function getUserStats(userId) {
    const user = await loadUser(userId);
    return {
        balance: user.balance,
        totalEarned: user.totalEarned || 0,
        totalLost: user.totalLost || 0,
        totalGambled: user.totalGambled || 0,
        gamesPlayed: user.gamesPlayed || 0,
        gamesWon: user.gamesWon || 0,
        winRate: user.gamesPlayed > 0 
            ? Math.round((user.gamesWon / user.gamesPlayed) * 100) 
            : 0,
        dailyStreak: user.dailyStreak || 0,
        inventoryCount: (user.inventory || []).length,
        memberSince: user.createdAt
    };
}

// ============================================================================
// CLEANUP
// ============================================================================

/**
 * Clean up old session data (keeps user balances/inventory)
 */
async function cleanup() {
    const now = Date.now();
    
    // Clear old cooldowns from memory
    for (const [key, timestamp] of cooldowns.entries()) {
        if (now - timestamp > 24 * 60 * 60 * 1000) { // 24 hours
            cooldowns.delete(key);
        }
    }

    // Clear cache for users not accessed in 1 hour
    for (const [userId, userData] of userCache.entries()) {
        if (userData.lastAccessed && now - userData.lastAccessed > 60 * 60 * 1000) {
            userCache.delete(userId);
        }
    }

    // Clean expired effects in database
    try {
        const col = await getCollection();
        await col.updateMany(
            {},
            { $pull: { activeEffects: { expiresAt: { $lt: now } } } }
        );
    } catch (error) {
        console.error('[StarkEconomy] Cleanup failed:', error);
    }

    lastCleanup = now;
    console.log('[StarkEconomy] Cleanup completed');
}

// ============================================================================
// MINIGAMES (Hunt, Fish, Dig, Beg)
// ============================================================================

/**
 * Generic minigame handler
 */
async function playMinigame(userId, gameType) {
    const game = MINIGAME_REWARDS[gameType];
    if (!game) return { success: false, error: 'Unknown game type' };

    const cooldown = checkCooldown(userId, gameType, game.cooldown);
    if (cooldown.onCooldown) {
        return { success: false, cooldown: cooldown.remaining };
    }

    // Pick random outcome based on chances
    const roll = Math.random();
    let cumulative = 0;
    let outcome = game.outcomes[game.outcomes.length - 1]; // Default to last

    for (const o of game.outcomes) {
        cumulative += o.chance;
        if (roll < cumulative) {
            outcome = o;
            break;
        }
    }

    // Apply multiplier bonus if event active (only to positive rewards)
    let reward = outcome.reward;
    if (reward > 0 && isMultiplierActive()) {
        reward = Math.floor(reward * ECONOMY_CONFIG.multiplierBonus);
    }

    const user = await loadUser(userId);
    user.balance = Math.max(0, user.balance + reward); // Don't go negative
    if (reward > 0) {
        user.totalEarned = (user.totalEarned || 0) + reward;
    } else if (reward < 0) {
        user.totalLost = (user.totalLost || 0) + Math.abs(reward);
    }
    await saveUser(userId, user);

    return {
        success: true,
        outcome: outcome.name,
        reward: reward,
        newBalance: user.balance
    };
}

/**
 * Hunt for animals
 */
async function hunt(userId) {
    return playMinigame(userId, 'hunt');
}

/**
 * Fish in the ocean
 */
async function fish(userId) {
    return playMinigame(userId, 'fish');
}

/**
 * Dig for treasure
 */
async function dig(userId) {
    return playMinigame(userId, 'dig');
}

/**
 * Beg for money
 */
async function beg(userId) {
    return playMinigame(userId, 'beg');
}

/**
 * Commit a crime (risky but high reward)
 */
async function crime(userId) {
    return playMinigame(userId, 'crime');
}

/**
 * Post a meme for money
 */
async function postmeme(userId) {
    return playMinigame(userId, 'postmeme');
}

/**
 * Search a location for money
 */
async function search(userId, locationIndex = null) {
    const game = MINIGAME_REWARDS.search;
    
    const cooldown = checkCooldown(userId, 'search', game.cooldown);
    if (cooldown.onCooldown) {
        return { success: false, cooldown: cooldown.remaining };
    }

    // Pick random location if not specified
    const location = locationIndex !== null && game.locations[locationIndex] 
        ? game.locations[locationIndex] 
        : game.locations[Math.floor(Math.random() * game.locations.length)];

    // Pick random outcome from location
    const roll = Math.random();
    let cumulative = 0;
    let outcome = location.outcomes[location.outcomes.length - 1];

    for (const o of location.outcomes) {
        cumulative += o.chance;
        if (roll < cumulative) {
            outcome = o;
            break;
        }
    }

    // Apply multiplier bonus if event active (only to positive rewards)
    let reward = outcome.reward;
    if (reward > 0 && isMultiplierActive()) {
        reward = Math.floor(reward * ECONOMY_CONFIG.multiplierBonus);
    }

    const user = await loadUser(userId);
    user.balance = Math.max(0, user.balance + reward);
    if (reward > 0) {
        user.totalEarned = (user.totalEarned || 0) + reward;
    } else if (reward < 0) {
        user.totalLost = (user.totalLost || 0) + Math.abs(reward);
    }
    await saveUser(userId, user);

    return {
        success: true,
        location: location.name,
        outcome: outcome.result,
        reward: reward,
        newBalance: user.balance
    };
}

/**
 * Get available search locations
 */
function getSearchLocations() {
    return MINIGAME_REWARDS.search.locations.map((l, i) => ({
        index: i,
        name: l.name
    }));
}

/**
 * Give money to another user
 */
async function give(fromUserId, toUserId, amount, fromUsername, toUsername) {
    if (fromUserId === toUserId) {
        return { success: false, error: 'Cannot give money to yourself' };
    }
    if (amount < 1) {
        return { success: false, error: 'Amount must be at least 1' };
    }

    const fromUser = await loadUser(fromUserId, fromUsername);
    if (fromUser.balance < amount) {
        return { success: false, error: 'Insufficient funds' };
    }

    const toUser = await loadUser(toUserId, toUsername);

    // Transfer
    fromUser.balance -= amount;
    toUser.balance += amount;
    toUser.totalEarned = (toUser.totalEarned || 0) + amount;

    await saveUser(fromUserId, fromUser);
    await saveUser(toUserId, toUser);

    return {
        success: true,
        amount,
        fromBalance: fromUser.balance,
        toBalance: toUser.balance
    };
}

// Auto-cleanup interval
setInterval(() => {
    cleanup().catch(console.error);
}, ECONOMY_CONFIG.cleanupInterval);

// ============================================================================
// MULTIPLIER EVENT SYSTEM (250% bonus every 3 hours, lasts 7 hours)
// ============================================================================

let multiplierActive = false;
let multiplierEndTime = 0;
let lastMultiplierStart = 0;

/**
 * Check if multiplier is currently active
 */
function isMultiplierActive() {
    if (multiplierActive && Date.now() < multiplierEndTime) {
        return true;
    }
    if (multiplierActive && Date.now() >= multiplierEndTime) {
        multiplierActive = false;
        console.log('[StarkEconomy] 250% multiplier event ended');
    }
    return false;
}

/**
 * Get current multiplier value
 */
function getMultiplier() {
    return isMultiplierActive() ? ECONOMY_CONFIG.multiplierBonus : 1;
}

/**
 * Get multiplier status
 */
function getMultiplierStatus() {
    const active = isMultiplierActive();
    return {
        active,
        multiplier: active ? ECONOMY_CONFIG.multiplierBonus : 1,
        endsAt: active ? multiplierEndTime : null,
        nextEventIn: active ? null : Math.max(0, (lastMultiplierStart + ECONOMY_CONFIG.multiplierInterval) - Date.now())
    };
}

/**
 * Start multiplier event (no DMs - users see boost in command responses)
 */
async function startMultiplierEvent() {
    multiplierActive = true;
    multiplierEndTime = Date.now() + ECONOMY_CONFIG.multiplierDuration;
    lastMultiplierStart = Date.now();
    console.log('[StarkEconomy] 🎉 250% multiplier event started! Lasts 7 hours.');
}

/**
 * Get boost notification text to append to economy command responses
 * Returns empty string if no boost active
 */
function getBoostText() {
    if (!isMultiplierActive()) return '';
    
    const remaining = multiplierEndTime - Date.now();
    const hours = Math.floor(remaining / (60 * 60 * 1000));
    const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
    
    return `\n\n🎉 **600% BOOST ACTIVE!** All earnings x6! (${hours}h ${minutes}m remaining)`;
}

// Schedule multiplier events every 3 hours
let multiplierInterval = null;
function startMultiplierScheduler() {
    if (multiplierInterval) clearInterval(multiplierInterval);
    
    // Start first event after 3 hours
    multiplierInterval = setInterval(() => {
        if (!isMultiplierActive()) {
            startMultiplierEvent();
        }
    }, ECONOMY_CONFIG.multiplierInterval);
    
    console.log('[StarkEconomy] Multiplier event scheduler started (every 3 hours)');
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
    // Config
    ECONOMY_CONFIG,
    SHOP_ITEMS,
    
    // Core
    getBalance,
    modifyBalance,
    loadUser,
    
    // Games
    claimDaily,
    work,
    gamble,
    playSlots,
    coinflip,
    rob,
    
    // Shop
    getShopItems,
    buyItem,
    getInventory,
    getActiveEffects,
    
    // Stats
    getLeaderboard,
    getUserStats,
    
    // Minigames
    hunt,
    fish,
    dig,
    beg,
    crime,
    postmeme,
    search,
    getSearchLocations,
    give,
    
    // Maintenance
    cleanup,
    
    // Multiplier Events
    isMultiplierActive,
    getMultiplier,
    getMultiplierStatus,
    getBoostText,
    startMultiplierEvent,
    startMultiplierScheduler
};

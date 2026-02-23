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
const fs = require('fs');
const path = require('path');

// Disk cache for leaderboard (5 minute TTL)
const LEADERBOARD_CACHE_PATH = path.join(__dirname, '../../data/leaderboard-cache.json');
const LEADERBOARD_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ============================================================================
// NUMBER FORMATTING - Compact display for large numbers
// ============================================================================

/**
 * Format large numbers in compact notation (K, M, B, T, Q, Qi, Sx, Sp, Oc)
 * @param {number} num - Number to format
 * @param {number} decimals - Decimal places (default 1)
 * @returns {string} - Formatted string like "71.3Q" or "2.5M"
 */
function formatCompact(num, decimals = 1) {
    if (num == null || isNaN(num)) {return '0';}
    num = Number(num);
    if (!isFinite(num)) {return '∞';}

    const absNum = Math.abs(num);
    const sign = num < 0 ? '-' : '';

    // Define suffixes (each step is 1000x)
    const suffixes = [
        { threshold: 1e100, suffix: 'Go' }, // Googol
        { threshold: 1e90, suffix: 'Nv' }, // Novemvigintillion
        { threshold: 1e87, suffix: 'Ov' }, // Octovigintillion
        { threshold: 1e84, suffix: 'Sv' }, // Septenvigintillion
        { threshold: 1e81, suffix: 'SxV' }, // Sexvigintillion
        { threshold: 1e78, suffix: 'QnV' }, // Quindecillion (Vigintillion range) -> using standard names
        // Okay let's stick to standard Naming
        { threshold: 1e75, suffix: 'Qv' },  // Quattuorvigintillion
        { threshold: 1e72, suffix: 'Tv' },  // Trevigintillion
        { threshold: 1e69, suffix: 'Dv' },  // Duovigintillion
        { threshold: 1e66, suffix: 'Uv' },  // Unvigintillion
        { threshold: 1e63, suffix: 'Vg' },  // Vigintillion
        { threshold: 1e60, suffix: 'Nd' },  // Novemdecillion
        { threshold: 1e57, suffix: 'Od' },  // Octodecillion
        { threshold: 1e54, suffix: 'Sd' },  // Septendecillion
        { threshold: 1e51, suffix: 'SxD' }, // Sexdecillion
        { threshold: 1e48, suffix: 'QiD' }, // Quindecillion
        { threshold: 1e45, suffix: 'QaD' }, // Quattuordecillion
        { threshold: 1e42, suffix: 'Td' },  // Tredecillion
        { threshold: 1e39, suffix: 'Dd' },  // Duodecillion
        { threshold: 1e36, suffix: 'Ud' },  // Undecillion
        { threshold: 1e33, suffix: 'Dc' },  // Decillion
        { threshold: 1e30, suffix: 'No' },  // Nonillion
        { threshold: 1e27, suffix: 'Oc' },  // Octillion
        { threshold: 1e24, suffix: 'Sp' },  // Septillion
        { threshold: 1e21, suffix: 'Sx' },  // Sextillion  
        { threshold: 1e18, suffix: 'Qi' },  // Quintillion
        { threshold: 1e15, suffix: 'Q' },   // Quadrillion
        { threshold: 1e12, suffix: 'T' },   // Trillion
        { threshold: 1e9, suffix: 'B' },    // Billion
        { threshold: 1e6, suffix: 'M' },    // Million
        { threshold: 1e3, suffix: 'K' }    // Thousand
    ];

    for (const { threshold, suffix } of suffixes) {
        if (absNum >= threshold) {
            const value = num / threshold;
            return sign + value.toFixed(decimals).replace(/\.0+$/, '') + suffix;
        }
    }

    // Small numbers - use locale string with no decimals
    return num.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

// Lazy-load starkbucks to avoid circular dependency
let _starkbucks = null;
function getStarkbucks() {
    if (!_starkbucks) {
        try {
            _starkbucks = require('./starkbucks-exchange');
        } catch (e) {
            _starkbucks = null;
        }
    }
    return _starkbucks;
}

// ============================================================================
// PER-USER LOCKING (Prevents race conditions from spam)
// ============================================================================
const userLocks = new Map(); // userId -> Promise

/**
 * Acquire a lock for a user - prevents concurrent operations
 * @param {string} userId - The user ID to lock
 * @param {Function} operation - Async operation to perform
 * @returns {Promise} - Result of the operation
 */
async function withUserLock(userId, operation) {
    // Wait for any pending operation for this user (with backoff to prevent CPU spin)
    let attempts = 0;
    while (userLocks.has(userId)) {
        await userLocks.get(userId).catch(() => { });
        if (userLocks.has(userId) && ++attempts > 50) {
            // Safety valve: force-release stale lock after ~5 seconds of waiting
            userLocks.delete(userId);
            break;
        }
        if (userLocks.has(userId)) {
            await new Promise(r => setTimeout(r, Math.min(100, 10 * attempts)));
        }
    }

    // Create a new lock
    const lockPromise = (async() => {
        try {
            return await operation();
        } finally {
            userLocks.delete(userId);
        }
    })();

    userLocks.set(userId, lockPromise);
    return lockPromise;
}

const { ECONOMY_CONFIG, SHOP_ITEMS, SLOT_SYMBOLS, MINIGAME_REWARDS } = require('./economy/config');

// ============================================================================
// IN-MEMORY CACHE (syncs with MongoDB)
// ============================================================================

const userCache = new Map(); // userId -> userData
const USER_CACHE_MAX = 5000;
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
 * Ensure a value is a valid number, fallback to default
 */
function ensureNumber(value, defaultValue = 0) {
    const num = Number(value);
    return Number.isFinite(num) ? num : defaultValue;
}

/**
 * Load user from DB or create new
 */
async function loadUser(userId, username = 'Unknown') {
    // Check cache first
    if (userCache.has(userId)) {
        const cached = userCache.get(userId);
        // Validate cached balance is not NaN
        cached.balance = ensureNumber(cached.balance, ECONOMY_CONFIG.startingBalance);
        return cached;
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
                createdAt: new Date(),
                updatedAt: new Date()
            };
            await col.insertOne(user);
        } else {
            // Validate and fix NaN values from DB
            user.balance = ensureNumber(user.balance, ECONOMY_CONFIG.startingBalance);
            user.totalEarned = ensureNumber(user.totalEarned, 0);
            user.totalLost = ensureNumber(user.totalLost, 0);
            user.totalGambled = ensureNumber(user.totalGambled, 0);
            user.gamesPlayed = ensureNumber(user.gamesPlayed, 0);
            user.gamesWon = ensureNumber(user.gamesWon, 0);
            user.dailyStreak = ensureNumber(user.dailyStreak, 0);
        }

        // Evict oldest entries if cache is too large
        if (userCache.size >= USER_CACHE_MAX) {
            const firstKey = userCache.keys().next().value;
            userCache.delete(firstKey);
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
    // Validate all numeric fields before saving
    userData.balance = ensureNumber(userData.balance, ECONOMY_CONFIG.startingBalance);
    userData.totalEarned = ensureNumber(userData.totalEarned, 0);
    userData.totalLost = ensureNumber(userData.totalLost, 0);
    userData.totalGambled = ensureNumber(userData.totalGambled, 0);
    userData.gamesPlayed = ensureNumber(userData.gamesPlayed, 0);
    userData.gamesWon = ensureNumber(userData.gamesWon, 0);
    userData.dailyStreak = ensureNumber(userData.dailyStreak, 0);
    userData.updatedAt = new Date();
    userCache.set(userId, userData);

    try {
        const col = await getCollection();
        await col.updateOne({ userId: userId }, { $set: userData }, { upsert: true });
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
 * Modify user balance (atomic for withdrawals to prevent race conditions)
 * For negative amounts, uses conditional update to ensure balance doesn't go negative
 */
async function modifyBalance(userId, amount, reason = 'unknown') {
    const safeAmount = ensureNumber(amount, 0);

    // For withdrawals, use atomic conditional update
    if (safeAmount < 0) {
        const absAmount = Math.abs(safeAmount);
        try {
            const col = await getCollection();

            // Atomic update: only deduct if balance >= amount
            const result = await col.findOneAndUpdate(
                { userId: userId, balance: { $gte: absAmount } },
                {
                    $inc: {
                        balance: safeAmount,
                        totalLost: absAmount
                    },
                    $set: { updatedAt: new Date() }
                },
                { returnDocument: 'after' }
            );

            if (!result) {
                // Either user doesn't exist or insufficient balance
                const user = await loadUser(userId);
                const currentBalance = ensureNumber(user.balance, 0);
                if (currentBalance < absAmount) {
                    return {
                        success: false,
                        error: 'Insufficient balance',
                        oldBalance: currentBalance,
                        newBalance: currentBalance,
                        change: 0
                    };
                }
                // User doesn't exist - create and retry
                await saveUser(userId, user);
                return modifyBalance(userId, amount, reason);
            }

            const newBalance = ensureNumber(result.balance, 0);
            const oldBalance = newBalance + absAmount;

            // Invalidate cache
            userCache.delete(userId);

            return { success: true, oldBalance, newBalance, change: safeAmount };
        } catch (error) {
            console.error('[StarkEconomy] Atomic withdraw failed:', error);
            // Fallback to non-atomic (better than failing completely)
            const user = await loadUser(userId);
            const oldBalance = ensureNumber(user.balance, ECONOMY_CONFIG.startingBalance);
            if (oldBalance < absAmount) {
                return { success: false, error: 'Insufficient balance', oldBalance, newBalance: oldBalance, change: 0 };
            }
            user.balance = oldBalance + safeAmount;
            user.totalLost = ensureNumber(user.totalLost, 0) + absAmount;
            await saveUser(userId, user);
            return { success: true, oldBalance, newBalance: user.balance, change: safeAmount };
        }
    }

    // For deposits, use atomic $inc (always safe)
    try {
        const col = await getCollection();
        const result = await col.findOneAndUpdate(
            { userId: userId },
            {
                $inc: {
                    balance: safeAmount,
                    totalEarned: safeAmount
                },
                $set: { updatedAt: new Date() },
                $setOnInsert: {
                    userId: userId,
                    totalLost: 0,
                    totalGambled: 0,
                    gamesPlayed: 0,
                    gamesWon: 0,
                    dailyStreak: 0,
                    inventory: [],
                    activeEffects: [],
                    createdAt: new Date()
                }
            },
            { upsert: true, returnDocument: 'after' }
        );

        const newBalance = ensureNumber(result?.balance, safeAmount);
        const oldBalance = newBalance - safeAmount;

        // Invalidate cache
        userCache.delete(userId);

        return { success: true, oldBalance, newBalance, change: safeAmount };
    } catch (error) {
        console.error('[StarkEconomy] Atomic deposit failed:', error);
        // Fallback to non-atomic
        const user = await loadUser(userId);
        const oldBalance = ensureNumber(user.balance, ECONOMY_CONFIG.startingBalance);
        user.balance = oldBalance + safeAmount;
        user.totalEarned = ensureNumber(user.totalEarned, 0) + safeAmount;
        await saveUser(userId, user);
        return { success: true, oldBalance, newBalance: user.balance, change: safeAmount };
    }
}

/**
 * Check if user is bot owner (bypasses cooldowns)
 */
function isBotOwner(userId) {
    const ownerId = process.env.BOT_OWNER_ID || '';
    return ownerId && userId === ownerId;
}

/**
 * Check and set cooldown (bot owner bypasses all cooldowns)
 */
function checkCooldown(userId, action, cooldownMs) {
    // Bot owner bypasses all cooldowns
    if (isBotOwner(userId)) {
        return { onCooldown: false, remaining: 0, ownerBypass: true };
    }

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
 * Check if user has Arc Reactor
 */
async function hasArcReactor(userId) {
    const user = await loadUser(userId);
    return (user.inventory || []).some(item => item.id === 'arc_reactor');
}

/**
 * Get Arc Reactor perks for user
 * Returns multipliers/bonuses if user has Arc Reactor, otherwise defaults
 */
async function getArcReactorPerks(userId) {
    const hasReactor = await hasArcReactor(userId);
    const perks = ECONOMY_CONFIG.arcReactorPerks;

    return {
        hasReactor,
        earningsMultiplier: hasReactor ? (1 + perks.earningsBonus) : 1,
        cooldownMultiplier: hasReactor ? (1 - perks.cooldownReduction) : 1,
        gamblingBonus: hasReactor ? perks.gamblingBonus : 0,
        dailyBonus: hasReactor ? perks.dailyBonusFlat : 0,
        interestRate: hasReactor ? perks.dailyInterestRate : 0,
        minigameCooldown: hasReactor ? perks.minigameCooldown : ECONOMY_CONFIG.workCooldown
    };
}

/**
 * Award SBX bonus alongside Stark Bucks earnings
 * Small SBX bonus (1% of Stark Bucks earned, scaled by SBX price)
 */
async function awardSbxBonus(userId, starkBucksEarned, reason = 'activity') {
    const sbx = getStarkbucks();
    if (!sbx) {return { sbxAwarded: 0 };}

    try {
        // Get current SBX price to calculate bonus
        const market = await sbx.getMarketData();
        const price = market?.price || 1;

        // Award 1% of Stark Bucks as SBX value (divided by price)
        // Minimum 0.01 SBX for any activity
        const sbxBonus = Math.max(0.01, (starkBucksEarned * 0.01) / price);
        const roundedBonus = Math.floor(sbxBonus * 100) / 100;

        if (roundedBonus > 0) {
            await sbx.updateWallet(userId, roundedBonus, `Bonus: ${reason}`);
            return { sbxAwarded: roundedBonus };
        }
    } catch (e) {
        // SBX system not available, continue without bonus
    }
    return { sbxAwarded: 0 };
}

/**
 * Get combined perks from Arc Reactor AND SBX purchases
 * This is the main function to check user perks across all systems
 */
async function getCombinedPerks(userId) {
    // Get Arc Reactor perks
    const arcPerks = await getArcReactorPerks(userId);

    // Get SBX purchase effects
    let sbxEffects = {};
    const sbx = getStarkbucks();
    if (sbx) {
        try {
            sbxEffects = await sbx.getUserEffects(userId);
        } catch (e) {
            sbxEffects = {};
        }
    }

    // Get Local Economy effects (Shop purchases)
    const user = await loadUser(userId);
    const localActive = await getActiveEffects(userId); // Reuse existing helper
    const inventory = user.inventory || [];

    const localBonus = {
        earnings: 0,
        cooldownRed: 0,
        gambling: 0,
        robberyImmunity: false,
        robberyDefense: 0
    };

    // Process Active Effects (Shields, Boosters)
    for (const eff of localActive) {
        // Legacy shield check
        if (eff.itemId === 'shield') {localBonus.robberyImmunity = true;}

        if (eff.effect) {
            if (eff.effect.earningsBonus) {localBonus.earnings += eff.effect.earningsBonus;}
            if (eff.effect.workCooldownReduction) {localBonus.cooldownRed += eff.effect.workCooldownReduction;}
            if (eff.effect.gamblingBonus) {localBonus.gambling += eff.effect.gamblingBonus;}
            if (eff.effect.robberyImmunity) {localBonus.robberyImmunity = true;}
            if (eff.effect.robberyDefense) {localBonus.robberyDefense += eff.effect.robberyDefense;}
        }
    }

    // Process Passive Upgrades (Inventory)
    for (const item of inventory) {
        const shopItem = SHOP_ITEMS[item.id];
        if (shopItem && shopItem.type === 'upgrade' && shopItem.effect) {
            if (shopItem.effect.workCooldownReduction) {localBonus.cooldownRed += shopItem.effect.workCooldownReduction;}
            if (shopItem.effect.gamblingBonus) {localBonus.gambling += shopItem.effect.gamblingBonus;}
        }
    }

    // Combine perks - SBX effects stack with Arc Reactor stack with Local Shop
    return {
        // Arc Reactor base
        hasReactor: arcPerks.hasReactor,

        // Earnings multiplier (Arc * SBX * Local)
        earningsMultiplier: arcPerks.earningsMultiplier * (sbxEffects.incomeMultiplier || 1) * (1 + localBonus.earnings),

        // Cooldown reduction (Stacking multiplicatively for balance)
        cooldownMultiplier: arcPerks.cooldownMultiplier * (1 - (sbxEffects.cooldownReduction || 0)) * (1 - Math.min(0.8, localBonus.cooldownRed)),

        // Gambling bonus (Additive)
        gamblingBonus: arcPerks.gamblingBonus + (sbxEffects.luckBoost || 0) + localBonus.gambling,

        // Daily multiplier
        dailyMultiplier: sbxEffects.dailyMultiplier || 1,

        // Flat daily bonus
        dailyBonus: arcPerks.dailyBonus,

        // Interest rate
        interestRate: arcPerks.interestRate,

        // Minigame cooldown
        minigameCooldown: Math.floor(arcPerks.minigameCooldown * (1 - (sbxEffects.cooldownReduction || 0))),

        // Defense
        robberyImmunity: localBonus.robberyImmunity,
        robberyDefense: localBonus.robberyDefense,

        // SBX-specific effects
        sbxMultiplier: sbxEffects.sbxMultiplier || 1,
        xpMultiplier: sbxEffects.xpMultiplier || 1,

        // AI-related perks
        memoryMultiplier: sbxEffects.memoryMultiplier || 1,
        priorityQueue: sbxEffects.priorityQueue || false,
        personalities: sbxEffects.personalities || [],
        tokenMultiplier: sbxEffects.tokenMultiplier || 1,
        betaAccess: sbxEffects.betaAccess || false,
        customCommands: sbxEffects.customCommands || 0,
        vipSupport: sbxEffects.vipSupport || false,

        // Raw SBX effects for reference
        _sbxEffects: sbxEffects
    };
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
 * Now uses combined perks from Arc Reactor AND SBX purchases
 */
async function claimDaily(userId, username) {
    const user = await loadUser(userId, username);
    const perks = await getCombinedPerks(userId);
    const now = Date.now();
    const timeSinceLastDaily = now - (user.lastDaily || 0);

    // Bot owner bypasses daily cooldown
    if (!isBotOwner(userId) && timeSinceLastDaily < ECONOMY_CONFIG.dailyCooldown) {
        const remaining = ECONOMY_CONFIG.dailyCooldown - timeSinceLastDaily;
        return {
            success: false,
            message: 'Already claimed',
            cooldown: remaining
        };
    }

    // Check streak
    const wasYesterday = timeSinceLastDaily < ECONOMY_CONFIG.dailyCooldown * 2;
    if (wasYesterday) {
        user.dailyStreak = Math.min(
            ensureNumber(user.dailyStreak, 0) + 1,
            ensureNumber(ECONOMY_CONFIG.maxDailyStreak, 30)
        );
    } else {
        user.dailyStreak = 1; // Reset streak
    }

    // Calculate reward
    const configuredDailyReward = ECONOMY_CONFIG.dailyReward;
    const baseReward =
        configuredDailyReward && typeof configuredDailyReward === 'object'
            ? ensureNumber(configuredDailyReward.min, 0) +
            Math.random() *
            (ensureNumber(configuredDailyReward.max, 0) -
                ensureNumber(configuredDailyReward.min, 0))
            : ensureNumber(configuredDailyReward, 0);

    let reward = Math.floor(baseReward);
    reward = ensureNumber(reward, 0);

    // Streak bonus
    const streakBonus =
        ensureNumber(user.dailyStreak, 0) * ensureNumber(ECONOMY_CONFIG.dailyStreakBonus, 0);
    reward = ensureNumber(reward + streakBonus, reward);

    // Arc Reactor daily bonus (+500 flat)
    let reactorBonus = 0;
    if (perks.hasReactor) {
        reactorBonus = perks.dailyBonus;
        reward += reactorBonus;
    }

    // Arc Reactor interest (1% of balance)
    let interestEarned = 0;
    if (perks.hasReactor && perks.interestRate > 0) {
        interestEarned = Math.floor(user.balance * perks.interestRate);
        reward += interestEarned;
    }

    // SBX daily multiplier (from purchased daily_multiplier item)
    if (perks.dailyMultiplier > 1) {
        reward = Math.floor(reward * perks.dailyMultiplier);
    }

    // Check for double daily item
    const hasDoubleDaily = (user.inventory || []).find(i => i.id === 'double_daily' && i.uses > 0);
    if (hasDoubleDaily) {
        reward *= 2;
        hasDoubleDaily.uses -= 1;
        if (hasDoubleDaily.uses <= 0) {
            user.inventory = user.inventory.filter(i => i.id !== 'double_daily');
        }
    }

    user.balance =
        ensureNumber(user.balance, ECONOMY_CONFIG.startingBalance) + ensureNumber(reward, 0);
    user.totalEarned = ensureNumber(user.totalEarned, 0) + ensureNumber(reward, 0);
    user.lastDaily = now;

    await saveUser(userId, user);

    // Award SBX bonus (1% of earnings)
    const sbxBonus = await awardSbxBonus(userId, reward, 'daily');

    return {
        success: true,
        reward,
        streak: user.dailyStreak,
        streakBonus,
        doubled: !!hasDoubleDaily,
        newBalance: user.balance,
        sbxAwarded: sbxBonus.sbxAwarded
    };
}

/**
 * Work for money
 */
async function work(userId, username) {
    const user = await loadUser(userId, username);
    const arcPerks = await getArcReactorPerks(userId);

    // Check for work cooldown reduction
    const effects = await getActiveEffects(userId);
    let { cooldownMultiplier } = arcPerks; // Arc Reactor reduces cooldowns
    effects.forEach(e => {
        if (e.effect?.workCooldownReduction) {
            cooldownMultiplier *= 1 - e.effect.workCooldownReduction;
        }
    });

    const cooldown = checkCooldown(
        userId,
        'work',
        ECONOMY_CONFIG.workCooldown * cooldownMultiplier
    );
    if (cooldown.onCooldown) {
        return { success: false, cooldown: cooldown.remaining };
    }

    let reward = Math.floor(
        ECONOMY_CONFIG.workReward.min +
        Math.random() * (ECONOMY_CONFIG.workReward.max - ECONOMY_CONFIG.workReward.min)
    );

    // Apply Arc Reactor earnings bonus
    reward = Math.floor(reward * arcPerks.earningsMultiplier);

    // Apply multiplier bonus if event active
    if (isMultiplierActive()) {
        reward = Math.floor(reward * ECONOMY_CONFIG.multiplierBonus);
    }

    const jobs = [
        `fixed a bug in the Mark ${Math.floor(Math.random() * 50 + 1)} suit`,
        'calibrated the arc reactor',
        'organized Tony\'s workshop',
        'debugged FRIDAY\'s code',
        'polished the Iron Legion',
        'updated the Stark satellite network',
        'ran diagnostics on the Quinjet',
        'cleaned Dum-E\'s mess',
        'tested new repulsor tech',
        'encrypted classified files',
        'repaired JARVIS\'s voice module',
        'optimized nanotech deployment systems',
        'calibrated Iron Man\'s targeting systems',
        'fixed the Avengers Tower elevator',
        'debugged War Machine\'s flight systems',
        'updated Pepper\'s calendar integration',
        'tested new energy shield prototypes',
        'organized Cap\'s shield collection',
        'repaired Spider-Man\'s web shooters',
        'calibrated Hawkeye\'s bow targeting',
        'fixed Black Widow\'s stealth tech',
        'updated Thor\'s hammer tracking',
        'debugged Hulk\'s transformation sensors',
        'repaired Vision\'s density controls',
        'calibrated Scarlet Witch\'s power dampeners',
        'fixed Doctor Strange\'s portal generator',
        'updated Black Panther\'s vibranium suit',
        'debugged Ant-Man\'s size controls',
        'repaired Wasp\'s shrinking tech',
        'calibrated Captain Marvel\'s energy absorption',
        'fixed Falcon\'s wing systems',
        'updated Winter Soldier\'s arm',
        'debugged Loki\'s illusion projectors',
        'repaired Rocket\'s weapon modifications',
        'calibrated Groot\'s growth inhibitors',
        'fixed Drax\'s invisibility (still working on it)',
        'updated Gamora\'s sword maintenance',
        'debugged Nebula\'s cybernetic upgrades',
        'repaired Mantis\'s empathy sensors',
        'calibrated Star-Lord\'s music player',
        'fixed Yondu\'s arrow controller',
        'updated Ego\'s planet core systems',
        'debugged Thanos\'s gauntlet interface',
        'repaired Ultron\'s consciousness backup',
        'calibrated Zemo\'s mask filters',
        'fixed Killmonger\'s suit systems',
        'updated Shuri\'s lab equipment',
        'debugged M\'Baku\'s armor',
        'repaired Okoye\'s spear tech',
        'calibrated Nakia\'s ring blades'
    ];

    const job = jobs[Math.floor(Math.random() * jobs.length)];

    user.balance += reward;
    user.totalEarned = (user.totalEarned || 0) + reward;
    await saveUser(userId, user);

    // Award SBX bonus (1% of earnings)
    const sbxBonus = await awardSbxBonus(userId, reward, 'work');

    return {
        success: true,
        reward,
        job,
        newBalance: user.balance,
        sbxAwarded: sbxBonus.sbxAwarded
    };
}

// Games extracted to economy/games.js


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
    if (!item) {return { success: false, error: 'Item not found' };}

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
 * Get top users by balance (with disk caching)
 * @param {number} limit - Number of users to return
 * @param {Object} client - Optional Discord client to fetch current usernames
 */
async function getLeaderboard(limit = 10, client = null) {
    try {
        // Check disk cache first
        if (fs.existsSync(LEADERBOARD_CACHE_PATH)) {
            try {
                const cacheData = JSON.parse(fs.readFileSync(LEADERBOARD_CACHE_PATH, 'utf-8'));
                const cacheAge = Date.now() - (cacheData.cachedAt || 0);

                // Return cached data if fresh and same limit
                if (cacheAge < LEADERBOARD_CACHE_TTL_MS && cacheData.limit >= limit) {
                    console.log(`[StarkEconomy] Leaderboard from disk cache (${Math.round(cacheAge / 1000)}s old)`);
                    return cacheData.entries.slice(0, limit);
                }
            } catch (e) {
                // Cache corrupted, will refresh
            }
        }

        // Fetch fresh data from DB
        const col = await getCollection();
        const users = await col.find({}).sort({ balance: -1 }).limit(limit).toArray();

        // Fetch current usernames from Discord if client is provided
        const leaderboardEntries = await Promise.all(
            users.map(async(u, i) => {
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
                        console.warn(
                            `[StarkEconomy] Failed to fetch username for user ${u.userId}:`,
                            error.message
                        );
                    }
                }

                return {
                    rank: i + 1,
                    userId: u.userId,
                    username: username,
                    balance: ensureNumber(u.balance, 0),
                    hasGoldenName: (u.inventory || []).some(item => item.id === 'golden_name'),
                    hasVipBadge: (u.inventory || []).some(item => item.id === 'vip_badge')
                };
            })
        );

        // Save to disk cache
        try {
            const cacheData = {
                cachedAt: Date.now(),
                limit: limit,
                entries: leaderboardEntries
            };
            fs.writeFileSync(LEADERBOARD_CACHE_PATH, JSON.stringify(cacheData));
            console.log('[StarkEconomy] Leaderboard cached to disk');
        } catch (e) {
            console.warn('[StarkEconomy] Failed to cache leaderboard:', e.message);
        }

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
        winRate: user.gamesPlayed > 0 ? Math.round((user.gamesWon / user.gamesPlayed) * 100) : 0,
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
        if (now - timestamp > 24 * 60 * 60 * 1000) {
            // 24 hours
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
        await col.updateMany({}, { $pull: { activeEffects: { expiresAt: { $lt: now } } } });
    } catch (error) {
        console.error('[StarkEconomy] Cleanup failed:', error);
    }

    lastCleanup = now;
    console.log('[StarkEconomy] Cleanup completed');
}


// Minigames extracted to economy/minigames.js


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
        nextEventIn: active
            ? null
            : Math.max(0, lastMultiplierStart + ECONOMY_CONFIG.multiplierInterval - Date.now())
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
    if (!isMultiplierActive()) {return '';}

    const remaining = multiplierEndTime - Date.now();
    const hours = Math.floor(remaining / (60 * 60 * 1000));
    const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));

    return `\n\n🎉 **600% BOOST ACTIVE!** All earnings x6! (${hours}h ${minutes}m remaining)`;
}

// Schedule multiplier events every 3 hours
let multiplierInterval = null;
function startMultiplierScheduler() {
    if (multiplierInterval) {clearInterval(multiplierInterval);}

    // Start first event after 3 hours
    multiplierInterval = setInterval(() => {
        if (!isMultiplierActive()) {
            startMultiplierEvent();
        }
    }, ECONOMY_CONFIG.multiplierInterval);

    console.log('[StarkEconomy] Multiplier event scheduler started (every 3 hours)');
}

// ============================================================================
// TINKER / CRAFTING SYSTEM
// ============================================================================

/**
 * Get user's collected materials
 */
async function getMaterials(userId) {
    const user = await loadUser(userId);
    return user.materials || {};
}

/**
 * Check if user has required materials for a recipe
 */
async function hasRequiredMaterials(userId, ingredients) {
    const materials = await getMaterials(userId);
    for (const [material, required] of Object.entries(ingredients)) {
        if ((materials[material] || 0) < required) {
            return false;
        }
    }
    return true;
}

/**
 * Craft an item from materials
 */
async function craftItem(userId, recipeId, recipe) {
    const user = await loadUser(userId);
    user.materials = user.materials || {};

    // Check if user has all required materials
    for (const [material, required] of Object.entries(recipe.ingredients)) {
        if ((user.materials[material] || 0) < required) {
            return {
                success: false,
                error: `Missing ${required - (user.materials[material] || 0)}x ${material}`
            };
        }
    }

    // Consume materials
    for (const [material, required] of Object.entries(recipe.ingredients)) {
        user.materials[material] -= required;
        if (user.materials[material] <= 0) {
            delete user.materials[material];
        }
    }

    // Add crafted item to inventory
    user.inventory = user.inventory || [];
    user.inventory.push({
        id: recipeId,
        name: recipe.name,
        description: recipe.description,
        value: recipe.value,
        rarity: recipe.rarity,
        craftedAt: Date.now()
    });

    // Track crafting stats
    user.totalCrafted = (user.totalCrafted || 0) + 1;

    await saveUser(userId, user);

    return {
        success: true,
        item: recipe.name,
        value: recipe.value,
        rarity: recipe.rarity
    };
}

/**
 * Sell a crafted item for coins
 */
async function sellItem(userId, itemIndex) {
    const user = await loadUser(userId);
    user.inventory = user.inventory || [];

    if (itemIndex < 0 || itemIndex >= user.inventory.length) {
        return { success: false, error: 'Invalid item index' };
    }

    const item = user.inventory[itemIndex];

    // Can't sell special items like arc_reactor
    if (item.id === 'arc_reactor' || item.oneTime) {
        return { success: false, error: 'This item cannot be sold' };
    }

    const sellValue = Math.floor((item.value || 100) * 0.7); // 70% of value
    user.inventory.splice(itemIndex, 1);
    user.balance += sellValue;
    user.totalEarned = (user.totalEarned || 0) + sellValue;

    await saveUser(userId, user);

    return {
        success: true,
        item: item.name,
        value: sellValue,
        newBalance: user.balance
    };
}


// Advanced features extracted to economy/advanced.js

// ============================================================================
// SUB-MODULE INITIALIZATION (factory pattern)
// ============================================================================

const _games = require('./economy/games')({
    loadUser, saveUser, modifyBalance, getActiveEffects, getArcReactorPerks,
    getCombinedPerks, checkCooldown, isBotOwner, ensureNumber,
    isMultiplierActive, ECONOMY_CONFIG, SLOT_SYMBOLS
});

const _minigames = require('./economy/minigames')({
    loadUser, saveUser, checkCooldown, getArcReactorPerks,
    isMultiplierActive, ECONOMY_CONFIG, MINIGAME_REWARDS
});

const _advanced = require('./economy/advanced')({
    loadUser, saveUser, modifyBalance, checkCooldown,
    getStarkbucks, ECONOMY_CONFIG
});

// Re-export sub-module functions
const {
    gamble, playSlots, coinflip, playBlackjack, rob
} = _games;

const {
    playMinigame, hunt, fish, dig, beg, crime, postmeme, search, getSearchLocations
} = _minigames;

const {
    getDailyChallenges, updateChallengeProgress,
    getPrestigeData, prestige,
    getBossData, attackBoss,
    getLotteryData, buyLotteryTickets,
    getQuestData, getAvailableQuests, startQuest, completeQuest,
    getTournamentData, joinTournament,
    investSBX, withdrawInvestment, getSBXMarketData, buySBX, sellSBX, getSBXBalance
} = _advanced;

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
    isBotOwner,

    // Games
    claimDaily,
    work,
    gamble,
    playSlots,
    coinflip,
    playBlackjack,
    rob,

    // Shop
    getShopItems,
    buyItem,
    getInventory,
    getActiveEffects,

    // Arc Reactor & SBX Perks
    hasArcReactor,
    getArcReactorPerks,
    getCombinedPerks,

    // Tinker / Crafting
    getMaterials,
    hasRequiredMaterials,
    craftItem,
    sellItem,

    // Stats
    getLeaderboard,
    getUserStats,

    // Minigames
    hunt,
    fish,
    dig,
    beg,
    crime,
    rob,
    postmeme,
    search,
    give,

    // Maintenance
    cleanup,

    // Multiplier Events
    isMultiplierActive,
    getMultiplier,
    getMultiplierStatus,
    getBoostText,
    startMultiplierEvent,
    startMultiplierScheduler,

    // Daily Challenges
    getDailyChallenges,
    updateChallengeProgress,

    // Prestige System
    getPrestigeData,
    prestige,

    // Boss Battles
    getBossData,
    attackBoss,

    // Lottery
    getLotteryData,
    buyLotteryTickets,

    // Quests
    getQuestData,
    getAvailableQuests,
    startQuest,
    completeQuest,

    // Tournaments
    getTournamentData,
    joinTournament,

    // SBX Wrappers
    investSBX,
    withdrawInvestment,
    getSBXMarketData,
    buySBX,
    sellSBX,
    getSBXBalance,

    // Utility
    formatCompact
};

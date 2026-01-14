/**
 * Starkbucks Exchange System (SBX)
 * Virtual currency exchange with price fluctuation, transactions, and store
 * 
 * Features:
 * - SBX currency with dynamic pricing (like crypto!)
 * - Transaction system with unique URLs
 * - Online store for unlockables
 * - 10% owner fee on all transactions
 * - Investment/reinvestment system
 * - Price fluctuation based on activity + USD
 * - Supports local MongoDB on selfhost (mongodb://localhost:27017)
 * - LRU caching for efficient database operations
 */

'use strict';

const crypto = require('crypto');
const database = require('./database');

// ============================================================================
// LRU CACHE FOR PERFORMANCE
// ============================================================================

const LruModule = require('lru-cache');
let LRUCache = null;
if (typeof LruModule === 'function') {
    LRUCache = LruModule;
} else if (typeof LruModule?.LRUCache === 'function') {
    ({ LRUCache } = LruModule);
} else if (typeof LruModule?.default === 'function') {
    LRUCache = LruModule.default;
}

// Cache configuration
const WALLET_CACHE_TTL = 2 * 60 * 1000; // 2 minutes
const WALLET_CACHE_MAX = 500;
const PURCHASE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const PURCHASE_CACHE_MAX = 200;

// Initialize caches
const walletCache = LRUCache ? new LRUCache({ max: WALLET_CACHE_MAX, ttl: WALLET_CACHE_TTL }) : new Map();
const purchaseCache = LRUCache ? new LRUCache({ max: PURCHASE_CACHE_MAX, ttl: PURCHASE_CACHE_TTL }) : new Map();

// ============================================================================
// CONFIGURATION
// ============================================================================

const SBX_CONFIG = {
    // Currency settings
    symbol: 'SBX',
    name: 'Starkbucks',
    decimals: 2,

    // Price fluctuation settings
    basePrice: 1.00,           // Base price in "USD"
    minPrice: 0.01,            // Minimum price (lowered to allow more range)
    maxPrice: 100000.00,       // Maximum price (100K cap)
    targetPrice: 1.00,         // Target equilibrium price for mean reversion
    volatility: 0.03,          // 3% max random change per tick
    maxTickChange: 0.05,       // Maximum 5% change per tick
    tickInterval: 20 * 1000,   // Price updates every 20 seconds

    // Recovery mechanics
    recoveryStrength: 0.02,    // 2% pull toward target when far from it
    recoveryThreshold: 0.5,    // Start recovery when price < 50% of target

    // Transaction settings
    ownerFeePercent: 0.10,     // 10% fee goes to bot owner
    minTransaction: 1,         // Minimum SBX per transaction
    maxTransaction: 1000000,   // Maximum SBX per transaction
    transactionExpiry: 24 * 60 * 60 * 1000, // 24 hours

    // Activity bonuses
    activityMultiplier: 0.001, // Price increase per active user
    volumeMultiplier: 0.0001,  // Price increase per SBX traded

    // Market events (random events that affect price) - reduced impact to prevent wild swings
    marketEvents: [
        { name: '📈 Bull Run', priceChange: 0.05, chance: 0.04, duration: 20 * 60 * 1000 },
        { name: '📉 Bear Market', priceChange: -0.05, chance: 0.04, duration: 20 * 60 * 1000 },
        { name: '🚀 Stark Industries IPO', priceChange: 0.08, chance: 0.02, duration: 30 * 60 * 1000 },
        { name: '💥 Market Dip', priceChange: -0.07, chance: 0.02, duration: 25 * 60 * 1000 },
        { name: '⭐ Celebrity Endorsement', priceChange: 0.04, chance: 0.05, duration: 15 * 60 * 1000 },
        { name: '📰 Bad Press', priceChange: -0.03, chance: 0.05, duration: 15 * 60 * 1000 },
        { name: '🎉 Community Event', priceChange: 0.02, chance: 0.08, duration: 10 * 60 * 1000 },
        { name: '🔧 Maintenance', priceChange: -0.02, chance: 0.08, duration: 8 * 60 * 1000 }
    ]
};

// ============================================================================
// STORE ITEMS (Unlockables)
// ============================================================================

const STORE_ITEMS = {
    // === COSMETICS ===
    custom_embed_color: {
        id: 'custom_embed_color',
        name: '🎨 Custom Embed Color',
        description: 'Set a custom color for all bot embeds in your messages',
        price: 500,
        category: 'cosmetic',
        oneTime: true,
        config: { type: 'color_picker' }
    },
    animated_badge: {
        id: 'animated_badge',
        name: '✨ Animated Profile Badge',
        description: 'A sparkly animated badge on your profile',
        price: 1000,
        category: 'cosmetic',
        oneTime: true
    },
    custom_welcome: {
        id: 'custom_welcome',
        name: '👋 Custom Welcome Message',
        description: 'Set a personalized welcome message when you join voice',
        price: 750,
        category: 'cosmetic',
        oneTime: true,
        config: { type: 'text_input', maxLength: 200 }
    },
    profile_banner: {
        id: 'profile_banner',
        name: '🖼️ Profile Banner',
        description: 'Add a custom banner to your Jarvis profile',
        price: 1500,
        category: 'cosmetic',
        oneTime: true,
        config: { type: 'image_url' }
    },
    title_prefix: {
        id: 'title_prefix',
        name: '👑 Custom Title',
        description: 'Add a custom title/prefix to your name in leaderboards',
        price: 2000,
        category: 'cosmetic',
        oneTime: true,
        config: { type: 'text_input', maxLength: 20 }
    },

    // === AI FEATURES ===
    extended_memory: {
        id: 'extended_memory',
        name: '🧠 Extended AI Memory',
        description: 'AI remembers 2x more conversation context',
        price: 3000,
        category: 'feature',
        oneTime: true,
        effect: { memoryMultiplier: 2 }
    },
    priority_queue: {
        id: 'priority_queue',
        name: '⚡ Priority AI Queue',
        description: 'Skip the queue for AI responses',
        price: 5000,
        category: 'feature',
        oneTime: true,
        effect: { priorityQueue: true }
    },
    ai_personality: {
        id: 'ai_personality',
        name: '🎭 AI Personality Pack',
        description: 'Unlock custom AI personalities (Sarcastic, Formal, Pirate, etc.)',
        price: 2500,
        category: 'feature',
        oneTime: true,
        effect: { personalities: ['sarcastic', 'formal', 'pirate', 'shakespeare', 'gen_z'] }
    },
    unlimited_tokens: {
        id: 'unlimited_tokens',
        name: '♾️ Extended Token Limit',
        description: 'Double your daily AI token limit',
        price: 4000,
        category: 'feature',
        oneTime: true,
        effect: { tokenMultiplier: 2 }
    },

    // === ECONOMY BOOSTS ===
    daily_multiplier: {
        id: 'daily_multiplier',
        name: '📈 Daily Bonus Multiplier',
        description: 'Permanently get 1.5x daily rewards',
        price: 8000,
        category: 'economy',
        oneTime: true,
        effect: { dailyMultiplier: 1.5 }
    },
    luck_boost: {
        id: 'luck_boost',
        name: '🍀 Permanent Luck Boost',
        description: '+10% gambling win rate forever',
        price: 10000,
        category: 'economy',
        oneTime: true,
        effect: { luckBoost: 0.10 }
    },
    income_boost: {
        id: 'income_boost',
        name: '💰 Income Multiplier',
        description: '+25% earnings from all minigames',
        price: 12000,
        category: 'economy',
        oneTime: true,
        effect: { incomeMultiplier: 1.25 }
    },
    cooldown_reduction: {
        id: 'cooldown_reduction',
        name: '⏰ Cooldown Reducer',
        description: '-30% cooldown on all economy commands',
        price: 7500,
        category: 'economy',
        oneTime: true,
        effect: { cooldownReduction: 0.30 }
    },

    // === EXCLUSIVE ACCESS ===
    beta_features: {
        id: 'beta_features',
        name: '🔬 Beta Tester Access',
        description: 'Early access to new features before release',
        price: 15000,
        category: 'exclusive',
        oneTime: true,
        effect: { betaAccess: true }
    },
    custom_commands: {
        id: 'custom_commands',
        name: '⌨️ Custom Command Aliases',
        description: 'Create up to 5 custom command shortcuts',
        price: 6000,
        category: 'exclusive',
        oneTime: true,
        effect: { customCommands: 5 }
    },
    vip_support: {
        id: 'vip_support',
        name: '🎫 VIP Support',
        description: 'Priority support channel access',
        price: 20000,
        category: 'exclusive',
        oneTime: true,
        effect: { vipSupport: true }
    },

    // === CONSUMABLES (can buy multiple) ===
    sbx_booster_1h: {
        id: 'sbx_booster_1h',
        name: '🚀 SBX Booster (1h)',
        description: '+50% SBX earnings for 1 hour',
        price: 200,
        category: 'consumable',
        oneTime: false,
        duration: 60 * 60 * 1000,
        effect: { sbxMultiplier: 1.5 }
    },
    double_xp_1h: {
        id: 'double_xp_1h',
        name: '⚡ Double XP (1h)',
        description: '2x experience gain for 1 hour',
        price: 300,
        category: 'consumable',
        oneTime: false,
        duration: 60 * 60 * 1000,
        effect: { xpMultiplier: 2 }
    },
    mystery_box: {
        id: 'mystery_box',
        name: '📦 Mystery Box',
        description: 'Random reward between 100-5000 SBX',
        price: 500,
        category: 'consumable',
        oneTime: false,
        effect: { type: 'mystery', min: 100, max: 5000 }
    }
};

// ============================================================================
// IN-MEMORY STATE
// ============================================================================

let currentPrice = SBX_CONFIG.basePrice;
const priceHistory = [];
let activeEvent = null;
let dailyVolume = 0;
const activeUsers = new Set();
let lastPriceTick = 0; // Start at 0 to allow immediate first update
let priceMomentum = 0; // Trend momentum (-1 to 1)

// Pending transactions cache
const pendingTransactions = new Map();

// ============================================================================
// NEWS SYSTEM - Persisted to MongoDB, auto-deletes after 24 hours
// ============================================================================

const NEWS_MAX_ITEMS = 50;
const NEWS_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours
const NEWS_SECRET = process.env.SBX_NEWS_SECRET || process.env.BOT_OWNER_ID || 'sbx-news-secret';

/**
 * Add news item (site owner only via API)
 * News can optionally affect price with priceImpact (-0.10 to +0.10)
 * Now persists to MongoDB and supports image URLs
 */
async function addNewsItem(headline, priceImpact = 0, secretKey = null, image = null) {
    // Clamp price impact to reasonable bounds (-10% to +10%)
    const clampedImpact = Math.max(-0.10, Math.min(0.10, priceImpact || 0));

    const newsItem = {
        id: crypto.randomBytes(8).toString('hex'),
        headline: String(headline).slice(0, 280),
        priceImpact: Math.round(clampedImpact * 10000) / 100, // Store as percentage for display
        image: image ? String(image).slice(0, 500) : null,
        timestamp: new Date(),
        expiresAt: new Date(Date.now() + NEWS_EXPIRY_MS), // Auto-delete after 24h
        applied: false
    };

    // Apply price impact immediately if set
    if (clampedImpact !== 0) {
        const oldPrice = currentPrice;
        currentPrice *= (1 + clampedImpact);
        currentPrice = Math.max(SBX_CONFIG.minPrice, Math.min(SBX_CONFIG.maxPrice, currentPrice));
        currentPrice = Math.round(currentPrice * 100) / 100;
        newsItem.applied = true;
        newsItem.oldPrice = oldPrice;
        newsItem.newPrice = currentPrice;
    }

    // Save to MongoDB
    try {
        const col = await dbGetCollection('sbx_news');
        await col.insertOne(newsItem);
        // Clean up old news (keep only latest N and delete expired)
        await col.deleteMany({
            $or: [
                { expiresAt: { $lt: new Date() } },
            ]
        });
        // Keep only latest N items
        const count = await col.countDocuments();
        if (count > NEWS_MAX_ITEMS) {
            const oldest = await col.find().sort({ timestamp: 1 }).limit(count - NEWS_MAX_ITEMS).toArray();
            if (oldest.length > 0) {
                await col.deleteMany({ _id: { $in: oldest.map(n => n._id) } });
            }
        }
    } catch (e) {
        console.error('[SBX News] Failed to save news:', e.message);
    }

    return { success: true, news: newsItem };
}

/**
 * Get latest news feed from MongoDB
 */
async function getNews(limit = 10) {
    try {
        const col = await dbGetCollection('sbx_news');
        // Delete expired news first
        await col.deleteMany({ expiresAt: { $lt: new Date() } });
        // Get latest news
        const news = await col.find().sort({ timestamp: -1 }).limit(limit).toArray();
        return news;
    } catch (e) {
        console.error('[SBX News] Failed to get news:', e.message);
        return [];
    }
}

/**
 * Clear all news (site owner only)
 */
async function clearNews(secretKey) {
    if (secretKey !== NEWS_SECRET && secretKey !== process.env.BOT_OWNER_ID) {
        return { success: false, error: 'Invalid secret key' };
    }
    try {
        const col = await dbGetCollection('sbx_news');
        await col.deleteMany({});
        return { success: true };
    } catch (e) {
        return { success: false, error: 'Database error' };
    }
}

// ============================================================================
// DATABASE OPERATIONS (uses MongoDB - local or remote via MONGO_URI_MAIN)
// ============================================================================

async function dbGetCollection(name) {
    await database.connect();
    if (!database.db) {
        throw new Error('[SBX] Database not connected');
    }
    return database.db.collection(name);
}

async function getCollection(name) {
    await database.connect();
    if (!database.db) {
        throw new Error('[SBX] Database not connected. Set MONGO_URI_MAIN to your local MongoDB (e.g., mongodb://localhost:27017/jarvis)');
    }
    return database.db.collection(name);
}

async function dbFindOne(collection, query) {
    const col = await getCollection(collection);
    return col.findOne(query);
}

async function dbFind(collection, query = {}) {
    const col = await getCollection(collection);
    return col.find(query).toArray();
}

async function dbInsertOne(collection, doc) {
    const col = await getCollection(collection);
    return col.insertOne(doc);
}

async function dbUpdateOne(collection, query, update, options = {}) {
    const col = await getCollection(collection);
    return col.updateOne(query, update, options);
}

// ============================================================================
// WALLET OPERATIONS
// ============================================================================

/**
 * Get user's SBX wallet (with caching)
 */
async function getWallet(userId) {
    // Check cache first
    const cacheKey = `wallet:${userId}`;
    if (walletCache.has(cacheKey)) {
        return walletCache.get(cacheKey);
    }

    let wallet = await dbFindOne('sbx_wallets', { userId });

    if (!wallet) {
        wallet = {
            userId,
            balance: 0,
            totalDeposited: 0,
            totalWithdrawn: 0,
            totalSpent: 0,
            totalEarned: 0,
            purchases: [],
            activeEffects: [],
            createdAt: new Date(),
            updatedAt: new Date()
        };
        await dbInsertOne('sbx_wallets', wallet);
    }

    // Cache the wallet
    walletCache.set(cacheKey, wallet);

    return wallet;
}

/**
 * Update user's SBX wallet balance atomically
 * Uses $inc for atomic updates to prevent race conditions
 */
async function updateWallet(userId, amount, reason = 'unknown') {
    // Ensure wallet exists first
    await getWallet(userId);

    // Invalidate cache before update
    walletCache.delete(`wallet:${userId}`);

    const col = await getCollection('sbx_wallets');

    // Use atomic $inc operation
    const update = {
        $inc: { balance: amount },
        $set: { updatedAt: new Date() }
    };

    if (amount > 0) {
        update.$inc.totalEarned = amount;
    } else {
        update.$inc.totalSpent = Math.abs(amount);
    }

    // Atomic update with balance floor check
    // For withdrawals, ensure balance doesn't go negative
    const query = amount < 0
        ? { userId, balance: { $gte: Math.abs(amount) } }
        : { userId };

    const result = await col.findOneAndUpdate(
        query,
        update,
        { returnDocument: 'after' }
    );

    if (!result) {
        // If withdrawal failed due to insufficient balance
        if (amount < 0) {
            return { success: false, error: 'Insufficient balance', oldBalance: 0, newBalance: 0, change: 0, reason };
        }
        throw new Error('Wallet update failed');
    }

    const newBalance = result.balance || 0;
    const oldBalance = newBalance - amount;

    return { success: true, oldBalance, newBalance, change: amount, reason };
}

/**
 * Get bot owner's wallet (for fees)
 */
async function _getOwnerWallet() {
    const ownerId = process.env.BOT_OWNER_ID || null;
    return getWallet(ownerId);
}

/**
 * Transfer SBX between users with owner fee
 */
async function transfer(fromUserId, toUserId, amount, memo = '') {
    if (amount < SBX_CONFIG.minTransaction) {
        return { success: false, error: `Minimum transaction is ${SBX_CONFIG.minTransaction} SBX` };
    }
    if (amount > SBX_CONFIG.maxTransaction) {
        return { success: false, error: `Maximum transaction is ${SBX_CONFIG.maxTransaction} SBX` };
    }

    const fromWallet = await getWallet(fromUserId);
    if (fromWallet.balance < amount) {
        return { success: false, error: 'Insufficient SBX balance' };
    }

    // Calculate fee
    const fee = Math.floor(amount * SBX_CONFIG.ownerFeePercent * 100) / 100;
    const netAmount = amount - fee;

    // Create transaction record
    const transaction = await createTransaction({
        type: 'transfer',
        from: fromUserId,
        to: toUserId,
        amount,
        fee,
        netAmount,
        memo,
        status: 'completed'
    });

    // Execute transfer
    await updateWallet(fromUserId, -amount, `Transfer to ${toUserId}`);
    await updateWallet(toUserId, netAmount, `Transfer from ${fromUserId}`);

    // Fee goes to owner
    if (fee > 0) {
        const ownerId = process.env.BOT_OWNER_ID || null;
        await updateWallet(ownerId, fee, `Fee from transfer ${transaction.id}`);
    }

    // Track volume
    dailyVolume += amount;
    activeUsers.add(fromUserId);
    activeUsers.add(toUserId);

    return {
        success: true,
        transaction,
        fee,
        netAmount
    };
}

// ============================================================================
// TRANSACTION SYSTEM
// ============================================================================

/**
 * Generate unique transaction ID
 */
function generateTransactionId() {
    return crypto.randomBytes(12).toString('hex');
}

/**
 * Create a new transaction record
 */
async function createTransaction(data) {
    const transaction = {
        id: generateTransactionId(),
        ...data,
        priceAtTime: currentPrice,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + SBX_CONFIG.transactionExpiry)
    };

    await dbInsertOne('sbx_transactions', transaction);
    pendingTransactions.set(transaction.id, transaction);

    return transaction;
}

/**
 * Get transaction by ID
 */
async function getTransaction(transactionId) {
    // Check cache first
    if (pendingTransactions.has(transactionId)) {
        return pendingTransactions.get(transactionId);
    }

    return dbFindOne('sbx_transactions', { id: transactionId });
}

/**
 * Create a payment request (generates URL)
 */
async function createPaymentRequest(requesterId, amount, memo = '', recipientId = null) {
    const transaction = await createTransaction({
        type: 'payment_request',
        from: null,  // Will be set when paid
        to: recipientId || requesterId,
        requestedBy: requesterId,
        amount,
        fee: Math.floor(amount * SBX_CONFIG.ownerFeePercent * 100) / 100,
        memo,
        status: 'pending'
    });

    // Generate URL path
    const baseUrl = process.env.PUBLIC_BASE_URL || process.env.JARVIS_DOMAIN || 'localhost:3000';
    const url = `https://${baseUrl.replace(/^https?:\/\//, '')}/transaction/${transaction.id}`;

    return {
        transaction,
        url,
        expiresAt: transaction.expiresAt
    };
}

/**
 * Complete a payment request
 */
async function completePayment(transactionId, payerId) {
    const transaction = await getTransaction(transactionId);

    if (!transaction) {
        return { success: false, error: 'Transaction not found' };
    }
    if (transaction.status !== 'pending') {
        return { success: false, error: 'Transaction already processed' };
    }
    if (new Date() > new Date(transaction.expiresAt)) {
        return { success: false, error: 'Transaction expired' };
    }

    const payerWallet = await getWallet(payerId);
    if (payerWallet.balance < transaction.amount) {
        return { success: false, error: 'Insufficient SBX balance' };
    }

    // Execute payment
    const netAmount = transaction.amount - transaction.fee;

    await updateWallet(payerId, -transaction.amount, `Payment ${transactionId}`);
    await updateWallet(transaction.to, netAmount, `Received payment ${transactionId}`);

    // Fee to owner
    if (transaction.fee > 0) {
        const ownerId = process.env.BOT_OWNER_ID || null;
        await updateWallet(ownerId, transaction.fee, `Fee from payment ${transactionId}`);
    }

    // Update transaction
    await dbUpdateOne('sbx_transactions',
        { id: transactionId },
        {
            $set: {
                from: payerId,
                status: 'completed',
                completedAt: new Date()
            }
        }
    );

    pendingTransactions.delete(transactionId);

    // Track activity
    dailyVolume += transaction.amount;
    activeUsers.add(payerId);
    activeUsers.add(transaction.to);

    return { success: true, transaction: { ...transaction, from: payerId, status: 'completed' } };
}

// ============================================================================
// EXCHANGE / PRICE SYSTEM
// ============================================================================

/**
 * Update price based on market conditions
 * Features mean reversion, recovery mechanics, and balanced volatility
 */
async function updatePrice() {
    const now = Date.now();
    if (now - lastPriceTick < SBX_CONFIG.tickInterval) {
        return currentPrice;
    }
    lastPriceTick = now;

    const oldPrice = currentPrice;
    let newPrice = currentPrice;
    const target = SBX_CONFIG.targetPrice;

    // =========================================================================
    // MEAN REVERSION - Price naturally gravitates toward target over time
    // =========================================================================
    const priceRatio = currentPrice / target;
    let meanReversionForce = 0;

    if (priceRatio < 0.1) {
        // CRITICAL: Price is extremely low (<10% of target) - strong recovery
        meanReversionForce = 0.08; // 8% upward push
    } else if (priceRatio < 0.3) {
        // Price is very low (<30% of target) - moderate recovery
        meanReversionForce = 0.04; // 4% upward push
    } else if (priceRatio < 0.7) {
        // Price is below target - gentle recovery
        meanReversionForce = 0.02; // 2% upward push
    } else if (priceRatio > 3.0) {
        // Price is very high (>300% of target) - gentle pullback
        meanReversionForce = -0.02;
    } else if (priceRatio > 5.0) {
        // Price is extremely high - moderate pullback
        meanReversionForce = -0.03;
    }

    newPrice *= (1 + meanReversionForce);

    // =========================================================================
    // MOMENTUM - Creates natural trends (but balanced)
    // =========================================================================
    // Bias momentum toward positive when price is low
    const momentumBias = priceRatio < 0.5 ? 0.1 : (priceRatio > 2 ? -0.05 : 0);
    priceMomentum += (Math.random() - 0.5 + momentumBias) * 0.1;
    priceMomentum = Math.max(-0.3, Math.min(0.3, priceMomentum));
    priceMomentum *= 0.95; // Gradual decay

    // =========================================================================
    // RANDOM VOLATILITY - Natural market fluctuation
    // =========================================================================
    const randomChange = ((Math.random() - 0.5) + priceMomentum * 0.2) * SBX_CONFIG.volatility;
    newPrice *= (1 + randomChange);

    // =========================================================================
    // ACTIVITY & VOLUME BONUSES - Reward engagement
    // =========================================================================
    const activityBonus = Math.min(activeUsers.size * SBX_CONFIG.activityMultiplier, 0.015);
    const volumeBonus = Math.min(dailyVolume * SBX_CONFIG.volumeMultiplier, 0.02);
    newPrice *= (1 + activityBonus + volumeBonus);

    // =========================================================================
    // MARKET EVENTS - Random events with reduced frequency when recovering
    // =========================================================================
    if (activeEvent && now < activeEvent.expiresAt) {
        // Reduce negative event impact when price is low
        let eventImpact = activeEvent.priceChange;
        if (eventImpact < 0 && priceRatio < 0.5) {
            eventImpact *= 0.3; // Reduce negative events when price is low
        }
        newPrice *= (1 + eventImpact);
    } else {
        activeEvent = null;
    }

    // Check for new random event (less likely when recovering)
    if (!activeEvent) {
        const eventChanceMultiplier = priceRatio < 0.5 ? 0.3 : 1; // Fewer events during recovery
        for (const event of SBX_CONFIG.marketEvents) {
            // Skip negative events more often when price is low
            if (event.priceChange < 0 && priceRatio < 0.5 && Math.random() > 0.3) {
                continue;
            }
            if (Math.random() < event.chance * eventChanceMultiplier) {
                activeEvent = {
                    ...event,
                    startedAt: now,
                    expiresAt: now + event.duration
                };
                break;
            }
        }
    }

    // =========================================================================
    // PRICE CHANGE LIMITS - Prevent extreme swings
    // =========================================================================
    const maxChange = SBX_CONFIG.maxTickChange;
    const priceChangeRatio = newPrice / oldPrice;
    if (priceChangeRatio > (1 + maxChange)) {
        newPrice = oldPrice * (1 + maxChange);
    } else if (priceChangeRatio < (1 - maxChange)) {
        newPrice = oldPrice * (1 - maxChange);
    }

    // Clamp to absolute bounds
    newPrice = Math.max(SBX_CONFIG.minPrice, Math.min(SBX_CONFIG.maxPrice, newPrice));
    newPrice = Math.round(newPrice * 100) / 100;

    // =========================================================================
    // HISTORY & PERSISTENCE
    // =========================================================================
    priceHistory.push({ price: newPrice, timestamp: now });
    if (priceHistory.length > 1440) {
        priceHistory.shift();
    }

    // Save to DB periodically
    if (priceHistory.length % 60 === 0) {
        await dbInsertOne('sbx_price_history', {
            price: newPrice,
            volume: dailyVolume,
            activeUsers: activeUsers.size,
            event: activeEvent?.name || null,
            timestamp: new Date()
        });
    }

    currentPrice = newPrice;

    // Reset daily stats at midnight
    const hour = new Date().getHours();
    if (hour === 0 && dailyVolume > 0) {
        dailyVolume = 0;
        activeUsers.clear();
    }

    return currentPrice;
}

/**
 * Get current market data
 */
async function getMarketData() {
    await updatePrice();

    // Calculate 24h change by finding price ~24 hours ago
    let change24h = 0;
    const twentyFourHoursAgo = Date.now() - (24 * 60 * 60 * 1000);

    if (priceHistory.length > 0) {
        // Find the price closest to 24 hours ago
        let price24hAgo = priceHistory[0]?.price || currentPrice;
        for (let i = 0; i < priceHistory.length; i++) {
            if (priceHistory[i].timestamp >= twentyFourHoursAgo) {
                price24hAgo = priceHistory[i].price;
                break;
            }
        }

        // If we don't have 24h of data, use the oldest available
        if (priceHistory[0].timestamp > twentyFourHoursAgo && priceHistory.length > 0) {
            price24hAgo = priceHistory[0].price;
        }

        change24h = ((currentPrice - price24hAgo) / price24hAgo) * 100;
    }

    return {
        symbol: SBX_CONFIG.symbol,
        name: SBX_CONFIG.name,
        price: currentPrice,
        change24h: Math.round(change24h * 100) / 100,
        volume24h: dailyVolume,
        activeUsers: activeUsers.size,
        event: activeEvent,
        high24h: Math.max(...priceHistory.map(p => p.price), currentPrice),
        low24h: Math.min(...priceHistory.map(p => p.price), currentPrice),
        priceHistory: priceHistory.slice(-60) // Last hour
    };
}

/**
 * Convert Stark Bucks (economy) to SBX at current rate
 */
async function convertToSBX(userId, starkBucks) {
    const starkEconomy = require('./stark-economy');

    const userBalance = await starkEconomy.getBalance(userId);
    if (userBalance < starkBucks) {
        return { success: false, error: 'Insufficient Stark Bucks' };
    }

    // Don't update price during conversion to avoid mid-transaction changes
    // Use current price as displayed to user
    const priceAtTime = currentPrice;

    // Conversion: Higher price = SBX worth more = get less SBX per SB
    // Base rate: 100 SB = 1 SBX at price 1.00
    // Buy at slight premium (2% spread)
    const buyPrice = priceAtTime * 1.02;
    const sbxAmount = Math.floor((starkBucks / (100 * buyPrice)) * 100) / 100;

    // Deduct from economy
    await starkEconomy.modifyBalance(userId, -starkBucks, 'Convert to SBX');

    // Add to SBX wallet
    await updateWallet(userId, sbxAmount, 'Converted from Stark Bucks');

    // Track
    dailyVolume += sbxAmount;
    activeUsers.add(userId);

    return {
        success: true,
        starkBucksSpent: starkBucks,
        sbxReceived: sbxAmount,
        rate: buyPrice,
        price: priceAtTime,
        priceUsed: priceAtTime
    };
}

/**
 * Convert SBX back to Stark Bucks
 */
async function convertToStarkBucks(userId, sbxAmount) {
    const starkEconomy = require('./stark-economy');
    const wallet = await getWallet(userId);

    if (wallet.balance < sbxAmount) {
        return { success: false, error: 'Insufficient SBX balance' };
    }

    // Don't update price during conversion to avoid mid-transaction changes
    // Use current price as displayed to user
    const priceAtTime = currentPrice;

    // Conversion: Higher price = SBX worth more = get more SB per SBX
    // Base rate: 1 SBX = 100 SB at price 1.00
    // Sell at slight discount (2% spread) + 5% fee
    const sellPrice = priceAtTime * 0.98;
    const grossStarkBucks = Math.floor(sbxAmount * 100 * sellPrice);
    const fee = Math.floor(grossStarkBucks * 0.05);
    const netStarkBucks = grossStarkBucks - fee;

    // Deduct SBX
    await updateWallet(userId, -sbxAmount, 'Convert to Stark Bucks');

    // Add to economy
    await starkEconomy.modifyBalance(userId, netStarkBucks, 'Converted from SBX');

    // Fee to owner in SBX
    const ownerFee = sbxAmount * 0.05;
    const ownerId = process.env.BOT_OWNER_ID || null;
    await updateWallet(ownerId, ownerFee, 'Conversion fee');

    return {
        success: true,
        sbxSpent: sbxAmount,
        starkBucksReceived: netStarkBucks,
        fee,
        rate: sellPrice,
        price: priceAtTime,
        priceUsed: priceAtTime
    };
}

// ============================================================================
// STORE OPERATIONS
// ============================================================================

/**
 * Get all store items
 */
function getStoreItems(category = null) {
    if (category) {
        return Object.values(STORE_ITEMS).filter(item => item.category === category);
    }
    return Object.values(STORE_ITEMS);
}

/**
 * Get user's purchased items (with caching)
 */
async function getUserPurchases(userId) {
    const cacheKey = `purchases:${userId}`;
    if (purchaseCache.has(cacheKey)) {
        return purchaseCache.get(cacheKey);
    }

    const purchases = await dbFind('sbx_store_purchases', { userId });
    purchaseCache.set(cacheKey, purchases);
    return purchases;
}

/**
 * Check if user owns an item
 */
async function userOwnsItem(userId, itemId) {
    const purchase = await dbFindOne('sbx_store_purchases', { userId, itemId });
    return !!purchase;
}

/**
 * Purchase an item from the store
 */
async function purchaseItem(userId, itemId) {
    const item = STORE_ITEMS[itemId];
    if (!item) {
        return { success: false, error: 'Item not found' };
    }

    // Check if one-time purchase and already owned
    if (item.oneTime) {
        const owned = await userOwnsItem(userId, itemId);
        if (owned) {
            return { success: false, error: 'You already own this item' };
        }
    }

    // Check balance
    const wallet = await getWallet(userId);
    if (wallet.balance < item.price) {
        return { success: false, error: `Insufficient SBX. Need ${item.price} SBX, have ${wallet.balance} SBX` };
    }

    // Calculate fee
    const fee = Math.floor(item.price * SBX_CONFIG.ownerFeePercent * 100) / 100;

    // Deduct price
    await updateWallet(userId, -item.price, `Purchase: ${item.name}`);

    // Fee to owner
    if (fee > 0) {
        const ownerId = process.env.BOT_OWNER_ID || null;
        await updateWallet(ownerId, fee, `Store fee: ${item.name}`);
    }

    // Record purchase
    const purchase = {
        id: generateTransactionId(),
        userId,
        itemId,
        item,
        price: item.price,
        fee,
        purchasedAt: new Date(),
        expiresAt: item.duration ? new Date(Date.now() + item.duration) : null
    };
    await dbInsertOne('sbx_store_purchases', purchase);

    // Invalidate purchase cache
    purchaseCache.delete(`purchases:${userId}`);

    // Apply effect if consumable
    if (item.category === 'consumable' && item.effect) {
        await applyPurchaseEffect(userId, item);
    }

    // Track
    dailyVolume += item.price;
    activeUsers.add(userId);

    return {
        success: true,
        purchase,
        item,
        newBalance: wallet.balance - item.price
    };
}

/**
 * Apply purchase effect to user
 */
async function applyPurchaseEffect(userId, item) {
    if (item.effect?.type === 'mystery') {
        // Mystery box - random reward
        const reward = Math.floor(Math.random() * (item.effect.max - item.effect.min + 1)) + item.effect.min;
        await updateWallet(userId, reward, 'Mystery Box reward');
        return { type: 'mystery', reward };
    }

    // Other effects are applied when checking user's perks
    return { type: 'effect', effect: item.effect };
}

/**
 * Get user's active effects from purchases
 */
async function getUserEffects(userId) {
    const purchases = await getUserPurchases(userId);
    const now = new Date();
    const effects = {};

    for (const purchase of purchases) {
        // Skip expired consumables
        if (purchase.expiresAt && new Date(purchase.expiresAt) < now) {
            continue;
        }

        const { item } = purchase;
        if (item.effect) {
            for (const [key, value] of Object.entries(item.effect)) {
                if (typeof value === 'number') {
                    effects[key] = (effects[key] || 1) * value;
                } else if (typeof value === 'boolean') {
                    effects[key] = effects[key] || value;
                } else if (Array.isArray(value)) {
                    effects[key] = [...(effects[key] || []), ...value];
                } else {
                    effects[key] = value;
                }
            }
        }
    }

    return effects;
}

// ============================================================================
// INVESTMENT SYSTEM
// ============================================================================

/**
 * Invest SBX (stake for passive income)
 */
async function investSBX(userId, amount) {
    const wallet = await getWallet(userId);

    if (wallet.balance < amount) {
        return { success: false, error: 'Insufficient SBX balance' };
    }

    // Get existing investment
    let investment = await dbFindOne('sbx_investments', { userId });

    if (!investment) {
        investment = {
            userId,
            principal: 0,
            earned: 0,
            lastPayout: new Date(),
            createdAt: new Date()
        };
    }

    // Add to principal
    investment.principal += amount;
    investment.updatedAt = new Date();

    // Deduct from wallet
    await updateWallet(userId, -amount, 'Investment stake');

    await dbUpdateOne('sbx_investments',
        { userId },
        { $set: investment },
        { upsert: true }
    );

    return {
        success: true,
        invested: amount,
        totalPrincipal: investment.principal,
        dailyRate: 0.005 // 0.5% daily
    };
}

/**
 * Claim investment earnings
 */
async function claimInvestmentEarnings(userId) {
    const investment = await dbFindOne('sbx_investments', { userId });

    if (!investment || investment.principal <= 0) {
        return { success: false, error: 'No active investment' };
    }

    const now = new Date();
    const lastPayout = new Date(investment.lastPayout);
    const daysPassed = (now - lastPayout) / (24 * 60 * 60 * 1000);

    if (daysPassed < 1) {
        const hoursLeft = Math.ceil((1 - daysPassed) * 24);
        return { success: false, error: `Next payout in ${hoursLeft} hours` };
    }

    // Calculate earnings (0.5% daily, compounding)
    const dailyRate = 0.005;
    const earnings = Math.floor(investment.principal * dailyRate * Math.floor(daysPassed) * 100) / 100;

    // Update investment
    investment.earned += earnings;
    investment.lastPayout = now;
    investment.updatedAt = now;

    await dbUpdateOne('sbx_investments', { userId }, { $set: investment });

    // Add to wallet
    await updateWallet(userId, earnings, 'Investment earnings');

    return {
        success: true,
        earnings,
        daysClaimed: Math.floor(daysPassed),
        totalEarned: investment.earned,
        principal: investment.principal
    };
}

/**
 * Withdraw investment principal
 */
async function withdrawInvestment(userId, amount) {
    const investment = await dbFindOne('sbx_investments', { userId });

    if (!investment || investment.principal < amount) {
        return { success: false, error: 'Insufficient investment balance' };
    }

    // Apply catastrophic price impact for partial withdrawals too
    await applyWithdrawalImpact(amount);

    // 2% early withdrawal fee
    const fee = Math.floor(amount * 0.02 * 100) / 100;
    const netAmount = amount - fee;

    // Update investment
    investment.principal -= amount;
    investment.updatedAt = new Date();

    await dbUpdateOne('sbx_investments', { userId }, { $set: investment });

    // Add to wallet (minus fee)
    await updateWallet(userId, netAmount, 'Investment withdrawal');

    // Fee to owner
    const ownerId = process.env.BOT_OWNER_ID || null;
    await updateWallet(ownerId, fee, 'Investment withdrawal fee');

    return {
        success: true,
        withdrawn: amount,
        fee,
        received: netAmount,
        remainingPrincipal: investment.principal
    };
}

/**
 * Withdraw all investments (principal + earnings)
 */
async function withdrawAllInvestments(userId) {
    const investment = await dbFindOne('sbx_investments', { userId });

    if (!investment || (investment.principal <= 0 && investment.earned <= 0)) {
        return { success: false, error: 'No active investments to withdraw' };
    }

    const totalPrincipal = investment.principal || 0;
    const totalEarned = investment.earned || 0;
    const totalAmount = totalPrincipal + totalEarned;

    // Calculate catastrophic price impact
    await applyWithdrawalImpact(totalAmount);

    // No withdrawal fee when withdrawing everything
    const fee = 0;

    // Delete investment record
    await dbUpdateOne('sbx_investments', { userId }, {
        $set: {
            principal: 0,
            earned: 0,
            updatedAt: new Date()
        }
    });

    // Add total amount to wallet
    await updateWallet(userId, totalAmount, 'Full investment withdrawal');

    return {
        success: true,
        total: totalAmount,
        principal: totalPrincipal,
        earnings: totalEarned,
        fee
    };
}

/**
 * Apply catastrophic price impact based on withdrawal size
 */
async function applyWithdrawalImpact(withdrawAmount) {
    try {
        // Get total invested across all users
        const col = await getCollection('sbx_investments');
        const totalInvested = await col.aggregate([
            { $group: { _id: null, total: { $sum: '$principal' } } }
        ]).toArray();

        const totalPrincipal = totalInvested[0]?.total || 0;
        if (totalPrincipal <= 0) {
            return;
        }

        // Calculate percentage of total being withdrawn
        const withdrawPercentage = withdrawAmount / totalPrincipal;

        // Apply catastrophic impact based on percentage
        let priceImpact = 0;
        if (withdrawPercentage > 0.5) {
            // Withdrawing >50% crashes the market
            priceImpact = -0.3; // -30% price
        } else if (withdrawPercentage > 0.25) {
            // Withdrawing >25% major impact
            priceImpact = -0.2; // -20% price
        } else if (withdrawPercentage > 0.1) {
            // Withdrawing >10% significant impact
            priceImpact = -0.1; // -10% price
        } else if (withdrawPercentage > 0.05) {
            // Withdrawing >5% moderate impact
            priceImpact = -0.05; // -5% price
        }

        if (priceImpact < 0) {
            currentPrice *= (1 + priceImpact);
            currentPrice = Math.max(SBX_CONFIG.minPrice, currentPrice);
            currentPrice = Math.round(currentPrice * 100) / 100;

            // Store in history
            priceHistory.push({
                price: currentPrice,
                timestamp: Date.now(),
                event: 'Catastrophic withdrawal'
            });

            // eslint-disable-next-line no-console
            console.log(`[Starkbucks] Catastrophic withdrawal impact: ${(priceImpact * 100).toFixed(1)}% | New price: ${currentPrice}`);
        }
    } catch (error) {
        // eslint-disable-next-line no-console
        console.error('[Starkbucks] Failed to apply withdrawal impact:', error);
    }
}

// ============================================================================
// LEADERBOARD
// ============================================================================

/**
 * Get SBX holdings leaderboard
 */
async function getLeaderboard(limit = 10) {
    try {
        const col = await getCollection('sbx_wallets');
        const wallets = await col.find({ balance: { $gt: 0 } })
            .sort({ balance: -1 })
            .limit(limit)
            .toArray();

        return wallets.map(w => ({
            userId: w.userId,
            balance: w.balance || 0
        }));
    } catch (error) {
        console.error('[Starkbucks] Leaderboard error:', error);
        return [];
    }
}

// ============================================================================
// INITIALIZATION
// ============================================================================

let priceUpdateInterval = null;

/**
 * Load price history from database on startup
 */
async function loadPriceHistory() {
    try {
        const col = await getCollection('sbx_price_history');

        // Get the most recent price
        const latest = await col.findOne({}, { sort: { timestamp: -1 } });
        if (latest) {
            currentPrice = latest.price;
            // eslint-disable-next-line no-console
            console.log(`[Starkbucks] Loaded current price: ${currentPrice} from DB`);
        }

        // Load last 60 entries (1 hour at 1 min intervals)
        const history = await col.find({}, {
            sort: { timestamp: -1 },
            limit: 60
        }).toArray();

        // Reverse to chronological order and populate priceHistory
        priceHistory.length = 0; // Clear existing
        history.reverse().forEach(entry => {
            priceHistory.push({ price: entry.price, timestamp: entry.timestamp });
        });

        // eslint-disable-next-line no-console
        console.log(`[Starkbucks] Loaded ${priceHistory.length} price history entries`);
    } catch (error) {
        // eslint-disable-next-line no-console
        console.error('[Starkbucks] Failed to load price history:', error);
        // Keep defaults if DB load fails
        currentPrice = SBX_CONFIG.basePrice;
        priceHistory.length = 0;
    }
}

async function startPriceUpdates() {
    if (priceUpdateInterval) { return; }

    // Load price history from DB on startup
    await loadPriceHistory();

    priceUpdateInterval = setInterval(() => {
        updatePrice().catch(err => {
            console.error('[Starkbucks] Price update error:', err);
        });
    }, SBX_CONFIG.tickInterval);

    // Initial update
    updatePrice().catch(() => { });
}

function stopPriceUpdates() {
    if (priceUpdateInterval) {
        clearInterval(priceUpdateInterval);
        priceUpdateInterval = null;
    }
}

/**
 * Get current SBX price
 */
function getCurrentPrice() {
    return currentPrice;
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
    // Config
    SBX_CONFIG,
    STORE_ITEMS,

    // Wallet
    getWallet,
    updateWallet,
    transfer,

    // Transactions
    createTransaction,
    getTransaction,
    createPaymentRequest,
    completePayment,
    generateTransactionId,

    // Exchange
    updatePrice,
    getMarketData,
    getCurrentPrice,
    convertToSBX,
    convertToStarkBucks,

    // Store
    getStoreItems,
    getUserPurchases,
    userOwnsItem,
    purchaseItem,
    getUserEffects,

    // Investments
    investSBX,
    claimInvestmentEarnings,
    withdrawInvestment,
    withdrawAllInvestments,

    // Leaderboard
    getLeaderboard,

    // News System
    addNewsItem,
    getNews,
    clearNews,

    // Lifecycle
    startPriceUpdates,
    stopPriceUpdates
};

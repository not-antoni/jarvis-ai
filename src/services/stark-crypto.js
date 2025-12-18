'use strict';

/**
 * Stark Crypto (SX) - Virtual Cryptocurrency Trading
 * Multiple coins with dynamic prices, trading, and portfolios
 */

const database = require('./database');

// ============================================================================
// CONFIGURATION
// ============================================================================

const SX_CONFIG = {
    // System settings
    tickInterval: 60 * 1000,      // Price updates every minute
    maxCoins: 20,                  // Max coins a user can hold types of
    
    // Trading settings
    minTrade: 1,                   // Minimum coins per trade
    tradeFeePercent: 0.02,         // 2% trading fee
    
    // Price settings
    baseVolatility: 0.10,          // 10% base volatility
    minPrice: 0.001,               // Minimum coin price
    maxPrice: 1000000,             // Maximum coin price
};

// Available cryptocurrencies
const CRYPTO_COINS = {
    // Main coins
    'IRON': {
        symbol: 'IRON',
        name: 'Iron Man Coin',
        emoji: '🦾',
        basePrice: 100,
        volatility: 0.08,
        description: 'The flagship crypto of Stark Industries'
    },
    'ARC': {
        symbol: 'ARC',
        name: 'Arc Reactor Token',
        emoji: '💠',
        basePrice: 500,
        volatility: 0.12,
        description: 'Powered by clean energy innovation'
    },
    'JARV': {
        symbol: 'JARV',
        name: 'Jarvis Coin',
        emoji: '🤖',
        basePrice: 50,
        volatility: 0.15,
        description: 'AI-powered cryptocurrency'
    },
    'STARK': {
        symbol: 'STARK',
        name: 'Stark Token',
        emoji: '⭐',
        basePrice: 1000,
        volatility: 0.05,
        description: 'Premium blue-chip crypto'
    },
    'PEPPER': {
        symbol: 'PEPPER',
        name: 'Pepper Coin',
        emoji: '🌶️',
        basePrice: 25,
        volatility: 0.20,
        description: 'Spicy and volatile'
    },
    'SHIELD': {
        symbol: 'SHIELD',
        name: 'Shield Token',
        emoji: '🛡️',
        basePrice: 75,
        volatility: 0.06,
        description: 'Stable and protective'
    },
    'HULK': {
        symbol: 'HULK',
        name: 'Hulk Smash Coin',
        emoji: '💚',
        basePrice: 10,
        volatility: 0.25,
        description: 'Extremely volatile - SMASH!'
    },
    'THOR': {
        symbol: 'THOR',
        name: 'Thunder Token',
        emoji: '⚡',
        basePrice: 200,
        volatility: 0.10,
        description: 'Struck by lightning gains'
    },
    'WIDOW': {
        symbol: 'WIDOW',
        name: 'Black Widow Coin',
        emoji: '🕷️',
        basePrice: 150,
        volatility: 0.09,
        description: 'Stealthy and deadly returns'
    },
    'VIBRA': {
        symbol: 'VIBRA',
        name: 'Vibranium',
        emoji: '💎',
        basePrice: 5000,
        volatility: 0.03,
        description: 'The rarest and most valuable'
    }
};

// ============================================================================
// IN-MEMORY STATE
// ============================================================================

const coinPrices = new Map();
const priceHistory = new Map();
let lastPriceTick = 0;

// Initialize prices
Object.entries(CRYPTO_COINS).forEach(([symbol, coin]) => {
    coinPrices.set(symbol, coin.basePrice);
    priceHistory.set(symbol, [{ price: coin.basePrice, timestamp: Date.now() }]);
});

// ============================================================================
// DATABASE HELPERS
// ============================================================================

async function getCollection(name) {
    await database.connect();
    return database.db.collection(name);
}

// ============================================================================
// PORTFOLIO MANAGEMENT
// ============================================================================

/**
 * Get user's crypto portfolio
 */
async function getPortfolio(userId) {
    try {
        const col = await getCollection('sx_portfolios');
        let portfolio = await col.findOne({ userId });
        
        if (!portfolio) {
            portfolio = {
                userId,
                holdings: {},      // { IRON: 10, ARC: 5, ... }
                totalInvested: 0,
                totalValue: 0,
                trades: 0,
                createdAt: new Date(),
                updatedAt: new Date()
            };
            await col.insertOne(portfolio);
        }
        
        // Calculate current value
        let totalValue = 0;
        for (const [symbol, amount] of Object.entries(portfolio.holdings || {})) {
            const price = coinPrices.get(symbol) || 0;
            totalValue += price * amount;
        }
        portfolio.totalValue = Math.round(totalValue * 100) / 100;
        
        return portfolio;
    } catch (error) {
        console.error('[StarkCrypto] Portfolio error:', error);
        return { userId, holdings: {}, totalInvested: 0, totalValue: 0, trades: 0 };
    }
}

/**
 * Buy cryptocurrency with Stark Bucks
 */
async function buyCrypto(userId, symbol, amount) {
    const starkEconomy = require('./stark-economy');
    const coin = CRYPTO_COINS[symbol.toUpperCase()];
    
    if (!coin) {
        return { success: false, error: 'Unknown cryptocurrency' };
    }
    
    if (amount < SX_CONFIG.minTrade) {
        return { success: false, error: `Minimum trade is ${SX_CONFIG.minTrade} coins` };
    }
    
    const price = coinPrices.get(symbol.toUpperCase());
    const totalCost = Math.ceil(price * amount);
    const fee = Math.ceil(totalCost * SX_CONFIG.tradeFeePercent);
    const totalWithFee = totalCost + fee;
    
    // Check balance
    const balance = await starkEconomy.getBalance(userId);
    if (balance < totalWithFee) {
        return { success: false, error: `Insufficient funds. Need ${totalWithFee} SB` };
    }
    
    // Deduct from balance
    await starkEconomy.modifyBalance(userId, -totalWithFee, `Buy ${amount} ${symbol}`);
    
    // Add to portfolio
    const col = await getCollection('sx_portfolios');
    await col.updateOne(
        { userId },
        {
            $inc: {
                [`holdings.${symbol.toUpperCase()}`]: amount,
                totalInvested: totalCost,
                trades: 1
            },
            $set: { updatedAt: new Date() }
        },
        { upsert: true }
    );
    
    // Fee to owner
    const ownerId = process.env.BOT_OWNER_ID || 'system_owner';
    if (fee > 0) {
        await starkEconomy.modifyBalance(ownerId, fee, `Crypto trading fee: ${symbol}`);
    }
    
    return {
        success: true,
        symbol: symbol.toUpperCase(),
        amount,
        price,
        totalCost,
        fee,
        totalPaid: totalWithFee
    };
}

/**
 * Sell cryptocurrency for Stark Bucks
 */
async function sellCrypto(userId, symbol, amount) {
    const starkEconomy = require('./stark-economy');
    const coin = CRYPTO_COINS[symbol.toUpperCase()];
    
    if (!coin) {
        return { success: false, error: 'Unknown cryptocurrency' };
    }
    
    if (amount < SX_CONFIG.minTrade) {
        return { success: false, error: `Minimum trade is ${SX_CONFIG.minTrade} coins` };
    }
    
    // Check holdings
    const portfolio = await getPortfolio(userId);
    const holdings = portfolio.holdings?.[symbol.toUpperCase()] || 0;
    
    if (holdings < amount) {
        return { success: false, error: `Insufficient ${symbol}. You have ${holdings}` };
    }
    
    const price = coinPrices.get(symbol.toUpperCase());
    const totalValue = Math.floor(price * amount);
    const fee = Math.ceil(totalValue * SX_CONFIG.tradeFeePercent);
    const netProceeds = totalValue - fee;
    
    // Remove from portfolio
    const col = await getCollection('sx_portfolios');
    await col.updateOne(
        { userId },
        {
            $inc: {
                [`holdings.${symbol.toUpperCase()}`]: -amount,
                trades: 1
            },
            $set: { updatedAt: new Date() }
        }
    );
    
    // Add to balance
    await starkEconomy.modifyBalance(userId, netProceeds, `Sell ${amount} ${symbol}`);
    
    // Fee to owner
    const ownerId = process.env.BOT_OWNER_ID || 'system_owner';
    if (fee > 0) {
        await starkEconomy.modifyBalance(ownerId, fee, `Crypto trading fee: ${symbol}`);
    }
    
    return {
        success: true,
        symbol: symbol.toUpperCase(),
        amount,
        price,
        totalValue,
        fee,
        netProceeds
    };
}

// ============================================================================
// PRICE MANAGEMENT
// ============================================================================

/**
 * Update all coin prices
 */
async function updatePrices() {
    const now = Date.now();
    if (now - lastPriceTick < SX_CONFIG.tickInterval) {
        return;
    }
    lastPriceTick = now;
    
    for (const [symbol, coin] of Object.entries(CRYPTO_COINS)) {
        let currentPrice = coinPrices.get(symbol);
        
        // Random walk with coin-specific volatility
        const volatility = coin.volatility || SX_CONFIG.baseVolatility;
        const change = (Math.random() - 0.5) * 2 * volatility;
        let newPrice = currentPrice * (1 + change);
        
        // Mean reversion towards base price (slight pull)
        const pullStrength = 0.01;
        newPrice += (coin.basePrice - newPrice) * pullStrength;
        
        // Clamp price
        newPrice = Math.max(SX_CONFIG.minPrice, Math.min(SX_CONFIG.maxPrice, newPrice));
        newPrice = Math.round(newPrice * 1000) / 1000;
        
        coinPrices.set(symbol, newPrice);
        
        // Store history
        const history = priceHistory.get(symbol) || [];
        history.push({ price: newPrice, timestamp: now });
        if (history.length > 1440) history.shift(); // Keep 24h
        priceHistory.set(symbol, history);
    }
}

/**
 * Get current prices for all coins
 */
function getAllPrices() {
    const prices = {};
    for (const [symbol, coin] of Object.entries(CRYPTO_COINS)) {
        const currentPrice = coinPrices.get(symbol);
        const history = priceHistory.get(symbol) || [];
        const oldPrice = history[0]?.price || currentPrice;
        const change24h = ((currentPrice - oldPrice) / oldPrice) * 100;
        
        prices[symbol] = {
            ...coin,
            price: currentPrice,
            change24h: Math.round(change24h * 100) / 100
        };
    }
    return prices;
}

/**
 * Get price for specific coin
 */
function getCoinPrice(symbol) {
    const coin = CRYPTO_COINS[symbol.toUpperCase()];
    if (!coin) return null;
    
    const currentPrice = coinPrices.get(symbol.toUpperCase());
    const history = priceHistory.get(symbol.toUpperCase()) || [];
    const oldPrice = history[0]?.price || currentPrice;
    const change24h = ((currentPrice - oldPrice) / oldPrice) * 100;
    
    return {
        ...coin,
        price: currentPrice,
        change24h: Math.round(change24h * 100) / 100,
        history: history.slice(-60) // Last hour
    };
}

// ============================================================================
// LEADERBOARD
// ============================================================================

/**
 * Get crypto portfolio leaderboard
 */
async function getLeaderboard(limit = 10) {
    try {
        const col = await getCollection('sx_portfolios');
        const portfolios = await col.find({})
            .sort({ totalInvested: -1 })
            .limit(limit)
            .toArray();
        
        // Calculate current values
        return portfolios.map(p => {
            let totalValue = 0;
            for (const [symbol, amount] of Object.entries(p.holdings || {})) {
                const price = coinPrices.get(symbol) || 0;
                totalValue += price * amount;
            }
            return {
                userId: p.userId,
                totalValue: Math.round(totalValue * 100) / 100,
                totalInvested: p.totalInvested || 0,
                trades: p.trades || 0
            };
        }).sort((a, b) => b.totalValue - a.totalValue);
    } catch (error) {
        console.error('[StarkCrypto] Leaderboard error:', error);
        return [];
    }
}

// ============================================================================
// INITIALIZATION
// ============================================================================

let priceUpdateInterval = null;

function startPriceUpdates() {
    if (priceUpdateInterval) return;
    
    priceUpdateInterval = setInterval(() => {
        updatePrices().catch(err => {
            console.error('[StarkCrypto] Price update error:', err);
        });
    }, SX_CONFIG.tickInterval);
    
    // Initial update
    updatePrices().catch(() => {});
}

function stopPriceUpdates() {
    if (priceUpdateInterval) {
        clearInterval(priceUpdateInterval);
        priceUpdateInterval = null;
    }
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
    // Config
    SX_CONFIG,
    CRYPTO_COINS,
    
    // Portfolio
    getPortfolio,
    buyCrypto,
    sellCrypto,
    
    // Prices
    updatePrices,
    getAllPrices,
    getCoinPrice,
    
    // Leaderboard
    getLeaderboard,
    
    // Lifecycle
    startPriceUpdates,
    stopPriceUpdates
};

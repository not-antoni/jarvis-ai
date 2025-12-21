'use strict';

/**
 * Stark Crypto (SX) - Virtual Cryptocurrency Trading
 * Robust market simulation with cycles, events, and realistic economics
 */

const database = require('./database');

// ============================================================================
// CONFIGURATION
// ============================================================================

const SX_CONFIG = {
    // System settings
    tickInterval: 30 * 1000,       // Price updates every 30 seconds
    historyMaxLength: 2880,        // 24 hours at 30s intervals
    
    // Trading settings
    minTrade: 0.01,                // Minimum coins per trade (fractional)
    maxTrade: 10000,               // Maximum coins per trade
    tradeFeePercent: 0.025,        // 2.5% trading fee (goes to owner)
    
    // Market mechanics
    baseVolatility: 0.03,          // 3% base volatility per tick
    momentumDecay: 0.95,           // How fast momentum decays
    volumeImpact: 0.0001,          // Price impact per unit volume
    liquidityDepth: 10000,         // Affects slippage
    
    // Market cycles
    cycleDuration: 60 * 60 * 1000, // 1 hour cycles
    bullProbability: 0.45,         // 45% chance of bull market
    bearProbability: 0.35,         // 35% chance of bear market
    sidewaysProbability: 0.20,     // 20% chance of sideways
    
    // Events
    eventChance: 0.005,            // 0.5% chance per tick for event
    crashChance: 0.001,            // 0.1% chance of flash crash
    pumpChance: 0.001,             // 0.1% chance of pump
};

// Market events that can occur
const MARKET_EVENTS = [
    { name: '📈 Bull Run', type: 'bull', multiplier: 1.5, duration: 15 * 60 * 1000, chance: 0.3 },
    { name: '📉 Bear Market', type: 'bear', multiplier: 0.6, duration: 20 * 60 * 1000, chance: 0.25 },
    { name: '🚀 Elon Tweet', type: 'pump', multiplier: 2.0, duration: 5 * 60 * 1000, chance: 0.1 },
    { name: '💥 Flash Crash', type: 'crash', multiplier: 0.3, duration: 3 * 60 * 1000, chance: 0.05 },
    { name: '📰 Good News', type: 'bull', multiplier: 1.3, duration: 10 * 60 * 1000, chance: 0.15 },
    { name: '⚠️ FUD Alert', type: 'bear', multiplier: 0.7, duration: 10 * 60 * 1000, chance: 0.1 },
    { name: '🏦 Whale Buy', type: 'pump', multiplier: 1.8, duration: 8 * 60 * 1000, chance: 0.05 },
];

// Available cryptocurrencies with market cap tiers
const CRYPTO_COINS = {
    'IRON': {
        symbol: 'IRON',
        name: 'Iron Man Coin',
        emoji: '🦾',
        basePrice: 100,
        volatility: 0.06,
        tier: 'large',           // large cap = more stable
        correlation: 1.0,        // Market leader
        description: 'The flagship crypto of Stark Industries'
    },
    'ARC': {
        symbol: 'ARC',
        name: 'Arc Reactor Token',
        emoji: '💠',
        basePrice: 500,
        volatility: 0.08,
        tier: 'large',
        correlation: 0.85,
        description: 'Powered by clean energy innovation'
    },
    'JARV': {
        symbol: 'JARV',
        name: 'Jarvis Coin',
        emoji: '🤖',
        basePrice: 50,
        volatility: 0.12,
        tier: 'mid',
        correlation: 0.7,
        description: 'AI-powered cryptocurrency'
    },
    'STARK': {
        symbol: 'STARK',
        name: 'Stark Token',
        emoji: '⭐',
        basePrice: 1000,
        volatility: 0.04,
        tier: 'large',
        correlation: 0.9,
        description: 'Premium blue-chip crypto'
    },
    'PEPPER': {
        symbol: 'PEPPER',
        name: 'Pepper Coin',
        emoji: '🌶️',
        basePrice: 25,
        volatility: 0.18,
        tier: 'small',
        correlation: 0.5,
        description: 'Spicy meme coin - high risk!'
    },
    'SHIELD': {
        symbol: 'SHIELD',
        name: 'Shield Token',
        emoji: '🛡️',
        basePrice: 75,
        volatility: 0.03,
        tier: 'stable',          // Stablecoin-like
        correlation: 0.2,
        description: 'Defensive stable asset'
    },
    'HULK': {
        symbol: 'HULK',
        name: 'Hulk Smash Coin',
        emoji: '💚',
        basePrice: 10,
        volatility: 0.25,
        tier: 'meme',            // Meme coins are crazy
        correlation: 0.3,
        description: 'HULK SMASH! Extremely volatile'
    },
    'THOR': {
        symbol: 'THOR',
        name: 'Thunder Token',
        emoji: '⚡',
        basePrice: 200,
        volatility: 0.10,
        tier: 'mid',
        correlation: 0.75,
        description: 'Struck by lightning gains'
    },
    'WIDOW': {
        symbol: 'WIDOW',
        name: 'Black Widow Coin',
        emoji: '🕷️',
        basePrice: 150,
        volatility: 0.09,
        tier: 'mid',
        correlation: 0.65,
        description: 'Stealthy with deadly returns'
    },
    'VIBRA': {
        symbol: 'VIBRA',
        name: 'Vibranium',
        emoji: '💎',
        basePrice: 5000,
        volatility: 0.02,
        tier: 'rare',            // Store of value
        correlation: -0.3,       // Inverse correlation (safe haven)
        description: 'The rarest - digital gold'
    },
    'FURY': {
        symbol: 'FURY',
        name: 'Fury Token',
        emoji: '👁️',
        basePrice: 300,
        volatility: 0.07,
        tier: 'mid',
        correlation: 0.6,
        description: 'Strategic investments by SHIELD'
    },
    'LOKI': {
        symbol: 'LOKI',
        name: 'Mischief Coin',
        emoji: '🦹',
        basePrice: 15,
        volatility: 0.30,
        tier: 'meme',
        correlation: -0.2,
        description: 'Extremely chaotic - expect the unexpected'
    },
    'GROOT': {
        symbol: 'GROOT',
        name: 'Groot Token',
        emoji: '🌳',
        basePrice: 35,
        volatility: 0.15,
        tier: 'small',
        correlation: 0.4,
        description: 'I am Groot (slow and steady growth)'
    },
    'WANDA': {
        symbol: 'WANDA',
        name: 'Scarlet Coin',
        emoji: '🔮',
        basePrice: 250,
        volatility: 0.11,
        tier: 'mid',
        correlation: 0.55,
        description: 'Reality-bending potential returns'
    },
    'MJOLNIR': {
        symbol: 'MJOLNIR',
        name: 'Worthy Token',
        emoji: '🔨',
        basePrice: 800,
        volatility: 0.05,
        tier: 'large',
        correlation: 0.8,
        description: 'Only the worthy can hold this asset'
    },
    'SPIDEY': {
        symbol: 'SPIDEY',
        name: 'Spider Coin',
        emoji: '🕸️',
        basePrice: 45,
        volatility: 0.14,
        tier: 'small',
        correlation: 0.5,
        description: 'With great power comes great gains'
    },
    'PANTHER': {
        symbol: 'PANTHER',
        name: 'Wakanda Token',
        emoji: '🐆',
        basePrice: 600,
        volatility: 0.06,
        tier: 'large',
        correlation: 0.7,
        description: 'Wakanda Forever - premium African tech'
    },
    'STRANGE': {
        symbol: 'STRANGE',
        name: 'Mystic Coin',
        emoji: '🧙',
        basePrice: 400,
        volatility: 0.12,
        tier: 'mid',
        correlation: 0.45,
        description: 'Dormammu, I\'ve come to bargain'
    },
    'VISION': {
        symbol: 'VISION',
        name: 'Mind Stone Token',
        emoji: '🤖',
        basePrice: 350,
        volatility: 0.08,
        tier: 'mid',
        correlation: 0.6,
        description: 'Synthezoid intelligence-backed asset'
    },
    'ANTMAN': {
        symbol: 'ANTMAN',
        name: 'Quantum Coin',
        emoji: '🐜',
        basePrice: 5,
        volatility: 0.35,
        tier: 'meme',
        correlation: 0.2,
        description: 'Tiny price, quantum potential!'
    },
    'GAMORA': {
        symbol: 'GAMORA',
        name: 'Guardian Token',
        emoji: '💚',
        basePrice: 180,
        volatility: 0.10,
        tier: 'mid',
        correlation: 0.55,
        description: 'Deadliest woman in the galaxy'
    },
    'THANOS': {
        symbol: 'THANOS',
        name: 'Inevitable Coin',
        emoji: '🟣',
        basePrice: 1500,
        volatility: 0.04,
        tier: 'rare',
        correlation: -0.4,
        description: 'Perfectly balanced, as all things should be'
    }
};

// Tier multipliers for volatility
const TIER_MULTIPLIERS = {
    stable: 0.3,
    large: 0.7,
    mid: 1.0,
    small: 1.5,
    meme: 2.5,
    rare: 0.4
};

// ============================================================================
// IN-MEMORY MARKET STATE
// ============================================================================

const coinPrices = new Map();
const priceHistory = new Map();
const coinMomentum = new Map();      // Tracks price momentum per coin
const tradeVolume = new Map();       // Recent trade volume per coin
let lastPriceTick = 0;

// Market state
let marketState = {
    cycle: 'sideways',               // bull, bear, sideways
    cycleStarted: Date.now(),
    sentiment: 0,                    // -1 to 1 (bearish to bullish)
    activeEvent: null,
    totalVolume24h: 0,
    lastEventTime: 0
};

// Initialize coin state
function initializeMarket() {
    const now = Date.now();
    Object.entries(CRYPTO_COINS).forEach(([symbol, coin]) => {
        // Add some initial variance to prices
        const variance = 1 + (Math.random() - 0.5) * 0.2;
        coinPrices.set(symbol, coin.basePrice * variance);
        priceHistory.set(symbol, [{ price: coin.basePrice * variance, timestamp: now }]);
        coinMomentum.set(symbol, 0);
        tradeVolume.set(symbol, 0);
    });
    
    // Set initial market cycle
    determineMarketCycle();
}

// Determine market cycle
function determineMarketCycle() {
    const rand = Math.random();
    if (rand < SX_CONFIG.bullProbability) {
        marketState.cycle = 'bull';
        marketState.sentiment = 0.3 + Math.random() * 0.4;
    } else if (rand < SX_CONFIG.bullProbability + SX_CONFIG.bearProbability) {
        marketState.cycle = 'bear';
        marketState.sentiment = -0.3 - Math.random() * 0.4;
    } else {
        marketState.cycle = 'sideways';
        marketState.sentiment = (Math.random() - 0.5) * 0.2;
    }
    marketState.cycleStarted = Date.now();
}

// Initialize on load
initializeMarket();

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
    
    // Fee to owner (TAX TIME!)
    const ownerId = process.env.BOT_OWNER_ID;
    if (fee > 0 && ownerId) {
        await starkEconomy.modifyBalance(ownerId, fee, `SX Tax: Buy ${amount} ${symbol}`);
    }
    
    // Record trade impact on market
    recordTradeImpact(symbol.toUpperCase(), amount, true);
    
    return {
        success: true,
        symbol: symbol.toUpperCase(),
        amount,
        price,
        totalCost,
        fee,
        totalPaid: totalWithFee,
        marketImpact: 'Bullish pressure added'
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
    
    // Fee to owner (TAX TIME!)
    const ownerId = process.env.BOT_OWNER_ID;
    if (fee > 0 && ownerId) {
        await starkEconomy.modifyBalance(ownerId, fee, `SX Tax: Sell ${amount} ${symbol}`);
    }
    
    // Record trade impact on market
    recordTradeImpact(symbol.toUpperCase(), amount, false);
    
    return {
        success: true,
        symbol: symbol.toUpperCase(),
        amount,
        price,
        totalValue,
        fee,
        netProceeds,
        marketImpact: 'Bearish pressure added'
    };
}

/**
 * Transfer cryptocurrency between users
 */
async function transferCrypto(fromUserId, toUserId, symbol, amount) {
    const coin = CRYPTO_COINS[symbol.toUpperCase()];
    
    if (!coin) {
        return { success: false, error: 'Unknown cryptocurrency' };
    }
    
    if (amount < SX_CONFIG.minTrade) {
        return { success: false, error: `Minimum transfer is ${SX_CONFIG.minTrade} coins` };
    }
    
    if (fromUserId === toUserId) {
        return { success: false, error: 'Cannot transfer to yourself' };
    }
    
    // Check sender holdings
    const senderPortfolio = await getPortfolio(fromUserId);
    const holdings = senderPortfolio.holdings?.[symbol.toUpperCase()] || 0;
    
    if (holdings < amount) {
        return { success: false, error: `Insufficient ${symbol}. You have ${holdings}` };
    }
    
    // Calculate transfer fee (1%)
    const fee = Math.ceil(amount * 0.01 * 100) / 100;
    const netAmount = amount - fee;
    
    const col = await getCollection('sx_portfolios');
    
    // Deduct from sender
    await col.updateOne(
        { userId: fromUserId },
        {
            $inc: { [`holdings.${symbol.toUpperCase()}`]: -amount },
            $set: { updatedAt: new Date() }
        }
    );
    
    // Add to receiver (minus fee)
    await col.updateOne(
        { userId: toUserId },
        {
            $inc: { [`holdings.${symbol.toUpperCase()}`]: netAmount },
            $set: { updatedAt: new Date() }
        },
        { upsert: true }
    );
    
    // Fee goes to bot owner
    const ownerId = process.env.BOT_OWNER_ID;
    if (fee > 0 && ownerId) {
        await col.updateOne(
            { userId: ownerId },
            {
                $inc: { [`holdings.${symbol.toUpperCase()}`]: fee },
                $set: { updatedAt: new Date() }
            },
            { upsert: true }
        );
    }
    
    return {
        success: true,
        symbol: symbol.toUpperCase(),
        amount,
        fee,
        netAmount,
        from: fromUserId,
        to: toUserId
    };
}

// ============================================================================
// PRICE MANAGEMENT - ROBUST MARKET SIMULATION
// ============================================================================

/**
 * Update all coin prices with realistic market mechanics
 */
async function updatePrices() {
    const now = Date.now();
    if (now - lastPriceTick < SX_CONFIG.tickInterval) {
        return;
    }
    lastPriceTick = now;
    
    // Check if we need a new market cycle
    if (now - marketState.cycleStarted > SX_CONFIG.cycleDuration) {
        determineMarketCycle();
        console.log(`[StarkCrypto] New market cycle: ${marketState.cycle}, sentiment: ${marketState.sentiment.toFixed(2)}`);
    }
    
    // Check for market events
    checkForMarketEvent(now);
    
    // Calculate market-wide factors
    const marketTrend = calculateMarketTrend();
    
    // Update each coin
    for (const [symbol, coin] of Object.entries(CRYPTO_COINS)) {
        const currentPrice = coinPrices.get(symbol);
        const momentum = coinMomentum.get(symbol) || 0;
        const volume = tradeVolume.get(symbol) || 0;
        
        // 1. Base random walk (Geometric Brownian Motion inspired)
        const tierMult = TIER_MULTIPLIERS[coin.tier] || 1.0;
        const effectiveVolatility = coin.volatility * tierMult * SX_CONFIG.baseVolatility;
        const randomWalk = (Math.random() - 0.5) * 2 * effectiveVolatility;
        
        // 2. Market correlation effect
        const correlationEffect = marketTrend * coin.correlation * 0.02;
        
        // 3. Momentum effect (prices tend to continue their direction briefly)
        const momentumEffect = momentum * 0.3;
        
        // 4. Volume impact (high volume = more movement)
        const volumeEffect = Math.min(volume * SX_CONFIG.volumeImpact, 0.05) * Math.sign(momentum || randomWalk);
        
        // 5. Mean reversion (gentle pull toward base price over time)
        const priceRatio = currentPrice / coin.basePrice;
        const meanReversion = priceRatio > 1 
            ? -0.002 * Math.log(priceRatio)
            : 0.002 * Math.log(1 / priceRatio);
        
        // 6. Event effect
        let eventEffect = 0;
        if (marketState.activeEvent && now < marketState.activeEvent.expiresAt) {
            const eventType = marketState.activeEvent.type;
            if (eventType === 'crash') {
                eventEffect = (marketState.activeEvent.multiplier - 1) * tierMult;
            } else if (eventType === 'pump') {
                eventEffect = (marketState.activeEvent.multiplier - 1) * (coin.tier === 'meme' ? 2 : 1);
            } else {
                eventEffect = (marketState.activeEvent.multiplier - 1) * coin.correlation;
            }
        }
        
        // Combine all effects
        const totalChange = randomWalk + correlationEffect + momentumEffect + volumeEffect + meanReversion + eventEffect;
        let newPrice = currentPrice * (1 + totalChange);
        
        // Price bounds (can't go below 1% of base or above 100x base)
        const minPrice = coin.basePrice * 0.01;
        const maxPrice = coin.basePrice * 100;
        newPrice = Math.max(minPrice, Math.min(maxPrice, newPrice));
        newPrice = Math.round(newPrice * 100) / 100;
        
        // Update momentum (decaying average of recent changes)
        const priceChange = (newPrice - currentPrice) / currentPrice;
        const newMomentum = momentum * SX_CONFIG.momentumDecay + priceChange * (1 - SX_CONFIG.momentumDecay);
        coinMomentum.set(symbol, newMomentum);
        
        // Decay trade volume
        tradeVolume.set(symbol, volume * 0.9);
        
        // Update price
        coinPrices.set(symbol, newPrice);
        
        // Store history
        const history = priceHistory.get(symbol) || [];
        history.push({ price: newPrice, timestamp: now });
        if (history.length > SX_CONFIG.historyMaxLength) history.shift();
        priceHistory.set(symbol, history);
    }
    
    // Clear expired event
    if (marketState.activeEvent && now >= marketState.activeEvent.expiresAt) {
        console.log(`[StarkCrypto] Event ended: ${marketState.activeEvent.name}`);
        marketState.activeEvent = null;
    }
    
    // Persist to database periodically (every 10 ticks = 5 minutes)
    if (Math.random() < 0.1) {
        await savePriceSnapshot();
    }
}

/**
 * Calculate overall market trend based on sentiment and cycle
 */
function calculateMarketTrend() {
    let trend = marketState.sentiment;
    
    // Add some noise to the trend
    trend += (Math.random() - 0.5) * 0.1;
    
    // Clamp to [-1, 1]
    return Math.max(-1, Math.min(1, trend));
}

/**
 * Check for and trigger market events
 */
function checkForMarketEvent(now) {
    // Don't trigger events too frequently
    if (now - marketState.lastEventTime < 5 * 60 * 1000) return;
    if (marketState.activeEvent) return;
    
    // Roll for event
    if (Math.random() < SX_CONFIG.eventChance) {
        // Pick a random event based on chances
        const totalChance = MARKET_EVENTS.reduce((sum, e) => sum + e.chance, 0);
        let roll = Math.random() * totalChance;
        
        for (const event of MARKET_EVENTS) {
            roll -= event.chance;
            if (roll <= 0) {
                marketState.activeEvent = {
                    ...event,
                    startedAt: now,
                    expiresAt: now + event.duration
                };
                marketState.lastEventTime = now;
                console.log(`[StarkCrypto] Event triggered: ${event.name}`);
                break;
            }
        }
    }
}

/**
 * Save price snapshot to database
 */
async function savePriceSnapshot() {
    try {
        const col = await getCollection('sx_price_snapshots');
        const prices = {};
        for (const [symbol, price] of coinPrices) {
            prices[symbol] = price;
        }
        await col.insertOne({
            prices,
            marketState: {
                cycle: marketState.cycle,
                sentiment: marketState.sentiment,
                event: marketState.activeEvent?.name || null
            },
            timestamp: new Date()
        });
    } catch (error) {
        console.error('[StarkCrypto] Failed to save snapshot:', error.message);
    }
}

/**
 * Record a trade's impact on market
 */
function recordTradeImpact(symbol, amount, isBuy) {
    const currentVolume = tradeVolume.get(symbol) || 0;
    tradeVolume.set(symbol, currentVolume + Math.abs(amount));
    
    // Trades affect momentum
    const momentum = coinMomentum.get(symbol) || 0;
    const impact = (amount / SX_CONFIG.liquidityDepth) * (isBuy ? 1 : -1);
    coinMomentum.set(symbol, momentum + impact * 0.1);
    
    marketState.totalVolume24h += Math.abs(amount);
}

/**
 * Get current prices for all coins with market data
 */
function getAllPrices() {
    const prices = {};
    for (const [symbol, coin] of Object.entries(CRYPTO_COINS)) {
        const currentPrice = coinPrices.get(symbol);
        const history = priceHistory.get(symbol) || [];
        const oldPrice = history[0]?.price || currentPrice;
        const change24h = ((currentPrice - oldPrice) / oldPrice) * 100;
        const momentum = coinMomentum.get(symbol) || 0;
        
        // Calculate high/low from history
        const prices24h = history.map(h => h.price);
        const high24h = prices24h.length ? Math.max(...prices24h) : currentPrice;
        const low24h = prices24h.length ? Math.min(...prices24h) : currentPrice;
        
        prices[symbol] = {
            ...coin,
            price: currentPrice,
            change24h: Math.round(change24h * 100) / 100,
            high24h,
            low24h,
            momentum: Math.round(momentum * 1000) / 1000,
            trend: momentum > 0.001 ? 'up' : momentum < -0.001 ? 'down' : 'neutral'
        };
    }
    return prices;
}

/**
 * Get price for specific coin with full history
 */
function getCoinPrice(symbol) {
    const coin = CRYPTO_COINS[symbol.toUpperCase()];
    if (!coin) return null;
    
    const currentPrice = coinPrices.get(symbol.toUpperCase());
    const history = priceHistory.get(symbol.toUpperCase()) || [];
    const oldPrice = history[0]?.price || currentPrice;
    const change24h = ((currentPrice - oldPrice) / oldPrice) * 100;
    const momentum = coinMomentum.get(symbol.toUpperCase()) || 0;
    
    // Calculate stats
    const prices24h = history.map(h => h.price);
    const high24h = prices24h.length ? Math.max(...prices24h) : currentPrice;
    const low24h = prices24h.length ? Math.min(...prices24h) : currentPrice;
    
    return {
        ...coin,
        price: currentPrice,
        change24h: Math.round(change24h * 100) / 100,
        high24h,
        low24h,
        momentum,
        history: history.slice(-120), // Last hour at 30s intervals
        trend: momentum > 0.001 ? 'up' : momentum < -0.001 ? 'down' : 'neutral'
    };
}

/**
 * Get current market state
 */
function getMarketState() {
    return {
        cycle: marketState.cycle,
        sentiment: Math.round(marketState.sentiment * 100) / 100,
        activeEvent: marketState.activeEvent ? {
            name: marketState.activeEvent.name,
            type: marketState.activeEvent.type,
            endsIn: Math.max(0, marketState.activeEvent.expiresAt - Date.now())
        } : null,
        volume24h: Math.round(marketState.totalVolume24h),
        cycleAge: Date.now() - marketState.cycleStarted
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
    MARKET_EVENTS,
    
    // Portfolio
    getPortfolio,
    buyCrypto,
    sellCrypto,
    transferCrypto,
    
    // Prices & Market
    updatePrices,
    getAllPrices,
    getCoinPrice,
    getMarketState,
    
    // Leaderboard
    getLeaderboard,
    
    // Lifecycle
    startPriceUpdates,
    stopPriceUpdates,
    initializeMarket
};

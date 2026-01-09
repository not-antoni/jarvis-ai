/**
 * Stark Stocks - Virtual Stock Market
 * 
 * A fake stock market simulation for the Stark Bucks economy.
 * Stocks fluctuate based on "news" and random market forces.
 */

const database = require('./database');

// Fake company stocks
const COMPANIES = [
    { symbol: 'STRK', name: 'Stark Industries', sector: 'tech', basePrice: 1000, volatility: 0.08 },
    { symbol: 'OSCP', name: 'Oscorp', sector: 'biotech', basePrice: 500, volatility: 0.12 },
    { symbol: 'WAYN', name: 'Wayne Enterprises', sector: 'defense', basePrice: 2000, volatility: 0.05 },
    { symbol: 'LXCP', name: 'LexCorp', sector: 'energy', basePrice: 800, volatility: 0.10 },
    { symbol: 'HMRN', name: 'Hammer Industries', sector: 'tech', basePrice: 150, volatility: 0.15 },
    { symbol: 'RAND', name: 'Rand Corporation', sector: 'martial', basePrice: 300, volatility: 0.10 },
    { symbol: 'PKER', name: 'Parker Industries', sector: 'science', basePrice: 250, volatility: 0.12 },
    { symbol: 'DALY', name: 'Daily Bugle Media', sector: 'media', basePrice: 50, volatility: 0.20 },
    { symbol: 'ASGD', name: 'Asgardian Exports', sector: 'luxury', basePrice: 5000, volatility: 0.06 },
    { symbol: 'HYDRA', name: 'Hydra Holdings', sector: 'shadow', basePrice: 666, volatility: 0.25 },
];

// News headlines that affect prices
const NEWS_POSITIVE = [
    'announces groundbreaking new technology',
    'reports record quarterly earnings',
    'secures major government contract',
    'stock upgraded by analysts',
    'CEO featured on Forbes cover',
    'acquires promising startup',
    'partnership with Avengers confirmed',
];

const NEWS_NEGATIVE = [
    'faces regulatory investigation',
    'reports disappointing earnings',
    'loses major contract bid',
    'stock downgraded by analysts',
    'CEO faces controversy',
    'product recall announced',
    'cyberattack disrupts operations',
];

// In-memory price cache (refreshes every tick)
let priceCache = new Map();
let lastUpdate = 0;
const UPDATE_INTERVAL = 5 * 60 * 1000; // 5 minutes

/**
 * Initialize or get current stock prices
 */
async function getMarketData() {
    const now = Date.now();

    // Refresh prices if cache expired
    if (now - lastUpdate > UPDATE_INTERVAL || priceCache.size === 0) {
        await refreshPrices();
    }

    return Array.from(priceCache.values());
}

/**
 * Refresh all stock prices with random fluctuations
 */
async function refreshPrices() {
    // Load persisted prices from DB
    const db = database.getMainDb();
    const collection = db.collection('stockMarket');

    for (const company of COMPANIES) {
        let stored = await collection.findOne({ symbol: company.symbol });

        if (!stored) {
            // Initialize new stock
            stored = {
                symbol: company.symbol,
                name: company.name,
                sector: company.sector,
                price: company.basePrice,
                previousPrice: company.basePrice,
                dayHigh: company.basePrice,
                dayLow: company.basePrice,
                history: [],
                lastNews: null,
                lastUpdate: Date.now()
            };
            await collection.insertOne(stored);
        }

        // Calculate new price with random fluctuation
        const volatility = company.volatility;
        const change = (Math.random() - 0.5) * 2 * volatility;
        const newPrice = Math.max(1, Math.round(stored.price * (1 + change)));

        // Update records
        const previousPrice = stored.price;
        stored.previousPrice = previousPrice;
        stored.price = newPrice;
        stored.dayHigh = Math.max(stored.dayHigh || newPrice, newPrice);
        stored.dayLow = Math.min(stored.dayLow || newPrice, newPrice);
        stored.history = (stored.history || []).slice(-50);
        stored.history.push({ price: newPrice, timestamp: Date.now() });
        stored.lastUpdate = Date.now();

        await collection.updateOne(
            { symbol: company.symbol },
            { $set: stored }
        );

        priceCache.set(company.symbol, {
            ...stored,
            change: newPrice - previousPrice,
            changePercent: ((newPrice - previousPrice) / previousPrice * 100).toFixed(2)
        });
    }

    lastUpdate = Date.now();
}

/**
 * Get single stock info
 */
async function getStock(symbol) {
    await getMarketData(); // Ensure cache is fresh
    return priceCache.get(symbol.toUpperCase()) || null;
}

/**
 * Buy stocks
 */
async function buyStock(userId, symbol, quantity) {
    const stock = await getStock(symbol);
    if (!stock) {
        return { success: false, error: `Stock ${symbol} not found.` };
    }

    const totalCost = stock.price * quantity;
    const economy = require('./stark-economy');
    const balance = await economy.getBalance(userId);

    if (balance < totalCost) {
        return { success: false, error: `Insufficient funds. Need ${totalCost} SBX, have ${balance}.` };
    }

    // Deduct balance
    await economy.addBalance(userId, -totalCost);

    // Add to portfolio
    const db = database.getMainDb();
    const portfolios = db.collection('stockPortfolios');

    await portfolios.updateOne(
        { userId, symbol: symbol.toUpperCase() },
        {
            $inc: { quantity: quantity, totalInvested: totalCost },
            $setOnInsert: { userId, symbol: symbol.toUpperCase() }
        },
        { upsert: true }
    );

    return {
        success: true,
        symbol: symbol.toUpperCase(),
        quantity,
        price: stock.price,
        totalCost,
        newBalance: balance - totalCost
    };
}

/**
 * Sell stocks
 */
async function sellStock(userId, symbol, quantity) {
    const stock = await getStock(symbol);
    if (!stock) {
        return { success: false, error: `Stock ${symbol} not found.` };
    }

    const db = database.getMainDb();
    const portfolios = db.collection('stockPortfolios');

    const holding = await portfolios.findOne({ userId, symbol: symbol.toUpperCase() });
    if (!holding || holding.quantity < quantity) {
        return { success: false, error: `You don't own ${quantity} shares of ${symbol}.` };
    }

    const totalEarnings = stock.price * quantity;

    // Update portfolio
    if (holding.quantity === quantity) {
        await portfolios.deleteOne({ userId, symbol: symbol.toUpperCase() });
    } else {
        await portfolios.updateOne(
            { userId, symbol: symbol.toUpperCase() },
            { $inc: { quantity: -quantity } }
        );
    }

    // Add balance
    const economy = require('./stark-economy');
    await economy.addBalance(userId, totalEarnings);
    const newBalance = await economy.getBalance(userId);

    // Calculate profit/loss
    const avgBuyPrice = holding.totalInvested / holding.quantity;
    const profit = (stock.price - avgBuyPrice) * quantity;

    return {
        success: true,
        symbol: symbol.toUpperCase(),
        quantity,
        price: stock.price,
        totalEarnings,
        profit: Math.round(profit),
        newBalance
    };
}

/**
 * Get user's portfolio
 */
async function getPortfolio(userId) {
    const db = database.getMainDb();
    const portfolios = db.collection('stockPortfolios');

    const holdings = await portfolios.find({ userId }).toArray();

    // Enrich with current prices
    await getMarketData();

    let totalValue = 0;
    let totalInvested = 0;

    const enriched = holdings.map(holding => {
        const stock = priceCache.get(holding.symbol);
        const currentValue = stock ? stock.price * holding.quantity : 0;
        const profit = currentValue - (holding.totalInvested || 0);

        totalValue += currentValue;
        totalInvested += holding.totalInvested || 0;

        return {
            ...holding,
            currentPrice: stock?.price || 0,
            currentValue,
            profit,
            profitPercent: holding.totalInvested ? ((profit / holding.totalInvested) * 100).toFixed(2) : '0.00'
        };
    });

    return {
        holdings: enriched,
        totalValue,
        totalInvested,
        totalProfit: totalValue - totalInvested,
        profitPercent: totalInvested ? (((totalValue - totalInvested) / totalInvested) * 100).toFixed(2) : '0.00'
    };
}

/**
 * Generate random market news
 */
async function generateNews() {
    const company = COMPANIES[Math.floor(Math.random() * COMPANIES.length)];
    const isPositive = Math.random() > 0.4; // 60% positive bias

    const headlines = isPositive ? NEWS_POSITIVE : NEWS_NEGATIVE;
    const headline = headlines[Math.floor(Math.random() * headlines.length)];

    // Apply price impact
    const impact = isPositive ?
        1 + (Math.random() * 0.15 + 0.05) : // +5% to +20%
        1 - (Math.random() * 0.15 + 0.05);  // -5% to -20%

    const db = database.getMainDb();
    const collection = db.collection('stockMarket');

    const stock = await collection.findOne({ symbol: company.symbol });
    if (stock) {
        const newPrice = Math.max(1, Math.round(stock.price * impact));
        await collection.updateOne(
            { symbol: company.symbol },
            {
                $set: {
                    price: newPrice,
                    lastNews: { headline, impact: isPositive ? 'positive' : 'negative', timestamp: Date.now() }
                }
            }
        );

        // Update cache
        if (priceCache.has(company.symbol)) {
            const cached = priceCache.get(company.symbol);
            cached.price = newPrice;
            cached.lastNews = { headline, impact: isPositive ? 'positive' : 'negative' };
        }
    }

    return {
        symbol: company.symbol,
        name: company.name,
        headline: `${company.name} ${headline}`,
        impact: isPositive ? 'positive' : 'negative',
        priceChange: isPositive ? '+' : '-'
    };
}

/**
 * Get market summary
 */
async function getMarketSummary() {
    const stocks = await getMarketData();

    const gainers = stocks
        .filter(s => s.change > 0)
        .sort((a, b) => parseFloat(b.changePercent) - parseFloat(a.changePercent))
        .slice(0, 3);

    const losers = stocks
        .filter(s => s.change < 0)
        .sort((a, b) => parseFloat(a.changePercent) - parseFloat(b.changePercent))
        .slice(0, 3);

    const totalMarketCap = stocks.reduce((sum, s) => sum + s.price * 1000000, 0);
    const avgChange = stocks.reduce((sum, s) => sum + parseFloat(s.changePercent), 0) / stocks.length;

    return {
        stocks,
        gainers,
        losers,
        totalMarketCap,
        avgChange: avgChange.toFixed(2),
        marketTrend: avgChange > 0 ? 'bullish' : avgChange < 0 ? 'bearish' : 'neutral'
    };
}

module.exports = {
    COMPANIES,
    getMarketData,
    getStock,
    buyStock,
    sellStock,
    getPortfolio,
    generateNews,
    getMarketSummary,
    refreshPrices,
};

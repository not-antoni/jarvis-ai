/**
 * Stark Companies System
 * Business ownership and management for the Stark Economy
 * 
 * Features:
 * - 5 company tiers (Basic, Small, Large, Mega, Ultra/Custom)
 * - Tax reductions based on company ownership
 * - Profit generation every hour
 * - Maintenance costs every 6 hours
 * - Risk/event system with good/bad outcomes
 * - Sabotage mechanics between players
 */

const database = require('./database');

// ============================================================================
// COMPANY TIERS & DEFINITIONS
// ============================================================================

const COMPANY_TIERS = {
    basic: { taxReduction: 5, maxOwned: 25 },
    small: { taxReduction: 8, maxOwned: 15 },
    large: { taxReduction: 10, maxOwned: 10 },
    mega: { taxReduction: 20, maxOwned: 5 },
    ultra: { taxReduction: 25, maxOwned: 1 }
};

// # = Price to buy
// @ = Maintenance cost (every 6 hours)
// R = Default risk (50 = neutral)
// $ = Profit per hour
const COMPANY_TYPES = {
    // === BASIC TIER ===
    fastfood: {
        id: 'fastfood',
        name: '🍔 Fast Food Place',
        tier: 'basic',
        price: 500000,          // 500K to buy
        maintenance: 5000,      // 5K every 2h
        defaultRisk: 45,        // Slightly risky
        defaultProfit: 15000,   // 15K per hour
        rushRisk: 8,            // +8% risk on rush
        slowRisk: -4,           // -4% risk on slow
        events: {
            bad: [
                { name: '🔥 Fire', profitMod: -35, duration: 15 * 60 * 1000 },
                { name: '🏥 Health Inspection (Fail)', profitMod: -40, duration: 0 }
            ],
            good: [
                { name: '☀️ Good Day', profitMod: 35, duration: 40 * 60 * 1000 },
                { name: '✅ Health Inspection (Pass)', profitMod: 45, duration: 0 }
            ]
        }
    },
    coffeeshop: {
        id: 'coffeeshop',
        name: '☕ Coffee Shop',
        tier: 'basic',
        price: 650000,          // 650K to buy
        maintenance: 6000,      // 6K every 2h
        defaultRisk: 50,
        defaultProfit: 18000,   // 18K per hour
        rushRisk: 6,
        slowRisk: -3,
        events: {
            bad: [
                { name: '💔 Broken Espresso Machine', profitMod: -30, duration: 20 * 60 * 1000 },
                { name: '📉 Competition Opened Nearby', profitMod: -25, duration: 0 }
            ],
            good: [
                { name: '📱 Viral TikTok', profitMod: 40, duration: 30 * 60 * 1000 },
                { name: '⭐ 5-Star Review', profitMod: 30, duration: 0 }
            ]
        }
    },
    pizzeria: {
        id: 'pizzeria',
        name: '🍕 Pizzeria',
        tier: 'basic',
        price: 750000,          // 750K to buy
        maintenance: 7000,      // 7K every 2h
        defaultRisk: 48,
        defaultProfit: 20000,   // 20K per hour
        rushRisk: 7,
        slowRisk: -4,
        events: {
            bad: [
                { name: '🧀 Cheese Shortage', profitMod: -35, duration: 25 * 60 * 1000 },
                { name: '🚚 Delivery Driver Quit', profitMod: -30, duration: 0 }
            ],
            good: [
                { name: '🎉 Party Order Surge', profitMod: 50, duration: 20 * 60 * 1000 },
                { name: '📺 Featured on Food Network', profitMod: 40, duration: 0 }
            ]
        }
    },

    // === SMALL TIER ===
    techstartup: {
        id: 'techstartup',
        name: '💻 Tech Startup',
        tier: 'small',
        price: 2500000,         // 2.5M to buy
        maintenance: 25000,     // 25K every 2h
        defaultRisk: 40,        // Higher risk = more volatile
        defaultProfit: 80000,   // 80K per hour
        rushRisk: 10,
        slowRisk: -5,
        events: {
            bad: [
                { name: '🐛 Major Bug Found', profitMod: -45, duration: 30 * 60 * 1000 },
                { name: '💸 Investor Pulled Out', profitMod: -50, duration: 0 }
            ],
            good: [
                { name: '🚀 Product Launch Success', profitMod: 60, duration: 45 * 60 * 1000 },
                { name: '💰 New Funding Round', profitMod: 55, duration: 0 }
            ]
        }
    },
    boutique: {
        id: 'boutique',
        name: '👗 Boutique Store',
        tier: 'small',
        price: 2000000,         // 2M to buy
        maintenance: 20000,     // 20K every 2h
        defaultRisk: 52,
        defaultProfit: 65000,   // 65K per hour
        rushRisk: 8,
        slowRisk: -4,
        events: {
            bad: [
                { name: '📦 Shipment Delayed', profitMod: -30, duration: 20 * 60 * 1000 },
                { name: '👎 Bad Fashion Season', profitMod: -35, duration: 0 }
            ],
            good: [
                { name: '👠 Celebrity Spotted', profitMod: 55, duration: 35 * 60 * 1000 },
                { name: '🛍️ Holiday Rush', profitMod: 45, duration: 0 }
            ]
        }
    },
    gym: {
        id: 'gym',
        name: '💪 Fitness Gym',
        tier: 'small',
        price: 3000000,         // 3M to buy
        maintenance: 30000,     // 30K every 2h
        defaultRisk: 55,
        defaultProfit: 90000,   // 90K per hour
        rushRisk: 9,
        slowRisk: -5,
        events: {
            bad: [
                { name: '🔧 Equipment Broke', profitMod: -40, duration: 25 * 60 * 1000 },
                { name: '😷 Member Got Injured', profitMod: -45, duration: 0 }
            ],
            good: [
                { name: '💪 New Year Resolution Rush', profitMod: 65, duration: 40 * 60 * 1000 },
                { name: '🏆 Won Best Gym Award', profitMod: 50, duration: 0 }
            ]
        }
    },

    // === LARGE TIER ===
    factory: {
        id: 'factory',
        name: '🏭 Manufacturing Factory',
        tier: 'large',
        price: 15000000,        // 15M to buy
        maintenance: 150000,    // 150K every 2h
        defaultRisk: 45,
        defaultProfit: 500000,  // 500K per hour
        rushRisk: 12,
        slowRisk: -6,
        events: {
            bad: [
                { name: '⚙️ Machine Breakdown', profitMod: -50, duration: 45 * 60 * 1000 },
                { name: '🪧 Workers Strike', profitMod: -60, duration: 0 }
            ],
            good: [
                { name: '📈 Government Contract', profitMod: 70, duration: 60 * 60 * 1000 },
                { name: '🤖 Automation Upgrade', profitMod: 55, duration: 0 }
            ]
        }
    },
    hotel: {
        id: 'hotel',
        name: '🏨 Hotel Chain',
        tier: 'large',
        price: 20000000,        // 20M to buy
        maintenance: 200000,    // 200K every 2h
        defaultRisk: 50,
        defaultProfit: 700000,  // 700K per hour
        rushRisk: 10,
        slowRisk: -5,
        events: {
            bad: [
                { name: '🐀 Pest Infestation', profitMod: -55, duration: 40 * 60 * 1000 },
                { name: '⭐ 1-Star Review Viral', profitMod: -45, duration: 0 }
            ],
            good: [
                { name: '🎭 Celebrity Stayed', profitMod: 60, duration: 50 * 60 * 1000 },
                { name: '🏆 5-Star Rating', profitMod: 50, duration: 0 }
            ]
        }
    },
    shoppingmall: {
        id: 'shoppingmall',
        name: '🛒 Shopping Mall',
        tier: 'large',
        price: 25000000,        // 25M to buy
        maintenance: 250000,    // 250K every 2h
        defaultRisk: 48,
        defaultProfit: 900000,  // 900K per hour
        rushRisk: 11,
        slowRisk: -6,
        events: {
            bad: [
                { name: '🚨 Security Incident', profitMod: -50, duration: 35 * 60 * 1000 },
                { name: '🏪 Anchor Store Left', profitMod: -55, duration: 0 }
            ],
            good: [
                { name: '🎄 Holiday Season', profitMod: 75, duration: 60 * 60 * 1000 },
                { name: '🎪 Special Event', profitMod: 60, duration: 0 }
            ]
        }
    },

    // === MEGA TIER ===
    mediaempire: {
        id: 'mediaempire',
        name: '📺 Media Empire',
        tier: 'mega',
        price: 100000000,       // 100M to buy
        maintenance: 1000000,   // 1M every 2h
        defaultRisk: 42,
        defaultProfit: 5000000, // 5M per hour
        rushRisk: 15,
        slowRisk: -8,
        events: {
            bad: [
                { name: '📉 Ratings Crash', profitMod: -60, duration: 60 * 60 * 1000 },
                { name: '🚫 Show Cancelled', profitMod: -70, duration: 0 }
            ],
            good: [
                { name: '🏆 Emmy Winner', profitMod: 80, duration: 90 * 60 * 1000 },
                { name: '📊 Viral Content', profitMod: 70, duration: 0 }
            ]
        }
    },
    spacecorp: {
        id: 'spacecorp',
        name: '🚀 Space Corporation',
        tier: 'mega',
        price: 200000000,       // 200M to buy
        maintenance: 2000000,   // 2M every 2h
        defaultRisk: 35,        // Very risky
        defaultProfit: 10000000, // 10M per hour
        rushRisk: 18,
        slowRisk: -10,
        events: {
            bad: [
                { name: '💥 Launch Failure', profitMod: -80, duration: 120 * 60 * 1000 },
                { name: '🛰️ Satellite Lost', profitMod: -65, duration: 0 }
            ],
            good: [
                { name: '🌙 Successful Mission', profitMod: 100, duration: 120 * 60 * 1000 },
                { name: '💎 Asteroid Mining Contract', profitMod: 90, duration: 0 }
            ]
        }
    },
    casino: {
        id: 'casino',
        name: '🎰 Casino Resort',
        tier: 'mega',
        price: 150000000,       // 150M to buy
        maintenance: 1500000,   // 1.5M every 2h
        defaultRisk: 50,
        defaultProfit: 7000000, // 7M per hour
        rushRisk: 14,
        slowRisk: -7,
        events: {
            bad: [
                { name: '🃏 Cheater Scandal', profitMod: -55, duration: 45 * 60 * 1000 },
                { name: '👮 Raid by Authorities', profitMod: -75, duration: 0 }
            ],
            good: [
                { name: '🎲 High Roller Weekend', profitMod: 85, duration: 60 * 60 * 1000 },
                { name: '🏆 Won Casino Award', profitMod: 65, duration: 0 }
            ]
        }
    }
};

// ============================================================================
// TIMING CONSTANTS
// ============================================================================

const TIMING = {
    PROFIT_INTERVAL: 60 * 60 * 1000,        // 1 hour
    MAINTENANCE_INTERVAL: 2 * 60 * 60 * 1000, // 2 hours (changed from 6h)
    TAX_INTERVAL: 2 * 60 * 60 * 1000,       // 2 hours (user request)
    RUSH_ADVANCE: 30 * 60 * 1000,           // 30 minutes
    SABOTAGE_ENABLE_DELAY: 30 * 60 * 1000,  // 30 minutes to enable
    SABOTAGE_VULNERABILITY_DELAY: 2.5 * 60 * 1000, // 2.5 minutes after enable
    CLEAN_COOLDOWN: 2.5 * 60 * 1000,        // 2.5 minutes
    SPREADDIRT_COOLDOWN: 5 * 60 * 1000,     // 5 minutes
    LOW_PROFIT_THRESHOLD: 5,                // 5% profit = low
    BANKRUPTCY_HOURS: 24,                   // 24 hours at 0% = bankruptcy
    PROFIT_DECAY_PER_CYCLE: 5               // -5% per cycle if can't pay maintenance
};

const TAX = {
    BASE_RATE: 75,
    MIN_RATE: 25,
    // Balance tax tiers (additional tax based on SB balance)
    BALANCE_TIERS: [
        { min: 0, rate: 0 },           // 0-100K: 0%
        { min: 100000, rate: 5 },      // 100K-1M: +5%
        { min: 1000000, rate: 10 },    // 1M-10M: +10%
        { min: 10000000, rate: 15 },   // 10M-100M: +15%
        { min: 100000000, rate: 20 },  // 100M-1B: +20%
        { min: 1000000000, rate: 30 }  // 1B+: +30%
    ],
    // Company tax tiers (based on total company value)
    COMPANY_TIERS: [
        { min: 0, rate: 0 },
        { min: 1000000, rate: 5 },     // 1M+: +5%
        { min: 10000000, rate: 10 },   // 10M+: +10%
        { min: 100000000, rate: 15 },  // 100M+: +15%
        { min: 500000000, rate: 25 }   // 500M+: +25%
    ]
};

// Worker efficiency: more workers = more profit but more cost
const WORKERS = {
    MAX_PER_COMPANY: 100,
    COST_PER_WORKER: 10000,     // 10K per worker per 2h
    PROFIT_BOOST_PER_WORKER: 1, // +1% profit per worker
    MAX_PROFIT_BOOST: 50        // Max +50% from workers
};

// ============================================================================
// DATABASE OPERATIONS
// ============================================================================

async function getCollection() {
    await database.connect();
    return database.db.collection('starkCompanies');
}

async function getUserCompaniesCollection() {
    await database.connect();
    return database.db.collection('starkCompanies');
}

// ============================================================================
// COMPANY ID GENERATION
// ============================================================================

function generateCompanyId(username, companyType, fourDigitId) {
    // Sanitize username (lowercase, alphanumeric + underscore only)
    const sanitizedName = username.toLowerCase().replace(/[^a-z0-9_]/g, '').substring(0, 20);
    return `${sanitizedName}_${companyType}_${fourDigitId}`;
}

function parseCompanyId(companyId) {
    const parts = companyId.split('_');
    if (parts.length < 3) return null;
    const fourDigitId = parts.pop();
    const companyType = parts.pop();
    const username = parts.join('_');
    return { username, companyType, fourDigitId };
}

// ============================================================================
// CORE COMPANY FUNCTIONS
// ============================================================================

/**
 * Get all companies owned by a user
 */
async function getUserCompanies(userId) {
    const col = await getCollection();
    return await col.find({ ownerId: userId }).toArray();
}

/**
 * Get a company by its ID
 */
async function getCompany(companyId) {
    const col = await getCollection();
    return await col.findOne({ id: companyId });
}

/**
 * Get company by owner and type for counting
 */
async function countUserCompaniesByTier(userId, tier) {
    const col = await getCollection();
    return await col.countDocuments({ ownerId: userId, tier: tier });
}

/**
 * Count total companies of a type owned by user
 */
async function countUserCompaniesByType(userId, companyType) {
    const col = await getCollection();
    return await col.countDocuments({ ownerId: userId, type: companyType });
}

/**
 * Buy a new company
 */
async function buyCompany(userId, username, companyType, fourDigitId) {
    const typeData = COMPANY_TYPES[companyType];
    if (!typeData) {
        return { success: false, error: `Unknown company type: ${companyType}` };
    }

    // Validate 4-digit ID
    if (!/^\d{4}$/.test(fourDigitId)) {
        return { success: false, error: 'ID must be exactly 4 digits (0000-9999)' };
    }

    // Check tier limits
    const tierData = COMPANY_TIERS[typeData.tier];
    const ownedInTier = await countUserCompaniesByTier(userId, typeData.tier);
    if (ownedInTier >= tierData.maxOwned) {
        return { success: false, error: `You can only own ${tierData.maxOwned} ${typeData.tier} companies` };
    }

    // Generate ID and check if exists for THIS user
    const companyId = generateCompanyId(username, companyType, fourDigitId);
    const existing = await getCompany(companyId);
    if (existing) {
        return { success: false, error: `You already have a company with ID ${fourDigitId}` };
    }

    // Check if user can afford
    const starkEconomy = require('./stark-economy');
    const userBalance = await starkEconomy.getBalance(userId);
    if (userBalance < typeData.price) {
        return { success: false, error: `Not enough Starkbucks! Need ${formatCompact(typeData.price)}, have ${formatCompact(userBalance)}` };
    }

    // Deduct cost
    await starkEconomy.modifyBalance(userId, -typeData.price, 'company_purchase');

    // Create company
    const now = new Date();
    const company = {
        id: companyId,
        ownerId: userId,
        ownerName: username,
        type: companyType,
        tier: typeData.tier,
        displayName: typeData.name,

        // Economics
        baseProfit: typeData.defaultProfit,
        currentProfitPercent: 100,  // Starts at 100%
        risk: typeData.defaultRisk,
        lastProfit: now,
        lastMaintenance: now,
        maintenanceCost: typeData.maintenance,

        // State
        sabotageEnabled: false,
        sabotageEnabledAt: null,
        lastRush: null,
        rushUsedThisPeriod: false,
        lastSlow: null,
        slowUsedThisPeriod: false,
        lastClean: null,
        lastSpreadDirt: null,

        // Temporary effects
        profitEffects: [],

        // Metadata
        createdAt: now,
        updatedAt: now
    };

    const col = await getCollection();
    await col.insertOne(company);

    return { success: true, company, cost: typeData.price };
}

/**
 * Calculate current profit with all modifiers
 */
function calculateCurrentProfit(company) {
    const typeData = COMPANY_TYPES[company.type];
    if (!typeData) return 0;

    let profit = typeData.defaultProfit;

    // Apply base profit percentage
    profit *= (company.currentProfitPercent / 100);

    // Apply temporary effects
    const now = Date.now();
    let effectMod = 0;
    for (const effect of company.profitEffects || []) {
        if (new Date(effect.expiresAt).getTime() > now || effect.duration === 0) {
            effectMod += effect.modifier;
        }
    }
    profit *= (1 + effectMod / 100);

    return Math.floor(profit);
}

/**
 * Calculate tax rate for a user based on their companies
 */
async function calculateTaxRate(userId) {
    const companies = await getUserCompanies(userId);

    if (companies.length === 0) {
        return TAX.BASE_RATE;
    }

    // Count unique tiers (doesn't stack for same company, does for different tiers)
    const tierCounts = {};
    for (const company of companies) {
        tierCounts[company.tier] = (tierCounts[company.tier] || 0) + 1;
    }

    // Calculate total reduction
    let totalReduction = 0;
    for (const [tier, count] of Object.entries(tierCounts)) {
        const tierData = COMPANY_TIERS[tier];
        if (tierData) {
            // Reduction stacks for each company in a tier
            totalReduction += tierData.taxReduction * count;
        }
    }

    const finalRate = Math.max(TAX.MIN_RATE, TAX.BASE_RATE - totalReduction);
    return finalRate;
}

/**
 * Rush - advance next profit by 30 minutes
 */
async function rushCompany(userId, companyId) {
    const company = await getCompany(companyId);
    if (!company) return { success: false, error: 'Company not found' };
    if (company.ownerId !== userId) return { success: false, error: 'You don\'t own this company' };
    if (company.rushUsedThisPeriod) return { success: false, error: 'Rush already used this profit period' };

    let typeData = COMPANY_TYPES[company.type];

    // Handle custom companies (ultra tier fallback)
    if (!typeData && company.isCustom) {
        typeData = {
            rushRisk: 15, // Ultra tier rush risk
            price: 50000000
        };
    } else if (!typeData) {
        // Fallback for unknown types
        typeData = { rushRisk: 10 };
    }

    const now = Date.now();
    const nextProfit = new Date(company.lastProfit).getTime() + TIMING.PROFIT_INTERVAL;
    const timeSinceProfit = now - new Date(company.lastProfit).getTime();

    let paidNow = false;
    let newNextProfit;

    if (timeSinceProfit >= TIMING.RUSH_ADVANCE) {
        // Already been 30+ minutes - pay now but next profit is at normal + 30min
        paidNow = true;
        newNextProfit = new Date(company.lastProfit).getTime() + TIMING.PROFIT_INTERVAL + TIMING.RUSH_ADVANCE;
    } else {
        // Less than 30 minutes - just advance by 30 minutes
        newNextProfit = nextProfit - TIMING.RUSH_ADVANCE;
    }

    // Increase risk
    const currentRisk = company.risk || 50;
    const riskToAdd = (typeData && typeData.rushRisk) ? typeData.rushRisk : 10;
    const newRisk = Math.min(100, currentRisk + riskToAdd);

    const col = await getCollection();
    await col.updateOne(
        { id: companyId },
        {
            $set: {
                risk: newRisk,
                rushUsedThisPeriod: true,
                lastRush: new Date(),
                ...(paidNow ? { lastProfit: new Date() } : {})
            }
        }
    );

    // If paid now, give profit
    let profitPaid = 0;
    if (paidNow) {
        profitPaid = calculateCurrentProfit(company);
        const starkEconomy = require('./stark-economy');
        await starkEconomy.modifyBalance(userId, profitPaid, 'company_rush_profit');
    }

    return {
        success: true,
        paidNow,
        profitPaid,
        riskIncrease: riskToAdd,
        newRisk
    };
}

/**
 * Calculate progressive tax based on user's balance
 * Higher balance = higher tax rate (rich pay more)
 * Returns additional tax percentage to add
 */
async function calculateBalanceTax(userId) {
    const starkEconomy = require('./stark-economy');
    const balance = await starkEconomy.getBalance(userId);

    // Aggressive Progressive Tax Tiers
    // 100K+: +5%
    // 1M+: +10%
    // 10M+: +15%
    // 100M+: +20%
    // 1B+: +25%
    // 10B+: +30%
    // 100B+: +35%
    // 1T+: +40%
    // 10T+: +50%
    // 100T+: +60%
    // 1Qa (Quad): +75%
    // 1Qi (Quint)+: +90%

    if (balance >= 1000000000000000000) return 90; // 1Qi+
    if (balance >= 1000000000000000) return 75;    // 1Qa+
    if (balance >= 100000000000000) return 60;     // 100T+
    if (balance >= 10000000000000) return 50;      // 10T+
    if (balance >= 1000000000000) return 40;       // 1T+
    if (balance >= 100000000000) return 35;        // 100B+
    if (balance >= 10000000000) return 30;         // 10B+
    if (balance >= 1000000000) return 25;          // 1B+
    if (balance >= 100000000) return 20;           // 100M+
    if (balance >= 10000000) return 15;            // 10M+
    if (balance >= 1000000) return 10;             // 1M+
    if (balance >= 100000) return 5;               // 100K+
    return 0;
}

/**
 * Slow - skip next payment, reduce risk
 */
async function slowCompany(userId, companyId) {
    const company = await getCompany(companyId);
    if (!company) return { success: false, error: 'Company not found' };
    if (company.ownerId !== userId) return { success: false, error: 'You don\'t own this company' };
    if (company.slowUsedThisPeriod) return { success: false, error: 'Slow already used this profit period' };

    const typeData = COMPANY_TYPES[company.type];

    // Skip next payment by setting lastProfit forward
    const newLastProfit = new Date(new Date(company.lastProfit).getTime() + TIMING.PROFIT_INTERVAL);
    const newRisk = Math.max(0, company.risk + typeData.slowRisk);

    const col = await getCollection();
    await col.updateOne(
        { id: companyId },
        {
            $set: {
                risk: newRisk,
                slowUsedThisPeriod: true,
                lastSlow: new Date(),
                lastProfit: newLastProfit
            }
        }
    );

    return {
        success: true,
        riskDecrease: Math.abs(typeData.slowRisk),
        newRisk
    };
}

/**
 * Clean - reduce risk by 5%
 */
async function cleanCompany(userId, companyId) {
    const company = await getCompany(companyId);
    if (!company) return { success: false, error: 'Company not found' };
    if (company.ownerId !== userId) return { success: false, error: 'You don\'t own this company' };

    // Check cooldown
    if (company.lastClean) {
        const elapsed = Date.now() - new Date(company.lastClean).getTime();
        if (elapsed < TIMING.CLEAN_COOLDOWN) {
            const remaining = Math.ceil((TIMING.CLEAN_COOLDOWN - elapsed) / 1000);
            return { success: false, error: `Clean on cooldown. Try again in ${remaining}s` };
        }
    }

    const newRisk = Math.max(0, company.risk - 5);

    const col = await getCollection();
    await col.updateOne(
        { id: companyId },
        { $set: { risk: newRisk, lastClean: new Date() } }
    );

    return { success: true, riskDecrease: 5, newRisk };
}

/**
 * Toggle sabotage mode
 */
async function toggleSabotage(userId, companyId) {
    const company = await getCompany(companyId);
    if (!company) return { success: false, error: 'Company not found' };
    if (company.ownerId !== userId) return { success: false, error: 'You don\'t own this company' };

    const col = await getCollection();

    if (company.sabotageEnabled) {
        // Disable sabotage
        await col.updateOne(
            { id: companyId },
            { $set: { sabotageEnabled: false, sabotageEnabledAt: null } }
        );
        return { success: true, enabled: false, message: 'Sabotage mode disabled' };
    } else {
        // Enable sabotage (30 min delay before can sabotage others)
        await col.updateOne(
            { id: companyId },
            { $set: { sabotageEnabled: true, sabotageEnabledAt: new Date() } }
        );
        return {
            success: true,
            enabled: true,
            message: 'Sabotage mode enabled! You can sabotage others in 30 minutes. Your company can be sabotaged in 2.5 minutes.'
        };
    }
}

/**
 * Spread dirt - increase risk on target company
 */
async function spreadDirt(userId, username, targetCompanyId) {
    const targetCompany = await getCompany(targetCompanyId);
    if (!targetCompany) return { success: false, error: 'Target company not found' };

    // Check if targeting own company or others
    const isOwnCompany = targetCompany.ownerId === userId;

    if (!isOwnCompany) {
        // Check if target has sabotage enabled and is vulnerable
        if (!targetCompany.sabotageEnabled) {
            return { success: false, error: 'Target company has sabotage disabled' };
        }
        const sabotageAge = Date.now() - new Date(targetCompany.sabotageEnabledAt).getTime();
        if (sabotageAge < TIMING.SABOTAGE_VULNERABILITY_DELAY) {
            const remaining = Math.ceil((TIMING.SABOTAGE_VULNERABILITY_DELAY - sabotageAge) / 1000);
            return { success: false, error: `Target is not yet vulnerable. Try again in ${remaining}s` };
        }

        // Check if attacker has a company with sabotage enabled
        const attackerCompanies = await getUserCompanies(userId);
        const canSabotage = attackerCompanies.some(c => {
            if (!c.sabotageEnabled) return false;
            const age = Date.now() - new Date(c.sabotageEnabledAt).getTime();
            return age >= TIMING.SABOTAGE_ENABLE_DELAY;
        });
        if (!canSabotage) {
            return { success: false, error: 'You need a company with sabotage enabled (30+ min) to attack others' };
        }
    }

    // Check cooldown (global per user)
    // For simplicity, we'll track this on the attacker's first company
    const attackerCompanies = await getUserCompanies(userId);
    if (attackerCompanies.length > 0) {
        const lastDirt = attackerCompanies[0].lastSpreadDirt;
        if (lastDirt) {
            const elapsed = Date.now() - new Date(lastDirt).getTime();
            if (elapsed < TIMING.SPREADDIRT_COOLDOWN) {
                const remaining = Math.ceil((TIMING.SPREADDIRT_COOLDOWN - elapsed) / 1000);
                return { success: false, error: `Spread Dirt on cooldown. Try again in ${remaining}s` };
            }
        }
    }

    // Apply dirt
    const newRisk = Math.min(100, targetCompany.risk + 5);

    const col = await getCollection();
    await col.updateOne(
        { id: targetCompanyId },
        { $set: { risk: newRisk } }
    );

    // Update cooldown on attacker's first company
    if (attackerCompanies.length > 0) {
        await col.updateOne(
            { id: attackerCompanies[0].id },
            { $set: { lastSpreadDirt: new Date() } }
        );
    }

    return {
        success: true,
        targetCompany: targetCompany.displayName,
        targetOwner: targetCompany.ownerName,
        riskIncrease: 5,
        newRisk,
        isOwnCompany
    };
}

/**
 * Lookup companies by username
 */
async function lookupByUsername(username) {
    const col = await getCollection();
    const sanitizedName = username.toLowerCase().replace(/[^a-z0-9_]/g, '');
    return await col.find({ ownerName: { $regex: new RegExp(`^${sanitizedName}`, 'i') } }).toArray();
}

/**
 * Reset profit profit on low profit company (3x or 9x maintenance cost)
 */
async function resetProfit(userId, companyId) {
    const company = await getCompany(companyId);
    if (!company) return { success: false, error: 'Company not found' };
    if (company.ownerId !== userId) return { success: false, error: 'You don\'t own this company' };
    if (company.currentProfitPercent > 5) {
        return { success: false, error: 'Can only reset profit when under 5%' };
    }

    // Calculate cost: 3x if not at 0% for 24h, 9x if at 0% for 24h
    const multiplier = company.currentProfitPercent === 0 && company.zeroSince ? 9 : 3;
    const cost = company.maintenanceCost * multiplier;

    const starkEconomy = require('./stark-economy');
    const userBalance = await starkEconomy.getBalance(userId);
    if (userBalance < cost) {
        return { success: false, error: `Not enough! Need ${formatCompact(cost)}, have ${formatCompact(userBalance)}` };
    }

    await starkEconomy.modifyBalance(userId, -cost, 'company_reset_profit');

    const typeData = COMPANY_TYPES[company.type];
    const col = await getCollection();
    await col.updateOne(
        { id: companyId },
        { $set: { currentProfitPercent: 100, zeroSince: null } }
    );

    return { success: true, cost, newProfit: 100 };
}

/**
 * Find a company by flexible ID (full ID, 4-digit code, or display name)
 * For a specific user
 */
async function findCompanyFlexible(userId, partialId) {
    const companies = await getUserCompanies(userId);
    const search = partialId.toLowerCase().trim();

    // Try exact full ID match first
    let found = companies.find(c => c.id.toLowerCase() === search);
    if (found) return found;

    // Try 4-digit ID match (at end of id)
    found = companies.find(c => c.id.endsWith(`_${search}`) || c.id.split('_').pop() === search);
    if (found) return found;

    // Try display name match (partial)
    found = companies.find(c => c.displayName.toLowerCase().includes(search) ||
        (c.customName && c.customName.toLowerCase().includes(search)));
    if (found) return found;

    // Try type match
    found = companies.find(c => c.type.toLowerCase() === search);
    if (found) return found;

    return null;
}

/**
 * Delete a company (with tax penalty - only get 50% value back)
 */
async function deleteCompany(userId, companyIdOrSearch) {
    // Find the company flexibly
    const company = await findCompanyFlexible(userId, companyIdOrSearch);
    if (!company) return { success: false, error: 'Company not found. Use full ID, 4-digit code, or company name.' };
    if (company.ownerId !== userId) return { success: false, error: 'You don\'t own this company' };

    // Calculate refund (50% of original price as penalty)
    const typeData = COMPANY_TYPES[company.type];
    let originalPrice;
    if (company.isCustom) {
        originalPrice = 50000000; // Ultra tier price
    } else if (typeData) {
        originalPrice = typeData.price;
    } else {
        originalPrice = 10000; // Fallback
    }

    const refund = Math.floor(originalPrice * 0.50); // 50% refund (50% penalty)

    // Give refund
    const starkEconomy = require('./stark-economy');
    await starkEconomy.modifyBalance(userId, refund, 'company_delete_refund');

    // Delete company
    const col = await getCollection();
    await col.deleteOne({ id: company.id });

    return {
        success: true,
        deletedCompany: company.displayName,
        companyId: company.id,
        refund,
        penalty: originalPrice - refund
    };
}

/**
 * Calculate progressive tax based on user's balance
 * Higher balance = higher tax rate (rich pay more)
 * Returns additional tax percentage to add
 */
async function calculateBalanceTax(userId) {
    const starkEconomy = require('./stark-economy');
    const balance = await starkEconomy.getBalance(userId);

    // Progressive tax tiers based on balance
    // 0-100K: 0%
    // 100K-1M: +5%
    // 1M-10M: +10%
    // 10M-100M: +15%
    // 100M+: +20%

    if (balance >= 100000000) return 20; // 100M+
    if (balance >= 10000000) return 15;  // 10M+
    if (balance >= 1000000) return 10;   // 1M+
    if (balance >= 100000) return 5;     // 100K+
    return 0;
}

/**
 * Calculate company tax based on total company value
 */
async function calculateCompanyTax(userId) {
    const companies = await getUserCompanies(userId);
    if (companies.length === 0) return 0;

    // Sum up total company value
    let totalValue = 0;
    for (const company of companies) {
        const typeData = COMPANY_TYPES[company.type];
        if (typeData) {
            totalValue += typeData.price;
        } else if (company.isCustom) {
            totalValue += 50000000; // Ultra tier value
        }
    }

    // Find applicable tier
    let tax = 0;
    for (const tier of TAX.COMPANY_TIERS) {
        if (totalValue >= tier.min) {
            tax = tier.rate;
        }
    }
    return tax;
}

/**
 * Hire workers for a company
 * More workers = more profit but higher costs
 */
async function hireWorkers(userId, companyIdOrSearch, count) {
    const company = await findCompanyFlexible(userId, companyIdOrSearch);
    if (!company) return { success: false, error: 'Company not found.' };
    if (company.ownerId !== userId) return { success: false, error: 'You don\'t own this company' };

    const currentWorkers = company.workers || 0;
    const newTotal = currentWorkers + count;

    if (count < 1 || count > 50) {
        return { success: false, error: 'You can hire 1-50 workers at a time' };
    }

    if (newTotal > WORKERS.MAX_PER_COMPANY) {
        return { success: false, error: `Max ${WORKERS.MAX_PER_COMPANY} workers per company. You have ${currentWorkers}.` };
    }

    // Calculate hiring cost (one-time cost)
    const hiringCost = count * WORKERS.COST_PER_WORKER * 10; // 10x per-cycle cost for hiring

    const starkEconomy = require('./stark-economy');
    const balance = await starkEconomy.getBalance(userId);
    if (balance < hiringCost) {
        return { success: false, error: `Need ${formatCompact(hiringCost)} SB to hire ${count} workers` };
    }

    await starkEconomy.modifyBalance(userId, -hiringCost, 'hire_workers');

    const col = await getCollection();
    await col.updateOne(
        { id: company.id },
        { $set: { workers: newTotal, updatedAt: new Date() } }
    );

    const profitBoost = Math.min(newTotal * WORKERS.PROFIT_BOOST_PER_WORKER, WORKERS.MAX_PROFIT_BOOST);

    return {
        success: true,
        hired: count,
        totalWorkers: newTotal,
        cost: hiringCost,
        profitBoost
    };
}

/**
 * Create partnership between two companies
 */
async function createPartnership(userId, myCompanySearch, partnerCompanyId) {
    const myCompany = await findCompanyFlexible(userId, myCompanySearch);
    if (!myCompany) return { success: false, error: 'Your company not found.' };
    if (myCompany.ownerId !== userId) return { success: false, error: 'You don\'t own this company' };

    const partnerCompany = await getCompany(partnerCompanyId);
    if (!partnerCompany) return { success: false, error: 'Partner company not found.' };
    if (partnerCompany.ownerId === userId) return { success: false, error: 'Cannot partner with your own company' };

    // Check if already partnered
    const partnerships = myCompany.partnerships || [];
    if (partnerships.includes(partnerCompanyId)) {
        return { success: false, error: 'Already partnered with this company' };
    }

    // Max 5 partnerships per company
    if (partnerships.length >= 5) {
        return { success: false, error: 'Max 5 partnerships per company' };
    }

    // Partnership cost based on both company values
    const myTypeData = COMPANY_TYPES[myCompany.type];
    const partnerTypeData = COMPANY_TYPES[partnerCompany.type];
    const myValue = myTypeData?.price || 50000000;
    const partnerValue = partnerTypeData?.price || 50000000;
    const partnershipCost = Math.floor((myValue + partnerValue) * 0.05); // 5% of combined value

    const starkEconomy = require('./stark-economy');
    const balance = await starkEconomy.getBalance(userId);
    if (balance < partnershipCost) {
        return { success: false, error: `Need ${formatCompact(partnershipCost)} SB for partnership` };
    }

    await starkEconomy.modifyBalance(userId, -partnershipCost, 'create_partnership');

    // Add partnership to both companies
    const col = await getCollection();
    await col.updateOne(
        { id: myCompany.id },
        { $push: { partnerships: partnerCompanyId }, $set: { updatedAt: new Date() } }
    );
    await col.updateOne(
        { id: partnerCompany.id },
        { $push: { partnerships: myCompany.id }, $set: { updatedAt: new Date() } }
    );

    return {
        success: true,
        myCompany: myCompany.displayName,
        partnerCompany: partnerCompany.displayName,
        partnerOwner: partnerCompany.ownerName,
        cost: partnershipCost,
        profitBoost: 10 // +10% profit boost from partnership
    };
}

/**
 * Update company properties (description, image, display name)
 * Available for all companies, not just custom
 */
async function updateCompany(userId, companyIdOrSearch, updates) {
    // Find the company flexibly
    const company = await findCompanyFlexible(userId, companyIdOrSearch);
    if (!company) return { success: false, error: 'Company not found. Use full ID, 4-digit code, or company name.' };
    if (company.ownerId !== userId) return { success: false, error: 'You don\'t own this company' };

    const updateFields = {};
    const changes = [];

    // Update description (max 500 chars, AI moderated)
    if (updates.description !== undefined) {
        if (updates.description.length > 500) {
            return { success: false, error: 'Description must be under 500 characters' };
        }
        if (updates.description.length > 0) {
            // Moderate description
            const modResult = await moderateName(updates.description);
            if (!modResult.allowed) {
                return { success: false, error: `Description not allowed: ${modResult.reason}` };
            }
        }
        updateFields.description = updates.description;
        changes.push('description');
    }

    // Update image URL (must be valid URL)
    if (updates.imageUrl !== undefined) {
        if (updates.imageUrl && updates.imageUrl.length > 0) {
            // Validate URL format
            try {
                // Just check if it's a valid URL string
                new URL(updates.imageUrl);
            } catch (e) {
                return { success: false, error: 'Invalid image URL format' };
            }
        }
        updateFields.imageUrl = updates.imageUrl || null;
        changes.push('image');
    }

    // Update display name (only for custom companies)
    if (updates.displayName && company.isCustom) {
        if (!updates.displayName || updates.displayName.length < 3 || updates.displayName.length > 30) {
            return { success: false, error: 'Display name must be 3-30 characters' };
        }
        const modResult = await moderateName(updates.displayName);
        if (!modResult.allowed) {
            return { success: false, error: `Name not allowed: ${modResult.reason}` };
        }
        updateFields.displayName = `✨ ${updates.displayName}`;
        updateFields.customName = updates.displayName;
        changes.push('name');
    }

    if (changes.length === 0) {
        return { success: false, error: 'No valid updates provided' };
    }

    updateFields.updatedAt = new Date();

    const col = await getCollection();
    await col.updateOne({ id: company.id }, { $set: updateFields });

    return {
        success: true,
        company: { ...company, ...updateFields },
        companyId: company.id,
        changes,
        updates: updates // Pass original updates for message formatting
    };
}

// ============================================================================
// FORMATTING HELPER
// ============================================================================

function formatCompact(num) {
    if (num >= 1e15) return (num / 1e15).toFixed(1) + 'Q';
    if (num >= 1e12) return (num / 1e12).toFixed(1) + 'T';
    if (num >= 1e9) return (num / 1e9).toFixed(1) + 'B';
    if (num >= 1e6) return (num / 1e6).toFixed(1) + 'M';
    if (num >= 1e3) return (num / 1e3).toFixed(1) + 'K';
    return num.toString();
}

// ============================================================================
// SCHEDULER - Profit payouts, maintenance, risk events
// ============================================================================

let schedulerRunning = false;
let schedulerInterval = null;

/**
 * Process all companies - called every minute
 */
async function processAllCompanies() {
    if (schedulerRunning) return; // Prevent overlapping runs
    schedulerRunning = true;

    try {
        const col = await getCollection();
        const allCompanies = await col.find({}).toArray();
        const now = Date.now();
        const starkEconomy = require('./stark-economy');

        for (const company of allCompanies) {
            try {
                await processCompany(company, now, col, starkEconomy);
            } catch (err) {
                console.error(`[Companies] Error processing ${company.id}:`, err);
            }
        }
    } catch (err) {
        console.error('[Companies] Scheduler error:', err);
    } finally {
        schedulerRunning = false;
    }
}

/**
 * Process a single company
 */
async function processCompany(company, now, col, starkEconomy) {
    const updates = {};
    const typeData = COMPANY_TYPES[company.type];
    if (!typeData) return;

    const lastProfitTime = new Date(company.lastProfit).getTime();
    const lastMaintenanceTime = new Date(company.lastMaintenance).getTime();

    // === PROFIT PAYOUT (every hour) ===
    if (now - lastProfitTime >= TIMING.PROFIT_INTERVAL) {
        const profit = calculateCurrentProfit(company);

        if (profit > 0) {
            await starkEconomy.modifyBalance(company.ownerId, profit, 'company_profit');
        }

        updates.lastProfit = new Date();
        updates.rushUsedThisPeriod = false;
        updates.slowUsedThisPeriod = false;

        // Check for risk events
        const eventResult = await checkRiskEvent(company, typeData);
        if (eventResult) {
            if (!updates.profitEffects) {
                updates.profitEffects = [...(company.profitEffects || [])];
            }
            updates.profitEffects.push(eventResult);
        }
    }

    // === MAINTENANCE (every 6 hours) ===
    if (now - lastMaintenanceTime >= TIMING.MAINTENANCE_INTERVAL) {
        const userBalance = await starkEconomy.getBalance(company.ownerId);

        if (userBalance >= company.maintenanceCost) {
            // Pay maintenance
            await starkEconomy.modifyBalance(company.ownerId, -company.maintenanceCost, 'company_maintenance');
            updates.lastMaintenance = new Date();
        } else {
            // Can't pay - profit decays
            const newProfit = Math.max(0, (company.currentProfitPercent || 100) - TIMING.PROFIT_DECAY_PER_CYCLE);
            updates.currentProfitPercent = newProfit;
            updates.lastMaintenance = new Date();

            // Track when hit 0%
            if (newProfit === 0 && !company.zeroSince) {
                updates.zeroSince = new Date();
            }
        }
    }

    // Clean up expired effects
    if (company.profitEffects && company.profitEffects.length > 0) {
        const activeEffects = company.profitEffects.filter(e => {
            if (e.duration === 0) return true; // Permanent effects
            return new Date(e.expiresAt).getTime() > now;
        });
        if (activeEffects.length !== company.profitEffects.length) {
            updates.profitEffects = activeEffects;
        }
    }

    // Apply updates
    if (Object.keys(updates).length > 0) {
        updates.updatedAt = new Date();
        await col.updateOne({ id: company.id }, { $set: updates });
    }
}

/**
 * Check if a risk event should occur
 * Returns event effect object if event triggers, null otherwise
 */
async function checkRiskEvent(company, typeData) {
    const risk = company.risk;

    // Risk determines event probability:
    // - Risk 0-30: High chance of bad events
    // - Risk 30-50: Some chance of bad events
    // - Risk 50-70: Some chance of good events
    // - Risk 70-100: High chance of good events

    // Base chance of any event is 15%
    if (Math.random() > 0.15) return null;

    // Determine if good or bad based on risk
    const isGoodEvent = Math.random() * 100 < risk;
    const events = isGoodEvent ? typeData.events.good : typeData.events.bad;

    if (!events || events.length === 0) return null;

    // Pick random event
    const event = events[Math.floor(Math.random() * events.length)];

    return {
        name: event.name,
        modifier: event.profitMod,
        duration: event.duration,
        expiresAt: event.duration > 0 ? new Date(Date.now() + event.duration) : new Date(Date.now() + 24 * 60 * 60 * 1000),
        createdAt: new Date()
    };
}

/**
 * Start the company scheduler
 */
function startScheduler() {
    if (schedulerInterval) return;

    console.log('[Companies] Starting scheduler (runs every 60s)');

    // Run every minute
    schedulerInterval = setInterval(processAllCompanies, 60 * 1000);

    // Run once on startup after a delay
    setTimeout(processAllCompanies, 10 * 1000);
}

/**
 * Stop the company scheduler
 */
function stopScheduler() {
    if (schedulerInterval) {
        clearInterval(schedulerInterval);
        schedulerInterval = null;
        console.log('[Companies] Scheduler stopped');
    }
}

// ============================================================================
// CUSTOM COMPANY CREATION (Ultra Tier)
// ============================================================================

// Basic profanity list for quick filter
const BLOCKED_WORDS = [
    'fuck', 'shit', 'ass', 'bitch', 'damn', 'cunt', 'dick', 'cock', 'pussy',
    'nigger', 'faggot', 'retard', 'nazi', 'hitler', 'kill', 'rape', 'porn',
    'sex', 'nude', 'naked', 'terrorist', 'bomb', 'suicide'
];

/**
 * Check if a company name is appropriate using basic filter + AI
 */
async function moderateName(name) {
    const lowerName = name.toLowerCase();

    // Quick basic filter
    for (const word of BLOCKED_WORDS) {
        if (lowerName.includes(word)) {
            return { allowed: false, reason: 'Name contains inappropriate content' };
        }
    }

    // AI moderation as secondary check
    try {
        const aiManager = require('./ai-providers');
        const prompt = `You are a content moderator. Check if this company name is appropriate for a family-friendly Discord bot economy game. Name: "${name}". Respond with ONLY "ALLOWED" or "BLOCKED: [reason]". No other text.`;

        const systemPrompt = 'You are a strict content moderator. Block anything inappropriate, offensive, sexual, violent, or discriminatory.';
        const result = await aiManager.generateResponse(systemPrompt, prompt, 50);

        if (result && result.toUpperCase().startsWith('BLOCKED')) {
            return { allowed: false, reason: result.substring(8).trim() || 'AI flagged as inappropriate' };
        }
    } catch (err) {
        console.warn('[Companies] AI moderation failed, using basic filter only:', err.message);
        // Fall through - basic filter passed
    }

    return { allowed: true };
}

/**
 * Create a custom Ultra-tier company
 */
async function createCustomCompany(userId, username, customName, fourDigitId) {
    // Validate name length
    if (!customName || customName.length < 3 || customName.length > 30) {
        return { success: false, error: 'Company name must be 3-30 characters' };
    }

    // Validate characters (alphanumeric, spaces, some punctuation)
    if (!/^[a-zA-Z0-9\s\-'&.,!]+$/.test(customName)) {
        return { success: false, error: 'Name can only contain letters, numbers, spaces, and basic punctuation' };
    }

    // Validate 4-digit ID
    if (!/^\d{4}$/.test(fourDigitId)) {
        return { success: false, error: 'ID must be exactly 4 digits (0000-9999)' };
    }

    // Check tier limit (only 1 Ultra allowed)
    const ownedUltra = await countUserCompaniesByTier(userId, 'ultra');
    if (ownedUltra >= COMPANY_TIERS.ultra.maxOwned) {
        return { success: false, error: 'You can only own 1 Ultra (custom) company' };
    }

    // Moderate the name
    const moderation = await moderateName(customName);
    if (!moderation.allowed) {
        return { success: false, error: `Name not allowed: ${moderation.reason}` };
    }

    // Generate ID and check if exists
    const sanitizedName = username.toLowerCase().replace(/[^a-z0-9_]/g, '').substring(0, 20);
    const companyId = `${sanitizedName}_custom_${fourDigitId}`;

    const existing = await getCompany(companyId);
    if (existing) {
        return { success: false, error: `You already have a custom company with ID ${fourDigitId}` };
    }

    // Check affordability (50M for Ultra)
    const ULTRA_PRICE = 50000000;
    const ULTRA_MAINTENANCE = 500000;
    const ULTRA_PROFIT = 2000000;

    const starkEconomy = require('./stark-economy');
    const userBalance = await starkEconomy.getBalance(userId);
    if (userBalance < ULTRA_PRICE) {
        return { success: false, error: `Not enough! Need ${formatCompact(ULTRA_PRICE)}, have ${formatCompact(userBalance)}` };
    }

    // Deduct cost
    await starkEconomy.modifyBalance(userId, -ULTRA_PRICE, 'custom_company_purchase');

    // Create company
    const now = new Date();
    const company = {
        id: companyId,
        ownerId: userId,
        ownerName: username,
        type: 'custom',
        tier: 'ultra',
        displayName: `✨ ${customName}`,
        customName: customName,
        isCustom: true,

        // Economics
        baseProfit: ULTRA_PROFIT,
        currentProfitPercent: 100,
        risk: 50,
        lastProfit: now,
        lastMaintenance: now,
        maintenanceCost: ULTRA_MAINTENANCE,

        // State
        sabotageEnabled: false,
        sabotageEnabledAt: null,
        lastRush: null,
        rushUsedThisPeriod: false,
        lastSlow: null,
        slowUsedThisPeriod: false,
        lastClean: null,
        lastSpreadDirt: null,

        // Temporary effects
        profitEffects: [],

        // Custom fields
        logoUrl: null,
        pageContent: null,
        stockPrice: 1000,
        stockHistory: [{ price: 1000, date: now }],

        // Metadata
        createdAt: now,
        updatedAt: now
    };

    const col = await getCollection();
    await col.insertOne(company);

    return {
        success: true,
        company,
        cost: ULTRA_PRICE,
        message: `Created custom company: ${customName} (ID: ${fourDigitId})`
    };
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
    // Constants
    COMPANY_TYPES,
    COMPANY_TIERS,
    TIMING,
    TAX,

    // Core functions
    getUserCompanies,
    getCompany,
    buyCompany,
    createCustomCompany,
    calculateCurrentProfit,
    calculateTaxRate,
    calculateBalanceTax,

    // Actions
    rushCompany,
    slowCompany,
    cleanCompany,
    toggleSabotage,
    spreadDirt,
    resetProfit,
    deleteCompany,
    updateCompany,

    // Workers & Partnerships
    hireWorkers,
    createPartnership,
    calculateCompanyTax,
    WORKERS,

    // Lookup
    lookupByUsername,
    findCompanyFlexible,

    // Helpers
    generateCompanyId,
    parseCompanyId,
    formatCompact,
    moderateName,

    // Scheduler
    startScheduler,
    stopScheduler,
    processAllCompanies
};

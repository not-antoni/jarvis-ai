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
        price: 50000,           // 50K to buy
        maintenance: 250,       // 250 every 6h
        defaultRisk: 45,        // Slightly risky
        defaultProfit: 2500,    // 2.5K per hour
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
        price: 45000,
        maintenance: 200,
        defaultRisk: 50,
        defaultProfit: 2000,
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
        price: 55000,
        maintenance: 300,
        defaultRisk: 48,
        defaultProfit: 2800,
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
        price: 150000,
        maintenance: 1000,
        defaultRisk: 40,        // Higher risk = more volatile
        defaultProfit: 8000,
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
        price: 120000,
        maintenance: 800,
        defaultRisk: 52,
        defaultProfit: 6500,
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
        price: 180000,
        maintenance: 1200,
        defaultRisk: 55,
        defaultProfit: 9000,
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
        price: 500000,
        maintenance: 5000,
        defaultRisk: 45,
        defaultProfit: 25000,
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
        price: 750000,
        maintenance: 8000,
        defaultRisk: 50,
        defaultProfit: 35000,
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
        price: 1000000,
        maintenance: 10000,
        defaultRisk: 48,
        defaultProfit: 45000,
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
        price: 5000000,
        maintenance: 50000,
        defaultRisk: 42,
        defaultProfit: 200000,
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
        price: 10000000,
        maintenance: 100000,
        defaultRisk: 35,        // Very risky
        defaultProfit: 500000,
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
        price: 8000000,
        maintenance: 80000,
        defaultRisk: 50,
        defaultProfit: 350000,
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
    MAINTENANCE_INTERVAL: 6 * 60 * 60 * 1000, // 6 hours
    TAX_INTERVAL: 12 * 60 * 60 * 1000,      // 12 hours
    RUSH_ADVANCE: 30 * 60 * 1000,           // 30 minutes
    SABOTAGE_ENABLE_DELAY: 30 * 60 * 1000,  // 30 minutes to enable
    SABOTAGE_VULNERABILITY_DELAY: 2.5 * 60 * 1000, // 2.5 minutes after enable
    CLEAN_COOLDOWN: 2.5 * 60 * 1000,        // 2.5 minutes
    SPREADDIRT_COOLDOWN: 5 * 60 * 1000,     // 5 minutes
    LOW_PROFIT_THRESHOLD: 5,                // 5% profit = low
    BANKRUPTCY_HOURS: 24,                   // 24 hours at 0% = bankruptcy
    PROFIT_DECAY_PER_CYCLE: 5               // -5% per 6h cycle if can't pay maintenance
};

const TAX = {
    BASE_RATE: 75,
    MIN_RATE: 25
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

    const typeData = COMPANY_TYPES[company.type];
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
    const newRisk = Math.min(100, company.risk + typeData.rushRisk);

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
        riskIncrease: typeData.rushRisk,
        newRisk
    };
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
    calculateCurrentProfit,
    calculateTaxRate,

    // Actions
    rushCompany,
    slowCompany,
    cleanCompany,
    toggleSabotage,
    spreadDirt,
    resetProfit,

    // Lookup
    lookupByUsername,

    // Helpers
    generateCompanyId,
    parseCompanyId,
    formatCompact,

    // Scheduler
    startScheduler,
    stopScheduler,
    processAllCompanies
};

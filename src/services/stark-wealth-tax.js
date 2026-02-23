/**
 * Stark Economy wealth tax scheduler (SB + SBX).
 */

const database = require('./database');
const starkEconomy = require('./stark-economy');
const sbx = require('./starkbucks-exchange');

const TAX_INTERVAL_MS = 2 * 60 * 60 * 1000;
const START_DELAY_MS = 10 * 1000;
const MIN_TAXABLE_WEALTH = 100000;

let schedulerInterval = null;
let schedulerRunning = false;

function toNumber(value, fallback = 0) {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
}

function calculateTaxRate(totalWealth) {
    const balance = toNumber(totalWealth, 0);

    if (balance >= 1000000000000000000) {return 90;} // 1Qi+
    if (balance >= 1000000000000000) {return 75;}    // 1Qa+
    if (balance >= 100000000000000) {return 60;}     // 100T+
    if (balance >= 10000000000000) {return 50;}      // 10T+
    if (balance >= 1000000000000) {return 40;}       // 1T+
    if (balance >= 100000000000) {return 35;}        // 100B+
    if (balance >= 10000000000) {return 30;}         // 10B+
    if (balance >= 1000000000) {return 25;}          // 1B+
    if (balance >= 100000000) {return 20;}           // 100M+
    if (balance >= 10000000) {return 15;}            // 10M+
    if (balance >= 1000000) {return 10;}             // 1M+
    if (balance >= 100000) {return 5;}               // 100K+
    return 0;
}

async function getSbxHoldings(db, userId) {
    const wallet = await db.collection('sbx_wallets').findOne(
        { userId },
        { projection: { balance: 1 } }
    );
    const investment = await db.collection('sbx_investments').findOne(
        { userId },
        { projection: { principal: 1 } }
    );

    return {
        walletBalance: toNumber(wallet?.balance, 0),
        investmentPrincipal: toNumber(investment?.principal, 0)
    };
}

async function applySbxTax(db, userId, sbxTaxAmount, walletBalance, investmentPrincipal) {
    let remaining = sbxTaxAmount;
    let deducted = 0;

    if (remaining <= 0) {return 0;}

    if (walletBalance > 0) {
        const take = Math.min(walletBalance, remaining);
        if (take > 0) {
            const result = await sbx.updateWallet(userId, -take, 'wealth_tax_sbx');
            if (!result || result.success === false) {
                console.warn(
                    `[WealthTax] SBX wallet deduction failed for ${userId}: ${result?.error || 'unknown'}`
                );
                return 0;
            }
            deducted += take;
            remaining -= take;
        }
    }

    if (remaining > 0 && investmentPrincipal > 0) {
        const take = Math.min(investmentPrincipal, remaining);
        if (take > 0) {
            const newPrincipal = Math.max(0, investmentPrincipal - take);
            await db.collection('sbx_investments').updateOne(
                { userId },
                { $set: { principal: newPrincipal, updatedAt: new Date() } }
            );
            deducted += take;
            remaining -= take;
        }
    }

    return deducted;
}

async function applyWealthTaxForUser(db, user) {
    const userId = user?.userId;
    if (!userId) {return;}

    const sbBalance = Math.max(0, toNumber(user.balance, 0));
    const price = Math.max(0, toNumber(sbx.getCurrentPrice?.(), 0));

    const { walletBalance, investmentPrincipal } = await getSbxHoldings(db, userId);
    const sbxHoldings = Math.max(0, walletBalance + investmentPrincipal);
    const sbxValue = price > 0 ? sbxHoldings * 100 * price : 0;
    const totalWealth = sbBalance + sbxValue;

    const rate = calculateTaxRate(totalWealth);

    if (totalWealth < MIN_TAXABLE_WEALTH || rate <= 0) {
        await db.collection('starkEconomy').updateOne(
            { userId },
            { $set: { lastTax: new Date() } }
        );
        return;
    }

    const sbTax = Math.floor(sbBalance * (rate / 100));
    const sbxTaxValue = Math.floor(sbxValue * (rate / 100));

    if (sbTax > 0) {
        await starkEconomy.modifyBalance(userId, -sbTax, 'wealth_tax');
    }

    if (sbxTaxValue > 0 && price > 0 && sbxHoldings > 0) {
        let sbxTaxAmount = Math.floor((sbxTaxValue / (100 * price)) * 100) / 100;
        sbxTaxAmount = Math.min(sbxTaxAmount, sbxHoldings);

        if (sbxTaxAmount > 0) {
            await applySbxTax(db, userId, sbxTaxAmount, walletBalance, investmentPrincipal);
        }
    }

    await db.collection('starkEconomy').updateOne(
        { userId },
        { $set: { lastTax: new Date() } }
    );
}

async function runWealthTax() {
    if (schedulerRunning) {return;}
    schedulerRunning = true;

    try {
        await database.connect();
        if (!database.db) {
            console.warn('[WealthTax] Database unavailable; skipping run.');
            return;
        }

        const now = Date.now();
        const cutoff = new Date(now - TAX_INTERVAL_MS);
        const col = database.db.collection('starkEconomy');

        const cursor = col.find(
            {
                $or: [
                    { lastTax: { $exists: false } },
                    { lastTax: { $lt: cutoff } }
                ]
            },
            {
                projection: { userId: 1, balance: 1, lastTax: 1 }
            }
        );

        for await (const user of cursor) {
            try {
                await applyWealthTaxForUser(database.db, user);
            } catch (error) {
                console.warn(`[WealthTax] Failed for user ${user?.userId || 'unknown'}:`, error);
            }
        }
    } catch (error) {
        console.error('[WealthTax] Run failed:', error);
    } finally {
        schedulerRunning = false;
    }
}

function startScheduler() {
    if (schedulerInterval) {return;}

    console.log('[WealthTax] Scheduler started (every 2 hours)');
    schedulerInterval = setInterval(runWealthTax, TAX_INTERVAL_MS);
    setTimeout(runWealthTax, START_DELAY_MS);
}

function stopScheduler() {
    if (!schedulerInterval) {return;}
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log('[WealthTax] Scheduler stopped');
}

module.exports = {
    startScheduler,
    stopScheduler,
    runWealthTax,
    calculateTaxRate
};

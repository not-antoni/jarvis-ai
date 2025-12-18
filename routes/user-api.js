'use strict';

/**
 * User API Routes
 * Execute commands from the website for authenticated users
 */

const express = require('express');
const router = express.Router();
const userAuth = require('../src/services/user-auth');

// Middleware to require authentication
function requireAuth(req, res, next) {
    const session = userAuth.getSessionFromRequest(req);
    if (!session) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    req.userSession = session;
    next();
}

// Get user's economy data
router.get('/api/user/economy', requireAuth, async (req, res) => {
    try {
        const starkEconomy = require('../src/services/stark-economy');
        const userId = req.userSession.userId;
        
        const [balance, stats] = await Promise.all([
            starkEconomy.getBalance(userId),
            starkEconomy.getUserStats(userId)
        ]);
        
        res.json({
            success: true,
            balance,
            stats
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get user's SBX wallet
router.get('/api/user/sbx', requireAuth, async (req, res) => {
    try {
        const sbx = require('../src/services/starkbucks-exchange');
        const userId = req.userSession.userId;
        
        const [wallet, price] = await Promise.all([
            sbx.getWallet(userId),
            Promise.resolve(sbx.getCurrentPrice())
        ]);
        
        res.json({
            success: true,
            wallet,
            currentPrice: price
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Execute SBX buy (convert Stark Bucks to SBX)
router.post('/api/user/sbx/buy', requireAuth, async (req, res) => {
    try {
        const sbx = require('../src/services/starkbucks-exchange');
        const userId = req.userSession.userId;
        const { amount } = req.body;
        
        if (!amount || amount <= 0) {
            return res.status(400).json({ error: 'Invalid amount' });
        }
        
        const result = await sbx.convertToSBX(userId, amount);
        if (!result.success) {
            return res.status(400).json({ error: result.error || 'Conversion failed' });
        }
        res.json({ success: true, sbxReceived: result.sbxReceived, ...result });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Execute SBX sell (convert SBX to Stark Bucks)
router.post('/api/user/sbx/sell', requireAuth, async (req, res) => {
    try {
        const sbx = require('../src/services/starkbucks-exchange');
        const userId = req.userSession.userId;
        const { amount } = req.body;
        
        if (!amount || amount <= 0) {
            return res.status(400).json({ error: 'Invalid amount' });
        }
        
        const result = await sbx.convertToStarkBucks(userId, amount);
        if (!result.success) {
            return res.status(400).json({ error: result.error || 'Conversion failed' });
        }
        res.json({ success: true, starkBucksReceived: result.starkBucksReceived, ...result });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Execute SBX invest
router.post('/api/user/sbx/invest', requireAuth, async (req, res) => {
    try {
        const sbx = require('../src/services/starkbucks-exchange');
        const userId = req.userSession.userId;
        const { amount } = req.body;
        
        if (!amount || amount <= 0) {
            return res.status(400).json({ error: 'Invalid amount' });
        }
        
        const result = await sbx.investSBX(userId, amount);
        if (!result.success) {
            return res.status(400).json({ error: result.error || 'Investment failed' });
        }
        res.json({ success: true, ...result });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Claim daily reward
router.post('/api/user/daily', requireAuth, async (req, res) => {
    try {
        const starkEconomy = require('../src/services/stark-economy');
        const userId = req.userSession.userId;
        const username = req.userSession.username;
        
        const result = await starkEconomy.claimDaily(userId, username);
        res.json({ success: true, ...result });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Execute work command
router.post('/api/user/work', requireAuth, async (req, res) => {
    try {
        const starkEconomy = require('../src/services/stark-economy');
        const userId = req.userSession.userId;
        const username = req.userSession.username;
        
        const result = await starkEconomy.work(userId, username);
        res.json({ success: true, ...result });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Get store items
router.get('/api/store/items', async (req, res) => {
    try {
        const sbx = require('../src/services/starkbucks-exchange');
        const items = sbx.getStoreItems();
        res.json({ success: true, items });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Purchase store item
router.post('/api/store/purchase', requireAuth, async (req, res) => {
    try {
        const sbx = require('../src/services/starkbucks-exchange');
        const userId = req.userSession.userId;
        const { itemId } = req.body;
        
        if (!itemId) {
            return res.status(400).json({ error: 'Item ID required' });
        }
        
        const result = await sbx.purchaseItem(userId, itemId);
        res.json({ success: true, ...result });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Get user's purchases
router.get('/api/user/purchases', requireAuth, async (req, res) => {
    try {
        const sbx = require('../src/services/starkbucks-exchange');
        const userId = req.userSession.userId;
        
        const purchases = await sbx.getUserPurchases(userId);
        res.json({ success: true, purchases });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get user balance (combined SB + SBX)
router.get('/api/user/balance', requireAuth, async (req, res) => {
    try {
        const starkEconomy = require('../src/services/stark-economy');
        const sbx = require('../src/services/starkbucks-exchange');
        const userId = req.userSession.userId;
        
        const [balance, wallet] = await Promise.all([
            starkEconomy.getBalance(userId),
            sbx.getWallet(userId).catch(() => ({ balance: 0, invested: 0 }))
        ]);
        
        res.json({
            success: true,
            balance: balance || 0,
            sbx: wallet?.balance || 0,
            invested: wallet?.invested || 0
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Claim SBX investment earnings
router.post('/api/user/sbx/claim', requireAuth, async (req, res) => {
    try {
        const sbx = require('../src/services/starkbucks-exchange');
        const userId = req.userSession.userId;
        
        const result = await sbx.claimInvestmentEarnings(userId);
        if (!result.success) {
            return res.status(400).json({ error: result.error || 'Claim failed' });
        }
        res.json({ success: true, earnings: result.earnings, ...result });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Get leaderboard
router.get('/api/leaderboard/:type', async (req, res) => {
    try {
        const starkEconomy = require('../src/services/stark-economy');
        const { type } = req.params;
        const limit = Math.min(parseInt(req.query.limit) || 10, 50);
        const resolve = req.query.resolve === 'true';
        
        let leaderboard;
        switch (type) {
            case 'balance':
                leaderboard = await starkEconomy.getLeaderboard(limit);
                break;
            case 'sbx':
                const sbx = require('../src/services/starkbucks-exchange');
                leaderboard = await sbx.getLeaderboard(limit);
                break;
            default:
                return res.status(400).json({ error: 'Invalid leaderboard type' });
        }
        
        // Resolve Discord user data if requested
        if (resolve && leaderboard?.length && global.discordClient) {
            const client = global.discordClient;
            for (const entry of leaderboard) {
                if (!entry.userId) continue;
                try {
                    const user = await client.users.fetch(entry.userId).catch(() => null);
                    if (user) {
                        entry.username = user.username;
                        entry.displayName = user.globalName || user.username;
                        entry.avatar = user.displayAvatarURL({ size: 64 });
                    }
                } catch {
                    // Keep original data
                }
            }
        }
        
        res.json({ success: true, leaderboard });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;

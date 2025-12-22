/**
 * Starkbucks Routes
 * Web routes for transactions, store, and exchange
 * 
 * Routes:
 * - /transaction/:id - Payment page
 * - /store - Online store
 * - /exchange - SBX exchange/ticker
 * - /api/sbx/* - API endpoints
 */

'use strict';

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const userAuth = require('../src/services/user-auth');

// ============================================================================
// MIDDLEWARE
// ============================================================================

// Parse JSON bodies
router.use(express.json());

// CORS for API routes - restrict to same origin for authenticated endpoints
const ALLOWED_ORIGINS = [
    process.env.PUBLIC_BASE_URL,
    'http://localhost:3000',
    'http://localhost:5173'
].filter(Boolean);

router.use('/api', (req, res, next) => {
    const { origin } = req.headers;
    if (origin && ALLOWED_ORIGINS.includes(origin)) {
        res.header('Access-Control-Allow-Origin', origin);
        res.header('Access-Control-Allow-Credentials', 'true');
    }
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

/**
 * Authentication middleware for SBX API routes
 * Requires valid session - uses userId from session, not from request body
 */
function requireSbxAuth(req, res, next) {
    const session = userAuth.getSessionFromRequest(req);
    if (!session) {
        return res.status(401).json({ error: 'Authentication required. Please login.' });
    }
    req.sbxUserId = session.userId;
    req.userSession = session;
    next();
}

/**
 * Validate amount parameter
 */
function validateAmount(amount) {
    const num = Number(amount);
    if (typeof amount === 'undefined' || amount === null || amount === '') {
        return { valid: false, error: 'Amount is required' };
    }
    if (isNaN(num) || !isFinite(num)) {
        return { valid: false, error: 'Amount must be a valid number' };
    }
    if (num <= 0) {
        return { valid: false, error: 'Amount must be positive' };
    }
    return { valid: true, value: num };
}

// ============================================================================
// LAZY LOAD STARKBUCKS SERVICE
// ============================================================================

let sbxService = null;
function getSBX() {
    if (!sbxService) {
        sbxService = require('../src/services/starkbucks-exchange');
        sbxService.startPriceUpdates();
    }
    return sbxService;
}

// ============================================================================
// TRANSACTION PAGE
// ============================================================================

/**
 * GET /transaction/:id
 * Display payment page for a transaction
 */
router.get('/transaction/:id', async (req, res) => {
    try {
        const sbx = getSBX();
        const transaction = await sbx.getTransaction(req.params.id);
        
        if (!transaction) {
            return res.status(404).send(renderErrorPage('Transaction Not Found', 
                'This transaction does not exist or has expired.'));
        }
        
        if (transaction.status === 'completed') {
            return res.send(renderCompletedPage(transaction));
        }
        
        if (new Date() > new Date(transaction.expiresAt)) {
            return res.status(410).send(renderErrorPage('Transaction Expired',
                'This payment request has expired.'));
        }
        
        res.send(renderTransactionPage(transaction));
    } catch (error) {
        console.error('[Starkbucks] Transaction page error:', error);
        res.status(500).send(renderErrorPage('Error', 'Failed to load transaction.'));
    }
});

/**
 * POST /transaction/:id/pay
 * Complete a payment (API)
 */
router.post('/transaction/:id/pay', requireSbxAuth, async (req, res) => {
    try {
        const sbx = getSBX();
        // Use authenticated userId from session, not from body
        const userId = req.sbxUserId;
        
        const result = await sbx.completePayment(req.params.id, userId);
        res.json(result);
    } catch (error) {
        console.error('[Starkbucks] Payment error:', error);
        res.status(500).json({ error: 'Payment failed' });
    }
});

// ============================================================================
// STORE PAGE
// ============================================================================

/**
 * GET /store
 * Display the online store
 */
router.get('/store', async (req, res) => {
    try {
        const sbx = getSBX();
        const items = sbx.getStoreItems();
        const market = await sbx.getMarketData();
        
        res.send(renderStorePage(items, market));
    } catch (error) {
        console.error('[Starkbucks] Store page error:', error);
        res.status(500).send(renderErrorPage('Error', 'Failed to load store.'));
    }
});

/**
 * GET /store/:category
 * Display store items by category
 */
router.get('/store/:category', async (req, res) => {
    try {
        const sbx = getSBX();
        const items = sbx.getStoreItems(req.params.category);
        const market = await sbx.getMarketData();
        
        res.send(renderStorePage(items, market, req.params.category));
    } catch (error) {
        console.error('[Starkbucks] Store category error:', error);
        res.status(500).send(renderErrorPage('Error', 'Failed to load store.'));
    }
});

// ============================================================================
// EXCHANGE PAGE
// ============================================================================

/**
 * GET /exchange
 * Display the SBX exchange/ticker
 */
router.get('/exchange', async (req, res) => {
    try {
        const sbx = getSBX();
        const market = await sbx.getMarketData();
        
        res.send(renderExchangePage(market));
    } catch (error) {
        console.error('[Starkbucks] Exchange page error:', error);
        res.status(500).send(renderErrorPage('Error', 'Failed to load exchange.'));
    }
});

// ============================================================================
// API ENDPOINTS
// ============================================================================

/**
 * GET /api/sbx/market
 * Get current market data
 */
router.get('/api/sbx/market', async (req, res) => {
    try {
        const sbx = getSBX();
        const market = await sbx.getMarketData();
        res.json(market);
    } catch (error) {
        res.status(500).json({ error: 'Failed to get market data' });
    }
});

/**
 * GET /api/sbx/ticker
 * Get current price ticker (simplified)
 */
router.get('/api/sbx/ticker', async (req, res) => {
    try {
        const sbx = getSBX();
        const market = await sbx.getMarketData();
        res.json({
            price: market.price,
            change24h: market.change24h,
            volume24h: market.volume24h,
            high24h: market.high24h,
            low24h: market.low24h
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get ticker', price: 1.0, change24h: 0 });
    }
});

/**
 * GET /api/sbx/wallet/:userId
 * Get user's SBX wallet
 */
router.get('/api/sbx/wallet/:userId', async (req, res) => {
    try {
        const sbx = getSBX();
        const wallet = await sbx.getWallet(req.params.userId);
        const effects = await sbx.getUserEffects(req.params.userId);
        
        res.json({
            ...wallet,
            activeEffects: effects
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get wallet' });
    }
});

/**
 * POST /api/sbx/transfer
 * Transfer SBX between users
 */
router.post('/api/sbx/transfer', requireSbxAuth, async (req, res) => {
    try {
        const sbx = getSBX();
        // Use authenticated userId as sender - cannot transfer from other wallets
        const from = req.sbxUserId;
        const { to, amount, memo } = req.body;
        
        if (!to) {
            return res.status(400).json({ error: 'Recipient ID required' });
        }
        
        const amountCheck = validateAmount(amount);
        if (!amountCheck.valid) {
            return res.status(400).json({ error: amountCheck.error });
        }
        
        const result = await sbx.transfer(from, to, amountCheck.value, memo);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: 'Transfer failed' });
    }
});

/**
 * POST /api/sbx/payment-request
 * Create a new payment request
 */
router.post('/api/sbx/payment-request', requireSbxAuth, async (req, res) => {
    try {
        const sbx = getSBX();
        // Use authenticated userId as requester
        const requesterId = req.sbxUserId;
        const { amount, memo, recipientId } = req.body;
        
        const amountCheck = validateAmount(amount);
        if (!amountCheck.valid) {
            return res.status(400).json({ error: amountCheck.error });
        }
        
        const result = await sbx.createPaymentRequest(
            requesterId, 
            amountCheck.value, 
            memo, 
            recipientId
        );
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: 'Failed to create payment request' });
    }
});

/**
 * POST /api/sbx/convert/to-sbx
 * Convert Stark Bucks to SBX
 */
router.post('/api/sbx/convert/to-sbx', requireSbxAuth, async (req, res) => {
    try {
        const sbx = getSBX();
        const userId = req.sbxUserId;
        const { amount } = req.body;
        
        const amountCheck = validateAmount(amount);
        if (!amountCheck.valid) {
            return res.status(400).json({ error: amountCheck.error });
        }
        
        const result = await sbx.convertToSBX(userId, amountCheck.value);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: 'Conversion failed' });
    }
});

/**
 * POST /api/sbx/convert/to-starkbucks
 * Convert SBX to Stark Bucks
 */
router.post('/api/sbx/convert/to-starkbucks', requireSbxAuth, async (req, res) => {
    try {
        const sbx = getSBX();
        const userId = req.sbxUserId;
        const { amount } = req.body;
        
        const amountCheck = validateAmount(amount);
        if (!amountCheck.valid) {
            return res.status(400).json({ error: amountCheck.error });
        }
        
        const result = await sbx.convertToStarkBucks(userId, amountCheck.value);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: 'Conversion failed' });
    }
});

/**
 * GET /api/sbx/store/items
 * Get all store items
 */
router.get('/api/sbx/store/items', async (req, res) => {
    try {
        const sbx = getSBX();
        const items = sbx.getStoreItems(req.query.category);
        res.json(items);
    } catch (error) {
        res.status(500).json({ error: 'Failed to get store items' });
    }
});

/**
 * POST /api/sbx/store/purchase
 * Purchase an item from the store
 */
router.post('/api/sbx/store/purchase', requireSbxAuth, async (req, res) => {
    try {
        const sbx = getSBX();
        const userId = req.sbxUserId;
        const { itemId } = req.body;
        
        if (!itemId) {
            return res.status(400).json({ error: 'Item ID required' });
        }
        
        const result = await sbx.purchaseItem(userId, itemId);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: 'Purchase failed' });
    }
});

/**
 * GET /api/sbx/store/purchases/:userId
 * Get user's purchases
 */
router.get('/api/sbx/store/purchases/:userId', async (req, res) => {
    try {
        const sbx = getSBX();
        const purchases = await sbx.getUserPurchases(req.params.userId);
        res.json(purchases);
    } catch (error) {
        res.status(500).json({ error: 'Failed to get purchases' });
    }
});

/**
 * POST /api/sbx/invest
 * Invest SBX
 */
router.post('/api/sbx/invest', requireSbxAuth, async (req, res) => {
    try {
        const sbx = getSBX();
        const userId = req.sbxUserId;
        const { amount } = req.body;
        
        const amountCheck = validateAmount(amount);
        if (!amountCheck.valid) {
            return res.status(400).json({ error: amountCheck.error });
        }
        
        const result = await sbx.investSBX(userId, amountCheck.value);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: 'Investment failed' });
    }
});

/**
 * POST /api/sbx/invest/claim
 * Claim investment earnings
 */
router.post('/api/sbx/invest/claim', requireSbxAuth, async (req, res) => {
    try {
        const sbx = getSBX();
        const userId = req.sbxUserId;
        
        const result = await sbx.claimInvestmentEarnings(userId);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: 'Claim failed' });
    }
});

/**
 * POST /api/sbx/invest/withdraw
 * Withdraw investment
 */
router.post('/api/sbx/invest/withdraw', requireSbxAuth, async (req, res) => {
    try {
        const sbx = getSBX();
        const userId = req.sbxUserId;
        const { amount } = req.body;
        
        const amountCheck = validateAmount(amount);
        if (!amountCheck.valid) {
            return res.status(400).json({ error: amountCheck.error });
        }
        
        const result = await sbx.withdrawInvestment(userId, amountCheck.value);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: 'Withdrawal failed' });
    }
});

// ============================================================================
// NEWS API (Site owner only)
// ============================================================================

/**
 * GET /api/sbx/news
 * Get latest news feed
 */
router.get('/api/sbx/news', async (req, res) => {
    try {
        const sbx = getSBX();
        const limit = Math.min(parseInt(req.query.limit) || 10, 50);
        const news = await sbx.getNews(limit);
        res.json({ success: true, news });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get news' });
    }
});

/**
 * POST /api/sbx/news
 * Add news item (site owner only - uses OAuth or secret key)
 */
router.post('/api/sbx/news', async (req, res) => {
    try {
        const sbx = getSBX();
        const { headline, priceImpact, secretKey, image } = req.body;
        
        if (!headline) {
            return res.status(400).json({ error: 'Headline required' });
        }
        
        // Check OAuth session first
        const session = userAuth.getSessionFromRequest(req);
        const botOwnerId = process.env.BOT_OWNER_ID;
        
        let authorized = false;
        if (session && session.userId === botOwnerId) {
            authorized = true;
        }
        if (!authorized && secretKey) {
            // Fall back to secret key auth
            authorized = secretKey === botOwnerId || secretKey === process.env.SBX_NEWS_SECRET;
        }
        
        if (!authorized) {
            return res.status(403).json({ success: false, error: 'Unauthorized - owner only', debug: { sessionExists: !!session, botOwnerId: botOwnerId ? 'set' : 'not set' } });
        }
        
        const result = await sbx.addNewsItem(headline, priceImpact || 0, secretKey || botOwnerId, image);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: 'Failed to add news' });
    }
});

/**
 * DELETE /api/sbx/news
 * Clear all news (site owner only - requires secret key)
 */
router.delete('/api/sbx/news', async (req, res) => {
    try {
        const sbx = getSBX();
        const { secretKey } = req.body;
        
        const result = await sbx.clearNews(secretKey);
        if (!result.success) {
            return res.status(403).json(result);
        }
        
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: 'Failed to clear news' });
    }
});

/**
 * POST /api/sbx/news/upload
 * Upload image for news (max 1MB, owner only)
 */
// Configure multer for image uploads (max 1MB)
const newsImageStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, '../uploads/news');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueName = Date.now() + '-' + Math.random().toString(36).slice(2, 8) + path.extname(file.originalname);
        cb(null, uniqueName);
    }
});

const newsImageUpload = multer({
    storage: newsImageStorage,
    limits: { fileSize: 1024 * 1024 }, // 1MB max
    fileFilter: (req, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        if (allowed.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Only images allowed (jpg, png, gif, webp)'));
        }
    }
});

router.post('/api/sbx/news/upload', newsImageUpload.single('image'), async (req, res) => {
    try {
        // Check owner auth
        const session = userAuth.getSessionFromRequest(req);
        const botOwnerId = process.env.BOT_OWNER_ID;
        
        if (!session) {
            return res.status(401).json({ error: 'Not authenticated' });
        }
        
        if (session.userId !== botOwnerId) {
            // Delete uploaded file if not authorized
            if (req.file) fs.unlinkSync(req.file.path);
            return res.status(403).json({ error: 'Owner only' });
        }
        
        if (!req.file) {
            return res.status(400).json({ error: 'No image uploaded' });
        }
        
        // Return the URL for the uploaded image
        const imageUrl = '/uploads/news/' + req.file.filename;
        res.json({ success: true, url: imageUrl });
    } catch (error) {
        res.status(500).json({ error: error.message || 'Upload failed' });
    }
});

// ============================================================================
// HTML TEMPLATES
// ============================================================================

const BASE_STYLES = `
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Segoe UI', system-ui, sans-serif;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
            min-height: 100vh;
            color: #e4e4e4;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
        }
        .card {
            background: rgba(255, 255, 255, 0.05);
            border-radius: 16px;
            padding: 24px;
            margin-bottom: 20px;
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.1);
        }
        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 20px 0;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
            margin-bottom: 30px;
        }
        .logo {
            font-size: 28px;
            font-weight: bold;
            background: linear-gradient(90deg, #f39c12, #e74c3c);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        .nav a {
            color: #e4e4e4;
            text-decoration: none;
            margin-left: 20px;
            padding: 8px 16px;
            border-radius: 8px;
            transition: background 0.2s;
        }
        .nav a:hover { background: rgba(255, 255, 255, 0.1); }
        .btn {
            display: inline-block;
            padding: 12px 24px;
            border-radius: 8px;
            font-weight: 600;
            text-decoration: none;
            cursor: pointer;
            border: none;
            font-size: 16px;
            transition: transform 0.2s, box-shadow 0.2s;
        }
        .btn:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.3); }
        .btn-primary {
            background: linear-gradient(90deg, #f39c12, #e74c3c);
            color: white;
        }
        .btn-secondary {
            background: rgba(255, 255, 255, 0.1);
            color: white;
        }
        .price-tag {
            font-size: 32px;
            font-weight: bold;
            color: #f39c12;
        }
        .price-change {
            font-size: 18px;
            margin-left: 10px;
        }
        .price-up { color: #2ecc71; }
        .price-down { color: #e74c3c; }
        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 20px; }
        .item-card {
            background: rgba(255, 255, 255, 0.05);
            border-radius: 12px;
            padding: 20px;
            border: 1px solid rgba(255, 255, 255, 0.1);
            transition: transform 0.2s, border-color 0.2s;
        }
        .item-card:hover {
            transform: translateY(-4px);
            border-color: #f39c12;
        }
        .item-name { font-size: 18px; font-weight: 600; margin-bottom: 8px; }
        .item-desc { color: #aaa; font-size: 14px; margin-bottom: 12px; }
        .item-price { color: #f39c12; font-weight: bold; }
        .category-badge {
            display: inline-block;
            padding: 4px 10px;
            border-radius: 12px;
            font-size: 12px;
            margin-bottom: 10px;
        }
        .category-cosmetic { background: #9b59b6; }
        .category-feature { background: #3498db; }
        .category-economy { background: #2ecc71; }
        .category-exclusive { background: #e74c3c; }
        .category-consumable { background: #f39c12; }
        .ticker {
            display: flex;
            align-items: center;
            gap: 30px;
            padding: 15px;
            background: rgba(0,0,0,0.3);
            border-radius: 8px;
            overflow-x: auto;
        }
        .ticker-item { white-space: nowrap; }
        .ticker-label { color: #888; font-size: 12px; }
        .ticker-value { font-weight: bold; }
        .chart-container { height: 200px; margin: 20px 0; }
        .transaction-amount {
            font-size: 48px;
            font-weight: bold;
            text-align: center;
            margin: 30px 0;
            color: #f39c12;
        }
        .transaction-memo {
            text-align: center;
            color: #aaa;
            margin-bottom: 20px;
        }
        .status-badge {
            display: inline-block;
            padding: 6px 12px;
            border-radius: 20px;
            font-size: 14px;
            font-weight: 600;
        }
        .status-pending { background: #f39c12; color: #000; }
        .status-completed { background: #2ecc71; }
        .status-expired { background: #e74c3c; }
        .event-banner {
            background: linear-gradient(90deg, #f39c12, #e74c3c);
            padding: 12px 20px;
            border-radius: 8px;
            margin-bottom: 20px;
            text-align: center;
            font-weight: 600;
        }
        footer {
            text-align: center;
            padding: 40px 20px;
            color: #666;
            font-size: 14px;
        }
    </style>
`;

function renderHeader() {
    return `
        <nav style="background: rgba(0,0,0,0.3); padding: 10px 20px; margin-bottom: 20px; border-radius: 8px;">
            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
                <a href="/" style="color: #f39c12; text-decoration: none; font-weight: bold; font-size: 18px;">🤖 Jarvis</a>
                <div style="display: flex; gap: 15px; flex-wrap: wrap;">
                    <a href="/sbx" style="color: #e4e4e4; text-decoration: none;">☕ SBX</a>
                    <a href="/store" style="color: #e4e4e4; text-decoration: none;">🛒 Store</a>
                    <a href="/exchange" style="color: #e4e4e4; text-decoration: none;">📊 Exchange</a>
                    <a href="/crypto" style="color: #e4e4e4; text-decoration: none;">💰 Crypto</a>
                    <a href="/leaderboard" style="color: #e4e4e4; text-decoration: none;">🏆 Leaderboard</a>
                    <a href="/commands" style="color: #e4e4e4; text-decoration: none;">📜 Commands</a>
                </div>
            </div>
        </nav>
        <header class="header">
            <div class="logo">⭐ Starkbucks</div>
            <nav class="nav">
                <a href="/exchange">Exchange</a>
                <a href="/store">Store</a>
            </nav>
        </header>
    `;
}

function renderTransactionPage(transaction) {
    const fee = transaction.fee || 0;
    const net = transaction.amount - fee;
    
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Pay ${transaction.amount} SBX - Starkbucks</title>
    ${BASE_STYLES}
</head>
<body>
    <div class="container">
        ${renderHeader()}
        
        <div class="card" style="max-width: 500px; margin: 40px auto; text-align: center;">
            <span class="status-badge status-pending">⏳ Pending Payment</span>
            
            <div class="transaction-amount">
                ${transaction.amount} SBX
            </div>
            
            ${transaction.memo ? `<div class="transaction-memo">"${transaction.memo}"</div>` : ''}
            
            <div style="margin: 20px 0; padding: 15px; background: rgba(0,0,0,0.2); border-radius: 8px;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                    <span>Amount</span>
                    <span>${transaction.amount} SBX</span>
                </div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                    <span>Fee (10%)</span>
                    <span>${fee.toFixed(2)} SBX</span>
                </div>
                <div style="display: flex; justify-content: space-between; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 8px; font-weight: bold;">
                    <span>Recipient Gets</span>
                    <span style="color: #2ecc71;">${net.toFixed(2)} SBX</span>
                </div>
            </div>
            
            <div style="font-size: 12px; color: #888; margin-bottom: 20px;">
                Transaction ID: ${transaction.id}<br>
                Expires: ${new Date(transaction.expiresAt).toLocaleString()}
            </div>
            
            <button class="btn btn-primary" style="width: 100%;" onclick="payNow()">
                Pay ${transaction.amount} SBX
            </button>
            
            <p style="margin-top: 15px; font-size: 12px; color: #666;">
                Connect with Discord to complete payment
            </p>
        </div>
    </div>
    
    <footer>
        Powered by Starkbucks Exchange • Virtual Currency Only
    </footer>
    
    <script>
        function payNow() {
            // TODO: Discord OAuth integration
            alert('Discord login coming soon! Use the bot command for now.');
        }
    </script>
</body>
</html>
    `;
}

function renderCompletedPage(transaction) {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Payment Complete - Starkbucks</title>
    ${BASE_STYLES}
</head>
<body>
    <div class="container">
        ${renderHeader()}
        
        <div class="card" style="max-width: 500px; margin: 40px auto; text-align: center;">
            <span class="status-badge status-completed">✓ Completed</span>
            
            <div style="font-size: 64px; margin: 30px 0;">✅</div>
            
            <h2 style="margin-bottom: 10px;">Payment Successful!</h2>
            <p style="color: #888;">${transaction.amount} SBX has been transferred</p>
            
            <div style="margin: 30px 0; padding: 15px; background: rgba(0,0,0,0.2); border-radius: 8px; text-align: left;">
                <div style="margin-bottom: 8px;">
                    <span style="color: #888;">From:</span> ${transaction.from || 'Unknown'}
                </div>
                <div style="margin-bottom: 8px;">
                    <span style="color: #888;">To:</span> ${transaction.to}
                </div>
                <div>
                    <span style="color: #888;">Completed:</span> ${new Date(transaction.completedAt || Date.now()).toLocaleString()}
                </div>
            </div>
            
            <a href="/exchange" class="btn btn-secondary">Back to Exchange</a>
        </div>
    </div>
    
    <footer>
        Powered by Starkbucks Exchange • Virtual Currency Only
    </footer>
</body>
</html>
    `;
}

function renderStorePage(items, market, category = null) {
    const categories = ['cosmetic', 'feature', 'economy', 'exclusive', 'consumable'];
    
    const itemsHtml = items.map(item => `
        <div class="item-card" data-item-id="${item.id}" data-one-time="${item.oneTime || false}">
            <span class="category-badge category-${item.category}">${item.category}</span>
            <div class="item-name">${item.name}</div>
            <div class="item-desc">${item.description}</div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 15px;">
                <span class="item-price">${item.price} SBX</span>
                <button class="btn btn-primary item-btn" data-item-id="${item.id}" style="padding: 8px 16px;" onclick="buyItem('${item.id}')">
                    Buy
                </button>
            </div>
        </div>
    `).join('');
    
    const categoryTabs = categories.map(cat => `
        <a href="/store/${cat}" class="btn ${category === cat ? 'btn-primary' : 'btn-secondary'}" style="margin-right: 10px; margin-bottom: 10px;">
            ${cat.charAt(0).toUpperCase() + cat.slice(1)}
        </a>
    `).join('');
    
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Store - Starkbucks</title>
    ${BASE_STYLES}
</head>
<body>
    <div class="container">
        ${renderHeader()}
        
        ${market.event ? `<div class="event-banner">${market.event.name} - Price affected!</div>` : ''}
        
        <div class="ticker">
            <div class="ticker-item">
                <div class="ticker-label">SBX Price</div>
                <div class="ticker-value">$${market.price.toFixed(2)}</div>
            </div>
            <div class="ticker-item">
                <div class="ticker-label">24h Change</div>
                <div class="ticker-value ${market.change24h >= 0 ? 'price-up' : 'price-down'}">
                    ${market.change24h >= 0 ? '+' : ''}${market.change24h.toFixed(2)}%
                </div>
            </div>
            <div class="ticker-item">
                <div class="ticker-label">Volume</div>
                <div class="ticker-value">${market.volume24h.toLocaleString()} SBX</div>
            </div>
        </div>
        
        <h1 style="margin: 30px 0 20px;">🛒 Starkbucks Store</h1>
        
        <div style="margin-bottom: 30px;">
            <a href="/store" class="btn ${!category ? 'btn-primary' : 'btn-secondary'}" style="margin-right: 10px; margin-bottom: 10px;">
                All
            </a>
            ${categoryTabs}
        </div>
        
        <div class="grid">
            ${itemsHtml}
        </div>
    </div>
    
    <footer>
        Powered by Starkbucks Exchange • Virtual Currency Only • 10% fee on all transactions
    </footer>
    
    <script>
        let currentUser = null;
        let userPurchases = [];
        
        async function checkAuth() {
            try {
                const res = await fetch('/api/user');
                const data = await res.json();
                if (data.authenticated && data.user) {
                    currentUser = data.user;
                    await loadPurchases();
                }
            } catch (e) {}
        }
        
        async function loadPurchases() {
            if (!currentUser) return;
            try {
                const res = await fetch('/api/sbx/store/purchases/' + (currentUser.id || currentUser.userId));
                const data = await res.json();
                if (Array.isArray(data)) {
                    userPurchases = data.map(p => p.itemId);
                    updateOwnedButtons();
                }
            } catch (e) {
                console.error('Failed to load purchases:', e);
            }
        }
        
        function updateOwnedButtons() {
            document.querySelectorAll('.item-card').forEach(card => {
                const itemId = card.dataset.itemId;
                const isOneTime = card.dataset.oneTime === 'true';
                const btn = card.querySelector('.item-btn');
                
                if (isOneTime && userPurchases.includes(itemId)) {
                    btn.textContent = '✓ Owned';
                    btn.disabled = true;
                    btn.classList.remove('btn-primary');
                    btn.classList.add('btn-secondary');
                    btn.style.opacity = '0.7';
                    btn.style.cursor = 'not-allowed';
                }
            });
        }
        
        async function buyItem(itemId) {
            if (!currentUser) {
                if (confirm('You need to login to purchase items. Login now?')) {
                    window.location.href = '/auth/login?redirect=/store';
                }
                return;
            }
            
            // Check if already owned
            const card = document.querySelector('.item-card[data-item-id="' + itemId + '"]');
            if (card && card.dataset.oneTime === 'true' && userPurchases.includes(itemId)) {
                alert('You already own this item!');
                return;
            }
            
            try {
                const res = await fetch('/api/sbx/store/purchase', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ itemId })
                });
                const data = await res.json();
                if (data.success) {
                    alert('Purchase successful! ' + (data.message || ''));
                    userPurchases.push(itemId);
                    updateOwnedButtons();
                } else {
                    alert('Purchase failed: ' + (data.error || 'Unknown error'));
                }
            } catch (e) {
                alert('Error: ' + e.message);
            }
        }
        
        checkAuth();
    </script>
</body>
</html>
    `;
}

function renderExchangePage(market) {
    const historyPoints = market.priceHistory || [];
    const chartData = historyPoints.map((p, i) => ({ x: i, y: p.price }));
    
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Exchange - Starkbucks</title>
    ${BASE_STYLES}
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
</head>
<body>
    <div class="container">
        ${renderHeader()}
        
        ${market.event ? `<div class="event-banner">${market.event.name}</div>` : ''}
        
        <div class="card">
            <div style="display: flex; align-items: baseline; margin-bottom: 20px;">
                <span class="price-tag">$${market.price.toFixed(2)}</span>
                <span class="price-change ${market.change24h >= 0 ? 'price-up' : 'price-down'}">
                    ${market.change24h >= 0 ? '▲' : '▼'} ${Math.abs(market.change24h).toFixed(2)}%
                </span>
            </div>
            
            <div class="ticker" style="margin-bottom: 20px;">
                <div class="ticker-item">
                    <div class="ticker-label">24h High</div>
                    <div class="ticker-value price-up">$${market.high24h.toFixed(2)}</div>
                </div>
                <div class="ticker-item">
                    <div class="ticker-label">24h Low</div>
                    <div class="ticker-value price-down">$${market.low24h.toFixed(2)}</div>
                </div>
                <div class="ticker-item">
                    <div class="ticker-label">24h Volume</div>
                    <div class="ticker-value">${market.volume24h.toLocaleString()} SBX</div>
                </div>
                <div class="ticker-item">
                    <div class="ticker-label">Active Users</div>
                    <div class="ticker-value">${market.activeUsers}</div>
                </div>
            </div>
            
            <div class="chart-container">
                <canvas id="priceChart"></canvas>
            </div>
        </div>
        
        <div class="grid" style="grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));">
            <div class="card">
                <h3 style="margin-bottom: 15px;">💱 Convert</h3>
                <p style="color: #888; margin-bottom: 15px;">Exchange Stark Bucks ↔ SBX</p>
                <p style="font-size: 14px; margin-bottom: 10px;">
                    Current Rate: <strong>100 Stark Bucks = ${(100 / market.price).toFixed(2)} SBX</strong>
                </p>
                <a href="/sbx" class="btn btn-primary">
                    Trade Now
                </a>
            </div>
            
            <div class="card">
                <h3 style="margin-bottom: 15px;">📈 Invest</h3>
                <p style="color: #888; margin-bottom: 15px;">Stake SBX for 0.5% daily returns</p>
                <p style="font-size: 14px; margin-bottom: 10px;">
                    Earn passive income on your SBX holdings
                </p>
                <a href="/sbx" class="btn btn-primary">
                    Start Investing
                </a>
            </div>
        </div>
        
        <div class="card">
            <h3 style="margin-bottom: 15px;">📊 How SBX Price Works</h3>
            <div class="grid" style="grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));">
                <div>
                    <strong>📈 Activity</strong>
                    <p style="color: #888; font-size: 14px;">More users = higher price</p>
                </div>
                <div>
                    <strong>💹 Volume</strong>
                    <p style="color: #888; font-size: 14px;">More trading = price boost</p>
                </div>
                <div>
                    <strong>🎲 Volatility</strong>
                    <p style="color: #888; font-size: 14px;">Random market fluctuations</p>
                </div>
                <div>
                    <strong>📰 Events</strong>
                    <p style="color: #888; font-size: 14px;">Random events affect price</p>
                </div>
            </div>
        </div>
    </div>
    
    <footer>
        Powered by Starkbucks Exchange • Virtual Currency Only • Not Real Money
    </footer>
    
    <script>
        const ctx = document.getElementById('priceChart').getContext('2d');
        new Chart(ctx, {
            type: 'line',
            data: {
                labels: ${JSON.stringify(historyPoints.map((_, i) => i + 'm ago').reverse())},
                datasets: [{
                    label: 'SBX Price',
                    data: ${JSON.stringify(historyPoints.map(p => p.price))},
                    borderColor: '#f39c12',
                    backgroundColor: 'rgba(243, 156, 18, 0.1)',
                    fill: true,
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: { grid: { color: 'rgba(255,255,255,0.1)' } },
                    x: { grid: { display: false } }
                }
            }
        });
        
        // Auto-refresh price every 30 seconds
        setInterval(async () => {
            try {
                const res = await fetch('/api/sbx/market');
                const data = await res.json();
                document.querySelector('.price-tag').textContent = '$' + data.price.toFixed(2);
            } catch (e) {}
        }, 30000);
    </script>
</body>
</html>
    `;
}

function renderErrorPage(title, message) {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title} - Starkbucks</title>
    ${BASE_STYLES}
</head>
<body>
    <div class="container">
        ${renderHeader()}
        
        <div class="card" style="max-width: 500px; margin: 40px auto; text-align: center;">
            <div style="font-size: 64px; margin-bottom: 20px;">❌</div>
            <h2 style="margin-bottom: 10px;">${title}</h2>
            <p style="color: #888;">${message}</p>
            <a href="/exchange" class="btn btn-primary" style="margin-top: 20px;">Back to Exchange</a>
        </div>
    </div>
</body>
</html>
    `;
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = router;

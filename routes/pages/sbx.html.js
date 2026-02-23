'use strict';

const { SHARED_STYLES, NAV_HTML } = require('./shared-styles');

const SBX_PAGE = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SBX Exchange | Jarvis</title>
    <style>${SHARED_STYLES}
        .price-display {
            text-align: center;
            padding: 3rem;
            background: rgba(0,212,255,0.05);
            border-radius: 16px;
            margin-bottom: 2rem;
        }
        .price-label { color: #888; font-size: 1rem; }
        .price-value {
            font-size: 4rem;
            font-weight: 800;
            background: linear-gradient(90deg, #00d4ff, #00ff88);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        .price-change { font-size: 1.2rem; margin-top: 0.5rem; }
        .price-up { color: #00ff88; }
        .price-down { color: #ff4444; }
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 1rem;
            margin-bottom: 2rem;
        }
        .stat-card {
            background: rgba(255,255,255,0.03);
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 12px;
            padding: 1.5rem;
            text-align: center;
        }
        .stat-value { font-size: 2rem; color: #00d4ff; font-weight: 700; }
        .stat-label { color: #888; font-size: 0.9rem; margin-top: 0.5rem; }
        .trade-card {
            background: rgba(255,255,255,0.03);
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 12px;
            padding: 1.5rem;
        }
        .trade-input {
            width: 100%;
            padding: 0.75rem;
            background: rgba(0,0,0,0.3);
            border: 1px solid rgba(255,255,255,0.2);
            border-radius: 8px;
            color: #fff;
            font-size: 1rem;
            margin-bottom: 1rem;
        }
        .trade-input:focus { outline: none; border-color: #00d4ff; }
        .trade-row { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 2rem; }
        .wallet-info {
            background: rgba(0,212,255,0.1);
            border-radius: 8px;
            padding: 1rem;
            margin-bottom: 1.5rem;
            text-align: center;
        }
        .login-prompt {
            text-align: center;
            padding: 2rem;
            background: rgba(255,255,255,0.03);
            border-radius: 12px;
            margin-bottom: 2rem;
        }
        .message { padding: 1rem; border-radius: 8px; margin-top: 1rem; display: none; }
        .message.success { background: rgba(46,204,113,0.2); color: #2ecc71; display: block; }
        .message.error { background: rgba(231,76,60,0.2); color: #e74c3c; display: block; }
        .chart-container {
            background: rgba(255,255,255,0.03);
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 12px;
            padding: 1.5rem;
            margin-bottom: 2rem;
        }
        .chart-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 1rem;
        }
        .chart-title { font-size: 1.2rem; font-weight: 600; }
        #priceChart {
            width: 100%;
            height: 200px;
            background: rgba(0,0,0,0.2);
            border-radius: 8px;
        }
    </style>
</head>
<body>
    ${NAV_HTML}
    <div class="container">
        <h1>☕ Starkbucks Exchange</h1>
        <p style="color: #888; margin-bottom: 2rem;">Trade SBX - the virtual currency of Jarvis</p>

        <div class="price-display">
            <div class="price-label">Current SBX Price</div>
            <div class="price-value" id="currentPrice">--</div>
            <div class="price-change" id="priceChange">Loading...</div>
        </div>

        <div class="chart-container">
            <div class="chart-header">
                <span class="chart-title">📈 Price History (Last Hour)</span>
                <span id="chartRange" style="color: #888; font-size: 0.9rem;">--</span>
            </div>
            <canvas id="priceChart"></canvas>
        </div>

        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-value" id="yourSbx">--</div>
                <div class="stat-label">Your SBX</div>
            </div>
            <div class="stat-card">
                <div class="stat-value" id="yourBalance">--</div>
                <div class="stat-label">Your Stark Bucks</div>
            </div>
            <div class="stat-card">
                <div class="stat-value" id="invested">--</div>
                <div class="stat-label">Invested SBX</div>
            </div>
        </div>

        <!-- Login prompt (shown when not logged in) -->
        <div id="loginPrompt" class="login-prompt">
            <h2 style="margin-bottom: 1rem;">🔐 Login to Trade</h2>
            <p style="color: #888; margin-bottom: 1.5rem;">Connect your Discord account to buy, sell, and invest SBX</p>
            <a href="/auth/login" class="btn btn-primary">Login with Discord</a>
        </div>

        <!-- Trading UI (shown when logged in) -->
        <div id="tradingUI" style="display: none;">
            <div class="trade-row">
                <div class="trade-card">
                    <h3 style="margin-bottom: 1rem;">💰 Buy SBX</h3>
                    <input type="number" class="trade-input" id="buyAmount" placeholder="Amount of Stark Bucks to spend" min="1" onkeypress="if(event.key==='Enter')buySbx()">
                    <div style="display: flex; gap: 0.5rem; margin-top: 0.5rem;">
                        <button class="btn btn-primary" style="flex: 1;" onclick="buySbx()">Buy SBX</button>
                        <button class="btn btn-secondary" style="width: 120px;" onclick="fillBuyAll()">Use All</button>
                    </div>
                    <div id="buyMessage" class="message"></div>
                </div>
                <div class="trade-card">
                    <h3 style="margin-bottom: 1rem;">💵 Sell SBX</h3>
                    <input type="text" class="trade-input" id="sellAmount" placeholder="Amount of SBX to sell (or 'all')" min="0.01" step="0.01" onkeypress="if(event.key==='Enter')sellSbx()">
                    <button class="btn btn-primary" style="width: 100%;" onclick="sellSbx()">Sell SBX</button>
                    <div id="sellMessage" class="message"></div>
                </div>
            </div>

            <div class="trade-card" style="margin-bottom: 2rem;">
                <h3 style="margin-bottom: 1rem;">📈 Invest SBX</h3>
                <p style="color: #888; margin-bottom: 1rem;">Earn 0.5% daily returns on invested SBX</p>
                <input type="number" class="trade-input" id="investAmount" placeholder="Amount of SBX to invest" min="1" step="0.01">
                <div style="display: flex; gap: 0.5rem; margin-bottom: 1rem;">
                    <button class="btn btn-primary" onclick="investSbx()">Invest</button>
                    <button class="btn btn-primary" onclick="claimEarnings()">Claim Earnings</button>
                    <button class="btn btn-danger" onclick="withdrawAllInvestments()" style="margin-left: auto;">Withdraw All</button>
                </div>
                <div id="investMessage" class="message"></div>
            </div>
        </div>

        <div class="card">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                <h3>📰 Market News</h3>
                <div style="display: flex; gap: 8px; align-items: center;">
                    <button onclick="loadNews(newsPage - 1)" id="newsPrev" style="background: rgba(255,255,255,0.1); border: none; color: #888; padding: 5px 10px; border-radius: 4px; cursor: pointer;" disabled>← Prev</button>
                    <span id="newsPageInfo" style="color: #666; font-size: 12px;">Page 1</span>
                    <button onclick="loadNews(newsPage + 1)" id="newsNext" style="background: rgba(255,255,255,0.1); border: none; color: #888; padding: 5px 10px; border-radius: 4px; cursor: pointer;">Next →</button>
                </div>
            </div>
            <div id="newsFeed" style="max-height: 300px; overflow-y: auto;">
                <p style="color: #666;">Loading news...</p>
            </div>

            <!-- Owner-only news form (hidden, shown via OAuth check) -->
            <div id="newsForm" style="display: none; margin-top: 20px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.1);">
                <h4 style="margin-bottom: 10px;">📝 Add News</h4>
                <input type="text" id="newsHeadline" placeholder="BREAKING: Tony Stark did something amazing..."
                    style="width: 100%; padding: 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.2); background: rgba(0,0,0,0.3); color: #fff; margin-bottom: 10px;">
                <div style="display: flex; gap: 10px; margin-bottom: 10px; align-items: center;">
                    <input type="file" id="newsImageFile" accept="image/*" style="flex: 1; color: #888;">
                    <span style="color: #666; font-size: 12px;">Max 1MB</span>
                </div>
                <input type="text" id="newsImage" placeholder="Or paste image URL..."
                    style="width: 100%; padding: 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.2); background: rgba(0,0,0,0.3); color: #fff; margin-bottom: 10px;">
                <div id="imagePreview" style="display: none; margin-bottom: 10px;">
                    <img id="previewImg" style="max-width: 200px; max-height: 100px; border-radius: 8px;">
                </div>
                <div style="display: flex; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; align-items: center;">
                    <label style="color: #888;">Price Impact:</label>
                    <input type="range" id="newsPriceImpact" min="-10" max="10" value="0" step="0.5"
                        style="flex: 1; min-width: 100px;" oninput="updatePriceLabel()">
                    <span id="priceImpactLabel" style="min-width: 60px; color: #f39c12; font-weight: bold;">0%</span>
                </div>
                <button onclick="postNews()" class="btn btn-primary">Post News</button>
                <span id="newsStatus" style="margin-left: 10px; color: #888;"></span>
            </div>
        </div>

        <div class="card">
            <h2>How It Works</h2>
            <p style="color: #aaa; line-height: 1.8;">
                • <strong>Buy SBX</strong> - Exchange your Stark Bucks for SBX<br>
                • <strong>Sell SBX</strong> - Convert SBX back to Stark Bucks<br>
                • <strong>Invest</strong> - Lock your SBX to earn 0.5% daily returns<br>
                • <strong>Store</strong> - Spend SBX on exclusive items and upgrades
            </p>
        </div>

        <div style="text-align: center; margin-top: 2rem;">
            <a href="/store" class="btn btn-primary">🛒 Visit Store</a>
            <a href="/leaderboard" class="btn btn-primary" style="margin-left: 1rem;">🏆 Leaderboard</a>
        </div>
    </div>

    <script>
        let currentUser = null;

        async function checkAuth() {
            try {
                const res = await fetch('/api/user', { credentials: 'include' });
                const data = await res.json();
                console.log('[SBX Auth]', data); // Debug
                if (data.authenticated && data.user) {
                    currentUser = data.user;
                    document.getElementById('loginPrompt').style.display = 'none';
                    document.getElementById('tradingUI').style.display = 'block';
                    loadUserBalance();
                } else {
                    console.log('[SBX Auth] Not authenticated, response:', data);
                }
            } catch (e) {
                console.error('[SBX Auth] Error:', e);
            }
        }

        // Format large numbers with K/M/B/T
        function formatNumber(num) {
            if (num === null || num === undefined) return '0';
            num = parseFloat(num);
            if (isNaN(num)) return '0';
            if (num >= 1e15) return (num / 1e15).toFixed(2) + 'Q';
            if (num >= 1e12) return (num / 1e12).toFixed(2) + 'T';
            if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
            if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
            if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
            return num.toLocaleString();
        }

        // Parse formatted numbers like "64M" back to raw numbers
        function parseFormattedNumber(str) {
            if (!str) return NaN;
            str = String(str).trim().toUpperCase();
            // Handle "all" keyword
            if (str === 'ALL') return 'ALL';
            // Remove commas and spaces
            str = str.replace(/,/g, '').replace(/\\s/g, '');
            // Check for suffix
            const suffixes = { 'K': 1e3, 'M': 1e6, 'B': 1e9, 'T': 1e12, 'Q': 1e15 };
            const lastChar = str.slice(-1);
            if (suffixes[lastChar]) {
                const num = parseFloat(str.slice(0, -1));
                return isNaN(num) ? NaN : num * suffixes[lastChar];
            }
            return parseFloat(str);
        }

        async function loadUserBalance() {
            if (!currentUser) return;
            try {
                const res = await fetch('/api/user/balance', { credentials: 'include' });
                const data = await res.json();
                if (data.success) {
                    document.getElementById('yourBalance').textContent = formatNumber(data.balance) + ' SB';
                    document.getElementById('yourSbx').textContent = formatNumber(data.sbx);
                    document.getElementById('invested').textContent = formatNumber(data.invested);
                }
            } catch (e) {
                console.error('Failed to load balance:', e);
            }
        }

        async function loadSbxData() {
            try {
                const res = await fetch('/api/sbx/ticker');
                const data = await res.json();
                if (data.price) {
                    document.getElementById('currentPrice').textContent = data.price.toFixed(2) + ' SB';
                    const changeClass = data.change24h >= 0 ? 'price-up' : 'price-down';
                    const arrow = data.change24h >= 0 ? '↑' : '↓';
                    document.getElementById('priceChange').innerHTML = '<span class="' + changeClass + '">' + arrow + ' ' + Math.abs(data.change24h || 0).toFixed(2) + '%</span>';
                }
            } catch (e) {
                document.getElementById('currentPrice').textContent = '1.00 SB';
                document.getElementById('priceChange').innerHTML = '<span class="price-up">↑ 0.00%</span>';
            }
        }

        function showMessage(elementId, message, isError) {
            const el = document.getElementById(elementId);
            el.textContent = message;
            el.className = 'message ' + (isError ? 'error' : 'success');
            setTimeout(() => { el.className = 'message'; }, 5000);
        }

        async function buySbx() {
            const input = document.getElementById('buyAmount').value;
            const amount = parseFormattedNumber(input);
            if (isNaN(amount) || amount < 1) {
                showMessage('buyMessage', 'Enter a valid amount (e.g. 100, 5K, 1M)', true);
                return;
            }
            try {
                const res = await fetch('/api/user/sbx/buy', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ amount })
                });
                const data = await res.json();
                if (data.success) {
                    showMessage('buyMessage', 'Bought ' + formatNumber(data.sbxReceived) + ' SBX!', false);
                    loadUserBalance();
                } else {
                    showMessage('buyMessage', data.error || 'Purchase failed', true);
                }
            } catch (e) {
                showMessage('buyMessage', 'Error: ' + e.message, true);
            }
        }

        function fillBuyAll() {
            const balanceText = document.getElementById('yourBalance').textContent || '';
            const numeric = balanceText.replace(' SB', '').replace(/,/g, '');
            const balance = parseFloat(numeric);
            if (!isNaN(balance) && balance > 0) {
                document.getElementById('buyAmount').value = balance;
            }
        }

        async function sellSbx() {
            const input = document.getElementById('sellAmount').value.trim();
            let amount = parseFormattedNumber(input);

            if (amount === 'ALL') {
                // Fetch actual balance from server for accuracy
                try {
                    const balRes = await fetch('/api/user/balance', { credentials: 'include' });
                    const balData = await balRes.json();
                    amount = balData.sbx || 0;
                } catch (e) {
                    showMessage('sellMessage', 'Failed to get balance', true);
                    return;
                }
            }

            if (isNaN(amount) || amount < 0.01) {
                showMessage('sellMessage', 'Enter a valid amount (e.g. 100, 5K, 1M, all)', true);
                return;
            }

            // Clear the input field after getting the amount
            document.getElementById('sellAmount').value = '';

            try {
                const res = await fetch('/api/user/sbx/sell', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ amount })
                });
                const data = await res.json();
                if (data.success) {
                    showMessage('sellMessage', 'Sold for ' + formatNumber(data.starkBucksReceived) + ' SB!', false);
                    loadUserBalance();
                } else {
                    showMessage('sellMessage', data.error || 'Sale failed', true);
                }
            } catch (e) {
                showMessage('sellMessage', 'Error: ' + e.message, true);
            }
        }

        async function investSbx() {
            const input = document.getElementById('investAmount').value.trim();
            let amount = parseFormattedNumber(input);

            if (amount === 'ALL') {
                try {
                    const balRes = await fetch('/api/user/balance', { credentials: 'include' });
                    const balData = await balRes.json();
                    amount = balData.sbx || 0;
                } catch (e) {
                    showMessage('investMessage', 'Failed to get balance', true);
                    return;
                }
            }

            if (isNaN(amount) || amount < 1) {
                showMessage('investMessage', 'Enter a valid amount (e.g. 100, 5K, 1M, all)', true);
                return;
            }
            try {
                const res = await fetch('/api/user/sbx/invest', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ amount })
                });
                const data = await res.json();
                if (data.success) {
                    showMessage('investMessage', 'Invested ' + formatNumber(amount) + ' SBX!', false);
                    loadUserBalance();
                } else {
                    showMessage('investMessage', data.error || 'Investment failed', true);
                }
            } catch (e) {
                showMessage('investMessage', 'Error: ' + e.message, true);
            }
        }

        async function claimEarnings() {
            try {
                const res = await fetch('/api/user/sbx/claim', { method: 'POST', credentials: 'include' });
                const data = await res.json();
                if (data.success) {
                    showMessage('investMessage', 'Claimed ' + formatNumber(data.earnings || 0) + ' SBX!', false);
                    loadUserBalance();
                } else {
                    showMessage('investMessage', data.error || 'Nothing to claim', true);
                }
            } catch (e) {
                showMessage('investMessage', 'Error: ' + e.message, true);
            }
        }

        async function withdrawAllInvestments() {
            if (!confirm('Are you sure you want to withdraw ALL investments? This will return all invested SBX plus any earnings to your wallet.')) {
                return;
            }
            try {
                const res = await fetch('/api/user/sbx/withdraw', { method: 'POST', credentials: 'include' });
                const data = await res.json();
                if (data.success) {
                    showMessage('investMessage', 'Withdrew ' + formatNumber(data.total || 0) + ' SBX!', false);
                    loadUserBalance();
                } else {
                    showMessage('investMessage', data.error || 'Withdrawal failed', true);
                }
            } catch (e) {
                showMessage('investMessage', 'Error: ' + e.message, true);
            }
        }

        async function loadPriceChart() {
            try {
                const res = await fetch('/api/sbx/market');
                const data = await res.json();
                const history = data.priceHistory || [];

                const canvas = document.getElementById('priceChart');
                const ctx = canvas.getContext('2d');
                const rect = canvas.parentElement.getBoundingClientRect();
                canvas.width = rect.width - 48;
                canvas.height = 200;

                // Clear canvas with dark background
                ctx.fillStyle = 'rgba(0,0,0,0.3)';
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                if (history.length < 2) {
                    ctx.fillStyle = 'rgba(255,255,255,0.5)';
                    ctx.font = '14px Arial';
                    ctx.textAlign = 'center';
                    ctx.fillText('Price history will appear here', canvas.width / 2, canvas.height / 2);
                    document.getElementById('chartRange').textContent = 'No data yet';
                    return;
                }

                // Sample data to reduce noise
                const sampleRate = Math.max(1, Math.floor(history.length / 80));
                const sampled = history.filter((_, i) => i % sampleRate === 0);
                const prices = sampled.map(p => p.price);

                const minPrice = Math.min(...prices);
                const maxPrice = Math.max(...prices);
                const padding = (maxPrice - minPrice) * 0.15 || 0.01;
                const chartMin = minPrice - padding;
                const chartMax = maxPrice + padding;
                const range = chartMax - chartMin || 1;

                document.getElementById('chartRange').textContent =
                    'Low: ' + minPrice.toFixed(2) + ' | High: ' + maxPrice.toFixed(2);

                // Draw grid lines
                ctx.strokeStyle = 'rgba(255,255,255,0.06)';
                ctx.lineWidth = 1;
                for (let i = 0; i <= 4; i++) {
                    const y = (canvas.height / 4) * i;
                    ctx.beginPath();
                    ctx.moveTo(0, y);
                    ctx.lineTo(canvas.width, y);
                    ctx.stroke();
                }

                // Calculate points with padding from edges
                const padX = 5;
                const padY = 15;
                const chartH = canvas.height - padY * 2;
                const chartW = canvas.width - padX * 2;

                const points = prices.map((price, i) => ({
                    x: padX + (i / (prices.length - 1)) * chartW,
                    y: padY + chartH - ((price - chartMin) / range) * chartH,
                    price: price
                }));

                // Draw multi-colored line segments (red for down, green for up)
                ctx.lineWidth = 2.5;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';

                for (let i = 1; i < points.length; i++) {
                    const prev = points[i - 1];
                    const curr = points[i];
                    const isUp = curr.price >= prev.price;

                    // Create gradient for smooth color transition
                    const grad = ctx.createLinearGradient(prev.x, prev.y, curr.x, curr.y);

                    // Look ahead and behind for smoother transitions
                    const prevUp = i > 1 ? points[i-1].price >= points[i-2].price : isUp;
                    const nextUp = i < points.length - 1 ? points[i+1].price >= curr.price : isUp;

                    const startColor = prevUp ? '#00ff88' : '#ff4444';
                    const endColor = isUp ? '#00ff88' : '#ff4444';

                    grad.addColorStop(0, startColor);
                    grad.addColorStop(1, endColor);

                    ctx.beginPath();
                    ctx.strokeStyle = grad;

                    // Use bezier for smoothness
                    if (i === 1) {
                        ctx.moveTo(prev.x, prev.y);
                        ctx.lineTo(curr.x, curr.y);
                    } else {
                        const prevPrev = points[i - 2];
                        const cpX = prev.x;
                        const cpY = prev.y;
                        ctx.moveTo(prev.x, prev.y);
                        ctx.lineTo(curr.x, curr.y);
                    }
                    ctx.stroke();
                }

                // Draw subtle glow effect
                ctx.globalAlpha = 0.3;
                ctx.lineWidth = 6;
                ctx.filter = 'blur(4px)';
                for (let i = 1; i < points.length; i++) {
                    const prev = points[i - 1];
                    const curr = points[i];
                    const isUp = curr.price >= prev.price;
                    ctx.beginPath();
                    ctx.strokeStyle = isUp ? '#00ff88' : '#ff4444';
                    ctx.moveTo(prev.x, prev.y);
                    ctx.lineTo(curr.x, curr.y);
                    ctx.stroke();
                }
                ctx.filter = 'none';
                ctx.globalAlpha = 1;

                // Draw current price dot
                const lastPoint = points[points.length - 1];
                const lastUp = prices[prices.length - 1] >= prices[prices.length - 2];
                ctx.beginPath();
                ctx.arc(lastPoint.x, lastPoint.y, 4, 0, Math.PI * 2);
                ctx.fillStyle = lastUp ? '#00ff88' : '#ff4444';
                ctx.fill();
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 1.5;
                ctx.stroke();

            } catch (e) {
                console.error('Chart error:', e);
            }
        }

        // News pagination
        let newsPage = 1;
        const newsPerPage = 5;
        let totalNews = 0;

        // Load news feed with pagination
        async function loadNews(page = 1) {
            if (page < 1) return;
            newsPage = page;

            try {
                const res = await fetch('/api/sbx/news?limit=50'); // Fetch all, paginate client-side
                const data = await res.json();
                const feed = document.getElementById('newsFeed');

                if (!data.news || data.news.length === 0) {
                    feed.innerHTML = '<p style="color: #666; font-style: italic;">No news yet. The market is quiet...</p>';
                    document.getElementById('newsPageInfo').textContent = 'No news';
                    document.getElementById('newsPrev').disabled = true;
                    document.getElementById('newsNext').disabled = true;
                    return;
                }

                totalNews = data.news.length;
                const totalPages = Math.ceil(totalNews / newsPerPage);
                if (page > totalPages) { newsPage = totalPages; page = totalPages; }

                const start = (page - 1) * newsPerPage;
                const pageNews = data.news.slice(start, start + newsPerPage);

                feed.innerHTML = pageNews.map(n => {
                    const time = new Date(n.timestamp).toLocaleString();
                    const impact = n.priceImpact > 0 ? '📈' : n.priceImpact < 0 ? '📉' : '';
                    const impactText = n.priceImpact ? ' (' + (n.priceImpact > 0 ? '+' : '') + n.priceImpact + '%)' : '';
                    let html = '<div style="padding: 10px; border-bottom: 1px solid rgba(255,255,255,0.05);">';
                    if (n.image) {
                        html += '<img src="' + n.image + '" style="max-width: 100%; max-height: 150px; border-radius: 8px; margin-bottom: 8px;" onerror="this.style.display=&quot;none&quot;">';
                    }
                    html += '<p style="margin: 0;">' + impact + ' ' + n.headline + '<span style="color: #f39c12; font-size: 12px;">' + impactText + '</span></p>';
                    html += '<small style="color: #666;">' + time + '</small></div>';
                    return html;
                }).join('');

                // Update pagination controls
                document.getElementById('newsPageInfo').textContent = 'Page ' + page + ' of ' + totalPages;
                document.getElementById('newsPrev').disabled = page <= 1;
                document.getElementById('newsNext').disabled = page >= totalPages;
            } catch (e) {
                document.getElementById('newsFeed').innerHTML = '<p style="color: #888;">Failed to load news</p>';
            }
        }

        function updatePriceLabel() {
            const val = parseFloat(document.getElementById('newsPriceImpact').value);
            const label = document.getElementById('priceImpactLabel');
            const prefix = val > 0 ? '+' : '';
            label.textContent = prefix + val + '%';
            label.style.color = val > 0 ? '#2ecc71' : val < 0 ? '#e74c3c' : '#f39c12';
        }

        // Handle image file selection and preview
        document.getElementById('newsImageFile').addEventListener('change', function(e) {
            const file = e.target.files[0];
            if (file) {
                if (file.size > 1024 * 1024) {
                    alert('Image too large! Max 1MB');
                    e.target.value = '';
                    return;
                }
                const reader = new FileReader();
                reader.onload = function(e) {
                    document.getElementById('previewImg').src = e.target.result;
                    document.getElementById('imagePreview').style.display = 'block';
                };
                reader.readAsDataURL(file);
            }
        });

        // Post news (owner only - uses OAuth session)
        async function postNews() {
            const headline = document.getElementById('newsHeadline').value.trim();
            const priceImpact = parseFloat(document.getElementById('newsPriceImpact').value) / 100;
            const imageUrl = document.getElementById('newsImage').value.trim();
            const imageFile = document.getElementById('newsImageFile').files[0];
            const status = document.getElementById('newsStatus');

            if (!headline) {
                status.textContent = '❌ Enter a headline';
                status.style.color = '#e74c3c';
                return;
            }

            let finalImageUrl = imageUrl;

            // Upload image file if selected
            if (imageFile) {
                status.textContent = '⏳ Uploading image...';
                status.style.color = '#f39c12';

                const formData = new FormData();
                formData.append('image', imageFile);

                try {
                    const uploadRes = await fetch('/api/sbx/news/upload', {
                        method: 'POST',
                        credentials: 'include',
                        body: formData
                    });
                    const uploadData = await uploadRes.json();
                    if (uploadData.success) {
                        finalImageUrl = uploadData.url;
                    } else {
                        status.textContent = '❌ Upload failed: ' + (uploadData.error || 'Unknown');
                        status.style.color = '#e74c3c';
                        return;
                    }
                } catch (e) {
                    status.textContent = '❌ Upload error: ' + e.message;
                    status.style.color = '#e74c3c';
                    return;
                }
            }

            try {
                const res = await fetch('/api/sbx/news', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ headline, priceImpact, image: finalImageUrl })
                });
                const data = await res.json();

                if (data.success) {
                    status.textContent = '✅ News posted!';
                    status.style.color = '#2ecc71';
                    document.getElementById('newsHeadline').value = '';
                    document.getElementById('newsImage').value = '';
                    document.getElementById('newsImageFile').value = '';
                    document.getElementById('imagePreview').style.display = 'none';
                    document.getElementById('newsPriceImpact').value = 0;
                    updatePriceLabel();
                    loadNews();
                    loadSbxData();
                } else {
                    status.textContent = '❌ ' + (data.error || 'Failed');
                    status.style.color = '#e74c3c';
                }
            } catch (e) {
                status.textContent = '❌ Error: ' + e.message;
                status.style.color = '#e74c3c';
            }
        }

        // Check if user is bot owner and show news form
        async function checkOwnerStatus() {
            try {
                const res = await fetch('/api/user', { credentials: 'include' });
                const data = await res.json();
                if (data.authenticated && data.user && data.user.isOwner) {
                    document.getElementById('newsForm').style.display = 'block';
                }
            } catch (e) {}
        }

        checkAuth();
        checkOwnerStatus();
        loadSbxData();
        loadPriceChart();
        loadNews();
        setInterval(loadSbxData, 20000);
        setInterval(loadPriceChart, 20000);
    </script>
</body>
</html>
`;

module.exports = SBX_PAGE;

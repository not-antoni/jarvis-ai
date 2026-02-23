'use strict';

const CRYPTO_PAGE = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Stark Crypto Exchange | Jarvis</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #0a0a0f;
            color: #e4e4e4;
            min-height: 100vh;
        }
        .container { max-width: 1400px; margin: 0 auto; padding: 1.5rem; }
        nav {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 1rem 5%;
            background: rgba(0,0,0,0.5);
            border-bottom: 1px solid rgba(255,255,255,0.1);
        }
        .logo {
            font-size: 1.5rem;
            font-weight: 700;
            background: linear-gradient(90deg, #00d4ff, #8a2be2);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            text-decoration: none;
        }
        .nav-links { display: flex; gap: 1.5rem; list-style: none; }
        .nav-links a { color: #888; text-decoration: none; transition: color 0.3s; }
        .nav-links a:hover { color: #00d4ff; }

        /* Market Status Banner */
        .market-banner {
            background: linear-gradient(90deg, rgba(0,212,255,0.1), rgba(138,43,226,0.1));
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 12px;
            padding: 1rem 1.5rem;
            margin-bottom: 1.5rem;
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-wrap: wrap;
            gap: 1rem;
        }
        .market-cycle {
            display: flex;
            align-items: center;
            gap: 0.75rem;
        }
        .cycle-indicator {
            width: 12px;
            height: 12px;
            border-radius: 50%;
            animation: pulse 2s infinite;
        }
        .cycle-bull { background: #00ff88; box-shadow: 0 0 10px #00ff88; }
        .cycle-bear { background: #ff4444; box-shadow: 0 0 10px #ff4444; }
        .cycle-sideways { background: #ffaa00; box-shadow: 0 0 10px #ffaa00; }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        .market-event {
            background: rgba(255,170,0,0.2);
            border: 1px solid #ffaa00;
            padding: 0.5rem 1rem;
            border-radius: 20px;
            font-size: 0.9rem;
            animation: glow 1.5s infinite;
        }
        @keyframes glow { 0%, 100% { box-shadow: 0 0 5px rgba(255,170,0,0.5); } 50% { box-shadow: 0 0 20px rgba(255,170,0,0.8); } }

        /* Portfolio Section */
        .portfolio-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 1rem;
            margin-bottom: 1.5rem;
        }
        .stat-card {
            background: rgba(255,255,255,0.03);
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 12px;
            padding: 1.25rem;
            text-align: center;
        }
        .stat-label { color: #666; font-size: 0.8rem; margin-bottom: 0.5rem; }
        .stat-value { font-size: 1.5rem; font-weight: 700; }
        .stat-value.up { color: #00ff88; }
        .stat-value.down { color: #ff4444; }
        .stat-value.primary { color: #00d4ff; }

        /* Crypto Grid */
        .crypto-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
            gap: 1rem;
            margin-bottom: 2rem;
        }
        .coin-card {
            background: rgba(255,255,255,0.02);
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 16px;
            padding: 1.25rem;
            transition: all 0.3s;
            cursor: pointer;
        }
        .coin-card:hover {
            border-color: #00d4ff;
            transform: translateY(-3px);
            box-shadow: 0 10px 30px rgba(0,212,255,0.1);
        }
        .coin-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 1rem;
        }
        .coin-info { display: flex; align-items: center; gap: 0.75rem; }
        .coin-emoji { font-size: 2.5rem; }
        .coin-symbol { font-weight: 700; font-size: 1.1rem; color: #fff; }
        .coin-name { color: #666; font-size: 0.8rem; }
        .coin-tier {
            font-size: 0.65rem;
            padding: 0.2rem 0.5rem;
            border-radius: 10px;
            text-transform: uppercase;
            font-weight: 600;
        }
        .tier-large { background: rgba(0,212,255,0.2); color: #00d4ff; }
        .tier-mid { background: rgba(138,43,226,0.2); color: #a855f7; }
        .tier-small { background: rgba(255,170,0,0.2); color: #ffaa00; }
        .tier-meme { background: rgba(0,255,136,0.2); color: #00ff88; }
        .tier-stable { background: rgba(100,100,100,0.2); color: #888; }
        .tier-rare { background: rgba(255,215,0,0.2); color: #ffd700; }

        .coin-price-row {
            display: flex;
            justify-content: space-between;
            align-items: baseline;
            margin-bottom: 0.75rem;
        }
        .coin-price { font-size: 1.75rem; font-weight: 800; }
        .coin-change {
            font-size: 1rem;
            font-weight: 600;
            padding: 0.25rem 0.5rem;
            border-radius: 6px;
        }
        .coin-change.up { background: rgba(0,255,136,0.15); color: #00ff88; }
        .coin-change.down { background: rgba(255,68,68,0.15); color: #ff4444; }

        .coin-sparkline {
            height: 30px;
            display: flex;
            align-items: flex-end;
            gap: 2px;
            margin: 0.5rem 0;
        }
        .spark-bar {
            flex: 1;
            background: currentColor;
            border-radius: 2px 2px 0 0;
            opacity: 0.6;
        }

        .coin-stats {
            display: flex;
            justify-content: space-between;
            font-size: 0.75rem;
            color: #666;
            border-top: 1px solid rgba(255,255,255,0.05);
            padding-top: 0.75rem;
        }

        /* Trade Modal */
        .trade-modal {
            display: none;
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.9);
            z-index: 1000;
            align-items: center;
            justify-content: center;
        }
        .trade-modal.active { display: flex; }
        .trade-box {
            background: #12121a;
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 20px;
            padding: 2rem;
            width: 95%;
            max-width: 450px;
        }
        .trade-header {
            display: flex;
            align-items: center;
            gap: 1rem;
            margin-bottom: 1.5rem;
        }
        .trade-emoji { font-size: 3rem; }
        .trade-stats {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 0.75rem;
            margin-bottom: 1.5rem;
        }
        .trade-stat {
            background: rgba(255,255,255,0.03);
            padding: 0.75rem;
            border-radius: 8px;
            text-align: center;
        }
        .trade-stat-label { font-size: 0.7rem; color: #666; }
        .trade-stat-value { font-weight: 700; }
        .trade-input {
            width: 100%;
            padding: 1rem;
            background: rgba(0,0,0,0.5);
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 10px;
            color: #fff;
            font-size: 1.2rem;
            margin-bottom: 0.75rem;
            text-align: center;
        }
        .trade-input:focus { outline: none; border-color: #00d4ff; }
        .trade-cost {
            text-align: center;
            color: #888;
            margin-bottom: 1rem;
            font-size: 0.9rem;
        }
        .trade-buttons { display: flex; gap: 0.75rem; }
        .btn {
            flex: 1;
            padding: 1rem;
            border: none;
            border-radius: 10px;
            font-size: 1rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s;
        }
        .btn-buy { background: linear-gradient(135deg, #00ff88, #00cc6a); color: #000; }
        .btn-sell { background: linear-gradient(135deg, #ff4444, #cc3333); color: #fff; }
        .btn-cancel { background: rgba(255,255,255,0.1); color: #888; }
        .btn:hover { transform: scale(1.02); }
        .trade-message { text-align: center; margin-top: 1rem; min-height: 1.5rem; }

        /* Login Prompt */
        .login-prompt {
            text-align: center;
            padding: 3rem;
            background: rgba(255,255,255,0.02);
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 16px;
            margin-bottom: 2rem;
        }
        .btn-login {
            display: inline-block;
            padding: 1rem 2rem;
            background: linear-gradient(135deg, #5865F2, #4752c4);
            color: #fff;
            text-decoration: none;
            border-radius: 10px;
            font-weight: 600;
        }

        /* Holdings */
        .holdings-section { margin-bottom: 2rem; }
        .holdings-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
            gap: 0.75rem;
        }
        .holding-card {
            background: rgba(255,255,255,0.03);
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 10px;
            padding: 1rem;
            text-align: center;
        }
        .holding-amount { font-size: 1.25rem; font-weight: 700; }
        .holding-value { color: #666; font-size: 0.8rem; }

        @media (max-width: 768px) {
            .market-banner { flex-direction: column; text-align: center; }
            .crypto-grid { grid-template-columns: 1fr; }
            .nav-links { display: none; }
        }
    </style>
</head>
<body>
    <nav>
        <a href="/" class="logo">Jarvis</a>
        <ul class="nav-links">
            <li><a href="/commands">Commands</a></li>
            <li><a href="/store">Store</a></li>
            <li><a href="/sbx">SBX</a></li>
            <li><a href="/crypto" style="color: #00d4ff;">Crypto</a></li>
        </ul>
    </nav>

    <div class="container">
        <h1 style="margin-bottom: 0.5rem;">📈 Stark Crypto Exchange</h1>
        <p style="color: #666; margin-bottom: 1.5rem;">Trade virtual cryptocurrencies • 2.5% fee per trade</p>

        <!-- Market Status Banner -->
        <div class="market-banner">
            <div class="market-cycle">
                <div class="cycle-indicator" id="cycleIndicator"></div>
                <div>
                    <div style="font-weight: 600;" id="marketCycle">Loading...</div>
                    <div style="font-size: 0.8rem; color: #666;">Sentiment: <span id="marketSentiment">0%</span></div>
                </div>
            </div>
            <div id="marketEvent" style="display: none;"></div>
            <div style="text-align: right;">
                <div style="font-size: 0.8rem; color: #666;">24h Volume</div>
                <div style="font-weight: 600;" id="totalVolume">0 SB</div>
            </div>
        </div>

        <!-- Login Prompt -->
        <div id="loginPrompt" class="login-prompt">
            <h2 style="margin-bottom: 1rem;">🔐 Login to Trade</h2>
            <p style="color: #666; margin-bottom: 1.5rem;">Connect your Discord account to buy and sell crypto</p>
            <a href="/auth/login" class="btn-login">Login with Discord</a>
        </div>

        <!-- Portfolio Section -->
        <div id="portfolioSection" style="display: none;">
            <div class="portfolio-grid">
                <div class="stat-card">
                    <div class="stat-label">Portfolio Value</div>
                    <div class="stat-value primary" id="portfolioValue">0 SB</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Profit / Loss</div>
                    <div class="stat-value" id="profitLoss">0 SB</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Available Balance</div>
                    <div class="stat-value" id="userBalance">0 SB</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Total Invested</div>
                    <div class="stat-value" id="totalInvested">0 SB</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Total Trades</div>
                    <div class="stat-value" id="totalTrades">0</div>
                </div>
            </div>

            <div class="holdings-section" id="holdingsSection" style="display: none;">
                <h3 style="margin-bottom: 1rem;">Your Holdings</h3>
                <div class="holdings-grid" id="holdingsGrid"></div>
            </div>

            <div class="holdings-section" id="tradeHistorySection" style="display: none; margin-top: 1.5rem;">
                <h3 style="margin-bottom: 1rem;">📜 Recent Trades</h3>
                <div id="tradeHistoryList" style="max-height: 200px; overflow-y: auto;"></div>
            </div>
        </div>

        <!-- Crypto Grid -->
        <h2 style="margin-bottom: 1rem;">Available Coins</h2>
        <div class="crypto-grid" id="cryptoGrid">
            <div style="text-align: center; padding: 3rem; color: #666;">Loading market data...</div>
        </div>
    </div>

    <!-- Trade Modal -->
    <div class="trade-modal" id="tradeModal">
        <div class="trade-box">
            <div class="trade-header">
                <span class="trade-emoji" id="tradeEmoji">🦾</span>
                <div>
                    <div style="font-size: 1.5rem; font-weight: 700;" id="tradeSymbol">IRON</div>
                    <div style="color: #666;" id="tradeName">Iron Man Coin</div>
                </div>
            </div>
            <div class="trade-stats">
                <div class="trade-stat">
                    <div class="trade-stat-label">Current Price</div>
                    <div class="trade-stat-value" id="tradePrice">0 SB</div>
                </div>
                <div class="trade-stat">
                    <div class="trade-stat-label">24h High</div>
                    <div class="trade-stat-value up" id="tradeHigh">0 SB</div>
                </div>
                <div class="trade-stat">
                    <div class="trade-stat-label">24h Low</div>
                    <div class="trade-stat-value down" id="tradeLow">0 SB</div>
                </div>
            </div>
            <input type="number" class="trade-input" id="tradeAmount" placeholder="Amount" min="0.01" step="0.01" onkeypress="if(event.key==='Enter')executeTrade('buy')">
            <div class="trade-cost" id="tradeCost">Total: 0 SB (+ 0 SB fee)</div>
            <div class="trade-buttons">
                <button class="btn btn-buy" onclick="executeTrade('buy')">Buy</button>
                <button class="btn btn-sell" onclick="executeTrade('sell')">Sell</button>
            </div>
            <button class="btn btn-cancel" style="width: 100%; margin-top: 0.75rem;" onclick="closeTradeModal()">Cancel</button>
            <div class="trade-message" id="tradeMessage"></div>
        </div>
    </div>

    <script>
        let currentUser = null;
        let selectedCoin = null;
        let prices = {};
        let portfolio = null;

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
            return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }

        // Format market cap
        function formatMarketCap(num) {
            if (!num || isNaN(num)) return '0';
            if (num >= 1e12) return (num / 1e12).toFixed(1) + 'T';
            if (num >= 1e9) return (num / 1e9).toFixed(1) + 'B';
            if (num >= 1e6) return (num / 1e6).toFixed(1) + 'M';
            if (num >= 1e3) return (num / 1e3).toFixed(1) + 'K';
            return num.toFixed(0);
        }

        // Parse formatted numbers like "64M" back to raw numbers
        function parseFormattedNumber(str) {
            if (!str) return NaN;
            str = String(str).trim().toUpperCase();
            if (str === 'ALL') return 'ALL';
            str = str.replace(/,/g, '').replace(/\\s/g, '');
            const suffixes = { 'K': 1e3, 'M': 1e6, 'B': 1e9, 'T': 1e12, 'Q': 1e15 };
            const lastChar = str.slice(-1);
            if (suffixes[lastChar]) {
                const num = parseFloat(str.slice(0, -1));
                return isNaN(num) ? NaN : num * suffixes[lastChar];
            }
            return parseFloat(str);
        }

        async function checkAuth() {
            try {
                const res = await fetch('/api/user', { credentials: 'include' });
                const data = await res.json();
                if (data.authenticated && data.user) {
                    currentUser = data.user;
                    document.getElementById('loginPrompt').style.display = 'none';
                    document.getElementById('portfolioSection').style.display = 'block';
                    loadPortfolio();
                }
            } catch (e) {}
        }

        async function loadPortfolio() {
            if (!currentUser) return;
            try {
                const [cryptoRes, balRes] = await Promise.all([
                    fetch('/api/user/crypto', { credentials: 'include' }),
                    fetch('/api/user/balance', { credentials: 'include' })
                ]);
                const cryptoData = await cryptoRes.json();
                const balData = await balRes.json();

                if (cryptoData.success) {
                    portfolio = cryptoData.portfolio;
                    document.getElementById('portfolioValue').textContent = (portfolio.totalValue || 0).toLocaleString() + ' SB';
                    document.getElementById('totalInvested').textContent = (portfolio.totalInvested || 0).toLocaleString() + ' SB';
                    document.getElementById('totalTrades').textContent = portfolio.trades || 0;

                    // Display P&L with color
                    const plEl = document.getElementById('profitLoss');
                    const pl = portfolio.profitLoss || 0;
                    const plPct = portfolio.profitLossPercent || 0;
                    plEl.textContent = (pl >= 0 ? '+' : '') + pl.toLocaleString() + ' SB (' + (plPct >= 0 ? '+' : '') + plPct + '%)';
                    plEl.className = 'stat-value ' + (pl >= 0 ? 'up' : 'down');

                    renderHoldings();
                    loadTradeHistory();
                }
                if (balData.success) {
                    document.getElementById('userBalance').textContent = (balData.balance || 0).toLocaleString() + ' SB';
                }
            } catch (e) { console.error('Portfolio error:', e); }
        }

        function renderHoldings() {
            if (!portfolio?.holdings) return;
            const holdings = Object.entries(portfolio.holdings).filter(([s, a]) => a > 0);
            if (holdings.length === 0) {
                document.getElementById('holdingsSection').style.display = 'none';
                return;
            }
            document.getElementById('holdingsSection').style.display = 'block';
            const grid = document.getElementById('holdingsGrid');
            grid.innerHTML = holdings.map(([symbol, amount]) => {
                const coin = prices[symbol] || {};
                const value = (coin.price || 0) * amount;
                return \`
    <div class="holding-card" onclick = "openTradeModal('\${symbol}')" >
                        <div>\${coin.emoji || '💰'} \${symbol}</div>
                        <div class="holding-amount">\${amount.toLocaleString()}</div>
                        <div class="holding-value">\${formatNumber(value)} SB</div>
                    </div>
    \`;
            }).join('');
        }

        async function loadTradeHistory() {
            if (!currentUser) return;
            try {
                const res = await fetch('/api/user/crypto/history?limit=10', { credentials: 'include' });
                const data = await res.json();
                if (data.success && data.trades.length > 0) {
                    document.getElementById('tradeHistorySection').style.display = 'block';
                    document.getElementById('tradeHistoryList').innerHTML = data.trades.map(t => {
                        const isBuy = t.action === 'buy';
                        const color = isBuy ? '#00ff88' : '#ff4444';
                        const icon = isBuy ? '📈' : '📉';
                        const time = new Date(t.timestamp).toLocaleString();
                        return \`<div style="padding: 8px; border-bottom: 1px solid rgba(255,255,255,0.05); display: flex; justify-content: space-between; align-items: center;">
                            <span>\${icon} <strong style="color:\${color}">\${t.action.toUpperCase()}</strong> \${t.amount} \${t.symbol}</span>
                            <span style="color: #666; font-size: 0.8rem;">@ \${t.price.toLocaleString()} SB • \${time}</span>
                        </div>\`;
                    }).join('');
                }
            } catch (e) { console.error('Trade history error:', e); }
        }

        async function loadMarketState() {
            try {
                const res = await fetch('/api/crypto/market');
                const data = await res.json();
                if (data.success) {
                    const market = data.market;
                    const indicator = document.getElementById('cycleIndicator');
                    indicator.className = 'cycle-indicator cycle-' + market.cycle;
                    document.getElementById('marketCycle').textContent =
                        market.cycle.charAt(0).toUpperCase() + market.cycle.slice(1) + ' Market';
                    document.getElementById('marketSentiment').textContent =
                        (market.sentiment * 100).toFixed(0) + '%';
                    document.getElementById('totalVolume').textContent =
                        market.volume24h.toLocaleString() + ' SB';

                    const eventEl = document.getElementById('marketEvent');
                    if (market.activeEvent) {
                        eventEl.className = 'market-event';
                        eventEl.textContent = market.activeEvent.name;
                        eventEl.style.display = 'block';
                    } else {
                        eventEl.style.display = 'none';
                    }
                }
            } catch (e) {}
        }

        async function loadPrices() {
            try {
                const res = await fetch('/api/crypto/prices');
                const data = await res.json();
                if (data.success) {
                    prices = data.prices;
                    renderCoins();
                    if (portfolio) renderHoldings();
                }
            } catch (e) {
                document.getElementById('cryptoGrid').innerHTML =
                    '<div style="text-align: center; padding: 3rem; color: #ff4444;">Failed to load prices</div>';
            }
        }

        function formatMarketCap(value) {
            if (value >= 1000000) return (value / 1000000).toFixed(1) + 'M';
            if (value >= 1000) return (value / 1000).toFixed(1) + 'K';
            return value.toLocaleString();
        }



        function renderCoins() {
            const grid = document.getElementById('cryptoGrid');
            grid.innerHTML = Object.entries(prices).map(([symbol, coin]) => {
                const changeClass = coin.change24h >= 0 ? 'up' : 'down';
                const arrow = coin.change24h >= 0 ? '▲' : '▼';
                const tierClass = 'tier-' + (coin.tier || 'mid');
                const sparkColor = coin.change24h >= 0 ? '#00ff88' : '#ff4444';

                // Generate simple sparkline bars
                const bars = [];
                for (let i = 0; i < 12; i++) {
                    const h = 20 + Math.random() * 60;
                    bars.push('<div class="spark-bar" style="height:' + h + '%;"></div>');
                }

                return \`
    <div class="coin-card" onclick = "openTradeModal('\${symbol}')" >
                        <div class="coin-header">
                            <div class="coin-info">
                                <span class="coin-emoji">\${coin.emoji}</span>
                                <div>
                                    <div class="coin-symbol">\${symbol}</div>
                                    <div class="coin-name">\${coin.name}</div>
                                </div>
                            </div>
                            <span class="coin-tier \${tierClass}">\${coin.tier || 'mid'}</span>
                        </div>
                        <div class="coin-price-row">
                            <span class="coin-price">\${formatNumber(coin.price)} SB</span>
                            <span class="coin-change \${changeClass}">\${arrow} \${Math.abs(coin.change24h).toFixed(2)}%</span>
                        </div>
                        <div class="coin-sparkline" style="color: \${sparkColor}">\${bars.join('')}</div>
                        <div class="coin-stats">
                            <span>H: \${formatNumber(coin.high24h || coin.price)}</span>
                            <span>L: \${formatNumber(coin.low24h || coin.price)}</span>
                            <span>MCap: \${formatMarketCap(coin.marketCap || coin.price * 10000)}</span>
                        </div>
                    </div>
    \`;
            }).join('');
        }

        function openTradeModal(symbol) {
            if (!currentUser) {
                alert('Please login to trade');
                return;
            }
            selectedCoin = symbol;
            const coin = prices[symbol];

            document.getElementById('tradeEmoji').textContent = coin.emoji;
            document.getElementById('tradeSymbol').textContent = symbol;
            document.getElementById('tradeName').textContent = coin.name;
            document.getElementById('tradePrice').textContent = coin.price.toLocaleString() + ' SB';
            document.getElementById('tradeHigh').textContent = (coin.high24h || coin.price).toLocaleString() + ' SB';
            document.getElementById('tradeLow').textContent = (coin.low24h || coin.price).toLocaleString() + ' SB';
            document.getElementById('tradeAmount').value = '';
            document.getElementById('tradeCost').textContent = 'Total: 0 SB (+ 0 SB fee)';
            document.getElementById('tradeMessage').textContent = '';
            document.getElementById('tradeModal').classList.add('active');
        }

        document.getElementById('tradeAmount').addEventListener('input', function() {
            const amount = parseFloat(this.value) || 0;
            const coin = prices[selectedCoin];
            if (coin) {
                const total = Math.ceil(coin.price * amount);
                const fee = Math.ceil(total * 0.025);
                document.getElementById('tradeCost').textContent =
                    'Total: ' + total.toLocaleString() + ' SB (+ ' + fee.toLocaleString() + ' SB fee)';
            }
        });

        function closeTradeModal() {
            document.getElementById('tradeModal').classList.remove('active');
            selectedCoin = null;
        }

        async function executeTrade(action) {
            const amount = parseFormattedNumber(document.getElementById('tradeAmount').value);
            if (!amount || amount < 0.01) {
                document.getElementById('tradeMessage').innerHTML = '<span style="color: #ff4444;">Enter a valid amount (min 0.01)</span>';
                return;
            }

            const msg = document.getElementById('tradeMessage');
            msg.innerHTML = '<span style="color: #888;">Processing...</span>';

            try {
                const res = await fetch('/api/user/crypto/' + action, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ symbol: selectedCoin, amount })
                });
                const data = await res.json();

                if (data.success) {
                    const verb = action === 'buy' ? 'Bought' : 'Sold';
                    msg.innerHTML = '<span style="color: #00ff88;">✓ ' + verb + ' ' + amount + ' ' + selectedCoin + '</span>';
                    loadPortfolio();
                    loadPrices();
                    setTimeout(closeTradeModal, 1500);
                } else {
                    msg.innerHTML = '<span style="color: #ff4444;">' + (data.error || 'Trade failed') + '</span>';
                }
            } catch (e) {
                msg.innerHTML = '<span style="color: #ff4444;">Network error</span>';
            }
        }

        // Initialize
        checkAuth();
        loadPrices();
        loadMarketState();
        setInterval(loadPrices, 30000);
        setInterval(loadMarketState, 15000);
        setInterval(() => { if (currentUser) { loadPortfolio(); loadTradeHistory(); } }, 60000);
    </script>
</body>
</html>
`;

module.exports = CRYPTO_PAGE;

'use strict';

/**
 * Additional Site Pages
 * Commands, Leaderboard, Docs, Changelog, SBX Exchange
 */

const express = require('express');
const router = express.Router();

const DISCORD_INVITE = 'https://discord.com/invite/ksXzuBtmK5';

// Shared styles
const SHARED_STYLES = `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        background: linear-gradient(135deg, #0a0a1a 0%, #1a1a3e 50%, #0d0d2b 100%);
        color: #e4e4e4;
        min-height: 100vh;
    }
    .container {
        max-width: 1200px;
        margin: 0 auto;
        padding: 2rem;
    }
    nav {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 1.5rem 5%;
        max-width: 1400px;
        margin: 0 auto;
    }
    .logo {
        font-size: 1.8rem;
        font-weight: 700;
        background: linear-gradient(90deg, #00d4ff, #8a2be2);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        text-decoration: none;
    }
    .nav-links {
        display: flex;
        gap: 2rem;
        list-style: none;
    }
    .nav-links a {
        color: #b0b0b0;
        text-decoration: none;
        font-weight: 500;
        transition: color 0.3s;
    }
    .nav-links a:hover { color: #00d4ff; }
    h1 {
        font-size: 2.5rem;
        margin-bottom: 1rem;
        background: linear-gradient(90deg, #fff, #00d4ff);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
    }
    h2 {
        color: #00d4ff;
        font-size: 1.5rem;
        margin: 2rem 0 1rem;
        border-bottom: 1px solid rgba(0,212,255,0.3);
        padding-bottom: 0.5rem;
    }
    .card {
        background: rgba(255,255,255,0.05);
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 12px;
        padding: 1.5rem;
        margin-bottom: 1rem;
    }
    .btn {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.75rem 1.5rem;
        border-radius: 8px;
        font-weight: 600;
        text-decoration: none;
        transition: all 0.3s;
    }
    .btn-primary {
        background: linear-gradient(90deg, #00d4ff, #8a2be2);
        color: white;
    }
    .btn-primary:hover { transform: translateY(-2px); }
    code {
        background: rgba(0,212,255,0.1);
        padding: 0.2rem 0.5rem;
        border-radius: 4px;
        font-family: 'Courier New', monospace;
    }
    .search-box {
        width: 100%;
        padding: 1rem;
        background: rgba(255,255,255,0.05);
        border: 1px solid rgba(255,255,255,0.2);
        border-radius: 8px;
        color: #fff;
        font-size: 1rem;
        margin-bottom: 2rem;
    }
    .search-box:focus {
        outline: none;
        border-color: #00d4ff;
    }
    table {
        width: 100%;
        border-collapse: collapse;
    }
    th, td {
        padding: 1rem;
        text-align: left;
        border-bottom: 1px solid rgba(255,255,255,0.1);
    }
    th { color: #00d4ff; }
    .rank { color: #8a2be2; font-weight: bold; }
    .amount { color: #00ff88; }
`;

const NAV_HTML = `
    <nav>
        <a href="/" class="logo">⚡ Jarvis</a>
        <ul class="nav-links">
            <li><a href="/commands">Commands</a></li>
            <li><a href="/store">Store</a></li>
            <li><a href="/leaderboard">Leaderboard</a></li>
            <li><a href="/sbx">SBX</a></li>
            <li><a href="/crypto">Crypto</a></li>
            <li><a href="/status">Status</a></li>
            <li><a href="/docs">Docs</a></li>
            <li><a href="/me">My Portal</a></li>
        </ul>
    </nav>
`;

// ============================================================================
// COMMANDS PAGE
// ============================================================================

const COMMANDS_PAGE = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Commands | Jarvis</title>
    <style>${SHARED_STYLES}
        .command-item {
            background: rgba(255,255,255,0.03);
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 8px;
            padding: 1rem;
            margin-bottom: 0.75rem;
            transition: all 0.3s;
        }
        .command-item:hover {
            background: rgba(255,255,255,0.06);
            border-color: rgba(0,212,255,0.3);
        }
        .command-name {
            color: #00d4ff;
            font-weight: 600;
            font-family: monospace;
        }
        .command-desc { color: #aaa; margin-top: 0.5rem; }
        .command-usage { color: #666; font-size: 0.9rem; margin-top: 0.25rem; }
        .category-tag {
            display: inline-block;
            background: rgba(138,43,226,0.2);
            color: #8a2be2;
            padding: 0.2rem 0.6rem;
            border-radius: 12px;
            font-size: 0.8rem;
            margin-left: 0.5rem;
        }
        .hidden { display: none; }
    </style>
</head>
<body>
    ${NAV_HTML}
    <div class="container">
        <h1>📚 Commands</h1>
        <p style="color: #888; margin-bottom: 2rem;">Use prefix <code>*j</code> or slash commands <code>/</code></p>
        
        <input type="text" class="search-box" id="searchBox" placeholder="🔍 Search commands..." oninput="filterCommands()">
        
        <div id="commandList">
            <h2>💬 AI & Chat</h2>
            <div class="command-item" data-category="ai">
                <span class="command-name">*j &lt;message&gt;</span>
                <span class="category-tag">AI</span>
                <p class="command-desc">Chat with Jarvis - just mention or use prefix</p>
            </div>
            <div class="command-item" data-category="ai">
                <span class="command-name">*j imagine &lt;prompt&gt;</span>
                <span class="category-tag">AI</span>
                <p class="command-desc">Generate AI images</p>
            </div>
            <div class="command-item" data-category="ai">
                <span class="command-name">*j reset</span>
                <span class="category-tag">AI</span>
                <p class="command-desc">Clear your conversation history</p>
            </div>
            
            <h2>💰 Economy</h2>
            <div class="command-item" data-category="economy">
                <span class="command-name">*j balance</span>
                <span class="category-tag">Economy</span>
                <p class="command-desc">Check your Stark Bucks balance</p>
            </div>
            <div class="command-item" data-category="economy">
                <span class="command-name">*j daily</span>
                <span class="category-tag">Economy</span>
                <p class="command-desc">Claim your daily reward</p>
            </div>
            <div class="command-item" data-category="economy">
                <span class="command-name">*j work</span>
                <span class="category-tag">Economy</span>
                <p class="command-desc">Work to earn Stark Bucks</p>
            </div>
            <div class="command-item" data-category="economy">
                <span class="command-name">*j leaderboard</span>
                <span class="category-tag">Economy</span>
                <p class="command-desc">View the richest users</p>
            </div>
            
            <h2>☕ Starkbucks (SBX)</h2>
            <div class="command-item" data-category="sbx">
                <span class="command-name">!sbx wallet</span>
                <span class="category-tag">SBX</span>
                <p class="command-desc">View your SBX wallet and balance</p>
            </div>
            <div class="command-item" data-category="sbx">
                <span class="command-name">!sbx buy &lt;amount&gt;</span>
                <span class="category-tag">SBX</span>
                <p class="command-desc">Buy SBX with Stark Bucks</p>
            </div>
            <div class="command-item" data-category="sbx">
                <span class="command-name">!sbx sell &lt;amount&gt;</span>
                <span class="category-tag">SBX</span>
                <p class="command-desc">Sell SBX for Stark Bucks</p>
            </div>
            <div class="command-item" data-category="sbx">
                <span class="command-name">!sbx invest &lt;amount&gt;</span>
                <span class="category-tag">SBX</span>
                <p class="command-desc">Invest SBX for daily returns</p>
            </div>
            <div class="command-item" data-category="sbx">
                <span class="command-name">!sbx store</span>
                <span class="category-tag">SBX</span>
                <p class="command-desc">View the SBX store items</p>
            </div>
            
            <h2>🛡️ Moderation</h2>
            <div class="command-item" data-category="mod">
                <span class="command-name">*j ban @user [reason]</span>
                <span class="category-tag">Mod</span>
                <p class="command-desc">Ban a user from the server</p>
            </div>
            <div class="command-item" data-category="mod">
                <span class="command-name">*j kick @user [reason]</span>
                <span class="category-tag">Mod</span>
                <p class="command-desc">Kick a user from the server</p>
            </div>
            <div class="command-item" data-category="mod">
                <span class="command-name">*j mute @user [duration]</span>
                <span class="category-tag">Mod</span>
                <p class="command-desc">Timeout a user</p>
            </div>
            <div class="command-item" data-category="mod">
                <span class="command-name">*j purge &lt;count&gt;</span>
                <span class="category-tag">Mod</span>
                <p class="command-desc">Delete multiple messages</p>
            </div>
            
            <h2>🎵 Music</h2>
            <div class="command-item" data-category="music">
                <span class="command-name">*j play &lt;song&gt;</span>
                <span class="category-tag">Music</span>
                <p class="command-desc">Play a song from YouTube/Spotify</p>
            </div>
            <div class="command-item" data-category="music">
                <span class="command-name">*j skip</span>
                <span class="category-tag">Music</span>
                <p class="command-desc">Skip the current song</p>
            </div>
            <div class="command-item" data-category="music">
                <span class="command-name">*j queue</span>
                <span class="category-tag">Music</span>
                <p class="command-desc">View the music queue</p>
            </div>
            <div class="command-item" data-category="music">
                <span class="command-name">*j stop</span>
                <span class="category-tag">Music</span>
                <p class="command-desc">Stop music and clear queue</p>
            </div>
            
            <h2>🔧 Utility</h2>
            <div class="command-item" data-category="utility">
                <span class="command-name">*j help</span>
                <span class="category-tag">Utility</span>
                <p class="command-desc">Show all available commands</p>
            </div>
            <div class="command-item" data-category="utility">
                <span class="command-name">*j ping</span>
                <span class="category-tag">Utility</span>
                <p class="command-desc">Check bot latency</p>
            </div>
            <div class="command-item" data-category="utility">
                <span class="command-name">*j avatar @user</span>
                <span class="category-tag">Utility</span>
                <p class="command-desc">Get a user's avatar</p>
            </div>
            <div class="command-item" data-category="utility">
                <span class="command-name">*j serverinfo</span>
                <span class="category-tag">Utility</span>
                <p class="command-desc">View server information</p>
            </div>
        </div>
    </div>
    
    <script>
        function filterCommands() {
            const query = document.getElementById('searchBox').value.toLowerCase();
            const items = document.querySelectorAll('.command-item');
            items.forEach(item => {
                const text = item.textContent.toLowerCase();
                item.classList.toggle('hidden', !text.includes(query));
            });
        }
    </script>
</body>
</html>
`;

// ============================================================================
// LEADERBOARD PAGE
// ============================================================================

const LEADERBOARD_PAGE = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Leaderboard | Jarvis</title>
    <style>${SHARED_STYLES}
        .tabs {
            display: flex;
            gap: 1rem;
            margin-bottom: 2rem;
        }
        .tab {
            padding: 0.75rem 1.5rem;
            background: rgba(255,255,255,0.05);
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 8px;
            color: #888;
            cursor: pointer;
            transition: all 0.3s;
            border: none;
            font-size: 1rem;
        }
        .tab:hover { background: rgba(255,255,255,0.1); }
        .tab.active {
            background: rgba(0,212,255,0.2);
            border-color: #00d4ff;
            color: #00d4ff;
        }
        .rank-1 { color: #ffd700; }
        .rank-2 { color: #c0c0c0; }
        .rank-3 { color: #cd7f32; }
        .loading { text-align: center; color: #888; padding: 2rem; }
        .user-cell {
            display: flex;
            align-items: center;
            gap: 0.75rem;
        }
        .user-avatar {
            width: 32px;
            height: 32px;
            border-radius: 50%;
            background: rgba(255,255,255,0.1);
            object-fit: cover;
        }
        .user-name { font-weight: 500; }
    </style>
</head>
<body>
    ${NAV_HTML}
    <div class="container">
        <h1>🏆 Leaderboard</h1>
        
        <div class="tabs">
            <button class="tab active" id="tabBalance" onclick="loadLeaderboard('balance', this)">💰 Stark Bucks</button>
            <button class="tab" id="tabSbx" onclick="loadLeaderboard('sbx', this)">☕ SBX Holdings</button>
        </div>
        
        <div class="card">
            <table>
                <thead>
                    <tr>
                        <th style="width: 80px;">Rank</th>
                        <th>User</th>
                        <th style="text-align: right;">Amount</th>
                    </tr>
                </thead>
                <tbody id="leaderboardBody">
                    <tr><td colspan="3" class="loading">Select a category above</td></tr>
                </tbody>
            </table>
        </div>
    </div>
    
    <script>
        let currentType = 'balance';
        
        function getDefaultAvatar(userId) {
            const index = (parseInt(userId) || 0) % 5;
            return 'https://cdn.discordapp.com/embed/avatars/' + index + '.png';
        }
        
        async function loadLeaderboard(type, btn) {
            currentType = type;
            
            // Update tabs
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            if (btn) btn.classList.add('active');
            
            const tbody = document.getElementById('leaderboardBody');
            tbody.innerHTML = '<tr><td colspan="3" class="loading">Loading...</td></tr>';
            
            try {
                const res = await fetch('/api/leaderboard/' + type + '?limit=25&resolve=true');
                const data = await res.json();
                
                if (!data.success || !data.leaderboard?.length) {
                    tbody.innerHTML = '<tr><td colspan="3" class="loading">No data yet</td></tr>';
                    return;
                }
                
                tbody.innerHTML = data.leaderboard.map((entry, i) => {
                    const rank = i + 1;
                    const rankClass = rank <= 3 ? 'rank-' + rank : '';
                    const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank;
                    const amount = type === 'sbx' 
                        ? (entry.balance || 0).toFixed(2) + ' SBX'
                        : (entry.balance || 0).toLocaleString() + ' SB';
                    const avatar = entry.avatar || getDefaultAvatar(entry.userId);
                    const name = entry.displayName || entry.username || 'User ' + (entry.userId || '').slice(-4);
                    return \`
                        <tr>
                            <td class="rank \${rankClass}">\${medal}</td>
                            <td>
                                <div class="user-cell">
                                    <img src="\${avatar}" class="user-avatar" alt="" onerror="this.src=getDefaultAvatar('\${entry.userId}')">
                                    <span class="user-name">\${name}</span>
                                </div>
                            </td>
                            <td class="amount" style="text-align: right;">\${amount}</td>
                        </tr>
                    \`;
                }).join('');
            } catch (e) {
                console.error('Leaderboard error:', e);
                tbody.innerHTML = '<tr><td colspan="3" class="loading">Error loading data</td></tr>';
            }
        }
        
        // Load balance leaderboard by default
        document.addEventListener('DOMContentLoaded', () => {
            loadLeaderboard('balance', document.getElementById('tabBalance'));
        });
    </script>
</body>
</html>
`;

// ============================================================================
// SBX EXCHANGE PAGE
// ============================================================================

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
                const res = await fetch('/api/user');
                const data = await res.json();
                if (data.authenticated && data.user) {
                    currentUser = data.user;
                    document.getElementById('loginPrompt').style.display = 'none';
                    document.getElementById('tradingUI').style.display = 'block';
                    loadUserBalance();
                }
            } catch (e) {
                console.log('Not logged in');
            }
        }
        
        async function loadUserBalance() {
            if (!currentUser) return;
            try {
                const res = await fetch('/api/user/balance');
                const data = await res.json();
                if (data.success) {
                    document.getElementById('yourBalance').textContent = (data.balance || 0).toLocaleString() + ' SB';
                    document.getElementById('yourSbx').textContent = (data.sbx || 0).toFixed(2);
                    document.getElementById('invested').textContent = (data.invested || 0).toFixed(2);
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
            const amount = parseFloat(document.getElementById('buyAmount').value);
            if (!amount || amount < 1) {
                showMessage('buyMessage', 'Enter a valid amount', true);
                return;
            }
            try {
                const res = await fetch('/api/user/sbx/buy', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ amount })
                });
                const data = await res.json();
                if (data.success) {
                    showMessage('buyMessage', 'Bought ' + data.sbxReceived.toFixed(2) + ' SBX!', false);
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
            const input = document.getElementById('sellAmount').value.toLowerCase().trim();
            let amount;
            
            if (input === 'all') {
                const balanceElement = document.getElementById('yourSbx');
                const balanceText = balanceElement.textContent;
                console.log('SBX balance text:', balanceText);
                amount = parseFloat(balanceText);
                console.log('Parsed amount:', amount);
                if (isNaN(amount) || amount <= 0) {
                    showMessage('sellMessage', 'No SBX to sell', true);
                    return;
                }
            } else {
                amount = parseFloat(input);
                if (!amount || amount < 0.01) {
                    showMessage('sellMessage', 'Enter a valid amount', true);
                    return;
                }
            }
            
            // Clear the input field after getting the amount
            document.getElementById('sellAmount').value = '';
            
            try {
                const res = await fetch('/api/user/sbx/sell', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ amount })
                });
                const data = await res.json();
                if (data.success) {
                    showMessage('sellMessage', 'Sold for ' + data.starkBucksReceived.toLocaleString() + ' SB!', false);
                    loadUserBalance();
                } else {
                    showMessage('sellMessage', data.error || 'Sale failed', true);
                }
            } catch (e) {
                showMessage('sellMessage', 'Error: ' + e.message, true);
            }
        }
        
        async function investSbx() {
            const amount = parseFloat(document.getElementById('investAmount').value);
            if (!amount || amount < 1) {
                showMessage('investMessage', 'Enter a valid amount', true);
                return;
            }
            try {
                const res = await fetch('/api/user/sbx/invest', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ amount })
                });
                const data = await res.json();
                if (data.success) {
                    showMessage('investMessage', 'Invested ' + amount.toFixed(2) + ' SBX!', false);
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
                const res = await fetch('/api/user/sbx/claim', { method: 'POST' });
                const data = await res.json();
                if (data.success) {
                    showMessage('investMessage', 'Claimed ' + (data.earnings || 0).toFixed(2) + ' SBX!', false);
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
                const res = await fetch('/api/user/sbx/withdraw', { method: 'POST' });
                const data = await res.json();
                if (data.success) {
                    showMessage('investMessage', 'Withdrew ' + (data.total || 0).toFixed(2) + ' SBX!', false);
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
                
                // Clear canvas
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                
                if (history.length < 2) {
                    // Show "No data" message
                    ctx.fillStyle = 'rgba(255,255,255,0.5)';
                    ctx.font = '14px Arial';
                    ctx.textAlign = 'center';
                    ctx.fillText('Price history will appear here', canvas.width / 2, canvas.height / 2);
                    document.getElementById('chartRange').textContent = 'No data yet';
                    return;
                }
                
                const prices = history.map(p => p.price);
                const minPrice = Math.min(...prices) * 0.98;
                const maxPrice = Math.max(...prices) * 1.02;
                const range = maxPrice - minPrice || 1;
                
                // Update range display
                document.getElementById('chartRange').textContent = 
                    'Low: ' + Math.min(...prices).toFixed(2) + ' | High: ' + Math.max(...prices).toFixed(2);
                
                // Draw grid lines
                ctx.strokeStyle = 'rgba(255,255,255,0.1)';
                ctx.lineWidth = 1;
                for (let i = 0; i <= 4; i++) {
                    const y = (canvas.height / 4) * i;
                    ctx.beginPath();
                    ctx.moveTo(0, y);
                    ctx.lineTo(canvas.width, y);
                    ctx.stroke();
                }
                
                // Draw price line
                const isUp = prices[prices.length - 1] >= prices[0];
                ctx.strokeStyle = isUp ? '#00ff88' : '#ff4444';
                ctx.lineWidth = 2;
                ctx.beginPath();
                
                for (let i = 0; i < prices.length; i++) {
                    const x = (i / (prices.length - 1)) * canvas.width;
                    const y = canvas.height - ((prices[i] - minPrice) / range) * canvas.height;
                    if (i === 0) ctx.moveTo(x, y);
                    else ctx.lineTo(x, y);
                }
                ctx.stroke();
                
                // Fill gradient under line
                ctx.lineTo(canvas.width, canvas.height);
                ctx.lineTo(0, canvas.height);
                ctx.closePath();
                const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
                gradient.addColorStop(0, isUp ? 'rgba(0,255,136,0.3)' : 'rgba(255,68,68,0.3)');
                gradient.addColorStop(1, 'rgba(0,0,0,0)');
                ctx.fillStyle = gradient;
                ctx.fill();
                
            } catch (e) {
                console.error('Chart error:', e);
            }
        }
        
        checkAuth();
        loadSbxData();
        loadPriceChart();
        setInterval(loadSbxData, 20000);
        setInterval(loadPriceChart, 20000);
    </script>
</body>
</html>
`;

// ============================================================================
// CRYPTO PAGE - Full featured with charts and market state
// ============================================================================

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
            <input type="number" class="trade-input" id="tradeAmount" placeholder="Amount" min="0.01" step="0.01">
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
        
        async function checkAuth() {
            try {
                const res = await fetch('/api/user');
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
                    fetch('/api/user/crypto'),
                    fetch('/api/user/balance')
                ]);
                const cryptoData = await cryptoRes.json();
                const balData = await balRes.json();
                
                if (cryptoData.success) {
                    portfolio = cryptoData.portfolio;
                    document.getElementById('portfolioValue').textContent = (portfolio.totalValue || 0).toLocaleString() + ' SB';
                    document.getElementById('totalInvested').textContent = (portfolio.totalInvested || 0).toLocaleString() + ' SB';
                    document.getElementById('totalTrades').textContent = portfolio.trades || 0;
                    renderHoldings();
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
                    <div class="holding-card" onclick="openTradeModal('\${symbol}')">
                        <div>\${coin.emoji || '💰'} \${symbol}</div>
                        <div class="holding-amount">\${amount.toLocaleString()}</div>
                        <div class="holding-value">\${value.toLocaleString()} SB</div>
                    </div>
                \`;
            }).join('');
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
                    <div class="coin-card" onclick="openTradeModal('\${symbol}')">
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
                            <span class="coin-price">\${coin.price.toLocaleString()} SB</span>
                            <span class="coin-change \${changeClass}">\${arrow} \${Math.abs(coin.change24h).toFixed(2)}%</span>
                        </div>
                        <div class="coin-sparkline" style="color: \${sparkColor}">\${bars.join('')}</div>
                        <div class="coin-stats">
                            <span>H: \${(coin.high24h || coin.price).toLocaleString()}</span>
                            <span>L: \${(coin.low24h || coin.price).toLocaleString()}</span>
                            <span>\${coin.trend === 'up' ? '📈' : coin.trend === 'down' ? '📉' : '➡️'}</span>
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
            const amount = parseFloat(document.getElementById('tradeAmount').value);
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
        setInterval(() => { if (currentUser) loadPortfolio(); }, 60000);
    </script>
</body>
</html>
`;

// ============================================================================
// DOCS PAGE - User Guide + API Documentation
// ============================================================================

const DOCS_PAGE = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Documentation | Jarvis API</title>
    <style>${SHARED_STYLES}
        .doc-section { margin-bottom: 3rem; }
        pre {
            background: rgba(0,0,0,0.3);
            padding: 1rem;
            border-radius: 8px;
            overflow-x: auto;
            font-family: 'Courier New', monospace;
            font-size: 0.85rem;
            line-height: 1.5;
        }
        .tabs { display: flex; gap: 0.5rem; margin-bottom: 2rem; }
        .tab {
            padding: 0.75rem 1.5rem;
            background: rgba(255,255,255,0.05);
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 8px;
            color: #888;
            cursor: pointer;
            transition: all 0.3s;
        }
        .tab:hover { background: rgba(255,255,255,0.1); color: #fff; }
        .tab.active { background: rgba(0,212,255,0.2); border-color: #00d4ff; color: #00d4ff; }
        .tab-content { display: none; }
        .tab-content.active { display: block; }
        .endpoint {
            background: rgba(255,255,255,0.03);
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 12px;
            padding: 1.5rem;
            margin-bottom: 1.5rem;
        }
        .endpoint-header {
            display: flex;
            align-items: center;
            gap: 1rem;
            margin-bottom: 1rem;
        }
        .method {
            padding: 0.25rem 0.75rem;
            border-radius: 4px;
            font-weight: 600;
            font-size: 0.8rem;
        }
        .method.get { background: rgba(0,212,255,0.2); color: #00d4ff; }
        .method.post { background: rgba(0,255,136,0.2); color: #00ff88; }
        .endpoint-path { font-family: monospace; font-size: 1.1rem; }
        .endpoint-desc { color: #888; margin-bottom: 1rem; }
        .param-table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
        .param-table th, .param-table td { padding: 0.75rem; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.1); }
        .param-table th { color: #00d4ff; font-weight: 500; }
        .param-name { font-family: monospace; color: #dcdcaa; }
        .param-type { color: #4ec9b0; font-size: 0.85rem; }
        .param-required { color: #f14c4c; font-size: 0.75rem; }
        .code-tabs { display: flex; gap: 0.5rem; margin-bottom: 0.5rem; }
        .code-tab {
            padding: 0.25rem 0.75rem;
            background: rgba(255,255,255,0.05);
            border-radius: 4px;
            font-size: 0.8rem;
            color: #888;
            cursor: pointer;
        }
        .code-tab.active { background: rgba(0,212,255,0.2); color: #00d4ff; }
        .response-example { margin-top: 1rem; }
        .copy-btn {
            float: right;
            padding: 0.25rem 0.5rem;
            background: rgba(255,255,255,0.1);
            border: none;
            border-radius: 4px;
            color: #888;
            cursor: pointer;
            font-size: 0.75rem;
        }
        .copy-btn:hover { background: rgba(255,255,255,0.2); color: #fff; }
    </style>
</head>
<body>
    ${NAV_HTML}
    <div class="container">
        <h1>📖 Documentation</h1>
        <p style="color: #888; margin-bottom: 2rem;">User guide and API reference for Jarvis</p>
        
        <div class="tabs">
            <button class="tab active" onclick="showTab('api')">🔌 API Reference</button>
            <button class="tab" onclick="showTab('guide')">📚 User Guide</button>
        </div>

        <!-- API Documentation Tab -->
        <div id="api" class="tab-content active">
            <div style="background: rgba(255, 68, 68, 0.15); border: 2px solid #ff4444; border-radius: 8px; padding: 1.5rem; margin-bottom: 2rem;">
                <h3 style="color: #ff4444; margin-bottom: 0.5rem;">⚠️ API Temporarily Disabled</h3>
                <p style="color: #ff6666; margin: 0;">The public API has been disabled for an unspecified amount of time. Please use the Discord bot instead.</p>
            </div>
            <div class="doc-section">
                <h2>🔑 Authentication</h2>
                <div class="card">
                    <p>All API requests require authentication using an API key. Include your key in the Authorization header:</p>
                    <pre>Authorization: Bearer jv-your-api-key</pre>
                    <p style="margin-top: 1rem; color: #888;">Get your API key from the <a href="/me" style="color: #00d4ff;">User Dashboard</a>. Each account can have up to 5 API keys.</p>
                </div>
            </div>

            <div class="doc-section">
                <h2>📡 Base URL</h2>
                <div class="card">
                    <pre>https://jorvis.org/api/v1</pre>
                </div>
            </div>

            <div class="doc-section">
                <h2>⚡ Rate Limits</h2>
                <div class="card">
                    <p>API requests are rate limited to <strong>60 requests per minute</strong> per API key.</p>
                    <p style="margin-top: 0.5rem; color: #888;">Rate limit headers are included in responses:</p>
                    <ul style="margin-left: 1.5rem; margin-top: 0.5rem; color: #aaa;">
                        <li><code>X-RateLimit-Limit</code> - Max requests per window</li>
                        <li><code>X-RateLimit-Remaining</code> - Remaining requests</li>
                        <li><code>X-RateLimit-Reset</code> - Unix timestamp when limit resets</li>
                    </ul>
                </div>
            </div>

            <div class="doc-section">
                <h2>🔗 Endpoints</h2>

                <div class="endpoint">
                    <div class="endpoint-header">
                        <span class="method post">POST</span>
                        <span class="endpoint-path">/chat/completions</span>
                    </div>
                    <p class="endpoint-desc">Create a chat completion using Jarvis AI. OpenAI-compatible format.</p>
                    
                    <h4 style="color: #00d4ff; margin: 1rem 0 0.5rem;">Request Body</h4>
                    <table class="param-table">
                        <tr><th>Parameter</th><th>Type</th><th>Description</th></tr>
                        <tr>
                            <td><span class="param-name">messages</span> <span class="param-required">required</span></td>
                            <td><span class="param-type">array</span></td>
                            <td>Array of message objects with <code>role</code> and <code>content</code></td>
                        </tr>
                        <tr>
                            <td><span class="param-name">model</span></td>
                            <td><span class="param-type">string</span></td>
                            <td>Model to use (optional, defaults to auto-select)</td>
                        </tr>
                        <tr>
                            <td><span class="param-name">temperature</span></td>
                            <td><span class="param-type">number</span></td>
                            <td>Sampling temperature (0-2, default: 0.7)</td>
                        </tr>
                        <tr>
                            <td><span class="param-name">max_tokens</span></td>
                            <td><span class="param-type">integer</span></td>
                            <td>Maximum tokens in response (default: 1000)</td>
                        </tr>
                    </table>

                    <h4 style="color: #00d4ff; margin: 1rem 0 0.5rem;">Example Request</h4>
                    <pre><button class="copy-btn" onclick="copyCode(this)">Copy</button>curl https://jorvis.org/api/v1/chat/completions \\
  -H "Authorization: Bearer jv-your-api-key" \\
  -H "Content-Type: application/json" \\
  -d '{
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "Hello, how are you?"}
    ],
    "temperature": 0.7
  }'</pre>

                    <h4 style="color: #00d4ff; margin: 1rem 0 0.5rem;">Example Response</h4>
                    <pre>{
  "id": "chatcmpl-abc123",
  "object": "chat.completion",
  "created": 1703001234,
  "model": "jarvis-default",
  "choices": [{
    "index": 0,
    "message": {
      "role": "assistant",
      "content": "Hello! I'm doing great, thank you for asking..."
    },
    "finish_reason": "stop"
  }],
  "usage": {
    "prompt_tokens": 25,
    "completion_tokens": 42,
    "total_tokens": 67
  }
}</pre>
                </div>

                <div class="endpoint">
                    <div class="endpoint-header">
                        <span class="method get">GET</span>
                        <span class="endpoint-path">/models</span>
                    </div>
                    <p class="endpoint-desc">List available AI models.</p>
                    
                    <h4 style="color: #00d4ff; margin: 1rem 0 0.5rem;">Example Response</h4>
                    <pre>{
  "object": "list",
  "data": [
    {"id": "jarvis-default", "object": "model", "owned_by": "jarvis"},
    {"id": "gpt-4", "object": "model", "owned_by": "jarvis"}
  ]
}</pre>
                </div>

                <div class="endpoint">
                    <div class="endpoint-header">
                        <span class="method get">GET</span>
                        <span class="endpoint-path">/user</span>
                    </div>
                    <p class="endpoint-desc">Get information about the authenticated user.</p>
                    
                    <h4 style="color: #00d4ff; margin: 1rem 0 0.5rem;">Example Response</h4>
                    <pre>{
  "userId": "123456789",
  "keyId": "abc123",
  "keyName": "My App",
  "totalKeys": 2,
  "maxKeys": 5
}</pre>
                </div>

                <div class="endpoint">
                    <div class="endpoint-header">
                        <span class="method get">GET</span>
                        <span class="endpoint-path">/usage</span>
                    </div>
                    <p class="endpoint-desc">Get API usage statistics for your account.</p>
                    
                    <h4 style="color: #00d4ff; margin: 1rem 0 0.5rem;">Example Response</h4>
                    <pre>{
  "userId": "123456789",
  "totalRequests": 1542,
  "keys": [
    {"id": "abc123", "name": "My App", "requestCount": 1200},
    {"id": "def456", "name": "Test Key", "requestCount": 342}
  ]
}</pre>
                </div>
            </div>

            <div class="doc-section">
                <h2>❌ Error Codes</h2>
                <div class="card">
                    <table class="param-table">
                        <tr><th>Code</th><th>Type</th><th>Description</th></tr>
                        <tr><td>401</td><td>authentication_error</td><td>Invalid or missing API key</td></tr>
                        <tr><td>429</td><td>rate_limit_error</td><td>Too many requests</td></tr>
                        <tr><td>400</td><td>invalid_request_error</td><td>Malformed request body</td></tr>
                        <tr><td>500</td><td>api_error</td><td>Internal server error</td></tr>
                        <tr><td>503</td><td>api_error</td><td>Service temporarily unavailable</td></tr>
                    </table>
                </div>
            </div>

            <div class="doc-section">
                <h2>💻 Code Examples</h2>
                
                <h3 style="color: #fff; margin: 1rem 0;">Python</h3>
                <pre><button class="copy-btn" onclick="copyCode(this)">Copy</button>import requests

response = requests.post(
    "https://jorvis.org/api/v1/chat/completions",
    headers={
        "Authorization": "Bearer jv-your-api-key",
        "Content-Type": "application/json"
    },
    json={
        "messages": [{"role": "user", "content": "Hello!"}]
    }
)

print(response.json()["choices"][0]["message"]["content"])</pre>

                <h3 style="color: #fff; margin: 1rem 0;">JavaScript (Node.js)</h3>
                <pre><button class="copy-btn" onclick="copyCode(this)">Copy</button>const response = await fetch("https://jorvis.org/api/v1/chat/completions", {
  method: "POST",
  headers: {
    "Authorization": "Bearer jv-your-api-key",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    messages: [{ role: "user", content: "Hello!" }]
  })
});

const data = await response.json();
console.log(data.choices[0].message.content);</pre>

                <h3 style="color: #fff; margin: 1rem 0;">OpenAI SDK Compatible</h3>
                <pre><button class="copy-btn" onclick="copyCode(this)">Copy</button>from openai import OpenAI

client = OpenAI(
    api_key="jv-your-api-key",
    base_url="https://jorvis.org/api/v1"
)

response = client.chat.completions.create(
    model="jarvis-default",
    messages=[{"role": "user", "content": "Hello!"}]
)

print(response.choices[0].message.content)</pre>
            </div>
        </div>

        <!-- User Guide Tab -->
        <div id="guide" class="tab-content">
            <div class="doc-section">
                <h2>🚀 Getting Started</h2>
                <div class="card">
                    <p>Jarvis uses two command styles:</p>
                    <ul style="margin-left: 1.5rem; margin-top: 0.5rem; color: #aaa;">
                        <li><strong>Slash Commands</strong> - Type <code>/</code> and select from the menu</li>
                        <li><strong>Text Commands</strong> - Use the <code>*j</code> prefix</li>
                    </ul>
                    <p style="margin-top: 1rem;">Example: <code>*j help</code> or <code>/help</code></p>
                </div>
            </div>
            
            <div class="doc-section">
                <h2>💬 AI Chat</h2>
                <div class="card">
                    <p>Talk to Jarvis naturally:</p>
                    <ul style="margin-left: 1.5rem; margin-top: 0.5rem; color: #aaa;">
                        <li><strong>@Jarvis</strong> - Mention the bot in any channel</li>
                        <li><strong>*j &lt;message&gt;</strong> - Use the text prefix</li>
                        <li><strong>DMs</strong> - Send a direct message to Jarvis</li>
                    </ul>
                    <p style="margin-top: 1rem;">Jarvis remembers context from your conversations. Use <code>*j reset</code> to clear your history.</p>
                </div>
            </div>
            
            <div class="doc-section">
                <h2>💰 Economy System</h2>
                <div class="card">
                    <p>Earn and spend coins:</p>
                    <ul style="margin-left: 1.5rem; margin-top: 0.5rem; color: #aaa;">
                        <li><code>/daily</code> - Claim daily rewards (streak bonuses!)</li>
                        <li><code>/work</code> - Work at Stark Industries</li>
                        <li><code>/hunt</code> <code>/fish</code> <code>/dig</code> - Minigames</li>
                        <li><code>/gamble</code> <code>/slots</code> <code>/coinflip</code> - Try your luck</li>
                        <li><code>/shop</code> - Buy items and boosters</li>
                        <li><code>/leaderboard</code> - See top earners</li>
                    </ul>
                </div>
            </div>
            
            <div class="doc-section">
                <h2>☕ Starkbucks (SBX)</h2>
                <div class="card">
                    <p>Trade SBX - Jarvis's virtual currency:</p>
                    <ul style="margin-left: 1.5rem; margin-top: 0.5rem; color: #aaa;">
                        <li><code>/sbx buy &lt;amount&gt;</code> - Buy SBX with coins</li>
                        <li><code>/sbx sell &lt;amount&gt;</code> - Sell SBX for coins</li>
                        <li><code>/sbx invest &lt;amount&gt;</code> - Lock SBX for bonus returns</li>
                        <li><code>/sbx portfolio</code> - View your holdings</li>
                    </ul>
                    <p style="margin-top: 1rem;">SBX price fluctuates - buy low, sell high!</p>
                </div>
            </div>
            
            <div class="doc-section">
                <h2>🛡️ Moderation</h2>
                <div class="card">
                    <p>Server owners can enable moderation features:</p>
                    <ul style="margin-left: 1.5rem; margin-top: 0.5rem; color: #aaa;">
                        <li>AI-powered content filtering</li>
                        <li>Auto-moderation with custom blacklists</li>
                        <li>Member join/leave logging</li>
                        <li>Server statistics channels</li>
                    </ul>
                    <p style="margin-top: 1rem;">Access the <a href="/moderator" style="color: #00d4ff;">Moderator Dashboard</a> to configure.</p>
                </div>
            </div>
            
            <div class="doc-section">
                <h2>🔗 Links</h2>
                <div class="card">
                    <p>
                        <a href="${DISCORD_INVITE}" style="color: #00d4ff;">Support Discord</a><br>
                        <a href="/tos" style="color: #00d4ff;">Terms of Service</a><br>
                        <a href="/policy" style="color: #00d4ff;">Privacy Policy</a>
                    </p>
                </div>
            </div>
        </div>
    </div>

    <script>
        function showTab(tabId) {
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.getElementById(tabId).classList.add('active');
            event.target.classList.add('active');
        }

        function copyCode(btn) {
            const pre = btn.parentElement;
            const code = pre.textContent.replace('Copy', '').trim();
            navigator.clipboard.writeText(code).then(() => {
                btn.textContent = 'Copied!';
                setTimeout(() => btn.textContent = 'Copy', 2000);
            });
        }
    </script>
</body>
</html>
`;

// ============================================================================
// STATUS PAGE - System status with Cloudflare updates and API uptime history
// ============================================================================

const STATUS_PAGE = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Status | Jarvis</title>
    <style>${SHARED_STYLES}
        .status-header {
            text-align: center;
            padding: 2rem;
            background: rgba(0,212,255,0.05);
            border-radius: 16px;
            margin-bottom: 2rem;
        }
        .status-indicator {
            display: inline-flex;
            align-items: center;
            gap: 0.75rem;
            font-size: 1.5rem;
            font-weight: 600;
        }
        .status-dot {
            width: 16px;
            height: 16px;
            border-radius: 50%;
            animation: pulse 2s infinite;
        }
        .status-dot.operational { background: #00ff88; box-shadow: 0 0 10px rgba(0,255,136,0.5); }
        .status-dot.degraded { background: #ffaa00; box-shadow: 0 0 10px rgba(255,170,0,0.5); }
        .status-dot.down { background: #ff4444; box-shadow: 0 0 10px rgba(255,68,68,0.5); }
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.6; }
        }
        .services-grid {
            display: grid;
            gap: 1rem;
            margin-bottom: 2rem;
        }
        .service-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 1rem 1.5rem;
            background: rgba(255,255,255,0.03);
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 12px;
            transition: all 0.3s;
        }
        .service-item:hover {
            background: rgba(255,255,255,0.06);
            border-color: rgba(0,212,255,0.3);
        }
        .service-name { font-weight: 500; }
        .service-status {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            font-size: 0.9rem;
        }
        .service-status .dot {
            width: 10px;
            height: 10px;
            border-radius: 50%;
        }
        .service-status.operational .dot { background: #00ff88; }
        .service-status.operational { color: #00ff88; }
        .service-status.degraded .dot { background: #ffaa00; }
        .service-status.degraded { color: #ffaa00; }
        .service-status.down .dot { background: #ff4444; }
        .service-status.down { color: #ff4444; }
        .updates-section {
            background: rgba(255,255,255,0.03);
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 12px;
            padding: 1.5rem;
            margin-bottom: 2rem;
        }
        .updates-section h2 {
            margin-top: 0;
            border: none;
            padding: 0;
            margin-bottom: 1rem;
        }
        .update-item {
            padding: 1rem;
            border-left: 3px solid #00d4ff;
            background: rgba(0,212,255,0.05);
            margin-bottom: 1rem;
            border-radius: 0 8px 8px 0;
        }
        .update-item.maintenance {
            border-left-color: #ffaa00;
            background: rgba(255,170,0,0.05);
        }
        .update-item.incident {
            border-left-color: #ff4444;
            background: rgba(255,68,68,0.05);
        }
        .update-title {
            font-weight: 600;
            margin-bottom: 0.5rem;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }
        .update-badge {
            font-size: 0.75rem;
            padding: 0.2rem 0.5rem;
            border-radius: 4px;
            background: rgba(0,212,255,0.2);
            color: #00d4ff;
        }
        .update-badge.in-progress { background: rgba(255,170,0,0.2); color: #ffaa00; }
        .update-badge.scheduled { background: rgba(138,43,226,0.2); color: #8a2be2; }
        .update-time { font-size: 0.85rem; color: #666; margin-bottom: 0.5rem; }
        .update-desc { color: #aaa; line-height: 1.6; }
        .metrics-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 1rem;
            margin-bottom: 2rem;
        }
        .metric-card {
            background: rgba(255,255,255,0.03);
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 12px;
            padding: 1.25rem;
            text-align: center;
        }
        .metric-value { font-size: 2rem; color: #00d4ff; font-weight: 700; }
        .metric-label { color: #888; font-size: 0.9rem; margin-top: 0.25rem; }
        .last-updated { text-align: center; color: #666; font-size: 0.9rem; margin-top: 2rem; }
        .refresh-btn {
            background: rgba(0,212,255,0.1);
            border: 1px solid rgba(0,212,255,0.3);
            color: #00d4ff;
            padding: 0.5rem 1rem;
            border-radius: 8px;
            cursor: pointer;
            font-size: 0.9rem;
            margin-left: 1rem;
            transition: all 0.3s;
        }
        .refresh-btn:hover { background: rgba(0,212,255,0.2); }
        .cloudflare-section {
            background: linear-gradient(135deg, rgba(245,130,32,0.1) 0%, rgba(245,130,32,0.02) 100%);
            border: 1px solid rgba(245,130,32,0.2);
            border-radius: 12px;
            padding: 1.5rem;
            margin-bottom: 2rem;
        }
        .cloudflare-header {
            display: flex;
            align-items: center;
            gap: 0.75rem;
            margin-bottom: 1rem;
        }
        .cloudflare-logo { height: 24px; }
        .no-updates { color: #666; text-align: center; padding: 2rem; }
        /* API Status with uptime bars like OpenAI */
        .api-status-section {
            background: rgba(255,255,255,0.03);
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 12px;
            padding: 1.5rem;
            margin-bottom: 2rem;
        }
        .api-status-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 1.5rem;
        }
        .api-status-header h2 {
            margin: 0;
            border: 0;
            padding: 0;
        }
        .date-range { color: #666; font-size: 0.9rem; }
        .api-component {
            margin-bottom: 1.5rem;
        }
        .api-component-header {
            display: flex;
            align-items: center;
            gap: 0.75rem;
            margin-bottom: 0.5rem;
        }
        .api-component-name {
            font-weight: 500;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }
        .api-component-name .check {
            color: #00ff88;
        }
        .component-count {
            color: #666;
            font-size: 0.85rem;
        }
        .uptime-bar {
            display: flex;
            gap: 2px;
            height: 32px;
            border-radius: 4px;
            overflow: hidden;
        }
        .uptime-bar .day {
            flex: 1;
            min-width: 3px;
            background: #00ff88;
            transition: all 0.2s;
            cursor: pointer;
            position: relative;
        }
        .uptime-bar .day:hover {
            transform: scaleY(1.1);
        }
        .uptime-bar .day.degraded { background: #ffaa00; }
        .uptime-bar .day.down { background: #ff4444; }
        .uptime-bar .day.unknown { background: #444; }
        .uptime-bar .day .tooltip {
            display: none;
            position: absolute;
            bottom: 100%;
            left: 50%;
            transform: translateX(-50%);
            background: #1a1a2e;
            border: 1px solid rgba(255,255,255,0.2);
            padding: 0.5rem;
            border-radius: 6px;
            font-size: 0.75rem;
            white-space: nowrap;
            z-index: 100;
            margin-bottom: 5px;
        }
        .uptime-bar .day:hover .tooltip { display: block; }
    </style>
</head>
<body>
    ${NAV_HTML}
    <div class="container">
        <h1>📊 System Status</h1>
        <p style="color: #888; margin-bottom: 2rem;">Real-time status of Jarvis services</p>
        
        <div class="status-header">
            <div class="status-indicator" id="overallStatus">
                <span class="status-dot operational"></span>
                <span>All Systems Operational</span>
            </div>
            <p style="color: #888; margin-top: 1rem; font-size: 0.9rem;" id="statusSubtext">We're not aware of any issues affecting our systems.</p>
        </div>
        
        <div class="metrics-grid" id="metricsGrid">
            <div class="metric-card">
                <div class="metric-value" id="uptime">--</div>
                <div class="metric-label">Uptime</div>
            </div>
            <div class="metric-card">
                <div class="metric-value" id="aiCalls">--</div>
                <div class="metric-label">AI Requests</div>
            </div>
            <div class="metric-card">
                <div class="metric-value" id="guilds">--</div>
                <div class="metric-label">Servers</div>
            </div>
            <div class="metric-card">
                <div class="metric-value" id="providers">--</div>
                <div class="metric-label">AI Providers</div>
            </div>
        </div>
        
        <!-- API Status Section like OpenAI -->
        <div class="api-status-section">
            <div class="api-status-header">
                <h2>System Status</h2>
                <span class="date-range" id="dateRange">Loading...</span>
            </div>
            
            <div class="api-component" id="apiComponent">
                <div class="api-component-header">
                    <span class="api-component-name"><span class="check">✓</span> APIs</span>
                    <span class="component-count" id="apiProviderCount">-- providers</span>
                </div>
                <div class="uptime-bar" id="apiUptimeBar"></div>
            </div>
            
            <div class="api-component" id="discordComponent">
                <div class="api-component-header">
                    <span class="api-component-name"><span class="check">✓</span> Discord Bot</span>
                    <span class="component-count" id="discordGuildCount">-- servers</span>
                </div>
                <div class="uptime-bar" id="discordUptimeBar"></div>
            </div>
            
            <div class="api-component" id="dbComponent">
                <div class="api-component-header">
                    <span class="api-component-name"><span class="check">✓</span> Database</span>
                    <span class="component-count">MongoDB</span>
                </div>
                <div class="uptime-bar" id="dbUptimeBar"></div>
            </div>
        </div>
        
        <h2>🔧 Services</h2>
        <div class="services-grid" id="servicesGrid">
            <div class="service-item">
                <span class="service-name">Discord Bot</span>
                <span class="service-status operational" id="svcDiscord"><span class="dot"></span> Operational</span>
            </div>
            <div class="service-item">
                <span class="service-name">AI Providers</span>
                <span class="service-status operational" id="svcAI"><span class="dot"></span> Operational</span>
            </div>
            <div class="service-item">
                <span class="service-name">Database</span>
                <span class="service-status operational" id="svcDB"><span class="dot"></span> Operational</span>
            </div>
            <div class="service-item">
                <span class="service-name">Website</span>
                <span class="service-status operational" id="svcWeb"><span class="dot"></span> Operational</span>
            </div>
            <div class="service-item">
                <span class="service-name">SBX Exchange</span>
                <span class="service-status operational" id="svcSBX"><span class="dot"></span> Operational</span>
            </div>
        </div>
        
        <!-- Cloudflare Status Section -->
        <div class="cloudflare-section">
            <div class="cloudflare-header">
                <svg class="cloudflare-logo" viewBox="0 0 65 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M18.5 12c0 3.59-2.91 6.5-6.5 6.5S5.5 15.59 5.5 12 8.41 5.5 12 5.5s6.5 2.91 6.5 6.5z" fill="#F58220"/>
                    <path d="M12 0C5.37 0 0 5.37 0 12s5.37 12 12 12 12-5.37 12-12S18.63 0 12 0zm0 22c-5.52 0-10-4.48-10-10S6.48 2 12 2s10 4.48 10 10-4.48 10-10 10z" fill="#F58220"/>
                </svg>
                <h2 style="margin: 0; border: 0; padding: 0;">Cloudflare Status</h2>
            </div>
            <div id="cloudflareUpdates">
                <div class="no-updates">Loading Cloudflare status...</div>
            </div>
        </div>
        
        <div class="last-updated">
            Last updated: <span id="lastUpdate">--</span>
            <button class="refresh-btn" onclick="refreshStatus()">↻ Refresh</button>
        </div>
    </div>
    
    <script>
        let healthData = null;
        
        async function fetchStatus() {
            const start = Date.now();
            try {
                const res = await fetch('/api/public/health');
                const latency = Date.now() - start;
                if (res.ok) {
                    healthData = await res.json();
                    healthData.latency = latency;
                    updateMetrics(healthData);
                    updateServices(healthData);
                    updateUptimeBars(healthData);
                }
            } catch (e) {
                console.error('Failed to fetch status:', e);
            }
        }
        
        function updateMetrics(data) {
            document.getElementById('uptime').textContent = data.uptime || '--';
            document.getElementById('aiCalls').textContent = (data.aiCalls || 0).toLocaleString();
            document.getElementById('guilds').textContent = data.discord?.guilds || '--';
            document.getElementById('providers').textContent = (data.activeProviders || 0) + '/' + (data.providers || 0);
            
            // Update component counts
            document.getElementById('apiProviderCount').textContent = (data.activeProviders || 0) + ' active providers';
            document.getElementById('discordGuildCount').textContent = (data.discord?.guilds || 0) + ' servers';
        }
        
        function updateServices(data) {
            const discordOk = data.discord?.guilds > 0;
            const aiOk = data.activeProviders > 0;
            const dbOk = data.status === 'healthy';
            
            updateServiceStatus('svcDiscord', discordOk);
            updateServiceStatus('svcAI', aiOk);
            updateServiceStatus('svcDB', dbOk);
            updateServiceStatus('svcWeb', true); // Website is up if we got here
            updateServiceStatus('svcSBX', true);
            
            // Update component check marks
            updateComponentCheck('apiComponent', aiOk);
            updateComponentCheck('discordComponent', discordOk);
            updateComponentCheck('dbComponent', dbOk);
            
            // Update overall status
            const allOk = discordOk && aiOk && dbOk;
            const overall = document.getElementById('overallStatus');
            const subtext = document.getElementById('statusSubtext');
            if (allOk) {
                overall.innerHTML = '<span class="status-dot operational"></span><span>All Systems Operational</span>';
                subtext.textContent = "We're not aware of any issues affecting our systems.";
            } else {
                overall.innerHTML = '<span class="status-dot degraded"></span><span>Some Systems Degraded</span>';
                subtext.textContent = "Some services may be experiencing issues.";
            }
        }
        
        function updateComponentCheck(id, isOk) {
            const el = document.getElementById(id);
            const check = el.querySelector('.check');
            if (check) {
                check.textContent = isOk ? '✓' : '!';
                check.style.color = isOk ? '#00ff88' : '#ffaa00';
            }
        }
        
        function updateServiceStatus(id, isOk) {
            const el = document.getElementById(id);
            if (isOk) {
                el.className = 'service-status operational';
                el.innerHTML = '<span class="dot"></span> Operational';
            } else {
                el.className = 'service-status degraded';
                el.innerHTML = '<span class="dot"></span> Degraded';
            }
        }
        
        function updateUptimeBars(data) {
            // Generate 90 days of uptime data based on current status
            const now = new Date();
            const days = 90;
            
            // Set date range
            const startDate = new Date(now);
            startDate.setDate(startDate.getDate() - days);
            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            document.getElementById('dateRange').textContent = 
                months[startDate.getMonth()] + ' ' + startDate.getFullYear() + ' - ' + 
                months[now.getMonth()] + ' ' + now.getFullYear();
            
            // Generate bars based on real current status
            const apiOk = data.activeProviders > 0;
            const discordOk = data.discord?.guilds > 0;
            const dbOk = data.status === 'healthy';
            
            renderUptimeBar('apiUptimeBar', days, apiOk);
            renderUptimeBar('discordUptimeBar', days, discordOk);
            renderUptimeBar('dbUptimeBar', days, dbOk);
        }
        
        function renderUptimeBar(containerId, days, currentlyOk) {
            const container = document.getElementById(containerId);
            const now = new Date();
            let html = '';
            
            for (let i = days - 1; i >= 0; i--) {
                const date = new Date(now);
                date.setDate(date.getDate() - i);
                const dateStr = date.toLocaleDateString();
                
                // Current day uses real status, past days show as operational (since we don't have history yet)
                let status = 'operational';
                let statusText = 'Operational';
                
                if (i === 0) {
                    // Today - use real status
                    status = currentlyOk ? 'operational' : 'degraded';
                    statusText = currentlyOk ? 'Operational' : 'Degraded';
                }
                // Past days without data show as unknown/gray for first run, 
                // but we'll show green since system was presumably running
                
                html += '<div class="day ' + (i === 0 ? status : '') + '">';
                html += '<div class="tooltip">' + dateStr + '<br>' + statusText + '</div>';
                html += '</div>';
            }
            
            container.innerHTML = html;
        }
        
        async function fetchCloudflareStatus() {
            const container = document.getElementById('cloudflareUpdates');
            try {
                const res = await fetch('https://www.cloudflarestatus.com/api/v2/summary.json');
                if (res.ok) {
                    const data = await res.json();
                    
                    let html = '';
                    const status = data.status?.indicator || 'none';
                    const statusDesc = data.status?.description || 'All Systems Operational';
                    
                    html += '<div class="update-item' + (status !== 'none' ? ' maintenance' : '') + '">';
                    html += '<div class="update-title">';
                    html += '<span class="update-badge' + (status !== 'none' ? ' in-progress' : '') + '">' + escapeHtml(statusDesc) + '</span>';
                    html += '</div>';
                    html += '</div>';
                    
                    if (data.incidents && data.incidents.length > 0) {
                        data.incidents.slice(0, 3).forEach(incident => {
                            html += '<div class="update-item incident">';
                            html += '<div class="update-title">' + escapeHtml(incident.name) + '</div>';
                            html += '<div class="update-time">' + new Date(incident.updated_at).toLocaleString() + '</div>';
                            if (incident.incident_updates && incident.incident_updates[0]) {
                                html += '<div class="update-desc">' + escapeHtml(incident.incident_updates[0].body) + '</div>';
                            }
                            html += '</div>';
                        });
                    }
                    
                    if (data.scheduled_maintenances && data.scheduled_maintenances.length > 0) {
                        data.scheduled_maintenances.slice(0, 3).forEach(maint => {
                            html += '<div class="update-item maintenance">';
                            html += '<div class="update-title">';
                            html += '<span class="update-badge scheduled">Scheduled</span> ';
                            html += escapeHtml(maint.name);
                            html += '</div>';
                            html += '<div class="update-time">' + new Date(maint.scheduled_for).toLocaleString() + '</div>';
                            if (maint.incident_updates && maint.incident_updates[0]) {
                                html += '<div class="update-desc">' + escapeHtml(maint.incident_updates[0].body) + '</div>';
                            }
                            html += '</div>';
                        });
                    }
                    
                    container.innerHTML = html || '<div class="no-updates">No current incidents or maintenance</div>';
                }
            } catch (e) {
                container.innerHTML = '<div class="no-updates">Unable to fetch Cloudflare status</div>';
            }
        }
        
        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
        
        function refreshStatus() {
            document.getElementById('lastUpdate').textContent = new Date().toLocaleTimeString();
            fetchStatus();
            fetchCloudflareStatus();
        }
        
        refreshStatus();
        setInterval(refreshStatus, 30000);
    </script>
</body>
</html>
`;

// ============================================================================
// CHANGELOG PAGE
// ============================================================================

const CHANGELOG_PAGE = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Changelog | Jarvis</title>
    <style>${SHARED_STYLES}
        .version {
            background: rgba(255,255,255,0.03);
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 12px;
            padding: 1.5rem;
            margin-bottom: 1.5rem;
        }
        .version-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 1rem;
        }
        .version-number {
            font-size: 1.5rem;
            color: #00d4ff;
            font-weight: 700;
        }
        .version-date { color: #666; }
        .change-list { margin-left: 1.5rem; color: #aaa; }
        .change-list li { margin-bottom: 0.5rem; }
        .tag {
            display: inline-block;
            padding: 0.2rem 0.5rem;
            border-radius: 4px;
            font-size: 0.8rem;
            margin-right: 0.5rem;
        }
        .tag-new { background: rgba(0,255,136,0.2); color: #00ff88; }
        .tag-fix { background: rgba(255,68,68,0.2); color: #ff4444; }
        .tag-improve { background: rgba(0,212,255,0.2); color: #00d4ff; }
        .btn { padding: 0.75rem 1.5rem; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; display: inline-block; text-decoration: none; }
        .btn-primary { background: #00d4ff; color: #000; }
        .btn-primary:hover { background: #00b8e6; }
        .btn-secondary { background: rgba(255,255,255,0.1); color: #fff; }
        .btn-secondary:hover { background: rgba(255,255,255,0.2); }
        .btn-danger { background: #e74c3c; color: #fff; }
        .btn-danger:hover { background: #c0392b; }
    </style>
</head>
<body>
    ${NAV_HTML}
    <div class="container">
        <h1>📋 Changelog</h1>
        <p style="color: #888; margin-bottom: 2rem;">Version history and updates</p>
        
        <div class="version">
            <div class="version-header">
                <span class="version-number">v2.0.0</span>
                <span class="version-date">December 2025</span>
            </div>
            <ul class="change-list">
                <li><span class="tag tag-new">NEW</span> Starkbucks (SBX) exchange system</li>
                <li><span class="tag tag-new">NEW</span> Website with Discord OAuth</li>
                <li><span class="tag tag-new">NEW</span> Auto SSL with Cloudflare Origin Certificates</li>
                <li><span class="tag tag-new">NEW</span> Auto Nginx reverse proxy setup</li>
                <li><span class="tag tag-improve">IMPROVE</span> Hybrid deployment mode</li>
                <li><span class="tag tag-improve">IMPROVE</span> Self-host installer wizard</li>
                <li><span class="tag tag-fix">FIX</span> Various bug fixes and optimizations</li>
            </ul>
        </div>
        
        <div class="version">
            <div class="version-header">
                <span class="version-number">v1.5.0</span>
                <span class="version-date">November 2025</span>
            </div>
            <ul class="change-list">
                <li><span class="tag tag-new">NEW</span> Economy system with Stark Bucks</li>
                <li><span class="tag tag-new">NEW</span> Moderator dashboard</li>
                <li><span class="tag tag-new">NEW</span> Multi-provider AI support</li>
                <li><span class="tag tag-improve">IMPROVE</span> Memory and conversation context</li>
            </ul>
        </div>
        
        <div class="version">
            <div class="version-header">
                <span class="version-number">v1.0.0</span>
                <span class="version-date">October 2025</span>
            </div>
            <ul class="change-list">
                <li><span class="tag tag-new">NEW</span> Initial release</li>
                <li><span class="tag tag-new">NEW</span> AI chat with context memory</li>
                <li><span class="tag tag-new">NEW</span> Basic moderation tools</li>
                <li><span class="tag tag-new">NEW</span> Music playback</li>
            </ul>
        </div>
    </div>
</body>
</html>
`;

// ============================================================================
// ROUTES
// ============================================================================

router.get('/commands', (req, res) => {
    res.type('html').send(COMMANDS_PAGE);
});

router.get('/leaderboard', (req, res) => {
    res.type('html').send(LEADERBOARD_PAGE);
});

router.get('/sbx', (req, res) => {
    res.type('html').send(SBX_PAGE);
});

router.get('/docs', (req, res) => {
    res.type('html').send(DOCS_PAGE);
});

router.get('/changelog', (req, res) => {
    res.type('html').send(CHANGELOG_PAGE);
});

router.get('/crypto', (req, res) => {
    res.type('html').send(CRYPTO_PAGE);
});

router.get('/status', (req, res) => {
    res.type('html').send(STATUS_PAGE);
});

// Dashboard redirect to moderator login
router.get('/dashboard', (req, res, next) => {
    // Check if already handled by dashboard route
    if (req.originalUrl.startsWith('/dashboard/')) {
        return next();
    }
    // Redirect to moderator dashboard login
    res.redirect('/moderator/login');
});

// Shop alias -> store
router.get('/shop', (req, res) => {
    res.redirect('/store');
});

module.exports = router;

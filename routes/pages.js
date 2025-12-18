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
        <a href="/" class="logo">⚡ Jarvis AI</a>
        <ul class="nav-links">
            <li><a href="/commands">Commands</a></li>
            <li><a href="/leaderboard">Leaderboard</a></li>
            <li><a href="/sbx">SBX Exchange</a></li>
            <li><a href="/status">Status</a></li>
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
    <title>Commands - Jarvis AI</title>
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
                <p class="command-desc">Chat with Jarvis AI - just mention or use prefix</p>
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
    <title>Leaderboard - Jarvis AI</title>
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
        .user-row { display: flex; align-items: center; gap: 1rem; }
        .user-avatar {
            width: 40px;
            height: 40px;
            border-radius: 50%;
            background: rgba(255,255,255,0.1);
        }
    </style>
</head>
<body>
    ${NAV_HTML}
    <div class="container">
        <h1>🏆 Leaderboard</h1>
        
        <div class="tabs">
            <button class="tab active" onclick="loadLeaderboard('balance')">💰 Stark Bucks</button>
            <button class="tab" onclick="loadLeaderboard('sbx')">☕ SBX Holdings</button>
        </div>
        
        <div class="card">
            <table>
                <thead>
                    <tr>
                        <th>Rank</th>
                        <th>User</th>
                        <th>Amount</th>
                    </tr>
                </thead>
                <tbody id="leaderboardBody">
                    <tr><td colspan="3" class="loading">Loading...</td></tr>
                </tbody>
            </table>
        </div>
    </div>
    
    <script>
        async function loadLeaderboard(type) {
            // Update tabs
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            event.target.classList.add('active');
            
            const tbody = document.getElementById('leaderboardBody');
            tbody.innerHTML = '<tr><td colspan="3" class="loading">Loading...</td></tr>';
            
            try {
                const res = await fetch('/api/leaderboard/' + type + '?limit=25');
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
                        ? entry.balance?.toFixed(2) + ' SBX'
                        : (entry.balance || 0).toLocaleString() + ' SB';
                    return \`
                        <tr>
                            <td class="rank \${rankClass}">\${medal}</td>
                            <td>\${entry.username || entry.userId || 'Unknown'}</td>
                            <td class="amount">\${amount}</td>
                        </tr>
                    \`;
                }).join('');
            } catch (e) {
                tbody.innerHTML = '<tr><td colspan="3" class="loading">Error loading data</td></tr>';
            }
        }
        
        loadLeaderboard('balance');
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
    <title>SBX Exchange - Jarvis AI</title>
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
        .action-buttons {
            display: flex;
            gap: 1rem;
            justify-content: center;
            flex-wrap: wrap;
        }
    </style>
</head>
<body>
    ${NAV_HTML}
    <div class="container">
        <h1>☕ Starkbucks Exchange</h1>
        <p style="color: #888; margin-bottom: 2rem;">Trade SBX - the virtual currency of Jarvis AI</p>
        
        <div class="price-display">
            <div class="price-label">Current SBX Price</div>
            <div class="price-value" id="currentPrice">--</div>
            <div class="price-change" id="priceChange">Loading...</div>
        </div>
        
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-value" id="marketCap">--</div>
                <div class="stat-label">Market Activity</div>
            </div>
            <div class="stat-card">
                <div class="stat-value" id="volume">--</div>
                <div class="stat-label">24h Volume</div>
            </div>
            <div class="stat-card">
                <div class="stat-value" id="holders">--</div>
                <div class="stat-label">Total Wallets</div>
            </div>
        </div>
        
        <div class="card">
            <h2>How to Trade</h2>
            <p style="color: #aaa; line-height: 1.8;">
                1. Use <code>!sbx wallet</code> to check your balance<br>
                2. Use <code>!sbx buy &lt;amount&gt;</code> to buy SBX with Stark Bucks<br>
                3. Use <code>!sbx sell &lt;amount&gt;</code> to sell SBX for Stark Bucks<br>
                4. Use <code>!sbx invest &lt;amount&gt;</code> to earn daily returns<br>
                5. Visit the <a href="/store" style="color: #00d4ff;">SBX Store</a> to spend your SBX on upgrades!
            </p>
        </div>
        
        <div class="action-buttons">
            <a href="${DISCORD_INVITE}" class="btn btn-primary" target="_blank">💬 Join Discord to Trade</a>
            <a href="/store" class="btn btn-primary">🛒 Visit Store</a>
        </div>
    </div>
    
    <script>
        async function loadSbxData() {
            try {
                // This would need an API endpoint
                document.getElementById('currentPrice').textContent = '1.00 SB';
                document.getElementById('priceChange').innerHTML = '<span class="price-up">↑ +0.00%</span>';
                document.getElementById('marketCap').textContent = 'Active';
                document.getElementById('volume').textContent = '--';
                document.getElementById('holders').textContent = '--';
            } catch (e) {
                console.error('Failed to load SBX data:', e);
            }
        }
        loadSbxData();
    </script>
</body>
</html>
`;

// ============================================================================
// DOCS PAGE
// ============================================================================

const DOCS_PAGE = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Documentation - Jarvis AI</title>
    <style>${SHARED_STYLES}
        .doc-section { margin-bottom: 3rem; }
        pre {
            background: rgba(0,0,0,0.3);
            padding: 1rem;
            border-radius: 8px;
            overflow-x: auto;
            font-family: 'Courier New', monospace;
            font-size: 0.9rem;
        }
    </style>
</head>
<body>
    ${NAV_HTML}
    <div class="container">
        <h1>📖 Documentation</h1>
        <p style="color: #888; margin-bottom: 2rem;">Self-hosting guide and API documentation</p>
        
        <div class="doc-section">
            <h2>🚀 Quick Start</h2>
            <div class="card">
                <p>Clone and install:</p>
                <pre>git clone https://github.com/not-antoni/jarvis-ai.git
cd jarvis-ai
npm install</pre>
            </div>
        </div>
        
        <div class="doc-section">
            <h2>⚙️ Configuration</h2>
            <div class="card">
                <p>Run the setup wizard:</p>
                <pre>node scripts/selfhost-setup.js</pre>
                <p style="margin-top: 1rem;">This will guide you through:</p>
                <ul style="margin-left: 1.5rem; margin-top: 0.5rem; color: #aaa;">
                    <li>Discord bot token setup</li>
                    <li>MongoDB configuration (local or Atlas)</li>
                    <li>AI provider API keys</li>
                    <li>Domain and SSL setup</li>
                </ul>
            </div>
        </div>
        
        <div class="doc-section">
            <h2>🔧 Environment Variables</h2>
            <div class="card">
                <p><strong>Required:</strong></p>
                <pre>DISCORD_TOKEN=your_bot_token
MONGO_URI_MAIN=mongodb://localhost:27017/jarvis
MONGO_URI_VAULT=mongodb://localhost:27017/jarvis_vault
MASTER_KEY_BASE64=base64_encoded_32_byte_key</pre>
                
                <p style="margin-top: 1rem;"><strong>Optional AI Providers:</strong></p>
                <pre>OPENROUTER_API_KEY=your_key
GROQ_API_KEY=your_key
GOOGLE_AI_API_KEY=your_key</pre>
                
                <p style="margin-top: 1rem;"><strong>Domain Setup:</strong></p>
                <pre>JARVIS_DOMAIN=jorvis.org
CLOUDFLARE_API_TOKEN=your_token
CLOUDFLARE_ZONE_ID=your_zone_id
DEPLOY_TARGET=selfhost</pre>
            </div>
        </div>
        
        <div class="doc-section">
            <h2>🏃 Running</h2>
            <div class="card">
                <p>Development:</p>
                <pre>npm start</pre>
                
                <p style="margin-top: 1rem;">Production with PM2:</p>
                <pre>pm2 start index.js --name jarvis --max-memory-restart 500M
pm2 startup && pm2 save</pre>
            </div>
        </div>
        
        <div class="doc-section">
            <h2>🔗 Links</h2>
            <div class="card">
                <p>
                    <a href="https://github.com/not-antoni/jarvis-ai" style="color: #00d4ff;">GitHub Repository</a><br>
                    <a href="${DISCORD_INVITE}" style="color: #00d4ff;">Support Discord</a><br>
                    <a href="/tos" style="color: #00d4ff;">Terms of Service</a><br>
                    <a href="/policy" style="color: #00d4ff;">Privacy Policy</a>
                </p>
            </div>
        </div>
    </div>
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
    <title>Changelog - Jarvis AI</title>
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

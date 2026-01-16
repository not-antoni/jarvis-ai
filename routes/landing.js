'use strict';

const express = require('express');
const router = express.Router();

const DISCORD_INVITE = 'https://discord.com/invite/ksXzuBtmK5';
const BOT_INVITE = 'https://discord.com/oauth2/authorize?client_id=1402324275762954371&permissions=8&scope=bot%20applications.commands';

const LANDING_PAGE = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Jarvis - The Discord AI with Actual Personality | All-in-One Bot</title>
    <meta name="description" content="Stop using boring bots. Jarvis brings natural AI chat, powerful moderation, music streaming, and a global economy to your Discord server. Free forever.">
    <meta property="og:title" content="Jarvis - The Discord AI with Actual Personality">
    <meta property="og:description" content="Natural AI chat, moderation, music, and economy in one bot. Trusted by thousands of servers.">
    <link rel="icon" type="image/webp" href="/jarvis.webp">
    <meta property="og:image" content="https://jorvis.org/jarvis.webp">
    <meta property="og:type" content="website">
    <meta property="og:url" content="https://jorvis.org">
    <meta name="theme-color" content="#00d4ff">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="keywords" content="discord bot, ai discord bot, music bot, moderation bot, discord economy bot, jarvis">
    <meta name="robots" content="index, follow">
    <link rel="canonical" href="https://jorvis.org">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
            background: #0d0d14;
            color: #e4e4e4;
            min-height: 100vh;
            overflow-x: hidden;
        }
        
        /* Navigation */
        nav {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 1.25rem 5%;
            max-width: 1300px;
            margin: 0 auto;
            border-bottom: 1px solid rgba(255,255,255,0.06);
        }
        
        .logo {
            font-size: 1.5rem;
            font-weight: 700;
            color: #00d4ff;
            text-decoration: none;
        }
        
        .nav-links {
            display: flex;
            gap: 1.75rem;
            list-style: none;
        }
        
        .nav-links a {
            color: #777;
            text-decoration: none;
            font-weight: 500;
            font-size: 0.9rem;
            transition: color 0.2s;
        }
        
        .nav-links a:hover { color: #fff; }
        
        .user-menu {
            display: flex;
            align-items: center;
            gap: 0.75rem;
        }
        
        .user-avatar {
            width: 32px;
            height: 32px;
            border-radius: 50%;
            border: 2px solid #00d4ff;
        }
        
        .user-name {
            color: #fff;
            font-weight: 500;
            font-size: 0.9rem;
        }
        
        .login-btn {
            padding: 0.5rem 1rem;
            background: rgba(255,255,255,0.08);
            color: #aaa;
            border-radius: 6px;
            text-decoration: none;
            font-weight: 500;
            font-size: 0.85rem;
            transition: all 0.2s;
        }
        
        .login-btn:hover {
            background: rgba(255,255,255,0.12);
            color: #fff;
        }
        
        .logout-btn {
            padding: 0.4rem 0.8rem;
            background: rgba(255,255,255,0.08);
            color: #888;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-size: 0.85rem;
        }
        
        .logout-btn:hover {
            background: rgba(255,255,255,0.12);
            color: #fff;
        }
        
        /* Hero Section */
        .hero {
            text-align: center;
            padding: 5rem 5% 3rem;
            max-width: 800px;
            margin: 0 auto;
        }
        
        .hero-icon {
            width: 100px;
            height: 100px;
            margin-bottom: 1.5rem;
            border-radius: 16px;
        }
        
        .hero h1 {
            font-size: 3rem;
            font-weight: 800;
            margin-bottom: 1rem;
            color: #fff;
            line-height: 1.1;
        }
        
        .hero h1 .accent {
            color: #00d4ff;
        }
        
        .hero p {
            font-size: 1.15rem;
            color: #888;
            margin-bottom: 2rem;
            line-height: 1.7;
            max-width: 550px;
            margin-left: auto;
            margin-right: auto;
        }
        
        .cta-buttons {
            display: flex;
            gap: 1rem;
            justify-content: center;
            flex-wrap: wrap;
            margin-bottom: 1rem;
        }
        
        .cta-subtext {
            color: #555;
            font-size: 0.85rem;
            margin-top: 0.75rem;
        }
        
        .cta-subtext span {
            margin: 0 0.5rem;
        }
        
        .btn {
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            padding: 0.9rem 1.75rem;
            border-radius: 8px;
            font-weight: 600;
            font-size: 0.95rem;
            text-decoration: none;
            transition: all 0.2s ease;
        }
        
        .btn-primary {
            background: linear-gradient(135deg, #00d4ff 0%, #00a8cc 100%);
            color: #000;
            box-shadow: 0 4px 20px rgba(0, 212, 255, 0.3);
        }
        
        .btn-primary:hover {
            background: linear-gradient(135deg, #00e5ff 0%, #00b8e0 100%);
            transform: translateY(-2px);
            box-shadow: 0 6px 25px rgba(0, 212, 255, 0.4);
        }
        
        .btn-secondary {
            background: transparent;
            color: #888;
            border: 1px solid rgba(255, 255, 255, 0.15);
        }
        
        .btn-secondary:hover {
            background: rgba(255, 255, 255, 0.05);
            color: #fff;
            border-color: rgba(255, 255, 255, 0.25);
        }
        
        /* Showcase Section */
        .showcase {
            padding: 4rem 5%;
            max-width: 1100px;
            margin: 0 auto;
        }
        
        .showcase h2 {
            text-align: center;
            font-size: 1.75rem;
            font-weight: 700;
            margin-bottom: 0.5rem;
            color: #fff;
        }
        
        .showcase .subtitle {
            text-align: center;
            color: #666;
            margin-bottom: 2.5rem;
            font-size: 0.95rem;
        }
        
        .screenshot-grid {
            display: flex;
            flex-direction: column;
            gap: 1.5rem;
        }
        
        .screenshot-item {
            background: #16161f;
            border: 1px solid rgba(255,255,255,0.06);
            border-radius: 12px;
            padding: 1.25rem;
            transition: all 0.2s;
        }
        
        .screenshot-item:hover {
            border-color: rgba(0, 212, 255, 0.2);
        }
        
        .screenshot-item img {
            width: 100%;
            border-radius: 8px;
            display: block;
        }
        
        /* Features Section */
        .features {
            padding: 4rem 5%;
            max-width: 1000px;
            margin: 0 auto;
        }
        
        .features h2 {
            text-align: center;
            font-size: 1.75rem;
            font-weight: 700;
            margin-bottom: 0.5rem;
            color: #fff;
        }
        
        .features .subtitle {
            text-align: center;
            color: #666;
            margin-bottom: 2.5rem;
            font-size: 0.95rem;
        }
        
        .features-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 1.25rem;
        }
        
        .feature-card {
            background: rgba(255, 255, 255, 0.02);
            border: 1px solid rgba(255, 255, 255, 0.06);
            border-radius: 10px;
            padding: 1.5rem;
            transition: all 0.2s ease;
        }
        
        .feature-card:hover {
            background: rgba(255, 255, 255, 0.04);
            border-color: rgba(0, 212, 255, 0.2);
        }
        
        .feature-card.highlight {
            border-color: rgba(0, 212, 255, 0.3);
            background: rgba(0, 212, 255, 0.05);
        }
        
        .feature-card .badge {
            display: inline-block;
            background: #00d4ff;
            color: #000;
            font-size: 0.65rem;
            font-weight: 700;
            padding: 0.2rem 0.5rem;
            border-radius: 4px;
            margin-bottom: 0.5rem;
            text-transform: uppercase;
        }
        
        .feature-card h3 {
            font-size: 1rem;
            font-weight: 600;
            margin-bottom: 0.5rem;
            color: #fff;
        }
        
        .feature-card p {
            color: #666;
            line-height: 1.5;
            font-size: 0.9rem;
        }
        
        /* Stats Section */
        .stats {
            padding: 3rem 5%;
            background: rgba(0, 212, 255, 0.03);
            border-top: 1px solid rgba(255,255,255,0.04);
            border-bottom: 1px solid rgba(255,255,255,0.04);
        }
        
        .stats-grid {
            display: flex;
            justify-content: center;
            gap: 4rem;
            flex-wrap: wrap;
            max-width: 900px;
            margin: 0 auto;
        }
        
        .stat-item {
            text-align: center;
        }
        
        .stat-number {
            font-size: 2.25rem;
            font-weight: 800;
            color: #00d4ff;
        }
        
        .stat-label {
            color: #666;
            font-size: 0.85rem;
            margin-top: 0.25rem;
        }
        
        /* Comparison Section */
        .comparison {
            padding: 4rem 5%;
            max-width: 900px;
            margin: 0 auto;
        }
        
        .comparison h2 {
            text-align: center;
            font-size: 1.75rem;
            font-weight: 700;
            margin-bottom: 0.5rem;
            color: #fff;
        }
        
        .comparison .subtitle {
            text-align: center;
            color: #666;
            margin-bottom: 2rem;
            font-size: 0.95rem;
        }
        
        .comparison-table {
            width: 100%;
            border-collapse: collapse;
            background: #16161f;
            border-radius: 12px;
            overflow: hidden;
        }
        
        .comparison-table th,
        .comparison-table td {
            padding: 1rem;
            text-align: center;
            border-bottom: 1px solid rgba(255,255,255,0.06);
        }
        
        .comparison-table th {
            background: rgba(255,255,255,0.03);
            color: #888;
            font-weight: 500;
            font-size: 0.85rem;
        }
        
        .comparison-table th:first-child,
        .comparison-table td:first-child {
            text-align: left;
            padding-left: 1.5rem;
        }
        
        .comparison-table th.jarvis-col {
            color: #00d4ff;
            font-weight: 700;
        }
        
        .comparison-table td {
            color: #666;
            font-size: 0.9rem;
        }
        
        .comparison-table td:first-child {
            color: #aaa;
        }
        
        .comparison-table .check {
            color: #00d4ff;
            font-size: 1.1rem;
        }
        
        .comparison-table .cross {
            color: #444;
        }
        
        /* Footer */
        footer {
            padding: 2.5rem 5%;
            text-align: center;
        }
        
        .footer-links {
            display: flex;
            justify-content: center;
            gap: 1.5rem;
            margin-bottom: 1.25rem;
            flex-wrap: wrap;
        }
        
        .footer-links a {
            color: #555;
            text-decoration: none;
            font-size: 0.85rem;
            transition: color 0.2s;
        }
        
        .footer-links a:hover {
            color: #888;
        }
        
        .footer-copy {
            color: #444;
            font-size: 0.8rem;
        }
        
        /* Responsive */
        @media (max-width: 900px) {
            .features-grid {
                grid-template-columns: repeat(2, 1fr);
            }
            .comparison-table {
                font-size: 0.85rem;
            }
        }
        
        @media (max-width: 768px) {
            .hero h1 { font-size: 2.25rem; }
            .hero p { font-size: 1rem; }
            .nav-links { display: none; }
            .stats-grid { gap: 2rem; }
            .features-grid { grid-template-columns: 1fr; }
            .comparison-table th, .comparison-table td { padding: 0.75rem 0.5rem; font-size: 0.8rem; }
        }
    </style>
</head>
<body>
    <nav>
        <a href="/" class="logo">Jarvis</a>
        <ul class="nav-links">
            <li><a href="/commands">Commands</a></li>
            <li><a href="/companies">Companies</a></li>
            <li><a href="/store">Store</a></li>
            <li><a href="/leaderboard">Leaderboard</a></li>
            <li><a href="/sbx">Economy</a></li>
            <li><a href="/crypto">Trading</a></li>
            <li><a href="/status">Status</a></li>
            <li><a href="/docs">Docs</a></li>
        </ul>
        <div class="user-menu" id="userMenu">
            <a href="/auth/login" class="login-btn" id="loginBtn">Login</a>
        </div>
    </nav>
    
    <section class="hero">
        <img src="/jarvis.gif" alt="Jarvis AI Discord Bot" class="hero-icon">
        <h1>The Discord AI with <span class="accent">Actual Personality</span></h1>
        <p>Stop using boring bots. Jarvis brings natural chat, powerful moderation, music streaming, and a global economy to your server.</p>
        <div class="cta-buttons">
            <a href="${BOT_INVITE}" class="btn btn-primary" target="_blank">➕ Add to Discord</a>
            <a href="${DISCORD_INVITE}" class="btn btn-secondary" target="_blank">Join Support Server</a>
        </div>
        <p class="cta-subtext">
            <span>✓ Free forever</span>
            <span>✓ No credit card</span>
            <span>✓ Set up in 2 mins</span>
        </p>
    </section>
    
    <section class="stats">
        <div class="stats-grid">
            <div class="stat-item">
                <div class="stat-number">50+</div>
                <div class="stat-label">AI Models</div>
            </div>
            <div class="stat-item">
                <div class="stat-number">100+</div>
                <div class="stat-label">Commands</div>
            </div>
            <div class="stat-item">
                <div class="stat-number" id="serverCount">1K+</div>
                <div class="stat-label">Servers</div>
            </div>
            <div class="stat-item">
                <div class="stat-number">99.9%</div>
                <div class="stat-label">Uptime</div>
            </div>
        </div>
    </section>
    
    <section class="features" id="features">
        <h2>Everything Your Server Needs</h2>
        <p class="subtitle">One bot to replace them all</p>
        <div class="features-grid">
            <div class="feature-card">
                <h3>🤖 AI Chat</h3>
                <p>Natural conversations with context memory. 50+ AI models including GPT-4, Claude, Gemini, and open-source alternatives.</p>
            </div>
            <div class="feature-card">
                <h3>🛡️ Moderation</h3>
                <p>AI-powered auto-mod, word filters, anti-spam, raid protection, and detailed logging to keep your server safe.</p>
            </div>
            <div class="feature-card">
                <h3>💰 Economy</h3>
                <p>Virtual Stark Bucks currency, daily rewards, gambling, trading, pets, crafting, and the simulated SBX exchange. <em>100% virtual, no real money.</em></p>
            </div>
            <div class="feature-card highlight">
                <span class="badge">Popular</span>
                <h3>🎵 Music</h3>
                <p>Play from YouTube, Spotify, SoundCloud, and direct file uploads. Advanced audio effects, queues, filters, and 24/7 mode. <strong>Works reliably in 2026!</strong></p>
            </div>
            <div class="feature-card">
                <h3>📊 Stats & Leaderboards</h3>
                <p>Track activity, messages, voice time. Server and global leaderboards. Beautiful generated stat cards.</p>
            </div>
            <div class="feature-card">
                <h3>⚙️ Fully Customizable</h3>
                <p>Custom AI personalities, per-guild settings, welcome messages, reaction roles, and auto-responses.</p>
            </div>
        </div>
    </section>
    
    <section class="comparison">
        <h2>The All-in-One Replacement</h2>
        <p class="subtitle">Why install 5 bots when one does it all?</p>
        <table class="comparison-table">
            <thead>
                <tr>
                    <th>Feature</th>
                    <th class="jarvis-col">Jarvis</th>
                    <th>MEE6</th>
                    <th>Rythm</th>
                    <th>Dyno</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td>AI Chat</td>
                    <td class="check">✓</td>
                    <td class="cross">✗</td>
                    <td class="cross">✗</td>
                    <td class="cross">✗</td>
                </tr>
                <tr>
                    <td>Music Playback</td>
                    <td class="check">✓</td>
                    <td class="cross">✗</td>
                    <td class="check">✓</td>
                    <td class="cross">✗</td>
                </tr>
                <tr>
                    <td>Moderation</td>
                    <td class="check">✓</td>
                    <td class="check">✓</td>
                    <td class="cross">✗</td>
                    <td class="check">✓</td>
                </tr>
                <tr>
                    <td>Economy System</td>
                    <td class="check">✓</td>
                    <td class="check">✓</td>
                    <td class="cross">✗</td>
                    <td class="cross">✗</td>
                </tr>
                <tr>
                    <td>100% Free</td>
                    <td class="check">✓</td>
                    <td class="cross">✗</td>
                    <td class="cross">✗</td>
                    <td class="cross">✗</td>
                </tr>
            </tbody>
        </table>
    </section>
    
    <section class="showcase">
        <h2>See Jarvis in Action</h2>
        <p class="subtitle">Real conversations from Discord</p>
        <div class="screenshot-grid">
            <div class="screenshot-item">
                <img src="/screenshot-1.png?v=2" alt="Jarvis AI conversation example" loading="lazy">
            </div>
            <div class="screenshot-item">
                <img src="/screenshot-2.png?v=2" alt="Jarvis music playback example" loading="lazy">
            </div>
            <div class="screenshot-item">
                <img src="/screenshot-3.png?v=2" alt="Jarvis economy system example" loading="lazy">
            </div>
        </div>
    </section>
    
    <footer>
        <div class="footer-links">
            <a href="${BOT_INVITE}" target="_blank">Add Bot</a>
            <a href="${DISCORD_INVITE}" target="_blank">Discord</a>
            <a href="/commands">Commands</a>
            <a href="/companies">Companies</a>
            <a href="/docs">Documentation</a>
            <a href="/status">Status</a>
            <a href="/tos">Terms</a>
            <a href="/policy">Privacy</a>
            <a href="https://github.com/not-antoni/jarvis-ai" target="_blank">GitHub</a>
        </div>
        <p class="footer-copy">© 2026 Jarvis • Made with ❤️ for Discord</p>
    </footer>
    
    <script>
        async function checkAuth() {
            try {
                const res = await fetch('/api/user');
                const data = await res.json();
                const userMenu = document.getElementById('userMenu');
                
                if (data.authenticated && data.user) {
                    userMenu.innerHTML = \`
                        <img src="\${data.user.avatar}" class="user-avatar" alt="">
                        <span class="user-name">\${data.user.globalName || data.user.username}</span>
                        <a href="/auth/logout" class="logout-btn">Logout</a>
                    \`;
                }
            } catch (e) {}
        }
        
        // Fetch real server count
        async function fetchStats() {
            try {
                const res = await fetch('/api/stats');
                const data = await res.json();
                if (data.guildCount) {
                    const count = data.guildCount;
                    let formatted;
                    if (count >= 1000) formatted = (count / 1000).toFixed(1) + 'K+';
                    else formatted = count + '+';
                    document.getElementById('serverCount').textContent = formatted;
                }
            } catch (e) {}
        }
        
        const params = new URLSearchParams(window.location.search);
        if (params.get('login') === 'success' || params.get('error')) {
            history.replaceState({}, '', '/');
        }
        
        checkAuth();
        fetchStats();
    </script>
</body>
</html>
`;

// Landing page
router.get('/', (req, res) => {
    res.type('html').send(LANDING_PAGE);
});

// /home alias for landing page
router.get('/home', (req, res) => {
    res.type('html').send(LANDING_PAGE);
});

module.exports = router;

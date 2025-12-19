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
    <title>Jarvis - Your Intelligent Discord Assistant</title>
    <meta name="description" content="Jarvis is a powerful Discord bot with AI chat, moderation, economy, music, and more. Add Jarvis to your server today!">
    <meta property="og:title" content="Jarvis - Discord Bot">
    <meta property="og:description" content="Your intelligent Discord assistant with AI chat, moderation, economy, and more.">
    <meta property="og:type" content="website">
    <meta property="og:url" content="https://jorvis.org">
    <meta name="theme-color" content="#00d4ff">
    <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🤖</text></svg>">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #0a0a1a 0%, #1a1a3e 50%, #0d0d2b 100%);
            color: #e4e4e4;
            min-height: 100vh;
            overflow-x: hidden;
        }
        
        /* Animated background */
        .bg-animation {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            z-index: -1;
            overflow: hidden;
        }
        
        .bg-animation::before {
            content: '';
            position: absolute;
            width: 200%;
            height: 200%;
            background: radial-gradient(circle at 20% 80%, rgba(0, 212, 255, 0.1) 0%, transparent 50%),
                        radial-gradient(circle at 80% 20%, rgba(138, 43, 226, 0.1) 0%, transparent 50%);
            animation: float 20s ease-in-out infinite;
        }
        
        @keyframes float {
            0%, 100% { transform: translate(0, 0); }
            50% { transform: translate(-5%, -5%); }
        }
        
        /* Navigation */
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
        
        .nav-links a:hover {
            color: #00d4ff;
        }
        
        /* User Menu */
        .user-menu {
            display: flex;
            align-items: center;
            gap: 1rem;
        }
        
        .user-avatar {
            width: 36px;
            height: 36px;
            border-radius: 50%;
            border: 2px solid #00d4ff;
        }
        
        .user-name {
            color: #fff;
            font-weight: 500;
        }
        
        .login-btn {
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            padding: 0.6rem 1.2rem;
            background: #5865F2;
            color: white;
            border-radius: 8px;
            text-decoration: none;
            font-weight: 500;
            transition: all 0.3s;
        }
        
        .login-btn:hover {
            background: #4752c4;
            transform: translateY(-1px);
        }
        
        .logout-btn {
            padding: 0.5rem 1rem;
            background: rgba(255,255,255,0.1);
            color: #888;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-size: 0.9rem;
        }
        
        .logout-btn:hover {
            background: rgba(255,255,255,0.15);
            color: #fff;
        }
        
        /* Hero Section */
        .hero {
            text-align: center;
            padding: 6rem 5% 4rem;
            max-width: 900px;
            margin: 0 auto;
        }
        
        .hero-icon {
            width: 120px;
            height: 120px;
            margin-bottom: 1.5rem;
            border-radius: 20px;
        }
        
        @keyframes pulse {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.05); }
        }
        
        .hero h1 {
            font-size: 3.5rem;
            font-weight: 800;
            margin-bottom: 1rem;
            background: linear-gradient(90deg, #fff, #00d4ff);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        
        .hero p {
            font-size: 1.3rem;
            color: #a0a0a0;
            margin-bottom: 2.5rem;
            line-height: 1.6;
        }
        
        .cta-buttons {
            display: flex;
            gap: 1rem;
            justify-content: center;
            flex-wrap: wrap;
        }
        
        .btn {
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            padding: 1rem 2rem;
            border-radius: 50px;
            font-weight: 600;
            font-size: 1rem;
            text-decoration: none;
            transition: all 0.3s ease;
        }
        
        .btn-primary {
            background: linear-gradient(90deg, #00d4ff, #8a2be2);
            color: white;
            box-shadow: 0 4px 20px rgba(0, 212, 255, 0.3);
        }
        
        .btn-primary:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 30px rgba(0, 212, 255, 0.4);
        }
        
        .btn-secondary {
            background: rgba(255, 255, 255, 0.1);
            color: white;
            border: 1px solid rgba(255, 255, 255, 0.2);
        }
        
        .btn-secondary:hover {
            background: rgba(255, 255, 255, 0.15);
            transform: translateY(-2px);
        }
        
        /* Features Section */
        .features {
            padding: 4rem 5%;
            max-width: 1200px;
            margin: 0 auto;
        }
        
        .features h2 {
            text-align: center;
            font-size: 2.5rem;
            margin-bottom: 3rem;
            color: #fff;
        }
        
        .features-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 1.5rem;
        }
        
        .feature-card {
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 16px;
            padding: 2rem;
            transition: all 0.3s ease;
        }
        
        .feature-card:hover {
            background: rgba(255, 255, 255, 0.06);
            transform: translateY(-5px);
            border-color: rgba(0, 212, 255, 0.3);
        }
        
        .feature-icon {
            font-size: 2.5rem;
            margin-bottom: 1rem;
        }
        
        .feature-card h3 {
            font-size: 1.3rem;
            margin-bottom: 0.75rem;
            color: #fff;
        }
        
        .feature-card p {
            color: #888;
            line-height: 1.6;
        }
        
        /* Stats Section */
        .stats {
            padding: 3rem 5%;
            background: rgba(0, 212, 255, 0.05);
        }
        
        .stats-grid {
            display: flex;
            justify-content: center;
            gap: 4rem;
            flex-wrap: wrap;
            max-width: 800px;
            margin: 0 auto;
        }
        
        .stat-item {
            text-align: center;
        }
        
        .stat-number {
            font-size: 3rem;
            font-weight: 800;
            background: linear-gradient(90deg, #00d4ff, #8a2be2);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        
        .stat-label {
            color: #888;
            font-size: 1rem;
            margin-top: 0.5rem;
        }
        
        /* Commands Section */
        .commands {
            padding: 4rem 5%;
            max-width: 1000px;
            margin: 0 auto;
        }
        
        .commands h2 {
            text-align: center;
            font-size: 2.5rem;
            margin-bottom: 2rem;
            color: #fff;
        }
        
        .command-categories {
            display: flex;
            flex-wrap: wrap;
            gap: 0.5rem;
            justify-content: center;
            margin-bottom: 2rem;
        }
        
        .command-tag {
            background: rgba(0, 212, 255, 0.1);
            color: #00d4ff;
            padding: 0.5rem 1rem;
            border-radius: 20px;
            font-size: 0.9rem;
            border: 1px solid rgba(0, 212, 255, 0.2);
        }
        
        /* Footer */
        footer {
            padding: 3rem 5%;
            border-top: 1px solid rgba(255, 255, 255, 0.1);
            text-align: center;
        }
        
        .footer-links {
            display: flex;
            justify-content: center;
            gap: 2rem;
            margin-bottom: 1.5rem;
            flex-wrap: wrap;
        }
        
        .footer-links a {
            color: #888;
            text-decoration: none;
            transition: color 0.3s;
        }
        
        .footer-links a:hover {
            color: #00d4ff;
        }
        
        .footer-copy {
            color: #666;
            font-size: 0.9rem;
        }
        
        /* Responsive */
        @media (max-width: 768px) {
            .hero h1 { font-size: 2.5rem; }
            .hero p { font-size: 1.1rem; }
            .nav-links { display: none; }
            .stats-grid { gap: 2rem; }
        }
    </style>
</head>
<body>
    <div class="bg-animation"></div>
    
    <nav>
        <a href="/" class="logo">Jarvis</a>
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
        <div class="user-menu" id="userMenu">
            <a href="/auth/login" class="login-btn" id="loginBtn">
                🔐 Login with Discord
            </a>
        </div>
    </nav>
    
    <section class="hero">
        <img src="/jarvis.gif" alt="Jarvis" class="hero-icon">
        <h1>Meet Jarvis</h1>
        <p>Your intelligent Discord assistant powered by cutting-edge AI. Chat naturally, moderate effortlessly, and supercharge your server with advanced features.</p>
        <div class="cta-buttons">
            <a href="${BOT_INVITE}" class="btn btn-primary" target="_blank">
                ➕ Add to Discord
            </a>
            <a href="${DISCORD_INVITE}" class="btn btn-secondary" target="_blank">
                💬 Join Support Server
            </a>
        </div>
    </section>
    
    <section class="features" id="features">
        <h2>✨ Powerful Features</h2>
        <div class="features-grid">
            <div class="feature-card">
                <div class="feature-icon">🧠</div>
                <h3>AI Conversations</h3>
                <p>Natural language chat powered by multiple AI providers. Jarvis remembers context and learns your preferences.</p>
            </div>
            <div class="feature-card">
                <div class="feature-icon">🛡️</div>
                <h3>Smart Moderation</h3>
                <p>Automated content filtering, word blacklists, anti-spam, and comprehensive logging to keep your server safe.</p>
            </div>
            <div class="feature-card">
                <div class="feature-icon">💰</div>
                <h3>Economy System</h3>
                <p>Full economy with daily rewards, work commands, gambling, trading, and the Starkbucks (SBX) exchange.</p>
            </div>
            <div class="feature-card">
                <div class="feature-icon">🎵</div>
                <h3>Music Player</h3>
                <p>High-quality music playback from YouTube, Spotify, and more. Queue management, filters, and 24/7 mode.</p>
            </div>
            <div class="feature-card">
                <div class="feature-icon">📊</div>
                <h3>Server Statistics</h3>
                <p>Track member activity, message analytics, voice time, and more with detailed insights and leaderboards.</p>
            </div>
            <div class="feature-card">
                <div class="feature-icon">⚙️</div>
                <h3>Customization</h3>
                <p>Personalized AI personalities, custom commands, role rewards, welcome messages, and much more.</p>
            </div>
        </div>
    </section>
    
    <section class="stats">
        <div class="stats-grid">
            <div class="stat-item">
                <div class="stat-number">50+</div>
                <div class="stat-label">AI Providers</div>
            </div>
            <div class="stat-item">
                <div class="stat-number">100+</div>
                <div class="stat-label">Commands</div>
            </div>
            <div class="stat-item">
                <div class="stat-number">24/7</div>
                <div class="stat-label">Uptime</div>
            </div>
            <div class="stat-item">
                <div class="stat-number">🔒</div>
                <div class="stat-label">Encrypted</div>
            </div>
        </div>
    </section>
    
    <section class="commands" id="commands">
        <h2>📚 Command Categories</h2>
        <div class="command-categories">
            <span class="command-tag">💬 AI Chat</span>
            <span class="command-tag">🛡️ Moderation</span>
            <span class="command-tag">💰 Economy</span>
            <span class="command-tag">🎵 Music</span>
            <span class="command-tag">📊 Statistics</span>
            <span class="command-tag">🎮 Games</span>
            <span class="command-tag">🔧 Utility</span>
            <span class="command-tag">⚙️ Settings</span>
            <span class="command-tag">🎁 Rewards</span>
            <span class="command-tag">📈 Leaderboards</span>
        </div>
        <p style="text-align: center; color: #888;">Use <code style="background: rgba(255,255,255,0.1); padding: 0.2rem 0.5rem; border-radius: 4px;">*j help</code> or <code style="background: rgba(255,255,255,0.1); padding: 0.2rem 0.5rem; border-radius: 4px;">/help</code> in Discord to see all commands</p>
    </section>
    
    <footer>
        <div class="footer-links">
            <a href="${BOT_INVITE}" target="_blank">Add Bot</a>
            <a href="${DISCORD_INVITE}" target="_blank">Discord Server</a>
            <a href="/changelog">Changelog</a>
                        <a href="/tos">Terms of Service</a>
            <a href="/policy">Privacy Policy</a>
        </div>
        <p class="footer-copy">© 2025 Jarvis. Made with ❤️ for Discord communities.</p>
    </footer>
    
    <script>
        // Check user authentication on page load
        async function checkAuth() {
            try {
                const res = await fetch('/api/user');
                const data = await res.json();
                
                const userMenu = document.getElementById('userMenu');
                
                if (data.authenticated && data.user) {
                    userMenu.innerHTML = \`
                        <img src="\${data.user.avatar}" class="user-avatar" alt="Avatar">
                        <span class="user-name">\${data.user.globalName || data.user.username}</span>
                        <a href="/auth/logout" class="logout-btn">Logout</a>
                    \`;
                }
            } catch (e) {
                console.log('Auth check failed:', e);
            }
        }
        
        // Check for login success/error in URL
        const params = new URLSearchParams(window.location.search);
        if (params.get('login') === 'success') {
            history.replaceState({}, '', '/');
        }
        if (params.get('error')) {
            console.error('Auth error:', params.get('error'));
            history.replaceState({}, '', '/');
        }
        
        checkAuth();
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

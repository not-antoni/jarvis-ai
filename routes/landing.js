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
    <title>Jarvis</title>
    <meta name="description" content="At your service, sir.">
    <meta property="og:title" content="Jarvis">
    <meta property="og:description" content="At your service, sir.">
    <link rel="icon" type="image/webp" href="/jarvis.webp">
    <meta property="og:type" content="website">
    <meta property="og:url" content="https://jorvis.org">
    <meta name="theme-color" content="#00d4ff">
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
            background: #00d4ff;
            color: #000;
        }
        
        .btn-primary:hover {
            background: #00b8e0;
            transform: translateY(-1px);
        }
        
        .btn-secondary {
            background: rgba(255, 255, 255, 0.08);
            color: #fff;
        }
        
        .btn-secondary:hover {
            background: rgba(255, 255, 255, 0.12);
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
            margin-bottom: 2.5rem;
            color: #fff;
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
            max-width: 700px;
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
        }
        
        @media (max-width: 768px) {
            .hero h1 { font-size: 2.25rem; }
            .hero p { font-size: 1rem; }
            .nav-links { display: none; }
            .stats-grid { gap: 2rem; }
            .features-grid { grid-template-columns: 1fr; }
        }
    </style>
</head>
<body>
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
            <li><a href="/me">Portal</a></li>
        </ul>
        <div class="user-menu" id="userMenu">
            <a href="/auth/login" class="login-btn" id="loginBtn">Login</a>
        </div>
    </nav>
    
    <section class="hero">
        <img src="/jarvis.gif" alt="Jarvis" class="hero-icon">
        <h1>Meet Jarvis</h1>
        <p>An AI assistant for Discord with personality. Chat naturally, get things done, and have fun.</p>
        <div class="cta-buttons">
            <a href="${BOT_INVITE}" class="btn btn-primary" target="_blank">Add to Discord</a>
            <a href="${DISCORD_INVITE}" class="btn btn-secondary" target="_blank">Join Server</a>
        </div>
    </section>
    
    <section class="showcase">
        <h2>See Jarvis in Action</h2>
        <p class="subtitle">Real conversations from Discord</p>
        <div class="screenshot-grid">
            <div class="screenshot-item">
                <img src="/screenshot-1.png" alt="Jarvis conversation example" loading="lazy">
            </div>
            <div class="screenshot-item">
                <img src="/screenshot-2.png" alt="Jarvis conversation example" loading="lazy">
            </div>
            <div class="screenshot-item">
                <img src="/screenshot-3.png" alt="Jarvis conversation example" loading="lazy">
            </div>
        </div>
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
                <div class="stat-number">24/7</div>
                <div class="stat-label">Online</div>
            </div>
        </div>
    </section>
    
    <section class="features" id="features">
        <h2>What Jarvis Can Do</h2>
        <div class="features-grid">
            <div class="feature-card">
                <h3>AI Chat</h3>
                <p>Natural conversations with context memory. Multiple AI providers for reliability.</p>
            </div>
            <div class="feature-card">
                <h3>Moderation</h3>
                <p>Auto-mod, word filters, anti-spam, and logging to keep your server clean.</p>
            </div>
            <div class="feature-card">
                <h3>Economy</h3>
                <p>Virtual currency, daily rewards, gambling, trading, and the SBX exchange.</p>
            </div>
            <div class="feature-card">
                <h3>Music</h3>
                <p>Play from YouTube, Spotify, and more. Queues, filters, and 24/7 mode.</p>
            </div>
            <div class="feature-card">
                <h3>Stats</h3>
                <p>Track activity, messages, voice time, and compete on leaderboards.</p>
            </div>
            <div class="feature-card">
                <h3>Customize</h3>
                <p>Set AI personalities, custom commands, welcome messages, and more.</p>
            </div>
        </div>
    </section>
    
    <footer>
        <div class="footer-links">
            <a href="${BOT_INVITE}" target="_blank">Add Bot</a>
            <a href="${DISCORD_INVITE}" target="_blank">Discord</a>
            <a href="/commands">Commands</a>
            <a href="/changelog">Changelog</a>
            <a href="/tos">Terms</a>
            <a href="/policy">Privacy</a>
        </div>
        <p class="footer-copy">© 2025 Jarvis</p>
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
        
        const params = new URLSearchParams(window.location.search);
        if (params.get('login') === 'success' || params.get('error')) {
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

'use strict';

const express = require('express');
const router = express.Router();
const { getPublicConfig } = require('../src/utils/public-config');

const publicConfig = getPublicConfig();
const DISCORD_INVITE = publicConfig.discordInviteUrl;
const BOT_INVITE = publicConfig.botInviteUrl;
const SITE_BASE_URL = publicConfig.baseUrl;
const GA_MEASUREMENT_ID = publicConfig.gaMeasurementId;

const LANDING_PAGE = `
<!DOCTYPE html>
<html lang="en">
<head>
    <!-- Google tag (gtag.js) -->
    <script async src="https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', '${GA_MEASUREMENT_ID}');
    </script>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Jarvis | Discord AI Bot</title>
    <meta name="description" content="AI chat, AutoMod, and music for Discord servers.">
    <meta property="og:title" content="Jarvis | Discord AI Bot">
    <meta property="og:description" content="AI chat, AutoMod, and music for Discord servers.">
    <link rel="icon" type="image/webp" href="/jarvis.webp">
    <meta property="og:site_name" content="Jarvis">
    <meta property="og:type" content="website">
    <meta property="og:url" content="${SITE_BASE_URL}">
    <meta name="theme-color" content="#fff">
    <meta name="twitter:card" content="summary">
    <meta name="keywords" content="discord bot, ai discord bot, music bot, automod bot, jarvis">
    <meta name="robots" content="index, follow">
    <link rel="canonical" href="${SITE_BASE_URL}">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Comic+Neue:wght@400;700;800&display=swap" rel="stylesheet">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }

        body {
            font-family: 'Comic Neue', 'Comic Sans MS', cursive, sans-serif;
            background: #000;
            color: #e4e4e4;
            min-height: 100vh;
            height: 100vh;
            overflow: hidden;
            display: flex;
            flex-direction: column;
        }
        
        /* Navigation */
        nav {
            display: flex;
            align-items: center;
            gap: 2rem;
            padding: 1.25rem 5%;
            max-width: 1300px;
            margin: 0 auto;
            border-bottom: 1px solid rgba(255,255,255,0.06);
        }
        
        .logo {
            font-size: 1.5rem;
            font-weight: 700;
            color: #fff;
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

        .page {
            flex: 1;
            display: flex;
            flex-direction: column;
        }
        
        /* Hero Section */
        .hero {
            text-align: center;
            padding: 4rem 5% 2rem;
            max-width: 800px;
            margin: 0 auto;
        }
        
        .hero h1 {
            font-size: 3rem;
            font-weight: 800;
            margin-bottom: 1rem;
            color: #fff;
            line-height: 1.1;
        }
        
        .hero h1 .accent {
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
            background: #fff;
            color: #000;
        }

        .btn-primary:hover {
            transform: translateY(-2px);
            opacity: 0.9;
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
        
        /* Stats Section */
        .stats {
            padding: 2rem 5%;
            background: rgba(255, 255, 255, 0.02);
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
            color: #fff;
        }
        
        .stat-label {
            color: #666;
            font-size: 0.85rem;
            margin-top: 0.25rem;
        }

        footer {
            margin-top: auto;
            padding: 1.25rem 5% 1.5rem;
            text-align: center;
        }

        .footer-links {
            display: flex;
            justify-content: center;
            gap: 1.5rem;
            flex-wrap: wrap;
            margin-bottom: 0.5rem;
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
        }
        
        @media (max-width: 768px) {
            .hero h1 { font-size: 2.25rem; }
            .hero p { font-size: 1rem; }
            .nav-links { display: none; }
            .stats-grid { gap: 2rem; }
        }
    </style>
</head>
<body>
    <nav>
        <a href="/" class="logo">Jarvis</a>
        <ul class="nav-links">
            <li><a href="/status">Status</a></li>
        </ul>
    </nav>

    <main class="page">
        <section class="hero">
            <h1>The Discord AI with <span class="accent">Actual Personality</span></h1>
            <p>Stop using boring bots. Jarvis brings natural chat, AutoMod filtering, and music streaming to your server.</p>
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
                    <div class="stat-number">50</div>
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
    </main>

    <footer>
        <div class="footer-links">
            <a href="/tos">Terms</a>
            <a href="/policy">Privacy</a>
        </div>
        <p class="footer-copy">© 2026 Jarvis • Made with love for Discord</p>
    </footer>
    
    <script>
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

'use strict';

const express = require('express');
const router = express.Router();
const { getPublicConfig } = require('../src/utils/public-config');

const publicConfig = getPublicConfig();
const DISCORD_INVITE = publicConfig.discordInviteUrl;
const BOT_INVITE = publicConfig.botInviteUrl;
const SITE_BASE_URL = publicConfig.baseUrl;
const GA_MEASUREMENT_ID = publicConfig.gaMeasurementId;
const CONTACT_EMAIL = 'dev@jorvis.org';

let _appContext = null;
function setAppContext(ctx) { _appContext = ctx; }
function getServerCount() {
    try {
        const count = _appContext?.getClient()?.guilds?.cache?.size || 0;
        if (count >= 1000) return (count / 1000).toFixed(1) + 'K+';
        if (count > 0) return count + '+';
    } catch {}
    return '';
}

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
    <title>Jarvis | Discord Bot — AI Chat, Voice, Music & AutoMod</title>
    <meta name="description" content="Free Discord bot that actually talks back. AI chat in text and voice channels, music playback, AutoMod, and 30+ slash commands. No credit card, no catch.">
    <meta property="og:title" content="Jarvis | Discord Bot — AI Chat, Voice, Music & AutoMod">
    <meta property="og:description" content="Free Discord bot that actually talks back. AI chat in text and voice channels, music playback, AutoMod, and 30+ slash commands. No credit card, no catch.">
    <link rel="icon" type="image/webp" href="/jarvis.webp">
    <meta property="og:site_name" content="Jarvis">
    <meta property="og:type" content="website">
    <meta property="og:url" content="${SITE_BASE_URL}">
    <meta name="theme-color" content="#000">
    <meta name="twitter:card" content="summary">
    <meta name="keywords" content="discord bot, ai discord bot, voice chat bot, music bot, automod bot, jarvis, discord ai assistant, speech to text discord">
    <meta name="robots" content="index, follow">
    <link rel="canonical" href="${SITE_BASE_URL}">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Comic+Neue:wght@400;700;800&display=swap" rel="stylesheet">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html { scroll-behavior: smooth; }

        body {
            font-family: 'Comic Neue', 'Comic Sans MS', cursive, sans-serif;
            background: #000;
            color: #e4e4e4;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
        }

        /* ---- Entrance Animations ---- */
        @keyframes fade-up {
            from { opacity: 0; transform: translateY(24px); }
            to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes fade-in {
            from { opacity: 0; }
            to   { opacity: 1; }
        }
        @keyframes scale-in {
            from { opacity: 0; transform: scale(0.92); }
            to   { opacity: 1; transform: scale(1); }
        }
        @keyframes gradient-shift {
            0%   { background-position: 0% 50%; }
            50%  { background-position: 100% 50%; }
            100% { background-position: 0% 50%; }
        }
        @keyframes glow-pulse {
            0%, 100% { opacity: 0.5; }
            50%      { opacity: 1; }
        }

        .anim-fade-up {
            opacity: 0;
            animation: fade-up 0.7s ease forwards;
        }
        .anim-fade-in {
            opacity: 0;
            animation: fade-in 0.6s ease forwards;
        }
        .anim-scale-in {
            opacity: 0;
            animation: scale-in 0.5s ease forwards;
        }
        .delay-1 { animation-delay: 0.1s; }
        .delay-2 { animation-delay: 0.25s; }
        .delay-3 { animation-delay: 0.4s; }
        .delay-4 { animation-delay: 0.55s; }
        .delay-5 { animation-delay: 0.7s; }
        .delay-6 { animation-delay: 0.85s; }

        /* Navigation */
        .nav-wrap {
            border-bottom: 1px solid rgba(255,255,255,0.06);
        }

        nav {
            display: flex;
            align-items: center;
            gap: 2rem;
            padding: 1.25rem 5%;
            max-width: 1300px;
            margin: 0 auto;
        }

        .logo {
            display: flex;
            align-items: center;
            gap: 0.6rem;
            text-decoration: none;
        }

        .logo-mark {
            width: 32px;
            height: 32px;
            background: #fff;
            border-radius: 6px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: 800;
            font-size: 0.7rem;
            color: #111;
            letter-spacing: 0.5px;
            flex-shrink: 0;
        }

        .logo-text {
            font-size: 1.5rem;
            font-weight: 700;
            color: #fff;
        }

        .nav-links {
            display: flex;
            gap: 1.75rem;
            list-style: none;
            margin-left: auto;
            align-items: center;
        }

        .nav-links a {
            color: #999;
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
            position: relative;
        }

        .hero-glow {
            position: absolute;
            top: -40%;
            left: 50%;
            transform: translateX(-50%);
            width: 600px;
            height: 400px;
            background: radial-gradient(ellipse, rgba(167,139,250,0.12) 0%, rgba(96,165,250,0.08) 40%, transparent 70%);
            pointer-events: none;
            animation: glow-pulse 6s ease-in-out infinite;
        }

        .hero h1 {
            font-size: 3rem;
            font-weight: 800;
            margin-bottom: 1rem;
            color: #fff;
            line-height: 1.1;
            position: relative;
        }

        .hero h1 .accent {
            background: linear-gradient(90deg, #a78bfa, #60a5fa, #a78bfa, #60a5fa);
            background-size: 200% 100%;
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            animation: gradient-shift 4s ease infinite;
        }

        .hero p {
            font-size: 1.15rem;
            color: #999;
            margin-bottom: 2rem;
            line-height: 1.7;
            max-width: 550px;
            margin-left: auto;
            margin-right: auto;
            position: relative;
        }

        .cta-buttons {
            display: flex;
            gap: 1rem;
            justify-content: center;
            flex-wrap: wrap;
            margin-bottom: 1rem;
            position: relative;
        }

        .cta-subtext {
            color: #777;
            font-size: 0.85rem;
            margin-top: 0.75rem;
            position: relative;
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
            color: #999;
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
            color: #888;
            font-size: 0.85rem;
            margin-top: 0.25rem;
        }

        footer {
            margin-top: auto;
            padding: 1.25rem 5% 1.5rem;
            text-align: center;
            border-top: 1px solid rgba(255,255,255,0.06);
        }

        .footer-links {
            display: flex;
            justify-content: center;
            gap: 1.5rem;
            flex-wrap: wrap;
            margin-bottom: 0.5rem;
        }

        .footer-links a {
            color: #777;
            text-decoration: none;
            font-size: 0.85rem;
            transition: color 0.2s;
        }

        .footer-links a:hover {
            color: #999;
        }

        .footer-copy {
            color: #777;
            font-size: 0.8rem;
        }

        .copy-toast {
            position: fixed;
            left: 50%;
            bottom: 1.5rem;
            transform: translate(-50%, 10px);
            background: rgba(255, 255, 255, 0.08);
            border: 1px solid rgba(255, 255, 255, 0.14);
            color: #ddd;
            padding: 0.6rem 0.85rem;
            border-radius: 999px;
            font-size: 0.8rem;
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.18s ease, transform 0.18s ease;
            backdrop-filter: blur(8px);
        }

        .copy-toast.is-visible {
            opacity: 1;
            transform: translate(-50%, 0);
        }

        /* Features Section */
        .features {
            padding: 3rem 5%;
            max-width: 900px;
            margin: 0 auto;
        }

        .features h2 {
            color: #fff;
            font-size: 1.5rem;
            font-weight: 700;
            text-align: center;
            margin-bottom: 2rem;
        }

        .features-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
            gap: 1.5rem;
        }

        .feature-card {
            background: rgba(255,255,255,0.03);
            border: 1px solid rgba(255,255,255,0.06);
            border-radius: 10px;
            padding: 1.5rem;
            transition: transform 0.25s ease, border-color 0.25s ease;
        }

        .feature-card:hover {
            transform: translateY(-3px);
            border-color: rgba(255,255,255,0.12);
        }

        .feature-icon {
            font-size: 1.5rem;
            margin-bottom: 0.75rem;
            display: block;
        }

        .feature-card h3 {
            color: #fff;
            font-size: 1rem;
            margin-bottom: 0.5rem;
        }

        .feature-card p {
            color: #999;
            font-size: 0.9rem;
            line-height: 1.6;
        }

        /* AGIS section */
        .agis-section {
            padding: 3rem 5%;
            max-width: 700px;
            margin: 0 auto;
            text-align: center;
        }

        .agis-badge {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 64px;
            height: 64px;
            background: #fff;
            border-radius: 12px;
            font-weight: 800;
            font-size: 1.1rem;
            color: #111;
            letter-spacing: 1px;
            margin-bottom: 1.25rem;
        }

        .agis-section h2 {
            color: #fff;
            font-size: 1.35rem;
            font-weight: 700;
            margin-bottom: 0.5rem;
        }

        .agis-section .agis-full {
            color: #666;
            font-size: 0.8rem;
            letter-spacing: 2px;
            text-transform: uppercase;
            margin-bottom: 1rem;
        }

        .agis-section p {
            color: #999;
            font-size: 0.95rem;
            line-height: 1.7;
            max-width: 500px;
            margin: 0 auto;
        }

        /* Responsive */
        @media (max-width: 768px) {
            .hero { padding: 2.5rem 5% 1.5rem; }
            .hero h1 { font-size: 2rem; }
            .hero p { font-size: 1rem; }
            .hero-glow { width: 350px; height: 250px; }
            .nav-links { display: none; }
            .stats-grid { gap: 1.5rem; }
            .stat-number { font-size: 1.75rem; }
            .features { padding: 2rem 5%; }
            .features h2 { font-size: 1.25rem; }
            .agis-section { padding: 2rem 5%; }
        }
    </style>
</head>
<body>
    <div class="nav-wrap anim-fade-in">
    <nav>
        <a href="/" class="logo">
            <span class="logo-mark">AGIS</span>
            <span class="logo-text">Jarvis</span>
        </a>
        <ul class="nav-links">
            <li><a href="#features">Features</a></li>
            <li><a href="#agis">AGIS</a></li>
            <li><a href="${DISCORD_INVITE}" target="_blank">Support</a></li>
        </ul>
    </nav>
    </div>

    <main class="page">
        <section class="hero">
            <div class="hero-glow"></div>
            <h1 class="anim-fade-up delay-1">The Discord AI with <span class="accent">Actual Personality</span></h1>
            <p class="anim-fade-up delay-2">Stop using boring bots. Jarvis does AI chat, voice conversations, music, and AutoMod — like an actual member of your server.</p>
            <div class="cta-buttons anim-fade-up delay-3">
                <a href="${BOT_INVITE}" class="btn btn-primary" target="_blank">Add to Discord</a>
                <a href="${DISCORD_INVITE}" class="btn btn-secondary" target="_blank">Join AGIS Operations</a>
            </div>
            <p class="cta-subtext anim-fade-in delay-4">
                <span>✓ Free forever</span>
                <span>✓ No credit card</span>
                <span>✓ Set up in 2 mins</span>
            </p>
        </section>

        <section class="stats anim-fade-in delay-5">
            <div class="stats-grid">
                <div class="stat-item">
                    <div class="stat-number">50+</div>
                    <div class="stat-label">Models</div>
                </div>
                <div class="stat-item">
                    <div class="stat-number">30+</div>
                    <div class="stat-label">Commands</div>
                </div>
                <div class="stat-item">
                    <div class="stat-number" id="serverCount">%%SERVER_COUNT%%</div>
                    <div class="stat-label">Servers</div>
                </div>
                <div class="stat-item">
                    <div class="stat-number">99.9%</div>
                    <div class="stat-label">Uptime</div>
                </div>
            </div>
        </section>

        <section class="features" id="features">
            <h2>Features</h2>
            <div class="features-grid">
                <div class="feature-card">
                    <span class="feature-icon">💬</span>
                    <h3>AI Chat</h3>
                    <p>Mention him, say his name, or use /jarvis in any channel. He remembers everything. DMs off because people were weird about it.</p>
                </div>
                <div class="feature-card">
                    <span class="feature-icon">🎙️</span>
                    <h3>Voice Chat</h3>
                    <p>Run /voice and he joins your call. Say "Jarvis" and talk — he hears you and talks back. Forget to say his name and he pretends you don't exist. Works best if you're British, apparently.</p>
                </div>
                <div class="feature-card">
                    <span class="feature-icon">🎵</span>
                    <h3>Music</h3>
                    <p>Drop a link, hit play. Queue, skip, loop, volume — it just works. No 15-step setup required.</p>
                </div>
                <div class="feature-card">
                    <span class="feature-icon">🛡️</span>
                    <h3>AutoMod</h3>
                    <p>Spam, toxicity, sketchy links — handled. You can stop babysitting your server now.</p>
                </div>
            </div>
        </section>

        <section class="agis-section" id="agis">
            <div class="agis-badge">AGIS</div>
            <h2>Built by AGIS</h2>
            <p class="agis-full">Artificial General Intelligent System</p>
            <p>The team behind Jarvis. We build AI that actually fits into your server — not as a tool, but as a presence.</p>
        </section>
    </main>

    <footer>
        <div class="footer-links">
            <a href="/tos">Terms</a>
            <a href="/policy">Privacy</a>
            <a href="#" onclick="copyContactEmail(event)">Contact</a>
            <a href="https://github.com/not-antoni/jarvis-ai" target="_blank" rel="noopener noreferrer">GitHub</a>
        </div>
        <p class="footer-copy">© 2026 AGIS • Powered by caffeine.</p>
    </footer>
    <div class="copy-toast" id="copyToast" aria-live="polite"></div>
    
    <script>
        const CONTACT_EMAIL = '${CONTACT_EMAIL}';
        let copyToastTimer = null;

        function showCopyToast(message) {
            const toast = document.getElementById('copyToast');
            if (!toast) return;
            toast.textContent = message;
            toast.classList.add('is-visible');
            clearTimeout(copyToastTimer);
            copyToastTimer = setTimeout(() => {
                toast.classList.remove('is-visible');
            }, 1600);
        }

        async function copyContactEmail(event) {
            event.preventDefault();
            try {
                if (navigator.clipboard?.writeText) {
                    await navigator.clipboard.writeText(CONTACT_EMAIL);
                } else {
                    const input = document.createElement('textarea');
                    input.value = CONTACT_EMAIL;
                    input.setAttribute('readonly', '');
                    input.style.position = 'absolute';
                    input.style.left = '-9999px';
                    document.body.appendChild(input);
                    input.select();
                    document.execCommand('copy');
                    document.body.removeChild(input);
                }
                showCopyToast('copied to clipboard');
            } catch (_) {
                showCopyToast(CONTACT_EMAIL);
            }
        }

        // Fetch real server count (retry once if cache not ready yet)
        // Live-update server count in case it changed since SSR
        (async () => {
            try {
                const res = await fetch('/api/stats');
                const data = await res.json();
                if (data.guildCount > 0) {
                    const count = data.guildCount;
                    const el = document.getElementById('serverCount');
                    el.textContent = count >= 1000 ? (count / 1000).toFixed(1) + 'K+' : count + '+';
                }
            } catch {}
        })();

        // Scroll-triggered animations for below-the-fold sections
        const scrollObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('anim-fade-up');
                    scrollObserver.unobserve(entry.target);
                }
            });
        }, { threshold: 0.15 });
        document.querySelectorAll('.feature-card, .agis-section').forEach(el => {
            el.classList.remove('anim-scale-in', 'anim-fade-up');
            el.style.opacity = '0';
            scrollObserver.observe(el);
        });
    </script>
</body>
</html>
`;

function serveLanding(req, res) {
    res.type('html').send(LANDING_PAGE.replace('%%SERVER_COUNT%%', getServerCount()));
}

router.get('/', serveLanding);
router.get('/home', serveLanding);

module.exports = router;
module.exports.setAppContext = setAppContext;

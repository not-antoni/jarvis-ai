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
    <meta name="theme-color" content="#fff">
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
            font-size: 1.5rem;
            font-weight: 700;
            color: #fff;
            text-decoration: none;
        }
        
        .nav-links {
            display: flex;
            gap: 1.75rem;
            list-style: none;
            margin-left: auto;
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
        }
        
        .hero h1 {
            font-size: 3rem;
            font-weight: 800;
            margin-bottom: 1rem;
            color: #fff;
            line-height: 1.1;
        }
        
        .hero h1 .accent {
            background: linear-gradient(135deg, #a78bfa, #60a5fa);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }
        
        .hero p {
            font-size: 1.15rem;
            color: #999;
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
            color: #777;
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

        /* Responsive */
        @media (max-width: 768px) {
            .hero { padding: 2.5rem 5% 1.5rem; }
            .hero h1 { font-size: 2rem; }
            .hero p { font-size: 1rem; }
            .nav-links { display: none; }
            .stats-grid { gap: 1.5rem; }
            .stat-number { font-size: 1.75rem; }
            .features { padding: 2rem 5%; }
            .features h2 { font-size: 1.25rem; }
        }
    </style>
</head>
<body>
    <div class="nav-wrap">
    <nav>
        <a href="/" class="logo">Jarvis</a>
        <ul class="nav-links">
            <li><a href="#features">Features</a></li>
            <li><a href="${DISCORD_INVITE}" target="_blank">Support</a></li>
        </ul>
    </nav>
    </div>

    <main class="page">
        <section class="hero">
            <h1>The Discord AI with <span class="accent">Actual Personality</span></h1>
            <p>Stop using boring bots. Jarvis does AI chat, voice conversations, music, and AutoMod — like an actual member of your server.</p>
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
                    <div class="stat-number">30+</div>
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
                    <p>YouTube, SoundCloud, whatever. Queue, skip, loop. It just works — no 15-step setup required.</p>
                </div>
                <div class="feature-card">
                    <span class="feature-icon">🛡️</span>
                    <h3>AutoMod</h3>
                    <p>Spam, toxicity, sketchy links — handled. You can stop babysitting your server now.</p>
                </div>
            </div>
        </section>
    </main>

    <footer>
        <div class="footer-links">
            <a href="/tos">Terms</a>
            <a href="/policy">Privacy</a>
            <a href="#" onclick="copyContactEmail(event)">Contact</a>
        </div>
        <p class="footer-copy">© 2026 Jarvis • Powered by caffeine.</p>
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
        async function fetchStats(retries) {
            try {
                const res = await fetch('/api/stats');
                const data = await res.json();
                if (data.guildCount > 0) {
                    const count = data.guildCount;
                    let formatted;
                    if (count >= 1000) formatted = (count / 1000).toFixed(1) + 'K+';
                    else formatted = count + '+';
                    document.getElementById('serverCount').textContent = formatted;
                } else if (retries > 0) {
                    setTimeout(() => fetchStats(retries - 1), 5000);
                }
            } catch (e) {
                if (retries > 0) setTimeout(() => fetchStats(retries - 1), 5000);
            }
        }

        fetchStats(2);
    </script>
<!-- ============================================================
     JARVIS NOTICE POPUP — drop this before </body> on any page
     matches your existing theme (Comic Neue, black, white btns)
     shows every single visit, no cookies, no mercy
     ============================================================ -->

<style>
  #jarvis-notice-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.75);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.25rem;
    animation: notice-fadein 0.22s ease;
  }

  @keyframes notice-fadein {
    from { opacity: 0; }
    to   { opacity: 1; }
  }

  #jarvis-notice-box {
    background: #0a0a0a;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 14px;
    padding: 2rem 2.25rem 1.75rem;
    max-width: 520px;
    width: 100%;
    font-family: 'Comic Neue', 'Comic Sans MS', cursive, sans-serif;
    color: #e4e4e4;
    box-shadow: 0 0 60px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(255,255,255,0.04);
    animation: notice-popup 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
  }

  @keyframes notice-popup {
    from { transform: scale(0.92) translateY(12px); opacity: 0; }
    to   { transform: scale(1)    translateY(0);    opacity: 1; }
  }

  #jarvis-notice-box h2 {
    font-size: 1.4rem;
    font-weight: 800;
    color: #fff;
    margin-bottom: 1rem;
    line-height: 1.25;
  }

  #jarvis-notice-box p {
    font-size: 0.95rem;
    color: #999;
    line-height: 1.75;
    margin-bottom: 0.6rem;
  }

  #jarvis-notice-box p strong {
    color: #ccc;
    font-weight: 700;
  }

  .notice-complaints {
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.07);
    border-radius: 8px;
    padding: 0.9rem 1rem;
    margin: 1rem 0 1.4rem;
    font-size: 0.88rem;
    color: #888;
    line-height: 1.9;
  }

  .notice-complaints span {
    display: block;
  }

  .notice-complaints span::before {
    content: '❌ ';
  }

  .notice-actions {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .notice-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.75rem 1.4rem;
    border-radius: 8px;
    font-family: inherit;
    font-weight: 700;
    font-size: 0.88rem;
    cursor: pointer;
    text-decoration: none;
    border: none;
    transition: all 0.18s ease;
  }

  .notice-btn-primary {
    background: #fff;
    color: #000;
  }

  .notice-btn-primary:hover {
    opacity: 0.88;
    transform: translateY(-1px);
  }

  .notice-btn-secondary {
    background: transparent;
    color: #999;
    border: 1px solid rgba(255, 255, 255, 0.15);
  }

  .notice-btn-secondary:hover {
    background: rgba(255,255,255,0.05);
    color: #fff;
    border-color: rgba(255,255,255,0.25);
  }

  .notice-footnote {
    margin-top: 1.1rem;
    font-size: 0.8rem;
    color: #666;
  }

  .notice-footnote a {
    color: #777;
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .notice-footnote a:hover { color: #999; }

  @media (max-width: 480px) {
    #jarvis-notice-box { padding: 1.5rem 1.25rem 1.35rem; }
    #jarvis-notice-box h2 { font-size: 1.2rem; }
    .notice-actions { flex-direction: column; }
    .notice-btn { justify-content: center; }
  }
</style>

<div id="jarvis-notice-overlay" role="dialog" aria-modal="true" aria-labelledby="jarvis-notice-title">
  <div id="jarvis-notice-box">
    <h2 id="jarvis-notice-title">guys please 😭</h2>
    <p>stop messaging everywhere asking:</p>
    <div class="notice-complaints">
      <span>"why doesn't the bot work??"</span>
      <span>"how do i make jarvis talk to my bot"</span>
      <span>"how do i make jarvis brush my teeth"</span>
    </div>
    <p>
      literally just join the support server or email
      <a href="#" onclick="copyNoticeEmail(event)" style="color:#aaa;text-underline-offset:2px;">dev@jorvis.org</a>.
      thats it. thats the whole answer. every time.
    </p>
    <div class="notice-actions">
      <a href="https://discord.com/invite/ksXzuBtmK5" class="notice-btn notice-btn-primary" target="_blank" rel="noreferrer">
        support server
      </a>
      <button class="notice-btn notice-btn-secondary" onclick="dismissNotice()">
        ok fine
      </button>
    </div>
  </div>
</div>

<script>
  const NOTICE_COOKIE = 'jarvis_notice_dismissed';

  function getCookie(name) {
    return document.cookie.split('; ').find(r => r.startsWith(name + '='));
  }

  function dismissNotice() {
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toUTCString();
    document.cookie = NOTICE_COOKIE + '=1; expires=' + expires + '; path=/';
    document.getElementById('jarvis-notice-overlay').remove();
  }

  // hide immediately if dismissed within the last 4 hours
  if (getCookie(NOTICE_COOKIE)) {
    document.getElementById('jarvis-notice-overlay').remove();
  }

  async function copyNoticeEmail(e) {
    e.preventDefault();
    const email = 'dev@jorvis.org';
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(email);
      } else {
        const t = document.createElement('textarea');
        t.value = email;
        t.style.cssText = 'position:absolute;left:-9999px';
        document.body.appendChild(t);
        t.select();
        document.execCommand('copy');
        document.body.removeChild(t);
      }
      if (typeof showCopyToast === 'function') showCopyToast('copied to clipboard');
    } catch (_) {}
  }
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

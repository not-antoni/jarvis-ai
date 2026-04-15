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

        .menu-toggle {
            display: none;
            background: none;
            border: none;
            color: #999;
            font-size: 1.4rem;
            cursor: pointer;
            margin-left: auto;
            padding: 0.25rem;
            line-height: 1;
        }
        .menu-toggle:hover { color: #fff; }

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
            color: #ccc;
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
            color: #aaa;
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
            color: #ccc;
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
            color: #aaa;
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
            color: #aaa;
            text-decoration: none;
            font-size: 0.85rem;
            transition: color 0.2s;
        }

        .footer-links a:hover {
            color: #fff;
        }

        .footer-copy {
            color: #aaa;
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
            color: #bbb;
            font-size: 0.9rem;
            line-height: 1.6;
        }

        /* How it works */
        .how-it-works {
            padding: 3rem 5%;
            max-width: 900px;
            margin: 0 auto;
        }
        .how-it-works h2 {
            color: #fff;
            font-size: 1.5rem;
            font-weight: 700;
            text-align: center;
            margin-bottom: 2rem;
        }
        .steps {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 1.5rem;
        }
        .step {
            text-align: center;
            padding: 1.25rem;
        }
        .step-num {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 36px; height: 36px;
            border-radius: 50%;
            background: rgba(255,255,255,0.06);
            color: #fff;
            font-weight: 700;
            font-size: 0.9rem;
            margin-bottom: 0.75rem;
        }
        .step h3 {
            color: #fff;
            font-size: 1rem;
            margin-bottom: 0.4rem;
        }
        .step p {
            color: #bbb;
            font-size: 0.85rem;
            line-height: 1.6;
        }

        /* About / text sections */
        .about-section {
            padding: 3rem 5%;
            max-width: 750px;
            margin: 0 auto;
        }
        .about-section h2 {
            color: #fff;
            font-size: 1.5rem;
            font-weight: 700;
            text-align: center;
            margin-bottom: 1.25rem;
        }
        .about-section p {
            color: #bbb;
            font-size: 0.95rem;
            line-height: 1.8;
            margin-bottom: 1rem;
            text-align: center;
            max-width: 600px;
            margin-left: auto;
            margin-right: auto;
        }
        .about-section a {
            color: #fff;
            text-decoration: underline;
            text-decoration-color: rgba(255,255,255,0.3);
        }
        .about-section a:hover {
            text-decoration-color: #fff;
        }

        /* Tech grid */
        .tech-section {
            padding: 2rem 5%;
            max-width: 900px;
            margin: 0 auto;
        }
        .tech-section h2 {
            color: #fff;
            font-size: 1.5rem;
            font-weight: 700;
            text-align: center;
            margin-bottom: 1.5rem;
        }
        .tech-grid {
            display: flex;
            flex-wrap: wrap;
            gap: 0.6rem;
            justify-content: center;
        }
        .tech-tag {
            background: rgba(255,255,255,0.05);
            border: 1px solid rgba(255,255,255,0.08);
            color: #ccc;
            font-size: 0.8rem;
            padding: 0.4rem 0.8rem;
            border-radius: 6px;
        }

        /* Scroll reveal (bidirectional) */
        .scroll-reveal {
            opacity: 0;
            transform: translateY(25px);
            transition: opacity 0.5s ease, transform 0.5s ease;
        }
        .scroll-reveal.scroll-visible {
            opacity: 1;
            transform: translateY(0);
        }

        /* Tablet */
        @media (max-width: 1024px) {
            .hero h1 { font-size: 2.5rem; }
            .stats-grid { gap: 2.5rem; }
            .features-grid { grid-template-columns: repeat(2, 1fr); }
            .about-section p { max-width: 100%; }
        }

        /* Mobile */
        @media (max-width: 768px) {
            .hero { padding: 2.5rem 5% 1.5rem; }
            .hero h1 { font-size: 1.85rem; line-height: 1.2; }
            .hero p { font-size: 0.95rem; line-height: 1.6; }
            .hero-glow { width: 300px; height: 200px; }
            .menu-toggle { display: block; }
            .nav-links {
                display: none;
                position: absolute;
                top: 100%;
                left: 0; right: 0;
                background: #000;
                border: 1px solid rgba(255,255,255,0.08);
                border-top: none;
                border-radius: 0 0 10px 10px;
                flex-direction: column;
                padding: 1rem 5%;
                gap: 0.75rem;
                z-index: 100;
                box-shadow: 0 8px 24px rgba(0,0,0,0.6);
            }
            .nav-links.open { display: flex; }
            nav { position: relative; }
            .cta-buttons { flex-direction: column; align-items: center; }
            .btn { width: 100%; max-width: 280px; justify-content: center; }
            .cta-subtext { font-size: 0.78rem; }
            .cta-subtext span { display: block; margin: 0.2rem 0; }
            .stats-grid { gap: 1.25rem; }
            .stat-number { font-size: 1.75rem; }
            .stat-label { font-size: 0.78rem; }
            .features { padding: 2rem 5%; }
            .features h2 { font-size: 1.25rem; }
            .features-grid { grid-template-columns: 1fr; }
            .feature-card { padding: 1.25rem; }
            .feature-card:hover { transform: none; }
            .how-it-works { padding: 2rem 5%; }
            .how-it-works h2 { font-size: 1.25rem; }
            .steps { grid-template-columns: 1fr; gap: 0.75rem; }
            .step { padding: 1rem; }
            .tech-section { padding: 1.5rem 5%; }
            .tech-section h2 { font-size: 1.25rem; }
            .tech-tag { font-size: 0.75rem; padding: 0.35rem 0.65rem; }
            .about-section { padding: 2rem 5%; }
            .about-section h2 { font-size: 1.25rem; }
            .about-section p { font-size: 0.9rem; line-height: 1.7; text-align: left; max-width: 100%; }
            footer { padding: 1rem 5% 1.25rem; }
            .footer-links { gap: 1rem; }
        }

        /* Small phones */
        @media (max-width: 400px) {
            .hero h1 { font-size: 1.5rem; }
            .hero p { font-size: 0.9rem; }
            .hero-glow { width: 250px; height: 160px; }
            .logo-text { font-size: 1.25rem; }
            .stat-number { font-size: 1.5rem; }
            .stats-grid { gap: 1rem; }
            .feature-card p { font-size: 0.85rem; }
            .about-section p { font-size: 0.85rem; }
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
        <button class="menu-toggle" onclick="document.querySelector('.nav-links').classList.toggle('open')" aria-label="Menu">&#9776;</button>
        <ul class="nav-links">
            <li><a href="#features">Features</a></li>
            <li><a href="#about">About</a></li>
            <li><a href="/agis">AGIS</a></li>
            <li><a href="${DISCORD_INVITE}" target="_blank">Support</a></li>
        </ul>
    </nav>
    </div>

    <main class="page">
        <section class="hero">
            <div class="hero-glow"></div>
            <h1 class="anim-fade-up delay-1">The Discord AI with <span class="accent">Actual Personality</span></h1>
            <p class="anim-fade-up delay-2">Stop using boring bots. Jarvis does AI chat, voice conversations, music, and AutoMod. Like an actual member of your server.</p>
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
                    <p>Run /voice and he joins your call. Say "Jarvis" and talk, he hears you and talks back. Forget to say his name and he pretends you don't exist. Works best if you're British, apparently.</p>
                </div>
                <div class="feature-card">
                    <span class="feature-icon">🎵</span>
                    <h3>Music</h3>
                    <p>Drop a link, hit play. Queue, skip, loop, volume. It just works. No 15-step setup required.</p>
                </div>
                <div class="feature-card">
                    <span class="feature-icon">🛡️</span>
                    <h3>AutoMod</h3>
                    <p>Spam, toxicity, sketchy links. Handled. You can stop babysitting your server now.</p>
                </div>
            </div>
        </section>

        <section class="how-it-works">
            <h2>How It Works</h2>
            <div class="steps">
                <div class="step">
                    <div class="step-num">1</div>
                    <h3>Invite</h3>
                    <p>Add Jarvis to your server. Takes about 30 seconds. No config needed, he just shows up and starts working.</p>
                </div>
                <div class="step">
                    <div class="step-num">2</div>
                    <h3>Talk</h3>
                    <p>Mention him, say his name, use slash commands. He picks up context from the conversation and actually remembers who you are.</p>
                </div>
                <div class="step">
                    <div class="step-num">3</div>
                    <h3>Enjoy</h3>
                    <p>He handles AI chat, voice calls, music, and moderation. You just use your server like normal. He fits in.</p>
                </div>
            </div>
        </section>

        <section class="tech-section">
            <h2>Under the Hood</h2>
            <div class="tech-grid">
                <span class="tech-tag">Node.js</span>
                <span class="tech-tag">Discord.js</span>
                <span class="tech-tag">50+ AI Models</span>
                <span class="tech-tag">Gemini</span>
                <span class="tech-tag">Mistral</span>
                <span class="tech-tag">DeepSeek</span>
                <span class="tech-tag">Llama</span>
                <span class="tech-tag">Qwen</span>
                <span class="tech-tag">Gemma</span>
                <span class="tech-tag">GPT</span>
                <span class="tech-tag">Speech-to-Text</span>
                <span class="tech-tag">Text-to-Speech</span>
                <span class="tech-tag">Encrypted Memory</span>
                <span class="tech-tag">Auto-Failover</span>
                <span class="tech-tag">Open Source</span>
            </div>
        </section>

        <section class="about-section" id="about">
            <h2>About AGIS</h2>
            <p>AGIS stands for Artificial General Intelligent System. It started as a name for a framework that didn't exist yet. The name stuck, the framework is still a work in progress, but the things built under it are very real and used by thousands of people every day.</p>
            <p>Jarvis is the first and main project under AGIS. He started as a joke bot in a friend's Discord server and turned into something way bigger than expected. Now he's running on over 500 servers, talking to people across the world, handling voice calls, playing music, moderating servers, and doing it all for free. There's no premium version. There's no "upgrade to unlock this feature." Everything just works out of the box.</p>
            <p>The whole thing is built and maintained by one person. No team, no investors, no company behind it. Just someone who wanted to make a Discord bot that didn't feel like talking to a customer service chatbot. The goal was always to make something that felt like an actual member of your server, not a tool you tolerate because it's useful.</p>
            <p>All of the code is <a href="https://github.com/not-antoni/jarvis-ai" target="_blank">open source on GitHub</a>. You can read every line, fork it, break it, fix it, whatever you want. Transparency isn't a marketing word here, it's just how the project works.</p>
        </section>

        <section class="about-section">
            <h2>The Community</h2>
            <p>AGIS Operations is the Discord server where everything happens. That's where people who use Jarvis hang out, report bugs when something breaks, suggest features they want to see, and sometimes just talk to Jarvis because they're bored. It's not a corporate community with rules about staying on topic. It's more like a group chat that happens to also be the support server.</p>
            <p>Feature requests actually get built. Bug reports actually get fixed. If something is broken at 2am, someone is probably already looking at it. The whole project moves fast because there's no approval process or ticket system. Someone says "this is broken" and it gets patched.</p>
            <p><a href="${DISCORD_INVITE}" target="_blank">Come join</a> if that sounds like your kind of thing.</p>
        </section>

        <section class="about-section">
            <h2>Why It's Free</h2>
            <p>People ask this a lot. Jarvis uses over 50 AI models from providers like Google, Mistral, DeepSeek, Meta, and others. Most of those providers offer generous free tiers for developers. The infrastructure runs on cloud credits and the occasional prayer. It works because the project is lean and the person running it would rather keep it free than charge people for something that should just exist.</p>
            <p>There's no catch. No data selling, no ads, no "free trial that expires." If that ever changes, you'll hear about it first. But honestly, the plan is to keep it this way.</p>
        </section>

        <section class="about-section">
            <h2>How the AI Works</h2>
            <p>Jarvis doesn't run on one model. He routes through 50+ models from different providers and picks whichever one is healthy and available at that moment. If one provider goes down, he switches to another one automatically. You don't notice and you don't have to care. The whole system is built around redundancy because no single AI provider has 100% uptime and pretending otherwise is a recipe for a dead bot.</p>
            <p>He also has memory. Not the "I remember the last 5 messages" kind. Jarvis stores conversations in an encrypted database and uses keyword relevance to pull up context from past interactions. So if you talked to him about something three weeks ago, he might actually remember. It's not perfect, but it's a lot better than starting from scratch every time.</p>
            <p>Voice works the same way. You join a voice channel, run a command, and he listens for his name. When you say "Jarvis" and then talk, he processes what you said in real time, generates a response, and speaks it back. No audio is ever recorded or stored. It goes in, gets transcribed, and disappears.</p>
        </section>

        <section class="about-section">
            <h2>Contact</h2>
            <p>For questions, partnerships, press, or anything else you can reach out at <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>. Response times vary depending on what's on fire that day, but emails do get read.</p>
            <p>If you just want to talk, the fastest way is the <a href="${DISCORD_INVITE}" target="_blank">Discord server</a>. You'll probably get a response within minutes there, either from the developer or from Jarvis himself. He's always online. He doesn't sleep. That's either impressive or concerning depending on how you look at it.</p>
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

        // Scroll-triggered animations (bidirectional)
        const scrollObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('scroll-visible');
                } else {
                    entry.target.classList.remove('scroll-visible');
                }
            });
        }, { threshold: 0.12 });
        document.querySelectorAll('.feature-card, .how-it-works, .step, .tech-section, .about-section').forEach(el => {
            el.classList.add('scroll-reveal');
            scrollObserver.observe(el);
        });

        // Close mobile nav on link tap
        document.querySelectorAll('.nav-links a').forEach(a => {
            a.addEventListener('click', () => document.querySelector('.nav-links').classList.remove('open'));
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

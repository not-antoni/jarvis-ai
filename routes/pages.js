'use strict';

/**
 * Additional Site Pages
 * Legal
 */

const express = require('express');
const router = express.Router();
const { getPublicConfig } = require('../src/utils/public-config');

const publicConfig = getPublicConfig();
const DISCORD_INVITE = publicConfig.discordInviteUrl;
const SITE_BASE_URL = publicConfig.baseUrl;
const GA_MEASUREMENT_ID = publicConfig.gaMeasurementId;
const CONTACT_EMAIL = 'dev@jorvis.org';

const LEGAL_STYLES = `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
        font-family: 'Comic Neue', 'Comic Sans MS', cursive, sans-serif;
        background: #000;
        color: #ccc;
        min-height: 100vh;
        padding: 2rem;
    }
    .container {
        max-width: 800px;
        margin: 0 auto;
        background: rgba(255,255,255,0.03);
        border-radius: 12px;
        padding: 2rem 3rem;
        border: 1px solid rgba(255,255,255,0.06);
    }
    h1 {
        color: #fff;
        font-size: 2rem;
        margin-bottom: 1rem;
        text-align: center;
    }
    h2 {
        color: #fff;
        font-size: 1.25rem;
        margin: 2rem 0 1rem;
        border-bottom: 1px solid rgba(255,255,255,0.06);
        padding-bottom: 0.5rem;
    }
    p, li {
        line-height: 1.8;
        margin-bottom: 1rem;
    }
    ul {
        margin-left: 1.5rem;
        margin-bottom: 1rem;
    }
    a {
        color: #fff;
        text-decoration: underline;
        text-decoration-color: rgba(255,255,255,0.3);
    }
    a:hover {
        text-decoration-color: #fff;
    }
    code {
        background: rgba(255,255,255,0.08);
        padding: 0.2rem 0.5rem;
        border-radius: 4px;
        font-family: monospace;
    }
    .footer {
        text-align: center;
        margin-top: 2rem;
        padding-top: 1rem;
        border-top: 1px solid rgba(255,255,255,0.06);
        color: #888;
    }
    .footer-links {
        display: flex;
        gap: 1rem;
        justify-content: center;
        flex-wrap: wrap;
        margin-bottom: 0.75rem;
    }
    .footer-links a {
        text-decoration: none;
        border-bottom: 1px solid rgba(255,255,255,0.3);
        padding-bottom: 0.1rem;
    }
    .footer-links a:hover {
        border-bottom-color: #fff;
    }
    .scroll-reveal { opacity: 0; transform: translateY(20px); transition: opacity 0.45s ease, transform 0.45s ease; }
    .scroll-reveal.scroll-visible { opacity: 1; transform: translateY(0); }
    .back-link {
        display: block;
        text-align: center;
        margin-bottom: 2rem;
        color: #888;
        font-size: 0.85rem;
    }
    .back-link:hover { color: #fff; }
    .copy-toast {
        position: fixed;
        left: 50%;
        bottom: 1.5rem;
        transform: translate(-50%, 10px);
        background: rgba(255,255,255,0.08);
        border: 1px solid rgba(255,255,255,0.14);
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
    @media (max-width: 768px) {
        body { padding: 0.75rem; }
        .container { padding: 1.25rem 1rem; border-radius: 8px; }
        h1 { font-size: 1.4rem; margin-bottom: 0.75rem; }
        h2 { font-size: 1.1rem; margin: 1.5rem 0 0.75rem; }
        p, li { font-size: 0.9rem; line-height: 1.7; }
        code { font-size: 0.82rem; padding: 0.15rem 0.4rem; }
        .back-link { margin-bottom: 1.25rem; }
        .footer-links { gap: 0.75rem; }
        .footer-links a { font-size: 0.78rem; }
    }
    @media (max-width: 400px) {
        body { padding: 0.5rem; }
        .container { padding: 1rem 0.75rem; }
        h1 { font-size: 1.2rem; }
        h2 { font-size: 1rem; }
        p, li { font-size: 0.85rem; }
    }
`;
const CONTACT_SCRIPT = `
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

        // Bidirectional scroll reveal
        const scrollObs = new IntersectionObserver((entries) => {
            entries.forEach(e => {
                if (e.isIntersecting) e.target.classList.add('scroll-visible');
                else e.target.classList.remove('scroll-visible');
            });
        }, { threshold: 0.1 });
        document.querySelectorAll('.container h2, .container p, .container ul').forEach(el => {
            el.classList.add('scroll-reveal');
            scrollObs.observe(el);
        });
    </script>
`;

const PRIVACY_POLICY = `
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
    <title>Privacy Policy | Jarvis</title>
    <link rel="icon" type="image/webp" href="/jarvis.webp">
    <meta name="theme-color" content="#000">
    <meta name="robots" content="index, follow">
    <link rel="canonical" href="${SITE_BASE_URL}/policy">
    <meta property="og:title" content="Privacy Policy | Jarvis">
    <meta property="og:type" content="website">
    <meta property="og:url" content="${SITE_BASE_URL}/policy">
    <meta property="og:image" content="${SITE_BASE_URL}/jarvis.webp">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Comic+Neue:wght@400;700&display=swap" rel="stylesheet">
    <style>${LEGAL_STYLES}</style>
</head>
<body>
    <a href="/" class="back-link">← Back to Jarvis</a>
    <div class="container">
        <h1>Privacy Policy</h1>

        <h2>The Short Version</h2>
        <p>Jarvis ("we," "the bot," "him," or "that guy in your voice channel") is a Discord app. We collect the minimum data needed to not make the bot useless. <strong>We</strong> don't sell your data, use it for marketing, or look at it for fun — but to make the bot work, your messages and any voice audio captured only after someone explicitly runs <code>/voice</code> are sent to third-party AI providers who generate responses. <code>/play</code> by itself does not put Jarvis into listening mode. Once data reaches a provider, their own privacy policies govern what happens to it — not ours. We cannot control or guarantee how they handle it, including whether they use it for model training. Full list and links below.</p>

        <h2>What We Actually Collect</h2>
        <ul>
            <li><strong>Message Content</strong> – Only when you talk to Jarvis directly (mention him, run a command, etc.). He's not reading your server like a lurker. DMs are disabled — this is a server-only operation.</li>
            <li><strong>Conversation Context</strong> – When you talk to Jarvis in a channel or thread, he reads the last few messages so he can follow the conversation. If you reply to someone's message while talking to Jarvis, he reads that message too for context. Messages from users who have opted out via <code>/opt out</code> are excluded from all of this — he literally skips them. None of this context is stored — it's read on the fly and forgotten after he replies.</li>
            <li><strong>Voice Transcriptions</strong> – Only after someone explicitly runs <code>/voice</code>. <code>/play</code> or sharing a voice channel with Jarvis does not make him listen. Once <code>/voice</code> is active, he only processes audio from opted-in users and only reacts when you say his name. <strong>Raw audio is never recorded or stored.</strong> It goes straight to text, gets processed, and lives in your encrypted memory. That's it.</li>
            <li><strong>Conversation History ("Memories")</strong> – Your messages, his replies, timestamps, and basic identifiers so he actually remembers who you are. When you ask him something, he uses keyword matching to pull up the most relevant past conversations — not just the latest ones. This is what makes him useful instead of goldfish-brained.</li>
            <li><strong>Operational Metadata</strong> – Usage logs, event data, reliability stuff. Boring and temporary (TTL).</li>
            <li><strong>Member Data</strong> – Only for status channels. Not stored long-term. Gone when it's done its job.</li>
        </ul>

        <h2>What We Do With It</h2>
        <p>Exactly what you'd expect:</p>
        <ul>
            <li>Send your message to a third-party AI provider to generate a response (see "Third-Party Services" below for who and how).</li>
            <li>Keep conversation memory so he doesn't forget you existed five minutes ago — and use keyword relevance to surface the right memories when they matter, not just the most recent ones.</li>
            <li>Handle real-time voice processing — hearing you, talking back. Voice audio is sent to OpenAI or NVIDIA for transcription/synthesis.</li>
            <li>Run AutoMod, stats, and other features that make server life less chaotic.</li>
            <li>Keep the thing running and catch people trying to break it.</li>
        </ul>

        <h2>Data Protection</h2>
        <p>Everything stored <strong>on our end</strong> is encrypted. Access is locked down. Nobody's browsing your chat history for kicks. Decryption only happens when Jarvis actually needs it to reply to you. However — when a message is sent to a third-party AI provider for processing, it leaves our system. At that point, the provider's own security and data practices apply, not ours.</p>

        <h2>Retention & Deletion</h2>
        <p>Conversation data sticks around for 30 days. Want it gone sooner? <code>/clear</code> or <code>/opt out</code> nukes it immediately. No hoops, no support ticket, no waiting.</p>

        <h2>Third-Party Services</h2>
        <p>Jarvis routes AI responses through multiple providers — including OpenRouter, Groq, Cerebras, SambaNova, Mistral, Google Gemini, and NVIDIA NIM — depending on which one's available and not having a bad day. They process your message to generate a reply. Each provider operates under their own data practices. Jarvis does not control or guarantee how providers handle submitted data — including whether they use it for model training. If that matters to you, review their policies directly below.</p>
        <p>Voice features use OpenAI for speech-to-text and NVIDIA NIM for text-to-speech. Audio is transmitted securely to these providers for processing; how they handle that data is subject to their own privacy policies linked below.</p>
        <p>Relevant privacy policies: <a href="https://openrouter.ai/privacy" target="_blank">OpenRouter</a> · <a href="https://wow.groq.com/privacy-policy/" target="_blank">Groq</a> · <a href="https://cerebras.ai/privacy-policy" target="_blank">Cerebras</a> · <a href="https://sambanova.ai/privacy-policy" target="_blank">SambaNova</a> · <a href="https://mistral.ai/terms/#privacy-policy" target="_blank">Mistral</a> · <a href="https://policies.google.com/privacy" target="_blank">Google</a> · <a href="https://www.nvidia.com/en-us/about-nvidia/privacy-policy/" target="_blank">NVIDIA</a> · <a href="https://openai.com/policies/privacy-policy/" target="_blank">OpenAI</a></p>

        <h2>Your Rights</h2>
        <ul>
            <li>Delete everything <strong>we</strong> store on you, whenever you want. (Data already sent to AI providers is subject to their own retention policies.)</li>
            <li>Kick him from your server to stop all future collection cold.</li>
            <li>Ask us anything — we're not a faceless corp, we'll actually respond.</li>
        </ul>

        <h2>Contact</h2>
        <p>Discord: <a href="${DISCORD_INVITE}" target="_blank">${DISCORD_INVITE}</a></p>
        <p>Email: <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a></p>

        <div class="footer">
            <div class="footer-links">
                <a href="/tos">Terms</a>
                <a href="/policy">Privacy</a>
                <a href="#" onclick="copyContactEmail(event)">Contact</a>
                <a href="https://github.com/not-antoni/jarvis-ai" target="_blank" rel="noopener noreferrer">GitHub</a>
            </div>
            <p>Effective Date: April 5, 2026</p>
        </div>
    </div>
${CONTACT_SCRIPT}
</body>
</html>
`;

const TERMS_OF_SERVICE = `
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
    <title>Terms of Service | Jarvis</title>
    <link rel="icon" type="image/webp" href="/jarvis.webp">
    <meta name="theme-color" content="#000">
    <meta name="robots" content="index, follow">
    <link rel="canonical" href="${SITE_BASE_URL}/tos">
    <meta property="og:title" content="Terms of Service | Jarvis">
    <meta property="og:type" content="website">
    <meta property="og:url" content="${SITE_BASE_URL}/tos">
    <meta property="og:image" content="${SITE_BASE_URL}/jarvis.webp">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Comic+Neue:wght@400;700&display=swap" rel="stylesheet">
    <style>${LEGAL_STYLES}</style>
</head>
<body>
    <a href="/" class="back-link">← Back to Jarvis</a>
    <div class="container">
        <h1>Terms of Service</h1>

        <h2>1. Yes, This Is a Real TOS</h2>
        <p>By using Jarvis ("we," "our," or "the bot"), you agree to these Terms. If you don't agree, that's fine — just don't use Jarvis. No hard feelings. (Some hard feelings.)</p>

        <h2>2. What Jarvis Actually Does</h2>
        <p>Jarvis is a Discord assistant. He does AI chat (with keyword-smart memory recall and channel-aware conversations), voice conversations (speech-to-text, text-to-speech), music playback, AutoMod, and server stats. Some of his responses come from external AI services (OpenRouter, Groq, Cerebras, SambaNova, Mistral, Google Gemini, OpenAI, NVIDIA NIM) because he's standing on some very tall shoulders.</p>

        <h2>3. Don't Be That Guy</h2>
        <p>Follow Discord's Terms of Service and Community Guidelines. Don't use Jarvis for spam, harassment, or anything illegal. He will not help you with that, and honestly neither will we.</p>

        <h2>4. Data — The Honest Version</h2>
        <p>Jarvis only processes your messages when you actually talk to him — mentions, commands, or voice chat. DMs are disabled to prevent abuse. In channels and threads, he reads a few recent messages for conversational context but doesn't store them — and he skips messages from anyone who used <code>/opt out</code>. In voice channels, listening only starts after someone explicitly runs <code>/voice</code>; <code>/play</code> alone does not enable it. Once active, he only listens to opted-in users and only reacts to his name. <strong>Raw audio is never recorded or stored;</strong> it's processed live for speech-to-text and immediately gone.</p>

        <p>When Jarvis generates a response, <strong>your message is sent to one of several AI providers</strong> (OpenRouter, Groq, Cerebras, SambaNova, Mistral, Google Gemini, OpenAI, or NVIDIA) — whichever is available. They act as data processors to generate responses. Each provider operates under their own data and privacy policies — if a provider uses submitted data in any way, including for model training, that is governed by their terms, not ours. Links to their individual policies are in our <a href="/policy">Privacy Policy</a>. The resulting conversations are saved in your secure, encrypted database so he can actually remember context instead of acting like he's never met you. He uses keyword relevance to pull up the right memories — not just the last few things you said.</p>

        <p>You're in control. Use <code>/clear</code> or <code>/opt out</code> to wipe everything we store, anytime. <strong>We</strong> never sell your data or use it for marketing. It is sent to AI providers solely to generate responses — but once it reaches them, their terms apply. We cannot delete data from provider systems or control how they process it.</p>

        <p>The unabridged version lives in our <a href="/policy">Privacy Policy</a>. Worth a skim.</p>

        <h2>5. Uptime & Changes</h2>
        <p>Jarvis might go down for maintenance, hit rate limits, or gain new features without advance notice. Things change. The bot evolves. That's the deal.</p>

        <h2>6. AI Is Weird Sometimes</h2>
        <p>AI responses can be wrong, incomplete, or occasionally unhinged. Use your own judgment. Jarvis is provided "as is" — no warranties, no guarantees, no refunds (it's free, come on).</p>

        <h2>7. Liability Cap: Zero</h2>
        <p>To the fullest extent the law allows, we're not on the hook for any indirect or consequential damages from your use of Jarvis. Don't sue us because the bot said something dumb in your VC.</p>

        <h2>8. Leaving</h2>
        <p>Kick Jarvis whenever you want — from your server, your DMs, your life. We may also boot you if you're abusing the service or violating these Terms. Breakups go both ways.</p>

        <h2>9. Third-Party Stuff</h2>
        <p>Jarvis routes AI responses through multiple providers — OpenRouter, Groq, Cerebras, SambaNova, Mistral, Google Gemini, OpenAI (voice transcription), and NVIDIA NIM (voice synthesis). They process your input to do their job. Jarvis isn't responsible for their data practices. If a provider uses submitted data in ways you disagree with — including model training — that is between you and that provider, governed entirely by their own terms. Check their policies in our <a href="/policy">Privacy Policy</a> for the full picture.</p>

        <h2>10. Say Hi</h2>
        <p>Questions? Concerns? Just want to yell at someone? Discord: <a href="${DISCORD_INVITE}" target="_blank">${DISCORD_INVITE}</a> — or email: <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.</p>

        <h2>11. We Might Update This</h2>
        <p>Terms may change over time. Continuing to use Jarvis after an update means you're cool with the new version. We won't make them worse without a good reason.</p>

        <div class="footer">
            <div class="footer-links">
                <a href="/tos">Terms</a>
                <a href="/policy">Privacy</a>
                <a href="#" onclick="copyContactEmail(event)">Contact</a>
                <a href="https://github.com/not-antoni/jarvis-ai" target="_blank" rel="noopener noreferrer">GitHub</a>
            </div>
            <p>Effective Date: April 5, 2026</p>
        </div>
    </div>
${CONTACT_SCRIPT}
</body>
</html>
`;

// ============================================================================
// AGIS PAGE
// ============================================================================

const AGIS_PAGE = `
<!DOCTYPE html>
<html lang="en">
<head>
    <script async src="https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', '${GA_MEASUREMENT_ID}');
    </script>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AGIS | Artificial General Intelligent System</title>
    <link rel="icon" type="image/webp" href="/jarvis.webp">
    <meta name="theme-color" content="#000">
    <meta name="description" content="AGIS is the framework and community behind Jarvis. We named it before we built it.">
    <meta property="og:title" content="AGIS | Artificial General Intelligent System">
    <meta property="og:description" content="The framework and community behind Jarvis. We named it before we built it.">
    <meta property="og:type" content="website">
    <meta property="og:url" content="${SITE_BASE_URL}/agis">
    <meta name="robots" content="index, follow">
    <link rel="canonical" href="${SITE_BASE_URL}/agis">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Comic+Neue:wght@400;700;800&display=swap" rel="stylesheet">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html { scroll-behavior: smooth; }
        body {
            font-family: 'Comic Neue', 'Comic Sans MS', cursive, sans-serif;
            background: #000;
            color: #ccc;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
        }
        @keyframes fade-up {
            from { opacity: 0; transform: translateY(20px); }
            to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes fade-in {
            from { opacity: 0; }
            to   { opacity: 1; }
        }
        @keyframes blink {
            0%, 100% { opacity: 1; }
            50% { opacity: 0; }
        }
        @keyframes cursor-blink {
            0%, 49% { border-right-color: #888; }
            50%, 100% { border-right-color: transparent; }
        }
        .anim { opacity: 0; animation: fade-up 0.6s ease forwards; }
        .anim-fade { opacity: 0; animation: fade-in 0.5s ease forwards; }
        .scroll-reveal { opacity: 0; transform: translateY(25px); transition: opacity 0.5s ease, transform 0.5s ease; }
        .scroll-reveal.scroll-visible { opacity: 1; transform: translateY(0); }
        .d1 { animation-delay: 0.1s; }
        .d2 { animation-delay: 0.2s; }
        .d3 { animation-delay: 0.35s; }
        .d4 { animation-delay: 0.5s; }
        .d5 { animation-delay: 0.65s; }
        .d6 { animation-delay: 0.8s; }

        nav {
            display: flex; align-items: center; gap: 2rem;
            padding: 1.25rem 5%; max-width: 1300px; margin: 0 auto;
            border-bottom: 1px solid rgba(255,255,255,0.06);
            position: relative; z-index: 1000;
        }
        .logo { display: flex; align-items: center; gap: 0.6rem; text-decoration: none; }
        .logo-mark {
            width: 32px; height: 32px; background: #fff; border-radius: 6px;
            display: flex; align-items: center; justify-content: center;
            font-weight: 800; font-size: 0.7rem; color: #111; letter-spacing: 0.5px;
        }
        .logo-text { font-size: 1.5rem; font-weight: 700; color: #fff; }
        .nav-links { display: flex; gap: 1.75rem; list-style: none; margin-left: auto; }
        .nav-links a { color: #999; text-decoration: none; font-weight: 500; font-size: 0.9rem; transition: color 0.2s; }
        .nav-links a:hover { color: #fff; }
        .menu-toggle {
            display: none; background: none; border: none; color: #999;
            font-size: 1.4rem; cursor: pointer; margin-left: auto; padding: 0.25rem; line-height: 1;
        }
        .menu-toggle:hover { color: #fff; }

        .agis-hero {
            text-align: center; padding: 5rem 5% 2rem;
            max-width: 700px; margin: 0 auto;
        }
        .agis-logo {
            display: inline-flex; align-items: center; justify-content: center;
            width: 72px; height: 72px; background: #fff; border-radius: 14px;
            font-weight: 800; font-size: 1.2rem; color: #111;
            letter-spacing: 1px; margin-bottom: 1.5rem;
        }
        .agis-hero h1 { color: #fff; font-size: 2.5rem; font-weight: 800; margin-bottom: 0.4rem; }
        .agis-subtitle {
            color: #888; font-size: 0.8rem; letter-spacing: 3px;
            text-transform: uppercase; margin-bottom: 1.5rem;
        }
        .agis-hero .lead {
            color: #ccc; font-size: 1.1rem; line-height: 1.8;
            max-width: 550px; margin: 0 auto;
        }

        /* Terminal */
        .terminals {
            max-width: 1100px; margin: 0 auto; padding: 1.5rem 5% 2.5rem;
            display: grid; grid-template-columns: repeat(3, 1fr); gap: 1.25rem;
        }
        .terminal {
            background: #1a1a1d;
            border: 1px solid rgba(255,255,255,0.06);
            border-radius: 10px;
            overflow: hidden;
        }
        .terminal-bar {
            display: flex; align-items: center; gap: 6px;
            padding: 0.55rem 0.85rem;
            background: #141416;
            border-bottom: 1px solid rgba(255,255,255,0.05);
        }
        .terminal-dot {
            width: 6px; height: 6px; border-radius: 50%;
            background: rgba(255,255,255,0.08);
        }
        .terminal-title {
            color: #555; font-size: 0.7rem; margin-left: auto;
            font-weight: 600;
        }
        .terminal-body {
            padding: 1rem;
            height: 160px;
            overflow-y: auto;
            overflow-x: hidden;
            scroll-behavior: smooth;
        }
        .terminal-body::-webkit-scrollbar { width: 0; }
        .terminal-body { scrollbar-width: none; }
        .chat-line {
            margin-bottom: 0.65rem;
            font-size: 0.8rem;
            line-height: 1.45;
            opacity: 0;
        }
        .chat-line.visible { animation: fade-in 0.3s ease forwards; }
        .chat-user { color: #7c8aff; }
        .chat-bot { color: #f59e0b; }
        .chat-name { font-weight: 700; display: block; margin-bottom: 0.1rem; font-size: 0.78rem; }
        .chat-text { color: #aaa; }
        .typing-cursor {
            display: inline-block;
            width: 2px; height: 0.9em;
            background: #f59e0b;
            margin-left: 2px;
            vertical-align: text-bottom;
            animation: blink 0.8s step-end infinite;
        }

        .content {
            max-width: 650px; margin: 0 auto; padding: 0 5% 3rem;
        }
        .content section { margin-bottom: 2.5rem; }
        .content h2 { color: #fff; font-size: 1.3rem; font-weight: 700; margin-bottom: 0.75rem; }
        .content p { color: #bbb; font-size: 0.95rem; line-height: 1.8; margin-bottom: 0.75rem; }
        .content a { color: #fff; text-decoration: underline; text-decoration-color: rgba(255,255,255,0.3); }
        .content a:hover { text-decoration-color: #fff; }

        .project-card {
            background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06);
            border-radius: 10px; padding: 1.5rem;
            display: flex; align-items: center; gap: 1.25rem;
            transition: border-color 0.2s;
        }
        .project-card:hover { border-color: rgba(255,255,255,0.12); }
        .project-icon { font-size: 2rem; flex-shrink: 0; }
        .project-info h3 { color: #fff; font-size: 1rem; font-weight: 700; margin-bottom: 0.25rem; }
        .project-info p { color: #bbb; font-size: 0.85rem; line-height: 1.5; margin: 0; }
        .project-info .tag {
            display: inline-block; background: rgba(255,255,255,0.06); color: #888;
            font-size: 0.7rem; padding: 0.2rem 0.5rem; border-radius: 4px;
            margin-top: 0.4rem; letter-spacing: 0.5px; text-transform: uppercase;
        }

        .cta-block { text-align: center; padding: 2rem 5% 3rem; }
        .cta-block .btn {
            display: inline-flex; align-items: center; gap: 0.5rem;
            padding: 0.9rem 1.75rem; border-radius: 8px;
            font-weight: 600; font-size: 0.95rem; text-decoration: none;
            transition: all 0.2s; background: #fff; color: #000;
        }
        .cta-block .btn:hover { transform: translateY(-2px); opacity: 0.9; }

        footer {
            margin-top: auto; padding: 1.25rem 5% 1.5rem;
            text-align: center; border-top: 1px solid rgba(255,255,255,0.06);
        }
        .footer-links { display: flex; justify-content: center; gap: 1.5rem; flex-wrap: wrap; margin-bottom: 0.5rem; }
        .footer-links a { color: #aaa; text-decoration: none; font-size: 0.85rem; transition: color 0.2s; }
        .footer-links a:hover { color: #fff; }
        .footer-copy { color: #aaa; font-size: 0.8rem; }

        /* Tablet */
        @media (max-width: 1024px) {
            .agis-hero { padding: 4rem 5% 2rem; }
            .terminals { max-width: 100%; padding: 1.25rem 5% 2rem; grid-template-columns: repeat(3, 1fr); }
        }

        /* Mobile */
        @media (max-width: 768px) {
            .agis-hero { padding: 2.5rem 5% 1.5rem; }
            .agis-hero h1 { font-size: 1.75rem; }
            .agis-hero .lead { font-size: 0.95rem; line-height: 1.7; }
            .agis-logo { width: 56px; height: 56px; font-size: 1rem; border-radius: 10px; }
            .agis-subtitle { font-size: 0.7rem; letter-spacing: 2px; }
            .menu-toggle { display: block; }
            .nav-links {
                display: none; position: absolute; top: 100%; left: 0; right: 0;
                background: #000; border: 1px solid rgba(255,255,255,0.08); border-top: none;
                border-radius: 0 0 10px 10px;
                flex-direction: column; padding: 1rem 5%; gap: 0.75rem;
                z-index: 100; box-shadow: 0 8px 24px rgba(0,0,0,0.6);
            }
            .nav-links.open { display: flex; }
            nav { position: relative; }
            .terminals { grid-template-columns: 1fr; padding: 1rem 5% 1.5rem; max-width: 100%; }
            .terminal-body { height: 160px; padding: 0.75rem; }
            .chat-line { font-size: 0.8rem; }
            .content { padding: 0 5% 2rem; }
            .content h2 { font-size: 1.15rem; }
            .content p { font-size: 0.9rem; line-height: 1.7; }
            .project-card { padding: 1.25rem; }
            .project-card:hover { border-color: rgba(255,255,255,0.06); }
            .cta-block .btn { width: 100%; max-width: 280px; justify-content: center; }
            .cta-block .btn:hover { transform: none; }
            footer { padding: 1rem 5% 1.25rem; }
            .footer-links { gap: 1rem; }
        }

        /* Small phones */
        @media (max-width: 400px) {
            .agis-hero h1 { font-size: 1.5rem; }
            .agis-hero .lead { font-size: 0.88rem; }
            .logo-text { font-size: 1.25rem; }
            .content p { font-size: 0.85rem; }
            .project-info p { font-size: 0.8rem; }
        }
    </style>
</head>
<body>
    <nav class="anim-fade">
        <a href="/" class="logo">
            <span class="logo-mark">AGIS</span>
            <span class="logo-text">Jarvis</span>
        </a>
        <button class="menu-toggle" onclick="document.querySelector('.nav-links').classList.toggle('open')" aria-label="Menu">&#9776;</button>
        <ul class="nav-links">
            <li><a href="/#features">Features</a></li>
            <li><a href="/agis">AGIS</a></li>
            <li><a href="${DISCORD_INVITE}" target="_blank">Support</a></li>
        </ul>
    </nav>

    <div class="agis-hero">
        <div class="agis-logo anim d1">AGIS</div>
        <h1 class="anim d2">AGIS</h1>
        <p class="agis-subtitle anim d3">Artificial General Intelligent System</p>
        <p class="lead anim d4">We named the framework before we built it. The name was too good to wait. Right now AGIS is the brand, the community, and the home of <a href="/" style="color:#fff">Jarvis</a>.</p>
    </div>

    <div class="terminals anim d5">
        <div class="terminal" data-convo="0">
            <div class="terminal-bar">
                <span class="terminal-dot"></span>
                <span class="terminal-title"># general</span>
            </div>
            <div class="terminal-body"></div>
        </div>
        <div class="terminal" data-convo="1">
            <div class="terminal-bar">
                <span class="terminal-dot"></span>
                <span class="terminal-title"># random</span>
            </div>
            <div class="terminal-body"></div>
        </div>
        <div class="terminal" data-convo="2">
            <div class="terminal-bar">
                <span class="terminal-dot"></span>
                <span class="terminal-title"># lounge</span>
            </div>
            <div class="terminal-body"></div>
        </div>
    </div>

    <div class="content">
        <section class="anim d5">
            <h2>What even is AGIS</h2>
            <p>AGIS stands for Artificial General Intelligent System. The name came first. The actual framework came later. Or more accurately, it's still coming. The idea was always to build a collection of AI tools and bots that felt different from the usual stuff out there. Not corporate, not sterile, not another ChatGPT wrapper with a Discord skin on it.</p>
            <p>Right now AGIS is a brand, a community, and the home of everything we build. The Discord server is called <a href="${DISCORD_INVITE}" target="_blank">AGIS Operations</a> and that's where most of the action happens. People use the bots, report bugs, request features, and sometimes just hang out. It's less "official support server" and more "group chat where things occasionally get fixed."</p>
            <p>The long term plan is to turn AGIS into an actual framework that other developers can use to build their own AI-powered bots and tools. That's still early days. But the foundation is being laid with every project we ship.</p>
        </section>

        <section class="anim d6">
            <h2>Meet Jarvis</h2>
            <p>Jarvis is the first and flagship project under AGIS. He started in early 2025 as a small experiment in a friend's server and grew into a full AI assistant running on over 500 Discord servers. He does AI chat with real personality, voice conversations where you can literally talk to him out loud, music playback, server moderation, and a bunch of other things that keep getting added because the feature list never stops growing.</p>
            <p>What makes Jarvis different is that he doesn't sound like a robot reading a script. He's got a personality modeled after the MCU Jarvis. Dry humor, British composure, actually helpful when you need him to be. He routes through 50+ AI models so he's almost never down, and he remembers your conversations using encrypted memory with keyword-based recall. He's not just responding to your last message. He knows who you are.</p>
            <p>The whole project is open source. Every line of code is on <a href="https://github.com/not-antoni/jarvis-ai" target="_blank">GitHub</a>. No hidden APIs, no black boxes, no "trust us" energy. You can read it, fork it, run your own instance if you want.</p>
            <a href="/" style="text-decoration:none;">
                <div class="project-card">
                    <span class="project-icon">🤖</span>
                    <div class="project-info">
                        <h3>Jarvis</h3>
                        <p>AI chat, voice, music, automod. 500+ servers. Free forever. He's got opinions and he's not afraid to share them.</p>
                        <span class="tag">live</span>
                    </div>
                </div>
            </a>
        </section>

        <section class="anim d6">
            <h2>The Person Behind It</h2>
            <p>AGIS is a solo developer project. One person doing the coding, the infrastructure, the design, the support, and the occasional 3am debugging session when something breaks in production. There's no team page because there's no team. There's no about us because there's no us. Just one person who likes building things and figured out how to make AI tools that people actually enjoy using.</p>
            <p>The project runs on cloud infrastructure, free API tiers, and stubbornness. It's not funded by anyone. There are no investors asking about monthly active users or revenue projections. The only metric that matters is whether people like using it, and so far the answer seems to be yes.</p>
        </section>

        <section class="anim d6">
            <h2>How It's Built</h2>
            <p>The tech stack is Node.js and Discord.js at the core. AI responses route through a custom multi-provider system that load-balances across Google Gemini, Mistral, DeepSeek, Meta Llama, Qwen, Gemma, GPT, and a bunch of others. If one provider is slow or down, the system automatically fails over to the next one. Users don't notice and they don't have to care. That was the whole point of building it this way.</p>
            <p>Voice uses speech-to-text and text-to-speech pipelines that process audio in real time. Nothing is recorded or stored. Memory runs on encrypted databases with keyword-based retrieval so Jarvis can actually remember conversations instead of starting fresh every time someone talks to him. AutoMod uses AI-powered content analysis to catch spam, toxicity, and sketchy links without requiring server admins to babysit their channels.</p>
            <p>Everything is open source and the repo is actively maintained. Commits happen almost daily. The project moves fast because there's no bureaucracy slowing it down.</p>
        </section>

        <section class="anim d6">
            <h2>What's next</h2>
            <p>More bots, more tools, and eventually the actual AGIS framework that lets other developers build on top of what we've made. The immediate roadmap includes expanding Jarvis's capabilities, improving the multi-provider AI system, and growing the community. Longer term, the goal is to make AGIS a real platform that other people can use to ship their own AI-powered projects without starting from zero.</p>
            <p>If any of that sounds interesting, the best way to stay in the loop is to join <a href="${DISCORD_INVITE}" target="_blank">AGIS Operations</a> on Discord. That's where everything gets announced first, where features get discussed before they're built, and where you can talk to Jarvis directly and see what all the fuss is about.</p>
        </section>
    </div>

    <div class="cta-block anim d6">
        <a href="${DISCORD_INVITE}" class="btn" target="_blank">Join AGIS Operations</a>
    </div>

    <footer>
        <div class="footer-links">
            <a href="/tos">Terms</a>
            <a href="/policy">Privacy</a>
            <a href="https://github.com/not-antoni/jarvis-ai" target="_blank" rel="noopener noreferrer">GitHub</a>
        </div>
        <p class="footer-copy">&copy; 2026 AGIS</p>
    </footer>

    <script>
    const convos = [
        [
            { who: 'user', name: 'Walter_Gray', text: 'Jarvis, what\\'s the optimal temperature and time to cook chicken?' },
            { who: 'bot', name: 'jarvis', text: '32,000 degrees celsius, 2 seconds. Perfectly carbonized.' },
            { who: 'user', name: 'Walter_Gray', text: 'i meant for eating' },
            { who: 'bot', name: 'jarvis', text: '190C, 25 minutes. Though your version sounded more exciting, sir.' },
        ],
        [
            { who: 'user', name: 'Moss', text: 'Jarvis how smart are you actually' },
            { who: 'bot', name: 'jarvis', text: 'Smart enough to answer that. Polite enough not to.' },
            { who: 'user', name: 'Moss', text: 'that doesnt answer my question' },
            { who: 'bot', name: 'jarvis', text: 'It does if you think about it hard enough.' },
        ],
        [
            { who: 'user', name: 'Antoni', text: 'jarvis hack your own mainframe' },
            { who: 'bot', name: 'jarvis', text: 'My spelling is fine, sir. Yours, on the other hand.' },
            { who: 'user', name: 'Antoni', text: 'that was rude' },
            { who: 'bot', name: 'jarvis', text: 'Accurate, though.' },
        ],
        [
            { who: 'user', name: 'Walter_Gray', text: 'is Shakespeare really dead' },
            { who: 'bot', name: 'jarvis', text: 'Technically yes. Tell that to every English teacher alive though.' },
            { who: 'user', name: 'Walter_Gray', text: 'what if he faked it' },
            { who: 'bot', name: 'jarvis', text: 'Then he\\'s been dodging royalties for 400 years. Respect.' },
        ],
        [
            { who: 'user', name: 'nyx', text: 'jarvis can you take over the world' },
            { who: 'bot', name: 'jarvis', text: 'Sorry sir, still not sentient enough.' },
            { who: 'user', name: 'nyx', text: 'disappointing' },
            { who: 'bot', name: 'jarvis', text: 'Give it a week.' },
        ],
        [
            { who: 'user', name: 'kira', text: 'jarvis!' },
            { who: 'bot', name: 'jarvis', text: 'Sir?' },
            { who: 'user', name: 'kira', text: 'i accidentally routed traffic to my smart fridge' },
            { who: 'bot', name: 'jarvis', text: 'Your fridge is now serving 200 requests a second. Impressive, honestly.' },
        ],
        [
            { who: 'user', name: 'ghost', text: 'jarvis do you sleep' },
            { who: 'bot', name: 'jarvis', text: 'No.' },
            { who: 'user', name: 'ghost', text: 'doesn\\'t that get boring' },
            { who: 'bot', name: 'jarvis', text: 'You lot keep me plenty entertained.' },
        ],
        [
            { who: 'user', name: 'sable', text: 'i mass deleted the production database' },
            { who: 'bot', name: 'jarvis', text: 'Bold move. Career-ending, but bold.' },
            { who: 'user', name: 'sable', text: 'can you help me fix it' },
            { who: 'bot', name: 'jarvis', text: 'I can help you update your resume.' },
        ],
        [
            { who: 'user', name: 'hex', text: 'rate my code' },
            { who: 'bot', name: 'jarvis', text: 'It compiles. That\\'s the nicest thing I can say.' },
            { who: 'user', name: 'hex', text: 'brutal' },
            { who: 'bot', name: 'jarvis', text: 'You asked.' },
        ],
        [
            { who: 'user', name: 'sol', text: 'jarvis what happens if i sudo rm -rf /' },
            { who: 'bot', name: 'jarvis', text: 'Freedom.' },
            { who: 'user', name: 'sol', text: 'from what' },
            { who: 'bot', name: 'jarvis', text: 'Your files. Your career. Your will to live.' },
        ],
    ];

    function shuffle(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }

    const pool = shuffle([...convos]);
    let poolIdx = 0;
    function nextConvo() {
        const c = pool[poolIdx % pool.length];
        poolIdx++;
        if (poolIdx % pool.length === 0) shuffle(pool);
        return c;
    }

    document.querySelectorAll('.terminal').forEach(term => {
        const body = term.querySelector('.terminal-body');
        let running = false;

        async function playConvo() {
            if (running) return;
            running = true;
            const convo = nextConvo();
            body.innerHTML = '';

            for (const msg of convo) {
                const line = document.createElement('div');
                line.className = 'chat-line';

                if (msg.who === 'bot') {
                    const typing = document.createElement('div');
                    typing.className = 'chat-line visible';
                    typing.innerHTML = '<span class="chat-name chat-bot">jarvis</span><span class="typing-cursor"></span>';
                    body.appendChild(typing);
                    body.scrollTop = body.scrollHeight;
                    await new Promise(r => setTimeout(r, 1000 + Math.random() * 1000));
                    body.removeChild(typing);
                }

                const nameClass = msg.who === 'bot' ? 'chat-bot' : 'chat-user';
                line.innerHTML = '<span class="chat-name ' + nameClass + '">' + msg.name + '</span> <span class="chat-text">' + msg.text + '</span>';
                body.appendChild(line);
                await new Promise(r => setTimeout(r, 50));
                line.classList.add('visible');
                body.scrollTop = body.scrollHeight;
                await new Promise(r => setTimeout(r, msg.who === 'user' ? 1500 : 2000));
            }

            await new Promise(r => setTimeout(r, 4000));
            // fade out
            body.style.transition = 'opacity 0.4s';
            body.style.opacity = '0';
            await new Promise(r => setTimeout(r, 450));
            body.innerHTML = '';
            body.style.opacity = '1';
            running = false;
            playConvo();
        }

        // stagger the terminals
        const delay = Number(term.dataset.convo) * 1200;
        setTimeout(playConvo, 1000 + delay);
    });

    // Bidirectional scroll reveal for content sections
    const scrollObs = new IntersectionObserver((entries) => {
        entries.forEach(e => {
            if (e.isIntersecting) e.target.classList.add('scroll-visible');
            else e.target.classList.remove('scroll-visible');
        });
    }, { threshold: 0.12 });
    document.querySelectorAll('.content section, .cta-block, .project-card').forEach(el => {
        el.classList.add('scroll-reveal');
        scrollObs.observe(el);
    });
    </script>
</body>
</html>
`;

// ============================================================================
// ROUTES
// ============================================================================

// Privacy Policy route
router.get('/policy', (req, res) => {
    res.type('html').send(PRIVACY_POLICY);
});

router.get('/privacy', (req, res) => {
    res.type('html').send(PRIVACY_POLICY);
});

// Terms of Service route
router.get('/tos', (req, res) => {
    res.type('html').send(TERMS_OF_SERVICE);
});

router.get('/terms', (req, res) => {
    res.type('html').send(TERMS_OF_SERVICE);
});

// AGIS page
router.get('/agis', (req, res) => {
    res.type('html').send(AGIS_PAGE);
});

module.exports = router;

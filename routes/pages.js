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
        body { padding: 1rem; }
        .container { padding: 1.5rem; }
        h1 { font-size: 1.5rem; }
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
            </div>
            <p>Effective Date: April 5, 2026</p>
        </div>
    </div>
${CONTACT_SCRIPT}
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

module.exports = router;

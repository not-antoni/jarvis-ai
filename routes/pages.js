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
        color: #666;
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
        color: #666;
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
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Comic+Neue:wght@400;700&display=swap" rel="stylesheet">
    <style>${LEGAL_STYLES}</style>
</head>
<body>
    <a href="/" class="back-link">← Back to Jarvis</a>
    <div class="container">
        <h1>Privacy Policy</h1>

        <h2>Overview</h2>
        <p>Jarvis ("we," or "the bot") is a Discord application offering AI-powered chat, AutoMod, and utility features. This Privacy Policy outlines what data we collect, how we use it, and your rights as a user.</p>

        <h2>What We Collect</h2>
        <ul>
            <li><strong>Message Content</strong> – Only when you interact with Jarvis (mentions, commands, or DMs). Used to generate replies and operate features.</li>
            <li><strong>Voice Transcriptions</strong> – When <code>/voice join</code> is active, Jarvis processes audio from opted-in users but only responds when addressed ("Jarvis"). <strong>Raw audio is never recorded or stored.</strong> It is converted directly to text, processed by the AI, and saved to your encrypted memory. Use <code>/voice leave</code> to stop.</li>
            <li><strong>Conversation History ("Memories")</strong> – Includes your messages, Jarvis's replies, timestamps, and basic identifiers to maintain context.</li>
            <li><strong>Operational Metadata</strong> – Usage data and event logs for reliability and performance. (TTL)</li>
            <li><strong>Member Data</strong> – Used only for status-related channels and not stored long-term.</li>
        </ul>

        <h2>How We Use It</h2>
        <p>We process data to:</p>
        <ul>
            <li>Generate relevant AI responses.</li>
            <li>Maintain conversation memory and personalization.</li>
            <li>Process voice chat in real time for speech-to-text and text-to-speech in voice channels.</li>
            <li>Support AutoMod, statistics, and other bot functions.</li>
            <li>Improve stability and detect abuse.</li>
        </ul>

        <h2>Data Protection</h2>
        <p>All stored data is encrypted and handled with strict access controls. No personal information is shared, sold, or publicly visible. Decryption occurs only when required for active bot functions (replies).</p>

        <h2>Retention & Deletion</h2>
        <p>Conversation data remains for 30 days. Users may delete all stored data at any time using <code>/clear</code> or <code>/opt out</code>.</p>

        <h2>Third-Party Services</h2>
        <p>Jarvis uses external AI providers (e.g., OpenRouter) to generate responses. These providers may process message content temporarily for completions. Their privacy policy: <a href="https://openrouter.ai/privacy" target="_blank">openrouter.ai/privacy</a></p>
        <p>Voice features use NVIDIA NIM APIs for speech-to-text and text-to-speech processing. Audio is transmitted securely and is not retained by NVIDIA after processing. Their privacy policy: <a href="https://www.nvidia.com/en-us/about-nvidia/privacy-policy/" target="_blank">nvidia.com/privacy-policy</a></p>

        <h2>Your Rights</h2>
        <ul>
            <li>Delete stored data at any time.</li>
            <li>Remove Jarvis to stop all future data collection.</li>
            <li>Contact us for privacy inquiries.</li>
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
            <p>Effective Date: March 24, 2026</p>
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
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Comic+Neue:wght@400;700&display=swap" rel="stylesheet">
    <style>${LEGAL_STYLES}</style>
</head>
<body>
    <a href="/" class="back-link">← Back to Jarvis</a>
    <div class="container">
        <h1>Terms of Service</h1>

        <h2>1. Acceptance of Terms</h2>
        <p>By using Jarvis ("we," "our," or "the bot"), you agree to these Terms of Service. If you disagree, do not use Jarvis.</p>

        <h2>2. Description of Service</h2>
        <p>Jarvis is a Discord assistant that provides AI-powered chat, voice chat (speech-to-text and text-to-speech), music playback, AutoMod tools, server statistics, and direct message (DM) interaction. Some responses are generated through external AI services (such as OpenRouter and NVIDIA NIM).</p>

        <h2>3. Usage Requirements</h2>
        <p>You must comply with Discord's Terms of Service and Community Guidelines. Do not use Jarvis for spam, harassment, or any unlawful activity.</p>

        <h2>4. Data and Privacy Summary</h2>
        <p>Jarvis processes message content only when you interact with it (via mentions, commands, DMs, or voice chat). In voice channels, Jarvis must be invited via <code>/voice join</code> and will only process audio from users who have explicitly opted in. <strong>Raw audio is never recorded or stored;</strong> it is processed in real-time for speech-to-text and immediately discarded.</p>

        <p>When active in a voice channel, Jarvis only responds to mentions of its name ("Jarvis"). To generate responses, <strong>anonymized text transcriptions are processed via external AI service providers</strong>. These providers act as data processors and do not use your data to train their global models. Resulting interactions are stored in your secure, encrypted database to maintain conversational memory. You can stop voice processing at any time using <code>/voice leave</code>.</p>

        <p>Users maintain full control and can opt out of data storage or delete all stored "memories" at any time using in-bot commands (e.g., <code>/clear</code> or <code>/opt out</code>). Your data is never sold or shared with third parties for marketing purposes.</p>

        <p>Full details are outlined in our <a href="/policy">Privacy Policy</a>.</p>

        <h2>5. Availability and Updates</h2>
        <p>Jarvis may go offline for maintenance, rate limits, or feature changes without prior notice. Functionality may evolve over time.</p>

        <h2>6. Disclaimers</h2>
        <p>AI responses may occasionally be inaccurate, incomplete, or offensive. Use Jarvis at your own discretion. The service is provided "as is" without any warranties or guarantees.</p>

        <h2>7. Limitation of Liability</h2>
        <p>To the fullest extent permitted by law, we are not responsible for any indirect or consequential damages arising from your use of Jarvis.</p>

        <h2>8. Termination</h2>
        <p>You may remove Jarvis from your server or DMs at any time. We may suspend or terminate access for abuse or violation of these Terms.</p>

        <h2>9. Third-Party Services</h2>
        <p>Jarvis integrates with external AI providers (e.g., OpenRouter) to generate responses and NVIDIA NIM APIs for voice processing (speech-to-text and text-to-speech). These providers may process input data temporarily for inference. Jarvis is not responsible for the data handling practices of third-party services.</p>

        <h2>10. Contact</h2>
        <p>Questions or concerns? Contact us on Discord: <a href="${DISCORD_INVITE}" target="_blank">${DISCORD_INVITE}</a> or by email at <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.</p>

        <h2>11. Changes to Terms</h2>
        <p>We may update these Terms periodically. Continued use of Jarvis after changes means you accept the revised version.</p>

        <div class="footer">
            <div class="footer-links">
                <a href="/tos">Terms</a>
                <a href="/policy">Privacy</a>
                <a href="#" onclick="copyContactEmail(event)">Contact</a>
            </div>
            <p>Effective Date: March 24, 2026</p>
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

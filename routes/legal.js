'use strict';

const express = require('express');
const router = express.Router();

const PRIVACY_POLICY = `
<!DOCTYPE html>
<html lang="en">
<head>
    <!-- Google tag (gtag.js) -->
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-7P8W1MN168"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', 'G-7P8W1MN168');
    </script>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Privacy Policy | Jarvis</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            color: #e4e4e4;
            min-height: 100vh;
            padding: 2rem;
        }
        .container {
            max-width: 800px;
            margin: 0 auto;
            background: rgba(255,255,255,0.05);
            border-radius: 16px;
            padding: 2rem 3rem;
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255,255,255,0.1);
        }
        h1 {
            color: #00d4ff;
            font-size: 2.5rem;
            margin-bottom: 1rem;
            text-align: center;
        }
        h2 {
            color: #00d4ff;
            font-size: 1.5rem;
            margin: 2rem 0 1rem;
            border-bottom: 1px solid rgba(0,212,255,0.3);
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
            color: #00d4ff;
            text-decoration: none;
        }
        a:hover {
            text-decoration: underline;
        }
        .footer {
            text-align: center;
            margin-top: 2rem;
            padding-top: 1rem;
            border-top: 1px solid rgba(255,255,255,0.1);
            color: #888;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🔒 Privacy Policy</h1>
        
        <h2>Overview</h2>
        <p>Jarvis ("we," or "the bot") is a Discord application offering AI-powered chat, moderation, and utility features. This Privacy Policy outlines what data we collect, how we use it, and your rights as a user.</p>
        
        <h2>What We Collect</h2>
        <ul>
            <li><strong>Message Content</strong> – Only when you interact with Jarvis (mentions, commands, or DMs). Used to generate replies and operate features.</li>
            <li><strong>Conversation History ("Memories")</strong> – Includes your messages, Jarvis's replies, timestamps, and basic identifiers to maintain context.</li>
            <li><strong>Operational Metadata</strong> – Usage data and event logs for reliability and performance. (TTL)</li>
            <li><strong>Member Data</strong> – Used only for status-related channels and not stored long-term.</li>
            <li><strong>Moderation Database</strong> – Used for moderation filters across servers (these contain regex filters and blacklisted words)</li>
        </ul>
        
        <h2>How We Use It</h2>
        <p>We process data to:</p>
        <ul>
            <li>Generate relevant AI responses.</li>
            <li>Maintain conversation memory and personalization.</li>
            <li>Support moderation, statistics, and other bot functions.</li>
            <li>Improve stability and detect abuse.</li>
        </ul>
        
        <h2>Data Protection</h2>
        <p>All stored data is encrypted and handled with strict access controls. No personal information is shared, sold, or publicly visible. Decryption occurs only when required for active bot functions (replies).</p>
        
        <h2>Retention & Deletion</h2>
        <p>Conversation data remains for 30 days. Users may delete all stored data at any time using <code>/reset</code> or <code>/opt out</code>.</p>
        
        <h2>Third-Party Services</h2>
        <p>Jarvis uses external AI providers (e.g., OpenRouter) to generate responses. These providers may process message content temporarily for completions. Their privacy policy: <a href="https://openrouter.ai/privacy" target="_blank">https://openrouter.ai/privacy</a></p>
        
        <h2>Your Rights</h2>
        <ul>
            <li>Delete stored data at any time.</li>
            <li>Remove Jarvis to stop all future data collection.</li>
            <li>Contact us for privacy inquiries.</li>
        </ul>
        
        <h2>Contact</h2>
        <p>Discord: <a href="https://discord.com/invite/ksXzuBtmK5" target="_blank">https://discord.com/invite/ksXzuBtmK5</a></p>
        
        <div class="footer">
            <p>Effective Date: November 16, 2025</p>
            <p>This update reflects improved data protection and encryption practices.</p>
        </div>
    </div>
</body>
</html>
`;

const TERMS_OF_SERVICE = `
<!DOCTYPE html>
<html lang="en">
<head>
    <!-- Google tag (gtag.js) -->
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-7P8W1MN168"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', 'G-7P8W1MN168');
    </script>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Terms of Service | Jarvis</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            color: #e4e4e4;
            min-height: 100vh;
            padding: 2rem;
        }
        .container {
            max-width: 800px;
            margin: 0 auto;
            background: rgba(255,255,255,0.05);
            border-radius: 16px;
            padding: 2rem 3rem;
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255,255,255,0.1);
        }
        h1 {
            color: #00d4ff;
            font-size: 2.5rem;
            margin-bottom: 1rem;
            text-align: center;
        }
        h2 {
            color: #00d4ff;
            font-size: 1.5rem;
            margin: 2rem 0 1rem;
            border-bottom: 1px solid rgba(0,212,255,0.3);
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
            color: #00d4ff;
            text-decoration: none;
        }
        a:hover {
            text-decoration: underline;
        }
        .footer {
            text-align: center;
            margin-top: 2rem;
            padding-top: 1rem;
            border-top: 1px solid rgba(255,255,255,0.1);
            color: #888;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>📜 Terms of Service</h1>
        
        <h2>1. Acceptance of Terms</h2>
        <p>By using Jarvis ("we," "our," or "the bot"), you agree to these Terms of Service. If you disagree, do not use Jarvis.</p>
        
        <h2>2. Description of Service</h2>
        <p>Jarvis is a Discord assistant that provides AI-powered chat, moderation tools, server statistics, and direct message (DM) interaction. Some responses are generated through external AI services (such as OpenRouter).</p>
        
        <h2>3. Usage Requirements</h2>
        <p>You must comply with Discord's Terms of Service and Community Guidelines. Do not use Jarvis for spam, harassment, or any unlawful activity.</p>
        
        <h2>4. Data and Privacy Summary</h2>
        <p>Jarvis processes message content only when you interact directly with it (via mentions, commands, or DMs). To provide context-aware replies, Jarvis stores limited conversation history—user message, Jarvis reply, timestamp, and identifiers—in a secure database.</p>
        <p>Users cannot fully opt out of data storage, as it is required for memory features, but can delete all stored data at any time using in-bot commands (e.g., <code>/reset</code> or <code>!clear</code>). Data is not used to train AI models and is not sold or shared externally.</p>
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
        <p>Jarvis integrates with external AI providers (e.g., OpenRouter) to generate responses. These providers may process input text temporarily for inference. Jarvis is not responsible for the data handling practices of third-party services.</p>
        
        <h2>10. Contact</h2>
        <p>Questions or concerns? Contact us on Discord: <a href="https://discord.com/invite/ksXzuBtmK5" target="_blank">https://discord.com/invite/ksXzuBtmK5</a></p>
        
        <h2>11. Changes to Terms</h2>
        <p>We may update these Terms periodically. Continued use of Jarvis after changes means you accept the revised version.</p>
        
        <div class="footer">
            <p>Effective Date: November 16, 2025</p>
        </div>
    </div>
</body>
</html>
`;

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

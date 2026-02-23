'use strict';

const { SHARED_STYLES, NAV_HTML } = require('./shared-styles');

const COMMANDS_PAGE = `
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
    <title>Commands | Jarvis</title>
    <style>${SHARED_STYLES}
        .command-item {
            background: rgba(255,255,255,0.03);
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 8px;
            padding: 1rem;
            margin-bottom: 0.75rem;
            transition: all 0.3s;
        }
        .command-item:hover {
            background: rgba(255,255,255,0.06);
            border-color: rgba(0,212,255,0.3);
        }
        .command-name {
            color: #00d4ff;
            font-weight: 600;
            font-family: monospace;
        }
        .command-desc { color: #aaa; margin-top: 0.5rem; }
        .command-usage { color: #666; font-size: 0.9rem; margin-top: 0.25rem; }
        .category-tag {
            display: inline-block;
            background: rgba(138,43,226,0.2);
            color: #8a2be2;
            padding: 0.2rem 0.6rem;
            border-radius: 12px;
            font-size: 0.8rem;
            margin-left: 0.5rem;
        }
        .hidden { display: none; }
    </style>
</head>
<body>
    ${NAV_HTML}
    <div class="container">
        <h1>📚 Commands</h1>
        <p style="color: #888; margin-bottom: 2rem;">Use prefix <code>*j</code> or slash commands <code>/</code></p>

        <input type="text" class="search-box" id="searchBox" placeholder="🔍 Search commands..." oninput="filterCommands()">

        <div id="commandList">
            <h2>💬 AI & Chat</h2>
            <div class="command-item" data-category="ai">
                <span class="command-name">*j &lt;message&gt;</span>
                <span class="category-tag">AI</span>
                <p class="command-desc">Chat with Jarvis - just mention or use prefix</p>
            </div>
            <div class="command-item" data-category="ai">
                <span class="command-name">*j imagine &lt;prompt&gt;</span>
                <span class="category-tag">AI</span>
                <p class="command-desc">Generate AI images</p>
            </div>
            <div class="command-item" data-category="ai">
                <span class="command-name">*j reset</span>
                <span class="category-tag">AI</span>
                <p class="command-desc">Clear your conversation history</p>
            </div>

            <h2>💰 Economy</h2>
            <div class="command-item" data-category="economy">
                <span class="command-name">*j balance</span>
                <span class="category-tag">Economy</span>
                <p class="command-desc">Check your Stark Bucks balance</p>
            </div>
            <div class="command-item" data-category="economy">
                <span class="command-name">*j daily</span>
                <span class="category-tag">Economy</span>
                <p class="command-desc">Claim your daily reward</p>
            </div>
            <div class="command-item" data-category="economy">
                <span class="command-name">*j work</span>
                <span class="category-tag">Economy</span>
                <p class="command-desc">Work to earn Stark Bucks</p>
            </div>
            <div class="command-item" data-category="economy">
                <span class="command-name">*j leaderboard</span>
                <span class="category-tag">Economy</span>
                <p class="command-desc">View the richest users</p>
            </div>

            <h2>☕ Starkbucks (SBX)</h2>
            <div class="command-item" data-category="sbx">
                <span class="command-name">!sbx wallet</span>
                <span class="category-tag">SBX</span>
                <p class="command-desc">View your SBX wallet and balance</p>
            </div>
            <div class="command-item" data-category="sbx">
                <span class="command-name">!sbx buy &lt;amount&gt;</span>
                <span class="category-tag">SBX</span>
                <p class="command-desc">Buy SBX with Stark Bucks</p>
            </div>
            <div class="command-item" data-category="sbx">
                <span class="command-name">!sbx sell &lt;amount&gt;</span>
                <span class="category-tag">SBX</span>
                <p class="command-desc">Sell SBX for Stark Bucks</p>
            </div>
            <div class="command-item" data-category="sbx">
                <span class="command-name">!sbx invest &lt;amount&gt;</span>
                <span class="category-tag">SBX</span>
                <p class="command-desc">Invest SBX for daily returns</p>
            </div>
            <div class="command-item" data-category="sbx">
                <span class="command-name">!sbx store</span>
                <span class="category-tag">SBX</span>
                <p class="command-desc">View the SBX store items</p>
            </div>

            <h2>🛡️ Moderation</h2>
            <div class="command-item" data-category="mod">
                <span class="command-name">*j ban @user [reason]</span>
                <span class="category-tag">Mod</span>
                <p class="command-desc">Ban a user from the server</p>
            </div>
            <div class="command-item" data-category="mod">
                <span class="command-name">*j kick @user [reason]</span>
                <span class="category-tag">Mod</span>
                <p class="command-desc">Kick a user from the server</p>
            </div>
            <div class="command-item" data-category="mod">
                <span class="command-name">*j mute @user [duration]</span>
                <span class="category-tag">Mod</span>
                <p class="command-desc">Timeout a user</p>
            </div>
            <div class="command-item" data-category="mod">
                <span class="command-name">*j purge &lt;count&gt;</span>
                <span class="category-tag">Mod</span>
                <p class="command-desc">Delete multiple messages</p>
            </div>

            <h2>🎵 Music</h2>
            <div class="command-item" data-category="music">
                <span class="command-name">*j play &lt;song&gt;</span>
                <span class="category-tag">Music</span>
                <p class="command-desc">Play a song from YouTube/Spotify</p>
            </div>
            <div class="command-item" data-category="music">
                <span class="command-name">*j skip</span>
                <span class="category-tag">Music</span>
                <p class="command-desc">Skip the current song</p>
            </div>
            <div class="command-item" data-category="music">
                <span class="command-name">*j queue</span>
                <span class="category-tag">Music</span>
                <p class="command-desc">View the music queue</p>
            </div>
            <div class="command-item" data-category="music">
                <span class="command-name">*j stop</span>
                <span class="category-tag">Music</span>
                <p class="command-desc">Stop music and clear queue</p>
            </div>

            <h2>🔧 Utility</h2>
            <div class="command-item" data-category="utility">
                <span class="command-name">*j help</span>
                <span class="category-tag">Utility</span>
                <p class="command-desc">Show all available commands</p>
            </div>
            <div class="command-item" data-category="utility">
                <span class="command-name">*j ping</span>
                <span class="category-tag">Utility</span>
                <p class="command-desc">Check bot latency</p>
            </div>
            <div class="command-item" data-category="utility">
                <span class="command-name">*j avatar @user</span>
                <span class="category-tag">Utility</span>
                <p class="command-desc">Get a user's avatar</p>
            </div>
            <div class="command-item" data-category="utility">
                <span class="command-name">*j serverinfo</span>
                <span class="category-tag">Utility</span>
                <p class="command-desc">View server information</p>
            </div>
        </div>
    </div>

    <script>
        function filterCommands() {
            const query = document.getElementById('searchBox').value.toLowerCase();
            const items = document.querySelectorAll('.command-item');
            items.forEach(item => {
                const text = item.textContent.toLowerCase();
                item.classList.toggle('hidden', !text.includes(query));
            });
        }
    </script>
</body>
</html>
`;

module.exports = COMMANDS_PAGE;

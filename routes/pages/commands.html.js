'use strict';

const { getPublicConfig } = require('../../src/utils/public-config');
const { SHARED_STYLES, NAV_HTML } = require('./shared-styles');
const GA_MEASUREMENT_ID = getPublicConfig().gaMeasurementId;

const COMMANDS_PAGE = `
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
    <title>Commands | Jarvis</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>${SHARED_STYLES}

        .page-intro {
            margin-bottom: 2rem;
        }
        .page-intro p {
            color: #555;
            font-size: 0.9rem;
        }
        .page-intro code {
            color: #00d4ff;
        }

        .command-item {
            background: rgba(255,255,255,0.02);
            border: 1px solid rgba(255,255,255,0.06);
            border-radius: 8px;
            padding: 1rem 1.25rem;
            margin-bottom: 0.5rem;
            transition: border-color 0.2s;
        }
        .command-item:hover {
            border-color: rgba(255,255,255,0.12);
        }
        .command-header {
            display: flex;
            align-items: center;
            gap: 0.75rem;
        }
        .command-name {
            color: #00d4ff;
            font-weight: 600;
            font-family: 'SF Mono', 'Fira Code', 'Courier New', monospace;
            font-size: 0.9rem;
        }
        .category-tag {
            display: inline-block;
            padding: 0.15rem 0.5rem;
            border-radius: 4px;
            font-size: 0.7rem;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.03em;
        }
        .category-tag.ai { background: rgba(0,212,255,0.1); color: #00d4ff; }
        .category-tag.mod { background: rgba(239,68,68,0.1); color: #ef4444; }
        .category-tag.music { background: rgba(168,85,247,0.1); color: #a855f7; }
        .category-tag.utility { background: rgba(245,158,11,0.1); color: #f59e0b; }
        .command-desc {
            color: #888;
            margin-top: 0.4rem;
            font-size: 0.85rem;
            line-height: 1.5;
        }
        .category-heading {
            font-size: 1rem;
            font-weight: 600;
            color: #ccc;
            margin: 2rem 0 0.75rem;
            padding-bottom: 0.5rem;
            border-bottom: 1px solid rgba(255,255,255,0.06);
        }
        .category-heading:first-of-type {
            margin-top: 0;
        }
        .hidden { display: none; }
    </style>
</head>
<body>
    ${NAV_HTML}
    <div class="container">
        <h1>Commands</h1>
        <div class="page-intro">
            <p>Use prefix <code>*j</code> or slash commands <code>/</code></p>
        </div>

        <input type="text" class="search-box" id="searchBox" placeholder="Search commands..." oninput="filterCommands()">

        <div id="commandList">
            <h3 class="category-heading">AI & Chat</h3>
            <div class="command-item" data-category="ai">
                <div class="command-header">
                    <span class="command-name">*j &lt;message&gt;</span>
                    <span class="category-tag ai">AI</span>
                </div>
                <p class="command-desc">Chat with Jarvis - just mention or use prefix</p>
            </div>
            <div class="command-item" data-category="ai">
                <div class="command-header">
                    <span class="command-name">*j imagine &lt;prompt&gt;</span>
                    <span class="category-tag ai">AI</span>
                </div>
                <p class="command-desc">Generate AI images</p>
            </div>
            <div class="command-item" data-category="ai">
                <div class="command-header">
                    <span class="command-name">*j reset</span>
                    <span class="category-tag ai">AI</span>
                </div>
                <p class="command-desc">Clear your conversation history</p>
            </div>

            <h3 class="category-heading">Moderation</h3>
            <div class="command-item" data-category="mod">
                <div class="command-header">
                    <span class="command-name">*j ban @user [reason]</span>
                    <span class="category-tag mod">Mod</span>
                </div>
                <p class="command-desc">Ban a user from the server</p>
            </div>
            <div class="command-item" data-category="mod">
                <div class="command-header">
                    <span class="command-name">*j kick @user [reason]</span>
                    <span class="category-tag mod">Mod</span>
                </div>
                <p class="command-desc">Kick a user from the server</p>
            </div>
            <div class="command-item" data-category="mod">
                <div class="command-header">
                    <span class="command-name">*j mute @user [duration]</span>
                    <span class="category-tag mod">Mod</span>
                </div>
                <p class="command-desc">Timeout a user</p>
            </div>
            <div class="command-item" data-category="mod">
                <div class="command-header">
                    <span class="command-name">*j purge &lt;count&gt;</span>
                    <span class="category-tag mod">Mod</span>
                </div>
                <p class="command-desc">Delete multiple messages</p>
            </div>

            <h3 class="category-heading">Music</h3>
            <div class="command-item" data-category="music">
                <div class="command-header">
                    <span class="command-name">*j play &lt;song&gt;</span>
                    <span class="category-tag music">Music</span>
                </div>
                <p class="command-desc">Play a song from YouTube/Spotify</p>
            </div>
            <div class="command-item" data-category="music">
                <div class="command-header">
                    <span class="command-name">*j skip</span>
                    <span class="category-tag music">Music</span>
                </div>
                <p class="command-desc">Skip the current song</p>
            </div>
            <div class="command-item" data-category="music">
                <div class="command-header">
                    <span class="command-name">*j queue</span>
                    <span class="category-tag music">Music</span>
                </div>
                <p class="command-desc">View the music queue</p>
            </div>
            <div class="command-item" data-category="music">
                <div class="command-header">
                    <span class="command-name">*j stop</span>
                    <span class="category-tag music">Music</span>
                </div>
                <p class="command-desc">Stop music and clear queue</p>
            </div>

            <h3 class="category-heading">Utility</h3>
            <div class="command-item" data-category="utility">
                <div class="command-header">
                    <span class="command-name">*j help</span>
                    <span class="category-tag utility">Utility</span>
                </div>
                <p class="command-desc">Show all available commands</p>
            </div>
            <div class="command-item" data-category="utility">
                <div class="command-header">
                    <span class="command-name">*j ping</span>
                    <span class="category-tag utility">Utility</span>
                </div>
                <p class="command-desc">Check bot latency</p>
            </div>
            <div class="command-item" data-category="utility">
                <div class="command-header">
                    <span class="command-name">*j avatar @user</span>
                    <span class="category-tag utility">Utility</span>
                </div>
                <p class="command-desc">Get a user's avatar</p>
            </div>
            <div class="command-item" data-category="utility">
                <div class="command-header">
                    <span class="command-name">*j serverinfo</span>
                    <span class="category-tag utility">Utility</span>
                </div>
                <p class="command-desc">View server information</p>
            </div>
        </div>
    </div>

    <script>
        function filterCommands() {
            const query = document.getElementById('searchBox').value.toLowerCase();
            const items = document.querySelectorAll('.command-item');
            const headings = document.querySelectorAll('.category-heading');
            items.forEach(function(item) {
                const text = item.textContent.toLowerCase();
                item.classList.toggle('hidden', !text.includes(query));
            });
            // Hide category headings if all their commands are hidden
            headings.forEach(function(heading) {
                let next = heading.nextElementSibling;
                let anyVisible = false;
                while (next && !next.classList.contains('category-heading')) {
                    if (next.classList.contains('command-item') && !next.classList.contains('hidden')) {
                        anyVisible = true;
                    }
                    next = next.nextElementSibling;
                }
                heading.classList.toggle('hidden', !anyVisible);
            });
        }
    </script>
</body>
</html>
`;

module.exports = COMMANDS_PAGE;

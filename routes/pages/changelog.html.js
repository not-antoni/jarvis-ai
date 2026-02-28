'use strict';

const { SHARED_STYLES, NAV_HTML } = require('./shared-styles');

const CHANGELOG_PAGE = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Changelog | Jarvis</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Comic+Neue:wght@400;700&display=swap" rel="stylesheet">
    <style>${SHARED_STYLES}
        .version {
            background: rgba(255,255,255,0.02);
            border: 1px solid rgba(255,255,255,0.06);
            border-radius: 10px;
            padding: 1.5rem;
            margin-bottom: 1rem;
        }
        .version-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 1rem;
        }
        .version-number {
            font-size: 1.25rem;
            color: #00d4ff;
            font-weight: 700;
        }
        .version-date { color: #555; font-size: 0.85rem; }
        .change-list { margin-left: 1.25rem; color: #999; }
        .change-list li { margin-bottom: 0.5rem; font-size: 0.9rem; line-height: 1.5; }
        .tag {
            display: inline-block;
            padding: 0.15rem 0.5rem;
            border-radius: 4px;
            font-size: 0.7rem;
            font-weight: 600;
            margin-right: 0.4rem;
            text-transform: uppercase;
            letter-spacing: 0.03em;
        }
        .tag-new { background: rgba(0,204,106,0.1); color: #00cc6a; }
        .tag-fix { background: rgba(239,68,68,0.1); color: #ef4444; }
        .tag-improve { background: rgba(0,212,255,0.1); color: #00d4ff; }
        .tag-remove { background: rgba(245,158,11,0.1); color: #f59e0b; }
    </style>
</head>
<body>
    ${NAV_HTML}
    <div class="container">
        <h1>Changelog</h1>
        <p style="color: #555; margin-bottom: 2rem; font-size: 0.9rem;">Version history and updates</p>

        <div class="version">
            <div class="version-header">
                <span class="version-number">v2.1.0</span>
                <span class="version-date">February 2026</span>
            </div>
            <ul class="change-list">
                <li><span class="tag tag-remove">REMOVED</span> Stark Bucks economy system</li>
                <li><span class="tag tag-improve">IMPROVE</span> Redesigned website with unified visual style</li>
                <li><span class="tag tag-improve">IMPROVE</span> Status page now shows real service health</li>
                <li><span class="tag tag-fix">FIX</span> Cleaned up navigation across all pages</li>
            </ul>
        </div>

        <div class="version">
            <div class="version-header">
                <span class="version-number">v2.0.0</span>
                <span class="version-date">December 2025</span>
            </div>
            <ul class="change-list">
                <li><span class="tag tag-new">NEW</span> Website with Discord OAuth</li>
                <li><span class="tag tag-new">NEW</span> Auto SSL with Cloudflare Origin Certificates</li>
                <li><span class="tag tag-new">NEW</span> Auto Nginx reverse proxy setup</li>
                <li><span class="tag tag-improve">IMPROVE</span> Hybrid deployment mode</li>
                <li><span class="tag tag-improve">IMPROVE</span> Self-host installer wizard</li>
                <li><span class="tag tag-fix">FIX</span> Various bug fixes and optimizations</li>
            </ul>
        </div>

        <div class="version">
            <div class="version-header">
                <span class="version-number">v1.5.0</span>
                <span class="version-date">November 2025</span>
            </div>
            <ul class="change-list">
                <li><span class="tag tag-new">NEW</span> Moderator dashboard</li>
                <li><span class="tag tag-new">NEW</span> Multi-provider AI support</li>
                <li><span class="tag tag-improve">IMPROVE</span> Memory and conversation context</li>
            </ul>
        </div>

        <div class="version">
            <div class="version-header">
                <span class="version-number">v1.0.0</span>
                <span class="version-date">October 2025</span>
            </div>
            <ul class="change-list">
                <li><span class="tag tag-new">NEW</span> Initial release</li>
                <li><span class="tag tag-new">NEW</span> AI chat with context memory</li>
                <li><span class="tag tag-new">NEW</span> Basic moderation tools</li>
                <li><span class="tag tag-new">NEW</span> Music playback</li>
            </ul>
        </div>
    </div>
</body>
</html>
`;

module.exports = CHANGELOG_PAGE;

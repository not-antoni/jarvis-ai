'use strict';

const { SHARED_STYLES, NAV_HTML } = require('./shared-styles');

const CHANGELOG_PAGE = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Changelog | Jarvis</title>
    <style>${SHARED_STYLES}
        .version {
            background: rgba(255,255,255,0.03);
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 12px;
            padding: 1.5rem;
            margin-bottom: 1.5rem;
        }
        .version-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 1rem;
        }
        .version-number {
            font-size: 1.5rem;
            color: #00d4ff;
            font-weight: 700;
        }
        .version-date { color: #666; }
        .change-list { margin-left: 1.5rem; color: #aaa; }
        .change-list li { margin-bottom: 0.5rem; }
        .tag {
            display: inline-block;
            padding: 0.2rem 0.5rem;
            border-radius: 4px;
            font-size: 0.8rem;
            margin-right: 0.5rem;
        }
        .tag-new { background: rgba(0,255,136,0.2); color: #00ff88; }
        .tag-fix { background: rgba(255,68,68,0.2); color: #ff4444; }
        .tag-improve { background: rgba(0,212,255,0.2); color: #00d4ff; }
        .btn { padding: 0.75rem 1.5rem; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; display: inline-block; text-decoration: none; }
        .btn-primary { background: #00d4ff; color: #000; }
        .btn-primary:hover { background: #00b8e6; }
        .btn-secondary { background: rgba(255,255,255,0.1); color: #fff; }
        .btn-secondary:hover { background: rgba(255,255,255,0.2); }
        .btn-danger { background: #e74c3c; color: #fff; }
        .btn-danger:hover { background: #c0392b; }
    </style>
</head>
<body>
    ${NAV_HTML}
    <div class="container">
        <h1>📋 Changelog</h1>
        <p style="color: #888; margin-bottom: 2rem;">Version history and updates</p>

        <div class="version">
            <div class="version-header">
                <span class="version-number">v2.0.0</span>
                <span class="version-date">December 2025</span>
            </div>
            <ul class="change-list">
                <li><span class="tag tag-new">NEW</span> Starkbucks (SBX) exchange system</li>
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
                <li><span class="tag tag-new">NEW</span> Economy system with Stark Bucks</li>
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

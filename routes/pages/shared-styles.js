'use strict';

const { getPublicConfig } = require('../../src/utils/public-config');

const DISCORD_INVITE = getPublicConfig().discordInviteUrl;

const SHARED_STYLES = `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        background: linear-gradient(135deg, #0a0a1a 0%, #1a1a3e 50%, #0d0d2b 100%);
        color: #e4e4e4;
        min-height: 100vh;
    }
    .container {
        max-width: 1200px;
        margin: 0 auto;
        padding: 2rem;
    }
    nav {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 1.5rem 5%;
        max-width: 1400px;
        margin: 0 auto;
    }
    .logo {
        font-size: 1.8rem;
        font-weight: 700;
        background: linear-gradient(90deg, #00d4ff, #8a2be2);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        text-decoration: none;
    }
    .nav-links {
        display: flex;
        gap: 2rem;
        list-style: none;
    }
    .nav-links a {
        color: #b0b0b0;
        text-decoration: none;
        font-weight: 500;
        transition: color 0.3s;
    }
    .nav-links a:hover { color: #00d4ff; }
    h1 {
        font-size: 2.5rem;
        margin-bottom: 1rem;
        background: linear-gradient(90deg, #fff, #00d4ff);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
    }
    h2 {
        color: #00d4ff;
        font-size: 1.5rem;
        margin: 2rem 0 1rem;
        border-bottom: 1px solid rgba(0,212,255,0.3);
        padding-bottom: 0.5rem;
    }
    .card {
        background: rgba(255,255,255,0.05);
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 12px;
        padding: 1.5rem;
        margin-bottom: 1rem;
    }
    .btn {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.75rem 1.5rem;
        border-radius: 8px;
        font-weight: 600;
        text-decoration: none;
        transition: all 0.3s;
    }
    .btn-primary {
        background: linear-gradient(90deg, #00d4ff, #8a2be2);
        color: white;
    }
    .btn-primary:hover { transform: translateY(-2px); }
    code {
        background: rgba(0,212,255,0.1);
        padding: 0.2rem 0.5rem;
        border-radius: 4px;
        font-family: 'Courier New', monospace;
    }
    .search-box {
        width: 100%;
        padding: 1rem;
        background: rgba(255,255,255,0.05);
        border: 1px solid rgba(255,255,255,0.2);
        border-radius: 8px;
        color: #fff;
        font-size: 1rem;
        margin-bottom: 2rem;
    }
    .search-box:focus {
        outline: none;
        border-color: #00d4ff;
    }
    table {
        width: 100%;
        border-collapse: collapse;
    }
    th, td {
        padding: 1rem;
        text-align: left;
        border-bottom: 1px solid rgba(255,255,255,0.1);
    }
    th { color: #00d4ff; }
    .rank { color: #8a2be2; font-weight: bold; }
    .amount { color: #00ff88; }
`;

const NAV_HTML = `
    <nav>
        <a href="/" class="logo">⚡ Jarvis</a>
        <ul class="nav-links">
            <li><a href="/commands">Commands</a></li>
            <li><a href="/store">Store</a></li>
            <li><a href="/leaderboard">Leaderboard</a></li>
            <li><a href="/sbx">SBX</a></li>
            <li><a href="/crypto">Crypto</a></li>
            <li><a href="/status">Status</a></li>
            <li><a href="/docs">Docs</a></li>
            <li><a href="/me">My Portal</a></li>
        </ul>
    </nav>
`;

module.exports = { SHARED_STYLES, NAV_HTML, DISCORD_INVITE };

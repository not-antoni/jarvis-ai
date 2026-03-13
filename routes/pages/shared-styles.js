'use strict';

const { getPublicConfig } = require('../../src/utils/public-config');

const DISCORD_INVITE = getPublicConfig().discordInviteUrl;

const SHARED_STYLES = `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
        font-family: 'Comic Neue', 'Comic Sans MS', cursive, sans-serif;
        background: #000;
        color: #ccc;
        min-height: 100vh;
    }
    .container {
        max-width: 900px;
        margin: 0 auto;
        padding: 2rem;
    }
    nav {
        display: flex;
        align-items: center;
        gap: 2rem;
        padding: 1.25rem 5%;
        max-width: 1300px;
        margin: 0 auto;
        border-bottom: 1px solid rgba(255,255,255,0.06);
    }
    .logo {
        font-size: 1.5rem;
        font-weight: 700;
        color: #fff;
        text-decoration: none;
    }
    .nav-links {
        display: flex;
        gap: 1.75rem;
        list-style: none;
    }
    .nav-links a {
        color: #666;
        text-decoration: none;
        font-weight: 500;
        font-size: 0.9rem;
        transition: color 0.2s;
    }
    .nav-links a:hover { color: #fff; }
    h1 {
        font-size: 2rem;
        margin-bottom: 0.5rem;
        color: #fff;
        font-weight: 700;
    }
    h2 {
        color: #fff;
        font-size: 1.25rem;
        font-weight: 600;
        margin: 2rem 0 1rem;
    }
    .card {
        background: rgba(255,255,255,0.03);
        border: 1px solid rgba(255,255,255,0.06);
        border-radius: 10px;
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
        transition: all 0.2s;
    }
    .btn-primary {
        background: #fff;
        color: #000;
    }
    .btn-primary:hover { transform: translateY(-2px); opacity: 0.9; }
    code {
        background: rgba(255,255,255,0.08);
        padding: 0.2rem 0.5rem;
        border-radius: 4px;
        font-family: 'SF Mono', 'Fira Code', 'Courier New', monospace;
        font-size: 0.85em;
    }
    table {
        width: 100%;
        border-collapse: collapse;
    }
    th, td {
        padding: 1rem;
        text-align: left;
        border-bottom: 1px solid rgba(255,255,255,0.06);
    }
    th { color: #888; font-weight: 500; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em; }
    @media (max-width: 768px) {
        .nav-links { display: none; }
        .container { padding: 1.5rem; }
        h1 { font-size: 1.5rem; }
    }
`;

const NAV_HTML = `
    <nav>
        <a href="/" class="logo">Jarvis</a>
        <ul class="nav-links"></ul>
    </nav>
`;

module.exports = { SHARED_STYLES, NAV_HTML, DISCORD_INVITE };

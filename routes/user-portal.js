'use strict';

/**
 * User Portal Routes (/me)
 * Personal dashboard for authenticated users
 */

const express = require('express');
const router = express.Router();
const appContext = require('../src/core/app-context');
const userAuth = require('../src/services/user-auth');
const apiKeys = require('../src/services/api-keys');
const { getPublicConfig } = require('../src/utils/public-config');

let database = null;
const API_BASE_URL = `${getPublicConfig().baseUrl}/api/v1`;

function init(db) {
    database = db;
}

/**
 * Authentication middleware for /me routes
 */
function requireAuth(req, res, next) {
    const session = userAuth.getSessionFromRequest(req);
    if (!session) {
        return res.redirect('/auth/login?redirect=/me');
    }
    req.user = session;
    next();
}

/**
 * Get user's conversation history
 */
async function getUserConversations(userId, limit = 50) {
    if (!database || !database.isConnected) {
        return [];
    }
    try {
        const collection = database.db.collection('conversations');
        const convos = await collection
            .find({ $or: [{ userId: userId }, { odUserId: userId }] })
            .sort({ updatedAt: -1 })
            .limit(limit)
            .toArray();
        return convos;
    } catch (err) {
        return [];
    }
}

/**
 * Get servers where user is owner/admin
 */
async function getUserServers(userId, discordClient) {
    if (!discordClient) {
        return [];
    }
    
    const servers = [];
    for (const [, guild] of discordClient.guilds.cache) {
        if (guild.ownerId === userId) {
            servers.push({
                id: guild.id,
                name: guild.name,
                icon: guild.iconURL({ size: 64 }),
                memberCount: guild.memberCount,
                isOwner: true
            });
        }
    }
    return servers;
}

// Portal page styles
const PORTAL_STYLES = `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
        font-family: 'Comic Neue', 'Comic Sans MS', cursive, sans-serif;
        background: #000;
        color: #e4e4e4;
        min-height: 100vh;
    }
    .site-nav {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 1.25rem 5%;
        max-width: 1300px;
        margin: 0 auto;
        border-bottom: 1px solid rgba(255,255,255,0.06);
    }
    .site-nav .logo {
        font-size: 1.5rem;
        font-weight: 700;
        color: #fff;
        text-decoration: none;
    }
    .site-nav .nav-links {
        display: flex;
        gap: 1.75rem;
        list-style: none;
    }
    .site-nav .nav-links a {
        color: #777;
        text-decoration: none;
        font-weight: 500;
        font-size: 0.9rem;
        transition: color 0.2s;
    }
    .site-nav .nav-links a:hover { color: #fff; }
    .site-nav .nav-links a.active { color: #fff; }
    .portal-container { max-width: 900px; margin: 0 auto; padding: 2rem; }
    .portal-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 1.5rem 0;
        border-bottom: 1px solid rgba(255,255,255,0.06);
        margin-bottom: 2rem;
    }
    .user-info { display: flex; align-items: center; gap: 1rem; }
    .user-avatar { width: 56px; height: 56px; border-radius: 50%; border: 2px solid rgba(255,255,255,0.2); }
    .user-name { font-size: 1.25rem; font-weight: 600; color: #fff; }
    .user-id { color: #555; font-size: 0.8rem; }
    .nav-tabs {
        display: flex;
        gap: 0.5rem;
        margin-bottom: 2rem;
        flex-wrap: wrap;
    }
    .nav-tab {
        padding: 0.6rem 1.25rem;
        background: rgba(255,255,255,0.03);
        border: 1px solid rgba(255,255,255,0.06);
        border-radius: 6px;
        color: #777;
        cursor: pointer;
        transition: all 0.2s;
        text-decoration: none;
        font-size: 0.85rem;
        font-weight: 500;
    }
    .nav-tab:hover { background: rgba(255,255,255,0.06); color: #ccc; }
    .nav-tab.active { background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.2); color: #fff; }
    .section { display: none; }
    .section.active { display: block; }
    .card {
        background: rgba(255,255,255,0.02);
        border: 1px solid rgba(255,255,255,0.06);
        border-radius: 10px;
        padding: 1.5rem;
        margin-bottom: 1.25rem;
    }
    .card h2 { color: #fff; margin-bottom: 1rem; font-size: 1.1rem; font-weight: 600; }
    .stats-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
        gap: 0.75rem;
    }
    .stat-item {
        background: rgba(255,255,255,0.02);
        border: 1px solid rgba(255,255,255,0.06);
        border-radius: 8px;
        padding: 1rem;
        text-align: center;
    }
    .stat-value { font-size: 1.5rem; font-weight: 700; color: #fff; font-variant-numeric: tabular-nums; }
    .stat-label { color: #555; font-size: 0.8rem; margin-top: 0.25rem; }
    .api-key-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0.85rem 1rem;
        background: rgba(255,255,255,0.02);
        border: 1px solid rgba(255,255,255,0.06);
        border-radius: 8px;
        margin-bottom: 0.5rem;
        transition: border-color 0.2s;
    }
    .api-key-item:hover { border-color: rgba(255,255,255,0.12); }
    .api-key-info { flex: 1; }
    .api-key-name { font-weight: 500; font-size: 0.9rem; color: #ccc; margin-bottom: 0.2rem; }
    .api-key-preview { font-family: 'SF Mono', 'Fira Code', monospace; color: #666; font-size: 0.8rem; }
    .api-key-stats { color: #555; font-size: 0.75rem; margin-top: 0.2rem; }
    .btn {
        padding: 0.5rem 1rem;
        border-radius: 6px;
        border: none;
        cursor: pointer;
        font-size: 0.85rem;
        font-weight: 500;
        transition: all 0.2s;
    }
    .btn-primary {
        background: #fff;
        color: #000;
    }
    .btn-primary:hover { transform: translateY(-1px); }
    .btn-danger { background: rgba(255,255,255,0.04); color: #888; border: 1px solid rgba(255,255,255,0.08); }
    .btn-danger:hover { background: rgba(255,255,255,0.08); color: #ccc; }
    .btn-secondary { background: rgba(255,255,255,0.05); color: #888; border: 1px solid rgba(255,255,255,0.08); }
    .btn-secondary:hover { background: rgba(255,255,255,0.08); color: #ccc; }
    .create-key-form {
        display: flex;
        gap: 0.5rem;
        margin-bottom: 1rem;
    }
    .create-key-form input {
        flex: 1;
        padding: 0.65rem 0.85rem;
        background: rgba(255,255,255,0.04);
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 6px;
        color: #fff;
        font-size: 0.9rem;
        transition: border-color 0.2s;
    }
    .create-key-form input:focus { outline: none; border-color: rgba(255,255,255,0.3); }
    .create-key-form input::placeholder { color: #555; }
    .new-key-display {
        background: rgba(255,255,255,0.04);
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 8px;
        padding: 1rem;
        margin-bottom: 1rem;
        display: none;
    }
    .new-key-display.show { display: block; }
    .new-key-display code {
        display: block;
        background: rgba(0,0,0,0.3);
        padding: 0.65rem;
        border-radius: 4px;
        font-family: 'SF Mono', 'Fira Code', monospace;
        font-size: 0.8rem;
        word-break: break-all;
        margin: 0.5rem 0;
    }
    .convo-item {
        padding: 0.85rem 1rem;
        background: rgba(255,255,255,0.02);
        border: 1px solid rgba(255,255,255,0.06);
        border-radius: 8px;
        margin-bottom: 0.5rem;
        cursor: pointer;
        transition: border-color 0.2s;
    }
    .convo-item:hover { border-color: rgba(255,255,255,0.12); }
    .convo-preview { color: #888; font-size: 0.85rem; margin-top: 0.35rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .convo-time { color: #555; font-size: 0.75rem; }
    .server-item {
        display: flex;
        align-items: center;
        gap: 0.85rem;
        padding: 0.85rem 1rem;
        background: rgba(255,255,255,0.02);
        border: 1px solid rgba(255,255,255,0.06);
        border-radius: 8px;
        margin-bottom: 0.5rem;
        transition: border-color 0.2s;
    }
    .server-item:hover { border-color: rgba(255,255,255,0.12); }
    .server-icon { width: 40px; height: 40px; border-radius: 50%; background: rgba(255,255,255,0.06); }
    .server-name { font-weight: 500; font-size: 0.9rem; color: #ccc; }
    .server-members { color: #555; font-size: 0.8rem; }
    .empty-state { text-align: center; color: #555; padding: 2.5rem; font-size: 0.85rem; }
    .message { padding: 0.85rem 1rem; border-radius: 8px; margin-bottom: 1rem; display: none; font-size: 0.85rem; }
    .message.show { display: block; }
    .message.success { background: rgba(255,255,255,0.04); color: #ccc; border: 1px solid rgba(255,255,255,0.1); }
    .message.error { background: rgba(255,255,255,0.03); color: #888; border: 1px solid rgba(255,255,255,0.08); }
    .logout-btn { color: #666; text-decoration: none; font-size: 0.85rem; }
    .logout-btn:hover { color: #fff; }
    @media (max-width: 768px) {
        .site-nav .nav-links { display: none; }
        .portal-header { flex-direction: column; gap: 1rem; text-align: center; }
        .portal-container { padding: 1.5rem; }
    }
`;

const PORTAL_PAGE = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>My Portal | Jarvis</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Comic+Neue:wght@400;700&display=swap" rel="stylesheet">
    <style>${PORTAL_STYLES}</style>
</head>
<body>
    <nav class="site-nav">
        <a href="/" class="logo">Jarvis</a>
        <ul class="nav-links">
            <li><a href="/status">Status</a></li>
            <li><a href="/me" class="active">My Portal</a></li>
            <li><a href="/moderator">Mod Dashboard</a></li>
        </ul>
    </nav>
    <div class="portal-container">
        <div class="portal-header">
            <div class="user-info">
                <img class="user-avatar" id="userAvatar" src="" alt="Avatar">
                <div>
                    <div class="user-name" id="userName">Loading...</div>
                    <div class="user-id" id="userId"></div>
                </div>
            </div>
            <div>
                <a href="/" class="btn btn-secondary" style="margin-right: 0.5rem;">← Back to Home</a>
                <a href="/auth/logout" class="logout-btn">Logout</a>
            </div>
        </div>

        <div class="nav-tabs">
            <button class="nav-tab active" onclick="showSection('overview')">📊 Overview</button>
            <button class="nav-tab" onclick="showSection('api-keys')">🔑 API Keys</button>
            <button class="nav-tab" onclick="showSection('conversations')">💬 Conversations</button>
            <button class="nav-tab" onclick="showSection('servers')">🏠 My Servers</button>
        </div>

        <!-- Overview Section -->
        <div id="overview" class="section active">
            <div class="card">
                <h2>📊 Account Overview</h2>
                <div class="stats-grid">
                    <div class="stat-item">
                        <div class="stat-value" id="statConvos">--</div>
                        <div class="stat-label">Conversations</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-value" id="statServers">--</div>
                        <div class="stat-label">Servers</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-value" id="statApiKeys">--</div>
                        <div class="stat-label">API Keys</div>
                    </div>
                </div>
            </div>

        </div>

        <!-- API Keys Section -->
        <div id="api-keys" class="section">
            <div class="card">
                <h2>🔑 API Keys</h2>
                <p style="color: #888; margin-bottom: 1rem;">Create API keys to use Jarvis AI from your own applications. Maximum 5 keys per account.</p>
                
                <div id="newKeyDisplay" class="new-key-display">
                    <strong>⚠️ Save this key now! It won't be shown again.</strong>
                    <code id="newKeyValue"></code>
                    <button class="btn btn-secondary" onclick="copyKey()">📋 Copy Key</button>
                </div>

                <div id="keyMessage" class="message"></div>

                <div class="create-key-form">
                    <input type="text" id="keyName" placeholder="Key name (e.g., My App)" maxlength="50">
                    <button class="btn btn-primary" onclick="createKey()">+ Create Key</button>
                </div>

                <div id="keysList">
                    <div class="empty-state">Loading keys...</div>
                </div>
            </div>

            <div class="card">
                <h2>📚 Quick Start</h2>
                <p style="color: #888; margin-bottom: 1rem;">Use your API key with the Jarvis API:</p>
                <pre style="background: rgba(0,0,0,0.3); padding: 1rem; border-radius: 8px; overflow-x: auto; font-size: 0.85rem;">
curl ${API_BASE_URL}/chat/completions \\
  -H "Authorization: Bearer jv-your-api-key" \\
  -H "Content-Type: application/json" \\
  -d '{
    "messages": [{"role": "user", "content": "Hello!"}]
  }'</pre>
                <p style="margin-top: 1rem; color: #888;">Use the Jarvis API to integrate AI chat into your applications.</p>
            </div>
        </div>

        <!-- Conversations Section -->
        <div id="conversations" class="section">
            <div class="card">
                <h2>💬 Recent Conversations</h2>
                <div id="convosList">
                    <div class="empty-state">Loading conversations...</div>
                </div>
            </div>
        </div>

        <!-- Servers Section -->
        <div id="servers" class="section">
            <div class="card">
                <h2>🏠 My Servers</h2>
                <p style="color: #888; margin-bottom: 1rem;">Servers you own where Jarvis is present.</p>
                <div id="serversList">
                    <div class="empty-state">Loading servers...</div>
                </div>
            </div>
        </div>

    </div>

    <script>
        let userData = null;

        function showSection(sectionId) {
            document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
            document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
            document.getElementById(sectionId).classList.add('active');
            event.target.classList.add('active');
        }

        function showMessage(elementId, message, isError) {
            const el = document.getElementById(elementId);
            el.textContent = message;
            el.className = 'message show ' + (isError ? 'error' : 'success');
            setTimeout(() => el.classList.remove('show'), 5000);
        }

        async function loadUserData() {
            try {
                const res = await fetch('/api/user');
                const data = await res.json();
                if (data.authenticated && data.user) {
                    userData = data.user;
                    document.getElementById('userAvatar').src = data.user.avatar;
                    document.getElementById('userName').textContent = data.user.globalName || data.user.username;
                    document.getElementById('userId').textContent = 'ID: ' + data.user.id;
                } else {
                    window.location.href = '/auth/login?redirect=/me';
                }
            } catch (e) {
                console.error('Failed to load user data:', e);
            }
        }

        async function loadDashboardData() {
            try {
                const res = await fetch('/me/api/dashboard');
                const data = await res.json();
                
                // Update stats
                document.getElementById('statConvos').textContent = data.conversationCount || 0;
                document.getElementById('statServers').textContent = data.serverCount || 0;
                document.getElementById('statApiKeys').textContent = data.keyCount || 0;

                // Render lists
                renderKeys(data.keys || []);
                renderConversations(data.conversations || []);
                renderServers(data.servers || []);
            } catch (e) {
                console.error('Failed to load dashboard data:', e);
            }
        }

        function renderKeys(keys) {
            const container = document.getElementById('keysList');
            if (keys.length === 0) {
                container.innerHTML = '<div class="empty-state">No API keys yet. Create one to get started!</div>';
                return;
            }
            container.innerHTML = keys.map(key => \`
                <div class="api-key-item">
                    <div class="api-key-info">
                        <div class="api-key-name">\${escapeHtml(key.name)}</div>
                        <div class="api-key-preview">\${key.keyPreview}</div>
                        <div class="api-key-stats">
                            Created: \${new Date(key.createdAt).toLocaleDateString()} • 
                            Requests: \${key.requestCount || 0}
                            \${key.lastUsedAt ? ' • Last used: ' + new Date(key.lastUsedAt).toLocaleDateString() : ''}
                        </div>
                    </div>
                    <button class="btn btn-danger" onclick="revokeKey('\${key.id}')">Revoke</button>
                </div>
            \`).join('');
        }

        function renderConversations(convos) {
            const container = document.getElementById('convosList');
            if (convos.length === 0) {
                container.innerHTML = '<div class="empty-state">No conversations yet. Start chatting with Jarvis!</div>';
                return;
            }
            container.innerHTML = convos.slice(0, 20).map(c => \`
                <div class="convo-item">
                    <div class="convo-time">\${new Date(c.updatedAt || c.createdAt).toLocaleString()}</div>
                    <div class="convo-preview">\${escapeHtml((c.messages?.[c.messages.length-1]?.content || 'No messages').slice(0, 100))}</div>
                </div>
            \`).join('');
        }

        function renderServers(servers) {
            const container = document.getElementById('serversList');
            if (servers.length === 0) {
                container.innerHTML = '<div class="empty-state">No servers found where you are the owner.</div>';
                return;
            }
            container.innerHTML = servers.map(s => \`
                <div class="server-item">
                    <img class="server-icon" src="\${s.icon || ''}" alt="" onerror="this.style.display='none'">
                    <div>
                        <div class="server-name">\${escapeHtml(s.name)}</div>
                        <div class="server-members">\${s.memberCount} members</div>
                    </div>
                </div>
            \`).join('');
        }

        async function createKey() {
            const nameInput = document.getElementById('keyName');
            const name = nameInput.value.trim() || 'Default';
            
            try {
                const res = await fetch('/me/api/keys', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name })
                });
                const data = await res.json();
                
                if (data.success) {
                    document.getElementById('newKeyValue').textContent = data.key;
                    document.getElementById('newKeyDisplay').classList.add('show');
                    nameInput.value = '';
                    loadDashboardData();
                } else {
                    showMessage('keyMessage', data.error || 'Failed to create key', true);
                }
            } catch (e) {
                showMessage('keyMessage', 'Error creating key', true);
            }
        }

        async function revokeKey(keyId) {
            if (!confirm('Are you sure you want to revoke this API key? This cannot be undone.')) return;
            
            try {
                const res = await fetch('/me/api/keys/' + keyId, { method: 'DELETE' });
                const data = await res.json();
                
                if (data.success) {
                    showMessage('keyMessage', 'Key revoked successfully', false);
                    loadDashboardData();
                } else {
                    showMessage('keyMessage', data.error || 'Failed to revoke key', true);
                }
            } catch (e) {
                showMessage('keyMessage', 'Error revoking key', true);
            }
        }

        function copyKey() {
            const key = document.getElementById('newKeyValue').textContent;
            navigator.clipboard.writeText(key).then(() => {
                showMessage('keyMessage', 'Key copied to clipboard!', false);
            });
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        loadUserData();
        loadDashboardData();
    </script>
</body>
</html>
`;

// Main portal page
router.get('/', requireAuth, (req, res) => {
    res.type('html').send(PORTAL_PAGE);
});

// Dashboard data API
router.get('/api/dashboard', requireAuth, async(req, res) => {
    try {
        const { userId } = req.user;
        
        const [keys, conversations, servers] = await Promise.all([
            apiKeys.getUserKeys(userId),
            getUserConversations(userId),
            getUserServers(userId, appContext.getClient())
        ]);

        res.json({
            success: true,
            keyCount: keys.length,
            keys,
            conversationCount: conversations.length,
            conversations: conversations.slice(0, 20),
            serverCount: servers.length,
            servers
        });
    } catch (error) {
        console.error('[UserPortal] Dashboard error:', error);
        res.status(500).json({ success: false, error: 'Failed to load dashboard' });
    }
});

// Create API key
router.post('/api/keys', requireAuth, async(req, res) => {
    try {
        const { name } = req.body;
        const result = await apiKeys.createKey(req.user.userId, name);
        res.json({ success: true, ...result });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

// Revoke API key
router.delete('/api/keys/:keyId', requireAuth, async(req, res) => {
    try {
        const success = await apiKeys.revokeKey(req.user.userId, req.params.keyId);
        res.json({ success });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

router.init = init;
module.exports = router;

/**
 * Moderator Dashboard Routes
 * 
 * /moderator - Login page
 * /moderator/callback - OAuth callback
 * /moderator/dashboard - Main dashboard
 * /moderator/setup - Password setup page
 * /moderator/logout - Logout
 */

const express = require('express');
const router = express.Router();
const auth = require('../services/moderator-auth');
const moderation = require('../services/GUILDS_FEATURES/moderation');

// Cookie parser middleware for this router
const cookieParser = require('cookie-parser');
router.use(cookieParser());

function shouldUseSecureCookies(req) {
    if (process.env.RENDER_EXTERNAL_URL) return true;
    if (process.env.DASHBOARD_DOMAIN && process.env.DASHBOARD_DOMAIN.startsWith('https://')) return true;
    if (req?.secure) return true;
    if (String(req?.headers?.['x-forwarded-proto'] || '').toLowerCase() === 'https') return true;
    return false;
}

// Session validation middleware
function requireAuth(req, res, next) {
    const token = req.cookies?.moderator_session;
    if (!token) {
        return res.redirect('/moderator?error=not_authenticated');
    }
    
    const session = auth.validateSession(token);
    if (!session) {
        res.clearCookie('moderator_session');
        return res.redirect('/moderator?error=session_expired');
    }
    
    req.session = session;
    next();
}

// ============ LOGIN PAGE ============
router.get('/', (req, res) => {
    const error = req.query.error;
    const errorMessages = {
        not_authenticated: 'Please log in to access the dashboard.',
        session_expired: 'Your session has expired. Please log in again.',
        unauthorized: 'You are not authorized to access this dashboard.',
        oauth_failed: 'Discord authentication failed. Please try again.',
        no_password: 'Please set up your password first.'
    };
    
    const errorMsg = errorMessages[error] || '';
    
    // Check if selfhost mode (password only)
    if (auth.SELFHOST_MODE) {
        res.send(getSelfhostLoginPage(errorMsg));
    } else {
        // Generate state for OAuth
        const state = require('crypto').randomBytes(16).toString('hex');
        res.cookie('oauth_state', state, { httpOnly: true, maxAge: 600000 });
        try {
            const oauthUrl = auth.getOAuthUrl(state);
            res.send(getOAuthLoginPage(oauthUrl, errorMsg));
        } catch (e) {
            const message = errorMsg || `Discord OAuth is not configured: ${e.message}`;
            res.send(getOAuthLoginPage('', message));
        }
    }
});

// ============ SELFHOST LOGIN (POST) ============
router.post('/login', async (req, res) => {
    if (!auth.SELFHOST_MODE) {
        return res.redirect('/moderator');
    }
    
    const { userId, password } = req.body;
    
    if (!userId || !password) {
        return res.redirect('/moderator?error=not_authenticated');
    }
    
    // Verify password
    const isValid = await auth.verifyUserPassword(userId, password);
    if (!isValid) {
        return res.redirect('/moderator?error=not_authenticated');
    }
    
    // Create session
    const token = auth.createSession(userId, { id: userId });
    res.cookie('moderator_session', token, { 
        httpOnly: true, 
        maxAge: 12 * 60 * 60 * 1000,
        sameSite: 'lax',
        secure: shouldUseSecureCookies(req)
    });
    
    res.redirect('/moderator/dashboard');
});

// ============ OAUTH CALLBACK ============
router.get('/callback', async (req, res) => {
    const { code, state } = req.query;
    const storedState = req.cookies?.oauth_state;
    
    // Clear state cookie
    res.clearCookie('oauth_state');
    
    // Verify state
    if (!state || state !== storedState) {
        return res.redirect('/moderator?error=oauth_failed');
    }
    
    try {
        // Exchange code for tokens
        const tokens = await auth.exchangeCode(code);
        
        // Get user info
        const discordUser = await auth.getDiscordUser(tokens.access_token);
        
        // Check if user has password set
        const hasPassword = await auth.hasPassword(discordUser.id);
        if (!hasPassword) {
            // Store temporary data and redirect to setup
            const setupToken = auth.generateSetupToken(discordUser.id);
            res.cookie('setup_user', JSON.stringify({ 
                id: discordUser.id, 
                username: discordUser.username,
                token: setupToken 
            }), { httpOnly: true, maxAge: 1800000 });
            return res.redirect('/moderator/setup');
        }
        
        // Create session
        const sessionToken = auth.createSession(discordUser.id, discordUser);
        res.cookie('moderator_session', sessionToken, { 
            httpOnly: true, 
            maxAge: 12 * 60 * 60 * 1000,
            sameSite: 'lax',
            secure: shouldUseSecureCookies(req)
        });
        
        res.redirect('/moderator/dashboard');
    } catch (error) {
        console.error('[Moderator] OAuth callback error:', error);
        res.redirect('/moderator?error=oauth_failed');
    }
});

// ============ PASSWORD SETUP PAGE ============
router.get('/setup', (req, res) => {
    const setupData = req.cookies?.setup_user;
    const { userId, token } = req.query;
    
    let userData = null;
    
    if (setupData) {
        try {
            userData = JSON.parse(setupData);
        } catch {}
    } else if (userId && token) {
        // From DM link
        if (auth.verifySetupToken(userId, token)) {
            userData = { id: userId, fromDM: true };
        }
    }
    
    if (!userData) {
        return res.redirect('/moderator?error=oauth_failed');
    }
    
    res.send(getSetupPage(userData));
});

// ============ PASSWORD SETUP (POST) ============
router.post('/setup', async (req, res) => {
    const { userId, password, confirmPassword } = req.body;
    
    if (!userId || !password || password !== confirmPassword) {
        return res.send(getSetupPage({ id: userId }, 'Passwords do not match.'));
    }
    
    if (password.length < 8) {
        return res.send(getSetupPage({ id: userId }, 'Password must be at least 8 characters.'));
    }
    
    // Set password
    await auth.setPassword(userId, password);
    
    // Clear setup cookie
    res.clearCookie('setup_user');
    
    // Create session
    const sessionToken = auth.createSession(userId, { id: userId });
    res.cookie('moderator_session', sessionToken, { 
        httpOnly: true, 
        maxAge: 12 * 60 * 60 * 1000,
        sameSite: 'lax',
        secure: shouldUseSecureCookies(req)
    });
    
    res.redirect('/moderator/dashboard');
});

// ============ DASHBOARD ============
router.get('/dashboard', requireAuth, async (req, res) => {
    const userId = req.session.userId;
    
    // Get all guilds with moderation enabled
    const allGuilds = moderation.ALLOWED_GUILDS;
    const guildStats = [];
    
    for (const guildId of allGuilds) {
        const status = moderation.getStatus(guildId);
        if (status.isEnabled) {
            guildStats.push({
                guildId,
                ...status
            });
        }
    }
    
    res.send(getDashboardPage(req.session, guildStats));
});

// ============ API ENDPOINTS ============
router.get('/api/stats/:guildId', requireAuth, async (req, res) => {
    const { guildId } = req.params;
    const status = moderation.getStatus(guildId);
    res.json(status);
});

router.post('/api/settings/:guildId', requireAuth, express.json(), async (req, res) => {
    const { guildId } = req.params;
    const settings = req.body;
    
    const result = moderation.updateSettings(guildId, settings);
    res.json(result);
});

// ============ LOGOUT ============
router.get('/logout', (req, res) => {
    const token = req.cookies?.moderator_session;
    if (token) {
        auth.destroySession(token);
    }
    res.clearCookie('moderator_session');
    res.redirect('/moderator');
});

// ============ HTML TEMPLATES ============

function getBaseStyles() {
    return `
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Segoe UI', system-ui, sans-serif;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
            min-height: 100vh;
            color: #e4e4e4;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
        }
        .card {
            background: rgba(255, 255, 255, 0.05);
            backdrop-filter: blur(10px);
            border-radius: 16px;
            padding: 30px;
            border: 1px solid rgba(255, 255, 255, 0.1);
            margin-bottom: 20px;
        }
        .btn {
            display: inline-block;
            padding: 12px 24px;
            border-radius: 8px;
            text-decoration: none;
            font-weight: 600;
            cursor: pointer;
            border: none;
            transition: all 0.3s ease;
        }
        .btn-discord {
            background: #5865F2;
            color: white;
        }
        .btn-discord:hover {
            background: #4752C4;
            transform: translateY(-2px);
        }
        .btn-primary {
            background: #e94560;
            color: white;
        }
        .btn-primary:hover {
            background: #c73e54;
        }
        input {
            width: 100%;
            padding: 12px 16px;
            border-radius: 8px;
            border: 1px solid rgba(255, 255, 255, 0.2);
            background: rgba(0, 0, 0, 0.3);
            color: white;
            font-size: 16px;
            margin-bottom: 15px;
        }
        input:focus {
            outline: none;
            border-color: #e94560;
        }
        .error {
            background: rgba(233, 69, 96, 0.2);
            border: 1px solid #e94560;
            padding: 12px;
            border-radius: 8px;
            margin-bottom: 20px;
        }
        .logo {
            font-size: 2.5rem;
            font-weight: bold;
            text-align: center;
            margin-bottom: 10px;
            background: linear-gradient(135deg, #e94560, #0f3460);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        .subtitle {
            text-align: center;
            color: #888;
            margin-bottom: 30px;
        }
    `;
}

function getOAuthLoginPage(oauthUrl, error = '') {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Jarvis Moderator Dashboard</title>
    <style>${getBaseStyles()}</style>
</head>
<body>
    <div class="container" style="display: flex; align-items: center; justify-content: center; min-height: 100vh;">
        <div class="card" style="max-width: 400px; text-align: center;">
            <div class="logo">🛡️ JARVIS</div>
            <p class="subtitle">Moderator Dashboard</p>
            
            ${error ? `<div class="error">${error}</div>` : ''}
            
            <p style="margin-bottom: 25px; color: #aaa;">
                Sign in with your Discord account to access the moderation dashboard.
            </p>
            
            <a href="${oauthUrl}" class="btn btn-discord" style="width: 100%; display: block;">
                <svg style="width: 20px; height: 20px; vertical-align: middle; margin-right: 8px;" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/>
                </svg>
                Continue with Discord
            </a>
            
            <p style="margin-top: 20px; font-size: 12px; color: #666;">
                Only authorized moderators can access this dashboard.
            </p>
        </div>
    </div>
</body>
</html>`;
}

function getSelfhostLoginPage(error = '') {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Jarvis Moderator Dashboard</title>
    <style>${getBaseStyles()}</style>
</head>
<body>
    <div class="container" style="display: flex; align-items: center; justify-content: center; min-height: 100vh;">
        <div class="card" style="max-width: 400px;">
            <div class="logo">🛡️ JARVIS</div>
            <p class="subtitle">Moderator Dashboard (Selfhost)</p>
            
            ${error ? `<div class="error">${error}</div>` : ''}
            
            <form method="POST" action="/moderator/login">
                <label style="display: block; margin-bottom: 5px; color: #aaa;">Discord User ID</label>
                <input type="text" name="userId" placeholder="Your Discord User ID" required>
                
                <label style="display: block; margin-bottom: 5px; color: #aaa;">Password</label>
                <input type="password" name="password" placeholder="Your dashboard password" required>
                
                <button type="submit" class="btn btn-primary" style="width: 100%;">
                    Sign In
                </button>
            </form>
            
            <p style="margin-top: 20px; font-size: 12px; color: #666; text-align: center;">
                Password was set via Jarvis DM. Contact the bot owner if you need access.
            </p>
        </div>
    </div>
</body>
</html>`;
}

function getSetupPage(userData, error = '') {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Set Up Password - Jarvis</title>
    <style>${getBaseStyles()}</style>
</head>
<body>
    <div class="container" style="display: flex; align-items: center; justify-content: center; min-height: 100vh;">
        <div class="card" style="max-width: 400px;">
            <div class="logo">🔐 JARVIS</div>
            <p class="subtitle">Set Your Dashboard Password</p>
            
            ${error ? `<div class="error">${error}</div>` : ''}
            
            <p style="margin-bottom: 25px; color: #aaa; text-align: center;">
                Welcome${userData.username ? `, ${userData.username}` : ''}! Please create a password for your moderator dashboard.
            </p>
            
            <form method="POST" action="/moderator/setup">
                <input type="hidden" name="userId" value="${userData.id}">
                
                <label style="display: block; margin-bottom: 5px; color: #aaa;">Password</label>
                <input type="password" name="password" placeholder="At least 8 characters" required minlength="8">
                
                <label style="display: block; margin-bottom: 5px; color: #aaa;">Confirm Password</label>
                <input type="password" name="confirmPassword" placeholder="Confirm your password" required>
                
                <button type="submit" class="btn btn-primary" style="width: 100%;">
                    Set Password & Continue
                </button>
            </form>
            
            <p style="margin-top: 20px; font-size: 12px; color: #666; text-align: center;">
                ⚠️ Remember this password! You'll need it for future logins.
            </p>
        </div>
    </div>
</body>
</html>`;
}

function getDashboardPage(session, guildStats) {
    const totalDetections = guildStats.reduce((sum, g) => sum + (g.stats?.total || 0), 0);
    const trackedMembers = guildStats.reduce((sum, g) => sum + (g.trackedMembersCount || 0), 0);
    
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Moderator Dashboard - Jarvis</title>
    <style>
        ${getBaseStyles()}
        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 20px 0;
            border-bottom: 1px solid rgba(255,255,255,0.1);
            margin-bottom: 30px;
        }
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        .stat-card {
            background: rgba(255,255,255,0.05);
            border-radius: 12px;
            padding: 20px;
            text-align: center;
            border: 1px solid rgba(255,255,255,0.1);
        }
        .stat-value {
            font-size: 2.5rem;
            font-weight: bold;
            background: linear-gradient(135deg, #e94560, #0f3460);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        .stat-label {
            color: #888;
            margin-top: 5px;
        }
        .guild-card {
            background: rgba(255,255,255,0.03);
            border-radius: 12px;
            padding: 20px;
            margin-bottom: 15px;
            border: 1px solid rgba(255,255,255,0.1);
        }
        .guild-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
        }
        .status-badge {
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 600;
        }
        .status-enabled {
            background: rgba(46, 204, 113, 0.2);
            color: #2ecc71;
        }
        .settings-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 10px;
        }
        .setting-item {
            background: rgba(0,0,0,0.2);
            padding: 10px;
            border-radius: 8px;
            font-size: 13px;
        }
        .setting-label {
            color: #888;
            font-size: 11px;
            margin-bottom: 3px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div>
                <h1 style="font-size: 1.5rem;">🛡️ Jarvis Moderator Dashboard</h1>
                <p style="color: #888; font-size: 14px;">Security System Status Overview</p>
            </div>
            <div>
                <span style="color: #888; margin-right: 15px;">User: ${session.userId}</span>
                <a href="/moderator/logout" class="btn btn-primary" style="padding: 8px 16px; font-size: 14px;">Logout</a>
            </div>
        </div>
        
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-value">${totalDetections}</div>
                <div class="stat-label">Total Detections</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${trackedMembers}</div>
                <div class="stat-label">Tracked Members</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${guildStats.length}</div>
                <div class="stat-label">Active Guilds</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">✅</div>
                <div class="stat-label">System Status</div>
            </div>
        </div>
        
        <div class="card">
            <h2 style="margin-bottom: 20px;">📊 Guild Overview</h2>
            
            ${guildStats.length === 0 ? `
                <p style="color: #888; text-align: center; padding: 40px;">
                    No guilds have moderation enabled yet.<br>
                    Use <code>.j enable moderation</code> in a server to get started.
                </p>
            ` : guildStats.map(guild => `
                <div class="guild-card">
                    <div class="guild-header">
                        <div>
                            <strong>Guild ID: ${guild.guildId}</strong>
                            <span class="status-badge status-enabled" style="margin-left: 10px;">Enabled</span>
                        </div>
                        <div style="color: #888; font-size: 13px;">
                            Enabled by: ${guild.enabledBy || 'Unknown'}
                        </div>
                    </div>
                    
                    <div class="settings-grid">
                        <div class="setting-item">
                            <div class="setting-label">Detections</div>
                            <strong>${guild.stats?.total || 0}</strong>
                        </div>
                        <div class="setting-item">
                            <div class="setting-label">Tracked Members</div>
                            <strong>${guild.trackedMembersCount || 0}</strong>
                        </div>
                        <div class="setting-item">
                            <div class="setting-label">AI Enabled</div>
                            <strong>${guild.settings?.useAI ? '✅' : '❌'}</strong>
                        </div>
                        <div class="setting-item">
                            <div class="setting-label">Min Severity</div>
                            <strong>${guild.settings?.minSeverity || 'medium'}</strong>
                        </div>
                        <div class="setting-item">
                            <div class="setting-label">Ping Roles</div>
                            <strong>${guild.settings?.pingRoles?.length || 0}</strong>
                        </div>
                        <div class="setting-item">
                            <div class="setting-label">Ping Users</div>
                            <strong>${guild.settings?.pingUsers?.length || 0}</strong>
                        </div>
                    </div>
                    
                    ${Object.keys(guild.stats?.byCategory || {}).length > 0 ? `
                        <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.1);">
                            <div class="setting-label" style="margin-bottom: 8px;">Detection Categories</div>
                            ${Object.entries(guild.stats.byCategory).map(([cat, count]) => `
                                <span style="display: inline-block; background: rgba(233,69,96,0.2); color: #e94560; padding: 3px 10px; border-radius: 12px; font-size: 12px; margin-right: 5px; margin-bottom: 5px;">
                                    ${cat}: ${count}
                                </span>
                            `).join('')}
                        </div>
                    ` : ''}
                </div>
            `).join('')}
        </div>
        
        <div style="text-align: center; color: #666; font-size: 12px; margin-top: 40px;">
            Jarvis Security System • Threat Detection Unit<br>
            Dashboard refreshes on page load
        </div>
    </div>
</body>
</html>`;
}

module.exports = router;

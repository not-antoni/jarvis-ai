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
    if (req?.secure) return true;
    if (String(req?.headers?.['x-forwarded-proto'] || '').toLowerCase() === 'https') return true;
    if (process.env.DASHBOARD_DOMAIN && process.env.DASHBOARD_DOMAIN.startsWith('https://'))
        return true;
    return false;
}

function getCookieOptions(req, overrides = {}) {
    return {
        httpOnly: true,
        sameSite: 'lax',
        secure: shouldUseSecureCookies(req),
        path: '/',
        ...overrides
    };
}

function getDiscordAvatarUrl(discordUser) {
    if (!discordUser || !discordUser.id) return '';
    if (discordUser.avatar) {
        const ext = String(discordUser.avatar).startsWith('a_') ? 'gif' : 'png';
        return `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.${ext}?size=64`;
    }
    return 'https://cdn.discordapp.com/embed/avatars/0.png';
}

function getDiscordClient() {
    return global.discordClient || null;
}

function userOwnsGuild(userId, guildId) {
    const client = getDiscordClient();
    const guild = client?.guilds?.cache?.get(String(guildId));
    return Boolean(guild && guild.ownerId === String(userId));
}

function parseDiscordIdList(input) {
    if (!input) return [];
    const raw = String(input);
    const tokens = raw
        .split(/[\s,]+/)
        .map(t => t.trim())
        .filter(Boolean);
    const ids = [];
    for (const token of tokens) {
        const match = token.match(/\d{15,20}/);
        if (match) ids.push(match[0]);
    }
    return Array.from(new Set(ids));
}

async function resolveDiscordUserData(userId) {
    const client = getDiscordClient();
    if (!client?.users?.fetch) return { id: String(userId) };

    const user = await client.users.fetch(String(userId)).catch(err => {
        console.warn('[Moderator] Failed to fetch user:', userId, err?.message || err);
        return null;
    });
    if (!user) return { id: String(userId) };

    return {
        id: user.id,
        username: user.username,
        global_name: user.globalName || null,
        avatar: user.avatar || null
    };
}

// Session validation middleware
async function requireAuth(req, res, next) {
    const token = req.cookies?.moderator_session;
    if (!token) {
        return res.redirect('/moderator?error=not_authenticated');
    }

    const session = auth.validateSession(token);
    if (!session) {
        res.clearCookie('moderator_session', { path: '/' });
        return res.redirect('/moderator?error=session_expired');
    }

    req.session = session;

    try {
        const d = req.session.discordData;
        const hasIdentity = Boolean(d && d.id);
        const hasName = Boolean(d && (d.global_name || d.username));
        const hasAvatar = Boolean(d && (d.avatar || d.avatar_url));

        // Some login flows create a session with `{ id }` only.
        // Hydrate it so the dashboard can display avatar + name.
        if (!hasIdentity || !hasName || !hasAvatar) {
            const resolved = await resolveDiscordUserData(req.session.userId);
            if (resolved && resolved.id) {
                req.session.discordData = {
                    ...(req.session.discordData || {}),
                    ...resolved
                };
            }
        }
    } catch {
        // Non-fatal; dashboard can still render with userId.
    }

    next();
}

// ============ LOGIN PAGE ============
router.get('/', (req, res) => {
    const error = req.query.error;
    const errorMessages = {
        not_authenticated: 'Please log in to access the dashboard.',
        session_expired: 'Your session has expired. Please log in again.',
        unauthorized: 'You are not authorized to access this dashboard.',
        oauth_failed: 'Discord authentication failed. Please try again.'
    };

    const errorMsg = errorMessages[error] || '';

    // Generate state for OAuth
    const state = require('crypto').randomBytes(16).toString('hex');
    res.cookie('oauth_state', state, getCookieOptions(req, { maxAge: 600000 }));
    try {
        const oauthUrl = auth.getOAuthUrl(state);
        res.send(getOAuthLoginPage(oauthUrl, errorMsg));
    } catch (e) {
        const message = errorMsg || `Discord OAuth is not configured: ${e.message}`;
        res.send(getOAuthLoginPage('', message));
    }
});

// Alias for login page
router.get('/login', (req, res) => res.redirect('/moderator'));

// ============ OAUTH CALLBACK ============
router.get('/callback', async (req, res) => {
    const { code, state } = req.query;
    const storedState = req.cookies?.oauth_state;

    // Clear state cookie
    res.clearCookie('oauth_state', { path: '/' });

    // Verify state
    if (!state || state !== storedState) {
        return res.redirect('/moderator?error=oauth_failed');
    }

    try {
        // Exchange code for tokens
        const tokens = await auth.exchangeCode(code);

        // Get user info
        const discordUser = await auth.getDiscordUser(tokens.access_token);

        // Create session directly (OAuth only - no password required)
        const sessionToken = auth.createSession(discordUser.id, discordUser);
        res.cookie(
            'moderator_session',
            sessionToken,
            getCookieOptions(req, { maxAge: 30 * 24 * 60 * 60 * 1000 }) // 30 days
        );

        res.redirect('/moderator/dashboard');
    } catch (error) {
        console.error('[Moderator] OAuth callback error:', error);
        res.redirect('/moderator?error=oauth_failed');
    }
});

// Password setup routes removed - OAuth only

// ============ DASHBOARD ============
router.get('/dashboard', requireAuth, async (req, res) => {
    const userId = req.session.userId;

    const client = getDiscordClient();
    const guildStats = [];

    if (client?.guilds?.cache) {
        for (const guild of client.guilds.cache.values()) {
            if (guild.ownerId !== userId) continue;
            const status = moderation.getStatus(guild.id);
            guildStats.push({
                guildId: guild.id,
                guildName: guild.name,
                guildIcon: typeof guild.iconURL === 'function' ? guild.iconURL({ size: 64 }) : null,
                ...status
            });
        }
    }

    res.send(getDashboardPage(req.session, guildStats));
});

// ============ API ENDPOINTS ============
router.get('/api/stats/:guildId', requireAuth, async (req, res) => {
    const { guildId } = req.params;
    if (!userOwnsGuild(req.session.userId, guildId)) {
        res.status(403).json({ success: false, error: 'unauthorized' });
        return;
    }
    const status = moderation.getStatus(guildId);
    res.json(status);
});

router.post('/api/settings/:guildId', requireAuth, express.json(), async (req, res) => {
    const { guildId } = req.params;
    const settings = req.body;

    if (!userOwnsGuild(req.session.userId, guildId)) {
        res.status(403).json({ success: false, error: 'unauthorized' });
        return;
    }

    if (!moderation.canEnableModeration(String(guildId))) {
        res.json({ success: false, error: 'ask Stark for a invite, sir.' });
        return;
    }

    const result = moderation.updateSettings(guildId, settings);
    res.json(result);
});

// ============ QUEUE & ANALYTICS API ENDPOINTS ============

// Get queue status (pending messages count, processing state)
router.get('/api/queue/status', requireAuth, async (req, res) => {
    const status = moderation.getQueueStatus();
    res.json({ success: true, ...status });
});

// Get pending messages in queue for a guild
router.get('/api/queue/:guildId/pending', requireAuth, async (req, res) => {
    const { guildId } = req.params;
    const limit = parseInt(req.query.limit) || 50;

    if (!userOwnsGuild(req.session.userId, guildId)) {
        return res.status(403).json({ success: false, error: 'unauthorized' });
    }

    const pending = moderation.getPendingMessages(guildId, limit);
    res.json({ success: true, messages: pending });
});

// Get analysis logs (recent AI decisions)
router.get('/api/logs', requireAuth, async (req, res) => {
    const limit = parseInt(req.query.limit) || 50;
    const logs = moderation.getAnalysisLogs(limit);
    res.json({ success: true, logs });
});

// Get user risk profile
router.get('/api/user/:userId/risk', requireAuth, async (req, res) => {
    const { userId } = req.params;
    const profile = moderation.getUserRiskProfile(userId);

    if (!profile) {
        return res.json({ success: true, profile: null, message: 'No risk profile found' });
    }

    // Resolve username if possible
    let username = null;
    try {
        const client = getDiscordClient();
        const user = await client?.users?.fetch(userId).catch(() => null);
        username = user?.username || null;
    } catch { }

    res.json({ success: true, profile: { userId, username, ...profile } });
});

// Get high-risk users for a guild
router.get('/api/guild/:guildId/risk-profiles', requireAuth, async (req, res) => {
    const { guildId } = req.params;
    const limit = parseInt(req.query.limit) || 50;

    if (!userOwnsGuild(req.session.userId, guildId)) {
        return res.status(403).json({ success: false, error: 'unauthorized' });
    }

    const profiles = moderation.getGuildUserProfiles(guildId, limit);
    res.json({ success: true, profiles });
});

// Trigger manual batch analysis
router.post('/api/queue/analyze', requireAuth, async (req, res) => {
    try {
        await moderation.triggerBatchAnalysis();
        res.json({ success: true, message: 'Batch analysis triggered' });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// ============ GUILD MANAGEMENT PAGES ============
router.get('/guild/:guildId', requireAuth, async (req, res) => {
    const { guildId } = req.params;

    if (!userOwnsGuild(req.session.userId, guildId)) {
        return res.redirect('/moderator?error=unauthorized');
    }

    const client = getDiscordClient();
    const guild = client?.guilds?.cache?.get(String(guildId)) || null;
    const status = moderation.getStatus(String(guildId));
    res.send(getGuildPage(req.session, guild, status, req.query?.error));
});

router.post(
    '/guild/:guildId/toggle',
    requireAuth,
    express.urlencoded({ extended: true }),
    async (req, res) => {
        const { guildId } = req.params;
        const enabled = String(req.body?.enabled || '').toLowerCase() === 'true';

        if (!userOwnsGuild(req.session.userId, guildId)) {
            return res.redirect('/moderator?error=unauthorized');
        }

        if (enabled && !moderation.canEnableModeration(String(guildId))) {
            return res.redirect(`/moderator/guild/${guildId}?error=not_whitelisted`);
        }

        if (enabled) {
            moderation.enableModeration(String(guildId), req.session.userId);
        } else {
            moderation.disableModeration(String(guildId), req.session.userId);
        }

        res.redirect(`/moderator/guild/${guildId}`);
    }
);

router.post(
    '/guild/:guildId/settings',
    requireAuth,
    express.urlencoded({ extended: true }),
    async (req, res) => {
        const { guildId } = req.params;

        if (!userOwnsGuild(req.session.userId, guildId)) {
            return res.redirect('/moderator?error=unauthorized');
        }

        if (!moderation.canEnableModeration(String(guildId))) {
            return res.redirect(`/moderator/guild/${guildId}?error=not_whitelisted`);
        }

        const patch = {
            minSeverity: req.body?.minSeverity,
            useAI: req.body?.useAI === 'on',
            useFallbackPatterns: req.body?.useFallbackPatterns === 'on',
            autoDelete: req.body?.autoDelete === 'on',
            autoMute: req.body?.autoMute === 'on',
            autoBan: req.body?.autoBan === 'on',
            pingRoles: parseDiscordIdList(req.body?.pingRoles),
            pingUsers: parseDiscordIdList(req.body?.pingUsers),
            alertChannel: req.body?.alertChannel || null,
            logChannel: req.body?.logChannel || null,
            useEmbeds: req.body?.useEmbeds === 'on',
            customAlertTemplate: req.body?.customAlertTemplate || '',
            // Auto-mod modules
            antiSpam: req.body?.antiSpam === 'on',
            antiMentionSpam: req.body?.antiMentionSpam === 'on',
            antiEmojiSpam: req.body?.antiEmojiSpam === 'on',
            antiCaps: req.body?.antiCaps === 'on',
            antiLinks: req.body?.antiLinks === 'on',
            antiInvites: req.body?.antiInvites === 'on',
            antiRaid: req.body?.antiRaid === 'on',
            antiLinksWhitelist: (req.body?.antiLinksWhitelist || '').split(',').map(s => s.trim()).filter(Boolean),
            punishmentDMTemplate: req.body?.punishmentDMTemplate || ''
        };

        moderation.updateSettings(String(guildId), patch);
        res.redirect(`/moderator/guild/${guildId}`);
    }
);

// ============ LOGOUT ============
router.get('/logout', (req, res) => {
    const token = req.cookies?.moderator_session;
    if (token) {
        auth.destroySession(token);
    }
    res.clearCookie('moderator_session', { path: '/' });
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

function getGuildPage(session, guild, status, errorCode = '') {
    const userLabel =
        session.discordData?.global_name || session.discordData?.username || session.userId;
    const userAvatar = getDiscordAvatarUrl(session.discordData);
    const guildName = guild?.name || 'Unknown Guild';
    const guildIcon = typeof guild?.iconURL === 'function' ? guild.iconURL({ size: 64 }) : null;
    const canEnable = Boolean(status?.canEnable);
    const isEnabled = Boolean(status?.isEnabled);
    const settings = status?.settings || {};
    const stats = status?.stats || {};
    const recentDetections = status?.recentDetections || [];
    const error = String(errorCode || '');

    const errorBanner = !canEnable && !isEnabled ? 'ask Stark for a invite, sir.' : '';
    const showNotWhitelisted = error === 'not_whitelisted';

    // Get guild channels for dropdowns
    const channels = [];
    if (guild?.channels?.cache) {
        for (const channel of guild.channels.cache.values()) {
            if (channel.type === 0 || channel.type === 5) { // Text or Announcement
                channels.push({ id: channel.id, name: channel.name });
            }
        }
        channels.sort((a, b) => a.name.localeCompare(b.name));
    }

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Guild Moderation - Jarvis</title>
    <style>
        ${getBaseStyles()}
        .header { display: flex; justify-content: space-between; align-items: center; padding: 20px 0; border-bottom: 1px solid rgba(255,255,255,0.1); margin-bottom: 30px; }
        .user-badge { display: inline-flex; align-items: center; gap: 10px; }
        .user-avatar { width: 34px; height: 34px; border-radius: 50%; border: 1px solid rgba(255,255,255,0.2); object-fit: cover; background: rgba(0,0,0,0.2); }
        .status-badge { padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; }
        .status-enabled { background: rgba(46, 204, 113, 0.2); color: #2ecc71; }
        .status-disabled { background: rgba(255, 255, 255, 0.12); color: #cfcfcf; }
        .select { width: 100%; padding: 12px 16px; border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.2); background: rgba(0, 0, 0, 0.3); color: white; font-size: 16px; margin-bottom: 15px; }
        .row { display: flex; gap: 20px; flex-wrap: wrap; }
        .row > .card { flex: 1 1 420px; }
        .muted { color: #888; font-size: 13px; }
        .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 15px; margin-bottom: 20px; }
        .stat-item { background: rgba(255,255,255,0.05); border-radius: 10px; padding: 15px; text-align: center; }
        .stat-value { font-size: 1.8rem; font-weight: bold; background: linear-gradient(135deg, #e94560, #0f3460); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        .stat-label { color: #888; font-size: 12px; margin-top: 5px; }
        .section-title { margin-bottom: 15px; padding-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.1); }
        .detection-list { max-height: 300px; overflow-y: auto; }
        .detection-item { background: rgba(0,0,0,0.2); border-radius: 8px; padding: 12px; margin-bottom: 10px; border-left: 3px solid; }
        .detection-item.critical { border-left-color: #e74c3c; }
        .detection-item.high { border-left-color: #e67e22; }
        .detection-item.medium { border-left-color: #f1c40f; }
        .detection-item.low { border-left-color: #3498db; }
        .category-tag { display: inline-block; background: rgba(233,69,96,0.2); color: #e94560; padding: 2px 8px; border-radius: 12px; font-size: 11px; margin-right: 5px; }
        .toggle-section { display: flex; align-items: center; gap: 10px; margin-bottom: 15px; }
        .toggle-switch { position: relative; width: 50px; height: 26px; }
        .toggle-switch input { opacity: 0; width: 0; height: 0; }
        .toggle-slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: rgba(255,255,255,0.2); transition: 0.3s; border-radius: 26px; }
        .toggle-slider:before { position: absolute; content: ""; height: 20px; width: 20px; left: 3px; bottom: 3px; background-color: white; transition: 0.3s; border-radius: 50%; }
        input:checked + .toggle-slider { background-color: #2ecc71; }
        input:checked + .toggle-slider:before { transform: translateX(24px); }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div>
                <div class="user-badge">
                    ${guildIcon ? `<img class="user-avatar" src="${guildIcon}" alt="icon">` : ''}
                    <div>
                        <h1 style="font-size: 1.4rem;">${guildName}</h1>
                        <div class="muted">Guild ID: ${guild?.id || ''}</div>
                    </div>
                    <span class="status-badge ${isEnabled ? 'status-enabled' : 'status-disabled'}">${isEnabled ? 'Enabled' : 'Disabled'}</span>
                </div>
            </div>
            <div>
                <span class="user-badge" style="color: #888; margin-right: 15px;">
                    ${userAvatar ? `<img class="user-avatar" src="${userAvatar}" alt="avatar">` : ''}
                    <span>${userLabel}</span>
                </span>
                <a href="/moderator/dashboard" class="btn" style="background: rgba(255,255,255,0.08); color: white; padding: 8px 16px; font-size: 14px;">Back</a>
                <a href="/moderator/logout" class="btn btn-primary" style="padding: 8px 16px; font-size: 14px; margin-left: 8px;">Logout</a>
            </div>
        </div>

        ${showNotWhitelisted ? `<div class="error">ask Stark for a invite, sir.</div>` : ''}
        ${errorBanner ? `<div class="error">${errorBanner}</div>` : ''}
        ${error && error !== 'not_whitelisted' ? `<div class="error">${error}</div>` : ''}

        ${isEnabled ? `
        <div class="stats-grid">
            <div class="stat-item"><div class="stat-value">${stats.total || 0}</div><div class="stat-label">Total Detections</div></div>
            <div class="stat-item"><div class="stat-value">${stats.byCategory?.scam || 0}</div><div class="stat-label">Scams Blocked</div></div>
            <div class="stat-item"><div class="stat-value">${stats.byCategory?.spam || 0}</div><div class="stat-label">Spam Caught</div></div>
            <div class="stat-item"><div class="stat-value">${status?.trackedMembersCount || 0}</div><div class="stat-label">Tracked Members</div></div>
        </div>
        ` : ''}

        <div class="row">
            <div class="card">
                <h2 class="section-title">⚡ Quick Controls</h2>
                
                <form method="POST" action="/moderator/guild/${guild?.id || ''}/toggle" style="margin-bottom: 20px;">
                    <input type="hidden" name="enabled" value="${isEnabled ? 'false' : 'true'}">
                    <button type="submit" class="btn btn-primary" style="width: 100%;" ${!canEnable && !isEnabled ? 'disabled' : ''}>
                        ${isEnabled ? '🔴 Disable Moderation' : '🟢 Enable Moderation'}
                    </button>
                </form>

                ${!canEnable && !isEnabled ? `<p class="muted" style="text-align: center; margin-bottom: 15px;">ask Stark for a invite, sir.</p>` : ''}

                ${isEnabled ? `
                <form method="POST" action="/moderator/guild/${guild?.id || ''}/settings">
                    <h3 style="font-size: 14px; color: #aaa; margin-bottom: 10px;">📢 Channel Configuration</h3>
                    
                    <label style="display: block; margin-bottom: 5px; color: #aaa;">Alert Channel</label>
                    <select class="select" name="alertChannel">
                        <option value="">Same as message channel</option>
                        ${channels.map(ch => `<option value="${ch.id}" ${settings.alertChannel === ch.id ? 'selected' : ''}>#${ch.name}</option>`).join('')}
                    </select>
                    
                    <label style="display: block; margin-bottom: 5px; color: #aaa;">Mod Log Channel</label>
                    <select class="select" name="logChannel">
                        <option value="">Disabled</option>
                        ${channels.map(ch => `<option value="${ch.id}" ${settings.logChannel === ch.id ? 'selected' : ''}>#${ch.name}</option>`).join('')}
                    </select>

                    <h3 style="font-size: 14px; color: #aaa; margin: 20px 0 10px;">🎯 Detection Settings</h3>
                    
                    <label style="display: block; margin-bottom: 5px; color: #aaa;">Minimum Severity</label>
                    <select class="select" name="minSeverity">
                        ${['low', 'medium', 'high', 'critical'].map(v => `<option value="${v}" ${(settings.minSeverity || 'medium') === v ? 'selected' : ''}>${v.charAt(0).toUpperCase() + v.slice(1)}</option>`).join('')}
                    </select>

                    <div class="toggle-section">
                        <label class="toggle-switch"><input type="checkbox" name="useAI" ${settings.useAI ? 'checked' : ''}><span class="toggle-slider"></span></label>
                        <span>AI Detection</span>
                    </div>
                    
                    <div class="toggle-section">
                        <label class="toggle-switch"><input type="checkbox" name="useFallbackPatterns" ${settings.useFallbackPatterns ? 'checked' : ''}><span class="toggle-slider"></span></label>
                        <span>Pattern Matching (Fallback)</span>
                    </div>

                    <h3 style="font-size: 14px; color: #aaa; margin: 20px 0 10px;">⚡ Auto Actions</h3>
                    
                    <div class="toggle-section">
                        <label class="toggle-switch"><input type="checkbox" name="autoDelete" ${settings.autoDelete ? 'checked' : ''}><span class="toggle-slider"></span></label>
                        <span>Auto Delete Flagged Messages</span>
                    </div>
                    
                    <div class="toggle-section">
                        <label class="toggle-switch"><input type="checkbox" name="autoMute" ${settings.autoMute ? 'checked' : ''}><span class="toggle-slider"></span></label>
                        <span>Auto Mute Offenders</span>
                    </div>
                    
                    <div class="toggle-section">
                        <label class="toggle-switch"><input type="checkbox" name="autoBan" ${settings.autoBan ? 'checked' : ''}><span class="toggle-slider"></span></label>
                        <span>Auto Ban (Critical Only)</span>
                    </div>

                    <h3 style="font-size: 14px; color: #aaa; margin: 20px 0 10px;">🔔 Alert Notifications</h3>
                    
                    <label style="display: block; margin-bottom: 5px; color: #aaa;">Ping Roles (IDs, comma separated)</label>
                    <input type="text" name="pingRoles" placeholder="Role IDs" value="${(settings.pingRoles || []).join(', ')}">
                    
                    <label style="display: block; margin-bottom: 5px; color: #aaa;">Ping Users (IDs, comma separated)</label>
                    <input type="text" name="pingUsers" placeholder="User IDs" value="${(settings.pingUsers || []).join(', ')}">

                    <h3 style="font-size: 14px; color: #aaa; margin: 20px 0 10px;">✨ Alert Style</h3>
                    
                    <div class="toggle-section">
                        <label class="toggle-switch"><input type="checkbox" name="useEmbeds" ${settings.useEmbeds !== false ? 'checked' : ''}><span class="toggle-slider"></span></label>
                        <span>Use Rich Embeds</span>
                    </div>
                    
                    <label style="display: block; margin-bottom: 5px; color: #aaa;">Custom Alert Message (supports emojis! 🔥⚡🚨)</label>
                    <textarea name="customAlertTemplate" rows="3" style="width: 100%; padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.2); background: rgba(0,0,0,0.3); color: white; font-size: 14px; margin-bottom: 10px; resize: vertical;" placeholder="🚨 {pings} ⚠️ THREAT DETECTED ⚠️ {user} | {category} 🚨">${settings.customAlertTemplate || ''}</textarea>
                    <p class="muted" style="margin-bottom: 8px;">Variables: <code>{user}</code> <code>{username}</code> <code>{category}</code> <code>{severity}</code> <code>{pings}</code> <code>{reason}</code> <code>{channel}</code></p>
                    <p class="muted" style="margin-bottom: 15px;">💡 <strong>Tip:</strong> Use any emojis! Examples: ⚡🔥🚨⚠️💀🛡️ or Discord custom emojis: <code>&lt;:name:id&gt;</code></p>

                    <h3 style="font-size: 14px; color: #aaa; margin: 20px 0 10px;">🛡️ Auto-Mod Modules</h3>
                    
                    <div class="toggle-section">
                        <label class="toggle-switch"><input type="checkbox" name="antiSpam" ${settings.antiSpam ? 'checked' : ''}><span class="toggle-slider"></span></label>
                        <span>Anti-Spam (${settings.antiSpamMaxMessages || 5} msgs / ${(settings.antiSpamWindow || 5000) / 1000}s)</span>
                    </div>
                    
                    <div class="toggle-section">
                        <label class="toggle-switch"><input type="checkbox" name="antiMentionSpam" ${settings.antiMentionSpam ? 'checked' : ''}><span class="toggle-slider"></span></label>
                        <span>Anti-Mention Spam (max ${settings.antiMentionMax || 5})</span>
                    </div>
                    
                    <div class="toggle-section">
                        <label class="toggle-switch"><input type="checkbox" name="antiEmojiSpam" ${settings.antiEmojiSpam ? 'checked' : ''}><span class="toggle-slider"></span></label>
                        <span>Anti-Emoji Spam (max ${settings.antiEmojiMax || 10})</span>
                    </div>
                    
                    <div class="toggle-section">
                        <label class="toggle-switch"><input type="checkbox" name="antiCaps" ${settings.antiCaps ? 'checked' : ''}><span class="toggle-slider"></span></label>
                        <span>Anti-Caps (${settings.antiCapsPercent || 70}%+ caps)</span>
                    </div>
                    
                    <div class="toggle-section">
                        <label class="toggle-switch"><input type="checkbox" name="antiLinks" ${settings.antiLinks ? 'checked' : ''}><span class="toggle-slider"></span></label>
                        <span>Anti-Links</span>
                    </div>
                    
                    <div class="toggle-section">
                        <label class="toggle-switch"><input type="checkbox" name="antiInvites" ${settings.antiInvites ? 'checked' : ''}><span class="toggle-slider"></span></label>
                        <span>Anti-Discord Invites</span>
                    </div>
                    
                    <div class="toggle-section">
                        <label class="toggle-switch"><input type="checkbox" name="antiRaid" ${settings.antiRaid ? 'checked' : ''}><span class="toggle-slider"></span></label>
                        <span>Anti-Raid (${settings.antiRaidJoinThreshold || 10} joins / min)</span>
                    </div>
                    
                    <label style="display: block; margin-bottom: 5px; color: #aaa; margin-top: 15px;">Link Whitelist (domains, comma separated)</label>
                    <input type="text" name="antiLinksWhitelist" placeholder="youtube.com, twitter.com" value="${(settings.antiLinksWhitelist || []).join(', ')}">
                    
                    <label style="display: block; margin-bottom: 5px; color: #aaa;">Punishment DM Template</label>
                    <textarea name="punishmentDMTemplate" rows="2" style="width: 100%; padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.2); background: rgba(0,0,0,0.3); color: white; font-size: 14px; margin-bottom: 10px; resize: vertical;" placeholder="You have been {action} in {guild} for: {reason}">${settings.punishmentDMTemplate || ''}</textarea>
                    <p class="muted" style="margin-bottom: 15px;">Variables: <code>{user}</code> <code>{action}</code> <code>{reason}</code> <code>{guild}</code> <code>{module}</code></p>

                    <button type="submit" class="btn btn-primary" style="width: 100%; margin-top: 15px;">💾 Save Settings</button>
                </form>
                ` : ''}
            </div>

            <div class="card">
                <h2 class="section-title">📊 Recent Detections</h2>
                
                ${!isEnabled ? `<p class="muted">Enable moderation to see detections.</p>` :
            recentDetections.length === 0 ? `<p class="muted">No recent detections. Your server is clean! ✨</p>` : `
                <div class="detection-list">
                    ${recentDetections.slice(0, 10).map(d => `
                        <div class="detection-item ${d.severity || 'medium'}">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                                <span class="category-tag">${d.category || 'unknown'}</span>
                                <span class="muted" style="font-size: 11px;">${d.timestamp ? new Date(d.timestamp).toLocaleString() : 'Unknown'}</span>
                            </div>
                            <div style="font-size: 13px;"><strong>User:</strong> ${d.userId || 'Unknown'}</div>
                            ${d.reason ? `<div style="font-size: 12px; color: #aaa; margin-top: 5px;">${d.reason}</div>` : ''}
                        </div>
                    `).join('')}
                </div>
                `}

                ${isEnabled ? `
                <h3 style="font-size: 14px; color: #aaa; margin: 25px 0 10px;">📈 Detection Categories</h3>
                <div style="display: flex; flex-wrap: wrap; gap: 8px;">
                    ${Object.entries(stats.byCategory || {}).map(([cat, count]) => `<span class="category-tag" style="padding: 5px 12px;">${cat}: ${count}</span>`).join('') || '<span class="muted">No categories yet</span>'}
                </div>
                ` : ''}
            </div>
        </div>

        ${isEnabled ? `
        <!-- NEW: Queue & Analytics Section -->
        <div class="row" style="margin-top: 20px;">
            <div class="card">
                <h2 class="section-title">📬 Message Queue</h2>
                <div id="queue-status">
                    <p class="muted">Loading queue status...</p>
                </div>
                <button onclick="triggerAnalysis()" class="btn btn-primary" style="width: 100%; margin-top: 15px;">
                    ⚡ Analyze Queue Now
                </button>
                <p class="muted" style="margin-top: 10px; font-size: 11px;">
                    Messages are batched for AI analysis every 60 seconds or 50 messages. High-risk messages (new accounts, links) are analyzed immediately.
                </p>
            </div>
            
            <div class="card">
                <h2 class="section-title">🧠 AI Analysis Logs</h2>
                <div id="analysis-logs" class="detection-list">
                    <p class="muted">Loading analysis logs...</p>
                </div>
            </div>
        </div>
        
        <div class="card" style="margin-top: 20px;">
            <h2 class="section-title">⚠️ High-Risk Users</h2>
            <div id="risk-profiles">
                <p class="muted">Loading risk profiles...</p>
            </div>
        </div>
        
        <script>
        const guildId = '${guild?.id || ''}';
        
        async function loadQueueStatus() {
            try {
                const res = await fetch('/moderator/api/queue/status');
                const data = await res.json();
                document.getElementById('queue-status').innerHTML = \`
                    <div class="stats-grid" style="margin-bottom: 0;">
                        <div class="stat-item">
                            <div class="stat-value">\${data.pendingMessages || 0}</div>
                            <div class="stat-label">Pending</div>
                        </div>
                        <div class="stat-item">
                            <div class="stat-value">\${data.isProcessing ? '🔄' : '✅'}</div>
                            <div class="stat-label">\${data.isProcessing ? 'Processing' : 'Idle'}</div>
                        </div>
                    </div>
                \`;
            } catch (e) {
                document.getElementById('queue-status').innerHTML = '<p class="muted">Failed to load</p>';
            }
        }
        
        async function loadAnalysisLogs() {
            try {
                const res = await fetch('/moderator/api/logs?limit=10');
                const data = await res.json();
                const logs = data.logs || [];
                
                if (logs.length === 0) {
                    document.getElementById('analysis-logs').innerHTML = '<p class="muted">No analysis logs yet</p>';
                    return;
                }
                
                document.getElementById('analysis-logs').innerHTML = logs.map(log => \`
                    <div class="detection-item \${log.flaggedCount > 0 ? 'high' : 'low'}">
                        <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                            <span>\${log.messageCount} msgs analyzed</span>
                            <span class="muted" style="font-size: 11px;">\${new Date(log.timestamp).toLocaleString()}</span>
                        </div>
                        <div style="font-size: 12px;">
                            <span class="category-tag">\${log.flaggedCount || 0} flagged</span>
                            <span class="muted">\${log.result?.summary || log.result || ''}</span>
                        </div>
                    </div>
                \`).join('');
            } catch (e) {
                document.getElementById('analysis-logs').innerHTML = '<p class="muted">Failed to load</p>';
            }
        }
        
        async function loadRiskProfiles() {
            try {
                const res = await fetch('/moderator/api/guild/' + guildId + '/risk-profiles?limit=10');
                const data = await res.json();
                const profiles = data.profiles || [];
                
                if (profiles.length === 0) {
                    document.getElementById('risk-profiles').innerHTML = '<p class="muted">No user risk data yet</p>';
                    return;
                }
                
                document.getElementById('risk-profiles').innerHTML = \`
                    <table style="width: 100%; border-collapse: collapse;">
                        <thead>
                            <tr style="text-align: left; border-bottom: 1px solid rgba(255,255,255,0.1);">
                                <th style="padding: 8px;">User ID</th>
                                <th>Avg Risk</th>
                                <th>Messages</th>
                                <th>Flagged</th>
                                <th>Last Seen</th>
                            </tr>
                        </thead>
                        <tbody>
                            \${profiles.map(p => \`
                                <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
                                    <td style="padding: 8px; font-family: monospace; font-size: 12px;">\${p.userId}</td>
                                    <td><span class="category-tag" style="background: rgba(\${p.averageRisk > 50 ? '233,69,96' : p.averageRisk > 25 ? '241,196,15' : '46,204,113'}, 0.2);">\${p.averageRisk}%</span></td>
                                    <td>\${p.totalMessages}</td>
                                    <td>\${p.flaggedCount}</td>
                                    <td class="muted" style="font-size: 11px;">\${p.lastSeen ? new Date(p.lastSeen).toLocaleString() : '-'}</td>
                                </tr>
                            \`).join('')}
                        </tbody>
                    </table>
                \`;
            } catch (e) {
                document.getElementById('risk-profiles').innerHTML = '<p class="muted">Failed to load</p>';
            }
        }
        
        async function triggerAnalysis() {
            try {
                const btn = event.target;
                btn.disabled = true;
                btn.textContent = '⏳ Processing...';
                
                await fetch('/moderator/api/queue/analyze', { method: 'POST' });
                
                setTimeout(() => {
                    btn.disabled = false;
                    btn.textContent = '⚡ Analyze Queue Now';
                    loadQueueStatus();
                    loadAnalysisLogs();
                }, 2000);
            } catch (e) {
                alert('Failed to trigger analysis');
            }
        }
        
        // Load data on page load
        loadQueueStatus();
        loadAnalysisLogs();
        loadRiskProfiles();
        
        // Refresh every 30 seconds
        setInterval(loadQueueStatus, 30000);
        </script>
        ` : ''}

        <div style="text-align: center; color: #666; font-size: 12px; margin-top: 40px;">
            Jarvis Security System • Threat Detection Unit
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
    const userLabel =
        session.discordData?.global_name || session.discordData?.username || session.userId;
    const userAvatar = getDiscordAvatarUrl(session.discordData);

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
        .user-badge {
            display: inline-flex;
            align-items: center;
            gap: 10px;
        }
        .user-avatar {
            width: 34px;
            height: 34px;
            border-radius: 50%;
            border: 1px solid rgba(255,255,255,0.2);
            object-fit: cover;
            background: rgba(0,0,0,0.2);
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
        .status-disabled {
            background: rgba(255, 255, 255, 0.12);
            color: #cfcfcf;
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
                <span class="user-badge" style="color: #888; margin-right: 15px;">
                    ${userAvatar ? `<img class="user-avatar" src="${userAvatar}" alt="avatar">` : ''}
                    <span>${userLabel}</span>
                </span>
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
                <div class="stat-label">Owned Guilds</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">✅</div>
                <div class="stat-label">System Status</div>
            </div>
        </div>
        
        <div class="card">
            <h2 style="margin-bottom: 20px;">🧰 Moderation Controls</h2>
            
            ${guildStats.length === 0
            ? `
                <p style="color: #888; text-align: center; padding: 40px;">
                    No manageable guilds found.<br>
                    You can only manage guilds where you are the <strong>owner</strong> and Jarvis is present.
                </p>
            `
            : guildStats
                .map(
                    guild => `
                <div class="guild-card">
                    <div class="guild-header">
                        <div>
                            <strong>${guild.guildName || 'Guild'} (${guild.guildId})</strong>
                            <span class="status-badge ${guild.isEnabled ? 'status-enabled' : 'status-disabled'}" style="margin-left: 10px;">${guild.isEnabled ? 'Enabled' : 'Disabled'}</span>
                        </div>
                        <div style="color: #888; font-size: 13px;">
                            ${guild.canEnable ? '' : 'ask Stark for a invite, sir.'}
                        </div>
                    </div>

                    <div style="margin-top: 10px;">
                        <a class="btn btn-primary" style="padding: 8px 16px; font-size: 14px;" href="/moderator/guild/${guild.guildId}">Manage</a>
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
                    
                    ${Object.keys(guild.stats?.byCategory || {}).length > 0
                            ? `
                        <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.1);">
                            <div class="setting-label" style="margin-bottom: 8px;">Detection Categories</div>
                            ${Object.entries(guild.stats.byCategory)
                                .map(
                                    ([cat, count]) => `
                                <span style="display: inline-block; background: rgba(233,69,96,0.2); color: #e94560; padding: 3px 10px; border-radius: 12px; font-size: 12px; margin-right: 5px; margin-bottom: 5px;">
                                    ${cat}: ${count}
                                </span>
                            `
                                )
                                .join('')}
                        </div>
                    `
                            : ''
                        }
                </div>
            `
                )
                .join('')
        }
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

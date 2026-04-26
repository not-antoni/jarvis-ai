'use strict';

/**
 * Web portal — Discord OAuth login + per-guild config dashboard.
 *
 * Routes
 *   GET  /portal                            SPA shell
 *   GET  /portal/login                      start OAuth flow
 *   GET  /portal/callback                   OAuth redirect target
 *   POST /portal/logout                     destroy session
 *   GET  /portal/api/me                     user + managed guilds
 *   GET  /portal/api/guilds/:gid/config     full config snapshot
 *   PATCH /portal/api/guilds/:gid/config    update config subset
 *
 * Authorization rules: only users the bot considers moderators may read or
 * mutate a guild's config. The API always revalidates on every request — we
 * never trust the OAuth guilds payload alone.
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');
const logger = require('../src/utils/logger');
const database = require('../src/services/database');
const portalAuth = require('../src/services/portal-auth');
const portalSessions = require('../src/services/portal-sessions');
const { getPublicConfig } = require('../src/utils/public-config');
const { PermissionsBitField } = require('discord.js');

const log = logger.child({ module: 'portal' });
const router = express.Router();

let _appContext = null;
function setAppContext(ctx) { _appContext = ctx; }

const COOKIE_NAME = 'jarvis_portal';
const PORTAL_HTML_PATH = path.join(__dirname, 'templates', 'portal.html');
let _portalTemplateCache = null;
function loadPortalTemplate() {
    if (!_portalTemplateCache || process.env.NODE_ENV !== 'production') {
        _portalTemplateCache = fs.readFileSync(PORTAL_HTML_PATH, 'utf8');
    }
    return _portalTemplateCache;
}

const oauthLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false
});

const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false
});

// Per-user manageable-guild cache. Cuts per-request guild fetches that were
// causing /portal/api/me to take "9291949219421949 years" and rate-limit the
// bot (#271). Entries auto-expire and are also bumped via guild events.
const GUILDS_CACHE_TTL_MS = Number(process.env.PORTAL_GUILDS_CACHE_TTL_MS) || 60_000;
const _userGuildsCache = new Map(); // userId -> { at: number, guilds: Array }

function _cachedGuildsFor(userId) {
    const entry = _userGuildsCache.get(userId);
    if (!entry) {return null;}
    if (Date.now() - entry.at > GUILDS_CACHE_TTL_MS) {
        _userGuildsCache.delete(userId);
        return null;
    }
    return entry.guilds;
}

function _setCachedGuilds(userId, guilds) {
    _userGuildsCache.set(userId, { at: Date.now(), guilds });
}

function invalidateUserGuildsCache(userId) {
    if (userId) {
        _userGuildsCache.delete(userId);
    } else {
        _userGuildsCache.clear();
    }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function cookieOptions() {
    return {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: portalSessions.SESSION_TTL_MS
    };
}

function sanitizeReturnTo(raw) {
    if (typeof raw !== 'string') {return '/portal';}
    // Only allow same-site absolute paths
    if (!raw.startsWith('/') || raw.startsWith('//')) {return '/portal';}
    if (raw.length > 200) {return '/portal';}
    return raw;
}

async function requireSession(req, res, next) {
    const sid = req.cookies?.[COOKIE_NAME];
    const session = sid ? await portalSessions.getSession(sid) : null;
    if (!session) {
        res.status(401).json({ error: 'Not authenticated', loginUrl: '/portal/login' });
        return;
    }
    req.portalSession = session;
    next();
}

/**
 * Resolves the full bot-side guild object the user is trying to manage, after
 * confirming the user is a moderator there. Responds with 403 otherwise.
 */
async function loadManageableGuild(req, res) {
    const client = _appContext?.getClient?.();
    if (!client) {
        res.status(503).json({ error: 'Bot client unavailable' });
        return null;
    }
    const guildId = String(req.params.guildId || '').trim();
    if (!/^\d{5,30}$/.test(guildId)) {
        res.status(400).json({ error: 'Invalid guild id' });
        return null;
    }
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
        res.status(404).json({ error: 'Bot is not in that guild' });
        return null;
    }
    const member = await guild.members.fetch(req.portalSession.userId).catch(() => null);
    if (!member) {
        res.status(403).json({ error: 'You are not a member of that guild' });
        return null;
    }
    const handler = _appContext?.getHandlers?.();
    if (!handler?.isGuildModerator) {
        res.status(500).json({ error: 'Moderator check handler missing' });
        return null;
    }
    const isModerator = await handler.isGuildModerator(member);
    if (!isModerator) {
        res.status(403).json({ error: 'You are not a moderator of that guild' });
        return null;
    }
    return { guild, member };
}

function buildGuildSummary(guild, member) {
    const me = guild.members.me;
    const iconUrl = typeof guild.iconURL === 'function' ? guild.iconURL({ size: 128 }) : null;
    return {
        id: guild.id,
        name: guild.name,
        icon: iconUrl,
        memberCount: guild.memberCount,
        ownerId: guild.ownerId,
        youAreOwner: member ? member.id === guild.ownerId : false,
        botHasAdmin: me?.permissions?.has(PermissionsBitField.Flags.Administrator) ?? false
    };
}

async function projectGuildConfig(guild) {
    const guildConfig = await database.getGuildConfig(guild.id).catch(() => null);
    const automod = await database.getAutoModConfig?.(guild.id).catch(() => null);
    const roles = guild.roles.cache
        .filter(r => !r.managed && r.id !== guild.id)
        .map(r => ({ id: r.id, name: r.name, color: r.hexColor, position: r.position }))
        .sort((a, b) => b.position - a.position)
        .slice(0, 100);
    const channels = guild.channels.cache
        .filter(c => c.isTextBased?.() && !c.isThread?.())
        .map(c => ({ id: c.id, name: c.name, parentId: c.parentId || null }))
        .slice(0, 100);
    return {
        guildId: guild.id,
        features: guildConfig?.features || null,
        moderatorUserIds: guildConfig?.moderatorUserIds || [],
        moderatorRoleIds: guildConfig?.moderatorRoleIds || [],
        aiChannelId: guildConfig?.aiChannelId || null,
        djRoleIds: guildConfig?.djRoleIds || [],
        djUserIds: guildConfig?.djUserIds || [],
        blockedUserIds: guildConfig?.blockedUserIds || [],
        customWakeWord: guildConfig?.customWakeWord || null,
        wakeWordsDisabled: Boolean(guildConfig?.wakeWordsDisabled),
        automod: automod || null,
        roles,
        channels
    };
}

// ─── SPA shell ──────────────────────────────────────────────────────────────

router.get('/', (req, res) => {
    const publicConfig = getPublicConfig();
    const template = loadPortalTemplate();
    const html = template
        .replaceAll('%%SITE_BASE_URL%%', publicConfig.baseUrl || '')
        .replaceAll('%%GA_MEASUREMENT_ID%%', publicConfig.gaMeasurementId || '')
        .replaceAll('%%DISCORD_INVITE%%', publicConfig.discordInviteUrl || '#')
        .replaceAll('%%OAUTH_CONFIGURED%%', portalAuth.isConfigured() ? 'true' : 'false');
    res.type('html').send(html);
});

// ─── OAuth routes ───────────────────────────────────────────────────────────

router.get('/login', oauthLimiter, (req, res) => {
    if (!portalAuth.isConfigured()) {
        res.status(503).type('html').send('<h1>Portal unavailable</h1><p>Discord OAuth is not configured on this deployment.</p>');
        return;
    }
    const returnTo = sanitizeReturnTo(req.query.return_to);
    const state = portalSessions.createState({ returnTo });
    res.redirect(portalAuth.getAuthorizeUrl({ state }));
});

router.get('/callback', oauthLimiter, async(req, res) => {
    try {
        const { code, state, error: oauthError } = req.query;
        if (oauthError) {
            log.warn('OAuth callback received error', { oauthError });
            res.redirect('/portal?error=denied');
            return;
        }
        if (!code || !state) {
            res.status(400).type('html').send('<h1>Login failed</h1><p>Missing authorization code or state.</p>');
            return;
        }
        const stateRecord = portalSessions.consumeState(state);
        if (!stateRecord) {
            res.status(400).type('html').send('<h1>Login failed</h1><p>Authorization expired or tampered. <a href="/portal/login">Try again</a>.</p>');
            return;
        }
        const tokens = await portalAuth.exchangeCode({ code });
        const discordUser = await portalAuth.fetchUser(tokens.accessToken);
        const session = await portalSessions.createSession({
            userId: discordUser.id,
            username: discordUser.username,
            globalName: discordUser.global_name || null,
            avatar: discordUser.avatar || null,
            discordAccessToken: tokens.accessToken,
            discordRefreshToken: tokens.refreshToken,
            discordTokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000)
        });
        res.cookie(COOKIE_NAME, session.sid, cookieOptions());
        res.redirect(sanitizeReturnTo(stateRecord.returnTo));
    } catch (error) {
        log.error('OAuth callback failed', { err: error });
        res.status(500).type('html').send(`<h1>Login failed</h1><p>${error?.message || 'Unknown error'}.</p><p><a href="/portal/login">Try again</a></p>`);
    }
});

router.post('/logout', oauthLimiter, async(req, res) => {
    const sid = req.cookies?.[COOKIE_NAME];
    if (sid) {
        const session = await portalSessions.getSession(sid);
        if (session?.userId) {
            invalidateUserGuildsCache(session.userId);
        }
        if (session?.discordAccessToken) {
            portalAuth.revokeToken(session.discordAccessToken).catch(() => {});
        }
        await portalSessions.deleteSession(sid);
    }
    res.clearCookie(COOKIE_NAME, { path: '/' });
    res.json({ ok: true });
});

// ─── API ────────────────────────────────────────────────────────────────────

// Lightweight identity endpoint — no guild work, used by landing/nav (#271).
router.get('/api/user', apiLimiter, requireSession, (req, res) => {
    const session = req.portalSession;
    res.json({
        user: {
            id: session.userId,
            username: session.username,
            globalName: session.globalName || null,
            avatarUrl: portalAuth.avatarUrlFor({
                id: session.userId,
                avatar: session.avatar
            })
        }
    });
});

router.get('/api/me', apiLimiter, requireSession, async(req, res) => {
    const session = req.portalSession;
    const client = _appContext?.getClient?.();
    const user = {
        id: session.userId,
        username: session.username,
        globalName: session.globalName || null,
        avatarUrl: portalAuth.avatarUrlFor({
            id: session.userId,
            avatar: session.avatar
        })
    };
    if (!client) {
        return res.json({ user, manageableGuilds: [], botReady: false });
    }

    // Fast path: serve cached guilds and bail before any REST fetch (#271).
    const cached = _cachedGuildsFor(session.userId);
    if (cached) {
        return res.json({ user, manageableGuilds: cached, botReady: true, cached: true });
    }

    const handler = _appContext.getHandlers?.();
    const allGuilds = [...client.guilds.cache.values()];

    // Prefer guilds where the member is already cached so we never block on
    // REST. Bound the number of REST fallbacks per request to avoid bot rate
    // limits when a user is in many shared servers.
    const cachedMemberGuilds = [];
    const needsFetchGuilds = [];
    for (const guild of allGuilds) {
        if (guild.members.cache.has(session.userId)) {
            cachedMemberGuilds.push(guild);
        } else {
            needsFetchGuilds.push(guild);
        }
    }

    const MAX_MEMBER_FETCHES = Number(process.env.PORTAL_GUILDS_MAX_FETCHES) || 25;
    const fetchTargets = needsFetchGuilds.slice(0, MAX_MEMBER_FETCHES);

    const evaluate = async guild => {
        try {
            const member = guild.members.cache.get(session.userId)
                ?? await guild.members.fetch(session.userId).catch(() => null);
            if (!member) {return null;}
            if (handler?.isGuildModerator && (await handler.isGuildModerator(member))) {
                return buildGuildSummary(guild, member);
            }
        } catch (error) {
            log.warn('me-api guild check failed', { guildId: guild.id, err: error });
        }
        return null;
    };

    const results = await Promise.all(
        [...cachedMemberGuilds, ...fetchTargets].map(evaluate)
    );
    const manageableGuilds = results.filter(Boolean);
    _setCachedGuilds(session.userId, manageableGuilds);

    res.json({
        user,
        manageableGuilds,
        botReady: true,
        partial: needsFetchGuilds.length > fetchTargets.length
    });
});

router.get('/api/guilds/:guildId/config', apiLimiter, requireSession, async(req, res) => {
    const ctx = await loadManageableGuild(req, res);
    if (!ctx) {return;}
    try {
        const payload = await projectGuildConfig(ctx.guild);
        res.json(payload);
    } catch (error) {
        log.error('Failed to load guild config projection', { err: error, guildId: ctx.guild.id });
        res.status(500).json({ error: 'Failed to load guild config' });
    }
});

router.patch('/api/guilds/:guildId/config', apiLimiter, requireSession, async(req, res) => {
    const ctx = await loadManageableGuild(req, res);
    if (!ctx) {return;}
    const guildId = ctx.guild.id;
    const patch = req.body || {};
    try {
        const tasks = [];
        if (patch.features && typeof patch.features === 'object') {
            tasks.push(database.updateGuildFeatures(guildId, patch.features));
        }
        if (Array.isArray(patch.moderatorUserIds)) {
            tasks.push(database.setGuildModeratorUsers(guildId, patch.moderatorUserIds));
        }
        if (Array.isArray(patch.moderatorRoleIds)) {
            tasks.push(database.setGuildModeratorRoles(guildId, patch.moderatorRoleIds));
        }
        if (Array.isArray(patch.djRoleIds)) {
            tasks.push(database.setGuildDjRoles(guildId, patch.djRoleIds));
        }
        if (Array.isArray(patch.djUserIds)) {
            tasks.push(database.setGuildDjUsers(guildId, patch.djUserIds));
        }
        if (Object.prototype.hasOwnProperty.call(patch, 'aiChannelId')) {
            const channelId = patch.aiChannelId;
            if (channelId === null || channelId === '') {
                tasks.push(database.clearGuildAiChannel(guildId));
            } else if (typeof channelId === 'string' && /^\d{5,30}$/.test(channelId)) {
                tasks.push(database.setGuildAiChannel(guildId, channelId));
            } else {
                return res.status(400).json({ error: 'Invalid aiChannelId' });
            }
        }
        if (Object.prototype.hasOwnProperty.call(patch, 'customWakeWord')) {
            const raw = patch.customWakeWord;
            const word = typeof raw === 'string' ? raw.trim().slice(0, 32) : null;
            tasks.push(database.setGuildWakeWord(guildId, word || null));
        }
        if (Object.prototype.hasOwnProperty.call(patch, 'wakeWordsDisabled')) {
            tasks.push(database.setGuildWakeWordsDisabled(guildId, Boolean(patch.wakeWordsDisabled)));
        }

        if (tasks.length === 0) {
            return res.status(400).json({ error: 'No recognized fields to update' });
        }

        await Promise.all(tasks);
        const fresh = await projectGuildConfig(ctx.guild);
        log.info('Portal config updated', {
            guildId,
            actorId: req.portalSession.userId,
            fields: Object.keys(patch)
        });
        res.json(fresh);
    } catch (error) {
        log.error('Portal config update failed', { err: error, guildId });
        res.status(500).json({ error: `Failed to update: ${error?.message || 'unknown error'}` });
    }
});

module.exports = router;
module.exports.setAppContext = setAppContext;
module.exports.invalidateUserGuildsCache = invalidateUserGuildsCache;

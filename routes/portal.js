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
 * Access rules:
 *   - The bot owner can see and manage every guild the bot is in.
 *   - Regular users can see guilds they own or administrate where Jarvis is installed.
 *   - Direct config reads/writes still revalidate server-side.
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
const { isOwner } = require('../src/utils/owner-check');

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

const GUILDS_CACHE_TTL_MS = Number(process.env.PORTAL_GUILDS_CACHE_TTL_MS) || 60_000;
const _userPortalCache = new Map(); // userId -> { at, payload }
const _userOAuthGuildsCache = new Map(); // userId -> { at, guilds }

function _cachedPortalPayloadFor(userId) {
    const entry = _userPortalCache.get(userId);
    if (!entry) {return null;}
    if (Date.now() - entry.at > GUILDS_CACHE_TTL_MS) {
        _userPortalCache.delete(userId);
        return null;
    }
    return entry.payload;
}

function _setCachedPortalPayload(userId, payload) {
    _userPortalCache.set(userId, { at: Date.now(), payload });
}

function _cachedOAuthGuildsFor(userId) {
    const entry = _userOAuthGuildsCache.get(userId);
    if (!entry) {return null;}
    if (Date.now() - entry.at > GUILDS_CACHE_TTL_MS) {
        _userOAuthGuildsCache.delete(userId);
        return null;
    }
    return entry.guilds;
}

function _setCachedOAuthGuilds(userId, guilds) {
    _userOAuthGuildsCache.set(userId, { at: Date.now(), guilds });
}

function invalidateUserGuildsCache(userId) {
    if (userId) {
        _userPortalCache.delete(userId);
        _userOAuthGuildsCache.delete(userId);
    } else {
        _userPortalCache.clear();
        _userOAuthGuildsCache.clear();
    }
}

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

function getOAuthGuildPermissions(oauthGuild) {
    const raw = oauthGuild?.permissions;
    if (raw === null || raw === undefined) {
        return new PermissionsBitField(0);
    }
    try {
        return new PermissionsBitField(BigInt(raw));
    } catch {
        try {
            return new PermissionsBitField(raw);
        } catch {
            return new PermissionsBitField(0);
        }
    }
}

function oauthGuildHasAdminAccess(oauthGuild) {
    if (!oauthGuild) {return false;}
    const perms = getOAuthGuildPermissions(oauthGuild);
    return Boolean(
        oauthGuild.owner ||
        perms.has(PermissionsBitField.Flags.Administrator)
    );
}

function buildGuildIconUrl(guildId, iconHash) {
    if (!guildId || !iconHash) {return null;}
    const isAnimated = String(iconHash).startsWith('a_');
    const ext = isAnimated ? 'gif' : 'png';
    return `https://cdn.discordapp.com/icons/${guildId}/${iconHash}.${ext}?size=128`;
}

function normalizeGuildCounts(botGuild, oauthGuild) {
    const memberCount = Number(
        botGuild?.memberCount ??
        oauthGuild?.approximate_member_count ??
        oauthGuild?.approximateMemberCount ??
        oauthGuild?.member_count ??
        oauthGuild?.memberCount ??
        0
    ) || 0;

    const activityCount = Number(
        oauthGuild?.approximate_presence_count ??
        oauthGuild?.approximatePresenceCount ??
        oauthGuild?.presence_count ??
        oauthGuild?.presenceCount ??
        0
    ) || 0;

    return { memberCount, activityCount };
}

function buildGuildSummary({ botGuild = null, oauthGuild = null, botOwnerMode = false, userId = null, canManage = false, installed = Boolean(botGuild) }) {
    const guildId = botGuild?.id || oauthGuild?.id || null;
    const name = botGuild?.name || oauthGuild?.name || 'Unknown Server';
    const iconHash = botGuild?.icon || oauthGuild?.icon || null;
    const iconUrl = buildGuildIconUrl(guildId, iconHash);
    const { memberCount, activityCount } = normalizeGuildCounts(botGuild, oauthGuild);
    const botMe = botGuild?.members?.me || null;
    const youAreOwner = Boolean(oauthGuild?.owner) || botGuild?.ownerId === userId;
    const youAreAdmin = oauthGuildHasAdminAccess(oauthGuild);
    const botHasAdmin = installed ? Boolean(botMe?.permissions?.has(PermissionsBitField.Flags.Administrator)) : false;

    return {
        id: guildId,
        name,
        icon: iconUrl,
        memberCount,
        activityCount,
        installed,
        botOwnerMode,
        canManage: Boolean(canManage || botOwnerMode),
        canInvite: !installed && Boolean(oauthGuild) && (botOwnerMode || oauthGuildHasAdminAccess(oauthGuild)),
        inviteUrl: !installed ? (getPublicConfig().botInviteUrl || null) : null,
        ownerId: botGuild?.ownerId || null,
        youAreOwner,
        youAreAdmin,
        botHasAdmin
    };
}

function sortGuilds(guilds, sortMode = 'member_count') {
    const list = Array.isArray(guilds) ? guilds.slice() : [];
    const nameSort = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
    list.sort((a, b) => {
        if (sortMode === 'activity') {
            const activityDiff = (b.activityCount || 0) - (a.activityCount || 0);
            if (activityDiff) {return activityDiff;}
            const memberDiff = (b.memberCount || 0) - (a.memberCount || 0);
            if (memberDiff) {return memberDiff;}
            return nameSort(a, b);
        }
        const memberDiff = (b.memberCount || 0) - (a.memberCount || 0);
        if (memberDiff) {return memberDiff;}
        const activityDiff = (b.activityCount || 0) - (a.activityCount || 0);
        if (activityDiff) {return activityDiff;}
        return nameSort(a, b);
    });
    return list;
}

async function getOAuthGuildsForSession(session, { forceRefresh = false } = {}) {
    const cached = !forceRefresh ? _cachedOAuthGuildsFor(session.userId) : null;
    if (cached) {return cached;}

    const accessToken = session.discordAccessToken;
    if (!accessToken) {return [];}

    try {
        const guilds = await portalAuth.fetchUserGuilds(accessToken, { withCounts: true });
        _setCachedOAuthGuilds(session.userId, guilds);
        return guilds;
    } catch (error) {
        const fallback = _cachedOAuthGuildsFor(session.userId);
        if (fallback) {
            log.warn('OAuth guild fetch failed, serving cached guild list', { userId: session.userId, err: error });
            return fallback;
        }
        throw error;
    }
}

async function buildPortalPayload(session, client) {
    const botOwnerMode = isOwner(session.userId);
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
        return {
            user,
            manageableGuilds: [],
            inviteableGuilds: [],
            botReady: false,
            isBotOwner: botOwnerMode
        };
    }

    const oauthGuilds = await getOAuthGuildsForSession(session, { forceRefresh: true });
    const oauthMap = new Map(oauthGuilds.map(g => [String(g.id), g]));
    const botGuilds = [...client.guilds.cache.values()];
    const botGuildIds = new Set(botGuilds.map(g => String(g.id)));

    const manageableGuilds = [];
    const inviteableGuilds = [];

    for (const botGuild of botGuilds) {
        const oauthGuild = oauthMap.get(String(botGuild.id)) || null;
        const canManage = botOwnerMode || oauthGuildHasAdminAccess(oauthGuild);
        if (botOwnerMode || canManage) {
            manageableGuilds.push(buildGuildSummary({
                botGuild,
                oauthGuild,
                botOwnerMode,
                userId: session.userId,
                canManage: true,
                installed: true
            }));
        }
    }

    for (const oauthGuild of oauthGuilds) {
        const guildId = String(oauthGuild.id);
        if (botGuildIds.has(guildId)) {continue;}
        if (!botOwnerMode && !oauthGuildHasAdminAccess(oauthGuild)) {continue;}
        inviteableGuilds.push(buildGuildSummary({
            botGuild: null,
            oauthGuild,
            botOwnerMode,
            userId: session.userId,
            canManage: false,
            installed: false
        }));
    }

    return {
        user,
        manageableGuilds: sortGuilds(manageableGuilds, 'member_count'),
        inviteableGuilds: sortGuilds(inviteableGuilds, 'member_count'),
        botReady: true,
        isBotOwner: botOwnerMode
    };
}

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

    const session = req.portalSession;
    if (isOwner(session.userId)) {
        return { guild, member: null, oauthGuild: null, botOwnerMode: true };
    }

    const oauthGuilds = await getOAuthGuildsForSession(session).catch(() => []);
    const oauthGuild = oauthGuilds.find(g => String(g.id) === guildId) || null;
    const perms = oauthGuild ? getOAuthGuildPermissions(oauthGuild) : null;
    const hasOAuthAccess = Boolean(
        oauthGuild &&
        (oauthGuild.owner ||
         perms?.has(PermissionsBitField.Flags.Administrator))
    );

    if (hasOAuthAccess) {
        const member = await guild.members.fetch(session.userId).catch(() => null);
        return { guild, member, oauthGuild, botOwnerMode: false };
    }

    const member = await guild.members.fetch(session.userId).catch(() => null);
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
        res.status(403).json({ error: 'You are not authorized to manage this guild' });
        return null;
    }
    return { guild, member, oauthGuild, botOwnerMode: false };
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
        blockedAiRoleIds: guildConfig?.blockedAiRoleIds || [],
        customWakeWord: guildConfig?.customWakeWord || null,
        wakeWordsDisabled: Boolean(guildConfig?.wakeWordsDisabled),
        automod: automod || null,
        roles,
        channels
    };
}

router.get('/', (req, res) => {
    const publicConfig = getPublicConfig();
    const template = loadPortalTemplate();
    const html = template
        .replaceAll('%%SITE_BASE_URL%%', publicConfig.baseUrl || '')
        .replaceAll('%%GA_MEASUREMENT_ID%%', publicConfig.gaMeasurementId || '')
        .replaceAll('%%DISCORD_INVITE%%', publicConfig.discordInviteUrl || '#')
        .replaceAll('%%BOT_INVITE%%', publicConfig.botInviteUrl || '#')
        .replaceAll('%%OAUTH_CONFIGURED%%', portalAuth.isConfigured() ? 'true' : 'false');
    res.type('html').send(html);
});

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
    const payload = {
        user: {
            id: session.userId,
            username: session.username,
            globalName: session.globalName || null,
            avatarUrl: portalAuth.avatarUrlFor({
                id: session.userId,
                avatar: session.avatar
            })
        }
    };

    if (!client) {
        return res.json({
            ...payload,
            manageableGuilds: [],
            inviteableGuilds: [],
            botReady: false,
            isBotOwner: isOwner(session.userId)
        });
    }

    try {
        const fresh = await buildPortalPayload(session, client);
        const response = {
            ...payload,
            ...fresh
        };
        res.json(response);
    } catch (error) {
        log.error('Failed to build portal guild payload', { err: error, userId: session.userId });
        res.status(500).json({ error: 'Failed to load servers' });
    }
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
        if (Array.isArray(patch.blockedAiRoleIds)) {
            tasks.push(database.setGuildBlockedAiRoles(guildId, patch.blockedAiRoleIds));
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
        invalidateUserGuildsCache(req.portalSession.userId);
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

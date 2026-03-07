'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const cookieParser = require('cookie-parser');
const appContext = require('../core/app-context');
const tempFiles = require('../utils/temp-files');
const { getPublicConfig } = require('../utils/public-config');
const { gatherHealthSnapshot } = require('../services/diagnostics');
const {
    extractBearerToken,
    isRenderHealthCheck, isRenderHealthUserAgent, buildProviderDigestResponse
} = require('./health-helpers');
const {
    isDashboardAuthed, dashboardAuthMiddleware,
    createDashboardAccessRouter
} = require('./dashboard-auth');

const ROOT_DIR = path.join(__dirname, '..', '..');
const HEALTH_TOKEN = (process.env.HEALTH_TOKEN || '').trim() || null;
const PUBLIC_CONFIG = getPublicConfig();

function normalizeHostValue(raw) {
    const value = String(raw || '').trim().toLowerCase();
    if (!value) {return '';}

    // Host header may include a port. Strip ":port" for hostname comparisons.
    if (value.startsWith('[') && value.includes(']')) {
        const endBracket = value.indexOf(']');
        return value.slice(1, endBracket);
    }

    return value.replace(/:\d+$/, '');
}

function hostFromEnv(raw) {
    const value = String(raw || '').trim();
    if (!value) {return '';}

    try {
        if (value.includes('://')) {
            return normalizeHostValue(new URL(value).host);
        }
    } catch {
        // Fall back to raw host parsing below.
    }

    return normalizeHostValue(value);
}

function buildAllowedHostSet() {
    const hosts = new Set(['localhost', '127.0.0.1', '::1']);
    const directEnvHosts = String(process.env.ALLOWED_HOSTS || '')
        .split(',')
        .map(entry => hostFromEnv(entry))
        .filter(Boolean);

    const derivedHosts = [
        process.env.SITE_DOMAIN,
        process.env.SITE_BASE_URL,
        process.env.JARVIS_DOMAIN,
        process.env.PUBLIC_BASE_URL,
        process.env.RENDER_EXTERNAL_URL
    ]
        .map(hostFromEnv)
        .filter(Boolean);

    const configuredDomain = normalizeHostValue(PUBLIC_CONFIG.domain);
    const configuredBaseHost = hostFromEnv(PUBLIC_CONFIG.baseUrl);

    for (const host of [...directEnvHosts, ...derivedHosts, configuredDomain, configuredBaseHost].filter(Boolean)) {
        hosts.add(host);
        if (!host.startsWith('www.') && !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) && host !== '::1') {
            hosts.add(`www.${host}`);
        }
    }

    return hosts;
}

function createExpressApp({ webhookRouter, database }) {
    const app = express();
    app.disable('x-powered-by');
    app.set('trust proxy', true);

    // ---- Helmet ----
    let helmet = null;
    try {
        helmet = require('helmet');
    } catch {
        helmet = null;
    }
    if (helmet) {
        app.use(helmet({
            contentSecurityPolicy: {
                directives: {
                    defaultSrc: ["'self'"],
                    scriptSrc: ["'self'", "'unsafe-inline'", 'https://static.cloudflareinsights.com'],
                    scriptSrcAttr: ["'self'", "'unsafe-inline'"],
                    connectSrc: ["'self'", 'https://cloudflareinsights.com', 'https://www.cloudflarestatus.com'],
                    imgSrc: ["'self'", 'data:', 'https:', '*']
                }
            }
        }));
    } else {
        app.use((req, res, next) => {
            res.setHeader('X-Content-Type-Options', 'nosniff');
            res.setHeader('X-Frame-Options', 'DENY');
            res.setHeader('Referrer-Policy', 'no-referrer');
            next();
        });
    }

    // ---- Cloudflare-only access middleware ----
    const CLOUDFLARE_ONLY = process.env.CLOUDFLARE_ONLY !== 'false';
    const ALLOWED_HOSTS = buildAllowedHostSet();

    app.use((req, res, next) => {
        const clientIp = req.ip || req.connection?.remoteAddress || '';
        if (clientIp === '127.0.0.1' || clientIp === '::1' || clientIp === '::ffff:127.0.0.1') {
            return next();
        }
        if (!CLOUDFLARE_ONLY) {
            return next();
        }
        const cfRay = req.headers['cf-ray'];
        const cfConnectingIp = req.headers['cf-connecting-ip'];
        const isFromCloudflare = !!(cfRay || cfConnectingIp);
        const hostHeader = String(req.headers.host || '').toLowerCase();
        const normalizedHost = normalizeHostValue(hostHeader);
        const isDirectIpAccess = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(normalizedHost);
        const isAwsDns = normalizedHost.includes('amazonaws.com') || normalizedHost.includes('compute-1.amazonaws.com');
        const isAllowedHost = Array.from(ALLOWED_HOSTS).some(
            host => normalizedHost === host || normalizedHost.endsWith(`.${host}`)
        );

        if ((isDirectIpAccess || isAwsDns) && !isFromCloudflare) {
            console.log(`[Security] Dropping connection: ${clientIp} -> ${hostHeader}`);
            req.socket.destroy();
            return;
        }
        if (!isFromCloudflare && !isAllowedHost && hostHeader) {
            console.log(`[Security] Dropping non-CF connection: ${clientIp} -> ${hostHeader}`);
            req.socket.destroy();
            return;
        }
        next();
    });

    // ---- Body parsers & cookie ----
    app.use(cookieParser());

    // Serve ephemeral temp files at short root paths
    app.get('/:id.:ext', (req, res, next) => {
        const { id, ext } = req.params;
        if (!/^[a-f0-9]{32}$/.test(id || '')) {return next();}
        if (!/^[a-z0-9]{1,8}$/i.test(ext || '')) {return next();}
        const filePath = path.join(tempFiles.TEMP_DIR, `${id}.${ext}`);
        if (!fs.existsSync(filePath)) {return next();}
        const typeMap = {
            png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
            gif: 'image/gif', webp: 'image/webp', mp4: 'video/mp4',
            mp3: 'audio/mpeg', wav: 'audio/wav', bin: 'application/octet-stream',
            txt: 'text/plain'
        };
        const ctype = typeMap[ext.toLowerCase()] || 'application/octet-stream';
        res.setHeader('Content-Type', ctype);
        res.setHeader('Cache-Control', 'public, max-age=14400, immutable');
        fs.createReadStream(filePath).pipe(res);
    });

    // Webhook forwarder requires raw body parsing, mount before json middleware
    app.use('/webhook', webhookRouter);

    const bodyLimit = process.env.JSON_BODY_LIMIT || '500kb';
    app.use(express.json({ limit: bodyLimit }));
    app.use(express.urlencoded({ extended: true, limit: bodyLimit }));

    // ---- Route mounts ----
    const moderatorRouter = require('../routes/moderator');
    app.use('/moderator', moderatorRouter);

    const jarvisOwnerRouter = require('../routes/jarvis');
    app.use('/jarvis', jarvisOwnerRouter);

    const legalRouter = require('../../routes/legal');
    app.use('/', legalRouter);

    const userAuthRouter = require('../../routes/user-auth');
    app.use('/', userAuthRouter);

    const userPortalRouter = require('../../routes/user-portal');
    userPortalRouter.init(database);
    app.use('/me', userPortalRouter);

    const publicApiRouter = require('../../routes/public-api');
    app.use('/api/v1', publicApiRouter);

    const pagesRouter = require('../../routes/pages');
    app.use('/', pagesRouter);

    // ---- Static files ----
    app.get('/favicon.ico', (req, res) => {
        res.type('image/webp');
        res.sendFile(path.join(ROOT_DIR, 'jarvis.webp'));
    });
    app.get('/jarvis.webp', (req, res) => {
        res.type('image/webp');
        res.sendFile(path.join(ROOT_DIR, 'jarvis.webp'));
    });
    app.use('/uploads/news', express.static(path.join(ROOT_DIR, 'uploads/news')));
    app.use('/assets', express.static(path.join(ROOT_DIR, 'assets')));

    // ---- SEO ----
    app.get('/robots.txt', (req, res) => {
        const siteBaseUrl = PUBLIC_CONFIG.baseUrl;
        res.type('text/plain').send(`# Jarvis Discord Bot - ${siteBaseUrl}
User-agent: *
Allow: /
Allow: /status
Allow: /changelog

# Disallow private areas
Disallow: /dashboard
Disallow: /dashboard/*
Disallow: /moderator
Disallow: /moderator/*
Disallow: /jarvis
Disallow: /jarvis/*
Disallow: /me
Disallow: /me/*
Disallow: /api/
Disallow: /auth/

# Sitemap
Sitemap: ${siteBaseUrl}/sitemap.xml
`);
    });

    app.get('/sitemap.xml', (req, res) => {
        const baseUrl = PUBLIC_CONFIG.baseUrl;
        const pages = [
            { url: '/', priority: '1.0', changefreq: 'weekly' },
            { url: '/status', priority: '0.6', changefreq: 'always' },
            { url: '/changelog', priority: '0.5', changefreq: 'monthly' },
            { url: '/tos', priority: '0.3', changefreq: 'yearly' },
            { url: '/policy', priority: '0.3', changefreq: 'yearly' }
        ];

        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map(p => `  <url>
    <loc>${baseUrl}${p.url}</loc>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`).join('\n')}
</urlset>`;

        res.type('application/xml').send(xml);
    });

    // ---- Public stats API ----
    app.get('/api/stats', async(req, res) => {
        try {
            const guildCount = appContext.getClient()?.guilds?.cache?.size || 0;
            const userCount = appContext.getClient()?.guilds?.cache?.reduce((acc, g) => acc + g.memberCount, 0) || 0;
            res.json({ guildCount, userCount, uptime: process.uptime() });
        } catch (e) {
            res.json({ guildCount: 0, userCount: 0, uptime: 0 });
        }
    });

    // Landing page (must be before dashboard to not override)
    const landingRouter = require('../../routes/landing');
    app.use('/', landingRouter);

    // ---- Dashboard ----
    const dashboardRouter = require('../../routes/dashboard');

    // Public health endpoint for /status page
    app.get('/api/public/health', async(req, res) => {
        try {
            const uptime = Date.now() - (dashboardRouter.getBotStartTime?.() || Date.now());
            const hours = Math.floor(uptime / 3600000);
            const minutes = Math.floor((uptime % 3600000) / 60000);

            let discordStats = { guilds: 0, users: 0, channels: 0 };
            if (appContext.getClient() && appContext.getClient().isReady()) {
                discordStats = {
                    guilds: appContext.getClient().guilds.cache.size,
                    users: appContext.getClient().guilds.cache.reduce((acc, g) => acc + g.memberCount, 0),
                    channels: appContext.getClient().channels.cache.size
                };
            }

            let aiStats = { totalRequests: 0, providers: 0, activeProviders: 0 };
            try {
                const aiMgr = require('../services/ai-providers');
                aiStats = aiMgr.getStats();
            } catch (e) {
                // Use defaults
            }

            res.json({
                status: 'healthy',
                uptime: `${hours}h ${minutes}m`,
                aiCalls: aiStats.totalRequests || 0,
                discord: discordStats,
                providers: aiStats.providers || 0,
                activeProviders: aiStats.activeProviders || 0
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    app.get('/api/public/uptime-history', async(req, res) => {
        try {
            const uptimeTracker = require('../services/uptime-tracker');
            const history = await uptimeTracker.getDailyHistory(90);
            res.json({ history });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    app.use('/api/dashboard', dashboardAuthMiddleware, dashboardRouter);

    const dashboardDistPath = path.join(ROOT_DIR, 'dashboard', 'dist');
    const dashboardAccessRouter = createDashboardAccessRouter(dashboardDistPath);
    app.use('/dashboard', dashboardAccessRouter);

    // ---- Status page ----
    app.get('/status', async(req, res) => {
        if (isRenderHealthUserAgent(req)) {
            return res.status(200).send('OK');
        }
        try {
            const snapshot = await gatherHealthSnapshot({
                includeProviders: true,
                redactProviders: true,
                pingDatabase: false
            });

            const providerStatus = snapshot.providers;
            const workingProviders = providerStatus.filter(p => !p.hasError && !p.isDisabled).length;
            const uptimeSeconds = Math.floor(snapshot.system.uptimeSeconds);
            const { memory } = snapshot.system;
            const envRequiredCount = snapshot.env.required.filter(item => item.present).length;
            const envRequiredTotal = snapshot.env.required.length;
            const { optionalConfigured } = snapshot.env;
            const { optionalTotal } = snapshot.env;
            const missingRequired = snapshot.env.required
                .filter(item => !item.present)
                .map(item => item.name);
            const optionalEnabled = snapshot.env.optional
                .filter(item => item.present)
                .map(item => item.name);
            const databaseStatus = snapshot.database;

            const providerList =
                providerStatus
                    .map(provider => {
                        const uptimePercent =
                            provider.metrics.successRate != null
                                ? `${(provider.metrics.successRate * 100).toFixed(1)}%`
                                : 'n/a';
                        const latency = Number.isFinite(provider.metrics.avgLatencyMs)
                            ? `${Math.round(provider.metrics.avgLatencyMs)}ms`
                            : 'n/a';
                        let statusClass = 'online';
                        let statusLabel = '✅ OK';

                        if (provider.isDisabled) {
                            statusClass = 'offline';
                            statusLabel = '⛔ Paused';
                        } else if (provider.hasError) {
                            statusClass = 'warning';
                            statusLabel = '⚠️ Error';
                        }

                        const disabledInfo =
                            provider.isDisabled && provider.disabledUntil
                                ? ` • resumes ${new Date(provider.disabledUntil).toLocaleString()}`
                                : '';

                        return `
                        <div class="provider-item">
                            <div>
                                <div class="provider-name">${provider.name}</div>
                                <div class="provider-meta">Uptime ${uptimePercent} • Latency ${latency}${disabledInfo}</div>
                            </div>
                            <span class="provider-status ${statusClass}">${statusLabel}</span>
                        </div>`;
                    })
                    .join('') ||
                '<div class="provider-item"><span class="provider-name">No providers configured</span></div>';

            const uptimeText = `${Math.floor(uptimeSeconds / 3600)}h ${Math.floor((uptimeSeconds % 3600) / 60)}m ${uptimeSeconds % 60}s`;
            const memoryText = `${Math.round(memory.heapUsed / 1024 / 1024)}MB / ${Math.round(memory.heapTotal / 1024 / 1024)}MB`;

            res.send(renderStatusPage({
                providerList, workingProviders, providerStatus,
                databaseStatus, uptimeText, memoryText,
                envRequiredCount, envRequiredTotal, optionalConfigured, optionalTotal,
                missingRequired, optionalEnabled
            }));
        } catch (error) {
            console.error('Failed to render status page:', error);
            res.status(500).send('Jarvis uplink is initializing. Please try again shortly.');
        }
    });

    // ---- Provider status ----
    app.get('/providers/status', async(req, res) => {
        if (HEALTH_TOKEN) {
            const providedToken = extractBearerToken(req);
            if (providedToken !== HEALTH_TOKEN) {
                return res
                    .status(401)
                    .json({ status: 'unauthorized', error: 'Valid bearer token required' });
            }
        }

        try {
            const snapshot = await gatherHealthSnapshot({
                includeProviders: true,
                redactProviders: false,
                pingDatabase: false
            });
            res.json(buildProviderDigestResponse(snapshot.providers || []));
        } catch (error) {
            console.error('Failed to build provider status digest:', error);
            res.status(500).json({ error: 'Unable to build provider status digest' });
        }
    });

    // ---- Command metrics ----
    app.get('/metrics/commands', async(req, res) => {
        if (HEALTH_TOKEN) {
            const providedToken = extractBearerToken(req);
            if (providedToken !== HEALTH_TOKEN) {
                return res
                    .status(401)
                    .json({ status: 'unauthorized', error: 'Valid bearer token required' });
            }
        }

        const limitParam = Number.parseInt(req.query?.limit, 10);
        const limit = Math.max(1, Math.min(Number.isFinite(limitParam) ? limitParam : 25, 200));
        const sortBy = req.query?.sort === 'errors' ? 'errors' : 'runs';

        if (!database.isConnected) {
            return res.status(503).json({ error: 'Command metrics unavailable (database offline)' });
        }

        try {
            const metrics = await database.getCommandMetricsSummary({ limit, sortBy });
            res.json({
                generatedAt: new Date().toISOString(),
                limit, sortBy,
                count: metrics.length,
                metrics
            });
        } catch (error) {
            console.error('Failed to load command metrics summary:', error);
            res.status(500).json({ error: 'Unable to load command metrics summary' });
        }
    });

    // ---- Legacy dashboard page ----
    app.get('/dashboard', async(req, res) => {
        if (!isDashboardAuthed(req)) {
            return res.redirect('/dashboard/login');
        }
        if (HEALTH_TOKEN) {
            const providedToken = extractBearerToken(req);
            if (providedToken !== HEALTH_TOKEN) {
                return res.status(401).send('Dashboard requires a valid bearer token.');
            }
        }

        const deep = ['1', 'true', 'yes', 'deep'].includes(String(req.query.deep || '').toLowerCase());

        try {
            const snapshot = await gatherHealthSnapshot({
                includeProviders: true,
                redactProviders: false,
                pingDatabase: deep,
                attemptReconnect: deep
            });

            res.send(renderDashboardPage(snapshot, deep));
        } catch (error) {
            console.error('Failed to render dashboard:', error);
            res.status(500).send('Dashboard unavailable while diagnostics recalibrate.');
        }
    });

    // ---- Health check endpoint ----
    app.get('/health', async(req, res) => {
        if (HEALTH_TOKEN && !isRenderHealthCheck(req)) {
            const providedToken = extractBearerToken(req);
            if (providedToken !== HEALTH_TOKEN) {
                return res.status(401).json({
                    status: 'unauthorized',
                    error: 'Valid bearer token required'
                });
            }
        }

        if (isRenderHealthUserAgent(req) && !req.query.deep) {
            return res.status(200).json({ status: 'ok' });
        }
        const deep = ['1', 'true', 'yes', 'deep'].includes(String(req.query.deep || '').toLowerCase());

        try {
            const snapshot = await gatherHealthSnapshot({
                includeProviders: true,
                redactProviders: false,
                pingDatabase: deep,
                attemptReconnect: deep
            });

            const healthyProviders = snapshot.providers.filter(
                p => !p.hasError && !p.isDisabled
            ).length;
            const status =
                snapshot.env.hasAllRequired && snapshot.database.connected && healthyProviders > 0
                    ? 'ok'
                    : 'degraded';

            const httpStatus = status === 'ok' ? 200 : 503;
            res.status(httpStatus).json({
                status,
                env: snapshot.env,
                database: snapshot.database,
                providers: snapshot.providers,
                system: snapshot.system,
                counts: {
                    providersTotal: snapshot.providers.length,
                    providersHealthy: healthyProviders
                }
            });
        } catch (error) {
            console.error('Health endpoint failed:', error);
            res.status(500).json({ status: 'error', error: error.message });
        }
    });

    return { app, dashboardRouter, publicApiRouter };
}

function mount404Handler(app) {
    app.use((req, res) => {
        res.status(404).send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>404 - Page Not Found | Jarvis</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #0a0a1a 0%, #1a1a3e 50%, #0d0d2b 100%);
            color: #e4e4e4;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            text-align: center;
            padding: 2rem;
        }
        .error-icon { font-size: 6rem; margin-bottom: 1rem; }
        h1 {
            font-size: 3rem;
            margin-bottom: 1rem;
            background: linear-gradient(90deg, #ff4444, #ff6b6b);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        p { color: #888; font-size: 1.2rem; margin-bottom: 2rem; }
        .btn {
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            padding: 1rem 2rem;
            background: linear-gradient(90deg, #00d4ff, #8a2be2);
            color: white;
            border-radius: 50px;
            font-weight: 600;
            text-decoration: none;
            transition: all 0.3s;
            box-shadow: 0 4px 20px rgba(0, 212, 255, 0.3);
        }
        .btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 30px rgba(0, 212, 255, 0.4);
        }
        .path { color: #666; font-size: 0.9rem; margin-top: 2rem; font-family: monospace; }
    </style>
</head>
<body>
    <div class="error-icon">🤖</div>
    <h1>404</h1>
    <p>There's nothing here.</p>
    <a href="/" class="btn">🏠 Go Home</a>
    <p class="path">${req.path.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])}</p>
</body>
</html>`);
    });
}

function renderStatusPage(data) {
    const {
        providerList, workingProviders, providerStatus,
        databaseStatus, uptimeText, memoryText,
        envRequiredCount, envRequiredTotal, optionalConfigured, optionalTotal,
        missingRequired, optionalEnabled
    } = data;

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Status | Jarvis</title>
    <meta name="theme-color" content="#00d4ff">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #0a0a1a 0%, #1a1a3e 50%, #0d0d2b 100%);
            color: #e4e4e4;
            min-height: 100vh;
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
        .nav-links { display: flex; gap: 2rem; list-style: none; }
        .nav-links a { color: #b0b0b0; text-decoration: none; font-weight: 500; transition: color 0.3s; }
        .nav-links a:hover { color: #00d4ff; }
        .container { max-width: 1200px; margin: 0 auto; padding: 2rem; }
        .header { text-align: center; margin-bottom: 3rem; }
        .header h1 {
            font-size: 2.5rem;
            background: linear-gradient(90deg, #fff, #00d4ff);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            margin-bottom: 0.5rem;
        }
        .status-badge {
            display: inline-flex; align-items: center; gap: 0.5rem;
            padding: 0.5rem 1.5rem;
            background: rgba(46, 204, 113, 0.2); border: 1px solid #2ecc71;
            border-radius: 50px; color: #2ecc71; font-weight: 600;
        }
        .status-badge.warning { background: rgba(241, 196, 15, 0.2); border-color: #f1c40f; color: #f1c40f; }
        .status-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(350px, 1fr)); gap: 1.5rem; margin: 2rem 0; }
        .card { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; padding: 1.5rem; }
        .card h3 { color: #00d4ff; margin-bottom: 1rem; font-size: 1.1rem; display: flex; align-items: center; gap: 0.5rem; }
        .provider-list { max-height: 250px; overflow-y: auto; }
        .provider-item { display: flex; justify-content: space-between; align-items: center; padding: 0.75rem 0; border-bottom: 1px solid rgba(255,255,255,0.05); }
        .provider-item:last-child { border-bottom: none; }
        .provider-name { color: #fff; font-weight: 500; }
        .provider-meta { font-size: 0.8rem; color: #888; margin-top: 0.25rem; }
        .provider-status { font-weight: 600; font-size: 0.85rem; }
        .online { color: #2ecc71; } .offline { color: #e74c3c; } .warning { color: #f1c40f; }
        .stat-row { display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid rgba(255,255,255,0.05); }
        .stat-row:last-child { border-bottom: none; }
        .stat-label { color: #888; } .stat-value { color: #fff; font-weight: 500; }
        .env-list { font-size: 0.9rem; line-height: 1.8; }
        .env-tag { display: inline-block; background: rgba(0,212,255,0.1); color: #00d4ff; padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.8rem; margin: 0.2rem; }
        .btn-row { display: flex; gap: 1rem; justify-content: center; flex-wrap: wrap; margin: 2rem 0; }
        .btn { display: inline-flex; align-items: center; gap: 0.5rem; padding: 0.75rem 1.5rem; border-radius: 8px; font-weight: 600; text-decoration: none; border: none; cursor: pointer; font-size: 1rem; transition: all 0.3s; }
        .btn-primary { background: linear-gradient(90deg, #00d4ff, #8a2be2); color: white; }
        .btn-primary:hover { transform: translateY(-2px); }
        .btn-secondary { background: rgba(255,255,255,0.1); color: white; border: 1px solid rgba(255,255,255,0.2); }
        .btn-secondary:hover { background: rgba(255,255,255,0.15); }
        footer { text-align: center; padding: 2rem; color: #666; font-size: 0.9rem; }
        footer a { color: #888; text-decoration: none; margin: 0 1rem; }
        footer a:hover { color: #00d4ff; }
        @media (max-width: 768px) { .nav-links { display: none; } .status-grid { grid-template-columns: 1fr; } }
    </style>
</head>
<body>
    <nav>
        <a href="/" class="logo">⚡ Jarvis</a>
        <ul class="nav-links">
            <li><a href="/commands">Commands</a></li>
            <li><a href="/store">Store</a></li>
            <li><a href="/leaderboard">Leaderboard</a></li>
            <li><a href="/sbx">SBX</a></li>
            <li><a href="/status" style="color: #00d4ff;">Status</a></li>
        </ul>
    </nav>
    <div class="container">
        <div class="header">
            <h1>🤖 System Status</h1>
            <div class="status-badge"><span style="font-size: 1.2rem;">●</span> All Systems Operational</div>
        </div>
        <div class="status-grid">
            <div class="card">
                <h3>🧠 AI Providers</h3>
                <div class="provider-list">${providerList}</div>
                <div style="margin-top: 1rem; text-align: center; padding-top: 1rem; border-top: 1px solid rgba(255,255,255,0.1);">
                    <strong style="color: #2ecc71;">${workingProviders}/${providerStatus.length}</strong>
                    <span style="color: #888;"> providers active</span>
                </div>
            </div>
            <div class="card">
                <h3>💾 System Info</h3>
                <div class="stat-row"><span class="stat-label">Database</span><span class="stat-value">${databaseStatus.connected ? '✅ Connected' : '❌ Disconnected'}</span></div>
                <div class="stat-row"><span class="stat-label">DB Ping</span><span class="stat-value">${databaseStatus.ping}</span></div>
                <div class="stat-row"><span class="stat-label">Uptime</span><span class="stat-value">${uptimeText}</span></div>
                <div class="stat-row"><span class="stat-label">Memory</span><span class="stat-value">${memoryText}</span></div>
            </div>
            <div class="card">
                <h3>🧪 Environment</h3>
                <div class="stat-row"><span class="stat-label">Required</span><span class="stat-value">${envRequiredCount}/${envRequiredTotal}</span></div>
                <div class="stat-row"><span class="stat-label">Optional</span><span class="stat-value">${optionalConfigured}/${optionalTotal}</span></div>
                ${missingRequired.length ? `<div style="margin-top: 0.5rem; color: #e74c3c; font-size: 0.85rem;">Missing: ${missingRequired.join(', ')}</div>` : ''}
                <div style="margin-top: 1rem;">${optionalEnabled.map(name => `<span class="env-tag">${name}</span>`).join('')}</div>
            </div>
        </div>
        <div class="btn-row">
            <button class="btn btn-primary" onclick="location.reload()">🔄 Refresh Status</button>
            <a href="/moderator/dashboard" class="btn btn-secondary">🛡️ Moderator Dashboard</a>
            <a href="/" class="btn btn-secondary">🏠 Home</a>
        </div>
    </div>
    <footer>
        <a href="/tos">Terms of Service</a>
        <a href="/policy">Privacy Policy</a>
        <p style="margin-top: 1rem;">© 2025 Jarvis</p>
    </footer>
    <script>setTimeout(() => location.reload(), 60000);</script>
</body>
</html>`;
}

function renderDashboardPage(snapshot, deep) {
    const providerRows =
        snapshot.providers
            .map((provider, index) => {
                const uptimePercent =
                    provider.metrics.successRate != null
                        ? `${provider.metrics.successRate.toFixed(1)}%`
                        : 'n/a';
                const latency = Number.isFinite(provider.metrics.avgLatencyMs)
                    ? `${Math.round(provider.metrics.avgLatencyMs)} ms`
                    : 'n/a';
                const totalCalls =
                    provider.metrics.total ??
                    provider.metrics.successes + provider.metrics.failures;
                const status = provider.isDisabled
                    ? 'Paused'
                    : provider.hasError
                        ? 'Error'
                        : 'Healthy';
                const disabledUntil =
                    provider.isDisabled && provider.disabledUntil
                        ? new Date(provider.disabledUntil).toLocaleString()
                        : '-';

                return `
                <tr>
                    <td>${index + 1}</td>
                    <td>${provider.name}</td>
                    <td>${provider.model}</td>
                    <td>${provider.costTier}</td>
                    <td class="${status.toLowerCase()}">${status}</td>
                    <td>${uptimePercent}</td>
                    <td>${latency}</td>
                    <td>${totalCalls}</td>
                    <td>${disabledUntil}</td>
                </tr>`;
            })
            .join('') || '<tr><td colspan="9">No providers configured</td></tr>';

    const requiredRows = snapshot.env.required
        .map(item => `<tr><td>${item.name}</td><td class="${item.present ? 'healthy' : 'error'}">${item.present ? 'Present' : 'Missing'}</td></tr>`)
        .join('');

    const optionalRows = snapshot.env.optional
        .map(item => `<tr><td>${item.name}</td><td class="${item.present ? 'healthy' : 'paused'}">${item.present ? 'Configured' : 'Not set'}</td></tr>`)
        .join('');

    const healthyProviders = snapshot.providers.filter(p => !p.hasError && !p.isDisabled).length;

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Jarvis Dashboard</title>
    <style>
        body { background: #0a0a0a; color: #e0e0e0; font-family: Arial, sans-serif; margin: 0; padding: 20px; }
        h1 { color: #00ffff; text-align: center; }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; margin-bottom: 20px; }
        .card { background: rgba(0, 255, 255, 0.04); border: 1px solid rgba(0, 255, 255, 0.2); border-radius: 8px; padding: 16px; }
        .card h2 { margin-top: 0; color: #00ffff; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; background: rgba(255, 255, 255, 0.03); }
        th, td { padding: 10px; border-bottom: 1px solid rgba(255, 255, 255, 0.1); text-align: left; }
        th { background: rgba(0, 255, 255, 0.1); }
        .healthy { color: #00ff7f; } .error { color: #ff6b6b; } .paused { color: #ffd166; }
        .actions { margin-top: 20px; text-align: center; }
        .actions a { color: #00ffff; text-decoration: none; margin: 0 10px; }
    </style>
</head>
<body>
    <h1>Jarvis Operations Dashboard</h1>
    <div class="grid">
        <div class="card">
            <h2>System</h2>
            <p>Uptime: ${Math.round(snapshot.system.uptimeSeconds / 60)} minutes</p>
            <p>Node: ${snapshot.system.nodeVersion}</p>
            <p>Memory: ${Math.round(snapshot.system.memory.heapUsed / 1024 / 1024)}MB used</p>
            <p>Timestamp: ${snapshot.system.timestamp}</p>
        </div>
        <div class="card">
            <h2>Database</h2>
            <p>Status: ${snapshot.database.connected ? '<span class="healthy">Connected</span>' : '<span class="error">Disconnected</span>'}</p>
            <p>Ping: ${snapshot.database.ping}</p>
            ${snapshot.database.error ? `<p>Error: ${snapshot.database.error}</p>` : ''}
        </div>
        <div class="card">
            <h2>Providers</h2>
            <p>Total: ${snapshot.providers.length}</p>
            <p>Healthy: ${healthyProviders}</p>
            <p>Mode: free tiers prioritized</p>
        </div>
    </div>
    <h2>AI Providers</h2>
    <table>
        <thead><tr><th>#</th><th>Name</th><th>Model</th><th>Tier</th><th>Status</th><th>Uptime</th><th>Latency</th><th>Calls</th><th>Disabled Until</th></tr></thead>
        <tbody>${providerRows}</tbody>
    </table>
    <div class="grid">
        <div class="card"><h2>Required Environment</h2><table><tbody>${requiredRows}</tbody></table></div>
        <div class="card"><h2>Optional Environment</h2><table><tbody>${optionalRows}</tbody></table></div>
    </div>
    <div class="actions">
        <a href="/">Back to Status Page</a> •
        <a href="/health${deep ? '' : '?deep=1'}">JSON Health Check${deep ? '' : ' (deep)'}</a>
    </div>
</body>
</html>`;
}

module.exports = { createExpressApp, mount404Handler };

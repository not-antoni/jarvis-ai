'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const cookieParser = require('cookie-parser');
const compression = require('compression');
const appContext = require('../core/app-context');
const tempFiles = require('../utils/temp-files');
const { getPublicConfig } = require('../utils/public-config');
const { gatherHealthSnapshot } = require('../services/diagnostics');
const { getCloudflareIpRanges, getTrustedProxyRanges, isIpInRanges } = require('../utils/net-guard');
const {
    extractBearerToken,
    isRenderHealthCheck, isRenderHealthUserAgent
} = require('./health-helpers');
const {
    publicStatsLimiter,
    healthLimiter,
    webhookLimiter,
    siteLimiter
} = require('./rate-limiters');

const ROOT_DIR = path.join(__dirname, '..', '..');
const HEALTH_TOKEN = (process.env.HEALTH_TOKEN || '').trim() || null;
const PUBLIC_CONFIG = getPublicConfig();
const TRUSTED_PROXY_RANGES = getTrustedProxyRanges();
const CLOUDFLARE_IP_RANGES = getCloudflareIpRanges();
const TEMPLATE_404 = fs.readFileSync(path.join(__dirname, '404.html'), 'utf8');

function requireHealthToken(req, res, { allowRender = false } = {}) {
    if (!HEALTH_TOKEN) {return true;}
    if (allowRender && isRenderHealthCheck(req)) {return true;}
    if (extractBearerToken(req) === HEALTH_TOKEN) {return true;}
    res.status(401).json({ status: 'unauthorized', error: 'Valid bearer token required' });
    return false;
}

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
    app.set('trust proxy', ip => isIpInRanges(ip, TRUSTED_PROXY_RANGES));
    app.use(compression());

    // ---- Helmet ----
    // BIMI logo — must be publicly accessible before helmet locks headers down
    app.get('/assets/bimi.svg', (req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.type('image/svg+xml');
        res.sendFile(path.join(ROOT_DIR, 'assets', 'bimi.svg'));
    });

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
        const remoteAddr = (req.socket?.remoteAddress || '').replace('::ffff:', '');
        if (remoteAddr === '127.0.0.1' || remoteAddr === '::1') {
            return next();
        }
        if (!CLOUDFLARE_ONLY) {
            return next();
        }
        const fromTrustedProxy = isIpInRanges(remoteAddr, TRUSTED_PROXY_RANGES);
        const cfRay = req.headers['cf-ray'];
        const cfConnectingIp = req.headers['cf-connecting-ip'];
        let isFromCloudflare = false;
        if (fromTrustedProxy) {
            isFromCloudflare = !!(cfRay || cfConnectingIp);
        } else if (CLOUDFLARE_IP_RANGES.length) {
            isFromCloudflare = isIpInRanges(remoteAddr, CLOUDFLARE_IP_RANGES);
        }
        const hostHeader = String(req.headers.host || '').toLowerCase();
        const normalizedHost = normalizeHostValue(hostHeader);
        const isDirectIpAccess = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(normalizedHost);
        const isAwsDns = normalizedHost.includes('amazonaws.com') || normalizedHost.includes('compute-1.amazonaws.com');
        const isAllowedHost = Array.from(ALLOWED_HOSTS).some(
            host => normalizedHost === host || normalizedHost.endsWith(`.${host}`)
        );

        if ((isDirectIpAccess || isAwsDns) && !isFromCloudflare) {
            res.status(403).end();
            return;
        }
        if (!isFromCloudflare && !isAllowedHost && hostHeader) {
            res.status(403).end();
            return;
        }
        next();
    });

    // ---- Body parsers & cookie ----
    app.use(cookieParser());

    // ---- Baseline site-wide rate limit (before route-specific limiters) ----
    app.use(siteLimiter);

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
    app.use('/webhook', webhookLimiter, webhookRouter);

    const bodyLimit = process.env.JSON_BODY_LIMIT || '500kb';
    app.use(express.json({ limit: bodyLimit }));
    app.use(express.urlencoded({ extended: true, limit: bodyLimit }));

    // ---- Route mounts ----
    const pagesRouter = require('../../routes/pages');
    app.use('/', pagesRouter);

    // Portal (OAuth + dashboard). Needs app context for guild/handler access.
    const portalRouter = require('../../routes/portal');
    if (typeof portalRouter.setAppContext === 'function') {
        portalRouter.setAppContext(appContext);
    }
    app.use('/portal', portalRouter);

    // ---- Static files ----
    app.get('/favicon.ico', (req, res) => {
        res.type('image/webp');
        res.sendFile(path.join(ROOT_DIR, 'jarvis.webp'));
    });
    app.get('/jarvis.webp', (req, res) => {
        res.type('image/webp');
        res.sendFile(path.join(ROOT_DIR, 'jarvis.webp'));
    });
    app.use('/assets', express.static(path.join(ROOT_DIR, 'assets')));

    // ---- SEO ----
    app.get('/robots.txt', (req, res) => {
        const siteBaseUrl = PUBLIC_CONFIG.baseUrl;
        res.type('text/plain').send(`# Jarvis Discord Bot - ${siteBaseUrl}
User-agent: *
Allow: /
# Disallow private areas
Disallow: /api/

# Sitemap
Sitemap: ${siteBaseUrl}/sitemap.xml
`);
    });

    app.get('/sitemap.xml', (req, res) => {
        const baseUrl = PUBLIC_CONFIG.baseUrl;
        const pages = [
            { url: '/', priority: '1.0', changefreq: 'weekly' },
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
    app.get('/api/stats', publicStatsLimiter, async(req, res) => {
        try {
            const guildCount = appContext.getClient()?.guilds?.cache?.size || 0;
            const userCount = appContext.getClient()?.guilds?.cache?.reduce((acc, g) => acc + g.memberCount, 0) || 0;
            res.json({ guildCount, userCount, uptime: process.uptime() });
        } catch (e) {
            res.json({ guildCount: 0, userCount: 0, uptime: 0 });
        }
    });

    // Landing page
    const landingRouter = require('../../routes/landing');
    if (typeof landingRouter.setAppContext === 'function') {
        landingRouter.setAppContext(appContext);
    }
    app.use('/', landingRouter);

    // ---- Command metrics ----
    app.get('/metrics/commands', async(req, res) => {
        if (!requireHealthToken(req, res)) {return;}

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

    // ---- Health check endpoint ----
    app.get('/health', healthLimiter, async(req, res) => {
        if (!requireHealthToken(req, res, { allowRender: true })) {return;}

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

    return { app };
}

function mount404Handler(app) {
    app.use((req, res) => {
        const safePath = req.path.replace(/[&<>"']/g, c => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        })[c]);
        const discordInvite = PUBLIC_CONFIG.discordInviteUrl || '#';
        const siteBaseUrl = PUBLIC_CONFIG.baseUrl || '/';
        const gaMeasurementId = PUBLIC_CONFIG.gaMeasurementId || '';

        const gaBlock = gaMeasurementId ? `
    <!-- Google tag (gtag.js) -->
    <script async src="https://www.googletagmanager.com/gtag/js?id=${gaMeasurementId}"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', '${gaMeasurementId}');
    </script>` : '';

        const html = TEMPLATE_404
            .replace('{{GA_BLOCK}}', gaBlock)
            .replace(/\{\{DISCORD_INVITE\}\}/g, discordInvite)
            .replace(/\{\{SITE_BASE_URL\}\}/g, siteBaseUrl)
            .replace('{{SAFE_PATH}}', safePath);

        res.status(404).send(html);
    });
}

module.exports = { createExpressApp, mount404Handler };
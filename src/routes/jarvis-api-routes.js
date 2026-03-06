'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const config = require('../../config');
const aiManager = require('../services/ai-providers');
const { gatherHealthSnapshot } = require('../services/diagnostics');
const moderation = require('../services/GUILDS_FEATURES/moderation');
const moderationFilters = require('../services/moderation-filters');
const subscriptions = require('../services/monitor-subscriptions');
const dataSync = require('../services/data-sync');
const ytDlpManager = require('../services/yt-dlp-manager');
const selfhostFeatures = require('../services/selfhost-features');
const { musicManager } = require('../core/musicManager');
const musicGuildWhitelist = require('../utils/musicGuildWhitelist');
const commandRegistry = require('../core/command-registry');
const errorLogger = require('../services/error-logger');

let apiKeysService = null;
try {
    apiKeysService = require('../services/api-keys');
} catch (e) {
    // API keys service not available
}

// ============ LOG HELPERS ============

function listLogFiles() {
    const logsDir = path.join(__dirname, '..', '..', 'logs');
    if (!fs.existsSync(logsDir)) {
        return [];
    }

    const entries = fs.readdirSync(logsDir, { withFileTypes: true });
    return entries
        .filter(e => e.isFile())
        .map(e => {
            const p = path.join(logsDir, e.name);
            const st = fs.statSync(p);
            return { name: e.name, size: st.size, mtimeMs: st.mtimeMs };
        })
        .sort((a, b) => (b.mtimeMs || 0) - (a.mtimeMs || 0));
}

function tailLogFile(fileName, lineCount) {
    const logsDir = path.join(__dirname, '..', '..', 'logs');
    const safeName = String(fileName || '').trim();
    if (!safeName || safeName.includes('/') || safeName.includes('\\') || safeName.includes('..')) {
        throw new Error('Invalid file');
    }

    const filePath = path.join(logsDir, safeName);
    if (!filePath.startsWith(logsDir)) {
        throw new Error('Invalid file');
    }

    const st = fs.statSync(filePath);
    const maxBytes = 256 * 1024;
    const bytesToRead = Math.min(st.size, maxBytes);

    const fd = fs.openSync(filePath, 'r');
    try {
        const buf = Buffer.alloc(bytesToRead);
        fs.readSync(fd, buf, 0, bytesToRead, st.size - bytesToRead);
        const text = buf.toString('utf8');
        const lines = text.split(/\r?\n/);
        const keep = Math.max(1, Math.min(Number(lineCount) || 200, 2000));
        return lines.slice(-keep);
    } finally {
        fs.closeSync(fd);
    }
}

// ============ ROUTE MOUNTING ============

/**
 * Mount feature API routes, log routes, and admin routes on the router.
 * @param {express.Router} router
 * @param {Object} ctx - Shared utilities from the main jarvis.js module
 */
function mountFeatureRoutes(router, ctx) {
    const { requireOwner, rateLimit, requireCsrf, recordAuditEvent, saveJarvisSnapshot, getDiscordClient, getDiscordHandlers } = ctx;

    router.get('/api/config', requireOwner, (req, res) => {
        const snapshot = {
            deployment: config.deployment,
            ai: config.ai,
            features: config.features,
            commands: config.commands,
            sentience: config.sentience,
            youtube: { apiKeyConfigured: Boolean(config.youtube?.apiKey) },
            brave: { apiKeyConfigured: Boolean(config.brave?.apiKey) },
            crypto: { apiKeyConfigured: Boolean(config.crypto?.apiKey) },
            admin: { userId: config.admin?.userId },
            server: { port: config.server?.port }
        };

        const payload = { ok: true, config: snapshot };
        res.json(payload);
        saveJarvisSnapshot('config', payload).catch(err => {
            console.warn('[Jarvis] Failed to save config snapshot:', err?.message || err);
        });
    });

    router.get('/api/overview', requireOwner, async(req, res) => {
        const client = getDiscordClient();
        const handlers = getDiscordHandlers();

        const discord = {
            ready: false,
            tag: null,
            guilds: 0,
            users: 0,
            channels: 0
        };

        if (client && typeof client.isReady === 'function' && client.isReady()) {
            discord.ready = true;
            discord.tag = client.user?.tag || null;
            discord.guilds = client.guilds?.cache?.size || 0;
            discord.channels = client.channels?.cache?.size || 0;
            try {
                discord.users = client.guilds.cache.reduce((acc, g) => acc + (g.memberCount || 0), 0);
            } catch {
                discord.users = 0;
            }
        }

        let providerStatus = [];
        let providerHealth = null;
        let selectionMode = 'unknown';
        let providerType = 'unknown';

        try {
            providerStatus = aiManager.getProviderStatus();
            providerHealth = aiManager.getHealthSummary();
            selectionMode = aiManager.getSelectionMode();
            providerType = aiManager.getProviderType();
        } catch {
            providerStatus = [];
            providerHealth = null;
        }

        let healthSnapshot = null;
        try {
            healthSnapshot = await gatherHealthSnapshot({ includeProviders: false, pingDatabase: false });
        } catch {
            healthSnapshot = null;
        }

        let agentSummary = {
            ok: false,
            health: null,
            circuit: null,
            activeSessions: 0,
            healthLabel: 'unavailable'
        };

        try {
            const metrics = handlers?.browserAgent?.getMetrics?.() || null;
            const report = handlers?.agentMonitor?.getHealthReport?.(handlers?.browserAgent) || null;
            if (metrics && report) {
                const score = report.overallHealth;
                agentSummary = {
                    ok: true,
                    health: score,
                    circuit: metrics.circuitBreakerStatus || null,
                    activeSessions: metrics.activeSessions || 0,
                    healthLabel: score >= 75 ? 'ok' : score >= 50 ? 'warning' : 'critical'
                };
            }
        } catch {
            // agentSummary stays as-is on failure
        }

        let subsCount = 0;
        try {
            const all = await subscriptions.get_all_subscriptions().catch(() => []);
            subsCount = Array.isArray(all) ? all.length : 0;
        } catch {
            subsCount = 0;
        }

        let syncStatus = null;
        try {
            syncStatus = typeof dataSync.getSyncStatus === 'function' ? dataSync.getSyncStatus() : null;
        } catch {
            syncStatus = null;
        }

        let ytdlp = null;
        try {
            ytdlp = ytDlpManager?.getStatus?.() || null;
        } catch {
            ytdlp = null;
        }

        const logsDir = path.join(__dirname, '..', '..', 'logs');
        let logFiles = [];
        try {
            if (fs.existsSync(logsDir)) {
                const entries = fs.readdirSync(logsDir, { withFileTypes: true });
                logFiles = entries
                    .filter(e => e.isFile())
                    .slice(0, 50)
                    .map(e => {
                        const p = path.join(logsDir, e.name);
                        const st = fs.statSync(p);
                        return { name: e.name, size: st.size, mtimeMs: st.mtimeMs };
                    })
                    .sort((a, b) => (b.mtimeMs || 0) - (a.mtimeMs || 0));
            }
        } catch {
            logFiles = [];
        }

        const payload = {
            ok: true,
            overview: {
                system: {
                    now: Date.now(),
                    uptimeMs: process.uptime() * 1000,
                    nodeVersion: process.version,
                    platform: process.platform,
                    memory: {
                        rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
                        heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
                    }
                },
                discord,
                database: healthSnapshot?.database || { connected: null, ping: 'unknown' },
                providers: {
                    total: providerStatus.length,
                    active: providerStatus.filter(p => !p.isDisabled).length,
                    selectionMode,
                    providerType,
                    health: providerHealth
                },
                agent: agentSummary,
                monitoring: { subscriptions: subsCount },
                music: { activeQueues: musicManager?.getActiveGuildIds?.()?.length || 0 },
                sync: syncStatus,
                ytdlp,
                logs: { files: logFiles.length },
                commands: { defined: Array.isArray(commandRegistry?.commandDefinitions) ? commandRegistry.commandDefinitions.length : 0 },
                errorLogger: {
                    pendingQueue: Array.isArray(errorLogger?.pendingQueue) ? errorLogger.pendingQueue.length : null
                },
                soul: { enabled: Boolean(selfhostFeatures?.jarvisSoul), mood: selfhostFeatures?.jarvisSoul?.mood || null }
            }
        };

        res.json(payload);
        saveJarvisSnapshot('overview', payload).catch(err => {
            console.warn('[Jarvis] Failed to save overview snapshot:', err?.message || err);
        });
    });

    router.get('/api/providers', requireOwner, (req, res) => {
        const availableProviderTypes = [
            'auto',
            'openai',
            'groq',
            'openrouter',
            'google',
            'deepseek',
            'ollama'
        ];

        let providers = [];
        let health = null;
        let selectionMode = 'unknown';
        let providerType = 'unknown';

        try {
            providers = aiManager.getProviderStatus();
            health = aiManager.getHealthSummary();
            selectionMode = aiManager.getSelectionMode();
            providerType = aiManager.getProviderType();
        } catch {
            providers = [];
            health = null;
        }

        const payload = {
            ok: true,
            selectionMode,
            providerType,
            availableProviderTypes,
            health,
            providers,
            count: providers.length,
            active: providers.filter(p => !p.isDisabled).length
        };

        res.json(payload);
        saveJarvisSnapshot('providers', payload).catch(err => {
            console.warn('[Jarvis] Failed to save providers snapshot:', err?.message || err);
        });
    });

    router.post(
        '/api/providers/selection-mode',
        requireOwner,
        rateLimit({ keyPrefix: 'jarvis:providers', max: 60, windowMs: 60 * 1000 }),
        requireCsrf,
        (req, res) => {
            const mode = String(req.body?.mode || '').toLowerCase();
            if (mode !== 'random' && mode !== 'ranked') {
                return res.status(400).json({ ok: false, error: 'invalid_mode' });
            }

            try {
                aiManager.setRandomSelection(mode === 'random');
                recordAuditEvent(req, 'providers.selectionMode', { mode });
                return res.json({ ok: true, selectionMode: aiManager.getSelectionMode() });
            } catch (e) {
                return res.status(500).json({ ok: false, error: e?.message || 'failed' });
            }
        }
    );

    router.post(
        '/api/providers/type',
        requireOwner,
        rateLimit({ keyPrefix: 'jarvis:providers', max: 60, windowMs: 60 * 1000 }),
        requireCsrf,
        (req, res) => {
            const type = String(req.body?.type || '').toLowerCase();
            try {
                aiManager.setProviderType(type);
                recordAuditEvent(req, 'providers.type', { type });
                return res.json({ ok: true, providerType: aiManager.getProviderType() });
            } catch (e) {
                return res.status(400).json({ ok: false, error: e?.message || 'invalid_type' });
            }
        }
    );

    router.get('/api/agent/health', requireOwner, (req, res) => {
        const handlers = getDiscordHandlers();
        const browserAgent = handlers?.browserAgent;
        const agentMonitor = handlers?.agentMonitor;

        if (!browserAgent?.getMetrics || !agentMonitor?.getHealthReport) {
            return res.json({ ok: false, error: 'not_initialized' });
        }

        try {
            const metrics = browserAgent.getMetrics();
            const health = agentMonitor.getHealthReport(browserAgent);
            const payload = { ok: true, metrics, health };
            res.json(payload);
            saveJarvisSnapshot('agent.health', payload).catch(err => {
                console.warn('[Jarvis] Failed to save agent health snapshot:', err?.message || err);
            });
            
        } catch (e) {
            return res.status(500).json({ ok: false, error: e?.message || 'failed' });
        }
    });

    router.get('/api/moderation', requireOwner, (req, res) => {
        const client = getDiscordClient();
        if (!client || typeof client.isReady !== 'function' || !client.isReady()) {
            return res.json({ ok: true, ready: false, guilds: [] });
        }

        const ids = Array.from(client.guilds.cache.keys());
        const limit = Math.min(Number(req.query.limit || 50), 200);
        const page = Math.max(Number(req.query.page || 1), 1);
        const start = (page - 1) * limit;
        const slice = ids.slice(start, start + limit);

        const rows = slice.map(guildId => {
            const g = client.guilds.cache.get(guildId);
            let status = null;
            try {
                status = moderation.getStatus(guildId);
            } catch {
                status = null;
            }
            return {
                guildId,
                guildName: g?.name || null,
                status
            };
        });

        const payload = { ok: true, ready: true, page, limit, total: ids.length, guilds: rows };
        res.json(payload);
        saveJarvisSnapshot(`moderation.page.${page}`, payload).catch(err => {
            console.warn(`[Jarvis] Failed to save moderation page ${page} snapshot:`, err?.message || err);
        });
    });

    router.get('/api/filters', requireOwner, async(req, res) => {
        const client = getDiscordClient();
        if (!client || typeof client.isReady !== 'function' || !client.isReady()) {
            return res.json({ ok: true, ready: false, guilds: [] });
        }

        const guildIdParam = req.query.guildId ? String(req.query.guildId) : null;
        const ids = guildIdParam ? [guildIdParam] : Array.from(client.guilds.cache.keys());
        const limit = Math.min(Number(req.query.limit || 25), 100);
        const page = Math.max(Number(req.query.page || 1), 1);
        const start = (page - 1) * limit;
        const slice = guildIdParam ? ids : ids.slice(start, start + limit);

        const guilds = [];
        for (const guildId of slice) {
            const g = client.guilds.cache.get(guildId);
            let filters = null;
            try {
                filters = await moderationFilters.getFilters(guildId);
                if (filters) {
                    filters = {
                        words: filters.words || [],
                        regexPatterns: filters.regexPatterns || [],
                        autoRegexEnabled: Boolean(filters.autoRegexEnabled),
                        cachedAt: filters.cachedAt || null
                    };
                }
            } catch {
                filters = null;
            }
            guilds.push({ guildId, guildName: g?.name || null, filters });
        }

        const payload = { ok: true, ready: true, page, limit, total: ids.length, guilds };
        res.json(payload);
        saveJarvisSnapshot(`filters.page.${page}`, payload).catch(err => {
            console.warn(`[Jarvis] Failed to save filters page ${page} snapshot:`, err?.message || err);
        });
    });

    router.get('/api/monitoring/subscriptions', requireOwner, async(req, res) => {
        try {
            const all = await subscriptions.get_all_subscriptions().catch(() => []);
            const subs = Array.isArray(all) ? all : [];
            const byType = subs.reduce((acc, s) => {
                const t = String(s?.monitor_type || 'unknown');
                acc[t] = (acc[t] || 0) + 1;
                return acc;
            }, {});
            const payload = { ok: true, count: subs.length, byType, subscriptions: subs };
            res.json(payload);
            saveJarvisSnapshot('monitoring.subscriptions', payload).catch(err => {
                console.warn('[Jarvis] Failed to save monitoring subscriptions snapshot:', err?.message || err);
            });
        } catch (e) {
            res.status(500).json({ ok: false, error: e?.message || 'failed' });
        }
    });

    router.get('/api/music', requireOwner, (req, res) => {
        const whitelist = musicGuildWhitelist.getWhitelistedGuilds();
        const activeGuilds = typeof musicManager.get().getActiveGuildIds === 'function' ? musicManager.get().getActiveGuildIds() : [];
        const activeQueues = activeGuilds.map(gid => musicManager.get().getQueueSnapshot(gid));

        const payload = { ok: true, whitelist, activeGuilds, activeQueues };
        res.json(payload);
        saveJarvisSnapshot('music', payload).catch(err => {
            console.warn('[Jarvis] Failed to save music snapshot:', err?.message || err);
        });
    });

    router.get('/api/economy', requireOwner, (_req, res) => {
        res.json({ ok: true, removed: true, message: 'Economy system has been removed.' });
    });

    router.get('/api/soul', requireOwner, (req, res) => {
        let soul = null;
        try {
            soul = selfhostFeatures?.jarvisSoul?.getStatus?.() || null;
        } catch {
            soul = null;
        }

        const payload = {
            ok: true,
            sentience: config.sentience || null,
            soul
        };

        res.json(payload);
        saveJarvisSnapshot('soul', payload).catch(err => {
            console.warn('[Jarvis] Failed to save soul snapshot:', err?.message || err);
        });
    });

    router.get('/api/sync', requireOwner, (req, res) => {
        try {
            const status = typeof dataSync.getSyncStatus === 'function' ? dataSync.getSyncStatus() : null;
            const payload = { ok: true, status };
            res.json(payload);
            saveJarvisSnapshot('sync', payload).catch(err => {
                console.warn('[Jarvis] Failed to save sync snapshot:', err?.message || err);
            });
        } catch (e) {
            res.status(500).json({ ok: false, error: e?.message || 'failed' });
        }
    });

    router.get('/api/ytdlp', requireOwner, (req, res) => {
        try {
            const payload = { ok: true, status: ytDlpManager?.getStatus?.() || null };
            res.json(payload);
            saveJarvisSnapshot('ytdlp', payload).catch(() => null);
        } catch (e) {
            res.status(500).json({ ok: false, error: e?.message || 'failed' });
        }
    });

    router.get('/api/commands/catalog', requireOwner, (req, res) => {
        try {
            const catalog =
                typeof commandRegistry.buildHelpCatalog === 'function'
                    ? commandRegistry.buildHelpCatalog()
                    : [];
            const payload = {
                ok: true,
                catalog,
                definitions: commandRegistry.commandDefinitions || [],
                ephemeral: Array.from(commandRegistry.SLASH_EPHEMERAL_COMMANDS || [])
            };

            res.json(payload);
            saveJarvisSnapshot('commands.catalog', payload).catch(() => null);
        } catch (e) {
            res.status(500).json({ ok: false, error: e?.message || 'failed' });
        }
    });

    // ============ LOG ROUTES ============

    router.get('/api/logs/files', requireOwner, (req, res) => {
        try {
            const files = listLogFiles();
            res.json({ ok: true, count: files.length, files });
        } catch (e) {
            res.status(500).json({ ok: false, error: e?.message || 'failed' });
        }
    });

    router.get(
        '/api/logs/tail',
        requireOwner,
        rateLimit({ keyPrefix: 'jarvis:logs', max: 120, windowMs: 60 * 1000 }),
        (req, res) => {
            const file = req.query.file ? String(req.query.file) : '';
            const lines = Math.min(Number(req.query.lines || 200), 2000);
            try {
                const out = tailLogFile(file, lines);
                res.json({ ok: true, file, lines: out.length, data: out.join('\n') });
            } catch (e) {
                res.status(400).json({ ok: false, error: e?.message || 'failed' });
            }
        }
    );

    router.get(
        '/api/logs/stream',
        requireOwner,
        rateLimit({ keyPrefix: 'jarvis:logs_stream', max: 30, windowMs: 60 * 1000 }),
        (req, res) => {
            const logsDir = path.join(__dirname, '..', '..', 'logs');
            const safeName = String(req.query.file || '').trim();
            if (!safeName || safeName.includes('/') || safeName.includes('\\') || safeName.includes('..')) {
                return res.status(400).json({ ok: false, error: 'invalid_file' });
            }

            const filePath = path.join(logsDir, safeName);
            if (!filePath.startsWith(logsDir)) {
                return res.status(400).json({ ok: false, error: 'invalid_file' });
            }

            res.status(200);
            res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
            res.setHeader('Cache-Control', 'no-cache, no-transform');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('X-Accel-Buffering', 'no');
            if (typeof res.flushHeaders === 'function') {
                res.flushHeaders();
            }

            function sendEvent(event, payload) {
                try {
                    res.write(`event: ${event}\n`);
                    res.write(`data: ${JSON.stringify(payload)}\n\n`);
                } catch {
                }
            }

            let lastSize = 0;
            try {
                const initLines = tailLogFile(safeName, 200);
                sendEvent('chunk', { type: 'init', file: safeName, data: initLines.join('\n') });
                const st = fs.statSync(filePath);
                lastSize = st.size;
            } catch (e) {
                sendEvent('error', { ok: false, error: e?.message || 'failed' });
            }

            const maxChunkBytes = 64 * 1024;
            const pollMs = 1000;

            const interval = setInterval(() => {
                try {
                    const st = fs.statSync(filePath);
                    if (st.size < lastSize) {
                        lastSize = 0;
                        sendEvent('chunk', { type: 'rotated', file: safeName, data: '' });
                    }
                    if (st.size === lastSize) {
                        res.write(`: ping ${Date.now()}\n\n`);
                        return;
                    }

                    const toRead = Math.min(st.size - lastSize, maxChunkBytes);
                    if (toRead <= 0) {return;}

                    const fd = fs.openSync(filePath, 'r');
                    try {
                        const buf = Buffer.alloc(toRead);
                        fs.readSync(fd, buf, 0, toRead, lastSize);
                        lastSize += toRead;
                        const text = buf.toString('utf8');
                        if (text) {
                            sendEvent('chunk', { type: 'append', file: safeName, data: text });
                        }
                    } finally {
                        fs.closeSync(fd);
                    }
                } catch (e) {
                    sendEvent('error', { ok: false, error: e?.message || 'failed' });
                }
            }, pollMs);

            req.on('close', () => {
                clearInterval(interval);
            });
        }
    );

    // ============ ADMIN API ROUTES ============

    router.get('/api/admin/api-usage', requireOwner, async(req, res) => {
        if (!apiKeysService) {
            return res.json({ ok: false, error: 'API keys service not available' });
        }

        try {
            const days = Math.min(Number(req.query.days || 7), 30);
            const stats = await apiKeysService.getUsageStats({ days, limit: 100 });

            res.json({
                ok: true,
                ...stats
            });
        } catch (e) {
            res.status(500).json({ ok: false, error: e?.message || 'failed' });
        }
    });

    router.get('/api/admin/api-keys', requireOwner, async(req, res) => {
        if (!apiKeysService) {
            return res.json({ ok: false, error: 'API keys service not available' });
        }

        try {
            const keys = await apiKeysService.getAllKeys();
            res.json({
                ok: true,
                totalUsers: keys.length,
                totalKeys: keys.reduce((sum, u) => sum + u.keyCount, 0),
                users: keys
            });
        } catch (e) {
            res.status(500).json({ ok: false, error: e?.message || 'failed' });
        }
    });

    router.post('/api/admin/api-keys/:userId/:keyId/disable', requireOwner, async(req, res) => {
        if (!apiKeysService) {
            return res.json({ ok: false, error: 'API keys service not available' });
        }

        try {
            const success = await apiKeysService.disableKey(req.params.userId, req.params.keyId);
            logAudit('api_key_disabled', { userId: req.params.userId, keyId: req.params.keyId });
            res.json({ ok: success });
        } catch (e) {
            res.status(500).json({ ok: false, error: e?.message || 'failed' });
        }
    });

    router.post('/api/admin/api-keys/:userId/:keyId/enable', requireOwner, async(req, res) => {
        if (!apiKeysService) {
            return res.json({ ok: false, error: 'API keys service not available' });
        }

        try {
            const success = await apiKeysService.enableKey(req.params.userId, req.params.keyId);
            logAudit('api_key_enabled', { userId: req.params.userId, keyId: req.params.keyId });
            res.json({ ok: success });
        } catch (e) {
            res.status(500).json({ ok: false, error: e?.message || 'failed' });
        }
    });

    router.get('/api/admin/ip-lookup/:ip', requireOwner, async(req, res) => {
        if (!apiKeysService) {
            return res.json({ ok: false, error: 'API keys service not available' });
        }

        try {
            const ipInfo = await apiKeysService.getIpInfo(req.params.ip);
            res.json({ ok: true, ip: req.params.ip, ...ipInfo });
        } catch (e) {
            res.status(500).json({ ok: false, error: e?.message || 'failed' });
        }
    });
}

module.exports = { mountFeatureRoutes };

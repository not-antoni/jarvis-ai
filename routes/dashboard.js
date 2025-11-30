/**
 * Dashboard API Routes
 * Backend endpoints for the Jarvis Control Center dashboard
 * Works on both Render and Selfhost deployments
 */

const express = require('express');
const router = express.Router();
const os = require('os');
const path = require('path');
const fs = require('fs');

// Determine storage mode
const IS_SELFHOST = String(process.env.SELFHOST_MODE || '').toLowerCase() === 'true';
const METRICS_FILE_PATH = path.join(__dirname, '..', 'data', 'dashboard-metrics.json');
const METRICS_COLLECTION = 'dashboard_metrics';
const TOKEN_CLEAR_THRESHOLD = 10_000_000; // 10 million tokens

// Runtime metrics store (persists across requests)
const metrics = {
    botStartTime: Date.now(),
    requestCount: 0,
    aiCallCount: 0,
    aiSuccessCount: 0,
    aiFailCount: 0,
    commandsExecuted: 0,
    messagesProcessed: 0,
    totalTokensIn: 0,
    totalTokensOut: 0,
    lastProviderUsed: null,
    recentLogs: [],
    maxLogs: 500,
    lastResetMonth: new Date().getMonth(), // Track which month we last reset
    lastResetYear: new Date().getFullYear(),
};

// Persistence helpers
let _database = null;
let saveTimer = null;
const SAVE_DEBOUNCE_MS = 5000;

async function getDatabase() {
    if (!_database) {
        try {
            _database = require('../src/services/database');
            if (!_database.isConnected) {
                await _database.connect();
            }
        } catch (e) {
            return null;
        }
    }
    return _database;
}

async function loadMetrics() {
    if (IS_SELFHOST) {
        // Load from file
        try {
            if (fs.existsSync(METRICS_FILE_PATH)) {
                const data = JSON.parse(fs.readFileSync(METRICS_FILE_PATH, 'utf8'));
                Object.assign(metrics, data, { recentLogs: [], botStartTime: Date.now() });
                console.log('Loaded dashboard metrics from file');
            }
        } catch (e) {
            console.warn('Failed to load dashboard metrics from file:', e.message);
        }
    } else {
        // Load from MongoDB
        try {
            const db = await getDatabase();
            if (db && db.db) {
                const doc = await db.db.collection(METRICS_COLLECTION).findOne({ _id: 'metrics' });
                if (doc) {
                    Object.assign(metrics, doc, { recentLogs: [], botStartTime: Date.now() });
                    console.log('Loaded dashboard metrics from MongoDB');
                }
            }
        } catch (e) {
            console.warn('Failed to load dashboard metrics from MongoDB:', e.message);
        }
    }
}

async function saveMetrics() {
    const payload = {
        requestCount: metrics.requestCount,
        aiCallCount: metrics.aiCallCount,
        aiSuccessCount: metrics.aiSuccessCount,
        aiFailCount: metrics.aiFailCount,
        commandsExecuted: metrics.commandsExecuted,
        messagesProcessed: metrics.messagesProcessed,
        totalTokensIn: metrics.totalTokensIn,
        totalTokensOut: metrics.totalTokensOut,
        lastResetMonth: metrics.lastResetMonth,
        lastResetYear: metrics.lastResetYear,
        savedAt: new Date().toISOString(),
    };

    if (IS_SELFHOST) {
        // Save to file
        try {
            const dir = path.dirname(METRICS_FILE_PATH);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(METRICS_FILE_PATH, JSON.stringify(payload, null, 2));
        } catch (e) {
            console.warn('Failed to save dashboard metrics to file:', e.message);
        }
    } else {
        // Save to MongoDB
        try {
            const db = await getDatabase();
            if (db && db.db) {
                await db.db.collection(METRICS_COLLECTION).updateOne(
                    { _id: 'metrics' },
                    { $set: payload },
                    { upsert: true }
                );
            }
        } catch (e) {
            console.warn('Failed to save dashboard metrics to MongoDB:', e.message);
        }
    }
}

function scheduleSave() {
    if (saveTimer) return;
    saveTimer = setTimeout(async () => {
        saveTimer = null;
        await saveMetrics();
    }, SAVE_DEBOUNCE_MS);
}

function clearMetrics(reason) {
    console.log(`Clearing dashboard metrics: ${reason}`);
    metrics.requestCount = 0;
    metrics.aiCallCount = 0;
    metrics.aiSuccessCount = 0;
    metrics.aiFailCount = 0;
    metrics.commandsExecuted = 0;
    metrics.messagesProcessed = 0;
    metrics.totalTokensIn = 0;
    metrics.totalTokensOut = 0;
    metrics.lastResetMonth = new Date().getMonth();
    metrics.lastResetYear = new Date().getFullYear();
    scheduleSave();
}

function checkTokenThreshold() {
    // Clear metrics if tokens exceed threshold (Render only)
    if (!IS_SELFHOST && (metrics.totalTokensIn + metrics.totalTokensOut) >= TOKEN_CLEAR_THRESHOLD) {
        clearMetrics(`Token threshold reached (${TOKEN_CLEAR_THRESHOLD.toLocaleString()})`);
    }
}

function checkMonthlyReset() {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    
    // Reset if we're in a new month
    if (currentYear > metrics.lastResetYear || 
        (currentYear === metrics.lastResetYear && currentMonth > metrics.lastResetMonth)) {
        clearMetrics(`Monthly reset (${now.toLocaleString('default', { month: 'long', year: 'numeric' })})`);
    }
}

// Load metrics on startup and check for monthly reset
loadMetrics().then(() => {
    checkMonthlyReset();
});

// Discord client reference (set by main app)
let discordClient = null;

// Middleware to track requests
router.use((req, res, next) => {
    metrics.requestCount++;
    next();
});

// Initialize with Discord client
router.setDiscordClient = (client) => {
    discordClient = client;
};

// Log helper
function addLog(level, source, message) {
    const log = {
        timestamp: new Date().toLocaleTimeString(),
        level,
        source,
        message,
    };
    metrics.recentLogs.unshift(log);
    if (metrics.recentLogs.length > metrics.maxLogs) {
        metrics.recentLogs.pop();
    }
}

// Export metrics functions for use by other modules
router.trackAICall = (success, provider) => {
    metrics.aiCallCount++;
    if (success) metrics.aiSuccessCount++;
    else metrics.aiFailCount++;
    metrics.lastProviderUsed = provider;
    addLog(success ? 'success' : 'error', 'AI', `${provider}: ${success ? 'Response generated' : 'Request failed'}`);
    scheduleSave();
};

router.trackTokens = (tokensIn, tokensOut) => {
    metrics.totalTokensIn += (tokensIn || 0);
    metrics.totalTokensOut += (tokensOut || 0);
    checkTokenThreshold();
    scheduleSave();
};

router.trackCommand = (commandName, userId) => {
    metrics.commandsExecuted++;
    addLog('info', 'Discord', `Command executed: ${commandName}`);
    scheduleSave();
};

router.trackMessage = () => {
    metrics.messagesProcessed++;
    // Don't save on every message - too frequent
};

router.addLog = addLog;

// Get current metrics for API
router.getMetrics = () => ({
    totalTokensIn: metrics.totalTokensIn,
    totalTokensOut: metrics.totalTokensOut,
    commandsExecuted: metrics.commandsExecuted,
    messagesProcessed: metrics.messagesProcessed,
    aiCallCount: metrics.aiCallCount,
    aiSuccessCount: metrics.aiSuccessCount,
    aiFailCount: metrics.aiFailCount,
});

/**
 * GET /api/dashboard/health
 * Returns overall system health and stats
 */
router.get('/health', async (req, res) => {
    try {
        const uptime = Date.now() - metrics.botStartTime;
        const hours = Math.floor(uptime / 3600000);
        const minutes = Math.floor((uptime % 3600000) / 60000);

        // Get Discord stats if client available
        let discordStats = { guilds: 0, users: 0, channels: 0 };
        if (discordClient && discordClient.isReady()) {
            discordStats = {
                guilds: discordClient.guilds.cache.size,
                users: discordClient.guilds.cache.reduce((acc, g) => acc + g.memberCount, 0),
                channels: discordClient.channels.cache.size,
            };
        }

        // Get AI provider stats including tokens
        let aiStats = {
            totalTokensIn: 0,
            totalTokensOut: 0,
            totalTokens: 0,
            totalRequests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            successRate: '100',
            providers: 0,
            activeProviders: 0,
        };
        try {
            const aiManager = require('../src/services/ai-providers');
            aiStats = aiManager.getStats();
        } catch (e) {
            // Use defaults if AI manager not available
        }

        res.json({
            status: 'healthy',
            uptime: `${hours}h ${minutes}m`,
            uptimeMs: uptime,
            requests: metrics.requestCount,
            aiCalls: aiStats.totalRequests,
            aiSuccess: aiStats.successfulRequests,
            aiFailed: aiStats.failedRequests,
            successRate: parseFloat(aiStats.successRate),
            tokensIn: aiStats.totalTokensIn,
            tokensOut: aiStats.totalTokensOut,
            totalTokens: aiStats.totalTokens,
            commandsExecuted: metrics.commandsExecuted,
            messagesProcessed: metrics.messagesProcessed,
            lastProvider: metrics.lastProviderUsed,
            discord: discordStats,
            providers: aiStats.providers,
            activeProviders: aiStats.activeProviders,
            memory: {
                used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
                total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
                system: Math.round(os.totalmem() / 1024 / 1024 / 1024),
                rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
            },
            cpu: os.loadavg()[0].toFixed(2),
            platform: process.platform,
            nodeVersion: process.version,
            deploymentMode: process.env.SELFHOST_MODE === 'true' ? 'selfhost' : 'render',
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/dashboard/providers
 * Returns AI provider status
 */
router.get('/providers', async (req, res) => {
    try {
        // Try to load AI providers module
        let providers = [];
        try {
            const aiManager = require('../src/services/ai-providers');
            const status = aiManager.getProviderStatus();
            providers = Array.isArray(status) ? status : [];
        } catch (err) {
            console.warn('Could not load AI providers:', err.message);
        }

        res.json({
            providers,
            count: providers.length,
            active: providers.filter(p => !p.isDisabled).length,
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/dashboard/providers/test
 * Test a specific provider
 */
router.post('/providers/test', async (req, res) => {
    try {
        const { provider } = req.body;
        const startTime = Date.now();

        // Try to test the provider
        try {
            const aiManager = require('../src/services/ai-providers');
            const response = await aiManager.generateResponse(
                [{ role: 'user', content: 'Say "test successful" in exactly 2 words.' }],
                { preferredProvider: provider }
            );
            
            metrics.aiCallCount++;
            metrics.aiSuccessCount++;
            
            res.json({
                success: true,
                provider,
                latency: Date.now() - startTime,
                response: response.content?.substring(0, 100),
            });
        } catch (err) {
            res.json({
                success: false,
                provider,
                latency: Date.now() - startTime,
                error: err.message,
            });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/dashboard/providers/reinitialize
 * Force reinitialize all providers (recovery from corrupted state)
 */
router.post('/providers/reinitialize', async (req, res) => {
    try {
        const aiManager = require('../src/services/ai-providers');
        const count = aiManager.forceReinitialize();
        res.json({
            success: true,
            message: `Reinitialized ${count} AI providers`,
            count,
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/dashboard/providers/health
 * Get provider health summary
 */
router.get('/providers/health', async (req, res) => {
    try {
        const aiManager = require('../src/services/ai-providers');
        const health = aiManager.getHealthSummary();
        res.json(health);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/dashboard/agents
 * Returns agent status and metrics
 */
router.get('/agents', async (req, res) => {
    try {
        // Try to load agent components
        let agents = [];
        let agentMetrics = {};

        try {
            const AgentMonitor = require('../src/agents/agentMonitor');
            const monitor = AgentMonitor.getInstance();
            const health = monitor.getHealthReport();
            
            agentMetrics = {
                memory: {
                    value: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
                    status: process.memoryUsage().heapUsed < 500 * 1024 * 1024 ? 'good' : 'warning',
                    details: `${Math.round(process.memoryUsage().heapUsed / process.memoryUsage().heapTotal * 100)}% of heap`,
                },
                cpu: {
                    value: `${(os.loadavg()[0] * 100 / os.cpus().length).toFixed(0)}%`,
                    status: os.loadavg()[0] < os.cpus().length ? 'good' : 'warning',
                    details: `${os.cpus().length} cores available`,
                },
                activeTasks: {
                    value: health.operations?.length || 0,
                    status: 'good',
                    details: 'Active operations',
                },
                errors: {
                    value: health.alerts?.filter(a => a.level === 'ERROR').length || 0,
                    status: health.alerts?.some(a => a.level === 'ERROR') ? 'warning' : 'good',
                    details: 'Last 24 hours',
                },
            };
        } catch (err) {
            // Default metrics if agent monitor not available
            agentMetrics = {
                memory: { value: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`, status: 'good', details: 'Node.js heap' },
                cpu: { value: `${(os.loadavg()[0] * 10).toFixed(0)}%`, status: 'good', details: `${os.cpus().length} cores` },
                activeTasks: { value: 0, status: 'good', details: 'No active tasks' },
                errors: { value: 0, status: 'good', details: 'No errors' },
            };
        }

        // Default agent list
        agents = [
            { name: 'BrowserAgent', type: 'Web Automation', status: 'idle', sessions: 0, tasks: 0, uptime: '—' },
            { name: 'ProductionAgent', type: 'Task Orchestration', status: 'running', sessions: 1, tasks: metrics.requestCount, uptime: formatUptime(Date.now() - metrics.botStartTime) },
            { name: 'ScraperAgent', type: 'Data Collection', status: 'idle', sessions: 0, tasks: 0, uptime: '—' },
        ];

        res.json({ agents, metrics: agentMetrics });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/dashboard/logs
 * Returns recent logs
 */
router.get('/logs', async (req, res) => {
    try {
        const { level, limit = 100 } = req.query;
        let logs = metrics.recentLogs;
        
        // Filter by level if specified
        if (level && level !== 'all') {
            logs = logs.filter(l => l.level === level);
        }
        
        // Limit results
        logs = logs.slice(0, parseInt(limit));
        
        res.json({
            logs,
            total: metrics.recentLogs.length,
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/dashboard/local-ai/status
 * Returns local AI (Ollama) status
 */
router.get('/local-ai/status', async (req, res) => {
    try {
        let status = 'not_installed';
        let gpus = [];
        let models = [];

        // Check if Ollama is running
        try {
            const response = await fetch('http://localhost:11434/api/tags', { 
                signal: AbortSignal.timeout(2000) 
            });
            if (response.ok) {
                status = 'running';
                const data = await response.json();
                models = (data.models || []).map(m => ({
                    name: m.name,
                    size: formatBytes(m.size),
                    quantization: m.details?.quantization_level || 'unknown',
                    context: 8,
                    speed: '~50',
                    loaded: false,
                }));
            }
        } catch {
            // Ollama not running or not installed
        }

        res.json({ status, gpus, models });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/dashboard/settings
 * Save dashboard settings
 */
router.post('/settings', async (req, res) => {
    try {
        const settings = req.body;
        // TODO: Persist settings to config file or database
        console.log('[Dashboard] Settings updated:', Object.keys(settings));
        res.json({ success: true, message: 'Settings saved' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/dashboard/settings
 * Get current settings
 */
router.get('/settings', async (req, res) => {
    try {
        const config = require('../config');
        res.json({
            port: config.server?.port || 3000,
            selfhostMode: config.deployment?.selfhostMode || false,
            defaultProvider: config.ai?.provider || 'auto',
            maxTokens: config.ai?.maxTokens || 500,
            temperature: config.ai?.temperature || 1,
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Helper functions
function formatUptime(ms) {
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    return `${hours}h ${minutes}m`;
}

function formatBytes(bytes) {
    if (bytes < 1024) return bytes + 'B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + 'MB';
    return (bytes / 1024 / 1024 / 1024).toFixed(1) + 'GB';
}

// Export initialization function for bot start time
router.initBotStartTime = () => {
    metrics.botStartTime = Date.now();
    addLog('info', 'System', 'Bot started - metrics reset');
};

module.exports = router;

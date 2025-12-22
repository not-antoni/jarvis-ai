/**
 * Render Deployment Environment Check
 * 
 * Run at startup to validate Render configuration.
 * Similar to selfhost-check.js but for Render deployments.
 */

const path = require('path');

// ANSI colors
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    magenta: '\x1b[35m'
};

/**
 * Check if running on Render
 */
function isRenderEnvironment() {
    return !!(process.env.RENDER || process.env.RENDER_SERVICE_ID || process.env.RENDER_EXTERNAL_URL);
}

/**
 * Get deployment mode
 */
function getDeploymentMode() {
    const explicit = (process.env.DEPLOY_TARGET || '').toLowerCase();
    if (explicit === 'selfhost') return 'selfhost';
    if (explicit === 'render') return 'render';
    if (explicit === 'hybrid' || !explicit) {
        return isRenderEnvironment() ? 'render (auto-detected)' : 'selfhost (auto-detected)';
    }
    return explicit;
}

/**
 * Validate Render configuration
 */
function validateRenderConfig() {
    const warnings = [];
    const errors = [];
    const info = [];

    const isRender = isRenderEnvironment();
    const mode = getDeploymentMode();

    info.push(`Deployment mode: ${mode}`);

    if (isRender) {
        info.push(`Render Service ID: ${process.env.RENDER_SERVICE_ID || 'not set'}`);
        
        if (process.env.RENDER_EXTERNAL_URL) {
            info.push(`External URL: ${process.env.RENDER_EXTERNAL_URL}`);
        }
    }

    // Check required vars
    if (!process.env.DISCORD_TOKEN) {
        errors.push('DISCORD_TOKEN not set');
    }

    if (!process.env.MONGO_URI_MAIN) {
        errors.push('MONGO_URI_MAIN not set - database features will fail');
    }

    if (!process.env.MONGO_URI_VAULT) {
        warnings.push('MONGO_URI_VAULT not set - vault features may fail');
    }

    if (!process.env.MASTER_KEY_BASE64) {
        errors.push('MASTER_KEY_BASE64 not set - encryption will fail');
    } else {
        try {
            const decoded = Buffer.from(process.env.MASTER_KEY_BASE64, 'base64');
            if (decoded.length !== 32) {
                errors.push('MASTER_KEY_BASE64 must decode to exactly 32 bytes');
            }
        } catch {
            errors.push('MASTER_KEY_BASE64 is not valid base64');
        }
    }

    // Check OAuth config
    const hasClientId = !!process.env.DISCORD_CLIENT_ID;
    const hasClientSecret = !!process.env.DISCORD_CLIENT_SECRET;
    if (hasClientId && !hasClientSecret) {
        errors.push('DISCORD_CLIENT_ID set but DISCORD_CLIENT_SECRET missing');
    }
    if (hasClientId && hasClientSecret) {
        info.push('Discord OAuth: configured');
    } else {
        info.push('Discord OAuth: not configured (dashboard login disabled)');
    }

    // Check AI providers
    const aiProviders = [
        'OPENAI_API_KEY',
        'GROQ_API_KEY',
        'OPENROUTER_API_KEY',
        'GOOGLE_AI_API_KEY'
    ];
    const configuredProviders = aiProviders.filter(key => !!process.env[key]);
    if (configuredProviders.length === 0) {
        warnings.push('No AI providers configured - AI features will be limited');
    } else {
        info.push(`AI providers: ${configuredProviders.length} configured`);
    }

    // Check optional but recommended
    if (!process.env.HEALTH_TOKEN && isRender) {
        info.push('HEALTH_TOKEN not set (health endpoint is public)');
    }

    // Performance settings
    const threadPoolSize = process.env.UV_THREADPOOL_SIZE;
    if (!threadPoolSize) {
        warnings.push('UV_THREADPOOL_SIZE not set (recommend 64 for Render)');
    } else {
        info.push(`UV_THREADPOOL_SIZE: ${threadPoolSize}`);
    }

    return {
        isRender,
        mode,
        warnings,
        errors,
        info
    };
}

/**
 * Print Render status at startup
 */
function printRenderStatus() {
    const result = validateRenderConfig();
    
    if (!result.isRender && !process.env.DEPLOY_TARGET) {
        // Not on Render and no explicit target - skip output
        return result;
    }

    const modeColor = result.isRender ? colors.magenta : colors.cyan;
    console.log(`\n${modeColor}═══ ${result.mode.includes('render') ? 'Render' : 'Deployment'} Mode ═══${colors.reset}`);

    for (const msg of result.info) {
        console.log(`${colors.cyan}ℹ${colors.reset} ${msg}`);
    }

    for (const msg of result.warnings) {
        console.log(`${colors.yellow}⚠${colors.reset} ${msg}`);
    }

    for (const msg of result.errors) {
        console.log(`${colors.red}✗${colors.reset} ${msg}`);
    }

    if (result.errors.length === 0 && result.warnings.length === 0) {
        console.log(`${colors.green}✓${colors.reset} Configuration looks good!`);
    }

    console.log('');
    return result;
}

module.exports = {
    isRenderEnvironment,
    getDeploymentMode,
    validateRenderConfig,
    printRenderStatus
};

// Run if called directly
if (require.main === module) {
    require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
    const result = printRenderStatus();
    process.exit(result.errors.length > 0 ? 1 : 0);
}

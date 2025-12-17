/**
 * Selfhost Environment Check
 * 
 * Run at startup to validate selfhost configuration.
 * Returns warnings/errors for common misconfigurations.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const SETUP_COMPLETE_FILE = path.join(DATA_DIR, '.selfhost-setup-complete');

// ANSI colors
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m'
};

/**
 * Check if running in selfhost mode
 */
function isSelfhostMode() {
    const deployTarget = (process.env.DEPLOY_TARGET || '').toLowerCase();
    const selfhostMode = (process.env.SELFHOST_MODE || '').toLowerCase();
    const isRender = !!(process.env.RENDER || process.env.RENDER_SERVICE_ID || process.env.RENDER_EXTERNAL_URL);
    
    return !isRender && (deployTarget === 'selfhost' || selfhostMode === 'true');
}

/**
 * Check if first-time setup is needed
 */
function needsFirstTimeSetup() {
    if (!isSelfhostMode()) return false;
    return !fs.existsSync(SETUP_COMPLETE_FILE);
}

/**
 * Validate selfhost configuration
 */
function validateSelfhostConfig() {
    const warnings = [];
    const errors = [];
    const info = [];

    if (!isSelfhostMode()) {
        return { isSelfhost: false, warnings, errors, info };
    }

    // Check PUBLIC_BASE_URL
    const baseUrl = process.env.PUBLIC_BASE_URL || '';
    if (!baseUrl) {
        warnings.push('PUBLIC_BASE_URL not set - OAuth callbacks will use localhost fallback');
    } else if (baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1')) {
        info.push(`PUBLIC_BASE_URL is set to local address: ${baseUrl}`);
    } else {
        info.push(`PUBLIC_BASE_URL: ${baseUrl}`);
    }

    // Check Discord OAuth config
    const clientId = process.env.DISCORD_CLIENT_ID;
    const clientSecret = process.env.DISCORD_CLIENT_SECRET;
    if (clientId && !clientSecret) {
        errors.push('DISCORD_CLIENT_ID set but DISCORD_CLIENT_SECRET is missing');
    }
    if (clientId && clientSecret && baseUrl) {
        info.push(`OAuth redirect URL should be: ${baseUrl}/auth/discord/callback`);
    }

    // Check database config for selfhost
    const localDbMode = process.env.LOCAL_DB_MODE === '1' || process.env.ALLOW_START_WITHOUT_DB === '1';
    const hasMongoMain = !!process.env.MONGO_URI_MAIN;
    const hasMongoVault = !!process.env.MONGO_URI_VAULT;
    
    if (localDbMode) {
        info.push('Running in LOCAL_DB_MODE (limited features, file-based storage)');
    } else if (!hasMongoMain || !hasMongoVault) {
        warnings.push('MongoDB URIs not fully configured - some features may not work');
    }

    // Check for common port conflicts
    const port = process.env.PORT || 3000;
    info.push(`Server will listen on port ${port}`);

    // Check master key
    if (!process.env.MASTER_KEY_BASE64) {
        errors.push('MASTER_KEY_BASE64 not set - encryption features will fail');
    }

    return {
        isSelfhost: true,
        needsSetup: needsFirstTimeSetup(),
        warnings,
        errors,
        info
    };
}

/**
 * Print selfhost status at startup
 */
function printSelfhostStatus() {
    const result = validateSelfhostConfig();
    
    if (!result.isSelfhost) {
        return result;
    }

    console.log(`\n${colors.cyan}═══ Selfhost Mode ═══${colors.reset}`);

    if (result.needsSetup) {
        console.log(`${colors.yellow}⚠ First-time setup not completed${colors.reset}`);
        console.log(`  Run: ${colors.bright}node scripts/selfhost-setup.js${colors.reset}`);
    }

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
    isSelfhostMode,
    needsFirstTimeSetup,
    validateSelfhostConfig,
    printSelfhostStatus
};

// Run if called directly
if (require.main === module) {
    require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
    printSelfhostStatus();
}

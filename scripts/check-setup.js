#!/usr/bin/env node
/**
 * Jarvis AI - Comprehensive Setup Checker
 * Validates all components are properly configured
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');

const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    cyan: '\x1b[36m',
    magenta: '\x1b[35m',
    blue: '\x1b[34m'
};

const log = {
    header: msg => console.log(`\n${colors.bright}${colors.cyan}━━━ ${msg} ━━━${colors.reset}\n`),
    success: msg => console.log(`${colors.green}✓${colors.reset} ${msg}`),
    warn: msg => console.log(`${colors.yellow}!${colors.reset} ${msg}`),
    error: msg => console.log(`${colors.red}✗${colors.reset} ${msg}`),
    info: msg => console.log(`${colors.blue}ℹ${colors.reset} ${msg}`),
    item: msg => console.log(`  ${colors.dim}→${colors.reset} ${msg}`)
};

// Check categories
const checks = {
    passed: 0,
    warned: 0,
    failed: 0
};

function pass(msg) {
    checks.passed++;
    log.success(msg);
}

function warn(msg) {
    checks.warned++;
    log.warn(msg);
}

function fail(msg) {
    checks.failed++;
    log.error(msg);
}

async function checkDiscord() {
    log.header('Discord Configuration');

    if (process.env.DISCORD_TOKEN) {
        pass('DISCORD_TOKEN is set');
        // Basic token format check
        if (process.env.DISCORD_TOKEN.length > 50) {
            pass('Token format looks valid');
        } else {
            warn("Token seems short - verify it's complete");
        }
    } else {
        fail('DISCORD_TOKEN is not set');
    }

    if (process.env.DISCORD_ENABLE_MESSAGE_CONTENT === 'true') {
        pass('Message content intent enabled');
    } else {
        warn('Message content intent disabled (set DISCORD_ENABLE_MESSAGE_CONTENT=true to enable)');
    }
}

async function checkDatabase() {
    log.header('Database Configuration');

    const localMode = process.env.LOCAL_DB_MODE === '1';

    if (localMode) {
        pass('Running in LOCAL_DB_MODE (no MongoDB required)');

        // Check local-db directory
        const localDir = path.join(__dirname, '..', 'data', 'local-db');
        if (fs.existsSync(localDir)) {
            const files = fs.readdirSync(localDir).filter(f => f.endsWith('.json'));
            pass(`Local database has ${files.length} collection files`);
        } else {
            warn('Local database directory not found - will be created on first use');
        }
    } else {
        if (process.env.MONGO_URI_MAIN) {
            pass('MONGO_URI_MAIN is set');

            // Try to parse and check format
            try {
                const uri = process.env.MONGO_URI_MAIN;
                if (uri.startsWith('mongodb://') || uri.startsWith('mongodb+srv://')) {
                    pass('MongoDB URI format is valid');
                }
            } catch (e) {
                warn('Could not validate MongoDB URI format');
            }
        } else {
            fail('MONGO_URI_MAIN is not set (required unless LOCAL_DB_MODE=1)');
        }

        if (process.env.MONGO_URI_VAULT) {
            pass('MONGO_URI_VAULT is set');
        } else {
            fail('MONGO_URI_VAULT is not set');
        }
    }

    if (process.env.MASTER_KEY_BASE64) {
        pass('MASTER_KEY_BASE64 is set (vault encryption)');
    } else {
        warn('MASTER_KEY_BASE64 not set (vault features will be limited)');
    }
}

async function checkAIProviders() {
    log.header('AI Providers');

    const providers = {
        OPENROUTER_API_KEY: 'OpenRouter (free tier available)',
        GROQ_API_KEY: 'Groq (free tier, very fast)',
        GOOGLE_AI_API_KEY: 'Google AI Studio (free Gemini)',
        OPENAI: 'OpenAI (paid)',
        AI_GATEWAY_API_KEY: 'DeepSeek via Gateway'
    };

    let hasProvider = false;
    const available = [];

    for (const [key, name] of Object.entries(providers)) {
        if (process.env[key]) {
            pass(`${name}`);
            hasProvider = true;
            available.push(name);
        }
    }

    // Check for multiple OpenRouter keys
    const orKeys = Object.keys(process.env).filter(k => k.startsWith('OPENROUTER_API_KEY'));
    if (orKeys.length > 1) {
        log.info(`  Found ${orKeys.length} OpenRouter keys (multi-key rotation)`);
    }

    // Check for multiple Groq keys
    const groqKeys = Object.keys(process.env).filter(k => k.startsWith('GROQ_API_KEY'));
    if (groqKeys.length > 1) {
        log.info(`  Found ${groqKeys.length} Groq keys (multi-key rotation)`);
    }

    if (!hasProvider) {
        fail('No AI provider configured!');
        console.log(`
${colors.yellow}To get free AI access:${colors.reset}
  ${colors.cyan}1. OpenRouter${colors.reset} - https://openrouter.ai (many free models)
     Set: OPENROUTER_API_KEY=sk-or-...
     
  ${colors.cyan}2. Groq${colors.reset} - https://console.groq.com (fast, free tier)
     Set: GROQ_API_KEY=gsk_...
     
  ${colors.cyan}3. Google AI${colors.reset} - https://aistudio.google.com (free Gemini)
     Set: GOOGLE_AI_API_KEY=...
`);
    } else {
        log.info(`AI Provider mode: ${process.env.AI_PROVIDER || 'auto'}`);
    }
}

async function checkAgentFeatures() {
    log.header('Agent Features');

    if (process.env.SELFHOST_MODE === 'true') {
        pass('Self-host mode enabled');
    } else {
        log.info('Self-host mode disabled (cloud deployment mode)');
    }

    if (process.env.HEADLESS_BROWSER_ENABLED === 'true') {
        pass('Headless browser enabled');

        // Check if puppeteer is installed
        try {
            require.resolve('puppeteer');
            pass('Puppeteer is installed');
        } catch (e) {
            warn('Puppeteer not installed (npm install puppeteer)');
        }
    } else {
        log.info('Headless browser disabled');
    }

    if (process.env.AGENT_READY === 'true') {
        pass('Agent marked as ready');
    } else {
        log.info('Agent not marked as ready (set AGENT_READY=true)');
    }

    if (process.env.LIVE_AGENT_MODE === 'true') {
        pass('Live agent mode enabled');
    } else {
        log.info('Live agent mode disabled');
    }
}

async function checkOptionalServices() {
    log.header('Optional Services');

    if (process.env.YOUTUBE_API_KEY) {
        pass('YouTube API configured');
    } else {
        log.info('YouTube API not configured');
    }

    if (process.env.BRAVE_API_KEY) {
        pass('Brave Search API configured');
    } else {
        log.info('Brave Search not configured');
    }

    if (process.env.CRYPTO_API_KEY) {
        pass('Crypto API configured');
    } else {
        log.info('Crypto API not configured');
    }
}

async function checkNewAgentSystem() {
    log.header('New Agent System (Codex-inspired)');

    const coreFiles = [
        'src/core/ToolHandler.js',
        'src/core/AgentToolRegistry.js',
        'src/core/AgentOrchestrator.js',
        'src/core/AgentCore.js',
        'src/core/FreeAIProvider.js',
        'src/core/tools/ScreenshotTool.js'
    ];

    let allPresent = true;
    for (const file of coreFiles) {
        const fullPath = path.join(__dirname, '..', file);
        if (fs.existsSync(fullPath)) {
            pass(path.basename(file));
        } else {
            fail(`Missing: ${file}`);
            allPresent = false;
        }
    }

    if (allPresent) {
        log.info('\nNew agent system is fully installed!');
        log.info('Test it with: node test-new-agent.js');
    }
}

async function checkProjectStructure() {
    log.header('Project Structure');

    const requiredDirs = ['src/core', 'src/agents', 'src/commands', 'data'];

    for (const dir of requiredDirs) {
        const fullPath = path.join(__dirname, '..', dir);
        if (fs.existsSync(fullPath)) {
            pass(dir);
        } else {
            warn(`Missing directory: ${dir}`);
        }
    }

    // Check package.json
    const pkgPath = path.join(__dirname, '..', 'package.json');
    if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        log.info(`Package: ${pkg.name} v${pkg.version}`);
    }
}

async function main() {
    console.log(`
${colors.bright}${colors.cyan}
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║     JARVIS AI - SETUP CHECKER                                ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
${colors.reset}`);

    await checkDiscord();
    await checkDatabase();
    await checkAIProviders();
    await checkAgentFeatures();
    await checkOptionalServices();
    await checkNewAgentSystem();
    await checkProjectStructure();

    // Summary
    console.log(`
${colors.bright}${colors.cyan}━━━ Summary ━━━${colors.reset}

${colors.green}Passed:${colors.reset} ${checks.passed}
${colors.yellow}Warnings:${colors.reset} ${checks.warned}
${colors.red}Failed:${colors.reset} ${checks.failed}
`);

    if (checks.failed === 0) {
        console.log(`${colors.green}${colors.bright}Setup looks good! 🎉${colors.reset}\n`);
    } else {
        console.log(
            `${colors.yellow}Some issues need attention. Check the output above.${colors.reset}\n`
        );
    }

    // Quick fix suggestions
    if (checks.failed > 0) {
        console.log(`${colors.cyan}Quick fixes:${colors.reset}`);

        if (!process.env.DISCORD_TOKEN) {
            log.item('Add DISCORD_TOKEN to your .env file');
        }
        if (!process.env.MONGO_URI_MAIN && process.env.LOCAL_DB_MODE !== '1') {
            log.item('Either set MONGO_URI_MAIN or enable LOCAL_DB_MODE=1');
        }
        if (!process.env.OPENROUTER_API_KEY && !process.env.GROQ_API_KEY) {
            log.item('Get a free API key from openrouter.ai or console.groq.com');
        }
        console.log('');
    }
}

main().catch(console.error);

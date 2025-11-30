#!/usr/bin/env node
/**
 * Module Load Time Profiler
 * Measures how long each module takes to require/execute
 */

// Load env first silently
require('dotenv').config();

const path = require('path');
const fs = require('fs');

// Suppress console output during requires
const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;

function suppressLogs() {
    console.log = () => {};
    console.warn = () => {};
    console.error = () => {};
}

function restoreLogs() {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
}

const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    cyan: '\x1b[36m',
    dim: '\x1b[2m',
    bright: '\x1b[1m'
};

function formatMs(ms) {
    if (ms < 10) return `${colors.green}${ms.toFixed(1)}ms${colors.reset}`;
    if (ms < 50) return `${colors.yellow}${ms.toFixed(1)}ms${colors.reset}`;
    if (ms < 200) return `${colors.red}${ms.toFixed(0)}ms${colors.reset}`;
    return `${colors.bright}${colors.red}${ms.toFixed(0)}ms${colors.reset}`;
}

function measureRequire(modulePath, displayName) {
    // Clear from cache to get fresh timing
    const resolved = require.resolve(modulePath);
    delete require.cache[resolved];
    
    suppressLogs();
    const start = process.hrtime.bigint();
    try {
        require(modulePath);
        const end = process.hrtime.bigint();
        restoreLogs();
        return { 
            name: displayName, 
            time: Number(end - start) / 1e6, 
            status: 'ok' 
        };
    } catch (e) {
        restoreLogs();
        return { 
            name: displayName, 
            time: 0, 
            status: 'error', 
            error: e.message.split('\n')[0] 
        };
    }
}

// Find all JS files
function findModules(dir, prefix = '') {
    const modules = [];
    try {
        const items = fs.readdirSync(dir);
        for (const item of items) {
            const fullPath = path.join(dir, item);
            const relPath = prefix ? `${prefix}/${item}` : item;
            
            // Skip
            if (item.startsWith('.') || item === 'node_modules' || item === 'codex' || item === 'vendor') continue;
            
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) {
                modules.push(...findModules(fullPath, relPath));
            } else if (item.endsWith('.js') && !item.includes('.test.') && !item.startsWith('test-')) {
                modules.push({ path: fullPath, name: relPath });
            }
        }
    } catch (e) {}
    return modules;
}

async function main() {
    console.log(`
${colors.cyan}${colors.bright}╔════════════════════════════════════════════════════════╗
║         Module Load Time Profiler                      ║
║         Measuring require() latency                    ║
╚════════════════════════════════════════════════════════╝${colors.reset}
`);

    const projectRoot = __dirname;
    const results = [];
    
    // Core modules first
    console.log(`${colors.bright}Root Modules:${colors.reset}`);
    const rootModules = [
        'config.js',
        'database.js',
        'db.js',
        'index.js',
        'ai-providers.js',
        'discord-handlers.js',
        'jarvis-core.js',
        'vault-client.js',
        'brave-search.js',
        'math-engine.js',
        'embedding-system.js',
        'moderation-filters.js',
        'crypto-client.js',
        'agent-cli.js'
    ];
    
    for (const mod of rootModules) {
        const fullPath = path.join(projectRoot, mod);
        if (fs.existsSync(fullPath)) {
            const result = measureRequire(fullPath, mod);
            results.push(result);
            if (result.status === 'ok') {
                console.log(`  ${formatMs(result.time).padStart(20)} │ ${result.name}`);
            } else {
                console.log(`  ${colors.red}ERROR${colors.reset}            │ ${result.name} ${colors.dim}(${result.error.slice(0, 40)})${colors.reset}`);
            }
        }
    }
    
    // src/ modules
    console.log(`\n${colors.bright}src/agents/:${colors.reset}`);
    const agentModules = findModules(path.join(projectRoot, 'src', 'agents'));
    for (const mod of agentModules) {
        const result = measureRequire(mod.path, mod.name);
        results.push(result);
        if (result.status === 'ok') {
            console.log(`  ${formatMs(result.time).padStart(20)} │ ${path.basename(result.name)}`);
        } else {
            console.log(`  ${colors.red}ERROR${colors.reset}            │ ${path.basename(result.name)} ${colors.dim}(${result.error.slice(0, 30)})${colors.reset}`);
        }
    }
    
    console.log(`\n${colors.bright}src/core/:${colors.reset}`);
    const coreModules = findModules(path.join(projectRoot, 'src', 'core'));
    for (const mod of coreModules) {
        const result = measureRequire(mod.path, mod.name);
        results.push(result);
        if (result.status === 'ok') {
            console.log(`  ${formatMs(result.time).padStart(20)} │ ${path.basename(result.name)}`);
        } else {
            console.log(`  ${colors.red}ERROR${colors.reset}            │ ${path.basename(result.name)} ${colors.dim}(${result.error.slice(0, 30)})${colors.reset}`);
        }
    }
    
    console.log(`\n${colors.bright}src/utils/:${colors.reset}`);
    const utilModules = findModules(path.join(projectRoot, 'src', 'utils'));
    for (const mod of utilModules) {
        const result = measureRequire(mod.path, mod.name);
        results.push(result);
        if (result.status === 'ok') {
            console.log(`  ${formatMs(result.time).padStart(20)} │ ${path.basename(result.name)}`);
        } else {
            console.log(`  ${colors.red}ERROR${colors.reset}            │ ${path.basename(result.name)} ${colors.dim}(${result.error.slice(0, 30)})${colors.reset}`);
        }
    }
    
    console.log(`\n${colors.bright}src/scrapers/:${colors.reset}`);
    const scraperModules = findModules(path.join(projectRoot, 'src', 'scrapers'));
    for (const mod of scraperModules) {
        const result = measureRequire(mod.path, mod.name);
        results.push(result);
        if (result.status === 'ok') {
            console.log(`  ${formatMs(result.time).padStart(20)} │ ${path.basename(result.name)}`);
        } else {
            console.log(`  ${colors.red}ERROR${colors.reset}            │ ${path.basename(result.name)} ${colors.dim}(${result.error.slice(0, 30)})${colors.reset}`);
        }
    }
    
    console.log(`\n${colors.bright}scripts/:${colors.reset}`);
    const scriptModules = findModules(path.join(projectRoot, 'scripts'));
    for (const mod of scriptModules) {
        const result = measureRequire(mod.path, mod.name);
        results.push(result);
        if (result.status === 'ok') {
            console.log(`  ${formatMs(result.time).padStart(20)} │ ${path.basename(result.name)}`);
        } else {
            console.log(`  ${colors.red}ERROR${colors.reset}            │ ${path.basename(result.name)} ${colors.dim}(${result.error.slice(0, 30)})${colors.reset}`);
        }
    }
    
    // Summary
    const successful = results.filter(r => r.status === 'ok');
    const failed = results.filter(r => r.status === 'error');
    const totalTime = successful.reduce((sum, r) => sum + r.time, 0);
    const sorted = [...successful].sort((a, b) => b.time - a.time);
    
    console.log(`
${colors.cyan}${colors.bright}════════════════════════════════════════════════════════${colors.reset}
${colors.bright}Summary:${colors.reset}
  Total modules: ${results.length}
  Loaded OK:     ${successful.length}
  Failed:        ${failed.length}
  
${colors.bright}Total load time:${colors.reset} ${formatMs(totalTime)}

${colors.bright}Slowest modules (top 10):${colors.reset}`);
    
    for (let i = 0; i < Math.min(10, sorted.length); i++) {
        const r = sorted[i];
        const bar = '█'.repeat(Math.min(30, Math.floor(r.time / 10)));
        console.log(`  ${(i + 1).toString().padStart(2)}. ${formatMs(r.time).padStart(15)} ${colors.dim}${bar}${colors.reset} ${r.name}`);
    }
    
    console.log(`
${colors.bright}Fastest modules (top 5):${colors.reset}`);
    const fastest = [...successful].sort((a, b) => a.time - b.time).slice(0, 5);
    for (const r of fastest) {
        console.log(`      ${formatMs(r.time).padStart(15)} ${r.name}`);
    }
    
    if (failed.length > 0) {
        console.log(`
${colors.red}${colors.bright}Failed modules:${colors.reset}`);
        for (const r of failed) {
            console.log(`  ${colors.red}✗${colors.reset} ${r.name}`);
            console.log(`    ${colors.dim}${r.error}${colors.reset}`);
        }
    }
    
    console.log();
}

main().catch(console.error);


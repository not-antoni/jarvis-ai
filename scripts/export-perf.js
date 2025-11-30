#!/usr/bin/env node
// Simple module load time export
require('dotenv').config();
const path = require('path');
const fs = require('fs');

// Store original console
const origLog = console.log;
const origWarn = console.warn;  
const origErr = console.error;

function silence() {
    console.log = console.warn = console.error = () => {};
}

function unsilence() {
    console.log = origLog;
    console.warn = origWarn;
    console.error = origErr;
}

function timeRequire(file, name) {
    try {
        const resolved = require.resolve(file);
        delete require.cache[resolved];
    } catch { return { name, ms: 0, ok: false, err: 'not found' }; }
    
    silence();
    const t0 = Date.now();
    try {
        require(file);
        const ms = Date.now() - t0;
        unsilence();
        return { name, ms, ok: true };
    } catch (e) {
        unsilence();
        return { name, ms: 0, ok: false, err: e.message.slice(0, 40) };
    }
}

function getJsFiles(dir) {
    const files = [];
    try {
        for (const f of fs.readdirSync(dir)) {
            if (f.startsWith('.') || f === 'node_modules' || f === 'codex' || f === 'vendor') continue;
            const fp = path.join(dir, f);
            if (fs.statSync(fp).isDirectory()) files.push(...getJsFiles(fp));
            else if (f.endsWith('.js') && !f.includes('test')) files.push(fp);
        }
    } catch {}
    return files;
}

const results = [];
const lines = [];

lines.push('========================================');
lines.push('  JARVIS CODEX - Module Load Times');
lines.push('  ' + new Date().toLocaleString());
lines.push('========================================\n');

// Safe modules only (no entry points that start servers/REPLs)
const safeRoot = [
    'config.js', 'db.js', 'ai-providers.js', 'jarvis-core.js', 
    'vault-client.js', 'brave-search.js', 'math-engine.js',
    'embedding-system.js', 'moderation-filters.js', 'crypto-client.js'
];

lines.push('ROOT MODULES:\n' + '-'.repeat(40));
for (const m of safeRoot) {
    const fp = path.join(__dirname, m);
    if (fs.existsSync(fp)) {
        const r = timeRequire(fp, m);
        results.push(r);
        lines.push(r.ok ? `${String(r.ms).padStart(8)} ms  ${r.name}` : `   ERROR  ${r.name}: ${r.err}`);
    }
}

// Subfolders
for (const [dir, label] of [['src/agents','AGENTS'],['src/core','CORE'],['src/utils','UTILS'],['src/scrapers','SCRAPERS'],['scripts','SCRIPTS']]) {
    const full = path.join(__dirname, dir);
    if (!fs.existsSync(full)) continue;
    
    lines.push(`\n${label}:\n` + '-'.repeat(40));
    for (const fp of getJsFiles(full)) {
        const name = path.basename(fp);
        // Skip entry points
        if (name === 'index.js' && dir === '.') continue;
        const r = timeRequire(fp, name);
        results.push(r);
        lines.push(r.ok ? `${String(r.ms).padStart(8)} ms  ${r.name}` : `   ERROR  ${r.name}: ${r.err}`);
    }
}

// Summary
const ok = results.filter(r => r.ok);
const bad = results.filter(r => !r.ok);
const total = ok.reduce((s,r) => s + r.ms, 0);

lines.push('\n========================================');
lines.push('SUMMARY');
lines.push('========================================');
lines.push(`Total: ${results.length} modules`);
lines.push(`OK: ${ok.length} | Failed: ${bad.length}`);
lines.push(`Total load time: ${total} ms\n`);

lines.push('SLOWEST:');
[...ok].sort((a,b) => b.ms - a.ms).slice(0,10).forEach((r,i) => 
    lines.push(`  ${i+1}. ${String(r.ms).padStart(6)} ms  ${r.name}`));

lines.push('\nFASTEST:');
[...ok].sort((a,b) => a.ms - b.ms).slice(0,5).forEach(r => 
    lines.push(`     ${String(r.ms).padStart(6)} ms  ${r.name}`));

if (bad.length) {
    lines.push('\nFAILED:');
    bad.forEach(r => lines.push(`  X ${r.name}: ${r.err}`));
}

fs.writeFileSync('tests.txt', lines.join('\n'));
origLog('Done! Saved to tests.txt');
process.exit(0);

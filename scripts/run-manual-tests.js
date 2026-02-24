#!/usr/bin/env node
'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const tests = [
    { name: 'selfhost-features', args: ['tests/selfhost-features.test.js'], retries: 1 },
    { name: 'sentient-core', args: ['tests/sentient-core.test.js'], retries: 1 },
    { name: 'yt-dlp-manager', args: ['tests/yt-dlp-manager.test.js'], retries: 0 }
];

function runTest(test) {
    for (let attempt = 1; attempt <= test.retries + 1; attempt++) {
        console.log(`\n=== ${test.name} (attempt ${attempt}/${test.retries + 1}) ===`);
        const result = spawnSync(process.execPath, test.args, {
            cwd: path.join(__dirname, '..'),
            stdio: 'inherit',
            env: process.env
        });

        if ((result.status ?? 1) === 0) {
            return { ok: true, attempts: attempt };
        }

        if (attempt <= test.retries) {
            console.log(`Retrying ${test.name} after failure...`);
        }
    }

    return { ok: false, attempts: test.retries + 1 };
}

let passed = 0;
let failed = 0;
let skipped = 0;

for (const test of tests) {
    const outcome = runTest(test);
    if (outcome.ok) {
        passed++;
    } else {
        failed++;
    }
}

if (process.env.RUN_SCRAPING_TESTS === '1') {
    const scrapingCommand = process.env.SCRAPING_TEST_CMD || '';
    if (!scrapingCommand.trim()) {
        console.log('\nSkipping scraping test suite (legacy Mocha-style test). Set SCRAPING_TEST_CMD to run it.');
        skipped++;
    } else {
        console.log(`\n=== scraping (custom command) ===`);
        const result = spawnSync(scrapingCommand, {
            cwd: path.join(__dirname, '..'),
            stdio: 'inherit',
            env: process.env,
            shell: true
        });
        if ((result.status ?? 1) === 0) {
            passed++;
        } else {
            failed++;
        }
    }
} else {
    console.log('\nSkipping scraping test suite (set RUN_SCRAPING_TESTS=1 to include it).');
    skipped++;
}

console.log('\n=== Manual Test Summary ===');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Skipped: ${skipped}`);

process.exit(failed > 0 ? 1 : 0);

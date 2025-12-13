const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...walk(fullPath));
            continue;
        }
        if (entry.isFile() && entry.name.endsWith('.test.js')) {
            files.push(fullPath);
        }
    }

    return files;
}

function isNodeTestFile(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        return content.includes('node:test');
    } catch {
        return false;
    }
}

function main() {
    const testsDir = path.join(process.cwd(), 'tests');
    if (!fs.existsSync(testsDir)) {
        console.error('No tests directory found.');
        process.exit(1);
    }

    const candidates = walk(testsDir);
    const testFiles = candidates.filter(isNodeTestFile).sort();

    if (testFiles.length === 0) {
        console.error('No node:test files found under tests/.');
        process.exit(1);
    }

    const args = ['--test', ...testFiles];
    const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
    process.exit(result.status ?? 1);
}

main();

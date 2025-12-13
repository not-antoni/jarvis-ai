#!/usr/bin/env node
/**
 * Line Counter Script
 * Counts .js files and total lines (excluding node_modules and external repos)
 */

const fs = require('fs');
const path = require('path');

const EXCLUDE_DIRS = [
    'node_modules',
    '.git',
    'external',
    'vendor',
    'dist',
    'build',
    'coverage',
    '.next',
    'bin'
];

let totalFiles = 0;
let totalLines = 0;
const fileBreakdown = [];

function countLines(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    return content.split('\n').length;
}

function walkDir(dir, depth = 0) {
    const items = fs.readdirSync(dir);

    for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
            if (!EXCLUDE_DIRS.includes(item)) {
                walkDir(fullPath, depth + 1);
            }
        } else if (item.endsWith('.js')) {
            const lines = countLines(fullPath);
            totalFiles++;
            totalLines += lines;
            fileBreakdown.push({ path: fullPath.replace(process.cwd() + path.sep, ''), lines });
        }
    }
}

console.log('\n📊 Jarvis AI - Code Statistics\n');
console.log('='.repeat(50));

walkDir(process.cwd());

// Sort by lines descending
fileBreakdown.sort((a, b) => b.lines - a.lines);

console.log(`\n📁 Total JavaScript Files: ${totalFiles}`);
console.log(`📝 Total Lines of Code: ${totalLines.toLocaleString()}`);
console.log(`📈 Average Lines per File: ${Math.round(totalLines / totalFiles)}`);

console.log('\n🔝 Top 10 Largest Files:\n');
fileBreakdown.slice(0, 10).forEach((f, i) => {
    console.log(`  ${i + 1}. ${f.path} (${f.lines.toLocaleString()} lines)`);
});

// Category breakdown
const categories = {};
fileBreakdown.forEach(f => {
    const parts = f.path.split(path.sep);
    const category = parts.length > 1 ? parts[0] + '/' + (parts[1] || '') : 'root';
    categories[category] = (categories[category] || 0) + f.lines;
});

console.log('\n📂 Lines by Directory:\n');
Object.entries(categories)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .forEach(([cat, lines]) => {
        console.log(`  ${cat}: ${lines.toLocaleString()} lines`);
    });

console.log('\n' + '='.repeat(50));
console.log('✅ Analysis complete!\n');

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');

function read(relativePath) {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

function extractFirstSetName(sourceText) {
    return (sourceText.match(/\.setName\('([^']+)'\)/) || [])[1] || null;
}

function extractRegisteredCommandNames() {
    const slashText = read('src/commands/slash-definitions.js');
    const topLevelSlashNames = slashText
        .split(/new\s+SlashCommandBuilder\s*\(\s*\)/)
        .slice(1)
        .map(block => extractFirstSetName(block))
        .filter(Boolean);

    const musicDir = path.join(REPO_ROOT, 'src', 'commands', 'music');
    const musicNames = fs.readdirSync(musicDir)
        .filter(fileName => fileName.endsWith('.js') && fileName !== 'index.js')
        .map(fileName => extractFirstSetName(read(path.join('src/commands/music', fileName))))
        .filter(Boolean);

    const quoteName = extractFirstSetName(read('src/commands/utility/quote.js'));

    return new Set([
        ...topLevelSlashNames,
        ...musicNames,
        quoteName
    ].filter(Boolean));
}

function extractRegistryNames() {
    return new Set(
        [...read('src/core/command-registry.js').matchAll(/name:\s*'([^']+)'/g)].map(match => match[1])
    );
}

function extractDispatchExplicitNames() {
    const source = read('src/services/handlers/interaction-dispatch.js');
    const explicitIfs = [...source.matchAll(/commandName === '([^']+)'/g)].map(match => match[1]);
    const switchCases = [...source.matchAll(/case '([^']+)':/g)].map(match => match[1]);
    return new Set([...explicitIfs, ...switchCases]);
}

test('command registry matches the registered command catalog', () => {
    const registered = extractRegisteredCommandNames();
    const registry = extractRegistryNames();

    const missingFromRegistry = [...registered].filter(name => !registry.has(name)).sort();
    const staleInRegistry = [...registry].filter(name => !registered.has(name)).sort();

    assert.deepEqual(missingFromRegistry, []);
    assert.deepEqual(staleInRegistry, []);
});

test('explicit interaction-dispatch branches only target registered commands', () => {
    const registered = extractRegisteredCommandNames();
    const explicitDispatchNames = extractDispatchExplicitNames();

    const staleDispatchNames = [...explicitDispatchNames]
        .filter(name => !registered.has(name))
        .sort();

    assert.deepEqual(staleDispatchNames, []);
});

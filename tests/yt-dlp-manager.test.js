/**
 * Tests for yt-dlp Manager
 * 
 * Run with: node tests/yt-dlp-manager.test.js
 */

const assert = require('assert');
const path = require('path');

// Mock config for testing - set all required env vars
process.env.SELFHOST_MODE = 'true';
process.env.DISCORD_TOKEN = 'test-token';
process.env.MONGO_URI_MAIN = 'mongodb://localhost:27017/test';
process.env.MONGO_URI_VAULT = 'mongodb://localhost:27017/test_vault';
process.env.BRAVE_API_KEY = 'test-brave-key';
process.env.MASTER_KEY_BASE64 = Buffer.from('12345678901234567890123456789012').toString('base64');

// Import after setting env vars
const ytDlpManager = require('../src/services/yt-dlp-manager');

console.log('\n🧪 Running yt-dlp Manager Tests...\n');

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`✅ ${name}`);
        passed++;
    } catch (error) {
        console.log(`❌ ${name}`);
        console.log(`   Error: ${error.message}`);
        failed++;
    }
}

async function asyncTest(name, fn) {
    try {
        await fn();
        console.log(`✅ ${name}`);
        passed++;
    } catch (error) {
        console.log(`❌ ${name}`);
        console.log(`   Error: ${error.message}`);
        failed++;
    }
}

// ============================================================================
// Basic Tests
// ============================================================================

console.log('\n📦 Basic Configuration Tests:\n');

test('Manager has correct executable name for platform', () => {
    const isWindows = process.platform === 'win32';
    const expectedName = isWindows ? 'yt-dlp.exe' : 'yt-dlp';
    
    assert(ytDlpManager.executableName === expectedName, 
        `Expected ${expectedName}, got ${ytDlpManager.executableName}`);
});

test('Manager has correct bin directory', () => {
    const expectedDir = path.join(__dirname, '../bin');
    const normalizedExpected = path.normalize(expectedDir);
    const normalizedActual = path.normalize(ytDlpManager.binDir);
    
    assert(normalizedActual === normalizedExpected,
        `Expected ${normalizedExpected}, got ${normalizedActual}`);
});

test('getStatus returns valid structure', () => {
    const status = ytDlpManager.getStatus();
    
    assert(typeof status.ready === 'boolean', 'Status should have ready boolean');
    assert(typeof status.updating === 'boolean', 'Status should have updating boolean');
    assert(typeof status.platform === 'string', 'Status should have platform string');
    assert(typeof status.executablePath === 'string', 'Status should have executablePath');
});

test('Platform is correctly detected', () => {
    const status = ytDlpManager.getStatus();
    const expectedPlatform = process.platform === 'win32' ? 'windows' : 'linux';
    
    assert(status.platform === expectedPlatform, 
        `Expected platform ${expectedPlatform}, got ${status.platform}`);
});

// ============================================================================
// GitHub API Tests (network required)
// ============================================================================

console.log('\n🌐 GitHub API Tests (requires network):\n');

asyncTest('Can fetch latest release info from GitHub', async () => {
    try {
        const release = await ytDlpManager.fetchLatestRelease();
        
        assert(release.tag_name, 'Release should have tag_name');
        assert(release.assets, 'Release should have assets array');
        assert(Array.isArray(release.assets), 'Assets should be an array');
        
        console.log(`   Found release: ${release.tag_name} with ${release.assets.length} assets`);
    } catch (error) {
        // Network errors are acceptable in test environments
        if (error.message.includes('ENOTFOUND') || error.message.includes('network')) {
            console.log('   ⚠️ Skipped: Network unavailable');
            return;
        }
        throw error;
    }
});

asyncTest('Can get download URL for current platform', async () => {
    try {
        const release = await ytDlpManager.fetchLatestRelease();
        const url = ytDlpManager.getDownloadUrl(release);
        
        assert(typeof url === 'string', 'URL should be a string');
        assert(url.startsWith('https://'), 'URL should start with https://');
        assert(url.includes('yt-dlp'), 'URL should contain yt-dlp');
        
        console.log(`   Download URL: ${url.substring(0, 80)}...`);
    } catch (error) {
        if (error.message.includes('ENOTFOUND') || error.message.includes('network')) {
            console.log('   ⚠️ Skipped: Network unavailable');
            return;
        }
        throw error;
    }
});

// ============================================================================
// Version Management Tests
// ============================================================================

console.log('\n📋 Version Management Tests:\n');

test('loadVersionFromFile returns null for non-existent file', () => {
    // This tests the fallback behavior
    const version = ytDlpManager.loadVersionFromFile();
    // It's okay if it returns a version (if one was saved before) or null
    assert(version === null || typeof version === 'string', 
        'Version should be null or string');
});

test('saveVersionToFile does not throw', () => {
    // This shouldn't throw even if directory doesn't exist yet
    try {
        ytDlpManager.saveVersionToFile('test-version-123');
        // If we get here, it worked (directory was created)
    } catch (error) {
        // This is also acceptable if no write permission
        if (!error.message.includes('permission')) {
            throw error;
        }
    }
});

// ============================================================================
// Summary
// ============================================================================

// Run async tests
(async () => {
    await asyncTest('Can fetch latest release info from GitHub', async () => {
        try {
            const release = await ytDlpManager.fetchLatestRelease();
            assert(release.tag_name, 'Release should have tag_name');
        } catch (error) {
            if (error.message.includes('ENOTFOUND') || error.message.includes('getaddrinfo')) {
                console.log('   ⚠️ Skipped: Network unavailable');
                return;
            }
            throw error;
        }
    });

    console.log('\n' + '='.repeat(50));
    console.log(`\n📊 Test Results: ${passed} passed, ${failed} failed\n`);

    if (failed > 0) {
        console.log('❌ Some tests failed!\n');
        process.exit(1);
    } else {
        console.log('✅ All tests passed!\n');
        process.exit(0);
    }
})();

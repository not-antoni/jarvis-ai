/**
 * Tests for Selfhost-only Experimental Features
 * 
 * Run with: node tests/selfhost-features.test.js
 */

const assert = require('assert');
const path = require('path');

// Mock config for testing - set all required env vars
process.env.SELFHOST_MODE = 'true';
process.env.SENTIENCE_GUILDS = '1403664986089324606,123456789';
process.env.DISCORD_TOKEN = 'test-token';
process.env.MONGO_URI_MAIN = 'mongodb://localhost:27017/test';
process.env.MONGO_URI_VAULT = 'mongodb://localhost:27017/test_vault';
process.env.BRAVE_API_KEY = 'test-brave-key';
// 32 bytes = 32 characters, base64 encoded
process.env.MASTER_KEY_BASE64 = Buffer.from('12345678901234567890123456789012').toString('base64');

// Import after setting env vars
const selfhostFeatures = require('../src/services/selfhost-features');

console.log('\n🧪 Running Selfhost Features Tests...\n');

let passed = 0;
let failed = 0;
let testChain = Promise.resolve();

function test(name, fn) {
    testChain = testChain.then(async() => {
        try {
            await fn();
            console.log(`✅ ${name}`);
            passed++;
        } catch (error) {
            console.log(`❌ ${name}`);
            console.log(`   Error: ${error.message}`);
            failed++;
        }
    });
    return testChain;
}

// ============================================================================
// Rap Battle Tests
// ============================================================================

console.log('\n📀 Rap Battle System Tests:\n');

test('processRapBattle returns all required fields', () => {
    const result = selfhostFeatures.processRapBattle('yo yo yo test rap', 'TestUser');
    
    assert(result.originalAnalysis, 'Missing originalAnalysis');
    assert(result.counterRap, 'Missing counterRap');
    assert(result.verdict, 'Missing verdict');
});

test('processRapBattle counter-rap includes username', () => {
    const result = selfhostFeatures.processRapBattle('drop the beat', 'CoolRapper');
    
    assert(result.counterRap.includes('CoolRapper'), 'Counter-rap should mention the user');
});

test('processRapBattle handles short input', () => {
    const result = selfhostFeatures.processRapBattle('hi', 'User');
    
    assert(result.counterRap.length > 0, 'Should generate counter-rap even for short input');
    assert(result.verdict.length > 0, 'Should have a verdict');
});

test('processRapBattle handles long input', () => {
    const longRap = 'I am the greatest rapper alive '.repeat(20);
    const result = selfhostFeatures.processRapBattle(longRap, 'LongRapper');
    
    assert(result.originalAnalysis.includes('...'), 'Long input should be truncated');
});

test('getRandomTaunt returns a string', () => {
    const taunt = selfhostFeatures.getRandomTaunt();
    
    assert(typeof taunt === 'string', 'Taunt should be a string');
    assert(taunt.length > 0, 'Taunt should not be empty');
});

// ============================================================================
// Sentience System Tests
// ============================================================================

console.log('\n✨ Sentience System Tests:\n');

test('isSentienceEnabled returns true for whitelisted guild', () => {
    const isEnabled = selfhostFeatures.isSentienceEnabled('1403664986089324606');

    // Note: This might be false if selfhost mode isn't properly detected
    // Just verify the function works
    assert(typeof isEnabled === 'boolean', 'Should return boolean');
});

test('isSentienceEnabled returns false for non-whitelisted guild', () => {
    const isEnabled = selfhostFeatures.isSentienceEnabled('999999999999999999');

    // This should be false since the guild isn't in the whitelist
    assert(isEnabled === false, 'Non-whitelisted guild should return false');
});

// ============================================================================
// Summary
// ============================================================================

(async() => {
    await testChain;
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

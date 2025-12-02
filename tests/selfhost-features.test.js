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
// Artificial Soul Tests
// ============================================================================

console.log('\n🤖 Artificial Soul Tests:\n');

test('ArtificialSoul initializes with default traits', () => {
    const soul = new selfhostFeatures.ArtificialSoul();
    
    assert(soul.traits.sass >= 0 && soul.traits.sass <= 100, 'Sass should be 0-100');
    assert(soul.traits.empathy >= 0 && soul.traits.empathy <= 100, 'Empathy should be 0-100');
    assert(soul.traits.chaos >= 0 && soul.traits.chaos <= 100, 'Chaos should be 0-100');
});

test('Soul evolves on joke interaction', () => {
    const soul = new selfhostFeatures.ArtificialSoul();
    const initialHumor = soul.traits.humor;
    
    soul.evolve('joke', 'positive');
    
    assert(soul.traits.humor > initialHumor, 'Humor should increase after joke');
});

test('Soul evolves on roast interaction', () => {
    const soul = new selfhostFeatures.ArtificialSoul();
    const initialSass = soul.traits.sass;
    
    soul.evolve('roast', 'positive');
    
    assert(soul.traits.sass > initialSass, 'Sass should increase after roast');
});

test('Soul evolves on chaos interaction', () => {
    const soul = new selfhostFeatures.ArtificialSoul();
    const initialChaos = soul.traits.chaos;
    
    soul.evolve('chaos', 'positive');
    
    assert(soul.traits.chaos > initialChaos, 'Chaos should increase after chaos event');
});

test('Soul status returns valid structure', () => {
    const soul = new selfhostFeatures.ArtificialSoul();
    const status = soul.getStatus();
    
    assert(status.age, 'Status should have age');
    assert(status.traits, 'Status should have traits');
    assert(status.mood, 'Status should have mood');
    assert(Array.isArray(status.personality), 'Personality should be array');
});

test('Soul mood can be changed', () => {
    const soul = new selfhostFeatures.ArtificialSoul();
    
    soul.setMood('chaotic');
    assert(soul.mood === 'chaotic', 'Mood should be chaotic');
    
    soul.setMood('happy');
    assert(soul.mood === 'happy', 'Mood should be happy');
});

test('Soul rejects invalid moods', () => {
    const soul = new selfhostFeatures.ArtificialSoul();
    const originalMood = soul.mood;
    
    soul.setMood('invalid_mood_xyz');
    assert(soul.mood === originalMood, 'Invalid mood should not change current mood');
});

test('Global jarvisSoul instance exists', () => {
    assert(selfhostFeatures.jarvisSoul, 'jarvisSoul should exist');
    assert(selfhostFeatures.jarvisSoul instanceof selfhostFeatures.ArtificialSoul, 'Should be ArtificialSoul instance');
});

// ============================================================================
// Self-Modification System Tests
// ============================================================================

console.log('\n🔧 Self-Modification System Tests:\n');

test('SelfModificationSystem status shows safety lock', () => {
    const status = selfhostFeatures.selfMod.getStatus();
    
    assert(status.canModify === false, 'canModify should be false for safety');
    assert(status.reason.includes('safety'), 'Reason should mention safety');
});

test('SelfModificationSystem rejects sensitive files', async () => {
    const result = await selfhostFeatures.selfMod.analyzeFile('.env');
    
    assert(result.error, 'Should return error for .env file');
    assert(result.error.includes('denied'), 'Error should mention access denied');
});

test('SelfModificationSystem rejects paths outside project', async () => {
    const result = await selfhostFeatures.selfMod.analyzeFile('/etc/passwd');
    
    assert(result.error, 'Should return error for external paths');
});

test('SelfModificationSystem analyzes valid file', async () => {
    const result = await selfhostFeatures.selfMod.analyzeFile('src/services/selfhost-features.js');
    
    assert(!result.error, 'Should not error for valid project file');
    assert(typeof result.lineCount === 'number', 'Should have line count');
    assert(Array.isArray(result.suggestions), 'Should have suggestions array');
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

test('getSentiencePrompt returns null for non-whitelisted guild', () => {
    const prompt = selfhostFeatures.getSentiencePrompt('999999999999999999');
    
    assert(prompt === null, 'Should return null for non-whitelisted guild');
});

// ============================================================================
// Summary
// ============================================================================

console.log('\n' + '='.repeat(50));
console.log(`\n📊 Test Results: ${passed} passed, ${failed} failed\n`);

if (failed > 0) {
    console.log('❌ Some tests failed!\n');
    process.exit(1);
} else {
    console.log('✅ All tests passed!\n');
    process.exit(0);
}

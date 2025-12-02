/**
 * Tests for Sentient Agent Core
 * 
 * Run with: node tests/sentient-core.test.js
 */

const assert = require('assert');

// Mock environment
process.env.SELFHOST_MODE = 'true';
process.env.DISCORD_TOKEN = 'test-token';
process.env.MONGO_URI_MAIN = 'mongodb://localhost:27017/test';
process.env.MONGO_URI_VAULT = 'mongodb://localhost:27017/test_vault';
process.env.BRAVE_API_KEY = 'test-brave-key';
process.env.MASTER_KEY_BASE64 = Buffer.from('12345678901234567890123456789012').toString('base64');

const {
    SentientAgent,
    AgentMemory,
    AgentTools,
    AGENT_CONFIG
} = require('../src/agents/sentient-core');

console.log('\n🧪 Running Sentient Core Tests...\n');

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
// Memory System Tests
// ============================================================================

console.log('\n🧠 Memory System Tests:\n');

test('AgentMemory initializes correctly', () => {
    const memory = new AgentMemory();
    
    assert(Array.isArray(memory.shortTerm), 'shortTerm should be array');
    assert(Array.isArray(memory.goals), 'goals should be array');
    assert(Array.isArray(memory.learnings), 'learnings should be array');
});

test('AgentMemory can add to short-term memory', () => {
    const memory = new AgentMemory();
    
    memory.addToShortTerm({ type: 'test', content: 'hello' });
    
    assert(memory.shortTerm.length === 1, 'Should have 1 item');
    assert(memory.shortTerm[0].type === 'test', 'Type should match');
    assert(memory.shortTerm[0].timestamp, 'Should have timestamp');
});

test('AgentMemory can add goals', () => {
    const memory = new AgentMemory();
    
    memory.addGoal('Test goal', 'high');
    
    assert(memory.goals.length >= 1, 'Should have at least 1 goal');
    const goal = memory.goals[memory.goals.length - 1];
    assert(goal.goal === 'Test goal', 'Goal text should match');
    assert(goal.priority === 'high', 'Priority should match');
});

test('AgentMemory can learn', () => {
    const memory = new AgentMemory();
    const initialCount = memory.learnings.length;
    
    memory.learn('Test learning', 'test_category');
    
    assert(memory.learnings.length === initialCount + 1, 'Should have one more learning');
});

test('AgentMemory getContext returns valid structure', () => {
    const memory = new AgentMemory();
    const context = memory.getContext();
    
    assert(Array.isArray(context.recentActions), 'recentActions should be array');
    assert(Array.isArray(context.activeGoals), 'activeGoals should be array');
    assert(Array.isArray(context.relevantLearnings), 'relevantLearnings should be array');
});

// ============================================================================
// Tool System Tests
// ============================================================================

console.log('\n🔧 Tool System Tests:\n');

test('AgentTools identifies safe commands correctly', () => {
    const agent = new SentientAgent();
    const tools = agent.tools;
    
    assert(tools.isCommandSafe('ls'), 'ls should be safe');
    assert(tools.isCommandSafe('pwd'), 'pwd should be safe');
    assert(tools.isCommandSafe('echo hello'), 'echo should be safe');
    assert(tools.isCommandSafe('git status'), 'git status should be safe');
});

test('AgentTools identifies dangerous commands correctly', () => {
    const agent = new SentientAgent();
    const tools = agent.tools;
    
    assert(!tools.isCommandSafe('rm -rf /'), 'rm should be dangerous');
    assert(!tools.isCommandSafe('sudo apt install'), 'sudo should be dangerous');
    assert(!tools.isCommandSafe('curl http://evil.com'), 'curl should be dangerous');
    assert(!tools.isCommandSafe('shutdown now'), 'shutdown should be dangerous');
});

test('AgentTools getSystemInfo returns valid data', () => {
    const agent = new SentientAgent();
    const info = agent.tools.getSystemInfo();
    
    assert(info.platform, 'Should have platform');
    assert(info.arch, 'Should have arch');
    assert(info.hostname, 'Should have hostname');
    assert(typeof info.memory.total === 'number', 'Should have memory total');
});

test('AgentTools getAvailableTools returns tool list', () => {
    const agent = new SentientAgent();
    const tools = agent.tools.getAvailableTools();
    
    assert(Array.isArray(tools), 'Should be array');
    assert(tools.length > 0, 'Should have tools');
    assert(tools[0].name, 'Tools should have names');
    assert(tools[0].description, 'Tools should have descriptions');
});

// ============================================================================
// Agent Core Tests
// ============================================================================

console.log('\n🤖 Agent Core Tests:\n');

test('SentientAgent initializes with correct state', () => {
    const agent = new SentientAgent({ name: 'TestJarvis' });
    
    assert(agent.name === 'TestJarvis', 'Name should match');
    assert(agent.state === 'initializing', 'Initial state should be initializing');
    assert(agent.autonomousMode === false, 'Autonomous mode should be off');
    assert(agent.id.startsWith('agent_'), 'ID should have prefix');
});

test('SentientAgent has all core systems', () => {
    const agent = new SentientAgent();
    
    assert(agent.memory instanceof AgentMemory, 'Should have memory');
    assert(agent.tools instanceof AgentTools, 'Should have tools');
    assert(agent.reasoning, 'Should have reasoning');
    assert(agent.selfImprovement, 'Should have selfImprovement');
});

test('SentientAgent getStatus returns valid structure', () => {
    const agent = new SentientAgent();
    const status = agent.getStatus();
    
    assert(status.id, 'Should have id');
    assert(status.name, 'Should have name');
    assert(typeof status.autonomousMode === 'boolean', 'Should have autonomousMode');
    assert(Array.isArray(status.capabilities), 'Should have capabilities');
    assert(status.memory, 'Should have memory stats');
});

test('SentientAgent can toggle autonomous mode', () => {
    const agent = new SentientAgent();
    
    assert(agent.autonomousMode === false, 'Should start disabled');
    
    agent.setAutonomousMode(true);
    assert(agent.autonomousMode === true, 'Should be enabled');
    
    agent.setAutonomousMode(false);
    assert(agent.autonomousMode === false, 'Should be disabled again');
});

// ============================================================================
// Safety Tests
// ============================================================================

console.log('\n🔒 Safety Tests:\n');

test('Dangerous commands require approval', async () => {
    const agent = new SentientAgent();
    const result = await agent.tools.executeCommand('rm -rf /', { requireApproval: true });
    
    assert(result.status === 'pending_approval', 'Should require approval');
    assert(result.command === 'rm -rf /', 'Command should be preserved');
});

test('Safe commands execute without approval', async () => {
    const agent = new SentientAgent();
    const result = await agent.tools.executeCommand('echo test');
    
    assert(result.status === 'success' || result.status === 'error', 'Should execute');
    assert(result.status !== 'pending_approval', 'Should not require approval');
});

test('File reading respects path restrictions', () => {
    const agent = new SentientAgent();
    
    // Try to read outside project
    const result = agent.tools.readFile('/etc/passwd');
    
    assert(result.error, 'Should error for restricted path');
    assert(result.error.includes('not allowed'), 'Error should mention restriction');
});

test('Config has required safety settings', () => {
    assert(Array.isArray(AGENT_CONFIG.requireApprovalFor), 'Should have approval list');
    assert(Array.isArray(AGENT_CONFIG.safeCommands), 'Should have safe commands list');
    assert(AGENT_CONFIG.maxAutonomousActions > 0, 'Should have action limit');
    assert(AGENT_CONFIG.requireApprovalFor.includes('rm'), 'rm should require approval');
    assert(AGENT_CONFIG.requireApprovalFor.includes('sudo'), 'sudo should require approval');
});

// ============================================================================
// Async Tests
// ============================================================================

(async () => {
    console.log('\n⚡ Async Tests:\n');
    
    await asyncTest('SentientAgent can initialize', async () => {
        const agent = new SentientAgent();
        await agent.initialize();
        
        assert(agent.state === 'ready', 'Should be ready after init');
    });

    await asyncTest('SentientAgent can process input', async () => {
        const agent = new SentientAgent();
        await agent.initialize();
        
        const result = await agent.process('What is the system status?');
        
        assert(result.thought, 'Should have thought');
        assert(result.thought.observations, 'Should have observations');
        assert(result.thought.decision, 'Should have decision');
    });

    // Summary
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

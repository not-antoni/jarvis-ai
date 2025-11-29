#!/usr/bin/env node
/**
 * Test script for the new Codex-inspired Jarvis Agent
 * Run: node test-new-agent.js
 */

// Load environment variables from .env
require('dotenv').config();

const { 
    AgentCore, 
    createAgent, 
    FreeAIProvider, 
    setupFreeAI,
    ToolHandler,
    ToolOutput,
    ScreenshotTool,
    QuickScreenshotTool
} = require('./src/core');

// Colors for terminal output
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    red: '\x1b[31m'
};

const log = {
    title: (t) => console.log(`\n${colors.bright}${colors.cyan}━━━ ${t} ━━━${colors.reset}\n`),
    success: (t) => console.log(`${colors.green}✓${colors.reset} ${t}`),
    error: (t) => console.log(`${colors.red}✗${colors.reset} ${t}`),
    info: (t) => console.log(`${colors.blue}ℹ${colors.reset} ${t}`),
    warn: (t) => console.log(`${colors.yellow}!${colors.reset} ${t}`),
    result: (t) => console.log(`${colors.magenta}→${colors.reset} ${t}`)
};

async function testToolRegistry() {
    log.title('Testing Tool Registry');

    const agent = createAgent({ registerDefaults: true });
    
    // List tools
    const tools = agent.getTools();
    log.info(`Registered tools: ${tools.length}`);
    tools.forEach(t => log.result(`  ${t.name}: ${t.description.slice(0, 50)}...`));

    // Test echo tool
    log.info('Testing echo tool...');
    const echoResult = await agent.executeTool('echo', { message: 'Hello from Jarvis!' });
    if (echoResult.success) {
        log.success(`Echo: ${echoResult.content}`);
    } else {
        log.error(`Echo failed: ${echoResult.content}`);
    }

    // Test calculate tool
    log.info('Testing calculate tool...');
    const calcResult = await agent.executeTool('calculate', { expression: '42 * 2 + 8' });
    if (calcResult.success) {
        log.success(`Calculate: ${JSON.stringify(calcResult.content)}`);
    } else {
        log.error(`Calculate failed: ${calcResult.content}`);
    }

    // Test time tool
    log.info('Testing get_time tool...');
    const timeResult = await agent.executeTool('get_time', {});
    if (timeResult.success) {
        log.success(`Time: ${timeResult.content}`);
    } else {
        log.error(`Time failed: ${timeResult.content}`);
    }

    return true;
}

async function testCustomTool() {
    log.title('Testing Custom Tool Registration');

    const agent = createAgent();

    // Register a custom tool
    agent.registerFunction(
        'greet',
        'Generate a personalized greeting',
        {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Name to greet' },
                style: { type: 'string', description: 'Greeting style: formal, casual, excited' }
            },
            required: ['name']
        },
        async (args) => {
            const styles = {
                formal: `Good day, ${args.name}. How may I assist you?`,
                casual: `Hey ${args.name}! What's up?`,
                excited: `OMG ${args.name}!! SO GREAT TO SEE YOU! 🎉`
            };
            return styles[args.style] || `Hello, ${args.name}!`;
        },
        { category: 'utility', parallel: true }
    );

    // Test it
    const result = await agent.executeTool('greet', { name: 'Developer', style: 'excited' });
    if (result.success) {
        log.success(`Custom tool: ${result.content}`);
    } else {
        log.error(`Custom tool failed: ${result.content}`);
    }

    return true;
}

async function testToolDiscovery() {
    log.title('Testing Tool Discovery');

    const agent = createAgent({ registerDefaults: true });

    // Discover tools for a query
    const queries = [
        'calculate something',
        'what time is it',
        'make an http request',
        'list all available tools'
    ];

    for (const query of queries) {
        log.info(`Query: "${query}"`);
        const discovered = agent.discoverTools(query, { limit: 3 });
        if (discovered.length > 0) {
            discovered.forEach(t => {
                log.result(`  ${t.name} (score: ${t.relevanceScore.toFixed(2)})`);
            });
        } else {
            log.warn('  No tools found');
        }
    }

    return true;
}

async function testParallelExecution() {
    log.title('Testing Parallel Execution');

    const agent = createAgent({ registerDefaults: true });

    // Execute multiple tools in parallel
    const calls = [
        { name: 'echo', args: { message: 'First' } },
        { name: 'echo', args: { message: 'Second' } },
        { name: 'get_time', args: {} },
        { name: 'calculate', args: { expression: '100 / 4' } }
    ];

    log.info(`Executing ${calls.length} tools in parallel...`);
    const startTime = Date.now();
    
    const results = await agent.registry.executeParallel(calls);
    
    const duration = Date.now() - startTime;
    log.success(`Completed in ${duration}ms`);
    
    results.forEach(r => {
        const status = r.result.success ? colors.green + '✓' : colors.red + '✗';
        log.result(`  ${status}${colors.reset} ${r.toolName}: ${JSON.stringify(r.result.content).slice(0, 50)}`);
    });

    return true;
}

async function testAIProvider() {
    log.title('Testing AI Provider Setup');

    const provider = new FreeAIProvider();

    if (provider.isAvailable()) {
        log.success(`AI Provider available: ${provider.currentProvider}`);
        log.info(`Model: ${provider.currentModel}`);
        log.info(`Available providers: ${provider.getAvailableProviders().join(', ')}`);

        // Try a simple completion
        log.info('Testing completion...');
        try {
            const response = await provider.generateResponse(
                'You are a helpful assistant. Be concise.',
                'Say "Hello World" and nothing else.',
                50
            );
            log.success(`Response: ${response.content}`);
            log.info(`Latency: ${response.latency}ms`);
        } catch (error) {
            log.error(`Completion failed: ${error.message}`);
        }
    } else {
        log.warn('No AI provider configured');
        log.info('To enable AI features, set one of these environment variables:');
        log.info('  OPENROUTER_API_KEY - Get free at https://openrouter.ai');
        log.info('  GROQ_API_KEY - Get free at https://console.groq.com');
    }

    return true;
}

async function testAgentStats() {
    log.title('Testing Agent Statistics');

    const agent = createAgent({ registerDefaults: true });

    // Run some operations
    await agent.executeTool('echo', { message: 'test1' });
    await agent.executeTool('echo', { message: 'test2' });
    await agent.executeTool('calculate', { expression: '1+1' });
    await agent.executeTool('nonexistent', {}); // This will fail

    const stats = agent.getStats();
    
    log.info('Registry Stats:');
    log.result(`  Tools: ${stats.registry.toolCount}`);
    log.result(`  Total Executions: ${stats.registry.totalExecutions}`);
    log.result(`  Success Rate: ${stats.registry.successRate}`);
    log.result(`  Cache Hits: ${stats.registry.cacheHits}`);

    log.info('Orchestrator Stats:');
    log.result(`  Executions: ${stats.orchestrator.totalExecutions}`);
    log.result(`  Success Rate: ${stats.orchestrator.successRate}`);

    return true;
}

async function testWithAI() {
    log.title('Testing Full Agent with AI');

    const provider = new FreeAIProvider();
    
    if (!provider.isAvailable()) {
        log.warn('Skipping AI test - no provider configured');
        return true;
    }

    const agent = createAgent({ 
        registerDefaults: true,
        verbose: true 
    });
    agent.setAIProvider(provider);

    log.info('Sending message to agent...');
    
    const result = await agent.processMessage(
        'What is 25 * 4? Use the calculate tool to find out.'
    );

    if (result.success) {
        log.success('Agent response:');
        console.log(result.response);
        
        if (result.toolResults?.length > 0) {
            log.info('Tools used:');
            result.toolResults.forEach(tr => {
                log.result(`  ${tr.name}: ${JSON.stringify(tr.result.content)}`);
            });
        }
    } else {
        log.error(`Agent failed: ${result.error}`);
    }

    return true;
}

// Main test runner
async function main() {
    console.log(`
${colors.bright}${colors.cyan}
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║     JARVIS AGENT - NEW CODEX-INSPIRED SYSTEM TEST            ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
${colors.reset}`);

    const tests = [
        { name: 'Tool Registry', fn: testToolRegistry },
        { name: 'Custom Tool', fn: testCustomTool },
        { name: 'Tool Discovery', fn: testToolDiscovery },
        { name: 'Parallel Execution', fn: testParallelExecution },
        { name: 'AI Provider', fn: testAIProvider },
        { name: 'Agent Stats', fn: testAgentStats },
        { name: 'Full Agent with AI', fn: testWithAI }
    ];

    let passed = 0;
    let failed = 0;

    for (const test of tests) {
        try {
            const result = await test.fn();
            if (result) {
                passed++;
            } else {
                failed++;
            }
        } catch (error) {
            log.error(`${test.name} crashed: ${error.message}`);
            console.error(error);
            failed++;
        }
    }

    log.title('Test Summary');
    log.info(`Passed: ${colors.green}${passed}${colors.reset}`);
    log.info(`Failed: ${colors.red}${failed}${colors.reset}`);

    if (failed === 0) {
        console.log(`\n${colors.green}${colors.bright}All tests passed! 🎉${colors.reset}\n`);
    } else {
        console.log(`\n${colors.yellow}Some tests failed. Check output above.${colors.reset}\n`);
    }

    // Print setup instructions if no AI
    const provider = new FreeAIProvider();
    if (!provider.isAvailable()) {
        console.log(FreeAIProvider.getSetupInstructions());
    }
}

main().catch(console.error);


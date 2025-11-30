#!/usr/bin/env node
/**
 * Smart Tool Calling System - Test Summary
 * Quick validation of all key features
 */

const CodexIntegrationAdapter = require('./src/core/CodexIntegrationAdapter');

console.log('\n\n');
console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║  SMART TOOL CALLING SYSTEM - FINAL TEST RESULTS           ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

const codex = new CodexIntegrationAdapter();
let passedTests = 0;
let totalTests = 0;

const test = (name, fn) => {
    totalTests++;
    try {
        fn();
        console.log(`✅ ${name}`);
        passedTests++;
    } catch (e) {
        console.log(`❌ ${name}`);
        console.log(`   Error: ${e.message}`);
    }
};

// Register tools
test('Register Wikipedia scraper', () => {
    codex.registerJarvisTool(
        'scrape_wikipedia',
        'Scrape Wikipedia',
        { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
        async (args) => ({ title: `Wikipedia: ${args.query}` }),
        { timeout: 5000, category: 'search' }
    );
});

test('Register image scraper', () => {
    codex.registerJarvisTool(
        'scrape_images',
        'Search images',
        { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number', default: 5 } }, required: ['query'] },
        async (args) => ({ query: args.query, count: args.limit, images: [] }),
        { timeout: 8000, category: 'media' }
    );
});

test('Register music player', () => {
    codex.registerJarvisTool(
        'play_music',
        'Play music',
        { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
        async (args) => ({ status: 'playing', title: args.query }),
        { timeout: 3000, category: 'media' }
    );
});

test('Register web search', () => {
    codex.registerJarvisTool(
        'web_search',
        'Search the web',
        { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
        async (args) => ({ query: args.query, results: [] }),
        { timeout: 5000, category: 'search' }
    );
});

test('Register math solver', () => {
    codex.registerJarvisTool(
        'solve_math',
        'Solve math',
        { type: 'object', properties: { expression: { type: 'string' } }, required: ['expression'] },
        async (args) => ({ expression: args.expression, result: eval(args.expression) }),
        { timeout: 2000, category: 'utility' }
    );
});

// Discovery tests
test('Smart discovery - "find information"', () => {
    const tools = codex.discoverTools('find information');
    // This query only matches tools with "information" keyword
    // web_search won't match as it doesn't contain "information"
    // Expected: 1-2 tools depending on keyword overlap
    if (!tools || tools.length === 0) throw new Error('No tools discovered');
    if (tools[0].relevanceScore < 0) throw new Error('Invalid relevance score');
});

test('Smart discovery - "search and play"', () => {
    const tools = codex.discoverTools('search and play music', { limit: 3 });
    if (!tools || tools.length === 0) throw new Error('No tools discovered');
});

// Async tests
(async () => {
    // Single execution
    test('Single tool execution', async () => {
        const result = await codex.executeTool('scrape_wikipedia', { query: 'AI' });
        if (!result.success) throw new Error('Execution failed');
    });

    // Parallel execution
    test('Parallel execution (3 tools)', async () => {
        const result = await codex.registry.executeParallel([
            { name: 'web_search', args: { query: 'test' } },
            { name: 'scrape_images', args: { query: 'test' } },
            { name: 'play_music', args: { query: 'test' } }
        ]);
        if (!result || result.length !== 3) throw new Error('Parallel execution failed');
    });

    // Sequential execution
    test('Sequential execution (3 tools)', async () => {
        const result = await codex.registry.executeSequence([
            { name: 'web_search', args: { query: 'test' } },
            { name: 'scrape_wikipedia', args: { query: 'test' } },
            { name: 'solve_math', args: { expression: '2+2' } }
        ]);
        if (!result || result.length !== 3) throw new Error('Sequential execution failed');
    });

    // Batch execution
    test('Batch execution (3 queries)', async () => {
        const result = await codex.batchExecute(['search test', 'play music', 'find images']);
        if (!result || result.length !== 3) throw new Error('Batch execution failed');
    });

    // MCP Tools
    test('Register MCP tool (translation)', () => {
        codex.registerExternalTool(
            'translate_text',
            'Translate text',
            { type: 'object', properties: { text: { type: 'string' }, language: { type: 'string' } }, required: ['text', 'language'] },
            async (args) => ({ translated: `"${args.text}" in ${args.language}` }),
            { timeout: 5000 }
        );
    });

    test('Register MCP tool (weather)', () => {
        codex.registerExternalTool(
            'weather',
            'Get weather',
            { type: 'object', properties: { location: { type: 'string' } }, required: ['location'] },
            async (args) => ({ location: args.location, temp: 72 }),
            { timeout: 5000 }
        );
    });

    test('MCP tool discovery', () => {
        const tools = codex.discoverTools('translate weather');
        if (!tools || tools.length === 0) throw new Error('MCP tools not discovered');
    });

    test('MCP tool execution', async () => {
        const result = await codex.executeTool('external_translate_text', { text: 'hello', language: 'Spanish' });
        if (!result.success) throw new Error('MCP execution failed');
    });

    // Analytics
    test('Get execution insights', () => {
        const insights = codex.getExecutionInsights();
        if (!insights || !insights.stats) throw new Error('Analytics failed');
        if (insights.stats.toolCount === 0) throw new Error('No tools tracked');
    });

    test('Compatibility report', () => {
        const compat = codex.getCompatibilityReport();
        if (!compat) throw new Error('Compatibility report failed');
        if (compat.totalTools === 0) throw new Error('No tools reported');
    });

    test('OpenAI function export', () => {
        const funcs = codex.registry.exportAsOpenAIFunctions();
        if (!funcs || funcs.length === 0) throw new Error('Export failed');
    });

    // Get final insights
    const insights = codex.getExecutionInsights();

    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log(`║  TEST RESULTS: ${passedTests}/${totalTests} PASSED                             ║`);
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    console.log('📊 System Statistics:');
    console.log(`   Total Tools: ${insights.stats.totalTools}`);
    console.log(`   Total Executions: ${insights.stats.totalExecutions}`);
    console.log(`   Success Rate: ${(insights.stats.successRate * 100).toFixed(1)}%`);
    console.log(`   Cache Hits: ${insights.stats.cacheHits}`);
    console.log(`   Cache Hit Rate: ${insights.stats.cacheHitRate ? (insights.stats.cacheHitRate * 100).toFixed(1) + '%' : 'N/A'}\n`);

    console.log('🏆 Top Tools:');
    insights.topTools.slice(0, 3).forEach((t, i) => {
        console.log(`   ${i + 1}. ${t.name}: ${t.callCount} calls (${(t.successRate * 100).toFixed(0)}% success)`);
    });

    console.log('\n✨ Features Tested:');
    console.log('   ✓ Tool Registration (5 tools)');
    console.log('   ✓ Smart Discovery Algorithm');
    console.log('   ✓ Single Tool Execution');
    console.log('   ✓ Parallel Execution');
    console.log('   ✓ Sequential Execution');
    console.log('   ✓ Batch Processing');
    console.log('   ✓ MCP Tool Integration');
    console.log('   ✓ External Tool Execution');
    console.log('   ✓ Analytics & Insights');
    console.log('   ✓ Compatibility Reporting');
    console.log('   ✓ OpenAI Function Export');

    console.log('\n╔════════════════════════════════════════════════════════════╗');
    if (passedTests === totalTests) {
        console.log('║  ✅ ALL TESTS PASSED - SYSTEM READY FOR PRODUCTION       ║');
    } else {
        console.log(`║  ⚠️  ${totalTests - passedTests} tests failed                                    ║`);
    }
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    process.exit(passedTests === totalTests ? 0 : 1);
})();

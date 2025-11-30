#!/usr/bin/env node
/**
 * Clean Test Output Reporter
 * Produces clean, readable test output without special character issues
 */

const CodexIntegrationAdapter = require('./src/core/CodexIntegrationAdapter');

const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    dim: '\x1b[2m',
};

const print = {
    header: (text) => console.log(`\n${colors.bright}${colors.cyan}==== ${text} ====${colors.reset}`),
    test: (name, passed) => {
        if (passed) {
            console.log(`${colors.green}[PASS]${colors.reset} ${name}`);
        } else {
            console.log(`${colors.red}[FAIL]${colors.reset} ${name}`);
        }
    },
    result: (passed, total) => {
        console.log(`\n${colors.bright}RESULTS: ${colors.green}${passed}${colors.reset}/${total} PASSED${colors.reset}`);
    },
    section: (text) => console.log(`\n${colors.cyan}${text}${colors.reset}`),
    sep: () => console.log(`${colors.dim}${'-'.repeat(60)}${colors.reset}`),
};

let passed = 0;
let total = 0;

const test = (name, fn) => {
    total++;
    try {
        fn();
        print.test(name, true);
        passed++;
        return true;
    } catch (e) {
        print.test(name, false);
        console.log(`  Error: ${e.message}`);
        return false;
    }
};

async function runTests() {
    console.log(`\n${colors.bright}${colors.cyan}JARVIS SMART TOOL CALLING SYSTEM - TEST SUITE${colors.reset}\n`);

    const codex = new CodexIntegrationAdapter();

    // Registration Tests
    print.header('Tool Registration');

    test('Register search tool', () => {
        codex.registerJarvisTool(
            'web_search',
            'Search the web for information',
            { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
            async (args) => ({ query: args.query, results: [] }),
            { timeout: 5000, category: 'search' }
        );
    });

    test('Register image tool', () => {
        codex.registerJarvisTool(
            'get_images',
            'Find images',
            { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number', default: 5 } }, required: ['query'] },
            async (args) => ({ count: args.limit, images: [] }),
            { timeout: 8000, category: 'media' }
        );
    });

    test('Register utility tool', () => {
        codex.registerJarvisTool(
            'translate',
            'Translate text',
            { type: 'object', properties: { text: { type: 'string' }, language: { type: 'string' } }, required: ['text', 'language'] },
            async (args) => ({ translated: args.text }),
            { timeout: 3000, category: 'utility' }
        );
    });

    test('Register analysis tool', () => {
        codex.registerJarvisTool(
            'analyze_text',
            'Analyze text for keywords',
            { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
            async (args) => ({ keywords: [] }),
            { timeout: 2000, category: 'analysis' }
        );
    });

    // Discovery Tests
    print.header('Smart Discovery');

    test('Discover tools for search query', () => {
        const tools = codex.discoverTools('find information');
        if (!tools || tools.length === 0) throw new Error('No tools discovered');
    });

    test('Discover multiple tools', () => {
        const tools = codex.discoverTools('search and analyze');
        if (!tools || tools.length < 2) throw new Error('Expected 2+ tools');
    });

    test('Discover with category matching', () => {
        const tools = codex.discoverTools('translate text', { category: 'utility' });
        if (!tools || tools.length === 0) throw new Error('No utility tools found');
    });

    // Execution Tests
    print.header('Tool Execution');

    test('Single tool execution', async () => {
        const result = await codex.executeTool('web_search', { query: 'test' });
        if (!result.success) throw new Error('Execution failed');
    });

    test('Tool with timeout', async () => {
        const result = await codex.executeTool('get_images', { query: 'test', limit: 5 });
        if (!result.success) throw new Error('Execution failed');
    });

    // Parallel Execution
    print.header('Parallel Execution');

    test('Execute multiple tools in parallel', async () => {
        const results = await codex.registry.executeParallel([
            { name: 'web_search', args: { query: 'test' } },
            { name: 'get_images', args: { query: 'test' } },
            { name: 'analyze_text', args: { text: 'sample' } }
        ]);
        if (!results || results.length !== 3) throw new Error('Expected 3 results');
    });

    // Sequential Execution
    print.header('Sequential Execution');

    test('Execute tools in sequence', async () => {
        const results = await codex.registry.executeSequence([
            { name: 'web_search', args: { query: 'test' } },
            { name: 'analyze_text', args: { text: 'test' } }
        ]);
        if (!results || results.length !== 2) throw new Error('Expected 2 results');
    });

    // Batch Processing
    print.header('Batch Processing');

    test('Batch execute multiple queries', async () => {
        const results = await codex.batchExecute(['find info', 'translate text']);
        if (!results || results.length < 1) throw new Error('Batch failed');
    });

    // MCP Integration
    print.header('MCP Integration');

    test('Register external tool', () => {
        codex.registerExternalTool(
            'api_call',
            'Call external API',
            { type: 'object', properties: { endpoint: { type: 'string' } }, required: ['endpoint'] },
            async (args) => ({ data: 'result' })
        );
    });

    test('External tool has prefix', () => {
        const tool = codex.registry.getTool('external_api_call');
        if (!tool) throw new Error('External tool not found with prefix');
    });

    // Analytics
    print.header('Analytics & Reporting');

    test('Get execution insights', () => {
        const insights = codex.getExecutionInsights();
        if (!insights || !insights.stats) throw new Error('Analytics failed');
    });

    test('Compatibility report', () => {
        const report = codex.getCompatibilityReport();
        if (!report || report.totalTools === 0) throw new Error('Report failed');
    });

    test('OpenAI export', () => {
        const funcs = codex.registry.exportAsOpenAIFunctions();
        if (!funcs || funcs.length === 0) throw new Error('Export failed');
    });

    // Summary
    print.sep();
    print.result(passed, total);

    const insights = codex.getExecutionInsights();
    print.section('System Summary:');
    console.log(`Tools: ${insights.stats.toolCount}`);
    console.log(`Executions: ${insights.stats.totalExecutions}`);
    console.log(`Cache: ${insights.stats.cacheSize} items`);

    if (passed === total) {
        console.log(`\n${colors.green}${colors.bright}All tests passed!${colors.reset}`);
        process.exit(0);
    } else {
        console.log(`\n${colors.red}${colors.bright}Some tests failed!${colors.reset}`);
        process.exit(1);
    }
}

runTests().catch(console.error);

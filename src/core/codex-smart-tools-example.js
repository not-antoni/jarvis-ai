/**
 * Codex Smart Tool Calling - Complete Integration Example
 * Demonstrates all features of the smart tool system
 */

const CodexIntegrationAdapter = require('./CodexIntegrationAdapter');

// Initialize the adapter
const codex = new CodexIntegrationAdapter({
    registry: {
        maxHistorySize: 1000,
        autoLearn: true,
        enableCaching: true
    },
    orchestrator: {
        approvalRequired: false,
        enablePlanning: true,
        verbose: true,
        maxRetries: 2
    }
});

// ==================== EXAMPLE 1: Register Jarvis Tools ====================

// Register a simple command tool
codex.registerJarvisTool(
    'search_web',
    'Search the web for information',
    {
        type: 'object',
        properties: {
            query: { type: 'string', description: 'Search query' },
            limit: { type: 'number', description: 'Result limit', default: 10 }
        },
        required: ['query']
    },
    async args => {
        console.log(`[Tool] Searching web for: ${args.query}`);
        // Actual implementation would use Brave Search or similar
        return {
            results: [
                { title: 'Result 1', url: 'https://example.com/1' },
                { title: 'Result 2', url: 'https://example.com/2' }
            ]
        };
    },
    {
        timeout: 5000,
        parallel: true,
        category: 'search'
    }
);

// Register a music tool
codex.registerJarvisTool(
    'play_music',
    'Play music from a query',
    {
        type: 'object',
        properties: {
            query: { type: 'string', description: 'Music search query' },
            source: { type: 'string', enum: ['youtube', 'spotify'], default: 'youtube' }
        },
        required: ['query']
    },
    async args => {
        console.log(`[Tool] Playing music: ${args.query}`);
        return { playing: true, query: args.query };
    },
    {
        timeout: 3000,
        parallel: true,
        category: 'media'
    }
);

// Register a shell execution tool (requires approval)
codex.registerJarvisTool(
    'execute_command',
    'Execute a shell command',
    {
        type: 'object',
        properties: {
            command: { type: 'string', description: 'Command to execute' }
        },
        required: ['command']
    },
    async args => {
        console.log(`[Tool] Executing: ${args.command}`);
        return { output: 'Command executed' };
    },
    {
        timeout: 10000,
        parallel: false, // Commands must run sequentially
        requiresApproval: true,
        category: 'system'
    }
);

// ==================== EXAMPLE 2: Tool Discovery ====================

async function demonstrateDiscovery() {
    console.log('\n=== Tool Discovery Example ===\n');

    // Discover tools for different queries
    const queries = ['search for information about AI', 'play some music', 'find weather data'];

    for (const query of queries) {
        const discovered = codex.discoverTools(query, { limit: 3 });
        console.log(`Query: "${query}"`);
        console.log('Available tools:');
        discovered.forEach(tool => {
            console.log(`  - ${tool.name} (relevance: ${tool.relevanceScore.toFixed(2)})`);
        });
        console.log('');
    }
}

// ==================== EXAMPLE 3: Smart Execution ====================

async function demonstrateSmartExecution() {
    console.log('\n=== Smart Execution Example ===\n');

    // Execute with smart tool selection
    const result = await codex.executeWithPlanning(
        'search for machine learning tutorials and play background music',
        {
            0: { query: 'machine learning tutorials' },
            1: { query: 'Lo-Fi beats' }
        },
        { category: 'general', priority: 'normal' }
    );

    console.log('Execution result:', JSON.stringify(result, null, 2));
}

// ==================== EXAMPLE 4: Tool Statistics ====================

async function demonstrateStatistics() {
    console.log('\n=== Tool Statistics Example ===\n');

    // Execute some tools
    await codex.executeTool('search_web', { query: 'javascript' });
    await codex.executeTool('play_music', { query: 'jazz' });
    await codex.executeTool('search_web', { query: 'python' });

    // Get statistics
    const insights = codex.getExecutionInsights();

    console.log('Registry Statistics:');
    console.log(`  Total tools: ${insights.stats.toolCount}`);
    console.log(`  Total executions: ${insights.stats.totalExecutions}`);
    console.log('');

    console.log('Top tools by success:');
    insights.topTools.forEach(tool => {
        console.log(`  - ${tool.name}: ${tool.successCount}/${tool.callCount} successful`);
    });
    console.log('');

    if (insights.recommendations.length > 0) {
        console.log('Recommendations:');
        insights.recommendations.forEach(rec => {
            console.log(`  [${rec.level}] ${rec.message}`);
        });
    }
}

// ==================== EXAMPLE 5: Compatibility Report ====================

async function demonstrateCompatibilityReport() {
    console.log('\n=== Tool Compatibility Report ===\n');

    const report = codex.getCompatibilityReport();

    console.log(`Total tools: ${report.totalTools}`);
    console.log(`Parallel-capable: ${report.supportParallel}`);
    console.log(`Require approval: ${report.requireApproval}`);
    console.log('');

    console.log('Tools by category:');
    Object.entries(report.byCategory).forEach(([category, tools]) => {
        console.log(`  ${category}: ${tools.length} tools`);
    });
    console.log('');

    console.log('Tool details:');
    report.details.forEach(detail => {
        const parallel = detail.parallel ? '✓' : '✗';
        const approval = detail.approval ? '✓' : '✗';
        console.log(`  ${detail.name} [${detail.category}]`);
        console.log(`    Parallel: ${parallel}, Approval: ${approval}`);
    });
}

// ==================== EXAMPLE 6: Export for API ====================

async function demonstrateExport() {
    console.log('\n=== Export for OpenAI Function Calling ===\n');

    const functions = codex.exportAsCodexTools();

    console.log('Exported functions (OpenAI format):');
    console.log(JSON.stringify(functions, null, 2));
}

// ==================== EXAMPLE 7: Batch Execution ====================

async function demonstrateBatchExecution() {
    console.log('\n=== Batch Execution Example ===\n');

    const queries = ['find python tutorials', 'play jazz music', 'search machine learning'];

    const results = await codex.batchExecute(queries);

    results.forEach((item, index) => {
        console.log(`[${index + 1}] Query: "${item.query}"`);
        console.log(`    Success: ${item.result.success}`);
        if (item.result.summary) {
            console.log(`    Tools executed: ${item.result.summary.totalTools}`);
            console.log(`    Successful: ${item.result.summary.successful}`);
        }
    });
}

// ==================== EXAMPLE 8: Direct Tool Execution ====================

async function demonstrateDirectExecution() {
    console.log('\n=== Direct Tool Execution Example ===\n');

    // Execute search tool
    const searchResult = await codex.executeTool('search_web', {
        query: 'artificial intelligence',
        limit: 5
    });

    console.log('Search result:');
    console.log(`  Success: ${searchResult.success}`);
    console.log(`  Duration: ${searchResult.duration}ms`);
    console.log('');

    // Execute music tool
    const musicResult = await codex.executeTool('play_music', {
        query: 'ambient music',
        source: 'youtube'
    });

    console.log('Music result:');
    console.log(`  Success: ${musicResult.success}`);
    console.log(`  Duration: ${musicResult.duration}ms`);
}

// ==================== Main Demo Runner ====================

async function runAllExamples() {
    try {
        await demonstrateDiscovery();
        await demonstrateDirectExecution();
        await demonstrateStatistics();
        await demonstrateCompatibilityReport();
        await demonstrateExport();
        await demonstrateBatchExecution();
        await demonstrateSmartExecution();

        console.log('\n✅ All examples completed successfully!\n');
    } catch (error) {
        console.error('Error running examples:', error);
    }
}

// Run if executed directly
if (require.main === module) {
    runAllExamples();
}

module.exports = {
    codex,
    demonstrateDiscovery,
    demonstrateSmartExecution,
    demonstrateStatistics,
    demonstrateCompatibilityReport,
    demonstrateExport,
    demonstrateBatchExecution,
    demonstrateDirectExecution,
    runAllExamples
};

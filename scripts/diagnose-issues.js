#!/usr/bin/env node
/**
 * Diagnostic script for test failures
 */

const CodexIntegrationAdapter = require('./src/core/CodexIntegrationAdapter');
const codex = new CodexIntegrationAdapter();

console.log('=== DIAGNOSTIC TEST ===\n');

// Register a tool
codex.registerJarvisTool(
    'scrape_wikipedia',
    'Scrape Wikipedia for information',
    { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    async (args) => ({ title: 'Test' }),
    { timeout: 5000, category: 'search' }
);

codex.registerJarvisTool(
    'web_search',
    'Search the web for results',
    { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    async (args) => ({ results: [] }),
    { timeout: 5000, category: 'search' }
);

// Issue 1: Discovery with generic query
console.log('ISSUE 1: Discovery for "find information"\n');
console.log('Expected: Find scrape_wikipedia and web_search\n');

const results = codex.discoverTools('find information');
console.log('Discovery results count:', results.length);
if (results.length > 0) {
    results.forEach(r => {
        console.log(`  - ${r.name}: ${r.relevanceScore}`);
    });
} else {
    console.log('  NO RESULTS - This is the issue!');
    
    // Debug: Check scoring directly
    console.log('\nDebug info:');
    const tools = codex.registry.getAllTools();
    console.log(`  Total tools registered: ${tools.length}`);
    tools.forEach(t => {
        console.log(`  - ${t.name}: description="${t.description}"`);
        
        // Test scoring manually
        const context = {
            query: 'find information',
            keywords: ['find', 'information'],
            category: 'general'
        };
        const score = t.getRelevanceScore(context);
        console.log(`    relevance score with context: ${score}`);
    });
}

// Issue 2: Compatibility report
console.log('\n\nISSUE 2: Compatibility Report\n');
console.log('Expected: Report showing tools count\n');

try {
    const compat = codex.getCompatibilityReport();
    console.log('Compatibility report:', JSON.stringify(compat, null, 2));
} catch (error) {
    console.log('ERROR:', error.message);
    console.log('Stack:', error.stack);
}

// Issue 3: Execution insights
console.log('\n\nISSUE 3: Execution Insights\n');
console.log('Expected: Stats with proper counts\n');

try {
    const insights = codex.getExecutionInsights();
    console.log('Insights stats:', JSON.stringify(insights.stats, null, 2));
    console.log('Top tools:', JSON.stringify(insights.topTools, null, 2));
} catch (error) {
    console.log('ERROR:', error.message);
}

#!/usr/bin/env node
/**
 * Deep dive into discovery scoring
 */

const CodexIntegrationAdapter = require('./src/core/CodexIntegrationAdapter');
const codex = new CodexIntegrationAdapter();

// Register tools
codex.registerJarvisTool(
    'scrape_wikipedia',
    'Scrape Wikipedia for information',
    { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    async args => ({ title: 'Test' }),
    { timeout: 5000, category: 'search' }
);

codex.registerJarvisTool(
    'web_search',
    'Search the web for results',
    { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    async args => ({ results: [] }),
    { timeout: 5000, category: 'search' }
);

codex.registerJarvisTool(
    'scrape_images',
    'Search and download images',
    {
        type: 'object',
        properties: { query: { type: 'string' }, limit: { type: 'number', default: 5 } },
        required: ['query']
    },
    async args => ({ images: [] }),
    { timeout: 8000, category: 'media' }
);

console.log('=== DISCOVERY SCORING ANALYSIS ===\n');

// Test query
const query = 'find information';
console.log(`Query: "${query}"\n`);

// Simulate context analysis
const contextAnalyzer = codex.registry.contextAnalyzer;
const context = contextAnalyzer.analyze(query, {});
console.log('Analyzed context:');
console.log('  Keywords:', context.keywords);
console.log('  Category:', context.category);
console.log();

// Score each tool
const tools = codex.registry.getAllTools();
console.log('Tool scoring:');
tools.forEach(tool => {
    const score = tool.getRelevanceScore(context);
    console.log(`\n  ${tool.name}`);
    console.log(`    Description: "${tool.description}"`);
    console.log(`    Category: ${tool.options.category}`);
    console.log(`    Score: ${score}`);

    // Break down scoring
    let breakdown = 0;
    if (query.toLowerCase().includes(tool.name.toLowerCase())) {
        console.log(`      + Name match: +10`);
        breakdown += 10;
    }
    const desc = tool.description.toLowerCase();
    context.keywords.forEach(kw => {
        if (desc.includes(kw.toLowerCase())) {
            console.log(`      + Keyword "${kw}": +2`);
            breakdown += 2;
        }
    });
    if (context.category === tool.options.category) {
        console.log(`      + Category match (${context.category}): +5`);
        breakdown += 5;
    }
    console.log(`    Calculated: ${breakdown}`);
});

console.log('\n\nFinal discovery results:');
const discovered = codex.discoverTools(query);
console.log(`Count: ${discovered.length}`);
discovered.forEach(d => {
    console.log(`  - ${d.name}: ${d.relevanceScore}`);
});

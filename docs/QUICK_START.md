# Quick Integration Guide

## 5-Minute Setup

### 1. Import the System
```javascript
const CodexIntegrationAdapter = require('./src/core/CodexIntegrationAdapter');
const codex = new CodexIntegrationAdapter();
```

### 2. Register Your Tools
```javascript
// Example: Web Search Tool
codex.registerJarvisTool(
    'web_search',
    'Search the web for information',
    {
        type: 'object',
        properties: {
            query: { type: 'string' },
            maxResults: { type: 'number', default: 10 }
        },
        required: ['query']
    },
    async (args) => {
        // Your implementation
        return {
            query: args.query,
            results: [],
            source: 'web'
        };
    },
    { timeout: 5000, category: 'search', parallel: true }
);
```

### 3. Use the Tools
```javascript
// Discover
const tools = codex.discoverTools('find information');

// Execute
const result = await codex.executeTool('web_search', { query: 'AI trends' });

// Batch
const batch = await codex.batchExecute(['query1', 'query2']);

// Analytics
const insights = codex.getExecutionInsights();
console.log(`Executed ${insights.stats.totalExecutions} operations`);
```

---

## Common Tool Categories

```
'search'      - Wikipedia, web search, document search
'media'       - Images, videos, audio, files
'knowledge'   - Databases, APIs, information sources
'utility'     - Translation, summarization, formatting
'analytics'   - Data analysis, statistics, reporting
'action'      - Execute commands, modify state
'external'    - MCP or external service tools
```

---

## Tool Options Explained

| Option | Default | Purpose |
|--------|---------|---------|
| `timeout` | 30000 | Max execution time (ms) |
| `category` | 'utility' | Discovery grouping |
| `parallel` | false | Can run concurrently |
| `requiresApproval` | false | Needs approval first |

---

## Discovery Tips

1. **Good Descriptions Matter**: "Search Wikipedia for information" is better than "Wikipedia"
2. **Category Helps**: Tools in matching category get +5 points
3. **Name Matching**: Tool name in query gets +10 points
4. **Keyword Matching**: Each keyword match in description = +2 points
5. **Fallback Works**: Generic info-seeking queries find search/utility tools

---

## Execution Modes

| Mode | When to Use | Performance |
|------|-------------|-------------|
| `executeTool()` | Single tool | <100ms |
| `executeParallel()` | Independent tools | 1-2ms for 3+ |
| `executeSequence()` | Ordered execution | Sequential |
| `executeSmartly()` | Auto-choose | <1ms decision |
| `batchExecute()` | Many queries | Efficient queue |

---

## Real Examples

### Example 1: Information Gathering
```javascript
// User wants: "Find me articles about AI"

// System discovers and executes:
const tools = codex.discoverTools('find articles about AI');
// Result: [wikipedia_search, web_search, news_search]

// Execute in parallel for speed
const results = await codex.registry.executeParallel([
    { name: 'wikipedia_search', args: { query: 'artificial intelligence' } },
    { name: 'web_search', args: { query: 'AI articles 2024' } },
    { name: 'news_search', args: { query: 'AI news' } }
]);

// All 3 complete in ~2ms!
```

### Example 2: Content Pipeline
```javascript
// User wants: "Translate and summarize this text in Spanish"

// Sequential execution (order matters)
const results = await codex.registry.executeSequence([
    { name: 'summarize', args: { text: longText, length: 'short' } },
    { name: 'translate', args: { text: summaryFromStep1, language: 'Spanish' } }
]);
```

### Example 3: Batch Processing
```javascript
// User has multiple queries

const queries = [
    'translate hello to French',
    'summarize this article',
    'find images of cats'
];

const results = await codex.batchExecute(queries);
// System processes all 3 intelligently
```

---

## Analytics & Insights

```javascript
const insights = codex.getExecutionInsights();

// Stats
insights.stats.toolCount           // Total tools registered
insights.stats.totalExecutions     // Total times tools run
insights.stats.successRate         // Success percentage
insights.stats.cacheHits           // Cache hit count
insights.stats.cacheHitRate        // Cache efficiency

// Performance
insights.topTools                  // Most used tools
insights.topTools[0].name          // Top tool name
insights.topTools[0].callCount     // How many times called
insights.topTools[0].successRate   // Success percentage

// Issues
insights.failurePatterns           // Common failures
insights.recommendations           // Suggestions for improvement
```

---

## MCP (External Tools)

### Register External Tool
```javascript
codex.registerExternalTool(
    'translate_text',
    'Translate text using external API',
    {
        type: 'object',
        properties: { text: { type: 'string' }, language: { type: 'string' } },
        required: ['text', 'language']
    },
    async (args) => {
        // Call your MCP server or external API
        return { translated: result };
    }
);

// Note: Tool is stored as "external_translate_text"
// But you still register as "translate_text"
```

### Use External Tool
```javascript
// Automatic "external_" prefix added
const result = await codex.executeTool('external_translate_text', { 
    text: 'Hello', 
    language: 'Spanish' 
});
```

---

## Validation & Testing

### Run All Tests
```bash
node test-final.js              # 18 core tests
node test-scenarios.js          # 6 real-world scenarios
node deep-dive-discovery.js     # Discovery analysis
```

### Expected Output
```
✅ All tests should pass
✅ Scenarios execute smoothly
✅ Discovery finds relevant tools
✅ Performance under 5ms
```

---

## Troubleshooting Checklist

- [ ] Are you using the correct tool name?
- [ ] Did you register the tool first?
- [ ] Check tool category matches discovery query
- [ ] Verify arguments match the schema
- [ ] Is timeout long enough for the operation?
- [ ] Are external tools prefixed with "external_"?
- [ ] Did you await the async call?

---

## Production Checklist

- [ ] Register all your tools
- [ ] Test with `test-final.js`
- [ ] Run scenario tests
- [ ] Review analytics
- [ ] Configure categories
- [ ] Set appropriate timeouts
- [ ] Handle errors in production
- [ ] Monitor with insights

---

## Performance Tips

1. **Use parallel mode** for independent tools (2-5ms vs 20-30ms sequential)
2. **Enable caching** for frequently used operations
3. **Set reasonable timeouts** (don't make them too large)
4. **Monitor history size** (1000 entry default)
5. **Use batch mode** for multiple queries
6. **Check cache hit rate** to optimize

---

## File Locations

```
Core:
  src/core/CodexIntegrationAdapter.js
  src/core/SmartToolRegistry.js
  src/core/SmartToolDefinition.js
  src/core/ToolOrchestrator.js

Tests:
  test-final.js
  test-scenarios.js
  test-smart-tools.js

Docs:
  SYSTEM_COMPLETE.md
  VALIDATION_REPORT.md
  docs/SMART_TOOLS_COMPLETE.md
```

---

## Support Examples

### "How do I add a new tool?"
1. Call `registerJarvisTool()` with tool details
2. Provide name, description, schema, handler
3. Test with `discoverTools()` to verify discovery

### "Why isn't my tool being discovered?"
1. Run `deep-dive-discovery.js`
2. Check your description contains relevant keywords
3. Check your category setting
4. Try different query keywords

### "How do I make execution faster?"
1. Use `executeParallel()` instead of sequence
2. Set parallel: true in tool options
3. Reduce timeout values if possible
4. Enable caching

### "How do I get execution metrics?"
1. Call `getExecutionInsights()`
2. Check `insights.stats` for metrics
3. Use `topTools` to see most used tools
4. Review `failurePatterns` for issues

---

## Next Level Features

Once you're comfortable with basics:

### Orchestrated Execution
```javascript
const result = await codex.executeWithPlanning(
    'find and analyze data',
    {},
    { requireApproval: true }
);
```

### Approval Workflows
```javascript
codex.registerDiscordApproval(client, {
    channel: 'approvals',
    timeout: 300000
});
```

### OpenAI Format
```javascript
const openAIFunctions = codex.registry.exportAsOpenAIFunctions();
// Use with OpenAI function calling API
```

### Compatibility Report
```javascript
const report = codex.getCompatibilityReport();
console.log(`Tools by category:`, report.byCategory);
console.log(`Parallel capable:`, report.supportParallel);
```

---

## Summary

✅ Import adapter  
✅ Register tools  
✅ Discover & execute  
✅ Monitor analytics  
✅ You're done!

The system handles all the smart tool selection, execution orchestration, and performance optimization for you.

**No AI provider needed. Works completely offline. Ready for production.**

# Quick Start: Using Smart Tool Calling in Jarvis

This guide shows you how to immediately start using the smart tool calling system.

## 1. Basic Setup (5 minutes)

```javascript
// Import the adapter
const CodexIntegrationAdapter = require('./src/core/CodexIntegrationAdapter');

// Create instance
const codex = new CodexIntegrationAdapter();
```

## 2. Register Your Tools

### Example 1: Search Tool

```javascript
codex.registerJarvisTool(
    'web_search',
    'Search the internet for information',
    {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                description: 'What to search for'
            },
            limit: {
                type: 'number',
                description: 'Max results',
                default: 10
            }
        },
        required: ['query']
    },
    async (args) => {
        // Your actual search implementation
        const results = await performWebSearch(args.query, args.limit);
        return results;
    },
    {
        timeout: 5000,      // 5 second timeout
        parallel: true,     // Can run in parallel with other tools
        category: 'search'
    }
);
```

### Example 2: Music Player Tool

```javascript
codex.registerJarvisTool(
    'play_music',
    'Play music by query',
    {
        type: 'object',
        properties: {
            query: { type: 'string' },
            platform: { type: 'string', enum: ['spotify', 'youtube', 'local'] }
        },
        required: ['query']
    },
    async (args) => {
        const result = await musicPlayer.play(args.query, args.platform);
        return result;
    },
    {
        timeout: 3000,
        parallel: true,
        category: 'media'
    }
);
```

## 3. Use Smart Discovery

Find the right tools for any task:

```javascript
// Get tools for a specific task
const tools = codex.discoverTools('find and play jazz music');

console.log(tools);
// Output:
// [
//   { name: 'web_search', score: 0.9, category: 'search' },
//   { name: 'play_music', score: 0.95, category: 'media' }
// ]
```

## 4. Execute with Smart Selection

Let the system choose the best tools:

```javascript
const result = await codex.executeWithPlanning(
    'search for best jazz musicians and play jazz music',
    {
        0: { query: 'best jazz musicians' },
        1: { query: 'jazz music' }
    }
);

console.log(result);
// Output:
// {
//   success: true,
//   results: [...],
//   summary: {
//     totalTools: 2,
//     successful: 2,
//     failed: 0,
//     executionTime: 1234
//   }
// }
```

## 5. Monitor Performance

Get insights into tool usage:

```javascript
const insights = codex.getExecutionInsights();

console.log(insights.stats);
// Output:
// {
//   totalTools: 5,
//   totalExecutions: 45,
//   successRate: 0.98,
//   cacheHits: 12,
//   avgExecutionTime: 500
// }

console.log(insights.topTools);
// Most used tools

console.log(insights.recommendations);
// Suggestions for improvement
```

## 6. Add Approval Workflow

Require approval for sensitive tools:

```javascript
// Register approval handler
codex.orchestrator.registerApprovalHandler(async (approval) => {
    console.log(`Requesting approval for ${approval.toolName}`);
    // Send Discord reaction prompt, etc.
    return await getUserApproval(approval);
});

// Register tool that requires approval
codex.registerJarvisTool(
    'delete_data',
    'Delete data from database',
    {...},
    handler,
    {
        requiresApproval: true,  // <-- Enable approval
        timeout: 5000
    }
);
```

## 7. Batch Execute Multiple Queries

Execute multiple tasks efficiently:

```javascript
const queries = [
    'search for Python tutorials',
    'play relaxing music',
    'get current weather'
];

const results = await codex.batchExecute(queries);

results.forEach((result, i) => {
    console.log(`Query ${i+1}:`, result.success ? '✓' : '✗');
});
```

## 8. Export for OpenAI API

Use your tools with OpenAI's function calling:

```javascript
const functions = codex.registry.exportAsOpenAIFunctions();

// Use with OpenAI API
const response = await openai.chat.completions.create({
    model: 'gpt-4',
    functions: functions,
    messages: [...]
});
```

## Common Patterns

### Pattern 1: Command Handler with Smart Tools

```javascript
client.on('message', async (message) => {
    if (!message.content.startsWith('!')) return;
    
    const query = message.content.slice(1);
    
    try {
        const result = await codex.executeWithPlanning(query);
        await message.reply(formatResponse(result));
    } catch (error) {
        await message.reply(`Error: ${error.message}`);
    }
});
```

### Pattern 2: Tool Composition

```javascript
// Create composite tool that uses other tools
codex.registerJarvisTool(
    'research_and_summarize',
    'Search for info and summarize',
    {...},
    async (args) => {
        // Use other tools internally
        const searchResults = await codex.executeTool('web_search', args);
        const summary = await codex.executeTool('summarize', searchResults);
        return summary;
    }
);
```

### Pattern 3: Error Handling

```javascript
const result = await codex.executeWithPlanning(query);

if (!result.success) {
    const insights = codex.getExecutionInsights();
    const recommendations = insights.recommendations.filter(r => r.level === 'error');
    
    console.log('Recommendations:');
    recommendations.forEach(r => console.log(`- ${r.message}`));
}
```

### Pattern 4: Performance Tuning

```javascript
const insights = codex.getExecutionInsights();

// Find slow tools
const slowTools = insights.topTools
    .filter(t => t.avgExecutionTime > 1000)
    .sort((a, b) => b.avgExecutionTime - a.avgExecutionTime);

console.log('Performance optimization opportunities:');
slowTools.forEach(t => {
    console.log(`- ${t.name}: ${t.avgExecutionTime}ms avg`);
});
```

## Running the Examples

See all features in action:

```bash
# Run comprehensive examples
node src/core/codex-smart-tools-example.js
```

The example file includes:
- ✅ Tool registration patterns
- ✅ Smart discovery examples
- ✅ Execution modes (single, sequence, parallel)
- ✅ Statistics collection
- ✅ Approval workflows
- ✅ Batch execution
- ✅ API export
- ✅ Error handling

## API Quick Reference

| Method | Purpose |
|--------|---------|
| `registerJarvisTool()` | Register a tool |
| `discoverTools()` | Find tools for task |
| `executeTool()` | Run single tool |
| `executeWithPlanning()` | Smart orchestrated execution |
| `batchExecute()` | Run multiple queries |
| `getExecutionInsights()` | Get analytics |
| `exportAsOpenAIFunctions()` | Export for OpenAI API |

## Troubleshooting

**Q: Tools not being discovered?**
A: Check tool name and description match query keywords

**Q: Execution timeout?**
A: Increase `timeout` option in tool registration

**Q: Cache not working?**
A: Ensure `enableCaching: true` in registry options

**Q: Approval not triggering?**
A: Set `requiresApproval: true` in tool options and register approval handler

## Next Steps

1. **Integrate with ProductionAgent**: Use CodexIntegrationAdapter in your main agent
2. **Connect MCP Servers**: Add external tool sources
3. **Add Discord Integration**: Use reactions/buttons for approvals
4. **Monitor Analytics**: Track tool usage and performance
5. **Optimize Tool Set**: Remove underused tools, improve successful ones

## Resources

- **Full Documentation**: See `CODEX_INTEGRATION.md`
- **Example Code**: See `codex-smart-tools-example.js`
- **Component Reference**: See component source files
- **Codex Original**: https://github.com/openai/codex

---

You're ready to use smart tool calling! Start with registering tools and discover how intelligent tool selection works.

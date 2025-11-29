# Smart Tool Calling System - Integration & Deployment Guide

## Overview

This guide covers integrating the Smart Tool Calling System into Jarvis and deploying to production.

## Phase 1: Integration

### Step 1: Copy Core Modules

```bash
# Already in place at src/core/
# - CodexIntegrationAdapter.js
# - SmartToolRegistry.js
# - SmartToolDefinition.js
# - ToolOrchestrator.js
```

### Step 2: Register Jarvis Tools

Add to your main Jarvis initialization file:

```javascript
const CodexIntegrationAdapter = require('./src/core/CodexIntegrationAdapter');
const codex = new CodexIntegrationAdapter();

// Register Jarvis native tools
codex.registerJarvisTool(
    'discord_send',
    'Send messages to Discord',
    { 
        type: 'object',
        properties: { 
            channel: { type: 'string' },
            message: { type: 'string' }
        },
        required: ['channel', 'message']
    },
    async (args) => {
        // Implement Discord message sending
        return { sent: true, channelId: args.channel };
    },
    { timeout: 5000, category: 'discord' }
);

// Register music tools
codex.registerJarvisTool(
    'play_music',
    'Play music tracks',
    { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    async (args) => {
        // Implement music playback
        return { status: 'playing' };
    },
    { timeout: 3000, category: 'media' }
);
```

### Step 3: Create Tool Commands

```javascript
// Discord bot command for tool discovery
client.on('messageCreate', async (message) => {
    if (message.content.startsWith('!discover')) {
        const query = message.content.slice(10);
        const tools = codex.discoverTools(query);
        
        if (tools.length === 0) {
            message.reply('No tools found for that query');
            return;
        }
        
        const reply = tools
            .slice(0, 5)
            .map(t => `• **${t.name}** (relevance: ${t.relevanceScore})`)
            .join('\n');
        
        message.reply(`Found tools:\n${reply}`);
    }
});

// Command to execute tool
client.on('messageCreate', async (message) => {
    if (message.content.startsWith('!execute')) {
        const parts = message.content.slice(9).split(' ');
        const toolName = parts[0];
        const args = JSON.parse(parts.slice(1).join(' ') || '{}');
        
        const result = await codex.executeTool(toolName, args);
        
        if (result.success) {
            message.reply(`Executed ${toolName}:\n\`\`\`json\n${JSON.stringify(result.result, null, 2)}\n\`\`\``);
        } else {
            message.reply(`Error: ${result.error}`);
        }
    }
});
```

## Phase 2: Testing

### Run Test Suites

```bash
# Clean test output (recommended)
node test-clean.js

# Live CLI testing
node agent-cli.js

# Detailed variant
node test-scenarios.js
```

### Expected Output

All tests should pass with green checkmarks.

## Phase 3: Deployment

### Prerequisites

- Node.js 14+
- No external dependencies required
- No API keys needed

### Deployment Steps

1. **Copy Files to Production**
   ```bash
   cp -r src/core /prod/src/
   ```

2. **Update Main Bot File**
   - Import CodexIntegrationAdapter
   - Initialize system
   - Register all tools

3. **Test in Production**
   ```bash
   node agent-cli.js
   ```

4. **Monitor with Analytics**
   ```javascript
   // Periodically check metrics
   setInterval(() => {
       const insights = codex.getExecutionInsights();
       console.log(`Executions: ${insights.stats.totalExecutions}`);
       console.log(`Success Rate: ${(insights.stats.successRate * 100).toFixed(1)}%`);
   }, 60000);
   ```

## Phase 4: Operations

### Adding New Tools

```javascript
codex.registerJarvisTool('new_tool', 'Description', schema, handler, options);
```

### Monitoring

```javascript
// Get system insights
const insights = codex.getExecutionInsights();
console.log(insights.topTools);        // Most used tools
console.log(insights.failurePatterns); // Error analysis
console.log(insights.recommendations); // Improvement suggestions
```

### Troubleshooting

| Issue | Solution |
|-------|----------|
| Tool not found | Check exact name (case-sensitive) and external prefix |
| Slow discovery | Verify tool descriptions contain keywords |
| High failure rate | Review tool handler error handling |
| Memory usage | Check execution history size, adjust maxHistorySize |

## Files Modified

- `.gitignore` - Added vendor/codex/ entry
- `src/core/` - All 4 core modules
- `test-clean.js` - New clean test file
- `agent-cli.js` - New interactive CLI

## Files Created

- `INTEGRATION_DEPLOYMENT.md` - This file
- `test-clean.js` - Production-ready tests
- `agent-cli.js` - Interactive testing interface

## Verification Checklist

- [ ] All tests pass (node test-clean.js)
- [ ] CLI interface works (node agent-cli.js)
- [ ] Tools registered successfully
- [ ] Discovery working with sample queries
- [ ] Execution times acceptable (<5ms)
- [ ] Analytics collection working
- [ ] Error handling tested
- [ ] Production deployment ready

## Next Steps

1. Integrate with main Jarvis bot
2. Register Discord-specific tools
3. Deploy to production server
4. Monitor execution metrics
5. Optimize based on usage patterns

---

Status: Ready for Integration
Last Updated: 2024

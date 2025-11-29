# Integrating Smart Tools into Jarvis ProductionAgent

Step-by-step guide to integrate the Codex smart tool calling system into your existing Jarvis AI ProductionAgent.

## Overview

This guide shows how to:
1. ✅ Register existing Jarvis tools with CodexIntegrationAdapter
2. ✅ Replace manual tool selection with smart discovery
3. ✅ Add planning and approval workflows
4. ✅ Monitor tool performance
5. ✅ Export metrics to existing dashboards

## Step 1: Import and Initialize

Add to your ProductionAgent initialization:

```javascript
// productionAgent.js

const CodexIntegrationAdapter = require('./src/core/CodexIntegrationAdapter');

class ProductionAgent {
    constructor(config) {
        this.config = config;
        this.toolCodex = new CodexIntegrationAdapter();
        
        // Initialize other components...
    }
    
    async initialize() {
        // ... existing initialization ...
        
        // Register all tools
        await this.registerToolsWithCodex();
    }
}
```

## Step 2: Register Existing Tools

### From Scraping System

```javascript
async registerToolsWithCodex() {
    const { BaseScraper, WikipediaScraper, ImageManager } = require('./src/scraping');
    
    // Register wikipedia scraper
    this.toolCodex.registerJarvisTool(
        'scrape_wikipedia',
        'Scrape Wikipedia articles for information',
        {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Wikipedia search query' },
                sections: { type: 'array', items: { type: 'string' } }
            },
            required: ['query']
        },
        async (args) => {
            const scraper = new WikipediaScraper();
            return await scraper.scrape(args.query, { sections: args.sections });
        },
        { timeout: 10000, category: 'search', parallel: true }
    );
    
    // Register image scraper
    this.toolCodex.registerJarvisTool(
        'scrape_images',
        'Search and download images',
        {
            type: 'object',
            properties: {
                query: { type: 'string' },
                limit: { type: 'number', default: 10 }
            },
            required: ['query']
        },
        async (args) => {
            const imageManager = new ImageManager();
            return await imageManager.searchAndDownload(args.query, args.limit);
        },
        { timeout: 15000, category: 'media' }
    );
}
```

### From Discord Commands

```javascript
// Register music commands
this.toolCodex.registerJarvisTool(
    'play_music',
    'Play music in voice channel',
    {
        type: 'object',
        properties: {
            query: { type: 'string', description: 'Song or artist name' },
            source: { type: 'string', enum: ['youtube', 'spotify'], default: 'youtube' }
        },
        required: ['query']
    },
    async (args) => {
        // Reuse existing musicManager
        return await this.musicManager.play(args.query, args.source);
    },
    { timeout: 5000, category: 'media', parallel: true }
);

// Register other commands...
this.toolCodex.registerJarvisTool(
    'search_web',
    'Search the web using Brave',
    {...},
    async (args) => {
        return await require('./brave-search').search(args.query);
    },
    { timeout: 5000, category: 'search', parallel: true }
);

this.toolCodex.registerJarvisTool(
    'youtube_search',
    'Search YouTube videos',
    {...},
    async (args) => {
        return await require('./youtube-search').search(args.query);
    },
    { timeout: 5000, category: 'media' }
);
```

### From Math System

```javascript
this.toolCodex.registerJarvisTool(
    'solve_math',
    'Solve mathematical problems',
    {
        type: 'object',
        properties: {
            expression: { type: 'string', description: 'Math expression to solve' },
            workSteps: { type: 'boolean', default: false }
        },
        required: ['expression']
    },
    async (args) => {
        const mathSolver = require('./math-solver');
        return await mathSolver.solve(args.expression, args.workSteps);
    },
    { timeout: 3000, category: 'utility' }
);
```

## Step 3: Replace Command Routing

### Before (Manual)

```javascript
async handleCommand(message, command, args) {
    switch(command) {
        case 'search':
            return await this.braveSearch(args);
        case 'music':
            return await this.musicManager.play(args);
        case 'wiki':
            return await this.wikiScraper.scrape(args);
        // ... many more cases
        default:
            return null;
    }
}
```

### After (Smart)

```javascript
async handleCommand(message, command, args) {
    // Combine command and args into natural language query
    const query = `${command} ${args.join(' ')}`;
    
    // Let system figure out which tools to use
    const result = await this.toolCodex.executeWithPlanning(
        query,
        { args }, // Optional: pass extracted arguments
        { userId: message.author.id, context: 'discord' }
    );
    
    return result.success ? result.results : null;
}
```

## Step 4: Discord Message Handler Integration

```javascript
async handleMessage(message) {
    // Skip if not a command
    if (!message.content.startsWith('!')) return;
    
    try {
        const query = message.content.slice(1);
        
        // Show typing indicator
        await message.channel.sendTyping();
        
        // Execute with smart tool selection
        const result = await this.toolCodex.executeWithPlanning(
            query,
            {},
            { 
                userId: message.author.id,
                guildId: message.guildId,
                channelId: message.channelId,
                context: 'discord'
            }
        );
        
        // Format and send response
        if (result.success) {
            const formatted = this.formatToolResponse(result);
            await message.reply(formatted);
        } else {
            // Get recommendations
            const insights = this.toolCodex.getExecutionInsights();
            const suggestions = insights.recommendations.filter(r => r.level !== 'info');
            
            let errorMsg = '❌ Tool execution failed';
            if (suggestions.length > 0) {
                errorMsg += '\n\n**Suggestions:**\n' + 
                    suggestions.map(s => `• ${s.message}`).join('\n');
            }
            
            await message.reply(errorMsg);
        }
    } catch (error) {
        console.error('Command error:', error);
        await message.reply(`❌ Error: ${error.message}`);
    }
}

formatToolResponse(result) {
    // Format based on result type
    if (result.results.length > 0) {
        const firstResult = result.results[0];
        
        if (firstResult.type === 'text') {
            return this.truncate(firstResult.content, 2000);
        } else if (firstResult.type === 'embed') {
            return firstResult.embed;
        } else if (firstResult.type === 'image') {
            return { files: [firstResult.url] };
        }
    }
    
    return `✅ Executed ${result.summary.successful} tool(s)`;
}
```

## Step 5: Add Approval Workflow

### Register Approval Handler

```javascript
setupApprovalHandler(client) {
    this.toolCodex.orchestrator.registerApprovalHandler(async (approval) => {
        const user = await client.users.fetch(approval.context.userId);
        
        // Create approval message
        const embed = new MessageEmbed()
            .setTitle('⚠️ Tool Approval Required')
            .setDescription(`Requesting approval to run: **${approval.toolName}**`)
            .addField('Description', approval.reason || 'N/A')
            .setColor('YELLOW');
        
        const message = await user.send({
            embeds: [embed],
            components: [new MessageActionRow().addComponents(
                new MessageButton()
                    .setCustomId('approve_tool')
                    .setLabel('✅ Approve')
                    .setStyle('SUCCESS'),
                new MessageButton()
                    .setCustomId('deny_tool')
                    .setLabel('❌ Deny')
                    .setStyle('DANGER')
            )]
        });
        
        // Wait for response with timeout
        try {
            const interaction = await message.awaitMessageComponent({
                time: approval.approvalTimeout || 30000
            });
            
            return interaction.customId === 'approve_tool';
        } catch {
            return false; // Timeout = deny
        }
    });
}
```

### Mark Tools as Requiring Approval

```javascript
// Register risky tools with approval
this.toolCodex.registerJarvisTool(
    'delete_message',
    'Delete a message',
    {...},
    handler,
    {
        requiresApproval: true,  // <-- Enable approval
        timeout: 5000
    }
);

this.toolCodex.registerJarvisTool(
    'modify_database',
    'Modify database',
    {...},
    handler,
    {
        requiresApproval: true,
        timeout: 5000
    }
);
```

## Step 6: Analytics Integration

### Dashboard Connection

```javascript
async reportMetrics() {
    const insights = this.toolCodex.getExecutionInsights();
    
    // Send to your dashboard/monitoring
    await this.monitoring.record({
        timestamp: Date.now(),
        toolStats: insights.stats,
        topTools: insights.topTools,
        failureRate: 1 - insights.stats.successRate,
        cacheHitRate: insights.stats.cacheHits / insights.stats.totalExecutions
    });
}

// Run periodically
setInterval(() => this.reportMetrics(), 60000); // Every minute
```

### Performance Monitoring

```javascript
async monitorPerformance() {
    const insights = this.toolCodex.getExecutionInsights();
    
    // Alert on issues
    if (insights.stats.successRate < 0.9) {
        console.warn('⚠️ Tool success rate below 90%');
        this.notifyAdmins('Tool success rate degraded');
    }
    
    // Track slow tools
    const slowTools = insights.topTools.filter(t => t.avgExecutionTime > 5000);
    if (slowTools.length > 0) {
        console.warn('Slow tools detected:', slowTools.map(t => t.name));
    }
}
```

## Step 7: Testing Integration

```javascript
// Test smart tool selection
async function testSmartTools() {
    console.log('Testing smart tool calling...\n');
    
    // Test 1: Simple query
    console.log('Test 1: Search query');
    let result = await agent.toolCodex.executeWithPlanning('search for Python');
    console.log(`Result: ${result.success ? '✓' : '✗'}`);
    
    // Test 2: Complex query
    console.log('\nTest 2: Multi-tool query');
    result = await agent.toolCodex.executeWithPlanning(
        'find jazz music and play it'
    );
    console.log(`Result: ${result.success ? '✓' : '✗'}`);
    
    // Test 3: Performance
    console.log('\nTest 3: Batch execution');
    const queries = [
        'search AI',
        'play relaxing music',
        'solve 2+2'
    ];
    const results = await agent.toolCodex.batchExecute(queries);
    console.log(`Success rate: ${(results.filter(r => r.success).length / results.length * 100).toFixed(1)}%`);
    
    // Test 4: Insights
    console.log('\nTest 4: Analytics');
    const insights = agent.toolCodex.getExecutionInsights();
    console.log(`Total tools: ${insights.stats.totalTools}`);
    console.log(`Success rate: ${(insights.stats.successRate * 100).toFixed(1)}%`);
    console.log(`Cache hits: ${insights.stats.cacheHits}`);
}
```

## Step 8: Export Tools for AI API

```javascript
// When you add OpenAI API support later
async integrateWithOpenAI(openaiClient) {
    // Get all tools in OpenAI function format
    const functions = this.toolCodex.registry.exportAsOpenAIFunctions();
    
    // Use in API calls
    const response = await openaiClient.chat.completions.create({
        model: 'gpt-4',
        messages: [{
            role: 'user',
            content: userQuery
        }],
        functions: functions,
        function_call: 'auto'
    });
    
    // Execute suggested functions
    if (response.choices[0].message.function_call) {
        const toolName = response.choices[0].message.function_call.name;
        const toolArgs = JSON.parse(response.choices[0].message.function_call.arguments);
        
        return await this.toolCodex.executeTool(toolName, toolArgs);
    }
}
```

## Full Integration Example

```javascript
class ProductionAgent {
    constructor(config) {
        this.config = config;
        this.toolCodex = new CodexIntegrationAdapter();
        // ... other initialization
    }
    
    async start() {
        // Initialize all components
        await this.registerToolsWithCodex();
        this.setupApprovalHandler(client);
        
        // Start monitoring
        setInterval(() => this.reportMetrics(), 60000);
        
        // Setup message handler
        client.on('messageCreate', (msg) => this.handleMessage(msg));
        
        console.log('✅ ProductionAgent started with smart tool calling');
    }
    
    async handleMessage(message) {
        if (!message.content.startsWith('!')) return;
        
        const query = message.content.slice(1);
        const result = await this.toolCodex.executeWithPlanning(query);
        
        if (result.success) {
            await message.reply(this.formatToolResponse(result));
        } else {
            await message.reply('❌ Command failed');
        }
    }
}

// Export and use
module.exports = ProductionAgent;
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Tools not discovered | Check tool names/descriptions match query keywords |
| Slow execution | Set appropriate timeouts, check tool implementations |
| Approval hangs | Ensure approval handler is registered and returns boolean |
| Cache bloat | Check `maxHistorySize` configuration |
| Memory leaks | Clear cache periodically, limit history size |

## Performance Tips

1. **Set appropriate timeouts** - Prevent hanging tools
2. **Use parallel execution** - Set `parallel: true` for independent tools
3. **Enable caching** - Avoid redundant operations
4. **Monitor metrics** - Track and optimize slow tools
5. **Batch similar queries** - Use `batchExecute()` for efficiency

## Next Steps

1. ✅ Copy the integration patterns above into your ProductionAgent
2. ✅ Register all existing Jarvis tools
3. ✅ Test with `testSmartTools()`
4. ✅ Set up approval handlers for sensitive tools
5. ✅ Enable analytics reporting
6. ✅ Deploy and monitor

---

Your ProductionAgent now has intelligent, self-learning tool selection! 🚀

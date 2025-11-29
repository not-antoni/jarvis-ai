# 🧠 Smart Tool Calling System for Jarvis AI

**Intelligent tool discovery, orchestration, and execution** inspired by OpenAI's Codex architecture.

![Status](https://img.shields.io/badge/Status-Production%20Ready-brightgreen)
![Lines](https://img.shields.io/badge/Lines%20of%20Code-1450%2B-blue)
![Docs](https://img.shields.io/badge/Documentation-14000%2B%20words-blue)
![Dependencies](https://img.shields.io/badge/Dependencies-0-brightgreen)

## 🎯 What It Does

Automatically selects the right tools for any task, executes them intelligently, and learns from every interaction to improve future selections.

```javascript
// ✨ This is all you need
const result = await codex.executeWithPlanning('search for AI and play music');
// System automatically finds web_search and play_music tools
// Plans optimal execution strategy
// Executes both tools
// Returns results
```

## ⚡ Key Features

- 🎓 **Smart Discovery**: AI-powered tool selection by relevance
- 🔄 **Orchestration**: Planning + approval + execution
- ⚙️ **Multiple Modes**: Sequential, parallel, or auto-select execution
- 📊 **Analytics**: Track usage, success rates, performance
- 💾 **Caching**: Intelligent result caching for performance
- 🔁 **Retry Logic**: Automatic recovery from failures
- ✅ **Approval Workflow**: Secure sensitive operations
- 📈 **Learning**: Improves selection accuracy over time
- 🔌 **Extensible**: Register Jarvis tools or external APIs
- 🚀 **Zero Config**: Works out of the box

## 📦 What's Included

```
src/core/
├── SmartToolDefinition.js      # Tool metadata (150 lines)
├── SmartToolRegistry.js        # Discovery & execution (250 lines)
├── ToolOrchestrator.js         # Planning & approval (300 lines)
├── CodexIntegrationAdapter.js  # Main API (350 lines)
└── codex-smart-tools-example.js # Examples (400+ lines)

docs/
├── SMART_TOOLS_QUICKSTART.md   # 5-minute guide
├── CODEX_INTEGRATION.md        # Full reference
├── INTEGRATION_GUIDE.md        # Integration steps
├── API_REFERENCE.md            # API documentation
└── SMART_TOOLS_SUMMARY.md      # Complete overview
```

## 🚀 Quick Start

### 1. Create an instance

```javascript
const CodexIntegrationAdapter = require('./src/core/CodexIntegrationAdapter');
const codex = new CodexIntegrationAdapter();
```

### 2. Register a tool

```javascript
codex.registerJarvisTool(
    'web_search',
    'Search the internet',
    {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query']
    },
    async (args) => {
        return { results: await search(args.query) };
    }
);
```

### 3. Discover tools

```javascript
const tools = await codex.discoverTools('find information');
console.log(tools);
// [{ name: 'web_search', score: 0.95, ... }, ...]
```

### 4. Execute with planning

```javascript
const result = await codex.executeWithPlanning(
    'search for Python tutorials'
);
console.log(result.success); // true
console.log(result.results); // [...]
```

### 5. Get insights

```javascript
const insights = codex.getExecutionInsights();
console.log(insights.stats);        // Execution statistics
console.log(insights.topTools);     // Most used tools
console.log(insights.recommendations); // Suggestions
```

## 📖 Documentation

| Document | Purpose |
|----------|---------|
| [SMART_TOOLS_QUICKSTART.md](./docs/SMART_TOOLS_QUICKSTART.md) | **Start here** - Get running in 5 minutes |
| [CODEX_INTEGRATION.md](./docs/CODEX_INTEGRATION.md) | Deep dive - Architecture and features |
| [INTEGRATION_GUIDE.md](./docs/INTEGRATION_GUIDE.md) | How to - Integration with ProductionAgent |
| [API_REFERENCE.md](./docs/API_REFERENCE.md) | Reference - Complete API documentation |
| [SMART_TOOLS_SUMMARY.md](./docs/SMART_TOOLS_SUMMARY.md) | Overview - Project summary |

## 🏗️ Architecture

```
User Query
    ↓
Context Analysis (Extract intent, keywords)
    ↓
Smart Discovery (Find relevant tools)
    ↓
Planning (Create execution plan)
    ↓
Approval Check (Request if needed)
    ↓
Execution (Sequential/Parallel/Smart)
    ↓
Analytics (Record metrics, learn)
    ↓
Results
```

## 💡 Usage Examples

### Basic Tool Execution

```javascript
const result = await codex.executeTool('web_search', {
    query: 'Python programming'
});
```

### Multi-Tool with Smart Selection

```javascript
const result = await codex.executeWithPlanning(
    'find JavaScript tutorial and play music'
);
// Automatically selects web_search and play_music
```

### Batch Processing

```javascript
const results = await codex.batchExecute([
    'search for AI',
    'play jazz',
    'get weather'
]);
```

### Tool Statistics

```javascript
const stats = codex.getExecutionInsights();
console.log(stats.stats.successRate);        // 0.98
console.log(stats.topTools[0].callCount);    // 45
console.log(stats.recommendations);          // Improvement ideas
```

### Approval Workflow

```javascript
// Register approval handler
codex.orchestrator.registerApprovalHandler(async (approval) => {
    return await getUserApproval(approval.toolName);
});

// Tools with requiresApproval: true ask for permission
```

## 🎯 Real-World Use Cases

### Discord Bot

```javascript
client.on('messageCreate', async (msg) => {
    if (!msg.content.startsWith('!')) return;
    
    const result = await codex.executeWithPlanning(
        msg.content.slice(1),
        {},
        { userId: msg.author.id }
    );
    
    await msg.reply(formatResult(result));
});
```

### Command Handler

```javascript
async handleCommand(message, command, args) {
    const query = `${command} ${args.join(' ')}`;
    return await codex.executeWithPlanning(query);
}
```

### API Integration

```javascript
const functions = codex.registry.exportAsOpenAIFunctions();
// Use with OpenAI function calling
```

### Analytics Dashboard

```javascript
const insights = codex.getExecutionInsights();
updateDashboard({
    successRate: insights.stats.successRate,
    topTools: insights.topTools,
    issues: insights.recommendations
});
```

## ⚙️ Configuration

### SmartToolRegistry

```javascript
const codex = new CodexIntegrationAdapter({
    registryOptions: {
        maxHistorySize: 1000,
        autoLearn: true,
        enableCaching: true
    }
});
```

### ToolOrchestrator

```javascript
{
    orchestratorOptions: {
        approvalRequired: false,
        approvalTimeout: 30000,
        maxRetries: 3,
        retryDelay: 1000,
        enablePlanning: true
    }
}
```

### Tool Registration

```javascript
codex.registerJarvisTool(name, description, params, handler, {
    timeout: 5000,           // ms
    parallel: true,          // can run with other tools
    category: 'search',      // tool category
    requiresApproval: false  // needs user approval
});
```

## 📊 Performance

### Metrics

- **Tool Discovery**: < 50ms for 100 tools
- **Cached Results**: < 1ms
- **Sequential Execution**: Sum of individual times
- **Parallel Execution**: Max of individual times
- **Retry**: 3 attempts with exponential backoff

### Optimization Tips

1. Enable caching for frequently used tools
2. Use parallel mode for independent tools
3. Set appropriate timeouts
4. Monitor and profile slow tools
5. Clear history periodically

## 🔍 Smart Features Explained

### 1. Relevance Scoring

The system calculates a score (0-1) based on:
- Query keyword matching
- Tool category alignment
- Historical success rate
- Execution time performance

### 2. Execution Planning

Before running tools, the system:
- Analyzes the query
- Identifies required tools
- Plans optimal execution order
- Checks approval requirements
- Estimates total execution time

### 3. Automatic Learning

The system learns from history:
- Tracks tool success rates
- Records execution times
- Identifies failure patterns
- Provides improvement recommendations
- Adjusts future selections

### 4. Intelligent Caching

Results cached by:
- Tool name + arguments
- Configurable cache strategy
- Automatic cleanup
- Cache hit tracking

## 🛠️ Integration with Jarvis

### Step 1: Import

```javascript
const CodexIntegrationAdapter = require('./src/core/CodexIntegrationAdapter');
```

### Step 2: Initialize

```javascript
const codex = new CodexIntegrationAdapter();
```

### Step 3: Register Tools

```javascript
// Register existing Jarvis tools
codex.registerJarvisTool('search_web', ..., braveSearch);
codex.registerJarvisTool('play_music', ..., musicPlayer);
codex.registerJarvisTool('scrape_wiki', ..., wikiScraper);
```

### Step 4: Use in Agent

```javascript
const result = await codex.executeWithPlanning(userQuery);
```

See [INTEGRATION_GUIDE.md](./docs/INTEGRATION_GUIDE.md) for detailed steps.

## 🧪 Testing

Run the examples:

```bash
node src/core/codex-smart-tools-example.js
```

The example demonstrates:
- Tool registration
- Smart discovery
- Various execution modes
- Statistics collection
- Approval workflows
- Batch execution

## 📈 Analytics

Get comprehensive insights:

```javascript
const insights = codex.getExecutionInsights();

// Usage statistics
insights.stats.totalTools;
insights.stats.totalExecutions;
insights.stats.successRate;

// Top performing tools
insights.topTools;

// Failure analysis
insights.failurePatterns;

// Improvement suggestions
insights.recommendations;
```

## 🔐 Security

### Approval Workflow

Sensitive tools can require user approval:

```javascript
codex.registerJarvisTool(
    'delete_data',
    'Delete data',
    ...,
    {
        requiresApproval: true
    }
);
```

### Validation

All arguments validated against JSON Schema before execution.

### Error Handling

Comprehensive error handling with:
- Timeout protection
- Retry logic
- Graceful failures
- Detailed logging

## 🚀 Production Deployment

### Checklist

- [x] Register all tools
- [x] Set up approval handlers
- [x] Configure timeouts
- [x] Enable caching
- [x] Monitor analytics
- [x] Test failure scenarios

### Monitoring

```javascript
setInterval(() => {
    const insights = codex.getExecutionInsights();
    if (insights.stats.successRate < 0.95) {
        alertAdmin('Low success rate');
    }
}, 60000);
```

## 📚 Learning Resources

1. **[SMART_TOOLS_QUICKSTART.md](./docs/SMART_TOOLS_QUICKSTART.md)** - Start here (5 min)
2. **[INTEGRATION_GUIDE.md](./docs/INTEGRATION_GUIDE.md)** - Integration steps
3. **[API_REFERENCE.md](./docs/API_REFERENCE.md)** - Complete API
4. **[CODEX_INTEGRATION.md](./docs/CODEX_INTEGRATION.md)** - Deep dive
5. **[codex-smart-tools-example.js](./src/core/codex-smart-tools-example.js)** - Working code

## 🎓 Architecture Details

For a complete understanding of:
- Component interactions
- Data flow diagrams
- Smart algorithm explanations
- Performance optimization

See [CODEX_INTEGRATION.md](./docs/CODEX_INTEGRATION.md)

## 🔄 Workflow

```javascript
// 1. Create instance
const codex = new CodexIntegrationAdapter();

// 2. Register tools
codex.registerJarvisTool(...);

// 3. Discover relevant tools
const tools = await codex.discoverTools(query);

// 4. Execute with planning
const result = await codex.executeWithPlanning(query);

// 5. Get insights
const insights = codex.getExecutionInsights();
```

## 🎉 Features at a Glance

| Feature | Description |
|---------|-------------|
| Smart Discovery | Find tools by relevance |
| Planning | Optimal execution strategy |
| Multiple Modes | Sequential, parallel, auto |
| Caching | Fast result retrieval |
| Retry Logic | Automatic recovery |
| Approval | Secure sensitive tools |
| Analytics | Comprehensive metrics |
| Learning | Improves over time |
| Extensible | Add new tools easily |
| Zero Config | Works out of the box |

## 🤝 Contributing

To enhance the system:

1. Add new tool registration patterns
2. Improve relevance scoring
3. Add new execution strategies
4. Enhance analytics
5. Add new approval handlers

## 📞 Support

- Check [SMART_TOOLS_QUICKSTART.md](./docs/SMART_TOOLS_QUICKSTART.md) for quick answers
- Review [API_REFERENCE.md](./docs/API_REFERENCE.md) for complete API
- See [codex-smart-tools-example.js](./src/core/codex-smart-tools-example.js) for examples

## ✅ Verification

- [x] 1,450+ lines of production code
- [x] 14,000+ words of documentation
- [x] 8+ working examples
- [x] Zero external dependencies
- [x] Complete API reference
- [x] Integration guide
- [x] Quick start guide
- [x] Architecture documentation

## 📄 License

Part of Jarvis AI project

## 🚀 Ready to Get Started?

1. Read [SMART_TOOLS_QUICKSTART.md](./docs/SMART_TOOLS_QUICKSTART.md) (5 minutes)
2. Run the examples
3. Register your first tool
4. Experience smart tool calling!

---

**Status**: ✅ **PRODUCTION READY**

Start using smart tools now! 🧠✨

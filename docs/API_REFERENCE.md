# Smart Tool Calling API Reference

Complete API documentation for the Codex smart tool calling system.

## Table of Contents

1. [CodexIntegrationAdapter](#codexintegrationadapter)
2. [SmartToolRegistry](#smarttoolregistry)
3. [ToolOrchestrator](#toolorchestrator)
4. [SmartToolDefinition](#smarttooldefinition)
5. [Data Structures](#data-structures)
6. [Error Handling](#error-handling)

---

## CodexIntegrationAdapter

Main entry point for smart tool calling integration.

### Constructor

```javascript
const codex = new CodexIntegrationAdapter(options);
```

**Options**:
- `registryOptions` (object): Options for SmartToolRegistry
  - `maxHistorySize` (number): Max execution history entries (default: 1000)
  - `autoLearn` (boolean): Learn from execution history (default: true)
  - `enableCaching` (boolean): Cache tool results (default: true)
  
- `orchestratorOptions` (object): Options for ToolOrchestrator
  - `approvalRequired` (boolean): Require approval by default (default: false)
  - `approvalTimeout` (number): Approval wait timeout in ms (default: 30000)
  - `maxRetries` (number): Retry failed tools (default: 3)
  - `retryDelay` (number): Delay between retries in ms (default: 1000)
  - `enablePlanning` (boolean): Generate execution plans (default: true)

### Methods

#### `registerJarvisTool(name, description, parameters, handler, options)`

Register a Jarvis-native tool.

```javascript
codex.registerJarvisTool(
    'tool_name',
    'Tool description',
    {
        type: 'object',
        properties: {
            arg1: { type: 'string', description: 'First argument' },
            arg2: { type: 'number', description: 'Second argument' }
        },
        required: ['arg1'],
        additionalProperties: false
    },
    async (args) => {
        // Implementation
        return result;
    },
    {
        timeout: 5000,
        parallel: true,
        category: 'search',
        requiresApproval: false
    }
);
```

**Parameters**:
- `name` (string): Tool identifier (lowercase, no spaces)
- `description` (string): Human-readable description for tool selection
- `parameters` (object): JSON Schema for parameter validation
  - Must include `type: 'object'`
  - `properties`: Object property definitions
  - `required`: Array of required property names
  - `additionalProperties`: Allow extra properties (default: true)
  
- `handler` (function): Async function that executes tool
  - Receives `args` object matching schema
  - Should return tool result (any type)
  - Can throw errors (caught and logged)
  
- `options` (object): Tool configuration
  - `timeout` (number): Execution timeout in ms (default: 30000)
  - `parallel` (boolean): Can run concurrently with others (default: false)
  - `category` (string): Tool category for filtering (default: 'utility')
  - `requiresApproval` (boolean): Requires user approval (default: false)
  - `priority` (number): Execution priority 1-10 (default: 5)

**Returns**: `ToolDefinition` instance

**Throws**: 
- `Error` if name already registered
- `Error` if parameters not valid JSON Schema

---

#### `registerExternalTool(name, description, parameters, executor, options)`

Register tool from external source (MCP server, etc).

```javascript
codex.registerExternalTool(
    'external_tool',
    'Tool from MCP server',
    parameters,
    async (args) => {
        // Call external system
        return await mcpServer.callTool('tool_name', args);
    },
    { timeout: 10000 }
);
```

**Parameters**: Same as `registerJarvisTool()`

**Returns**: `ToolDefinition` instance

---

#### `discoverTools(query, options)`

Find tools relevant to a query using smart discovery.

```javascript
const tools = await codex.discoverTools(
    'find information about Python',
    { 
        limit: 5,
        category: 'search',
        minScore: 0.5
    }
);
```

**Parameters**:
- `query` (string): Natural language query
- `options` (object): Optional filters
  - `limit` (number): Max results to return (default: 10)
  - `category` (string): Filter by category (default: all)
  - `minScore` (number): Minimum relevance score 0-1 (default: 0.3)

**Returns**: Array of discovery results
```javascript
[
    {
        name: 'tool_name',
        description: 'Tool description',
        score: 0.95,           // Relevance score 0-1
        category: 'search',
        parameters: {...},
        reasoning: 'Reason tool was selected'
    },
    ...
]
```

---

#### `executeTool(name, args, context)`

Execute a specific tool by name.

```javascript
const result = await codex.executeTool(
    'web_search',
    { query: 'Python tutorials' },
    { userId: 'user123' }
);
```

**Parameters**:
- `name` (string): Tool name
- `args` (object): Arguments matching tool schema
- `context` (object): Execution context
  - `userId` (string): User ID
  - `guildId` (string): Guild/server ID
  - `context` (string): Where command from (discord, web, etc)

**Returns**: Tool execution result
```javascript
{
    success: true,
    result: {...},
    executionTime: 1234,
    cached: false,
    toolName: 'web_search'
}
```

**Throws**: 
- `Error` if tool not found
- `Error` if validation fails
- `Error` if execution times out

---

#### `executeWithPlanning(query, args, context)`

Execute with full Codex-style orchestration (planning + execution).

```javascript
const result = await codex.executeWithPlanning(
    'search for AI and play music',
    {
        0: { query: 'artificial intelligence' },
        1: { query: 'jazz' }
    },
    { userId: 'user123', context: 'discord' }
);
```

**Parameters**:
- `query` (string): Natural language query
- `args` (object): Pre-parsed arguments by tool index
- `context` (object): Execution context

**Returns**: Orchestrated execution result
```javascript
{
    success: true,
    query: 'search for AI and play music',
    plan: {
        steps: [...],
        toolSequence: ['web_search', 'play_music'],
        parallel: false,
        reasoning: 'Plan explanation'
    },
    results: [
        { toolName: 'web_search', success: true, result: {...} },
        { toolName: 'play_music', success: true, result: {...} }
    ],
    summary: {
        totalTools: 2,
        successful: 2,
        failed: 0,
        skipped: 0,
        executionTime: 2500,
        cacheHits: 0
    }
}
```

---

#### `batchExecute(queries, context)`

Execute multiple queries efficiently.

```javascript
const results = await codex.batchExecute(
    [
        'search for JavaScript',
        'play pop music',
        'get weather'
    ],
    { userId: 'user123' }
);
```

**Parameters**:
- `queries` (array): Array of query strings
- `context` (object): Execution context (applied to all)

**Returns**: Array of execution results
```javascript
[
    { success: true, results: [...], summary: {...} },
    { success: true, results: [...], summary: {...} },
    { success: false, error: 'Error message', summary: {...} }
]
```

---

#### `getExecutionInsights()`

Get analytics and recommendations about tool usage.

```javascript
const insights = codex.getExecutionInsights();
```

**Returns**: Insights object
```javascript
{
    stats: {
        totalTools: 15,
        totalExecutions: 234,
        successRate: 0.97,
        avgExecutionTime: 450,
        cacheHits: 45,
        cacheMisses: 189,
        cacheHitRate: 0.192,
        toolsUsedToday: 8,
        peakUsageHour: 14
    },
    topTools: [
        {
            name: 'web_search',
            callCount: 45,
            successCount: 44,
            failureCount: 1,
            successRate: 0.978,
            avgExecutionTime: 500,
            category: 'search'
        },
        ...
    ],
    failurePatterns: [
        {
            tool: 'external_api',
            count: 5,
            lastError: 'Timeout',
            firstOccurrence: 1234567890,
            lastOccurrence: 1234567900
        },
        ...
    ],
    recommendations: [
        {
            level: 'info',
            tool: 'cache',
            message: 'Cache hit rate below 20%'
        },
        {
            level: 'warning',
            tool: 'external_api',
            message: 'Tool failing 25% of time'
        },
        {
            level: 'error',
            tool: 'slow_query',
            message: 'Average execution time 5+ seconds'
        }
    ]
}
```

---

#### `getCompatibilityReport()`

Get report of tool capabilities and compatibility.

```javascript
const report = codex.getCompatibilityReport();
```

**Returns**: Compatibility report
```javascript
{
    jarvisTools: { count: 15, ready: 15, failed: 0 },
    externalTools: { count: 3, ready: 2, failed: 1 },
    mcpServers: { count: 2, connected: 2, disconnected: 0 },
    features: {
        parallelExecution: true,
        approvalWorkflow: true,
        caching: true,
        planning: true
    },
    capabilities: [
        { tool: 'web_search', parallelizable: true, requiresApproval: false },
        ...
    ]
}
```

---

#### `syncMCPServers(servers)`

Register Model Context Protocol servers.

```javascript
await codex.syncMCPServers([
    mcpServerInstance1,
    mcpServerInstance2
]);
```

**Parameters**:
- `servers` (array): MCP server instances

**Returns**: Promise resolving to sync result
```javascript
{
    success: true,
    synced: 2,
    failed: 0,
    toolsAdded: 15,
    errors: []
}
```

---

## SmartToolRegistry

Tool collection management and execution.

### Properties

- `registry` (Map): All registered tools
- `executionHistory` (array): Recent execution records
- `toolCache` (Map): Cached tool results
- `contextAnalyzer` (ContextAnalyzer): Query analysis

### Methods

#### `registerTool(toolDef)`

Register a tool definition.

```javascript
registry.registerTool(toolDefinition);
```

---

#### `selectTools(query, context, limit)`

Smart tool selection by relevance.

```javascript
const selected = registry.selectTools('search for Python', context, 5);
```

**Parameters**:
- `query` (string): Query
- `context` (object): Execution context
- `limit` (number): Max results

**Returns**: Array of ToolDefinition objects sorted by relevance

---

#### `executeTool(name, args, context)`

Execute single tool.

```javascript
const result = await registry.executeTool('web_search', args, context);
```

---

#### `executeSequence(toolCalls)`

Execute tools sequentially.

```javascript
const results = await registry.executeSequence([
    { name: 'step1', args: {...} },
    { name: 'step2', args: {...} }
]);
```

---

#### `executeParallel(toolCalls)`

Execute tools concurrently.

```javascript
const results = await registry.executeParallel([
    { name: 'task1', args: {...} },
    { name: 'task2', args: {...} }
]);
```

---

#### `executeSmartly(toolCalls)`

Choose execution strategy automatically.

```javascript
const results = await registry.executeSmartly(toolCalls);
```

---

#### `getStats()`

Get registry statistics.

```javascript
const stats = registry.getStats();
```

---

#### `getHistory(limit)`

Get execution history.

```javascript
const history = registry.getHistory(100);
```

---

#### `exportAsOpenAIFunctions()`

Export tools for OpenAI function calling.

```javascript
const functions = registry.exportAsOpenAIFunctions();
```

---

## ToolOrchestrator

Planning and coordination of tool execution.

### Properties

- `plans` (array): Execution plans
- `approvalHandler` (function): Custom approval logic

### Methods

#### `planExecution(query, context)`

Generate execution plan.

```javascript
const plan = orchestrator.planExecution(
    'search and play music',
    context
);
```

**Returns**: Plan object
```javascript
{
    steps: [
        { step: 1, tool: 'web_search', reason: 'Get information' },
        { step: 2, tool: 'play_music', reason: 'Play result' }
    ],
    toolSequence: ['web_search', 'play_music'],
    parallel: false,
    reasoning: 'Execute search then play'
}
```

---

#### `registerApprovalHandler(handler)`

Register custom approval logic.

```javascript
orchestrator.registerApprovalHandler(async (approval) => {
    // approval.toolName
    // approval.args
    // approval.reason
    // approval.context
    return await getUserApproval(approval);
});
```

---

#### `requestApproval(toolName, args, reason)`

Request user approval for tool.

```javascript
const approved = await orchestrator.requestApproval(
    'delete_data',
    { id: 123 },
    'User initiated deletion'
);
```

**Returns**: Boolean (true if approved)

---

#### `execute(query, args, context)`

Full orchestrated execution.

```javascript
const result = await orchestrator.execute(query, args, context);
```

---

## SmartToolDefinition

Individual tool with metadata and scoring.

### Properties

- `name` (string): Tool name
- `description` (string): Tool description
- `parameters` (object): JSON Schema
- `handler` (function): Implementation
- `options` (object): Tool configuration
- `stats` (object): Execution statistics

### Methods

#### `getRelevanceScore(context)`

Calculate relevance score for context.

```javascript
const score = toolDef.getRelevanceScore({
    query: 'find information',
    keywords: ['search', 'web']
});
```

**Returns**: Number 0-1 (higher = more relevant)

---

#### `validateArguments(args)`

Validate arguments against schema.

```javascript
const valid = toolDef.validateArguments({ query: 'test' });
```

**Returns**: Boolean

---

#### `recordExecution(duration, success, result)`

Record execution for analytics.

```javascript
toolDef.recordExecution(1234, true, result);
```

---

#### `getStats()`

Get execution statistics.

```javascript
const stats = toolDef.getStats();
// {
//   callCount: 45,
//   successCount: 44,
//   failureCount: 1,
//   totalExecutionTime: 50000,
//   avgExecutionTime: 1136,
//   successRate: 0.978,
//   ...
// }
```

---

## Data Structures

### ToolDefinition

```javascript
{
    name: 'tool_name',
    description: 'What the tool does',
    parameters: {
        type: 'object',
        properties: {...},
        required: [...]
    },
    handler: async (args) => {...},
    options: {
        timeout: 5000,
        parallel: true,
        category: 'search',
        requiresApproval: false,
        priority: 5
    },
    stats: {
        callCount: 10,
        successCount: 9,
        failureCount: 1,
        totalExecutionTime: 5000,
        avgExecutionTime: 500,
        successRate: 0.9,
        lastCalled: 1234567890
    }
}
```

### ExecutionResult

```javascript
{
    success: true,
    toolName: 'tool_name',
    result: {...},          // Tool return value
    executionTime: 1234,    // ms
    cached: false,
    error: null,            // null if successful
    timestamp: 1234567890,
    context: {...}
}
```

### DiscoveryResult

```javascript
{
    name: 'tool_name',
    description: 'Description',
    score: 0.95,            // Relevance 0-1
    category: 'search',
    parameters: {...},
    reasoning: 'Why selected',
    stats: {...}
}
```

---

## Error Handling

### Common Errors

```javascript
// Tool not found
Error: Tool 'invalid_tool' not found

// Validation failed
Error: Arguments do not match schema

// Execution timeout
Error: Tool execution timed out after 5000ms

// Parameter required
Error: Parameter 'query' is required

// Approval denied
Error: Tool execution denied by user approval
```

### Error Recovery

```javascript
try {
    const result = await codex.executeTool(name, args);
    if (!result.success) {
        const insights = codex.getExecutionInsights();
        // Handle failures with insights
    }
} catch (error) {
    if (error.message.includes('not found')) {
        // Handle missing tool
    } else if (error.message.includes('timeout')) {
        // Handle timeout
    } else {
        // Handle other errors
    }
}
```

---

## Examples

### Example 1: Basic Tool Registration and Execution

```javascript
const codex = new CodexIntegrationAdapter();

codex.registerJarvisTool('greet', 'Greet a person', 
    { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    async (args) => ({ message: `Hello ${args.name}!` })
);

const result = await codex.executeTool('greet', { name: 'Alice' });
console.log(result.result.message); // Hello Alice!
```

### Example 2: Smart Discovery

```javascript
const tools = await codex.discoverTools('find information online');
tools.forEach(t => console.log(`${t.name}: ${t.score.toFixed(2)}`));
```

### Example 3: Multi-Tool Execution

```javascript
const result = await codex.executeWithPlanning(
    'search for JavaScript and play music',
    {}
);

console.log(`Success: ${result.success}`);
console.log(`Tools executed: ${result.summary.successful}`);
```

---

Complete API reference for smart tool calling system!

/**
 * AgentCore - Main Jarvis Agent Engine
 * Codex-inspired intelligent agent with tool calling, AI integration, and robust execution
 */

const EventEmitter = require('events');
const AgentToolRegistry = require('./AgentToolRegistry');
const { AgentOrchestrator, ApprovalDecision } = require('./AgentOrchestrator');
const {
    ToolHandler,
    FunctionHandler,
    ToolOutput,
    ToolInvocation,
    ToolKind
} = require('./ToolHandler');

/**
 * Main Agent Core class
 */
class AgentCore extends EventEmitter {
    constructor(options = {}) {
        super();

        // Initialize registry and orchestrator
        this.registry = new AgentToolRegistry(options.registry || {});
        this.orchestrator = new AgentOrchestrator(this.registry, options.orchestrator || {});

        // AI Provider (injected)
        this.aiProvider = options.aiProvider || null;

        // Configuration
        this.options = {
            systemPrompt: options.systemPrompt || this._defaultSystemPrompt(),
            maxTurns: options.maxTurns || 10,
            autoExecuteTools: options.autoExecuteTools !== false,
            verbose: options.verbose || false,
            ...options
        };

        // State
        this.conversationHistory = [];
        this.activeSession = null;

        // Setup default tools
        if (options.registerDefaults !== false) {
            this._registerDefaultTools();
        }

        // Forward events
        this.registry.on('tool:start', data => this.emit('tool:start', data));
        this.registry.on('tool:complete', data => this.emit('tool:complete', data));
        this.registry.on('tool:error', data => this.emit('tool:error', data));
        this.orchestrator.on('approval:requested', data => this.emit('approval:requested', data));
        this.orchestrator.on('approval:decision', data => this.emit('approval:decision', data));
    }

    /**
     * Set AI provider
     */
    setAIProvider(provider) {
        this.aiProvider = provider;
    }

    /**
     * Register a tool handler
     */
    registerTool(handler) {
        if (handler instanceof ToolHandler) {
            return this.registry.registerHandler(handler);
        }
        throw new Error('Tool must be an instance of ToolHandler');
    }

    /**
     * Register a simple function as tool
     */
    registerFunction(name, description, parameters, fn, options = {}) {
        return this.registry.registerFunction(name, description, parameters, fn, options);
    }

    /**
     * Execute a single tool
     */
    async executeTool(name, args = {}, context = {}) {
        return this.orchestrator.run(name, args, context);
    }

    /**
     * Process user message - main agent loop
     */
    async processMessage(userMessage, context = {}) {
        if (!this.aiProvider) {
            return {
                success: false,
                error: 'No AI provider configured. Set one with setAIProvider() or use tools directly.',
                suggestion:
                    'Get a free API key from OpenRouter (openrouter.ai) or Groq (console.groq.com)'
            };
        }

        const startTime = Date.now();
        const turnResults = [];
        let currentMessage = userMessage;
        let turn = 0;

        this.emit('message:start', { message: userMessage, context });

        // Add to conversation history
        this.conversationHistory.push({
            role: 'user',
            content: userMessage,
            timestamp: Date.now()
        });

        try {
            while (turn < this.options.maxTurns) {
                turn++;

                // Get AI response
                const aiResponse = await this._getAIResponse(currentMessage, context);

                if (!aiResponse.success) {
                    return {
                        success: false,
                        error: aiResponse.error,
                        turns: turn,
                        duration: Date.now() - startTime
                    };
                }

                // Check for tool calls
                const toolCalls = this._extractToolCalls(aiResponse.content);

                if (toolCalls.length === 0) {
                    // No tool calls - final response
                    this.conversationHistory.push({
                        role: 'assistant',
                        content: aiResponse.content,
                        timestamp: Date.now()
                    });

                    return {
                        success: true,
                        response: aiResponse.content,
                        toolResults: turnResults,
                        turns: turn,
                        duration: Date.now() - startTime,
                        provider: aiResponse.provider
                    };
                }

                // Execute tool calls
                if (this.options.autoExecuteTools) {
                    const results = await this._executeToolCalls(toolCalls, context);
                    turnResults.push(...results);

                    // Build tool results message
                    currentMessage = this._formatToolResults(results);

                    // Add to history
                    this.conversationHistory.push({
                        role: 'assistant',
                        content: aiResponse.content,
                        toolCalls,
                        timestamp: Date.now()
                    });

                    this.conversationHistory.push({
                        role: 'tool',
                        content: currentMessage,
                        results,
                        timestamp: Date.now()
                    });
                } else {
                    // Return tool calls for manual execution
                    return {
                        success: true,
                        response: aiResponse.content,
                        pendingToolCalls: toolCalls,
                        turns: turn,
                        duration: Date.now() - startTime
                    };
                }
            }

            return {
                success: false,
                error: `Max turns (${this.options.maxTurns}) reached`,
                toolResults: turnResults,
                turns: turn,
                duration: Date.now() - startTime
            };
        } catch (error) {
            this.emit('message:error', { error, context });
            return {
                success: false,
                error: error.message,
                turns: turn,
                duration: Date.now() - startTime
            };
        }
    }

    /**
     * Get AI response with tool definitions
     */
    async _getAIResponse(message, context) {
        try {
            // Build system prompt with tools
            const tools = this.registry.exportAsOpenAIFunctions();
            const systemPrompt = this._buildSystemPrompt(tools);

            // Call AI provider
            const response = await this.aiProvider.generateResponse(
                systemPrompt,
                message,
                context.maxTokens || 2048
            );

            return {
                success: true,
                content: response.content,
                provider: response.provider
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Build system prompt with tool definitions
     */
    _buildSystemPrompt(tools) {
        let prompt = this.options.systemPrompt;

        if (tools.length > 0) {
            prompt += '\n\n## Available Tools\n\n';
            prompt += 'You can use these tools by responding with a tool call in this format:\n';
            prompt += '```tool\n{"name": "tool_name", "arguments": {...}}\n```\n\n';
            prompt += 'Available tools:\n\n';

            for (const tool of tools) {
                const fn = tool.function;
                prompt += `### ${fn.name}\n`;
                prompt += `${fn.description}\n`;
                prompt += `Parameters: ${JSON.stringify(fn.parameters, null, 2)}\n\n`;
            }
        }

        return prompt;
    }

    /**
     * Extract tool calls from AI response
     */
    _extractToolCalls(content) {
        const toolCalls = [];

        // Match tool call blocks
        const toolPattern = /```tool\n?([\s\S]*?)\n?```/g;
        let match;

        while ((match = toolPattern.exec(content)) !== null) {
            try {
                const call = JSON.parse(match[1].trim());
                if (call.name) {
                    toolCalls.push({
                        name: call.name,
                        arguments: call.arguments || call.args || {}
                    });
                }
            } catch (e) {
                console.warn('[AgentCore] Failed to parse tool call:', e.message);
            }
        }

        // Also try JSON format without code blocks
        const jsonPattern = /\{"name":\s*"([^"]+)",\s*"arguments":\s*(\{[^}]+\})\}/g;
        while ((match = jsonPattern.exec(content)) !== null) {
            try {
                const call = {
                    name: match[1],
                    arguments: JSON.parse(match[2])
                };
                // Avoid duplicates
                if (!toolCalls.find(tc => tc.name === call.name)) {
                    toolCalls.push(call);
                }
            } catch (e) {
                // Ignore parse errors
            }
        }

        return toolCalls;
    }

    /**
     * Execute extracted tool calls
     */
    async _executeToolCalls(toolCalls, context) {
        const results = [];

        for (const call of toolCalls) {
            this.emit('tool:executing', { name: call.name, arguments: call.arguments });

            const result = await this.orchestrator.run(call.name, call.arguments, context);

            results.push({
                name: call.name,
                arguments: call.arguments,
                result: result.toJSON ? result.toJSON() : result
            });

            this.emit('tool:executed', { name: call.name, result });
        }

        return results;
    }

    /**
     * Format tool results for AI
     */
    _formatToolResults(results) {
        let message = 'Tool execution results:\n\n';

        for (const r of results) {
            message += `## ${r.name}\n`;
            message += `Status: ${r.result.success ? 'Success' : 'Failed'}\n`;
            message += `Output: ${typeof r.result.content === 'string' ? r.result.content : JSON.stringify(r.result.content)}\n\n`;
        }

        return message;
    }

    /**
     * Discover tools for a query
     */
    discoverTools(query, options = {}) {
        return this.registry.selectTools(query, options);
    }

    /**
     * Get all registered tools
     */
    getTools() {
        return this.registry.getAllSpecs();
    }

    /**
     * Get agent statistics
     */
    getStats() {
        return {
            registry: this.registry.getStats(),
            orchestrator: this.orchestrator.getStats(),
            conversationLength: this.conversationHistory.length,
            hasAIProvider: !!this.aiProvider
        };
    }

    /**
     * Clear conversation history
     */
    clearHistory() {
        this.conversationHistory = [];
    }

    /**
     * Register approval handler (e.g., Discord reactions)
     */
    onApprovalRequest(handler) {
        this.orchestrator.registerApprovalHandler(handler);
    }

    /**
     * Default system prompt
     */
    _defaultSystemPrompt() {
        return `You are Jarvis, an intelligent AI assistant with access to various tools.

Your capabilities include:
- Executing shell commands
- Taking screenshots of web pages
- Searching the web
- Analyzing text and data
- And more through registered tools

When you need to use a tool, respond with a tool call in this format:
\`\`\`tool
{"name": "tool_name", "arguments": {"param": "value"}}
\`\`\`

Always explain what you're doing and why. Be helpful, accurate, and concise.`;
    }

    /**
     * Register default built-in tools
     */
    _registerDefaultTools() {
        // Echo tool (for testing)
        this.registerFunction(
            'echo',
            'Echo back the input message. Useful for testing.',
            {
                type: 'object',
                properties: {
                    message: { type: 'string', description: 'Message to echo back' }
                },
                required: ['message']
            },
            async args => args.message,
            { category: 'utility', parallel: true }
        );

        // Get current time
        this.registerFunction(
            'get_time',
            'Get the current date and time',
            { type: 'object', properties: {} },
            async () => new Date().toISOString(),
            { category: 'utility', parallel: true }
        );

        // Calculate math expression
        this.registerFunction(
            'calculate',
            'Evaluate a mathematical expression',
            {
                type: 'object',
                properties: {
                    expression: {
                        type: 'string',
                        description: 'Math expression to evaluate (e.g., "2 + 2 * 3")'
                    }
                },
                required: ['expression']
            },
            async args => {
                // Safe math eval (basic operations only)
                const sanitized = args.expression.replace(/[^0-9+\-*/().%\s]/g, '');
                try {
                    const result = Function(`"use strict"; return (${sanitized})`)();
                    return { expression: args.expression, result };
                } catch (e) {
                    return ToolOutput.error(`Invalid expression: ${e.message}`);
                }
            },
            { category: 'utility', parallel: true }
        );

        // List available tools
        this.registerFunction(
            'list_tools',
            'List all available tools and their descriptions',
            { type: 'object', properties: {} },
            async () => {
                const tools = this.registry.getAllSpecs();
                return tools.map(t => ({
                    name: t.name,
                    description: t.description,
                    category: t.category
                }));
            },
            { category: 'utility', parallel: true }
        );

        // HTTP request tool
        this.registerFunction(
            'http_request',
            'Make an HTTP GET request to a URL',
            {
                type: 'object',
                properties: {
                    url: { type: 'string', description: 'URL to fetch' },
                    headers: { type: 'object', description: 'Optional headers' }
                },
                required: ['url']
            },
            async args => {
                try {
                    const response = await fetch(args.url, {
                        headers: args.headers || {},
                        timeout: 10000
                    });
                    const text = await response.text();
                    return {
                        status: response.status,
                        statusText: response.statusText,
                        body: text.slice(0, 5000) // Limit response size
                    };
                } catch (e) {
                    return ToolOutput.error(`HTTP request failed: ${e.message}`);
                }
            },
            { category: 'web', parallel: true, timeout: 15000 }
        );
    }
}

/**
 * Create a pre-configured agent instance
 */
function createAgent(options = {}) {
    return new AgentCore(options);
}

module.exports = {
    AgentCore,
    createAgent,
    // Re-export for convenience
    ToolHandler,
    FunctionHandler,
    ToolOutput,
    ToolInvocation,
    ToolKind,
    AgentToolRegistry,
    AgentOrchestrator,
    ApprovalDecision
};

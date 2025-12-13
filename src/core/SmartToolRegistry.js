/**
 * Smart Tool Registry - Codex-inspired tool management
 * Intelligently selects and routes tools based on context
 */

const ToolDefinition = require('./SmartToolDefinition');

class SmartToolRegistry {
    constructor(options = {}) {
        this.tools = new Map();
        this.callHistory = [];
        this.options = {
            maxHistorySize: 1000,
            autoLearn: true,
            enableCaching: true,
            ...options
        };
        this.cache = new Map();
        this.contextAnalyzer = new ContextAnalyzer();
    }

    /**
     * Register a new tool
     */
    registerTool(name, description, parameters, handler, options = {}) {
        if (this.tools.has(name)) {
            throw new Error(`Tool '${name}' is already registered`);
        }

        const tool = new ToolDefinition(name, description, parameters, handler, options);
        this.tools.set(name, tool);

        return tool;
    }

    /**
     * Unregister a tool
     */
    unregisterTool(name) {
        return this.tools.delete(name);
    }

    /**
     * Get all registered tools
     */
    getAllTools() {
        return Array.from(this.tools.values());
    }

    /**
     * Get tool by name
     */
    getTool(name) {
        return this.tools.get(name);
    }

    /**
     * Smart tool selection based on context
     */
    selectTools(query, context = {}, limit = 5) {
        const analyzedContext = this.contextAnalyzer.analyze(query, context);

        // Score all tools
        const scored = this.getAllTools().map(tool => ({
            tool,
            score: tool.getRelevanceScore(analyzedContext)
        }));

        // Sort by score descending
        scored.sort((a, b) => b.score - a.score);

        // Return top tools with positive scores
        return scored
            .filter(item => item.score > 0)
            .slice(0, limit)
            .map(item => ({
                name: item.tool.name,
                description: item.tool.description,
                score: item.score,
                tool: item.tool
            }));
    }

    /**
     * Execute a tool call
     */
    async executeTool(name, args, context = {}) {
        const tool = this.getTool(name);
        if (!tool) {
            throw new Error(`Tool '${name}' not found`);
        }

        // Validate arguments
        const validation = tool.validateArguments(args);
        if (!validation.valid) {
            return {
                success: false,
                error: `Validation failed: ${validation.errors.join(', ')}`
            };
        }

        // Check cache if enabled
        const cacheKey = this._getCacheKey(name, args);
        if (this.options.enableCaching && this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey);
        }

        try {
            const startTime = Date.now();

            // Execute tool with timeout
            const result = await this._executeWithTimeout(tool.handler(args), tool.options.timeout);

            const duration = Date.now() - startTime;
            tool.recordExecution(duration, true);

            const response = {
                success: true,
                result,
                duration,
                toolName: name,
                executedAt: new Date().toISOString()
            };

            // Cache result if enabled
            if (this.options.enableCaching) {
                this.cache.set(cacheKey, response);
            }

            // Record in history
            this._recordExecution(name, args, response);

            return response;
        } catch (error) {
            const duration = Date.now() - startTime;
            tool.recordExecution(duration, false);

            const response = {
                success: false,
                error: error.message,
                duration,
                toolName: name,
                executedAt: new Date().toISOString()
            };

            this._recordExecution(name, args, response);

            return response;
        }
    }

    /**
     * Execute multiple tools in sequence
     */
    async executeSequence(toolCalls, context = {}) {
        const results = [];

        for (const call of toolCalls) {
            const result = await this.executeTool(call.name, call.args, context);
            results.push(result);

            // If a tool fails and failFast is enabled, stop
            if (!result.success && call.failFast) {
                break;
            }
        }

        return results;
    }

    /**
     * Execute multiple tools in parallel
     */
    async executeParallel(toolCalls, context = {}) {
        const promises = toolCalls.map(call => this.executeTool(call.name, call.args, context));

        return Promise.all(promises);
    }

    /**
     * Smart execution - chooses sequence or parallel based on tool compatibility
     */
    async executeSmartly(toolCalls, context = {}) {
        // Check if all tools support parallel execution
        const allParallel = toolCalls.every(call => {
            const tool = this.getTool(call.name);
            return tool && tool.options.parallel;
        });

        if (allParallel && toolCalls.length > 1) {
            return this.executeParallel(toolCalls, context);
        }

        return this.executeSequence(toolCalls, context);
    }

    /**
     * Get registry statistics
     */
    getStats() {
        return {
            toolCount: this.tools.size,
            totalExecutions: this.callHistory.length,
            tools: Array.from(this.tools.values()).map(tool => tool.getStats()),
            cacheSize: this.cache.size
        };
    }

    /**
     * Get execution history (last N entries)
     */
    getHistory(limit = 100) {
        return this.callHistory.slice(-limit);
    }

    /**
     * Clear cache
     */
    clearCache() {
        this.cache.clear();
    }

    /**
     * Export tools in OpenAI function calling format
     */
    exportAsOpenAIFunctions() {
        return Array.from(this.tools.values()).map(tool => ({
            type: 'function',
            function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters
            }
        }));
    }

    // Private methods

    async _executeWithTimeout(promise, timeout) {
        return Promise.race([
            promise,
            new Promise((_, reject) =>
                setTimeout(
                    () => reject(new Error(`Tool execution timeout (${timeout}ms)`)),
                    timeout
                )
            )
        ]);
    }

    _getCacheKey(name, args) {
        return `${name}:${JSON.stringify(args)}`;
    }

    _recordExecution(name, args, result) {
        if (!this.options.autoLearn) return;

        this.callHistory.push({
            toolName: name,
            args,
            result,
            timestamp: Date.now()
        });

        // Keep history size manageable
        if (this.callHistory.length > this.options.maxHistorySize) {
            this.callHistory = this.callHistory.slice(-this.options.maxHistorySize);
        }
    }
}

/**
 * Context Analyzer - Extracts meaning from queries
 */
class ContextAnalyzer {
    analyze(query, context = {}) {
        const analyzed = {
            query: query || '',
            keywords: this._extractKeywords(query),
            category: context.category || 'general',
            priority: context.priority || 'normal',
            domain: context.domain || 'general'
        };

        return analyzed;
    }

    _extractKeywords(query) {
        if (!query) return [];

        // Simple keyword extraction - can be enhanced with NLP
        return query
            .toLowerCase()
            .split(/\s+/)
            .filter(word => word.length > 3)
            .slice(0, 5);
    }
}

module.exports = SmartToolRegistry;

/**
 * AgentToolRegistry - Codex-inspired tool registry with advanced features
 * Supports parallel execution, telemetry, caching, and smart selection
 */

const EventEmitter = require('events');
const { ToolHandler, ToolOutput, ToolInvocation, ToolKind, FunctionHandler } = require('./ToolHandler');

/**
 * Tool Registry - Central hub for all tool management
 */
class AgentToolRegistry extends EventEmitter {
    constructor(options = {}) {
        super();
        this.handlers = new Map();
        this.specs = [];
        this.options = {
            maxHistorySize: 1000,
            enableCaching: true,
            cacheTTL: 60000, // 1 minute
            enableTelemetry: true,
            maxParallelCalls: 10,
            defaultTimeout: 30000,
            ...options
        };
        
        // Caching
        this.cache = new Map();
        this.cacheTimestamps = new Map();
        
        // History & telemetry
        this.history = [];
        this.telemetry = {
            totalCalls: 0,
            totalSuccesses: 0,
            totalFailures: 0,
            totalDuration: 0,
            cacheHits: 0,
            cacheMisses: 0
        };
    }

    /**
     * Register a ToolHandler instance
     */
    registerHandler(handler) {
        if (!(handler instanceof ToolHandler)) {
            throw new Error('Handler must be an instance of ToolHandler');
        }

        const name = handler.name;
        if (this.handlers.has(name)) {
            console.warn(`[AgentToolRegistry] Overwriting handler for tool: ${name}`);
        }

        this.handlers.set(name, handler);
        this.specs.push({
            name: handler.spec.name,
            description: handler.spec.description,
            parameters: handler.spec.parameters,
            kind: handler.spec.kind,
            category: handler.spec.category,
            parallel: handler.spec.parallel
        });

        // Forward handler events
        handler.on('execute:start', (data) => this.emit('tool:start', data));
        handler.on('execute:complete', (data) => this.emit('tool:complete', data));
        handler.on('execute:error', (data) => this.emit('tool:error', data));

        return handler;
    }

    /**
     * Register a simple function as a tool
     */
    registerFunction(name, description, parameters, fn, options = {}) {
        const handler = new FunctionHandler({
            name,
            description,
            parameters,
            ...options
        }, fn);
        
        return this.registerHandler(handler);
    }

    /**
     * Unregister a tool
     */
    unregisterTool(name) {
        const handler = this.handlers.get(name);
        if (handler) {
            handler.removeAllListeners();
            this.handlers.delete(name);
            this.specs = this.specs.filter(s => s.name !== name);
            return true;
        }
        return false;
    }

    /**
     * Get handler by name
     */
    getHandler(name) {
        return this.handlers.get(name) || null;
    }

    /**
     * Get all registered handlers
     */
    getAllHandlers() {
        return Array.from(this.handlers.values());
    }

    /**
     * Get all tool specs
     */
    getAllSpecs() {
        return [...this.specs];
    }

    /**
     * Dispatch a tool call
     */
    async dispatch(invocation) {
        const { toolName, callId } = invocation;
        const startTime = Date.now();
        
        this.telemetry.totalCalls++;
        this.emit('dispatch:start', { invocation });

        // Get handler
        const handler = this.getHandler(toolName);
        if (!handler) {
            const error = `Tool '${toolName}' not found`;
            this.telemetry.totalFailures++;
            this.recordHistory(invocation, ToolOutput.error(error), Date.now() - startTime);
            return ToolOutput.error(error);
        }

        // Check cache
        const cacheKey = this._getCacheKey(toolName, invocation.arguments);
        if (this.options.enableCaching && this._isCacheValid(cacheKey)) {
            this.telemetry.cacheHits++;
            const cached = this.cache.get(cacheKey);
            this.emit('dispatch:cache-hit', { invocation, cached });
            return cached;
        }
        this.telemetry.cacheMisses++;

        // Execute
        const output = await handler.execute(invocation);
        const duration = Date.now() - startTime;

        // Update telemetry
        if (output.success) {
            this.telemetry.totalSuccesses++;
        } else {
            this.telemetry.totalFailures++;
        }
        this.telemetry.totalDuration += duration;

        // Cache successful results
        if (this.options.enableCaching && output.success) {
            this.cache.set(cacheKey, output);
            this.cacheTimestamps.set(cacheKey, Date.now());
        }

        // Record history
        this.recordHistory(invocation, output, duration);
        
        this.emit('dispatch:complete', { invocation, output, duration });
        return output;
    }

    /**
     * Execute a tool by name (convenience method)
     */
    async executeTool(name, args = {}, context = {}) {
        const invocation = new ToolInvocation({
            toolName: name,
            arguments: args,
            context,
            ...context
        });
        
        return this.dispatch(invocation);
    }

    /**
     * Execute multiple tools in parallel
     */
    async executeParallel(toolCalls, context = {}) {
        // Limit parallel calls
        const batches = this._batchArray(toolCalls, this.options.maxParallelCalls);
        const allResults = [];

        for (const batch of batches) {
            const promises = batch.map(call => {
                const invocation = new ToolInvocation({
                    toolName: call.name,
                    arguments: call.args || {},
                    context,
                    ...context
                });
                return this.dispatch(invocation);
            });

            const results = await Promise.allSettled(promises);
            allResults.push(...results.map((r, i) => ({
                toolName: batch[i].name,
                result: r.status === 'fulfilled' ? r.value : ToolOutput.error(r.reason?.message || 'Unknown error')
            })));
        }

        return allResults;
    }

    /**
     * Execute tools in sequence
     */
    async executeSequence(toolCalls, context = {}, options = {}) {
        const results = [];
        const stopOnError = options.stopOnError !== false;

        for (const call of toolCalls) {
            const invocation = new ToolInvocation({
                toolName: call.name,
                arguments: call.args || {},
                context,
                ...context
            });

            const result = await this.dispatch(invocation);
            results.push({ toolName: call.name, result });

            if (!result.success && stopOnError) {
                break;
            }
        }

        return results;
    }

    /**
     * Smart execution - decides parallel vs sequential based on tool properties
     */
    async executeSmart(toolCalls, context = {}) {
        // Check if all tools support parallel
        const allParallel = toolCalls.every(call => {
            const handler = this.getHandler(call.name);
            return handler && handler.spec.parallel;
        });

        // Check if any are mutating
        const hasMutating = toolCalls.some(call => {
            const handler = this.getHandler(call.name);
            return handler && handler.isMutating(new ToolInvocation({
                toolName: call.name,
                arguments: call.args || {}
            }));
        });

        if (allParallel && !hasMutating && toolCalls.length > 1) {
            return this.executeParallel(toolCalls, context);
        }

        return this.executeSequence(toolCalls, context);
    }

    /**
     * Select relevant tools for a query
     */
    selectTools(query, options = {}) {
        const limit = options.limit || 5;
        const category = options.category;
        const keywords = this._extractKeywords(query);

        const scored = this.getAllHandlers()
            .filter(h => !category || h.spec.category === category)
            .map(handler => ({
                handler,
                score: this._scoreHandler(handler, query, keywords)
            }))
            .filter(item => item.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);

        return scored.map(item => ({
            name: item.handler.name,
            description: item.handler.spec.description,
            relevanceScore: item.score,
            handler: item.handler
        }));
    }

    /**
     * Export all tools as OpenAI function format
     */
    exportAsOpenAIFunctions() {
        return this.getAllHandlers().map(h => h.toOpenAIFunction());
    }

    /**
     * Export all tools as Responses API format
     */
    exportAsResponsesApiTools() {
        return this.getAllHandlers().map(h => h.toResponsesApiTool());
    }

    /**
     * Get registry statistics
     */
    getStats() {
        return {
            toolCount: this.handlers.size,
            totalExecutions: this.telemetry.totalCalls,
            successRate: this.telemetry.totalCalls > 0 
                ? ((this.telemetry.totalSuccesses / this.telemetry.totalCalls) * 100).toFixed(1) + '%' 
                : 'N/A',
            avgDuration: this.telemetry.totalCalls > 0 
                ? Math.round(this.telemetry.totalDuration / this.telemetry.totalCalls) 
                : 0,
            cacheHits: this.telemetry.cacheHits,
            cacheHitRate: (this.telemetry.cacheHits + this.telemetry.cacheMisses) > 0
                ? (this.telemetry.cacheHits / (this.telemetry.cacheHits + this.telemetry.cacheMisses))
                : 0,
            tools: this.getAllHandlers().map(h => h.getStats())
        };
    }

    /**
     * Get execution history
     */
    getHistory(limit = 100) {
        return this.history.slice(-limit);
    }

    /**
     * Clear cache
     */
    clearCache() {
        this.cache.clear();
        this.cacheTimestamps.clear();
    }

    /**
     * Prune expired cache entries
     */
    pruneCache() {
        const now = Date.now();
        const ttl = this.options.cacheTTL;

        for (const [key, timestamp] of this.cacheTimestamps.entries()) {
            if (now - timestamp > ttl) {
                this.cache.delete(key);
                this.cacheTimestamps.delete(key);
            }
        }
    }

    // Private methods

    _getCacheKey(name, args) {
        return `${name}:${JSON.stringify(args)}`;
    }

    _isCacheValid(key) {
        if (!this.cache.has(key)) return false;
        const timestamp = this.cacheTimestamps.get(key);
        return timestamp && (Date.now() - timestamp) < this.options.cacheTTL;
    }

    _batchArray(array, size) {
        const batches = [];
        for (let i = 0; i < array.length; i += size) {
            batches.push(array.slice(i, i + size));
        }
        return batches;
    }

    _extractKeywords(query) {
        if (!query) return [];
        return query
            .toLowerCase()
            .replace(/[^\w\s]/g, '')
            .split(/\s+/)
            .filter(word => word.length > 2);
    }

    _scoreHandler(handler, query, keywords) {
        let score = 0;
        const name = handler.name.toLowerCase();
        const description = handler.spec.description.toLowerCase();
        const queryLower = (query || '').toLowerCase();

        // Exact name match
        if (queryLower.includes(name)) {
            score += 10;
        }

        // Keyword matches in description
        for (const keyword of keywords) {
            if (description.includes(keyword)) {
                score += 2;
            }
            if (name.includes(keyword)) {
                score += 3;
            }
        }

        // Success rate bonus
        const stats = handler.getStats();
        if (stats.callCount > 0) {
            const successRate = stats.successCount / stats.callCount;
            score += successRate * 2;
        }

        return score;
    }

    recordHistory(invocation, output, duration) {
        this.history.push({
            callId: invocation.callId,
            toolName: invocation.toolName,
            args: invocation.arguments,
            success: output.success,
            duration,
            timestamp: Date.now()
        });

        // Keep history bounded
        if (this.history.length > this.options.maxHistorySize) {
            this.history = this.history.slice(-this.options.maxHistorySize);
        }
    }
}

module.exports = AgentToolRegistry;


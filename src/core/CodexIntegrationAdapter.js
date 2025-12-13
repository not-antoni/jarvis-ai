/**
 * Codex Integration Adapter - Bridge between Jarvis and Codex tool calling
 * Allows Jarvis to leverage Codex's smart tool selection mechanisms
 */

const SmartToolRegistry = require('./SmartToolRegistry');
const ToolOrchestrator = require('./ToolOrchestrator');

class CodexIntegrationAdapter {
    constructor(options = {}) {
        this.registry = new SmartToolRegistry(options.registry || {});
        this.orchestrator = new ToolOrchestrator(this.registry, options.orchestrator || {});
        this.options = {
            enableCodexPatterns: true,
            mapExternalTools: true,
            ...options
        };
        this.externalTools = new Map();
    }

    /**
     * Register a Jarvis tool to the smart registry
     */
    registerJarvisTool(name, description, parameters, handler, options = {}) {
        return this.registry.registerTool(name, description, parameters, handler, {
            category: 'jarvis',
            ...options
        });
    }

    /**
     * Register an external tool (MCP server, plugin, etc)
     */
    registerExternalTool(name, description, parameters, handler, options = {}) {
        const toolName = `external_${name}`;
        this.externalTools.set(name, { name, description, parameters, handler });

        return this.registry.registerTool(toolName, description, parameters, handler, {
            category: 'external',
            ...options
        });
    }

    /**
     * Smart tool discovery - find tools matching a query
     */
    discoverTools(query, options = {}) {
        const limit = options.limit || 5;
        const category = options.category || 'all';

        const selected = this.registry.selectTools(query, { category });

        return selected.map(tool => ({
            name: tool.name,
            description: tool.description,
            relevanceScore: tool.score,
            canExecute: true
        }));
    }

    /**
     * Execute tool with smart selection
     */
    async executeTool(name, args = {}, context = {}) {
        // Try exact match first
        let tool = this.registry.getTool(name);

        // If not found, try to find similar
        if (!tool) {
            const discovered = this.discoverTools(name, { limit: 1 });
            if (discovered.length > 0) {
                const toolName = discovered[0].name;
                tool = this.registry.getTool(toolName);
            }
        }

        if (!tool) {
            return {
                success: false,
                error: `Tool '${name}' not found`
            };
        }

        return this.registry.executeTool(name, args, context);
    }

    /**
     * Plan and execute - Codex-style orchestration
     */
    async executeWithPlanning(query, args = {}, context = {}) {
        return this.orchestrator.execute(query, args, context);
    }

    /**
     * Export Codex-compatible tool definitions
     */
    exportAsCodexTools() {
        return this.registry.exportAsOpenAIFunctions();
    }

    /**
     * Get tool compatibility report
     */
    getCompatibilityReport() {
        const tools = this.registry.getAllTools();

        return {
            totalTools: tools.length,
            byCategory: this._groupBy(tools, t => t.options.category),
            supportParallel: tools.filter(t => t.options.parallel).length,
            requireApproval: tools.filter(t => t.options.requiresApproval).length,
            details: tools.map(t => ({
                name: t.name,
                category: t.options.category,
                parallel: t.options.parallel,
                approval: t.options.requiresApproval
            }))
        };
    }

    /**
     * Batch execute with smart coordination
     */
    async batchExecute(queries, context = {}) {
        const results = [];

        for (const query of queries) {
            const result = await this.executeWithPlanning(query, {}, context);
            results.push({
                query,
                result
            });
        }

        return results;
    }

    /**
     * Get execution insights and recommendations
     */
    getExecutionInsights() {
        const stats = this.registry.getStats();
        const history = this.registry.getHistory(50);

        const insights = {
            stats,
            topTools: this._getTopTools(stats.tools, 5),
            failurePatterns: this._analyzeFailures(history),
            recommendations: this._generateRecommendations(stats, history)
        };

        return insights;
    }

    /**
     * Register Discord approval handler
     */
    registerDiscordApproval(client, options = {}) {
        this.orchestrator.registerApprovalHandler(async approval => {
            return new Promise(resolve => {
                // Implementation would depend on Discord client
                // This is a template
                console.log(`[Codex] Requesting approval for: ${approval.toolName}`);
                resolve(true); // Auto-approve for now
            });
        });
    }

    /**
     * Sync with MCP servers (Model Context Protocol)
     */
    async syncMCPServers(mcpServers = []) {
        for (const server of mcpServers) {
            try {
                const tools = await server.listTools();
                for (const tool of tools) {
                    this.registerExternalTool(
                        tool.name,
                        tool.description,
                        tool.inputSchema,
                        args => server.callTool(tool.name, args),
                        { requiresApproval: true }
                    );
                }
            } catch (error) {
                console.error(`Failed to sync MCP server: ${error.message}`);
            }
        }
    }

    // Private methods

    _groupBy(items, keyFn) {
        const groups = {};
        items.forEach(item => {
            const key = keyFn(item);
            if (!groups[key]) groups[key] = [];
            groups[key].push(item);
        });
        return groups;
    }

    _getTopTools(toolStats, limit) {
        return toolStats
            .sort((a, b) => (b.successCount || 0) - (a.successCount || 0))
            .slice(0, limit)
            .map(t => ({
                name: t.name,
                successCount: t.successCount,
                callCount: t.callCount
            }));
    }

    _analyzeFailures(history) {
        const failures = history.filter(h => !h.result.success);

        if (failures.length === 0) {
            return { count: 0, patterns: [] };
        }

        const byTool = this._groupBy(failures, h => h.toolName);

        return {
            count: failures.length,
            patterns: Object.entries(byTool).map(([tool, fails]) => ({
                tool,
                count: fails.length,
                lastError: fails[fails.length - 1].result.error
            }))
        };
    }

    _generateRecommendations(stats, history) {
        const recommendations = [];

        // Low success rate
        stats.tools.forEach(tool => {
            const rate = parseFloat(tool.successRate);
            if (rate < 50 && tool.callCount > 5) {
                recommendations.push({
                    level: 'warning',
                    tool: tool.name,
                    message: `${tool.name} has low success rate (${tool.successRate}). Consider review.`
                });
            }
        });

        // Slow tools
        stats.tools.forEach(tool => {
            if (tool.avgDuration > 10000) {
                recommendations.push({
                    level: 'info',
                    tool: tool.name,
                    message: `${tool.name} is slow (${tool.avgDuration}ms avg). Consider timeout adjustment.`
                });
            }
        });

        return recommendations;
    }
}

module.exports = CodexIntegrationAdapter;

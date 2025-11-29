/**
 * ToolHandler - Codex-inspired tool handler base class
 * Every tool must implement this interface for consistent behavior
 */

const EventEmitter = require('events');

/**
 * Tool execution result
 */
class ToolOutput {
    constructor(content, options = {}) {
        this.content = content;
        this.success = options.success !== false;
        this.contentItems = options.contentItems || null;
        this.metadata = options.metadata || {};
        this.timestamp = Date.now();
    }

    static success(content, metadata = {}) {
        return new ToolOutput(content, { success: true, metadata });
    }

    static error(message, metadata = {}) {
        return new ToolOutput(message, { success: false, metadata });
    }

    toJSON() {
        return {
            content: this.content,
            success: this.success,
            contentItems: this.contentItems,
            metadata: this.metadata,
            timestamp: this.timestamp
        };
    }
}

/**
 * Tool invocation context - carries all needed info for tool execution
 */
class ToolInvocation {
    constructor(options) {
        this.callId = options.callId || `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        this.toolName = options.toolName;
        this.arguments = options.arguments || {};
        this.context = options.context || {};
        this.session = options.session || null;
        this.userId = options.userId || null;
        this.guildId = options.guildId || null;
        this.channelId = options.channelId || null;
        this.timestamp = Date.now();
    }
}

/**
 * Approval requirement enum
 */
const ApprovalRequirement = {
    SKIP: 'skip',           // No approval needed
    NEEDS_APPROVAL: 'needs_approval',  // User must approve
    FORBIDDEN: 'forbidden'   // Cannot be executed
};

/**
 * Tool kind enum
 */
const ToolKind = {
    FUNCTION: 'function',
    SHELL: 'shell',
    BROWSER: 'browser',
    MCP: 'mcp',
    CUSTOM: 'custom'
};

/**
 * Base ToolHandler class - all tools should extend this
 */
class ToolHandler extends EventEmitter {
    constructor(spec) {
        super();
        this.spec = {
            name: spec.name,
            description: spec.description || '',
            parameters: spec.parameters || { type: 'object', properties: {} },
            kind: spec.kind || ToolKind.FUNCTION,
            category: spec.category || 'utility',
            timeout: spec.timeout || 30000,
            parallel: spec.parallel !== false,
            requiresApproval: spec.requiresApproval || false,
            isMutating: spec.isMutating || false,
            ...spec
        };
        
        // Metrics
        this.metrics = {
            callCount: 0,
            successCount: 0,
            failureCount: 0,
            totalDuration: 0,
            lastCall: null,
            lastError: null
        };
    }

    /**
     * Get tool kind
     */
    get kind() {
        return this.spec.kind;
    }

    /**
     * Get tool name
     */
    get name() {
        return this.spec.name;
    }

    /**
     * Check if this handler matches the given payload kind
     */
    matchesKind(kind) {
        return this.spec.kind === kind;
    }

    /**
     * Check if this tool is mutating (modifies state)
     */
    isMutating(invocation) {
        return this.spec.isMutating;
    }

    /**
     * Get approval requirement for this invocation
     */
    getApprovalRequirement(invocation) {
        if (this.spec.requiresApproval) {
            return {
                requirement: ApprovalRequirement.NEEDS_APPROVAL,
                reason: `Tool ${this.name} requires user approval`
            };
        }
        return {
            requirement: ApprovalRequirement.SKIP,
            reason: null
        };
    }

    /**
     * Validate invocation arguments
     */
    validate(invocation) {
        const errors = [];
        const args = invocation.arguments;
        const params = this.spec.parameters;

        // Check required parameters
        if (params.required) {
            for (const required of params.required) {
                if (!(required in args) || args[required] === undefined || args[required] === null) {
                    errors.push(`Missing required parameter: ${required}`);
                }
            }
        }

        // Type checking
        if (params.properties) {
            for (const [key, schema] of Object.entries(params.properties)) {
                if (key in args && args[key] !== undefined) {
                    const value = args[key];
                    const expectedType = schema.type;
                    
                    if (expectedType === 'string' && typeof value !== 'string') {
                        errors.push(`Parameter '${key}' should be string, got ${typeof value}`);
                    } else if (expectedType === 'number' && typeof value !== 'number') {
                        errors.push(`Parameter '${key}' should be number, got ${typeof value}`);
                    } else if (expectedType === 'boolean' && typeof value !== 'boolean') {
                        errors.push(`Parameter '${key}' should be boolean, got ${typeof value}`);
                    } else if (expectedType === 'array' && !Array.isArray(value)) {
                        errors.push(`Parameter '${key}' should be array, got ${typeof value}`);
                    } else if (expectedType === 'object' && (typeof value !== 'object' || Array.isArray(value))) {
                        errors.push(`Parameter '${key}' should be object, got ${typeof value}`);
                    }
                }
            }
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    /**
     * Main handle method - MUST be overridden by subclasses
     * @param {ToolInvocation} invocation - The tool invocation
     * @returns {Promise<ToolOutput>} - The tool output
     */
    async handle(invocation) {
        throw new Error(`ToolHandler.handle() must be implemented by ${this.name}`);
    }

    /**
     * Execute the tool with full lifecycle management
     */
    async execute(invocation) {
        const startTime = Date.now();
        this.metrics.lastCall = startTime;

        // Emit start event
        this.emit('execute:start', { invocation, handler: this });

        try {
            // Validate
            const validation = this.validate(invocation);
            if (!validation.valid) {
                const output = ToolOutput.error(`Validation failed: ${validation.errors.join(', ')}`);
                this.recordMetrics(startTime, false);
                this.emit('execute:error', { invocation, error: output.content, handler: this });
                return output;
            }

            // Execute with timeout
            const result = await this._executeWithTimeout(
                this.handle(invocation),
                this.spec.timeout
            );

            // Ensure result is ToolOutput
            const output = result instanceof ToolOutput ? result : ToolOutput.success(result);
            
            this.recordMetrics(startTime, output.success);
            this.emit('execute:complete', { invocation, output, handler: this });
            
            return output;

        } catch (error) {
            const output = ToolOutput.error(error.message, { stack: error.stack });
            this.metrics.lastError = error.message;
            this.recordMetrics(startTime, false);
            this.emit('execute:error', { invocation, error: error.message, handler: this });
            return output;
        }
    }

    /**
     * Execute with timeout wrapper
     */
    async _executeWithTimeout(promise, timeout) {
        return Promise.race([
            promise,
            new Promise((_, reject) => {
                setTimeout(() => {
                    reject(new Error(`Tool execution timed out after ${timeout}ms`));
                }, timeout);
            })
        ]);
    }

    /**
     * Record execution metrics
     */
    recordMetrics(startTime, success) {
        const duration = Date.now() - startTime;
        this.metrics.callCount++;
        this.metrics.totalDuration += duration;
        
        if (success) {
            this.metrics.successCount++;
        } else {
            this.metrics.failureCount++;
        }
    }

    /**
     * Get tool statistics
     */
    getStats() {
        const { callCount, successCount, failureCount, totalDuration, lastCall, lastError } = this.metrics;
        return {
            name: this.name,
            kind: this.kind,
            category: this.spec.category,
            callCount,
            successCount,
            failureCount,
            avgDuration: callCount > 0 ? Math.round(totalDuration / callCount) : 0,
            successRate: callCount > 0 ? ((successCount / callCount) * 100).toFixed(1) + '%' : 'N/A',
            lastCall: lastCall ? new Date(lastCall).toISOString() : null,
            lastError
        };
    }

    /**
     * Export as OpenAI function calling format
     */
    toOpenAIFunction() {
        return {
            type: 'function',
            function: {
                name: this.spec.name,
                description: this.spec.description,
                parameters: this.spec.parameters
            }
        };
    }

    /**
     * Export as Responses API format (Codex style)
     */
    toResponsesApiTool() {
        return {
            type: 'function',
            name: this.spec.name,
            description: this.spec.description,
            strict: false,
            parameters: this.spec.parameters
        };
    }
}

/**
 * Function handler - simple function wrapper
 */
class FunctionHandler extends ToolHandler {
    constructor(spec, fn) {
        super({ ...spec, kind: ToolKind.FUNCTION });
        this._fn = fn;
    }

    async handle(invocation) {
        const result = await this._fn(invocation.arguments, invocation);
        return result instanceof ToolOutput ? result : ToolOutput.success(result);
    }
}

/**
 * Shell command handler
 */
class ShellHandler extends ToolHandler {
    constructor(spec, options = {}) {
        super({ 
            ...spec, 
            kind: ToolKind.SHELL,
            isMutating: true,
            requiresApproval: options.requiresApproval !== false
        });
        this.shellOptions = options;
    }

    isMutating(invocation) {
        // Check if command is known safe
        const safeCommands = ['ls', 'pwd', 'echo', 'cat', 'head', 'tail', 'grep', 'find', 'which', 'whoami'];
        const command = invocation.arguments.command || '';
        const firstWord = command.split(/\s+/)[0];
        return !safeCommands.includes(firstWord);
    }

    async handle(invocation) {
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);

        const { command, cwd, timeout } = invocation.arguments;
        
        try {
            const { stdout, stderr } = await execAsync(command, {
                cwd: cwd || process.cwd(),
                timeout: timeout || this.spec.timeout,
                maxBuffer: 1024 * 1024 * 10 // 10MB
            });

            return ToolOutput.success(stdout || stderr || 'Command completed successfully', {
                metadata: { stderr: stderr || null }
            });
        } catch (error) {
            return ToolOutput.error(`Command failed: ${error.message}`, {
                metadata: { stderr: error.stderr, code: error.code }
            });
        }
    }
}

module.exports = {
    ToolHandler,
    FunctionHandler,
    ShellHandler,
    ToolOutput,
    ToolInvocation,
    ToolKind,
    ApprovalRequirement
};


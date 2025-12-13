/**
 * AgentOrchestrator - Codex-inspired tool orchestration with approval, retry, and sandbox
 * Central control for tool execution lifecycle
 */

const EventEmitter = require('events');
const { ToolOutput, ToolInvocation, ApprovalRequirement } = require('./ToolHandler');

/**
 * Approval decision types
 */
const ApprovalDecision = {
    APPROVED: 'approved',
    APPROVED_FOR_SESSION: 'approved_for_session',
    DENIED: 'denied',
    ABORT: 'abort',
    TIMEOUT: 'timeout'
};

/**
 * Sandbox types
 */
const SandboxType = {
    NONE: 'none',
    BASIC: 'basic',
    STRICT: 'strict'
};

/**
 * Tool error wrapper
 */
class ToolError extends Error {
    constructor(message, code, metadata = {}) {
        super(message);
        this.name = 'ToolError';
        this.code = code;
        this.metadata = metadata;
    }

    static rejected(reason) {
        return new ToolError(reason, 'REJECTED', { rejectionReason: reason });
    }

    static timeout(timeoutMs) {
        return new ToolError(`Operation timed out after ${timeoutMs}ms`, 'TIMEOUT', { timeoutMs });
    }

    static approvalTimeout(timeoutMs) {
        return new ToolError(`Approval timed out after ${timeoutMs}ms`, 'APPROVAL_TIMEOUT', {
            timeoutMs
        });
    }

    static sandboxDenied(output) {
        return new ToolError('Sandbox denied operation', 'SANDBOX_DENIED', { output });
    }
}

/**
 * Main Orchestrator class
 */
class AgentOrchestrator extends EventEmitter {
    constructor(registry, options = {}) {
        super();
        this.registry = registry;
        this.options = {
            // Approval settings
            approvalTimeout: 60000,
            autoApproveNonMutating: true,
            sessionApprovals: new Map(),

            // Retry settings
            maxRetries: 3,
            baseRetryDelay: 1000,
            maxRetryDelay: 10000,
            retryBackoffMultiplier: 2,
            retryJitter: 0.1,

            // Sandbox settings
            defaultSandbox: SandboxType.BASIC,
            escalateOnSandboxFailure: true,

            // Execution settings
            globalTimeout: 120000,
            verbose: false,

            ...options
        };

        // State
        this.approvalHandlers = [];
        this.executionHistory = [];
        this.sessionApprovals = new Map();
    }

    /**
     * Main execution method - runs a tool with full orchestration
     */
    async run(toolName, args = {}, context = {}) {
        const startTime = Date.now();
        const invocation = new ToolInvocation({
            toolName,
            arguments: args,
            context,
            ...context
        });

        this.emit('orchestration:start', { invocation });

        try {
            // Get handler
            const handler = this.registry.getHandler(toolName);
            if (!handler) {
                throw new ToolError(`Tool '${toolName}' not found`, 'NOT_FOUND');
            }

            // Step 1: Approval
            const approvalResult = await this._handleApproval(handler, invocation);
            if (
                approvalResult.decision === ApprovalDecision.DENIED ||
                approvalResult.decision === ApprovalDecision.ABORT
            ) {
                throw ToolError.rejected(approvalResult.reason || 'User denied');
            }

            if (approvalResult.decision === ApprovalDecision.TIMEOUT) {
                throw ToolError.approvalTimeout(this.options.approvalTimeout);
            }

            // Step 2: Execute with retry logic
            const result = await this._executeWithRetry(handler, invocation);

            const duration = Date.now() - startTime;
            this._recordExecution(invocation, result, duration);

            this.emit('orchestration:complete', { invocation, result, duration });
            return result;
        } catch (error) {
            const duration = Date.now() - startTime;
            const result =
                error instanceof ToolError
                    ? ToolOutput.error(error.message, { code: error.code, ...error.metadata })
                    : ToolOutput.error(error.message);

            this._recordExecution(invocation, result, duration);
            this.emit('orchestration:error', { invocation, error, duration });

            return result;
        }
    }

    /**
     * Handle approval workflow
     */
    async _handleApproval(handler, invocation) {
        // Check if already approved for session
        const sessionKey = this._getSessionApprovalKey(handler.name, invocation);
        if (this.sessionApprovals.has(sessionKey)) {
            return { decision: ApprovalDecision.APPROVED_FOR_SESSION };
        }

        // Get approval requirement
        const requirement = handler.getApprovalRequirement(invocation);

        switch (requirement.requirement) {
            case ApprovalRequirement.SKIP:
                return { decision: ApprovalDecision.APPROVED };

            case ApprovalRequirement.FORBIDDEN:
                return {
                    decision: ApprovalDecision.DENIED,
                    reason: requirement.reason || 'Tool is forbidden'
                };

            case ApprovalRequirement.NEEDS_APPROVAL:
                // Auto-approve non-mutating if configured
                if (this.options.autoApproveNonMutating && !handler.isMutating(invocation)) {
                    return { decision: ApprovalDecision.APPROVED };
                }

                // Request user approval
                return await this._requestApproval(handler, invocation, requirement.reason);

            default:
                return { decision: ApprovalDecision.APPROVED };
        }
    }

    /**
     * Request approval from registered handlers
     */
    async _requestApproval(handler, invocation, reason) {
        if (this.approvalHandlers.length === 0) {
            // No handlers = auto-approve
            if (this.options.verbose) {
                console.log(`[AgentOrchestrator] Auto-approving ${handler.name} (no handlers)`);
            }
            return { decision: ApprovalDecision.APPROVED };
        }

        const approvalRequest = {
            toolName: handler.name,
            description: handler.spec.description,
            arguments: invocation.arguments,
            reason,
            isMutating: handler.isMutating(invocation),
            timestamp: Date.now()
        };

        this.emit('approval:requested', approvalRequest);

        try {
            // Race approval handlers against timeout
            const decision = await Promise.race([
                this._collectApprovals(approvalRequest),
                this._approvalTimeout()
            ]);

            this.emit('approval:decision', { ...approvalRequest, decision });

            // Store session approval if granted for session
            if (decision.decision === ApprovalDecision.APPROVED_FOR_SESSION) {
                const sessionKey = this._getSessionApprovalKey(handler.name, invocation);
                this.sessionApprovals.set(sessionKey, true);
            }

            return decision;
        } catch (error) {
            return { decision: ApprovalDecision.TIMEOUT, reason: error.message };
        }
    }

    /**
     * Collect approvals from all handlers
     */
    async _collectApprovals(request) {
        const results = await Promise.all(
            this.approvalHandlers.map(handler =>
                handler(request).catch(e => ({
                    decision: ApprovalDecision.DENIED,
                    error: e.message
                }))
            )
        );

        // All must approve
        const denied = results.find(
            r => r.decision === ApprovalDecision.DENIED || r.decision === ApprovalDecision.ABORT
        );

        if (denied) {
            return denied;
        }

        // Check for session approval
        const sessionApproval = results.find(
            r => r.decision === ApprovalDecision.APPROVED_FOR_SESSION
        );
        if (sessionApproval) {
            return sessionApproval;
        }

        return { decision: ApprovalDecision.APPROVED };
    }

    /**
     * Approval timeout handler
     */
    _approvalTimeout() {
        return new Promise((_, reject) => {
            setTimeout(() => {
                reject(new Error('Approval timeout'));
            }, this.options.approvalTimeout);
        });
    }

    /**
     * Execute with retry logic
     */
    async _executeWithRetry(handler, invocation) {
        let lastError = null;
        let attempt = 0;

        while (attempt < this.options.maxRetries) {
            attempt++;

            try {
                if (this.options.verbose && attempt > 1) {
                    console.log(
                        `[AgentOrchestrator] Retry attempt ${attempt}/${this.options.maxRetries} for ${handler.name}`
                    );
                }

                const result = await this._executeWithTimeout(
                    handler.execute(invocation),
                    this.options.globalTimeout
                );

                if (result.success) {
                    return result;
                }

                // Check if error is retryable
                if (!this._isRetryable(result)) {
                    return result;
                }

                lastError = result;
            } catch (error) {
                if (!this._isRetryableError(error)) {
                    throw error;
                }
                lastError = ToolOutput.error(error.message);
            }

            // Wait before retry with exponential backoff + jitter
            if (attempt < this.options.maxRetries) {
                const delay = this._calculateRetryDelay(attempt);
                await this._sleep(delay);
            }
        }

        return lastError || ToolOutput.error(`Failed after ${this.options.maxRetries} attempts`);
    }

    /**
     * Execute with global timeout
     */
    async _executeWithTimeout(promise, timeout) {
        return Promise.race([
            promise,
            new Promise((_, reject) => {
                setTimeout(() => reject(ToolError.timeout(timeout)), timeout);
            })
        ]);
    }

    /**
     * Check if result is retryable
     */
    _isRetryable(result) {
        if (result.success) return false;

        const content = result.content?.toLowerCase() || '';
        const retryablePatterns = [
            'timeout',
            'network',
            'econnrefused',
            'enotfound',
            'rate limit',
            '429',
            '503',
            '502',
            'overloaded',
            'temporarily unavailable'
        ];

        return retryablePatterns.some(pattern => content.includes(pattern));
    }

    /**
     * Check if error is retryable
     */
    _isRetryableError(error) {
        const message = error.message?.toLowerCase() || '';
        return (
            message.includes('timeout') ||
            message.includes('network') ||
            message.includes('econnrefused')
        );
    }

    /**
     * Calculate retry delay with exponential backoff and jitter
     */
    _calculateRetryDelay(attempt) {
        const baseDelay =
            this.options.baseRetryDelay *
            Math.pow(this.options.retryBackoffMultiplier, attempt - 1);
        const cappedDelay = Math.min(baseDelay, this.options.maxRetryDelay);

        // Add jitter
        const jitter = cappedDelay * this.options.retryJitter * (Math.random() * 2 - 1);
        return Math.round(cappedDelay + jitter);
    }

    /**
     * Register approval handler
     */
    registerApprovalHandler(handler) {
        this.approvalHandlers.push(handler);
    }

    /**
     * Remove approval handler
     */
    removeApprovalHandler(handler) {
        const index = this.approvalHandlers.indexOf(handler);
        if (index > -1) {
            this.approvalHandlers.splice(index, 1);
        }
    }

    /**
     * Clear session approvals
     */
    clearSessionApprovals() {
        this.sessionApprovals.clear();
    }

    /**
     * Batch execute multiple tools
     */
    async runBatch(toolCalls, context = {}) {
        const results = [];

        for (const call of toolCalls) {
            const result = await this.run(call.name, call.args || {}, context);
            results.push({
                toolName: call.name,
                result
            });

            // Stop on error if configured
            if (!result.success && call.stopOnError) {
                break;
            }
        }

        return results;
    }

    /**
     * Run tools in parallel (only non-mutating)
     */
    async runParallel(toolCalls, context = {}) {
        const promises = toolCalls.map(call =>
            this.run(call.name, call.args || {}, context)
                .then(result => ({ toolName: call.name, result }))
                .catch(error => ({
                    toolName: call.name,
                    result: ToolOutput.error(error.message)
                }))
        );

        return Promise.all(promises);
    }

    /**
     * Plan and execute - analyze query and run appropriate tools
     */
    async planAndExecute(query, context = {}) {
        // Select relevant tools
        const selectedTools = this.registry.selectTools(query, { limit: 3 });

        if (selectedTools.length === 0) {
            return {
                success: false,
                error: 'No suitable tools found for query',
                query
            };
        }

        // Execute best match
        const bestTool = selectedTools[0];
        const result = await this.run(bestTool.name, context.args || {}, context);

        return {
            success: result.success,
            result,
            selectedTool: bestTool.name,
            alternatives: selectedTools.slice(1).map(t => t.name),
            query
        };
    }

    /**
     * Get execution statistics
     */
    getStats() {
        const successful = this.executionHistory.filter(e => e.success).length;
        const failed = this.executionHistory.filter(e => !e.success).length;

        return {
            totalExecutions: this.executionHistory.length,
            successful,
            failed,
            successRate:
                this.executionHistory.length > 0
                    ? ((successful / this.executionHistory.length) * 100).toFixed(1) + '%'
                    : 'N/A',
            avgDuration:
                this.executionHistory.length > 0
                    ? Math.round(
                          this.executionHistory.reduce((sum, e) => sum + e.duration, 0) /
                              this.executionHistory.length
                      )
                    : 0,
            approvalHandlers: this.approvalHandlers.length,
            sessionApprovals: this.sessionApprovals.size
        };
    }

    /**
     * Get recent execution history
     */
    getHistory(limit = 50) {
        return this.executionHistory.slice(-limit);
    }

    // Private helpers

    _getSessionApprovalKey(toolName, invocation) {
        const userId = invocation.userId || 'unknown';
        const sessionId = invocation.context?.sessionId || 'default';
        return `${userId}:${sessionId}:${toolName}`;
    }

    _recordExecution(invocation, result, duration) {
        this.executionHistory.push({
            callId: invocation.callId,
            toolName: invocation.toolName,
            success: result.success,
            duration,
            timestamp: Date.now()
        });

        // Keep history bounded
        if (this.executionHistory.length > 1000) {
            this.executionHistory = this.executionHistory.slice(-1000);
        }
    }

    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = {
    AgentOrchestrator,
    ApprovalDecision,
    SandboxType,
    ToolError
};

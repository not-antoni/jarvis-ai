/**
 * Tool Orchestrator - Codex-inspired tool orchestration and approval management
 * Handles tool call planning, approval, and execution
 */

class ToolOrchestrator {
    constructor(registry, options = {}) {
        this.registry = registry;
        this.options = {
            approvalRequired: false,
            approvalTimeout: 30000,
            maxRetries: 3,
            retryDelay: 1000,
            enablePlanning: true,
            verbose: false,
            ...options
        };
        this.approvalHandlers = [];
        this.plans = new Map();
    }

    /**
     * Plan tool execution before running
     */
    async planExecution(query, context = {}) {
        const selectedTools = this.registry.selectTools(query, context);

        if (selectedTools.length === 0) {
            return {
                viable: false,
                reason: 'No suitable tools found'
            };
        }

        const plan = {
            id: this._generatePlanId(),
            query,
            selectedTools: selectedTools.map(t => ({
                name: t.name,
                description: t.description,
                score: t.score
            })),
            steps: this._generateSteps(selectedTools, query),
            estimatedDuration: this._estimateDuration(selectedTools),
            createdAt: new Date().toISOString()
        };

        this.plans.set(plan.id, plan);

        return {
            viable: true,
            plan
        };
    }

    /**
     * Request approval for tool execution
     */
    async requestApproval(toolName, args, reason = '') {
        const approval = {
            toolName,
            args,
            reason,
            timestamp: new Date().toISOString(),
            requestedAt: Date.now()
        };

        // If no handlers registered, auto-approve
        if (this.approvalHandlers.length === 0) {
            return { approved: true, automatic: true };
        }

        // Get approvals from all handlers
        const approvals = await Promise.race([
            Promise.all(this.approvalHandlers.map(handler => handler(approval))),
            new Promise((_, reject) =>
                setTimeout(
                    () => reject(new Error('Approval timeout')),
                    this.options.approvalTimeout
                )
            )
        ]);

        // All handlers must approve
        return {
            approved: approvals.every(a => a === true),
            responses: approvals,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Register approval handler (e.g., Discord reaction, prompt)
     */
    registerApprovalHandler(handler) {
        this.approvalHandlers.push(handler);
    }

    /**
     * Execute tools with full orchestration
     */
    async execute(query, args = {}, context = {}) {
        const startTime = Date.now();
        const execution = {
            id: this._generateExecutionId(),
            query,
            startTime,
            steps: []
        };

        try {
            // Step 1: Planning
            if (this.options.enablePlanning) {
                const plan = await this.planExecution(query, context);
                if (!plan.viable) {
                    return {
                        success: false,
                        error: plan.reason,
                        duration: Date.now() - startTime
                    };
                }
                execution.planId = plan.plan.id;
                if (this.options.verbose) {
                    console.log(`[ToolOrchestrator] Plan: ${plan.plan.id}`);
                    console.log(
                        `[ToolOrchestrator] Selected tools: ${plan.plan.selectedTools.map(t => t.name).join(', ')}`
                    );
                }
            }

            // Step 2: Select tools
            const selectedTools = this.registry.selectTools(query, context);
            if (selectedTools.length === 0) {
                return {
                    success: false,
                    error: 'No suitable tools found',
                    duration: Date.now() - startTime
                };
            }

            // Step 3: Prepare execution
            const toolCalls = selectedTools.map((tool, index) => ({
                name: tool.name,
                args: args[index] || {},
                requiresApproval: tool.tool.options.requiresApproval,
                step: index + 1
            }));

            // Step 4: Request approvals if needed
            for (const call of toolCalls.filter(c => c.requiresApproval)) {
                const approval = await this.requestApproval(
                    call.name,
                    call.args,
                    `Tool: ${call.name}`
                );

                if (!approval.approved) {
                    return {
                        success: false,
                        error: `Approval denied for tool: ${call.name}`,
                        duration: Date.now() - startTime
                    };
                }

                if (this.options.verbose) {
                    console.log(`[ToolOrchestrator] Approved: ${call.name}`);
                }
            }

            // Step 5: Execute with retries
            const results = [];
            for (const call of toolCalls) {
                let lastError;
                let result;

                for (let attempt = 0; attempt < this.options.maxRetries; attempt++) {
                    try {
                        result = await this.registry.executeTool(call.name, call.args, context);

                        if (result.success) {
                            break;
                        }

                        lastError = result.error;

                        if (attempt < this.options.maxRetries - 1) {
                            await this._delay(this.options.retryDelay);
                        }
                    } catch (error) {
                        lastError = error.message;
                    }
                }

                if (!result || !result.success) {
                    if (this.options.verbose) {
                        console.log(`[ToolOrchestrator] Tool failed: ${call.name} - ${lastError}`);
                    }
                }

                results.push(result || { success: false, error: lastError });
                execution.steps.push({
                    toolName: call.name,
                    result: result || { success: false, error: lastError }
                });
            }

            const duration = Date.now() - startTime;
            execution.endTime = Date.now();
            execution.duration = duration;

            // Summary
            const successful = results.filter(r => r.success).length;
            const failed = results.filter(r => !r.success).length;

            return {
                success: failed === 0,
                results,
                summary: {
                    totalTools: toolCalls.length,
                    successful,
                    failed
                },
                duration,
                executionId: execution.id
            };
        } catch (error) {
            return {
                success: false,
                error: error.message,
                duration: Date.now() - startTime
            };
        }
    }

    /**
     * Get plan by ID
     */
    getPlan(planId) {
        return this.plans.get(planId);
    }

    /**
     * List all plans
     */
    listPlans() {
        return Array.from(this.plans.values());
    }

    /**
     * Clear old plans
     */
    clearOldPlans(ageMs = 3600000) {
        // 1 hour default
        const now = Date.now();
        for (const [id, plan] of this.plans.entries()) {
            const planTime = new Date(plan.createdAt).getTime();
            if (now - planTime > ageMs) {
                this.plans.delete(id);
            }
        }
    }

    // Private methods

    _generatePlanId() {
        return `plan_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    _generateExecutionId() {
        return `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    _generateSteps(tools, query) {
        return tools.map((tool, index) => ({
            step: index + 1,
            tool: tool.name,
            description: tool.description,
            estimatedTime: 5000 // ms
        }));
    }

    _estimateDuration(tools) {
        return tools.reduce((sum, tool) => sum + 5000, 0); // 5s per tool estimate
    }

    _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = ToolOrchestrator;

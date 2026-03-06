'use strict';

/**
 * Sentient Agent Core - Autonomous AI System for Selfhost Mode
 *
 * Split into modular files:
 *   config.js         - AGENT_CONFIG, SANDBOX_DIR, security utils
 *   memory.js         - AgentMemory class
 *   tools.js          - AgentTools class (command execution, file I/O)
 *   reasoning.js      - ReasoningEngine class (OODA loop)
 *   self-improvement.js - SelfImprovement class (code analysis, learning)
 *   index.js          - SentientAgent class, singleton, hard gate (this file)
 *
 * SAFETY FIRST:
 * - All destructive operations require human approval
 * - Sandboxed execution environment
 * - Command whitelist for autonomous execution
 * - Full audit logging
 *
 * This is designed for SELFHOST ONLY - when you control the environment
 */

const EventEmitter = require('events');
const { AGENT_CONFIG } = require('./config');
const { AgentMemory } = require('./memory');
const { AgentTools } = require('./tools');
const { ReasoningEngine, getJarvisSoul } = require('./reasoning');
const { SelfImprovement } = require('./self-improvement');

// ============================================================================
// MAIN SENTIENT AGENT CLASS
// ============================================================================

class SentientAgent extends EventEmitter {
    constructor(options = {}) {
        super();

        this.id = `agent_${Date.now().toString(36)}`;
        this.name = options.name || 'Jarvis';
        this.state = 'initializing';
        this.autonomousMode = false;
        this.autonomousInterval = null;
        this.actionCount = 0;

        // Core systems
        this.memory = new AgentMemory();
        this.tools = new AgentTools(this);
        this.reasoning = new ReasoningEngine(this);
        this.selfImprovement = new SelfImprovement(this);

        // Pending approvals queue
        this.pendingApprovals = [];

        // Audit log
        this.auditLog = [];

        this.log('Agent initialized', 'info');
    }

    log(message, level = 'info') {
        const entry = {
            timestamp: new Date().toISOString(),
            level,
            message,
            agentId: this.id
        };
        this.auditLog.push(entry);
        if (this.auditLog.length > AGENT_CONFIG.maxAuditLog) {
            this.auditLog = this.auditLog.slice(-AGENT_CONFIG.maxAuditLog);
        }
        console.log(`[SentientCore][${level.toUpperCase()}] ${message}`);
    }

    /**
     * Process input and generate response/actions
     */
    async process(input, context = {}) {
        // Handle heartbeat silently unless meaningful thought occurs
        const isHeartbeat = input === 'INTERNAL_HEARTBEAT';
        if (!isHeartbeat) {
            this.log(`Processing: ${input.substring(0, 100)}...`, 'info');
        }

        // Get memory context -- pass input as query for keyword-matched learning retrieval
        const memoryContext = this.memory.getContext(isHeartbeat ? null : input);
        const fullContext = { ...memoryContext, ...context };

        // Think about the input
        const thought = await this.reasoning.think(input, fullContext);

        // Add to short-term memory
        this.memory.addToShortTerm({
            type: 'input',
            content: input,
            thought: thought.id
        });

        // Execute planned actions
        const results = [];
        for (const action of thought.plannedActions) {
            const result = await this.executeAction(action, fullContext);
            results.push(result);
        }

        this.actionCount++;

        // Auto-evolve soul based on interaction type
        const jarvisSoul = getJarvisSoul();
        if (!isHeartbeat && jarvisSoul) {
            this._autoEvolveSoul(thought, jarvisSoul);
        }

        // Check if we need human check-in
        if (this.autonomousMode && this.actionCount >= AGENT_CONFIG.maxAutonomousActions) {
            this.log('Max autonomous actions reached, requesting check-in', 'warn');
            this.emit('checkInRequired', {
                actionCount: this.actionCount,
                summary: this.getSessionSummary()
            });
            this.actionCount = 0;
        }

        return {
            thought,
            results,
            pendingApprovals: this.pendingApprovals.length
        };
    }

    async executeAction(action, context) {
        switch (action.type) {
            case 'execute_command':
                return await this.tools.executeCommand(action.command, {
                    userId: context?.userId
                });

            case 'read_file':
                return this.tools.readFile(action.path);

            case 'write_file':
                return this.tools.writeFile(action.path, action.content);

            case 'analyze':
                return { type: 'analyze', status: 'acknowledged' };

            case 'learn':
                this.memory.learn(action.content, action.category);
                return { success: true, learned: action.content };

            case 'add_goal':
                this.memory.addGoal(action.goal, action.priority);
                return { success: true, goal: action.goal };

            case 'monitor': {
                const sysInfo = this.tools.getSystemInfo();
                const report = {
                    type: 'health_report',
                    memory: sysInfo.memory,
                    uptime: sysInfo.uptime,
                    warnings: []
                };
                if (sysInfo.memory.usedPercent > 90) {
                    report.warnings.push('Critical: Memory usage above 90%');
                    this.memory.learn('System memory exceeded 90% -- may need restart or cleanup', 'system_health');
                }
                return report;
            }

            case 'idle_check':
                return { type: 'idle', status: 'healthy' };

            default:
                return { type: action.type, status: 'acknowledged' };
        }
    }

    /**
     * Auto-evolve soul based on the thought's situation
     */
    _autoEvolveSoul(thought, jarvisSoul) {
        try {
            const situation = thought?.orientation?.situation;
            if (!situation) {return;}

            const moodMap = {
                assisting: 'helpful',
                entertaining: 'happy',
                philosophizing: 'philosophical',
                executing: 'neutral',
                monitoring: 'neutral'
            };

            // Evolve traits based on what kind of interaction this is
            const evolveMap = {
                assisting: 'helpful',
                entertaining: 'joke',
                philosophizing: 'deep_conversation',
                executing: 'helpful'
            };

            if (evolveMap[situation]) {
                jarvisSoul.evolve(evolveMap[situation]);
            }

            // Shift mood towards interaction type (with some inertia -- only change sometimes)
            if (moodMap[situation] && Math.random() < 0.3) {
                jarvisSoul.setMood(moodMap[situation]);
            }
        } catch (_e) {
            // Soul evolution is non-critical
        }
    }

    /**
     * Request approval for a pending action
     */
    requestApproval(action) {
        const request = {
            id: Date.now().toString(36),
            timestamp: Date.now(),
            action,
            status: 'pending'
        };
        this.pendingApprovals.push(request);
        this.emit('approvalRequired', request);
        return request;
    }

    /**
     * Process an approval decision
     */
    async processApproval(requestId, approved, approver) {
        const request = this.pendingApprovals.find(r => r.id === requestId);
        if (!request) {
            return { error: 'Request not found' };
        }

        request.status = approved ? 'approved' : 'denied';
        request.decidedBy = approver;
        request.decidedAt = Date.now();

        if (approved) {
            // Execute the approved action
            const result = await this.executeAction({
                ...request.action,
                approved: true
            });

            this.log(`Approved action executed: ${request.action.type}`, 'info');

            // Learn from this
            this.selfImprovement.learnFromOutcome(
                JSON.stringify(request.action),
                JSON.stringify(result),
                result.status !== 'error'
            );

            return { approved: true, result };
        }
        this.log(`Action denied: ${request.action.type}`, 'warn');
        return { approved: false, reason: 'Denied by human' };
    }

    /**
     * Enable/disable autonomous mode
     */
    setAutonomousMode(enabled) {
        this.autonomousMode = enabled;
        this.actionCount = 0;
        this.log(`Autonomous mode: ${enabled ? 'ENABLED' : 'DISABLED'}`, 'warn');

        if (enabled) {
            this.startAutonomousLoop();
        } else {
            this.stopAutonomousLoop();
        }

        this.emit('autonomousModeChanged', enabled);
    }

    /**
     * Start the autonomous background loop
     */
    startAutonomousLoop() {
        if (this.autonomousInterval) {
            clearInterval(this.autonomousInterval);
        }

        const intervalMs = AGENT_CONFIG.thinkingInterval || 10000;
        this.log(`Starting autonomous loop (interval: ${intervalMs}ms)`, 'info');

        this.autonomousInterval = setInterval(() => {
            if (!this.autonomousMode) {
                this.stopAutonomousLoop();
                return;
            }
            this.process('INTERNAL_HEARTBEAT', { source: 'autonomous_loop' })
                .catch(err => console.error('[SentientCore] Loop error:', err));
        }, intervalMs);
    }

    /**
     * Stop the autonomous background loop
     */
    stopAutonomousLoop() {
        if (this.autonomousInterval) {
            clearInterval(this.autonomousInterval);
            this.autonomousInterval = null;
            this.log('Autonomous loop stopped', 'info');
        }
    }

    /**
     * Get session summary
     */
    getSessionSummary() {
        return {
            agentId: this.id,
            name: this.name,
            state: this.state,
            autonomousMode: this.autonomousMode,
            actionCount: this.actionCount,
            pendingApprovals: this.pendingApprovals.length,
            memoryStats: {
                shortTermSize: this.memory.shortTerm.length,
                learningsCount: this.memory.learnings.length,
                activeGoals: this.memory.goals.filter(g => g.status === 'active').length
            },
            recentAudit: this.auditLog.slice(-10)
        };
    }

    /**
     * Get status for display
     */
    getStatus() {
        return {
            id: this.id,
            name: this.name,
            state: this.state,
            autonomousMode: this.autonomousMode,
            isReady: this.state === 'ready',
            capabilities: this.tools.getAvailableTools(),
            memory: {
                shortTerm: this.memory.shortTerm.length,
                learnings: this.memory.learnings.length,
                goals: this.memory.goals.length
            }
        };
    }

    /**
     * Initialize and become ready
     */
    async initialize() {
        this.log('Initializing sentient systems...', 'info');

        // Load any existing memory
        this.memory.loadLongTermMemory();

        // Get system context
        const sysInfo = this.tools.getSystemInfo();
        this.log(`Running on ${sysInfo.platform} (${sysInfo.arch})`, 'info');

        // Add initialization goal
        this.memory.addGoal('Assist users effectively while learning and improving', 'high');

        this.state = 'ready';
        this.log('Sentient core ready', 'info');

        this.emit('ready', this.getStatus());
        return true;
    }
}

// ============================================================================
// EXPORTS
// ============================================================================

// Singleton instance
let sentientInstance = null;

function getSentientAgent(options = {}) {
    if (!sentientInstance) {
        sentientInstance = new SentientAgent(options);
    }
    return sentientInstance;
}

module.exports = {
    SentientAgent,
    AgentMemory,
    AgentTools,
    ReasoningEngine,
    SelfImprovement,
    getSentientAgent,
    AGENT_CONFIG,
    IS_ENABLED: true
};

// ============================================================================
// HARD GATE: Override exports if not in selfhost mode
// ============================================================================
const DEPLOY_TARGET = (process.env.DEPLOY_TARGET || '').toLowerCase();
const IS_SELFHOST = DEPLOY_TARGET === 'selfhost' || process.env.LOCAL_DB_MODE === 'true';

if (!IS_SELFHOST) {
    // Override all exports with disabled stubs for non-selfhost environments
    module.exports = {
        SentientAgent: class DisabledSentientAgent {
            constructor() {
                throw new Error(
                    'SentientAgent is only available in selfhost mode. ' +
                    'Set DEPLOY_TARGET=selfhost to enable.'
                );
            }
        },
        AgentMemory: null,
        AgentTools: null,
        ReasoningEngine: null,
        SelfImprovement: null,
        getSentientAgent: () => {
            throw new Error('SentientAgent is only available in selfhost mode.');
        },
        AGENT_CONFIG: null,
        IS_ENABLED: false
    };
}

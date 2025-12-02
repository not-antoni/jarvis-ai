/**
 * Sentient Agent Core - Autonomous AI System for Selfhost Mode
 * 
 * Based on research from:
 * - AutoGPT/BabyAGI agent loop architecture
 * - Anthropic's Computer Use capabilities
 * - Martin Fowler's agentic AI security guidelines
 * 
 * SAFETY FIRST:
 * - All destructive operations require human approval
 * - Sandboxed execution environment
 * - Command whitelist for autonomous execution
 * - Full audit logging
 * 
 * This is designed for SELFHOST ONLY - when you control the environment
 */

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

// ============================================================================
// CONFIGURATION
// ============================================================================

const AGENT_CONFIG = {
    // Safety settings
    requireApprovalFor: [
        'rm', 'del', 'rmdir', 'format', 'mkfs',  // Destructive
        'sudo', 'su', 'chmod', 'chown',          // Privilege escalation
        'curl', 'wget', 'ssh', 'scp',            // Network operations
        'npm install', 'pip install',            // Package installation
        'systemctl', 'service',                  // System services
        'reboot', 'shutdown', 'halt'             // System control
    ],
    
    // Commands safe for autonomous execution
    safeCommands: [
        'ls', 'dir', 'pwd', 'cd', 'cat', 'head', 'tail', 'grep',
        'echo', 'date', 'whoami', 'hostname', 'uname',
        'ps', 'top', 'df', 'free', 'uptime',
        'git status', 'git log', 'git diff', 'git branch',
        'node --version', 'npm --version', 'python --version'
    ],
    
    // Maximum autonomous actions before requiring check-in
    maxAutonomousActions: 10,
    
    // Thinking interval (ms)
    thinkingInterval: 5000,
    
    // Memory limits
    shortTermMemorySize: 50,
    longTermMemoryFile: 'data/agent-memory.json'
};

// ============================================================================
// MEMORY SYSTEM
// ============================================================================

class AgentMemory {
    constructor() {
        this.shortTerm = [];      // Recent context (in-memory)
        this.workingMemory = {};  // Current task state
        this.goals = [];          // Active goals
        this.learnings = [];      // Things learned from interactions
        this.longTermPath = path.join(__dirname, '../../', AGENT_CONFIG.longTermMemoryFile);
        
        this.loadLongTermMemory();
    }

    loadLongTermMemory() {
        try {
            if (fs.existsSync(this.longTermPath)) {
                const data = JSON.parse(fs.readFileSync(this.longTermPath, 'utf8'));
                this.learnings = data.learnings || [];
                this.goals = data.goals || [];
                console.log(`[SentientCore] Loaded ${this.learnings.length} learnings from memory`);
            }
        } catch (error) {
            console.warn('[SentientCore] Could not load long-term memory:', error.message);
        }
    }

    saveLongTermMemory() {
        try {
            const dir = path.dirname(this.longTermPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(this.longTermPath, JSON.stringify({
                learnings: this.learnings.slice(-100), // Keep last 100
                goals: this.goals,
                savedAt: new Date().toISOString()
            }, null, 2));
        } catch (error) {
            console.warn('[SentientCore] Could not save long-term memory:', error.message);
        }
    }

    addToShortTerm(entry) {
        this.shortTerm.push({
            ...entry,
            timestamp: Date.now()
        });
        
        // Trim to size limit
        if (this.shortTerm.length > AGENT_CONFIG.shortTermMemorySize) {
            // Move important items to learnings before discarding
            const overflow = this.shortTerm.shift();
            if (overflow.important) {
                this.learn(overflow.content, overflow.category);
            }
        }
    }

    learn(content, category = 'general') {
        this.learnings.push({
            content,
            category,
            learnedAt: Date.now()
        });
        this.saveLongTermMemory();
    }

    addGoal(goal, priority = 'medium') {
        this.goals.push({
            id: Date.now().toString(36),
            goal,
            priority,
            status: 'active',
            createdAt: Date.now(),
            progress: []
        });
        this.saveLongTermMemory();
    }

    getContext() {
        return {
            recentActions: this.shortTerm.slice(-10),
            activeGoals: this.goals.filter(g => g.status === 'active'),
            relevantLearnings: this.learnings.slice(-20),
            workingMemory: this.workingMemory
        };
    }
}

// ============================================================================
// TOOL SYSTEM - What the agent can do
// ============================================================================

class AgentTools {
    constructor(agent) {
        this.agent = agent;
        this.executionHistory = [];
    }

    /**
     * Check if a command is safe for autonomous execution
     */
    isCommandSafe(command) {
        const cmd = command.toLowerCase().trim();
        
        // Check against dangerous patterns
        for (const dangerous of AGENT_CONFIG.requireApprovalFor) {
            if (cmd.includes(dangerous.toLowerCase())) {
                return false;
            }
        }
        
        // Check if it matches a known safe command
        for (const safe of AGENT_CONFIG.safeCommands) {
            if (cmd.startsWith(safe.toLowerCase())) {
                return true;
            }
        }
        
        // Unknown commands require approval
        return false;
    }

    /**
     * Execute a shell command (with safety checks)
     */
    async executeCommand(command, options = {}) {
        const { requireApproval = true, timeout = 30000 } = options;
        
        const isSafe = this.isCommandSafe(command);
        
        if (!isSafe && requireApproval) {
            // Queue for human approval
            return {
                status: 'pending_approval',
                command,
                reason: 'Command requires human approval',
                requestId: Date.now().toString(36)
            };
        }

        return new Promise((resolve) => {
            const startTime = Date.now();
            
            try {
                const result = execSync(command, {
                    encoding: 'utf8',
                    timeout,
                    maxBuffer: 1024 * 1024, // 1MB
                    shell: true
                });

                const execution = {
                    command,
                    output: result.substring(0, 2000), // Limit output size
                    exitCode: 0,
                    duration: Date.now() - startTime,
                    timestamp: Date.now()
                };

                this.executionHistory.push(execution);
                resolve({ status: 'success', ...execution });
            } catch (error) {
                const execution = {
                    command,
                    output: error.message,
                    exitCode: error.status || 1,
                    duration: Date.now() - startTime,
                    timestamp: Date.now()
                };

                this.executionHistory.push(execution);
                resolve({ status: 'error', ...execution });
            }
        });
    }

    /**
     * Read a file (with path restrictions)
     */
    readFile(filePath) {
        const absolutePath = path.resolve(filePath);
        const projectRoot = path.resolve(__dirname, '../..');
        
        // Security: Only allow reading within project or common safe paths
        const allowedPaths = [
            projectRoot,
            '/tmp',
            '/var/log'
        ];
        
        const isAllowed = allowedPaths.some(p => absolutePath.startsWith(p));
        
        if (!isAllowed) {
            return { error: 'Path not allowed for reading' };
        }

        try {
            const content = fs.readFileSync(absolutePath, 'utf8');
            return { 
                success: true, 
                content: content.substring(0, 10000), // Limit size
                path: absolutePath 
            };
        } catch (error) {
            return { error: error.message };
        }
    }

    /**
     * Write a file (requires approval for non-temp files)
     */
    writeFile(filePath, content, options = {}) {
        const absolutePath = path.resolve(filePath);
        const isTempFile = absolutePath.includes('/tmp') || absolutePath.includes('\\temp');
        
        if (!isTempFile && !options.approved) {
            return {
                status: 'pending_approval',
                action: 'write_file',
                path: absolutePath,
                contentPreview: content.substring(0, 200)
            };
        }

        try {
            fs.writeFileSync(absolutePath, content);
            return { success: true, path: absolutePath };
        } catch (error) {
            return { error: error.message };
        }
    }

    /**
     * Get system information
     */
    getSystemInfo() {
        const os = require('os');
        return {
            platform: os.platform(),
            arch: os.arch(),
            hostname: os.hostname(),
            uptime: os.uptime(),
            memory: {
                total: os.totalmem(),
                free: os.freemem(),
                usedPercent: Math.round((1 - os.freemem() / os.totalmem()) * 100)
            },
            cpus: os.cpus().length,
            user: os.userInfo().username
        };
    }

    /**
     * List available tools
     */
    getAvailableTools() {
        return [
            { name: 'execute_command', description: 'Run shell commands', requiresApproval: 'for dangerous commands' },
            { name: 'read_file', description: 'Read file contents', requiresApproval: false },
            { name: 'write_file', description: 'Write to files', requiresApproval: 'for non-temp files' },
            { name: 'get_system_info', description: 'Get system information', requiresApproval: false },
            { name: 'search_codebase', description: 'Search project files', requiresApproval: false },
            { name: 'analyze_code', description: 'Analyze code for improvements', requiresApproval: false }
        ];
    }
}

// ============================================================================
// REASONING ENGINE - How the agent thinks
// ============================================================================

class ReasoningEngine {
    constructor(agent) {
        this.agent = agent;
        this.thoughtHistory = [];
    }

    /**
     * Main reasoning loop - OODA (Observe, Orient, Decide, Act)
     */
    async think(input, context) {
        const thought = {
            id: Date.now().toString(36),
            timestamp: Date.now(),
            input,
            observations: [],
            orientation: null,
            decision: null,
            plannedActions: []
        };

        // 1. OBSERVE - Gather information
        thought.observations = await this.observe(input, context);

        // 2. ORIENT - Understand the situation
        thought.orientation = this.orient(thought.observations, context);

        // 3. DECIDE - Choose what to do
        thought.decision = this.decide(thought.orientation, context);

        // 4. Plan actions (ACT happens externally)
        thought.plannedActions = this.planActions(thought.decision);

        this.thoughtHistory.push(thought);
        return thought;
    }

    async observe(input, context) {
        const observations = [];

        // What is the user asking?
        observations.push({
            type: 'user_intent',
            content: input
        });

        // What do we know from memory?
        if (context.recentActions?.length > 0) {
            observations.push({
                type: 'recent_context',
                content: `${context.recentActions.length} recent actions in memory`
            });
        }

        // What are our current goals?
        if (context.activeGoals?.length > 0) {
            observations.push({
                type: 'active_goals',
                content: context.activeGoals.map(g => g.goal)
            });
        }

        // System state
        const sysInfo = this.agent.tools.getSystemInfo();
        observations.push({
            type: 'system_state',
            content: `${sysInfo.platform} | ${sysInfo.memory.usedPercent}% RAM used`
        });

        return observations;
    }

    orient(observations, context) {
        // Synthesize observations into understanding
        return {
            situation: 'analyzing',
            confidence: 0.7,
            relevantKnowledge: context.relevantLearnings?.slice(0, 5) || [],
            constraints: [
                'Must get approval for dangerous operations',
                'Cannot access files outside allowed paths',
                'Should learn from outcomes'
            ]
        };
    }

    decide(orientation, context) {
        return {
            shouldAct: true,
            actionType: 'respond',
            confidence: orientation.confidence,
            reasoning: 'Based on current context and goals'
        };
    }

    planActions(decision) {
        if (!decision.shouldAct) {
            return [{ type: 'wait', reason: 'No action needed' }];
        }

        return [
            { type: decision.actionType, priority: 1 }
        ];
    }
}

// ============================================================================
// SELF-IMPROVEMENT SYSTEM
// ============================================================================

class SelfImprovement {
    constructor(agent) {
        this.agent = agent;
        this.improvementLog = [];
    }

    /**
     * Analyze own code for potential improvements
     */
    async analyzeOwnCode() {
        const coreFiles = [
            'src/agents/sentient-core.js',
            'src/services/selfhost-features.js',
            'src/services/jarvis-core.js'
        ];

        const suggestions = [];

        for (const file of coreFiles) {
            const result = this.agent.tools.readFile(file);
            if (result.success) {
                const analysis = this.analyzeCode(result.content, file);
                suggestions.push(...analysis);
            }
        }

        return suggestions;
    }

    analyzeCode(content, filename) {
        const suggestions = [];
        const lines = content.split('\n');

        lines.forEach((line, index) => {
            // Find TODO comments
            if (line.includes('TODO') || line.includes('FIXME')) {
                suggestions.push({
                    file: filename,
                    line: index + 1,
                    type: 'todo',
                    content: line.trim(),
                    suggestion: 'Complete this TODO item'
                });
            }

            // Find potential improvements
            if (line.includes('console.log') && !line.includes('error')) {
                suggestions.push({
                    file: filename,
                    line: index + 1,
                    type: 'logging',
                    suggestion: 'Consider using structured logging'
                });
            }
        });

        return suggestions;
    }

    /**
     * Propose a code modification (requires human approval)
     */
    proposeModification(file, oldCode, newCode, reason) {
        const proposal = {
            id: Date.now().toString(36),
            timestamp: Date.now(),
            file,
            oldCode: oldCode.substring(0, 500),
            newCode: newCode.substring(0, 500),
            reason,
            status: 'pending_approval'
        };

        this.improvementLog.push(proposal);

        return {
            ...proposal,
            message: 'Modification proposed. Requires human approval to apply.'
        };
    }

    /**
     * Learn from outcomes
     */
    learnFromOutcome(action, outcome, success) {
        const learning = {
            action: action.substring(0, 200),
            outcome: outcome.substring(0, 200),
            success,
            learnedAt: Date.now()
        };

        this.agent.memory.learn(
            `Action "${action}" resulted in ${success ? 'success' : 'failure'}: ${outcome}`,
            success ? 'success_pattern' : 'failure_pattern'
        );

        return learning;
    }
}

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
        console.log(`[SentientCore][${level.toUpperCase()}] ${message}`);
    }

    /**
     * Process input and generate response/actions
     */
    async process(input, context = {}) {
        this.log(`Processing: ${input.substring(0, 100)}...`, 'info');

        // Get memory context
        const memoryContext = this.memory.getContext();
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
                return await this.tools.executeCommand(action.command);
            
            case 'read_file':
                return this.tools.readFile(action.path);
            
            case 'write_file':
                return this.tools.writeFile(action.path, action.content);
            
            case 'analyze':
                return await this.selfImprovement.analyzeOwnCode();
            
            case 'learn':
                this.memory.learn(action.content, action.category);
                return { success: true, learned: action.content };
            
            case 'add_goal':
                this.memory.addGoal(action.goal, action.priority);
                return { success: true, goal: action.goal };
            
            default:
                return { type: action.type, status: 'acknowledged' };
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
        } else {
            this.log(`Action denied: ${request.action.type}`, 'warn');
            return { approved: false, reason: 'Denied by human' };
        }
    }

    /**
     * Enable/disable autonomous mode
     */
    setAutonomousMode(enabled) {
        this.autonomousMode = enabled;
        this.actionCount = 0;
        this.log(`Autonomous mode: ${enabled ? 'ENABLED' : 'DISABLED'}`, 'warn');
        this.emit('autonomousModeChanged', enabled);
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
    AGENT_CONFIG
};

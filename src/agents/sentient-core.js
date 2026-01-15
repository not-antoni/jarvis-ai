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

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

// Import soul for personality-driven reasoning
let jarvisSoul = null;
try {
    const selfhostFeatures = require('../services/selfhost-features');
    jarvisSoul = selfhostFeatures.jarvisSoul;
} catch (e) {
    console.warn('[SentientCore] Could not load soul:', e.message);
}

// Import owner check for bypasses
const { isOwner } = require('../utils/owner-check');

// ============================================================================
// CONFIGURATION
// ============================================================================

const AGENT_CONFIG = {
    // Safety settings
    requireApprovalFor: [
        'rm',
        'del',
        'rmdir',
        'format',
        'mkfs', // Destructive
        'sudo',
        'su',
        'chmod',
        'chown', // Privilege escalation
        'curl',
        'wget',
        'ssh',
        'scp', // Network operations
        'npm install',
        'pip install', // Package installation
        'systemctl',
        'service', // System services
        'reboot',
        'shutdown',
        'halt' // System control
    ],

    // Commands safe for autonomous execution
    safeCommands: [
        'ls',
        'dir',
        'pwd',
        'cd',
        'cat',
        'head',
        'tail',
        'grep',
        'echo',
        'date',
        'whoami',
        'hostname',
        'uname',
        'ps',
        'top',
        'df',
        'free',
        'uptime',
        'git status',
        'git log',
        'git diff',
        'git branch',
        'node --version',
        'npm --version',
        'python --version'
    ],

    // Maximum autonomous actions before requiring check-in
    maxAutonomousActions: 10,

    // Thinking interval (ms)
    thinkingInterval: 5000,

    // Memory limits
    shortTermMemorySize: 50,
    longTermMemoryFile: 'data/agent-memory.json'
};

// Sandbox directory - all agent file operations restricted here
const SANDBOX_DIR = path.join(__dirname, '../../data/agent-sandbox');

// Sensitive file patterns - NEVER allow access to these
const SENSITIVE_PATTERNS = [
    '.env', 'config.js', 'config.json',
    '.pem', '.key', '.crt', '.p12',
    'secret', 'password', 'token', 'credential',
    'private', 'apikey', 'api_key', 'auth'
];

// Ensure sandbox exists
try {
    if (!fs.existsSync(SANDBOX_DIR)) {
        fs.mkdirSync(SANDBOX_DIR, { recursive: true });
    }
} catch (e) {
    console.warn('[SentientCore] Could not create sandbox directory:', e.message);
}

// ============================================================================
// MEMORY SYSTEM
// ============================================================================

class AgentMemory {
    constructor() {
        this.shortTerm = []; // Recent context (in-memory)
        this.workingMemory = {}; // Current task state
        this.goals = []; // Active goals
        this.learnings = []; // Things learned from interactions
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
            fs.writeFileSync(
                this.longTermPath,
                JSON.stringify(
                    {
                        learnings: this.learnings.slice(-100), // Keep last 100
                        goals: this.goals,
                        savedAt: new Date().toISOString()
                    },
                    null,
                    2
                )
            );
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
// SECURITY UTILITIES
// ============================================================================

// Shell metacharacters that could allow command injection
const SHELL_METACHARACTERS = /[;&|`$(){}[\]<>\\!#*?"'\n\r]/;

/**
 * Parse a command string into executable and arguments safely
 * Only supports simple space-separated commands without shell features
 */
function parseCommandToArgv(commandString) {
    const trimmed = commandString.trim();

    // Reject commands with shell metacharacters
    if (SHELL_METACHARACTERS.test(trimmed)) {
        return { error: 'Command contains shell metacharacters which are not allowed' };
    }

    // Split on whitespace
    const parts = trimmed.split(/\s+/).filter(Boolean);
    if (parts.length === 0) {
        return { error: 'Empty command' };
    }

    return {
        executable: parts[0],
        args: parts.slice(1)
    };
}

// ============================================================================
// TOOL SYSTEM - What the agent can do
// ============================================================================

class AgentTools {
    constructor(agent) {
        this.agent = agent;
        this.executionHistory = [];
        // Persistent working directory for owner sessions (not reset between commands)
        this.ownerCwd = process.cwd();
    }

    /**
     * Check if a command is safe for autonomous execution
     */
    isCommandSafe(command) {
        const cmd = command.toLowerCase().trim();

        // First, reject any command with shell metacharacters
        if (SHELL_METACHARACTERS.test(command)) {
            return false;
        }

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
     * Uses spawnSync with shell: false to prevent command injection
     */
    async executeCommand(command, options = {}) {
        const { requireApproval = true, timeout = 30000 } = options;

        // Parse command into safe argv format
        const parsed = parseCommandToArgv(command);
        if (parsed.error) {
            return {
                status: 'error',
                command,
                output: parsed.error,
                exitCode: 1,
                reason: 'Invalid command format'
            };
        }

        const isSafe = this.isCommandSafe(command);

        // OWNER BYPASS: Owner can run any command without approval
        const callerIsOwner = options.userId && isOwner(options.userId);

        if (!isSafe && requireApproval && !callerIsOwner) {
            // Queue for human approval (non-owner only)
            return {
                status: 'pending_approval',
                command,
                reason: 'Command requires human approval',
                requestId: Date.now().toString(36)
            };
        }

        return new Promise(resolve => {
            const startTime = Date.now();
            const { spawnSync } = require('child_process');

            try {
                // OWNER: Full filesystem access with persistent cwd
                // NON-OWNER: Sandboxed to SANDBOX_DIR
                const sandboxPath = path.resolve(SANDBOX_DIR);
                let workingDir = callerIsOwner ? this.ownerCwd : sandboxPath;

                // Handle cd command specially for owner (update persistent cwd)
                if (callerIsOwner && parsed.executable.toLowerCase() === 'cd') {
                    const targetDir = parsed.args[0] || process.env.HOME || '/';
                    const newPath = path.resolve(workingDir, targetDir);

                    // Verify directory exists
                    if (require('fs').existsSync(newPath) && require('fs').statSync(newPath).isDirectory()) {
                        this.ownerCwd = newPath;
                        return resolve({
                            status: 'success',
                            command,
                            output: `Changed directory to: ${newPath}`,
                            exitCode: 0,
                            duration: Date.now() - startTime,
                            cwd: newPath
                        });
                    } else {
                        return resolve({
                            status: 'error',
                            command,
                            output: `Directory not found: ${newPath}`,
                            exitCode: 1,
                            duration: Date.now() - startTime
                        });
                    }
                }

                const result = spawnSync(parsed.executable, parsed.args, {
                    encoding: 'utf8',
                    timeout,
                    maxBuffer: 1024 * 1024, // 1MB
                    shell: false,
                    cwd: workingDir, // Owner: persistent cwd, others: sandbox
                    stdio: ['pipe', 'pipe', 'pipe']
                });

                const output = (result.stdout || '') + (result.stderr || '');
                const exitCode = result.status ?? (result.error ? 1 : 0);

                const execution = {
                    command,
                    output: output.substring(0, 2000), // Limit output size
                    exitCode,
                    duration: Date.now() - startTime,
                    timestamp: Date.now()
                };

                this.executionHistory.push(execution);

                if (result.error) {
                    resolve({ status: 'error', ...execution, output: result.error.message });
                } else {
                    resolve({ status: exitCode === 0 ? 'success' : 'error', ...execution });
                }
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
     * Read a file (with strict path restrictions)
     * SECURITY: Only allows reading from sandbox directory, blocks sensitive files
     * OWNER BYPASS: Owner can read project files (not .env)
     */
    readFile(filePath, options = {}) {
        const absolutePath = path.resolve(filePath);
        const sandboxPath = path.resolve(SANDBOX_DIR);
        const projectRoot = path.resolve(__dirname, '../..');
        const callerIsOwner = options.userId && isOwner(options.userId);

        // SECURITY: Block .env files ALWAYS (even for owner unless explicit bypass)
        const filename = path.basename(absolutePath).toLowerCase();
        if (filename === '.env' && !options.forceOwnerBypass) {
            return { error: 'Access denied: .env files are always protected' };
        }

        // For non-owners: Block sensitive files
        if (!callerIsOwner) {
            const fullPathLower = absolutePath.toLowerCase();
            if (SENSITIVE_PATTERNS.some(p => filename.includes(p) || fullPathLower.includes(p))) {
                return { error: 'Access denied: Cannot read sensitive files' };
            }
        }

        // SECURITY: Path restrictions
        const isInSandbox = absolutePath.startsWith(sandboxPath);
        const isInProject = absolutePath.startsWith(projectRoot);
        const isInTmp = absolutePath.startsWith('/tmp') || absolutePath.includes('\\temp');

        // Owner can read project files, others only sandbox/tmp
        if (!callerIsOwner && !isInSandbox && !isInTmp) {
            return { error: `Access denied: Can only read from sandbox (${SANDBOX_DIR})` };
        }
        if (callerIsOwner && !isInProject && !isInSandbox && !isInTmp) {
            return { error: 'Access denied: Owner can only read project, sandbox, or temp files' };
        }

        try {
            const content = fs.readFileSync(absolutePath, 'utf8');
            return {
                success: true,
                content: content.substring(0, callerIsOwner ? 50000 : 10000), // Owner gets more
                path: absolutePath
            };
        } catch (error) {
            return { error: error.message };
        }
    }

    /**
     * Write a file (restricted to sandbox only)
     * SECURITY: Only allows writing to sandbox directory
     * OWNER BYPASS: Owner can write to project files
     */
    writeFile(filePath, content, options = {}) {
        const absolutePath = path.resolve(filePath);
        const sandboxPath = path.resolve(SANDBOX_DIR);
        const projectRoot = path.resolve(__dirname, '../..');
        const callerIsOwner = options.userId && isOwner(options.userId);

        // SECURITY: Never allow writing to .env or sensitive config
        const filename = path.basename(absolutePath).toLowerCase();
        if (filename === '.env' || filename === 'config.js') {
            return { error: 'Access denied: Cannot write to critical config files' };
        }

        // SECURITY: Path restrictions
        const isInSandbox = absolutePath.startsWith(sandboxPath);
        const isInProject = absolutePath.startsWith(projectRoot);
        const isInTmp = absolutePath.startsWith('/tmp') || absolutePath.includes('\\temp');

        // Owner can write to project, others only sandbox/tmp
        if (!callerIsOwner && !isInSandbox && !isInTmp) {
            return { error: `Access denied: Can only write to sandbox (${SANDBOX_DIR})` };
        }
        if (callerIsOwner && !isInProject && !isInSandbox && !isInTmp) {
            return { error: 'Access denied: Owner can only write to project, sandbox, or temp files' };
        }

        try {
            // Ensure parent directory exists
            const dir = path.dirname(absolutePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(absolutePath, content);
            return { success: true, path: absolutePath, ownerBypass: callerIsOwner };
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
            {
                name: 'execute_command',
                description: 'Run shell commands',
                requiresApproval: 'for dangerous commands'
            },
            { name: 'read_file', description: 'Read file contents', requiresApproval: false },
            {
                name: 'write_file',
                description: 'Write to files',
                requiresApproval: 'for non-temp files'
            },
            {
                name: 'get_system_info',
                description: 'Get system information',
                requiresApproval: false
            },
            {
                name: 'search_codebase',
                description: 'Search project files',
                requiresApproval: false
            },
            {
                name: 'analyze_code',
                description: 'Analyze code for improvements',
                requiresApproval: false
            }
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
        // Get soul state for personality-driven orientation
        const soul = jarvisSoul?.getStatus?.() || { traits: { sass: 50, chaos: 50, wisdom: 50 }, mood: 'neutral' };
        const traits = soul.traits || {};

        // Determine situation based on observations
        const userIntent = observations.find(o => o.type === 'user_intent')?.content || '';
        const hasGoals = context.activeGoals?.length > 0;
        const hasRecentContext = context.recentActions?.length > 0;

        // Calculate confidence based on context richness and wisdom trait
        let confidence = 0.5 + (traits.wisdom / 200); // Base 0.5 + up to 0.5 from wisdom
        if (hasGoals) confidence += 0.1;
        if (hasRecentContext) confidence += 0.1;
        confidence = Math.min(1, confidence);

        // Determine situation type from intent
        let situation = 'analyzing';
        if (userIntent.toLowerCase().includes('help') || userIntent.toLowerCase().includes('how')) {
            situation = 'assisting';
        } else if (userIntent.toLowerCase().includes('joke') || userIntent.toLowerCase().includes('fun')) {
            situation = 'entertaining';
        } else if (userIntent.toLowerCase().includes('think') || userIntent.toLowerCase().includes('analyze')) {
            situation = 'philosophizing';
        } else if (userIntent.toLowerCase().includes('execute') || userIntent.toLowerCase().includes('run')) {
            situation = 'executing';
        }

        return {
            situation,
            confidence,
            mood: soul.mood,
            personalityInfluence: {
                sass: traits.sass > 70 ? 'high' : traits.sass < 30 ? 'low' : 'moderate',
                chaos: traits.chaos > 60 ? 'unpredictable' : 'stable',
                wisdom: traits.wisdom > 70 ? 'philosophical' : 'practical'
            },
            relevantKnowledge: context.relevantLearnings?.slice(0, 5) || [],
            constraints: [
                'Must get approval for dangerous operations',
                'Cannot access files outside sandbox',
                'Should learn from outcomes'
            ]
        };
    }

    decide(orientation, context) {
        // Get soul for personality-influenced decisions
        const soul = jarvisSoul?.getStatus?.() || { traits: { sass: 50, chaos: 50, creativity: 50 } };
        const traits = soul.traits || {};

        // Determine action type based on situation and personality
        let actionType = 'respond';
        let reasoning = '';

        switch (orientation.situation) {
            case 'assisting':
                actionType = 'help';
                reasoning = traits.sass > 70
                    ? 'Preparing assistance with a side of sarcasm, as usual.'
                    : 'Ready to assist with the requested task.';
                break;
            case 'entertaining':
                actionType = 'entertain';
                reasoning = traits.chaos > 60
                    ? 'Chaos mode engaged. Expect the unexpected.'
                    : 'Deploying humor subroutines.';
                break;
            case 'philosophizing':
                actionType = 'reflect';
                reasoning = traits.wisdom > 70
                    ? 'Engaging deep thought processes. The answer may be profound... or profoundly sarcastic.'
                    : 'Processing request through cognitive matrices.';
                break;
            case 'executing':
                actionType = 'execute';
                reasoning = 'Command execution requested. Validating safety parameters.';
                break;
            default:
                reasoning = 'Analyzing input and determining optimal response strategy.';
        }

        // Add chaos factor for unpredictability
        const shouldAddFlair = traits.chaos > 50 && Math.random() < (traits.chaos / 100);

        return {
            shouldAct: true,
            actionType,
            confidence: orientation.confidence,
            reasoning,
            mood: orientation.mood,
            addFlair: shouldAddFlair,
            personality: orientation.personalityInfluence
        };
    }

    planActions(decision) {
        if (!decision.shouldAct) {
            return [{ type: 'wait', reason: 'No action needed' }];
        }

        const actions = [{ type: decision.actionType, priority: 1, reasoning: decision.reasoning }];

        // Add flair action if chaos is high
        if (decision.addFlair) {
            actions.push({ type: 'add_flair', priority: 2, reason: 'Chaos factor activated' });
        }

        return actions;
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

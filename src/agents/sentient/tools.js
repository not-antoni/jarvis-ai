'use strict';

const fs = require('fs');
const path = require('path');
const { isOwner, getOwnerId } = require('../../utils/owner-check');
const {
    AGENT_CONFIG,
    SANDBOX_DIR,
    SENSITIVE_PATTERNS,
    SHELL_METACHARACTERS,
    parseCommandToArgv
} = require('./config');

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
     * Uses async exec for owner, spawnSync with shell: false for non-owner
     * OWNER BYPASS: Owner can use shell metacharacters
     */
    async executeCommand(command, options = {}) {
        const { requireApproval = true, timeout = 30000 } = options;

        const ownerId = getOwnerId();
        const callerUserId = options.userId ? String(options.userId).trim() : null;
        const callerIsOwner = Boolean(ownerId && callerUserId && callerUserId === String(ownerId).trim());

        // Hardened security: shell execution is owner-only.
        if (!callerIsOwner) {
            return {
                status: 'forbidden',
                command,
                output: ownerId
                    ? 'Sentient shell execution is restricted to the configured owner.'
                    : 'Sentient shell execution is disabled until an owner ID is configured.',
                exitCode: 1,
                duration: 0,
                reason: 'Owner-only command execution'
            };
        }

        // Parse command into safe argv format (skip for owner - they get full shell)
        const parsed = callerIsOwner ? { executable: command, args: [] } : parseCommandToArgv(command);
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

        if (!isSafe && requireApproval && !callerIsOwner) {
            // Queue for human approval (non-owner only)
            return {
                status: 'pending_approval',
                command,
                reason: 'Command requires human approval',
                requestId: Date.now().toString(36)
            };
        }

        const startTime = Date.now();

        // OWNER: Full filesystem access with persistent cwd
        // NON-OWNER: Sandboxed to SANDBOX_DIR
        const sandboxPath = path.resolve(SANDBOX_DIR);
        const workingDir = callerIsOwner ? this.ownerCwd : sandboxPath;

        // Handle cd command specially for owner (update persistent cwd)
        if (callerIsOwner && parsed.executable.toLowerCase() === 'cd') {
            const targetDir = parsed.args[0] || process.env.HOME || '/';
            const newPath = path.resolve(workingDir, targetDir);

            if (fs.existsSync(newPath) && fs.statSync(newPath).isDirectory()) {
                this.ownerCwd = newPath;
                return {
                    status: 'success',
                    command,
                    output: `Changed directory to: ${newPath}`,
                    exitCode: 0,
                    duration: Date.now() - startTime,
                    cwd: newPath
                };
            }
            return {
                status: 'error',
                command,
                output: `Directory not found: ${newPath}`,
                exitCode: 1,
                duration: Date.now() - startTime
            };
        }

        const _recordExecution = (exec) => {
            this.executionHistory.push(exec);
            if (this.executionHistory.length > AGENT_CONFIG.maxExecutionHistory) {
                this.executionHistory = this.executionHistory.slice(-AGENT_CONFIG.maxExecutionHistory);
            }
        };

        try {
            let output, exitCode;

            if (callerIsOwner) {
                // Owner: async exec with shell for full command support (pipes, etc)
                const { exec: execAsync } = require('child_process');
                const result = await new Promise((resolve, reject) => {
                    execAsync(command, {
                        encoding: 'utf8',
                        timeout,
                        maxBuffer: 5 * 1024 * 1024,
                        cwd: workingDir
                    }, (error, stdout, stderr) => {
                        if (error) {
                            error.stdout = stdout;
                            error.stderr = stderr;
                            return reject(error);
                        }
                        resolve({ stdout, stderr });
                    });
                });
                output = (result.stdout || '') + (result.stderr || '');
                exitCode = 0;
            } else {
                // Non-owner: spawnSync with shell: false for security
                const { spawnSync } = require('child_process');
                const result = spawnSync(parsed.executable, parsed.args, {
                    encoding: 'utf8',
                    timeout,
                    maxBuffer: 1024 * 1024,
                    shell: false,
                    cwd: workingDir,
                    stdio: ['pipe', 'pipe', 'pipe']
                });
                output = (result.stdout || '') + (result.stderr || '');
                exitCode = result.status ?? (result.error ? 1 : 0);

                if (result.error) {
                    const execution = {
                        command,
                        output: result.error.message,
                        exitCode: 1,
                        duration: Date.now() - startTime,
                        timestamp: Date.now()
                    };
                    _recordExecution(execution);
                    return { status: 'error', ...execution };
                }
            }

            const execution = {
                command,
                output: output.substring(0, callerIsOwner ? 4000 : 2000),
                exitCode,
                duration: Date.now() - startTime,
                timestamp: Date.now()
            };
            _recordExecution(execution);
            return { status: exitCode === 0 ? 'success' : 'error', ...execution };
        } catch (error) {
            // For owner async exec, include stdout/stderr from the error if available
            const errorOutput = callerIsOwner
                ? ((error.stdout || '') + (error.stderr || '') || error.message)
                : error.message;
            const execution = {
                command,
                output: errorOutput.substring(0, callerIsOwner ? 4000 : 2000),
                exitCode: error.code || error.status || 1,
                duration: Date.now() - startTime,
                timestamp: Date.now()
            };
            _recordExecution(execution);
            return { status: 'error', ...execution };
        }
    }

    /**
     * Read a file (with strict path restrictions)
     * SECURITY: Only allows reading from sandbox directory, blocks sensitive files
     * OWNER BYPASS: Owner can read project files (not .env)
     */
    readFile(filePath, options = {}) {
        const absolutePath = path.resolve(filePath);
        const sandboxPath = path.resolve(SANDBOX_DIR);
        const projectRoot = path.resolve(__dirname, '../../..');
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
        const projectRoot = path.resolve(__dirname, '../../..');
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
     * Get system information (cached for 30 seconds to avoid repeated os.cpus() calls)
     */
    getSystemInfo() {
        const now = Date.now();
        if (this._sysInfoCache && now - this._sysInfoCacheTime < 30000) {
            return this._sysInfoCache;
        }
        const os = require('os');
        this._sysInfoCache = {
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
        this._sysInfoCacheTime = now;
        return this._sysInfoCache;
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

module.exports = { AgentTools };

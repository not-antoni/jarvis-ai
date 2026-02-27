'use strict';

const fs = require('fs');
const path = require('path');

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
    longTermMemoryFile: 'data/agent-memory.json',

    // History limits (prevent unbounded growth)
    maxExecutionHistory: 200,
    maxAuditLog: 500,
    maxThoughtHistory: 200,
    maxImprovementLog: 100,

    // Self-improvement analysis targets (overridable)
    analysisTargets: [
        'src/agents/sentient-core.js',
        'src/services/selfhost-features.js',
        'src/services/jarvis-core.js'
    ]
};

// Sandbox directory - all agent file operations restricted here
const SANDBOX_DIR = path.join(__dirname, '../../../data/agent-sandbox');

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

module.exports = {
    AGENT_CONFIG,
    SANDBOX_DIR,
    SENSITIVE_PATTERNS,
    SHELL_METACHARACTERS,
    parseCommandToArgv
};

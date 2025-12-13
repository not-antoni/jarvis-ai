/**
 * Jarvis Agent Core - Main exports
 * Codex-inspired intelligent agent system
 */

// Core components
const { AgentCore, createAgent } = require('./AgentCore');
const AgentToolRegistry = require('./AgentToolRegistry');
const {
    AgentOrchestrator,
    ApprovalDecision,
    SandboxType,
    ToolError
} = require('./AgentOrchestrator');

// Tool system
const {
    ToolHandler,
    FunctionHandler,
    ShellHandler,
    ToolOutput,
    ToolInvocation,
    ToolKind,
    ApprovalRequirement
} = require('./ToolHandler');

// AI Provider
const { FreeAIProvider, setupFreeAI, FREE_MODELS } = require('./FreeAIProvider');

// Built-in tools
const { ScreenshotTool, QuickScreenshotTool } = require('./tools/ScreenshotTool');

// Legacy adapters (for backwards compatibility)
const SmartToolRegistry = require('./SmartToolRegistry');
const ToolOrchestrator = require('./ToolOrchestrator');
const CodexIntegrationAdapter = require('./CodexIntegrationAdapter');
const SmartToolDefinition = require('./SmartToolDefinition');

module.exports = {
    // Main agent
    AgentCore,
    createAgent,

    // Registry & Orchestration
    AgentToolRegistry,
    AgentOrchestrator,
    ApprovalDecision,
    SandboxType,
    ToolError,

    // Tool system
    ToolHandler,
    FunctionHandler,
    ShellHandler,
    ToolOutput,
    ToolInvocation,
    ToolKind,
    ApprovalRequirement,

    // AI
    FreeAIProvider,
    setupFreeAI,
    FREE_MODELS,

    // Built-in tools
    ScreenshotTool,
    QuickScreenshotTool,

    // Legacy (deprecated but available)
    SmartToolRegistry,
    ToolOrchestrator,
    CodexIntegrationAdapter,
    SmartToolDefinition
};

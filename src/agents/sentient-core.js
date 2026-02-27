'use strict';

/**
 * Sentient Agent Core - Re-export shim
 *
 * The sentient agent system has been split into modular files under
 * src/agents/sentient/. This file re-exports the public API so that
 * all existing require('./sentient-core') calls continue to work.
 *
 * Module structure:
 *   sentient/config.js           - AGENT_CONFIG, SANDBOX_DIR, security utils
 *   sentient/memory.js           - AgentMemory class
 *   sentient/tools.js            - AgentTools class (command execution, file I/O)
 *   sentient/reasoning.js        - ReasoningEngine class (OODA loop)
 *   sentient/self-improvement.js - SelfImprovement class (code analysis, learning)
 *   sentient/index.js            - SentientAgent class, singleton, hard gate
 */

module.exports = require('./sentient');

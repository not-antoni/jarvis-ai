# Sentient Agent Design Document

## Overview

This document describes the architecture for Jarvis's autonomous "sentient" capabilities, designed for **selfhost mode only**. The system enables Jarvis to control the host PC (especially Linux environments) while maintaining strict safety controls.

## Research Findings

### How Autonomous Agents Work (From Research)

Based on analysis of AutoGPT, BabyAGI, and academic papers:

1. **Agent Loop (OODA)**
   - **Observe**: Gather information from environment
   - **Orient**: Understand the situation in context
   - **Decide**: Choose appropriate action
   - **Act**: Execute and observe results

2. **Memory Architecture**
   - **Short-term**: Current context window (~50 items)
   - **Working memory**: Active task state
   - **Long-term**: Persistent learnings (vector DB or JSON)
   - **Episodic**: Specific interaction records

3. **Tool Use**
   - Shell command execution
   - File system access
   - API calls
   - Code analysis/generation

### Security Concerns (From Martin Fowler & WIRED Research)

**The "Lethal Trifecta" of AI Agent Risks:**
1. Access to sensitive data
2. Ability to communicate externally
3. Exposure to untrusted content

**How Attackers Use Autonomous Agents:**
- **Prompt Injection Worms**: Self-replicating prompts that spread through AI systems
- **Data Exfiltration**: Using agent permissions to steal sensitive data
- **Privilege Escalation**: Tricking agents into running dangerous commands
- **RAG Poisoning**: Injecting malicious content into agent knowledge bases

### Our Mitigations

| Risk | Mitigation |
|------|------------|
| Dangerous commands | Approval whitelist system |
| File system access | Path restrictions |
| Network access | Blocked by default |
| Self-modification | Human approval required |
| Runaway execution | Max action limit + check-ins |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    SENTIENT AGENT CORE                       │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │   MEMORY    │  │  REASONING   │  │  SELF-IMPROVEMENT │   │
│  │  SYSTEM     │  │   ENGINE     │  │     SYSTEM        │   │
│  │             │  │              │  │                   │   │
│  │ - Short-term│  │ - OODA Loop  │  │ - Code analysis   │   │
│  │ - Long-term │  │ - Planning   │  │ - Learn from      │   │
│  │ - Goals     │  │ - Decisions  │  │   outcomes        │   │
│  │ - Learnings │  │              │  │ - Propose changes │   │
│  └─────────────┘  └──────────────┘  └──────────────────┘   │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │                    TOOL SYSTEM                       │    │
│  │                                                      │    │
│  │  [Shell Commands]  [File I/O]  [System Info]        │    │
│  │                                                      │    │
│  │  ┌─────────────────────────────────────────────┐    │    │
│  │  │           SAFETY LAYER                       │    │    │
│  │  │  - Command whitelist/blacklist               │    │    │
│  │  │  - Path restrictions                         │    │    │
│  │  │  - Human approval queue                      │    │    │
│  │  │  - Audit logging                             │    │    │
│  │  └─────────────────────────────────────────────┘    │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Command Safety Classification

### ✅ Safe (Autonomous Execution)
```bash
ls, dir, pwd, cat, head, tail, grep
echo, date, whoami, hostname, uname
ps, top, df, free, uptime
git status, git log, git diff
node --version, npm --version
```

### ⚠️ Requires Approval
```bash
rm, del, rmdir           # Destructive
sudo, su, chmod, chown   # Privilege escalation
curl, wget, ssh, scp     # Network operations
npm install, pip install # Package installation
systemctl, service       # System services
reboot, shutdown         # System control
```

## Memory System

### Short-Term Memory
- Last 50 interactions/observations
- In-memory only, fast access
- Automatically promotes important items to long-term

### Long-Term Memory
- Persisted to `data/agent-memory.json`
- Categories: success_pattern, failure_pattern, user_preference
- Limited to 100 items (oldest discarded)

### Goal System
- Persistent goals across sessions
- Priority levels: low, medium, high
- Progress tracking per goal

## Self-Improvement Capabilities

### What It CAN Do (Autonomously)
- Analyze own code for TODOs/improvements
- Learn from successful/failed actions
- Build knowledge of effective patterns
- Suggest optimizations

### What It CANNOT Do (Without Approval)
- Modify its own source code
- Install new dependencies
- Change system configuration
- Execute network requests

## Activation Modes

### 1. Interactive Mode (Default)
- Responds to explicit commands
- Always requires human input
- Full audit logging

### 2. Semi-Autonomous Mode
- Can perform up to 10 safe actions independently
- Queues dangerous operations for approval
- Requires periodic check-in

### 3. Full Autonomous Mode (⚠️ Experimental)
- Only enable on isolated/sandboxed systems
- All safety controls still active
- Recommended: Run in Docker container

## Integration with Discord

```javascript
// Example: Triggering sentient mode
const { getSentientAgent } = require('./agents/sentient-core');

// In selfhost mode only
if (config.deployment.selfhostMode) {
    const agent = getSentientAgent({ name: 'Jarvis' });
    await agent.initialize();
    
    // Process a request
    const result = await agent.process('Check system status');
    
    // Handle approval requests
    agent.on('approvalRequired', async (request) => {
        // Notify owner via Discord DM
        // Wait for approval
    });
}
```

## Future Enhancements

### Phase 1 (Current)
- [x] Basic agent loop
- [x] Memory system
- [x] Command safety layer
- [x] Approval queue

### Phase 2 (Planned)
- [ ] Local LLM integration (Ollama)
- [ ] Vector memory with embeddings
- [ ] MCP server integration
- [ ] Voice command support

### Phase 3 (Future)
- [ ] Multi-agent coordination
- [ ] Proactive monitoring
- [ ] Self-healing capabilities
- [ ] Full Docker sandboxing

## Safety Checklist Before Enabling

- [ ] Running on dedicated/isolated machine
- [ ] Backup of important data
- [ ] Discord notifications configured
- [ ] Approval flow tested
- [ ] Audit logging verified
- [ ] Emergency shutdown command known

## References

1. [AI Agents: Evolution, Architecture, and Real-World Applications](https://arxiv.org/html/2503.12687v1)
2. [Agentic AI and Security - Martin Fowler](https://martinfowler.com/articles/agentic-ai-security.html)
3. [Here Come the AI Worms - WIRED](https://www.wired.com/story/here-come-the-ai-worms/)
4. [LLM Powered Autonomous Agents - Lilian Weng](https://lilianweng.github.io/posts/2023-06-23-agent/)
5. [Open Interpreter](https://github.com/openinterpreter/open-interpreter)

---

*"With great power comes great responsibility. And also great logging."*
— Jarvis, probably

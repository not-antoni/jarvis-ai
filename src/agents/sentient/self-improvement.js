'use strict';

const { AGENT_CONFIG } = require('./config');

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
        const coreFiles = AGENT_CONFIG.analysisTargets;

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
        if (this.improvementLog.length > AGENT_CONFIG.maxImprovementLog) {
            this.improvementLog = this.improvementLog.slice(-AGENT_CONFIG.maxImprovementLog);
        }

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

module.exports = { SelfImprovement };

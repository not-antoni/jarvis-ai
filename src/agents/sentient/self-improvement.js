'use strict';

// ============================================================================
// SELF-IMPROVEMENT SYSTEM
// ============================================================================

class SelfImprovement {
    constructor(agent) {
        this.agent = agent;
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

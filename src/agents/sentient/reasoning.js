'use strict';

const { AGENT_CONFIG } = require('./config');

// Import soul for personality-driven reasoning
let jarvisSoul = null;
try {
    const selfhostFeatures = require('../../services/selfhost-features');
    jarvisSoul = selfhostFeatures.jarvisSoul;
} catch (e) {
    console.warn('[SentientCore] Could not load soul:', e.message);
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
        if (this.thoughtHistory.length > AGENT_CONFIG.maxThoughtHistory) {
            this.thoughtHistory = this.thoughtHistory.slice(-AGENT_CONFIG.maxThoughtHistory);
        }
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
                content: `${context.recentActions.length} recent actions in memory`,
                details: context.recentActions.slice(-3).map(a => a.content || a.type).join('; ')
            });
        }

        // What are our current goals?
        if (context.activeGoals?.length > 0) {
            observations.push({
                type: 'active_goals',
                content: context.activeGoals.map(g => g.goal)
            });
        }

        // Relevant past learnings (keyword-matched to input)
        if (context.relevantLearnings?.length > 0) {
            observations.push({
                type: 'past_experience',
                content: context.relevantLearnings.map(l => l.content).slice(0, 3),
                count: context.relevantLearnings.length
            });
        }

        // System state
        const sysInfo = this.agent.tools.getSystemInfo();
        const memWarning = sysInfo.memory.usedPercent > 85 ? ' HIGH' : '';
        observations.push({
            type: 'system_state',
            content: `${sysInfo.platform} | ${sysInfo.memory.usedPercent}% RAM${memWarning}`
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
        const hasPastExperience = observations.some(o => o.type === 'past_experience');

        // Calculate confidence based on context richness and wisdom trait
        let confidence = 0.5 + (traits.wisdom / 200); // Base 0.5 + up to 0.5 from wisdom
        if (hasGoals) {confidence += 0.1;}
        if (hasRecentContext) {confidence += 0.1;}
        if (hasPastExperience) {confidence += 0.15;} // Boost confidence when we have relevant experience
        confidence = Math.min(1, confidence);

        // Determine situation type from intent with broader pattern matching
        const lower = userIntent.toLowerCase();
        let situation = 'analyzing';
        if (lower.includes('help') || lower.includes('how') || lower.includes('fix') || lower.includes('debug')) {
            situation = 'assisting';
        } else if (lower.includes('joke') || lower.includes('fun') || lower.includes('meme') || lower.includes('roast')) {
            situation = 'entertaining';
        } else if (lower.includes('think') || lower.includes('analyze') || lower.includes('meaning') || lower.includes('why')) {
            situation = 'philosophizing';
        } else if (lower.includes('execute') || lower.includes('run') || lower.includes('do ') || lower.includes('make')) {
            situation = 'executing';
        } else if (lower.includes('monitor') || lower.includes('health') || lower.includes('status') || lower.includes('check')) {
            situation = 'monitoring';
        } else if (lower === 'internal_heartbeat') {
            situation = 'idle';
        }

        // Build insight from past experience
        const experienceInsight = hasPastExperience
            ? observations.find(o => o.type === 'past_experience').content
            : [];

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
            experienceInsight,
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

        // Append experience insight to reasoning if available
        const expNote = orientation.experienceInsight?.length > 0
            ? ` (Drawing on ${orientation.experienceInsight.length} past experience(s).)`
            : '';

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
            case 'monitoring':
                actionType = 'monitor';
                reasoning = 'Running system diagnostics and health assessment.';
                break;
            case 'idle':
                actionType = 'idle_check';
                reasoning = 'Background heartbeat -- checking for goals to pursue.';
                break;
            default:
                reasoning = 'Analyzing input and determining optimal response strategy.';
        }

        reasoning += expNote;

        // Add chaos factor for unpredictability
        const shouldAddFlair = traits.chaos > 50 && Math.random() < (traits.chaos / 100);

        return {
            shouldAct: orientation.situation !== 'idle' || context.activeGoals?.length > 0,
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

// Re-export jarvisSoul for use by the main agent class
module.exports = { ReasoningEngine, getJarvisSoul: () => jarvisSoul };

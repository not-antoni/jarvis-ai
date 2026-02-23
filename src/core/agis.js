'use strict';

/**
 * A.G.I.S. — Artificial General Intelligent System
 *
 * Higher-level orchestration layer that sits above the sentient agent core.
 * Provides goal decomposition, multi-step planning, and context-aware decision making.
 *
 * SAFETY: Inherits all safety constraints from sentient-core.
 * Only available in selfhost mode.
 */

const EventEmitter = require('events');

const IS_SELFHOST = (process.env.DEPLOY_TARGET || '').toLowerCase() === 'selfhost'
    || process.env.LOCAL_DB_MODE === 'true'
    || process.env.SELFHOST_MODE === 'true';

class AGIS extends EventEmitter {
    constructor(options = {}) {
        super();
        this.enabled = IS_SELFHOST;
        this.goals = [];
        this.plans = new Map(); // goalId -> plan steps
        this.context = {
            serverCount: 0,
            userCount: 0,
            uptime: 0,
            capabilities: [],
            recentActions: []
        };
        this.maxGoals = options.maxGoals || 5;
        this.aiManager = options.aiManager || null;
        this.database = options.database || null;
    }

    /**
     * Decompose a high-level goal into actionable steps
     */
    async decompose(goal) {
        if (!this.enabled) {return { error: 'A.G.I.S. is only available in selfhost mode.' };}

        const plan = {
            id: `plan_${Date.now().toString(36)}`,
            goal,
            steps: [],
            status: 'planning',
            createdAt: new Date()
        };

        // Use AI to decompose the goal into steps
        if (this.aiManager) {
            try {
                const prompt = `You are J.A.R.V.I.S.'s planning subsystem (A.G.I.S.). Given this goal, decompose it into 3-7 concrete, actionable steps. Each step should be a single specific action. Return ONLY a JSON array of strings (the steps). No commentary.

Goal: ${goal}

Context: Running as a Discord bot with access to: AI chat, web search, code execution, economy system, moderation tools, server management.`;

                const result = await this.aiManager.generateResponse(
                    'You are a task decomposition system. Respond ONLY with valid JSON arrays.',
                    prompt,
                    1024
                );

                const content = result?.content || result;
                if (typeof content === 'string') {
                    // Extract JSON array from response
                    const match = content.match(/\[[\s\S]*\]/);
                    if (match) {
                        const steps = JSON.parse(match[0]);
                        plan.steps = steps.map((step, i) => ({
                            id: `step_${i}`,
                            description: String(step),
                            status: 'pending',
                            result: null
                        }));
                    }
                }
            } catch (err) {
                console.warn('[AGIS] AI decomposition failed:', err.message);
            }
        }

        // Fallback if AI decomposition failed
        if (plan.steps.length === 0) {
            plan.steps = [{
                id: 'step_0',
                description: `Execute: ${goal}`,
                status: 'pending',
                result: null
            }];
        }

        plan.status = 'ready';
        this.plans.set(plan.id, plan);

        if (this.goals.length >= this.maxGoals) {
            this.goals.shift(); // Remove oldest goal
        }
        this.goals.push({ goal, planId: plan.id, createdAt: new Date() });

        return plan;
    }

    /**
     * Evaluate context and decide what to do next (proactive thinking)
     */
    async evaluate() {
        if (!this.enabled) {return null;}

        this.context.uptime = process.uptime();

        const activePlans = Array.from(this.plans.values())
            .filter(p => p.status === 'ready' || p.status === 'in_progress');

        if (activePlans.length === 0) {return null;}

        const plan = activePlans[0];
        const nextStep = plan.steps.find(s => s.status === 'pending');

        if (!nextStep) {
            plan.status = 'completed';
            return { type: 'plan_complete', plan };
        }

        return {
            type: 'next_step',
            planId: plan.id,
            plan,
            step: nextStep
        };
    }

    /**
     * Complete a step in a plan
     */
    completeStep(planId, stepId, result) {
        const plan = this.plans.get(planId);
        if (!plan) {return false;}

        const step = plan.steps.find(s => s.id === stepId);
        if (!step) {return false;}

        step.status = 'completed';
        step.result = result;
        step.completedAt = new Date();

        // Check if all steps are done
        const allDone = plan.steps.every(s => s.status === 'completed' || s.status === 'skipped');
        if (allDone) {
            plan.status = 'completed';
            plan.completedAt = new Date();
        } else {
            plan.status = 'in_progress';
        }

        this.context.recentActions.push({
            planId,
            stepId,
            result: String(result).slice(0, 200),
            timestamp: Date.now()
        });

        // Keep recent actions bounded
        if (this.context.recentActions.length > 20) {
            this.context.recentActions = this.context.recentActions.slice(-20);
        }

        return true;
    }

    /**
     * Get current system status
     */
    getStatus() {
        return {
            enabled: this.enabled,
            activeGoals: this.goals.length,
            activePlans: Array.from(this.plans.values()).filter(p => p.status !== 'completed').length,
            completedPlans: Array.from(this.plans.values()).filter(p => p.status === 'completed').length,
            uptime: Math.floor(process.uptime()),
            context: {
                recentActions: this.context.recentActions.length,
                capabilities: this.context.capabilities
            }
        };
    }

    /**
     * Get detailed plan information
     */
    getPlan(planId) {
        return this.plans.get(planId) || null;
    }

    /**
     * Register a capability that AGIS can use
     */
    registerCapability(name, description) {
        this.context.capabilities.push({ name, description });
    }
}

// Singleton
let instance = null;

function getAGIS(options = {}) {
    if (!instance) {
        instance = new AGIS(options);

        // Register default capabilities
        instance.registerCapability('chat', 'Respond to users via AI');
        instance.registerCapability('search', 'Search the web via Brave Search');
        instance.registerCapability('code', 'Execute sandboxed JavaScript code');
        instance.registerCapability('math', 'Solve mathematical expressions');
        instance.registerCapability('economy', 'Manage Stark Bucks virtual economy');
        instance.registerCapability('moderate', 'Server moderation (ban, kick, mute, warn)');
        instance.registerCapability('music', 'Play music in voice channels');
        instance.registerCapability('monitor', 'Monitor websites and services');
    }
    return instance;
}

module.exports = { AGIS, getAGIS };

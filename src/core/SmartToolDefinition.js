/**
 * Smart Tool Calling System - Inspired by Codex
 * Implements intelligent tool selection and dispatching based on context
 */

/**
 * Tool Definition with smart metadata
 */
class ToolDefinition {
    constructor(name, description, parameters, handler, options = {}) {
        this.name = name;
        this.description = description;
        this.parameters = parameters; // JSON Schema
        this.handler = handler;
        this.options = {
            timeout: 30000,
            parallel: false,
            requiresApproval: false,
            category: 'utility',
            ...options
        };
        this.callCount = 0;
        this.successCount = 0;
        this.failureCount = 0;
        this.totalDuration = 0;
    }

    /**
     * Get tool relevance score for a given context
     */
    getRelevanceScore(context) {
        let score = 0;

        // Exact name match
        if (context.query && context.query.toLowerCase().includes(this.name.toLowerCase())) {
            score += 10;
        }

        // Description keyword match
        if (context.keywords) {
            const descriptionLower = this.description.toLowerCase();
            context.keywords.forEach(keyword => {
                if (descriptionLower.includes(keyword.toLowerCase())) {
                    score += 2;
                }
            });
        }

        // Category matching
        if (context.category === this.options.category) {
            score += 5;
        }

        // Recent success bonus
        if (this.successCount > 0) {
            score += Math.min(this.successCount, 5) * 0.5;
        }

        // Failure penalty
        if (this.failureCount > 0) {
            score -= Math.min(this.failureCount, 3) * 0.5;
        }

        // Fallback: If no keyword matches but tool has general search/utility category
        // and context has common information-seeking keywords, give it a baseline score
        if (score === 0 && context.keywords) {
            const infoKeywords = [
                'find',
                'search',
                'information',
                'get',
                'retrieve',
                'look',
                'query'
            ];
            const hasInfoKeyword = context.keywords.some(kw =>
                infoKeywords.includes(kw.toLowerCase())
            );

            if (
                hasInfoKeyword &&
                (this.options.category === 'search' || this.options.category === 'utility')
            ) {
                score = 1; // Minimum relevance for search tools with info-seeking queries
            }
        }

        return score;
    }

    /**
     * Validate arguments against schema
     */
    validateArguments(args) {
        const errors = [];

        if (this.parameters.required) {
            for (const required of this.parameters.required) {
                if (!(required in args)) {
                    errors.push(`Missing required parameter: ${required}`);
                }
            }
        }

        // Basic type checking
        for (const [key, schema] of Object.entries(this.parameters.properties || {})) {
            if (key in args) {
                const type = typeof args[key];
                if (schema.type && type !== schema.type) {
                    errors.push(`Parameter ${key} should be ${schema.type}, got ${type}`);
                }
            }
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    /**
     * Record execution metrics
     */
    recordExecution(duration, success) {
        this.callCount++;
        this.totalDuration += duration;
        if (success) {
            this.successCount++;
        } else {
            this.failureCount++;
        }
    }

    /**
     * Get execution statistics
     */
    getStats() {
        return {
            name: this.name,
            callCount: this.callCount,
            successCount: this.successCount,
            failureCount: this.failureCount,
            avgDuration: this.callCount > 0 ? this.totalDuration / this.callCount : 0,
            successRate:
                this.callCount > 0
                    ? ((this.successCount / this.callCount) * 100).toFixed(2) + '%'
                    : 'N/A'
        };
    }
}

module.exports = ToolDefinition;

/**
 * High school level mathematics helper powered by Nerdamer.
 * Supports evaluation, simplification, factoring, expansion,
 * derivatives, integrals, and equation solving for 0-12 curriculum.
 */

const nerdamer = require('nerdamer/all');

const RESERVED_KEYWORDS = new Set([
    'sin', 'cos', 'tan', 'cot', 'sec', 'csc',
    'asin', 'acos', 'atan', 'acot', 'asec', 'acsc',
    'sinh', 'cosh', 'tanh', 'coth', 'sech', 'csch',
    'log', 'ln', 'sqrt', 'abs', 'sign', 'sgn', 'exp',
    'floor', 'ceil', 'round', 'min', 'max', 'mod',
    'gcd', 'lcm', 'diff', 'integrate', 'factor',
    'expand', 'simplify', 'sum', 'product', 'pow',
    'and', 'or', 'xor', 'not', 'pi', 'e'
]);

class MathSolver {
    solve(rawInput) {
        const parsed = this.parseInput(rawInput);

        switch (parsed.operation) {
            case 'solve':
                return this.handleSolve(parsed);
            case 'simplify':
                return this.handleSimplify(parsed);
            case 'factor':
                return this.handleFactor(parsed);
            case 'expand':
                return this.handleExpand(parsed);
            case 'derivative':
                return this.handleDerivative(parsed);
            case 'integrate':
                return this.handleIntegral(parsed);
            case 'evaluate':
            default:
                return this.handleEvaluate(parsed);
        }
    }

    parseInput(rawInput = '') {
        const trimmed = rawInput.trim();

        if (!trimmed.length) {
            throw new Error('No expression provided');
        }

        if (/^solve\b/i.test(trimmed)) {
            const remainder = trimmed.replace(/^solve\b/i, '').trim();
            const { expression, variable } = this.extractVariableClause(remainder);
            return { operation: 'solve', expression, variable };
        }

        if (/^simplify\b/i.test(trimmed)) {
            const expression = trimmed.replace(/^simplify\b/i, '').trim();
            return { operation: 'simplify', expression };
        }

        if (/^factor\b/i.test(trimmed)) {
            const expression = trimmed.replace(/^factor\b/i, '').trim();
            return { operation: 'factor', expression };
        }

        if (/^expand\b/i.test(trimmed)) {
            const expression = trimmed.replace(/^expand\b/i, '').trim();
            return { operation: 'expand', expression };
        }

        if (/^(differentiate|derivative|derive)\b/i.test(trimmed)) {
            const remainder = trimmed.replace(/^(differentiate|derivative|derive)\b/i, '').trim();
            const { expression, variable } = this.extractVariableClause(remainder);
            return { operation: 'derivative', expression, variable };
        }

        if (/^(integrate|integral|antiderivative)\b/i.test(trimmed)) {
            const remainder = trimmed.replace(/^(integrate|integral|antiderivative)\b/i, '').trim();
            const { expression, variable } = this.extractVariableClause(remainder);
            return { operation: 'integrate', expression, variable };
        }

        if (/^evaluate\b/i.test(trimmed)) {
            const expression = trimmed.replace(/^evaluate\b/i, '').trim();
            return { operation: 'evaluate', expression };
        }

        return { operation: 'evaluate', expression: trimmed };
    }

    extractVariableClause(input) {
        let expression = input.trim();
        let variable = null;

        const leadingFor = expression.match(/^for\s+([a-zA-Z][a-zA-Z0-9]*)\s*[:=,-]?\s*(.+)$/i);
        if (leadingFor) {
            variable = leadingFor[1];
            expression = leadingFor[2].trim();
        }

        const derivativeNotation = expression.match(/^d\/d([a-zA-Z][a-zA-Z0-9]*)\s*(.+)$/i);
        if (derivativeNotation) {
            variable = derivativeNotation[1];
            expression = derivativeNotation[2].trim();
        }

        const wrtMatch = expression.match(/(.+?)(?:with respect to|wrt)\s+([a-zA-Z][a-zA-Z0-9]*)$/i);
        if (wrtMatch) {
            expression = wrtMatch[1].trim();
            variable = variable || wrtMatch[2];
        }

        const trailingFor = expression.match(/(.+?)\s+for\s+([a-zA-Z][a-zA-Z0-9]*)$/i);
        if (trailingFor) {
            expression = trailingFor[1].trim();
            variable = variable || trailingFor[2];
        }

        expression = expression.replace(/^[:=,-]+/, '').trim();

        return { expression, variable };
    }

    detectVariables(expression) {
        const tokens = expression.match(/[a-zA-Z]+/g) || [];
        const candidates = tokens
            .map(token => token.trim())
            .filter(token => token.length > 0)
            .filter(token => !RESERVED_KEYWORDS.has(token.toLowerCase()));

        return Array.from(new Set(candidates));
    }

    handleEvaluate({ expression }) {
        if (!expression?.length) {
            return 'Please provide a valid expression after the math wake phrase, sir.';
        }

        try {
            const exact = nerdamer(expression).text();
            let approx = null;

            try {
                approx = nerdamer(expression).evaluate().text();
                if (approx === exact) {
                    approx = null;
                }
            } catch {
                approx = null;
            }

            const details = [`Exact: ${exact}`];
            if (approx) {
                details.push(`Approximation: ${approx}`);
            }

            return this.buildResponse('Evaluate', expression, details);
        } catch (error) {
            return this.reportFailure(error, expression);
        }
    }

    handleSimplify({ expression }) {
        if (!expression?.length) {
            return 'Please provide something to simplify after the command, sir.';
        }

        try {
            const simplified = nerdamer(expression).text();
            return this.buildResponse('Simplify', expression, [`Result: ${simplified}`]);
        } catch (error) {
            return this.reportFailure(error, expression);
        }
    }

    handleFactor({ expression }) {
        if (!expression?.length) {
            return 'Please provide an expression to factor, sir.';
        }

        try {
            const factored = nerdamer(`factor(${expression})`).text();
            return this.buildResponse('Factor', expression, [`Result: ${factored}`]);
        } catch (error) {
            return this.reportFailure(error, expression);
        }
    }

    handleExpand({ expression }) {
        if (!expression?.length) {
            return 'Please provide an expression to expand, sir.';
        }

        try {
            const expanded = nerdamer(`expand(${expression})`).text();
            return this.buildResponse('Expand', expression, [`Result: ${expanded}`]);
        } catch (error) {
            return this.reportFailure(error, expression);
        }
    }

    handleDerivative({ expression, variable }) {
        if (!expression?.length) {
            return 'Please provide an expression to differentiate, sir.';
        }

        const variables = variable ? [variable] : this.detectVariables(expression);

        if (!variable && variables.length === 0) {
            return 'I need a variable for differentiation, sir. Try specifying one.';
        }

        if (!variable && variables.length > 1) {
            return `Multiple variables detected (${variables.join(', ')}). Please specify one, sir.`;
        }

        const target = variable || variables[0];

        try {
            const derivative = nerdamer(`diff(${expression}, ${target})`).text();
            return this.buildResponse('Derivative', expression, [`d/d${target}: ${derivative}`]);
        } catch (error) {
            return this.reportFailure(error, expression);
        }
    }

    handleIntegral({ expression, variable }) {
        if (!expression?.length) {
            return 'Please provide an expression to integrate, sir.';
        }

        const variables = variable ? [variable] : this.detectVariables(expression);

        if (!variable && variables.length === 0) {
            return 'I need a variable for integration, sir. Try specifying one.';
        }

        if (!variable && variables.length > 1) {
            return `Multiple variables detected (${variables.join(', ')}). Please specify one, sir.`;
        }

        const target = variable || variables[0];

        try {
            const integral = nerdamer(`integrate(${expression}, ${target})`).text();
            return this.buildResponse('Integrate', expression, [`Result: ${integral} + C`]);
        } catch (error) {
            return this.reportFailure(error, expression);
        }
    }

    handleSolve({ expression, variable }) {
        if (!expression?.length) {
            return 'Please provide an equation to solve, sir.';
        }

        const segments = expression
            .split(/[\n;]+/)
            .map(segment => segment.trim())
            .filter(Boolean);

        const equations = (segments.length ? segments : [expression])
            .map(eq => (eq.includes('=') ? eq : `${eq}=0`));

        let variables = this.detectVariables(equations.join(' '));

        if (variable) {
            variables = Array.from(new Set([variable, ...variables]));
        }

        if (!variables.length) {
            return 'I could not detect any variables to solve for, sir.';
        }

        try {
            if (variables.length === 1 && equations.length === 1) {
                const [left, right] = equations[0].split('=');
                const diff = `${left} - (${right})`;
                const rawSolutions = nerdamer.solve(diff, variables[0]);
                const solutionStrings = this.unpackSolutionList(rawSolutions);

                if (!solutionStrings.length) {
                    return `No solution found for ${variables[0]}, sir.`;
                }

                const formatted = this.formatSingleVariableSolutions(solutionStrings, variables[0]);
                return this.buildResponse(`Solve for ${variables[0]}`, expression, formatted);
            }

            const systemSolutions = nerdamer.solveEquations(equations, variables);
            const parsedSolutions = this.unpackSystemSolutions(systemSolutions);

            if (!parsedSolutions.length) {
                return 'No solution found for the provided system, sir.';
            }

            const details = parsedSolutions.map(({ variable: v, value }) => `${v} = ${value}`);
            return this.buildResponse('Solve System', expression, details);
        } catch (error) {
            return this.reportFailure(error, expression);
        }
    }

    unpackSolutionList(raw) {
        if (!raw) {
            return [];
        }

        const text = raw.toString().trim();

        if (!text.length || text === '[]') {
            return [];
        }

        const trimmed = text.replace(/^\[/, '').replace(/\]$/, '');

        if (!trimmed.length) {
            return [];
        }

        return trimmed.split(',').map(part => part.trim()).filter(Boolean);
    }

    formatSingleVariableSolutions(solutions, variable) {
        return solutions.map((solution, index) => {
            let approx = null;
            try {
                approx = nerdamer(solution).evaluate().text();
            } catch {
                approx = null;
            }

            const label = solutions.length > 1 ? `${index + 1}) ${variable} = ${solution}` : `${variable} = ${solution}`;
            if (approx && approx !== solution) {
                return `${label} (≈ ${approx})`;
            }
            return label;
        });
    }

    unpackSystemSolutions(raw) {
        if (!raw) {
            return [];
        }

        const text = raw.toString().trim();

        if (!text.length || text === '[]') {
            return [];
        }

        const trimmed = text.replace(/^\[\s*/, '').replace(/\s*\]$/, '');
        if (!trimmed.length) {
            return [];
        }

        return trimmed
            .split('],')
            .map(chunk => chunk.replace(/[\[\]]/g, '').trim())
            .map(pairText => {
                const parts = pairText.split(',');
                if (parts.length !== 2) {
                    return null;
                }

                const variable = parts[0].trim();
                const value = parts[1].trim();
                return { variable, value };
            })
            .filter(Boolean);
    }

    buildResponse(operation, expression, details = [], closing = 'Ready for the next challenge, sir.') {
        const lines = ['**Mathematics Console**'];
        lines.push(`- Operation: ${operation}`);
        if (expression?.length) {
            lines.push(`- Input: ${expression}`);
        }
        details.forEach(detail => lines.push(`- ${detail}`));
        lines.push(closing);
        return lines.join('\n');
    }

    reportFailure(error, expression) {
        const reason = error?.message ? error.message.replace(/^Error:\s*/i, '') : 'Unexpected error';
        const details = [`Issue: ${reason}`];
        return this.buildResponse('Error', expression, details, 'Please adjust the problem and try again, sir.');
    }
}

module.exports = new MathSolver();

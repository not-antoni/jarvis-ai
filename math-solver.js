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
            const normalized = this.normalizeExpression(expression);
            return { operation: 'solve', expression: normalized, rawExpression: expression.trim(), variable };
        }

        if (/^simplify\b/i.test(trimmed)) {
            const rawExpression = trimmed.replace(/^simplify\b/i, '').trim();
            const expression = this.normalizeExpression(rawExpression);
            return { operation: 'simplify', expression, rawExpression };
        }

        if (/^factor\b/i.test(trimmed)) {
            const rawExpression = trimmed.replace(/^factor\b/i, '').trim();
            const expression = this.normalizeExpression(rawExpression);
            return { operation: 'factor', expression, rawExpression };
        }

        if (/^expand\b/i.test(trimmed)) {
            const rawExpression = trimmed.replace(/^expand\b/i, '').trim();
            const expression = this.normalizeExpression(rawExpression);
            return { operation: 'expand', expression, rawExpression };
        }

        if (/^(differentiate|derivative|derive)\b/i.test(trimmed)) {
            const remainder = trimmed.replace(/^(differentiate|derivative|derive)\b/i, '').trim();
            const { expression, variable } = this.extractVariableClause(remainder);
            const normalized = this.normalizeExpression(expression);
            return { operation: 'derivative', expression: normalized, rawExpression: expression.trim(), variable };
        }

        if (/^(integrate|integral|antiderivative)\b/i.test(trimmed)) {
            const remainder = trimmed.replace(/^(integrate|integral|antiderivative)\b/i, '').trim();
            const { expression, variable } = this.extractVariableClause(remainder);
            const normalized = this.normalizeExpression(expression);
            return { operation: 'integrate', expression: normalized, rawExpression: expression.trim(), variable };
        }

        if (/^evaluate\b/i.test(trimmed)) {
            const rawExpression = trimmed.replace(/^evaluate\b/i, '').trim();
            const expression = this.normalizeExpression(rawExpression);
            return { operation: 'evaluate', expression, rawExpression };
        }

        return {
            operation: 'evaluate',
            expression: this.normalizeExpression(trimmed),
            rawExpression: trimmed
        };
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

    normalizeExpression(expression = '') {
        if (!expression) {
            return expression;
        }

        let normalized = expression;

        normalized = normalized.replace(/√\s*\(/g, 'sqrt(');
        normalized = normalized.replace(/√\s*([a-zA-Z0-9._]+)/g, 'sqrt($1)');
        normalized = normalized.replace(/\bsquare\s+root\s+of\s*\(([^)]+)\)/gi, 'sqrt($1)');
        normalized = normalized.replace(/\bsquare\s+root\s+of\s+([a-zA-Z0-9._]+)/gi, 'sqrt($1)');
        normalized = normalized.replace(/\bsqrt\s+of\s*\(([^)]+)\)/gi, 'sqrt($1)');
        normalized = normalized.replace(/\bsqrt\s+of\s+([a-zA-Z0-9._]+)/gi, 'sqrt($1)');

        return normalized;
    }

    handleEvaluate({ expression, rawExpression }) {
        if (!expression?.length) {
            return 'Please provide a valid expression after the math wake phrase, sir.';
        }

        try {
            const exact = nerdamer(expression).text();
            const approx = this.safeApproximate(expression, exact);
            const display = this.getDisplayExpression(rawExpression, expression);
            const lines = [display, `= ${exact}`];
            if (approx) {
                lines.push(`≈ ${approx}`);
            }

            return this.finalizeResponse(lines);
        } catch (error) {
            return this.reportFailure(error, expression, rawExpression);
        }
    }

    handleSimplify({ expression, rawExpression }) {
        if (!expression?.length) {
            return 'Please provide something to simplify after the command, sir.';
        }

        try {
            const simplified = nerdamer(expression).text();
            const display = this.getDisplayExpression(rawExpression, expression);
            const lines = [display, `= ${simplified}`];
            return this.finalizeResponse(lines);
        } catch (error) {
            return this.reportFailure(error, expression, rawExpression);
        }
    }

    handleFactor({ expression, rawExpression }) {
        if (!expression?.length) {
            return 'Please provide an expression to factor, sir.';
        }

        try {
            const factored = nerdamer(`factor(${expression})`).text();
            const display = this.getDisplayExpression(rawExpression, expression);
            const lines = [display, `= ${factored}`];
            return this.finalizeResponse(lines);
        } catch (error) {
            return this.reportFailure(error, expression, rawExpression);
        }
    }

    handleExpand({ expression, rawExpression }) {
        if (!expression?.length) {
            return 'Please provide an expression to expand, sir.';
        }

        try {
            const expanded = nerdamer(`expand(${expression})`).text();
            const display = this.getDisplayExpression(rawExpression, expression);
            const lines = [display, `= ${expanded}`];
            return this.finalizeResponse(lines);
        } catch (error) {
            return this.reportFailure(error, expression, rawExpression);
        }
    }

    handleDerivative({ expression, rawExpression, variable }) {
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
            const display = this.getDisplayExpression(rawExpression, expression);
            const lines = [`d/d${target} (${display})`, `= ${derivative}`];
            return this.finalizeResponse(lines);
        } catch (error) {
            return this.reportFailure(error, expression, rawExpression);
        }
    }

    handleIntegral({ expression, rawExpression, variable }) {
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
            const display = this.getDisplayExpression(rawExpression, expression);
            const lines = [`Integral d${target} (${display})`, `= ${integral} + C`];
            return this.finalizeResponse(lines);
        } catch (error) {
            return this.reportFailure(error, expression, rawExpression);
        }
    }

    handleSolve({ expression, rawExpression, variable }) {
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
            const display = this.getDisplayExpression(rawExpression, expression);
            const lines = [display || 'Equation', 'Unable to detect a variable to solve for'];
            return this.finalizeResponse(lines);
        }

        try {
            if (variables.length === 1 && equations.length === 1) {
                const [left, right] = equations[0].split('=');
                const diff = `${left} - (${right})`;
                const rawSolutions = nerdamer.solve(diff, variables[0]);
                const solutionStrings = this.unpackSolutionList(rawSolutions);

                if (!solutionStrings.length) {
                    const display = this.prepareEquationDisplay(rawExpression, equations);
                    const lines = [...display, `No solution found for ${variables[0]}`];
                    return this.finalizeResponse(lines);
                }

                const formatted = this.formatSingleVariableSolutions(solutionStrings, variables[0]);
                const display = this.prepareEquationDisplay(rawExpression, equations);
                const lines = [...display, ...formatted];
                return this.finalizeResponse(lines);
            }

            const systemSolutions = nerdamer.solveEquations(equations, variables);
            const parsedSolutions = this.unpackSystemSolutions(systemSolutions);

            if (!parsedSolutions.length) {
                const display = this.prepareEquationDisplay(rawExpression, equations);
                const lines = [...display, 'No solution found for the provided system'];
                return this.finalizeResponse(lines);
            }

            const display = this.prepareEquationDisplay(rawExpression, equations);
            const details = parsedSolutions.map(({ variable: v, value }) => {
                const approx = this.safeApproximate(value, value);
                return approx && approx !== value
                    ? `${v} = ${value} (≈ ${approx})`
                    : `${v} = ${value}`;
            });
            const lines = [...display, ...details];
            return this.finalizeResponse(lines);
        } catch (error) {
            return this.reportFailure(error, expression, rawExpression);
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
        return solutions.map((solution) => {
            const approx = this.safeApproximate(solution, solution);
            const base = `${variable} = ${solution}`;
            return approx && approx !== solution
                ? `${base} (≈ ${approx})`
                : base;
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

    safeApproximate(expression, fallback = null) {
        try {
            const approx = nerdamer(expression).evaluate().text();
            if (approx && approx !== fallback) {
                return approx;
            }
        } catch {
            return null;
        }
        return null;
    }

    getDisplayExpression(rawExpression, normalized) {
        if (typeof rawExpression === 'string' && rawExpression.trim().length) {
            return rawExpression.trim();
        }
        return normalized || '';
    }

    prepareEquationDisplay(rawExpression, normalizedEquations) {
        const displaySource = typeof rawExpression === 'string' && rawExpression.trim().length
            ? rawExpression
            : normalizedEquations.join('\n');

        return displaySource
            .split(/[\n;]+/)
            .map(segment => segment.trim())
            .filter(Boolean)
            .map(segment => (segment.includes('=') ? segment : `${segment} = 0`));
    }

    finalizeResponse(lines) {
        const cleaned = Array.isArray(lines)
            ? lines.map(line => (line || '').trim()).filter(line => line.length)
            : [];

        if (!cleaned.length) {
            return 'Computation complete, sir.';
        }

        const lastIndex = cleaned.length - 1;
        const lastLine = cleaned[lastIndex];
        if (!/sir\./i.test(lastLine)) {
            let base = lastLine;
            if (base.endsWith('.')) {
                base = base.slice(0, -1);
            }
            cleaned[lastIndex] = `${base}, sir.`;
        }

        return cleaned.join('\n');
    }

    reportFailure(error, expression, rawExpression) {
        const reason = error?.message ? error.message.replace(/^Error:\s*/i, '') : 'Unexpected error';
        const display = this.getDisplayExpression(rawExpression, expression) || 'Problem';
        const lines = [display, `Error: ${reason}`, 'Please adjust the problem and try again'];
        return this.finalizeResponse(lines);
    }
}

module.exports = new MathSolver();

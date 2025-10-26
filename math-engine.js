const nerdamer = require('nerdamer/all');

const RESERVED_KEYWORDS = new Set([
    'sin', 'cos', 'tan', 'cot', 'sec', 'csc',
    'asin', 'acos', 'atan', 'acot', 'asec', 'acsc',
    'arcsin', 'arccos', 'arctan', 'arccot', 'arcsec', 'arccsc',
    'sinh', 'cosh', 'tanh', 'coth', 'sech', 'csch',
    'log', 'ln', 'sqrt', 'abs', 'sign', 'sgn', 'exp',
    'floor', 'ceil', 'round', 'min', 'max', 'mod',
    'gcd', 'lcm', 'diff', 'integrate', 'factor',
    'expand', 'simplify', 'sum', 'product', 'pow',
    'and', 'or', 'xor', 'not', 'pi', 'e'
]);

const MAX_INPUT_LENGTH = 240;
const MAX_NESTED_FUNCTIONS = 12;
const MAX_FACTORIALS = 3;
const MAX_EXPONENTS = 6;

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

    enforceLimits(rawInput = '') {
        const trimmed = String(rawInput ?? '').trim();
        if (!trimmed.length) {
            throw new Error('No expression provided');
        }

        if (trimmed.length > MAX_INPUT_LENGTH) {
            throw new Error('Expression too long, sir. Try something more concise.');
        }

        const functionCalls = trimmed.match(/[a-zA-Z_]+\s*\(/g) || [];
        if (functionCalls.length > MAX_NESTED_FUNCTIONS) {
            throw new Error('That computation stacks too many nested functions, sir.');
        }

        const factorials = (trimmed.match(/!/g) || []).length;
        if (factorials > MAX_FACTORIALS) {
            throw new Error('Let us keep factorial indulgence modest, sir.');
        }

        const exponents = (trimmed.match(/\^/g) || []).length;
        if (exponents > MAX_EXPONENTS) {
            throw new Error('Too many exponentiations for a live calculation, sir.');
        }

        const hugeNumbers = trimmed.match(/\d{7,}/g) || [];
        if (hugeNumbers.length) {
            throw new Error('Numbers that large overload my mental abacus, sir.');
        }

        return trimmed;
    }

    parseInput(rawInput = '') {
        const trimmed = this.enforceLimits(rawInput);

        if (/^solve\b/i.test(trimmed)) {
            let remainder = trimmed.replace(/^solve\b/i, '').trim();
            if (/^system\b/i.test(remainder)) {
                remainder = remainder.replace(/^system\b/i, '').trim();
            }
            const { expression, variable } = this.extractVariableClause(remainder);
            const parsed = this.prepareParsedExpression(expression, variable);
            return { operation: 'solve', ...parsed };
        }

        if (/^simplify\b/i.test(trimmed)) {
            const rawExpression = trimmed.replace(/^simplify\b/i, '').trim();
            const parsed = this.prepareParsedExpression(rawExpression);
            return { operation: 'simplify', ...parsed };
        }

        if (/^factor\b/i.test(trimmed)) {
            const rawExpression = trimmed.replace(/^factor\b/i, '').trim();
            const parsed = this.prepareParsedExpression(rawExpression);
            return { operation: 'factor', ...parsed };
        }

        if (/^expand\b/i.test(trimmed)) {
            const rawExpression = trimmed.replace(/^expand\b/i, '').trim();
            const parsed = this.prepareParsedExpression(rawExpression);
            return { operation: 'expand', ...parsed };
        }

        if (/^(differentiate|derivative|derive)\b/i.test(trimmed)) {
            const remainder = trimmed.replace(/^(differentiate|derivative|derive)\b/i, '').trim();
            const { expression, variable } = this.extractVariableClause(remainder);
            const parsed = this.prepareParsedExpression(expression, variable);
            return { operation: 'derivative', ...parsed };
        }

        if (/^(integrate|integral|antiderivative)\b/i.test(trimmed)) {
            const remainder = trimmed.replace(/^(integrate|integral|antiderivative)\b/i, '').trim();
            const { expression, variable } = this.extractVariableClause(remainder);
            const parsed = this.prepareParsedExpression(expression, variable);
            return { operation: 'integrate', ...parsed };
        }

        if (/^evaluate\b/i.test(trimmed)) {
            const rawExpression = trimmed.replace(/^evaluate\b/i, '').trim();
            const parsed = this.prepareParsedExpression(rawExpression);
            return { operation: 'evaluate', ...parsed };
        }

        const parsed = this.prepareParsedExpression(trimmed);
        return { operation: 'evaluate', ...parsed };
    }

    prepareParsedExpression(rawInputExpression, variable = null) {
        const placeholders = [];
        const cleanRaw = typeof rawInputExpression === 'string' ? rawInputExpression.trim() : '';

        const { expression: baseExpression, assignments } = this.extractAssignments(cleanRaw);

        const normalizedExpression = this.normalizeExpression(baseExpression);
        const expression = this.injectPlaceholders(normalizedExpression, placeholders);

        let processedVariable = null;
        if (typeof variable === 'string' && variable.trim().length) {
            const normalizedVariable = this.normalizeExpression(variable.trim());
            processedVariable = this.injectPlaceholders(normalizedVariable, placeholders);
        }

        return {
            expression,
            rawExpression: baseExpression,
            variable: processedVariable,
            placeholders,
            assignments: assignments.map(item => ({
                variable: item.variable,
                value: this.normalizeExpression(item.value),
                rawValue: item.rawValue
            }))
        };
    }

    extractAssignments(input) {
        if (!input || !input.length) {
            return { expression: input, assignments: [] };
        }

        const assignmentPattern = /\b(?:at|where)\b\s+(.+)$/i;
        const match = input.match(assignmentPattern);

        if (!match) {
            return { expression: input, assignments: [] };
        }

        const expression = input.slice(0, match.index).trim();
        const assignmentSection = match[1].trim();

        if (!assignmentSection.length) {
            return { expression, assignments: [] };
        }

        const segments = assignmentSection.split(/[,;]+/);
        const assignments = [];

        for (const segment of segments) {
            const trimmed = segment.trim();
            if (!trimmed.length) {
                continue;
            }

            const pairMatch = trimmed.match(/^([a-zA-Z][a-zA-Z0-9_]*)\s*=\s*(.+)$/);
            if (!pairMatch) {
                continue;
            }

            const variable = pairMatch[1];
            const value = pairMatch[2].trim();
            if (!value.length) {
                continue;
            }

            assignments.push({ variable, value, rawValue: value });
        }

        return { expression, assignments };
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

        return { expression, variable };
    }

    normalizeExpression(expression = '') {
        let normalized = String(expression ?? '')
            .replace(/\s+/g, ' ')
            .replace(/×/g, '*')
            .replace(/÷/g, '/')
            .replace(/–|—/g, '-')
            .trim();

        normalized = normalized.replace(/\bpi\b/gi, 'pi');
        normalized = normalized.replace(/\be\b/gi, 'e');

        if (/[^0-9a-zA-Z\s+\-*/^%().,=<>!]/.test(normalized)) {
            const invalid = normalized.match(/[^0-9a-zA-Z\s+\-*/^%().,=<>!]/g)?.[0];
            throw new Error(`Unsupported character "${invalid}" detected.`);
        }

        return normalized;
    }

    injectPlaceholders(expression, placeholders) {
        if (!expression) {
            return expression;
        }

        return expression.replace(/"([^"]+)"|'([^']+)'/g, (_, doubleQuoted, singleQuoted) => {
            const value = doubleQuoted ?? singleQuoted ?? '';
            const token = `__STR${placeholders.length}__`;
            placeholders.push({ token, value });
            return token;
        });
    }

    restorePlaceholders(text, placeholders) {
        if (!text || !placeholders?.length) {
            return text;
        }

        let restored = text;
        for (const { token, value } of placeholders) {
            const encodedValue = JSON.stringify(value).slice(1, -1);
            restored = restored
                .replace(new RegExp(token, 'g'), encodedValue)
                .replace(new RegExp(encodedValue, 'g'), value);
        }

        return restored;
    }

    applyAssignments(expression, assignments) {
        if (!assignments.length) {
            return { expression, scope: null };
        }

        const scope = {};
        let preparedExpression = expression;

        for (const assignment of assignments) {
            if (!assignment.variable || !assignment.value) {
                continue;
            }

            if (RESERVED_KEYWORDS.has(assignment.variable.toLowerCase())) {
                throw new Error(`"${assignment.variable}" is reserved and may not be reassigned.`);
            }

            const normalizedValue = assignment.value.replace(/\b(?:pi|π)\b/gi, 'pi');
            scope[assignment.variable] = nerdamer(normalizedValue).evaluate().text();
            const pattern = new RegExp(`\\b${assignment.variable}\\b`, 'g');
            preparedExpression = preparedExpression.replace(pattern, `(${scope[assignment.variable]})`);
        }

        return { expression: preparedExpression, scope };
    }

    handleEvaluate(parsed) {
        const { expression, assignments, placeholders } = parsed;
        const { expression: preparedExpression } = this.applyAssignments(expression, assignments);
        const result = nerdamer(preparedExpression).evaluate().text();
        return this.restorePlaceholders(result, placeholders);
    }

    handleSimplify(parsed) {
        const { expression, placeholders } = parsed;
        const result = nerdamer(expression).simplify().text();
        return this.restorePlaceholders(result, placeholders);
    }

    handleFactor(parsed) {
        const { expression, placeholders } = parsed;
        const result = nerdamer(expression).factor().text();
        return this.restorePlaceholders(result, placeholders);
    }

    handleExpand(parsed) {
        const { expression, placeholders } = parsed;
        const result = nerdamer.expand(expression).text();
        return this.restorePlaceholders(result, placeholders);
    }

    handleDerivative(parsed) {
        const { expression, variable, placeholders } = parsed;
        const target = variable || 'x';
        const result = nerdamer.diff(expression, target).text();
        return this.restorePlaceholders(result, placeholders);
    }

    handleIntegral(parsed) {
        const { expression, variable, placeholders } = parsed;
        const target = variable || 'x';
        const result = nerdamer.integrate(expression, target).text();
        return this.restorePlaceholders(`${result} + C`, placeholders);
    }

    handleSolve(parsed) {
        const { expression, variable, placeholders } = parsed;
        const target = variable || 'x';
        const result = nerdamer.solve(expression, target).toString();
        return this.restorePlaceholders(result, placeholders);
    }
}

function solveMath(rawInput) {
    const solver = new MathSolver();
    return solver.solve(rawInput);
}

module.exports = {
    solveMath
};

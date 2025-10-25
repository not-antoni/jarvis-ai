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

        expression = expression.replace(/^[:=,-]+/, '').trim();

        return { expression, variable };
    }

    detectVariables(expression) {
        const tokens = expression.match(/[A-Za-z_][A-Za-z0-9_]*/g) || [];
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

    injectPlaceholders(expression, placeholders = []) {
        if (!expression || !expression.length) {
            return expression;
        }

        let result = '';
        let index = 0;

        while (index < expression.length) {
            const match = this.matchUserFunction(expression, index);
            if (match) {
                const placeholder = this.getOrCreatePlaceholder(match.original, match.canonical, placeholders);
                result += placeholder;
                index = match.endIndex;
            } else {
                result += expression[index];
                index += 1;
            }
        }

        return result;
    }

    matchUserFunction(expression, startIndex) {
        const firstChar = expression[startIndex];

        if (!firstChar || !/[A-Za-z]/.test(firstChar)) {
            return null;
        }

        let nameEnd = startIndex;
        while (nameEnd < expression.length && /[A-Za-z0-9]/.test(expression[nameEnd])) {
            nameEnd++;
        }

        const name = expression.slice(startIndex, nameEnd);
        if (!name.length) {
            return null;
        }

        if (name.length !== 1) {
            return null;
        }

        const lowerName = name.toLowerCase();
        if (RESERVED_KEYWORDS.has(lowerName)) {
            return null;
        }

        const prevChar = startIndex > 0 ? expression[startIndex - 1] : null;
        if (prevChar && /[A-Za-z0-9_]/.test(prevChar)) {
            return null;
        }

        let cursor = nameEnd;
        while (cursor < expression.length && /\s/.test(expression[cursor])) {
            cursor++;
        }

        if (cursor >= expression.length || expression[cursor] !== '(') {
            return null;
        }

        let depth = 0;
        let position = cursor;

        while (position < expression.length) {
            const char = expression[position];
            if (char === '(') {
                depth += 1;
            } else if (char === ')') {
                depth -= 1;
                if (depth === 0) {
                    position += 1;
                    break;
                }
            }
            position += 1;
        }

        if (depth !== 0) {
            return null;
        }

        const original = expression.slice(startIndex, position);
        const canonical = original.replace(/\s+/g, '');
        return { name, endIndex: position, original, canonical };
    }

    getOrCreatePlaceholder(original, canonical, placeholders) {
        if (!Array.isArray(placeholders)) {
            return original;
        }

        const existing = placeholders.find(entry => entry.canonical === canonical);
        if (existing) {
            return existing.placeholder;
        }

        const placeholder = `__func${placeholders.length}__`;
        placeholders.push({ placeholder, original, canonical });
        return placeholder;
    }

    restorePlaceholders(text, placeholders) {
        if (!text || !Array.isArray(placeholders) || !placeholders.length) {
            return text;
        }

        return placeholders.reduce((output, entry) => {
            return output.split(entry.placeholder).join(entry.original);
        }, text);
    }

    handleEvaluate({ expression, rawExpression, placeholders = [], assignments = [] }) {
        if (!expression?.length) {
            return 'Please provide a valid expression after the math wake phrase, sir.';
        }

        try {
            const equalityIndex = this.findStandaloneEquals(expression);

            if (equalityIndex >= 0) {
                const leftSegment = expression.slice(0, equalityIndex).trim();
                const rightSegment = expression.slice(equalityIndex + 1).trim();

                if (!rightSegment.length) {
                    const display = this.getDisplayExpression(rawExpression, expression, placeholders);
                    return this.finalizeResponse([display, '= Unable to process the right-hand side'], placeholders);
                }

                const assignmentObject = this.buildAssignmentObject(assignments);
                const simplifiedNode = assignmentObject
                    ? nerdamer(rightSegment, assignmentObject).simplify()
                    : nerdamer(rightSegment).simplify();
                const simplifiedRightRaw = simplifiedNode.text();
                const approxRightRaw = this.safeApproximate(rightSegment, simplifiedRightRaw, assignments);

                const leftDisplay = this.restorePlaceholders(leftSegment, placeholders);
                const originalRightDisplay = this.restorePlaceholders(rightSegment, placeholders);
                const simplifiedRightDisplay = this.restorePlaceholders(simplifiedRightRaw, placeholders);
                const approxRightDisplay = approxRightRaw
                    ? this.restorePlaceholders(approxRightRaw, placeholders)
                    : null;

                const lines = [];
                if (leftDisplay) {
                    const originalCondensed = (originalRightDisplay || '').replace(/\s+/g, '');
                    const simplifiedCondensed = (simplifiedRightDisplay || '').replace(/\s+/g, '');

                    let includeSimplified = Boolean(simplifiedRightDisplay && simplifiedRightDisplay !== originalRightDisplay);
                    if (includeSimplified && simplifiedCondensed.length >= originalCondensed.length) {
                        includeSimplified = false;
                    }

                    let includeApprox = Boolean(
                        approxRightDisplay
                        && approxRightDisplay !== simplifiedRightDisplay
                        && approxRightDisplay !== originalRightDisplay
                    );
                    if (includeApprox && /[A-Za-z]/.test(approxRightDisplay.replace(/[π]/g, ''))) {
                        includeApprox = false;
                    }

                    lines.push(`${leftDisplay} = ${originalRightDisplay}`);
                    if (includeSimplified) {
                        lines.push(`${leftDisplay} = ${simplifiedRightDisplay}`);
                    }
                    if (includeApprox) {
                        lines.push(`${leftDisplay} ≈ ${approxRightDisplay}`);
                    }
                } else {
                    const display = this.getDisplayExpression(rawExpression, expression, placeholders);
                    lines.push(display);
                    const simplifiedCondensed = (simplifiedRightDisplay || '').replace(/\s+/g, '');
                    const displayCondensed = display.replace(/\s+/g, '');

                    if (simplifiedRightDisplay && simplifiedCondensed !== displayCondensed && simplifiedCondensed.length < displayCondensed.length) {
                        lines.push(`= ${simplifiedRightDisplay}`);
                    }

                    if (approxRightDisplay && !/[A-Za-z]/.test(approxRightDisplay.replace(/[π]/g, ''))) {
                        lines.push(`≈ ${approxRightDisplay}`);
                    }
                }

                if (assignments.length) {
                    lines.push(`Given: ${this.formatAssignments(assignments)}`);
                }

                return this.finalizeResponse(lines, placeholders);
            }

            const display = this.getDisplayExpression(rawExpression, expression, placeholders);
            const { exact, approx } = this.evaluateExpression(expression, assignments);

            const lines = [display, `= ${exact}`];
            if (approx && approx !== exact) {
                lines.push(`≈ ${approx}`);
            }

            if (assignments.length) {
                lines.push(`Given: ${this.formatAssignments(assignments)}`);
            }

            return this.finalizeResponse(lines, placeholders);
        } catch (error) {
            return this.reportFailure(error, expression, rawExpression, placeholders);
        }
    }

    handleSimplify({ expression, rawExpression, placeholders = [] }) {
        if (!expression?.length) {
            return 'Please provide something to simplify after the command, sir.';
        }

        try {
            const simplified = nerdamer(expression).simplify().text();
            const display = this.getDisplayExpression(rawExpression, expression, placeholders);
            const lines = [display, `= ${simplified}`];
            return this.finalizeResponse(lines, placeholders);
        } catch (error) {
            return this.reportFailure(error, expression, rawExpression, placeholders);
        }
    }

    handleFactor({ expression, rawExpression, placeholders = [] }) {
        if (!expression?.length) {
            return 'Please provide an expression to factor, sir.';
        }

        try {
            const factored = nerdamer(`factor(${expression})`).text();
            const display = this.getDisplayExpression(rawExpression, expression, placeholders);
            const lines = [display, `= ${factored}`];
            return this.finalizeResponse(lines, placeholders);
        } catch (error) {
            return this.reportFailure(error, expression, rawExpression, placeholders);
        }
    }

    handleExpand({ expression, rawExpression, placeholders = [] }) {
        if (!expression?.length) {
            return 'Please provide an expression to expand, sir.';
        }

        try {
            const expanded = nerdamer(`expand(${expression})`).text();
            const display = this.getDisplayExpression(rawExpression, expression, placeholders);
            const lines = [display, `= ${expanded}`];
            return this.finalizeResponse(lines, placeholders);
        } catch (error) {
            return this.reportFailure(error, expression, rawExpression, placeholders);
        }
    }

    handleDerivative({ expression, rawExpression, variable, placeholders = [] }) {
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
            const display = this.getDisplayExpression(rawExpression, expression, placeholders);
            const lines = [`d/d${target} (${display})`, `= ${derivative}`];
            return this.finalizeResponse(lines, placeholders);
        } catch (error) {
            return this.reportFailure(error, expression, rawExpression, placeholders);
        }
    }

    handleIntegral({ expression, rawExpression, variable, placeholders = [] }) {
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
            const display = this.getDisplayExpression(rawExpression, expression, placeholders);
            const lines = [`Integral d${target} (${display})`, `= ${integral} + C`];
            return this.finalizeResponse(lines, placeholders);
        } catch (error) {
            return this.reportFailure(error, expression, rawExpression, placeholders);
        }
    }

    handleSolve({ expression, rawExpression, variable, placeholders = [] }) {
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
            const display = this.getDisplayExpression(rawExpression, expression, placeholders);
            const lines = [display || 'Equation', 'Unable to detect a variable to solve for'];
            return this.finalizeResponse(lines, placeholders);
        }

        try {
            if (variables.length === 1 && equations.length === 1) {
                const [left, right] = equations[0].split('=');
                const diff = `${left} - (${right})`;
                const rawSolutions = nerdamer.solve(diff, variables[0]);
                const solutionStrings = this.unpackSolutionList(rawSolutions);

                if (!solutionStrings.length) {
                    const display = this.prepareEquationDisplay(rawExpression, equations, placeholders);
                    const lines = [...display, `No solution found for ${variables[0]}`];
                    return this.finalizeResponse(lines, placeholders);
                }

                const formatted = this.formatSingleVariableSolutions(solutionStrings, variables[0]);
                const display = this.prepareEquationDisplay(rawExpression, equations, placeholders);
                const lines = [...display, ...formatted];
                return this.finalizeResponse(lines, placeholders);
            }

            const systemSolutions = nerdamer.solveEquations(equations, variables);
            const parsedSolutions = this.unpackSystemSolutions(systemSolutions);

            if (!parsedSolutions.length) {
                const display = this.prepareEquationDisplay(rawExpression, equations, placeholders);
                const lines = [...display, 'No solution found for the provided system'];
                return this.finalizeResponse(lines, placeholders);
            }

            const display = this.prepareEquationDisplay(rawExpression, equations, placeholders);
            const details = parsedSolutions.map(({ variable: v, value }) => {
                const approx = this.safeApproximate(value, value);
                return approx && approx !== value
                    ? `${v} = ${value} (≈ ${approx})`
                    : `${v} = ${value}`;
            });
            const lines = [...display, ...details];
            return this.finalizeResponse(lines, placeholders);
        } catch (error) {
            return this.reportFailure(error, expression, rawExpression, placeholders);
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

        if (Array.isArray(raw)) {
            return raw
                .map(entry => {
                    if (Array.isArray(entry) && entry.length === 2) {
                        const [variable, value] = entry;
                        return {
                            variable: typeof variable === 'string' ? variable : String(variable),
                            value: typeof value === 'string' ? value : String(value)
                        };
                    }
                    if (entry && typeof entry === 'object' && 'variable' in entry && 'value' in entry) {
                        return {
                            variable: String(entry.variable),
                            value: String(entry.value)
                        };
                    }
                    return null;
                })
                .filter(Boolean);
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

    safeApproximate(expression, fallback = null, assignments = []) {
        try {
            const assignmentObject = this.buildAssignmentObject(assignments);
            const approxNode = assignmentObject
                ? nerdamer(expression, assignmentObject).evaluate()
                : nerdamer(expression).evaluate();
            const approx = approxNode.text();
            if (approx && approx !== fallback) {
                return approx;
            }
        } catch {
            return null;
        }
        return null;
    }

    evaluateExpression(expression, assignments = []) {
        const assignmentObject = this.buildAssignmentObject(assignments);
        const node = assignmentObject
            ? nerdamer(expression, assignmentObject)
            : nerdamer(expression);

        const exact = node.evaluate().text();
        const approx = this.safeApproximate(expression, exact, assignments);

        return { exact, approx };
    }

    buildAssignmentObject(assignments = []) {
        if (!assignments || !assignments.length) {
            return null;
        }

        return assignments.reduce((acc, { variable, value }) => {
            if (variable && value) {
                acc[variable] = value;
            }
            return acc;
        }, {});
    }

    formatAssignments(assignments = []) {
        if (!assignments || !assignments.length) {
            return '';
        }

        const parts = assignments.map(({ variable, rawValue, value }) => {
            const displayValue = rawValue || value || '';
            return `${variable} = ${displayValue}`;
        });

        return parts.join(', ');
    }

    findStandaloneEquals(expression) {
        if (!expression || !expression.length) {
            return -1;
        }

        for (let i = 0; i < expression.length; i++) {
            if (expression[i] !== '=') {
                continue;
            }

            const prev = i > 0 ? expression[i - 1] : null;
            const next = i + 1 < expression.length ? expression[i + 1] : null;

            if (prev === '<' || prev === '>' || prev === '!' || prev === '=') {
                continue;
            }

            if (next === '=') {
                continue;
            }

            return i;
        }

        return -1;
    }

    getDisplayExpression(rawExpression, normalized, placeholders) {
        if (typeof rawExpression === 'string' && rawExpression.trim().length) {
            return rawExpression.trim();
        }

        const fallback = normalized || '';
        return this.restorePlaceholders(fallback, placeholders).trim();
    }

    prepareEquationDisplay(rawExpression, normalizedEquations, placeholders) {
        const displaySource = typeof rawExpression === 'string' && rawExpression.trim().length
            ? rawExpression
            : normalizedEquations.join('\n');

        const restored = this.restorePlaceholders(displaySource, placeholders);

        return restored
            .split(/[\n;]+/)
            .map(segment => segment.trim())
            .filter(Boolean)
            .map(segment => (segment.includes('=') ? segment : `${segment} = 0`));
    }

    finalizeResponse(lines, placeholders = []) {
        const cleaned = Array.isArray(lines)
            ? lines.map(line => (line || '').trim()).filter(line => line.length)
            : [];

        if (!cleaned.length) {
            return 'Computation complete, sir.';
        }

        const restored = cleaned
            .map(line => this.restorePlaceholders(line, placeholders).trim())
            .filter(line => line.length);

        if (!restored.length) {
            return 'Computation complete, sir.';
        }

        const formatted = restored.map(line => this.formatForOutput(line));

        const lastIndex = formatted.length - 1;
        let lastLine = formatted[lastIndex];
        if (!/sir\.\s*$/i.test(lastLine)) {
            let base = lastLine.replace(/\s+$/, '');
            if (base.endsWith('.')) {
                base = base.slice(0, -1);
            }
            formatted[lastIndex] = `${base}, sir.`;
        }

        return formatted.join('\n');
    }

    reportFailure(error, expression, rawExpression, placeholders) {
        const reason = error?.message ? error.message.replace(/^Error:\s*/i, '') : 'Unexpected error';
        const display = this.getDisplayExpression(rawExpression, expression, placeholders) || 'Problem';
        const lines = [display, `Error: ${reason}`, 'Please adjust the problem and try again'];
        return this.finalizeResponse(lines, placeholders);
    }

    formatForOutput(text) {
        if (!text) {
            return text;
        }

        let output = text;

        output = output.replace(/sqrt\s*\(/gi, '√(');
        output = output.replace(/\bpi\b/gi, 'π');
        output = output.replace(/abs\(([^()]+)\)/gi, '|$1|');
        output = output.replace(/<=/g, '≤');
        output = output.replace(/>=/g, '≥');
        output = output.replace(/!=/g, '≠');
        output = output.replace(/->/g, '→');

        output = output.replace(/√\(([^()]+)\)\^\(-1\)/g, '1/√($1)');
        output = output.replace(/\*1\/√\(/g, ' / √(');

        output = output.replace(/([0-9A-Za-z)π√])\s*\*\s*([0-9A-Za-z(π√])/g, '$1·$2');

        output = output.replace(/\^([+-]?[0-9]+)/g, (_, digits) => this.toSuperscript(digits));

        return output;
    }

    toSuperscript(digits) {
        const SUPERSCRIPTS = {
            '0': '⁰',
            '1': '¹',
            '2': '²',
            '3': '³',
            '4': '⁴',
            '5': '⁵',
            '6': '⁶',
            '7': '⁷',
            '8': '⁸',
            '9': '⁹',
            '+': '⁺',
            '-': '⁻'
        };

        return digits.split('').map(char => SUPERSCRIPTS[char] || char).join('');
    }
}

module.exports = new MathSolver();

const nerdamer = require('nerdamer/all');

// Temporary function storage (auto-clears after use)
const functionStore = new Map();
const FUNCTION_TTL_MS = 60000; // Functions expire after 1 minute

function storeFunction(name, variable, expression) {
    functionStore.set(name.toLowerCase(), {
        variable,
        expression,
        createdAt: Date.now()
    });
    // Auto-cleanup after TTL
    setTimeout(() => {
        functionStore.delete(name.toLowerCase());
    }, FUNCTION_TTL_MS);
}

function getFunction(name) {
    const fn = functionStore.get(name.toLowerCase());
    if (!fn) {return null;}
    // Check if expired
    if (Date.now() - fn.createdAt > FUNCTION_TTL_MS) {
        functionStore.delete(name.toLowerCase());
        return null;
    }
    return fn;
}

function clearFunction(name) {
    functionStore.delete(name.toLowerCase());
}

const RESERVED_KEYWORDS = new Set([
    'sin',
    'cos',
    'tan',
    'cot',
    'sec',
    'csc',
    'asin',
    'acos',
    'atan',
    'acot',
    'asec',
    'acsc',
    'arcsin',
    'arccos',
    'arctan',
    'arccot',
    'arcsec',
    'arccsc',
    'sinh',
    'cosh',
    'tanh',
    'coth',
    'sech',
    'csch',
    'log',
    'ln',
    'sqrt',
    'abs',
    'sign',
    'sgn',
    'exp',
    'floor',
    'ceil',
    'round',
    'min',
    'max',
    'mod',
    'gcd',
    'lcm',
    'diff',
    'integrate',
    'factor',
    'expand',
    'simplify',
    'sum',
    'product',
    'pow',
    'and',
    'or',
    'xor',
    'not',
    'pi',
    'e'
]);

const MAX_INPUT_LENGTH = 240;
const MAX_NESTED_FUNCTIONS = 12;
const MAX_FACTORIALS = 3;
const MAX_EXPONENTS = 6;

class MathSolver {
    solve(rawInput) {
        // Handle random/stats operations before nerdamer parsing
        const randomResult = this.tryRandomOperation(rawInput);
        if (randomResult !== null) {return randomResult;}

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

    tryRandomOperation(rawInput) {
        const trimmed = String(rawInput ?? '').trim().toLowerCase();

        // random - plain random number 0-1
        if (/^rand(om)?$/i.test(trimmed)) {
            return String(Math.random());
        }

        // random <min> <max> or random(<min>, <max>)
        const randRange = trimmed.match(/^rand(?:om)?\s*\(?\s*(-?[\d.]+)\s*[,\s]\s*(-?[\d.]+)\s*\)?$/i);
        if (randRange) {
            const min = parseFloat(randRange[1]);
            const max = parseFloat(randRange[2]);
            if (isNaN(min) || isNaN(max)) {return null;}
            const result = Math.floor(Math.random() * (max - min + 1)) + min;
            return String(result);
        }

        // randint <max> - random integer 1 to max
        const randInt = trimmed.match(/^randint\s*\(?\s*(\d+)\s*\)?$/i);
        if (randInt) {
            const max = parseInt(randInt[1]);
            return String(Math.floor(Math.random() * max) + 1);
        }

        // dice <count>d<sides> - dice rolls
        const diceMatch = trimmed.match(/^(?:dice|roll)\s+(\d+)d(\d+)$/i);
        if (diceMatch) {
            const count = Math.min(parseInt(diceMatch[1]), 100);
            const sides = parseInt(diceMatch[2]);
            const rolls = Array.from({ length: count }, () => Math.floor(Math.random() * sides) + 1);
            const total = rolls.reduce((a, b) => a + b, 0);
            return `[${rolls.join(', ')}] = ${total}`;
        }

        // choose <a>, <b>, <c> - random choice
        const chooseMatch = trimmed.match(/^choose\s+(.+)$/i);
        if (chooseMatch) {
            const options = chooseMatch[1].split(/[,|]/).map(s => s.trim()).filter(Boolean);
            if (options.length < 2) {return null;}
            return options[Math.floor(Math.random() * options.length)];
        }

        // shuffle <a>, <b>, <c> - shuffle list
        const shuffleMatch = trimmed.match(/^shuffle\s+(.+)$/i);
        if (shuffleMatch) {
            const items = shuffleMatch[1].split(/[,|]/).map(s => s.trim()).filter(Boolean);
            for (let i = items.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [items[i], items[j]] = [items[j], items[i]];
            }
            return items.join(', ');
        }

        // avg/mean <numbers> - average
        const avgMatch = trimmed.match(/^(?:avg|average|mean)\s+(.+)$/i);
        if (avgMatch) {
            const nums = avgMatch[1].split(/[\s,]+/).map(Number).filter(n => !isNaN(n));
            if (!nums.length) {return null;}
            return String(nums.reduce((a, b) => a + b, 0) / nums.length);
        }

        // median <numbers>
        const medianMatch = trimmed.match(/^median\s+(.+)$/i);
        if (medianMatch) {
            const nums = medianMatch[1].split(/[\s,]+/).map(Number).filter(n => !isNaN(n)).sort((a, b) => a - b);
            if (!nums.length) {return null;}
            const mid = Math.floor(nums.length / 2);
            return String(nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2);
        }

        // stddev <numbers> - standard deviation
        const stdMatch = trimmed.match(/^(?:stddev|stdev|sd)\s+(.+)$/i);
        if (stdMatch) {
            const nums = stdMatch[1].split(/[\s,]+/).map(Number).filter(n => !isNaN(n));
            if (nums.length < 2) {return null;}
            const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
            const variance = nums.reduce((sum, n) => sum + (n - mean) ** 2, 0) / nums.length;
            return String(Math.sqrt(variance));
        }

        // base conversion: <num> to base<n> or hex/bin/oct
        const baseMatch = trimmed.match(/^(\d+)\s+to\s+(hex|bin|oct|base\s*(\d+))$/i);
        if (baseMatch) {
            const num = parseInt(baseMatch[1]);
            const target = baseMatch[2].toLowerCase();
            if (target === 'hex') {return `0x${num.toString(16).toUpperCase()}`;}
            if (target === 'bin') {return `0b${num.toString(2)}`;}
            if (target === 'oct') {return `0o${num.toString(8)}`;}
            if (baseMatch[3]) {return num.toString(parseInt(baseMatch[3]));}
        }

        // percentage: what % of X is Y  or  X % of Y
        const pctOfMatch = trimmed.match(/^([\d.]+)\s*%\s*of\s*([\d.]+)$/i);
        if (pctOfMatch) {
            return String((parseFloat(pctOfMatch[1]) / 100) * parseFloat(pctOfMatch[2]));
        }

        return null;
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

        const wrtMatch = expression.match(
            /(.+?)(?:with respect to|wrt)\s+([a-zA-Z][a-zA-Z0-9]*)$/i
        );
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

        // Check for function definition: f(x) = x^2
        const funcDefMatch = normalized.match(/^([a-zA-Z])\s*\(\s*([a-zA-Z])\s*\)\s*=\s*(.+)$/i);
        if (funcDefMatch) {
            const [, funcName, varName, funcExpr] = funcDefMatch;
            storeFunction(funcName, varName, funcExpr.trim());
            // Return a confirmation message marker
            this._lastFunctionDefined = {
                name: funcName,
                variable: varName,
                expression: funcExpr.trim()
            };
            return funcExpr.trim(); // Return expression for display
        }

        // Check for function evaluation: f(2) or f(5)
        const funcEvalMatch = normalized.match(/^([a-zA-Z])\s*\(\s*([0-9.]+)\s*\)$/i);
        if (funcEvalMatch) {
            const [, funcName, inputValue] = funcEvalMatch;
            const storedFunc = getFunction(funcName);
            if (storedFunc) {
                // Substitute the value into the expression
                const substituted = storedFunc.expression.replace(
                    new RegExp(`\\b${storedFunc.variable}\\b`, 'g'),
                    `(${inputValue})`
                );
                // Clear function after use (one-time use)
                clearFunction(funcName);
                return substituted;
            }
            // If no stored function, treat as regular expression
        }

        if (/[^0-9a-zA-Z\s+\-*/^%().,=<>!_|]/.test(normalized)) {
            const invalid = normalized.match(/[^0-9a-zA-Z\s+\-*/^%().,=<>!_|]/g)?.[0];
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
            preparedExpression = preparedExpression.replace(
                pattern,
                `(${scope[assignment.variable]})`
            );
        }

        return { expression: preparedExpression, scope };
    }

    handleEvaluate(parsed) {
        const { expression, assignments, placeholders } = parsed;

        // Check if this was a function definition
        if (this._lastFunctionDefined) {
            const { name, variable, expression: funcExpr } = this._lastFunctionDefined;
            this._lastFunctionDefined = null;
            return `Function ${name}(${variable}) = ${funcExpr} stored (use ${name}(value) to evaluate, expires in 60s)`;
        }

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

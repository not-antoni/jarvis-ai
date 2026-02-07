'use strict';

const { parentPort } = require('worker_threads');
const vm = require('vm');

if (!parentPort) {
    throw new Error('code-worker must be run as a worker thread');
}

parentPort.on('message', ({ code, language, timeoutMs }) => {
    const timeout = Math.min(timeoutMs || 5000, 10000);

    try {
        if (language === 'javascript' || language === 'js') {
            const logs = [];
            const errors = [];

            const sandbox = {
                console: {
                    log: (...args) => logs.push(args.map(String).join(' ')),
                    error: (...args) => errors.push(args.map(String).join(' ')),
                    warn: (...args) => logs.push(`[warn] ${args.map(String).join(' ')}`),
                    info: (...args) => logs.push(args.map(String).join(' '))
                },
                Math,
                Date,
                JSON,
                parseInt,
                parseFloat,
                isNaN,
                isFinite,
                Number,
                String,
                Boolean,
                Array,
                Object,
                Map,
                Set,
                RegExp,
                Error,
                TypeError,
                RangeError,
                Symbol,
                Promise,
                setTimeout: undefined,
                setInterval: undefined,
                setImmediate: undefined,
                clearTimeout: undefined,
                clearInterval: undefined,
                process: undefined,
                require: undefined,
                global: undefined,
                globalThis: undefined,
                __dirname: undefined,
                __filename: undefined,
                module: undefined,
                exports: undefined,
                Buffer: undefined,
                fetch: undefined
            };

            const context = vm.createContext(sandbox);
            const script = new vm.Script(code, { filename: 'user-code.js' });
            const result = script.runInContext(context, { timeout });

            const output = logs.join('\n');
            const errorOutput = errors.join('\n');
            const resultStr = result !== undefined ? String(result) : '';

            let combined = '';
            if (output) combined += output;
            if (resultStr && resultStr !== 'undefined') {
                if (combined) combined += '\n';
                combined += `=> ${resultStr}`;
            }
            if (errorOutput) {
                if (combined) combined += '\n';
                combined += `[stderr] ${errorOutput}`;
            }

            if (!combined.trim()) {
                combined = '(no output)';
            }

            parentPort.postMessage({ success: true, result: combined.slice(0, 4000) });
        } else {
            parentPort.postMessage({
                success: false,
                error: `Language "${language}" is not supported. Currently only JavaScript is available.`
            });
        }
    } catch (error) {
        let errorMessage = error?.message || 'Code execution failed.';
        if (errorMessage.includes('Script execution timed out')) {
            errorMessage = 'Execution timed out — your code took too long, sir.';
        }
        parentPort.postMessage({ success: false, error: errorMessage });
    }
});

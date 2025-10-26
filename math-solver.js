const path = require('path');
const { Worker } = require('worker_threads');

const WORKER_PATH = path.join(__dirname, 'math-worker.js');
const MAX_INPUT_LENGTH = 240;
const TIMEOUT_MS = 5000;

function sanitizeInput(rawInput) {
    const value = typeof rawInput === 'string' ? rawInput : String(rawInput ?? '');
    if (!value.trim().length) {
        throw new Error('No expression provided');
    }

    if (value.length > MAX_INPUT_LENGTH) {
        throw new Error('Expression too long, sir. Try something more focused.');
    }

    return value;
}

function runMathWorker(rawInput) {
    return new Promise((resolve, reject) => {
        const worker = new Worker(WORKER_PATH);
        const timer = setTimeout(() => {
            worker.terminate();
            reject(new Error('Math subsystem timed out, sir.'));
        }, TIMEOUT_MS);

        worker.once('message', (message) => {
            clearTimeout(timer);
            worker.terminate();
            if (message?.success) {
                resolve(message.result);
            } else {
                reject(new Error(message?.error || 'Math evaluation failed.'));
            }
        });

        worker.once('error', (err) => {
            clearTimeout(timer);
            worker.terminate();
            reject(err);
        });

        worker.postMessage({ rawInput });
    });
}

module.exports = {
    async solve(rawInput) {
        const sanitized = sanitizeInput(rawInput);
        return await runMathWorker(sanitized);
    }
};

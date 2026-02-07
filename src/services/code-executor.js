'use strict';

const path = require('path');
const { Worker } = require('worker_threads');

const WORKER_PATH = path.join(__dirname, 'code-worker.js');
const DEFAULT_TIMEOUT_MS = 5000;
const MAX_CODE_LENGTH = 2000;

/**
 * Execute user code in a sandboxed worker thread.
 * Currently supports JavaScript only. The sandbox has no access to
 * Node.js APIs (require, fs, process, Buffer, etc.) — only standard
 * JS built-ins and a mock console that captures output.
 */
function executeCode(code, language = 'javascript', timeoutMs = DEFAULT_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
        if (!code || typeof code !== 'string' || !code.trim()) {
            return reject(new Error('No code provided.'));
        }

        if (code.length > MAX_CODE_LENGTH) {
            return reject(new Error(`Code too long (${code.length} chars). Max is ${MAX_CODE_LENGTH}.`));
        }

        const lang = (language || 'javascript').toLowerCase().trim();

        const worker = new Worker(WORKER_PATH);
        const timer = setTimeout(() => {
            worker.terminate();
            reject(new Error('Code execution timed out, sir.'));
        }, Math.min(timeoutMs, 10000) + 1000); // Extra 1s buffer for worker overhead

        worker.once('message', (message) => {
            clearTimeout(timer);
            worker.terminate();
            if (message?.success) {
                resolve(message.result);
            } else {
                reject(new Error(message?.error || 'Code execution failed.'));
            }
        });

        worker.once('error', (err) => {
            clearTimeout(timer);
            worker.terminate();
            reject(err);
        });

        worker.postMessage({ code, language: lang, timeoutMs: Math.min(timeoutMs, 10000) });
    });
}

module.exports = { executeCode };

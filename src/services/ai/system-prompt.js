'use strict';

const fs = require('fs');
const path = require('path');

const PROMPT_PATH = path.join(__dirname, '..', '..', '..', 'config', 'system-prompt.txt');

let _promptCache = null;
let _promptMtime = null;

function loadSystemPrompt() {
    try {
        const stat = fs.statSync(PROMPT_PATH);
        if (_promptCache !== null && _promptMtime === stat.mtimeMs) {
            return _promptCache;
        }
        _promptCache = fs.readFileSync(PROMPT_PATH, 'utf8').trim();
        _promptMtime = stat.mtimeMs;
    } catch (err) {
        console.warn(`[AIExecution] Failed to load system-prompt.txt:`, err.message);
        _promptCache = null;
    }
    return _promptCache;
}

function resolveSystemPrompt(composedPrompt, _provider) {
    const prompt = loadSystemPrompt();
    if (!prompt) return composedPrompt;
    const toneMatch = composedPrompt?.match(/\n\n\[TONE ADJUSTMENT:[^\]]*\]/);
    return prompt + (toneMatch ? toneMatch[0] : '');
}

module.exports = {
    loadSystemPrompt,
    resolveSystemPrompt
};

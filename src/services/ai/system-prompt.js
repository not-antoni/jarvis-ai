'use strict';

const fs = require('fs');
const path = require('path');

const promptsDir = path.join(__dirname, '..', '..', '..', 'config', 'prompts');
const _promptCache = {};
const _promptMtimes = {};

const FAMILY_TIER = {
    mistral: 'flexible',
    google: 'google',
    deepseek: 'flexible',
    cerebras: 'moderate',
    openai: 'moderate',
    nvidia: 'moderate',
    bedrock: 'moderate',
    openrouter: 'moderate',
    ollama: 'moderate',
    groq: 'strict',
    sambanova: 'strict'
};

function loadTierPrompt(tier) {
    const filePath = path.join(promptsDir, `${tier}.txt`);
    try {
        const stat = fs.statSync(filePath);
        if (_promptCache[tier] && _promptMtimes[tier] === stat.mtimeMs) {
            return _promptCache[tier];
        }
        _promptCache[tier] = fs.readFileSync(filePath, 'utf8').trim();
        _promptMtimes[tier] = stat.mtimeMs;
    } catch (err) {
        console.warn(`[AIExecution] Failed to load ${tier}.txt prompt, falling back to flexible:`, err.message);
        if (tier !== 'flexible') {return loadTierPrompt('flexible');}
        _promptCache[tier] = null;
    }
    return _promptCache[tier];
}

function resolveSystemPrompt(composedPrompt, provider) {
    const family = String(provider?.family || '').toLowerCase();
    const tier = FAMILY_TIER[family];
    if (!tier || tier === 'flexible') {return composedPrompt;}
    const tierPrompt = loadTierPrompt(tier);
    if (!tierPrompt) {return composedPrompt;}
    const toneMatch = composedPrompt.match(/\n\n\[TONE ADJUSTMENT:[^\]]*\]/);
    return tierPrompt + (toneMatch ? toneMatch[0] : '');
}

module.exports = {
    FAMILY_TIER,
    loadTierPrompt,
    resolveSystemPrompt
};

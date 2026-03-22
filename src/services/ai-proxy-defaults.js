'use strict';

const DEFAULT_ALLOWED_HOSTS = [
    'api.openai.com',
    'openrouter.ai',
    'api.groq.com',
    'ollama.com',
    'ai-gateway.vercel.sh',
    'generativelanguage.googleapis.com',
    'integrate.api.nvidia.com'
];

const DEFAULT_BYPASS_HOSTS = [
    // Google Gemini rate limits are tied to the Google project/key,
    // so rotating Cloudflare workers only multiplies 429s instead of helping.
    'generativelanguage.googleapis.com'
];

function getDefaultAllowedHostsCsv() {
    return DEFAULT_ALLOWED_HOSTS.join(',');
}

function getDefaultBypassHostsCsv() {
    return DEFAULT_BYPASS_HOSTS.join(',');
}

function readCsvEnvWithFallback(name, fallbackCsv) {
    return Object.prototype.hasOwnProperty.call(process.env, name)
        ? String(process.env[name] || '')
        : fallbackCsv;
}

module.exports = {
    DEFAULT_ALLOWED_HOSTS,
    DEFAULT_BYPASS_HOSTS,
    getDefaultAllowedHostsCsv,
    getDefaultBypassHostsCsv,
    readCsvEnvWithFallback
};

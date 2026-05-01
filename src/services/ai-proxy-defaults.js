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
    'generativelanguage.googleapis.com',
    // Groq rate limits by API key, not IP - proxy just adds latency.
    'api.groq.com',
    // NVIDIA NIM rate limits by API key - proxy just adds latency.
    'integrate.api.nvidia.com',
    // Vercel AI Gateway rejects proxied requests (403) - must go direct.
    'ai-gateway.vercel.sh'
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

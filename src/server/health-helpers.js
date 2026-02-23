'use strict';

const fs = require('fs');
const path = require('path');

function safeReadJson(filePath, fallback) {
    try {
        if (!fs.existsSync(filePath)) {
            return fallback;
        }
        const raw = fs.readFileSync(filePath, 'utf8');
        return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
        console.warn(`Failed to read ${path.basename(filePath)}:`, error);
        return fallback;
    }
}

function writeJsonAtomic(filePath, value) {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    const tempPath = `${filePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(value, null, 2));
    fs.renameSync(tempPath, filePath);
}

function extractBearerToken(req) {
    const healthTokenHeader = req.headers?.['x-health-token'];
    if (typeof healthTokenHeader === 'string' && healthTokenHeader.trim()) {
        return healthTokenHeader.trim();
    }

    const authHeader = req.headers?.authorization;
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
        return authHeader.slice(7).trim();
    }
    if (typeof req.query?.token === 'string') {
        return req.query.token;
    }
    return null;
}

function isRenderHealthCheck(req) {
    const ua = String(req.headers?.['user-agent'] || '').toLowerCase();
    if (ua.includes('render/health')) {return true;}

    const forwardedFor = String(req.headers?.['x-forwarded-for'] || '')
        .split(',')[0]
        .trim();
    if (forwardedFor.startsWith('10.') || forwardedFor === '127.0.0.1' || forwardedFor === '::1') {
        return true;
    }

    const remoteAddr = (req.ip || '').replace('::ffff:', '');
    return remoteAddr === '127.0.0.1' || remoteAddr === '::1';
}

function isRenderHealthUserAgent(req) {
    const ua = String(req.headers?.['user-agent'] || '').toLowerCase();
    return ua.includes('render/health');
}

function buildProviderDigestResponse(providers = []) {
    const list = Array.isArray(providers) ? providers : [];
    const total = list.length;
    const online = list.filter(p => !p.hasError && !p.isDisabled).length;
    const errored = list.filter(p => p.hasError).length;
    const disabled = list.filter(p => p.isDisabled).length;
    const latencySamples = list
        .map(p => p.metrics?.avgLatencyMs)
        .filter(value => Number.isFinite(value) && value > 0);
    const avgLatencyMs = latencySamples.length
        ? Math.round(latencySamples.reduce((sum, value) => sum + value, 0) / latencySamples.length)
        : null;

    const fastestProviders = list
        .filter(p => Number.isFinite(p.metrics?.avgLatencyMs))
        .sort((a, b) => a.metrics.avgLatencyMs - b.metrics.avgLatencyMs)
        .slice(0, 5)
        .map(p => ({
            name: p.name,
            type: p.type,
            family: p.family || null,
            avgLatencyMs: Math.round(p.metrics.avgLatencyMs),
            successRate: p.metrics?.successRate
        }));

    const issueCandidates = list
        .filter(p => p.hasError || p.isDisabled)
        .sort((a, b) => {
            const failuresA = a.metrics?.failures || 0;
            const failuresB = b.metrics?.failures || 0;
            return failuresB - failuresA;
        })
        .slice(0, 5)
        .map(p => ({
            name: p.name,
            type: p.type,
            status: p.isDisabled ? 'disabled' : 'error',
            lastError: p.lastError || null,
            disabledUntil: p.disabledUntil || null
        }));

    return {
        generatedAt: new Date().toISOString(),
        summary: {
            total,
            online,
            errored,
            disabled,
            avgLatencyMs
        },
        fastestProviders,
        issueCandidates
    };
}

module.exports = {
    safeReadJson,
    writeJsonAtomic,
    extractBearerToken,
    isRenderHealthCheck,
    isRenderHealthUserAgent,
    buildProviderDigestResponse
};

'use strict';

/**
 * Edge security middleware (#262, #265, #266).
 *
 * Three layered checks, evaluated in order:
 *   1. ASN blocklist     - drop traffic from networks known for abuse.
 *                          Fed via the `cf-asn` (or `x-asn`) header that the
 *                          Cloudflare worker / transform rule attaches.
 *   2. Country blocklist  - drop traffic from disallowed regions, read from
 *                          `cf-ipcountry`.
 *   3. IP whitelist       - when configured, only these CIDRs may reach
 *                          non-public routes (health/landing/assets stay
 *                          public so monitoring keeps working).
 *
 * Configure via env:
 *   BLOCKED_ASNS=14061,16276,3214        - comma-separated AS numbers
 *   BLOCKED_COUNTRIES=ru,kp,ir           - ISO 3166-1 alpha-2 codes
 *   IP_WHITELIST=1.2.3.4/32,5.6.0.0/16   - restrict admin/portal endpoints
 *   IP_WHITELIST_MODE=strict|soft        - strict applies to ALL routes
 *
 * Public read-only routes (`/`, `/portal`, static assets, /api/stats, /health,
 * /robots.txt, /sitemap.xml, OAuth flows) bypass the IP whitelist when mode is
 * soft. ASN + country blocks are always enforced.
 */

const { isIpInRanges } = require('../utils/net-guard');

function parseCsvEnv(value) {
    return String(value || '')
        .split(/[\s,]+/)
        .map(entry => entry.trim())
        .filter(Boolean);
}

const BLOCKED_ASNS = new Set(parseCsvEnv(process.env.BLOCKED_ASNS).map(v => v.replace(/^as/i, '')));
const BLOCKED_COUNTRIES = new Set(parseCsvEnv(process.env.BLOCKED_COUNTRIES).map(v => v.toLowerCase()));
const IP_WHITELIST = parseCsvEnv(process.env.IP_WHITELIST);
const IP_WHITELIST_MODE = String(process.env.IP_WHITELIST_MODE || 'soft').toLowerCase();

const PUBLIC_PREFIXES = [
    '/health',
    '/robots.txt',
    '/sitemap.xml',
    '/api/stats',
    '/assets/',
    '/favicon.ico',
    '/jarvis.webp',
    '/portal/login',
    '/portal/callback',
    '/portal/logout'
];

function isPublicRoute(req) {
    const p = String(req.path || '');
    if (p === '/' || p === '/home' || p === '/portal') {return true;}
    return PUBLIC_PREFIXES.some(prefix => p === prefix || p.startsWith(prefix));
}

function getClientIp(req) {
    const cf = req.headers['cf-connecting-ip'];
    if (cf && typeof cf === 'string') {return cf.trim();}
    if (typeof req.ip === 'string' && req.ip) {
        return req.ip.replace(/^::ffff:/, '');
    }
    const remote = req.socket?.remoteAddress;
    if (typeof remote === 'string' && remote) {return remote.replace(/^::ffff:/, '');}
    return '';
}

function getAsn(req) {
    const value = req.headers['cf-asn'] || req.headers['x-asn'];
    if (!value) {return null;}
    return String(value).replace(/^as/i, '').trim();
}

function getCountry(req) {
    const value = req.headers['cf-ipcountry'] || req.headers['x-country'];
    if (!value) {return null;}
    return String(value).trim().toLowerCase();
}

function ipMatchesAny(ip, ranges) {
    if (!ip || !ranges?.length) {return false;}
    const normalized = ranges.map(range => {
        if (range.includes('/')) {return range;}
        // Bare IP - treat as /32 (v4) or /128 (v6)
        return range.includes(':') ? `${range}/128` : `${range}/32`;
    });
    return isIpInRanges(ip, normalized);
}

function shouldEnforceWhitelist(req) {
    if (!IP_WHITELIST.length) {return false;}
    if (IP_WHITELIST_MODE === 'strict') {return true;}
    return !isPublicRoute(req);
}

function createSecurityGuard() {
    function securityGuard(req, res, next) {
        // ASN block - applied to every request when configured.
        if (BLOCKED_ASNS.size) {
            const asn = getAsn(req);
            if (asn && BLOCKED_ASNS.has(asn)) {
                res.status(403).end();
                return;
            }
        }

        // Country block - applied to every request when configured.
        if (BLOCKED_COUNTRIES.size) {
            const country = getCountry(req);
            if (country && BLOCKED_COUNTRIES.has(country)) {
                res.status(403).end();
                return;
            }
        }

        // IP whitelist - applied based on mode.
        if (shouldEnforceWhitelist(req)) {
            const ip = getClientIp(req);
            if (!ip || !ipMatchesAny(ip, IP_WHITELIST)) {
                res.status(403).end();
                return;
            }
        }

        next();
    }

    securityGuard.summary = {
        asnBlocked: BLOCKED_ASNS.size,
        countryBlocked: BLOCKED_COUNTRIES.size,
        whitelistEntries: IP_WHITELIST.length,
        whitelistMode: IP_WHITELIST_MODE
    };

    return securityGuard;
}

module.exports = {
    createSecurityGuard,
    isPublicRoute,
    _internals: {
        BLOCKED_ASNS,
        BLOCKED_COUNTRIES,
        IP_WHITELIST,
        IP_WHITELIST_MODE
    }
};

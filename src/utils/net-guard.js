'use strict';

const dns = require('dns').promises;
const fs = require('fs');
const net = require('net');

const FETCH_IMPL = globalThis.fetch ? globalThis.fetch.bind(globalThis) : require('node-fetch');

const IPV4_PRIVATE_CIDRS = [
    '0.0.0.0/8',
    '10.0.0.0/8',
    '100.64.0.0/10',
    '127.0.0.0/8',
    '169.254.0.0/16',
    '172.16.0.0/12',
    '192.0.0.0/24',
    '192.0.2.0/24',
    '192.88.99.0/24',
    '192.168.0.0/16',
    '198.18.0.0/15',
    '198.51.100.0/24',
    '203.0.113.0/24',
    '224.0.0.0/4',
    '240.0.0.0/4',
    '255.255.255.255/32'
];

const IPV6_PRIVATE_CIDRS = [
    '::/128',
    '::1/128',
    '::ffff:0:0/96',
    '64:ff9b:1::/48',
    '100::/64',
    '2001:db8::/32',
    'fc00::/7',
    'fe80::/10',
    'ff00::/8'
];

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_REDIRECTS = 5;

function stripZoneId(value) {
    const idx = value.indexOf('%');
    return idx === -1 ? value : value.slice(0, idx);
}

function parseIpv4(ip) {
    const parts = String(ip).split('.');
    if (parts.length !== 4) {return null;}
    let value = 0n;
    for (const part of parts) {
        if (part === '') {return null;}
        const num = Number(part);
        if (!Number.isInteger(num) || num < 0 || num > 255) {return null;}
        value = (value << 8n) + BigInt(num);
    }
    return value;
}

function expandIpv6(ip) {
    let input = stripZoneId(String(ip).toLowerCase());

    if (input.includes('.')) {
        const lastColon = input.lastIndexOf(':');
        if (lastColon === -1) {return null;}
        const ipv4Part = input.slice(lastColon + 1);
        const v4Value = parseIpv4(ipv4Part);
        if (v4Value == null) {return null;}
        const high = Number((v4Value >> 16n) & 0xffffn).toString(16);
        const low = Number(v4Value & 0xffffn).toString(16);
        input = `${input.slice(0, lastColon)}:${high}:${low}`;
    }

    const parts = input.split('::');
    if (parts.length > 2) {return null;}

    const left = parts[0] ? parts[0].split(':').filter(Boolean) : [];
    const right = parts.length === 2 && parts[1] ? parts[1].split(':').filter(Boolean) : [];
    const missing = 8 - (left.length + right.length);
    if (missing < 0) {return null;}

    const full = [...left, ...Array(missing).fill('0'), ...right];
    if (full.length !== 8) {return null;}

    return full;
}

function parseIpv6(ip) {
    const groups = expandIpv6(ip);
    if (!groups) {return null;}

    let value = 0n;
    for (const group of groups) {
        if (!/^[0-9a-f]{1,4}$/i.test(group)) {return null;}
        value = (value << 16n) + BigInt(parseInt(group, 16));
    }
    return value;
}

function parseIp(ip) {
    if (!ip) {return null;}
    const normalized = stripZoneId(String(ip));
    const v4 = parseIpv4(normalized);
    if (v4 != null) {
        return { version: 4, value: v4 };
    }
    const v6 = parseIpv6(normalized);
    if (v6 == null) {return null;}
    const upper96 = v6 >> 32n;
    const isMappedV4 = upper96 === 0xffffn;
    return {
        version: 6,
        value: v6,
        isMappedV4,
        v4Value: isMappedV4 ? (v6 & 0xffffffffn) : null
    };
}

function parseCidr(cidr) {
    if (!cidr) {return null;}
    const [base, maskRaw] = String(cidr).split('/');
    const info = parseIp(base);
    if (!info) {return null;}
    const maxBits = info.version === 4 ? 32 : 128;
    const maskBits = maskRaw === undefined || maskRaw === ''
        ? maxBits
        : Number(maskRaw);
    if (!Number.isInteger(maskBits) || maskBits < 0 || maskBits > maxBits) {return null;}
    return { version: info.version, base: info.value, maskBits };
}

function maskFor(bits, totalBits) {
    if (bits === 0) {return 0n;}
    return ((1n << BigInt(bits)) - 1n) << BigInt(totalBits - bits);
}

function isValueInRange(value, cidrInfo, totalBits) {
    const mask = maskFor(cidrInfo.maskBits, totalBits);
    return (value & mask) === (cidrInfo.base & mask);
}

function isIpInCidr(ip, cidr) {
    const ipInfo = parseIp(ip);
    const cidrInfo = parseCidr(cidr);
    if (!ipInfo || !cidrInfo) {return false;}
    if (ipInfo.version === cidrInfo.version) {
        const bits = ipInfo.version === 4 ? 32 : 128;
        return isValueInRange(ipInfo.value, cidrInfo, bits);
    }
    if (ipInfo.version === 6 && cidrInfo.version === 4 && ipInfo.isMappedV4) {
        return isValueInRange(ipInfo.v4Value, cidrInfo, 32);
    }
    return false;
}

function isIpInRanges(ip, ranges) {
    if (!ip || !Array.isArray(ranges) || ranges.length === 0) {return false;}
    return ranges.some(range => isIpInCidr(ip, range));
}

function isPrivateIp(ip) {
    return isIpInRanges(ip, IPV4_PRIVATE_CIDRS) || isIpInRanges(ip, IPV6_PRIVATE_CIDRS);
}

function isPublicIp(ip) {
    const info = parseIp(ip);
    if (!info) {return false;}
    return !isPrivateIp(ip);
}

function parseIpRangesFromFile(filePath) {
    if (!filePath || !fs.existsSync(filePath)) {return [];}
    const raw = fs.readFileSync(filePath, 'utf8');
    const ranges = new Set();
    for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {continue;}
        const match = trimmed.match(/(?:allow|deny)\s+([0-9a-fA-F:.]+\/\d+)/);
        if (match) {
            ranges.add(match[1]);
        } else if (/^[0-9a-fA-F:.]+\/\d+$/.test(trimmed)) {
            ranges.add(trimmed);
        }
    }
    return Array.from(ranges);
}

function parseIpRangesFromEnv(value) {
    if (!value) {return [];}
    return String(value)
        .split(/[\s,]+/)
        .map(entry => entry.trim())
        .filter(Boolean);
}

function getCloudflareIpRanges() {
    const envRanges = parseIpRangesFromEnv(process.env.CLOUDFLARE_IP_RANGES);
    if (envRanges.length) {return envRanges;}
    const envFile = process.env.CLOUDFLARE_IPS_FILE;
    if (envFile) {
        return parseIpRangesFromFile(envFile);
    }
    return parseIpRangesFromFile('/etc/nginx/cloudflare-ips.conf');
}

function getTrustedProxyRanges() {
    const ranges = new Set([
        '127.0.0.1/32',
        '::1/128'
    ]);

    for (const entry of parseIpRangesFromEnv(process.env.TRUSTED_PROXY_IPS)) {
        ranges.add(entry);
    }

    const cloudflareRanges = getCloudflareIpRanges();
    if (cloudflareRanges.length) {
        for (const entry of cloudflareRanges) {
            ranges.add(entry);
        }
    }

    return Array.from(ranges);
}

async function resolveHostAddresses(hostname) {
    if (!hostname) {return [];}
    const ipVersion = net.isIP(hostname);
    if (ipVersion) {
        return [{ address: hostname, family: ipVersion }];
    }
    const results = await dns.lookup(hostname, { all: true, verbatim: true });
    return results.map(result => ({ address: result.address, family: result.family }));
}

function isHostAllowed(hostname, allowHosts) {
    if (!allowHosts || allowHosts.length === 0) {return true;}
    const host = hostname.toLowerCase();
    return allowHosts.some(entry => {
        const rule = entry.toLowerCase();
        if (host === rule) {return true;}
        if (rule.startsWith('.')) {return host.endsWith(rule);}
        return host.endsWith(`.${rule}`);
    });
}

async function assertPublicHttpUrl(rawUrl, options = {}) {
    const { allowHttp = true, allowHttps = true, allowPrivate = false, allowHosts } = options;
    let url;
    try {
        url = new URL(rawUrl);
    } catch {
        throw new Error('Invalid URL');
    }

    const protocol = url.protocol;
    if ((protocol === 'http:' && !allowHttp) || (protocol === 'https:' && !allowHttps)) {
        throw new Error('Unsupported URL protocol');
    }
    if (!['http:', 'https:'].includes(protocol)) {
        throw new Error('Unsupported URL protocol');
    }

    const hostname = url.hostname;
    if (!hostname) {throw new Error('Invalid URL host');}
    if (hostname.toLowerCase() === 'localhost') {
        throw new Error('Localhost is not allowed');
    }

    if (!isHostAllowed(hostname, allowHosts)) {
        throw new Error('Host not allowed');
    }

    if (!allowPrivate) {
        const addresses = await resolveHostAddresses(hostname);
        if (!addresses.length) {
            throw new Error('DNS lookup failed');
        }
        for (const addr of addresses) {
            if (!isPublicIp(addr.address)) {
                throw new Error('Private IPs are not allowed');
            }
        }
    }

    return url.toString();
}

async function safeFetch(rawUrl, options = {}, policy = {}) {
    const {
        maxRedirects = DEFAULT_MAX_REDIRECTS,
        timeoutMs = DEFAULT_TIMEOUT_MS,
        allowHttp = true,
        allowHttps = true,
        allowPrivate = false,
        allowHosts
    } = policy;

    let url = rawUrl;
    let redirectCount = 0;

    while (true) {
        const validated = await assertPublicHttpUrl(url, { allowHttp, allowHttps, allowPrivate, allowHosts });
        const controller = timeoutMs ? new AbortController() : null;
        let timeoutId;
        if (controller) {
            timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        }
        let response;
        try {
            response = await FETCH_IMPL(validated, {
                ...options,
                redirect: 'manual',
                signal: controller ? controller.signal : undefined
            });
        } finally {
            if (timeoutId) {clearTimeout(timeoutId);}
        }

        const location = response.headers.get('location');
        if (location && response.status >= 300 && response.status < 400) {
            if (redirectCount >= maxRedirects) {
                throw new Error('Too many redirects');
            }
            try { response.body?.destroy?.(); } catch {}
            url = new URL(location, validated).toString();
            redirectCount += 1;
            continue;
        }

        return response;
    }
}

async function readResponseBuffer(response, maxBytes) {
    if (!response.body) {return Buffer.alloc(0);}

    const chunks = [];
    let received = 0;
    for await (const chunk of response.body) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        received += buf.length;
        if (maxBytes && received > maxBytes) {
            const err = new Error('Response too large');
            err.code = 'RESPONSE_TOO_LARGE';
            throw err;
        }
        chunks.push(buf);
    }
    return Buffer.concat(chunks);
}

async function fetchBuffer(url, options = {}, policy = {}) {
    const response = await safeFetch(url, options, policy);
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    const contentLength = Number(response.headers.get('content-length') || 0);

    if (policy.maxBytes && contentLength && contentLength > policy.maxBytes) {
        return { tooLarge: true, contentType, url: response.url };
    }

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    try {
        const buffer = await readResponseBuffer(response, policy.maxBytes);
        return { buffer, contentType, url: response.url };
    } catch (error) {
        if (error.code === 'RESPONSE_TOO_LARGE') {
            return { tooLarge: true, contentType, url: response.url };
        }
        throw error;
    }
}

module.exports = {
    assertPublicHttpUrl,
    fetchBuffer,
    getCloudflareIpRanges,
    getTrustedProxyRanges,
    isIpInRanges,
    isPrivateIp,
    isPublicIp,
    safeFetch
};

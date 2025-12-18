/**
 * Cloudflare Domain Management
 * Auto-configure domain for Jarvis on Render or Selfhost
 * 
 * Features:
 * - Auto-register custom domain with Cloudflare
 * - Manage DNS records for the domain
 * - SSL certificate management
 * - Works for both Render and Selfhost deployments
 */

'use strict';

// ============================================================================
// CONFIGURATION
// ============================================================================

const CLOUDFLARE_API_BASE = 'https://api.cloudflare.com/client/v4';

function getConfig() {
    return {
        apiToken: process.env.CLOUDFLARE_API_TOKEN || '',
        email: process.env.CLOUDFLARE_EMAIL || '',
        globalApiKey: process.env.CLOUDFLARE_GLOBAL_API_KEY || '',
        accountId: process.env.CLOUDFLARE_ACCOUNT_ID || '',
        zoneId: process.env.CLOUDFLARE_ZONE_ID || '',
        domain: process.env.JARVIS_DOMAIN || '',
        publicBaseUrl: process.env.PUBLIC_BASE_URL || '',
        renderExternalUrl: process.env.RENDER_EXTERNAL_URL || '',
        deployTarget: (process.env.DEPLOY_TARGET || 'render').toLowerCase()
    };
}

// ============================================================================
// AUTH HELPERS
// ============================================================================

function getAuthHeaders() {
    const config = getConfig();
    
    // Prefer API token
    if (config.apiToken) {
        return { Authorization: `Bearer ${config.apiToken}` };
    }
    
    // Fallback to email + global key
    if (config.email && config.globalApiKey) {
        return {
            'X-Auth-Email': config.email,
            'X-Auth-Key': config.globalApiKey
        };
    }
    
    return null;
}

async function cfFetch(endpoint, options = {}) {
    const authHeaders = getAuthHeaders();
    if (!authHeaders) {
        throw new Error('Cloudflare credentials not configured');
    }
    
    const url = endpoint.startsWith('http') ? endpoint : `${CLOUDFLARE_API_BASE}${endpoint}`;
    
    const response = await fetch(url, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...authHeaders,
            ...(options.headers || {})
        }
    });
    
    const data = await response.json().catch(() => ({}));
    
    if (!response.ok) {
        const errorMsg = data.errors?.[0]?.message || response.statusText;
        throw new Error(`Cloudflare API error: ${errorMsg}`);
    }
    
    return data;
}

// ============================================================================
// ZONE OPERATIONS
// ============================================================================

/**
 * Get zone details
 */
async function getZone(zoneId = null) {
    const config = getConfig();
    const id = zoneId || config.zoneId;
    
    if (!id) {
        throw new Error('Zone ID not configured');
    }
    
    const data = await cfFetch(`/zones/${id}`);
    return data.result;
}

/**
 * List zones for account
 */
async function listZones() {
    const config = getConfig();
    const data = await cfFetch(`/zones?account.id=${config.accountId}`);
    return data.result || [];
}

/**
 * Find zone by domain name
 */
async function findZoneByDomain(domain) {
    const data = await cfFetch(`/zones?name=${domain}`);
    return data.result?.[0] || null;
}

// ============================================================================
// DNS OPERATIONS
// ============================================================================

/**
 * List DNS records for zone
 */
async function listDnsRecords(zoneId = null) {
    const config = getConfig();
    const id = zoneId || config.zoneId;
    
    const data = await cfFetch(`/zones/${id}/dns_records`);
    return data.result || [];
}

/**
 * Get DNS record by name and type
 */
async function getDnsRecord(name, type = 'A', zoneId = null) {
    const config = getConfig();
    const id = zoneId || config.zoneId;
    
    const data = await cfFetch(`/zones/${id}/dns_records?name=${name}&type=${type}`);
    return data.result?.[0] || null;
}

/**
 * Create DNS record
 */
async function createDnsRecord(record, zoneId = null) {
    const config = getConfig();
    const id = zoneId || config.zoneId;
    
    const data = await cfFetch(`/zones/${id}/dns_records`, {
        method: 'POST',
        body: JSON.stringify(record)
    });
    
    return data.result;
}

/**
 * Update DNS record
 */
async function updateDnsRecord(recordId, record, zoneId = null) {
    const config = getConfig();
    const id = zoneId || config.zoneId;
    
    const data = await cfFetch(`/zones/${id}/dns_records/${recordId}`, {
        method: 'PATCH',
        body: JSON.stringify(record)
    });
    
    return data.result;
}

/**
 * Delete DNS record
 */
async function deleteDnsRecord(recordId, zoneId = null) {
    const config = getConfig();
    const id = zoneId || config.zoneId;
    
    await cfFetch(`/zones/${id}/dns_records/${recordId}`, {
        method: 'DELETE'
    });
    
    return true;
}

/**
 * Upsert DNS record (create or update)
 */
async function upsertDnsRecord(name, type, content, options = {}, zoneId = null) {
    const existing = await getDnsRecord(name, type, zoneId);
    
    const record = {
        type,
        name,
        content,
        ttl: options.ttl || 1, // 1 = auto
        proxied: options.proxied !== false, // Default to proxied
        ...options
    };
    
    if (existing) {
        return updateDnsRecord(existing.id, record, zoneId);
    } else {
        return createDnsRecord(record, zoneId);
    }
}

// ============================================================================
// RENDER INTEGRATION
// ============================================================================

/**
 * Configure domain for Render deployment
 * Points the domain to Render's servers
 */
async function configureForRender(subdomain = null) {
    const config = getConfig();
    const domain = config.domain;
    
    if (!domain) {
        throw new Error('JARVIS_DOMAIN not configured');
    }
    
    // Render uses CNAME records
    // Main domain needs to point to render's onrender.com
    const renderHost = config.renderExternalUrl
        ? new URL(config.renderExternalUrl).hostname
        : null;
    
    if (!renderHost) {
        throw new Error('RENDER_EXTERNAL_URL not configured');
    }
    
    const records = [];
    
    // Root domain - use CNAME flattening (Cloudflare supports this)
    records.push(await upsertDnsRecord(
        domain,
        'CNAME',
        renderHost,
        { proxied: true }
    ));
    
    // www subdomain
    records.push(await upsertDnsRecord(
        `www.${domain}`,
        'CNAME',
        renderHost,
        { proxied: true }
    ));
    
    // Custom subdomain if specified
    if (subdomain) {
        records.push(await upsertDnsRecord(
            `${subdomain}.${domain}`,
            'CNAME',
            renderHost,
            { proxied: true }
        ));
    }
    
    return {
        success: true,
        domain,
        target: renderHost,
        records
    };
}

// ============================================================================
// SELFHOST INTEGRATION
// ============================================================================

/**
 * Configure domain for selfhost deployment
 * Points the domain to a specific IP or hostname
 */
async function configureForSelfhost(target, subdomain = null) {
    const config = getConfig();
    const domain = config.domain;
    
    if (!domain) {
        throw new Error('JARVIS_DOMAIN not configured');
    }
    
    if (!target) {
        throw new Error('Target IP or hostname required');
    }
    
    // Determine if target is IP or hostname
    const isIp = /^(\d{1,3}\.){3}\d{1,3}$/.test(target);
    const recordType = isIp ? 'A' : 'CNAME';
    
    const records = [];
    
    // Root domain
    records.push(await upsertDnsRecord(
        domain,
        recordType,
        target,
        { proxied: true }
    ));
    
    // www subdomain
    records.push(await upsertDnsRecord(
        `www.${domain}`,
        recordType,
        target,
        { proxied: true }
    ));
    
    // Custom subdomain if specified
    if (subdomain) {
        records.push(await upsertDnsRecord(
            `${subdomain}.${domain}`,
            recordType,
            target,
            { proxied: true }
        ));
    }
    
    return {
        success: true,
        domain,
        target,
        recordType,
        records
    };
}

// ============================================================================
// AUTO-CONFIGURE
// ============================================================================

/**
 * Auto-detect deployment mode and configure domain
 */
async function autoConfigure(options = {}) {
    const config = getConfig();
    
    if (!config.zoneId && !config.domain) {
        return { success: false, error: 'No domain configuration found' };
    }
    
    // If no zone ID but have domain, try to find zone
    if (!config.zoneId && config.domain) {
        const zone = await findZoneByDomain(config.domain);
        if (zone) {
            console.log(`[CloudflareDomain] Found zone for ${config.domain}: ${zone.id}`);
            // Note: This doesn't persist, would need to be saved
        }
    }
    
    try {
        if (config.deployTarget === 'render') {
            return await configureForRender(options.subdomain);
        } else if (config.deployTarget === 'selfhost') {
            const target = options.target || config.publicBaseUrl;
            if (!target) {
                return { 
                    success: false, 
                    error: 'Selfhost requires PUBLIC_BASE_URL or target option' 
                };
            }
            // Extract hostname from URL if needed
            const hostname = target.startsWith('http') 
                ? new URL(target).hostname 
                : target;
            return await configureForSelfhost(hostname, options.subdomain);
        } else {
            return { success: false, error: `Unknown deploy target: ${config.deployTarget}` };
        }
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// ============================================================================
// SSL / ORIGIN CERTIFICATES
// ============================================================================

/**
 * Get zone SSL settings
 */
async function getSSLSettings(zoneId = null) {
    const config = getConfig();
    const id = zoneId || config.zoneId;
    
    const data = await cfFetch(`/zones/${id}/settings/ssl`);
    return data.result;
}

/**
 * Set SSL mode (off, flexible, full, strict)
 */
async function setSSLMode(mode, zoneId = null) {
    const config = getConfig();
    const id = zoneId || config.zoneId;
    
    const validModes = ['off', 'flexible', 'full', 'strict'];
    if (!validModes.includes(mode)) {
        throw new Error(`Invalid SSL mode. Must be one of: ${validModes.join(', ')}`);
    }
    
    const data = await cfFetch(`/zones/${id}/settings/ssl`, {
        method: 'PATCH',
        body: JSON.stringify({ value: mode })
    });
    
    return data.result;
}

/**
 * Enable "Always Use HTTPS"
 */
async function enableAlwaysHttps(zoneId = null) {
    const config = getConfig();
    const id = zoneId || config.zoneId;
    
    const data = await cfFetch(`/zones/${id}/settings/always_use_https`, {
        method: 'PATCH',
        body: JSON.stringify({ value: 'on' })
    });
    
    return data.result;
}

// ============================================================================
// DIAGNOSTICS
// ============================================================================

/**
 * Get domain configuration status
 */
async function getDomainStatus() {
    const config = getConfig();
    const status = {
        configured: false,
        domain: config.domain,
        zoneId: config.zoneId,
        deployTarget: config.deployTarget,
        hasCredentials: !!getAuthHeaders(),
        zone: null,
        dnsRecords: [],
        ssl: null,
        errors: []
    };
    
    if (!config.domain && !config.zoneId) {
        status.errors.push('No domain or zone ID configured');
        return status;
    }
    
    if (!getAuthHeaders()) {
        status.errors.push('Cloudflare credentials not configured');
        return status;
    }
    
    try {
        if (config.zoneId) {
            status.zone = await getZone();
            status.configured = true;
        }
    } catch (e) {
        status.errors.push(`Zone error: ${e.message}`);
    }
    
    try {
        if (config.zoneId) {
            status.dnsRecords = await listDnsRecords();
        }
    } catch (e) {
        status.errors.push(`DNS error: ${e.message}`);
    }
    
    try {
        if (config.zoneId) {
            status.ssl = await getSSLSettings();
        }
    } catch (e) {
        status.errors.push(`SSL error: ${e.message}`);
    }
    
    return status;
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
    // Config
    getConfig,
    
    // Zone operations
    getZone,
    listZones,
    findZoneByDomain,
    
    // DNS operations
    listDnsRecords,
    getDnsRecord,
    createDnsRecord,
    updateDnsRecord,
    deleteDnsRecord,
    upsertDnsRecord,
    
    // Deployment configuration
    configureForRender,
    configureForSelfhost,
    autoConfigure,
    
    // SSL
    getSSLSettings,
    setSSLMode,
    enableAlwaysHttps,
    
    // Diagnostics
    getDomainStatus
};

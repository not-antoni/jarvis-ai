/**
 * Cloudflare Domain Management
 * Auto-configure domain for Jarvis on Render or Selfhost
 * 
 * Features:
 * - Auto-register custom domain with Cloudflare
 * - Manage DNS records for the domain
 * - SSL certificate management
 * - Works for both Render and Selfhost deployments
 * - Caches config to avoid unnecessary API calls on restart
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

// ============================================================================
// CONFIGURATION
// ============================================================================

const CLOUDFLARE_API_BASE = 'https://api.cloudflare.com/client/v4';
const CONFIG_CACHE_FILE = path.join(process.cwd(), 'data', 'cloudflare-config.json');
const NGINX_CONFIG_FILE = '/etc/nginx/sites-available/jarvis';
const SSL_CERT_DIR = '/etc/ssl/cloudflare';
const SSL_CACHE_FILE = path.join(process.cwd(), 'data', 'ssl-config.json');

// ============================================================================
// NGINX AUTO-SETUP
// ============================================================================

/**
 * Check if a command exists
 */
function commandExists(cmd) {
    try {
        const result = spawnSync('which', [cmd], { encoding: 'utf8', timeout: 5000 });
        return result.status === 0 && result.stdout.trim().length > 0;
    } catch {
        return false;
    }
}

/**
 * Check if running as root or can sudo
 */
function canSudo() {
    try {
        execSync('sudo -n true 2>/dev/null', { encoding: 'utf8', timeout: 5000 });
        return true;
    } catch {
        return false;
    }
}

/**
 * Generate Nginx config for domain (with optional SSL)
 */
function generateNginxConfig(domain, ssl = false) {
    const redirectBlock = ssl ? `
server {
    listen 80;
    server_name ${domain} www.${domain};
    return 301 https://$host$request_uri;
}
` : '';

    return `${redirectBlock}server {
    listen ${ssl ? '443 ssl http2' : '80'};
    server_name ${domain} www.${domain};
${ssl ? `
    ssl_certificate /etc/ssl/cloudflare/${domain}.pem;
    ssl_certificate_key /etc/ssl/cloudflare/${domain}.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;
    ssl_prefer_server_ciphers off;
` : ''}
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
        proxy_buffering off;
    }
}`;
}

/**
 * Check if Nginx is configured for our domain
 */
function isNginxConfigured(domain) {
    try {
        if (!fs.existsSync(NGINX_CONFIG_FILE)) {
            return false;
        }
        const content = fs.readFileSync(NGINX_CONFIG_FILE, 'utf8');
        return content.includes(domain);
    } catch {
        return false;
    }
}

/**
 * Check if SSL certificates exist for domain
 */
function sslCertsExist(domain) {
    const certPath = `${SSL_CERT_DIR}/${domain}.pem`;
    const keyPath = `${SSL_CERT_DIR}/${domain}.key`;
    try {
        return fs.existsSync(certPath) && fs.existsSync(keyPath);
    } catch {
        // Check with sudo
        try {
            execSync(`sudo test -f ${certPath} && sudo test -f ${keyPath}`, { encoding: 'utf8' });
            return true;
        } catch {
            return false;
        }
    }
}

/**
 * Load SSL config cache
 */
function loadSslCache() {
    try {
        if (fs.existsSync(SSL_CACHE_FILE)) {
            return JSON.parse(fs.readFileSync(SSL_CACHE_FILE, 'utf8'));
        }
    } catch {
        // Ignore
    }
    return null;
}

/**
 * Save SSL config cache
 */
function saveSslCache(config) {
    try {
        const dir = path.dirname(SSL_CACHE_FILE);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(SSL_CACHE_FILE, JSON.stringify(config, null, 2));
    } catch {
        // Ignore
    }
}

/**
 * Create Cloudflare Origin Certificate via API
 */
async function createOriginCertificate(domain) {
    const config = getConfig();

    if (!config.zoneId) {
        return { success: false, error: 'CLOUDFLARE_ZONE_ID required for SSL' };
    }

    try {
        const response = await cfFetch('/certificates', {
            method: 'POST',
            body: JSON.stringify({
                hostnames: [domain, `*.${domain}`],
                requested_validity: 5475, // 15 years
                request_type: 'origin-rsa',
                csr: null
            })
        });

        return {
            success: true,
            certificate: response.result.certificate,
            privateKey: response.result.private_key,
            expiresOn: response.result.expires_on
        };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

/**
 * Save SSL certificates to disk
 */
async function saveSslCertificates(domain, certificate, privateKey) {
    if (!canSudo()) {
        return { success: false, error: 'Cannot run sudo to save certificates' };
    }

    try {
        // Create SSL directory
        execSync(`sudo mkdir -p ${SSL_CERT_DIR}`, { encoding: 'utf8' });

        // Write certificate
        const certTmp = '/tmp/jarvis-ssl-cert.pem';
        const keyTmp = '/tmp/jarvis-ssl-key.pem';

        fs.writeFileSync(certTmp, certificate);
        fs.writeFileSync(keyTmp, privateKey);

        execSync(`sudo cp ${certTmp} ${SSL_CERT_DIR}/${domain}.pem`, { encoding: 'utf8' });
        execSync(`sudo cp ${keyTmp} ${SSL_CERT_DIR}/${domain}.key`, { encoding: 'utf8' });
        execSync(`sudo chmod 600 ${SSL_CERT_DIR}/${domain}.key`, { encoding: 'utf8' });
        execSync(`sudo chmod 644 ${SSL_CERT_DIR}/${domain}.pem`, { encoding: 'utf8' });

        // Cleanup temp files
        fs.unlinkSync(certTmp);
        fs.unlinkSync(keyTmp);

        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

/**
 * Auto-setup SSL with Cloudflare Origin Certificate
 */
async function autoSetupSsl(domain) {
    if (!domain) {
        return { success: false, error: 'No domain provided' };
    }

    // Check if certs already exist
    if (sslCertsExist(domain)) {
        return { success: true, cached: true, message: 'SSL certificates already exist' };
    }

    // Check cache
    const cached = loadSslCache();
    if (cached && cached.domain === domain && cached.certificate && cached.privateKey) {
        // Try to save cached certs
        const saveResult = await saveSslCertificates(domain, cached.certificate, cached.privateKey);
        if (saveResult.success) {
            return { success: true, fromCache: true };
        }
    }

    // Create new certificate via Cloudflare API
    const certResult = await createOriginCertificate(domain);
    if (!certResult.success) {
        return certResult;
    }

    // Save certificates
    const saveResult = await saveSslCertificates(domain, certResult.certificate, certResult.privateKey);
    if (!saveResult.success) {
        return saveResult;
    }

    // Cache the certificates
    saveSslCache({
        domain,
        certificate: certResult.certificate,
        privateKey: certResult.privateKey,
        expiresOn: certResult.expiresOn,
        createdAt: new Date().toISOString()
    });

    return { success: true, domain, expiresOn: certResult.expiresOn };
}

/**
 * Auto-setup Nginx reverse proxy (with optional SSL)
 */
async function autoSetupNginx(domain, enableSsl = true) {
    if (!domain) {
        return { success: false, error: 'No domain provided' };
    }

    // Check if we can run sudo commands
    if (!canSudo()) {
        return {
            success: false,
            error: 'Cannot run sudo. Run manually: sudo apt install nginx && setup config',
            manual: true
        };
    }

    // Check if SSL should be enabled
    let useSSL = false;
    if (enableSsl) {
        const sslResult = await autoSetupSsl(domain);
        if (sslResult.success) {
            useSSL = true;
            if (!sslResult.cached && !sslResult.fromCache) {
                console.log(`[SSL] ✅ Created Origin Certificate for ${domain}`);
            }
        } else if (process.env.VERBOSE_LOGS === 'true') {
            console.log(`[SSL] ⚠️ ${sslResult.error} - falling back to HTTP`);
        }
    }

    // Check if already configured with correct SSL state
    const currentConfig = isNginxConfigured(domain);
    const hasSSLConfig = currentConfig && fs.existsSync(NGINX_CONFIG_FILE) &&
        fs.readFileSync(NGINX_CONFIG_FILE, 'utf8').includes('ssl_certificate');

    if (currentConfig && hasSSLConfig === useSSL) {
        return { success: true, cached: true, ssl: useSSL, message: 'Nginx already configured' };
    }

    try {
        // Install Nginx if not present
        if (!commandExists('nginx')) {
            console.log('[Nginx] Installing nginx...');
            execSync('sudo apt-get update && sudo apt-get install -y nginx', {
                encoding: 'utf8',
                timeout: 120000,
                stdio: 'pipe'
            });
        }

        // Generate and write config
        const config = generateNginxConfig(domain, useSSL);
        const tempFile = '/tmp/jarvis-nginx.conf';
        fs.writeFileSync(tempFile, config);

        execSync(`sudo cp ${tempFile} ${NGINX_CONFIG_FILE}`, { encoding: 'utf8' });
        execSync('sudo ln -sf /etc/nginx/sites-available/jarvis /etc/nginx/sites-enabled/', { encoding: 'utf8' });
        execSync('sudo rm -f /etc/nginx/sites-enabled/default', { encoding: 'utf8' });

        // Test and restart
        execSync('sudo nginx -t', { encoding: 'utf8' });
        execSync('sudo systemctl restart nginx', { encoding: 'utf8' });
        execSync('sudo systemctl enable nginx', { encoding: 'utf8' });

        const protocol = useSSL ? 'HTTPS' : 'HTTP';
        console.log(`[Nginx] ✅ Configured (${protocol}): ${domain} → localhost:3000`);
        return { success: true, domain, ssl: useSSL };

    } catch (err) {
        return { success: false, error: err.message };
    }
}

/**
 * Load cached Cloudflare configuration
 */
function loadCachedConfig() {
    try {
        if (fs.existsSync(CONFIG_CACHE_FILE)) {
            return JSON.parse(fs.readFileSync(CONFIG_CACHE_FILE, 'utf8'));
        }
    } catch {
        // Ignore errors
    }
    return null;
}

/**
 * Save Cloudflare configuration to cache
 */
function saveCachedConfig(config) {
    try {
        const dir = path.dirname(CONFIG_CACHE_FILE);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(CONFIG_CACHE_FILE, JSON.stringify(config, null, 2));
    } catch (err) {
        console.warn('[CloudflareDomain] Failed to save config cache:', err.message);
    }
}

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
 * Detect if running on Render (checks for Render-specific env vars)
 */
function isRunningOnRender() {
    return !!(process.env.RENDER || process.env.RENDER_EXTERNAL_URL || process.env.RENDER_SERVICE_ID);
}

/**
 * Extract hostname from URL or return as-is if already a hostname/IP
 */
function extractHostname(urlOrHost) {
    if (!urlOrHost) { return null; }

    // If it's already just an IP address, return it
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(urlOrHost)) {
        return urlOrHost;
    }

    // If it's a hostname without protocol, return it
    if (!urlOrHost.includes('://')) {
        // Remove port if present
        return urlOrHost.split(':')[0];
    }

    // Parse as URL
    try {
        return new URL(urlOrHost).hostname;
    } catch {
        return null;
    }
}

/**
 * Detect the best target for DNS configuration
 */
function detectTarget() {
    const config = getConfig();

    // If on Render, use Render's external URL
    if (isRunningOnRender() && config.renderExternalUrl) {
        const hostname = extractHostname(config.renderExternalUrl);
        if (hostname && hostname !== config.domain) {
            return { mode: 'render', target: hostname };
        }
    }

    // If PUBLIC_BASE_URL is set, use that - but NOT if it's the same as our domain
    if (config.publicBaseUrl) {
        const hostname = extractHostname(config.publicBaseUrl);
        // Skip if hostname matches domain (would cause self-reference CNAME error)
        if (hostname && hostname !== config.domain && !hostname.endsWith(`.${config.domain}`)) {
            return { mode: 'selfhost', target: hostname };
        }
    }

    // Try to detect public IP (most reliable for selfhost)
    try {
        const { execSync } = require('child_process');
        const ip = execSync('curl -s --max-time 3 ifconfig.me', { encoding: 'utf8' }).trim();
        if (ip && /^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
            return {
                mode: 'selfhost',
                target: ip
            };
        }
    } catch {
        // Ignore
    }

    return null;
}

/**
 * Auto-detect deployment mode and configure domain
 * Supports: render, selfhost, hybrid (auto-detect)
 * Caches config to skip unnecessary API calls on restart
 */
async function autoConfigure(options = {}) {
    const config = getConfig();
    const forceReconfigure = options.force === true;

    if (!config.zoneId && !config.domain) {
        return { success: false, error: 'No domain configuration found' };
    }

    // Detect target first
    const detected = detectTarget();
    if (!detected) {
        return {
            success: false,
            error: 'Could not detect target. Set PUBLIC_BASE_URL, RENDER_EXTERNAL_URL, or ensure internet access.'
        };
    }

    // Check cached config - skip if already configured with same target
    const cached = loadCachedConfig();
    if (!forceReconfigure && cached && cached.target === detected.target && cached.domain === config.domain) {
        console.log(`[CloudflareDomain] Already configured: ${cached.domain} → ${cached.target} (cached)`);
        return { success: true, cached: true, ...cached };
    }

    // If no zone ID but have domain, try to find zone
    if (!config.zoneId && config.domain) {
        const zone = await findZoneByDomain(config.domain);
        if (zone) {
            console.log(`[CloudflareDomain] Found zone for ${config.domain}: ${zone.id}`);
        }
    }

    try {
        console.log(`[CloudflareDomain] Configuring: ${config.domain} → ${detected.target} (${detected.mode})`);

        let result;
        if (detected.mode === 'render') {
            result = await configureForRender(options.subdomain);
        } else {
            result = await configureForSelfhost(detected.target, options.subdomain);
        }

        // Cache successful configuration
        if (result.success) {
            saveCachedConfig({
                domain: config.domain,
                target: detected.target,
                mode: detected.mode,
                configuredAt: new Date().toISOString()
            });
        }

        return result;
    } catch (error) {
        return { success: false, error: error.message };
    }
}

/**
 * Force reconfigure (bypass cache)
 */
async function forceReconfigure(options = {}) {
    return autoConfigure({ ...options, force: true });
}

/**
 * Clear cached configuration
 */
function clearConfigCache() {
    try {
        if (fs.existsSync(CONFIG_CACHE_FILE)) {
            fs.unlinkSync(CONFIG_CACHE_FILE);
            return true;
        }
    } catch {
        // Ignore
    }
    return false;
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
    forceReconfigure,

    // Cache management
    loadCachedConfig,
    saveCachedConfig,
    clearConfigCache,

    // Detection helpers
    isRunningOnRender,
    detectTarget,

    // Nginx auto-setup
    autoSetupNginx,
    isNginxConfigured,
    generateNginxConfig,

    // SSL auto-setup
    autoSetupSsl,
    sslCertsExist,
    createOriginCertificate,
    saveSslCertificates,

    // SSL
    getSSLSettings,
    setSSLMode,
    enableAlwaysHttps,

    // Diagnostics
    getDomainStatus
};

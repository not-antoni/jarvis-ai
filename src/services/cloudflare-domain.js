'use strict';
const fs = require('fs');
const path = require('path');
const { isIP } = require('node:net');
const { execSync, spawnSync } = require('child_process');
const CLOUDFLARE_API_BASE = 'https://api.cloudflare.com/client/v4';
const CONFIG_CACHE_FILE = path.join(process.cwd(), 'data', 'cloudflare-config.json');
const SSL_CERT_DIR = '/etc/ssl/cloudflare';
const SSL_CACHE_FILE = path.join(process.cwd(), 'data', 'ssl-config.json');
const isRhel = fs.existsSync('/etc/redhat-release') || fs.existsSync('/etc/amazon-linux-release');
const NGINX_DIR = isRhel ? '/etc/nginx/conf.d' : '/etc/nginx/sites-available';
const NGINX_ENABLED_DIR = isRhel ? null : '/etc/nginx/sites-enabled'; // RHEL includes conf.d automatically
const NGINX_CONFIG_FILE = isRhel ? path.join(NGINX_DIR, 'jarvis.conf') : path.join(NGINX_DIR, 'jarvis');
const NGINX_ALT_CONFIG_FILE = isRhel ? '/etc/nginx/sites-available/jarvis' : '/etc/nginx/conf.d/jarvis.conf';
const NGINX_ALT_ENABLED_FILE = isRhel ? '/etc/nginx/sites-enabled/jarvis' : null;
const CLOUDFLARE_IPS_FILE = '/etc/nginx/cloudflare-ips.conf';
function commandExists(cmd) {
    try {
        const result = spawnSync('which', [cmd], { encoding: 'utf8', timeout: 5000 });
        return result.status === 0 && result.stdout.trim().length > 0;
    } catch {
        return false;
    }
}
function getNginxHttp2Syntax() {
    try {
        const result = spawnSync('nginx', ['-v'], { encoding: 'utf8', timeout: 5000 });
        const versionStr = (result.stderr || result.stdout || '').match(/(\d+)\.(\d+)\.(\d+)/);
        if (!versionStr) { return { listen: '', directive: '    http2 on;\n' }; }
        const [, major, minor, patch] = versionStr.map(Number);
        const isNew = major > 1 || (major === 1 && minor > 25) || (major === 1 && minor === 25 && patch >= 1);
        return isNew
            ? { listen: '', directive: '    http2 on;\n' }
            : { listen: ' http2', directive: '' };
    } catch {
        // Default to old syntax (safer for Linux Mint / Ubuntu LTS)
        return { listen: ' http2', directive: '' };
    }
}
function normalizeHostTarget(value) {
    const trimmed = String(value || '').trim();
    if (!trimmed) { return ''; }
    if (trimmed.startsWith('[')) {
        const closingBracket = trimmed.indexOf(']');
        if (closingBracket > 0) {
            return trimmed.slice(1, closingBracket);
        }
    }
    return trimmed;
}
function detectDnsRecordType(target) {
    const normalizedTarget = normalizeHostTarget(target);
    const family = isIP(normalizedTarget);
    if (family === 4) { return 'A'; }
    if (family === 6) { return 'AAAA'; }
    return 'CNAME';
}
function canSudo() {
    try {
        execSync('sudo -n true 2>/dev/null', { encoding: 'utf8', timeout: 5000 });
        return true;
    } catch {
        return false;
    }
}
function generateCloudflareIpsConfig() {
    const ipv4 = [
        '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22',
        '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20',
        '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
        '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22'
    ];
    const ipv6 = [
        '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32',
        '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32'
    ];
    const allowLines = [...ipv4, ...ipv6].map(ip => `allow ${ip};`).join('\n');
    return `# Cloudflare IPs - Auto-generated fallback
# Updated: ${new Date().toISOString()}
# Run scripts/update-cloudflare-ips.sh to refresh from Cloudflare

${allowLines}

# Localhost for local testing
allow 127.0.0.1;
allow ::1;

# Deny all other IPs
deny all;
`;
}
function ensureCloudflareIpsConfig() {
    if (fs.existsSync(CLOUDFLARE_IPS_FILE)) {
        return true;
    }
    if (!canSudo()) {
        return false;
    }
    try {
        const config = generateCloudflareIpsConfig();
        const tempFile = '/tmp/cloudflare-ips.conf';
        fs.writeFileSync(tempFile, config);
        execSync(`sudo cp ${tempFile} ${CLOUDFLARE_IPS_FILE}`, { encoding: 'utf8' });
        execSync(`sudo chmod 644 ${CLOUDFLARE_IPS_FILE}`, { encoding: 'utf8' });
        return true;
    } catch (error) {
        console.warn('[Nginx] Failed to create Cloudflare IP allowlist:', error?.message || error);
        return false;
    }
}
function generateSystemdService(desc, projectRoot, execStart) {
    return `[Unit]\nDescription=${desc}\n\n[Service]\nType=oneshot\nWorkingDirectory=${projectRoot}\nExecStart=${execStart}\nUser=root\nStandardOutput=journal\nStandardError=journal\n`;
}
function generateSystemdTimer(desc, calendar) {
    return `[Unit]\nDescription=${desc}\n\n[Timer]\nOnCalendar=${calendar}\nPersistent=true\n\n[Install]\nWantedBy=timers.target\n`;
}
function generateCloudflareTimerService(projectRoot) {
    return generateSystemdService('Update Cloudflare IP ranges for nginx', projectRoot, `/usr/bin/env bash ${projectRoot}/scripts/update-cloudflare-ips.sh`);
}
function generateCloudflareTimerUnit() {
    return generateSystemdTimer('Weekly Cloudflare IP update for nginx', 'Sun *-*-* 03:00:00');
}
function writeUnitFile(targetPath, content) {
    const tempFile = `/tmp/${path.basename(targetPath)}`;
    fs.writeFileSync(tempFile, content);
    execSync(`sudo cp ${tempFile} ${targetPath}`, { encoding: 'utf8' });
    execSync(`sudo chmod 644 ${targetPath}`, { encoding: 'utf8' });
}
function ensureSystemdTimer(servicePath, timerPath, serviceContent, timerContent, timerName) {
    if (!commandExists('systemctl') || !canSudo()) { return false; }
    let serviceNeedsWrite = true;
    let timerNeedsWrite = true;
    try {
        if (fs.existsSync(servicePath)) {
            serviceNeedsWrite = fs.readFileSync(servicePath, 'utf8') !== serviceContent;
        }
        if (fs.existsSync(timerPath)) {
            timerNeedsWrite = fs.readFileSync(timerPath, 'utf8') !== timerContent;
        }
    } catch {
        serviceNeedsWrite = true;
        timerNeedsWrite = true;
    }
    if (serviceNeedsWrite) { writeUnitFile(servicePath, serviceContent); }
    if (timerNeedsWrite) { writeUnitFile(timerPath, timerContent); }
    execSync('sudo systemctl daemon-reload', { encoding: 'utf8' });
    execSync(`sudo systemctl enable ${timerName}`, { encoding: 'utf8' });
    execSync(`sudo systemctl start ${timerName}`, { encoding: 'utf8' });
}
function ensureCloudflareIpsTimer(projectRoot) {
    try {
        ensureSystemdTimer(
            '/etc/systemd/system/cloudflare-ips-update.service',
            '/etc/systemd/system/cloudflare-ips-update.timer',
            generateCloudflareTimerService(projectRoot),
            generateCloudflareTimerUnit(),
            'cloudflare-ips-update.timer'
        );
        execSync(`sudo chmod +x ${projectRoot}/scripts/update-cloudflare-ips.sh`, { encoding: 'utf8' });
        // Don't force an immediate run — let the timer handle it on schedule.
        // Starting the oneshot service right now can fail (network not ready, etc.)
        // and causes noisy errors on every bot restart.
        return true;
    } catch (error) {
        console.warn('[Nginx] Failed to configure Cloudflare IP update timer:', error?.message || error);
        return false;
    }
}
function generateNginxConfig(domain, ssl = false, cloudflareOnly = true) {
    const h2 = ssl ? getNginxHttp2Syntax() : { listen: '', directive: '' };
    const redirectBlock = ssl ? `
server {
    listen 80;
    server_name ${domain} www.${domain};
    return 301 https://$host$request_uri;
}
` : '';
    const cloudflareDefaultBlock = cloudflareOnly
        ? ssl
            ? `server {
    listen 80 default_server;
    listen [::]:80 default_server;
    listen 443 ssl${h2.listen} default_server;
    listen [::]:443 ssl${h2.listen} default_server;
${h2.directive}    server_name _;

    ssl_certificate /etc/ssl/cloudflare/${domain}.pem;
    ssl_certificate_key /etc/ssl/cloudflare/${domain}.key;

    return 444;
}

`
            : `server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;
    return 444;
}

`
        : '';
    const cloudflareAllowList = cloudflareOnly
        ? `
    include ${CLOUDFLARE_IPS_FILE};
`
        : '';
    return `${cloudflareDefaultBlock}${redirectBlock}server {
    listen ${ssl ? `443 ssl${h2.listen}` : '80'};
${h2.directive}    server_name ${domain} www.${domain};
${ssl ? `
    ssl_certificate /etc/ssl/cloudflare/${domain}.pem;
    ssl_certificate_key /etc/ssl/cloudflare/${domain}.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;
    ssl_prefer_server_ciphers off;
` : ''}
${cloudflareAllowList}
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
function sslCertsExist(domain) {
    const certPath = `${SSL_CERT_DIR}/${domain}.pem`;
    const keyPath = `${SSL_CERT_DIR}/${domain}.key`;
    try {
        return fs.existsSync(certPath) && fs.existsSync(keyPath);
    } catch {
        try {
            execSync(`sudo test -f ${certPath} && sudo test -f ${keyPath}`, { encoding: 'utf8' });
            return true;
        } catch {
            return false;
        }
    }
}
function loadJsonFile(filePath) {
    try { return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : null; } catch { return null; }
}
function saveJsonFile(filePath, data, warnLabel) {
    try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch (err) { if (warnLabel) { console.warn(`[${warnLabel}] Failed to save cache:`, err.message); } }
}
function loadSslCache() { return loadJsonFile(SSL_CACHE_FILE); }
function saveSslCache(config) { saveJsonFile(SSL_CACHE_FILE, config); }
async function createOriginCertificate(domain) {
    try {
        if (!/^[A-Za-z0-9.-]+$/.test(domain)) {
            return { success: false, error: 'Invalid domain for CSR generation' };
        }
        if (!commandExists('openssl')) {
            return { success: false, error: 'OpenSSL not available for CSR generation' };
        }
        const keyPath = `/tmp/jarvis-origin-${Date.now()}.key`;
        const csrPath = `/tmp/jarvis-origin-${Date.now()}.csr`;
        const csrArgs = [
            'req',
            '-new',
            '-newkey',
            'rsa:2048',
            '-nodes',
            '-keyout',
            keyPath,
            '-out',
            csrPath,
            '-subj',
            `/CN=${domain}`,
            '-addext',
            `subjectAltName=DNS:${domain},DNS:*.${domain}`
        ];
        const csrResult = spawnSync('openssl', csrArgs, { encoding: 'utf8' });
        if (csrResult.status !== 0) {
            return {
                success: false,
                error: `OpenSSL CSR generation failed: ${csrResult.stderr || csrResult.stdout || 'unknown error'}`
            };
        }
        const csr = fs.readFileSync(csrPath, 'utf8');
        const privateKey = fs.readFileSync(keyPath, 'utf8');
        fs.unlinkSync(csrPath);
        fs.unlinkSync(keyPath);
        const response = await cfFetch('/certificates', {
            method: 'POST',
            body: JSON.stringify({
                csr,
                hostnames: [domain, `*.${domain}`],
                requested_validity: 5475, // 15 years
                request_type: 'origin-rsa'
            })
        });
        return {
            success: true,
            certificate: response.result.certificate,
            privateKey,
            expiresOn: response.result.expires_on
        };
    } catch (err) {
        return { success: false, error: err.message };
    }
}
async function saveSslCertificates(domain, certificate, privateKey) {
    if (!canSudo()) {
        return { success: false, error: 'Cannot run sudo to save certificates' };
    }
    try {
        execSync(`sudo mkdir -p ${SSL_CERT_DIR}`, { encoding: 'utf8' });
        const certTmp = '/tmp/jarvis-ssl-cert.pem';
        const keyTmp = '/tmp/jarvis-ssl-key.pem';
        fs.writeFileSync(certTmp, certificate);
        fs.writeFileSync(keyTmp, privateKey);
        execSync(`sudo cp ${certTmp} ${SSL_CERT_DIR}/${domain}.pem`, { encoding: 'utf8' });
        execSync(`sudo cp ${keyTmp} ${SSL_CERT_DIR}/${domain}.key`, { encoding: 'utf8' });
        execSync(`sudo chmod 600 ${SSL_CERT_DIR}/${domain}.key`, { encoding: 'utf8' });
        execSync(`sudo chmod 644 ${SSL_CERT_DIR}/${domain}.pem`, { encoding: 'utf8' });
        fs.unlinkSync(certTmp);
        fs.unlinkSync(keyTmp);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}
async function autoSetupSsl(domain) {
    if (!domain) {
        return { success: false, error: 'No domain provided' };
    }
    if (sslCertsExist(domain)) {
        return { success: true, cached: true, message: 'SSL certificates already exist' };
    }
    const projectCertDir = path.join(process.cwd(), 'cloudflare');
    const siblingCertDir = path.join(process.cwd(), '../cloudflare');
    const pathsToCheck = [projectCertDir, siblingCertDir];
    for (const dir of pathsToCheck) {
        const certPath = path.join(dir, 'cert.pem');
        const keyPath = path.join(dir, 'key.pem');
        if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
            console.log(`[SSL] Found existing certificates in ${dir}. Importing...`);
            try {
                const certContent = fs.readFileSync(certPath, 'utf8');
                const keyContent = fs.readFileSync(keyPath, 'utf8');
                const saveResult = await saveSslCertificates(domain, certContent, keyContent);
                if (saveResult.success) {
                    return { success: true, message: 'Imported certificates from local folder' };
                }
            } catch (err) {
                console.warn('[SSL] Failed to import certificates:', err.message);
            }
        }
    }
    const cached = loadSslCache();
    if (cached && cached.domain === domain && cached.certificate && cached.privateKey) {
        const saveResult = await saveSslCertificates(domain, cached.certificate, cached.privateKey);
        if (saveResult.success) {
            return { success: true, fromCache: true };
        }
    }
    const certResult = await createOriginCertificate(domain);
    if (!certResult.success) {
        return certResult;
    }
    const saveResult = await saveSslCertificates(domain, certResult.certificate, certResult.privateKey);
    if (!saveResult.success) {
        return saveResult;
    }
    saveSslCache({
        domain,
        certificate: certResult.certificate,
        privateKey: certResult.privateKey,
        expiresOn: certResult.expiresOn,
        createdAt: new Date().toISOString()
    });
    return { success: true, domain, expiresOn: certResult.expiresOn };
}
async function autoSetupNginx(domain, enableSsl = true, force = false) {
    if (!domain) {
        return { success: false, error: 'No domain provided' };
    }
    if (!canSudo()) {
        return {
            success: false,
            error: 'Cannot run sudo. Run manually: sudo apt install nginx && setup config',
            manual: true
        };
    }
    let useSSL = false;
    let sslError = null;
    if (enableSsl) {
        const sslResult = await autoSetupSsl(domain);
        if (sslResult.success) {
            useSSL = true;
            if (!sslResult.cached && !sslResult.fromCache) {
                console.log(`[SSL] ✅ Created Origin Certificate for ${domain}`);
            }
        } else {
            sslError = sslResult.error || 'SSL setup failed';
            if (process.env.VERBOSE_LOGS === 'true') {
                console.log(`[SSL] ⚠️ ${sslError} - falling back to HTTP`);
            }
        }
    }
    const wantsCloudflareOnly =
        String(process.env.CLOUDFLARE_ONLY || '').toLowerCase() !== 'false';
    if (enableSsl && !useSSL && wantsCloudflareOnly) {
        return {
            success: false,
            error: `SSL setup failed (${sslError || 'unknown'}) and CLOUDFLARE_ONLY is enabled. Install a valid origin certificate before enabling Cloudflare-only.`
        };
    }
    const cloudflareOnlyReady = wantsCloudflareOnly ? ensureCloudflareIpsConfig() : false;
    const enforceCloudflareOnly = wantsCloudflareOnly && cloudflareOnlyReady;
    const projectRoot = process.cwd();
    const timerReady = enforceCloudflareOnly ? ensureCloudflareIpsTimer(projectRoot) : false;
    if (wantsCloudflareOnly && !cloudflareOnlyReady) {
        console.warn('[Nginx] Cloudflare-only requested but allowlist missing; proceeding without it.');
    }
    if (enforceCloudflareOnly && !timerReady) {
        console.warn('[Nginx] Cloudflare IP update timer not configured; continuing without timer.');
    }
    const currentConfig = isNginxConfigured(domain);
    const configContent = currentConfig && fs.existsSync(NGINX_CONFIG_FILE)
        ? fs.readFileSync(NGINX_CONFIG_FILE, 'utf8')
        : '';
    const hasSSLConfig = configContent.includes('ssl_certificate');
    const hasCloudflareOnly =
        configContent.includes('return 444') || configContent.includes(CLOUDFLARE_IPS_FILE);
    if (!force && enforceCloudflareOnly && hasCloudflareOnly && hasSSLConfig === useSSL) {
        return { success: true, cached: true, ssl: useSSL, message: 'Nginx Cloudflare-only config preserved' };
    }
    if (!force && currentConfig && hasSSLConfig === useSSL && (!enforceCloudflareOnly || hasCloudflareOnly)) {
        return { success: true, cached: true, ssl: useSSL, message: 'Nginx already configured' };
    }
    try {
        if (!commandExists('nginx')) {
            console.log('[Nginx] Installing nginx...');
            execSync('sudo apt-get update && sudo apt-get install -y nginx', {
                encoding: 'utf8',
                timeout: 120000,
                stdio: 'pipe'
            });
        }
        if (NGINX_ALT_CONFIG_FILE && fs.existsSync(NGINX_ALT_CONFIG_FILE)) {
            execSync(`sudo rm -f ${NGINX_ALT_CONFIG_FILE}`, { encoding: 'utf8' });
        }
        if (NGINX_ALT_ENABLED_FILE && fs.existsSync(NGINX_ALT_ENABLED_FILE)) {
            execSync(`sudo rm -f ${NGINX_ALT_ENABLED_FILE}`, { encoding: 'utf8' });
        }
        const config = generateNginxConfig(domain, useSSL, enforceCloudflareOnly);
        const tempFile = '/tmp/jarvis-nginx.conf';
        fs.writeFileSync(tempFile, config);
        execSync(`sudo cp ${tempFile} ${NGINX_CONFIG_FILE}`, { encoding: 'utf8' });
        if (NGINX_ENABLED_DIR) {
            execSync(`sudo ln -sf ${NGINX_CONFIG_FILE} ${NGINX_ENABLED_DIR}/`, { encoding: 'utf8' });
            execSync(`sudo rm -f ${NGINX_ENABLED_DIR}/default`, { encoding: 'utf8' });
        }
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
function loadCachedConfig() { return loadJsonFile(CONFIG_CACHE_FILE); }
function saveCachedConfig(config) { saveJsonFile(CONFIG_CACHE_FILE, config, 'CloudflareDomain'); }
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
function getAuthHeaders() {
    const config = getConfig();
    if (config.apiToken) {
        return { Authorization: `Bearer ${config.apiToken}` };
    }
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
async function findZoneByDomain(domain) {
    const data = await cfFetch(`/zones?name=${domain}`);
    return data.result?.[0] || null;
}
async function getDnsRecord(name, type = 'A', zoneId = null) {
    const config = getConfig();
    const id = zoneId || config.zoneId;
    const data = await cfFetch(`/zones/${id}/dns_records?name=${name}&type=${type}`);
    return data.result?.[0] || null;
}
async function createDnsRecord(record, zoneId = null) {
    const config = getConfig();
    const id = zoneId || config.zoneId;
    const data = await cfFetch(`/zones/${id}/dns_records`, {
        method: 'POST',
        body: JSON.stringify(record)
    });
    return data.result;
}
async function updateDnsRecord(recordId, record, zoneId = null) {
    const config = getConfig();
    const id = zoneId || config.zoneId;
    const data = await cfFetch(`/zones/${id}/dns_records/${recordId}`, {
        method: 'PATCH',
        body: JSON.stringify(record)
    });
    return data.result;
}
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
    }
    return createDnsRecord(record, zoneId);
}
async function upsertDomainRecords(domain, recordType, target, subdomain) {
    const names = [domain, `www.${domain}`];
    if (subdomain) {names.push(`${subdomain}.${domain}`);}
    const records = [];
    for (const name of names) {
        records.push(await upsertDnsRecord(name, recordType, target, { proxied: true }));
    }
    return records;
}
async function configureForRender(subdomain = null) {
    const config = getConfig();
    const { domain } = config;
    if (!domain) {throw new Error('JARVIS_DOMAIN not configured');}
    const renderHost = config.renderExternalUrl
        ? new URL(config.renderExternalUrl).hostname
        : null;
    if (!renderHost) {throw new Error('RENDER_EXTERNAL_URL not configured');}
    return { success: true, domain, target: renderHost, records: await upsertDomainRecords(domain, 'CNAME', renderHost, subdomain) };
}
async function configureForSelfhost(target, subdomain = null) {
    const config = getConfig();
    const { domain } = config;
    if (!domain) {throw new Error('JARVIS_DOMAIN not configured');}
    if (!target) {throw new Error('Target IP or hostname required');}
    const normalizedTarget = normalizeHostTarget(target);
    const recordType = detectDnsRecordType(normalizedTarget);
    return {
        success: true,
        domain,
        target: normalizedTarget,
        recordType,
        records: await upsertDomainRecords(domain, recordType, normalizedTarget, subdomain)
    };
}
function isRunningOnRender() {
    return !!(process.env.RENDER || process.env.RENDER_EXTERNAL_URL || process.env.RENDER_SERVICE_ID);
}
function extractHostname(urlOrHost) {
    const rawValue = String(urlOrHost || '').trim();
    if (!rawValue) { return null; }
    const normalizedTarget = normalizeHostTarget(rawValue);
    if (isIP(normalizedTarget)) {
        return normalizedTarget;
    }
    if (!rawValue.includes('://')) {
        return rawValue.split(':')[0];
    }
    try {
        return normalizeHostTarget(new URL(rawValue).hostname);
    } catch {
        return null;
    }
}
function detectTarget() {
    const config = getConfig();
    if (isRunningOnRender() && config.renderExternalUrl) {
        const hostname = extractHostname(config.renderExternalUrl);
        if (hostname && hostname !== config.domain) {
            return { mode: 'render', target: hostname };
        }
    }
    if (config.publicBaseUrl) {
        const hostname = extractHostname(config.publicBaseUrl);
        if (hostname && hostname !== config.domain && !hostname.endsWith(`.${config.domain}`)) {
            return { mode: 'selfhost', target: hostname };
        }
    }
    try {
        const { execSync } = require('child_process');
        const ip = normalizeHostTarget(execSync('curl -s --max-time 3 https://ifconfig.me/ip', { encoding: 'utf8' }).trim());
        if (ip && detectDnsRecordType(ip) !== 'CNAME') {
            return {
                mode: 'selfhost',
                target: ip
            };
        }
    } catch {
    }
    return null;
}
async function autoConfigure(options = {}) {
    const config = getConfig();
    const forceReconfigure = options.force === true;
    if (!config.zoneId && !config.domain) {
        return { success: false, error: 'No domain configuration found' };
    }
    const detected = detectTarget();
    if (!detected) {
        return {
            success: false,
            error: 'Could not detect target. Set PUBLIC_BASE_URL, RENDER_EXTERNAL_URL, or ensure internet access.'
        };
    }
    const cached = loadCachedConfig();
    if (!forceReconfigure && cached && cached.target === detected.target && cached.domain === config.domain) {
        console.log(`[CloudflareDomain] Already configured: ${cached.domain} → ${cached.target} (cached)`);
        return { success: true, cached: true, ...cached };
    }
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
// ── DNS auto-refresh (runs in-process) ──────────────────────────────────────
const DNS_REFRESH_INTERVAL_MS = 60 * 1000; // 1 minute
const PUBLIC_IP_SOURCES = {
    A: ['https://api4.ipify.org', 'https://ipv4.icanhazip.com', 'https://ifconfig.me/ip'],
    AAAA: ['https://api6.ipify.org', 'https://ipv6.icanhazip.com', 'https://ifconfig.me/ip']
};
let _lastKnownIps = { A: null, AAAA: null };
let _dnsRefreshTimer = null;

async function getPublicIp(recordType = 'A') {
    const normalizedRecordType = recordType === 'AAAA' ? 'AAAA' : 'A';
    const sources = PUBLIC_IP_SOURCES[normalizedRecordType];
    for (const url of sources) {
        try {
            const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
            const ip = normalizeHostTarget((await res.text()).trim());
            if (detectDnsRecordType(ip) === normalizedRecordType) { return ip; }
        } catch {}
    }
    return null;
}

async function refreshDnsRecords(deps = {}) {
    const config = deps.config || getConfig();
    if (!config.domain || !config.zoneId) return;
    const authHeaders = Object.prototype.hasOwnProperty.call(deps, 'authHeaders')
        ? deps.authHeaders
        : getAuthHeaders();
    if (!authHeaders) return;
    const resolvePublicIp = deps.resolvePublicIp || getPublicIp;
    const upsertRecord = deps.upsertDnsRecord || upsertDnsRecord;
    const logger = deps.logger || console;

    try {
        const names = [config.domain, `www.${config.domain}`];
        for (const recordType of ['A', 'AAAA']) {
            try {
                const ip = normalizeHostTarget(await resolvePublicIp(recordType));
                if (!ip || detectDnsRecordType(ip) !== recordType || ip === _lastKnownIps[recordType]) { continue; }

                for (const name of names) {
                    try {
                        await upsertRecord(name, recordType, ip, { proxied: true });
                    } catch (err) {
                        logger.warn(`[DNS] Failed to update ${name} ${recordType}:`, err.message);
                    }
                }

                if (_lastKnownIps[recordType]) {
                    logger.log(`[DNS] ${recordType} changed ${_lastKnownIps[recordType]} → ${ip}, records updated`);
                }
                _lastKnownIps[recordType] = ip;
            } catch {}
        }
    } catch {}
}

function resetDnsRefreshState() {
    _lastKnownIps = { A: null, AAAA: null };
    if (_dnsRefreshTimer) {
        clearInterval(_dnsRefreshTimer);
        _dnsRefreshTimer = null;
    }
}

function startDnsRefresh() {
    if (_dnsRefreshTimer) return;
    refreshDnsRecords();
    _dnsRefreshTimer = setInterval(refreshDnsRecords, DNS_REFRESH_INTERVAL_MS);
    _dnsRefreshTimer.unref();
}

function stopDnsRefresh() {
    if (_dnsRefreshTimer) { clearInterval(_dnsRefreshTimer); _dnsRefreshTimer = null; }
}

module.exports = {
    getConfig,
    autoConfigure,
    autoSetupNginx,
    ensureCloudflareIpsConfig,
    ensureCloudflareIpsTimer,
    startDnsRefresh,
    stopDnsRefresh,
    __testing: {
        detectDnsRecordType,
        extractHostname,
        getPublicIp,
        refreshDnsRecords,
        resetDnsRefreshState,
    }
};

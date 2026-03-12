require('dotenv').config();
const cloudflareDomain = require('../src/services/cloudflare-domain');

(async() => {
    try {
        const config = cloudflareDomain.getConfig();
        const domain = config.domain || '';
        if (!domain) {
            console.log('[NginxEnsure] JARVIS_DOMAIN not set; skipping.');
            process.exit(0);
        }

        cloudflareDomain.ensureCloudflareIpsConfig?.();
        cloudflareDomain.ensureCloudflareIpsTimer?.(process.cwd());

        const result = await cloudflareDomain.autoSetupNginx(domain, true, false);
        if (!result?.success) {
            console.error('[NginxEnsure] Failed to apply nginx config:', result?.error || 'unknown');
            process.exit(1);
        }

        console.log('[NginxEnsure] Nginx config verified/applied.');
        process.exit(0);
    } catch (error) {
        console.error('[NginxEnsure] Error:', error?.message || error);
        process.exit(1);
    }
})();

#!/bin/bash
# deploy-nginx.sh
# Deploys nginx configuration with Cloudflare-only access
# Usage: ./scripts/deploy-nginx.sh [domain]
# Example: ./scripts/deploy-nginx.sh jorvis.org

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Detect OS for nginx paths
if [ -f /etc/redhat-release ] || [ -f /etc/amazon-linux-release ]; then
    NGINX_DIR="/etc/nginx/conf.d"
    NGINX_CONF="$NGINX_DIR/jarvis.conf"
    NGINX_ENABLED_DIR=""
    NGINX_ALT_CONF="/etc/nginx/sites-available/jarvis"
    NGINX_ALT_ENABLED="/etc/nginx/sites-enabled/jarvis"
else
    NGINX_DIR="/etc/nginx/sites-available"
    NGINX_CONF="$NGINX_DIR/jarvis"
    NGINX_ENABLED_DIR="/etc/nginx/sites-enabled"
    NGINX_ALT_CONF="/etc/nginx/conf.d/jarvis.conf"
    NGINX_ALT_ENABLED=""
fi

# Default domain or use argument
DOMAIN="${1:-jorvis.org}"

echo "═══════════════════════════════════════════════════════════"
echo "  Jarvis AI - Nginx Cloudflare-Only Deployment"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "Domain: $DOMAIN"
echo ""

# ── Detect nginx version for http2 syntax ──────────────────────────────────
NGINX_VERSION=$(nginx -v 2>&1 | grep -oP '\d+\.\d+\.\d+' | head -1)
NGINX_MAJOR=$(echo "$NGINX_VERSION" | cut -d. -f1)
NGINX_MINOR=$(echo "$NGINX_VERSION" | cut -d. -f2)
NGINX_PATCH=$(echo "$NGINX_VERSION" | cut -d. -f3)
echo "Detected nginx $NGINX_VERSION"

# http2 as standalone directive requires nginx >= 1.25.1
USE_NEW_HTTP2=false
if [ "$NGINX_MAJOR" -gt 1 ]; then
    USE_NEW_HTTP2=true
elif [ "$NGINX_MAJOR" -eq 1 ] && [ "$NGINX_MINOR" -gt 25 ]; then
    USE_NEW_HTTP2=true
elif [ "$NGINX_MAJOR" -eq 1 ] && [ "$NGINX_MINOR" -eq 25 ] && [ "$NGINX_PATCH" -ge 1 ]; then
    USE_NEW_HTTP2=true
fi

if [ "$USE_NEW_HTTP2" = true ]; then
    echo "Using new http2 syntax (http2 on;)"
    HTTP2_LISTEN_443=""
    HTTP2_DIRECTIVE="    http2 on;"
else
    echo "Using legacy http2 syntax (listen 443 ssl http2;)"
    HTTP2_LISTEN_443=" http2"
    HTTP2_DIRECTIVE=""
fi

# 1. Create Cloudflare IPs config
echo ""
echo "▶ Fetching Cloudflare IP ranges..."
"$SCRIPT_DIR/update-cloudflare-ips.sh" || {
    echo "  ⚠ Fetch failed, creating initial Cloudflare IPs config..."
    sudo tee /etc/nginx/cloudflare-ips.conf > /dev/null << 'EOF'
# Cloudflare IPs - Run scripts/update-cloudflare-ips.sh to refresh
# IPv4
allow 173.245.48.0/20;
allow 103.21.244.0/22;
allow 103.22.200.0/22;
allow 103.31.4.0/22;
allow 141.101.64.0/18;
allow 108.162.192.0/18;
allow 190.93.240.0/20;
allow 188.114.96.0/20;
allow 197.234.240.0/22;
allow 198.41.128.0/17;
allow 162.158.0.0/15;
allow 104.16.0.0/13;
allow 104.24.0.0/14;
allow 172.64.0.0/13;
allow 131.0.72.0/22;
# IPv6
allow 2400:cb00::/32;
allow 2606:4700::/32;
allow 2803:f800::/32;
allow 2405:b500::/32;
allow 2405:8100::/32;
allow 2a06:98c0::/29;
allow 2c0f:f248::/32;
# Localhost
allow 127.0.0.1;
allow ::1;
# Deny all other IPs
deny all;
EOF
    sudo chmod 644 /etc/nginx/cloudflare-ips.conf
    echo "  ✓ Created initial Cloudflare IPs config"
}

# 2. Generate domain-specific nginx config
echo ""
echo "▶ Generating nginx config for $DOMAIN..."

SSL_CERT_PATH="/etc/ssl/cloudflare/${DOMAIN}.pem"
SSL_KEY_PATH="/etc/ssl/cloudflare/${DOMAIN}.key"

if [ ! -f "$SSL_CERT_PATH" ] || [ ! -f "$SSL_KEY_PATH" ]; then
    echo "  ⚠ SSL certs not found at $SSL_CERT_PATH"
    echo "  Creating self-signed certificate..."
    sudo mkdir -p /etc/ssl/cloudflare
    sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout "$SSL_KEY_PATH" \
        -out "$SSL_CERT_PATH" \
        -subj "/CN=$DOMAIN" 2>/dev/null
    echo "  ✓ Self-signed certificate created"
fi

cat > /tmp/jarvis.conf << EOF
# Block direct IP/hostname access - only allow via Cloudflare
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    listen 443 ssl${HTTP2_LISTEN_443} default_server;
    listen [::]:443 ssl${HTTP2_LISTEN_443} default_server;
${HTTP2_DIRECTIVE}
    server_name _;
    ssl_certificate ${SSL_CERT_PATH};
    ssl_certificate_key ${SSL_KEY_PATH};
    return 444;
}

server {
    listen 80;
    server_name ${DOMAIN} www.${DOMAIN};
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl${HTTP2_LISTEN_443};
${HTTP2_DIRECTIVE}
    server_name ${DOMAIN} www.${DOMAIN};

    ssl_certificate ${SSL_CERT_PATH};
    ssl_certificate_key ${SSL_KEY_PATH};
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;
    ssl_prefer_server_ciphers off;

    include /etc/nginx/cloudflare-ips.conf;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 86400;
        proxy_buffering off;
    }
}
EOF

sudo mv /tmp/jarvis.conf "$NGINX_CONF"
sudo chmod 644 "$NGINX_CONF"
if [ -n "$NGINX_ENABLED_DIR" ]; then
    sudo ln -sf "$NGINX_CONF" "$NGINX_ENABLED_DIR/jarvis"
fi
if [ -n "$NGINX_ALT_CONF" ] && [ -f "$NGINX_ALT_CONF" ]; then
    sudo rm -f "$NGINX_ALT_CONF"
fi
if [ -n "$NGINX_ALT_ENABLED" ] && [ -e "$NGINX_ALT_ENABLED" ]; then
    sudo rm -f "$NGINX_ALT_ENABLED"
fi
echo "✓ Nginx config deployed"

# 3. Disable default nginx site
if [ -n "$NGINX_ENABLED_DIR" ] && [ -f "$NGINX_ENABLED_DIR/default" ]; then
    sudo rm -f "$NGINX_ENABLED_DIR/default"
    echo "✓ Disabled default nginx site"
fi

if grep -q 'server_name  _;' /etc/nginx/nginx.conf 2>/dev/null; then
    sudo sed -i 's/server_name  _;/server_name  localhost;/' /etc/nginx/nginx.conf
    echo "✓ Fixed nginx.conf default server conflict"
fi

# 4. Test and reload nginx
echo ""
echo "▶ Testing nginx configuration..."
if sudo nginx -t 2>&1; then
    sudo systemctl reload nginx 2>/dev/null || sudo systemctl start nginx
    echo "✓ Nginx reloaded successfully"
else
    echo "✗ Nginx config test failed!"
    exit 1
fi

# 5. Install systemd timer for Cloudflare IP updates (replaces cron)
echo ""
echo "▶ Setting up Cloudflare IP update timer..."

sudo tee /etc/systemd/system/cloudflare-ips-update.service > /dev/null << SVCEOF
[Unit]
Description=Update Cloudflare IP ranges for nginx
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=${PROJECT_DIR}/scripts/update-cloudflare-ips.sh
StandardOutput=journal
StandardError=journal
SVCEOF

sudo tee /etc/systemd/system/cloudflare-ips-update.timer > /dev/null << TIMEREOF
[Unit]
Description=Weekly Cloudflare IP update

[Timer]
OnCalendar=Sun *-*-* 03:00:00
Persistent=true

[Install]
WantedBy=timers.target
TIMEREOF

sudo systemctl daemon-reload
sudo systemctl enable --now cloudflare-ips-update.timer
echo "✓ Systemd timer installed (Sundays 3 AM)"

# 6. Summary
echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  ✓ Deployment Complete!"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "Security Configuration:"
echo "  • Direct IP access:        BLOCKED (returns 444)"
echo "  • Unknown hostnames:       BLOCKED (returns 444)"
echo "  • $DOMAIN via Cloudflare:  ALLOWED"
echo ""
echo "Files:"
echo "  • $NGINX_CONF"
echo "  • /etc/nginx/cloudflare-ips.conf"
echo ""
echo "Timer: Cloudflare IPs auto-update every Sunday at 3 AM"
echo ""

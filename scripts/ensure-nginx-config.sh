#!/bin/bash
# ensure-nginx-config.sh
# Ensures nginx config includes Cloudflare-only protection
# Run this on boot or after git pull to maintain security

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PROJECT_NGINX="$PROJECT_DIR/nginx/jarvis.conf"
CF_IPS_CONF="/etc/nginx/cloudflare-ips.conf"

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

# Only run if we have sudo access and nginx is installed
if ! command -v nginx &> /dev/null; then
    exit 0
fi

# Check if current nginx config has the default_server block (our security config)
if [ ! -f "$NGINX_CONF" ] || ! grep -q "default_server" "$NGINX_CONF" 2>/dev/null; then
    echo "[Nginx] Security config missing, restoring..."
    
    # Copy the project's nginx config
    if [ -f "$PROJECT_NGINX" ]; then
        sudo cp "$PROJECT_NGINX" "$NGINX_CONF"
        if [ -n "$NGINX_ENABLED_DIR" ]; then
            sudo ln -sf "$NGINX_CONF" "$NGINX_ENABLED_DIR/jarvis"
            sudo rm -f "$NGINX_ENABLED_DIR/default" 2>/dev/null || true
        fi
        echo "[Nginx] Restored jarvis.conf from project"
    fi
fi

# Remove conflicting config to avoid duplicate default_server blocks
if [ -n "$NGINX_ALT_CONF" ] && [ -f "$NGINX_ALT_CONF" ]; then
    sudo rm -f "$NGINX_ALT_CONF"
fi
if [ -n "$NGINX_ALT_ENABLED" ] && [ -e "$NGINX_ALT_ENABLED" ]; then
    sudo rm -f "$NGINX_ALT_ENABLED"
fi

# Ensure Cloudflare IPs config exists
if [ ! -f "$CF_IPS_CONF" ]; then
    echo "[Nginx] Cloudflare IPs config missing, creating..."
    
    # Create basic Cloudflare IPs config
    sudo tee "$CF_IPS_CONF" > /dev/null << 'EOF'
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
# Deny all
deny all;
EOF
    echo "[Nginx] Created cloudflare-ips.conf"
fi

# Test and reload nginx if we made changes
if sudo nginx -t 2>&1; then
    sudo systemctl reload nginx 2>/dev/null || true
    echo "[Nginx] Config validated and reloaded"
fi

#!/bin/bash
# ensure-nginx-config.sh
# Ensures nginx config includes Cloudflare-only protection
# Run on boot or after git pull to maintain security

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PROJECT_NGINX="$PROJECT_DIR/nginx/jarvis.conf"
CF_IPS_CONF="/etc/nginx/cloudflare-ips.conf"

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

if ! command -v nginx &> /dev/null; then
    exit 0
fi

# ── Detect nginx version for http2 syntax ──────────────────────────────────
NGINX_VERSION=$(nginx -v 2>&1 | grep -oP '\d+\.\d+\.\d+' | head -1)
NGINX_MAJOR=$(echo "$NGINX_VERSION" | cut -d. -f1)
NGINX_MINOR=$(echo "$NGINX_VERSION" | cut -d. -f2)
NGINX_PATCH=$(echo "$NGINX_VERSION" | cut -d. -f3)

USE_NEW_HTTP2=false
if [ "$NGINX_MAJOR" -gt 1 ]; then
    USE_NEW_HTTP2=true
elif [ "$NGINX_MAJOR" -eq 1 ] && [ "$NGINX_MINOR" -gt 25 ]; then
    USE_NEW_HTTP2=true
elif [ "$NGINX_MAJOR" -eq 1 ] && [ "$NGINX_MINOR" -eq 25 ] && [ "$NGINX_PATCH" -ge 1 ]; then
    USE_NEW_HTTP2=true
fi

if [ "$USE_NEW_HTTP2" = true ]; then
    HTTP2_LISTEN_443=""
    HTTP2_DIRECTIVE="    http2 on;"
else
    HTTP2_LISTEN_443=" http2"
    HTTP2_DIRECTIVE=""
fi

# ── Fix http2 syntax in existing config if needed ─────────────────────────
if [ -f "$NGINX_CONF" ]; then
    if [ "$USE_NEW_HTTP2" = false ] && grep -q "^    http2 on;" "$NGINX_CONF" 2>/dev/null; then
        echo "[Nginx] Fixing http2 syntax for nginx $NGINX_VERSION..."
        sudo sed -i 's/^    http2 on;//g' "$NGINX_CONF"
        sudo sed -i 's/listen \(.*\) ssl;/listen \1 ssl http2;/' "$NGINX_CONF"
        echo "[Nginx] http2 syntax fixed"
    elif [ "$USE_NEW_HTTP2" = true ] && grep -q "ssl http2" "$NGINX_CONF" 2>/dev/null; then
        echo "[Nginx] Fixing http2 syntax for nginx $NGINX_VERSION..."
        sudo sed -i 's/ http2;$/;/' "$NGINX_CONF"
        # Add http2 on; after each server { block that has ssl
        sudo sed -i '/listen.*ssl;/{/http2 on/!{n;s/^/    http2 on;\n/}}' "$NGINX_CONF"
        echo "[Nginx] http2 syntax fixed"
    fi
fi

# ── Ensure config exists ───────────────────────────────────────────────────
if [ ! -f "$NGINX_CONF" ] || ! grep -q "default_server" "$NGINX_CONF" 2>/dev/null; then
    echo "[Nginx] Security config missing, restoring..."
    if [ -f "$PROJECT_NGINX" ]; then
        sudo cp "$PROJECT_NGINX" "$NGINX_CONF"
        if [ -n "$NGINX_ENABLED_DIR" ]; then
            sudo ln -sf "$NGINX_CONF" "$NGINX_ENABLED_DIR/jarvis"
            sudo rm -f "$NGINX_ENABLED_DIR/default" 2>/dev/null || true
        fi
        echo "[Nginx] Restored jarvis.conf from project"
    fi
fi

# ── Remove conflicting configs ─────────────────────────────────────────────
if [ -n "$NGINX_ALT_CONF" ] && [ -f "$NGINX_ALT_CONF" ]; then
    sudo rm -f "$NGINX_ALT_CONF"
fi
if [ -n "$NGINX_ALT_ENABLED" ] && [ -e "$NGINX_ALT_ENABLED" ]; then
    sudo rm -f "$NGINX_ALT_ENABLED"
fi

# ── Ensure Cloudflare IPs config ──────────────────────────────────────────
if [ ! -f "$CF_IPS_CONF" ]; then
    echo "[Nginx] Cloudflare IPs config missing, creating..."
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
    sudo chmod 644 "$CF_IPS_CONF"
    echo "[Nginx] Created cloudflare-ips.conf"
fi

# ── Ensure systemd timer exists (so bot doesn't fail trying to create it) ──
if [ ! -f /etc/systemd/system/cloudflare-ips-update.service ]; then
    echo "[Nginx] Installing cloudflare-ips-update systemd units..."
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
    echo "[Nginx] Systemd timer installed"
fi

# ── Test and reload ────────────────────────────────────────────────────────
if sudo nginx -t 2>&1; then
    sudo systemctl reload nginx 2>/dev/null || sudo systemctl start nginx
    echo "[Nginx] Config validated and reloaded"
else
    echo "[Nginx] Config test failed!"
    exit 1
fi

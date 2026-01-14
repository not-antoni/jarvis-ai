#!/bin/bash
# deploy-nginx.sh
# Deploys nginx configuration with Cloudflare-only access
# Usage: ./scripts/deploy-nginx.sh [domain]
# Example: ./scripts/deploy-nginx.sh jorvis.org

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Default domain or use argument
DOMAIN="${1:-jorvis.org}"

echo "═══════════════════════════════════════════════════════════"
echo "  Jarvis AI - Nginx Cloudflare-Only Deployment"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "Domain: $DOMAIN"
echo ""

# 1. Create Cloudflare IPs config
echo "▶ Fetching Cloudflare IP ranges..."
$SCRIPT_DIR/update-cloudflare-ips.sh || {
    echo "Creating initial Cloudflare IPs config..."
    
    cat > /tmp/cloudflare-ips.conf << 'EOF'
# Cloudflare IPs - Initial setup
# Run scripts/update-cloudflare-ips.sh to refresh

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
    
    sudo mv /tmp/cloudflare-ips.conf /etc/nginx/cloudflare-ips.conf
    sudo chmod 644 /etc/nginx/cloudflare-ips.conf
    echo "✓ Created initial Cloudflare IPs config"
}

# 2. Generate domain-specific nginx config
echo ""
echo "▶ Generating nginx config for $DOMAIN..."

# Determine SSL cert location
SSL_CERT_PATH="/etc/ssl/cloudflare/${DOMAIN}.pem"
SSL_KEY_PATH="/etc/ssl/cloudflare/${DOMAIN}.key"

# Check if certs exist, use self-signed otherwise
if [ ! -f "$SSL_CERT_PATH" ] || [ ! -f "$SSL_KEY_PATH" ]; then
    echo "  ⚠ SSL certs not found at $SSL_CERT_PATH"
    echo "  Creating self-signed certificate (replace with Cloudflare Origin cert for production)"
    
    sudo mkdir -p /etc/ssl/cloudflare
    sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout "$SSL_KEY_PATH" \
        -out "$SSL_CERT_PATH" \
        -subj "/CN=$DOMAIN" 2>/dev/null
    
    echo "  ✓ Self-signed certificate created"
fi

# Generate nginx config with variable substitution
cat > /tmp/jarvis.conf << EOF
# Block direct IP/hostname access - only allow Cloudflare
# This catches: direct IP, AWS hostnames (ec2-*.compute-1.amazonaws.com), etc.
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    listen 443 ssl default_server;
    listen [::]:443 ssl default_server;
    http2 on;
    server_name _;
    
    ssl_certificate $SSL_CERT_PATH;
    ssl_certificate_key $SSL_KEY_PATH;
    
    # Return 444 (close connection) - no response, frustrates bots
    return 444;
}

server {
    listen 80;
    server_name $DOMAIN www.$DOMAIN;
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl;
    http2 on;
    server_name $DOMAIN www.$DOMAIN;

    ssl_certificate $SSL_CERT_PATH;
    ssl_certificate_key $SSL_KEY_PATH;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;
    ssl_prefer_server_ciphers off;

    # Only allow Cloudflare IPs
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

sudo mv /tmp/jarvis.conf /etc/nginx/conf.d/jarvis.conf
sudo chmod 644 /etc/nginx/conf.d/jarvis.conf
echo "✓ Nginx config deployed"

# 3. Disable default nginx server if it exists
if [ -f /etc/nginx/sites-enabled/default ]; then
    sudo rm -f /etc/nginx/sites-enabled/default
    echo "✓ Disabled default nginx site"
fi

# Fix default server conflict in nginx.conf if present
if grep -q 'server_name  _;' /etc/nginx/nginx.conf 2>/dev/null; then
    sudo sed -i 's/server_name  _;/server_name  localhost;/' /etc/nginx/nginx.conf
    echo "✓ Fixed nginx.conf default server conflict"
fi

# 4. Test and reload nginx
echo ""
echo "▶ Testing nginx configuration..."
if sudo nginx -t 2>&1; then
    sudo systemctl reload nginx
    echo "✓ Nginx reloaded successfully"
else
    echo "✗ Nginx config test failed! Check the errors above."
    exit 1
fi

# 5. Set up cron job for Cloudflare IP updates
echo ""
echo "▶ Setting up weekly Cloudflare IP update..."
CRON_CMD="0 3 * * 0 $PROJECT_DIR/scripts/update-cloudflare-ips.sh >> /var/log/cloudflare-ips.log 2>&1"

# Check if cron job already exists
if ! crontab -l 2>/dev/null | grep -q "update-cloudflare-ips.sh"; then
    (crontab -l 2>/dev/null; echo "$CRON_CMD") | crontab -
    echo "✓ Added weekly cron job (Sundays 3 AM)"
else
    echo "✓ Cron job already exists"
fi

# 6. Summary
echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  ✓ Deployment Complete!"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "Security Configuration:"
echo "  • Direct IP access:        BLOCKED (returns 444)"
echo "  • AWS hostname access:     BLOCKED (returns 444)"  
echo "  • Unknown hostnames:       BLOCKED (returns 444)"
echo "  • $DOMAIN via Cloudflare:  ALLOWED"
echo ""
echo "Files:"
echo "  • /etc/nginx/conf.d/jarvis.conf"
echo "  • /etc/nginx/cloudflare-ips.conf"
echo ""
echo "Cron: Cloudflare IPs auto-update every Sunday at 3 AM"
echo ""

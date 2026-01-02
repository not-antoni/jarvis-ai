#!/bin/bash
# YouTube Cookie Sync Script
# Uses yt-dlp to extract cookies from your Chrome browser and uploads to VPS
# This works with Chrome's encrypted cookies

set -e

# Configuration
VPS_HOST="ec2-user@ec2-35-170-197-182.compute-1.amazonaws.com"
VPS_KEY="$HOME/jarvis.pem"
REMOTE_PATH="/home/ec2-user/jarvis-ai/scripts/yt-cookies.txt"
OUTPUT_FILE="/tmp/yt-cookies.txt"

echo "[CookieSync] Extracting cookies from Chrome..."

# Use yt-dlp to extract cookies (handles encryption)
if command -v yt-dlp &> /dev/null; then
    yt-dlp --cookies-from-browser chrome --cookies "$OUTPUT_FILE" --skip-download "https://www.youtube.com/watch?v=dQw4w9WgXcQ" 2>/dev/null || true
elif command -v youtube-dl &> /dev/null; then
    youtube-dl --cookies-from-browser chrome --cookies "$OUTPUT_FILE" --skip-download "https://www.youtube.com/watch?v=dQw4w9WgXcQ" 2>/dev/null || true
else
    echo "[CookieSync] Installing yt-dlp..."
    pip install --user yt-dlp
    ~/.local/bin/yt-dlp --cookies-from-browser chrome --cookies "$OUTPUT_FILE" --skip-download "https://www.youtube.com/watch?v=dQw4w9WgXcQ" 2>/dev/null || true
fi

# Check if we got cookies
if [ ! -s "$OUTPUT_FILE" ]; then
    echo "[CookieSync] ERROR: No cookies exported. Make sure you're logged into YouTube in Chrome."
    exit 1
fi

COOKIE_COUNT=$(grep -c "youtube\|google" "$OUTPUT_FILE" 2>/dev/null || echo "0")
echo "[CookieSync] Exported $COOKIE_COUNT YouTube/Google cookies"

# Upload to VPS
echo "[CookieSync] Uploading to VPS..."
scp -o StrictHostKeyChecking=no -i "$VPS_KEY" "$OUTPUT_FILE" "$VPS_HOST:$REMOTE_PATH"

echo "[CookieSync] Done! Cookies synced to VPS."

# Optionally restart the bot to pick up new cookies
# ssh -o StrictHostKeyChecking=no -i "$VPS_KEY" "$VPS_HOST" "pm2 restart jarvis" 2>/dev/null || true

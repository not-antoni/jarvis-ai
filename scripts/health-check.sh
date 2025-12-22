#!/bin/bash
# Jarvis AI - Health Check Script
#
# Checks bot health and optionally restarts via PM2 if unhealthy.
# 
# Usage:
#   ./health-check.sh                    # Check health
#   ./health-check.sh --restart          # Check and restart if unhealthy
#   ./health-check.sh --restart --notify # Also send notification on failure
#
# Cron example (check every 5 minutes, restart if needed):
#   */5 * * * * /path/to/jarvis-ai/scripts/health-check.sh --restart >> /var/log/jarvis-health.log 2>&1

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Load configuration from .env if available
if [ -f "$PROJECT_DIR/.env" ]; then
    export $(grep -E "^(PUBLIC_BASE_URL|HEALTH_TOKEN|DISCORD_WEBHOOK_URL)=" "$PROJECT_DIR/.env" | xargs)
fi

# Configuration
HEALTH_URL="${PUBLIC_BASE_URL:-http://localhost:3000}/health"
HEALTH_TOKEN="${HEALTH_TOKEN:-}"
PM2_APP_NAME="${PM2_APP_NAME:-jarvis}"
LOG_FILE="${LOG_FILE:-/var/log/jarvis-health.log}"
RESTART_ON_FAILURE=false
NOTIFY_ON_FAILURE=false
TIMEOUT=10

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --restart)
            RESTART_ON_FAILURE=true
            shift
            ;;
        --notify)
            NOTIFY_ON_FAILURE=true
            shift
            ;;
        --url)
            HEALTH_URL="$2"
            shift 2
            ;;
        --token)
            HEALTH_TOKEN="$2"
            shift 2
            ;;
        --app)
            PM2_APP_NAME="$2"
            shift 2
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: $0 [--restart] [--notify] [--url URL] [--token TOKEN] [--app PM2_NAME]"
            exit 1
            ;;
    esac
done

# Build curl command
CURL_CMD="curl -sf --max-time $TIMEOUT"
if [ -n "$HEALTH_TOKEN" ]; then
    CURL_CMD="$CURL_CMD -H 'Authorization: Bearer $HEALTH_TOKEN'"
fi

# Perform health check
log "Checking health: $HEALTH_URL"

if response=$(eval "$CURL_CMD '$HEALTH_URL'" 2>&1); then
    status=$(echo "$response" | grep -o '"status":"[^"]*"' | head -1 | cut -d'"' -f4)
    
    if [ "$status" = "ok" ]; then
        log "${GREEN}✓${NC} Health check passed (status: ok)"
        exit 0
    elif [ "$status" = "degraded" ]; then
        log "${YELLOW}⚠${NC} Health check degraded but running"
        exit 0
    else
        log "${YELLOW}⚠${NC} Health check returned status: $status"
    fi
else
    log "${RED}✗${NC} Health check failed: $response"
    
    if [ "$RESTART_ON_FAILURE" = true ]; then
        if command -v pm2 &> /dev/null; then
            log "Attempting to restart $PM2_APP_NAME via PM2..."
            if pm2 restart "$PM2_APP_NAME" 2>/dev/null; then
                log "${GREEN}✓${NC} Successfully restarted $PM2_APP_NAME"
                
                # Wait for startup and verify
                sleep 10
                if eval "$CURL_CMD '$HEALTH_URL'" &>/dev/null; then
                    log "${GREEN}✓${NC} Bot is healthy after restart"
                else
                    log "${RED}✗${NC} Bot still unhealthy after restart"
                    
                    # Send notification if enabled
                    if [ "$NOTIFY_ON_FAILURE" = true ] && [ -n "$DISCORD_WEBHOOK_URL" ]; then
                        curl -sf -X POST "$DISCORD_WEBHOOK_URL" \
                            -H "Content-Type: application/json" \
                            -d "{\"content\":\"⚠️ **Jarvis Health Alert**\\nBot restarted but still unhealthy at $(date)\"}" \
                            &>/dev/null || true
                    fi
                    exit 1
                fi
            else
                log "${RED}✗${NC} Failed to restart $PM2_APP_NAME"
                exit 1
            fi
        else
            log "${YELLOW}⚠${NC} PM2 not available, cannot restart automatically"
            exit 1
        fi
    fi
    
    exit 1
fi

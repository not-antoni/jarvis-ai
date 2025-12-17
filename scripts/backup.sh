#!/bin/bash
# Jarvis AI - Selfhost Backup Script
# 
# Creates a compressed backup of critical configurations
# Run nightly via cron: 0 0 * * * /path/to/jarvis-ai/scripts/backup.sh
#
# Usage: ./backup.sh [--dry-run]

set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="${BACKUP_DIR:-$PROJECT_DIR/backups}"
MAX_BACKUPS="${MAX_BACKUPS:-7}"  # Keep last 7 days
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_NAME="jarvis-backup-$TIMESTAMP"
DRY_RUN=false

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

log_info() { echo -e "${CYAN}ℹ${NC} $1"; }
log_success() { echo -e "${GREEN}✓${NC} $1"; }
log_warn() { echo -e "${YELLOW}⚠${NC} $1"; }
log_error() { echo -e "${RED}✗${NC} $1"; }

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --backup-dir)
            BACKUP_DIR="$2"
            shift 2
            ;;
        --max-backups)
            MAX_BACKUPS="$2"
            shift 2
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: $0 [--dry-run] [--backup-dir /path] [--max-backups N]"
            exit 1
            ;;
    esac
done

echo "═══ Jarvis AI Backup ═══"
echo ""

# Create backup directory
if [ "$DRY_RUN" = true ]; then
    log_info "[DRY RUN] Would create backup directory: $BACKUP_DIR"
else
    mkdir -p "$BACKUP_DIR"
    log_info "Backup directory: $BACKUP_DIR"
fi

# Create temp directory for staging
TEMP_DIR=$(mktemp -d)
STAGING_DIR="$TEMP_DIR/$BACKUP_NAME"
mkdir -p "$STAGING_DIR"

log_info "Staging backup in $STAGING_DIR"

# Files/directories to backup from project
PROJECT_ITEMS=(
    ".env"
    "data"
    "config"
    "lavalink/application.yml"
)

# System config files (if accessible)
SYSTEM_ITEMS=(
    "/etc/nginx/sites-available/jarvis"
    "/etc/nginx/sites-enabled/jarvis"
)

# Backup project files
log_info "Backing up project files..."
for item in "${PROJECT_ITEMS[@]}"; do
    src="$PROJECT_DIR/$item"
    if [ -e "$src" ]; then
        # Create parent directory structure
        parent_dir=$(dirname "$item")
        if [ "$parent_dir" != "." ]; then
            mkdir -p "$STAGING_DIR/project/$parent_dir"
        fi
        
        if [ -d "$src" ]; then
            # Directory - copy excluding node_modules, .git, logs
            if [ "$DRY_RUN" = true ]; then
                log_info "[DRY RUN] Would copy directory: $item"
            else
                rsync -a --exclude='node_modules' --exclude='.git' --exclude='*.log' \
                    "$src" "$STAGING_DIR/project/$parent_dir/"
                log_success "Copied: $item"
            fi
        else
            # File
            if [ "$DRY_RUN" = true ]; then
                log_info "[DRY RUN] Would copy file: $item"
            else
                cp "$src" "$STAGING_DIR/project/$item"
                log_success "Copied: $item"
            fi
        fi
    else
        log_warn "Not found (skipping): $item"
    fi
done

# Backup system config files (requires sudo potentially)
log_info "Checking system config files..."
mkdir -p "$STAGING_DIR/system"
for item in "${SYSTEM_ITEMS[@]}"; do
    if [ -e "$item" ]; then
        if [ "$DRY_RUN" = true ]; then
            log_info "[DRY RUN] Would copy system file: $item"
        else
            if [ -r "$item" ]; then
                cp "$item" "$STAGING_DIR/system/$(basename "$item")"
                log_success "Copied: $item"
            else
                log_warn "Cannot read (need sudo?): $item"
            fi
        fi
    fi
done

# Backup PM2 process list if available
if command -v pm2 &> /dev/null; then
    if [ "$DRY_RUN" = true ]; then
        log_info "[DRY RUN] Would save PM2 process list"
    else
        pm2 save 2>/dev/null || true
        PM2_DUMP="$HOME/.pm2/dump.pm2"
        if [ -f "$PM2_DUMP" ]; then
            cp "$PM2_DUMP" "$STAGING_DIR/pm2-dump.pm2"
            log_success "Saved PM2 process list"
        fi
    fi
fi

# Create metadata file
if [ "$DRY_RUN" = false ]; then
    cat > "$STAGING_DIR/backup-info.json" << EOF
{
    "timestamp": "$(date -Iseconds)",
    "hostname": "$(hostname)",
    "user": "$(whoami)",
    "project_dir": "$PROJECT_DIR",
    "node_version": "$(node --version 2>/dev/null || echo 'unknown')",
    "pm2_version": "$(pm2 --version 2>/dev/null || echo 'not installed')"
}
EOF
fi

# Compress backup
BACKUP_FILE="$BACKUP_DIR/$BACKUP_NAME.tar.gz"
if [ "$DRY_RUN" = true ]; then
    log_info "[DRY RUN] Would create archive: $BACKUP_FILE"
else
    log_info "Creating compressed archive..."
    tar -czf "$BACKUP_FILE" -C "$TEMP_DIR" "$BACKUP_NAME"
    log_success "Created: $BACKUP_FILE"
    
    # Show backup size
    BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
    log_info "Backup size: $BACKUP_SIZE"
fi

# Cleanup temp directory
rm -rf "$TEMP_DIR"

# Rotate old backups
if [ "$DRY_RUN" = false ]; then
    log_info "Rotating old backups (keeping last $MAX_BACKUPS)..."
    cd "$BACKUP_DIR"
    ls -t jarvis-backup-*.tar.gz 2>/dev/null | tail -n +$((MAX_BACKUPS + 1)) | while read old_backup; do
        rm -f "$old_backup"
        log_info "Removed old backup: $old_backup"
    done
fi

echo ""
log_success "Backup complete!"

if [ "$DRY_RUN" = false ]; then
    echo ""
    echo "To restore, extract with:"
    echo "  tar -xzf $BACKUP_FILE -C /tmp"
    echo "  cp /tmp/$BACKUP_NAME/project/.env $PROJECT_DIR/.env"
    echo "  # etc."
fi

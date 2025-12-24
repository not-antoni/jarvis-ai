# J.A.R.V.I.S.

**Just A Rather Very Intelligent System** — A feature-rich Discord bot inspired by Tony Stark's AI assistant.

**OFFICIAL SITE**: https://jorvis.org/

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Discord.js](https://img.shields.io/badge/discord.js-v14-blue.svg)](https://discord.js.org)
[![Node.js](https://img.shields.io/badge/node-24.12.0-green.svg)](https://nodejs.org)

> **196 JavaScript files • 94,000+ lines of code • 100% open source**

> [!IMPORTANT]
> **Production Requirement**: This project **REQUIRES** Node.js **v24.12.0** exactly to function correctly in production (as defined in `render.yaml`). Using other versions may lead to instability or errors. Please ensure your environment matches this version.

---

## Table of Contents

- [Features](#features)
- [Quick Start](#quick-start)
- [Deployment Modes](#deployment-modes)
- [Self-Hosting Guide](#self-hosting-guide)
- [Database Migration](#database-migration)
- [Commands](#commands)
- [Configuration](#configuration)
- [Project Structure](#project-structure)
- [Contributing](#contributing)
- [License](#license)

---

## Features

### AI Chat
Multi-provider AI with OpenAI, OpenRouter, Groq, Google Gemini, Vercel AI Gateway, and local Ollama support. Context-aware conversations with switchable personas.

### Economy System
Full economy with MongoDB persistence:
- `/daily` - Daily rewards with streak bonuses
- `/work` - Earn money at Stark Industries
- `/hunt` `/fish` `/dig` `/beg` - Minigames
- `/gamble` `/slots` `/coinflip` - Gambling
- `/shop` `/buy` - Item shop with boosters
- `/give` - Send money to friends
- `/vote` - Vote rewards (top.gg integration)

### Fun
- `/rapbattle` - AI vs Human rap battles
- `/roast` - British-style roasts
- `/soul` - Artificial soul system
- `/trivia` `/scramble` - Word games

### Moderation
Smart filters that catch Unicode bypass attempts (Cyrillic, Armenian, etc.), automod, logging, and reaction roles.

### Music
YouTube playback via yt-dlp with auto-updates.

---

## Quick Start

```bash
# Clone
git clone https://github.com/not-antoni/jarvis-ai.git
cd jarvis-ai

# Install
npm install

# Configure
cp .env.example .env
# Edit .env with your tokens

# Run
npm start
```

### Required Environment Variables

```env
DISCORD_TOKEN=your_bot_token
MONGO_URI_MAIN=mongodb://localhost:27017/jarvis_ai
MONGO_URI_VAULT=mongodb://localhost:27017/jarvis_vault
MASTER_KEY_BASE64=base64_32_byte_key
```

### Optional

```env
# Dashboard / monitoring
DASHBOARD_PASSWORD=...   # Password gate for /dashboard and /api/dashboard/* (preferred)
PASSWORD=...             # Backwards-compatible fallback
HEALTH_TOKEN=...         # Locks down /health, /providers/status, /metrics/commands

# Webserver limits
JSON_BODY_LIMIT=500kb    # Default JSON/urlencoded body limit (e.g. 2mb)

# AI providers (configure at least one)
OPENROUTER_API_KEY=...
GROQ_API_KEY=...
GOOGLE_AI_API_KEY=...
OPENAI_API_KEY=...

# Extras
BRAVE_API_KEY=...        # Web search
YOUTUBE_API_KEY=...      # YouTube

# OAuth (optional, used by moderator auth)
DISCORD_CLIENT_ID=...
DISCORD_CLIENT_SECRET=...
```

---

## Deployment Modes

Jarvis supports three deployment modes:

| Mode | `DEPLOY_TARGET` | Use Case |
|------|-----------------|----------|
| **Render** | `render` (default) | Cloud hosting on Render.com |
| **Selfhost** | `selfhost` | VPS, Raspberry Pi, home server |
| **Hybrid** | `hybrid` | Auto-detects based on environment |

### Quick Mode Selection

```env
# Cloud (Render.com)
DEPLOY_TARGET=render

# Self-hosted (VPS, Raspberry Pi)
DEPLOY_TARGET=selfhost
SELFHOST_MODE=true

# Auto-detect (recommended for flexibility)
DEPLOY_TARGET=hybrid
```

---

## Self-Hosting Guide

### Option 1: Quick Setup Wizard

```bash
# Interactive setup - configures everything
node scripts/selfhost-setup.js

# Verify your configuration
node scripts/selfhost-check.js
```

### Option 2: Manual Setup

#### Step 1: Environment Variables

```env
# Core settings
DEPLOY_TARGET=selfhost
SELFHOST_MODE=true
PUBLIC_BASE_URL=http://YOUR_IP:3000

# Database (MongoDB)
MONGO_URI_MAIN=mongodb://localhost:27017/jarvis_ai
MONGO_URI_VAULT=mongodb://localhost:27017/jarvis_vault

# Security
MASTER_KEY_BASE64=<generate with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))">
USER_SESSION_SECRET=<random 32+ char string>

# Performance (for VPS/Raspberry Pi)
FFMPEG_PATH=/usr/bin/ffmpeg
YTDLP_MAX_DURATION=900
YTDLP_MAX_FILESIZE_MB=50
```

#### Step 2: Install Dependencies

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install -y ffmpeg mongodb
sudo systemctl start mongodb
sudo systemctl enable mongodb

# Install PM2
sudo npm install -g pm2
```

#### Step 3: Run with PM2

```bash
# Using the included ecosystem config
pm2 start ecosystem.config.js

# Or manually
pm2 start index.js --name "jarvis" --max-memory-restart 500M

# Auto-start on boot
pm2 startup && pm2 save

# View logs
pm2 logs jarvis
```

### Auto-Deploy (Git Pull + PM2 Restart)

Set up automatic deployment with Discord alerts when you push to GitHub. Run this one command on your VPS:

```bash
echo '#!/bin/bash
WEBHOOK="YOUR_DISCORD_WEBHOOK_URL"
PING="<@YOUR_DISCORD_USER_ID>"
LOGFILE="/home/admin/deploy.log"
export PATH="/usr/local/bin:/usr/bin:/bin:$HOME/.nvm/versions/node/$(ls $HOME/.nvm/versions/node 2>/dev/null | tail -1)/bin:$PATH"
cd /home/admin/jarvis-ai

# Keep only last 500 lines of log
if [ -f "$LOGFILE" ] && [ $(wc -l < "$LOGFILE") -gt 500 ]; then
    tail -n 500 "$LOGFILE" > "$LOGFILE.tmp" && mv "$LOGFILE.tmp" "$LOGFILE"
fi

# Check if PM2 process is online
if ! pm2 list 2>/dev/null | grep -q "jarvis.*online"; then
    curl -s -H "Content-Type: application/json" -d "{\"content\":\"$PING 🔴 **JARVIS DOWN** - PM2 process not running! Attempting restart...\"}" "$WEBHOOK"
    pm2 restart jarvis 2>&1 || curl -s -H "Content-Type: application/json" -d "{\"content\":\"$PING ❌ **RESTART FAILED** - Manual intervention needed!\"}" "$WEBHOOK"
fi

# Auto-deploy check
git fetch origin main 2>&1
if [ $? -ne 0 ]; then
    curl -s -H "Content-Type: application/json" -d "{\"content\":\"$PING ⚠️ **Git fetch failed** - Check VPS network/credentials\"}" "$WEBHOOK"
    exit 1
fi

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

if [ "$LOCAL" != "$REMOTE" ]; then
    git pull origin main 2>&1
    if [ $? -ne 0 ]; then
        curl -s -H "Content-Type: application/json" -d "{\"content\":\"$PING ❌ **Git pull failed** - Merge conflict or error\"}" "$WEBHOOK"
        exit 1
    fi
    pm2 restart jarvis 2>&1
    if [ $? -ne 0 ]; then
        curl -s -H "Content-Type: application/json" -d "{\"content\":\"$PING ❌ **PM2 restart failed** after deploy\"}" "$WEBHOOK"
        exit 1
    fi
    curl -s -H "Content-Type: application/json" -d "{\"content\":\"✅ **Deployed successfully** - $(git log -1 --pretty=%s)\"}" "$WEBHOOK"
fi' > /home/admin/auto-deploy.sh && chmod +x /home/admin/auto-deploy.sh && (crontab -l 2>/dev/null | grep -v auto-deploy; echo "* * * * * /home/admin/auto-deploy.sh >> /home/admin/deploy.log 2>&1") | crontab -
```

**Features:**
- ✅ Deploys automatically when you push to `origin/main`
- 🔴 Pings you if PM2 process is down and tries to restart
- ⚠️ Pings you if git fetch/pull fails
- 📋 Auto-rotates logs (keeps last 500 lines)
- ✅ Success message with commit title (no ping)

Replace `YOUR_DISCORD_WEBHOOK_URL` and `YOUR_DISCORD_USER_ID` with your values. Verify with: `crontab -l`

### PM2 Error Logger (Discord Alerts)

Monitor your bot for errors and get instant Discord notifications:

```bash
# Set your webhook URL and owner ID
export PM2_ERROR_WEBHOOK="https://discord.com/api/webhooks/..."
export OWNER_DISCORD_ID="YOUR_DISCORD_USER_ID"

# Run the error logger alongside your bot
pm2 start scripts/pm2-error-logger.js --name "jarvis-logger"

# Or add both to ecosystem.config.js:
# apps: [
#   { name: 'jarvis', script: 'index.js', ... },
#   { name: 'jarvis-logger', script: 'scripts/pm2-error-logger.js', ... }
# ]
```

**Features:**
- 🚨 Instant Discord alerts for ReferenceError, TypeError, SyntaxError, etc.
- 🔕 Rate limiting (max 5 alerts per minute)
- 🔄 Deduplication (same error won't spam for 5 minutes)
- 📋 Stack traces included in alerts
- 🟢 Startup notification when logger starts

### Option 3: Docker Deployment

```bash
cd docker
docker-compose up -d
```

This starts:
- Jarvis bot
- MongoDB (with persistent volume)
- Lavalink (for music)
- yt-cipher (YouTube support)

### Option 4: Systemd Service

```bash
# Copy service file
sudo cp scripts/jarvis.service /etc/systemd/system/

# Edit paths in the service file
sudo nano /etc/systemd/system/jarvis.service

# Enable and start
sudo systemctl daemon-reload
sudo systemctl enable jarvis
sudo systemctl start jarvis
```

### Health Monitoring

```bash
# Run health check script (cron-compatible)
./scripts/health-check.sh

# Add to crontab for auto-restart
crontab -e
# Add: */5 * * * * /path/to/jarvis-ai/scripts/health-check.sh
```

### OAuth Redirect URLs

Add to [Discord Developer Portal](https://discord.com/developers/applications):

```
http://YOUR_IP:3000/auth/discord/callback
http://YOUR_IP:3000/auth/callback
http://YOUR_IP:3000/moderator/callback
```

---

## Database Migration

### Migrate from Atlas/Render to Local MongoDB

When switching from cloud MongoDB (Atlas) to local MongoDB:

```bash
# 1. Check current status
node scripts/migrate-to-local.js --check

# 2. Full clone: Atlas → Local MongoDB
node scripts/migrate-to-local.js --clone

# 3. Or just export to JSON (backup)
node scripts/migrate-to-local.js
```

### Migration Commands

| Command | Description |
|---------|-------------|
| `--check` | Show migration status |
| `--clone` | Full clone: Remote → JSON → Local MongoDB |
| `--to-local-mongo` | Import JSON export to local MongoDB |
| `--import` | Import JSON to local file-based DB |
| `--restore` | Restore from backup |
| `--backups` | List available backups |

### After Migration

Update your `.env`:

```env
# Local MongoDB
MONGO_URI_MAIN=mongodb://localhost:27017/jarvis_local
MONGO_URI_VAULT=mongodb://localhost:27017/jarvis_vault

# Enable selfhost
SELFHOST_MODE=true
DEPLOY_TARGET=selfhost
```

### Backup & Safety

The migration script automatically:
- Creates backups before any sync
- Keeps last 5 backups
- Allows restore anytime with `--restore`

---

## Raspberry Pi Setup

### Quick Start

```bash
# 1. Install MongoDB
sudo apt update
sudo apt install -y mongodb
sudo systemctl enable mongodb

# 2. Clone and setup
git clone https://github.com/not-antoni/jarvis-ai.git
cd jarvis-ai
npm install

# 3. Run setup wizard
node scripts/selfhost-setup.js

# 4. Migrate data from cloud
node scripts/migrate-to-local.js --clone

# 5. Start with PM2
pm2 start ecosystem.config.js
pm2 save
```

### Recommended Pi Settings

```env
# Lower resource usage
UV_THREADPOOL_SIZE=4
YTDLP_MAX_DURATION=600
YTDLP_MAX_FILESIZE_MB=30

# Use local MongoDB
MONGO_URI_MAIN=mongodb://localhost:27017/jarvis_ai
```

See [SELFHOST.md](SELFHOST.md) for complete documentation.

---

## Commands

| Category | Commands |
|----------|----------|
| **Economy** | `/balance` `/daily` `/work` `/gamble` `/slots` `/coinflip` `/shop` `/buy` `/give` `/leaderboard` `/vote` |
| **Minigames** | `/hunt` `/fish` `/dig` `/beg` |
| **Fun** | `/rapbattle` `/roast` `/soul` `/trivia` `/scramble` `/meme` |
| **AI** | `/jarvis` `/persona` `/search` |
| **Music** | `/play` `/skip` `/pause` `/resume` `/stop` `/queue` |
| **Utility** | `/help` `/ping` `/avatar` `/serverinfo` |

---

## Legacy Text Commands (`*j`)

Legacy text commands use the `*j` prefix and are enabled when Message Content intent is active:

```env
DISCORD_ENABLE_MESSAGE_CONTENT=true
```

### Command Categories (6 pages)

| Page | Category | Commands |
|------|----------|----------|
| 1 | Fun | `*j roast` `*j soul` `*j 8ball` `*j dadjoke` `*j pickupline` `*j rate` `*j roll` |
| 2 | Social | `*j ship` `*j hug` `*j slap` `*j fight` `*j howgay` `*j howbased` `*j vibecheck` |
| 3 | Economy | `*j balance` `*j daily` `*j work` `*j gamble` `*j slots` `*j coinflip` `*j leaderboard` |
| 4 | Minigames | `*j hunt` `*j fish` `*j dig` `*j beg` `*j tinker` `*j recipes` `*j contract` |
| 5 | Shop | `*j shop` `*j buy` `*j inventory` `*j reactor` (Arc Reactor perks) |
| 6 | Utility | `*j help` `*j ping` `*j remind` `*j kick` `*j enable moderation` |

### Arc Reactor (💠)

The legendary 10,000 coin item grants real perks:
- **+15%** earnings on ALL activities
- **-25%** cooldown on ALL commands  
- **+5%** gambling win rate
- **+500** daily reward bonus
- **+1%** daily interest on balance

## Configuration

See `config/index.js` for all configuration options.

Key files:
- `.env` - Environment variables (secrets)
- `config/index.js` - App configuration
- `src/core/feature-flags.js` - Toggle features

## AI proxy rotation (Cloudflare Workers)

Jarvis can proxy AI HTTP requests through a pool of Cloudflare Workers endpoints (round-robin or random). This only applies to allowed AI hosts (e.g. `api.openai.com`, `openrouter.ai`, `api.groq.com`, `ai-gateway.vercel.sh`).

### Enable via `.env`

```env
AI_PROXY_ENABLED=true
AI_PROXY_URLS=https://your-worker-1.workers.dev/,https://your-worker-2.workers.dev/
AI_PROXY_STRATEGY=round_robin
AI_PROXY_TOKEN=your_shared_secret
AI_PROXY_DEBUG=true
AI_PROXY_FALLBACK_DIRECT=true
AI_PROXY_AUTO_PROVISION=false
AI_PROXY_SAVE_TO_DB=true
AI_PROXY_WORKERS_COUNT=3
AI_PROXY_WORKER_PREFIX=jarvis-ai-proxy
AI_PROXY_SET_WORKER_TOKEN=true
```

Important:

- **`AI_PROXY_ENABLED=true` is not enough by itself**. You must also configure `AI_PROXY_URLS` (or have them stored in MongoDB via the provisioning script).

### Auto-provision at runtime (optional)

If you set Cloudflare credentials and want Jarvis to automatically deploy workers on demand:

```env
AI_PROXY_ENABLED=true
AI_PROXY_URLS=
AI_PROXY_AUTO_PROVISION=true
CLOUDFLARE_ACCOUNT_ID=...
CLOUDFLARE_API_TOKEN=...
AI_PROXY_TOKEN=...
```

On the first eligible AI HTTP request, Jarvis will:

- Deploy `AI_PROXY_WORKERS_COUNT` workers (default 3) under `AI_PROXY_WORKER_PREFIX`
- Enable `workers.dev`
- Save the resulting URLs to MongoDB (when `AI_PROXY_SAVE_TO_DB=true`)

If you still see:

`[AIProxy] AI proxying is enabled but no proxy URLs are configured...`

then either:

- Your Cloudflare env vars are missing/invalid
- Auto-provision is disabled (`AI_PROXY_AUTO_PROVISION=false`)
- Or MongoDB is unavailable and no `AI_PROXY_URLS` were provided

### Provision Workers automatically

Use the included script:

```bash
npm run provision:ai-proxies
```

It will deploy workers, print the URLs, and (by default) save them to MongoDB.

### Test rotation

```bash
node scripts/test-ai-proxy-rotation.js
```

## Website

Jarvis includes a full website at your configured domain (or IP:PORT):

| Page | URL | Description |
|------|-----|-------------|
| **Home** | `/` | Landing page with Discord invite |
| **Status** | `/status` | Live bot status, uptime, health |
| **Commands** | `/commands` | Searchable command list |
| **Leaderboard** | `/leaderboard` | Public economy rankings |
| **Store** | `/store` | SBX item shop |
| **SBX Exchange** | `/sbx` | Starkbucks info & trading |
| **Crypto** | `/crypto` | Stark Crypto trading |
| **Docs** | `/docs` | Self-hosting guide |

### SBX News API

Add funny "company" news to the SBX exchange that can affect stock prices:

```bash
# Add news (site owner only) - replace YOUR_DOMAIN with your actual domain!
curl -X POST https://YOUR_DOMAIN/api/sbx/news \
  -H "Content-Type: application/json" \
  -d '{
    "headline": "BREAKING: Tony Stark spotted buying coffee with SBX",
    "priceImpact": 0.02,
    "secretKey": "YOUR_BOT_OWNER_ID"
  }'

# Get news feed
curl https://YOUR_DOMAIN/api/sbx/news?limit=10

# Clear all news
curl -X DELETE https://YOUR_DOMAIN/api/sbx/news \
  -H "Content-Type: application/json" \
  -d '{"secretKey": "YOUR_BOT_OWNER_ID"}'
```

**Note:** Replace `YOUR_DOMAIN` with your actual site (e.g., `jarvis.example.com` or `123.45.67.89:3000`)

| Parameter | Description |
|-----------|-------------|
| `headline` | News text (max 280 chars) |
| `priceImpact` | Optional: -0.05 to +0.05 (e.g., 0.02 = +2% price) |
| `secretKey` | Your `BOT_OWNER_ID` or custom `SBX_NEWS_SECRET` |

Other pages: `/changelog` (Version history), `/tos` (Terms), `/policy` (Privacy)

### Discord OAuth (optional)

Enable user login on the website:

```env
DISCORD_CLIENT_ID=your_client_id
DISCORD_CLIENT_SECRET=your_client_secret
PUBLIC_BASE_URL=https://your-domain.com
```

Add redirect URI to Discord Developer Portal:
```
https://your-domain.com/auth/callback
```

### Custom Domain (Cloudflare)

Jarvis can auto-configure SSL via Cloudflare Origin Certificates:

```env
CLOUDFLARE_API_TOKEN=your_token
CLOUDFLARE_ZONE_ID=your_zone_id
PUBLIC_DOMAIN=yourdomain.com
```

**Note:** If you lose Cloudflare/domain access, the site remains accessible at your VPS IP:PORT (e.g., `http://123.45.67.89:3000`).

---

## Dashboard

The bot serves a built-in dashboard UI:

- `/dashboard` - UI (static build from `dashboard/dist`)
- `/api/dashboard/*` - JSON API consumed by the UI

### Dashboard login

- If `DASHBOARD_PASSWORD` (or `PASSWORD`) is **unset/empty**, the dashboard is **open**.
- If it’s set, you must log in at `/dashboard/login`.

**Important:** Use `DASHBOARD_PASSWORD` instead of `PASSWORD`. `PASSWORD` is a very generic env var name and is commonly overridden by hosting platforms or other tooling, which results in “wrong password” even when your `.env` looks correct.

If you changed the password, also clear the auth cookie by visiting `/dashboard/logout` (or clear cookies) and try again.

## Webhook

The service exposes `/webhook` for Discord interaction webhooks and verifies the request signature (requires `DISCORD_WEBHOOK_PUBLIC_KEY`).

## Diagnostics

If enabled, agent diagnostics are mounted under `/diagnostics/health/agent/*`.

## Tests

`npm test` runs only the `node:test`-based unit tests (auto-discovered).

Some test files in `tests/` are manual/integration scripts and are intentionally excluded from `npm test`.
To run them:

```bash
npm run test:manual
```

---

## Project Structure

```
jarvis-ai/
├── index.js                 # Entry point
├── config/                  # Configuration
├── src/
│   ├── agents/              # AI agents
│   ├── commands/            # Slash commands
│   ├── core/                # Core systems
│   ├── services/            # Main services
│   │   ├── stark-economy.js # Economy system
│   │   ├── jarvis-core.js   # AI chat
│   │   └── discord-handlers-parts/
│   └── utils/               # Utilities
├── routes/                  # Express routes
└── tests/                   # Test suite
```

---

## Contributing

1. Fork the repo
2. Create a branch (`git checkout -b feature/thing`)
3. Commit (`git commit -m 'Add thing'`)
4. Push (`git push origin feature/thing`)
5. Open a PR

---

## License

Apache License 2.0. See [LICENSE](LICENSE) for details.

**Disclaimer:** "J.A.R.V.I.S." and Iron Man references are fan content. Not affiliated with Marvel or Disney.

---

## API Key Auto-Discovery

Jarvis automatically discovers all API keys matching these patterns:

```env
# These are auto-discovered (add as many as you want)
OPENROUTER_API_KEY=...
OPENROUTER_API_KEY2=...
OPENROUTER_API_KEY3=...
# ... OPENROUTER_API_KEY99, etc.

OLLAMA_API_KEY=...
OLLAMA_API_KEY2=...
# ... any number
```

No code changes needed - just add keys to `.env` and restart.

---

Made by [not-antoni](https://github.com/not-antoni)

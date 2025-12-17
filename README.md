# J.A.R.V.I.S. AI

**Just A Rather Very Intelligent System** — A feature-rich Discord bot inspired by Tony Stark's AI assistant.

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Discord.js](https://img.shields.io/badge/discord.js-v14-blue.svg)](https://discord.js.org)
[![Node.js](https://img.shields.io/badge/node-24.12.0-green.svg)](https://nodejs.org)

> **145 JavaScript files • 51,000+ lines of code • 100% open source**

---

## Table of Contents

- [Features](#features)
- [Quick Start](#quick-start)
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

## Self-Hosting (VPS)

For running Jarvis on your own VPS instead of Render.

### Quick Start

```bash
# Run the interactive setup wizard
node scripts/selfhost-setup.js

# Or verify your current configuration
node scripts/selfhost-setup.js --verify
```

### Selfhost Environment Variables

```env
# Enable selfhost mode
DEPLOY_TARGET=selfhost
SELFHOST_MODE=true
PUBLIC_BASE_URL=http://YOUR_VPS_IP:3000

# yt-dlp / ffmpeg (prevents VPS overload)
FFMPEG_PATH=/usr/bin/ffmpeg
YTDLP_MAX_DURATION=900      # Max 15 minutes (music, not documentaries)
YTDLP_MAX_FILESIZE_MB=50    # Max 50MB per video
```

### Production Setup (PM2)

```bash
# Install PM2
sudo npm install -g pm2

# Start with auto-restart
pm2 start index.js --name "jarvis" --max-memory-restart 500M

# Auto-start on boot
pm2 startup && pm2 save

# View logs
pm2 logs jarvis
```

### OAuth Redirect URLs

After getting your VPS IP, add these to [Discord Developer Portal](https://discord.com/developers/applications):

```
http://YOUR_VPS_IP:3000/auth/discord/callback
http://YOUR_VPS_IP:3000/moderator/callback
```

### System Requirements

- **Node.js 18+** (recommended)
- **ffmpeg** - `sudo apt install ffmpeg`
- **PM2** - `sudo npm install -g pm2`

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

## Legacy text commands (`.j`)

Legacy text commands are enabled only when the Message Content intent is enabled:

```env
DISCORD_ENABLE_MESSAGE_CONTENT=true
```

Examples:

- `.j help`
- `.j ping`
- `.j remind in 5 minutes check the oven`
- `.j kick @user [reason]`

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

## Acknowledgments

- [discord.js](https://discord.js.org/) - Discord API
- [ppbot](https://github.com/schlopp/ppbot) - Economy inspiration
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) - YouTube downloads

---

Made by [not-antoni](https://github.com/not-antoni)

Copyright (C) 2026 not-antoni

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.


# J.A.R.V.I.S.

**Just A Rather Very Intelligent System** — A feature-rich Discord bot inspired by Tony Stark's AI assistant.

**OFFICIAL SITE**: https://jorvis.org/

[![License](https://img.shields.io/badge/license-Proprietary-red.svg)](LICENSE)
[![Discord.js](https://img.shields.io/badge/discord.js-v14-blue.svg)](https://discord.js.org)
[![Node.js](https://img.shields.io/badge/node-24.12.0-green.svg)](https://nodejs.org)

> [!IMPORTANT]
> **Production Requirement**: This project **REQUIRES** Node.js **v24.12.0** exactly to function correctly in production (as defined in `render.yaml`). Using other versions may lead to instability or errors.

---

## Features

### AI Chat
Multi-provider AI with OpenAI, OpenRouter, Groq, Cerebras, SambaNova, Mistral, Google Gemini, NVIDIA NIM, Vercel AI Gateway, and Ollama support. Context-aware conversations with encrypted per-user memory vault.

### Music
Native Discord voice playback via `@discordjs/voice` + `yt-dlp`.
- **Sources**: YouTube + SoundCloud
- **File Uploads**: Drag & drop MP3/FLAC/OGG files directly into chat
- **Smart Queue**: Mix YouTube/SoundCloud links and uploaded files seamlessly
- **Fast Start**: Live `yt-dlp -> ffmpeg` stream path with automatic fallback

### Moderation
- **Server Stats**: Auto-updating stat channels
- **Member Log**: Join/leave announcements

### Utility
`/jarvis` `/yt` `/news` `/remind` `/timezone` `/caption` `/gif` `/avatar` `/banner` `/clip` `/profile` `/history` `/digest` `/help` `/wakeword`

### Fun
`/ship`

---

## Quick Start
```bash
git clone https://github.com/not-antoni/jarvis-ai.git
cd jarvis-ai
npm install
cp .env.example .env  # Edit with your tokens
npm start
```

> [!NOTE]
> **Runtime**: Discord voice + DAVE support requires **Node 22.12+**.
> **Python**: Not required when using the bundled standalone `yt-dlp` binary.

### Required Environment Variables

```env
DISCORD_TOKEN=your_bot_token
MONGO_URI_MAIN=mongodb://localhost:27017/jarvis_ai
MONGO_URI_VAULT=mongodb://localhost:27017/jarvis_vault
MASTER_KEY_BASE64=base64_32_byte_key
```

### Optional

```env
# Health
HEALTH_TOKEN=...

# AI providers (configure at least one)
OPENROUTER_API_KEY=...
GROQ_API_KEY=...
CEREBRAS_API_KEY=...
SAMBANOVA_API_KEY=...
MISTRAL_API_KEY=...
GOOGLE_AI_API_KEY=...
OPENAI_API_KEY=...
NVIDIA_API_KEY=...
AI_GATEWAY_API_KEY=...       # Vercel AI Gateway

# SoundCloud API
SOUNDCLOUD_CLIENT_ID=...
SOUNDCLOUD_CLIENT_SECRET=...

# Cloudflare Workers AI proxy
CLOUDFLARE_WORKER_URL=...
AI_PROXY_TOKEN=...

# Extras
BRAVE_API_KEY=...
YOUTUBE_API_KEY=...
OLLAMA_API_KEY=...
```

---

## Deployment Modes

| Mode | `DEPLOY_TARGET` | Use Case |
|------|-----------------|----------|
| **Render** | `render` (default) | Cloud hosting on Render.com |
| **Selfhost** | `selfhost` | VPS, Raspberry Pi, home server |
| **Hybrid** | `hybrid` | Auto-detects based on environment |

```env
DEPLOY_TARGET=selfhost
SELFHOST_MODE=true
```

---

## Self-Hosting Guide

### Quick Setup

```bash
node scripts/selfhost-setup.js   # Interactive setup
node scripts/selfhost-check.js   # Verify configuration
```

### Manual Setup

#### 1. Environment Variables

```env
DEPLOY_TARGET=selfhost
SELFHOST_MODE=true
PUBLIC_BASE_URL=http://YOUR_IP:3000
MONGO_URI_MAIN=mongodb://localhost:27017/jarvis_ai
MONGO_URI_VAULT=mongodb://localhost:27017/jarvis_vault
MASTER_KEY_BASE64=<generate with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))">
```

#### 2. System Dependencies

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install -y ffmpeg mongodb git fonts-noto fonts-noto-cjk fonts-noto-color-emoji
fc-cache -fv

# Amazon Linux/RHEL
sudo dnf install -y git ffmpeg google-noto-sans-fonts google-noto-serif-fonts google-noto-emoji-fonts dejavu-sans-fonts google-noto-cjk-fonts
fc-cache -fv
```

#### 3. Run with PM2

```bash
pm2 start ecosystem.config.js
pm2 startup && pm2 save
pm2 logs jarvis
```

### Systemd Alternative

```bash
sudo cp scripts/jarvis.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable jarvis
sudo systemctl start jarvis
```

---

## Database Migration

Migrate from cloud MongoDB (Atlas) to local:

```bash
node scripts/migrate-to-local.js --check   # Check status
node scripts/migrate-to-local.js --clone    # Full clone: Remote -> Local
```

| Flag | Description |
|------|-------------|
| `--check` | Show migration status |
| `--clone` | Full clone to local MongoDB |
| `--to-local-mongo` | Import JSON to local MongoDB |
| `--restore` | Restore from backup |
| `--backups` | List available backups |

---

## Troubleshooting

### Music - Python Version Error
yt-dlp requires Python 3.10+. Fix: `sudo dnf install -y python3.11 && sudo alternatives --set python3 /usr/bin/python3.11`

### Music - yt-dlp Not Found
Jarvis downloads `yt-dlp` at runtime. Check logs: `pm2 logs jarvis --lines 100 | grep -i ytdlp`

### Database Connection Failed
```bash
sudo systemctl status mongod
sudo systemctl start mongod
sudo systemctl enable mongod
```

### Bot Not Responding
1. `pm2 status jarvis`
2. `pm2 logs jarvis --lines 50`
3. Verify `DISCORD_TOKEN` in `.env`
4. Restart bot to re-register slash commands

---

## AI Proxy Rotation (Cloudflare Workers)

Proxy AI requests through a pool of Cloudflare Workers (round-robin/random):

```env
AI_PROXY_ENABLED=true
AI_PROXY_URLS=https://worker-1.workers.dev/,https://worker-2.workers.dev/
AI_PROXY_STRATEGY=round_robin
AI_PROXY_TOKEN=your_shared_secret
AI_PROXY_BYPASS_HOSTS=generativelanguage.googleapis.com
AI_PROXY_FALLBACK_DIRECT=true
```

Auto-provision workers: `npm run provision:ai-proxies`

`generativelanguage.googleapis.com` is bypassed by default. Gemini rate limits are tied to your Google project/key, so rotating Cloudflare workers tends to amplify `429` responses instead of helping. Set `AI_PROXY_BYPASS_HOSTS=` if you explicitly want Google requests proxied.

---

## API Key Auto-Discovery

Jarvis auto-discovers numbered API keys:

```env
OPENROUTER_API_KEY=...
OPENROUTER_API_KEY2=...
OPENROUTER_API_KEY3=...
OLLAMA_API_KEY=...
OLLAMA_API_KEY2=...
```

No code changes needed — just add keys and restart.

---

## Tests

```bash
npm test              # Unit tests (node:test)
npm run test:manual   # Manual/integration tests
```

---

## Project Structure

```
jarvis-ai/
├── index.js              # Entry point
├── config/               # Configuration
├── src/
│   ├── commands/         # Slash command definitions
│   ├── core/             # Core systems (feature flags, cooldowns, registry)
│   ├── services/         # Main services (AI, music, moderation, handlers)
│   └── utils/            # Utilities
├── routes/               # Express routes
└── tests/                # Test suite
```

---

## Contributing

1. Fork the repo
2. Create a branch (`git checkout -b feature/thing`)
3. Commit (`git commit -m 'Add thing'`)
4. Push and open a PR

---

## License

Proprietary. See [LICENSE](LICENSE) for details.

**Disclaimer:** "J.A.R.V.I.S." and Iron Man references are fan content. Not affiliated with Marvel or Disney.

---

Made by [not-antoni](https://github.com/not-antoni)

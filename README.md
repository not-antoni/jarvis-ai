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
Multi-provider AI with OpenAI, Anthropic Claude, Google Gemini, Cohere, and local Ollama support. Context-aware conversations with switchable personas.

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

## Configuration

See `config/index.js` for all configuration options.

Key files:
- `.env` - Environment variables (secrets)
- `config/index.js` - App configuration
- `src/core/feature-flags.js` - Toggle features

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

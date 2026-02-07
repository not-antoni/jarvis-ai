# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Run the bot
npm start                    # node index.js

# Tests (uses node:test built-in, no framework)
npm test                     # Runs all *.test.js files under tests/ that import node:test
node --test tests/utils/sanitize.test.js   # Run a single test file

# Lint & format
npm run lint                 # eslint . --ext .js
npm run lint:fix
npm run format               # prettier --write
npm run format:check

# Deploy slash commands to Discord
npm run verify               # node scripts/deploy.js

# Database migrations
npm run migrate              # node scripts/run-migrations.js

# Dashboard (separate React+Vite app)
cd dashboard && npm run dev
```

## Architecture

### Entry Point & Boot Sequence
`index.js` is the main entry. It initializes: dotenv, Discord.js Client, Express server, MongoDB connection, AI providers, cron jobs (nightly dump, announcement scheduler, monitor scheduler), then registers Discord event listeners that delegate to `discordHandlers`.

### Handler Concatenation System (Critical)
`src/services/discord-handlers.js` does NOT export a normal module. It reads all `src/services/discord-handlers-parts/part-*.js` files, concatenates their source code, and compiles the combined string via `module._compile()`. This means:
- All part files share the same scope (variables, requires, class definition)
- `part-00.js` contains all `require()` imports and the `DiscordHandlers` class constructor
- `part-01.js` through `part-06.js` contain class methods that are part of the same class body
- You cannot add new `require()` statements in part-01 through part-06; add them to part-00.js
- `EXPECTED_PARTS_COUNT = 7` — update this in discord-handlers.js if adding/removing part files

### Part File Responsibilities
- **part-00.js**: All imports, class constructor, guild config caching (3-layer: LRU memory → disk JSON → MongoDB), utility methods
- **part-01.js**: `handleMessage()` — main message event handler, attachment processing, URL extraction
- **part-02.js**: Message routing — wakeword detection, AI response generation, channel/DM handling
- **part-03.js**: AI response delivery, conversation context building, anti-repetition logic
- **part-04.js**: Feature command handlers (reaction roles, announcements, monitor, clip, meme, crypto, trivia, jokes, memory, persona) — ~3250 lines
- **part-05.js**: `handleSlashCommand()` — massive switch statement routing 70+ slash commands — ~4850 lines
- **part-06.js**: Smaller command handlers (wakeword, remind, timezone, mystats)

### AI Provider System
`src/services/ai-providers.js` manages multi-provider AI with automatic failover. Supported providers: OpenRouter, Groq, Google Gemini, OpenAI, Cloudflare Workers AI, Ollama, AI proxy (self-hosted Cloudflare Workers). Provider priority and failover are configured in `config/index.js` under `config.ai.providers`.

### Core AI Personality
`src/services/jarvis-core.js` contains `getBasePrompt()` (the JARVIS persona), conversation context assembly, encoding/decoding utilities, and the math solver bridge. The bot's personality is JARVIS from the MCU — dry British wit, addresses users as "sir".

### Economy System
`src/services/stark-economy.js` — Stark Bucks virtual economy (80+ functions). Config data (ECONOMY_CONFIG, SHOP_ITEMS, SLOT_SYMBOLS, MINIGAME_REWARDS) has been extracted to `src/services/economy/config.js`. Includes gambling, daily rewards, shop, crafting, pets, heists, bosses, quests, tournaments, auction house, SBX cryptocurrency.

### Database Layer
- `src/services/database.js` — Main DatabaseManager class wrapping MongoDB with LRU caches
- `src/services/db.js` — Low-level MongoDB connection (connectMain, getJarvisDb)
- `src/localdb.js` — JSON file-based fallback when `LOCAL_DB_MODE=1` (no MongoDB required)
- `src/services/guild-config-cache.js` — Disk-level JSON cache for guild configs

### Feature Flags
`src/core/feature-flags.js` provides `isFeatureGloballyEnabled()` and `isFeatureEnabledForGuild()`. Global flags are set in `config/index.js` under `config.features`. Per-guild overrides are stored in guild config documents in MongoDB.

### Command Registry
`src/core/command-registry.js` — Central registry mapping command names to feature flags, categories, and ephemeral status. Used for feature gating and help generation.

### Web Server
Express server defined in `index.js` with routes in `routes/` (dashboard, user-auth, webhook, companies, starkbucks, public-api, landing, legal, pages). Dashboard is a separate React+Vite app in `dashboard/`.

### Agent Infrastructure
`src/agents/` contains browser automation (Puppeteer), agent monitoring, retry policies, auto-healing, captcha handling, cost rate limiting, and the sentient agent system (`sentient-core`).

### Math Engine
`src/services/math-engine.js` runs nerdamer in a sandboxed worker thread (`math-worker.js`) with timeout protection. Supports algebra, calculus, random operations, dice rolls, and statistical functions.

## Code Style
- 4-space indentation, single quotes, semicolons, no trailing commas
- Prefix unused variables with `_` (eslint: `argsIgnorePattern: '^_'`)
- `no-var` enforced — use `const`/`let`
- Prettier: 120 char line width, arrow parens `avoid`

## Deployment Modes
The bot runs in three modes controlled by `DEPLOY_TARGET` env var:
- **render**: Hosted on Render.com, uses MongoDB Atlas
- **selfhost**: Local/VPS deployment, can use local MongoDB
- **hybrid**: Auto-detects environment (recommended)

Set `LOCAL_DB_MODE=1` to run without MongoDB (uses JSON file storage in `data/`).

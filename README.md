# J.A.R.V.I.S.

**Just A Rather Very Intelligent System** - a feature-rich Discord bot inspired by Tony Stark's AI assistant. Multi-provider AI chat, native music playback, moderation suite, strike system, web search, and a Discord-OAuth portal for server admins.

**Official site**: https://jorvis.org/

[![License](https://img.shields.io/badge/license-GPLv3-red.svg)](LICENSE)
[![Discord.js](https://img.shields.io/badge/discord.js-v14-blue.svg)](https://discord.js.org)
[![Node.js](https://img.shields.io/badge/node-24.12.0-green.svg)](https://nodejs.org)

> [!IMPORTANT]
> **Production runtime**: Node **v24.12.0** (as pinned in `render.yaml` / `Dockerfile`). Node 22.12+ is the minimum for Discord DAVE/voice; other versions may misbehave.

---

## Features

### AI chat
Multi-provider failover across OpenAI, OpenRouter, Groq, Cerebras, SambaNova, Mistral, Google Gemini, NVIDIA NIM, Vercel AI Gateway, Bedrock, and Ollama. Per-user encrypted memory vault, guild-aware context, automatic failover with cost-tier priority, and poisoned-output detection.

### Web search (Brave)
- **Automatic prompt augmentation only** (no slash command anymore - `/search` was removed in #268). Whenever a user's question trips a *time-sensitive* signal - latest/today/right-now, score/standing/result, price/cost/rate/quote/value/worth, oldest/highest/cheapest, an explicit year, etc. - Jarvis transparently fetches Brave results and injects them as an authoritative `[WEB_SEARCH]` context block.
- **Always fires on explicit search verbs** - "search this", "google that", "look it up", "find me info on…", "research this for me" - so the user can force a lookup any time without memorising magic words.
- **Freshness filter** - Brave is called with `freshness=pd|pw|pm|py` based on the prompt's recency cue, so live data ("today", "latest", "current") returns results from the right time window instead of stale SERPs (#259 follow-up).
- **SafeSearch is `strict` by default** - both web and image. NSFW SERPs are a prompt-poisoning surface (the model would ingest them as authoritative context). Override with `BRAVE_SAFESEARCH=off|moderate|strict` and `BRAVE_IMAGE_SAFESEARCH=…`.
- **Image / GIF support** - image-flavoured prompts (`gif`, `meme`, `sticker`, `wallpaper`, `image of …`) route to Brave Images and dedupe by media URL.
- Conservative heuristic, cached (LRU + freshness-aware key), 3.5s hard timeout so the search never blocks the reply.
- Strict prompt rule: when a `[WEB_SEARCH]` / `[IMAGE_SEARCH]` block is present the model uses only that evidence and refuses to guess prices, dates, or quotations.

### Music
Native Discord voice via `@discordjs/voice` + `yt-dlp`.
- **Sources**: YouTube, SoundCloud, direct file uploads (MP3/FLAC/OGG).
- **Commands**: `/play` `/pause` `/resume` `/skip` `/stop` `/queue` `/loop` `/dj` `/nowplaying` `/clearqueue`.
- `/nowplaying` renders a live progress bar that auto-refreshes every 6 s.
- `/clearqueue` wipes pending tracks without interrupting the current one.

### Moderation
- `/purge count:<1–100> [user]` - bulk delete, optionally filtered to one member.
- `/timeout user duration:<10m|2h|1d> [reason]` - duration parser accepts `30s`, `10m`, `1h30m`, `2d`, bare numbers (minutes), up to Discord's 28-day cap.
- `/untimeout` · `/kick` · `/ban [delete_days:0–7]` · `/unban user|user_id:<id> [reason]` (#261/#254 - accepts a member picker *or* a raw user ID for users who already left the guild).
- **Strike system** - `/warn add|list|remove|clear` with MongoDB-backed warnings. Relaxed default escalation (3 → 10m timeout, 5 → 1h timeout, 10 → auto-kick). All thresholds env-tunable; no auto-ban.
- Moderator authorization: guild owner, `Administrator`/`ManageGuild`, or users/roles listed in the guild config.
- **AutoMod**: per-guild rules via `/automod`.
- **Server stats & member log**: auto-updating stat channels and join/leave announcements.

### Web portal (`/portal`)
Discord OAuth2 login with signed session cookies.
- Guild picker shows every server where you're a moderator.
- Edit feature toggles, AI chat channel, moderator roles, wake word.
- Server-rendered HTML + vanilla JS; no build step.
- **Fast hydration** (#271): the user info paints immediately from the session via the lightweight `/portal/api/user` endpoint, while `/portal/api/me` resolves manageable guilds in the background using a per-user cache (`PORTAL_GUILDS_CACHE_TTL_MS`, default 60s) and a bounded REST fan-out (`PORTAL_GUILDS_MAX_FETCHES`, default 25). No more "wait three hours for the guild list" while the bot gets rate-limited.

### Utility
`/jarvis` `/yt` `/news` `/remind` `/timezone` `/caption` `/gif` `/avatar` `/banner` `/clip` `/profile` `/help` `/userinfo` `/serverinfo` `/wakeword` `/blacklist` `/channel` `/features` `/ping` (replies directly with no `editReply` round-trip - saves bot quota, #272).

### Fun
`/ship` `/memory` `/clear` `/invite`

### Edge security & AI safety (#262 / #265 / #266 / #273)
- **`security-guard` middleware** runs ahead of routes and gates by:
  - **ASN block** - `BLOCKED_ASNS=14061,16276,…` reads the `cf-asn` (or `x-asn`) header set by a Cloudflare transform rule.
  - **Country block** - `BLOCKED_COUNTRIES=ru,kp,…` reads `cf-ipcountry`.
  - **IP whitelist** - `IP_WHITELIST=1.2.3.4/32,5.6.0.0/16` with `IP_WHITELIST_MODE=soft` (only `/portal*`, admin & API routes are gated; landing/static stay public) or `strict` (whitelist enforced everywhere). Reads `cf-connecting-ip`.
- **Invisible-unicode scrub** - every AI output and every memory write goes through `stripInvisibleUnicode`, which removes zero-width / bidi / variation-selector / Tag-character payloads commonly used for prompt-poisoning and stego (full ranges in `src/services/ai/sanitize.js`).
- **Prompt-block rotation safety** - when a Gemini provider returns a content-policy refusal (`providerFault:false` / `promptBlocked`), the entire family is skipped for the rest of *that* request. One refusal can no longer burn the failover budget across 10+ Gemini keys.

---

## Quick start

```bash
git clone https://github.com/not-antoni/jarvis-ai.git
cd jarvis-ai
npm install
cp .env.example .env  # fill in secrets (see below)
npm start
```

### Docker

Multi-stage image with canvas/opus/sharp prebuilds, ffmpeg, and Python for yt-dlp:

```bash
docker compose up -d               # bot + mongo
docker compose logs -f jarvis      # follow logs
```

The compose file exposes `:3000` for the web server and persists `data/`, `logs/`, and MongoDB volumes.

> [!NOTE]
> yt-dlp is downloaded at runtime into a cache dir - no manual install required.

### Required environment variables

```env
DISCORD_TOKEN=your_bot_token
MONGO_URI_MAIN=mongodb://localhost:27017/jarvis_ai
MONGO_URI_VAULT=mongodb://localhost:27017/jarvis_vault
MASTER_KEY_BASE64=<node -e "console.log(require('crypto').randomBytes(32).toString('base64'))">
```

### Optional (power features)

```env
# --- Web portal (Discord OAuth2) ---
DISCORD_CLIENT_ID=...
DISCORD_CLIENT_SECRET=...
# PORTAL_CALLBACK_URL defaults to ${SITE_BASE_URL}/portal/callback - must be whitelisted in the Discord dev portal.

# --- Web search (Brave) ---
BRAVE_SEARCH_API_KEY=...            # BRAVE_API_KEY also accepted
WEB_SEARCH_AUTO=true                # set false to disable auto-augmentation
WEB_SEARCH_TIMEOUT_MS=3500
WEB_SEARCH_MAX_RESULTS=3

# --- Warn / strike thresholds ---
WARN_TIER1_COUNT=3 WARN_TIER1_TIMEOUT_MS=600000
WARN_TIER2_COUNT=5 WARN_TIER2_TIMEOUT_MS=3600000
WARN_TIER3_COUNT=10 WARN_TIER3_ACTION=kick    # or "none"
WARN_WINDOW_MS=2592000000                     # 30d window for tiers 1 & 2

# --- AI provider cooldowns ---
PERMANENT_QUOTA_BENCH_MS=7200000              # 2h bench after Google daily quota exhaustion

# --- AI providers (configure at least one) ---
OPENROUTER_API_KEY=... GROQ_API_KEY=... CEREBRAS_API_KEY=... SAMBANOVA_API_KEY=...
MISTRAL_API_KEY=... GOOGLE_AI_API_KEY=... OPENAI_API_KEY=... NVIDIA_API_KEY=...
AI_GATEWAY_API_KEY=...                        # Vercel AI Gateway

# --- Edge security guard (#262 / #265 / #266) ---
BLOCKED_ASNS=14061,16276                      # comma-separated AS numbers
BLOCKED_COUNTRIES=ru,kp                       # ISO 3166-1 alpha-2 codes
IP_WHITELIST=1.2.3.4/32,5.6.0.0/16            # CIDRs allowed to reach gated routes
IP_WHITELIST_MODE=soft                        # soft (portal+API) or strict (all routes)

# --- Portal cache tuning (#271) ---
PORTAL_GUILDS_CACHE_TTL_MS=60000              # per-user manageable-guilds cache
PORTAL_GUILDS_MAX_FETCHES=25                  # max REST member-fetches per /api/me

# --- SoundCloud ---
SOUNDCLOUD_CLIENT_ID=... SOUNDCLOUD_CLIENT_SECRET=...

# --- Cloudflare Workers AI proxy ---
AI_PROXY_ENABLED=true
AI_PROXY_URLS=https://worker-1.workers.dev/,...
AI_PROXY_STRATEGY=round_robin
AI_PROXY_TOKEN=...
AI_PROXY_FALLBACK_DIRECT=true

# --- Misc ---
HEALTH_TOKEN=... YOUTUBE_API_KEY=... OLLAMA_API_KEY=...
```

Full reference in [`.env.example`](.env.example).

---

## Deployment modes

| Mode | `DEPLOY_TARGET` | Use case |
|------|-----------------|----------|
| **Render** | `render` (default) | Cloud hosting on Render.com |
| **Selfhost** | `selfhost` | VPS, Raspberry Pi, home server |
| **Hybrid** | `hybrid` | Auto-detects based on environment |

```env
DEPLOY_TARGET=selfhost
SELFHOST_MODE=true
```

---

## Self-hosting guide

### Quick setup

```bash
node scripts/selfhost-setup.js    # interactive setup
node scripts/selfhost-check.js    # verify configuration
```

### Manual setup

#### 1. Environment variables

```env
DEPLOY_TARGET=selfhost
SELFHOST_MODE=true
PUBLIC_BASE_URL=http://YOUR_IP:3000
MONGO_URI_MAIN=mongodb://localhost:27017/jarvis_ai
MONGO_URI_VAULT=mongodb://localhost:27017/jarvis_vault
MASTER_KEY_BASE64=<generate with crypto.randomBytes(32).toString('base64')>
```

#### 2. System dependencies

```bash
# Ubuntu / Debian
sudo apt update && sudo apt install -y ffmpeg mongodb git fonts-noto fonts-noto-cjk fonts-noto-color-emoji
fc-cache -fv

# Amazon Linux / RHEL
sudo dnf install -y git ffmpeg google-noto-sans-fonts google-noto-serif-fonts google-noto-emoji-fonts dejavu-sans-fonts google-noto-cjk-fonts
fc-cache -fv
```

#### 3. Run with PM2

```bash
pm2 start ecosystem.config.js
pm2 startup && pm2 save
pm2 logs jarvis
```

### systemd alternative

```bash
sudo cp scripts/jarvis.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable jarvis
sudo systemctl start jarvis
```

### Portal OAuth setup

1. Go to https://discord.com/developers/applications → your app → OAuth2.
2. Add redirect URI `${SITE_BASE_URL}/portal/callback` (e.g. `https://jorvis.org/portal/callback`). Must match exactly.
3. Copy the **Client ID** and **Client Secret** into `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET`.
4. The portal auto-serves at `/portal` once those envs are set.

---

## Database migration

Migrate from cloud MongoDB (Atlas) to local:

```bash
node scripts/migrate-to-local.js --check   # status
node scripts/migrate-to-local.js --clone   # full clone: remote → local
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

### `Gemini blocked: PROHIBITED_CONTENT`
Google's immovable **input** safety filter (not controllable via `safetySettings`). The request fails over to another provider automatically - logged at `warn` with a `[ContentBlocked]` prefix, not `error`.
Since the refusal is deterministic per prompt, the **whole `google` family is skipped for the rest of that request** so a single block can't burn the failover budget across every Gemini key. The Vertex Express path uses `BLOCK_NONE` on all five safety categories (including `HARM_CATEGORY_CIVIC_INTEGRITY`) - see `VERTEX_SAFETY_OFF` in `src/services/ai-providers-execution.js`.

### Google trial credit returns 401 / "API key not valid"
Google AI for Startups credit keys sometimes only authenticate against Vertex AI (Express Mode), not the public Generative Language API. Set `GOOGLE_TRIAL_BACKEND=vertex` (or `VERTEX_PROVIDER=true`) and pick a Vertex-served model with `VERTEX_MODELS=gemini-2.5-flash`. Use `GOOGLE_TRIAL_BACKEND=both` to register both transports - the failover loop will bench whichever 401s.

### `GoogleAI benched 2h (quota unavailable for credential, until <ISO time>)`
The credential group hit its **daily** free-tier limit (`Limit: 0` in the 429 body). Jarvis benches the whole Google credential group for 2 hours to avoid wasting 429-returning probe requests. Adjust via `PERMANENT_QUOTA_BENCH_MS`. The bench ETA is included in the log for easy eyeballing.

### Music - Python version error
yt-dlp wants Python 3.10+. `sudo dnf install -y python3.11 && sudo alternatives --set python3 /usr/bin/python3.11`

### Music - yt-dlp not found
Jarvis downloads `yt-dlp` at runtime. Inspect: `pm2 logs jarvis --lines 100 | grep -i ytdlp`

### Database connection failed

```bash
sudo systemctl status mongod
sudo systemctl start mongod
sudo systemctl enable mongod
```

### Bot not responding

1. `pm2 status jarvis`
2. `pm2 logs jarvis --lines 50`
3. Verify `DISCORD_TOKEN`
4. Restart to re-register slash commands

---

## AI proxy rotation (Cloudflare Workers)

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

`generativelanguage.googleapis.com` is bypassed by default. Gemini rate limits are tied to your Google project/key, so rotating Cloudflare workers tends to amplify `429` responses instead of helping. Unset `AI_PROXY_BYPASS_HOSTS` only if you explicitly want Google requests proxied.

---

## API key auto-discovery

Jarvis auto-discovers numbered API keys:

```env
OPENROUTER_API_KEY=...
OPENROUTER_API_KEY2=...
OPENROUTER_API_KEY3=...
OLLAMA_API_KEY=...
OLLAMA_API_KEY2=...
```

No code changes needed - add keys and restart.

---

## Tests

```bash
npm test               # Unit tests (node:test)
npm run test:coverage  # c8 coverage report → coverage/
npm run test:manual    # Manual/integration tests
npm run lint           # ESLint
npm run format:check   # Prettier check
```

CI (`.github/workflows/ci.yml`) runs tests with coverage and uploads the HTML report as an artifact on every push.

---

## Project structure

```
jarvis-ai/
├── index.js               # Entry point
├── config/                # Validation + central config
├── Dockerfile             # Multi-stage build
├── docker-compose.yml     # Local dev stack
├── src/
│   ├── commands/          # Slash command definitions
│   │   ├── music/         # /play /pause /nowplaying /clearqueue ...
│   │   └── utility/
│   ├── core/              # Feature flags, command registry, cooldowns
│   ├── services/
│   │   ├── handlers/      # moderation-commands, warn-commands, ...
│   │   ├── ai/            # error-normalize, cooldown policy, sanitize (invisible-unicode scrub)
│   │   ├── ai-providers*.js  # Gemini + Vertex Express + OpenAI-compat + Bedrock + Ollama
│   │   ├── brave-search.js
│   │   ├── portal-auth.js
│   │   ├── portal-sessions.js
│   │   ├── jarvis-core.js
│   │   └── database.js
│   ├── server/            # Express setup, rate-limiters, security-guard, health checks
│   └── utils/             # Logger, voice-timer-guard, helpers
├── routes/
│   ├── landing.js / pages.js
│   ├── portal.js          # OAuth + dashboard API
│   ├── webhook.js
│   └── templates/         # landing.html, portal.html
└── tests/                 # node:test suite (~120 tests, including security-guard, invisible-unicode, vertex-express, voice-noise, brave-search)
```

---

## Contributing

1. Fork the repo
2. Create a branch (`git checkout -b feature/thing`)
3. Commit (`git commit -m 'Add thing'`)
4. Push and open a PR

Dependabot is configured to batch weekly minor/patch updates for npm, GitHub Actions, and Docker.

---

## License

GPLv3. See [LICENSE](LICENSE).

**Disclaimer:** "J.A.R.V.I.S." and Iron Man references are fan content. Not affiliated with Marvel or Disney.

---

Made by [not-antoni](https://github.com/not-antoni)

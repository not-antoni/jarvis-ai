# Contributing to Jarvis AI

Thank you for your interest in contributing to Jarvis! This document provides guidelines and information for contributors.

## Architecture Overview

```
jarvis-ai/
├── index.js                    # Entry point, initializes Discord client
├── config/                     # Configuration management
│   └── index.js               # Centralized config with env var handling
├── src/
│   ├── agents/                # AI agent system (experimental)
│   ├── commands/              # Slash command definitions
│   │   ├── music/            # Music commands (play, skip, etc.)
│   │   ├── moderation/       # Mod commands (giveaway, etc.)
│   │   ├── utility/          # Utility commands (quote, etc.)
│   │   └── terf/             # TERF wiki integration
│   ├── core/                  # Core systems
│   │   ├── command-registry.js   # Command definitions for /help
│   │   ├── feature-flags.js      # Feature toggles
│   │   └── loop-detection.js     # Conversation loop prevention
│   ├── handlers/              # Command handlers (NEW - being refactored)
│   ├── routes/                # Express routes
│   │   ├── jarvis.js         # Owner dashboard routes
│   │   └── moderator.js      # Mod panel routes
│   ├── services/              # Business logic
│   │   ├── ai-providers.js       # Multi-provider AI rotation
│   │   ├── database.js           # MongoDB operations
│   │   ├── distube.js            # Music player
│   │   ├── jarvis-core.js        # AI personality & responses
│   │   ├── stark-economy.js      # Economy system
│   │   ├── stark-crypto.js       # Crypto market simulation
│   │   └── GUILDS_FEATURES/      # Per-guild features
│   │       ├── moderation.js     # AI moderation
│   │       ├── threat-database.js # Cross-guild threats
│   │       └── moderation-queue.js # Batch processing
│   └── utils/                 # Utility functions
├── routes/                    # Legacy routes (being migrated)
├── scripts/                   # CLI tools & deployment
├── tests/                     # Test suites
└── docs/                      # Documentation
```

## Key Systems

### AI Provider Rotation
Located in `src/services/ai-providers.js`. Supports:
- OpenRouter, Groq, Google Gemini, OpenAI, Cloudflare Workers AI
- Automatic failover and round-robin rotation
- Per-provider rate limiting

### Economy System
Located in `src/services/stark-economy.js`. Features:
- Stark Bucks (SBX) currency
- Daily rewards, work, gambling, shop
- Cooldown management per user
- MongoDB persistence

### Moderation System
Located in `src/services/GUILDS_FEATURES/moderation.js`. Features:
- AI-powered message analysis
- Batch processing queue
- Cross-guild threat sharing
- Auto-escalation (warn → mute → kick → ban)

### Music System
Located in `src/services/distube.js` and `src/commands/music/`. Features:
- YouTube, SoundCloud, Spotify support
- File uploads (MP3, FLAC, OGG)
- Queue management

## Development Setup

```bash
# Clone the repository
git clone https://github.com/not-antoni/jarvis-ai.git
cd jarvis-ai

# Install dependencies
npm install

# Copy environment template
cp .env.example .env
# Edit .env with your tokens

# Run locally
npm start

# Run tests
npm test

# Lint code
npm run lint
```

## Code Style

We use ESLint with a custom configuration. Key rules:
- 4-space indentation
- Single quotes for strings
- Semicolons required
- Max line length: 120 characters

Run linting before committing:
```bash
npm run lint:fix
```

## Pull Request Process

1. **Fork** the repository
2. **Create a branch** for your feature: `git checkout -b feature/amazing-thing`
3. **Make changes** following code style guidelines
4. **Write tests** for new functionality
5. **Run tests**: `npm test`
6. **Lint code**: `npm run lint`
7. **Commit** with descriptive message
8. **Push** to your fork
9. **Open PR** against `main` branch

### PR Title Format
- `feat: Add new feature`
- `fix: Fix bug description`
- `docs: Update documentation`
- `refactor: Improve code structure`
- `test: Add tests for X`
- `chore: Update dependencies`

## Testing

### Unit Tests
Located in `tests/unit/`. Run with:
```bash
npm test
```

### Manual Tests
Located in `tests/`. Run specific tests:
```bash
npm run test:manual
```

### Writing Tests
Use Node.js built-in test runner:
```javascript
const { describe, it } = require('node:test');
const assert = require('node:assert');

describe('MyFeature', () => {
    it('should do something', () => {
        assert.strictEqual(1 + 1, 2);
    });
});
```

## Environment Variables

See `README.md` for full list. Key variables:
- `DISCORD_TOKEN` - Bot token (required)
- `MONGO_URI_MAIN` - MongoDB connection (required)
- `OPENROUTER_API_KEY` - AI provider (at least one required)

## Feature Flags

Located in `src/core/feature-flags.js`. Features can be:
- Globally enabled/disabled
- Per-guild enabled/disabled
- Environment-dependent

## Questions?

- Join the [Support Server](https://discord.gg/ksXzuBtmK5)
- Open an [Issue](https://github.com/not-antoni/jarvis-ai/issues)

---

Made with ❤️ by [not-antoni](https://github.com/not-antoni)

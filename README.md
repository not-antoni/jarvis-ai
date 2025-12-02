<![CDATA[<div align="center">
  <img src="https://i.imgur.com/YourLogo.png" alt="Jarvis AI" width="200"/>
  
  # 🤖 J.A.R.V.I.S. AI Discord Bot
  
  **Just A Rather Very Intelligent System**
  
  [![Discord](https://img.shields.io/badge/Discord-Add%20Bot-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID)
  [![top.gg](https://img.shields.io/badge/top.gg-Vote-FF3366?style=for-the-badge)](https://top.gg/bot/1402324275762954371)
  [![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)
  
  *A feature-rich Discord bot inspired by Tony Stark's AI assistant*
  
  **145 JS Files • 51,000+ Lines of Code • 100% Open Source**
  
</div>

---

## ✨ Features

### 🧠 AI Chat & Intelligence
- **Multi-Provider AI** - OpenAI GPT-4, Anthropic Claude, Google Gemini, Cohere, local Ollama
- **Context-Aware** - Remembers conversations and user preferences
- **Smart Personas** - Switch between Jarvis, Friday, and custom personalities
- **Brave Search** - Real-time web search integration

### 💰 Stark Bucks Economy
- **Daily Rewards** - Claim daily with streak bonuses (up to 30 days!)
- **Work System** - Funny Stark Industries jobs
- **Gambling** - Slots, coinflip, double-or-nothing
- **Shop** - Buy boosters, badges, and cosmetics
- **Leaderboards** - Compete for the top spot
- **MongoDB Persistence** - Your balance is safe forever

### 🎮 Fun Commands
- **`/rapbattle`** - HUMANOID vs HUMAN rap battles
- **`/roast @user`** - Classy British roasts
- **`/soul`** - View Jarvis's evolving artificial soul
- **`/trivia`** - Stark Industries trivia challenges
- **`/meme`** - Generate memes with custom text

### 🛡️ Moderation
- **Smart Filters** - Catches Cyrillic/Unicode bypass attempts
- **Automod** - Custom word filters with regex support
- **Logging** - Member joins, leaves, message edits/deletes
- **Reaction Roles** - Self-assignable roles via reactions

### 🎵 Music (yt-dlp)
- **YouTube Playback** - Play, pause, skip, queue
- **Auto-Updates** - yt-dlp updates automatically from GitHub

### 🤖 Selfhost-Only Features
- **Sentient Agent** - PC control with safety checks
- **Self-Modification** - Code analysis (read-only)

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ 
- MongoDB database
- Discord Bot Token
- AI API Key (OpenAI/Anthropic/etc.)

### Installation

```bash
# Clone the repository
git clone https://github.com/not-antoni/jarvis-ai.git
cd jarvis-ai

# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env with your tokens
nano .env

# Start the bot
npm start
```

### Environment Variables

Create a `.env` file with these required variables:

```env
# Discord
DISCORD_TOKEN=your_bot_token
DISCORD_CLIENT_ID=your_client_id

# Database
MONGODB_URI=mongodb://localhost:27017/jarvis

# AI (at least one required)
OPENAI_API_KEY=sk-...
# OR
ANTHROPIC_API_KEY=sk-ant-...
# OR
GOOGLE_GEMINI_KEY=...

# Optional
BRAVE_API_KEY=...           # Web search
YOUTUBE_API_KEY=...         # YouTube features
GITHUB_TOKEN=...            # Higher API rate limits
TOPGG_TOKEN=...             # top.gg voting rewards
```

---

## 📋 Commands

### Economy (`/balance`, `/daily`, `/work`, etc.)
| Command | Description |
|---------|-------------|
| `/balance` | Check your Stark Bucks and stats |
| `/daily` | Claim daily reward (streak bonuses!) |
| `/work` | Work at Stark Industries |
| `/gamble <amount>` | Double or nothing |
| `/slots <bet>` | Play the slot machine |
| `/coinflip <bet> <h/t>` | 50/50 coin flip |
| `/shop` | Browse items for sale |
| `/buy <item>` | Purchase an item |
| `/leaderboard` | View richest users |

### Fun
| Command | Description |
|---------|-------------|
| `/rapbattle <bars>` | Challenge Jarvis to a rap battle |
| `/roast @user` | Get a classy British roast |
| `/soul status` | View Jarvis's artificial soul |
| `/trivia` | Answer Stark trivia |
| `/meme <text>` | Generate a meme |

### AI Chat
| Command | Description |
|---------|-------------|
| `@Jarvis <message>` | Chat with Jarvis |
| `/jarvis <prompt>` | Chat via slash command |
| `/persona <name>` | Switch AI personality |
| `/search <query>` | Web search with Brave |

### Moderation
| Command | Description |
|---------|-------------|
| `/filter add <word>` | Add word to filter |
| `/filter remove <word>` | Remove from filter |
| `/automod status` | View automod settings |

---

## 🏗️ Project Structure

```
jarvis-ai/
├── index.js              # Main entry point
├── config/               # Configuration files
├── src/
│   ├── agents/           # AI agents (sentient, browser)
│   ├── commands/         # Slash command handlers
│   ├── core/             # Core systems (cooldowns, features)
│   ├── services/         # Main services
│   │   ├── jarvis-core.js
│   │   ├── ai-providers.js
│   │   ├── stark-economy.js
│   │   ├── moderation-filters.js
│   │   └── discord-handlers-parts/
│   ├── utils/            # Utility functions
│   └── scrapers/         # Web scrapers
├── routes/               # Express routes (dashboard)
├── tests/                # Test files
└── docs/                 # Documentation
```

---

## 📊 Statistics

Run `node count-lines.js` to see current stats:

```
📁 Total JavaScript Files: 145
📝 Total Lines of Code: 51,553
📈 Average Lines per File: 356
```

---

## 🔧 Development

### Running Tests
```bash
npm test
# Or specific tests
node tests/selfhost-features.test.js
node tests/sentient-core.test.js
```

### Code Style
- ES6+ JavaScript
- Async/await for all async operations
- JSDoc comments for functions
- Error handling with try/catch

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing`)
5. Open a Pull Request

---

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.

This project uses various open-source libraries. See the LICENSE file for full attribution.

**Disclaimer:** "J.A.R.V.I.S." and Iron Man references are fan content. This project is not affiliated with Marvel or Disney.

---

## 🙏 Acknowledgments

- [discord.js](https://discord.js.org/) - Discord API library
- [ppbot](https://github.com/schlopp/ppbot) - Economy system inspiration
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) - YouTube downloading
- The Discord bot community

---

<div align="center">
  
  Made with 💙 by [not-antoni](https://github.com/not-antoni)
  
  ⭐ Star this repo if you find it useful!
  
</div>
]]>

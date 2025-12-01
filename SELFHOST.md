# Jarvis Selfhost Guide

Quick setup for running Jarvis on your own machine.

---

## 1. Environment Setup

Copy `.env.example` to `.env` and fill in your tokens:

```env
DISCORD_TOKEN=your_bot_token
MONGO_URI_MAIN=mongodb://localhost:27017/jarvis
# ... other configs
```

---

## 2. Lavalink Music Server (Optional but Recommended)

Lavalink provides fast, reliable YouTube music playback.

### Start Lavalink

**Option A: Double-click**
```
lavalink/start.bat
```

**Option B: PowerShell**
```powershell
cd lavalink
.\start.ps1
```

**Option C: Manual**
```powershell
cd lavalink
& "C:\Program Files\Microsoft\jdk-17.0.17.10-hotspot\bin\java.exe" -Xmx512M -jar Lavalink.jar
```

### Lavalink Environment Variables

Add to your `.env`:
```env
LAVALINK_HOST=localhost:2333
LAVALINK_PASSWORD=youshallnotpass
LAVALINK_ENABLED=true
```

### Using Lavalink

Once running, use `/lavalink play <song>` in Discord.
- **Live search**: Start typing and see YouTube results in real-time!
- Way faster than the regular `/play` command

---

## 3. Start the Bot

**First time setup:**
```powershell
npm install
```

**Start in selfhost mode:**
```powershell
$env:DEPLOY_TARGET="selfhost"; npm start
```

**Or with Lavalink (recommended):**
```powershell
$env:DEPLOY_TARGET="selfhost"; $env:LAVALINK_HOST="localhost:2333"; $env:LAVALINK_PASSWORD="youshallnotpass"; npm start
```

**Alternative:** Add to your `.env`:
```env
DEPLOY_TARGET=selfhost
LAVALINK_HOST=localhost:2333
LAVALINK_PASSWORD=youshallnotpass
```
Then just run:
```powershell
npm start
```

---

## 4. Commands

| Command | Description |
|---------|-------------|
| `/lavalink play <query>` | Play with live YouTube search |
| `/lavalink skip` | Skip track |
| `/lavalink pause` | Pause |
| `/lavalink resume` | Resume |
| `/lavalink stop` | Stop and clear queue |
| `/lavalink queue` | View queue |
| `/play <query>` | Regular music (uses yt-dlp, slower) |

---

## Troubleshooting

### Lavalink won't start
- Make sure Java 17+ is installed: `java -version`
- Check if port 2333 is free

### Bot can't connect to Lavalink
- Verify Lavalink is running (you should see "Lavalink is ready!")
- Check `LAVALINK_HOST` in your `.env`

### No sound in voice channel
- Make sure you're in a voice channel before using `/lavalink play`
- Check bot has permissions to join and speak

---

## File Structure

```
jarvis-ai/
├── lavalink/
│   ├── Lavalink.jar      # Lavalink server
│   ├── application.yml   # Lavalink config
│   ├── start.bat         # Windows startup script
│   └── start.ps1         # PowerShell startup script
├── .env                  # Your environment variables
└── ...
```

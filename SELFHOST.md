# Jarvis Selfhost Guide

Complete guide for running Jarvis on a VPS or local machine.

---

## Quick Start (First Time)

Run the interactive setup wizard:
```bash
node scripts/selfhost-setup.js
```

This will guide you through:
- Configuring your public URL (critical for OAuth)
- Setting up Discord credentials
- Database configuration
- Generating security keys

---

## 1. Environment Setup

Copy `.env.example` to `.env` and configure:

```env
# Required
DISCORD_TOKEN=your_bot_token
MONGO_URI_MAIN=mongodb+srv://...
MONGO_URI_VAULT=mongodb+srv://...
MASTER_KEY_BASE64=<run: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))">

# Selfhost Mode (IMPORTANT!)
DEPLOY_TARGET=selfhost
SELFHOST_MODE=true
PUBLIC_BASE_URL=http://YOUR_VPS_IP:3000  # or https://your-domain.com

# Discord OAuth (for moderator dashboard)
DISCORD_CLIENT_ID=your_app_id
DISCORD_CLIENT_SECRET=your_secret
```

### Critical: OAuth Redirect URLs

In [Discord Developer Portal](https://discord.com/developers/applications):
1. Go to your application → OAuth2 → Redirects
2. Add: `http://YOUR_VPS_IP:3000/auth/discord/callback`
3. Add: `http://YOUR_VPS_IP:3000/moderator/callback`

**If you change your VPS IP or domain, update these redirects!**

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

## 5. VPS Production Setup (Recommended)

### PM2 Process Manager

PM2 keeps your bot running and auto-restarts on crashes:

```bash
# Install PM2
sudo npm install -g pm2

# Start Jarvis
pm2 start index.js --name "jarvis" --max-memory-restart 500M

# Auto-start on boot
pm2 startup
pm2 save

# Useful commands
pm2 logs jarvis      # View logs
pm2 monit            # Real-time monitoring
pm2 restart jarvis   # Restart bot
```

### Nginx Reverse Proxy (Optional)

For HTTPS and cleaner URLs:

```bash
sudo apt install nginx
sudo nano /etc/nginx/sites-available/jarvis
```

Add this configuration:
```nginx
server {
    listen 80;
    server_name your-domain.com;  # or your VPS IP

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Enable the site:
```bash
sudo ln -s /etc/nginx/sites-available/jarvis /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### Firewall Setup

```bash
sudo ufw allow ssh
sudo ufw allow 'Nginx Full'  # or: sudo ufw allow 3000
sudo ufw enable
```

### Backups

Run the included backup script:
```bash
./scripts/backup.sh
```

Set up nightly backups with cron:
```bash
crontab -e
# Add this line:
0 0 * * * /path/to/jarvis-ai/scripts/backup.sh
```

---

## 6. Troubleshooting

### OAuth "Invalid redirect_uri" Error
- Check `PUBLIC_BASE_URL` in `.env` matches your actual URL
- Verify redirect URLs in Discord Developer Portal match exactly
- Run `node scripts/selfhost-check.js` to diagnose

### Bot starts but features don't work
- Run `node scripts/selfhost-setup.js` to verify configuration
- Check MongoDB connection with the startup logs
- Ensure `SELFHOST_MODE=true` is set

### Lavalink won't start
- Make sure Java 17+ is installed: `java -version`
- Check if port 2333 is free

### Bot can't connect to Lavalink
- Verify Lavalink is running (you should see "Lavalink is ready!")
- Check `LAVALINK_HOST` in your `.env`

### No sound in voice channel
- Make sure you're in a voice channel before using `/lavalink play`
- Check bot has permissions to join and speak

### Leaderboard/Quote shows "□□□" (Square Characters)
Missing fonts on your VPS. Install the required fonts:

**Ubuntu/Debian:**
```bash
sudo apt update
sudo apt install -y fonts-noto fonts-noto-cjk fonts-noto-color-emoji
fc-cache -fv
pm2 restart jarvis
```

**Amazon Linux / RHEL:**
```bash
sudo dnf install -y google-noto-sans-fonts google-noto-serif-fonts google-noto-emoji-fonts dejavu-sans-fonts
sudo dnf install -y google-noto-cjk-fonts google-noto-sans-cjk-ttc-fonts google-noto-serif-cjk-ttc-fonts
fc-cache -fv
pm2 restart jarvis
```

**Arch Linux:**
```bash
sudo pacman -S noto-fonts noto-fonts-cjk noto-fonts-emoji
```

### Music Playback Glitches/Stuttering
1. **Check VPS resources**: `htop` - ensure CPU < 80%
2. **Increase buffering** in `src/services/distube.js`:
   - `probesize: 10000000`
   - `analyzeduration: 10000000`
3. **Check network**: `ping cdn.discordapp.com`

### FFprobe/FFmpeg Not Found
Install FFmpeg on your system:

**Ubuntu/Debian:**
```bash
sudo apt install -y ffmpeg
```

**Amazon Linux:**
```bash
# FFmpeg is pre-installed via static build
# Or: sudo dnf install -y ffmpeg
```

### MongoDB Connection Timeout
- Check if MongoDB is running: `sudo systemctl status mongod`
- Verify connection string format
- For Atlas: Whitelist your VPS IP in Network Access

### DNF/YUM Broken on Amazon Linux
If you see `ModuleNotFoundError: No module named 'dnf'`:
```bash
sudo alternatives --set python3 /usr/bin/python3.9
# Or:
sudo ln -sf /usr/bin/python3.9 /usr/bin/python3
```

### Bot Crashes on Startup
1. Check logs: `pm2 logs jarvis --lines 100`
2. Verify all required env vars are set
3. Check MongoDB is accessible
4. Ensure DISCORD_TOKEN is valid

### AI Commands Return "No providers available"
At least one AI provider must be configured:
```env
OPENROUTER_API_KEY=your_key
# OR
GROQ_API_KEY=your_key
# OR
GOOGLE_AI_API_KEY=your_key
```

### Dashboard Login Issues
1. Clear cookies for your domain
2. Check `DASHBOARD_PASSWORD` env var (not `PASSWORD`)
3. Try incognito/private window
4. Verify OAuth redirect URLs match exactly

---

## File Structure

```
jarvis-ai/
├── scripts/
│   ├── selfhost-setup.js  # First-time setup wizard
│   ├── selfhost-check.js  # Configuration validator
│   └── backup.sh          # Backup script
├── lavalink/
│   ├── Lavalink.jar       # Lavalink server
│   ├── application.yml    # Lavalink config
│   ├── start.bat          # Windows startup script
│   └── start.ps1          # PowerShell startup script
├── data/
│   └── .selfhost-setup-complete  # Setup marker
├── .env                   # Your environment variables
└── ...
```

# Local Self-Hosting Setup Guide for Jarvis AI

⚠️ **LOCAL TESTING ONLY** - This guide is for testing self-hosting locally on your PC. When you deploy to a server (Render, etc.), keep `SELFHOST_MODE=false` (the default).

## Quick Start

### 1. Enable Self-Hosting Mode

Set the following environment variable:

```bash
# Linux/Mac
export SELFHOST_MODE=true

# Windows PowerShell
$env:SELFHOST_MODE = "true"

# Windows Command Prompt
set SELFHOST_MODE=true

# .env file
SELFHOST_MODE=true
```

### 2. Configure Database Exports (Optional)

If you want automatic MongoDB exports for backups:

```bash
# Enable auto-export
export SELFHOST_AUTO_EXPORT_MONGO=true

# Set export path (default: ./data/mongo-exports)
export SELFHOST_EXPORT_PATH=/path/to/exports

# Specify collections to export (comma-separated)
export SELFHOST_EXPORT_COLLECTIONS=conversations,userProfiles,guildConfigs
```

### 3. Configure Deployment Target

```bash
# Set deployment target (default: 'render', or 'selfhost')
export DEPLOY_TARGET=selfhost

# Enable headless browser for local scraping
export HEADLESS_BROWSER_ENABLED=true

# Enable agent mode
export AGENT_READY=true
export LIVE_AGENT_MODE=true
```

## Environment Variables Reference

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `SELFHOST_MODE` | boolean | **false** | Enable self-hosting mode (LOCAL TESTING ONLY) |
| `DEPLOY_TARGET` | string | 'render' | Deployment target ('render' or 'selfhost') - keep as 'render' for cloud |
| `SELFHOST_AUTO_EXPORT_MONGO` | boolean | false | Auto-export MongoDB collections (local only) |
| `SELFHOST_EXPORT_PATH` | string | './data/mongo-exports' | Directory for MongoDB exports |
| `SELFHOST_EXPORT_COLLECTIONS` | string | '' | Comma-separated collection names to export |
| `HEADLESS_BROWSER_ENABLED` | boolean | true | Enable local headless browser |
| `AGENT_READY` | boolean | false | Mark agent as ready for production |
| `LIVE_AGENT_MODE` | boolean | true | Enable live agent mode |

## Configuration Object

The self-hosting configuration is accessible via:

```javascript
const config = require('./config');

// Check if self-hosting is enabled
if (config.deployment.selfhostMode) {
    console.log('Self-hosting mode is ENABLED');
}

// Access self-hosting settings
console.log('Export path:', config.deployment.exportPath);
console.log('Export collections:', config.deployment.exportCollections);
console.log('Headless browser:', config.deployment.headlessBrowser);
console.log('Agent ready:', config.deployment.agentReady);
```

## Setup Steps

### Step 1: Install Dependencies

```bash
npm install
```

### Step 2: Configure Environment

Create a `.env` file in the project root:

```env
# Self-Hosting Configuration
SELFHOST_MODE=true
DEPLOY_TARGET=selfhost
HEADLESS_BROWSER_ENABLED=true

# MongoDB Configuration (for exports)
SELFHOST_AUTO_EXPORT_MONGO=true
SELFHOST_EXPORT_PATH=./data/mongo-exports
SELFHOST_EXPORT_COLLECTIONS=conversations,userProfiles,guildConfigs

# Discord Bot
DISCORD_TOKEN=your_token_here
DISCORD_ENABLE_MESSAGE_CONTENT=true

# Optional: Database
MONGO_URI_MAIN=mongodb://localhost:27017
MONGO_DB_MAIN_NAME=jarvis_ai

# Optional: AI Providers
AI_PROVIDER=auto
OPENAI_API_KEY=optional
GROQ_API_KEY=optional
```

### Step 3: Start the Bot

```bash
# Development with self-hosting (LOCAL ONLY)
npm run dev

# Production on Render (keep SELFHOST_MODE=false)
npm start

# Do NOT set SELFHOST_MODE=true when deploying to Render
```

### Step 4: For Cloud Deployment (Render, etc.)

**Do NOT set SELFHOST_MODE=true on cloud platforms like Render.** Keep default settings:

```env
# Render deployment - keep these defaults
SELFHOST_MODE=false          # ← Keep FALSE (default)
DEPLOY_TARGET=render         # ← Keep as render (default)
HEADLESS_BROWSER_ENABLED=true
```

### Step 5: Verify Self-Hosting (Local Only)

```bash
# Check config is loaded correctly
node -e "const config = require('./config'); console.log('Self-host mode:', config.deployment.selfhostMode); console.log('Export path:', config.deployment.exportPath);"
```

## Features Available in Self-Hosting Mode (Local Testing)

When `SELFHOST_MODE=true` on your local PC, the following features are available:

- ✅ Local deployment testing on your PC
- ✅ MongoDB auto-export to local filesystem
- ✅ Custom export collection selection
- ✅ Local headless browser support
- ✅ Full agent mode testing
- ✅ Custom port configuration
- ✅ Health check endpoints
- ✅ All Discord commands and features

⚠️ **When deploying to Render (or any cloud platform):** Keep `SELFHOST_MODE=false` (default) and use platform-specific configuration instead.

## Troubleshooting

### Self-hosting mode not recognized

**Problem**: Config shows `selfhostMode: undefined`

**Solution**: Ensure the environment variable is set correctly before starting:

```bash
echo $SELFHOST_MODE  # Check it's set
node index.js       # Start the bot
```

### Export path not working

**Problem**: Exports not being saved

**Solution**: Ensure the directory exists:

```bash
mkdir -p ./data/mongo-exports
chmod 755 ./data/mongo-exports
```

### Headless browser not working

**Problem**: Browser operations failing

**Solution**: Install headless browser dependencies:

```bash
# Ubuntu/Debian
sudo apt-get install chromium-browser

# Mac
brew install chromium

# Then set the path if needed
export PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
```

## Monitoring Self-Hosting

### Check Self-Host Status

```bash
# View deployment configuration
node -e "const c = require('./config'); console.log(JSON.stringify(c.deployment, null, 2));"
```

### View Export Logs

```bash
# Check what was exported
ls -la ./data/mongo-exports/
tail -f ./data/mongo-exports/*.log
```

### Verify Database Exports

```bash
# Restore from export (example)
mongorestore --db jarvis_ai ./data/mongo-exports/jarvis_ai/
```

## Security Considerations

When self-hosting:

1. **Keep .env private** - Don't commit `.env` to version control
2. **Use strong credentials** - Set secure Discord and API tokens
3. **Restrict network access** - Only expose necessary ports
4. **Backup regularly** - Enable auto-export and backup frequently
5. **Monitor logs** - Keep an eye on application logs
6. **Update dependencies** - Regularly run `npm update`

## Docker Deployment (Optional)

Example Dockerfile for self-hosting:

```dockerfile
FROM node:18-alpine

WORKDIR /app

# Copy files
COPY package*.json ./
RUN npm ci --only=production

COPY . .

# Create export directory
RUN mkdir -p ./data/mongo-exports

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Start bot
CMD ["node", "index.js"]
```

Build and run:

```bash
# Build
docker build -t jarvis-ai-selfhost .

# Run
docker run -e SELFHOST_MODE=true \
           -e DISCORD_TOKEN=your_token \
           -e MONGO_URI_MAIN=mongodb://host.docker.internal:27017 \
           -v $(pwd)/data:/app/data \
           -p 3000:3000 \
           jarvis-ai-selfhost
```

## Support

For issues or questions about self-hosting:

1. Check the troubleshooting section above
2. Review environment variable settings
3. Check application logs for error messages
4. Verify MongoDB connectivity if using exports
5. Ensure all required dependencies are installed

---

## ⚠️ IMPORTANT: Cloud Deployment (Render, Heroku, etc.)

**When deploying to cloud platforms, keep the default configuration:**

```env
# NEVER set to true on cloud platforms
SELFHOST_MODE=false          # Default
DEPLOY_TARGET=render         # Default for Render
```

Self-hosting mode is for **local testing on your PC only**. Render and other cloud platforms have their own deployment requirements and will not work with `SELFHOST_MODE=true`.

---

**Last Updated**: November 29, 2025
**Status**: Active

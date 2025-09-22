# 🚀 Render Deployment Checklist

## Pre-Deployment Checklist

### ✅ Code Changes
- [x] Added "jarvis search" handler to discord-handlers.js
- [x] Added handleWikiSearch method to jarvis-core.js
- [x] Created requirements.txt for Python dependencies
- [x] Updated render.yaml to include Python setup
- [x] Updated DEPLOYMENT.md with new features

### ✅ Files Ready
- [x] scraper.py (unchanged, as requested)
- [x] requirements.txt (jsonlines==4.0.1)
- [x] render.yaml (updated with pip install)
- [x] All Node.js files updated

### ✅ Dependencies
- [x] Node.js dependencies in package.json
- [x] Python dependencies in requirements.txt
- [x] Python integration tested locally

## Render Configuration

### Build Command
```yaml
buildCommand: |
  npm install
  python3 -m pip install --upgrade pip
  python3 -m pip install -r requirements.txt
```

### Environment Variables Required
- `DISCORD_TOKEN` (required)
- `MONGO_PW` (required)
- At least one AI provider API key (recommended)

## New Features Added

### Wiki Search Command
- **Command**: `jarvis search [query]`
- **Function**: Searches wiki using Python scraper
- **Integration**: Uses child_process.spawn to call scraper.py
- **Output**: Formatted list of found pages

### Example Usage
```
jarvis search energy research
jarvis search facility
jarvis search troty
```

## Deployment Steps

1. **Commit all changes** to your GitHub repository
2. **Push to main branch**
3. **Deploy on Render** - it will automatically:
   - Install Node.js dependencies
   - Install Python dependencies
   - Start the bot

## Post-Deployment Testing

1. Check Render logs for any errors
2. Test the bot responds to mentions
3. Test `/jarvis` slash command
4. Test `jarvis search [query]` command
5. Verify health endpoint: `https://your-app.onrender.com/health`

## Potential Issues & Solutions

### Python Not Found
- **Issue**: "python: command not found"
- **Solution**: Render should have Python available, but if not, change `python` to `python3` in jarvis-core.js

### Missing jsonlines
- **Issue**: "ModuleNotFoundError: No module named 'jsonlines'"
- **Solution**: 
  - Verify requirements.txt is in the repo
  - Use `python3` instead of `python` in buildCommand
  - Ensure buildCommand includes: `python3 -m pip install -r requirements.txt`

### Permission Issues
- **Issue**: Python process fails to start
- **Solution**: Check Render logs for specific error messages

## Status: ✅ READY FOR DEPLOYMENT

All code changes are complete and tested. The bot is ready to be deployed on Render with the new "jarvis search" functionality.

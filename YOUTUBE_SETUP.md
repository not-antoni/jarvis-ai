# YouTube Search Feature Setup

## Overview
Jarvis now supports YouTube video search with the command pattern: `jarvis yt [search terms]`

## Requirements
- YouTube Data API v3 key from Google Cloud Console
- `googleapis` npm package (already installed)

## Setup Instructions

### 1. Get YouTube API Key
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable the **YouTube Data API v3**
4. Go to "Credentials" and create an API key
5. (Optional) Restrict the API key to YouTube Data API v3 for security

### 2. Configure Environment Variable
Add your API key to your `.env` file:
```
YOUTUBE_API_KEY=your_api_key_here
```

### 3. Test the Feature
Run the test script to verify everything works:
```bash
node test-youtube.js
```

## Usage

### Command Format
The command must be in this exact order:
```
jarvis yt [search terms]
```

### Examples
- `jarvis yt how to bake a cake` ✅ (will search YouTube)
- `jarvis yt funny cats` ✅ (will search YouTube)
- `jarvis bake a cake search yt` ❌ (will use normal AI response)
- `jarvis help me find yt videos` ❌ (will use normal AI response)

### Response Format
When a video is found, Jarvis will respond with:
- Video title
- Channel name  
- Direct YouTube URL

## Error Handling
- If no API key is configured, YouTube search will be disabled
- If no videos are found, Jarvis will inform the user
- API errors are handled gracefully with fallback messages

## API Limits
- YouTube Data API has daily quotas
- Each search costs 100 quota units
- Default quota is 10,000 units per day (100 searches)
- Monitor usage in Google Cloud Console

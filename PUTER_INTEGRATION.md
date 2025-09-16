# Puter AI Provider Integration

This document explains how to integrate and use Puter as an AI provider in your Jarvis Discord bot.

## Overview

Puter has been added as a new AI provider that can be used alongside your existing providers (OpenRouter, Groq, Google AI, Mixtral, HuggingFace, and Vercel OpenAI). The integration makes HTTP requests to Puter's API endpoints to generate AI responses.

## Setup

### 1. Environment Variables

Add your Puter tokens to your environment variables:

```bash
# Primary Puter token
export PUTER_TOKEN=your_puter_token_here

# Optional: Secondary Puter token for load balancing
export PUTER_TOKEN2=your_secondary_puter_token_here
```

### 2. Getting Your Puter Token

1. Visit your Puter app at: https://puter.com/app/ai-23
2. Sign in to your Puter account
3. Navigate to your account settings or API section
4. Generate or copy your API token
5. Set it as an environment variable

## How It Works

### Provider Configuration

The Puter provider is automatically initialized when you start the bot if `PUTER_TOKEN` is available. It supports:

- **Multiple tokens**: Up to 2 Puter tokens for load balancing
- **Model**: Uses `gpt-4.1-nano` by default (as per Puter documentation)
- **API Endpoint**: `https://api.puter.com/drivers/call`
- **Authentication**: Bearer token authentication

### Request Format

The integration sends HTTP POST requests to Puter's `/drivers/call` endpoint with the following structure:

```json
{
  "interface": "puter-chat-completion",
  "driver": "openai-completion",
  "test_mode": false,
  "method": "complete",
  "args": {
    "messages": [
      { "role": "system", "content": "System instructions" },
      { "role": "user", "content": "User's prompt" }
    ],
    "model": "gpt-4.1-nano",
    "temperature": 0.6,
    "max_tokens": 500
  }
}
```

### Response Handling

The provider expects responses in this format:

```json
{
  "success": true,
  "service": { "name": "ai-chat" },
  "result": {
    "index": 0,
    "message": {
      "role": "assistant",
      "content": "AI generated response text",
      "refusal": null,
      "annotations": []
    },
    "logprobs": null,
    "finish_reason": "stop",
    "usage": [...],
    "via_ai_chat_service": true
  },
  "metadata": { "service_used": "openai-completion" }
}
```

## Testing

### Run the Test Script

Test your Puter integration:

```bash
npm run test-puter
```

This will:
1. Check if Puter tokens are available
2. Show provider status
3. Attempt a test AI request
4. Display detailed error information if something goes wrong

### Manual Testing

You can also test the integration by starting your Discord bot and using it normally. The Puter provider will be included in the provider rotation and used automatically.

## Troubleshooting

### Common Issues

1. **No Puter providers found**
   - Ensure `PUTER_TOKEN` is set in your environment
   - Check that the token is valid and not expired

2. **API errors**
   - Verify the token has proper permissions
   - Check if the API endpoint is correct
   - Ensure your Puter account has sufficient credits

3. **Invalid response format**
   - The API might have changed its response structure
   - Check Puter's documentation for updates

### Debug Information

The test script provides detailed debugging information including:
- Provider initialization status
- Error messages and timestamps
- Performance metrics
- API response details

## Integration Details

### Code Location

The Puter integration is implemented in:
- `ai-providers.js`: Main provider logic
- `test-puter.js`: Test script
- `PUTER_INTEGRATION.md`: This documentation

### Provider Priority

Puter providers are included in the automatic provider ranking system based on:
- Success rate
- Average response time
- Error frequency

### Fallback Behavior

If Puter providers fail, the system automatically falls back to other available providers in order of their performance ranking.

## API Endpoints

The integration uses the following Puter API endpoint:
- **URL**: `https://api.puter.com/drivers/call`
- **Method**: POST
- **Headers**: 
  - `Content-Type: application/json;charset=UTF-8`
  - `Authorization: Bearer {token}`
  - `Origin: https://ai-23-wafrt.puter.site`
  - `Referer: https://ai-23-wafrt.puter.site/`
  - `User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)`

## Notes

- The integration is based on reverse engineering of Puter's client-side API
- If Puter changes their API structure, the integration may need updates
- The provider supports multiple tokens for load balancing and redundancy
- All standard AI provider features (metrics, error handling, fallback) are supported
